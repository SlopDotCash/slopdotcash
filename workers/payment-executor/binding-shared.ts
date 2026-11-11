/** Executor environment, deployment selection and stored-binding primitives shared by the executor core and binding recovery. */
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { decodeFunctionData, parseAbi, parseTransaction } from "viem";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import type {
  DispatchPayment,
  PaymentExecutor,
} from "../../backend/payments/dispatch";
import {
  evmRpc as rpc,
  verifyEvmDeployment,
} from "../../contracts/evm/adapter";
import {
  chainFamily,
  ESCROW_NETWORKS,
  type EscrowChain,
  isEscrowChain,
  isMaxNativeCostWei,
} from "../../src/lib/escrow-policy.mjs";
import type { PaymentDeployment } from "../payments/deployment-types";
import { mainnetExecutionEnabled } from "./mainnet-execution.mjs";

export type Hex = `0x${string}`;

export type SignerInput = {
  type: "eip1559";
  chainId: number;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  to: Hex;
  data: Hex;
  value: bigint;
};

export interface Signer {
  address: string;
  signTransaction(input: SignerInput): Promise<Hex>;
  /**
   * Payment keeper only: sign a same-nonce fee replacement of the named
   * journaled original. Without it, no replacement is signed.
   */
  signReplacement?(input: SignerInput, replaces: Hex): Promise<Hex>;
}

export interface JournalStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  transaction<T>(callback: (store: JournalStore) => Promise<T>): Promise<T>;
  /** Required only for bounded legacy-history admission under the test nonce limit. */
  list?<T>(options: { prefix: string; limit: number }): Promise<Map<string, T>>;
}

export interface ExecutorEnvironment {
  PAYMENTS_DB: D1Database;
  PAYMENT_DEPLOYMENTS: string;
  PAYMENT_RPC_URLS: string;
  SIGNER: Signer;
  JOURNAL: JournalStore;
  ATTESTER?: PaymentExecutor;
  /** Only the local integration harness may enable chain 31337. Never set in hosted deployments. */
  ALLOW_LOCAL_TEST_CHAIN?: boolean;
  /**
   * Payment keeper only: bounded same-nonce fee replacement of its journaled
   * sends (owner decision, 25 October 2026). The clock measures the wait.
   */
  FEE_BUMP?: { now(): Date };
  /** Validated test-stack staging control; never enabled for production. */
  BINDING_NONCE_LIMIT?: 1;
}

export type Deployment = Pick<
  PaymentDeployment,
  | "payoutPolicy"
  | "projectId"
  | "vault"
  | "asset"
  | "owner"
  | "identityAuthority"
  | "feeRecipient"
  | "codeSha256"
  | "bindingDelaySeconds"
  | "bindingConsentNonceLimit"
> & {
  /** A registry network, or the local Anvil network of the integration harness. */
  network: string;
  chain: string;
  rpcUrl: string;
  chainId: string;
  /** Reviewed executor gas ceiling in gas units, copied from the registry into the deployment record. */
  gasCeiling: string;
  /** Optional per-operation native gas cost bound. Existing sends retain their original bound. */
  maxNativeCostWei?: string;
  factory: string;
  factoryCodeSha256: string;
  registrar: string;
};

export interface Attempt {
  /** Payment attempts name an obligation; monthly attempts name a period. */
  obligationId?: string;
  monthlyPeriod?: string;
  network: string;
  vault: string;
  fingerprint: string;
  rawTransaction: Hex;
  transactionId: Hex;
  /** Stable vault/actor budget for the optional one-nonce test qualification. */
  bindingNonceBudgetKey?: string;
  /** Durable one-nonce admission for this exact signed EIP-712 consent. */
  bindingConsentBudgetKey?: string;
  /** Immutable bound admitted before this operation's first signature. */
  maxNativeCostWei?: string;
}

