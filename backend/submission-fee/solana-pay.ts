/**
 * The Solana way to pay the refundable submission fee (operator decision,
 * 25 November 2026; PRD section 6, "Submission fee deposits", "Solana"):
 *
 *   POST /api/v1/submission-fee/solana
 *
 * A browser cannot read a Solana endpoint by itself, so this route prepares
 * the payer's one transaction and reads its outcome, as the vault funding
 * route does. It signs nothing and holds no key. Every address it uses comes
 * from the reviewed tables in `src/lib/submission-fee.mjs`, the item from
 * Slopbot's stored row, and nothing but the payer's own wallet address and a
 * nonce from the request. The page builds the same message from the same
 * tables and refuses a prepared transaction that differs by one byte.
 *
 * Steps: `review` prepares a `deposit` of the pull request's fee; `check`
 * reads that transaction's finalized outcome; `reclaim-review` prepares the
 * payer's own `reclaim` of a deposit the program still holds after its
 * delay; `reclaim-check` reads its outcome. The route answers 404 while the
 * program id is not published or Solana is not switched on.
 *
 * A reclaim does not depend on anything Slop recorded: the wallet's open
 * deposits for the pull request are found on chain, by the payer and item
 * stored in each record.
 *
 * Nobody signs in here, and every request reads the shared payment
 * endpoint, so requests are counted before anything is read: 20 a minute
 * from one address, 30 a minute for one pull request and 120 a minute in
 * all. A request makes at most six reads (`SOLANA_PAY_READS`).
 */

import {
  SolanaRpcUnavailable,
  solanaAssociatedTokenAddress,
  solanaBase64Bytes,
  solanaPubkey,
  solanaRpc,
} from "../../contracts/solana/adapter";
import {
  decodeSubmissionConfig,
  decodeSubmissionDeposit,
  depositInstruction,
  reclaimInstruction,
  type SubmissionDeposit,
  type SubmissionDepositsIdl,
  submissionConfigAddress,
  submissionDepositAddress,
  submissionDepositDiscriminator,
  submissionDepositOffset,
  submissionDepositSize,
} from "../../contracts/solana/submission-deposits";
import { CLASSIC_TOKEN_PROGRAM } from "../../contracts/solana/token";
import { message } from "../../contracts/solana/transactions";
import {
  checkSolanaMessageTransaction,
  prepareSolanaWalletTransaction,
  SolanaWalletActionError,
} from "../../contracts/solana/wallet-transactions";
import { decodeBase58Bytes, encodeBase58Bytes } from "../../src/lib/base58";
import {
  SUBMISSION_FEE_SOLANA_RENT_LAMPORTS,
  validStableFee,
} from "../../src/lib/submission-fee.mjs";
import { isWalletAddress } from "../../src/lib/wallets";
import { consumeExactRateLimit } from "../../workers/identity/rate-limit";
import type { D1Database, D1QueryStatement } from "../d1";
import { json, readJsonObject } from "../http";

type Database = D1Database<D1QueryStatement>;

/** The published Solana deployment and a private endpoint to read it. */
export interface SolanaFeeDeployment {
  network: string;
  programId: string;
  mint: string;
  feeWallet: string;
  rpcUrl: string;
  /** Tests only: another program interface than the committed IDL. */
  idl?: SubmissionDepositsIdl;
}

const ID = /^[1-9][0-9]{0,15}$/u;
const NONCE = /^(0|[1-9][0-9]{0,19})$/u;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const U64_MAX = (1n << 64n) - 1n;
const refuse = (message: string, error = "fee_action_rejected") =>
  json(422, { error, message }, { cacheControl: "no-store" });
const ok = (body: unknown) => json(200, body, { cacheControl: "no-store" });

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SolanaRpcUnavailable("Invalid chain response");
  return value as Obj;
};

/**
 * The most reads of the payment endpoint one request makes: the open
 * deposits of a wallet, the accounts it needs in one read, and the four of
 * preparing a wallet transaction (blockhash, fee, balance, simulation).
 */
export const SOLANA_PAY_READS = 6;
/** Requests a minute: from one address, for one pull request, in all. */
export const SOLANA_PAY_LIMITS = { address: 20, item: 30, all: 120 } as const;
/** A wallet's open deposits for one pull request looked at for a reclaim. */
const RECLAIM_CANDIDATES = 20;

/**
 * Accounts read together at finalized commitment: for each address its
 * bytes when it exists and `owner` owns it, else null.
 */
