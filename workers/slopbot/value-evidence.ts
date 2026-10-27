import { isCreditEligibleCommitAuthor } from "../../src/lib/commit-credit";
import {
  findRegisteredRepositoryById,
  type TargetRepository,
} from "../../src/lib/repositories.mjs";
import {
  type AcceptedValueRange,
  collectAcceptedValueRange,
} from "./value-accepted-range";
import {
  type AddedBinaryProof,
  addedBinaryRecovery,
  binarySourceLimitations,
  needsAddedBinaryProof,
} from "./value-binary";
import {
  collectBranchPolicy,
  matchesHistoricalIntegrationBranch,
  type ValueBranchPolicy,
} from "./value-branch-policy";
import { githubLinkDestinations } from "./value-commit-hints";
import {
  needsFullValueComparison,
  needsRemovedValueComparison,
  recoverFullValueComparisons,
  recoverRemovedValueComparisons,
  recoverUnchangedValueRenames,
} from "./value-file-comparisons";
import {
  collectIndirectValueAcceptance,
  type IndirectValueAcceptance,
} from "./value-indirect";
import type { ValueMergeResolution } from "./value-merge-resolution";
import {
  addedValuePatchRecovery,
  hasCompleteValuePatch,
  valueDeletionCount,
  valuePatch,
} from "./value-patch";
import {
  type AcceptedPatchReplay,
  collectAcceptedPatchReplay,
} from "./value-patch-replay";
import {
  collectRetainedMergeReferences,
  type RetainedMergeReference,
} from "./value-retained-reference";

// Shared by the installation worker and the historical reviewer. Missing or
// moving evidence prevents assessment; pagination limits never imply coverage.
export interface EvidenceClient {
  get<T>(path: string): Promise<T | null>;
  graphql?<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}
