import { keccak_256 } from "@noble/hashes/sha3.js";
import type {
  DispatchPayment,
  PaymentExecutor,
} from "../../backend/payments/dispatch";
import {
  buildPaymentWalletMessage,
  verifyPaymentWalletSignature,
} from "../../backend/payments/possession";
import type { D1Database } from "../../backend/trace/cloudflare-persistence";
import {
  buildBindCalldata,
  buildPayCalldata,
  verifyBaseDeployment,
} from "../../contracts/evm/adapter";
import { finalizedBaseRevert } from "../payments/reconcile";

type Hex = `0x${string}`;
export interface Signer {
  address: string;
  signTransaction(input: {
    type: "eip1559";
    chainId: number;
    nonce: number;
    gas: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    to: Hex;
    data: Hex;
    value: bigint;
  }): Promise<Hex>;
}
export interface JournalStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  transaction<T>(callback: (store: JournalStore) => Promise<T>): Promise<T>;
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
}
type Input = DispatchPayment & { idempotencyKey: string };
interface Deployment {
  projectId: string;
  network: string;
  chain: string;
  vault: string;
  rpcUrl: string;
  chainId: string;
  asset: string;
  owner: string;
  identityAuthority: string;
  feeRecipient: string;
  codeSha256: string;
  bindingDelaySeconds: string;
}
export interface Authorization extends DispatchPayment {
  projectId: string;
  grossMicro: string;
  feeMicro: string;
  sourceDigest: string;
  message: string;
  signature: string;
  challengeId: string;
  expiresAt: string;
}
interface Attempt {
  obligationId: string;
  network: string;
  vault: string;
  fingerprint: string;
  rawTransaction: Hex;
  transactionId: Hex;
}
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
function hex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
function digest(text: string) {
  return hex(keccak_256(new TextEncoder().encode(text)));
}
function transactionHash(raw: Hex) {
  return hex(
    keccak_256(
      Uint8Array.from(raw.slice(2).match(/../g) ?? [], (b) =>
        Number.parseInt(b, 16),
      ),
    ),
  );
}
async function rpc(
  config: Deployment,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Chain RPC unavailable");
  const body = (await response.json()) as { result?: unknown; error?: unknown };
  if (body.error || !("result" in body))
    throw new Error("Chain RPC rejected operation");
  return body.result;
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
  input: Input,
  chain: "base" | "solana",
): Promise<Authorization> {
  const authorization = await env.PAYMENTS_DB.prepare(
    "SELECT o.id obligationId,o.project_id projectId,o.network,o.vault,o.github_user_id githubUserId,o.gross_micro grossMicro,o.fee_micro feeMicro,o.source_digest sourceDigest,w.id claimId,w.record_sha256 claimDigest,w.wallet_address destination,c.message,a.signature,c.id challengeId,c.expires_at expiresAt FROM payment_obligations o JOIN wallet_claims w ON w.github_user_id=o.github_user_id AND w.chain=o.chain JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=o.github_user_id JOIN payment_wallet_challenges c ON c.id=a.challenge_id AND c.claim_id=w.id AND c.github_user_id=o.github_user_id JOIN payment_attempts t ON t.obligation_id=o.id AND t.claim_id=w.id WHERE o.id=? AND t.id=? AND o.chain=? AND c.consumed_at IS NOT NULL AND c.consumed_at<=c.expires_at AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)",
  )
    .bind(input.obligationId, input.idempotencyKey, chain)
    .first<Authorization>();
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

/** Public chain identity check runs before the hosted worker reads its signer secret. */
export async function preflightBaseDeployment(
  env: Pick<
    ExecutorEnvironment,
    "PAYMENT_DEPLOYMENTS" | "PAYMENT_RPC_URLS" | "ALLOW_LOCAL_TEST_CHAIN"
  >,
  input: DispatchPayment,
): Promise<Deployment> {
  const configs = JSON.parse(env.PAYMENT_DEPLOYMENTS) as Deployment[];
  const selected = configs.filter(
    (d) => d.network === input.network && same(d.vault, input.vault),
  );
  if (
    selected.length !== 1 ||
    selected[0].chain !== "base" ||
    !(
      selected[0].chainId === "84532" ||
      (env.ALLOW_LOCAL_TEST_CHAIN && selected[0].chainId === "31337")
    )
  )
    throw new Error("Test deployment required");
  if (selected[0].chainId === "84532" && selected[0].network !== "base-sepolia")
    throw new Error("Base Sepolia network required");
  const rpcUrls = JSON.parse(env.PAYMENT_RPC_URLS) as Record<string, string>;
  const rpcUrl = rpcUrls[input.network];
  if (typeof rpcUrl !== "string")
    throw new Error("Private RPC configuration missing");
  const deployment = { ...selected[0], rpcUrl };
  if (
    BigInt((await rpc(deployment, "eth_chainId", [])) as string) !==
    BigInt(deployment.chainId)
  )
    throw new Error("Wrong RPC chain");
  await verifyBaseDeployment({
    ...deployment,
    chainId: BigInt(deployment.chainId),
  });
  return deployment;
}

async function authorize(
  env: ExecutorEnvironment,
  input: Input,
): Promise<{ authorization: Authorization; deployment: Deployment }> {
  if (
    !input ||
    Object.values(input).some((v) => typeof v !== "string") ||
    !BYTES32.test(input.obligationId) ||
    !ADDRESS.test(input.destination) ||
    !ADDRESS.test(input.vault) ||
    !/^[0-9a-f]{64}$/.test(input.claimDigest) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.idempotencyKey)
  )
    throw new Error("Invalid payout request");
  const authorization = await authorizeRegistry(env, input, "base");
  const deployment = await preflightBaseDeployment(env, input);
  if (deployment.projectId !== authorization.projectId)
    throw new Error("Reviewed project deployment mismatch");
  return { authorization, deployment };
}
async function obligation(config: Deployment, authorization: Authorization) {
  const state = await call(
    config,
    `0xe76af61d${authorization.obligationId.slice(2)}`,
    5,
  );
  if (
    BigInt(`0x${state[0]}`).toString() !== authorization.githubUserId ||
    BigInt(`0x${state[1]}`).toString() !== authorization.grossMicro ||
    BigInt(`0x${state[2]}`).toString() !== authorization.feeMicro ||
    state[3].toLowerCase() !== authorization.sourceDigest ||
    BigInt(authorization.feeMicro) !== BigInt(authorization.grossMicro) / 50n
  )
    throw new Error("Finalized award differs from approved ledger");
  return BigInt(`0x${state[4]}`) !== 0n;
}
const CANCELLED = (1n << 64n) - 1n;
async function binding(config: Deployment, actor: string) {
  const state = await call(config, `0xa45d1232${word(actor)}`, 4);
  return {
    destination: `0x${state[0].slice(24)}`,
    version: BigInt(`0x${state[1]}`).toString(),
    claimDigest: state[2],
    activatesAt: BigInt(`0x${state[3]}`),
  };
}
/** Pending and owner-cancelled bindings cannot pay; never sign a transaction that must revert. */
async function assertBindingActive(config: Deployment, activatesAt: bigint) {
  if (activatesAt === CANCELLED)
    throw new Error(
      "Project owner cancelled this destination binding; identity review required",
    );
  // The contract compares block time, not this worker's clock.
  const latest = (await rpc(config, "eth_getBlockByNumber", [
    "latest",
    false,
  ])) as { timestamp: string };
  if (BigInt(latest.timestamp) < activatesAt)
    throw new Error(
      `Destination binding activates at ${new Date(Number(activatesAt) * 1000).toISOString()}; retry after activation`,
    );
}
/** A reverted bind changed nothing on-chain, so a fresh bind may replace it. */
async function retireRevertedBind(
  env: ExecutorEnvironment,
  config: Deployment,
  key: string,
  attempt: Attempt,
): Promise<boolean> {
  const proof = await finalizedBaseRevert(
    config.rpcUrl,
    config.chainId,
    attempt.transactionId,
  );
  if (!proof) return false;
  return env.JOURNAL.transaction(async (store) => {
    const current = await store.get<Attempt | null>(key);
    if (!current || current.transactionId !== attempt.transactionId)
      return false;
    await store.put(`${key}:reverted:${attempt.transactionId}`, {
      ...current,
      revert: proof,
    });
    await store.put(key, null);
    return true;
  });
}

