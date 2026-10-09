import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type {
  DispatchPayment,
  PaymentExecutor,
} from "../../backend/payments/dispatch";
import type { D1Database } from "../../backend/trace/cloudflare-persistence";
import {
  BINDING_SIZE,
  PROJECT_SIZE,
  type SolanaEscrowConfig,
  solanaAccount,
  solanaBase58,
  solanaDigest,
  solanaPubkey,
  solanaRpc,
  solanaUint,
  verifySolanaDeployment,
} from "../../contracts/solana/adapter";
import { decodeBase58Bytes } from "../../src/lib/squads-funding";
import {
  authorizeRegistry,
  authorizeWalletRotation,
  holdSuccessorClaim,
  type JournalStore,
} from "./core";

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
  ATTESTER?: PaymentExecutor;
  /** Local integration only; hosted wrapper never forwards these fields. */
  ALLOW_LOCAL_TEST_CHAIN?: boolean;
  LOCAL_SOLANA_GENESIS?: string;
}
type Input = DispatchPayment & { idempotencyKey: string };
type Preflight = Pick<
  SolanaExecutorEnvironment,
  | "PAYMENT_DEPLOYMENTS"
  | "PAYMENT_RPC_URLS"
  | "ALLOW_LOCAL_TEST_CHAIN"
  | "LOCAL_SOLANA_GENESIS"
>;
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  ASSOCIATED = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  SYSTEM = "11111111111111111111111111111111";
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const bytes = (value: string) => {
  const result = decodeBase58Bytes(value);
  if (result.length !== 32) throw new Error("Invalid public key");
  return result;
};
const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
};
function le(value: bigint) {
  if (value < 0n || value > (1n << 64n) - 1n) throw new Error("u64 overflow");
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, value, true);
  return b;
}
function pda(program: string, seeds: Uint8Array[]): string {
  for (let bump = 255; bump >= 0; bump--) {
    const hash = sha256(
      concat(
        ...seeds,
        Uint8Array.of(bump),
        bytes(program),
        encoder.encode("ProgramDerivedAddress"),
      ),
    );
    try {
      ed25519.Point.fromBytes(hash);
    } catch {
      return solanaBase58(hash);
    }
  }
  throw new Error("No program address");
}
const int64 = (value: Uint8Array, offset: number) =>
  new DataView(value.buffer, value.byteOffset, value.byteLength).getBigInt64(
    offset,
    true,
  );
const instructionData = (name: string, ...args: Uint8Array[]) =>
  concat(sha256(encoder.encode(`global:${name}`)).slice(0, 8), ...args);
interface Meta {
  key: string;
  write: boolean;
}
interface Instruction {
  program: string;
  accounts: Meta[];
  data: Uint8Array;
}
function short(value: number) {
  const output: number[] = [];
  do {
    let byte = value & 127;
    value >>>= 7;
    if (value) byte |= 128;
    output.push(byte);
  } while (value);
  return Uint8Array.from(output);
}
function message(
  payer: string,
  blockhash: string,
  instructions: Instruction[],
): Uint8Array {
  const accounts = new Map<string, boolean>([[payer, true]]);
  for (const i of instructions) {
    for (const a of i.accounts)
      accounts.set(a.key, Boolean(accounts.get(a.key) || a.write));
    if (!accounts.has(i.program)) accounts.set(i.program, false);
  }
  const keys = [
    payer,
    ...[...accounts].filter(([k, w]) => k !== payer && w).map(([k]) => k),
    ...[...accounts].filter(([k, w]) => k !== payer && !w).map(([k]) => k),
  ];
  if (keys.length > 32) throw new Error("Executor account limit");
  const readonly = keys.filter((k) => !accounts.get(k)).length;
  const compiled = instructions.map((i) =>
    concat(
      Uint8Array.of(keys.indexOf(i.program)),
      short(i.accounts.length),
      Uint8Array.from(i.accounts.map((a) => keys.indexOf(a.key))),
      short(i.data.length),
      i.data,
    ),
  );
  return concat(
    Uint8Array.of(1, 0, readonly),
    short(keys.length),
    ...keys.map(bytes),
    bytes(blockhash),
    short(compiled.length),
    ...compiled,
  );
}
function ata(mint: string, owner: string) {
  return pda(ASSOCIATED, [bytes(owner), bytes(TOKEN), bytes(mint)]);
}
function createAta(payer: string, mint: string, owner: string): Instruction {
  return {
    program: ASSOCIATED,
    accounts: [
      { key: payer, write: true },
      { key: ata(mint, owner), write: true },
      { key: owner, write: false },
      { key: mint, write: false },
      { key: SYSTEM, write: false },
      { key: TOKEN, write: false },
    ],
    data: Uint8Array.of(1),
  };
}

