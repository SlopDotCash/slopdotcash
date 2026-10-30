import {
  proveSolanaExpiry,
  type RecoveryRpc,
  recoveryOperator,
} from "./solana-expiry";
/**
 * Solana fee-wallet client. Routes come from the Jupiter Swap API. Each
 * Jupiter transaction is parsed before signing: the fee wallet is the only
 * signer and fee payer, every top-level program is on a short allowlist, and
 * a simulation must credit the fee wallet's USDC account with at least the
 * signed minimum.
 *
 * Vault fee claims (issue #905) call only the escrow program's permissionless
 * `claim_fees` for a vault named in a reviewed manifest, after the deployment
 * verifies at finalized commitment and its fee recipient is this fee wallet.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  PROJECT_DISCRIMINATOR,
  PROJECT_SIZE,
  SOLANA_NATIVE_ASSET,
  type SolanaEscrowConfig,
  solanaAccount,
  solanaBase58,
  solanaBase64,
  solanaBase64Bytes,
  solanaUint,
  solanaVaultAddress,
  verifySolanaDeployment,
} from "../../contracts/solana/adapter";
import { nativeLamportDeltas } from "../../contracts/solana/native";
import {
  inspectMintAccount,
  inspectTokenAccount,
  TOKEN_2022_PROGRAM,
} from "../../contracts/solana/token";
import {
  ata,
  concat,
  createAta,
  instructionData,
  message as legacyMessage,
} from "../../contracts/solana/transactions";
import { decodeBase58Bytes } from "../../src/lib/base58";
import { readBoundedJson } from "../../src/lib/browser-json";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import type { Limits, NetworkConfig } from "./config";
import type {
  AccruedFees,
  ChainClient,
  ConversionRow,
  FeeVault,
  PreparedSend,
  Quote,
  QuoteResult,
  SendStatus,
  VaultFeeClient,
} from "./core";
import type { NativeGasJournal } from "./native-gas";
import {
  associatedAccountCreations,
  resolveSolanaAccounts,
  type SolanaAccountProof,
  verifySolanaAccountProof,
} from "./solana-accounts";
import { WRAPPED_SOL, wrapNativeRoute } from "./solana-native-route";
import {
  assertSolanaRouteSimulation,
  reviewSolanaRouteAccounts,
} from "./solana-route-accounts";
import {
  finalizedRouteCredit,
  type RouteReceipt,
} from "./solana-route-receipt";

export const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const ASSOCIATED_TOKEN = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
/**
 * Top-level programs a conversion may invoke: compute budget, idempotent
 * associated-account creation and the Jupiter router. System and token
 * programs never run at top level, so no direct transfer can be added.
 */
const ALLOWED_PROGRAMS = new Set([
  COMPUTE_BUDGET,
  ASSOCIATED_TOKEN,
  JUPITER_PROGRAM,
]);

type Fetch = typeof fetch;

export interface SolanaClientOptions {
  config: NetworkConfig;
  limits: Limits;
  jupiterApiUrl: string;
  jupiterApiKey: string | null;
  /** Solana CLI keypair JSON (64 numbers). Absent in dry_run. */
  keypair?: string;
  nativeGas?: NativeGasJournal;
  recoveryRpcUrl?: string;
  fetch?: Fetch;
  /**
   * Local validator tests only: re-stamp the Jupiter message with the local
   * blockhash before signing. The hosted Worker never sets this.
   */
  localBlockhash?: boolean;
  /** Exact local validator identity supplied only by the integration harness. */
  localGenesisHash?: string;
  /**
   * Unit tests only: stands in for the finalized program, Config and project
   * verification. The hosted Worker never sets it.
   */
  verifyDeployment?: (config: SolanaEscrowConfig) => Promise<Uint8Array>;
  sleep?: (ms: number) => Promise<void>;
}

/** Project account offset of `accrued_fees` (contracts/solana/adapter.ts). */
const ACCRUED_FEES_OFFSET = 316;
/** Status polls after a claim is broadcast, CLAIM_POLL_MS apart. */
const CLAIM_POLLS = 60;
const CLAIM_POLL_MS = 2_000;

/**
 * The reviewed manifest deployment of one Solana vault as the adapter's
 * escrow config. A missing or malformed field refuses the claim; the cluster
 * genesis comes from the escrow network registry, never from the record.
 */
export function solanaEscrowConfig(
  entry: FeeVault,
  rpcUrl: string,
): SolanaEscrowConfig {
  const record = entry.deployment;
  const text = (key: string): string => {
    const value = record[key];
    if (typeof value !== "string" || value.length === 0)
      throw new Error(`reviewed Solana deployment lacks ${key}`);
    return value;
  };
  const network = text("network");
  const cluster = Object.hasOwn(ESCROW_NETWORKS, network)
    ? ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS]
    : undefined;
  if (cluster?.family !== "solana" || typeof cluster.genesisHash !== "string")
    throw new Error(`reviewed deployment network ${network} is not Solana`);
  return {
    payoutPolicy: entry.payoutPolicy,
    rpcUrl,
    genesisHash: cluster.genesisHash,
    programId: text("programId"),
    projectPda: text("projectPda"),
    projectId: entry.projectId,
    network,
    networkDomain: text("networkDomain"),
    vault: text("vault"),
    mint: text("asset"),
    owner: text("owner"),
    identityAuthority: text("identityAuthority"),
    feeRecipient: text("feeRecipient"),
    rotationAuthority: text("rotationAuthority"),
    codeSha256: text("codeSha256"),
    upgradeAuthority:
      record.upgradeAuthority === null ? null : text("upgradeAuthority"),
    bindingDelaySeconds: text("bindingDelaySeconds"),
    rotationDelaySeconds: text("rotationDelaySeconds"),
  };
}

function compactLength(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0;
  for (let shift = 0, i = 0; i < 3; i++, shift += 7) {
    const byte = bytes[offset + i];
    if (byte === undefined) throw new Error("truncated transaction");
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value, offset + i + 1];
  }
  throw new Error("invalid compact length");
}

export interface ParsedTransaction {
  signatureCount: number;
  messageOffset: number;
  requiredSignatures: number;
  readonlySigned: number;
  readonlyUnsigned: number;
  staticKeys: string[];
  blockhashOffset: number;
  programs: string[];
  legacy: boolean;
  lookups: { address: string; writable: number[]; readonly: number[] }[];
  instructions: { program: string; accounts: number[]; data: Uint8Array }[];
}

