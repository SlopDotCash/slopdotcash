import { hexToBytes } from "@noble/hashes/utils.js";
import { Response } from "miniflare";
import { base58Decode, base58Encode, base64Decode, base64Encode } from "@repo/platform/chain/solana";
import type { Handler } from "@repo/platform/testing";
import { solanaGenesis } from "../../src/runtime/pins.ts";
import { solanaSeedKey } from "../../src/signer/solanaKey.ts";
import {
  CLASSIC_TOKEN_PROGRAM,
  CONFIG_DISCRIMINATOR,
  DEPOSIT_DISCRIMINATOR,
  SOLANA_SUBMISSION_FEE_DEPOSIT_BYTES,
  SOLANA_SUBMISSION_FEE_KEPT_TO,
  SOLANA_SUBMISSION_FEE_MINT,
  SOLANA_SUBMISSION_FEE_PROGRAM_ID,
  associatedUsdcAccount,
  firstTransactionSignature,
  hex32Bytes,
  reclaimInstruction,
  resolveInstruction,
  submissionConfigAddress,
  submissionDepositAddress,
  submissionVaultAddress,
} from "../../src/submissionFee/solanaProgram.ts";

export interface FakeSolanaDeposit {
  readonly id: number;
  readonly payer: string;
  readonly nonce: bigint;
  readonly item: string;
  readonly amount: bigint;
  readonly depositedAt: number;
  readonly mint?: string;
  readonly keptTo?: string;
  open: boolean;
}

export interface FakeSolanaStatus {
  readonly slot: number;
  readonly confirmationStatus: "processed" | "confirmed" | "finalized" | null;
  readonly err: unknown;
}

export interface FakeSolanaLedger {
  readonly programId: string;
  readonly owner: string;
  readonly resolver: string;
  readonly mint: string;
  readonly feeWallet: string;
  slot: number;
  blockHeight: number;
  paused: boolean;
  reclaimDelay: number;
  blockhash: string;
  lastValidBlockHeight: number;
  feeLamports: number;
  sendFails: boolean;
  readonly tokenAccounts: Map<string, { readonly mint: string; readonly owner: string; readonly amount: bigint; readonly state: number }>;
  readonly deposits: Map<number, FakeSolanaDeposit>;
  readonly sent: { readonly sig: string; readonly rawTx: string }[];
  readonly statuses: Map<string, FakeSolanaStatus>;
  readonly transactions: Map<string, unknown>;
  readonly signaturesByAddress: Map<string, { readonly signature: string; readonly slot: number; readonly err: unknown; readonly blockTime: number }[]>;
}

function encodeConfig(ledger: FakeSolanaLedger): Uint8Array {
  const out = new Uint8Array(122);
  out.set(CONFIG_DISCRIMINATOR, 0);
  out.set(base58Decode(ledger.owner) ?? new Uint8Array(32), 8);
  out.set(base58Decode(ledger.resolver) ?? new Uint8Array(32), 72);
  const view = new DataView(out.buffer);
  view.setBigInt64(104, BigInt(ledger.reclaimDelay), true);
  view.setBigUint64(112, BigInt(ledger.deposits.size), true);
  out[120] = ledger.paused ? 1 : 0;
  out[121] = 255;
  return out;
}

function encodeDeposit(deposit: FakeSolanaDeposit, ledger: FakeSolanaLedger): Uint8Array {
  const out = new Uint8Array(SOLANA_SUBMISSION_FEE_DEPOSIT_BYTES);
  out.set(DEPOSIT_DISCRIMINATOR, 0);
  const view = new DataView(out.buffer);
  view.setBigUint64(8, BigInt(deposit.id), true);
  out.set(base58Decode(deposit.payer) ?? new Uint8Array(32), 16);
  view.setBigUint64(48, deposit.nonce, true);
  out.set(base58Decode(deposit.mint ?? ledger.mint) ?? new Uint8Array(32), 56);
  out.set(base58Decode(deposit.keptTo ?? ledger.feeWallet) ?? new Uint8Array(32), 88);
  out.set(hex32Bytes(deposit.item) ?? new Uint8Array(32), 120);
  view.setBigUint64(152, deposit.amount, true);
  view.setBigInt64(160, BigInt(deposit.depositedAt), true);
  out[168] = 254;
  return out;
}

function encodeTokenAccount(entry: { readonly mint: string; readonly owner: string; readonly amount: bigint; readonly state: number }): Uint8Array {
  const out = new Uint8Array(165);
  out.set(base58Decode(entry.mint) ?? new Uint8Array(32), 0);
  out.set(base58Decode(entry.owner) ?? new Uint8Array(32), 32);
  new DataView(out.buffer).setBigUint64(64, entry.amount, true);
  out[108] = entry.state;
  return out;
}