async function accountsBytes(
  deployment: SolanaFeeDeployment,
  wanted: readonly { address: string; owner: string }[],
): Promise<(Uint8Array | null)[]> {
  const values = object(
    await solanaRpc(deployment, "getMultipleAccounts", [
      wanted.map((entry) => entry.address),
      { commitment: "finalized", encoding: "base64" },
    ]),
  ).value;
  if (!Array.isArray(values) || values.length !== wanted.length)
    throw new SolanaRpcUnavailable("Invalid chain response");
  return values.map((value, at) => {
    if (value === null || value === undefined) return null;
    const info = object(value);
    if (
      info.owner !== wanted[at].owner ||
      !Array.isArray(info.data) ||
      info.data[1] !== "base64" ||
      typeof info.data[0] !== "string"
    )
      return null;
    return solanaBase64Bytes(info.data[0]);
  });
}

/**
 * A wallet's associated token account of the mint: its balance in base
 * units when it exists, belongs to the wallet and is not frozen; else null.
 */
function tokenBalance(
  bytes: Uint8Array | null,
  mint: string,
  wallet: string,
): bigint | null {
  if (
    bytes === null ||
    bytes.length !== 165 ||
    solanaPubkey(bytes, 0) !== mint ||
    solanaPubkey(bytes, 32) !== wallet ||
    bytes[108] !== 1
  )
    return null;
  return new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(64, true);
}

/**
 * The open deposit records this wallet paid for this item, oldest first,
 * found on chain: the endpoint filters by the record's size, first eight
 * bytes, payer and item. At most twenty are looked at.
 */