async function signAndSubmit(
  env: ExecutorEnvironment,
  config: Deployment,
  key: string,
  fingerprint: string,
  data: string,
  input: Input,
) {
  let attempt = await env.JOURNAL.get<Attempt>(key);
  if (attempt && attempt.fingerprint !== fingerprint)
    throw new Error("Idempotency key reused for another operation");
  if (!attempt) {
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
    if (gas > 500_000n) throw new Error("Gas exceeds narrow operation policy");
    const nonceKey = `nonce:${config.chainId}:${env.SIGNER.address.toLowerCase()}`;
    attempt = await env.JOURNAL.transaction(async (store) => {
      if (await store.get(`retired:${input.network}:${input.idempotencyKey}`))
        throw new Error("Attempt retired before signing");
      const existing = await store.get<Attempt>(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new Error("Idempotency collision");
        return existing;
      }
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
      const next = {
        obligationId: input.obligationId,
        network: input.network,
        vault: input.vault,
        fingerprint,
        rawTransaction,
        transactionId: transactionHash(rawTransaction),
      };
      await store.put(key, next);
      await store.put(nonceKey, nonce + 1);
      return next;
    });
  }
  // Stored signed bytes exist before either the first broadcast or a retry.
  const receipt = (await rpc(config, "eth_getTransactionReceipt", [
    attempt.transactionId,
  ])) as { status: string } | null;
  if (receipt) {
    if (receipt.status !== "0x1")
      throw new Error(
        "Recorded transaction reverted; operator reconciliation required",
      );
    return { transactionId: attempt.transactionId };
  }
  try {
    const sent = await rpc(config, "eth_sendRawTransaction", [
      attempt.rawTransaction,
    ]);
    if (sent !== attempt.transactionId)
      throw new Error("Transaction hash mismatch");
  } catch (error) {
    const known = await rpc(config, "eth_getTransactionByHash", [
      attempt.transactionId,
    ]);
    if (!known) throw error;
  }
  return { transactionId: attempt.transactionId };
}

