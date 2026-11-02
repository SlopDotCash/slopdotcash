import type { ValueEvidence } from "./value-evidence";
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

/** Search supplies the full current API-era census, not just the first PR
 * that GitHub's commit/pulls endpoint says introduced a shared commit.
 * An incomplete or moving census cannot authorize independent valuation.
 */
export async function collectAcceptedCommitCensus(
  github: ValueClient,
  evidence: ValueEvidence,
  startAt: number,
): Promise<AcceptedCommitCensus | null> {
  if (!github.graphql || !Number.isFinite(startAt)) return null;
  const [owner, name] = evidence.repository.split("/");
  const query = `repo:${evidence.repository} is:pr is:merged merged:>=${new Date(startAt).toISOString().slice(0, 10)}`;
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
      `query($q:String!,$cursor:String){search(query:$q,type:ISSUE,first:100,after:$cursor){issueCount nodes{... on PullRequest{id number url mergedAt repository{id databaseId nameWithOwner isPrivate} mergeCommit{oid} commits(first:100){totalCount nodes{commit{oid}}pageInfo{hasNextPage endCursor}}}}pageInfo{hasNextPage endCursor}}}`,
      { q: query, cursor },
    );
    const search = result.search;
    if (
      !search ||
      !Number.isSafeInteger(search.issueCount) ||
      search.issueCount < 0 ||
      // GitHub search exposes at most 1,000 results. Do not call a truncated
      // search a complete source group or reset an inference attempt cap.
      search.issueCount > 1000 ||
      (count !== null && count !== search.issueCount)
    )
      return null;
    count = search.issueCount;
    for (const pull of search.nodes) {
      const repo = pull.repository;
      if (
        !pull.id ||
        ids.has(pull.id) ||
        !Number.isSafeInteger(pull.number) ||
        pull.number <= 0 ||
        !Number.isFinite(Date.parse(pull.mergedAt)) ||
        !repo ||
        repo.isPrivate !== false ||
        repo.id !== evidence.repositoryNodeId ||
        repo.databaseId !== evidence.repositoryDatabaseId ||
        repo.nameWithOwner.toLowerCase() !==
          evidence.repository.toLowerCase() ||
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
      if (shas.size !== total) return null;
      if (pull.mergeCommit !== null) {
        if (!/^[a-f0-9]{40}$/u.test(pull.mergeCommit.oid)) return null;
        shas.add(pull.mergeCommit.oid);
      }
      const carrier = {
        repository: evidence.repository,
        number: pull.number,
        nodeId: pull.id,
      };
      for (const sha of shas) {
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
