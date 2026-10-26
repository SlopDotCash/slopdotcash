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
  type SolanaEscrowConfig,
  solanaAccount,
  solanaBase58,
  solanaUint,
  solanaVaultAddress,
  verifySolanaDeployment,
} from "../../contracts/solana/adapter";
import {
  ata,
  concat,
  createAta,
  instructionData,
  message as legacyMessage,
  TOKEN,
} from "../../contracts/solana/transactions";
import { decodeBase58Bytes } from "../../src/lib/base58";
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

export const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
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
  staticKeys: string[];
  blockhashOffset: number;
  programs: string[];
  legacy: boolean;
  instructions: { program: string; accounts: number[]; data: Uint8Array }[];
}

/** Parses a legacy or v0 wire transaction far enough to check its signers and programs. */
export function parseTransaction(raw: Uint8Array): ParsedTransaction {
  const [signatureCount, afterCount] = compactLength(raw, 0);
  const messageOffset = afterCount + signatureCount * 64;
  let offset = messageOffset;
  const legacy = (raw[offset] & 0x80) === 0;
  if (!legacy) {
    if ((raw[offset] & 0x7f) !== 0)
      throw new Error("unsupported message version");
    offset += 1;
  }
  const requiredSignatures = raw[offset];
  offset += 3;
  const [keyCount, afterKeys] = compactLength(raw, offset);
  offset = afterKeys;
  const staticKeys: string[] = [];
  for (let i = 0; i < keyCount; i++) {
    staticKeys.push(solanaBase58(raw.slice(offset, offset + 32)));
    offset += 32;
  }
  const blockhashOffset = offset;
  offset += 32;
  const [instructionCount, afterInstructions] = compactLength(raw, offset);
  offset = afterInstructions;
  const programs: string[] = [];
  const instructions: ParsedTransaction["instructions"] = [];
  for (let i = 0; i < instructionCount; i++) {
    const programIndex = raw[offset];
    offset += 1;
    // Program ids must be static keys; a lookup-table index is refused.
    if (programIndex === undefined || programIndex >= staticKeys.length)
      throw new Error("program id outside the static keys");
    programs.push(staticKeys[programIndex]);
    const [accounts, afterAccounts] = compactLength(raw, offset);
    const accountIndexes = [
      ...raw.slice(afterAccounts, afterAccounts + accounts),
    ];
    offset = afterAccounts + accounts;
    const [dataLength, afterData] = compactLength(raw, offset);
    instructions.push({
      program: staticKeys[programIndex],
      accounts: accountIndexes,
      data: raw.slice(afterData, afterData + dataLength),
    });
    offset = afterData + dataLength;
  }
  if (offset > raw.length) throw new Error("truncated transaction");
  return {
    signatureCount,
    messageOffset,
    requiredSignatures,
    staticKeys,
    blockhashOffset,
    programs,
    legacy,
    instructions,
  };
}

function onCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.Point.fromBytes(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Associated token account of `owner` for `mint` under `tokenProgram`. */
export function associatedTokenAccount(
  owner: string,
  mint: string,
  tokenProgram = TOKEN_PROGRAM,
): string {
  const seeds = [owner, tokenProgram, mint].map(decodeBase58Bytes);
  const program = decodeBase58Bytes(ASSOCIATED_TOKEN);
  const marker = new TextEncoder().encode("ProgramDerivedAddress");
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds, Uint8Array.of(bump), program, marker];
    const input = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
      input.set(part, at);
      at += part.length;
    }
    const hash = sha256(input);
    if (!onCurve(hash)) return solanaBase58(hash);
  }
  throw new Error("no associated token address");
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

const toBase64 = (bytes: Uint8Array) => {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
};
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

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
    nativeInteger(meta.preBalances[0]) - nativeInteger(meta.postBalances[0]);
  if (walletDebit > actual) actual = walletDebit;
  return actual;
}