/** Parse the entire signed wire message, including every v0 address lookup. */
export function parseTransaction(raw: Uint8Array): ParsedTransaction {
  const [signatureCount, afterCount] = compactLength(raw, 0);
  const messageOffset = afterCount + signatureCount * 64;
  let offset = messageOffset;
  const take = (count: number) => {
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      offset + count > raw.length
    )
      throw new Error("truncated transaction");
    const part = raw.slice(offset, offset + count);
    offset += count;
    return part;
  };
  const length = () => {
    const [n, next] = compactLength(raw, offset);
    offset = next;
    return n;
  };
  if (messageOffset >= raw.length || raw.length > 1232)
    throw new Error("invalid transaction size");
  const legacy = (raw[offset] & 0x80) === 0;
  if (!legacy && take(1)[0] !== 0x80)
    throw new Error("unsupported message version");
  const [requiredSignatures, readonlySigned, readonlyUnsigned] = take(3);
  const keyCount = length();
  if (
    keyCount < requiredSignatures ||
    signatureCount !== requiredSignatures ||
    readonlySigned > requiredSignatures ||
    readonlyUnsigned > keyCount - requiredSignatures
  )
    throw new Error("invalid transaction signer header");
  const staticKeys = Array.from({ length: keyCount }, () =>
    solanaBase58(take(32)),
  );
  const blockhashOffset = offset;
  take(32);
  const programs: string[] = [],
    instructions: ParsedTransaction["instructions"] = [];
  const instructionCount = length();
  for (let i = 0; i < instructionCount; i++) {
    const programIndex = take(1)[0];
    // Invoked programs stay in static keys, so no table can substitute a router.
    if (programIndex >= staticKeys.length)
      throw new Error("program id outside the static keys");
    const accounts = [...take(length())],
      data = take(length());
    programs.push(staticKeys[programIndex]);
    instructions.push({ program: staticKeys[programIndex], accounts, data });
  }
  const lookups: ParsedTransaction["lookups"] = [];
  if (!legacy) {
    const count = length();
    for (let i = 0; i < count; i++) {
      const address = solanaBase58(take(32)),
        writable = [...take(length())],
        readonly = [...take(length())];
      lookups.push({ address, writable, readonly });
    }
  }
  const total =
    keyCount +
    lookups.reduce((n, t) => n + t.writable.length + t.readonly.length, 0);
  if (
    offset !== raw.length ||
    total > 256 ||
    instructions.some((i) => i.accounts.some((index) => index >= total))
  )
    throw new Error("invalid transaction account indexes or trailing bytes");
  return {
    signatureCount,
    messageOffset,
    requiredSignatures,
    readonlySigned,
    readonlyUnsigned,
    staticKeys,
    blockhashOffset,
    programs,
    legacy,
    lookups,
    instructions,
  };
}

function decimalBps(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(String(value));
  if (!match) return null;
  // fraction * 10000, rounded up so a cap is never undercounted.
  const fraction = (match[2] ?? "").padEnd(4, "0");
  const whole = BigInt(match[1]) * 10_000n + BigInt(fraction.slice(0, 4));
  const rest = /[1-9]/u.test(fraction.slice(4)) ? 1n : 0n;
  return Number(whole + rest);
}

interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  platformFee: unknown;
  routePlan?: { swapInfo?: { label?: string } }[];
}

function signedMinimumOutput(quote: JupiterQuote): bigint {
  // The API can round its display threshold up by one base unit. /swap
  // encodes quoted output and slippage, not that threshold. Retain only
  // the conservative floor we can bind to those signed instruction fields.
  const minimum =
    (BigInt(quote.outAmount) * BigInt(10000 - quote.slippageBps)) / 10000n;
  const advertised = BigInt(quote.otherAmountThreshold);
  if (advertised < minimum || advertised > minimum + 1n)
    throw new Error(
      "Jupiter threshold differs from its signed slippage bounds",
    );
  return minimum;
}

function nativeInteger(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(
      "Solana native cost evidence must be an exact safe integer",
    );
  return BigInt(value);
}

export function solanaNativeCost(
  meta: {
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances: TokenBalance[];
    postTokenBalances: TokenBalance[];
  },
  accounts: readonly number[],
  nativePrincipal = 0n,
): bigint {
  let actual = nativeInteger(meta.fee);
  const nativeToken = "So11111111111111111111111111111111111111112";
  const tokenNative = (balances: TokenBalance[], index: number) => {
    const b = balances.find(
      (b) => b.accountIndex === index && b.mint === nativeToken,
    );
    return b ? BigInt(b.uiTokenAmount.amount) : 0n;
  };
  for (const index of accounts) {
    const before =
      nativeInteger(meta.preBalances[index]) -
      tokenNative(meta.preTokenBalances, index);
    const after =
      nativeInteger(meta.postBalances[index]) -
      tokenNative(meta.postTokenBalances, index);
    if (before < 0n || after < 0n)
      throw new Error("Solana native rent receipt is inconsistent");
    if (after > before) actual += after - before;
  }
  const walletDebit =
    nativeInteger(meta.preBalances[0]) -
    nativeInteger(meta.postBalances[0]) -
    nativePrincipal;
  if (walletDebit > actual) actual = walletDebit;
  return actual;
}

