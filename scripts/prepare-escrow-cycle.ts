/** Generate source-bound gross proposals. This command neither approves nor signs. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readBoundedJson } from "../src/lib/browser-json";
import {
  assertLeaderboardSnapshot,
  assertPublishableLeaderboardSnapshot,
} from "../src/lib/leaderboard";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import {
  allocateIntegerTotal,
  createProjectView,
} from "../src/lib/project-view";
import { findProject } from "../src/lib/projects.mjs";
import {
  additiveReviewBudgetWeights,
  allocateReviewBudgetMinor,
  ensureCompleteCycle,
} from "../src/lib/reward-cycle";
import { resolveGitHubToken } from "./github-token";
import { writeNewFile, writeNewJsonFile } from "./write-new-file";

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface EscrowIdentity {
  nodeId: string;
  githubUserId: string;
  login: string;
}
export async function resolveEscrowIdentities(
  nodeIds: string[],
  token?: string,
): Promise<EscrowIdentity[]> {
  const authorization = token ?? (await resolveGitHubToken());
  const result: EscrowIdentity[] = [];
  for (let i = 0; i < nodeIds.length; i += 100) {
    const ids = nodeIds.slice(i, i + 100);
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        authorization: `Bearer ${authorization}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query:
          "query($ids:[ID!]!){nodes(ids:$ids){... on User{id databaseId login}}}",
        variables: { ids },
      }),
    });
    if (!response.ok) throw new Error("GitHub numeric identity lookup failed");
    const body = (await readBoundedJson(
      response,
      1048576,
      "GitHub actor identities",
    )) as {
      errors?: unknown;
      data?: { nodes?: { id: string; databaseId: number; login: string }[] };
    };
    if (body.errors || body.data?.nodes?.length !== ids.length)
      throw new Error("Incomplete GitHub identity evidence");
    for (const [index, node] of body.data.nodes.entries()) {
      if (
        !node ||
        node.id !== ids[index] ||
        !Number.isSafeInteger(node.databaseId) ||
        node.databaseId <= 0 ||
        typeof node.login !== "string"
      )
        throw new Error("GitHub actor identity mismatch");
      result.push({
        nodeId: node.id,
        githubUserId: String(node.databaseId),
        login: node.login,
      });
    }
  }
  return result.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

/** Origin excludes amount, wallet, snapshot and network so revisions cannot pay twice. */
export function escrowAwardOrigin(
  projectId: string,
  cycleId: string,
  actorId: string,
) {
  if (!/^[1-9][0-9]*$/.test(actorId) || BigInt(actorId) > (1n << 64n) - 1n)
    throw new Error("GitHub actor ID must fit uint64");
  return digest(
    JSON.stringify(["slop-escrow-origin-v2", projectId, cycleId, actorId]),
  );
}

export function buildEscrowCycle(
  input: {
    projectId: string;
    cycleId: string;
    generatedAt: string;
  },
  bytes: Buffer,
  identityBytes: Buffer,
  policyBytes: Buffer,
) {
  const project = assertProjectDefinition(
    JSON.parse(policyBytes.toString("utf8")),
  );
  if (project.id !== input.projectId || !findProject(input.projectId))
    throw new Error("Archived project is not canonical");
  if (
    !project?.escrow ||
    input.cycleId < project.escrow.effectiveCycle ||
    project.reward.kind !== "monthly-pool"
  )
    throw new Error("Project must adopt the reviewed escrow policy first");
  const snapshot = JSON.parse(bytes.toString("utf8"));
  assertLeaderboardSnapshot(snapshot);
  const generatedAt = input.generatedAt;
  const sourceSnapshotSha256 = digest(bytes);
  const view = createProjectView(
    snapshot,
    project.id,
    input.cycleId,
    undefined,
    project,
  );
  ensureCompleteCycle(
    {
      projectId: project.id,
      cycleId: input.cycleId,
      generatedAt,
      sourceSnapshotSha256,
      snapshot,
    },
    view,
  );
  if (view.reward.kind !== "monthly-pool")
    throw new Error("Expected monthly pool");
  const cap = BigInt(view.reward.capMinor);
  const reviewPolicy = project.reward.reviewBudget;
  const reviewCap =
    reviewPolicy?.fundingState === "committed" &&
    reviewPolicy.paymentMode === "enabled" &&
    Date.parse(reviewPolicy.effectiveAt) <= Date.parse(view.cycle.from)
      ? BigInt(reviewPolicy.committedMinor) <
        BigInt(reviewPolicy.monthlyCapMinor)
        ? BigInt(reviewPolicy.committedMinor)
        : BigInt(reviewPolicy.monthlyCapMinor)
      : 0n;
  if (cap < 0n || cap + reviewCap > (1n << 64n) - 1n)
    throw new Error("Gross cap exceeds supported range");
  const reviewAllocations = allocateReviewBudgetMinor(
    reviewCap,
    additiveReviewBudgetWeights(view.ledger),
  );
  const allocations = allocateIntegerTotal(cap, view.leaders);
  const identities = JSON.parse(
    identityBytes.toString("utf8"),
  ) as EscrowIdentity[];
  if (
    !Array.isArray(identities) ||
    identities.length !== view.leaders.length ||
    new Set(identities.map((actor) => actor.nodeId)).size !==
      identities.length ||
    new Set(identities.map((actor) => actor.githubUserId)).size !==
      identities.length
  )
    throw new Error("Actor identity coverage differs from proposal");
  const awards = view.leaders
    .map((leader) => {
      const identity = identities.find(
        (actor) => actor.nodeId === leader.actor.id,
      );
      if (!identity) throw new Error("Missing numeric GitHub identity");
      const gross =
        (allocations.get(leader.actor.id) ?? 0n) +
        (reviewAllocations.get(leader.actor.id) ?? 0n);
      const fee = gross / 50n;
      return {
        githubUserId: identity.githubUserId,
        githubNodeId: leader.actor.id,
        login: leader.actor.login,
        sourceDigest: escrowAwardOrigin(
          project.id,
          input.cycleId,
          identity.githubUserId,
        ),
        grossMicro: gross.toString(),
        feeMicro: fee.toString(),
        netMicro: (gross - fee).toString(),
        evidenceEventIds: [...leader.evidenceEventIds].sort(),
      };
    })
    .sort((a, b) => a.githubUserId.localeCompare(b.githubUserId));
  const proposal = {
    schemaVersion: "2",
    kind: "escrow-gross-proposal",
    projectId: project.id,
    cycleId: input.cycleId,
    chain: project.escrow.chain,
    status: "under-review",
    generatedAt,
    reviewEndsAt: new Date(
      Date.parse(generatedAt) + 14 * 86400000,
    ).toISOString(),
    sourceSnapshotSha256,
    githubIdentitiesSha256: digest(identityBytes),
    projectPolicySha256: digest(policyBytes),
    scoringRuleVersion: snapshot.ruleVersion,
    contributionWindow: { from: view.cycle.from, to: view.cycle.to },
    grossCapMicro: (cap + reviewCap).toString(),
    sharedPoolCapMicro: cap.toString(),
    reviewBudgetCapMicro: reviewCap.toString(),
    feeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    awards,
  };
  return proposal;
}

