import { gitObjectSha1 } from "./git-object";
import type {
  Commit,
  EvidenceClient,
  NativeMergeAcceptance,
  Pull,
  ValueEvidence,
} from "./value-evidence-types";
import { collectIndirectValueRetention } from "./value-indirect-retention";
import { hasCompleteValuePatch, valuePatch } from "./value-patch";
import { readValueTreeProof } from "./value-tree";
import type { WorkUnitSource } from "./value-work-unit-types";

export const NATIVE_MERGE_CONTEXT =
  "Native ancestor acceptance requires its complete accepted carrier source";

const oid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);

/** GitHub may mark several ancestor PRs merged by one later integration.
 * Retain the exact ancestry and complete file comparison. Joint preparation
 * verifies the independently collected carrier before admitting the source.
 */
export async function collectNativeMergeAcceptance(
  client: EvidenceClient,
  repository: string,
  source: Pick<ValueEvidence, "pull" | "files" | "mergeCommitEvidence">,
): Promise<NativeMergeAcceptance | null> {
  const { pull, mergeCommitEvidence: merge } = source;
  if (
    !pull.merged_at ||
    !merge ||
    merge.sha !== pull.merge_commit_sha ||
    merge.parents.length < 2 ||
    new Set(merge.parents.map((parent) => parent.sha)).size !==
      merge.parents.length ||
    (merge.parents.length === 2 &&
      merge.parents.some((parent) => parent.sha === pull.head.sha)) ||
    ![pull.head.sha, merge.sha, ...merge.parents.map((p) => p.sha)].every(oid)
  )
    return null;
  let carrier: NativeMergeAcceptance["carrier"];
  if (merge.parents.length > 2) {
    const listed = await client.get<Pick<Pull, "number" | "merged_at">[]>(
      `/repos/${repository}/commits/${merge.sha}/pulls?per_page=100`,
    );
    if (!Array.isArray(listed) || listed.length >= 100) return null;
    const candidates: Pull[] = [];
    for (const entry of listed) {
      if (entry.number === pull.number || !entry.merged_at) continue;
      const candidate = await client.get<Pull>(
        `/repos/${repository}/pulls/${entry.number}`,
      );
      if (
        candidate?.number === entry.number &&
        candidate.node_id !== pull.node_id &&
        candidate.html_url ===
          `https://github.com/${repository}/pull/${entry.number}` &&
        candidate.merged_at &&
        Number.isFinite(Date.parse(candidate.merged_at)) &&
        Date.parse(candidate.merged_at) <= Date.parse(pull.merged_at) &&
        oid(candidate.head.sha) &&
        oid(candidate.merge_commit_sha)
      )
        candidates.push(candidate);
    }
    if (candidates.length !== 1) return null;
    const accepted = candidates[0];
    if (!accepted.merge_commit_sha || !accepted.merged_at) return null;
    carrier = {
      pullRequestId: accepted.node_id,
      headSha: accepted.head.sha,
      mergeSha: accepted.merge_commit_sha,
      mergedAt: accepted.merged_at,
    };
  }
  const tip = carrier?.headSha ?? merge.parents[1].sha;
  const acceptedSha = carrier?.mergeSha ?? merge.sha;
  const commits = new Map<string, Commit>();
  let expected: number | undefined;
  for (let page = 1; ; page++) {
    const comparison = await client.get<{
      status: string;
      merge_base_commit: { sha: string };
      total_commits: number;
      commits: Commit[];
    }>(
      `/repos/${repository}/compare/${pull.head.sha}...${tip}?per_page=100&page=${page}`,
    );
    if (
      comparison?.status !== "ahead" ||
      comparison.merge_base_commit?.sha !== pull.head.sha ||
      !Number.isSafeInteger(comparison.total_commits) ||
      comparison.total_commits < 1 ||
      !Array.isArray(comparison.commits) ||
      comparison.commits.length > 100 ||
      (expected !== undefined && expected !== comparison.total_commits)
    )
      return null;
    expected = comparison.total_commits;
    for (const commit of comparison.commits) {
      if (
        !oid(commit.sha) ||
        commits.has(commit.sha) ||
        !Array.isArray(commit.parents) ||
        !commit.parents.length ||
        !commit.parents.every((parent) => oid(parent.sha)) ||
        new Set(commit.parents.map((parent) => parent.sha)).size !==
          commit.parents.length
      )
        return null;
      const actor = (value: Commit["author"]) =>
        value === null
          ? null
          : { node_id: value.node_id, login: value.login, type: value.type };
      commits.set(commit.sha, {
        sha: commit.sha,
        html_url: commit.html_url,
        author: actor(commit.author),
        committer: actor(commit.committer),
        parents: commit.parents.map(({ sha }) => ({ sha })),
        commit: {
          message: commit.commit.message,
          author: { date: commit.commit.author.date },
          committer: { date: commit.commit.committer.date },
        },
      });
    }
    if (commits.size >= expected) break;
    if (comparison.commits.length !== 100) return null;
  }
  if (commits.size !== expected) return null;
  if (!acyclic(commits)) return null;
  // A complete path suffices to prove ancestry. Keep every parent of each
  // visited commit so the carrier can independently check all those edges.
  const path = carrier
    ? joinPath(commits, tip, merge.sha, pull.head.sha)
    : findPath(commits, tip, pull.head.sha);
  if (!path) return null;
  if (carrier) {
    const integration = commits.get(merge.sha);
    if (
      !integration ||
      JSON.stringify(integration.parents) !== JSON.stringify(merge.parents) ||
      !Number.isFinite(Date.parse(integration.commit.committer.date)) ||
      Date.parse(integration.commit.committer.date) >
        Date.parse(carrier.mergedAt)
    )
      return null;
  }
  const cache = new Map<string, Promise<unknown>>();
  const cached: EvidenceClient = {
    async get<T>(url: string): Promise<T | null> {
      if (!cache.has(url)) cache.set(url, client.get(url));
      return (await cache.get(url)) as T | null;
    },
    ...(client.verifiedFile
      ? { verifiedFile: client.verifiedFile.bind(client) }
      : {}),
  };
  const trees = await Promise.all([
    readValueTreeProof(cached, repository, pull.head.sha),
    readValueTreeProof(cached, repository, acceptedSha),
  ]);
  const [headTree, mergeTree] = trees;
  if (!headTree || !mergeTree) return null;
  const retainedFiles: NativeMergeAcceptance["retainedFiles"] = [];
  for (let at = 0; at < source.files.length; at += 16) {
    const files = await collectIndirectValueRetention(
      cached,
      repository,
      pull.head.sha,
      acceptedSha,
      source.files.slice(at, at + 16),
    );
    if (!files) return null;
    retainedFiles.push(...files);
  }
  if (!retainedFiles.length) return null;
  return {
    schemaVersion: 1,
    headSha: pull.head.sha,
    mergeSha: merge.sha,
    parentSha: merge.parents[0].sha,
    integratedHeadSha: tip,
    ...(carrier ? { carrier } : {}),
    ancestry: path,
    trees: [
      {
        commitSha: pull.head.sha,
        treeSha: headTree.treeSha,
        entries: [...headTree.entries.values()],
      },
      {
        commitSha: acceptedSha,
        treeSha: mergeTree.treeSha,
        entries: [...mergeTree.entries.values()],
      },
    ],
    retainedFiles,
  };
}

