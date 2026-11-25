/**
 * The Solana way to pay the refundable submission fee from the pay page
 * (operator decision, 25 November 2026; PRD section 6, "Submission fee
 * deposits", "Solana"). The browser cannot read a Solana endpoint by itself,
 * so the API prepares the payer's one transaction and reads its outcome
 * (`backend/submission-fee/solana-pay.ts`). The page does not trust what it
 * gets back: it builds the same message here from the published tables, the
 * item it computed and the connected wallet, and refuses a prepared
 * transaction that differs by one byte. Nothing here signs; the wallet does.
 */

import { solanaAssociatedTokenAddress } from "../../contracts/solana/adapter";
import {
  depositInstruction,
  reclaimInstruction,
  type SubmissionDepositsIdl,
  submissionDepositAddress,
} from "../../contracts/solana/submission-deposits";
import { message } from "../../contracts/solana/transactions";
import { decodeBase58Bytes } from "./base58";
import { readBoundedJson } from "./browser-json";
import type { VaultConnection } from "./evm-vault-actions";
import { apiRequest } from "./project-api";
import { CANONICAL_UINT } from "./record-validation.mjs";
import { sendSolanaWalletTransaction } from "./solana-vault-actions";
import { assertUnsignedSolanaWire } from "./solana-wire";
import { SUBMISSION_FEE_SOLANA_RENT_LAMPORTS } from "./submission-fee.mjs";
import type { SolanaFeeWay } from "./submission-fee-page";

/** The pull request a deposit pays, as the page resolved it. */
export type SolanaFeeSubject = {
  repositoryId: string;
  pullNumber: number;
  /** The item hash the page computed; never the API's. */
  item: string;
};

/** A reviewed deposit: everything the wallet is about to sign. */
export type SolanaFeePlan = {
  wallet: string;
  /** The payer-chosen number in the deposit record's address, decimal. */
  nonce: string;
  amount: string;
  blockhash: string;
  lastValidBlockHeight: number;
  transaction: string;
  networkFeeLamports: string;
  rentLamports: string;
  /** The deposit record's address, derived here. */
  deposit: string;
};

export type SolanaReclaimPlan = {
  wallet: string;
  deposit: string;
  mint: string;
  amount: string;
  blockhash: string;
  lastValidBlockHeight: number;
  transaction: string;
  networkFeeLamports: string;
};

export type SolanaFeeStatus = "pending" | "failed" | "finalized";

const PATH = "submission-fee/solana";
const NONCE_TRIES = 3;

class NonceUsed extends Error {}

async function post(body: Record<string, unknown>) {
  const response = await apiRequest(PATH, { body, timeoutMs: 90_000 });
  const value = (await readBoundedJson(
    response,
    16_384,
    "Solana fee response",
  )) as Record<string, unknown> | null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The fee service returned an invalid response.");
  if (response.status === 409 && value.error === "nonce_used")
    throw new NonceUsed();
  if (!response.ok) {
    if (response.status === 422 && typeof value.message === "string")
      throw new Error(value.message);
    if (response.status === 404)
      throw new Error("Paying on Solana is not available for this fee.");
    throw new Error("The Solana fee service did not answer. Try again.");
  }
  return value;
}

/** A random unsigned 64-bit number: the payer's nonce. */
function randomNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return new DataView(bytes.buffer).getBigUint64(0, true);
}

function lifetime(plan: Record<string, unknown>) {
  if (
    typeof plan.blockhash !== "string" ||
    decodeBase58Bytes(plan.blockhash).length !== 32 ||
    !Number.isSafeInteger(plan.lastValidBlockHeight) ||
    (plan.lastValidBlockHeight as number) < 0 ||
    typeof plan.transaction !== "string" ||
    typeof plan.networkFeeLamports !== "string" ||
    !CANONICAL_UINT.test(plan.networkFeeLamports)
  )
    throw new Error("The fee review response is invalid.");
  return {
    blockhash: plan.blockhash,
    lastValidBlockHeight: plan.lastValidBlockHeight as number,
    transaction: plan.transaction,
    networkFeeLamports: plan.networkFeeLamports,
  };
}

