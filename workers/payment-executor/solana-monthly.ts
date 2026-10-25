import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  OBLIGATION_DISCRIMINATOR,
  OBLIGATION_SIZE,
  PROJECT_SIZE,
  type SolanaEscrowConfig,
  solanaAccount,
  solanaAllocationProof,
  solanaAllocationRoot,
  solanaAllocationTotal,
  solanaAwardId,
  solanaBase58,
  solanaDigest,
  solanaMonthlyMessage,
  solanaPubkey,
  solanaRpc,
  solanaUint,
} from "../../contracts/solana/adapter";
import {
  bytes,
  concat,
  encoder,
  type Instruction,
  instructionData,
  le,
  message,
  pda,
  SYSTEM,
} from "../../contracts/solana/transactions";
import {
  acceptsPayoutFee,
  ordinaryFee,
} from "../../src/lib/payments/contracts";
import type { MonthlyAuthorization } from "./monthly";
import {
  broadcastSolanaTransaction,
  type PublicSolanaExecutorEnvironment,
  preflightSolanaDeployment,
  readSolanaAccount,
  solanaTransactionStatus,
} from "./solana";

const hex = (value: Uint8Array) =>
  Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");
const discriminator = (name: string) =>
  hex(sha256(encoder.encode(`account:${name}`)).slice(0, 8));
function u32(value: number) {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, true);
  return result;
}
interface Attempt {
  fingerprint: string;
  transactionId: string;
  raw: string;
  lastValidBlockHeight: number;
  generation: number;
}

/** Stores signed bytes before broadcast; replaces only proven failed or expired attempts. */
async function submit(
  env: PublicSolanaExecutorEnvironment,
  config: SolanaEscrowConfig,
  key: string,
  instructions: Instruction[],
) {
  const fingerprint = hex(
    sha256(
      encoder.encode(
        JSON.stringify([
          config.programId,
          config.projectPda,
          env.SOLANA_SIGNER.address,
          instructions,
        ]),
      ),
    ),
  );
  let attempt = await env.JOURNAL.get<Attempt>(key);
  let retired: Attempt | undefined;
  if (attempt) {
    if (attempt.fingerprint !== fingerprint)
      throw new Error("Monthly journal collision");
    const status = await solanaTransactionStatus({ config }, attempt);
    if (status && !status.failed)
      return { transactionId: attempt.transactionId, alreadyCommitted: false };
    if (status && !status.finalized)
      throw new Error("Monthly failure is not finalized");
    if (!status) {
      const height = await solanaRpc(config, "getBlockHeight", [
        { commitment: "finalized" },
      ]);
      if (typeof height !== "number" || !Number.isSafeInteger(height))
        throw new Error("Invalid finalized height");
      if (height <= attempt.lastValidBlockHeight) {
        return {
          ...(await broadcastSolanaTransaction({ config }, attempt)),
          alreadyCommitted: false,
        };
      }
    }
    retired = attempt;
  }
  const latest = (await solanaRpc(config, "getLatestBlockhash", [
    { commitment: "finalized" },
  ])) as {
    value: { blockhash: string; lastValidBlockHeight: number };
  };
  if (!Number.isSafeInteger(latest.value.lastValidBlockHeight))
    throw new Error("Invalid block height");
  const msg = message(
    env.SOLANA_SIGNER.address,
    latest.value.blockhash,
    instructions,
  );
  attempt = await env.JOURNAL.transaction(async (store) => {
    const existing = await store.get<Attempt>(key);
    if (
      existing?.fingerprint !== undefined &&
      existing.fingerprint !== fingerprint
    )
      throw new Error("Monthly journal collision");
    if (
      existing &&
      (!retired || existing.transactionId !== retired.transactionId)
    )
      return existing;
    if (retired && !existing) throw new Error("Monthly attempt disappeared");
    if (existing)
      await store.put(`${key}:retired:${existing.generation}`, existing);
    const signature = await env.SOLANA_SIGNER.signMessage(msg);
    if (
      signature.length !== 64 ||
      !ed25519.verify(signature, msg, bytes(env.SOLANA_SIGNER.address), {
        zip215: false,
      })
    )
      throw new Error("Invalid signer response");
    const raw = concat(Uint8Array.of(1), signature, msg);
    if (raw.length > 1232) throw new Error("Monthly transaction too large");
    const candidate: Attempt = {
      fingerprint,
      transactionId: solanaBase58(signature),
      raw: btoa(String.fromCharCode(...raw)),
      lastValidBlockHeight: latest.value.lastValidBlockHeight,
      generation: (existing?.generation ?? 0) + 1,
    };
    await store.put(key, candidate);
    return candidate;
  });
  return {
    ...(await broadcastSolanaTransaction({ config }, attempt)),
    alreadyCommitted: false,
  };
}

