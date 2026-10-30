import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import type {
  DispatchPayment,
  PaymentExecutor,
} from "../../backend/payments/dispatch";
import {
  BINDING_SIZE,
  OBLIGATION_DISCRIMINATOR,
  OBLIGATION_SIZE,
  PROJECT_SIZE,
  SOLANA_NATIVE_ASSET,
  type SolanaEscrowConfig,
  solanaAccount,
  solanaAwardId,
  solanaBase58,
  solanaDigest,
  solanaMintDetails,
  solanaPubkey,
  solanaRpc,
  solanaUint,
  verifySolanaDeployment,
} from "../../contracts/solana/adapter";
import {
  ata,
  bytes,
  concat,
  createAta,
  encoder,
  type Instruction,
  instructionData,
  le,
  message,
  pda,
  SYSTEM,
} from "../../contracts/solana/transactions";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { acceptsPayoutFee } from "../../src/lib/payments/contracts";
import {
  authorizeRegistry,
  authorizeWalletRotation,
  type JournalStore,
  requireWalletAuthorization,
} from "./core";
import { mainnetExecutionEnabled } from "./mainnet-execution.mjs";

export interface SolanaSigner {
  address: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}
export interface SolanaExecutorEnvironment {
  PAYMENTS_DB: D1Database;
  PAYMENT_DEPLOYMENTS: string;
  PAYMENT_RPC_URLS: string;
  SOLANA_SIGNER: SolanaSigner;
  JOURNAL: JournalStore;
  /** Local integration only; hosted wrapper never forwards these fields. */
  ALLOW_LOCAL_TEST_CHAIN?: boolean;
  LOCAL_SOLANA_GENESIS?: string;
}
export type PublicSolanaExecutorEnvironment = Omit<
  SolanaExecutorEnvironment,
  "PAYMENTS_DB"
>;

type Input = DispatchPayment & { idempotencyKey: string };
type Preflight = Pick<
  SolanaExecutorEnvironment,
  | "PAYMENT_DEPLOYMENTS"
  | "PAYMENT_RPC_URLS"
  | "ALLOW_LOCAL_TEST_CHAIN"
  | "LOCAL_SOLANA_GENESIS"
>;
const int64 = (value: Uint8Array, offset: number) =>
  new DataView(value.buffer, value.byteOffset, value.byteLength).getBigInt64(
    offset,
    true,
  );