/** @throws {never} */
export function solanaAddressFromHex(seedHex: string): string {
  return solanaSeedKey(hexToBytes(seedHex))?.address ?? "";
}

/** @throws {never} */
export function depositAccountOf(ledger: FakeSolanaLedger, deposit: FakeSolanaDeposit): string {
  return submissionDepositAddress(ledger.programId, deposit.payer, deposit.nonce) ?? "";
}

/** @throws {never} */
export function buildSettlementTransaction(params: {
  readonly ledger: FakeSolanaLedger;
  readonly deposit: FakeSolanaDeposit;
  readonly kind: "refunded" | "kept" | "reclaimed";
  readonly slot: number;
  readonly blockTime: number;
}): unknown {
  const { ledger, deposit, kind, slot, blockTime } = params;
  const depositAddr = depositAccountOf(ledger, deposit);
  const mint = deposit.mint ?? ledger.mint;
  const vault = submissionVaultAddress(ledger.programId, mint) ?? "";
  const wallet = kind === "kept" ? (deposit.keptTo ?? ledger.feeWallet) : deposit.payer;
  const destination = associatedUsdcAccount(wallet, mint) ?? "";
  const ix = kind === "reclaimed"
    ? reclaimInstruction({ programId: ledger.programId, payer: deposit.payer, deposit: depositAddr, mint, destination })
    : resolveInstruction({
      programId: ledger.programId,
      resolver: ledger.resolver,
      deposit: depositAddr,
      mint,
      destination,
      payer: deposit.payer,
      refund: kind === "refunded",
      expectedId: BigInt(deposit.id),
    });
  if (ix === undefined) return null;
  const accountKeys = [...new Set([ix.programId, ...ix.keys.map((k) => k.pubkey)])];
  const transferData = new Uint8Array(10);
  transferData[0] = 12;
  new DataView(transferData.buffer).setBigUint64(1, deposit.amount, true);
  transferData[9] = 6;
  const destIndex = accountKeys.indexOf(destination);
  return {
    slot,
    blockTime,
    transaction: {
      message: {
        accountKeys,
        instructions: [
          {
            programIdIndex: accountKeys.indexOf(ix.programId),
            accounts: ix.keys.map((k) => accountKeys.indexOf(k.pubkey)),
            data: base58Encode(ix.data),
          },
        ],
      },
    },
    meta: {
      err: null,
      innerInstructions: [
        {
          index: 0,
          instructions: [
            {
              stackHeight: 2,
              programIdIndex: accountKeys.indexOf(CLASSIC_TOKEN_PROGRAM),
              accounts: [accountKeys.indexOf(vault), accountKeys.indexOf(mint), destIndex, accountKeys.indexOf(depositAddr)],
              data: base58Encode(transferData),
            },
          ],
        },
      ],
      preTokenBalances: [{ accountIndex: destIndex, mint, owner: wallet, uiTokenAmount: { amount: "0" } }],
      postTokenBalances: [{ accountIndex: destIndex, mint, owner: wallet, uiTokenAmount: { amount: deposit.amount.toString() } }],
    },
  };
}

/** @throws {never} */
export function createFakeSolanaLedger(owner: string, resolver: string): FakeSolanaLedger {
  const programId = SOLANA_SUBMISSION_FEE_PROGRAM_ID ?? "4St4KPBhaHZw29gEaqstU9TzYHRfXLq7aat932r1uzW7";
  const feeAta = associatedUsdcAccount(SOLANA_SUBMISSION_FEE_KEPT_TO, SOLANA_SUBMISSION_FEE_MINT) ?? "";
  const tokenAccounts = new Map<string, { readonly mint: string; readonly owner: string; readonly amount: bigint; readonly state: number }>();
  tokenAccounts.set(feeAta, { mint: SOLANA_SUBMISSION_FEE_MINT, owner: SOLANA_SUBMISSION_FEE_KEPT_TO, amount: 0n, state: 1 });
  return {
    programId,
    owner,
    resolver,
    mint: SOLANA_SUBMISSION_FEE_MINT,
    feeWallet: SOLANA_SUBMISSION_FEE_KEPT_TO,
    slot: 474_212_000,
    blockHeight: 350_000_000,
    paused: false,
    reclaimDelay: 2_592_000,
    blockhash: base58Encode(new Uint8Array(32).fill(7)),
    lastValidBlockHeight: 350_000_150,
    feeLamports: 5_000,
    sendFails: false,
    tokenAccounts,
    deposits: new Map(),
    sent: [],
    statuses: new Map(),
    transactions: new Map(),
    signaturesByAddress: new Map(),
  };
}

