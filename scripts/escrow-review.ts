import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";

export interface EscrowReviewProposal {
  projectId: string;
  cycleId: string;
  grossCapMicro: string;
  awards: { githubUserId: string; grossMicro: string; sourceDigest: string }[];
}
export interface EscrowDecision {
  githubUserId: string;
  state: "approved" | "held" | "excluded";
  approvedGrossMicro: string;
  adjustmentReason: string | null;
  relatedParty: boolean;
}
export interface EscrowDecisions {
  schemaVersion: "1";
  proposalSha256: string;
  rows: EscrowDecision[];
}
function exact(value: unknown, fields: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== fields.sort().join()
  )
    throw new Error("Invalid reviewed decision fields");
  return value as Record<string, unknown>;
}
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
/** Same per-row decisions/reason/related-party principles as legacy reviewed allocations. */
export function assertEscrowDecisions(
  value: unknown,
  proposal: EscrowReviewProposal,
  proposalSha256: string,
  stewardActorId: string | readonly string[],
): EscrowDecisions {
  const stewards = new Set(
    typeof stewardActorId === "string" ? [stewardActorId] : stewardActorId,
  );
  const record = exact(value, ["schemaVersion", "proposalSha256", "rows"]);
  if (
    record.schemaVersion !== "1" ||
    record.proposalSha256 !== proposalSha256 ||
    !Array.isArray(record.rows) ||
    record.rows.length !== proposal.awards.length
  )
    throw new Error("Decisions must cover the exact proposal");
  const awards = new Map(proposal.awards.map((a) => [a.githubUserId, a]));
  const seen = new Set<string>();
  let approved = 0n;
  for (const item of record.rows) {
    const row = exact(item, [
      "githubUserId",
      "state",
      "approvedGrossMicro",
      "adjustmentReason",
      "relatedParty",
    ]);
    if (
      typeof row.githubUserId !== "string" ||
      seen.has(row.githubUserId) ||
      !awards.has(row.githubUserId) ||
      !["approved", "held", "excluded"].includes(String(row.state)) ||
      typeof row.approvedGrossMicro !== "string" ||
      !/^(0|[1-9]\d*)$/.test(row.approvedGrossMicro) ||
      typeof row.relatedParty !== "boolean"
    )
      throw new Error("Invalid actor or decision");
    seen.add(row.githubUserId);
    const amount = BigInt(row.approvedGrossMicro),
      award = awards.get(row.githubUserId);
    if (
      !award ||
      amount > (1n << 64n) - 1n ||
      (row.state !== "approved" && amount !== 0n)
    )
      throw new Error("Invalid approved gross amount");
    if (
      row.adjustmentReason !== null &&
      (typeof row.adjustmentReason !== "string" || !row.adjustmentReason.trim())
    )
      throw new Error("Invalid adjustment reason");
    if (row.approvedGrossMicro !== award.grossMicro && !row.adjustmentReason)
      throw new Error("Award changes require a public reason");
    if (stewards.has(row.githubUserId) && row.relatedParty !== true)
      throw new Error("Project steward is a related party");
    approved += amount;
  }
  if (approved > BigInt(proposal.grossCapMicro))
    throw new Error("Reviewed awards exceed the gross cap");
  return record as unknown as EscrowDecisions;
}
export interface Publication {
  path: string;
  sha256: string;
  commit: string;
  pullRequest: number;
  mergedAt: string;
}
interface GitHubReview {
  id: number;
  state: string;
  submitted_at: string;
  commit_id: string;
  body: string;
  user: { id: number; login: string; type: string };
}
/** Trust root is the repository of this checked-out application, not a caller-supplied URL. */
function repository(): string {
  const remote = execFileSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
  }).trim();
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(
      remote,
    );
  if (!match) throw new Error("Canonical GitHub origin required");
  return match[1];
}
async function github<T>(
  repository: string,
  path: string,
  token?: string,
): Promise<T> {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/${path}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok)
    throw new Error(`GitHub review evidence unavailable (${response.status})`);
  return response.json() as Promise<T>;
}
async function publicBytes(
  repo: string,
  path: string,
  ref: string,
  token?: string,
): Promise<Buffer> {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`,
    {
      headers: {
        accept: "application/vnd.github.raw+json",
        "x-github-api-version": "2022-11-28",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok)
    throw new Error(`Public artifact bytes unavailable (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}
/** Exact local bytes must be the live protected-branch bytes. PR merged_at is the clock. */
async function publication(
  repo: string,
  path: string,
  bytes: Buffer,
  token?: string,
): Promise<Publication> {
  const commits = await github<{ sha: string }[]>(
    repo,
    `commits?sha=develop&path=${encodeURIComponent(path)}&per_page=1`,
    token,
  );
  if (commits.length !== 1 || !/^[a-f0-9]{40}$/.test(commits[0].sha))
    throw new Error("Publication commit unavailable");
  const commit = commits[0].sha;
  for (const ref of ["develop", commit]) {
    if (!(await publicBytes(repo, path, ref, token)).equals(bytes))
      throw new Error("Archive differs from public canonical bytes");
  }
  const pulls = await github<
    {
      number: number;
      merged_at: string | null;
      merge_commit_sha: string;
      head: { sha: string };
      state: string;
      base: { ref: string; repo: { full_name: string } };
    }[]
  >(repo, `commits/${commit}/pulls?per_page=100`, token);
  const candidates = pulls.filter(
    (p) =>
      p.merged_at &&
      p.base.ref === "develop" &&
      p.base.repo.full_name.toLowerCase() === repo.toLowerCase(),
  );
  if (candidates.length !== 1)
    throw new Error("Exact publication requires a merged protected-branch PR");
  const p = candidates[0];
  const ancestry = await github<{ status: string }>(
    repo,
    `compare/${commit}...${p.head.sha}`,
    token,
  );
  if (!["ahead", "identical"].includes(ancestry.status))
    throw new Error("Published source commit is not in the merged PR head");
  if (!(await publicBytes(repo, path, p.merge_commit_sha, token)).equals(bytes))
    throw new Error("Merged PR did not publish exact artifact bytes");
  if (!p.merged_at || !Number.isFinite(Date.parse(p.merged_at)))
    throw new Error("Verified PR merge time missing");
  return {
    path,
    sha256: sha(bytes),
    commit,
    pullRequest: p.number,
    mergedAt: p.merged_at,
  };
}
export async function verifyEscrowReview(input: {
  directory: string;
  proposal: EscrowReviewProposal;
  proposalSha256: string;
  stewardActorId: string;
  now: Date;
  token?: string;
}) {
  const repo = repository();
  const prefix = `cycles/${input.proposal.projectId}/${input.proposal.cycleId}/escrow-v2`;
  const decisionsBytes = await readFile(
    resolve(input.directory, "decisions.json"),
  );
  const archivedProject = assertProjectDefinition(
    JSON.parse(
      await readFile(resolve(input.directory, "project.json"), "utf8"),
    ),
  );
  if (archivedProject.id !== input.proposal.projectId)
    throw new Error("Archived project identity mismatch");
  const stewardActorIds = [
    input.stewardActorId,
    archivedProject.steward.github.actorId,
  ];
  const decisions = assertEscrowDecisions(
    JSON.parse(decisionsBytes.toString("utf8")),
    input.proposal,
    input.proposalSha256,
    stewardActorIds,
  );
  const publications: Publication[] = [];
  for (const name of [
    "source-snapshot.json",
    "github-identities.json",
    "project.json",
    "proposal.json",
    "decisions.json",
  ]) {
    publications.push(
      await publication(
        repo,
        `${prefix}/${name}`,
        await readFile(resolve(input.directory, name)),
        input.token,
      ),
    );
  }
  const start = Math.max(...publications.map((p) => Date.parse(p.mergedAt)));
  const reviewEndsAt = new Date(start + 14 * 86400000).toISOString();
  if (
    !Number.isFinite(input.now.getTime()) ||
    input.now.getTime() < Date.parse(reviewEndsAt)
  )
    throw new Error(
      "The exact public financial decisions have not completed 14 days of review",
    );
  const related = decisions.rows.filter(
    (r) =>
      r.relatedParty &&
      r.state === "approved" &&
      BigInt(r.approvedGrossMicro) > 0n,
  );
  let approvalPublication: Publication | null = null;
  if (related.length) {
    const bytes = await readFile(
      resolve(input.directory, "platform-approvals.json"),
    );
    const value = exact(JSON.parse(bytes.toString("utf8")), [
      "schemaVersion",
      "proposalSha256",
      "decisionsSha256",
      "approvals",
    ]);
    if (
      value.schemaVersion !== "1" ||
      value.proposalSha256 !== input.proposalSha256 ||
      value.decisionsSha256 !== sha(decisionsBytes) ||
      !Array.isArray(value.approvals) ||
      value.approvals.length !== related.length
    )
      throw new Error(
        "Separate related-party approvals must bind exact decisions",
      );
    approvalPublication = await publication(
      repo,
      `${prefix}/platform-approvals.json`,
      bytes,
      input.token,
    );
    const approvedActors = new Set<string>();
    for (const item of value.approvals) {
      const approval = exact(item, [
        "githubUserId",
        "reviewerId",
        "reviewer",
        "approvedAt",
        "pullRequest",
        "reviewId",
      ]);
      if (
        typeof approval.githubUserId !== "string" ||
        approvedActors.has(approval.githubUserId) ||
        !related.some((r) => r.githubUserId === approval.githubUserId) ||
        typeof approval.reviewerId !== "string" ||
        typeof approval.reviewer !== "string" ||
        typeof approval.approvedAt !== "string" ||
        !Number.isSafeInteger(approval.pullRequest) ||
        !Number.isSafeInteger(approval.reviewId)
      )
        throw new Error("Invalid separate platform approval");
      if (
        approval.reviewerId === approval.githubUserId ||
        stewardActorIds.includes(approval.reviewerId)
      )
        throw new Error(
          "Related-party approval requires an independent platform reviewer",
        );
      const pull = await github<{
        head: { sha: string };
        merged_at: string | null;
        merge_commit_sha: string;
        base: { ref: string; repo: { full_name: string } };
      }>(repo, `pulls/${approval.pullRequest}`, input.token);
      if (
        !pull.merged_at ||
        pull.base.ref !== "develop" ||
        pull.base.repo.full_name.toLowerCase() !== repo.toLowerCase()
      )
        throw new Error(
          "Platform approval PR must be merged into canonical develop",
        );
      // Approval PR must itself publish the exact decisions, preventing unrelated review reuse.
      if (
        !(
          await publicBytes(
            repo,
            `${prefix}/decisions.json`,
            pull.merge_commit_sha,
            input.token,
          )
        ).equals(decisionsBytes)
      )
        throw new Error("Approval PR does not bind financial decisions");
      const review = await github<GitHubReview>(
        repo,
        `pulls/${approval.pullRequest}/reviews/${approval.reviewId}`,
        input.token,
      );
      if (
        review.user.type !== "User" ||
        !review.body
          .split(/\r?\n/)
          .map((line) => line.trim())
          .includes(
            `slop-related-party-approval:v1 ${input.proposalSha256} ${sha(decisionsBytes)} ${approval.githubUserId}`,
          ) ||
        review.state !== "APPROVED" ||
        review.commit_id !== pull.head.sha ||
        String(review.user.id) !== approval.reviewerId ||
        review.user.login.toLowerCase() !== approval.reviewer.toLowerCase() ||
        review.submitted_at !== approval.approvedAt ||
        Date.parse(review.submitted_at) < Date.parse(reviewEndsAt) ||
        Date.parse(review.submitted_at) > input.now.getTime()
      )
        throw new Error(
          "Related-party review does not meet independent exact-head approval requirements",
        );
      const permission = await github<{
        permission: string;
        user: { id: number };
      }>(
        repo,
        `collaborators/${encodeURIComponent(review.user.login)}/permission`,
        input.token,
      );
      if (
        !["admin", "maintain", "write"].includes(permission.permission) ||
        String(permission.user.id) !== approval.reviewerId
      )
        throw new Error("Platform approver lacks current maintainer authority");
      approvedActors.add(approval.githubUserId);
    }
  }
  return {
    decisions,
    decisionsSha256: sha(decisionsBytes),
    reviewEndsAt,
    publications,
    approvalPublication,
  };
}

export async function verifyCurrentEscrowDeployment(input: {
  projectId: string;
  currentProject: unknown;
  archiveDirectory: string;
  token?: string;
}): Promise<Publication> {
  const path = `projects/${input.projectId}/project.json`;
  const bytes = await readFile(resolve(path));
  const current = assertProjectDefinition(JSON.parse(bytes.toString("utf8")));
  if (
    current.id !== input.projectId ||
    !isDeepStrictEqual(current, input.currentProject)
  )
    throw new Error(
      "Generated registry differs from the current canonical project manifest",
    );
  const archived = assertProjectDefinition(
    JSON.parse(
      await readFile(resolve(input.archiveDirectory, "project.json"), "utf8"),
    ),
  );
  if (
    !current.escrow ||
    !archived.escrow ||
    [
      "chain",
      "effectiveCycle",
      "feeMode",
      "feeBasisPoints",
      "withdrawalFeeBasisPoints",
    ].some(
      (key) =>
        current.escrow?.[key as keyof typeof current.escrow] !==
        archived.escrow?.[key as keyof typeof archived.escrow],
    )
  )
    throw new Error(
      "Current escrow financial policy differs from the reviewed archive",
    );
  return publication(repository(), path, bytes, input.token);
}
