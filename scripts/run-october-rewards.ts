/** Trusted main-only October proposal import. Private inputs stay in the runner. */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { D1QueryStatement } from "../backend/d1";
import { PARTICIPATION_BAN_QUERY } from "../backend/projects/account-bans";
import {
  CloudflareProjectPersistence,
  type ProjectD1Database,
} from "../backend/projects/cloudflare-persistence";
import { publicRestrictionOf } from "../backend/projects/enforcement";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import { payoutExclusionFor } from "../src/lib/payout-exclusions.mjs";
import {
  assertPointsJournal,
  type PointsJournal,
  pointMembers,
} from "../src/lib/points";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { sha256Hex } from "../src/lib/sha256";
import { loadPublishedPoints } from "./generate-points";
import { pointProtectionQuery } from "./points-protection-sql";
import { prepareGuardedOctoberImport } from "./prepare-october-rewards";

const execute = promisify(execFile);
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const PERIOD = "2026-10";
const APPROVED_PROJECTS = new Set([
  "eliza",
  "slopdotcash",
  "asi",
  "feed",
  "thenetwork",
]);
type Plan = ReturnType<typeof prepareGuardedOctoberImport>;
type Query = (sql: string) => Promise<Record<string, unknown>[]>;

/** Strictly decode Wrangler's normal --json output, with no empty-result fallback. */
export function octoberQueryRows(stdout: string): Record<string, unknown>[] {
  const results = JSON.parse(stdout) as {
    success?: boolean;
    results?: Record<string, unknown>[];
  }[];
  if (
    !Array.isArray(results) ||
    results.length !== 1 ||
    results[0].success !== true ||
    !Array.isArray(results[0].results)
  )
    throw new Error("Incomplete private October query");
  return results[0].results;
}

/** Expose only the canonical persistence reader's SELECT operations. */
function readOnlyDatabase(query: Query): ProjectD1Database {
  const prepare = (sql: string, values: unknown[] = []): D1QueryStatement => {
    const read = () => {
      if (!/^\s*SELECT\b/iu.test(sql))
        throw new Error("Expected a private read");
      let position = 0;
      const bound = sql.replace(/\?/gu, () => {
        const value = values[position++];
        if (typeof value === "string") return quote(value);
        if (typeof value === "number" && Number.isSafeInteger(value))
          return String(value);
        if (value === null) return "NULL";
        throw new Error("Invalid private query binding");
      });
      if (position !== values.length)
        throw new Error("Private query binding mismatch");
      return query(bound);
    };
    return {
      bind: (...bound) => prepare(sql, bound),
      all: async <T>() => ({ success: true, results: (await read()) as T[] }),
      first: async <T>() => ((await read())[0] as T | undefined) ?? null,
      run: async () => {
        throw new Error("Private reader cannot write");
      },
    };
  };
  return {
    prepare,
    batch: async () => {
      throw new Error("Private reader cannot write");
    },
  };
}

/** Compare the explicit owner-reviewed weights against the complete current journal.
 * This is validation only. The reviewed packet remains the allocation authority. */