/** Rejects mainnet unless reviewed, and a wrong RPC genesis, before the hosted wrapper reads a signer seed. */
export async function preflightSolanaDeployment(
  env: Preflight,
  input: Pick<DispatchPayment, "network" | "vault">,
): Promise<SolanaEscrowConfig> {
  const rows = JSON.parse(env.PAYMENT_DEPLOYMENTS) as (SolanaEscrowConfig & {
    chain: string;
    asset?: string;
  })[];
  const matches = rows.filter(
    (d) =>
      d.network === input.network &&
      d.vault === input.vault &&
      d.chain === "solana",
  );
  if (matches.length !== 1) throw new Error("Ambiguous Solana deployment");
  // A registry test cluster, or the mainnet only when its reviewed
  // MAINNET_EXECUTION value is on; the genesis hash comes from the registry.
  const cluster = Object.hasOwn(ESCROW_NETWORKS, input.network)
    ? ESCROW_NETWORKS[input.network as keyof typeof ESCROW_NETWORKS]
    : undefined;
  const expected =
    cluster?.family === "solana" &&
    (cluster.testnet || mainnetExecutionEnabled(input.network))
      ? cluster.genesisHash
      : env.ALLOW_LOCAL_TEST_CHAIN && input.network === "solana-localnet"
        ? env.LOCAL_SOLANA_GENESIS
        : undefined;
  if (!expected)
    throw new Error("Only approved Solana test clusters are supported");
  const rpcUrl = (JSON.parse(env.PAYMENT_RPC_URLS) as Record<string, string>)[
    input.network
  ];
  if (typeof rpcUrl !== "string") throw new Error("Missing RPC");
  const config = {
    ...matches[0],
    mint: matches[0].asset ?? matches[0].mint,
    rpcUrl,
    genesisHash: expected,
  };
  for (const key of [
    config.programId,
    config.projectPda,
    config.vault,
    config.mint,
  ])
    bytes(key);
  solanaDigest(config.networkDomain);
  if ((await solanaRpc(config, "getGenesisHash", [])) !== expected)
    throw new Error("Wrong Solana RPC genesis");
  await verifySolanaDeployment(config);
  return config;
}
export async function readSolanaAccount(
  config: SolanaEscrowConfig,
  address: string,
  size: number,
  disc: string,
) {
  const response = (await solanaRpc(config, "getAccountInfo", [
    address,
    { commitment: "finalized", encoding: "base64" },
  ])) as { value: unknown };
  return response.value === null
    ? null
    : solanaAccount(response.value, config.programId, size, disc);
}
interface Context {
  config: SolanaEscrowConfig;
  tokenProgram: string;
  project: Uint8Array;
  obligation: Uint8Array;
  awardAddress: string;
  bindingAddress: string;
  binding: Uint8Array | null;
}
async function authorized(
  env: SolanaExecutorEnvironment,
  input: Input,
): Promise<Context> {
  if (
    !input ||
    Object.values(input).some((v) => typeof v !== "string") ||
    !/^(?:0x)?[0-9a-fA-F]{64}$/.test(input.obligationId) ||
    !/^[0-9a-f]{64}$/.test(input.claimDigest) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.idempotencyKey)
  )
    throw new Error("Invalid Solana request");
  bytes(input.destination);
  const authorization = await authorizeRegistry(env, input, "solana");
  const ctx = await readAward(env, input);
  if (
    ctx.config.projectId !== authorization.projectId ||
    solanaUint(ctx.obligation, 8).toString() !== authorization.grossBase ||
    solanaUint(ctx.obligation, 128).toString() !== authorization.feeBase ||
    bytesToHex(ctx.obligation.slice(16, 48)) !== authorization.sourceDigest
  )
    throw new Error("Finalized award differs from authorized ledger");
  return ctx;
}
async function readAward(
  env: Preflight,
  input: Pick<Input, "network" | "vault" | "obligationId" | "githubUserId">,
): Promise<Context> {
  const config = await preflightSolanaDeployment(env, input);
  const project = await readSolanaAccount(
    config,
    config.projectPda,
    PROJECT_SIZE,
    "cda8bdcab5f78e13",
  );
  if (
    !project ||
    solanaPubkey(project, 168) !== config.mint ||
    bytesToHex(project.slice(72, 104)) !==
      bytesToHex(solanaDigest(config.networkDomain))
  )
    throw new Error("Project domain mismatch");
  if (
    pda(config.programId, [
      encoder.encode("vault"),
      bytes(config.projectPda),
    ]) !== config.vault
  )
    throw new Error("Wrong vault PDA");
  const awardAddress = pda(config.programId, [
    encoder.encode("award"),
    bytes(config.projectPda),
    solanaDigest(input.obligationId),
  ]);
  const obligation = await readSolanaAccount(
    config,
    awardAddress,
    OBLIGATION_SIZE,
    OBLIGATION_DISCRIMINATOR,
  );
  if (
    !obligation ||
    solanaUint(obligation, 8) === 0n ||
    solanaAwardId(config.projectPda, bytesToHex(obligation.slice(16, 48))) !==
      input.obligationId.replace(/^0x/, "").toLowerCase() ||
    solanaPubkey(obligation, 48) !== config.projectPda ||
    solanaUint(obligation, 112).toString() !== input.githubUserId ||
    !acceptsPayoutFee(
      solanaUint(obligation, 8),
      solanaUint(obligation, 128),
      config.payoutPolicy,
    ) ||
    solanaUint(obligation, 120) + solanaUint(obligation, 128) !==
      solanaUint(obligation, 8)
  )
    throw new Error("Finalized award mismatch");
  // Bindings are per project: seeds are the project PDA and the actor. They do not
  // reference the identity authority, so they survive an authority rotation.
  const bindingAddress = pda(config.programId, [
    encoder.encode("wallet"),
    bytes(config.projectPda),
    le(BigInt(input.githubUserId)),
  ]);
  const binding = await readSolanaAccount(
    config,
    bindingAddress,
    BINDING_SIZE,
    "33d3ccb9a84434b0",
  );
  const { tokenProgram } = await solanaMintDetails(config, config.mint);
  return {
    config,
    tokenProgram,
    project,
    obligation,
    awardAddress,
    bindingAddress,
    binding,
  };
}
interface Attempt {
  obligationId: string;
  network: string;
  vault: string;
  fingerprint: string;
  raw: string;
  transactionId: string;
  lastValidBlockHeight: number;
  generation: number;
  /** Set while the destination wallet's signature is still missing from raw. */
  cosigner?: string;
}
export interface PreparedBinding {
  transactionId: string;
  /** Base64 transaction carrying the identity signature and an empty slot for the destination wallet. */
  transaction?: string;
}
async function send(
  env: PublicSolanaExecutorEnvironment,
  ctx: Context,
  input: Input,
  role: string,
  instructions: Instruction[],
  refresh: () => Promise<Context>,
  cosigner?: string,
): Promise<PreparedBinding> {
  const key = `solana:${role}:${input.network}:${input.idempotencyKey}`,
    fingerprint = bytesToHex(
      sha256(
        encoder.encode(
          JSON.stringify([
            ctx.config.programId,
            ctx.config.projectPda,
            input.obligationId,
            input.network,
            input.vault,
            input.githubUserId,
            ...(role === "keeper"
              ? []
              : [input.claimId, input.claimDigest, input.destination]),
            input.idempotencyKey,
          ]),
        ),
      ),
    );
  let attempt = await env.JOURNAL.get<Attempt>(key);
  let provenExpired: Attempt | undefined;
  if (attempt && attempt.fingerprint !== fingerprint)
    throw new Error("Idempotency collision");
  if (attempt) {
    const status = await solanaTransactionStatus(ctx, attempt);
    if (status && !status.failed)
      return { transactionId: attempt.transactionId };
    if (status?.failed && (role !== "keeper" || !status.finalized))
      throw new Error("Existing transaction failed; reconcile before retry");
    const height = await solanaRpc(ctx.config, "getBlockHeight", [
      { commitment: "finalized" },
    ]);
    if (typeof height !== "number" || !Number.isSafeInteger(height))
      throw new Error("Invalid finalized block height");
    if (
      height > attempt.lastValidBlockHeight ||
      (role === "keeper" && status?.failed && status.finalized)
    ) {
      // Re-read finalized obligation/binding only after finalized expiry. No resubmission
      // can race an old valid blockhash. Preserve prior signed attempt in the journal.
      const current = await refresh();
      if (
        (role === "relayer" || role === "keeper") &&
        current.obligation[136] !== 0
      )
        throw new Error(
          "Paid outside known attempt; finalized receipt reconciliation required",
        );
      if (
        role === "attester" &&
        current.binding &&
        solanaPubkey(current.binding, 112) === input.destination &&
        bytesToHex(current.binding.slice(8, 40)) === input.claimDigest
      )
        throw new Error(
          "Binding changed; finalized receipt reconciliation required",
        );
      provenExpired = attempt;
      attempt = undefined;
    }
  }
  if (!attempt) {
    if (ctx.obligation[136] !== 0) throw new Error("Award already paid");
    const latest = (await solanaRpc(ctx.config, "getLatestBlockhash", [
      { commitment: "finalized" },
    ])) as { value: { blockhash: string; lastValidBlockHeight: number } };
    if (!Number.isSafeInteger(latest.value.lastValidBlockHeight))
      throw new Error("Invalid block height");
    const msg = message(
      env.SOLANA_SIGNER.address,
      latest.value.blockhash,
      instructions,
      cosigner ? [cosigner] : [],
    );
    attempt = await env.JOURNAL.transaction(async (store) => {
      if (await store.get(`retired:${input.network}:${input.idempotencyKey}`))
        throw new Error("Attempt retired before signing");
      const existing = await store.get<Attempt>(key);
      if (existing && existing.fingerprint !== fingerprint)
        throw new Error("Journal collision");
      if (
        existing &&
        (!provenExpired ||
          existing.transactionId !== provenExpired.transactionId ||
          existing.generation !== provenExpired.generation)
      )
        return existing;
      if (provenExpired && !existing)
        throw new Error("Expired attempt disappeared from durable journal");
      if (existing)
        await store.put(`${key}:expired:${existing.generation}`, existing);
      const signature = await env.SOLANA_SIGNER.signMessage(msg);
      if (
        signature.length !== 64 ||
        !ed25519.verify(signature, msg, bytes(env.SOLANA_SIGNER.address), {
          zip215: false,
        })
      )
        throw new Error("Invalid signer response");
      // A co-signed binding leaves the second signature slot empty until the
      // destination wallet signs the same bytes.
      const raw = cosigner
        ? concat(Uint8Array.of(2), signature, new Uint8Array(64), msg)
        : concat(Uint8Array.of(1), signature, msg);
      if (raw.length > 1232) throw new Error("Transaction too large");
      const candidate: Attempt = {
        obligationId: input.obligationId,
        network: input.network,
        vault: input.vault,
        fingerprint,
        raw: btoa(String.fromCharCode(...raw)),
        transactionId: solanaBase58(signature),
        lastValidBlockHeight: latest.value.lastValidBlockHeight,
        generation: latest.value.lastValidBlockHeight,
        ...(cosigner ? { cosigner } : {}),
      };
      await store.put(key, candidate);
      return candidate;
    });
  }
  if (attempt.cosigner)
    return { transactionId: attempt.transactionId, transaction: attempt.raw };
  return broadcastSolanaTransaction(ctx, attempt);
}
/** An observed signature is submission evidence, never proof of payment finality. */
export async function solanaTransactionStatus(
  ctx: Pick<Context, "config">,
  attempt: Pick<Attempt, "transactionId">,
): Promise<{ failed: boolean; finalized: boolean } | null> {
  const response = (await solanaRpc(ctx.config, "getSignatureStatuses", [
    [attempt.transactionId],
    { searchTransactionHistory: true },
  ])) as { value?: unknown };
  if (
    !response ||
    !Array.isArray(response.value) ||
    response.value.length !== 1
  )
    throw new Error("Invalid signature status response");
  const status = response.value[0];
  if (status === null) return null;
  if (
    typeof status !== "object" ||
    Array.isArray(status) ||
    !Object.hasOwn(status, "err") ||
    !["processed", "confirmed", "finalized"].includes(status.confirmationStatus)
  )
    throw new Error("Invalid signature status response");
  return {
    failed: status.err !== null,
    finalized: status.confirmationStatus === "finalized",
  };
}
async function observedTransaction(
  ctx: Pick<Context, "config">,
  attempt: Pick<Attempt, "transactionId">,
): Promise<boolean> {
  const status = await solanaTransactionStatus(ctx, attempt);
  if (status?.failed)
    throw new Error("Existing transaction failed; reconcile before retry");
  return status !== null;
}
export async function broadcastSolanaTransaction(
  ctx: Pick<Context, "config">,
  attempt: Pick<Attempt, "transactionId" | "raw">,
): Promise<{ transactionId: string }> {
  if (await observedTransaction(ctx, attempt))
    return { transactionId: attempt.transactionId };
  let result: unknown;
  try {
    result = await solanaRpc(ctx.config, "sendTransaction", [
      attempt.raw,
      {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      },
    ]);
  } catch (error) {
    // The exact bytes may have landed between the status read and preflight,
    // or the response may have been lost. Reconcile without signing or resending.
    if (await observedTransaction(ctx, attempt))
      return { transactionId: attempt.transactionId };
    throw error;
  }
  if (result !== attempt.transactionId)
    throw new Error("Broadcast signature mismatch");
  return { transactionId: attempt.transactionId };
}
/** Verifies the authority and the destination signed the journaled binding bytes, then broadcasts. */
export async function completeSolanaBinding(
  env: SolanaExecutorEnvironment,
  input: Input,
  transaction: string,
): Promise<{ transactionId: string }> {
  const ctx = await authorized(env, input);
  const key = `solana:attester:${input.network}:${input.idempotencyKey}`;
  const attempt = await env.JOURNAL.get<Attempt>(key);
  if (!attempt || attempt.obligationId !== input.obligationId)
    throw new Error("No prepared binding for this attempt");
  if (!attempt.cosigner) return broadcastSolanaTransaction(ctx, attempt);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(transaction))
    throw new Error("Invalid signed transaction encoding");
  const signed = Uint8Array.from(atob(transaction), (c) => c.charCodeAt(0));
  const prepared = Uint8Array.from(atob(attempt.raw), (c) => c.charCodeAt(0));
  const msg = prepared.slice(129);
  if (
    signed.length !== prepared.length ||
    signed[0] !== 2 ||
    bytesToHex(signed.slice(1, 65)) !== bytesToHex(prepared.slice(1, 65)) ||
    bytesToHex(signed.slice(129)) !== bytesToHex(msg)
  )
    throw new Error("Signed transaction differs from the prepared binding");
  const walletSignature = signed.slice(65, 129);
  if (
    attempt.cosigner !== input.destination ||
    !ed25519.verify(walletSignature, msg, bytes(input.destination), {
      zip215: false,
    })
  )
    throw new Error("Destination wallet signature rejected");
  const completed = await env.JOURNAL.transaction(async (store) => {
    const current = await store.get<Attempt>(key);
    if (
      !current ||
      current.transactionId !== attempt.transactionId ||
      current.generation !== attempt.generation
    )
      throw new Error("Prepared binding changed; retry");
    if (!current.cosigner) return current;
    const next: Attempt = {
      ...current,
      raw: btoa(String.fromCharCode(...signed)),
    };
    delete next.cosigner;
    await store.put(key, next);
    return next;
  });
  return broadcastSolanaTransaction(ctx, completed);
}
/** Prepares and half-signs a binding; the destination wallet must co-sign the same bytes. */
export function createSolanaAttester(env: SolanaExecutorEnvironment): {
  submit(input: Input): Promise<PreparedBinding>;
} {
  return {
    async submit(input) {
      const ctx = await authorized(env, input);
      if (solanaPubkey(ctx.project, 104) !== env.SOLANA_SIGNER.address)
        throw new Error("Signer is not identity authority");
      if (input.destination === env.SOLANA_SIGNER.address)
        throw new Error("Destination cannot be the identity authority");
      if (
        ctx.binding &&
        (solanaPubkey(ctx.binding, 112) !== input.destination ||
          bytesToHex(ctx.binding.slice(8, 40)) !== input.claimDigest)
      )
        await authorizeWalletRotation(
          env,
          input,
          bytesToHex(ctx.binding.slice(8, 40)),
        );
      if (!ctx.binding) await requireWalletAuthorization(env, input);
      const version = ctx.binding ? solanaUint(ctx.binding, 144) : 0n;
      // Submission expiry only; the binding itself has no expiry (see contracts/solana/README.md).
      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const ix: Instruction = {
        program: ctx.config.programId,
        accounts: [
          { key: env.SOLANA_SIGNER.address, write: true },
          { key: env.SOLANA_SIGNER.address, write: false },
          { key: input.destination, write: false },
          { key: ctx.config.projectPda, write: false },
          { key: ctx.bindingAddress, write: true },
          { key: SYSTEM, write: false },
        ],
        data: instructionData(
          "bind_wallet",
          le(BigInt(input.githubUserId)),
          solanaDigest(ctx.config.networkDomain),
          le(version),
          solanaDigest(input.claimDigest),
          le(expiresAt),
        ),
      };
      return send(
        env,
        ctx,
        input,
        "attester",
        [ix],
        () => authorized(env, input),
        input.destination,
      );
    },
  };
}
/**
 * Unix time of the latest confirmed block. A payment executes in a later slot, whose
 * clock is not earlier, so this never runs ahead of the program's clock.
 */
