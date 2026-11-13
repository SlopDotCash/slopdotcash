import type { ValueEvidence } from "./value-evidence-types";
import type { ValueClient } from "./value-publication";

interface Carrier {
  repository: string;
  number: number;
  nodeId: string;
}
interface Page<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}
interface Commits extends Page<{ commit: { oid: string } }> {
  totalCount: number;
}
interface Pull {
  id: string;
  number: number;
  url: string;
  mergedAt: string;
  baseRefOid: string | null;
  headRefOid: string | null;
  repository: {
    id: string;
    databaseId: number;
    nameWithOwner: string;
    isPrivate: boolean;
  };
  mergeCommit: { oid: string } | null;
  commits: Commits;
}
export interface AcceptedCommitCensus {
  ids: Set<string>;
  carriers: Map<string, Carrier[]>;
}

/** GitHub lists at most 250 commits for a pull request, through GraphQL and
 * REST alike, while `totalCount` still reports the full number. The compare
 * API pages through the whole range, so a larger pull request is read there
 * and must agree with both the reported count and every listed commit.
 */
const PULL_REQUEST_COMMIT_LISTING_LIMIT = 250;
const SHA = /^[a-f0-9]{40}$/u;

async function compareRangeCommits(
  github: ValueClient,
  current: string,
  pull: Pull,
  total: number,
  listed: Set<string>,
): Promise<Set<string> | null> {
  const base = pull.baseRefOid;
  const head = pull.headRefOid;
  if (!base || !head || !SHA.test(base) || !SHA.test(head)) return null;
  const shas = new Set<string>();
  const pages = Math.ceil(total / 100);
  for (let page = 1; page <= pages; page++) {
    const range = await github.get<{
      total_commits: number;
      commits: { sha: string }[];
    }>(`/repos/${current}/compare/${base}...${head}?per_page=100&page=${page}`);
    if (
      !range ||
      range.total_commits !== total ||
      !Array.isArray(range.commits) ||
      range.commits.length !== Math.min(100, total - (page - 1) * 100)
    )
      return null;
    for (const { sha } of range.commits) {
      if (typeof sha !== "string" || !SHA.test(sha) || shas.has(sha))
        return null;
      shas.add(sha);
    }
  }
  if (shas.size !== total) return null;
  for (const sha of listed) if (!shas.has(sha)) return null;
  return shas;
}

/** Search supplies the full current API-era census, not just the first PR
 * that GitHub's commit/pulls endpoint says introduced a shared commit.
 * An incomplete or moving census cannot authorize independent valuation.
 * `current` is the repository's current owner/name. Evidence keeps the
 * registered id, which after a rename is the former path; search does not
 * follow a rename, so it finds no PR under that path.
 */
export async function collectAcceptedCommitCensus(
  github: ValueClient,
  evidence: ValueEvidence,
  startAt: number,
  current: string = evidence.repository,
): Promise<AcceptedCommitCensus | null> {
  return collectRange(github, evidence, startAt, current);
}

type MergeRange = { start: number; end: number };