export function createSolanaClient(
  options: SolanaClientOptions,
): ChainClient & {
  address(): string | null;
} {
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
    const body = (await response.json()) as {
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
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
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

  /** Only classic, owner-owned ATAs have an admitted native creation cost.
   * Legacy messages keep every inspected account in the signed static keys.
   * Routes requiring address lookups remain unavailable rather than bypassing
   * the native-cost proof.
   */
  function rentAccounts(parsed: ParsedTransaction) {
    if (!parsed.legacy)
      throw new Error("Native-budget proof requires a legacy Solana route");
    if (
      parsed.signatureCount !== 1 ||
      parsed.requiredSignatures !== 1 ||
      parsed.staticKeys[0] !== wallet
    )
      throw new Error("Native fee payer must be the sole reviewed signer");
    const accounts = new Set<number>();
    for (const ix of parsed.instructions) {
      if (ix.program !== ASSOCIATED_TOKEN) continue;
      const keys = ix.accounts.map((i) => parsed.staticKeys[i]);
      if (
        keys.length < 6 ||
        keys.length > 7 ||
        keys[0] !== wallet ||
        keys[2] !== wallet ||
        keys[4] !== "11111111111111111111111111111111" ||
        keys[5] !== TOKEN_PROGRAM ||
        !(ix.data.length === 0 || (ix.data.length === 1 && ix.data[0] <= 1)) ||
        keys[1] !== associatedTokenAccount(wallet, keys[3])
      )
        throw new Error("Unbounded or unsupported associated-account creation");
      accounts.add(ix.accounts[1]);
    }
    return [...accounts];
  }

  async function reserveNative(
    raw: Uint8Array,
    valueMicro: bigint,
    assertLease?: () => Promise<void>,
  ) {
    const journal = options.nativeGas;
    if (!journal || !config.nativeBudget)
      throw new Error(
        "Solana signing needs native limits and the durable budget journal",
      );
    const parsed = parseTransaction(raw);
    const accounts = rentAccounts(parsed);
    const message = raw.slice(parsed.messageOffset);
    const fee = await rpc<{ context: { slot: number }; value: number | null }>(
      "getFeeForMessage",
      [toBase64(message), { commitment: "confirmed" }],
    );
    const networkFee = nativeInteger(fee.value);
    const rent = accounts.length
      ? nativeInteger(
          await rpc<number>("getMinimumBalanceForRentExemption", [
            165,
            { commitment: "confirmed" },
          ]),
        )
      : 0n;
    // Reserve creation even when the ATA exists: it could be closed before inclusion.
    const maximum = networkFee + rent * BigInt(accounts.length);
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
      toBase64(raw),
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
      before - nativeInteger(simulated.value.accounts[0].lamports) > maximum
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
      const raw = fromBase64(send.rawTx);
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
      const accounts = rentAccounts(parsed);
      const tx = await rpc<{
        slot: number;
        transaction: [string, string];
        meta: {
          fee: number;
          preBalances: number[];
          postBalances: number[];
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
      const actual = solanaNativeCost(tx.meta, accounts);
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
    const quote = await jupiter<JupiterQuote>(
      `quote?${new URLSearchParams({
        inputMint: token,
        outputMint: usdc,
        amount: amount.toString(),
        slippageBps: String(slippageBps),
        swapMode: "ExactIn",
        restrictIntermediateTokens: "true",
        asLegacyTransaction: "true",
      })}`,
    );
    if (
      quote.inputMint !== token ||
      quote.outputMint !== usdc ||
      quote.inAmount !== amount.toString() ||
      quote.swapMode !== "ExactIn" ||
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
      if (/could not find account|Invalid param/iu.test(error.message))
        return null;
      throw error;
    });
    return result ? BigInt(result.value.amount) : 0n;
  }

  async function broadcast(rawTx: string): Promise<void> {
    const raw = fromBase64(rawTx);
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
    return { escrow, project };
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
    transaction: {
      slot: number;
      transaction: { signatures: string[] };
      meta: {
        err: unknown;
        preTokenBalances: TokenBalance[];
        postTokenBalances: TokenBalance[];
        logMessages: string[] | null;
      };
    },
  ) {
    if (
      !Number.isSafeInteger(transaction.slot) ||
      transaction.slot < 0 ||
      transaction.transaction?.signatures?.[0] !== txId
    )
      throw new Error("claim receipt identity or slot is missing");
    const verified = await verifiedVault(entry, transaction.slot);
    if (!verified) throw new Error("Recorded claim pays another fee wallet");
    const { escrow } = verified;
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
        const data = fromBase64(log.slice("Program data: ".length));
        if (!eventTag.every((byte, index) => data[index] === byte)) continue;
        if (
          amount !== null ||
          data.length !== 80 ||
          solanaBase58(data.slice(8, 40)) !== escrow.projectPda ||
          solanaBase58(data.slice(40, 72)) !== ata(escrow.mint, wallet)
        )
          throw new Error("claim receipt has an invalid FeesClaimed event");
        amount = new DataView(data.buffer, data.byteOffset).getBigUint64(
          72,
          true,
        );
      }
    }
    const received = delta(transaction.meta, wallet, escrow.mint);
    const paid = -delta(transaction.meta, escrow.projectPda, escrow.mint);
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
      const { escrow } = verified;
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

      const feeAccount = ata(escrow.mint, wallet);
      const latest = await rpc<{
        value: { blockhash: string; lastValidBlockHeight: number };
      }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
      const body = legacyMessage(wallet, latest.value.blockhash, [
        createAta(wallet, escrow.mint, wallet),
        {
          program: escrow.programId,
          accounts: [
            { key: escrow.projectPda, write: true },
            { key: escrow.mint, write: false },
            { key: escrow.vault, write: true },
            { key: feeAccount, write: true },
            { key: TOKEN, write: false },
          ],
          data: instructionData("claim_fees"),
        },
      ]);
      const before = await tokenAccountBalance(feeAccount);
      const simulation = await rpc<{
        value: {
          err: unknown;
          accounts: ({ data: [string, string] } | null)[] | null;
        };
      }>("simulateTransaction", [
        toBase64(concat(Uint8Array.of(1), new Uint8Array(64), body)),
        {
          encoding: "base64",
          sigVerify: false,
          replaceRecentBlockhash: false,
          commitment: "confirmed",
          accounts: { encoding: "base64", addresses: [feeAccount] },
        },
      ]);
      if (simulation.value.err !== null)
        throw new Error(
          `claim simulation failed: ${JSON.stringify(simulation.value.err).slice(0, 200)}`,
        );
      const simulated = simulation.value.accounts?.[0];
      if (!simulated)
        throw new Error("claim simulation did not credit the fee account");
      const data = fromBase64(simulated.data[0]);
      if (
        new DataView(data.buffer, data.byteOffset).getBigUint64(64, true) -
          before <
        amount
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
      const rawTx = toBase64(concat(Uint8Array.of(1), signature, body));
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
      const transaction = await rpc<{
        slot: number;
        transaction: { signatures: string[] };
        meta: {
          err: unknown;
          preTokenBalances: TokenBalance[];
          postTokenBalances: TokenBalance[];
          logMessages: string[] | null;
        };
      } | null>("getTransaction", [
        txId,
        {
          commitment: "confirmed",
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        },
      ]);
      if (!transaction || transaction.meta.err !== null)
        throw new Error(`claim ${txId} receipt is not available`);
      await claimReceipt(entry, txId, transaction);
      return { txId };
    },
  };

  return {
    address: () => (seed ? wallet : null),
    vaultFees,

    reconcileNativeGas: reconcileNative,
    async balance(token) {
      const result = await rpc<{
        value: {
          account: {
            data: { parsed: { info: { tokenAmount: { amount: string } } } };
          };
        }[];
      }>("getTokenAccountsByOwner", [
        wallet,
        { mint: token },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]);
      return result.value.reduce(
        (sum, entry) =>
          sum + BigInt(entry.account.data.parsed.info.tokenAmount.amount),
        0n,
      );
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
        minAmountOut: BigInt(quote.otherAmountThreshold),
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
      const fresh = await fetchQuote(
        token,
        quote.amountIn,
        Math.max(1, Math.floor(limits.maxSlippageBps / 2)),
      );
      const minAmountOut = BigInt(fresh.otherAmountThreshold);
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
          asLegacyTransaction: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              maxLamports: 200_000,
              priorityLevel: "high",
            },
          },
        }),
      });
      const raw = fromBase64(swap.swapTransaction);
      const parsed = parseTransaction(raw);
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

      const usdcAccount = associatedTokenAccount(wallet, usdc);
      const before = await tokenAccountBalance(usdcAccount);
      const simulation = await rpc<{
        value: {
          err: unknown;
          accounts: ({ data: [string, string] } | null)[] | null;
        };
      }>("simulateTransaction", [
        toBase64(raw),
        {
          encoding: "base64",
          sigVerify: false,
          replaceRecentBlockhash: false,
          commitment: "confirmed",
          accounts: { encoding: "base64", addresses: [usdcAccount] },
        },
      ]);
      if (simulation.value.err !== null)
        throw new Error(
          `swap simulation failed: ${JSON.stringify(simulation.value.err).slice(0, 200)}`,
        );
      const account = simulation.value.accounts?.[0];
      if (!account)
        throw new Error("swap simulation did not credit the USDC account");
      const data = fromBase64(account.data[0]);
      const after = new DataView(data.buffer, data.byteOffset).getBigUint64(
        64,
        true,
      );
      if (after - before < minAmountOut)
        throw new Error(
          "swap simulation returned less than the signed minimum",
        );

      const nativeGasId = await reserveNative(
        raw,
        quote.amountOut,
        assertLease,
      );
      const message = raw.slice(parsed.messageOffset);
      const signature = ed25519.sign(message, seed);
      raw.set(signature, parsed.messageOffset - 64);
      return {
        nativeGasId,
        txId: solanaBase58(signature),
        rawTx: toBase64(raw),
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
        const transaction = await rpc<{
          slot: number;
          transaction: { signatures: string[] };
          meta: {
            err: unknown;
            preTokenBalances: TokenBalance[];
            postTokenBalances: TokenBalance[];
            logMessages: string[] | null;
          };
        } | null>("getTransaction", [
          row.txId,
          {
            commitment: "finalized",
            encoding: "json",
            maxSupportedTransactionVersion: 0,
          },
        ]);
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
      // A finalized height past the blockhash window proves the bytes can
      // no longer land. For a claim, an absent history entry still cannot
      // prove that it did not already land; retain the receipt requirement.
      if (row.expiresAt !== null && height > row.expiresAt)
        return row.kind === "claim"
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