function accountPayload(ledger: FakeSolanaLedger, addr: string): { readonly owner: string; readonly data: readonly [string, "base64"] } | null {
  if (addr === submissionConfigAddress(ledger.programId))
    return { owner: ledger.programId, data: [base64Encode(encodeConfig(ledger)), "base64"] };
  const token = ledger.tokenAccounts.get(addr);
  if (token !== undefined)
    return { owner: CLASSIC_TOKEN_PROGRAM, data: [base64Encode(encodeTokenAccount(token)), "base64"] };
  for (const deposit of ledger.deposits.values()) {
    if (deposit.open && depositAccountOf(ledger, deposit) === addr)
      return { owner: ledger.programId, data: [base64Encode(encodeDeposit(deposit, ledger)), "base64"] };
  }
  return null;
}

/** @throws {never} */
export function nextSolanaBlockhash(ledger: FakeSolanaLedger, fillByte: number): void {
  ledger.blockhash = base58Encode(new Uint8Array(32).fill(fillByte));
  ledger.lastValidBlockHeight = ledger.blockHeight + 150;
}

/** @throws {never} */
export function solanaFeeRpc(ledger: FakeSolanaLedger): Handler {
  return async (request) => {
    const call = JSON.parse(await request.text()) as { readonly id: unknown; readonly method: string; readonly params: ReadonlyArray<unknown> };
    const answered = (result: unknown) => Response.json({ jsonrpc: "2.0", id: call.id, result });
    const refused = (code: number, message: string) => Response.json({ jsonrpc: "2.0", id: call.id, error: { code, message } });
    switch (call.method) {
      case "getGenesisHash": return answered(solanaGenesis);
      case "getEpochInfo": return answered({ absoluteSlot: ledger.slot, blockHeight: ledger.blockHeight });
      case "getLatestBlockhash": return answered({ value: { blockhash: ledger.blockhash, lastValidBlockHeight: ledger.lastValidBlockHeight } });
      case "getFeeForMessage": return answered({ value: ledger.feeLamports });
      case "simulateTransaction": return answered({ value: { err: null } });
      case "getAccountInfo": {
        const addr = String(call.params[0]);
        return answered({ context: { slot: ledger.slot }, value: accountPayload(ledger, addr) });
      }
      case "getMultipleAccounts": {
        const addrs = call.params[0] as ReadonlyArray<string>;
        return answered({ context: { slot: ledger.slot }, value: addrs.map((addr) => accountPayload(ledger, addr)) });
      }
      case "getProgramAccounts": {
        const opts = (call.params[1] ?? {}) as { readonly withContext?: boolean; readonly dataSlice?: { readonly offset: number; readonly length: number } };
        const entries = [...ledger.deposits.values()]
          .filter((deposit) => deposit.open && (deposit.mint ?? ledger.mint) === ledger.mint && (deposit.keptTo ?? ledger.feeWallet) === ledger.feeWallet)
          .map((deposit) => {
            const full = encodeDeposit(deposit, ledger);
            const slice = opts.dataSlice === undefined ? full : full.subarray(opts.dataSlice.offset, opts.dataSlice.offset + opts.dataSlice.length);
            return { pubkey: depositAccountOf(ledger, deposit), account: { owner: ledger.programId, data: [base64Encode(slice), "base64"] } };
          });
        return answered(opts.withContext === true ? { context: { slot: ledger.slot }, value: entries } : entries);
      }
      case "getSignaturesForAddress": {
        const addr = String(call.params[0]);
        return answered(ledger.signaturesByAddress.get(addr) ?? []);
      }
      case "getTransaction": {
        const sig = String(call.params[0]);
        return answered(ledger.transactions.get(sig) ?? null);
      }
      case "getSignatureStatuses": {
        const sigs = call.params[0] as ReadonlyArray<string>;
        return answered({ context: { slot: ledger.slot }, value: sigs.map((sig) => ledger.statuses.get(sig) ?? null) });
      }
      case "sendTransaction": {
        if (ledger.sendFails) return refused(-32000, "upstream unavailable");
        const rawTx = String(call.params[0]);
        const wire = base64Decode(rawTx);
        const sig = wire === undefined ? undefined : firstTransactionSignature(wire);
        if (sig === undefined) return refused(-32602, "invalid wire tx");
        ledger.sent.push({ sig, rawTx });
        return answered(sig);
      }
      default: return refused(-32601, `unexpected ${call.method}`);
    }
  };
}