export function createBaseAttester(env: ExecutorEnvironment): PaymentExecutor {
  return {
    async submit(input) {
      const { authorization, deployment } = await authorize(env, input);
      const authority = await call(deployment, "0x13fa3c08", 1);
      if (!same(`0x${authority[0].slice(24)}`, env.SIGNER.address))
        throw new Error("Wrong identity signer");
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
        !(await retireRevertedBind(env, deployment, key, existing))
      )
        return signAndSubmit(env, deployment, key, fingerprint, "", input);
      if (await obligation(deployment, authorization))
        throw new Error("Award already paid");
      const current = await binding(deployment, input.githubUserId);
      if (current.version !== "0")
        await authorizeWalletRotation(env, input, current.claimDigest);
      else await holdSuccessorClaim(env, input);
      return signAndSubmit(
        env,
        deployment,
        key,
        fingerprint,
        buildBindCalldata({
          githubUserId: input.githubUserId,
          destination: input.destination,
          expectedVersion: current.version,
          claimDigest: `0x${input.claimDigest}`,
          expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
        }),
        input,
      );
    },
  };
}

export function createBaseExecutor(env: ExecutorEnvironment): PaymentExecutor {
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
      if (await obligation(deployment, authorization))
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
      await assertBindingActive(deployment, current.activatesAt);
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
  if (!row || !["base", "solana"].includes(row.chain))
    throw new Error("Unknown payment attempt");
  const key =
    row.chain === "base"
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

const ROTATION_HOLD_MS = 24 * 60 * 60 * 1000;
function assertRotationHoldElapsed(createdAt: string, authorizedAt: string) {
  const activatedAt = Math.max(Date.parse(createdAt), Date.parse(authorizedAt));
  if (
    !Number.isFinite(activatedAt) ||
    Date.now() < activatedAt + ROTATION_HOLD_MS
  )
    throw new Error(
      "Wallet rotation held for 24 hours after registration and authorization",
    );
}

/** A successor wallet waits out the rotation hold even where no binding exists yet. */
export async function holdSuccessorClaim(
  env: { PAYMENTS_DB: D1Database },
  input: Input,
): Promise<void> {
  const claim = await env.PAYMENTS_DB.prepare(
    "SELECT w.supersedes_claim_id supersedes,w.created_at createdAt,a.authorized_at authorizedAt FROM wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=w.github_user_id WHERE w.id=? AND w.github_user_id=?",
  )
    .bind(input.claimId, input.githubUserId)
    .first<{
      supersedes: string | null;
      createdAt: string;
      authorizedAt: string;
    }>();
  if (!claim) throw new Error("Wallet authorization missing");
  if (claim.supersedes !== null)
    assertRotationHoldElapsed(claim.createdAt, claim.authorizedAt);
}

/** Delayed user-authorized successor activation; never an administrator override. */
export async function authorizeWalletRotation(
  env: { PAYMENTS_DB: D1Database },
  input: Input,
  oldClaimDigest: string,
): Promise<void> {
  const current = await env.PAYMENTS_DB.prepare(
    "SELECT w.chain,w.created_at createdAt,a.authorized_at authorizedAt FROM wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=w.github_user_id WHERE w.id=? AND w.github_user_id=?",
  )
    .bind(input.claimId, input.githubUserId)
    .first<{
      chain: "base" | "solana";
      createdAt: string;
      authorizedAt: string;
    }>();
  if (!current || !["base", "solana"].includes(current.chain))
    throw new Error("Wallet rotation authorization missing");
  await authorizeRegistry(env, input, current.chain);
  assertRotationHoldElapsed(current.createdAt, current.authorizedAt);
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
  const pending = await env.PAYMENTS_DB.prepare(
    `${lineage} SELECT a.id FROM payment_attempts a JOIN lineage l ON l.id=a.claim_id WHERE l.depth>0 AND a.state IN ('prepared','unknown','submitted') LIMIT 1`,
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
    .first<{ claimId: string; actorId: string; chain: "base" | "solana" }>();
  if (!previous) throw new Error("Unknown payment attempt");
  const successor = await env.PAYMENTS_DB.prepare(
    "SELECT w.id claimId,w.wallet_address address,w.record_sha256 claimDigest,c.id nonce,c.expires_at expiresAt,c.message,a.signature FROM wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id AND a.github_user_id=w.github_user_id JOIN payment_wallet_challenges c ON c.id=a.challenge_id AND c.claim_id=w.id AND c.github_user_id=w.github_user_id WHERE w.github_user_id=? AND w.chain=? AND c.consumed_at IS NOT NULL AND c.consumed_at<=c.expires_at AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)",
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
      previous.chain === "base"
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