/**
 * The one `deposit` instruction as a message, built from the published
 * tables: the program, the USDC mint, the fee wallet, the page's own item
 * hash and the fee amount. The source is the wallet's associated USDC
 * account.
 */
export function solanaFeeMessage(
  way: SolanaFeeWay,
  input: { wallet: string; item: string; nonce: bigint; blockhash: string },
  idl?: SubmissionDepositsIdl,
): Uint8Array {
  return message(input.wallet, input.blockhash, [
    depositInstruction(
      {
        programId: way.programId,
        payer: input.wallet,
        mint: way.token,
        source: solanaAssociatedTokenAddress(way.token, input.wallet),
        item: input.item,
        amount: BigInt(way.amount),
        keptTo: way.keptTo,
        nonce: input.nonce,
      },
      idl,
    ),
  ]);
}

/** The payer's own `reclaim` into their associated account, as a message. */
export function solanaReclaimMessage(
  way: SolanaFeeWay,
  input: { wallet: string; deposit: string; blockhash: string },
  idl?: SubmissionDepositsIdl,
): Uint8Array {
  return message(input.wallet, input.blockhash, [
    reclaimInstruction(
      {
        programId: way.programId,
        payer: input.wallet,
        deposit: input.deposit,
        mint: way.token,
        destination: solanaAssociatedTokenAddress(way.token, input.wallet),
      },
      idl,
    ),
  ]);
}

/**
 * Prepares the deposit and checks it. A nonce this wallet already used is
 * replaced by a new random one without asking the payer anything.
 */
export async function reviewSolanaFee(
  way: SolanaFeeWay,
  subject: SolanaFeeSubject,
  wallet: VaultConnection,
  idl?: SubmissionDepositsIdl,
): Promise<SolanaFeePlan> {
  if (!wallet.solanaSend)
    throw new Error("Choose a wallet with Solana transaction support.");
  for (let attempt = 0; ; attempt += 1) {
    const nonce = randomNonce();
    let value: Record<string, unknown>;
    try {
      value = await post({
        step: "review",
        repositoryId: subject.repositoryId,
        pullNumber: subject.pullNumber,
        wallet: wallet.address,
        nonce: nonce.toString(),
      });
    } catch (caught) {
      if (caught instanceof NonceUsed && attempt + 1 < NONCE_TRIES) continue;
      if (caught instanceof NonceUsed)
        throw new Error("The deposit could not be prepared. Try again.");
      throw caught;
    }
    const plan = value.plan as Record<string, unknown> | null;
    if (
      !plan ||
      typeof plan !== "object" ||
      plan.wallet !== wallet.address ||
      plan.nonce !== nonce.toString() ||
      plan.amount !== way.amount ||
      plan.rentLamports !== SUBMISSION_FEE_SOLANA_RENT_LAMPORTS
    )
      throw new Error("The fee review differs from this pull request's fee.");
    const life = lifetime(plan);
    // The wallet signs only the message this page built itself.
    assertUnsignedSolanaWire(
      life.transaction,
      solanaFeeMessage(
        way,
        {
          wallet: wallet.address,
          item: subject.item,
          nonce,
          blockhash: life.blockhash,
        },
        idl,
      ),
      "The prepared transaction differs from the reviewed deposit.",
    );
    return {
      ...life,
      wallet: wallet.address,
      nonce: nonce.toString(),
      amount: way.amount,
      rentLamports: SUBMISSION_FEE_SOLANA_RENT_LAMPORTS,
      deposit: submissionDepositAddress(way.programId, wallet.address, nonce),
    };
  }
}