export async function prepareEscrowCycle(input: {
  projectId: string;
  cycleId: string;
  snapshotPath: string;
  generatedAt?: string;
  githubToken?: string;
}) {
  const bytes = await readFile(input.snapshotPath);
  const snapshot: unknown = JSON.parse(bytes.toString("utf8"));
  assertPublishableLeaderboardSnapshot(snapshot);
  const view = createProjectView(snapshot, input.projectId, input.cycleId);
  const identities = await resolveEscrowIdentities(
    view.leaders.map((leader) => leader.actor.id),
    input.githubToken,
  );
  const canonicalProject = findProject(input.projectId);
  if (!canonicalProject) throw new Error("Unknown project");
  const policyBytes = await readFile(
    resolve("projects", canonicalProject.id, "project.json"),
  );
  const identityBytes = Buffer.from(`${JSON.stringify(identities, null, 2)}\n`);
  const proposal = buildEscrowCycle(
    { ...input, generatedAt: input.generatedAt ?? new Date().toISOString() },
    bytes,
    identityBytes,
    policyBytes,
  );
  // Versioned paths cannot be consumed accidentally by legacy Solana settlement.
  const directory = resolve(
    "cycles",
    input.projectId,
    input.cycleId,
    "escrow-v2",
  );
  await writeNewFile(
    resolve(directory, "source-snapshot.json"),
    bytes,
    "Snapshot already exists; inspect partial or existing cycle",
  );
  await writeNewFile(
    resolve(directory, "github-identities.json"),
    identityBytes,
    "Identity archive already exists",
  );
  await writeNewFile(
    resolve(directory, "project.json"),
    policyBytes,
    "Project policy archive already exists",
  );
  await writeNewJsonFile(
    resolve(directory, "proposal.json"),
    proposal,
    "Proposal already exists; preserve review history",
  );
  return proposal;
}

/** Exact reconstruction rejects amount changes, omitted actors, and edited review dates. */
export async function validateEscrowCycle(
  directory: string,
  projectId: string,
  cycleId: string,
) {
  const bytes = await readFile(resolve(directory, "source-snapshot.json"));
  const proposalBytes = await readFile(resolve(directory, "proposal.json"));
  const value = JSON.parse(proposalBytes.toString("utf8"));
  if (typeof value.generatedAt !== "string")
    throw new Error("Missing review start");
  const identityBytes = await readFile(
    resolve(directory, "github-identities.json"),
  );
  const policyBytes = await readFile(resolve(directory, "project.json"));
  const baseline = buildEscrowCycle(
    { projectId, cycleId, generatedAt: value.generatedAt },
    bytes,
    identityBytes,
    policyBytes,
  );
  if (JSON.stringify(value) !== JSON.stringify(baseline))
    throw new Error(
      "Escrow proposal differs from its complete frozen source or current policy",
    );
  return {
    proposal: baseline,
    bytes: proposalBytes,
    digest: digest(proposalBytes),
  };
}

if (import.meta.main) {
  const [projectId, cycleId, snapshotPath, ...extra] = process.argv.slice(2);
  if (!projectId || !cycleId || !snapshotPath || extra.length)
    throw new Error(
      "Usage: bun scripts/prepare-escrow-cycle.ts PROJECT YYYY-MM SNAPSHOT",
    );
  await prepareEscrowCycle({ projectId, cycleId, snapshotPath });
}