function joinPath(
  commits: ReadonlyMap<string, Commit>,
  tip: string,
  integration: string,
  head: string,
): Commit[] | null {
  const before = findPath(commits, tip, integration);
  const after = findPath(commits, integration, head);
  return before && after ? [...before, ...after] : null;
}

function findPath(
  commits: ReadonlyMap<string, Commit>,
  tip: string,
  target: string,
): Commit[] | null {
  const visited = new Set<string>();
  function walk(sha: string): Commit[] | null {
    if (sha === target) return [];
    if (visited.has(sha)) return null;
    visited.add(sha);
    const commit = commits.get(sha);
    if (!commit) return null;
    for (const parent of commit.parents) {
      const rest = walk(parent.sha);
      if (rest) return [commit, ...rest];
    }
    return null;
  }
  return walk(tip);
}

export function nativeMergeDeferralOnly(evidence: ValueEvidence): boolean {
  return (
    evidence.nativeMergeAcceptance !== undefined &&
    evidence.limitations.length === 1 &&
    evidence.limitations[0] === NATIVE_MERGE_CONTEXT
  );
}

/** The full ordinary carrier supplies independent commit identity and author
 * evidence. A supplied proof cannot add commits or change an author's credit.
 */
export async function nativeMergeCarrierMatches(
  source: ValueEvidence,
  sources: readonly WorkUnitSource[],
): Promise<boolean> {
  const proof = source.nativeMergeAcceptance;
  const merge = source.mergeCommitEvidence;
  if (
    proof?.schemaVersion !== 1 ||
    !merge ||
    (proof.carrier ? merge.parents.length <= 2 : merge.parents.length !== 2) ||
    new Set(merge.parents.map((parent) => parent.sha)).size !==
      merge.parents.length ||
    !merge.parents.every((parent) => oid(parent.sha)) ||
    source.pull.merged_at === null ||
    proof.headSha !== source.pull.head.sha ||
    proof.mergeSha !== source.pull.merge_commit_sha ||
    proof.mergeSha !== merge.sha ||
    proof.parentSha !== merge.parents[0].sha ||
    proof.integratedHeadSha !==
      (proof.carrier?.headSha ?? merge.parents[1].sha) ||
    !proof.ancestry.length ||
    proof.ancestry[0].sha !== proof.integratedHeadSha ||
    new Set(proof.ancestry.map((commit) => commit.sha)).size !==
      proof.ancestry.length ||
    proof.retainedFiles.length !== source.files.length ||
    new Set(proof.retainedFiles.map((file) => file.sourcePath)).size !==
      source.files.length ||
    !source.files.every((file) =>
      proof.retainedFiles.some(
        (retained) => retained.sourcePath === file.filename,
      ),
    )
  )
    return false;
  if (
    proof.trees.length !== 2 ||
    proof.trees[0].commitSha !== proof.headSha ||
    proof.trees[1].commitSha !== (proof.carrier?.mergeSha ?? proof.mergeSha)
  )
    return false;
  const trees = await Promise.all(
    proof.trees.map((tree) =>
      readValueTreeProof(
        {
          async get<T>(url: string): Promise<T | null> {
            if (
              url ===
              `/repos/${source.repository}/git/commits/${tree.commitSha}`
            )
              return { sha: tree.commitSha, tree: { sha: tree.treeSha } } as T;
            if (
              url ===
              `/repos/${source.repository}/git/trees/${tree.treeSha}?recursive=1`
            )
              return {
                sha: tree.treeSha,
                truncated: false,
                tree: tree.entries,
              } as T;
            return null;
          },
        },
        source.repository,
        tree.commitSha,
      ),
    ),
  );
  if (!trees[0] || !trees[1]) return false;
  for (const file of proof.retainedFiles) {
    for (const version of [file.historical, file.accepted]) {
      if (
        version &&
        (!["100644", "100755"].includes(version.mode) ||
          version.text.includes("\0") ||
          (await gitObjectSha1(
            "blob",
            new TextEncoder().encode(version.text),
          )) !== version.blobSha)
      )
        return false;
    }
    const submitted = source.files.find(
      (item) => item.filename === file.sourcePath,
    );
    if (
      !submitted ||
      file.sourcePath !== file.acceptedPath ||
      (file.historical === null && submitted.status !== "removed")
    )
      return false;
    if (
      file.historical &&
      !submittedPostimageMatches(submitted, file.historical)
    )
      return false;
    for (const [tree, version] of [
      [trees[0], file.historical],
      [trees[1], file.accepted],
    ] as const) {
      const entry = tree.entries.get(file.sourcePath);
      if (
        version === null
          ? entry !== undefined
          : entry?.sha !== version.blobSha ||
            entry.mode !== version.mode ||
            entry.type !== "blob"
      )
        return false;
    }
  }
  const carriers = sources.filter(({ evidence }) => {
    const accepted = evidence.mergeCommitEvidence;
    return (
      evidence !== source &&
      evidence.repositoryNodeId === source.repositoryNodeId &&
      evidence.repositoryDatabaseId === source.repositoryDatabaseId &&
      evidence.limitations.length === 0 &&
      evidence.pull.merged_at !== null &&
      Date.parse(evidence.pull.merged_at) <=
        Date.parse(source.pull.merged_at ?? "") &&
      evidence.pull.head.sha === proof.integratedHeadSha &&
      (proof.carrier
        ? evidence.pull.node_id === proof.carrier.pullRequestId &&
          evidence.pull.merged_at === proof.carrier.mergedAt &&
          evidence.pull.merge_commit_sha === proof.carrier.mergeSha &&
          accepted?.sha === proof.carrier.mergeSha &&
          accepted.parents.length === 2 &&
          accepted.parents[0].sha === evidence.pull.base.sha &&
          accepted.parents[1].sha === evidence.pull.head.sha
        : evidence.pull.merge_commit_sha === proof.mergeSha &&
          accepted?.sha === proof.mergeSha &&
          JSON.stringify(accepted) === JSON.stringify(merge)) &&
      evidence.commits.length === evidence.pull.commits &&
      evidence.commits.some((commit) => commit.sha === evidence.pull.head.sha)
    );
  });
  return carriers.some(({ evidence }) => {
    const commits = new Map(
      evidence.commits.map((commit) => [commit.sha, commit]),
    );
    if (commits.size !== evidence.commits.length) return false;
    if (!acyclic(commits)) return false;
    if (proof.carrier) {
      const integration = commits.get(merge.sha);
      const acceptedAt = Date.parse(proof.carrier.mergedAt);
      if (
        !integration ||
        JSON.stringify(integration.parents) !== JSON.stringify(merge.parents) ||
        !proof.ancestry.some((commit) => commit.sha === merge.sha) ||
        merge.parents.some(
          (parent) =>
            parent.sha !== evidence.pull.base.sha && !commits.has(parent.sha),
        ) ||
        !Number.isFinite(acceptedAt) ||
        [...commits.values()].some(
          (commit) =>
            !Number.isFinite(Date.parse(commit.commit.committer.date)) ||
            Date.parse(commit.commit.committer.date) > acceptedAt,
        )
      )
        return false;
    }
    for (const [index, commit] of proof.ancestry.entries()) {
      const next = proof.ancestry[index + 1]?.sha ?? proof.headSha;
      if (
        !commit.parents.some((parent) => parent.sha === next) ||
        JSON.stringify(commits.get(commit.sha)) !== JSON.stringify(commit)
      )
        return false;
    }
    const originalGraph = new Map(
      source.commits.map((commit) => [commit.sha, commit]),
    );
    // Earlier integration merges can be omitted from a later PR's API range.
    // Complete sibling sources retain their exact merge-parent graph.
    for (const sibling of sources) {
      if (!qualifiedGraphSource(sibling.evidence, source)) continue;
      for (const entry of sibling.evidence.commits) {
        const known = originalGraph.get(entry.sha);
        if (known && JSON.stringify(known) !== JSON.stringify(entry))
          return false;
        originalGraph.set(entry.sha, entry);
      }
    }
    if (
      new Set(source.commits.map((commit) => commit.sha)).size !==
      source.commits.length
    )
      return false;
    if (!acyclic(originalGraph)) return false;
    const parentGraph = new Map(
      [...originalGraph].map(([sha, entry]) => [sha, entry.parents]),
    );
    for (const sibling of sources) {
      if (!qualifiedGraphSource(sibling.evidence, source)) continue;
      const merged = sibling.evidence.mergeCommitEvidence;
      if (!merged) continue;
      const known = parentGraph.get(merged.sha);
      if (known && JSON.stringify(known) !== JSON.stringify(merged.parents))
        return false;
      parentGraph.set(merged.sha, merged.parents);
    }
    if (!acyclicParents(parentGraph)) return false;
    const baseAncestors = new Set<string>();
    const pending = [evidence.pull.base.sha];
    while (pending.length) {
      const sha = pending.pop();
      if (sha === undefined) return false;
      if (baseAncestors.has(sha)) continue;
      baseAncestors.add(sha);
      pending.push(...(parentGraph.get(sha) ?? []).map((parent) => parent.sha));
    }
    return source.commits.every((commit) => {
      // GitHub can include ancestors already present at the later carrier's
      // base. Such commits are outside its submitted range; their complete
      // original parent graph must reach that exact base boundary.
      const copiedCommit = commits.get(commit.sha);
      if (!copiedCommit) return baseAncestors.has(commit.sha);
      if (JSON.stringify(copiedCommit) !== JSON.stringify(commit)) return false;
      if (commit.parents.length > 1) return true;
      const original = source.commitAttribution.filter(
        (entry) => entry.sha === commit.sha,
      );
      const copied = evidence.commitAttribution.filter(
        (entry) => entry.sha === commit.sha,
      );
      return (
        original.length === 1 &&
        copied.length === 1 &&
        original[0].limitations.length === 0 &&
        copied[0].limitations.length === 0 &&
        original[0].changedPaths !== null &&
        copied[0].changedPaths !== null &&
        JSON.stringify(original[0]) === JSON.stringify(copied[0])
      );
    });
  });
}