/** Advances one finalized monthly reservation by one bounded transaction. Never pays an award. */
const MONTH_SIZE = 109;
const int64 = (value: Uint8Array, offset: number) =>
  new DataView(value.buffer, value.byteOffset, value.byteLength).getBigInt64(
    offset,
    true,
  );
const sourcePdas = (config: SolanaEscrowConfig, sourceDigest: string) => {
  const source = solanaDigest(sourceDigest);
  return {
    source,
    origin: pda(config.programId, [
      encoder.encode("origin"),
      bytes(config.projectPda),
      source,
    ]),
    monthlySource: pda(config.programId, [
      encoder.encode("monthly-source"),
      bytes(config.projectPda),
      source,
    ]),
  };
};
/** The program's own test: anyone can send lamports to a PDA address, which
 * leaves a system-owned empty account that the program treats as absent. */
const initialized = (config: SolanaEscrowConfig, value: unknown) => {
  if (value === null || typeof value !== "object") return false;
  const info = value as { owner?: unknown; data?: unknown };
  return (
    info.owner === config.programId &&
    Array.isArray(info.data) &&
    typeof info.data[0] === "string" &&
    info.data[0].length > 0
  );
};
/** Whether a recorded obligation already pays this monthly award's actor at least
 * its gross. release_monthly_award releases such a leaf at any time. */
const paysActor = (
  recorded: Uint8Array,
  entry: { githubUserId: string; grossMicro: string },
) =>
  solanaUint(recorded, 112) === BigInt(entry.githubUserId) &&
  solanaUint(recorded, 8) >= BigInt(entry.grossMicro) &&
  solanaUint(recorded, 120) >=
    BigInt(entry.grossMicro) - ordinaryFee(BigInt(entry.grossMicro));
/** Reads accounts at one finalized slot per batch of 100; returns the lowest slot seen. */
async function readFinalized(config: SolanaEscrowConfig, addresses: string[]) {
  const values: unknown[] = [];
  let slot = Number.POSITIVE_INFINITY;
  for (let index = 0; index < addresses.length; index += 100) {
    const batch = addresses.slice(index, index + 100);
    const response = (await solanaRpc(config, "getMultipleAccounts", [
      batch,
      { commitment: "finalized", encoding: "base64" },
    ])) as { context?: { slot?: unknown }; value: unknown[] };
    if (
      !Array.isArray(response.value) ||
      response.value.length !== batch.length ||
      typeof response.context?.slot !== "number" ||
      !Number.isSafeInteger(response.context.slot)
    )
      throw new Error("Invalid finalized account response");
    slot = Math.min(slot, response.context.slot);
    values.push(...response.value);
  }
  return { values, slot };
}

/**
 * Attester rule for solanaMonthlyMessage v3: at one finalized slot no included
 * source has a `monthly-source` account, and any `origin` it has records an
 * identical award (same actor and gross, a genuine 2% fee; counted once, as on EVM);
 * frozen_at is that slot's block time. Origins are never closed, so every
 * batch's source was also absent at the lowest batch slot, whose block time is
 * returned. A later hand commit of a smaller award or one to another actor has
 * committed_at >= frozen_at, so release_monthly_award keeps its gross reserved.
 */
export async function freezeSolanaMonthly(
  config: SolanaEscrowConfig,
  plan: MonthlyAuthorization["plan"],
) {
  if (plan.family !== "solana") throw new Error("Wrong monthly family");
  const addresses = plan.entries.flatMap((entry) => {
    const { origin, monthlySource } = sourcePdas(config, entry.sourceDigest);
    return [origin, monthlySource];
  });
  const { values, slot } = await readFinalized(config, addresses);
  for (const [index, entry] of plan.entries.entries()) {
    const [originInfo, marker] = values.slice(index * 2, index * 2 + 2);
    if (initialized(config, marker))
      throw new Error("A monthly source was already consumed by a month");
    if (!initialized(config, originInfo)) continue;
    // An existing identical award is counted once, as on EVM; the program
    // releases this leaf.
    const recorded = await readSolanaAccount(
      config,
      solanaPubkey(
        solanaAccount(
          originInfo,
          config.programId,
          40,
          discriminator("Origin"),
        ),
        8,
      ),
      OBLIGATION_SIZE,
      OBLIGATION_DISCRIMINATOR,
    );
    // Sign only when the existing award is this exact award, as EVM's
    // commitMonthly counts it; a larger or different award is a conflict.
    if (
      !recorded ||
      solanaUint(recorded, 112) !== BigInt(entry.githubUserId) ||
      solanaUint(recorded, 8) !== BigInt(entry.grossMicro) ||
      !acceptsPayoutFee(solanaUint(recorded, 8), solanaUint(recorded, 128))
    )
      throw new Error("A monthly source was already consumed");
  }
  const time = await solanaRpc(config, "getBlockTime", [slot]);
  if (typeof time !== "number" || !Number.isSafeInteger(time) || time <= 0)
    throw new Error("Invalid finalized block time");
  return String(time);
}

