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
  type SubmissionDepositsIdl,
  submissionConfigAddress,
  submissionDepositAddress,
} from "../../contracts/solana/submission-deposits";
import { CLASSIC_TOKEN_PROGRAM } from "../../contracts/solana/token";
import { message } from "../../contracts/solana/transactions";
import {
  checkSolanaMessageTransaction,
  prepareSolanaWalletTransaction,
  SolanaWalletActionError,
} from "../../contracts/solana/wallet-transactions";
import {
  SUBMISSION_FEE_SOLANA_RENT_LAMPORTS,
  validStableFee,
} from "../../src/lib/submission-fee.mjs";
import { isWalletAddress } from "../../src/lib/wallets";
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

/** An account's bytes at finalized commitment, or null when it is absent. */
async function accountBytes(
  deployment: SolanaFeeDeployment,
  address: string,
  owner: string,
): Promise<Uint8Array | null> {
  const value = object(
    await solanaRpc(deployment, "getAccountInfo", [
      address,
      { commitment: "finalized", encoding: "base64" },
    ]),
  ).value;
  if (value === null || value === undefined) return null;
  const info = object(value);
  if (
    info.owner !== owner ||
    !Array.isArray(info.data) ||
    info.data[1] !== "base64" ||
    typeof info.data[0] !== "string"
  )
    return null;
  return solanaBase64Bytes(info.data[0]);
}

/**
 * A wallet's associated token account of the mint: its balance in base
 * units when it exists, belongs to the wallet and is not frozen; else null.
 */
async function tokenBalance(
  deployment: SolanaFeeDeployment,
  mint: string,
  wallet: string,
): Promise<bigint | null> {
  const bytes = await accountBytes(
    deployment,
    solanaAssociatedTokenAddress(mint, wallet),
    CLASSIC_TOKEN_PROGRAM,
  );
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
      const config = await accountBytes(
        deployment,
        submissionConfigAddress(deployment.programId),
        deployment.programId,
      );
      if (config === null)
        return refuse("Solana deposits are not available right now.");
      if (decodeSubmissionConfig(config, deployment.idl).depositsPaused)
        return refuse(
          "New Solana deposits are paused right now. Pay another way, or try again later.",
        );
      // A kept fee must have somewhere to go before any deposit is taken.
      if (
        (await tokenBalance(
          deployment,
          deployment.mint,
          deployment.feeWallet,
        )) === null
      )
        return refuse("Solana deposits are not available right now.");
      const balance = await tokenBalance(deployment, deployment.mint, wallet);
      if (balance === null)
        return refuse(
          "This wallet has no USDC account on Solana. A refund goes to that account, so it must exist before you pay.",
        );
      if (balance < BigInt(row.stable_minor))
        return refuse("This wallet does not hold enough USDC on Solana.");
      const deposit = submissionDepositAddress(
        deployment.programId,
        wallet,
        nonce,
      );
      // This payer already used this nonce: the page picks another.
      if (
        (await accountBytes(deployment, deposit, deployment.programId)) !== null
      )
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
    // Reclaim: the payer's own open deposit for this pull request, oldest
    // first, as the Worker recorded it with its record's address.
    const recorded = await deps.db
      .prepare(
        `SELECT deposit_id, deposit_account, token FROM submission_fee_deposits
          WHERE network = ? AND item = ? AND payer = ?
            AND deposit_account IS NOT NULL
            AND (? = 1 OR state IN ('open', 'refund_due', 'kept_due'))
          ORDER BY deposit_id LIMIT 20`,
      )
      .bind(deployment.network, row.item, wallet, checking ? 1 : 0)
      .all<{ deposit_id: number; deposit_account: string; token: string }>();
    if (step === "reclaim-check") {
      const named = recorded.results.find(
        (entry) => entry.deposit_account === body.deposit,
      );
      if (!named) return json(400, { error: "invalid_fee_action" });
      return ok({
        status: (
          await checkSolanaMessageTransaction(
            deployment,
            wallet,
            message(wallet, body.blockhash as string, [
              reclaimIx(deployment, wallet, named.deposit_account, named.token),
            ]),
            body.transactionId as string,
          )
        ).status,
      });
    }
    const config = await accountBytes(
      deployment,
      submissionConfigAddress(deployment.programId),
      deployment.programId,
    );
    if (config === null)
      return refuse("Solana deposits are not available right now.");
    const delay = decodeSubmissionConfig(config, deployment.idl).reclaimDelay;
    let earliest: number | null = null;
    for (const entry of recorded.results) {
      const bytes = await accountBytes(
        deployment,
        entry.deposit_account,
        deployment.programId,
      );
      // Already settled: its record is closed.
      if (bytes === null) continue;
      const record = decodeSubmissionDeposit(bytes, deployment.idl);
      // The address may hold a later deposit of the same payer and nonce;
      // only the recorded deposit itself is offered.
      if (
        record.id !== entry.deposit_id ||
        record.payer !== wallet ||
        record.mint !== entry.token
      )
        continue;
      const from = record.depositedAt + delay;
      if (from * 1000 > deps.now().getTime()) {
        earliest = earliest === null ? from : Math.min(earliest, from);
        continue;
      }
      if ((await tokenBalance(deployment, record.mint, wallet)) === null)
        return refuse(
          "This wallet has no USDC account on Solana to take the deposit back into. Create it in your wallet, then try again.",
        );
      return ok({
        plan: {
          ...(await prepareSolanaWalletTransaction(deployment, wallet, [
            reclaimIx(deployment, wallet, entry.deposit_account, record.mint),
          ])),
          wallet,
          deposit: entry.deposit_account,
          mint: record.mint,
          amount: record.amount,
        },
      });
    }
    return refuse(
      earliest === null
        ? "No deposit from this wallet for this pull request is still held by the deposit program."
        : `This wallet's deposit can be taken back from ${new Date(earliest * 1000).toISOString()}.`,
      earliest === null ? "no_open_deposit" : "reclaim_too_early",
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