async function confirmedChainTime(config: SolanaEscrowConfig): Promise<bigint> {
  const slot = await solanaRpc(config, "getSlot", [
    { commitment: "confirmed" },
  ]);
  if (typeof slot !== "number" || !Number.isSafeInteger(slot))
    throw new Error("Invalid confirmed slot");
  const time = await solanaRpc(config, "getBlockTime", [slot]);
  if (typeof time !== "number" || !Number.isSafeInteger(time))
    throw new Error("Confirmed block time unavailable");
  return BigInt(time);
}
export function createSolanaExecutor(
  env: SolanaExecutorEnvironment,
): PaymentExecutor {
  return {
    async submit(input) {
      const ctx = await authorized(env, input);
      return payBoundAward(env, ctx, input, () => authorized(env, input));
    },
  };
}

async function payBoundAward(
  env: PublicSolanaExecutorEnvironment,
  ctx: Context,
  input: Input,
  refresh: () => Promise<Context>,
  role = "relayer",
) {
  // A binding needs the destination wallet's own signature, so the relayer
  // cannot request one; the contributor completes it through the attester.
  if (
    !ctx.binding ||
    solanaPubkey(ctx.binding, 112) !== input.destination ||
    bytesToHex(ctx.binding.slice(8, 40)) !== input.claimDigest
  )
    throw new Error(
      "Destination binding awaits the contributor's co-signature; retry after it is finalized",
    );
  // The program pays only the latest binding, which is the claimed destination.
  // Delays are compared with the chain clock, not the host clock: the program uses
  // the chain clock, and an early transaction would fail and block retries.
  const version = solanaUint(ctx.binding, 144);
  const delay = int64(ctx.project, 249);
  const now = await confirmedChainTime(ctx.config);
  const payableAt = int64(ctx.obligation, 137) + delay;
  if (now < payableAt)
    throw new Error(
      `Award is inside its commit delay until ${new Date(Number(payableAt) * 1000).toISOString()}; retry after it ends`,
    );
  const veto = pda(ctx.config.programId, [
    encoder.encode("veto"),
    bytes(ctx.config.projectPda),
    le(BigInt(input.githubUserId)),
    le(version),
  ]);
  const vetoed = (await solanaRpc(ctx.config, "getAccountInfo", [
    veto,
    { commitment: "finalized", encoding: "base64" },
  ])) as { value: { owner: string } | null };
  if (vetoed.value && vetoed.value.owner !== SYSTEM)
    throw new Error(
      "Project owner vetoed this destination binding; identity review required",
    );
  if (env.SOLANA_SIGNER.address === solanaPubkey(ctx.project, 8))
    throw new Error("Gas payer must be separate from project owner");
  if (env.SOLANA_SIGNER.address === solanaPubkey(ctx.project, 104))
    throw new Error("Gas payer must be separate from identity authority");
  const native = ctx.config.mint === SOLANA_NATIVE_ASSET;
  const ix: Instruction = {
    program: ctx.config.programId,
    accounts: native
      ? [
          { key: ctx.config.projectPda, write: true },
          { key: ctx.awardAddress, write: true },
          { key: ctx.bindingAddress, write: true },
          { key: ctx.config.vault, write: true },
          { key: input.destination, write: true },
          { key: veto, write: false },
        ]
      : [
          { key: ctx.config.projectPda, write: true },
          { key: ctx.awardAddress, write: true },
          { key: ctx.bindingAddress, write: true },
          { key: ctx.config.mint, write: false },
          { key: ctx.config.vault, write: true },
          {
            key: ata(ctx.config.mint, input.destination, ctx.tokenProgram),
            write: true,
          },
          { key: ctx.tokenProgram, write: false },
          { key: veto, write: false },
        ],
    data: instructionData(native ? "pay_native" : "pay", le(version)),
  };
  return send(
    env,
    ctx,
    input,
    role,
    native
      ? [ix]
      : [
          createAta(
            env.SOLANA_SIGNER.address,
            ctx.config.mint,
            input.destination,
            ctx.tokenProgram,
          ),
          ix,
        ],
    refresh,
  );
}

