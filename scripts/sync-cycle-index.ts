/**
 * Validates the complete Git-backed reward lifecycle, binds each proposal to a
 * frozen source snapshot, and publishes only reconciled cycle artifacts for
 * the static UI. Optional online mode re-verifies every paid Solana signature.
 */

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCycleIndex,
  CYCLE_INDEX_SCHEMA_VERSION,
  type CycleFileReference,
  type CycleIndex,
  type CycleIndexEntry,
} from "../src/lib/cycle-index";
import {
  assertLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "../src/lib/leaderboard";
import { findProject } from "../src/lib/projects.mjs";
import { createRewardCycleProposal } from "../src/lib/reward-cycle";
import { finalizeRewardAllocation } from "../src/lib/reward-finalization";
import {
  assertExternalContributionShareManifest,
  assertRewardAllocationManifest,
  assertRewardSettlementManifest,
  type RewardAllocationManifest,
  type RewardSettlementManifest,
} from "../src/lib/rewards";
import {
  assertSettlementExecutionPlan,
  type SettlementExecutionPlan,
} from "../src/lib/settlement-plan";
import { verifyRewardSettlementOnchain } from "../src/lib/solana-settlement";
import {
  DEFAULT_SOLANA_RPC_URL,
  fetchFinalizedSolanaTransaction,
} from "./solana-rpc";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CYCLES_ROOT = resolve(REPOSITORY_ROOT, "cycles");
export const PUBLIC_CYCLES_ROOT = resolve(
  REPOSITORY_ROOT,
  "public/data/cycles",
);
const ALLOWED_FILES = new Set([
  "allocation.json",
  "execution-plan.json",
  "proposal.json",
  "settlement.json",
  "source-snapshot.json",
  "transactions.json",
]);
const REQUIRED_FILES = ["proposal.json", "source-snapshot.json"] as const;
const MAX_CYCLES = 240;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

interface JsonFile {
  bytes: Buffer;
  digest: string;
  value: unknown;
}

interface CycleBuild {
  entry: CycleIndexEntry;
  files: Map<string, Buffer>;
  allocation: RewardAllocationManifest | null;
  plan: SettlementExecutionPlan | null;
  settlement: RewardSettlementManifest | null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function reference(
  projectId: string,
  cycleId: string,
  name: string,
  file: JsonFile,
): CycleFileReference {
  return {
    sha256: file.digest,
    url: `/data/cycles/${projectId}/${cycleId}/${name}`,
  };
}

async function jsonFile(
  path: string,
  maxBytes = MAX_JSON_BYTES,
): Promise<JsonFile> {
  const stats = await lstat(path);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size <= 0 ||
    stats.size > maxBytes
  ) {
    throw new TypeError(
      `${relative(REPOSITORY_ROOT, path)} is not a bounded regular file`,
    );
  }
  const bytes = await readFile(path);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new TypeError(
      `${relative(REPOSITORY_ROOT, path)} is not valid JSON`,
      {
        cause: error,
      },
    );
  }
  return {
    bytes,
    digest: createHash("sha256").update(bytes).digest("hex"),
    value,
  };
}

