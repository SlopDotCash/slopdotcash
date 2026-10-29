import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  decodeFunctionData,
  parseAbi,
  parseTransaction,
  recoverAddress,
  recoverTransactionAddress,
} from "viem";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import type {
  DispatchPayment,
  PaymentExecutor,
} from "../../backend/payments/dispatch";
import {
  buildPaymentWalletMessage,
  verifyEvmBindingSignature,
  verifyPaymentWalletSignature,
} from "../../backend/payments/possession";
import {
  buildBindCalldata,
  buildCommitMonthlyCalldata,
  buildCommitMonthlyLeafCalldata,
  buildPayCalldata,
  buildReserveMonthlyCalldata,
  type EvmMonthlyReservation,
  evmAllocationRoot,
  evmAwardId,
  evmMonthlyDigest,
  evmMonthlyReserveDigest,
  evmMonthlySumTree,
  readEvmMonthlyReserve,
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
import { acceptsPayoutFee } from "../../src/lib/payments/contracts";
import type { PaymentDeployment } from "../payments/index";
import { finalizedEvmRevert } from "../payments/reconcile";
import { reconcileBindingWinner } from "./binding-recovery";
import { mainnetExecutionEnabled } from "./mainnet-execution.mjs";
import type { MonthlyAuthorization } from "./monthly";

type Hex = `0x${string}`;
type SignerInput = {
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
export type PublicEvmExecutorEnvironment = Omit<
  ExecutorEnvironment,
  "PAYMENTS_DB" | "ATTESTER"
>;

type Input = DispatchPayment & { idempotencyKey: string };
/**
 * A binding request. The hosted `/v1/pay` names the dispatcher's payout
 * attempt. The production attester's scheduled binding names none
 * (`idempotencyKey: null`): Slop prepares no payout attempt on a mainnet
 * (PRD PAY-04).
 */
type BindingRequest = DispatchPayment & { idempotencyKey: string | null };
type AttemptMode = "required" | "none";
type Deployment = Pick<
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
export interface Authorization extends DispatchPayment {
  projectId: string;
  grossBase: string;
  feeBase: string;
  sourceDigest: string;
  message: string;
  signature: string;
  challengeId: string;
  expiresAt: string;
}
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
function assertSignedNativeCost(
  config: { maxNativeCostWei?: string },
  raw: Hex,
  attempt?: Pick<Attempt, "maxNativeCostWei">,
) {
  const signed = parseTransaction(raw);
  if (signed.gas === undefined || signed.maxFeePerGas === undefined)
    throw new Error("Signed EVM gas envelope unavailable");
  assertEvmNativeCost(
    config,
    { gas: signed.gas, maxFeePerGas: signed.maxFeePerGas, value: signed.value },
    attempt,
  );
}
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
function hex(bytes: Uint8Array): Hex {
  return `0x${bytesToHex(bytes)}`;
}
function digest(text: string) {
  return hex(keccak_256(new TextEncoder().encode(text)));
}
function transactionHash(raw: Hex) {
  return hex(keccak_256(hexToBytes(raw.slice(2))));
}
function words(value: unknown, count: number): string[] {
  if (
    typeof value !== "string" ||
    !new RegExp(`^0x[0-9a-fA-F]{${count * 64}}$`).test(value)
  )
    throw new Error("Malformed contract state");
  return value.slice(2).match(/.{64}/g) ?? [];
}
function word(value: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > (1n << 64n) - 1n)
    throw new Error("Invalid actor/version");
  return BigInt(value).toString(16).padStart(64, "0");
}
async function call(config: Deployment, data: string, count: number) {
  return words(
    await rpc(config, "eth_call", [{ to: config.vault, data }, "finalized"]),
    count,
  );
}
function same(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

/** Shared signed wallet consent and current-claim authorization; chain code must verify deployment and obligation. */
export async function authorizeRegistry(
  env: { PAYMENTS_DB: D1Database },
  input: BindingRequest,
  chain: EscrowChain,
  /** Request handlers name a payout attempt; only the scheduled binding names none. */
  attempt: AttemptMode = "required",
): Promise<Authorization> {
  if (
    attempt === "none"
      ? input.idempotencyKey !== null
      : typeof input.idempotencyKey !== "string"
  )
    throw new Error("Payout attempt mode mismatch");
  const select =
    "SELECT o.id obligationId,o.project_id projectId,o.network,o.vault,o.github_user_id githubUserId,o.gross_base grossBase,o.fee_base feeBase,o.source_digest sourceDigest,w.id claimId,w.record_sha256 claimDigest,w.wallet_address destination,c.message,a.signature,c.id challengeId,c.expires_at expiresAt FROM payment_obligations o JOIN effective_payment_wallet_claims w ON w.github_user_id=o.github_user_id AND w.chain=o.chain JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=o.github_user_id JOIN payment_wallet_challenges c ON c.id=a.challenge_id AND c.claim_id=w.id AND c.github_user_id=o.github_user_id";
  const current =
    "o.chain=? AND c.consumed_at IS NOT NULL AND c.consumed_at<=c.expires_at";
  // Without a payout attempt, only an unpaid reserved award of the named
  // claim qualifies.
  const authorization = await (attempt === "none"
    ? env.PAYMENTS_DB.prepare(
        `${select} WHERE o.id=? AND w.id=? AND o.state='reserved' AND ${current}`,
      ).bind(input.obligationId, input.claimId, chain)
    : env.PAYMENTS_DB.prepare(
        `${select} JOIN payment_attempts t ON t.obligation_id=o.id AND t.claim_id=w.id WHERE o.id=? AND t.id=? AND ${current}`,
      ).bind(input.obligationId, input.idempotencyKey, chain)
  ).first<Authorization>();
  if (!authorization)
    throw new Error("Current approved wallet/attempt unavailable");
  for (const key of [
    "obligationId",
    "network",
    "vault",
    "githubUserId",
    "claimId",
    "claimDigest",
    "destination",
  ] as const) {
    if (authorization[key] !== input[key])
      throw new Error("Payout request differs from approved registry");
  }
  if (
    authorization.message !==
      buildPaymentWalletMessage({
        actorId: input.githubUserId,
        chain,
        address: input.destination,
        claimId: input.claimId,
        claimDigest: input.claimDigest,
        nonce: authorization.challengeId,
        expiresAt: authorization.expiresAt,
      }) ||
    !verifyPaymentWalletSignature(
      chain,
      input.destination,
      authorization.message,
      authorization.signature,
    )
  )
    throw new Error("Wallet authorization signature rejected");
  return authorization;
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
function selectReviewedEvmDeployment(
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

/**
 * Before the attester signs an EVM month: commitMonthly counts an existing award
 * under an included source once only if it is the same award, and otherwise
 * reverts the whole month. Refuse to sign a month that can only revert, as the
 * Solana freeze refuses the same allocation.
 */
export async function assertEvmMonthlySources(
  deployment: Deployment,
  entries: readonly {
    githubUserId: string;
    grossMicro: string;
    sourceDigest: string;
  }[],
) {
  for (const entry of entries) {
    const id = evmAwardId(
      BigInt(deployment.chainId),
      deployment.vault,
      entry.sourceDigest,
    );
    const state = await call(deployment, `0xe76af61d${id.slice(2)}`, 6);
    const actor = BigInt(`0x${state[0]}`);
    if (actor === 0n) continue;
    const gross = BigInt(`0x${state[1]}`),
      fee = BigInt(`0x${state[2]}`);
    if (
      actor.toString() !== entry.githubUserId ||
      gross.toString() !== entry.grossMicro ||
      !acceptsPayoutFee(gross, fee)
    )
      throw new Error(
        "A monthly source is already reserved by a different award",
      );
  }
}

async function authorize(
  env: ExecutorEnvironment,
  input: BindingRequest,
  /** Request handlers name a payout attempt; only the scheduled binding names none. */
  attempt: AttemptMode = "required",
): Promise<{ authorization: Authorization; deployment: Deployment }> {
  if (
    !input ||
    Object.entries(input).some(
      ([key, v]) =>
        typeof v !== "string" &&
        !(key === "idempotencyKey" && v === null && attempt === "none"),
    ) ||
    !BYTES32.test(input.obligationId) ||
    !ADDRESS.test(input.destination) ||
    !ADDRESS.test(input.vault) ||
    !/^[0-9a-f]{64}$/.test(input.claimDigest) ||
    (attempt === "none"
      ? input.idempotencyKey !== null
      : typeof input.idempotencyKey !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(input.idempotencyKey))
  )
    throw new Error("Invalid payout request");
  const { chain } = selectReviewedEvmDeployment(env, input);
  const authorization = await authorizeRegistry(env, input, chain, attempt);
  const deployment = await preflightEvmDeployment(env, input);
  if (deployment.projectId !== authorization.projectId)
    throw new Error("Reviewed project deployment mismatch");
  return { authorization, deployment };
}
/** Award state: awards(id) returns actorId, gross, fee, sourceDigest, committedAt, paid. */
async function obligation(config: Deployment, authorization: Authorization) {
  const state = await call(
    config,
    `0xe76af61d${authorization.obligationId.slice(2)}`,
    6,
  );
  if (
    BigInt(`0x${state[0]}`).toString() !== authorization.githubUserId ||
    BigInt(`0x${state[1]}`).toString() !== authorization.grossBase ||
    BigInt(`0x${state[2]}`).toString() !== authorization.feeBase ||
    state[3].toLowerCase() !== authorization.sourceDigest ||
    !acceptsPayoutFee(
      BigInt(authorization.grossBase),
      BigInt(authorization.feeBase),
      config.payoutPolicy,
    )
  )
    throw new Error("Finalized award differs from approved ledger");
  return {
    committedAt: BigInt(`0x${state[4]}`),
    paid: BigInt(`0x${state[5]}`) !== 0n,
  };
}
/** Latest binding: bindings(actor) returns destination, version, claimDigest, activatesAt, cancelled. */
async function binding(config: Deployment, actor: string) {
  const state = await call(config, `0xa45d1232${word(actor)}`, 5);
  return {
    destination: `0x${state[0].slice(24)}`,
    version: BigInt(`0x${state[1]}`).toString(),
    claimDigest: state[2],
    activatesAt: BigInt(`0x${state[3]}`),
    cancelled: BigInt(`0x${state[4]}`) !== 0n,
  };
}
/**
 * Pending and owner-cancelled bindings cannot pay, and an award cannot pay until bindingDelay after its
 * commit; never sign a transaction that must revert.
 */
async function assertPayable(
  config: Deployment,
  current: { activatesAt: bigint; cancelled: boolean },
  committedAt: bigint,
) {
  if (current.cancelled)
    throw new Error(
      "Project owner cancelled this destination binding; identity review required",
    );
  // The contract compares block time, not this worker's clock.
  const latest = (await rpc(config, "eth_getBlockByNumber", [
    "latest",
    false,
  ])) as { timestamp: string };
  const now = BigInt(latest.timestamp);
  if (now < current.activatesAt)
    throw new Error(
      `Destination binding activates at ${new Date(Number(current.activatesAt) * 1000).toISOString()}; retry after activation`,
    );
  const payableAt = committedAt + BigInt(config.bindingDelaySeconds);
  if (now < payableAt)
    throw new Error(
      `Award is inside its commit delay until ${new Date(Number(payableAt) * 1000).toISOString()}; retry after it ends`,
    );
}
/** A finalized revert may be retried unless the test binding policy keeps its nonce held. */
async function retireRevertedAttempt(
  env: PublicEvmExecutorEnvironment,
  config: Deployment,
  key: string,
  attempt: Attempt,
): Promise<boolean> {
  // Any same-nonce fee replacement may be the transaction that consumed the nonce.
  let proof: Awaited<ReturnType<typeof finalizedEvmRevert>> = null;
  for (const transactionId of await signedTransactionIds(
    env.JOURNAL,
    attempt,
  )) {
    proof = await finalizedEvmRevert(
      config.rpcUrl,
      config.chainId,
      transactionId,
      config.chain,
    );
    if (proof) break;
  }
  if (!proof) return false;
  return env.JOURNAL.transaction(async (store) => {
    const current = await store.get<Attempt | null>(key);
    if (!current || current.transactionId !== attempt.transactionId)
      return false;
    await store.put(`${key}:reverted:${attempt.transactionId}`, {
      ...current,
      revert: proof,
    });
    if (
      key.startsWith(STORED_BINDING) &&
      (env.BINDING_NONCE_LIMIT === 1 ||
        config.bindingConsentNonceLimit === 1 ||
        current.bindingConsentBudgetKey)
    )
      return false; // Keep the consumed nonce and its revert proof held.
    await store.put(key, null);
    return true;
  });
}

async function assertBindingNonceBudget(store: JournalStore, attempt: Attempt) {
  if (!attempt.bindingNonceBudgetKey)
    throw new Error("Legacy test binding requires operator review");
  const budget = await store.get<{
    nonce: number;
    transactionId: string;
    fingerprint: string;
  }>(attempt.bindingNonceBudgetKey);
  const tx = parseTransaction(attempt.rawTransaction);
  if (
    !budget ||
    budget.nonce !== tx.nonce ||
    budget.transactionId !== attempt.transactionId ||
    budget.fingerprint !== attempt.fingerprint
  )
    throw new Error("Test binding nonce budget differs from signed attempt");
}
async function reserveBindingNonceBudget(
  store: JournalStore,
  config: Deployment,
  actor: string | undefined,
) {
  if (!actor || !/^[1-9][0-9]*$/.test(actor))
    throw new Error("Test binding actor unavailable");
  const key = `bind:test-nonce:${digest(JSON.stringify([config.chainId, config.vault.toLowerCase(), actor]))}`;
  if (await store.get(key))
    throw new Error(
      "Test binding nonce already consumed; operator review required",
    );
  if (!store.list) throw new Error("Test binding history cannot be reviewed");
  const prior = await store.list<Attempt | null>({
    prefix: STORED_BINDING,
    limit: 1000,
  });
  if (!(prior instanceof Map) || prior.size >= 1000)
    throw new Error("Test binding history exceeds review bound");
  // Cancellation/supersession recovery moves the original into this archive
  // and clears its active key. Include it before admitting a different claim.
  const observations = await store.list<{ attempt: Attempt }>({
    prefix: "binding-observed:",
    limit: 1000 - prior.size,
  });
  if (!(observations instanceof Map) || observations.size >= 1000 - prior.size)
    throw new Error("Test binding history exceeds review bound");
  const attempts = [
    ...prior.values(),
    ...[...observations.values()].map((record) => {
      if (!record?.attempt) throw new Error("Legacy test binding is malformed");
      return record.attempt;
    }),
  ];
  for (const attempt of attempts) {
    if (
      !attempt ||
      attempt.network !== config.network ||
      attempt.vault.toLowerCase() !== config.vault.toLowerCase()
    )
      continue;
    const data = parseTransaction(attempt.rawTransaction).data;
    if (!data || data.length < 74)
      throw new Error("Legacy test binding is malformed");
    if (BigInt(`0x${data.slice(10, 74)}`).toString() === actor)
      throw new Error("Legacy test binding history requires operator review");
  }
  return key;
}

/** Identity of the wallet-signed payload, not the caller's operation label. */
function bindingConsentIdentity(config: Deployment, data: Hex) {
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

type BindingConsentBudget = {
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

async function assertBindingConsentCandidate(
  store: JournalStore,
  config: Deployment,
  attempt: Attempt,
  candidate: {
    nonce?: number;
    gas?: bigint;
    maxFeePerGas?: bigint;
    value?: bigint;
  },
) {
  if (!attempt.bindingConsentBudgetKey) return;
  const budget = await assertBindingConsentBudget(store, config, attempt);
  if (
    !budget ||
    candidate.nonce !== budget.nonce ||
    candidate.gas === undefined ||
    candidate.maxFeePerGas === undefined
  )
    throw new Error("Binding candidate differs from its retained nonce budget");
  assertEvmNativeCost(
    { maxNativeCostWei: budget.nativeCeilingWei },
    {
      gas: candidate.gas,
      maxFeePerGas: candidate.maxFeePerGas,
      value: candidate.value,
    },
  );
}

async function unusedBindingConsent(
  store: JournalStore,
  config: Deployment,
  data: Hex,
) {
  const consent = bindingConsentIdentity(config, data);
  // This lookup is unconditional: disabling the opt-in cannot reset an admission.
  if ((await store.get(consent.key)) !== undefined)
    throw new Error(
      "Binding consent nonce already consumed; operator review required",
    );
  return consent;
}

async function reserveBindingConsentBudget(
  store: JournalStore,
  config: Deployment,
  data: Hex,
) {
  const consent = await unusedBindingConsent(store, config, data);
  if (config.bindingConsentNonceLimit !== 1) return undefined;
  if (!store.list) throw new Error("Binding consent history unavailable");
  const prior = await store.list<Attempt | null>({
    prefix: STORED_BINDING,
    limit: 1000,
  });
  if (!(prior instanceof Map) || prior.size >= 1000)
    throw new Error("Binding consent history exceeds review bound");
  const observed = await store.list<{ key: string; attempt: Attempt }>({
    prefix: "binding-observed:",
    limit: 1000 - prior.size,
  });
  if (!(observed instanceof Map) || observed.size >= 1000 - prior.size)
    throw new Error("Binding consent history exceeds review bound");
  for (const [key, attempt] of prior) {
    if (
      attempt === null &&
      ![...prior.keys()].some((name) => name.startsWith(`${key}:reverted:`)) &&
      ![...observed.values()].some(
        (record) => record?.key === key && record.attempt,
      )
    )
      throw new Error("Retired binding consent history unavailable");
  }
  const attempts = [
    ...prior.values(),
    ...[...observed.values()].map((record) => {
      if (!record?.attempt)
        throw new Error("Binding consent history malformed");
      return record.attempt;
    }),
  ];
  for (const attempt of attempts) {
    if (attempt === null) continue;
    if (!attempt || typeof attempt.vault !== "string")
      throw new Error("Binding consent history malformed");
    if (
      attempt.network !== config.network ||
      !same(attempt.vault, config.vault)
    )
      continue;
    const tx = parseTransaction(attempt.rawTransaction);
    if (!tx.data) throw new Error("Binding consent history malformed");
    if (
      bindingConsentIdentity(config, tx.data).identity[3] ===
      consent.identity[3]
    )
      await assertBindingConsentBudget(store, config, attempt, true);
  }
  return consent;
}

async function signAndSubmit(
  env: PublicEvmExecutorEnvironment,
  config: Deployment,
  key: string,
  fingerprint: string,
  data: string,
  input: Pick<Input, "network" | "vault" | "idempotencyKey"> & {
    obligationId?: string;
    monthlyPeriod?: string;
    githubUserId?: string;
  },
  /** Journal list that records the key in the same transaction as the signed bytes. */
  pendingList?: string,
  /** Authorization must still hold immediately before any stored binding broadcast. */
  beforeBroadcast?: (attempt: Attempt) => Promise<void>,
) {
  let attempt = await env.JOURNAL.get<Attempt>(key);
  if (attempt && key.startsWith(STORED_BINDING))
    await assertBindingConsentBudget(env.JOURNAL, config, attempt);
  if (
    attempt &&
    env.BINDING_NONCE_LIMIT === 1 &&
    key.startsWith(STORED_BINDING)
  )
    await assertBindingNonceBudget(env.JOURNAL, attempt);
  if (attempt && attempt.fingerprint !== fingerprint)
    throw new Error("Idempotency key reused for another operation");
  if (!attempt) {
    // Empty calldata means "reconcile the journaled transaction"; it never
    // signs a new one, even when the entry was retired meanwhile.
    if (!data) throw new Error("No journaled transaction to reconcile");
    // Refuse a consumed consent before quotes/simulation, then recheck inside
    // the atomic admission below so concurrent invocations cannot race it.
    if (key.startsWith(STORED_BINDING))
      await unusedBindingConsent(env.JOURNAL, config, data as Hex);
    const chainNonce = Number(
      BigInt(
        (await rpc(config, "eth_getTransactionCount", [
          env.SIGNER.address,
          "pending",
        ])) as string,
      ),
    );
    const block = (await rpc(config, "eth_getBlockByNumber", [
      "latest",
      false,
    ])) as { baseFeePerGas: string };
    const priority = 1_000_000n;
    const maxFee = BigInt(block.baseFeePerGas) * 2n + priority;
    if (maxFee > 10_000_000_000n)
      throw new Error("Gas fee exceeds test signer policy");
    const gas =
      (BigInt(
        (await rpc(config, "eth_estimateGas", [
          { from: env.SIGNER.address, to: config.vault, data, value: "0x0" },
        ])) as string,
      ) *
        12n) /
      10n;
    if (gas > BigInt(config.gasCeiling))
      throw new Error("Gas exceeds narrow operation policy");
    assertEvmNativeCost(config, { gas, maxFeePerGas: maxFee });
    const nonceKey = `nonce:${config.chainId}:${env.SIGNER.address.toLowerCase()}`;
    attempt = await env.JOURNAL.transaction(async (store) => {
      if (await store.get(`retired:${input.network}:${input.idempotencyKey}`))
        throw new Error("Attempt retired before signing");
      const existing = await store.get<Attempt>(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new Error("Idempotency collision");
        if (env.BINDING_NONCE_LIMIT === 1 && key.startsWith(STORED_BINDING))
          await assertBindingNonceBudget(store, existing);
        if (key.startsWith(STORED_BINDING))
          await assertBindingConsentBudget(store, config, existing);
        return existing;
      }
      const consent = key.startsWith(STORED_BINDING)
        ? await reserveBindingConsentBudget(store, config, data as Hex)
        : undefined;
      if (consent && fingerprint !== consent.fingerprint)
        throw new Error("Binding consent operation differs");
      const bindingNonceBudgetKey =
        env.BINDING_NONCE_LIMIT === 1 && key.startsWith(STORED_BINDING)
          ? await reserveBindingNonceBudget(store, config, input.githubUserId)
          : undefined;
      const nonce = Math.max(
        chainNonce,
        (await store.get<number>(nonceKey)) ?? 0,
      );
      if (!Number.isSafeInteger(nonce)) throw new Error("Invalid signer nonce");
      const rawTransaction = await env.SIGNER.signTransaction({
        type: "eip1559",
        chainId: Number(config.chainId),
        nonce,
        gas,
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: priority,
        to: config.vault as Hex,
        data: data as Hex,
        value: 0n,
      });
      assertSignedNativeCost(config, rawTransaction);
      const next = {
        ...(input.obligationId
          ? { obligationId: input.obligationId }
          : { monthlyPeriod: input.monthlyPeriod }),
        network: input.network,
        vault: input.vault,
        fingerprint,
        rawTransaction,
        transactionId: transactionHash(rawTransaction),
        ...(bindingNonceBudgetKey ? { bindingNonceBudgetKey } : {}),
        ...(consent ? { bindingConsentBudgetKey: consent.key } : {}),
        ...(config.maxNativeCostWei === undefined
          ? {}
          : { maxNativeCostWei: config.maxNativeCostWei }),
      };
      if (consent) {
        const gasEnvelope = BigInt(config.gasCeiling) * 10_000_000_000n;
        const nativeEnvelope =
          next.maxNativeCostWei === undefined
            ? gasEnvelope
            : BigInt(next.maxNativeCostWei);
        await store.put<BindingConsentBudget>(consent.key, {
          schema: "binding-consent-nonce-v1",
          identity: consent.identity,
          fingerprint,
          nonce,
          transactionId: next.transactionId,
          // Includes any permitted same-nonce fee/cancellation competitor.
          nativeCeilingWei: String(
            nativeEnvelope < gasEnvelope ? nativeEnvelope : gasEnvelope,
          ),
        });
      }
      if (bindingNonceBudgetKey)
        await store.put(bindingNonceBudgetKey, {
          nonce,
          transactionId: next.transactionId,
          fingerprint,
        });
      await store.put(key, next);
      await store.put(nonceKey, nonce + 1);
      if (pendingList) {
        const keys = (await store.get<string[]>(pendingList)) ?? [];
        if (!keys.includes(key)) await store.put(pendingList, [...keys, key]);
      }
      return next;
    });
  }
  // Stored signed bytes exist before either the first broadcast or a retry.
  // Any journaled same-nonce attempt can be the one that lands.
  for (const transactionId of (
    await signedTransactionIds(env.JOURNAL, attempt)
  ).reverse()) {
    const receipt = (await rpc(config, "eth_getTransactionReceipt", [
      transactionId,
    ])) as { status: string } | null;
    if (receipt) {
      if (receipt.status !== "0x1")
        throw new Error(
          "Recorded transaction reverted; operator reconciliation required",
        );
      return { transactionId };
    }
  }
  await beforeBroadcast?.(attempt);
  if (env.FEE_BUMP)
    return replaceUnderpricedAttempt(env, env.FEE_BUMP, config, key, attempt);
  await broadcast(config, attempt, attempt, env.JOURNAL);
  return { transactionId: attempt.transactionId };
}

/** The node knows this exact signed transaction, pending or mined. */
export async function observedEvmTransaction(
  config: Pick<Deployment, "rpcUrl">,
  transactionId: string,
) {
  return !!(await rpc(config, "eth_getTransactionByHash", [transactionId]));
}

/** An uncertain send is accepted only when the node already knows its exact hash. */
async function broadcast(
  config: Deployment,
  signed: { rawTransaction: Hex; transactionId: Hex },
  original: Attempt,
  journal: JournalStore,
) {
  assertSignedNativeCost(config, signed.rawTransaction, original);
  await assertBindingConsentCandidate(
    journal,
    config,
    original,
    parseTransaction(signed.rawTransaction),
  );
  try {
    const sent = await rpc(config, "eth_sendRawTransaction", [
      signed.rawTransaction,
    ]);
    if (sent !== signed.transactionId)
      throw new Error("Transaction hash mismatch");
  } catch (error) {
    if (!(await observedEvmTransaction(config, signed.transactionId)))
      throw error;
  }
}

/**
 * Bounded automatic fee replacement for the payment keeper (owner decision,
 * 25 October 2026). Each step raises both fees by 25%, never above three times
 * the original fees or the existing 10 gwei ceiling, with a 10% minimum step.
 * Gas, recipient, value and calldata never change.
 */
const FEE_BUMP_POLICY = {
  waitMs: 10 * 60_000,
  stepPercent: 125n,
  minimumPercent: 110n,
  capMultiple: 3n,
  maxFeePerGas: 10_000_000_000n,
} as const;
type FeeReplacement = {
  rawTransaction: Hex;
  transactionId: Hex;
  signedAt: string;
};
/** Immutable append-only list of replacements for one original attempt. */
type FeeReplacements = {
  original: Hex;
  observedAt: string;
  replacements: FeeReplacement[];
};
const feeReplacementKey = (attempt: Attempt) =>
  `fee-bump:${attempt.transactionId.toLowerCase()}`;

/** The original first, then each journaled same-nonce replacement in signing order. */
async function signedTransactionIds(journal: JournalStore, attempt: Attempt) {
  const record = await journal.get<FeeReplacements>(feeReplacementKey(attempt));
  return [
    attempt.transactionId,
    ...(record?.replacements ?? []).map((item) => item.transactionId),
  ];
}

function nextReplacementFees(
  original: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
  latest: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
) {
  const policy = FEE_BUMP_POLICY;
  const step = (value: bigint, cap: bigint) => {
    const raised = (value * policy.stepPercent + 99n) / 100n;
    return raised < cap ? raised : cap;
  };
  const feeCap =
    original.maxFeePerGas * policy.capMultiple < policy.maxFeePerGas
      ? original.maxFeePerGas * policy.capMultiple
      : policy.maxFeePerGas;
  const next = {
    maxFeePerGas: step(latest.maxFeePerGas, feeCap),
    maxPriorityFeePerGas: step(
      latest.maxPriorityFeePerGas,
      original.maxPriorityFeePerGas * policy.capMultiple,
    ),
  };
  const minimum = (value: bigint) =>
    (value * policy.minimumPercent + 99n) / 100n;
  if (
    next.maxFeePerGas < minimum(latest.maxFeePerGas) ||
    next.maxPriorityFeePerGas < minimum(latest.maxPriorityFeePerGas) ||
    next.maxPriorityFeePerGas > next.maxFeePerGas
  )
    return null;
  return next;
}

/** Recheck every stored replacement against the original before any broadcast. */
async function verifiedReplacements(
  env: PublicEvmExecutorEnvironment,
  config: Deployment,
  attempt: Attempt,
  record: FeeReplacements,
) {
  const original = parseTransaction(attempt.rawTransaction);
  assertSignedNativeCost({}, attempt.rawTransaction, attempt);
  if (
    !attempt.rawTransaction.startsWith("0x02") ||
    typeof original.nonce !== "number" ||
    original.maxFeePerGas === undefined ||
    original.maxPriorityFeePerGas === undefined ||
    original.gas === undefined ||
    record.original.toLowerCase() !== attempt.transactionId.toLowerCase()
  )
    throw new Error("Journaled transaction cannot take a fee replacement");
  const fees = {
    maxFeePerGas: original.maxFeePerGas,
    maxPriorityFeePerGas: original.maxPriorityFeePerGas,
  };
  let latest = {
    rawTransaction: attempt.rawTransaction,
    transactionId: attempt.transactionId,
    signedAt: record.observedAt,
    ...fees,
  };
  for (const item of record.replacements) {
    const signed = parseTransaction(item.rawTransaction);
    // Historical envelopes use the bound recorded at admission, not a later config change.
    assertSignedNativeCost({}, item.rawTransaction, attempt);
    const expected = nextReplacementFees(fees, latest);
    if (
      !item.rawTransaction.startsWith("0x02") ||
      transactionHash(item.rawTransaction) !== item.transactionId ||
      !expected ||
      signed.maxFeePerGas !== expected.maxFeePerGas ||
      signed.maxPriorityFeePerGas !== expected.maxPriorityFeePerGas ||
      signed.chainId !== original.chainId ||
      signed.chainId !== Number(config.chainId) ||
      signed.nonce !== original.nonce ||
      signed.gas !== original.gas ||
      !same(signed.to ?? "", original.to ?? "") ||
      (signed.value ?? 0n) !== (original.value ?? 0n) ||
      (signed.data ?? "0x") !== (original.data ?? "0x") ||
      (signed.accessList?.length ?? 0) !== 0 ||
      !same(
        await recoverTransactionAddress({
          serializedTransaction: item.rawTransaction as `0x02${string}`,
        }),
        env.SIGNER.address,
      )
    )
      throw new Error("Stored fee replacement differs from its original");
    latest = { ...item, ...expected };
  }
  return { original, fees, latest };
}

/**
 * Rebroadcast the latest journaled attempt. When it stayed unmined past the
 * wait and the current base fee exceeds its max fee,
 * first sign one same-nonce replacement. The replacement's worst-case gas is
 * reserved by the keeper signer inside the same journal transaction.
 */
async function replaceUnderpricedAttempt(
  env: PublicEvmExecutorEnvironment,
  clock: { now(): Date },
  config: Deployment,
  key: string,
  attempt: Attempt,
) {
  const recordKey = feeReplacementKey(attempt);
  let record = await env.JOURNAL.get<FeeReplacements>(recordKey);
  if (!record) {
    // The wait starts when the keeper first finds this attempt unmined.
    const observed = {
      original: attempt.transactionId,
      observedAt: clock.now().toISOString(),
      replacements: [],
    };
    record = await env.JOURNAL.transaction(async (store) => {
      const retained = await store.get<FeeReplacements>(recordKey);
      if (retained) return retained;
      await store.put(recordKey, observed);
      return observed;
    });
  }
  const {
    original,
    fees: originalFees,
    latest,
  } = await verifiedReplacements(env, config, attempt, record);
  // Report a wait after the latest verified bytes were offered again.
  const waiting = async (reason: string): Promise<never> => {
    await broadcast(config, latest, attempt, env.JOURNAL).catch(
      () => undefined,
    );
    throw new Error(reason);
  };
  let baseFee: bigint;
  try {
    const block = (await rpc(config, "eth_getBlockByNumber", [
      "latest",
      false,
    ])) as { baseFeePerGas: string };
    baseFee = BigInt(block.baseFeePerGas);
  } catch {
    return waiting(
      "Network fee unavailable; the latest journaled attempt was rebroadcast without a fee replacement",
    );
  }
  const now = clock.now();
  if (
    baseFee <= latest.maxFeePerGas ||
    now.getTime() - Date.parse(latest.signedAt) < FEE_BUMP_POLICY.waitMs
  ) {
    await broadcast(config, latest, attempt, env.JOURNAL);
    return { transactionId: latest.transactionId };
  }
  const fees = nextReplacementFees(originalFees, latest);
  if (!fees)
    return waiting(
      "Fee replacement cap reached; journaled attempts wait for a lower network fee",
    );
  if (
    (config.maxNativeCostWei !== undefined ||
      attempt.maxNativeCostWei !== undefined) &&
    fees.maxFeePerGas < baseFee
  )
    return waiting("Current base fee exceeds the permitted replacement fee");
  try {
    assertEvmNativeCost(
      config,
      { gas: original.gas as bigint, ...fees, value: original.value },
      attempt,
    );
    await assertBindingConsentCandidate(env.JOURNAL, config, attempt, {
      nonce: original.nonce,
      gas: original.gas,
      ...fees,
      value: original.value,
    });
  } catch {
    return waiting("Fee replacement exceeds the operation's native cost limit");
  }
  if ((original.gas as bigint) > BigInt(config.gasCeiling))
    return waiting(
      "Registry gas ceiling is now below the journaled gas limit; no fee replacement is signed",
    );
  const mined = BigInt(
    (await rpc(config, "eth_getTransactionCount", [
      env.SIGNER.address,
      "latest",
    ])) as string,
  );
  if (mined > BigInt(original.nonce as number))
    throw new Error(
      "Signer nonce is already used; waiting for the journaled receipt",
    );
  const sign = env.SIGNER.signReplacement?.bind(env.SIGNER);
  if (!sign)
    return waiting("This signer cannot sign a budgeted fee replacement");
  const current = record;
  let replacement: FeeReplacement;
  try {
    replacement = await env.JOURNAL.transaction(async (store) => {
      if (
        JSON.stringify(await store.get(recordKey)) !==
          JSON.stringify(current) ||
        JSON.stringify(await store.get(key)) !== JSON.stringify(attempt)
      )
        throw new Error("Journaled attempt changed before fee replacement");
      await assertBindingConsentCandidate(store, config, attempt, {
        nonce: original.nonce,
        gas: original.gas,
        ...fees,
        value: original.value,
      });
      const rawTransaction = await sign(
        {
          type: "eip1559",
          chainId: Number(config.chainId),
          nonce: original.nonce as number,
          gas: original.gas as bigint,
          ...fees,
          to: original.to as Hex,
          data: (original.data ?? "0x") as Hex,
          value: original.value ?? 0n,
        },
        attempt.transactionId,
      );
      assertSignedNativeCost(config, rawTransaction, attempt);
      const next = {
        rawTransaction,
        transactionId: transactionHash(rawTransaction),
        signedAt: now.toISOString(),
      };
      // Never change the original bytes or the shared nonce high-water mark.
      await store.put(recordKey, {
        ...current,
        replacements: [...current.replacements, next],
      });
      return next;
    });
  } catch (error) {
    // Without a reservation there is no replacement; keep the latest signed send alive.
    return waiting(
      `Fee replacement waits: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await broadcast(config, replacement, attempt, env.JOURNAL);
  return { transactionId: replacement.transactionId };
}

/**
 * A monthly step that another sender completed can still have this signer's
 * journaled transaction, which holds its nonce. Every later send of this signer
 * waits behind that nonce. Until the signer's mined nonce passes it, send the
 * same journaled bytes again. They cannot commit the step a second time.
 * Returns true once no journaled nonce of this step remains unmined.
 */
async function sendJournaledUntilMined(
  env: PublicEvmExecutorEnvironment,
  config: Deployment,
  key: string,
  monthlyPeriod: string,
) {
  const attempt = await env.JOURNAL.get<Attempt | null>(key);
  if (!attempt) return true;
  const { nonce } = parseTransaction(attempt.rawTransaction);
  if (typeof nonce !== "number")
    throw new Error("Journaled transaction nonce unavailable");
  const mined = await rpc(config, "eth_getTransactionCount", [
    env.SIGNER.address,
    "latest",
  ]);
  if (BigInt(mined as string) > BigInt(nonce)) return true;
  await signAndSubmit(env, config, key, attempt.fingerprint, "", {
    network: attempt.network,
    vault: attempt.vault,
    idempotencyKey: digest(key).slice(2),
    monthlyPeriod,
  });
  return false;
}

/** Permissionless monthly commitment using the executor's gas key, not the attester key.
 * Signature, pinned deployment and existing on-chain root are checked on every retry.
 * A submitted transaction is not proof of finalized reservation or payment.
 */
export async function submitEvmMonthly(
  env: PublicEvmExecutorEnvironment,
  authorization: MonthlyAuthorization,
  admit = true,
  maxLeaves = 16,
): Promise<{
  transactionId: string | null;
  alreadyCommitted: boolean;
  complete?: boolean;
  notAdmitted?: boolean;
  committedSources?: string[];
}> {
  const { plan, signatureHex } = authorization;
  if (
    plan.family !== "evm" ||
    !/^[2-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(plan.request.period)
  )
    throw new Error("Invalid monthly authorization");
  const target = {
    network: plan.request.network,
    vault: plan.deployment.vault,
  };
  const deployment = await preflightEvmDeployment(env, target);
  if (
    deployment.projectId !== plan.request.projectId ||
    !same(deployment.asset, plan.deployment.asset) ||
    same(env.SIGNER.address, deployment.identityAuthority)
  )
    throw new Error("Monthly executor or deployment mismatch");
  const reservation = plan.evmReservation;
  if (reservation)
    return submitEvmMonthlyReserve(
      env,
      authorization,
      deployment,
      reservation,
      admit,
      maxLeaves,
    );
  if (!admit) return { transactionId: null, alreadyCommitted: false };
  const root = evmAllocationRoot(plan.entries);
  const expected = evmMonthlyDigest(
    BigInt(deployment.chainId),
    deployment.vault,
    plan.request.period,
    root,
  );
  if (
    root !== plan.allocationRoot ||
    expected.slice(2) !== plan.messageHex ||
    !/^[a-f0-9]{130}$/.test(signatureHex) ||
    !same(
      await recoverAddress({
        hash: expected as Hex,
        signature: `0x${signatureHex}`,
      }),
      deployment.identityAuthority,
    )
  )
    throw new Error("Invalid monthly authority signature");
  const period = Number(plan.request.period.replace("-", ""));
  const currentRoot = (
    await call(
      deployment,
      `${digest("monthlyRoots(uint32)").slice(0, 10)}${period.toString(16).padStart(64, "0")}`,
      1,
    )
  )[0];
  const key = `monthly:${target.network}:${target.vault.toLowerCase()}:${plan.request.period}`;
  if (BigInt(`0x${currentRoot}`) !== 0n) {
    // Another sender may have committed this month after this signer journaled its own commit.
    const settled = await sendJournaledUntilMined(
      env,
      deployment,
      key,
      plan.request.period,
    );
    if (`0x${currentRoot}` !== root)
      throw new Error("Another monthly root is already committed");
    // Not complete while this signer's journaled nonce is unmined.
    return {
      transactionId: null,
      alreadyCommitted: true,
      ...(settled ? {} : { complete: false }),
    };
  }
  const fingerprint = digest(
    JSON.stringify([
      deployment.chainId,
      target.vault.toLowerCase(),
      plan.request.period,
      root,
    ]),
  );
  const previous = await env.JOURNAL.get<Attempt>(key);
  if (previous) await retireRevertedAttempt(env, deployment, key, previous);
  const result = await signAndSubmit(
    env,
    deployment,
    key,
    fingerprint,
    buildCommitMonthlyCalldata(
      plan.request.period,
      plan.entries,
      `0x${signatureHex}`,
    ),
    {
      ...target,
      idempotencyKey: digest(key).slice(2),
      monthlyPeriod: plan.request.period,
    },
  );
  return { ...result, alreadyCommitted: false };
}

/** The reserve and each leaf share the existing exact-byte transaction journal. A replacement root
 * cannot skip an uncertain admission: first reconcile/rebroadcast that stored transaction. */
async function submitEvmMonthlyReserve(
  env: PublicEvmExecutorEnvironment,
  authorization: MonthlyAuthorization,
  deployment: Deployment,
  reservation: EvmMonthlyReservation,
  admit: boolean,
  maxLeaves: number,
) {
  const { plan, signatureHex } = authorization;
  if (!Number.isSafeInteger(maxLeaves) || maxLeaves < 1)
    throw new Error("Invalid monthly leaf bound");
  const config = { ...deployment, chainId: BigInt(deployment.chainId) };
  const tree = evmMonthlySumTree(plan.entries);
  const expected = evmMonthlyReserveDigest(
    config.chainId,
    deployment.vault,
    plan.request.period,
    reservation,
  );
  if (
    reservation.allocationDigest !== `0x${plan.request.snapshotSha256}` ||
    reservation.allocationRoot !== tree.hash ||
    plan.allocationRoot !== tree.hash ||
    reservation.count !== plan.entries.length ||
    reservation.remainingGross !== tree.total.toString() ||
    reservation.wholeGross !== plan.totalGrossBase ||
    expected.slice(2) !== plan.messageHex ||
    !/^[a-f0-9]{130}$/.test(signatureHex)
  )
    throw new Error("Monthly reserve differs from its frozen authorization");
  const state = await readEvmMonthlyReserve(config, plan.request.period);
  const target = { network: plan.request.network, vault: deployment.vault };
  const legacy = authorization.legacyAuthorization;
  if (legacy) {
    if (
      legacy.plan.evmReservation ||
      legacy.plan.family !== "evm" ||
      legacy.plan.request.projectId !== plan.request.projectId ||
      legacy.plan.request.period !== plan.request.period ||
      legacy.plan.request.network !== plan.request.network ||
      legacy.plan.request.snapshotSha256 !== plan.request.snapshotSha256 ||
      !same(legacy.plan.deployment.vault, deployment.vault) ||
      !same(legacy.plan.deployment.asset, deployment.asset) ||
      plan.entries.some(
        (entry) =>
          !legacy.plan.entries.some(
            (old) =>
              same(old.sourceDigest, entry.sourceDigest) &&
              old.githubUserId === entry.githubUserId &&
              old.grossMicro === entry.grossMicro,
          ),
      )
    ) {
      throw new Error(
        "Legacy authorization differs from the frozen monthly allocation",
      );
    }
  }
  const key = `monthly:v2:${target.network}:${target.vault.toLowerCase()}:${plan.request.period}`;
  const legacyKey = `monthly:${target.network}:${target.vault.toLowerCase()}:${plan.request.period}`;
  // Another sender may have admitted this month after this signer journaled its own commitment.
  let rootSettled = true;
  if (BigInt(state.root) !== 0n)
    for (const journaled of [legacyKey, key])
      rootSettled =
        (await sendJournaledUntilMined(
          env,
          deployment,
          journaled,
          plan.request.period,
        )) && rootSettled;
  if (BigInt(state.root) !== 0n && BigInt(state.allocationDigest) === 0n) {
    if (!legacy)
      throw new Error("The original legacy monthly authorization is required");
    // An independently signed V1 transaction may win after V2 publication. Its finalized root
    // proves the full old commitment; do not submit V2 or overwrite either authorization.
    const legacyRoot = evmAllocationRoot(legacy.plan.entries);
    const legacyDigest = evmMonthlyDigest(
      config.chainId,
      deployment.vault,
      plan.request.period,
      legacyRoot,
    );
    if (
      state.root !== legacyRoot ||
      legacy.plan.allocationRoot !== legacyRoot ||
      legacy.plan.messageHex !== legacyDigest.slice(2) ||
      !/^[a-f0-9]{130}$/.test(legacy.signatureHex) ||
      !same(
        await recoverAddress({
          hash: legacyDigest as Hex,
          signature: `0x${legacy.signatureHex}`,
        }),
        legacy.plan.deployment.identityAuthority,
      )
    ) {
      throw new Error(
        "Legacy monthly root differs from its original authorization",
      );
    }
    return {
      transactionId: null,
      alreadyCommitted: true,
      complete: rootSettled,
    };
  }
  const fingerprint = digest(
    JSON.stringify([deployment.chainId, target.vault.toLowerCase(), expected]),
  );
  if (BigInt(state.root) === 0n) {
    if (!admit)
      return {
        notAdmitted: true,
        transactionId: null,
        alreadyCommitted: false,
        complete: false,
      };
    const authority = (
      await call(deployment, `${digest("identityAuthority()").slice(0, 10)}`, 1)
    )[0];
    if (
      !same(
        await recoverAddress({
          hash: expected,
          signature: `0x${signatureHex}`,
        }),
        `0x${authority.slice(24)}`,
      )
    ) {
      throw new Error("Invalid monthly authority signature");
    }
    const legacyAttempt = await env.JOURNAL.get<Attempt>(legacyKey);
    if (
      legacyAttempt &&
      !(await retireRevertedAttempt(env, deployment, legacyKey, legacyAttempt))
    ) {
      const result = await signAndSubmit(
        env,
        deployment,
        legacyKey,
        legacyAttempt.fingerprint,
        "",
        {
          ...target,
          idempotencyKey: digest(legacyKey).slice(2),
          monthlyPeriod: plan.request.period,
        },
      );
      return { ...result, alreadyCommitted: false, complete: false };
    }
    const previous = await env.JOURNAL.get<Attempt>(key);
    if (
      previous &&
      !(await retireRevertedAttempt(env, deployment, key, previous))
    ) {
      const result = await signAndSubmit(
        env,
        deployment,
        key,
        previous.fingerprint,
        "",
        {
          ...target,
          idempotencyKey: digest(key).slice(2),
          monthlyPeriod: plan.request.period,
        },
      );
      return { ...result, alreadyCommitted: false, complete: false };
    }
    const result = await signAndSubmit(
      env,
      deployment,
      key,
      fingerprint,
      buildReserveMonthlyCalldata(
        plan.request.period,
        reservation,
        `0x${signatureHex}`,
      ),
      {
        ...target,
        idempotencyKey: digest(key).slice(2),
        monthlyPeriod: plan.request.period,
      },
    );
    return { ...result, alreadyCommitted: false, complete: false };
  }
  if (
    state.root !== tree.hash ||
    state.allocationDigest !== reservation.allocationDigest ||
    state.total !== tree.total ||
    state.count !== plan.entries.length
  ) {
    throw new Error("Another monthly reserve is already admitted");
  }
  // The chain already authenticated this root. A later authority rotation, owner opt-out or expired
  // admission window cannot invalidate the funded reserve or require another authority signature.
  const cursorKey = `${key}:${tree.hash}:finalized-cursor`;
  let cursor = (await env.JOURNAL.get<number>(cursorKey)) ?? 0;
  if (
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    cursor > plan.entries.length
  )
    throw new Error("Invalid monthly execution cursor");
  if (state.remaining === 0n) {
    // Other senders may have committed the last leaves after this signer journaled one of them.
    let index = cursor;
    for (; index < plan.entries.length && index < cursor + maxLeaves; ++index) {
      const leafKey = `${key}:${tree.hash}:leaf:${index}`;
      if (
        !(await sendJournaledUntilMined(
          env,
          deployment,
          leafKey,
          plan.request.period,
        ))
      )
        break;
      await env.JOURNAL.put(cursorKey, index + 1);
    }
    // Complete only after every journaled nonce of this month is mined.
    return {
      transactionId: null,
      alreadyCommitted: true,
      complete: rootSettled && index === plan.entries.length,
    };
  }
  let transactionId: string | null = null;
  const committedSources: string[] = [];
  for (
    let index = cursor, examined = 0;
    index < plan.entries.length && examined < maxLeaves;
    ++index, ++examined
  ) {
    const entry = plan.entries[index];
    const leafKey = `${key}:${tree.hash}:leaf:${index}`;
    const id = evmAwardId(config.chainId, deployment.vault, entry.sourceDigest);
    const award = await call(deployment, `0xe76af61d${id.slice(2)}`, 6);
    if (BigInt(`0x${award[0]}`) !== 0n) {
      if (
        BigInt(`0x${award[0]}`).toString() !== entry.githubUserId ||
        BigInt(`0x${award[1]}`).toString() !== String(entry.grossMicro) ||
        !acceptsPayoutFee(BigInt(`0x${award[1]}`), BigInt(`0x${award[2]}`))
      )
        throw new Error(
          "Admitted monthly source conflicts with a funded award",
        );
      // Another sender may have committed this leaf after this signer journaled its own leaf.
      // The cursor passes it only after the signer's mined nonce passes those bytes.
      const settled = await sendJournaledUntilMined(
        env,
        deployment,
        leafKey,
        plan.request.period,
      );
      if (settled && cursor === index) {
        cursor = index + 1;
        await env.JOURNAL.put(cursorKey, cursor);
      }
      continue;
    }
    const data = buildCommitMonthlyLeafCalldata(
      plan.request.period,
      entry,
      index,
      tree.proofs[index],
    );
    const previous = await env.JOURNAL.get<Attempt>(leafKey);
    if (previous)
      await retireRevertedAttempt(env, deployment, leafKey, previous);
    const result = await signAndSubmit(
      env,
      deployment,
      leafKey,
      digest(data),
      data,
      {
        ...target,
        idempotencyKey: digest(leafKey).slice(2),
        monthlyPeriod: plan.request.period,
      },
    );
    transactionId = result.transactionId;
    committedSources.push(entry.sourceDigest);
  }
  return {
    transactionId,
    alreadyCommitted: true,
    complete: false,
    committedSources,
  };
}

/** Read a funded award and its wallet-authorized binding without private Slop data. */
export async function preparePermissionlessEvmPayment(
  env: Pick<
    PublicEvmExecutorEnvironment,
    "PAYMENT_DEPLOYMENTS" | "PAYMENT_RPC_URLS" | "ALLOW_LOCAL_TEST_CHAIN"
  >,
  input: { network: string; vault: string; obligationId: string },
) {
  if (!BYTES32.test(input.obligationId)) throw new Error("Invalid award ID");
  return readPermissionlessEvmPayment(
    await preflightEvmDeployment(env, input),
    input,
  );
}

async function readPermissionlessEvmPayment(
  deployment: Deployment,
  input: { obligationId: string },
) {
  const state = await call(
    deployment,
    `0xe76af61d${input.obligationId.slice(2)}`,
    6,
  );
  const actor = BigInt(`0x${state[0]}`).toString();
  const gross = BigInt(`0x${state[1]}`),
    fee = BigInt(`0x${state[2]}`);
  if (
    actor === "0" ||
    gross === 0n ||
    !acceptsPayoutFee(gross, fee, deployment.payoutPolicy) ||
    !same(
      evmAwardId(BigInt(deployment.chainId), deployment.vault, `0x${state[3]}`),
      input.obligationId,
    )
  )
    throw new Error("Finalized funded award is invalid");
  if (BigInt(`0x${state[5]}`) !== 0n)
    return { deployment, state: "paid" as const };
  const current = await binding(deployment, actor);
  if (current.version === "0")
    return { deployment, state: "awaiting-wallet" as const };
  await assertPayable(deployment, current, BigInt(`0x${state[4]}`));
  return {
    deployment,
    state: "ready" as const,
    data: buildPayCalldata(input.obligationId, current.version),
    destination: current.destination,
    version: current.version,
  };
}

/** This gas key has no vault authority. The contract selects the co-signed destination. */
export async function submitPermissionlessEvmPayment(
  env: PublicEvmExecutorEnvironment,
  input: { network: string; vault: string; obligationId: string },
) {
  if (!BYTES32.test(input.obligationId)) throw new Error("Invalid award ID");
  const deployment = await preflightEvmDeployment(env, input);
  const roles = await Promise.all(
    ["0x13fa3c08", "0x8da5cb5b"].map((data) => call(deployment, data, 1)),
  );
  if (
    [
      deployment.feeRecipient,
      deployment.registrar,
      ...roles.map((value) => `0x${value[0].slice(24)}`),
    ].some((role) => same(role, env.SIGNER.address))
  )
    throw new Error("Keeper key must have no vault role");
  const fingerprint = digest(
    JSON.stringify([
      deployment.chainId,
      input.vault.toLowerCase(),
      input.obligationId.toLowerCase(),
    ]),
  );
  const key = `keeper:pay:${fingerprint}`;
  // Journaled bytes hold this signer's nonce even after the award stops being
  // payable (the owner cancelled its binding), so send them before that check.
  const previous = await env.JOURNAL.get<Attempt>(key);
  if (
    previous &&
    !(await retireRevertedAttempt(env, deployment, key, previous))
  ) {
    return {
      state: "submitted" as const,
      ...(await signAndSubmit(env, deployment, key, fingerprint, "", {
        ...input,
        idempotencyKey: fingerprint.slice(2),
      })),
    };
  }
  const plan = await readPermissionlessEvmPayment(deployment, input);
  if (plan.state !== "ready") return { state: plan.state };
  return {
    state: "submitted" as const,
    ...(await signAndSubmit(env, deployment, key, fingerprint, plan.data, {
      ...input,
      idempotencyKey: fingerprint.slice(2),
    })),
  };
}

/** The vault's identity authority, read at the finalized block, must be this signer. */
async function assertIdentitySigner(
  env: ExecutorEnvironment,
  config: Deployment,
) {
  const authority = await call(config, "0x13fa3c08", 1);
  if (!same(`0x${authority[0].slice(24)}`, env.SIGNER.address))
    throw new Error("Wrong identity signer");
}

/** A first binding needs the wallet authorization; a later one is a rotation of the bound claim. */
async function authorizeBindingVersion(
  env: ExecutorEnvironment,
  input: BindingRequest,
  current: { version: string; claimDigest: string },
  attempt: AttemptMode,
) {
  if (current.version !== "0")
    await authorizeWalletRotation(env, input, current.claimDigest, attempt);
  else await requireWalletAuthorization(env, input);
}

/**
 * The bindDestination calldata with the destination wallet's own EIP-712
 * signature over this exact binding, collected by the account API and
 * verified again here. The attester submits the signature unchanged and
 * cannot bind without it. Null when no stored signature for this on-chain
 * version is valid for at least ten more minutes, so a binding is never sent
 * at its expiry second (Solana rejects that second; EVM would accept it).
 */
async function storedBindingCalldata(
  env: ExecutorEnvironment,
  config: Deployment,
  input: DispatchPayment,
  expectedVersion: string,
  exactConsent?: { expiresAt: string; signature: string },
) {
  // As the Solana program does, never bind the identity authority (or this
  // attester's own key) as a payout destination. The EVM vault would accept it.
  if (
    same(input.destination, config.identityAuthority) ||
    same(input.destination, env.SIGNER.address)
  )
    throw new Error("The identity authority cannot be a payout destination");
  const accepted = await env.PAYMENTS_DB.prepare(
    `SELECT expires_at expiresAt,signature FROM payment_binding_authorizations WHERE claim_id=? AND github_user_id=? AND network=? AND vault=? AND chain_id=? AND expected_version=? AND CAST(expires_at AS INTEGER)>?${exactConsent ? " AND expires_at=? AND lower(signature)=?" : ""} ORDER BY CAST(expires_at AS INTEGER) DESC LIMIT 1`,
  )
    .bind(
      input.claimId,
      input.githubUserId,
      input.network,
      input.vault.toLowerCase(),
      config.chainId,
      expectedVersion,
      Math.floor(Date.now() / 1000) + 600,
      ...(exactConsent ? [exactConsent.expiresAt, exactConsent.signature] : []),
    )
    .first<{ expiresAt: string; signature: string }>();
  if (!accepted) return null;
  const request = {
    githubUserId: input.githubUserId,
    destination: input.destination,
    expectedVersion,
    claimDigest: `0x${input.claimDigest}`,
    expiresAt: accepted.expiresAt,
  };
  if (
    !verifyEvmBindingSignature(
      BigInt(config.chainId),
      config.vault,
      request,
      accepted.signature,
    )
  )
    throw new Error("Destination wallet signature rejected");
  return buildBindCalldata({ ...request, walletSignature: accepted.signature });
}

export function createEvmAttester(env: ExecutorEnvironment): PaymentExecutor {
  return {
    async submit(input) {
      const { authorization, deployment } = await authorize(env, input);
      await assertIdentitySigner(env, deployment);
      const key = `bind:${input.idempotencyKey}`;
      const fingerprint = digest(
        JSON.stringify([
          input.obligationId,
          input.network,
          input.vault,
          input.githubUserId,
          input.claimId,
          input.claimDigest,
          input.destination,
          input.idempotencyKey,
        ]),
      );
      const existing = await env.JOURNAL.get<Attempt | null>(key);
      if (
        existing &&
        !(await retireRevertedAttempt(env, deployment, key, existing))
      )
        return signAndSubmit(env, deployment, key, fingerprint, "", input);
      if ((await obligation(deployment, authorization)).paid)
        throw new Error("Award already paid");
      const current = await binding(deployment, input.githubUserId);
      await authorizeBindingVersion(env, input, current, "required");
      const data = await storedBindingCalldata(
        env,
        deployment,
        input,
        current.version,
      );
      if (!data)
        throw new Error(
          `Destination wallet signature required for binding version ${current.version}`,
        );
      return signAndSubmit(env, deployment, key, fingerprint, data, input);
    },
  };
}

/** One contributor's stored binding consent on one pinned vault, read from D1. */
export type BindingCandidate = DispatchPayment;
export type BindingOutcome =
  | { state: "current" }
  | { state: "waiting" }
  | { state: "submitted"; transactionId: string };

/**
 * The reserved awards on the pinned vaults whose contributor has a current
 * signed wallet authorization and a stored destination binding consent
 * that the attester can still submit. One row per contributor and vault,
 * because a binding belongs to the actor, not to one award. D1 reads only:
 * no RPC and no secret.
 */
export async function bindingCandidates(
  env: Pick<ExecutorEnvironment, "PAYMENTS_DB" | "PAYMENT_DEPLOYMENTS">,
  now = new Date(),
  limit = 500,
): Promise<BindingCandidate[]> {
  const pinned = JSON.parse(env.PAYMENT_DEPLOYMENTS) as {
    network: string;
    vault: string;
  }[];
  const candidates: BindingCandidate[] = [];
  for (const deployment of pinned) {
    const row = await env.PAYMENTS_DB.prepare(
      "SELECT json_group_array(json_object('obligationId',obligationId,'network',network,'vault',vault,'githubUserId',githubUserId,'claimId',claimId,'claimDigest',claimDigest,'destination',destination)) items FROM (SELECT MIN(o.id) obligationId,o.network network,o.vault vault,o.github_user_id githubUserId,w.id claimId,w.record_sha256 claimDigest,w.wallet_address destination FROM payment_obligations o JOIN effective_payment_wallet_claims w ON w.github_user_id=o.github_user_id AND w.chain=o.chain JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=o.github_user_id WHERE o.state='reserved' AND o.network=? AND lower(o.vault)=? AND w.source='d1_registry' AND EXISTS(SELECT 1 FROM payment_binding_authorizations b WHERE b.claim_id=w.id AND b.github_user_id=o.github_user_id AND b.network=o.network AND b.vault=lower(o.vault) AND CAST(b.expires_at AS INTEGER)>?) GROUP BY o.github_user_id,w.id ORDER BY MIN(o.created_at) LIMIT ?)",
    )
      .bind(
        deployment.network,
        deployment.vault.toLowerCase(),
        Math.floor(now.getTime() / 1000) + 600,
        limit,
      )
      .first<{ items: string }>();
    candidates.push(...(JSON.parse(row?.items ?? "[]") as BindingCandidate[]));
  }
  return candidates;
}

/**
 * The production trigger for an EVM destination binding (PRD PAY-05). The
 * production attester's scheduled run calls it for each binding candidate,
 * because a mainnet has no Slop relayer to request a binding (PAY-04). It
 * keeps every check of the hosted attester: the pinned deployment, the
 * GitHub actor and claim digest of the current signed wallet authorization,
 * the finalized unpaid award, the identity signer, the successor lineage of
 * a rotation, and the destination wallet's exact stored consent with its
 * expiry and expected version. A binding that is already current needs
 * nothing. Without consent for the current on-chain version, the award
 * waits for the contributor.
 *
 * There is one journal entry for each vault, actor, claim and finalized
 * binding version. A binding signed for that version is reconciled first:
 * its receipt is read independently of current authorization. Missing receipts
 * permit the same bytes to be sent only while the exact claim and wallet consent
 * remain authorized. Held bytes survive until a finalized winning receipt. The vault's
 * expectedVersion check refuses a replayed or reordered binding.
 */
export async function bindStoredDestination(
  env: ExecutorEnvironment,
  candidate: BindingCandidate,
): Promise<BindingOutcome> {
  const input: BindingRequest = { ...candidate, idempotencyKey: null };
  const { authorization, deployment } = await authorize(env, input, "none");
  await assertIdentitySigner(env, deployment);
  const current = await binding(deployment, input.githubUserId);
  if (
    !current.cancelled &&
    current.version !== "0" &&
    same(current.destination, input.destination) &&
    current.claimDigest === input.claimDigest
  )
    return { state: "current" };
  const scopedData =
    deployment.bindingConsentNonceLimit === 1
      ? await storedBindingCalldata(env, deployment, input, current.version)
      : undefined;
  if (scopedData === null) return { state: "waiting" };
  const operation = scopedData
    ? bindingConsentIdentity(deployment, scopedData as Hex).fingerprint
    : digest(
        JSON.stringify([
          deployment.chainId,
          input.vault.toLowerCase(),
          input.githubUserId,
          input.claimId,
          input.claimDigest,
          input.destination.toLowerCase(),
          current.version,
        ]),
      );
  const key = `${STORED_BINDING}${operation.slice(2)}`;
  const journaled = { ...input, idempotencyKey: operation.slice(2) };
  const existing = await env.JOURNAL.get<Attempt | null>(key);
  if (env.BINDING_NONCE_LIMIT === 1 && existing === null)
    throw new Error("Retired test binding requires operator review");
  if (existing && (await env.JOURNAL.get(cancellationKey(existing)))) {
    const result = await reconcileStoredBinding(env, key);
    return result.transactionId
      ? { state: "submitted", transactionId: result.transactionId }
      : { state: "waiting" };
  }
  if (
    existing &&
    !(await retireRevertedAttempt(env, deployment, key, existing))
  )
    return {
      state: "submitted",
      ...(await signAndSubmit(
        env,
        deployment,
        key,
        operation,
        "",
        journaled,
        undefined,
        (attempt) =>
          authorizeStoredBindingBroadcast(env, deployment, key, attempt),
      )),
    };
  if ((await obligation(deployment, authorization)).paid)
    throw new Error("Award already paid");
  await authorizeBindingVersion(env, input, current, "none");
  const data =
    scopedData ??
    (await storedBindingCalldata(env, deployment, input, current.version));
  if (!data) return { state: "waiting" };
  // The signing transaction also adds the key to the pending list, so the
  // signed bytes are reconciled even after this contributor stops being a
  // candidate, and no overlapping run can remove the key before signing.
  return {
    state: "submitted",
    ...(await signAndSubmit(
      env,
      deployment,
      key,
      operation,
      data,
      journaled,
      PENDING_BINDINGS,
      (attempt) =>
        authorizeStoredBindingBroadcast(env, deployment, key, attempt),
    )),
  };
}

export const STORED_BINDING = "bind:stored:";
/** Journal keys of stored bindings signed but not yet finalized. */
export const PENDING_BINDINGS = "pending-stored-bindings";

export const storedBindingAbi = parseAbi([
  "function bindDestination(uint64 actorId,address destination,uint64 expectedVersion,bytes32 claimDigest,uint64 expiresAt,bytes walletSignature)",
]);

/** Rebuild the journaled intent from current D1 authority before its bytes leave the signer. */
async function storedBindingIntent(
  env: ExecutorEnvironment,
  deployment: Deployment,
  key: string,
  attempt: Attempt,
) {
  const transaction = parseTransaction(attempt.rawTransaction);
  if (
    !attempt.rawTransaction.startsWith("0x02") ||
    transactionHash(attempt.rawTransaction) !== attempt.transactionId ||
    transaction.chainId !== Number(deployment.chainId) ||
    !same(transaction.to ?? "", deployment.vault) ||
    (transaction.value ?? 0n) !== 0n ||
    !transaction.data ||
    !isEscrowChain(deployment.chain) ||
    !same(
      await recoverTransactionAddress({
        serializedTransaction: attempt.rawTransaction as `0x02${string}`,
      }),
      env.SIGNER.address,
    )
  )
    throw new Error(
      "Stored binding transaction differs from its reviewed signer or deployment",
    );
  const { args } = decodeFunctionData({
    abi: storedBindingAbi,
    data: transaction.data,
  });
  const [actor, destination, version, claimDigest, expiresAt, signature] = args;
  const candidate = await env.PAYMENTS_DB.prepare(
    "SELECT o.id obligationId,o.network,o.vault,o.github_user_id githubUserId,w.id claimId,w.record_sha256 claimDigest,w.wallet_address destination FROM payment_obligations o JOIN wallet_claims w ON w.github_user_id=o.github_user_id AND w.chain=o.chain WHERE o.id=? AND w.github_user_id=? AND w.record_sha256=? AND lower(w.wallet_address)=?",
  )
    .bind(
      attempt.obligationId,
      actor.toString(),
      claimDigest.slice(2),
      destination.toLowerCase(),
    )
    .first<BindingCandidate>();
  if (!candidate)
    throw new Error("Stored binding claim unavailable; signed attempt held");
  const input: BindingRequest = { ...candidate, idempotencyKey: null };
  const fingerprint = attempt.bindingConsentBudgetKey
    ? bindingConsentIdentity(deployment, transaction.data).fingerprint
    : digest(
        JSON.stringify([
          deployment.chainId,
          input.vault.toLowerCase(),
          input.githubUserId,
          input.claimId,
          input.claimDigest,
          input.destination.toLowerCase(),
          version.toString(),
        ]),
      );
  if (
    fingerprint !== attempt.fingerprint ||
    key !== `${STORED_BINDING}${fingerprint.slice(2)}` ||
    input.network !== attempt.network ||
    !same(input.vault, attempt.vault)
  )
    throw new Error("Stored binding differs from its recorded authorization");
  return { input, transaction, version, expiresAt, signature };
}

async function authorizeStoredBindingBroadcast(
  env: ExecutorEnvironment,
  deployment: Deployment,
  key: string,
  attempt: Attempt,
) {
  const { input, transaction, version, expiresAt, signature } =
    await storedBindingIntent(env, deployment, key, attempt);
  if (!isEscrowChain(deployment.chain))
    throw new Error("Unknown binding chain");
  const authorization = await authorizeRegistry(
    env,
    input,
    deployment.chain,
    "none",
  );
  await assertIdentitySigner(env, deployment);
  if ((await obligation(deployment, authorization)).paid)
    throw new Error("Award already paid; signed binding held");
  const current = await binding(deployment, input.githubUserId);
  if (current.version !== version.toString())
    throw new Error(
      "Stored binding version is no longer current; signed attempt held",
    );
  await authorizeBindingVersion(env, input, current, "none");
  const data = await storedBindingCalldata(
    env,
    deployment,
    input,
    current.version,
    { expiresAt: expiresAt.toString(), signature },
  );
  if (!data || !transaction.data || !same(data, transaction.data))
    throw new Error(
      "Stored binding consent unavailable or expired; signed attempt held",
    );
  // Chain reads can take time. Recheck the current claim after them, directly before send.
  await authorizeRegistry(env, input, deployment.chain, "none");
}

type BindingCancellation = {
  original: Attempt;
  reason:
    | { kind: "superseded"; claimId: string; successorClaimId: string }
    | { kind: "expired"; expiresAt: string; finalizedBlock: string };
  rawTransaction: Hex;
  transactionId: Hex;
};
const cancellationKey = (attempt: Attempt) =>
  `binding-cancel:${attempt.transactionId.toLowerCase()}`;

/** One immutable competitor for this binding's nonce; no payment or monthly operation. */
async function cancelObsoleteStoredBinding(
  env: ExecutorEnvironment,
  deployment: Deployment,
  key: string,
  attempt: Attempt,
): Promise<{ settled: boolean; transactionId?: string } | null> {
  const archiveKey = cancellationKey(attempt);
  let cancellation = await env.JOURNAL.get<BindingCancellation>(archiveKey);
  const observe = async () =>
    reconcileBindingWinner(
      env,
      {
        network: attempt.network,
        vault: attempt.vault,
        originalTransactionId: attempt.transactionId,
        winnerTransactionId:
          cancellation?.transactionId ?? attempt.transactionId,
      },
      true,
    );
  // Canonical receipts win over current D1 state, including after a lost send.
  if ((await observe()).state !== "pending") return { settled: true };
  await assertBindingConsentBudget(env.JOURNAL, deployment, attempt);
  await assertIdentitySigner(env, deployment);
  const {
    input,
    transaction: original,
    expiresAt,
  } = await storedBindingIntent(env, deployment, key, attempt);
  if (
    typeof original.nonce !== "number" ||
    !Number.isSafeInteger(original.nonce) ||
    original.maxFeePerGas === undefined ||
    original.maxPriorityFeePerGas === undefined
  )
    throw new Error("Stored binding fee or nonce unavailable");
  const nonce = original.nonce;
  if (!cancellation) {
    const successor = await env.PAYMENTS_DB.prepare(
      "SELECT w.id FROM effective_payment_wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=w.github_user_id WHERE w.id!=? AND w.github_user_id=? AND w.chain=?",
    )
      .bind(input.claimId, input.githubUserId, deployment.chain)
      .first<{ id: string }>();
    let reason: BindingCancellation["reason"];
    if (successor) {
      reason = {
        kind: "superseded",
        claimId: input.claimId,
        successorClaimId: successor.id,
      };
    } else {
      const finalized = (await rpc(deployment, "eth_getBlockByNumber", [
        "finalized",
        false,
      ])) as {
        number: string;
        timestamp: string;
      };
      if (BigInt(finalized.timestamp) <= expiresAt) return null;
      reason = {
        kind: "expired",
        expiresAt: expiresAt.toString(),
        finalizedBlock: finalized.number,
      };
    }
    if (21_000n > BigInt(deployment.gasCeiling))
      throw new Error("Cancellation exceeds narrow operation gas policy");
    const latest = (await rpc(deployment, "eth_getBlockByNumber", [
      "latest",
      false,
    ])) as { baseFeePerGas: string };
    // One 12.5% replacement increment, bounded by the existing 10 gwei limit.
    // A later underpriced attempt stays held; it never creates another competitor.
    const bump = (value: bigint) => (value * 9n + 7n) / 8n;
    const priority =
      bump(original.maxPriorityFeePerGas) > 1_000_000n
        ? bump(original.maxPriorityFeePerGas)
        : 1_000_000n;
    const quote = BigInt(latest.baseFeePerGas) * 2n + priority;
    const maxFee =
      quote > bump(original.maxFeePerGas) ? quote : bump(original.maxFeePerGas);
    if (maxFee > 10_000_000_000n || priority > maxFee)
      throw new Error("Cancellation exceeds signer gas fee policy");
    assertEvmNativeCost(
      deployment,
      { gas: 21_000n, maxFeePerGas: maxFee },
      attempt,
    );
    await assertBindingConsentCandidate(env.JOURNAL, deployment, attempt, {
      nonce,
      gas: 21_000n,
      maxFeePerGas: maxFee,
    });
    if (
      (await rpc(deployment, "eth_getCode", [env.SIGNER.address, "latest"])) !==
      "0x"
    )
      throw new Error("Cancellation requires a plain signer account");
    cancellation = await env.JOURNAL.transaction(async (store) => {
      await assertBindingConsentBudget(store, deployment, attempt);
      const retained = await store.get<BindingCancellation>(archiveKey);
      if (retained) return retained;
      if (
        JSON.stringify(await store.get(key)) !== JSON.stringify(attempt) ||
        !((await store.get<string[]>(PENDING_BINDINGS)) ?? []).includes(key) ||
        (await store.get(
          `binding-observed:${attempt.transactionId.toLowerCase()}`,
        ))
      )
        throw new Error("Binding changed before cancellation signing");
      await assertBindingConsentCandidate(store, deployment, attempt, {
        nonce,
        gas: 21_000n,
        maxFeePerGas: maxFee,
      });
      const rawTransaction = await env.SIGNER.signTransaction({
        type: "eip1559",
        chainId: Number(deployment.chainId),
        nonce,
        gas: 21_000n,
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: priority,
        to: env.SIGNER.address as Hex,
        value: 0n,
        data: "0x",
      });
      assertSignedNativeCost(deployment, rawTransaction, attempt);
      const next = {
        original: attempt,
        reason,
        rawTransaction,
        transactionId: transactionHash(rawTransaction),
      };
      await store.put(archiveKey, next);
      // Never replace original bytes or reset/increment the shared nonce high-water mark.
      return next;
    });
  }
  const signed = parseTransaction(cancellation.rawTransaction);
  assertSignedNativeCost(deployment, cancellation.rawTransaction, attempt);
  await assertBindingConsentCandidate(env.JOURNAL, deployment, attempt, signed);
  if (
    JSON.stringify(cancellation.original) !== JSON.stringify(attempt) ||
    !cancellation.rawTransaction.startsWith("0x02") ||
    transactionHash(cancellation.rawTransaction) !==
      cancellation.transactionId ||
    signed.chainId !== Number(deployment.chainId) ||
    signed.nonce !== original.nonce ||
    !same(signed.to ?? "", env.SIGNER.address) ||
    (signed.value ?? 0n) !== 0n ||
    (signed.data ?? "0x") !== "0x" ||
    signed.gas !== 21_000n ||
    (signed.accessList?.length ?? 0) !== 0 ||
    signed.maxFeePerGas === undefined ||
    signed.maxFeePerGas > 10_000_000_000n ||
    signed.maxPriorityFeePerGas === undefined ||
    signed.maxPriorityFeePerGas > signed.maxFeePerGas ||
    signed.gas > BigInt(deployment.gasCeiling) ||
    !same(
      await recoverTransactionAddress({
        serializedTransaction: cancellation.rawTransaction as `0x02${string}`,
      }),
      env.SIGNER.address,
    )
  )
    throw new Error(
      "Stored cancellation differs from its binding or gas policy",
    );
  // A binding included during preparation must reconcile before any competing send.
  if ((await observe()).state !== "pending") return { settled: true };
  if (
    (await rpc(deployment, "eth_getCode", [env.SIGNER.address, "latest"])) !==
    "0x"
  )
    throw new Error("Cancellation requires a plain signer account");
  const sent = await rpc(deployment, "eth_sendRawTransaction", [
    cancellation.rawTransaction,
  ]);
  if (sent !== cancellation.transactionId)
    throw new Error("Cancellation hash mismatch");
  return { settled: false, transactionId: cancellation.transactionId };
}

/**
 * Reconcile receipts even after the claim changes. A missing receipt is not
 * permission to resend obsolete consent. Only a proved obsolete binding may
 * use the narrowly authorized self-cancellation; uncertain evidence stays held.
 */
async function reconcileStoredBinding(
  env: ExecutorEnvironment,
  key: string,
): Promise<{ settled: boolean; transactionId?: string }> {
  const attempt = await env.JOURNAL.get<Attempt | null>(key);
  if (!attempt) return { settled: true };
  const deployment = await preflightEvmDeployment(env, attempt);
  if (await env.JOURNAL.get(cancellationKey(attempt))) {
    const result = await cancelObsoleteStoredBinding(
      env,
      deployment,
      key,
      attempt,
    );
    if (!result) throw new Error("Stored cancellation unavailable");
    return result;
  }
  const receipt = (await rpc(deployment, "eth_getTransactionReceipt", [
    attempt.transactionId,
  ])) as {
    status: string;
    transactionHash: string;
    blockHash: string;
    blockNumber: string;
  } | null;
  if (receipt) {
    if (
      receipt.transactionHash.toLowerCase() !==
      attempt.transactionId.toLowerCase()
    )
      throw new Error("Recorded binding receipt identity mismatch");
    if (receipt.status !== "0x1") {
      if (await retireRevertedAttempt(env, deployment, key, attempt))
        return { settled: true };
      throw new Error(
        "Recorded binding reverted; operator reconciliation required",
      );
    }
    const finalized = (await rpc(deployment, "eth_getBlockByNumber", [
      "finalized",
      false,
    ])) as { number: string };
    const block = (await rpc(deployment, "eth_getBlockByNumber", [
      receipt.blockNumber,
      false,
    ])) as { hash: string } | null;
    if (!block || block.hash !== receipt.blockHash)
      throw new Error("Recorded binding receipt is not canonical");
    return { settled: BigInt(receipt.blockNumber) <= BigInt(finalized.number) };
  }
  if (env.BINDING_NONCE_LIMIT === 1)
    await assertBindingNonceBudget(env.JOURNAL, attempt);
  await assertBindingConsentBudget(env.JOURNAL, deployment, attempt);
  const cancellation = await cancelObsoleteStoredBinding(
    env,
    deployment,
    key,
    attempt,
  );
  if (cancellation) return cancellation;
  return {
    settled: false,
    ...(await signAndSubmit(
      env,
      deployment,
      key,
      attempt.fingerprint,
      "",
      {
        network: attempt.network,
        vault: attempt.vault,
        obligationId: attempt.obligationId,
        idempotencyKey: key.slice(STORED_BINDING.length),
      },
      undefined,
      (current) =>
        authorizeStoredBindingBroadcast(env, deployment, key, current),
    )),
  };
}

/** One scheduled binding run of the production EVM attester. */
export interface BindingRunReport {
  candidates: number;
  current: number;
  waiting: number;
  failed: number;
  /** Binding or same-nonce cancellation transactions broadcast in this run. */
  submitted: string[];
}

/** Journal keys of signed stored bindings that are not finalized yet. */
export async function pendingStoredBindings(journal: JournalStore) {
  return (await journal.get<string[]>(PENDING_BINDINGS)) ?? [];
}

/**
 * The scheduled binding run, after the caller's preflight. It first
 * reconciles every pending signed binding, then checks at most `perRun`
 * candidates, the least recently checked first, so no contributor waits
 * behind others. One failure never stops the other contributors; it is
 * counted in `failed`.
 */
export async function runStoredBindings(
  env: ExecutorEnvironment,
  candidates: BindingCandidate[],
  now = new Date(),
  perRun = 10,
): Promise<BindingRunReport> {
  const submitted = new Set<string>();
  const report = {
    candidates: candidates.length,
    current: 0,
    waiting: 0,
    failed: 0,
  };
  for (const key of await pendingStoredBindings(env.JOURNAL)) {
    try {
      const observed = (await env.JOURNAL.get<Attempt | null>(key))
        ?.transactionId;
      const result = await reconcileStoredBinding(env, key);
      if (result.transactionId) submitted.add(result.transactionId);
      if (result.settled)
        await env.JOURNAL.transaction(async (store) => {
          // An overlapping run may have signed a replacement meanwhile; its
          // key stays pending.
          const now = await store.get<Attempt | null>(key);
          if (now && now.transactionId !== observed) return;
          const keys = (await store.get<string[]>(PENDING_BINDINGS)) ?? [];
          await store.put(
            PENDING_BINDINGS,
            keys.filter((item) => item !== key),
          );
        });
    } catch (error) {
      report.failed += 1;
      logBindingFailure("stored_binding_reconcile_failed", error);
    }
  }
  const checked = (candidate: BindingCandidate) =>
    `binding-checked:${candidate.network}:${candidate.vault.toLowerCase()}:${candidate.githubUserId}`;
  const order = await Promise.all(
    candidates.map(
      async (candidate) =>
        [
          (await env.JOURNAL.get<number>(checked(candidate))) ?? 0,
          candidate,
        ] as const,
    ),
  );
  order.sort((a, b) => a[0] - b[0]);
  for (const [, candidate] of order.slice(0, perRun)) {
    await env.JOURNAL.put(checked(candidate), now.getTime());
    try {
      const outcome = await bindStoredDestination(env, candidate);
      if (outcome.state === "submitted") submitted.add(outcome.transactionId);
      else report[outcome.state] += 1;
    } catch (error) {
      report.failed += 1;
      logBindingFailure("stored_binding_failed", error);
    }
  }
  return { ...report, submitted: [...submitted] };
}
/** Fixed fields only: an error message can contain a private RPC URL. */
function logBindingFailure(event: string, error: unknown) {
  console.error(
    JSON.stringify({
      event,
      kind: error instanceof Error ? error.name : "unknown",
    }),
  );
}

export function createEvmExecutor(env: ExecutorEnvironment): PaymentExecutor {
  return {
    async submit(input) {
      const { authorization, deployment } = await authorize(env, input);
      const authority = await call(deployment, "0x13fa3c08", 1);
      if (same(`0x${authority[0].slice(24)}`, env.SIGNER.address))
        throw new Error("Gas signer must differ from identity authority");
      const owner = await call(deployment, "0x8da5cb5b", 1);
      if (same(`0x${owner[0].slice(24)}`, env.SIGNER.address))
        throw new Error("Gas signer must differ from project owner");
      const key = `pay:${input.idempotencyKey}`;
      const fingerprint = digest(
        JSON.stringify([
          input.obligationId,
          input.network,
          input.vault,
          input.githubUserId,
          input.claimId,
          input.claimDigest,
          input.destination,
          input.idempotencyKey,
        ]),
      );
      if (await env.JOURNAL.get<Attempt>(key))
        return signAndSubmit(env, deployment, key, fingerprint, "", input);
      const award = await obligation(deployment, authorization);
      if (award.paid)
        throw new Error("Award already paid; index finalized evidence");
      const current = await binding(deployment, input.githubUserId);
      if (
        !same(current.destination, input.destination) ||
        current.claimDigest !== input.claimDigest ||
        current.version === "0"
      ) {
        if (!env.ATTESTER) throw new Error("Identity attester unavailable");
        await env.ATTESTER.submit(input);
        throw new Error(
          "Destination binding awaits finality; retry the same attempt",
        );
      }
      await assertPayable(deployment, current, award.committedAt);
      // Re-read registry authorization before signing. The contract resolves any subsequent rotation race.
      await authorize(env, input);
      return signAndSubmit(
        env,
        deployment,
        key,
        fingerprint,
        buildPayCalldata(input.obligationId, current.version),
        input,
      );
    },
  };
}

/** Read-only recovery survives wallet replacement; it cannot authorize or submit a transaction. */
export async function lookupAttempt(
  env: { PAYMENTS_DB: D1Database; JOURNAL: JournalStore },
  input: {
    idempotencyKey: string;
    obligationId: string;
    network: string;
    vault: string;
  },
) {
  const row = await env.PAYMENTS_DB.prepare(
    "SELECT o.chain FROM payment_attempts a JOIN payment_obligations o ON o.id=a.obligation_id WHERE a.id=? AND o.id=? AND o.network=? AND o.vault=?",
  )
    .bind(input.idempotencyKey, input.obligationId, input.network, input.vault)
    .first<{ chain: string }>();
  if (!row || !isEscrowChain(row.chain))
    throw new Error("Unknown payment attempt");
  const key =
    chainFamily(row.chain) === "evm"
      ? `pay:${input.idempotencyKey}`
      : `solana:relayer:${input.network}:${input.idempotencyKey}`;
  const attempt = await env.JOURNAL.get<Attempt>(key);
  if (!attempt) return { transactionId: null };
  if (
    attempt.obligationId !== input.obligationId ||
    attempt.network !== input.network ||
    attempt.vault !== input.vault
  )
    throw new Error("Attempt metadata mismatch");
  return { transactionId: attempt.transactionId };
}

/** Verify wallet authorization before its first on-chain binding. */
export async function requireWalletAuthorization(
  env: { PAYMENTS_DB: D1Database },
  input: Pick<DispatchPayment, "claimId" | "githubUserId">,
): Promise<void> {
  const claim = await env.PAYMENTS_DB.prepare(
    "SELECT w.id FROM wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=w.github_user_id WHERE w.id=? AND w.github_user_id=?",
  )
    .bind(input.claimId, input.githubUserId)
    .first();
  if (!claim) throw new Error("Wallet authorization missing");
}

/** Immediate user-authorized successor activation after prior attempts are reconciled. */
export async function authorizeWalletRotation(
  env: { PAYMENTS_DB: D1Database },
  input: BindingRequest,
  oldClaimDigest: string,
  attempt: AttemptMode = "required",
): Promise<void> {
  const current = await env.PAYMENTS_DB.prepare(
    "SELECT w.chain FROM wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=w.github_user_id WHERE w.id=? AND w.github_user_id=?",
  )
    .bind(input.claimId, input.githubUserId)
    .first<{
      chain: EscrowChain;
    }>();
  if (!current || !isEscrowChain(current.chain))
    throw new Error("Wallet rotation authorization missing");
  await authorizeRegistry(env, input, current.chain, attempt);
  const lineage =
    "WITH RECURSIVE lineage(id,supersedes_claim_id,record_sha256,depth) AS (SELECT id,supersedes_claim_id,record_sha256,0 FROM wallet_claims WHERE id=? AND github_user_id=? AND chain=? UNION ALL SELECT w.id,w.supersedes_claim_id,w.record_sha256,l.depth+1 FROM wallet_claims w JOIN lineage l ON l.supersedes_claim_id=w.id WHERE w.github_user_id=? AND w.chain=? AND l.depth<100) ";
  const args = [
    input.claimId,
    input.githubUserId,
    current.chain,
    input.githubUserId,
    current.chain,
  ];
  const predecessor = await env.PAYMENTS_DB.prepare(
    `${lineage} SELECT id FROM lineage WHERE record_sha256=? AND depth>0`,
  )
    .bind(...args, oldClaimDigest.replace(/^0x/, ""))
    .first<{ id: string }>();
  if (!predecessor)
    throw new Error(
      "Wallet rotation is not a successor of the on-chain binding",
    );
  // A finalized payout settles its award, so an attempt that did not record that
  // transaction cannot pay again; recovery and reconcile skip it too.
  const pending = await env.PAYMENTS_DB.prepare(
    `${lineage} SELECT a.id FROM payment_attempts a JOIN lineage l ON l.id=a.claim_id JOIN payment_obligations o ON o.id=a.obligation_id WHERE l.depth>0 AND a.state IN ('prepared','unknown','submitted') AND o.state='reserved' LIMIT 1`,
  )
    .bind(...args)
    .first();
  if (pending)
    throw new Error(
      "Wallet rotation held until earlier payment attempts are reconciled",
    );
}

/** Atomically retires an unsigned old-wallet attempt; a concurrently stored signature wins over retirement. */
export async function retireUnsignedAttempt(
  env: { PAYMENTS_DB: D1Database; JOURNAL: JournalStore },
  input: {
    idempotencyKey: string;
    obligationId: string;
    network: string;
    vault: string;
  },
) {
  const previous = await env.PAYMENTS_DB.prepare(
    "SELECT a.claim_id claimId,o.github_user_id actorId,o.chain FROM payment_attempts a JOIN payment_obligations o ON o.id=a.obligation_id WHERE a.id=? AND o.id=? AND o.network=? AND o.vault=?",
  )
    .bind(input.idempotencyKey, input.obligationId, input.network, input.vault)
    .first<{ claimId: string; actorId: string; chain: EscrowChain }>();
  if (!previous || !isEscrowChain(previous.chain))
    throw new Error("Unknown payment attempt");
  const successor = await env.PAYMENTS_DB.prepare(
    "SELECT w.id claimId,w.wallet_address address,w.record_sha256 claimDigest,c.id nonce,c.expires_at expiresAt,c.message,a.signature FROM effective_payment_wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=w.github_user_id JOIN payment_wallet_challenges c ON c.id=a.challenge_id AND c.claim_id=w.id AND c.github_user_id=w.github_user_id WHERE w.github_user_id=? AND w.chain=? AND c.consumed_at IS NOT NULL AND c.consumed_at<=c.expires_at",
  )
    .bind(previous.actorId, previous.chain)
    .first<{
      claimId: string;
      address: string;
      claimDigest: string;
      nonce: string;
      expiresAt: string;
      message: string;
      signature: string;
    }>();
  if (
    !successor ||
    successor.claimId === previous.claimId ||
    successor.message !==
      buildPaymentWalletMessage({
        ...successor,
        actorId: previous.actorId,
        chain: previous.chain,
      }) ||
    !verifyPaymentWalletSignature(
      previous.chain,
      successor.address,
      successor.message,
      successor.signature,
    )
  )
    throw new Error("Signed successor authorization required");
  const ancestor = await env.PAYMENTS_DB.prepare(
    "WITH RECURSIVE lineage(id,supersedes_claim_id,depth) AS (SELECT id,supersedes_claim_id,0 FROM wallet_claims WHERE id=? AND github_user_id=? AND chain=? UNION ALL SELECT w.id,w.supersedes_claim_id,l.depth+1 FROM wallet_claims w JOIN lineage l ON l.supersedes_claim_id=w.id WHERE w.github_user_id=? AND w.chain=? AND l.depth<100) SELECT id FROM lineage WHERE id=? AND depth>0",
  )
    .bind(
      successor.claimId,
      previous.actorId,
      previous.chain,
      previous.actorId,
      previous.chain,
      previous.claimId,
    )
    .first();
  if (!ancestor) throw new Error("Authorized wallet is not a successor");
  return env.JOURNAL.transaction(async (store) => {
    const key =
      chainFamily(previous.chain) === "evm"
        ? `pay:${input.idempotencyKey}`
        : `solana:relayer:${input.network}:${input.idempotencyKey}`;
    const existing = await store.get<Attempt>(key);
    if (existing) {
      if (
        existing.obligationId !== input.obligationId ||
        existing.network !== input.network ||
        existing.vault !== input.vault
      )
        throw new Error("Attempt metadata mismatch");
      return { retired: false, transactionId: existing.transactionId };
    }
    await store.put(`retired:${input.network}:${input.idempotencyKey}`, {
      obligationId: input.obligationId,
      claimId: previous.claimId,
      successorClaimId: successor.claimId,
    });
    return { retired: true, transactionId: null };
  });
}
