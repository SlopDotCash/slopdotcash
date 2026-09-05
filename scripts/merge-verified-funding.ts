/** Runs only from trusted develop. PR objects are data, never executable input. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";
import {
  canonicalFundingDecisionBytes,
  checkFundingRecordPr,
} from "./check-funding-record-pr";
import {
  assertFundingMergeDecision,
  assertFundingMergeProtection,
  FUNDING_MERGE_POLICY_VERSION,
  type FundingMergeProtection,
} from "./funding-merge-policy";

interface PullRequest {
  number: number;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  mergeable_state: string;
  merge_commit_sha: string | null;
  base: { ref: string; sha: string; repo: { full_name: string } };
  head: { sha: string };
  user: { login: string };
  labels: unknown[];
  assignees: unknown[];
  requested_reviewers: unknown[];
  requested_teams: unknown[];
}
interface Review {
  id: number;
  user: { id: number; login: string };
  state: string;
  commit_id: string;
}
interface CheckRun {
  status: string;
  conclusion: string | null;
  name: string;
}
interface WorkflowRun {
  id: number;
  head_sha: string;
  event: string;
  status: string;
  conclusion: string | null;
  path: string;
  pull_requests: { number: number }[];
}

export async function mergeVerifiedFunding(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const token = process.env.GITHUB_TOKEN;
  const log = process.env.FUNDING_MERGE_LOG;
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) ||
    !token ||
    !log ||
    process.env.GITHUB_REF !== "refs/heads/develop" ||
    process.env.SLOP_FUNDING_AUTOMERGE_ENABLED !== "true"
  ) {
    throw new Error(
      "Trusted develop workflow and explicit activation required",
    );
  }
  const git = (...args: string[]) =>
    execFileSync("git", ["--no-replace-objects", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    }).trim();
  const baseSha = git("rev-parse", "HEAD");
  const api = async <T>(path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`https://api.github.com/${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
    return (response.status === 204 ? null : await response.json()) as T;
  };
  const prefix = `repos/${repository}`;
  const evidence = async (value: unknown) => {
    await appendFile(log, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  };
  const guard = async (number: number, headSha: string) => {
    const pr = await api<PullRequest>(`${prefix}/pulls/${number}`);
    const branch = await api<{ object: { sha: string } }>(
      `${prefix}/git/ref/heads/develop`,
    );
    if (
      branch.object.sha !== baseSha ||
      pr.base.sha !== baseSha ||
      pr.head.sha !== headSha ||
      pr.base.ref !== "develop" ||
      pr.base.repo.full_name !== repository ||
      pr.state !== "open" ||
      pr.merged ||
      pr.draft ||
      pr.mergeable !== true ||
      !pr.merge_commit_sha ||
      pr.user.login === "github-actions[bot]" ||
      pr.labels.length ||
      pr.assignees.length ||
      pr.requested_reviewers.length ||
      pr.requested_teams.length
    ) {
      throw new Error("PR changed, has human gates, or is not mergeable");
    }
    const [owner, name] = repository.split("/");
    const result = await api<{
      errors?: unknown[];
      data: {
        repository: {
          defaultBranchRef: {
            name: string;
            branchProtectionRule: FundingMergeProtection | null;
          };
          pullRequest: {
            reviewThreads: {
              nodes: { isResolved: boolean }[];
              pageInfo: { hasNextPage: boolean };
            };
          };
        };
      };
    }>("graphql", "POST", {
      query: `query($owner:String!,$name:String!,$number:Int!) {
        repository(owner:$owner,name:$name) {
          defaultBranchRef { name branchProtectionRule {
            requiresStatusChecks requiresStrictStatusChecks requiredStatusCheckContexts
            isAdminEnforced requiresApprovingReviews requiredApprovingReviewCount
            dismissesStaleReviews requiresConversationResolution allowsForcePushes
            allowsDeletions bypassPullRequestAllowances(first:1) { totalCount }
          } }
          pullRequest(number:$number) { reviewThreads(first:100) {
            nodes { isResolved } pageInfo { hasNextPage }
          } }
        }
      }`,
      variables: { owner, name, number },
    });
    if (result.errors?.length) throw new Error("GitHub authority query failed");
    const authority = result.data.repository;
    if (authority.defaultBranchRef.name !== "develop")
      throw new Error("Default branch changed");
    assertFundingMergeProtection(
      authority.defaultBranchRef.branchProtectionRule,
    );
    const threads = authority.pullRequest.reviewThreads;
    if (
      threads.pageInfo.hasNextPage ||
      threads.nodes.some((t) => !t.isResolved)
    )
      throw new Error("Unresolved or truncated review threads");
    const reviews = await api<Review[]>(
      `${prefix}/pulls/${number}/reviews?per_page=100`,
    );
    if (reviews.length >= 100) throw new Error("Truncated reviews");
    const latest = new Map<number, Review>();
    for (const review of reviews.sort((a, b) => a.id - b.id)) {
      if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state))
        latest.set(review.user.id, review);
    }
    if ([...latest.values()].some((r) => r.state === "CHANGES_REQUESTED"))
      throw new Error("A reviewer requested changes");
    // Native strict protection closes the base-update race at the merge API.
    // Independently prove the full quality workflow belongs to this exact head.
    const runs = await api<{ workflow_runs: WorkflowRun[] }>(
      `${prefix}/actions/workflows/deploy.yml/runs?event=pull_request&head_sha=${headSha}&per_page=100`,
    );
    const run = runs.workflow_runs.sort((a, b) => b.id - a.id)[0];
    if (
      !run ||
      run.head_sha !== headSha ||
      run.event !== "pull_request" ||
      run.path !== ".github/workflows/deploy.yml" ||
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      !run.pull_requests.some((p) => p.number === number)
    ) {
      throw new Error("Exact-head quality workflow has not passed");
    }
    for (const sha of new Set([headSha, pr.merge_commit_sha])) {
      const checks = await api<{ total_count: number; check_runs: CheckRun[] }>(
        `${prefix}/commits/${sha}/check-runs?filter=latest&per_page=100`,
      );
      const statuses = await api<{ total_count: number; state: string }>(
        `${prefix}/commits/${sha}/status?per_page=100`,
      );
      if (
        checks.total_count > checks.check_runs.length ||
        statuses.total_count >= 100 ||
        (statuses.total_count > 0 && statuses.state !== "success") ||
        checks.check_runs.some(
          (check) =>
            check.status !== "completed" ||
            (check.conclusion !== "success" &&
              !(
                check.name === "Deploy trusted production bundle" &&
                check.conclusion === "skipped"
              )),
        )
      ) {
        throw new Error("Checks are incomplete, truncated, or not green");
      }
    }
    return { pr, reviews: [...latest.values()], qualityRunId: run.id };
  };

  const candidates = await api<PullRequest[]>(
    `${prefix}/pulls?state=open&base=develop&sort=created&direction=asc&per_page=100`,
  );
  if (candidates.length >= 100) throw new Error("Open PR inventory truncated");
  for (const candidate of candidates) {
    const number = candidate.number;
    const headSha = candidate.head.sha;
    if (
      !Number.isSafeInteger(number) ||
      number < 1 ||
      !/^[a-f0-9]{40}$/u.test(headSha)
    )
      throw new Error("Invalid GitHub PR identity");
    let mergeAttempted = false;
    try {
      git("fetch", "--no-tags", "origin", `refs/pull/${number}/head`);
      if (git("rev-parse", "FETCH_HEAD") !== headSha)
        throw new Error("Fetched head changed");
      const decision = await checkFundingRecordPr({
        baseSha,
        headSha,
        pullRequestNumber: number,
      });
      await evidence({ policy: FUNDING_MERGE_POLICY_VERSION, decision });
      const assertDecision = () =>
        assertFundingMergeDecision(decision, {
          baseSha,
          headSha,
          number,
          now: Date.now(),
        });
      assertDecision();
      const before = await guard(number, headSha);
      const decisionHash = createHash("sha256")
        .update(canonicalFundingDecisionBytes(decision))
        .digest("hex");
      if (
        !before.reviews.some(
          (r) =>
            r.user.login === "github-actions[bot]" &&
            r.state === "APPROVED" &&
            r.commit_id === headSha,
        )
      ) {
        assertDecision();
        await api(`${prefix}/pulls/${number}/reviews`, "POST", {
          event: "APPROVE",
          commit_id: headSha,
          body: `${FUNDING_MERGE_POLICY_VERSION}: repository-authorized funding-only review.\n\nBase: ${baseSha}\nHead: ${headSha}\nDecision SHA-256: ${decisionHash}\nQuality run: ${before.qualityRunId}\n\n${decision.records.map((r) => `${r.recordBytesSha256}: ${r.verifierVersion}; output SHA-256 ${r.verifierOutputSha256}`).join("\n")}\n\nRead-only chain evidence; no wallet control, signing, payment, or deployment approval. Full decision retained in this automation run.`,
        });
      }
      const final = await guard(number, headSha);
      assertDecision();
      if (final.pr.mergeable_state !== "clean")
        throw new Error(
          "GitHub has not confirmed all protected merge requirements",
        );
      mergeAttempted = true;
      const merged = await api<{ merged: boolean; sha: string }>(
        `${prefix}/pulls/${number}/merge`,
        "PUT",
        { sha: headSha, merge_method: "merge" },
      );
      if (!merged.merged || !/^[a-f0-9]{40}$/u.test(merged.sha))
        throw new Error("GitHub did not confirm the merge");
      const readback = await api<PullRequest>(`${prefix}/pulls/${number}`);
      const commit = await api<{ parents: { sha: string }[] }>(
        `${prefix}/git/commits/${merged.sha}`,
      );
      if (
        !readback.merged ||
        readback.head.sha !== headSha ||
        readback.merge_commit_sha !== merged.sha ||
        commit.parents.length !== 2 ||
        commit.parents[0].sha !== baseSha ||
        commit.parents[1].sha !== headSha
      ) {
        throw new Error(
          "Merged PR or merge-parent readback differs from verification",
        );
      }
      await evidence({
        number,
        baseSha,
        headSha,
        mergeSha: merged.sha,
        decisionHash,
      });
      // GITHUB_TOKEN merges do not trigger push workflows. Dispatch the normal
      // develop workflow explicitly; its designated production reviewer remains.
      await api(`${prefix}/actions/workflows/deploy.yml/dispatches`, "POST", {
        ref: "develop",
      });
      await evidence({ number, productionWorkflowDispatched: true });
      return; // One merge per run: never reuse verification across a new base.
    } catch (error) {
      await evidence({
        number,
        headSha,
        mergeAttempted,
        refused: error instanceof Error ? error.message : "Unknown failure",
      });
      if (mergeAttempted) throw error;
    }
  }
}

if (import.meta.main) await mergeVerifiedFunding();