function verifyProposalAgainstSnapshot(
  proposal: RewardAllocationManifest,
  snapshot: LeaderboardSnapshot,
  snapshotDigest: string,
): void {
  const baseline = createRewardCycleProposal({
    cycleId: proposal.cycleId,
    generatedAt: proposal.generatedAt,
    projectId: proposal.projectId,
    snapshot,
    sourceSnapshotSha256: snapshotDigest,
  });
  if (baseline.kind !== "reward-allocation") {
    throw new TypeError("Monthly proposal regenerated as an external share");
  }
  const byIntent = new Map(
    baseline.allocations.map((allocation) => [allocation.intentId, allocation]),
  );
  if (proposal.allocations.length !== baseline.allocations.length) {
    throw new TypeError("Reward proposal adds or removes a scored contributor");
  }
  for (const allocation of proposal.allocations) {
    const expected = byIntent.get(allocation.intentId);
    if (
      !expected ||
      allocation.actor.id !== expected.actor.id ||
      allocation.actor.login !== expected.actor.login ||
      allocation.score !== expected.score ||
      allocation.suggestedMinor !== expected.suggestedMinor ||
      canonical(allocation.evidenceEventIds) !==
        canonical(expected.evidenceEventIds)
    ) {
      throw new TypeError(
        `Reward proposal intent ${allocation.intentId} differs from its frozen snapshot`,
      );
    }
  }
  if (
    proposal.sourceSnapshotSha256 !== snapshotDigest ||
    proposal.scoringRuleVersion !== snapshot.ruleVersion ||
    proposal.contributionWindow.from !== baseline.contributionWindow.from ||
    proposal.contributionWindow.to !== baseline.contributionWindow.to ||
    proposal.capMinor !== baseline.capMinor ||
    proposal.totals.suggestedMinor !== baseline.totals.suggestedMinor
  ) {
    throw new TypeError(
      "Reward proposal metadata differs from its frozen snapshot",
    );
  }
}