export async function sendSolanaFee(
  way: SolanaFeeWay,
  subject: SolanaFeeSubject,
  wallet: VaultConnection,
  plan: SolanaFeePlan,
  beforeSend: () => void,
  idl?: SubmissionDepositsIdl,
): Promise<string> {
  if (plan.wallet !== wallet.address)
    throw new Error("Connect and review the intended wallet again.");
  return sendSolanaWalletTransaction(
    { network: way.network as "solana-mainnet" },
    wallet,
    plan.transaction,
    solanaFeeMessage(
      way,
      {
        wallet: wallet.address,
        item: subject.item,
        nonce: BigInt(plan.nonce),
        blockhash: plan.blockhash,
      },
      idl,
    ),
    beforeSend,
  );
}

function status(value: Record<string, unknown>): SolanaFeeStatus {
  if (
    value.status !== "pending" &&
    value.status !== "failed" &&
    value.status !== "finalized"
  )
    throw new Error("The transaction status could not be verified.");
  return value.status;
}

/** The finalized outcome of a deposit this tab sent. */
export async function checkSolanaFee(
  subject: SolanaFeeSubject,
  saved: { wallet: string; nonce: string; blockhash: string },
  transactionId: string,
): Promise<SolanaFeeStatus> {
  return status(
    await post({
      step: "check",
      repositoryId: subject.repositoryId,
      pullNumber: subject.pullNumber,
      wallet: saved.wallet,
      nonce: saved.nonce,
      blockhash: saved.blockhash,
      transactionId,
    }),
  );
}

/**
 * Prepares the payer's `reclaim` of a deposit the program still holds after
 * its delay, and checks it against the message built here.
 */
export async function reviewSolanaReclaim(
  way: SolanaFeeWay,
  subject: SolanaFeeSubject,
  wallet: VaultConnection,
  idl?: SubmissionDepositsIdl,
): Promise<SolanaReclaimPlan> {
  if (!wallet.solanaSend)
    throw new Error("Choose a wallet with Solana transaction support.");
  const value = await post({
    step: "reclaim-review",
    repositoryId: subject.repositoryId,
    pullNumber: subject.pullNumber,
    wallet: wallet.address,
  });
  const plan = value.plan as Record<string, unknown> | null;
  if (
    !plan ||
    typeof plan !== "object" ||
    plan.wallet !== wallet.address ||
    plan.mint !== way.token ||
    typeof plan.deposit !== "string" ||
    decodeBase58Bytes(plan.deposit).length !== 32 ||
    typeof plan.amount !== "string" ||
    !/^[1-9][0-9]{0,19}$/u.test(plan.amount)
  )
    throw new Error("The reclaim review response is invalid.");
  const life = lifetime(plan);
  assertUnsignedSolanaWire(
    life.transaction,
    solanaReclaimMessage(
      way,
      {
        wallet: wallet.address,
        deposit: plan.deposit,
        blockhash: life.blockhash,
      },
      idl,
    ),
    "The prepared transaction differs from the reviewed reclaim.",
  );
  return {
    ...life,
    wallet: wallet.address,
    deposit: plan.deposit,
    mint: way.token,
    amount: plan.amount,
  };
}

export async function sendSolanaReclaim(
  way: SolanaFeeWay,
  wallet: VaultConnection,
  plan: SolanaReclaimPlan,
  beforeSend: () => void,
  idl?: SubmissionDepositsIdl,
): Promise<string> {
  if (plan.wallet !== wallet.address)
    throw new Error("Connect and review the intended wallet again.");
  return sendSolanaWalletTransaction(
    { network: way.network as "solana-mainnet" },
    wallet,
    plan.transaction,
    solanaReclaimMessage(
      way,
      {
        wallet: wallet.address,
        deposit: plan.deposit,
        blockhash: plan.blockhash,
      },
      idl,
    ),
    beforeSend,
  );
}

export async function checkSolanaReclaim(
  subject: SolanaFeeSubject,
  saved: { wallet: string; deposit: string; blockhash: string },
  transactionId: string,
): Promise<SolanaFeeStatus> {
  return status(
    await post({
      step: "reclaim-check",
      repositoryId: subject.repositoryId,
      pullNumber: subject.pullNumber,
      wallet: saved.wallet,
      deposit: saved.deposit,
      blockhash: saved.blockhash,
      transactionId,
    }),
  );
}