interface Actor {
  node_id: string;
  login: string;
  type: string;
}
interface Pull {
  node_id: string;
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  user: Actor;
  merged_by: Actor | null;
  state: string;
  merged_at: string | null;
  closed_at: string | null;
  merge_commit_sha: string | null;
  updated_at: string;
  head: { sha: string };
  base: { sha: string; ref: string };
  changed_files: number;
  comments: number;
  review_comments: number;
  commits: number;
}
interface Review {
  node_id: string;
  id: number;
  html_url: string;
  body: string;
  user: Actor | null;
  submitted_at: string | null;
  state: string;
  commit_id: string;
}
interface Comment {
  node_id: string;
  html_url: string;
  body: string;
  user: Actor | null;
  created_at: string;
  updated_at: string;
  pull_request_review_id?: number;
}
export interface FileChange {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  blob_url: string | null;
  fullComparison?: {
    baseSha: string;
    headSha: string;
    before: { blobSha: string; text: string };
    after: { blobSha: string; text: string };
  };
  removedComparison?: {
    baseSha: string;
    headSha: string;
    before: { blobSha: string; text: string };
  };
  unchangedRename?: { baseSha: string; headSha: string; blobSha: string };
  addedBinary?: AddedBinaryProof;
}
interface Commit {
  sha: string;
  html_url: string;
  author: Actor | null;
  committer: Actor | null;
  parents: { sha: string }[];
  commit: {
    message: string;
    author: { date: string };
    committer: { date: string };
  };
}
interface CommitChangeEvidence {
  sha: string;
  html_url: string;
  parents: { sha: string }[];
  stats: { additions: number; deletions: number; total: number };
  files: FileChange[];
}
function fileChange({
  filename,
  previous_filename,
  status,
  additions,
  deletions,
  patch,
  blob_url,
  sha,
}: FileChange & { sha?: string }): FileChange {
  // GitHub omits patches for empty added files. This known Git object has
  // exactly zero bytes; zero line counts alone could also describe a binary.
  if (
    patch === undefined &&
    status === "added" &&
    additions === 0 &&
    deletions === 0 &&
    sha === "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"
  )
    patch = "";
  return {
    filename,
    ...(previous_filename === undefined ? {} : { previous_filename }),
    status,
    additions,
    deletions,
    ...(patch === undefined ? {} : { patch }),
    blob_url,
  };
}
function changeBytes(files: FileChange[]): string {
  return JSON.stringify(
    [...files]
      .sort((left, right) => left.filename.localeCompare(right.filename))
      .map((file) => [
        file.filename,
        file.previous_filename ?? null,
        file.status,
        file.additions,
        valueDeletionCount(file),
        valuePatch(file) ?? null,
        file.fullComparison
          ? [
              file.fullComparison.before.blobSha,
              file.fullComparison.after.blobSha,
            ]
          : null,
        // Keep every old text-only signature byte-identical.
        ...(file.addedBinary
          ? [
              [
                file.addedBinary.mode,
                file.addedBinary.blobSha,
                file.addedBinary.size,
                file.addedBinary.sha256,
              ],
            ]
          : []),
      ]),
  );
}
function actor({ node_id, login, type }: Actor): Actor {
  return { node_id, login, type };
}
function comment({
  node_id,
  html_url,
  body,
  user,
  created_at,
  updated_at,
  pull_request_review_id,
}: Comment): Comment {
  return {
    node_id,
    html_url,
    body,
    user: user === null ? null : actor(user),
    created_at,
    updated_at,
    ...(pull_request_review_id === undefined ? {} : { pull_request_review_id }),
  };
}
/** The commit endpoint has a separate file pagination contract and cap. */
async function collectCommitChanges(
  client: EvidenceClient,
  root: string,
  sha: string,
  label: string,
) {
  let commit: CommitChangeEvidence | null = null;
  const limitations: string[] = [];
  for (let page = 1; ; page++) {
    const batch = await client.get<CommitChangeEvidence>(
      `${root}/commits/${sha}?per_page=100&page=${page}`,
    );
    if (!batch || batch.sha !== sha) {
      limitations.push(`${label} evidence is unavailable`);
      break;
    }
    if (commit === null) {
      commit = {
        sha: batch.sha,
        html_url: batch.html_url,
        parents: batch.parents.map(({ sha }) => ({ sha })),
        stats: { ...batch.stats },
        files: [],
      };
    }
    commit.files.push(...batch.files.map(fileChange));
    if (commit.files.length >= 3000) {
      limitations.push(`${label} file limit reached; Git evidence required`);
      break;
    }
    if (batch.files.length < 100) break;
  }
  if (commit !== null) {
    if (
      new Set(commit.files.map((file) => file.filename)).size !==
      commit.files.length
    )
      limitations.push(`${label} contains repeated file paths`);
    if (commit.parents.length > 0 && limitations.length === 0) {
      await recoverRemovedValueComparisons(
        client,
        root.slice("/repos/".length),
        commit.files,
        commit.parents[0].sha,
        commit.sha,
      );
    }
    for (const kind of ["additions", "deletions"] as const)
      if (
        commit.files.reduce(
          (sum, file) =>
            sum +
            (kind === "deletions" ? valueDeletionCount(file) : file.additions),
          0,
        ) !== commit.stats[kind]
      )
        limitations.push(`Incomplete ${label.toLowerCase()} ${kind}`);
  }
  if (
    commit !== null &&
    commit.parents.length === 1 &&
    limitations.length === 0
  ) {
    await recoverFullValueComparisons(
      client,
      root.slice("/repos/".length),
      commit.files.filter((file) =>
        /(^|\/)package\.json$/u.test(file.filename),
      ),
      commit.parents[0].sha,
      commit.sha,
    );
  }
  return { commit, limitations };
}
export interface CommitAttribution {
  sha: string;
  actorNodeIds: string[];
  changedPaths: string[] | null;
  // Private source evidence for retained-copy reconciliation. Paths alone
  // cannot establish which original changes survived a cherry-pick.
  files?: FileChange[];
  limitations: string[];
}
interface RelatedPullRequest {
  id: string;
  number: number;
  url: string;
  repository: string;
}
async function relatedPullRequests(
  client: EvidenceClient,
  repository: string,
  number: number,
  pullId: string,
  sourceTexts: readonly string[],
) {
  const references = new Map<string, RelatedPullRequest>();
  const limitations: string[] = [];
  if (!client.graphql)
    return {
      references: [],
      limitations: ["Related PR evidence is unavailable"],
    };
  const [owner, name] = repository.split("/");
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const result: {
      repository: {
        pullRequest: {
          id: string;
          timelineItems: {
            nodes: {
              source: {
                __typename: string;
                id?: string;
                number?: number;
                url?: string;
                repository?: { nameWithOwner: string; isPrivate: boolean };
              };
            }[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        } | null;
      } | null;
    } = await client.graphql(
      `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){id timelineItems(first:100,after:$cursor,itemTypes:[CROSS_REFERENCED_EVENT]){nodes{... on CrossReferencedEvent{source{__typename ... on PullRequest{id number url repository{nameWithOwner isPrivate}}}}}pageInfo{hasNextPage endCursor}}}} rateLimit{cost limit remaining resetAt}}`,
      { owner, name, number, cursor },
    );
    const pull = result.repository?.pullRequest;
    if (!pull || pull.id !== pullId) {
      limitations.push("Related PR evidence is unavailable");
      break;
    }
    for (const { source } of pull.timelineItems.nodes) {
      if (source.__typename !== "PullRequest") continue;
      if (source.repository?.isPrivate !== false) {
        limitations.push("Related private PR evidence is withheld");
        continue;
      }
      if (
        !source.id ||
        typeof source.number !== "number" ||
        !Number.isSafeInteger(source.number) ||
        source.number <= 0 ||
        source.url !==
          `https://github.com/${source.repository.nameWithOwner}/pull/${source.number}`
      )
        throw new Error("Invalid related PR identity");
      references.set(source.id, {
        id: source.id,
        number: source.number,
        url: source.url,
        repository: source.repository.nameWithOwner,
      });
    }
    const page = pull.timelineItems.pageInfo;
    if (!page.hasNextPage) break;
    if (!page.endCursor || cursors.has(page.endCursor))
      throw new Error("Related PR pagination did not advance");
    cursors.add(page.endCursor);
    cursor = page.endCursor;
  }
  // Timeline events point from a referenced PR back to its source. Resolve
  // outgoing references too: a replacement often names the original only in
  // its own body or review discussion. Text is a discovery hint, not proof of
  // duplication; GitHub supplies the immutable identity and visibility.
  const candidates = new Map<string, { repository: string; number: number }>();
  for (const text of sourceTexts) {
    // Link destinations own the reference scope. In release notes, a label
    // such as #412 may point to an upstream repository rather than this one.
    // owner/repo starts only at a name boundary, so each run is read once.
    const referencesText = githubLinkDestinations(text);
    for (const match of referencesText.matchAll(
      /https:\/\/(?:redirect\.)?github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(?:pull|issues)\/(\d+)\b|(?<![\w/])(?:(?<![.-])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)[ \t]*)?#(\d+)\b/gu,
    )) {
      const targetRepository = match[1] ?? match[3] ?? repository;
      const targetNumber = Number(match[2] ?? match[4]);
      if (!Number.isSafeInteger(targetNumber) || targetNumber <= 0) continue;
      if (
        targetRepository.toLowerCase() === repository.toLowerCase() &&
        targetNumber === number
      )
        continue;
      candidates.set(`${targetRepository.toLowerCase()}#${targetNumber}`, {
        repository: targetRepository,
        number: targetNumber,
      });
    }
  }
  for (const target of candidates.values()) {
    if (
      [...references.values()].some(
        (entry) =>
          entry.repository.toLowerCase() === target.repository.toLowerCase() &&
          entry.number === target.number,
      )
    )
      continue;
    const [targetOwner, targetName] = target.repository.split("/");
    const result = await client
      .graphql<{
        repository: {
          isPrivate: boolean;
          nameWithOwner: string;
          issueOrPullRequest: {
            __typename: string;
            id?: string;
            number?: number;
            url?: string;
          } | null;
        } | null;
      }>(
        `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){isPrivate nameWithOwner issueOrPullRequest(number:$number){__typename ... on PullRequest{id number url}}}}`,
        { owner: targetOwner, name: targetName, number: target.number },
      )
      .catch(() => null);
    // Failed discovery is retained as an explicit gap, never an empty success.
    const repo = result?.repository;
    if (!repo || repo.isPrivate !== false) {
      limitations.push("Outgoing reference is unavailable or private");
      continue;
    }
    const referenced = repo.issueOrPullRequest;
    if (!referenced) {
      limitations.push(
        `Outgoing reference is unavailable: ${target.repository}#${target.number}`,
      );
      continue;
    }
    if (referenced.__typename !== "PullRequest") continue;
    if (
      !referenced.id ||
      referenced.number !== target.number ||
      referenced.url !==
        `https://github.com/${repo.nameWithOwner}/pull/${target.number}`
    )
      throw new Error("Invalid outgoing PR identity");
    references.set(referenced.id, {
      id: referenced.id,
      number: target.number,
      url: referenced.url,
      repository: repo.nameWithOwner,
    });
  }
  return {
    references: [...references.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    limitations: [...new Set(limitations)],
  };
}
/** True when `id` names the repository or one of its aliases, ignoring case. */
export function namesRepository(
  repository: Pick<TargetRepository, "id" | "aliases">,
  id: string,
): boolean {
  const key = id.toLowerCase();
  return [repository.id, ...repository.aliases].some(
    (name) => name.toLowerCase() === key,
  );
}
/** The registered repository that `id` names, ignoring case. */
export function findRepository(
  repositories: readonly TargetRepository[],
  id: string,
): TargetRepository | undefined {
  return repositories.find((repository) => namesRepository(repository, id));
}
/** Captured attribution policy must match the independently selected registry.
 * A matching source digest alone does not establish project authority.
 */
export function valueEvidenceMatchesRepository(
  evidence: ValueEvidence,
  repository: TargetRepository,
): boolean {
  const policy = evidence.repositoryPolicy;
  return (
    policy !== null &&
    namesRepository(repository, evidence.repository) &&
    policy.id === repository.id &&
    policy.projectId === repository.projectId &&
    policy.integrationBranch === repository.integrationBranch &&
    policy.expectedNodeId === repository.expectedNodeId &&
    (repository.expectedNodeId === null ||
      repository.expectedNodeId === evidence.repositoryNodeId)
  );
}

export interface ValueEvidence {
  repository: string;
  repositoryPolicy: Pick<
    TargetRepository,
    "id" | "projectId" | "integrationBranch" | "expectedNodeId"
  > | null;
  repositoryNodeId: string;
  repositoryDatabaseId: number;
  collectedAt: string;
  pull: Pull;
  files: FileChange[];
  mergeCommitEvidence: CommitChangeEvidence | null;
  acceptedRange?: AcceptedValueRange;
  acceptedPatchReplay?: AcceptedPatchReplay;
  indirectAcceptance?: IndirectValueAcceptance;
  commits: Commit[];
  reviews: Review[];
  comments: Comment[];
  reviewComments: Comment[];
  limitations: string[];
  evidenceUrls: string[];
  eligibleReviewIds: string[];
  implementationActorNodeIds: string[];
  historicalBranchPolicy?: ValueBranchPolicy;
  commitAttribution: CommitAttribution[];
  mergeResolutions?: ValueMergeResolution[];
  retainedMergeReferences?: RetainedMergeReference[];
  relatedPullRequests: RelatedPullRequest[];
  contextFiles?: {
    path: string;
    ref: string;
    blobSha: string;
    text: string;
    url: string;
  }[];
}
async function pages<T>(client: EvidenceClient, path: string): Promise<T[]> {
  const values: T[] = [];
  for (let page = 1; ; page++) {
    const batch = await client.get<T[]>(`${path}?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error(`Evidence unavailable: ${path}`);
    values.push(...batch);
    if (batch.length < 100) return values;
  }
}
/** The PR commits route stops at 250. The immutable comparison paginates the
 * complete range; reconcile it with both the reported count and observed IDs.
 */
async function pullCommits(
  client: EvidenceClient,
  root: string,
  path: string,
  pull: Pull,
): Promise<Commit[]> {
  const observed = await pages<Commit>(client, `${path}/commits`);
  if (observed.length >= pull.commits) return observed;
  const complete: Commit[] = [];
  const ids = new Set<string>();
  for (let page = 1; page <= Math.ceil(pull.commits / 100); page++) {
    const batch = await client.get<{
      total_commits: number;
      commits: Commit[];
    }>(
      `${root}/compare/${pull.base.sha}...${pull.head.sha}?per_page=100&page=${page}`,
    );
    if (
      !batch ||
      batch.total_commits !== pull.commits ||
      !Array.isArray(batch.commits)
    )
      throw new Error(
        "Comparison cannot reconcile the reported PR commit count",
      );
    for (const commit of batch.commits) {
      if (!/^[a-f0-9]{40}$/u.test(commit.sha) || ids.has(commit.sha))
        throw new Error("Comparison contains an invalid or repeated commit");
      ids.add(commit.sha);
      complete.push(commit);
    }
  }
  if (
    complete.length !== pull.commits ||
    observed.some((commit) => !ids.has(commit.sha))
  )
    throw new Error(
      "Comparison commit range does not cover the observed PR commits",
    );
  return complete;
}

export async function collectValueEvidence(
  client: EvidenceClient,
  repository: string,
  number: number,
  repositoryPolicy: TargetRepository | null = findRegisteredRepositoryById(
    repository,
  ),
): Promise<ValueEvidence> {
  if (
    !/^[\w.-]+\/[\w.-]+$/u.test(repository) ||
    !Number.isSafeInteger(number) ||
    number < 1
  )
    throw new Error("Invalid PR identity");
  const root = `/repos/${repository}`;
  const repositoryIdentity = await client.get<{ id: number; node_id: string }>(
    root,
  );
  if (!repositoryIdentity) throw new Error("Repository identity unavailable");
  if (
    repositoryPolicy !== null &&
    (!namesRepository(repositoryPolicy, repository) ||
      (repositoryPolicy.expectedNodeId !== null &&
        repositoryPolicy.expectedNodeId !== repositoryIdentity.node_id))
  )
    throw new Error("Repository policy does not match the evidence source");
  const path = `${root}/pulls/${number}`;
  const rawPull = await client.get<Pull>(path);
  if (!rawPull) throw new Error("Pull request unavailable");
  const {
    node_id,
    number: prNumber,
    html_url,
    title,
    body,
    user,
    merged_by,
    state,
    merged_at,
    closed_at,
    merge_commit_sha,
    updated_at,
    head,
    base,
    changed_files,
    comments: commentCount,
    review_comments,
    commits: commitCount,
  } = rawPull;
  const pull: Pull = {
    node_id,
    number: prNumber,
    html_url,
    title,
    body,
    user: actor(user),
    merged_by: merged_by === null ? null : actor(merged_by),
    state,
    merged_at,
    closed_at,
    merge_commit_sha,
    updated_at,
    head: { sha: head.sha },
    base: { sha: base.sha, ref: base.ref },
    changed_files,
    comments: commentCount,
    review_comments,
    commits: commitCount,
  };
  const [rawFiles, rawCommits, rawReviews, rawComments, rawReviewComments] =
    await Promise.all([
      pages<FileChange>(client, `${path}/files`),
      pullCommits(client, root, path, pull),
      pages<Review>(client, `${path}/reviews`),
      pages<Comment>(client, `${root}/issues/${number}/comments`),
      pages<Comment>(client, `${path}/comments`),
    ]);
  const files = rawFiles.map(fileChange);
  const commits = rawCommits.map(
    ({ sha, html_url, commit, author, committer, parents }) => ({
      sha,
      html_url,
      author: author === null ? null : actor(author),
      committer: committer === null ? null : actor(committer),
      parents: parents.map(({ sha }) => ({ sha })),
      commit: {
        message: commit.message,
        author: { date: commit.author.date },
        committer: { date: commit.committer.date },
      },
    }),
  );
  const reviews = rawReviews.map(
    ({
      node_id,
      id,
      html_url,
      body,
      user,
      submitted_at,
      state,
      commit_id,
    }) => ({
      node_id,
      id,
      html_url,
      body,
      user: user === null ? null : actor(user),
      submitted_at,
      state,
      commit_id,
    }),
  );
  const comments = rawComments.map(comment);
  const reviewComments = rawReviewComments.map(comment);
  const limitations: string[] = [];
  if (repositoryPolicy === null)
    limitations.push("Registered repository scoring policy is unavailable");
  const recoverAddedPatches = addedValuePatchRecovery(client, repository);
  const recoverBinary = addedBinaryRecovery(client, repository);
  await recoverAddedPatches(files, pull.head.sha);
  if (
    files.some(
      (file) =>
        needsFullValueComparison(file) ||
        needsRemovedValueComparison(file) ||
        needsAddedBinaryProof(file) ||
        (file.status === "renamed" &&
          file.patch === undefined &&
          file.additions === 0 &&
          file.deletions === 0),
    )
  ) {
    const comparison = await client.get<{
      merge_base_commit?: { sha: string };
    }>(`${root}/compare/${pull.base.sha}...${pull.head.sha}`);
    if (comparison?.merge_base_commit?.sha) {
      await recoverRemovedValueComparisons(
        client,
        repository,
        files,
        comparison.merge_base_commit.sha,
        pull.head.sha,
      );
      await recoverFullValueComparisons(
        client,
        repository,
        files,
        comparison.merge_base_commit.sha,
        pull.head.sha,
      );
      await recoverUnchangedValueRenames(
        client,
        repository,
        files,
        comparison.merge_base_commit.sha,
        pull.head.sha,
      );
      await recoverBinary(
        files,
        comparison.merge_base_commit.sha,
        pull.head.sha,
      );
    }
  }
  let mergeCommitEvidence: CommitChangeEvidence | null = null;
  let acceptedRange: AcceptedValueRange | null = null;
  let acceptedPatchReplay: AcceptedPatchReplay | null = null;
  if (pull.merged_at !== null) {
    if (!pull.merge_commit_sha) {
      limitations.push("Reported merge commit is unavailable");
    } else {
      // A PR diff can include work already brought in by another merge. Retain
      // both views; an empty accepted diff is not proof its author did no work.
      const accepted = await collectCommitChanges(
        client,
        root,
        pull.merge_commit_sha,
        "Reported merge commit",
      );
      mergeCommitEvidence = accepted.commit;
      limitations.push(...accepted.limitations);
      if (mergeCommitEvidence !== null) {
        await recoverAddedPatches(
          mergeCommitEvidence.files,
          pull.merge_commit_sha,
        );
        if (mergeCommitEvidence.parents.length > 0) {
          await recoverFullValueComparisons(
            client,
            repository,
            mergeCommitEvidence.files,
            mergeCommitEvidence.parents[0].sha,
            mergeCommitEvidence.sha,
          );
          await recoverUnchangedValueRenames(
            client,
            repository,
            mergeCommitEvidence.files,
            mergeCommitEvidence.parents[0].sha,
            mergeCommitEvidence.sha,
          );
          await recoverBinary(
            mergeCommitEvidence.files,
            mergeCommitEvidence.parents[0].sha,
            mergeCommitEvidence.sha,
          );
        }
        // GitHub can report an integration merge with the PR head first.
        // Shared commits still retain one claim in the joint work-unit ledger.
        const directMerge =
          mergeCommitEvidence.parents.length === 2 &&
          mergeCommitEvidence.parents.some(
            (parent) => parent.sha === pull.head.sha,
          );
        // A squash is usable when its entire diff matches the submitted diff.
        // Never assume that the final commit of a rebase contains the whole PR.
        const matchingSingleParent =
          mergeCommitEvidence.parents.length === 1 &&
          files.length > 0 &&
          changeBytes(files) === changeBytes(mergeCommitEvidence.files);
        if (
          !directMerge &&
          !matchingSingleParent &&
          accepted.limitations.length === 0
        ) {
          acceptedRange = await collectAcceptedValueRange(
            client,
            repository,
            pull.head.sha,
            files,
            mergeCommitEvidence,
          );
        }
        if (
          !directMerge &&
          !matchingSingleParent &&
          acceptedRange === null &&
          accepted.limitations.length === 0
        ) {
          acceptedPatchReplay = await collectAcceptedPatchReplay(
            client,
            repository,
            pull.head.sha,
            files,
            mergeCommitEvidence,
          );
        }
        if (
          !directMerge &&
          !matchingSingleParent &&
          acceptedRange === null &&
          acceptedPatchReplay === null
        ) {
          limitations.push(
            "Reported merge neither directly integrates this head nor matches its entire diff; reconcile the accepted range and related PRs",
          );
        }
      }
    }
  }
  for (const [name, actual, expected] of [
    ["files", files.length, pull.changed_files],
    ["commits", commits.length, pull.commits],
    ["comments", comments.length, pull.comments],
    ["review comments", reviewComments.length, pull.review_comments],
  ] as const)
    if (actual !== expected)
      limitations.push(`Incomplete ${name}: ${actual}/${expected}`);
  // GitHub omits binary and oversized patches. Do not let absent or truncated
  // content turn into a confident low-value recommendation.
  for (const file of [...files, ...(mergeCommitEvidence?.files ?? [])]) {
    if (
      !hasCompleteValuePatch(file) &&
      file.fullComparison === undefined &&
      file.addedBinary === undefined
    )
      limitations.push(`Full diff required: ${file.filename}`);
  }
  const related = await relatedPullRequests(
    client,
    repository,
    number,
    pull.node_id,
    [
      pull.body ?? "",
      ...reviews.map((review) => review.body),
      ...comments.map((entry) => entry.body),
      ...reviewComments.map((entry) => entry.body),
    ],
  );
  limitations.push(...related.limitations);
  const evidenceUrls = [
    ...new Set([
      pull.html_url,
      ...related.references.map((reference) => reference.url),
      ...files.map((file) => file.blob_url),
      ...(mergeCommitEvidence === null
        ? []
        : [
            mergeCommitEvidence.html_url,
            ...mergeCommitEvidence.files.map((file) => file.blob_url),
          ]),
      ...commits.map((commit) => commit.html_url),
      ...reviews.map((review) => review.html_url),
      ...comments.map((comment) => comment.html_url),
      ...reviewComments.map((comment) => comment.html_url),
    ]),
  ].filter((url): url is string => typeof url === "string");
  // Retain GitHub-linked primary authors and complete paths for scoped evidence.
  // Co-author trailers do not establish credit under SCR-04.
  const commitAttribution: CommitAttribution[] = [];
  for (const commit of commits.filter((entry) => entry.parents.length <= 1)) {
    const changes = await collectCommitChanges(
      client,
      root,
      commit.sha,
      `Commit ${commit.sha}`,
    );
    if (changes.commit && commit.parents.length === 1) {
      // Recover only the newly admitted paths; unrelated commit text keeps its
      // original representation and digest. Later rewrites remain unsupported.
      await recoverBinary(
        changes.commit.files.filter((file) =>
          files.some(
            (submitted) =>
              submitted.addedBinary && submitted.filename === file.filename,
          ),
        ),
        commit.parents[0].sha,
        commit.sha,
      );
    }
    const attribution: CommitAttribution = {
      sha: commit.sha,
      actorNodeIds: commit.author ? [commit.author.node_id] : [],
      changedPaths:
        changes.commit !== null && changes.limitations.length === 0
          ? [
              ...new Set(
                changes.commit.files.flatMap((file) => [
                  file.filename,
                  ...(file.previous_filename ? [file.previous_filename] : []),
                ]),
              ),
            ].sort()
          : null,
      ...(changes.commit !== null && changes.limitations.length === 0
        ? { files: changes.commit.files }
        : {}),
      limitations: changes.limitations,
    };
    commitAttribution.push(attribution);
  }
  const indirect = await collectIndirectValueAcceptance(
    client,
    {
      repository,
      repositoryNodeId: repositoryIdentity.node_id,
      repositoryPolicy,
      pull,
      commits,
      comments,
    },
    (sha) =>
      collectCommitChanges(client, root, sha, "Indirect integration commit"),
  );
  limitations.push(...indirect.limitations);
  // Retained copies never use an indirect-accepted source. A reference there
  // could not authorize credit; it would only change the source digest.
  const retained =
    indirect.acceptance === null
      ? await collectRetainedMergeReferences(client, {
          repository,
          repositoryNodeId: repositoryIdentity.node_id,
          repositoryDatabaseId: repositoryIdentity.id,
          pull,
          comments,
        })
      : { references: [], limitations: [] };
  limitations.push(...retained.limitations);
  if (indirect.acceptance !== null) {
    evidenceUrls.push(
      indirect.acceptance.observationUrl,
      `https://github.com/${repository}/commit/${indirect.acceptance.integrationSha}`,
      `https://github.com/${repository}/commit/${indirect.acceptance.acceptedTipSha}`,
    );
    for (const file of indirect.acceptance.integrationFiles)
      if (!hasCompleteValuePatch(file) && file.fullComparison === undefined)
        limitations.push(
          `Full indirect integration diff required: ${file.filename}`,
        );
  }
  // Trailer identities are source text, not credit authority under SCR-04.
  const implementationActors = new Set<string>();
  if (pull.user.type !== "Bot") implementationActors.add(pull.user.node_id);
  let historicalBranchPolicy: ValueBranchPolicy | undefined;
  if (
    pull.merged_at !== null &&
    repositoryPolicy !== null &&
    pull.base.ref !== repositoryPolicy.integrationBranch &&
    commits.some(
      (commit) =>
        commit.parents.length <= 1 &&
        commit.author &&
        commit.author.node_id !== pull.user.node_id &&
        isCreditEligibleCommitAuthor({
          id: commit.author.node_id,
          kind: commit.author.type,
        }),
    )
  ) {
    try {
      historicalBranchPolicy = await collectBranchPolicy(
        client,
        repository,
        pull.base.sha,
      );
    } catch {
      limitations.push(
        "Historical integration branch authority is unavailable or ambiguous",
      );
    }
  }
  if (
    pull.base.ref === repositoryPolicy?.integrationBranch ||
    matchesHistoricalIntegrationBranch(historicalBranchPolicy, pull.base)
  ) {
    for (const commit of commits) {
      if (
        commit.parents.length <= 1 &&
        (!indirect.acceptance ||
          indirect.acceptance.acceptedCommitShas.includes(commit.sha)) &&
        commit.author &&
        isCreditEligibleCommitAuthor({
          id: commit.author.node_id,
          kind: commit.author.type,
        })
      )
        implementationActors.add(commit.author.node_id);
    }
  }
  for (const attribution of commitAttribution)
    limitations.push(...attribution.limitations);
  const after = await client.get<Pull>(path);
  if (
    !after ||
    after.updated_at !== pull.updated_at ||
    after.head.sha !== pull.head.sha ||
    after.base.sha !== pull.base.sha ||
    after.state !== pull.state ||
    after.closed_at !== pull.closed_at ||
    after.merged_at !== pull.merged_at ||
    after.merge_commit_sha !== pull.merge_commit_sha
  )
    limitations.push("PR changed during evidence collection");
  const outcomeAt =
    pull.merged_at ?? indirect.acceptance?.observedOnBranchAt ?? pull.closed_at;
  const eligibleReviewIds = reviews
    .filter(
      (review) =>
        review.user !== null &&
        review.user.type !== "Bot" &&
        !implementationActors.has(review.user.node_id) &&
        review.submitted_at !== null &&
        review.state !== "PENDING" &&
        (outcomeAt === null ||
          Date.parse(review.submitted_at) < Date.parse(outcomeAt)),
    )
    .map((review) => review.node_id);
  const evidence: ValueEvidence = {
    repository,
    repositoryNodeId: repositoryIdentity.node_id,
    repositoryDatabaseId: repositoryIdentity.id,
    repositoryPolicy:
      repositoryPolicy === null
        ? null
        : {
            id: repositoryPolicy.id,
            projectId: repositoryPolicy.projectId,
            integrationBranch: repositoryPolicy.integrationBranch,
            expectedNodeId: repositoryPolicy.expectedNodeId,
          },
    collectedAt: new Date().toISOString(),
    pull,
    files,
    mergeCommitEvidence,
    ...(acceptedRange === null ? {} : { acceptedRange }),
    ...(acceptedPatchReplay === null ? {} : { acceptedPatchReplay }),
    ...(indirect.acceptance === null
      ? {}
      : { indirectAcceptance: indirect.acceptance }),
    commits,
    reviews,
    comments,
    reviewComments,
    ...(retained.references.length
      ? { retainedMergeReferences: retained.references }
      : {}),
    limitations,
    evidenceUrls,
    eligibleReviewIds,
    implementationActorNodeIds: [...implementationActors].sort(),
    ...(historicalBranchPolicy === undefined ? {} : { historicalBranchPolicy }),
    commitAttribution,
    relatedPullRequests: related.references,
  };
  limitations.push(...(await binarySourceLimitations(evidence)));
  return evidence;
}