async function buildCycle(
  projectId: string,
  cycleId: string,
  directory: string,
  options: { allowPendingTransactionEvidence?: boolean } = {},
): Promise<CycleBuild> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !ALLOWED_FILES.has(entry.name)
    ) {
      throw new TypeError(
        `${relative(REPOSITORY_ROOT, join(directory, entry.name))} is not an allowed cycle file`,
      );
    }
  }
  for (const required of REQUIRED_FILES) {
    if (!names.includes(required)) {
      throw new TypeError(`${projectId}/${cycleId} is missing ${required}`);
    }
  }
  const loaded = new Map<string, JsonFile>();
  await Promise.all(
    names.map(async (name) => {
      loaded.set(
        name,
        await jsonFile(
          join(directory, name),
          name === "source-snapshot.json" ? MAX_SNAPSHOT_BYTES : MAX_JSON_BYTES,
        ),
      );
    }),
  );
  const snapshotFile = loaded.get("source-snapshot.json");
  const proposalFile = loaded.get("proposal.json");
  if (!snapshotFile || !proposalFile)
    throw new Error("required cycle files vanished");
  assertLeaderboardSnapshot(snapshotFile.value);
  const snapshot = snapshotFile.value;
  const rawProposal = proposalFile.value as { kind?: unknown };
  const files = new Map(
    [...loaded.entries()]
      .filter(([name]) => name !== "transactions.json")
      .map(([name, file]) => [name, file.bytes]),
  );

  if (rawProposal.kind === "external-contribution-share") {
    if (
      names.some(
        (name) =>
          !REQUIRED_FILES.includes(name as (typeof REQUIRED_FILES)[number]),
      )
    ) {
      throw new TypeError(
        "External contribution shares cannot contain payment files",
      );
    }
    const proposal = assertExternalContributionShareManifest(
      proposalFile.value,
    );
    if (proposal.projectId !== projectId || proposal.cycleId !== cycleId) {
      throw new TypeError("External share does not match its cycle path");
    }
    const expected = createRewardCycleProposal({
      cycleId,
      generatedAt: proposal.generatedAt,
      projectId,
      snapshot,
      sourceSnapshotSha256: snapshotFile.digest,
    });
    if (canonical(expected) !== canonical(proposal)) {
      throw new TypeError("External share differs from its frozen snapshot");
    }
    return {
      entry: {
        projectId,
        cycleId,
        kind: "external-prize-share",
        state:
          proposal.entries.length === 0
            ? "closed-no-awards"
            : "external-provisional",
        generatedAt: proposal.generatedAt,
        contributionWindow: proposal.contributionWindow,
        reviewEndsAt: null,
        approvedAt: null,
        settledAt: null,
        reward: {
          currency: null,
          capMinor: "0",
          suggestedMinor: "0",
          approvedMinor: "0",
          paidMinor: "0",
          feeMinor: "0",
          sharePartsPerMillion: proposal.entries.reduce(
            (total, entry) => total + entry.sharePartsPerMillion,
            0,
          ),
        },
        contributors: proposal.entries.map((entry) => ({
          actor: entry.actor,
          score: entry.score,
          state: "external-share",
          suggestedMinor: "0",
          approvedMinor: "0",
          paidMinor: "0",
          sharePartsPerMillion: entry.sharePartsPerMillion,
          wallet: null,
        })),
        files: {
          sourceSnapshot: reference(
            projectId,
            cycleId,
            "source-snapshot.json",
            snapshotFile,
          ),
          proposal: reference(
            projectId,
            cycleId,
            "proposal.json",
            proposalFile,
          ),
          allocation: null,
          executionPlan: null,
          settlement: null,
        },
      },
      files,
      allocation: null,
      plan: null,
      settlement: null,
    };
  }

  const proposal = assertRewardAllocationManifest(proposalFile.value);
  if (
    proposal.projectId !== projectId ||
    proposal.cycleId !== cycleId ||
    proposal.status !== "proposed"
  ) {
    throw new TypeError(
      "Reward proposal does not match its cycle path or state",
    );
  }
  verifyProposalAgainstSnapshot(proposal, snapshot, snapshotFile.digest);

  const allocationFile = loaded.get("allocation.json") ?? null;
  let allocation: RewardAllocationManifest | null = null;
  if (allocationFile) {
    allocation = assertRewardAllocationManifest(allocationFile.value);
    if (!allocation.approvedAt) {
      throw new TypeError("Cycle allocation is not approved");
    }
    const expected = finalizeRewardAllocation(
      proposal,
      allocation.approvedAt,
      Date.parse(allocation.approvedAt),
    );
    if (canonical(expected) !== canonical(allocation)) {
      throw new TypeError(
        "Approved allocation differs from its reviewed proposal",
      );
    }
  }

  const planFile = loaded.get("execution-plan.json") ?? null;
  let plan: SettlementExecutionPlan | null = null;
  if (planFile) {
    if (!allocation || !allocationFile) {
      throw new TypeError("Settlement plan has no approved allocation");
    }
    plan = assertSettlementExecutionPlan(planFile.value, allocation);
    if (plan.allocationSha256 !== allocationFile.digest) {
      throw new TypeError("Settlement plan does not bind to allocation bytes");
    }
  }

  const settlementFile = loaded.get("settlement.json") ?? null;
  let settlement: RewardSettlementManifest | null = null;
  if (settlementFile) {
    if (!allocation || !allocationFile || !plan) {
      throw new TypeError("Settlement has no approved allocation and plan");
    }
    if (!loaded.has("transactions.json")) {
      throw new TypeError(
        "Settlement is missing its submitted transaction evidence",
      );
    }
    settlement = assertRewardSettlementManifest(
      settlementFile.value,
      allocation,
    );
    if (settlement.allocationSha256 !== allocationFile.digest) {
      throw new TypeError("Settlement does not bind to allocation bytes");
    }
  } else if (
    loaded.has("transactions.json") &&
    !options.allowPendingTransactionEvidence
  ) {
    throw new TypeError(
      "Unverified transaction evidence cannot be published alone",
    );
  }

  const state =
    proposal.allocations.length === 0
      ? "closed-no-awards"
      : settlement
        ? settlement.status === "paid"
          ? "paid"
          : "settlement-planned"
        : plan
          ? "settlement-planned"
          : allocation
            ? "payment-ready"
            : "review";
  const allocationByIntent = new Map(
    allocation?.allocations.map((entry) => [entry.intentId, entry]) ?? [],
  );
  const settlementByIntent = new Map(
    settlement?.recipients.map((entry) => [entry.intentId, entry]) ?? [],
  );
  return {
    entry: {
      projectId,
      cycleId,
      kind: "monthly-pool",
      state,
      generatedAt: proposal.generatedAt,
      contributionWindow: proposal.contributionWindow,
      reviewEndsAt: proposal.review.endsAt,
      approvedAt: allocation?.approvedAt ?? null,
      settledAt: settlement?.settledAt ?? null,
      reward: {
        currency: "USDC",
        capMinor: proposal.capMinor,
        suggestedMinor: proposal.totals.suggestedMinor,
        approvedMinor: allocation?.totals.approvedMinor ?? "0",
        paidMinor: settlement?.totals.paidMinor ?? "0",
        feeMinor: allocation?.totals.feeMinor ?? "0",
        sharePartsPerMillion: null,
      },
      contributors: proposal.allocations.map((entry) => {
        const approved = allocationByIntent.get(entry.intentId);
        const paid = settlementByIntent.get(entry.intentId);
        return {
          actor: entry.actor,
          score: entry.score,
          state:
            paid?.state === "paid" ? "paid" : (approved?.state ?? entry.state),
          suggestedMinor: entry.suggestedMinor,
          approvedMinor: approved?.approvedMinor ?? "0",
          paidMinor: paid?.paidMinor ?? "0",
          sharePartsPerMillion: null,
          wallet: approved?.wallet ?? entry.wallet,
        };
      }),
      files: {
        sourceSnapshot: reference(
          projectId,
          cycleId,
          "source-snapshot.json",
          snapshotFile,
        ),
        proposal: reference(projectId, cycleId, "proposal.json", proposalFile),
        allocation: allocationFile
          ? reference(projectId, cycleId, "allocation.json", allocationFile)
          : null,
        executionPlan: planFile
          ? reference(projectId, cycleId, "execution-plan.json", planFile)
          : null,
        settlement: settlementFile
          ? reference(projectId, cycleId, "settlement.json", settlementFile)
          : null,
      },
    },
    files,
    allocation,
    plan,
    settlement,
  };
}