async function openDepositsOf(
  deployment: SolanaFeeDeployment,
  wallet: string,
  item: string,
): Promise<(SubmissionDeposit & { account: string })[]> {
  const idl = deployment.idl;
  const itemBytes = Uint8Array.from(item.slice(2).match(/../gu) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
  const found = await solanaRpc(deployment, "getProgramAccounts", [
    deployment.programId,
    {
      commitment: "finalized",
      encoding: "base64",
      filters: [
        { dataSize: submissionDepositSize(idl) },
        {
          memcmp: {
            offset: 0,
            bytes: encodeBase58Bytes(submissionDepositDiscriminator(idl)),
          },
        },
        {
          memcmp: {
            offset: submissionDepositOffset("payer", idl),
            bytes: wallet,
          },
        },
        {
          memcmp: {
            offset: submissionDepositOffset("item", idl),
            bytes: encodeBase58Bytes(itemBytes),
          },
        },
      ],
    },
  ]);
  if (!Array.isArray(found))
    throw new SolanaRpcUnavailable("Invalid chain response");
  const records: (SubmissionDeposit & { account: string })[] = [];
  for (const entry of found.map(object)) {
    const info = object(entry.account);
    if (
      typeof entry.pubkey !== "string" ||
      info.owner !== deployment.programId ||
      !Array.isArray(info.data) ||
      typeof info.data[0] !== "string"
    )
      throw new SolanaRpcUnavailable("Invalid chain response");
    const record = decodeSubmissionDeposit(
      solanaBase64Bytes(info.data[0]),
      idl,
    );
    // The record's own facts, whatever the endpoint filtered by.
    if (
      record.payer !== wallet ||
      record.item.toLowerCase() !== item.toLowerCase() ||
      entry.pubkey !==
        submissionDepositAddress(deployment.programId, wallet, record.nonce)
    )
      continue;
    records.push({ ...record, account: entry.pubkey });
  }
  return records
    .sort((left, right) => left.id - right.id)
    .slice(0, RECLAIM_CANDIDATES);
}

function depositMessage(
  deployment: SolanaFeeDeployment,
  input: {
    wallet: string;
    item: string;
    amount: string;
    nonce: bigint;
    blockhash: string;
  },
) {
  return message(input.wallet, input.blockhash, [
    depositInstruction(
      {
        programId: deployment.programId,
        payer: input.wallet,
        mint: deployment.mint,
        source: solanaAssociatedTokenAddress(deployment.mint, input.wallet),
        item: input.item,
        amount: BigInt(input.amount),
        keptTo: deployment.feeWallet,
        nonce: input.nonce,
      },
      deployment.idl,
    ),
  ]);
}

function reclaimIx(
  deployment: SolanaFeeDeployment,
  wallet: string,
  deposit: string,
  mint: string,
) {
  return reclaimInstruction(
    {
      programId: deployment.programId,
      payer: wallet,
      deposit,
      mint,
      destination: solanaAssociatedTokenAddress(mint, wallet),
    },
    deployment.idl,
  );
}

async function hasTable(db: Database, name: string) {
  const row = await db
    .prepare(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(name)
    .first<{ found: number }>();
  return row?.found === 1;
}

/** The pull request's stored fee row, or null when Slop asked none. */
async function itemRow(db: Database, repositoryId: number, pull: number) {
  if (!(await hasTable(db, "submission_fee_items"))) return null;
  return db
    .prepare(
      `SELECT item, stable_minor, paid_at, paid_deposit_id, outcome
         FROM submission_fee_items WHERE repository_id = ? AND pull_number = ?`,
    )
    .bind(repositoryId, pull)
    .first<{
      item: string;
      stable_minor: string;
      paid_at: string | null;
      paid_deposit_id: number | null;
      outcome: string | null;
    }>();
}

export async function handleSolanaFeePay(
  request: Request,
  deps: {
    db: Database;
    now: () => Date;
    /** Null while Solana is not offered: every request is then not found. */
    deployment: () => SolanaFeeDeployment | null;
    /** The secret the request counters are keyed with (32 or more chars). */
    rateLimitSecret?: string;
  },
): Promise<Response> {
  const notFound = () =>
    json(404, { error: "not_found" }, { cacheControl: "no-store" });
  if (request.method !== "POST")
    return json(405, { error: "method_not_allowed" });
  let deployment: SolanaFeeDeployment | null;
  try {
    deployment = deps.deployment();
  } catch {
    // No private endpoint is configured: Solana is not offered here.
    deployment = null;
  }
  if (deployment === null) return notFound();
  const body = await readJsonObject(request, 2048, "fee payment action");
  const steps = ["review", "check", "reclaim-review", "reclaim-check"];
  if (
    !body ||
    typeof body.step !== "string" ||
    !steps.includes(body.step) ||
    typeof body.repositoryId !== "string" ||
    !ID.test(body.repositoryId) ||
    !Number.isSafeInteger(body.pullNumber) ||
    (body.pullNumber as number) < 1 ||
    typeof body.wallet !== "string" ||
    !isWalletAddress("solana", body.wallet)
  )
    return json(400, { error: "invalid_fee_action" });
  const step = body.step;
  const wallet = body.wallet;
  const checking = step === "check" || step === "reclaim-check";
  if (
    checking &&
    (typeof body.blockhash !== "string" ||
      !isWalletAddress("solana", body.blockhash) ||
      typeof body.transactionId !== "string" ||
      body.transactionId.length > 100)
  )
    return json(400, { error: "invalid_fee_action" });
  if (
    step === "reclaim-check" &&
    (typeof body.deposit !== "string" ||
      !ADDRESS.test(body.deposit) ||
      decodeBase58Bytes(body.deposit).length !== 32)
  )
    return json(400, { error: "invalid_fee_action" });
  // Counted before anything is read, here or on the chain. Without the
  // secret the counters cannot be kept, and nothing is read at all.
  const secret = deps.rateLimitSecret ?? "";
  if (secret.length < 32)
    return json(
      503,
      { error: "temporarily_unavailable" },
      { cacheControl: "no-store" },
    );
  const counted: [string, string, number][] = [
    [
      "address",
      request.headers.get("cf-connecting-ip") ?? "unattributed",
      SOLANA_PAY_LIMITS.address,
    ],
    ["item", `${body.repositoryId}:${body.pullNumber}`, SOLANA_PAY_LIMITS.item],
    ["all", "all", SOLANA_PAY_LIMITS.all],
  ];
  for (const [scope, principal, limit] of counted) {
    const admission = await consumeExactRateLimit({
      db: deps.db as unknown as Parameters<
        typeof consumeExactRateLimit
      >[0]["db"],
      limit,
      nowEpochSeconds: Math.floor(deps.now().getTime() / 1000),
      principal,
      scope: `submission-fee-solana-${scope}`,
      secret,
      windowSeconds: 60,
    });
    if (!admission.allowed) {
      const response = json(
        429,
        { error: "rate_limited" },
        { cacheControl: "no-store" },
      );
      response.headers.set("retry-after", String(admission.retryAfterSeconds));
      return response;
    }
  }
  const row = await itemRow(
    deps.db,
    Number(body.repositoryId),
    body.pullNumber as number,
  );
  if (!row || !validStableFee(row.stable_minor)) return notFound();
  try {
    if (step === "review" || step === "check") {
      if (
        typeof body.nonce !== "string" ||
        !NONCE.test(body.nonce) ||
        BigInt(body.nonce) > U64_MAX
      )
        return json(400, { error: "invalid_fee_action" });
      const nonce = BigInt(body.nonce);
      const facts = { wallet, item: row.item, amount: row.stable_minor, nonce };
      if (step === "check")
        return ok({
          status: (
            await checkSolanaMessageTransaction(
              deployment,
              wallet,
              depositMessage(deployment, {
                ...facts,
                blockhash: body.blockhash as string,
              }),
              body.transactionId as string,
            )
          ).status,
        });
      if (row.paid_deposit_id !== null || row.outcome !== null)
        return refuse(
          "This pull request is already recorded as paid. Nothing was prepared.",
          "fee_already_paid",
        );
      const deposit = submissionDepositAddress(
        deployment.programId,
        wallet,
        nonce,
      );
      // The program's Config, the fee wallet's and the payer's USDC
      // accounts and the record address, in one read.
      const [config, feeAccount, payerAccount, used] = await accountsBytes(
        deployment,
        [
          {
            address: submissionConfigAddress(deployment.programId),
            owner: deployment.programId,
          },
          {
            address: solanaAssociatedTokenAddress(
              deployment.mint,
              deployment.feeWallet,
            ),
            owner: CLASSIC_TOKEN_PROGRAM,
          },
          {
            address: solanaAssociatedTokenAddress(deployment.mint, wallet),
            owner: CLASSIC_TOKEN_PROGRAM,
          },
          { address: deposit, owner: deployment.programId },
        ],
      );
      if (config === null)
        return refuse("Solana deposits are not available right now.");
      if (decodeSubmissionConfig(config, deployment.idl).depositsPaused)
        return refuse(
          "New Solana deposits are paused right now. Pay another way, or try again later.",
        );
      // A kept fee must have somewhere to go before any deposit is taken.
      if (
        tokenBalance(feeAccount, deployment.mint, deployment.feeWallet) === null
      )
        return refuse("Solana deposits are not available right now.");
      const balance = tokenBalance(payerAccount, deployment.mint, wallet);
      if (balance === null)
        return refuse(
          "This wallet has no USDC account on Solana. A refund goes to that account, so it must exist before you pay.",
        );
      if (balance < BigInt(row.stable_minor))
        return refuse("This wallet does not hold enough USDC on Solana.");
      // This payer already used this nonce: the page picks another.
      if (used !== null)
        return json(409, { error: "nonce_used" }, { cacheControl: "no-store" });
      const instruction = depositInstruction(
        {
          programId: deployment.programId,
          payer: wallet,
          mint: deployment.mint,
          source: solanaAssociatedTokenAddress(deployment.mint, wallet),
          item: row.item,
          amount: BigInt(row.stable_minor),
          keptTo: deployment.feeWallet,
          nonce,
        },
        deployment.idl,
      );
      return ok({
        plan: {
          ...(await prepareSolanaWalletTransaction(deployment, wallet, [
            instruction,
          ])),
          wallet,
          nonce: body.nonce,
          amount: row.stable_minor,
          rentLamports: SUBMISSION_FEE_SOLANA_RENT_LAMPORTS,
        },
      });
    }
    // Reclaim. The outcome of one the payer sent: the same message, built
    // from the wallet, the record address and the table's mint.
    if (step === "reclaim-check")
      return ok({
        status: (
          await checkSolanaMessageTransaction(
            deployment,
            wallet,
            message(wallet, body.blockhash as string, [
              reclaimIx(
                deployment,
                wallet,
                body.deposit as string,
                deployment.mint,
              ),
            ]),
            body.transactionId as string,
          )
        ).status,
      });
    // The wallet's own open deposits for this pull request, found on chain,
    // oldest first. Nothing Slop recorded is needed for it.
    const open = (await openDepositsOf(deployment, wallet, row.item)).filter(
      (record) => record.mint === deployment.mint,
    );
    if (open.length === 0)
      return refuse(
        "No deposit from this wallet for this pull request is still held by the deposit program.",
        "no_open_deposit",
      );
    const [config, payerAccount] = await accountsBytes(deployment, [
      {
        address: submissionConfigAddress(deployment.programId),
        owner: deployment.programId,
      },
      {
        address: solanaAssociatedTokenAddress(deployment.mint, wallet),
        owner: CLASSIC_TOKEN_PROGRAM,
      },
    ]);
    if (config === null)
      return refuse("Solana deposits are not available right now.");
    const delay = decodeSubmissionConfig(config, deployment.idl).reclaimDelay;
    let earliest: number | null = null;
    for (const record of open) {
      const from = record.depositedAt + delay;
      if (from * 1000 > deps.now().getTime()) {
        earliest = earliest === null ? from : Math.min(earliest, from);
        continue;
      }
      if (tokenBalance(payerAccount, deployment.mint, wallet) === null)
        return refuse(
          "This wallet has no USDC account on Solana to take the deposit back into. Create it in your wallet, then try again.",
        );
      return ok({
        plan: {
          ...(await prepareSolanaWalletTransaction(deployment, wallet, [
            reclaimIx(deployment, wallet, record.account, record.mint),
          ])),
          wallet,
          deposit: record.account,
          mint: record.mint,
          amount: record.amount,
        },
      });
    }
    return refuse(
      `This wallet's deposit can be taken back from ${new Date((earliest ?? 0) * 1000).toISOString()}.`,
      "reclaim_too_early",
    );
  } catch (error) {
    if (error instanceof SolanaWalletActionError) return refuse(error.message);
    if (error instanceof SolanaRpcUnavailable)
      return json(
        503,
        { error: "temporarily_unavailable" },
        { cacheControl: "no-store" },
      );
    throw error;
  }
}