function submittedPostimageMatches(
  file: ValueEvidence["files"][number],
  version: NativeMergeAcceptance["retainedFiles"][number]["historical"] & {},
): boolean {
  if (file.fullComparison)
    return (
      file.fullComparison.after.blobSha === version.blobSha &&
      file.fullComparison.after.text === version.text
    );
  if (file.addedComparison)
    return (
      file.addedComparison.after.blobSha === version.blobSha &&
      file.addedComparison.after.text === version.text
    );
  if (!hasCompleteValuePatch(file)) return false;
  const patch = valuePatch(file);
  if (patch === undefined) return false;
  if (file.status === "removed") return false;
  const lines = version.text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  const input = patch.split("\n");
  let checked = false;
  for (let at = 0; at < input.length; ) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(input[at++]);
    if (!header) return false;
    const expected = Number(header[2] ?? "1");
    const after: string[] = [];
    let previous = "";
    while (at < input.length && !input[at].startsWith("@@")) {
      const line = input[at++];
      if (line === "" && at === input.length) break;
      if (line === "\\ No newline at end of file") {
        if (previous !== "-" && after.length)
          after[after.length - 1] = after[after.length - 1].slice(0, -1);
        continue;
      }
      previous = line[0];
      if (previous === "+" || previous === " ")
        after.push(`${line.slice(1)}\n`);
      else if (previous !== "-") return false;
    }
    const start = Number(header[1]) - 1;
    if (
      after.length !== expected ||
      lines.slice(start, start + expected).join("") !== after.join("")
    )
      return false;
    checked = true;
  }
  return checked;
}