/**
 * Validates one canonical cycle immediately before a money-state transition.
 * Pending transaction signatures are allowed only for the settlement verifier
 * that will fetch and reconcile them before writing its terminal record.
 */
export async function validateCycleTransition(
  projectId: string,
  cycleId: string,
  options: { allowPendingTransactionEvidence?: boolean } = {},
): Promise<CycleIndexEntry> {
  if (!findProject(projectId)) {
    throw new TypeError(`Unknown project: ${projectId}`);
  }
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleId)) {
    throw new TypeError("Cycle id must be YYYY-MM");
  }
  const directory = join(CYCLES_ROOT, projectId, cycleId);
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new TypeError("Cycle transition path must be a real directory");
  }
  return (
    await buildCycle(projectId, cycleId, directory, {
      allowPendingTransactionEvidence:
        options.allowPendingTransactionEvidence ?? false,
    })
  ).entry;
}

async function collectCycles(): Promise<CycleBuild[]> {
  const rootStats = await lstat(CYCLES_ROOT).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (!rootStats) return [];
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new TypeError("cycles root must be a real directory");
  }
  const builds: CycleBuild[] = [];
  const projectEntries = await readdir(CYCLES_ROOT, { withFileTypes: true });
  for (const projectEntry of projectEntries) {
    if (projectEntry.name === "README.md") continue;
    if (
      !projectEntry.isDirectory() ||
      projectEntry.isSymbolicLink() ||
      !findProject(projectEntry.name)
    ) {
      throw new TypeError(
        `cycles/${projectEntry.name} is not a registered project directory`,
      );
    }
    const projectDirectory = join(CYCLES_ROOT, projectEntry.name);
    const cycleEntries = await readdir(projectDirectory, {
      withFileTypes: true,
    });
    for (const cycleEntry of cycleEntries) {
      if (
        !cycleEntry.isDirectory() ||
        cycleEntry.isSymbolicLink() ||
        !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleEntry.name)
      ) {
        throw new TypeError(
          `cycles/${projectEntry.name}/${cycleEntry.name} is not a canonical cycle directory`,
        );
      }
      builds.push(
        await buildCycle(
          projectEntry.name,
          cycleEntry.name,
          join(projectDirectory, cycleEntry.name),
        ),
      );
      if (builds.length > MAX_CYCLES)
        throw new RangeError("cycle limit exceeded");
    }
  }
  return builds.sort(
    (left, right) =>
      right.entry.cycleId.localeCompare(left.entry.cycleId) ||
      left.entry.projectId.localeCompare(right.entry.projectId),
  );
}