export function assertOctoberReviewedWeights(
  plan: Plan,
  journal: PointsJournal,
  reviewedPacket: Uint8Array,
): void {
  assertPointsJournal(journal);
  if (sha256Hex(reviewedPacket) !== plan.reviews.reviewedPacketSha256)
    throw new Error("Reviewed weights packet changed");
  const packets = packetWeights(reviewedPacket);
  if (sha256Hex(JSON.stringify(journal)) !== plan.reviews.evidence.pointsBatch)
    throw new Error("Published Points differ from the reviewed private batch");
  for (const project of plan.reviews.projects) {
    const policy = assertProjectDefinition(JSON.parse(project.manifest));
    const from =
      policy.reward.rewardStartAt > `${PERIOD}-01T00:00:00.000Z`
        ? policy.reward.rewardStartAt
        : `${PERIOD}-01T00:00:00.000Z`;
    const members = pointMembers(journal, PERIOD, project.id);
    const known = new Map(
      members.map((member) => [
        githubUserIdFromNodeId(member.actor.id),
        member.actor.id,
      ]),
    );
    const expected = new Map(
      members.flatMap((member) => {
        const awards = member.awards.filter(
          (award) =>
            award.category !== "payout-received" &&
            award.occurredAt >= from &&
            award.occurredAt < "2026-11-01T00:00:00.000Z",
        );
        if (awards.length === 0) return [];
        const id = githubUserIdFromNodeId(member.actor.id);
        if (!id) throw new Error("Accepted-work actor has no numeric identity");
        const signed = awards.reduce(
          (sum, award) => sum + BigInt(award.amount),
          0n,
        );
        const points = Number(signed > 0n ? signed : 0n);
        if (!Number.isSafeInteger(points))
          throw new Error("Accepted-work Points overflow");
        return [[id, { nodeId: member.actor.id, points }] as const];
      }),
    );
    const weights = packets.get(project.id);
    if (!weights) throw new Error("Missing reviewed weight validation input");
    for (const row of weights) {
      const actual =
        expected.get(row.githubUserId) ??
        (row.acceptedWorkPoints === 0 &&
        known.get(row.githubUserId) === row.githubNodeId
          ? { nodeId: row.githubNodeId, points: 0 }
          : undefined);
      if (
        !actual ||
        actual.nodeId !== row.githubNodeId ||
        actual.points !== row.acceptedWorkPoints
      )
        throw new Error(
          "Reviewed October weights differ from accepted-work Points",
        );
      expected.delete(row.githubUserId);
    }
    if (expected.size)
      throw new Error("Reviewed October weights omit a contributor");
  }
}

type ReviewedWeight = {
  githubUserId: string;
  githubNodeId: string;
  acceptedWorkPoints: number;
  eligible: boolean;
};
function packetWeights(bytes: Uint8Array): Map<string, ReviewedWeight[]> {
  const packet = JSON.parse(new TextDecoder().decode(bytes)) as {
    projects: {
      id: string;
      identities: { githubUserId: string; githubNodeId: string }[];
      weights: {
        githubUserId: string;
        acceptedWorkPoints: number;
        eligible: boolean;
      }[];
    }[];
  };
  return new Map(
    packet.projects.map((project) => [
      project.id,
      project.weights.map((weight) => ({
        ...weight,
        githubNodeId:
          project.identities.find(
            (actor) => actor.githubUserId === weight.githubUserId,
          )?.githubNodeId ?? "",
      })),
    ]),
  );
}

/** Exact immutable header and rows, used after import and for no-op replay. */
export async function verifyOctoberReadback(
  plan: Plan,
  query: Query,
): Promise<void> {
  for (const { monthlyBase: base, manifest } of plan.reviews.projects) {
    const key = `project_id=${quote(base.projectId)} AND period='2026-10'`;
    const headers = await query(
      `SELECT manifest,manifest_sha256,source_snapshot_sha256,cap_base,recipient_count FROM monthly_reward_bases WHERE ${key}`,
    );
    if (headers.length !== 1)
      throw new Error("October proposal header is missing or duplicated");
    const header = headers[0];
    if (
      header.manifest !== manifest ||
      header.manifest_sha256 !== base.manifestSha256 ||
      header.source_snapshot_sha256 !== base.sourceSnapshotSha256 ||
      header.cap_base !== base.capBase ||
      header.recipient_count !== base.rows.length
    )
      throw new Error("October proposal header differs after import");
    const rows = await query(
      `SELECT github_user_id,github_login,gross_base,source_digest FROM monthly_reward_base_rows WHERE ${key} ORDER BY github_user_id`,
    );
    const expected = [...base.rows]
      .sort((a, b) => (a.githubUserId < b.githubUserId ? -1 : 1))
      .map((row) => ({
        github_user_id: row.githubUserId,
        github_login: row.login,
        gross_base: row.grossBase,
        source_digest: row.sourceDigest,
      }));
    if (JSON.stringify(rows) !== JSON.stringify(expected))
      throw new Error("October proposal rows differ after import");
  }
}

