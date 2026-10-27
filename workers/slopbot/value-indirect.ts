import { sameRepositoryCommitHints } from "./value-commit-hints";
import type { EvidenceClient, ValueEvidence } from "./value-evidence";
import {
  collectIndirectValueRetention,
  type IndirectRetainedFile,
} from "./value-indirect-retention";

type CommitChanges = NonNullable<ValueEvidence["mergeCommitEvidence"]>;
export interface IndirectValueAcceptance {
  historicalHeadSha: string;
  integrationSha: string;
  integrationParentSha: string;
  acceptedTipSha: string;
  branch: string;
  observedOnBranchAt: string;
  observationRunId: number;
  observationUrl: string;
  acceptedCommitShas: string[];
  alreadyPresentCommitShas: string[];
  laterCommitShas: string[];
  integrationFiles: CommitChanges["files"];
  retainedFiles: IndirectRetainedFile[];
}

/** Text supplies discovery hints only. Acceptance requires GitHub ancestry and
 * a push-triggered observation on the registry's integration branch. Preserve
 * the actual PR state; a workflow timestamp is not a fabricated merge event.
 */
export async function collectIndirectValueAcceptance(
  client: EvidenceClient,
  source: Pick<
    ValueEvidence,
    | "repository"
    | "repositoryNodeId"
    | "repositoryPolicy"
    | "pull"
    | "commits"
    | "comments"
  >,
  changes: (
    sha: string,
  ) => Promise<{ commit: CommitChanges | null; limitations: string[] }>,
): Promise<{
  acceptance: IndirectValueAcceptance | null;
  limitations: string[];
}> {
  const none = { acceptance: null, limitations: [] };
  if (
    source.pull.merged_at !== null ||
    source.pull.state !== "closed" ||
    !source.repositoryPolicy ||
    !source.pull.closed_at
  )
    return none;
  const closedAt = Date.parse(source.pull.closed_at);
  const texts = source.comments
    .filter((c) => /\b(?:merged?|integrat(?:ed|ion))\b/iu.test(c.body))
    .map((c) => c.body);
  const hints = [
    ...new Set(
      texts.flatMap((text) =>
        sameRepositoryCommitHints(source.repository, text).filter((s) =>
          /[a-f]/u.test(s),
        ),
      ),
    ),
  ];
  if (!hints.length) return none;
  const unresolved = (reason: string) => ({
    acceptance: null,
    limitations: [`Indirect integration: ${reason}`],
  });
  if (hints.length > 16 || source.commits.length > 100)
    return unresolved(
      "discovery bounds reached; complete reconciliation required",
    );
  const root = `/repos/${source.repository}`;
  const branch = source.repositoryPolicy.integrationBranch;
  const candidates: CommitChanges[] = [];
  for (const hint of hints) {
    let c: CommitChanges | null;
    try {
      c = await client.get<CommitChanges>(
        `${root}/commits/${hint}?per_page=100&page=1`,
      );
    } catch {
      // Prose can contain non-commit digests. Keep the PR evidence, but do
      // not infer acceptance when a discovery request could not resolve.
      return unresolved(`commit hint ${hint} could not be resolved`);
    }
    if (!c) return unresolved(`commit hint ${hint} could not be resolved`);
    if (
      !/^[a-f0-9]{40}$/u.test(c.sha) ||
      !c.sha.startsWith(hint) ||
      !Array.isArray(c.parents)
    )
      return unresolved("commit identity is incomplete");
    if (!candidates.some((v) => v.sha === c.sha)) candidates.push(c);
  }
  const known = new Set(source.commits.map((c) => c.sha));
  const integrations = candidates.filter(
    (c) => c.parents.length === 2 && known.has(c.parents[1].sha),
  );
  if (!integrations.length) return none;
  const current = await client.get<{ name: string; commit: { sha: string } }>(
    `${root}/branches/${encodeURIComponent(branch)}`,
  );
  if (
    current?.name !== branch ||
    !/^[a-f0-9]{40}$/u.test(current.commit?.sha ?? "")
  )
    return unresolved("registered integration branch is unavailable");
  const comparisons = new Map<string, boolean>();
  async function ancestor(a: string, b: string) {
    const key = `${a}...${b}`;
    const cached = comparisons.get(key);
    if (cached !== undefined) return cached;
    const comparison = await client.get<{
      status: string;
      merge_base_commit: { sha: string };
    }>(`${root}/compare/${key}?per_page=1`);
    if (!comparison?.merge_base_commit?.sha)
      throw new Error("Indirect acceptance ancestry is unavailable");
    const result =
      ["ahead", "identical"].includes(comparison.status) &&
      comparison.merge_base_commit.sha === a;
    comparisons.set(key, result);
    return result;
  }
  type Run = {
    id: number;
    html_url: string;
    event: string;
    head_branch: string;
    head_sha: string;
    created_at: string;
    repository: { node_id: string };
  };
  const observations: { tip: string; run: Run }[] = [];
  for (const candidate of candidates) {
    if (!(await ancestor(candidate.sha, current.commit.sha))) continue;
    const runs = await client.get<{
      total_count: number;
      workflow_runs: Run[];
    }>(
      `${root}/actions/runs?head_sha=${candidate.sha}&event=push&branch=${encodeURIComponent(branch)}&per_page=100&page=1`,
    );
    if (
      !runs ||
      !Number.isSafeInteger(runs.total_count) ||
      runs.total_count !== runs.workflow_runs.length
    )
      return unresolved("branch observation inventory is incomplete");
    for (const run of runs.workflow_runs) {
      if (
        run.repository?.node_id !== source.repositoryNodeId ||
        run.event !== "push" ||
        run.head_branch !== branch ||
        run.head_sha !== candidate.sha ||
        !Number.isSafeInteger(run.id) ||
        run.id <= 0 ||
        run.html_url !==
          `https://github.com/${source.repository}/actions/runs/${run.id}` ||
        !Number.isFinite(Date.parse(run.created_at))
      )
        return unresolved("branch observation identity is invalid");
      if (Date.parse(run.created_at) <= closedAt)
        observations.push({ tip: candidate.sha, run });
    }
  }
  observations.sort(
    (a, b) =>
      a.run.created_at.localeCompare(b.run.created_at) || a.run.id - b.run.id,
  );
  const proofs: Omit<IndirectValueAcceptance, "retainedFiles">[] = [];
  for (const integration of integrations) {
    let observed: (typeof observations)[number] | undefined;
    for (const observation of observations)
      if (await ancestor(integration.sha, observation.tip)) {
        observed = observation;
        break;
      }
    if (!observed) continue;
    const complete = await changes(integration.sha);
    if (!complete.commit || complete.limitations.length)
      return unresolved("integration file scope is incomplete");
    if (
      complete.commit.parents.length !== 2 ||
      complete.commit.parents.some(
        (p, i) => p.sha !== integration.parents[i].sha,
      )
    )
      return unresolved("integration parents changed");
    const acceptedCommitShas: string[] = [],
      alreadyPresentCommitShas: string[] = [],
      laterCommitShas: string[] = [];
    for (const commit of source.commits.filter((c) => c.parents.length <= 1)) {
      if (!(await ancestor(commit.sha, integration.parents[1].sha)))
        laterCommitShas.push(commit.sha);
      else if (await ancestor(commit.sha, integration.parents[0].sha))
        alreadyPresentCommitShas.push(commit.sha);
      else acceptedCommitShas.push(commit.sha);
    }
    if (!acceptedCommitShas.length) continue;
    proofs.push({
      historicalHeadSha: integration.parents[1].sha,
      integrationSha: integration.sha,
      integrationParentSha: integration.parents[0].sha,
      acceptedTipSha: observed.tip,
      branch,
      observedOnBranchAt: observed.run.created_at,
      observationRunId: observed.run.id,
      observationUrl: observed.run.html_url,
      acceptedCommitShas: acceptedCommitShas.sort(),
      alreadyPresentCommitShas: alreadyPresentCommitShas.sort(),
      laterCommitShas: laterCommitShas.sort(),
      integrationFiles: complete.commit.files,
    });
  }
  if (proofs.length !== 1)
    return unresolved(
      proofs.length
        ? "multiple historical integrations require reconciliation"
        : "no complete branch observation proves the historical integration",
    );
  const proof = proofs[0];
  const retainedFiles = await collectIndirectValueRetention(
    client,
    source.repository,
    proof.historicalHeadSha,
    proof.acceptedTipSha,
    proof.integrationFiles,
  );
  if (retainedFiles === null)
    return unresolved("complete retained-content comparison is unavailable");
  return { acceptance: { ...proof, retainedFiles }, limitations: [] };
}