export async function syncCycleIndex(
  options: {
    checkOnly?: boolean;
    generatedAt?: string;
    online?: boolean;
    rpcUrl?: string;
  } = {},
): Promise<CycleIndex> {
  const builds = await collectCycles();
  if (options.online) {
    const rpc = new URL(options.rpcUrl?.trim() || DEFAULT_SOLANA_RPC_URL);
    if (rpc.protocol !== "https:" || rpc.username || rpc.password || rpc.hash) {
      throw new TypeError("Solana RPC URL must be credential-free HTTPS");
    }
    for (const build of builds) {
      if (build.allocation && build.plan && build.settlement) {
        const allocationReference = build.entry.files.allocation;
        if (!allocationReference)
          throw new Error("allocation reference vanished");
        await verifyRewardSettlementOnchain({
          allocation: build.allocation,
          expectedAllocationSha256: allocationReference.sha256,
          getTransaction: (signature) =>
            fetchFinalizedSolanaTransaction(rpc.toString(), signature),
          plan: build.plan,
          settlement: build.settlement,
        });
      }
    }
  }
  const index: CycleIndex = {
    schemaVersion: CYCLE_INDEX_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    cycles: builds.map((build) => build.entry),
  };
  assertCycleIndex(index);
  if (!options.checkOnly) {
    const temporaryRoot = `${PUBLIC_CYCLES_ROOT}.${process.pid}.${Date.now()}.tmp`;
    await rm(temporaryRoot, { force: true, recursive: true });
    try {
      await mkdir(temporaryRoot, { recursive: true });
      for (const build of builds) {
        const destination = join(
          temporaryRoot,
          build.entry.projectId,
          build.entry.cycleId,
        );
        await mkdir(destination, { recursive: true });
        await Promise.all(
          [...build.files.entries()].map(([name, bytes]) =>
            writeFile(join(destination, name), bytes),
          ),
        );
      }
      await writeFile(
        join(temporaryRoot, "index.json"),
        `${JSON.stringify(index, null, 2)}\n`,
      );
      await rm(PUBLIC_CYCLES_ROOT, { force: true, recursive: true });
      await mkdir(dirname(PUBLIC_CYCLES_ROOT), { recursive: true });
      await rename(temporaryRoot, PUBLIC_CYCLES_ROOT);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }
  return index;
}

function parseArguments(values: string[]): {
  checkOnly: boolean;
  online: boolean;
  rpcUrl?: string;
} {
  let checkOnly = false;
  let online = false;
  let rpcUrl: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--check") checkOnly = true;
    else if (value === "--online") online = true;
    else if (value === "--rpc-url") {
      rpcUrl = values[index + 1];
      if (!rpcUrl || rpcUrl.startsWith("--")) {
        throw new TypeError("--rpc-url requires a value");
      }
      index += 1;
    } else throw new TypeError(`Unknown cycle-index argument: ${value}`);
  }
  return { checkOnly, online, rpcUrl };
}

if (import.meta.main) {
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    const index = await syncCycleIndex({
      ...arguments_,
      rpcUrl: arguments_.rpcUrl ?? process.env.SOLANA_RPC_URL,
    });
    process.stdout.write(
      `[Slop] validated ${index.cycles.length} reward cycle${index.cycles.length === 1 ? "" : "s"}${arguments_.online ? " with finalized Solana evidence" : ""}\n`,
    );
  } catch (error) {
    // error-policy:J1 command boundary exposes a non-zero, actionable failure.
    process.stderr.write(
      `[Slop] cycle validation refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