async function collectRange(
  github: ValueClient,
  evidence: ValueEvidence,
  startAt: number,
  current: string,
  range?: MergeRange,
): Promise<AcceptedCommitCensus | null> {
  if (!github.graphql || !Number.isFinite(startAt)) return null;
  const [owner, name] = current.split("/");
  const period = range
    ? `merged:${new Date(range.start).toISOString().replace(".000Z", "Z")}..${new Date(range.end).toISOString().replace(".000Z", "Z")}`
    : `merged:>=${new Date(startAt).toISOString().slice(0, 10)}`;
  const query = `repo:${current} is:pr is:merged ${period}`;
  const ids = new Set<string>();
  const carriers = new Map<string, Carrier[]>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let count: number | null = null;
  for (;;) {
    const result: {
      search: Page<Pull> & { issueCount: number };
    } = await github.graphql<{
      search: Page<Pull> & { issueCount: number };
    }>(
      `query($q:String!,$cursor:String){search(query:$q,type:ISSUE,first:100,after:$cursor){issueCount nodes{... on PullRequest{id number url mergedAt baseRefOid headRefOid repository{id databaseId nameWithOwner isPrivate} mergeCommit{oid} commits(first:100){totalCount nodes{commit{oid}}pageInfo{hasNextPage endCursor}}}}pageInfo{hasNextPage endCursor}}}`,
      { q: query, cursor },
    );
    const search = result.search;
    if (
      !search ||
      !Number.isSafeInteger(search.issueCount) ||
      search.issueCount < 0 ||
      (count !== null && count !== search.issueCount)
    )
      return null;
    count = search.issueCount;
    // GitHub search exposes at most 1,000 results per query. Subdivide the
    // merged-time range instead of imposing that limit on the repository.
    // Its timestamps have second precision, so the ranges do not overlap.
    if (count > 1000) {
      const start =
        range?.start ??
        Date.parse(new Date(startAt).toISOString().slice(0, 10));
      const end = range?.end ?? Math.floor(Date.now() / 1000) * 1000;
      if (start >= end) return null;
      const middle = Math.floor((start + end) / 2000) * 1000;
      const left = await collectRange(github, evidence, startAt, current, {
        start,
        end: middle,
      });
      if (left === null) return null;
      const right = await collectRange(github, evidence, startAt, current, {
        start: middle + 1000,
        end,
      });
      if (right === null || left.ids.size + right.ids.size !== count)
        return null;
      for (const id of right.ids) {
        if (left.ids.has(id)) return null;
        left.ids.add(id);
      }
      for (const [sha, matches] of right.carriers)
        left.carriers.set(sha, [...(left.carriers.get(sha) ?? []), ...matches]);
      return left;
    }
    for (const pull of search.nodes) {
      const repo = pull.repository;
      if (
        !pull.id ||
        ids.has(pull.id) ||
        !Number.isSafeInteger(pull.number) ||
        pull.number <= 0 ||
        !Number.isFinite(Date.parse(pull.mergedAt)) ||
        (range !== undefined &&
          (Date.parse(pull.mergedAt) < range.start ||
            Date.parse(pull.mergedAt) > range.end)) ||
        !repo ||
        repo.isPrivate !== false ||
        repo.id !== evidence.repositoryNodeId ||
        repo.databaseId !== evidence.repositoryDatabaseId ||
        repo.nameWithOwner.toLowerCase() !== current.toLowerCase() ||
        pull.url !==
          `https://github.com/${repo.nameWithOwner}/pull/${pull.number}`
      )
        return null;
      ids.add(pull.id);
      const shas = new Set<string>();
      const commitCursors = new Set<string>();
      let commits = pull.commits;
      const total = commits.totalCount;
      if (!Number.isSafeInteger(total) || total < 0) return null;
      for (;;) {
        if (commits.totalCount !== total) return null;
        for (const { commit } of commits.nodes) {
          if (!/^[a-f0-9]{40}$/u.test(commit.oid) || shas.has(commit.oid))
            return null;
          shas.add(commit.oid);
        }
        if (!commits.pageInfo.hasNextPage) break;
        const after = commits.pageInfo.endCursor;
        if (!after || commitCursors.has(after)) return null;
        commitCursors.add(after);
        const next = await github.graphql<{
          repository: {
            id: string;
            pullRequest: { id: string; commits: Commits };
          } | null;
        }>(
          `query($owner:String!,$name:String!,$number:Int!,$after:String!){repository(owner:$owner,name:$name){id pullRequest(number:$number){id commits(first:100,after:$after){totalCount nodes{commit{oid}}pageInfo{hasNextPage endCursor}}}}}`,
          { owner, name, number: pull.number, after },
        );
        if (
          next.repository?.id !== evidence.repositoryNodeId ||
          next.repository.pullRequest?.id !== pull.id
        )
          return null;
        commits = next.repository.pullRequest.commits;
      }
      let accepted = shas;
      if (shas.size !== total) {
        // Only GitHub's listing limit is recoverable; any other shortfall is
        // an incomplete census.
        const complete =
          shas.size === PULL_REQUEST_COMMIT_LISTING_LIMIT &&
          total > PULL_REQUEST_COMMIT_LISTING_LIMIT
            ? await compareRangeCommits(github, current, pull, total, shas)
            : null;
        if (complete === null) return null;
        accepted = complete;
      }
      if (pull.mergeCommit !== null) {
        if (!SHA.test(pull.mergeCommit.oid)) return null;
        accepted.add(pull.mergeCommit.oid);
      }
      const carrier = {
        repository: evidence.repository,
        number: pull.number,
        nodeId: pull.id,
      };
      for (const sha of accepted) {
        const matches = carriers.get(sha) ?? [];
        matches.push(carrier);
        carriers.set(sha, matches);
      }
    }
    if (!search.pageInfo.hasNextPage) break;
    if (!search.pageInfo.endCursor || cursors.has(search.pageInfo.endCursor))
      return null;
    cursors.add(search.pageInfo.endCursor);
    cursor = search.pageInfo.endCursor;
  }
  return ids.size === count ? { ids, carriers } : null;
}