/** GitHub commit pages need not be topological. Follow edges directly. */
function acyclic(commits: ReadonlyMap<string, Commit>): boolean {
  return acyclicParents(
    new Map([...commits].map(([sha, commit]) => [sha, commit.parents])),
  );
}

function acyclicParents(
  parents: ReadonlyMap<string, { sha: string }[]>,
): boolean {
  const done = new Set<string>(),
    active = new Set<string>();
  function visit(sha: string): boolean {
    if (active.has(sha)) return false;
    if (done.has(sha)) return true;
    const edges = parents.get(sha);
    if (!edges) return true;
    active.add(sha);
    for (const parent of edges) if (!visit(parent.sha)) return false;
    active.delete(sha);
    done.add(sha);
    return true;
  }
  return [...parents.keys()].every(visit);
}

/** Only an independently complete direct integration may supply extra edges. */
function qualifiedGraphSource(
  candidate: ValueEvidence,
  source: ValueEvidence,
): boolean {
  const merge = candidate.mergeCommitEvidence;
  return (
    candidate === source ||
    (candidate.repositoryNodeId === source.repositoryNodeId &&
      candidate.repositoryDatabaseId === source.repositoryDatabaseId &&
      candidate.limitations.length === 0 &&
      candidate.pull.merged_at !== null &&
      merge !== null &&
      merge.sha === candidate.pull.merge_commit_sha &&
      merge.parents.length === 2 &&
      merge.parents.some((parent) => parent.sha === candidate.pull.head.sha) &&
      candidate.commits.length === candidate.pull.commits &&
      candidate.commits.some(
        (commit) => commit.sha === candidate.pull.head.sha,
      ))
  );
}