/** The public contract binding, not a copied private wallet claim, supplies the destination. */
export async function preparePermissionlessSolanaPayment(
  env: Preflight,
  input: {
    network: string;
    vault: string;
    obligationId: string;
    githubUserId: string;
  },
) {
  const ctx = await readAward(env, input);
  if (ctx.obligation[136] !== 0) return { ctx, state: "paid" as const };
  if (!ctx.binding) return { ctx, state: "awaiting-wallet" as const };
  const bound: Input = {
    ...input,
    destination: solanaPubkey(ctx.binding, 112),
    claimDigest: bytesToHex(ctx.binding.slice(8, 40)),
    claimId: ctx.bindingAddress,
    idempotencyKey: bytesToHex(
      sha256(
        encoder.encode(
          JSON.stringify([input.network, input.vault, input.obligationId]),
        ),
      ),
    ),
  };
  return { ctx, input: bound, state: "ready" as const };
}

export async function submitPermissionlessSolanaPayment(
  env: PublicSolanaExecutorEnvironment,
  input: {
    network: string;
    vault: string;
    obligationId: string;
    githubUserId: string;
  },
) {
  const plan = await preparePermissionlessSolanaPayment(env, input);
  if (plan.state !== "ready") return { state: plan.state };
  const config = plan.ctx.config;
  if (
    [
      config.feeRecipient,
      config.rotationAuthority,
      config.upgradeAuthority,
    ].includes(env.SOLANA_SIGNER.address)
  )
    throw new Error("Keeper key must have no vault role");
  return {
    state: "submitted" as const,
    ...(await payBoundAward(
      env,
      plan.ctx,
      plan.input,
      () => readAward(env, input),
      "keeper",
    )),
  };
}