/** Rejects mainnet and wrong RPC genesis before the hosted wrapper reads a signer seed. */
export async function preflightSolanaDeployment(
  env: Preflight,
  input: DispatchPayment,
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
  const expected =
    input.network === "solana-devnet"
      ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
      : input.network === "solana-testnet"
        ? "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY"
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
async function read(
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
  const config = await preflightSolanaDeployment(env, input),
    authorization = await authorizeRegistry(env, input, "solana");
  if (config.projectId !== authorization.projectId)
    throw new Error("Wrong project authorization");
  const project = await read(
    config,
    config.projectPda,
    PROJECT_SIZE,
    "cda8bdcab5f78e13",
  );
  if (
    !project ||
    solanaPubkey(project, 168) !== config.mint ||
    hex(project.slice(72, 104)) !== hex(solanaDigest(config.networkDomain))
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
  const obligation = await read(config, awardAddress, 137, "a8ce8d6a584caca7");
  if (
    !obligation ||
    solanaPubkey(obligation, 48) !== config.projectPda ||
    solanaUint(obligation, 112).toString() !== input.githubUserId ||
    solanaUint(obligation, 8).toString() !== authorization.grossMicro ||
    solanaUint(obligation, 128).toString() !== authorization.feeMicro ||
    hex(obligation.slice(16, 48)) !== authorization.sourceDigest ||
    solanaUint(obligation, 128) !== solanaUint(obligation, 8) / 50n ||
    solanaUint(obligation, 120) + solanaUint(obligation, 128) !==
      solanaUint(obligation, 8)
  )
    throw new Error("Finalized award mismatch");
  const bindingAddress = pda(config.programId, [
    encoder.encode("wallet"),
    project.slice(104, 136),
    project.slice(72, 104),
    le(BigInt(input.githubUserId)),
  ]);
  const binding = await read(
    config,
    bindingAddress,
    BINDING_SIZE,
    "33d3ccb9a84434b0",
  );
  return { config, project, obligation, awardAddress, bindingAddress, binding };
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
}
async function send(
  env: SolanaExecutorEnvironment,
  ctx: Context,
  input: Input,
  role: string,
  instructions: Instruction[],
): Promise<{ transactionId: string }> {
  const key = `solana:${role}:${input.network}:${input.idempotencyKey}`,
    fingerprint = hex(
      sha256(
        encoder.encode(
          JSON.stringify([
            ctx.config.programId,
            ctx.config.projectPda,
            input.obligationId,
            input.network,
            input.vault,
            input.githubUserId,
            input.claimId,
            input.claimDigest,
            input.destination,
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
    const response = (await solanaRpc(ctx.config, "getSignatureStatuses", [
      [attempt.transactionId],
      { searchTransactionHistory: true },
    ])) as { value: ({ err: unknown; confirmationStatus: string } | null)[] };
    const status = response.value[0];
    if (status) {
      if (status.err)
        throw new Error("Existing transaction failed; reconcile before retry");
      return { transactionId: attempt.transactionId };
    }
    const height = await solanaRpc(ctx.config, "getBlockHeight", [
      { commitment: "finalized" },
    ]);
    if (typeof height !== "number" || !Number.isSafeInteger(height))
      throw new Error("Invalid finalized block height");
    if (height > attempt.lastValidBlockHeight) {
      // Re-read finalized obligation/binding only after finalized expiry. No resubmission
      // can race an old valid blockhash. Preserve prior signed attempt in the journal.
      const current = await authorized(env, input);
      if (role === "relayer" && current.obligation[136] !== 0)
        throw new Error(
          "Paid outside known attempt; finalized receipt reconciliation required",
        );
      if (
        role === "attester" &&
        current.binding &&
        solanaPubkey(current.binding, 112) === input.destination &&
        hex(current.binding.slice(8, 40)) === input.claimDigest
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
      const raw = concat(Uint8Array.of(1), signature, msg);
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
      };
      await store.put(key, candidate);
      return candidate;
    });
  }
  const result = await solanaRpc(ctx.config, "sendTransaction", [
    attempt.raw,
    {
      encoding: "base64",
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    },
  ]);
  if (result !== attempt.transactionId)
    throw new Error("Broadcast signature mismatch");
  return { transactionId: attempt.transactionId };
}
export function createSolanaAttester(
  env: SolanaExecutorEnvironment,
): PaymentExecutor {
  return {
    async submit(input) {
      const ctx = await authorized(env, input);
      if (solanaPubkey(ctx.project, 104) !== env.SOLANA_SIGNER.address)
        throw new Error("Signer is not identity authority");
      if (
        ctx.binding &&
        (solanaPubkey(ctx.binding, 112) !== input.destination ||
          hex(ctx.binding.slice(8, 40)) !== input.claimDigest)
      )
        await authorizeWalletRotation(
          env,
          input,
          hex(ctx.binding.slice(8, 40)),
        );
      if (!ctx.binding) await holdSuccessorClaim(env, input);
      const version = ctx.binding ? solanaUint(ctx.binding, 144) : 0n;
      const ix: Instruction = {
        program: ctx.config.programId,
        accounts: [
          { key: env.SOLANA_SIGNER.address, write: true },
          { key: env.SOLANA_SIGNER.address, write: false },
          { key: ctx.config.projectPda, write: false },
          { key: ctx.bindingAddress, write: true },
          { key: SYSTEM, write: false },
        ],
        data: instructionData(
          "bind_wallet",
          le(BigInt(input.githubUserId)),
          solanaDigest(ctx.config.networkDomain),
          le(version),
          bytes(input.destination),
          solanaDigest(input.claimDigest),
        ),
      };
      return send(env, ctx, input, "attester", [ix]);
    },
  };
}
export function createSolanaExecutor(
  env: SolanaExecutorEnvironment,
): PaymentExecutor {
  return {
    async submit(input) {
      const ctx = await authorized(env, input);
      if (
        !ctx.binding ||
        solanaPubkey(ctx.binding, 112) !== input.destination ||
        hex(ctx.binding.slice(8, 40)) !== input.claimDigest
      ) {
        if (!env.ATTESTER) throw new Error("Identity attester unavailable");
        await env.ATTESTER.submit(input);
        throw new Error("Destination binding awaiting finality");
      }
      const version = solanaUint(ctx.binding, 144);
      const activatesAt = int64(ctx.binding, 152) + int64(ctx.project, 249);
      if (BigInt(Math.floor(Date.now() / 1000)) < activatesAt)
        throw new Error(
          `Destination binding activates at ${new Date(Number(activatesAt) * 1000).toISOString()}; retry after activation`,
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
      const feeOwner = solanaPubkey(ctx.project, 136);
      const ix: Instruction = {
        program: ctx.config.programId,
        accounts: [
          { key: ctx.config.projectPda, write: true },
          { key: ctx.awardAddress, write: true },
          { key: ctx.bindingAddress, write: false },
          { key: ctx.config.mint, write: false },
          { key: ctx.config.vault, write: true },
          { key: ata(ctx.config.mint, input.destination), write: true },
          { key: ata(ctx.config.mint, feeOwner), write: true },
          { key: TOKEN, write: false },
          { key: veto, write: false },
        ],
        data: instructionData("pay", le(version)),
      };
      return send(env, ctx, input, "relayer", [
        createAta(
          env.SOLANA_SIGNER.address,
          ctx.config.mint,
          input.destination,
        ),
        createAta(env.SOLANA_SIGNER.address, ctx.config.mint, feeOwner),
        ix,
      ]);
    },
  };
}