async function privateD1(args: string[]): Promise<string> {
  const { stdout } = await execute(
    resolve("node_modules/.bin/wrangler"),
    [
      "d1",
      "execute",
      "slop-private",
      "--remote",
      "--config",
      "workers/identity/wrangler.toml",
      ...args,
    ],
    {
      env: {
        ...process.env,
        WRANGLER_LOG: args.includes("--json") ? "log" : "error",
        WRANGLER_WRITE_LOGS: "false",
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return stdout;
}

/** Build from current private registry and public Points, without writing D1. */
export async function preparePrivateOctoberPlan(options: {
  approvedTerms: Uint8Array;
  packetBytes: Uint8Array;
  reviewedPacketSha256: string;
  journal: PointsJournal | (() => Promise<PointsJournal>);
  query: Query;
  now: Date;
}): Promise<{
  plan: Plan;
  registryBytes: Uint8Array;
  alreadyImported: boolean;
}> {
  const {
    approvedTerms,
    packetBytes,
    reviewedPacketSha256,
    journal,
    query,
    now,
  } = options;
  const persistence = new CloudflareProjectPersistence(readOnlyDatabase(query));
  const before = await persistence.enforcementGeneration();
  const records = await persistence.listEnforcements();
  if (sha256Hex(packetBytes) !== reviewedPacketSha256)
    throw new Error("Reviewed packet digest differs");
  const packet = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packetBytes),
  ) as {
    projects: { id: string }[];
  };
  if (
    !Array.isArray(packet.projects) ||
    !packet.projects.length ||
    packet.projects.some(({ id }) => !APPROVED_PROJECTS.has(id))
  )
    throw new Error("Unknown October project");
  const projects = [];
  for (const { id } of packet.projects) {
    const rows = await query(
      `SELECT id,status,revision,manifest,manifest_sha256 FROM projects WHERE id=${quote(id)}`,
    );
    if (rows.length !== 1) throw new Error("Missing October project");
    const row = rows[0];
    if (row.status !== "active")
      throw new Error("October project is not active");
    const manifest = assertProjectDefinition(JSON.parse(String(row.manifest)));
    projects.push({
      id,
      revision: row.revision,
      manifestSha256: row.manifest_sha256,
      manifestText: row.manifest,
      restriction: publicRestrictionOf({ id, manifest }, records).state,
    });
  }
  if ((await persistence.enforcementGeneration()) !== before)
    throw new Error("Enforcement changed during capture");
  const registry = {
    schemaVersion: "1",
    origin: "https://slop.cash",
    capturedAt: now.toISOString(),
    enforcementGeneration: before,
    projects,
  };
  const input = {
    approvedTerms,
    reviewedPacket: packetBytes,
    reviewedPacketSha256,
    currentRegistry: new TextEncoder().encode(JSON.stringify(registry)),
    now,
  };
  const plan = prepareGuardedOctoberImport(input);
  const existingProjects = await query(
    `SELECT project_id FROM monthly_reward_bases WHERE period='2026-10' AND project_id IN (${plan.reviews.projects.map(({ id }) => quote(id)).join(",")})`,
  );
  if (existingProjects.length === plan.reviews.projects.length) {
    await verifyOctoberReadback(plan, query);
    return {
      plan,
      registryBytes: input.currentRegistry,
      alreadyImported: true,
    };
  }
  const currentJournal =
    typeof journal === "function" ? await journal() : journal;
  assertOctoberReviewedWeights(plan, currentJournal, packetBytes);
  const currentBatch = await query(
    "SELECT digest FROM points_batches ORDER BY revision_count DESC,generated_at DESC,digest DESC LIMIT 1",
  );
  if (
    currentBatch.length !== 1 ||
    currentBatch[0].digest !== plan.reviews.evidence.pointsBatch
  )
    throw new Error("Current private Points batch differs");
  const weights = packetWeights(packetBytes);
  for (const project of plan.reviews.projects) {
    const protection = await query(
      pointProtectionQuery([{ projectId: project.id, period: PERIOD }]),
    );
    if (existingProjects.some((row) => row.project_id === project.id))
      await verifyOctoberReadback(
        { ...plan, reviews: { ...plan.reviews, projects: [project] } },
        query,
      );
    else if (protection.length !== 1 || protection[0].protected !== 0)
      throw new Error("October project has protected financial history");
    const policy = assertProjectDefinition(JSON.parse(project.manifest));
    for (const weight of weights.get(project.id) ?? []) {
      const banned = await query(
        PARTICIPATION_BAN_QUERY.replace("?", quote(weight.githubUserId)),
      );
      const eligible =
        banned.length === 0 &&
        !payoutExclusionFor(policy, PERIOD, weight.githubNodeId);
      if (eligible !== weight.eligible)
        throw new Error("Reviewed eligibility differs from current policy");
    }
  }
  return { plan, registryBytes: input.currentRegistry, alreadyImported: false };
}

/** A lost import response is reconciled before the operation can be retried. */
export async function importOctoberPlan(
  plan: Plan,
  importFile: () => Promise<unknown>,
  query: Query,
): Promise<void> {
  try {
    await importFile();
  } catch {
    // D1 may have committed before the transport failed. Only every exact
    // immutable header and row proves this attempt succeeded.
    await verifyOctoberReadback(plan, query);
    return;
  }
  await verifyOctoberReadback(plan, query);
}

export async function runOctoberRewards(): Promise<void> {
  let phase = "trusted invocation";
  try {
    if (
      process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      process.env.GITHUB_REF !== "refs/heads/main" ||
      !/^[a-f0-9]{40}$/u.test(process.env.GITHUB_SHA ?? "") ||
      !/^[a-f0-9]{64}$/u.test(process.env.REVIEWED_PACKET_SHA256 ?? "") ||
      !["true", "false"].includes(process.env.OCTOBER_APPLY ?? "") ||
      !process.env.RUNNER_TEMP ||
      !process.env.OCTOBER_REWARDS_REVIEWED_PACKET
    )
      throw new Error("Untrusted October invocation");
    const head = await execute("git", ["rev-parse", "HEAD"]);
    const main = await execute("git", [
      "ls-remote",
      "origin",
      "refs/heads/main",
    ]);
    if (
      head.stdout.trim() !== process.env.GITHUB_SHA ||
      main.stdout.split(/\s/u)[0] !== process.env.GITHUB_SHA
    )
      throw new Error("October invocation is stale");
    const directory = join(process.env.RUNNER_TEMP, "october-private-proposal");
    await mkdir(directory, { mode: 0o700 });
    const query: Query = async (sql) =>
      octoberQueryRows(await privateD1(["--json", "--command", sql]));
    phase = "private registry, Points and eligibility validation";
    const packetBytes = new TextEncoder().encode(
      process.env.OCTOBER_REWARDS_REVIEWED_PACKET,
    );
    const { plan, registryBytes, alreadyImported } =
      await preparePrivateOctoberPlan({
        approvedTerms: await readFile(
          "tests/fixtures/october-approved-terms.txt",
        ),
        packetBytes,
        reviewedPacketSha256: String(process.env.REVIEWED_PACKET_SHA256),
        journal: async () => {
          const journal = await loadPublishedPoints();
          if (!journal) throw new Error("Current Points are unavailable");
          return journal;
        },
        query,
        now: new Date(),
      });
    await writeFile(join(directory, "reviewed-packet.json"), packetBytes, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(join(directory, "registry.json"), registryBytes, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(join(directory, "proposal.sql"), plan.sql, {
      flag: "wx",
      mode: 0o600,
    });
    if (process.env.OCTOBER_APPLY === "true" && !alreadyImported) {
      phase = "atomic proposal import";
      const latest = await execute("git", [
        "ls-remote",
        "origin",
        "refs/heads/main",
      ]);
      if (latest.stdout.split(/\s/u)[0] !== process.env.GITHUB_SHA)
        throw new Error("Main changed before import");
      await importOctoberPlan(
        plan,
        () => privateD1(["--file", join(directory, "proposal.sql")]),
        query,
      );
    }
    console.log(
      JSON.stringify({
        schemaVersion: "1",
        period: PERIOD,
        mode: alreadyImported
          ? "already-imported-and-verified"
          : process.env.OCTOBER_APPLY === "true"
            ? "applied-and-verified"
            : "preview",
        reviewedPacketSha256: plan.reviews.reviewedPacketSha256,
        projects: plan.reviews.projects.length,
        recipients: plan.reviews.projects.reduce(
          (count, p) => count + p.awards.length,
          0,
        ),
      }),
    );
  } catch {
    throw new Error(`October proposal preparation refused during ${phase}`);
  }
}

if (import.meta.main) {
  runOctoberRewards().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