/** The tighter current/original limit governs new sends; absent preserves prior policy. */
export function assertEvmNativeCost(
  config: { maxNativeCostWei?: string },
  transaction: { gas: bigint; maxFeePerGas: bigint; value?: bigint },
  attempt?: Pick<Attempt, "maxNativeCostWei">,
) {
  const limits = [config.maxNativeCostWei, attempt?.maxNativeCostWei].filter(
    (value) => value !== undefined,
  );
  for (const limit of limits)
    if (!isMaxNativeCostWei(limit))
      throw new Error("Invalid EVM native cost limit");
  const cost =
    transaction.gas * transaction.maxFeePerGas + (transaction.value ?? 0n);
  if (
    transaction.gas < 0n ||
    transaction.maxFeePerGas < 0n ||
    (transaction.value ?? 0n) < 0n ||
    limits.some((limit) => cost > BigInt(limit))
  )
    throw new Error("EVM transaction exceeds native cost limit");
}

function hex(bytes: Uint8Array): Hex {
  return `0x${bytesToHex(bytes)}`;
}

export function digest(text: string) {
  return hex(keccak_256(new TextEncoder().encode(text)));
}

export function transactionHash(raw: Hex) {
  return hex(keccak_256(hexToBytes(raw.slice(2))));
}

export function same(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

/** The one reviewed deployment for this network and vault; no RPC, no secrets. */
function selectDeployment(
  env: Pick<ExecutorEnvironment, "PAYMENT_DEPLOYMENTS">,
  input: Pick<DispatchPayment, "network" | "vault">,
): Omit<Deployment, "rpcUrl"> {
  const configs = JSON.parse(env.PAYMENT_DEPLOYMENTS) as Omit<
    Deployment,
    "rpcUrl"
  >[];
  const selected = configs.filter(
    (d) => d.network === input.network && same(d.vault, input.vault),
  );
  if (selected.length !== 1) throw new Error("Test deployment required");
  return selected[0];
}

/**
 * Public chain identity check, with no RPC and no secrets. A deployment is
 * accepted only when it is an EVM registry network whose chain and chain id
 * both match the registry entry, or the local Anvil chain under the
 * integration override. A mainnet network also needs its reviewed
 * MAINNET_EXECUTION value, which is on for Base mainnet only.
 */
export function selectReviewedEvmDeployment(
  env: Pick<
    ExecutorEnvironment,
    "PAYMENT_DEPLOYMENTS" | "ALLOW_LOCAL_TEST_CHAIN"
  >,
  input: Pick<DispatchPayment, "network" | "vault">,
): Omit<Deployment, "rpcUrl"> & { chain: EscrowChain } {
  const selected = selectDeployment(env, input);
  const policy = Object.hasOwn(ESCROW_NETWORKS, selected.network)
    ? ESCROW_NETWORKS[selected.network as keyof typeof ESCROW_NETWORKS]
    : undefined;
  const reviewedNetwork =
    policy !== undefined &&
    policy.family === "evm" &&
    policy.chain === selected.chain &&
    (policy.testnet || mainnetExecutionEnabled(selected.network)) &&
    policy.chainId === selected.chainId;
  const localChain =
    policy === undefined &&
    env.ALLOW_LOCAL_TEST_CHAIN === true &&
    selected.chainId === "31337";
  if (
    !isEscrowChain(selected.chain) ||
    chainFamily(selected.chain) !== "evm" ||
    (selected.bindingConsentNonceLimit !== undefined &&
      selected.bindingConsentNonceLimit !== 1) ||
    !(reviewedNetwork || localChain)
  )
    throw new Error("Test deployment required");
  return selected as Omit<Deployment, "rpcUrl"> & { chain: EscrowChain };
}

/**
 * Runs before the hosted worker reads its signer secret: the registry identity
 * check, then the RPC chain id and the deployed vault.
 */
export async function preflightEvmDeployment(
  env: Pick<
    ExecutorEnvironment,
    "PAYMENT_DEPLOYMENTS" | "PAYMENT_RPC_URLS" | "ALLOW_LOCAL_TEST_CHAIN"
  >,
  input: Pick<DispatchPayment, "network" | "vault">,
): Promise<Deployment> {
  const selected = selectReviewedEvmDeployment(env, input);
  if (!/^[1-9][0-9]{0,9}$/.test(selected.gasCeiling ?? ""))
    throw new Error("Reviewed gas ceiling required");
  if (
    selected.maxNativeCostWei !== undefined &&
    !isMaxNativeCostWei(selected.maxNativeCostWei)
  )
    throw new Error("Invalid EVM native cost limit");
  const rpcUrls = JSON.parse(env.PAYMENT_RPC_URLS) as Record<string, string>;
  const rpcUrl = rpcUrls[input.network];
  if (typeof rpcUrl !== "string")
    throw new Error("Private RPC configuration missing");
  const deployment = { ...selected, rpcUrl };
  if (
    BigInt((await rpc(deployment, "eth_chainId", [])) as string) !==
    BigInt(deployment.chainId)
  )
    throw new Error("Wrong RPC chain");
  await verifyEvmDeployment({
    ...deployment,
    chainId: BigInt(deployment.chainId),
  });
  return deployment;
}

/** Identity of the wallet-signed payload, not the caller's operation label. */
export function bindingConsentIdentity(config: Deployment, data: Hex) {
  const { args } = decodeFunctionData({ abi: storedBindingAbi, data });
  const [actor, destination, version, claimDigest, expiresAt] = args;
  if (actor === 0n) throw new Error("Binding consent actor unavailable");
  const identity = [
    config.network,
    config.chainId,
    config.vault.toLowerCase(),
    actor.toString(),
    destination.toLowerCase(),
    version.toString(),
    claimDigest.toLowerCase(),
    expiresAt.toString(),
  ];
  const fingerprint = digest(JSON.stringify(identity));
  return {
    identity,
    fingerprint,
    key: `bind:consent-nonce:${fingerprint.slice(2)}`,
  };
}

export type BindingConsentBudget = {
  schema: "binding-consent-nonce-v1";
  identity: string[];
  fingerprint: string;
  nonce: number;
  transactionId: string;
  nativeCeilingWei: string;
};

/** Retained admission is authoritative even if a later deployment disables the opt-in. */
export async function assertBindingConsentBudget(
  store: JournalStore,
  config: Deployment,
  attempt: Attempt,
  required = config.bindingConsentNonceLimit === 1,
) {
  if (!attempt.bindingConsentBudgetKey) {
    if (required)
      throw new Error("Legacy binding consent budget requires operator review");
    return;
  }
  const tx = parseTransaction(attempt.rawTransaction);
  if (!tx.data) throw new Error("Binding consent transaction unavailable");
  const consent = bindingConsentIdentity(config, tx.data);
  const budget = await store.get<BindingConsentBudget>(consent.key);
  if (
    attempt.bindingConsentBudgetKey !== consent.key ||
    attempt.fingerprint !== consent.fingerprint ||
    !budget ||
    budget.schema !== "binding-consent-nonce-v1" ||
    JSON.stringify(budget.identity) !== JSON.stringify(consent.identity) ||
    budget.fingerprint !== consent.fingerprint ||
    budget.nonce !== tx.nonce ||
    budget.transactionId !== attempt.transactionId ||
    transactionHash(attempt.rawTransaction) !== attempt.transactionId ||
    tx.chainId !== Number(config.chainId) ||
    !same(tx.to ?? "", config.vault) ||
    (tx.value ?? 0n) !== 0n ||
    tx.gas === undefined ||
    tx.maxFeePerGas === undefined ||
    !/^[1-9][0-9]*$/.test(budget.nativeCeilingWei) ||
    tx.gas * tx.maxFeePerGas > BigInt(budget.nativeCeilingWei)
  )
    throw new Error("Binding consent budget differs from signed attempt");
  return budget;
}

export const STORED_BINDING = "bind:stored:";

/** Journal keys of stored bindings signed but not yet finalized. */
export const PENDING_BINDINGS = "pending-stored-bindings";

export const storedBindingAbi = parseAbi([
  "function bindDestination(uint64 actorId,address destination,uint64 expectedVersion,bytes32 claimDigest,uint64 expiresAt,bytes walletSignature)",
]);