/** Advances one finalized monthly reservation by up to `limit` bounded
 * transactions. Never pays an award. After admission it settles every
 * remaining leaf, so the owner's direct commits stay blocked only briefly. */
export async function submitSolanaMonthly(
  env: PublicSolanaExecutorEnvironment,
  authorization: MonthlyAuthorization,
  allowAdmission = true,
  limit = 1,
) {
  const { plan, signatureHex } = authorization;
  if (plan.family !== "solana") throw new Error("Wrong monthly family");
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Invalid monthly transaction limit");
  const frozenAt = plan.frozenAt ?? "";
  if (!/^[1-9][0-9]{0,15}$/.test(frozenAt))
    throw new Error("Monthly freeze time missing");
  const config = await preflightSolanaDeployment(env, {
    network: plan.request.network,
    vault: plan.deployment.vault,
  });
  if (
    config.projectId !== plan.request.projectId ||
    config.mint !== plan.deployment.asset
  )
    throw new Error("Wrong monthly deployment");
  const root = solanaAllocationRoot(plan.entries);
  const total = solanaAllocationTotal(plan.entries);
  const signed = solanaMonthlyMessage(
    config.programId,
    config.projectPda,
    plan.request.period,
    root,
    total,
    frozenAt,
    config.networkDomain,
  );
  if (
    root !== plan.allocationRoot ||
    total !== plan.totalGrossBase ||
    hex(signed) !== plan.messageHex
  )
    throw new Error("Monthly allocation mismatch");
  const period = u32(Number(plan.request.period.replace("-", "")));
  const month = pda(config.programId, [
    encoder.encode("month"),
    bytes(config.projectPda),
    period,
  ]);
  const record = await readSolanaAccount(
    config,
    month,
    MONTH_SIZE,
    discriminator("MonthlyAllocation"),
  );
  const payer = { key: env.SOLANA_SIGNER.address, write: true };
  const project = { key: config.projectPda, write: true };
  const system = { key: SYSTEM, write: false };
  const monthMeta = { key: month, write: true };
  const vault = { key: config.vault, write: false };
  const journal = `solana:monthly:${config.network}:${month}`;
  if (!record) {
    if (!allowAdmission)
      return {
        transactionId: null,
        alreadyCommitted: false,
        notAdmitted: true,
      };
    const state = await readSolanaAccount(
      config,
      config.projectPda,
      PROJECT_SIZE,
      discriminator("Project"),
    );
    if (!state) throw new Error("Project missing");
    const authority = solanaPubkey(state, 104);
    if (authority === env.SOLANA_SIGNER.address)
      throw new Error("Monthly gas signer must be separate from attester");
    if (!/^[0-9a-f]{128}$/.test(signatureHex))
      throw new Error("Invalid monthly signature");
    const signature = Uint8Array.from(signatureHex.match(/../g) ?? [], (s) =>
      Number.parseInt(s, 16),
    );
    if (!ed25519.verify(signature, signed, bytes(authority), { zip215: false }))
      throw new Error("Invalid monthly authority");
    // Ed25519 native instruction: key at 16, signature at 48, message at 112.
    const offsets = new Uint8Array(16);
    offsets[0] = 1;
    const view = new DataView(offsets.buffer);
    [48, 65535, 16, 65535, 112, signed.length, 65535].forEach((v, i) => {
      view.setUint16(2 + i * 2, v, true);
    });
    return submit(env, config, `${journal}:root`, [
      {
        program: "Ed25519SigVerify111111111111111111111111111",
        accounts: [],
        data: concat(offsets, bytes(authority), signature, signed),
      },
      {
        program: config.programId,
        accounts: [
          payer,
          project,
          vault,
          monthMeta,
          { key: "Sysvar1nstructions1111111111111111111111111", write: false },
          system,
        ],
        data: instructionData(
          "commit_monthly",
          period,
          solanaDigest(root),
          le(BigInt(total)),
          le(BigInt(frozenAt)),
        ),
      },
    ]);
  }
  if (
    solanaPubkey(record, 8) !== config.projectPda ||
    hex(record.slice(40, 44)) !== hex(period) ||
    hex(record.slice(44, 76)) !== root ||
    solanaUint(record, 84) !== BigInt(total) ||
    int64(record, 100) !== BigInt(frozenAt)
  )
    throw new Error("Conflicting monthly reservation");
  if (solanaUint(record, 76) === BigInt(total))
    return { transactionId: null, alreadyCommitted: true };
  // Admission authenticated the whole root. Later authority rotation, opt-out and
  // period changes must not invalidate its already-funded, permissionless leaves.
  const { values: markers } = await readFinalized(
    config,
    plan.entries.map((entry) =>
      pda(config.programId, [
        encoder.encode("settled"),
        bytes(month),
        solanaDigest(entry.sourceDigest),
      ]),
    ),
  );
  const transactionIds: string[] = [];
  let stranded = 0;
  for (let index = 0; index < plan.entries.length; index++) {
    if (transactionIds.length >= limit) break;
    if (
      initialized(config, markers[index]) &&
      solanaAccount(
        markers[index],
        config.programId,
        8,
        discriminator("BindingVeto"),
      )
    )
      continue;
    const entry = plan.entries[index];
    const { source, origin, monthlySource } = sourcePdas(
      config,
      entry.sourceDigest,
    );
    const settled = pda(config.programId, [
      encoder.encode("settled"),
      bytes(month),
      source,
    ]);
    const actor = BigInt(entry.githubUserId);
    const gross = BigInt(entry.grossMicro);
    // Mirror release_monthly_award: a zero actor, or a consumed source whose
    // obligation pays this actor at least this gross, or was committed strictly
    // before frozen_at. Any other consumed source stays reserved for good and is
    // never retried as a refund.
    let release = actor === 0n;
    let obligation = config.programId; // Anchor's placeholder for no account.
    if (!release) {
      const [originInfo] = (await readFinalized(config, [origin])).values;
      if (initialized(config, originInfo)) {
        const consumed = solanaAccount(
          originInfo,
          config.programId,
          40,
          discriminator("Origin"),
        );
        obligation = solanaPubkey(consumed, 8);
        const recorded = await readSolanaAccount(
          config,
          obligation,
          OBLIGATION_SIZE,
          OBLIGATION_DISCRIMINATOR,
        );
        if (!recorded) throw new Error("Origin obligation missing");
        if (
          !paysActor(recorded, entry) &&
          int64(recorded, 137) >= BigInt(frozenAt)
        ) {
          stranded++;
          continue;
        }
        release = true;
      }
    }
    const proof = solanaAllocationProof(plan.entries, index);
    const award = solanaDigest(
      solanaAwardId(config.projectPda, entry.sourceDigest),
    );
    const args = [
      source,
      le(actor),
      le(gross),
      u32(index),
      u32(plan.entries.length),
      u32(proof.length),
      ...proof.map((n) => concat(solanaDigest(n.hash), le(BigInt(n.total)))),
    ];
    const result = await submit(
      env,
      config,
      `${journal}:${index}:${release ? "release" : "commit"}`,
      [
        {
          program: config.programId,
          accounts: release
            ? [
                payer,
                project,
                monthMeta,
                { key: origin, write: false },
                { key: monthlySource, write: false },
                { key: obligation, write: false },
                { key: settled, write: true },
                system,
              ]
            : [
                payer,
                project,
                vault,
                monthMeta,
                { key: origin, write: true },
                {
                  key: pda(config.programId, [
                    encoder.encode("award"),
                    bytes(config.projectPda),
                    award,
                  ]),
                  write: true,
                },
                { key: settled, write: true },
                { key: monthlySource, write: true },
                system,
              ],
          data: release
            ? instructionData("release_monthly_award", period, ...args)
            : instructionData("commit_monthly_award", period, award, ...args),
        },
      ],
    );
    transactionIds.push(result.transactionId);
  }
  if (transactionIds.length)
    return {
      transactionId: transactionIds[transactionIds.length - 1],
      transactionIds,
      alreadyCommitted: false,
    };
  // Only sources the owner consumed by hand after the freeze with a smaller
  // award or one to another actor remain. They can never commit or release, so their gross stays
  // reserved and nothing is left.
  if (stranded)
    throw new Error(
      "Post-freeze source conflict remains reserved; reconciliation required",
    );
  throw new Error("Monthly reservation counters disagree with settled leaves");
}