export function createSolanaClient(options: SolanaClientOptions): ChainClient {
  const { config, limits } = options;
  const doFetch = options.fetch ?? fetch;
  const wallet = config.feeWallet;
  if (config.definition.usdc === null)
    throw new Error(`no verified USDC target on ${config.network}`);
  const usdc: string = config.definition.usdc;
  const seed = options.keypair
    ? (() => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(options.keypair);
        } catch {
          throw new TypeError("Fee-wallet keypair for solana is malformed");
        }
        if (
          !Array.isArray(parsed) ||
          parsed.length !== 64 ||
          !parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
        )
          throw new TypeError("Fee-wallet keypair for solana is malformed");
        const bytes = Uint8Array.from(parsed);
        const secret = bytes.slice(0, 32);
        const publicKey = ed25519.getPublicKey(secret);
        if (
          solanaBase58(publicKey) !== wallet ||
          solanaBase58(bytes.slice(32)) !== wallet
        )
          throw new TypeError(
            "Fee-wallet keypair for solana does not control the configured fee wallet",
          );
        return secret;
      })()
    : null;

  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    const response = await doFetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await (method === "getMultipleAccounts"
      ? readBoundedJson(response, 8 * 1024 * 1024, "Solana route accounts")
      : response.json())) as {
      result?: T;
      error?: { message?: string };
    };
    if (!response.ok || body.error)
      throw new Error(
        `Solana ${method}: ${String(body.error?.message ?? response.status).slice(0, 200)}`,
      );
    return body.result as T;
  }

  async function jupiter<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await doFetch(`${options.jupiterApiUrl}/${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(options.jupiterApiKey
          ? { "x-api-key": options.jupiterApiKey }
          : {}),
      },
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // A refusal may carry plain text; an accepted reply must be JSON.
      if (response.ok)
        throw new Error(`Jupiter ${path.split("?")[0]}: unparseable response`);
    }
    if (!response.ok) {
      const detail = body as { error?: string; errorCode?: string } | null;
      const error = new Error(
        `Jupiter ${path.split("?")[0]}: ${String(detail?.errorCode ?? detail?.error ?? response.status).slice(0, 200)}`,
      );
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return body as T;
  }

  const rentAccounts = (
    parsed: ParsedTransaction,
    resolved = parsed.staticKeys,
  ) => associatedAccountCreations(parsed, resolved, wallet);

  async function admittedMint(mint: string) {
    const result = await rpc<{ value: unknown }>("getAccountInfo", [
      mint,
      { encoding: "base64", commitment: "finalized" },
    ]);
    return inspectMintAccount(result.value, mint);
  }

  async function reserveNative(
    raw: Uint8Array,
    valueMicro: bigint,
    assertLease?: () => Promise<void>,
    reviewedProof?: SolanaAccountProof,
  ) {
    const journal = options.nativeGas;
    if (!journal || !config.nativeBudget)
      throw new Error(
        "Solana signing needs native limits and the durable budget journal",
      );
    const parsed = parseTransaction(raw);
    const accountProof =
      reviewedProof ?? (await resolveSolanaAccounts(raw, parsed, rpc));
    verifySolanaAccountProof(raw, parsed, accountProof);
    if (parsed.programs.includes(JUPITER_PROGRAM) && !accountProof.route)
      throw new Error(
        "Jupiter signing lacks a complete retained account review",
      );
    const accounts = rentAccounts(parsed, accountProof.keys);
    const message = raw.slice(parsed.messageOffset);
    const fee = await rpc<{ context: { slot: number }; value: number | null }>(
      "getFeeForMessage",
      [solanaBase64(message), { commitment: "confirmed" }],
    );
    const networkFee = nativeInteger(fee.value);
    const nativePrincipal = accountProof.route?.expectation.nativeInput
      ? BigInt(accountProof.route.expectation.amountIn)
      : 0n;
    let rent = 0n;
    for (const account of accounts) {
      if (
        (await admittedMint(account.mint)).tokenProgram !== account.tokenProgram
      )
        throw new Error(
          "Associated account token program differs from admitted mint",
        );
      // Reserve even existing ATAs: closure before inclusion must not escape caps.
      rent += nativeInteger(
        await rpc<number>("getMinimumBalanceForRentExemption", [
          account.size,
          { commitment: "confirmed" },
        ]),
      );
    }
    const maximum = networkFee + rent;
    if (networkFee === 0n)
      throw new Error("Solana signature fee evidence is missing");
    const before = nativeInteger(
      (
        await rpc<{ value: number }>("getBalance", [
          wallet,
          { commitment: "confirmed" },
        ])
      ).value,
    );
    const simulated = await rpc<{
      value: { err: unknown; accounts: ({ lamports: number } | null)[] | null };
    }>("simulateTransaction", [
      solanaBase64(raw),
      {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: false,
        commitment: "confirmed",
        accounts: { encoding: "base64", addresses: [wallet] },
      },
    ]);
    if (
      simulated.value.err !== null ||
      !simulated.value.accounts?.[0] ||
      before -
        nativeInteger(simulated.value.accounts[0].lamports) -
        nativePrincipal >
        maximum ||
      (nativePrincipal > 0n &&
        before - nativeInteger(simulated.value.accounts?.[0]?.lamports) <
          nativePrincipal)
    )
      throw new Error("Solana simulation has unbounded native wallet debit");
    if (maximum > BigInt(config.nativeBudget.perTransaction))
      throw new Error(
        "Solana native fee and account creation exceed the transaction budget",
      );
    const priced = await fetchQuote(
      "So11111111111111111111111111111111111111112",
      maximum,
      limits.maxSlippageBps,
    );
    const costValue = BigInt(priced.outAmount);
    if (costValue <= 0n)
      throw new Error("Final Solana native cost cannot be priced");
    if (costValue * limits.gasMultiple > valueMicro)
      throw new Error("Final Solana native cost exceeds the gas-cost multiple");
    // Bind the signed blockhash to an actual retained slot, so a recovery
    // provider must demonstrate history covering the entire landing window.
    const contextSlot = Number(nativeInteger(fee.context?.slot));
    const hash = solanaBase58(
      raw.slice(parsed.blockhashOffset, parsed.blockhashOffset + 32),
    );
    const slots = await rpc<number[]>("getBlocks", [
      Math.max(0, contextSlot - 512),
      contextSlot,
      { commitment: "confirmed" },
    ]);
    if (
      !Array.isArray(slots) ||
      slots.length > 513 ||
      slots.some(
        (slot) =>
          !Number.isSafeInteger(slot) ||
          slot < Math.max(0, contextSlot - 512) ||
          slot > contextSlot,
      )
    )
      throw new Error("Solana blockhash history is unavailable");
    let blockhashSlot: number | undefined;
    for (const slot of [...new Set(slots)].sort((a, b) => b - a)) {
      const block = await rpc<{ blockhash: string } | null>("getBlock", [
        slot,
        {
          commitment: "confirmed",
          transactionDetails: "none",
          rewards: false,
          maxSupportedTransactionVersion: 0,
        },
      ]);
      if (block?.blockhash === hash) {
        blockhashSlot = slot;
        break;
      }
    }
    if (blockhashSlot === undefined)
      throw new Error("Signed Solana blockhash has no retained slot anchor");
    await assertLease?.();
    const id = await journal.reserveSolana(
      solanaBase58(sha256(message)),
      blockhashSlot,
      accountProof,
    );
    await assertLease?.();
    return id;
  }

  async function reconcileNative() {
    const journal = options.nativeGas;
    if (!journal) return;
    await journal.recoverUnsigned();
    if ((await journal.unaccounted()).length)
      throw new Error(
        "Historical Solana sends need verified native-cost reconciliation before signing",
      );
    for (const send of await journal.unsettled()) {
      if (!send.rawTx || send.feeWallet !== wallet)
        throw new Error(
          "Solana native journal lacks its reviewed signed bytes",
        );
      const raw = solanaBase64Bytes(send.rawTx);
      const parsed = parseTransaction(raw);
      const message = raw.slice(parsed.messageOffset);
      const signature = raw.slice(
        parsed.messageOffset - 64,
        parsed.messageOffset,
      );
      if (
        solanaBase58(signature) !== send.txId ||
        !ed25519.verify(signature, message, decodeBase58Bytes(wallet))
      )
        throw new Error("Solana native journal signature mismatch");
      const retained = (await journal.rows()).find(
        (row) => row.tx_id === send.txId,
      );
      let accountProof: SolanaAccountProof | undefined;
      if (retained?.solana_account_proof) {
        const retainedProof: SolanaAccountProof = JSON.parse(
          retained.solana_account_proof,
        );
        verifySolanaAccountProof(raw, parsed, retainedProof);
        accountProof = retainedProof;
      } else if (!parsed.legacy) {
        throw new Error(
          "Versioned Solana recovery lacks retained account evidence",
        );
      }
      const accounts = rentAccounts(parsed, accountProof?.keys);
      const tx = await rpc<{
        slot: number;
        transaction: [string, string];
        meta: {
          err: unknown;
          fee: number;
          preBalances: number[];
          postBalances: number[];
          loadedAddresses?: { writable: string[]; readonly: string[] };
          preTokenBalances: TokenBalance[];
          postTokenBalances: TokenBalance[];
        };
      } | null>("getTransaction", [
        send.txId,
        {
          commitment: "finalized",
          encoding: "base64",
          maxSupportedTransactionVersion: 0,
        },
      ]);
      if (!tx) {
        const row = (await journal.rows()).find(
          (row) => row.tx_id === send.txId,
        );
        const secondary =
          options.recoveryRpcUrl ?? "https://solana-rpc.publicnode.com";
        const primaryOperator = recoveryOperator(config.rpcUrl),
          secondaryOperator = recoveryOperator(secondary);
        // Unknown operators/old rows are held. A mere null response never releases gas.
        if (
          row?.solana_blockhash_slot !== null &&
          row?.solana_blockhash_slot !== undefined &&
          primaryOperator &&
          secondaryOperator &&
          primaryOperator !== secondaryOperator
        ) {
          const second: RecoveryRpc = async <T>(
            method: string,
            params: unknown[],
          ) => {
            const response = await doFetch(secondary, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
              signal: AbortSignal.timeout(15000),
            });
            const body = (await response.json()) as {
              result?: T;
              error?: unknown;
            };
            if (!response.ok || body.error || body.result === undefined)
              throw new Error("Independent Solana expiry provider unavailable");
            return body.result;
          };
          const proof = await proveSolanaExpiry(
            send.txId,
            solanaBase58(
              raw.slice(parsed.blockhashOffset, parsed.blockhashOffset + 32),
            ),
            row.solana_blockhash_slot,
            [
              { operator: primaryOperator, rpc },
              { operator: secondaryOperator, rpc: second },
            ],
            journal.expiryCoverageStore(),
          );
          if (proof) await journal.resolveSolanaExpiry(send, proof);
        }
        continue;
      }
      if (tx.transaction?.[1] !== "base64" || tx.transaction[0] !== send.rawTx)
        throw new Error(
          "Finalized Solana native receipt does not match signed bytes",
        );
      const block = await rpc<{
        blockhash: string;
        signatures: string[];
      } | null>("getBlock", [
        tx.slot,
        {
          commitment: "finalized",
          transactionDetails: "signatures",
          rewards: false,
          maxSupportedTransactionVersion: 0,
        },
      ]);
      if (
        !block?.signatures?.includes(send.txId) ||
        typeof block.blockhash !== "string"
      )
        throw new Error(
          "Solana native receipt lacks canonical finalized block evidence",
        );
      if (
        accountProof &&
        (JSON.stringify(tx.meta.loadedAddresses?.writable ?? []) !==
          JSON.stringify(accountProof.loadedWritable) ||
          JSON.stringify(tx.meta.loadedAddresses?.readonly ?? []) !==
            JSON.stringify(accountProof.loadedReadonly))
      )
        throw new Error(
          "Finalized Solana account mapping differs from retained signing evidence",
        );
      const actual = solanaNativeCost(
        tx.meta,
        accounts.map((account) => account.index),
        tx.meta.err === null && accountProof?.route?.expectation.nativeInput
          ? BigInt(accountProof.route.expectation.amountIn)
          : 0n,
      );
      await journal.settle(send, {
        txId: send.txId,
        actualWei: actual.toString(),
        blockHash: block.blockhash,
      });
    }
  }

  async function fetchQuote(
    token: string,
    amount: bigint,
    slippageBps: number,
  ) {
    const inputMint = token === SOLANA_NATIVE_ASSET ? WRAPPED_SOL : token;
    const quote = await jupiter<JupiterQuote>(
      `quote?${new URLSearchParams({
        inputMint,
        outputMint: usdc,
        amount: amount.toString(),
        slippageBps: String(slippageBps),
        swapMode: "ExactIn",
        restrictIntermediateTokens: "true",
        asLegacyTransaction: "false",
        instructionVersion: "V2",
      })}`,
    );
    if (
      quote.inputMint !== inputMint ||
      quote.outputMint !== usdc ||
      quote.inAmount !== amount.toString() ||
      quote.swapMode !== "ExactIn" ||
      quote.slippageBps !== slippageBps ||
      quote.platformFee !== null ||
      !/^\d+$/u.test(quote.outAmount) ||
      !/^\d+$/u.test(quote.otherAmountThreshold)
    )
      throw new Error("Jupiter quote does not match the request");
    return quote;
  }

  async function tokenAccountBalance(account: string): Promise<bigint> {
    const result = await rpc<{ value: { amount: string } } | null>(
      "getTokenAccountBalance",
      [account, { commitment: "confirmed" }],
    ).catch((error: Error) => {
      // Only a proven absent account is an empty balance. It is the
      // baseline of each simulation credit check.
      if (/could not find account/iu.test(error.message)) return null;
      throw error;
    });
    return result ? BigInt(result.value.amount) : 0n;
  }

  /** Simulates unsigned bytes and returns what they credit to `account`. */
  async function simulatedCredit(
    rawTx: string,
    account: string,
    label: string,
    native = false,
  ): Promise<bigint> {
    const before = native
      ? nativeInteger(
          (
            await rpc<{ value: number }>("getBalance", [
              account,
              { commitment: "confirmed" },
            ])
          ).value,
        )
      : await tokenAccountBalance(account);
    const simulation = await rpc<{
      value: {
        err: unknown;
        accounts:
          | ({ data: [string, string]; lamports: number } | null)[]
          | null;
      };
    }>("simulateTransaction", [
      rawTx,
      {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: false,
        commitment: "confirmed",
        accounts: { encoding: "base64", addresses: [account] },
      },
    ]);
    if (simulation.value.err !== null)
      throw new Error(
        `${label} simulation failed: ${JSON.stringify(simulation.value.err).slice(0, 200)}`,
      );
    const simulated = simulation.value.accounts?.[0];
    if (!simulated)
      throw new Error(
        `${label} simulation did not credit the ${label === "claim" ? "fee" : "USDC"} account`,
      );
    if (native) {
      const parsed = parseTransaction(solanaBase64Bytes(rawTx));
      const fee = await rpc<{ value: number }>("getFeeForMessage", [
        solanaBase64(solanaBase64Bytes(rawTx).slice(parsed.messageOffset)),
        { commitment: "confirmed" },
      ]);
      return (
        nativeInteger(simulated.lamports) - before + nativeInteger(fee.value)
      );
    }
    const data = solanaBase64Bytes(simulated.data[0]);
    return (
      new DataView(data.buffer, data.byteOffset).getBigUint64(64, true) - before
    );
  }

  async function broadcast(rawTx: string): Promise<void> {
    const raw = solanaBase64Bytes(rawTx);
    const parsed = parseTransaction(raw);
    const expected = solanaBase58(
      raw.slice(parsed.messageOffset - 64, parsed.messageOffset),
    );
    const result = await rpc<string>("sendTransaction", [
      rawTx,
      { encoding: "base64", skipPreflight: true, maxRetries: 5 },
    ]);
    if (result !== expected) throw new Error("Broadcast signature mismatch");
  }

  const verifyDeployment = options.verifyDeployment ?? verifySolanaDeployment;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  /**
   * Verifies the reviewed deployment at finalized commitment (cluster,
   * program bytes, the pinned Config and every project authority, including
   * that the project's fee recipient is the reviewed one) and returns its
   * config with the finalized project bytes. Null when the vault pays another
   * fee recipient. Unknown or mismatched state throws, so no claim follows.
   */
  async function verifiedVault(entry: FeeVault, executedAtSlot?: number) {
    const escrow = {
      ...solanaEscrowConfig(entry, config.rpcUrl),
      ...(options.localGenesisHash
        ? { genesisHash: options.localGenesisHash }
        : {}),
      executedAtSlot,
    };
    // Another wallet's fees are not this run's to claim.
    if (escrow.feeRecipient !== wallet) return null;
    if (escrow.upgradeAuthority === wallet)
      throw new Error("Fee wallet must not be the program upgrade authority");
    if (solanaVaultAddress(escrow.programId, escrow.projectPda) !== entry.vault)
      throw new Error("vault is not the reviewed project's vault address");
    if (entry.vault !== escrow.vault)
      throw new Error("vault differs from its reviewed deployment record");
    const project = await verifyDeployment(escrow);
    const tokenProgram =
      escrow.mint === SOLANA_NATIVE_ASSET
        ? SOLANA_NATIVE_ASSET
        : (await admittedMint(escrow.mint)).tokenProgram;
    return { escrow, project, tokenProgram };
  }

  async function confirmedAccrued(escrow: SolanaEscrowConfig) {
    const info = await rpc<{ value: unknown }>("getAccountInfo", [
      escrow.projectPda,
      { commitment: "confirmed", encoding: "base64" },
    ]);
    if (info.value === null) throw new Error("project account missing");
    return solanaUint(
      solanaAccount(
        info.value,
        escrow.programId,
        PROJECT_SIZE,
        PROJECT_DISCRIMINATOR,
      ),
      ACCRUED_FEES_OFFSET,
    );
  }

  /** Token balance change of `owner`'s `mint` accounts in one transaction. */
  const delta = (
    meta: {
      preTokenBalances: TokenBalance[];
      postTokenBalances: TokenBalance[];
    },
    owner: string,
    mint: string,
  ) => {
    const total = (balances: TokenBalance[]) =>
      balances
        .filter((b) => b.owner === owner && b.mint === mint)
        .reduce((sum, b) => sum + BigInt(b.uiTokenAmount.amount), 0n);
    return total(meta.postTokenBalances) - total(meta.preTokenBalances);
  };

  async function claimReceipt(
    entry: FeeVault,
    txId: string,
    transaction: TransactionReceipt,
  ) {
    if (
      !Number.isSafeInteger(transaction.slot) ||
      transaction.slot < 0 ||
      transaction.transaction?.signatures?.[0] !== txId
    )
      throw new Error("claim receipt identity or slot is missing");
    const verified = await verifiedVault(entry, transaction.slot);
    if (!verified) throw new Error("Recorded claim pays another fee wallet");
    const { escrow, tokenProgram } = verified;
    if (transaction.meta.err !== null)
      throw new Error("claim receipt reports a failed transaction");
    const eventTag = sha256(
      new TextEncoder().encode("event:FeesClaimed"),
    ).slice(0, 8);
    const programs: string[] = [];
    let amount: bigint | null = null;
    for (const log of transaction.meta.logMessages ?? []) {
      const invoked = /^Program (\w+) invoke \[\d+\]$/.exec(log);
      if (invoked) programs.push(invoked[1]);
      else if (/^Program \w+ (?:success|failed:)/.test(log)) programs.pop();
      else if (
        programs.at(-1) === escrow.programId &&
        log.startsWith("Program data: ")
      ) {
        const data = solanaBase64Bytes(log.slice("Program data: ".length));
        if (!eventTag.every((byte, index) => data[index] === byte)) continue;
        if (
          amount !== null ||
          data.length !== 80 ||
          solanaBase58(data.slice(8, 40)) !== escrow.projectPda ||
          solanaBase58(data.slice(40, 72)) !==
            (escrow.mint === SOLANA_NATIVE_ASSET
              ? wallet
              : ata(escrow.mint, wallet, tokenProgram))
        )
          throw new Error("claim receipt has an invalid FeesClaimed event");
        amount = new DataView(data.buffer, data.byteOffset).getBigUint64(
          72,
          true,
        );
      }
    }
    const native = escrow.mint === SOLANA_NATIVE_ASSET;
    const nativeDeltas = native
      ? nativeLamportDeltas(
          { ...transaction.meta },
          transaction.transaction.message?.accountKeys ?? [],
        )
      : null;
    const received =
      nativeDeltas?.get(wallet) ?? delta(transaction.meta, wallet, escrow.mint);
    const paid = nativeDeltas
      ? -(nativeDeltas.get(escrow.vault) ?? 0n)
      : -delta(transaction.meta, escrow.projectPda, escrow.mint);
    if (
      amount === null ||
      amount === 0n ||
      received !== amount ||
      paid !== amount
    )
      throw new Error("claim receipt does not match the vault fee");
    return received;
  }

  const vaultFees: VaultFeeClient = {
    async accrued(entry): Promise<AccruedFees | null> {
      const verified = await verifiedVault(entry);
      if (!verified) return null;
      const amount = solanaUint(verified.project, ACCRUED_FEES_OFFSET);
      return amount === 0n ? null : { asset: verified.escrow.mint, amount };
    },

    // The claim pays one signature fee, priced like a swap's. The idempotent
    // associated-account creation, when it runs, funds a rent deposit that
    // stays in the fee wallet's own token account; it is not a network fee.
    async claimCostMicro() {
      return limits.solanaFeeMicro;
    },

    async claim(entry, recordClaim, _nonceFloor, assertLease, valueMicro) {
      if (!seed)
        throw new Error("Signing is disabled without a fee-wallet key");
      const verified = await verifiedVault(entry);
      if (!verified) throw new Error("vault pays another fee recipient");
      const { escrow, tokenProgram } = verified;
      const amount = solanaUint(verified.project, ACCRUED_FEES_OFFSET);
      if (amount === 0n) throw new Error("no accrued fees to claim");
      // The run reconciles recorded claims before reaching this path. Also
      // wait for unfinalized project activity: the confirmed counter may
      // already reflect a claim that the finalized project does not yet show.
      if ((await confirmedAccrued(escrow)) === 0n)
        throw new Error("an earlier claim is confirmed but not yet finalized");
      const recent = await rpc<
        { err: unknown; confirmationStatus: string | null }[]
      >("getSignaturesForAddress", [
        escrow.projectPda,
        { commitment: "confirmed", limit: 25 },
      ]);
      if (
        recent.some(
          (s) => s.err === null && s.confirmationStatus !== "finalized",
        )
      )
        throw new Error("an earlier project transaction is not yet finalized");

      const native = escrow.mint === SOLANA_NATIVE_ASSET;
      const feeAccount = native
        ? wallet
        : ata(escrow.mint, wallet, tokenProgram);
      const latest = await rpc<{
        value: { blockhash: string; lastValidBlockHeight: number };
      }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
      const body = legacyMessage(wallet, latest.value.blockhash, [
        ...(native
          ? []
          : [createAta(wallet, escrow.mint, wallet, tokenProgram)]),
        {
          program: escrow.programId,
          accounts: native
            ? [
                { key: escrow.projectPda, write: true },
                { key: escrow.vault, write: true },
                { key: feeAccount, write: true },
              ]
            : [
                { key: escrow.projectPda, write: true },
                { key: escrow.mint, write: false },
                { key: escrow.vault, write: true },
                { key: feeAccount, write: true },
                { key: tokenProgram, write: false },
              ],
          data: instructionData(native ? "claim_fees_native" : "claim_fees"),
        },
      ]);
      if (
        (await simulatedCredit(
          solanaBase64(concat(Uint8Array.of(1), new Uint8Array(64), body)),
          feeAccount,
          "claim",
          native,
        )) < amount
      )
        throw new Error("claim simulation credited less than the accrued fee");

      if (!recordClaim)
        throw new Error("Fee claim requires a durable send record");
      const unsigned = concat(Uint8Array.of(1), new Uint8Array(64), body);
      const nativeGasId = await reserveNative(
        unsigned,
        valueMicro ?? (escrow.mint === usdc ? amount : 0n),
        assertLease,
      );
      const signature = ed25519.sign(body, seed);
      const txId = solanaBase58(signature);
      const rawTx = solanaBase64(concat(Uint8Array.of(1), signature, body));
      await recordClaim({
        nativeGasId,
        txId,
        rawTx,
        evmNonce: null,
        expiresAt: latest.value.lastValidBlockHeight,
        amount,
      });
      await assertLease?.();
      await broadcast(rawTx);
      for (let poll = 0; ; poll++) {
        const statuses = await rpc<{
          value: ({ err: unknown; confirmationStatus: string | null } | null)[];
        }>("getSignatureStatuses", [
          [txId],
          { searchTransactionHistory: true },
        ]);
        const status = statuses.value[0];
        if (status?.err) throw new Error(`claim ${txId} failed on chain`);
        if (
          status?.confirmationStatus === "confirmed" ||
          status?.confirmationStatus === "finalized"
        )
          break;
        if (!status) {
          const height = await rpc<number>("getBlockHeight", [
            { commitment: "finalized" },
          ]);
          if (height > latest.value.lastValidBlockHeight)
            throw new Error(`claim ${txId} expired before inclusion`);
        }
        if (poll + 1 >= CLAIM_POLLS)
          throw new Error(`claim ${txId} not confirmed in time`);
        await sleep(CLAIM_POLL_MS);
      }

      // Verify the executed FeesClaimed amount against both the fee wallet's
      // credit and the vault's debit before conversion.
      const transaction = await rpc<TransactionReceipt | null>(
        "getTransaction",
        [
          txId,
          {
            commitment: "confirmed",
            encoding: "json",
            maxSupportedTransactionVersion: 0,
          },
        ],
      );
      if (!transaction || transaction.meta.err !== null)
        throw new Error(`claim ${txId} receipt is not available`);
      await claimReceipt(entry, txId, transaction);
      return { txId };
    },
  };

  return {
    vaultFees,

    reconcileNativeGas: reconcileNative,
    async balance(token) {
      if (token === SOLANA_NATIVE_ASSET) {
        const result = await rpc<{ value: number }>("getBalance", [
          wallet,
          { commitment: "finalized" },
        ]);
        const spendable =
          nativeInteger(result.value) -
          BigInt(config.nativeBudget?.perTransaction ?? "0");
        return spendable > 0n ? spendable : 0n;
      }
      const mint = await admittedMint(token);
      // A reviewed route debits only the canonical associated account. A
      // claim_fees caller may pay another token account the fee wallet owns;
      // that holding stays in the wallet and never inflates the swap amount.
      const holding = ata(token, wallet, mint.tokenProgram);
      const result = await rpc<{
        value: { pubkey: string; account: unknown }[];
      }>("getTokenAccountsByOwner", [
        wallet,
        { mint: token },
        { encoding: "base64", commitment: "finalized" },
      ]);
      const seen = new Set<string>();
      return result.value.reduce((sum, entry) => {
        if (seen.has(entry.pubkey))
          throw new Error("Duplicate fee token account");
        seen.add(entry.pubkey);
        const { bytes } = inspectTokenAccount(entry.account, mint.tokenProgram);
        if (
          solanaBase58(bytes.slice(0, 32)) !== token ||
          solanaBase58(bytes.slice(32, 64)) !== wallet
        )
          throw new Error(
            "Fee token holding differs from admitted mint or wallet",
          );
        if (entry.pubkey !== holding) return sum;
        return (
          sum +
          new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(64, true)
        );
      }, 0n);
    },

    async quote(token, amount): Promise<QuoteResult> {
      let quote: JupiterQuote;
      try {
        quote = await fetchQuote(token, amount, limits.maxSlippageBps);
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status !== undefined && status >= 400 && status < 500)
          return { noRoute: (error as Error).message };
        throw error;
      }
      const amountOut = BigInt(quote.outAmount);
      if (amountOut === 0n) return { noRoute: "Jupiter quoted zero output" };
      return {
        route: "jupiter",
        amountIn: amount,
        amountOut,
        minAmountOut: signedMinimumOutput(quote),
        priceImpactBps: decimalBps(quote.priceImpactPct),
        gasCostMicro: limits.solanaFeeMicro,
        summary: {
          aggregator: "jupiter",
          slippageBps: quote.slippageBps,
          priceImpactPct: quote.priceImpactPct,
          venues: (quote.routePlan ?? [])
            .map((step) => step.swapInfo?.label)
            .filter((label): label is string => typeof label === "string")
            .slice(0, 8),
        },
      };
    },

    async prepare(
      token,
      quote: Quote,
      _nonceFloor,
      assertLease,
    ): Promise<PreparedSend> {
      if (!seed)
        throw new Error("Signing is disabled without a fee-wallet key");
      const nativeInput = token === SOLANA_NATIVE_ASSET;
      const inputToken = nativeInput ? WRAPPED_SOL : token;
      const inputMint = await admittedMint(inputToken);
      const outputMint = await admittedMint(usdc);
      const fresh = await fetchQuote(
        token,
        quote.amountIn,
        Math.max(1, Math.floor(limits.maxSlippageBps / 2)),
      );
      const minAmountOut = signedMinimumOutput(fresh);
      if (minAmountOut < quote.minAmountOut)
        throw new Error("price moved below the recorded minimum");
      const swap = await jupiter<{
        swapTransaction: string;
        lastValidBlockHeight: number;
      }>("swap", {
        method: "POST",
        body: JSON.stringify({
          quoteResponse: fresh,
          userPublicKey: wallet,
          wrapAndUnwrapSol: false,
          asLegacyTransaction: false,
          // PumpSwap V2 otherwise creates a user-volume PDA outside the
          // reviewed ATA-only rent budget. Shared routing uses the router's
          // existing pool accounts; every resolved account is still checked.
          ...(inputMint.tokenProgram === TOKEN_2022_PROGRAM
            ? { useSharedAccounts: true }
            : {}),
          // The builder cannot simulate our native wrap before we add it.
          // Native routes use its conservative limit, then our full local
          // simulation and gas reservation check the completed transaction.
          dynamicComputeUnitLimit: !nativeInput,
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              maxLamports: 200_000,
              priorityLevel: "high",
            },
          },
        }),
      });
      let raw: Uint8Array = solanaBase64Bytes(swap.swapTransaction);
      let parsed = parseTransaction(raw);
      if (
        parsed.signatureCount !== 1 ||
        parsed.requiredSignatures !== 1 ||
        parsed.staticKeys[0] !== wallet
      )
        throw new Error(
          "Jupiter transaction must have the fee wallet as its only signer",
        );
      if (!parsed.programs.includes(JUPITER_PROGRAM))
        throw new Error(
          "Jupiter transaction does not call the Jupiter program",
        );
      const unexpected = parsed.programs.find((p) => !ALLOWED_PROGRAMS.has(p));
      if (unexpected)
        throw new Error(`Jupiter transaction calls ${unexpected}`);

      let lastValidBlockHeight = swap.lastValidBlockHeight;
      if (options.localBlockhash) {
        const latest = await rpc<{
          value: { blockhash: string; lastValidBlockHeight: number };
        }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
        raw.set(
          decodeBase58Bytes(latest.value.blockhash),
          parsed.blockhashOffset,
        );
        lastValidBlockHeight = latest.value.lastValidBlockHeight;
      }
      if (
        !Number.isSafeInteger(lastValidBlockHeight) ||
        lastValidBlockHeight <= 0
      )
        throw new Error("Jupiter returned an invalid block height");

      let accountProof = await resolveSolanaAccounts(raw, parsed, rpc);
      if (nativeInput) {
        raw = wrapNativeRoute(
          raw,
          parsed,
          accountProof,
          wallet,
          quote.amountIn,
        );
        parsed = parseTransaction(raw);
        accountProof = await resolveSolanaAccounts(raw, parsed, rpc);
      }
      const expected = {
        program: JUPITER_PROGRAM,
        wallet,
        inputMint: inputToken,
        inputProgram: inputMint.tokenProgram,
        outputMint: usdc,
        outputProgram: outputMint.tokenProgram,
        amountIn: quote.amountIn,
        quotedOut: BigInt(fresh.outAmount),
        minimumOut: minAmountOut,
        slippageBps: fresh.slippageBps,
        ...(nativeInput ? { nativeInput: true as const } : {}),
      };
      const review = await reviewSolanaRouteAccounts(
        rpc,
        raw,
        parsed,
        accountProof,
        expected,
      );
      const simulation = await rpc<{
        context: { slot: number };
        value: { err: unknown; accounts: unknown[] | null };
      }>("simulateTransaction", [
        solanaBase64(raw),
        {
          encoding: "base64",
          sigVerify: false,
          replaceRecentBlockhash: false,
          commitment: "confirmed",
          accounts: {
            encoding: "base64",
            addresses: [review.sourceAddress, review.destinationAddress],
          },
        },
      ]);
      if (simulation.value.err !== null || !simulation.value.accounts)
        throw new Error("Jupiter route simulation is unavailable or failed");
      assertSolanaRouteSimulation(
        review,
        simulation.context.slot,
        simulation.value.accounts,
      );
      const reviewedProof: SolanaAccountProof = {
        ...accountProof,
        route: {
          expectation: {
            ...expected,
            amountIn: expected.amountIn.toString(),
            quotedOut: expected.quotedOut.toString(),
            minimumOut: expected.minimumOut.toString(),
          },
          accounts: review.observations,
        },
      };
      const nativeGasId = await reserveNative(
        raw,
        quote.amountOut,
        assertLease,
        reviewedProof,
      );
      const message = raw.slice(parsed.messageOffset);
      const signature = ed25519.sign(message, seed);
      raw.set(signature, parsed.messageOffset - 64);
      return {
        nativeGasId,
        txId: solanaBase58(signature),
        rawTx: solanaBase64(raw),
        evmNonce: null,
        expiresAt: lastValidBlockHeight,
        approvalTxId: null,
        minAmountOut,
      };
    },

    broadcast,

    async status(row: ConversionRow): Promise<SendStatus> {
      if (row.txId && (await options.nativeGas?.solanaExpiryResolved(row.txId)))
        return {
          kind: "failed",
          reason:
            "blockhash expired; two independent retained histories prove no inclusion",
        };
      const statuses = await rpc<{
        value: ({ err: unknown; confirmationStatus: string | null } | null)[];
      }>("getSignatureStatuses", [
        [row.txId],
        { searchTransactionHistory: true },
      ]);
      const status = statuses.value[0];
      if (status) {
        if (status.confirmationStatus !== "finalized")
          return { kind: "pending" };
        if (status.err !== null)
          return {
            kind: "failed",
            reason: `${row.kind === "claim" ? "claim" : "swap"} transaction failed on chain`,
          };
        if (row.kind !== "claim") {
          const retained = (await options.nativeGas?.rows())?.find(
            (entry) => entry.tx_id === row.txId,
          );
          const proof: SolanaAccountProof | undefined =
            retained?.solana_account_proof
              ? JSON.parse(retained.solana_account_proof)
              : undefined;
          if (proof?.route) {
            const receipt = await rpc<RouteReceipt | null>("getTransaction", [
              row.txId,
              {
                commitment: "finalized",
                encoding: "base64",
                maxSupportedTransactionVersion: 0,
              },
            ]);
            if (!receipt) return { kind: "pending" };
            return {
              kind: "finalized",
              amountOut: finalizedRouteCredit(row, proof, receipt),
            };
          }
          if (
            row.rawTx &&
            !parseTransaction(solanaBase64Bytes(row.rawTx)).legacy
          )
            throw new Error(
              "Versioned swap receipt lacks its retained route review",
            );
        }
        const transaction = await rpc<TransactionReceipt | null>(
          "getTransaction",
          [
            row.txId,
            {
              commitment: "finalized",
              encoding: "json",
              maxSupportedTransactionVersion: 0,
            },
          ],
        );
        if (!transaction) return { kind: "pending" };
        if (row.kind === "claim")
          return {
            kind: "finalized",
            amountOut: await claimReceipt(
              JSON.parse(row.quote as string) as FeeVault,
              row.txId as string,
              transaction,
            ),
          };
        // The row's own target, so a send reconciles against the asset it
        // was signed for.
        const credit = delta(transaction.meta, wallet, row.targetToken);
        return { kind: "finalized", amountOut: credit > 0n ? credit : 0n };
      }
      const height = await rpc<number>("getBlockHeight", [
        { commitment: "finalized" },
      ]);
      // Expiry prevents future inclusion, but one provider's missing history
      // does not prove that the bytes never landed. Journaled sends wait for
      // the independent retained-history proof checked above.
      if (row.expiresAt !== null && height > row.expiresAt)
        return row.kind === "claim" || row.nativeGasId
          ? { kind: "pending" }
          : { kind: "failed", reason: "blockhash expired before inclusion" };
      if (
        row.kind === "claim" &&
        !(await verifiedVault(JSON.parse(row.quote as string) as FeeVault))
      )
        throw new Error("Recorded claim pays another fee wallet");
      return { kind: "rebroadcast" };
    },
  };
}

interface TokenBalance {
  accountIndex?: number;
  owner?: string;
  mint: string;
  uiTokenAmount: { amount: string };
}
/** The `getTransaction` fields a claim or swap receipt check reads. */
interface TransactionReceipt {
  slot: number;
  transaction: { signatures: string[]; message?: { accountKeys: string[] } };
  meta: {
    err: unknown;
    fee?: number;
    preBalances?: number[];
    postBalances?: number[];
    preTokenBalances: TokenBalance[];
    postTokenBalances: TokenBalance[];
    logMessages: string[] | null;
  };
}
