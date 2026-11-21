/** Main-only private publication of an independently reviewed historical project. */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { PARTICIPATION_BAN_QUERY } from "../backend/projects/account-bans";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import { latestPoints, type PointsJournal } from "../src/lib/points";
import { repositoryIdentity } from "../src/lib/project-repositories.mjs";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { sha256Hex } from "../src/lib/sha256";
import { GitHubClient } from "../workers/slopbot/github";
import { mergedTimeRangeQualifier } from "../workers/slopbot/value-accepted-commit-census";
import { pullCommits } from "../workers/slopbot/value-evidence";
import type { Pull } from "../workers/slopbot/value-evidence-types";
import { loadPublishedPoints, pointsSql } from "./generate-points";
import { resolveGitHubToken } from "./github-token";
import {
  correctionBatchRecorded,
  recordCorrection,
} from "./prepare-implementation-corrections";
import { reviewedPacketStorage } from "./private-payout-packet";
import {
  changeDigest,
  readPullRequestGitFiles,
  readReviewedSquashGitFiles,
} from "./pull-request-git-files";
import {
  decodeHistoricalPacket,
  decodeHistoricalPacketBytes,
  type HistoricalAcceptedSquash,
  type HistoricalPointsPacket,
  historicalProtectionQuery,
  reconstructHistoricalPoints,
} from "./reviewed-historical-points";
import { currentOwnerVerifier, octoberQueryRows } from "./run-october-rewards";
import { fetchProjectRegistry } from "./sync-project-registry.mjs";
import { loadParticipationBans } from "./value-ingestion";
import {
  type PublicMergeRepository,
  publicGitProcess,
  withPublicGitObjects,
} from "./value-merge-ingestion";

const execute = promisify(execFile);
const hash = (value: unknown) => sha256Hex(JSON.stringify(value));
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
type Query = (sql: string) => Promise<Record<string, unknown>[]>;

/** Re-read the exact closed window by immutable PR and repository identity. */
export async function verifyHistoricalCensus(
  packet: HistoricalPointsPacket,
  github: Pick<GitHubClient, "graphql">,
): Promise<void> {
  const sources: HistoricalPointsPacket["sourceAudit"]["sources"] = [];
  const collect = async (
    from: string,
    through: string,
  ): Promise<HistoricalPointsPacket["sourceAudit"]["sources"]> => {
    const rows: HistoricalPointsPacket["sourceAudit"]["sources"] = [];
    let cursor: string | null = null;
    let total: number | undefined;
    do {
      const data: {
        search: {
          issueCount: number;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: {
            id: string;
            number: number;
            headRefOid: string;
            mergedAt: string;
            repository: { id: string };
          }[];
        };
      } = await github.graphql(
        "query HistoricalPointsCensus($query:String!,$after:String){search(query:$query,type:ISSUE,first:100,after:$after){issueCount pageInfo{hasNextPage endCursor} nodes{...on PullRequest{id number headRefOid mergedAt repository{id}}}}}",
        {
          query: `repo:${packet.sourceAudit.repository} is:pr is:merged ${mergedTimeRangeQualifier(Date.parse(from), Date.parse(through) - 1000)}`,
          after: cursor,
        },
      );
      const page = data.search;
      if (
        !Number.isSafeInteger(page?.issueCount) ||
        (total !== undefined && total !== page.issueCount) ||
        !Array.isArray(page.nodes)
      )
        throw Error("Historical census count changed");
      total = page.issueCount;
      if (total >= 1000) {
        const start = Date.parse(from),
          end = Date.parse(through);
        if (end - start <= 1000)
          throw Error("Historical census cannot be split further");
        const middle = new Date(
          Math.floor((start + end) / 2000) * 1000,
        ).toISOString();
        const combined = [
          ...(await collect(from, middle)),
          ...(await collect(middle, through)),
        ];
        if (
          combined.length !== total ||
          new Set(combined.map((row) => row.id)).size !== total
        )
          throw Error("Historical split census changed");
        return combined;
      }
      for (const row of page.nodes) {
        if (row.repository?.id !== packet.sourceAudit.repositoryNodeId)
          throw Error("Historical census repository changed");
        rows.push({
          id: row.id,
          number: row.number,
          headSha: row.headRefOid,
          mergedAt: new Date(row.mergedAt).toISOString(),
        });
      }
      const next = page.pageInfo;
      if (
        !next ||
        typeof next.hasNextPage !== "boolean" ||
        (next.hasNextPage && (!next.endCursor || next.endCursor === cursor))
      )
        throw Error("Historical census pagination failed");
      cursor = next.hasNextPage ? next.endCursor : null;
    } while (cursor);
    if (
      rows.length !== total ||
      new Set(rows.map((row) => row.id)).size !== total
    )
      throw Error("Historical census incomplete");
    return rows;
  };
  sources.push(
    ...(await collect(packet.sourceAudit.from, packet.sourceAudit.through)),
  );
  const ordered = (rows: typeof sources) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id));
  if (
    JSON.stringify(ordered(sources)) !==
    JSON.stringify(ordered(packet.sourceAudit.sources))
  )
    throw Error("Reviewed historical census changed");
}

/** Verify the complete duplicate changes, including paths and both object IDs. */
export async function verifyHistoricalIdenticalAcceptedChanges(
  packet: Pick<HistoricalPointsPacket, "sourceAudit" | "duplicateRetirements">,
  github: Pick<GitHubClient, "get">,
  withObjects = withPublicGitObjects,
): Promise<ReadonlySet<string>> {
  const candidates = (packet.duplicateRetirements ?? []).filter(
    (retirement) => retirement.identicalAcceptedChange !== undefined,
  );
  const verified = new Set<string>();
  if (!candidates.length) return verified;
  const root = `/repos/${packet.sourceAudit.repository}`;
  const repository = await github.get<PublicMergeRepository>(root);
  if (
    repository?.node_id !== packet.sourceAudit.repositoryNodeId ||
    repository.full_name?.toLowerCase() !==
      packet.sourceAudit.repository.toLowerCase()
  )
    throw Error("Reviewed identical change repository changed");
  for (const retirement of candidates) {
    const proof = retirement.identicalAcceptedChange;
    const earlier = retirement.earlierSources.find(
      (source) => source.sourceId === proof?.earlierSourceId,
    );
    if (!proof || !earlier) throw Error("Reviewed earlier source is missing");
    const sha = /^[a-f0-9]{40}$/u;
    if (
      !sha.test(proof.earlierMergeSha) ||
      !sha.test(proof.mergeSha) ||
      proof.earlierMergeSha === proof.mergeSha ||
      !/^[a-f0-9]{64}$/u.test(proof.diffSha256) ||
      (proof.emptySquash !== undefined && proof.emptySquash !== true)
    )
      throw Error("Reviewed identical change identity is invalid");
    const emptySquash = proof.emptySquash === true;
    const sources = [
      { source: earlier, mergeSha: proof.earlierMergeSha },
      { source: retirement.source, mergeSha: proof.mergeSha },
    ];
    async function verifyPull({ source, mergeSha }: (typeof sources)[number]) {
      const audit = packet.sourceAudit.sources.find(
        (row) => row.id === source.sourceId,
      );
      if (!audit)
        throw Error("Identical change is outside the reviewed census");
      const pull = await github.get<Pull>(`${root}/pulls/${audit.number}`);
      if (
        !pull ||
        pull.node_id !== source.sourceId ||
        pull.number !== audit.number ||
        pull.head.sha !== source.headSha ||
        !sha.test(pull.head.sha) ||
        !sha.test(pull.base.sha) ||
        pull.merge_commit_sha !== mergeSha ||
        !pull.merged_at ||
        new Date(pull.merged_at).toISOString() !== source.occurredAt ||
        pull.commits !== source.commitCount ||
        (emptySquash &&
          (pull.state !== "closed" ||
            pull.html_url !== source.sourceUrl ||
            pull.user.node_id !== source.author?.id ||
            pull.user.type !== source.author?.kind))
      )
        throw Error("Reviewed identical change source changed");
      return pull;
    }
    const checked = await Promise.all(
      sources.map(async (binding) => ({
        ...binding,
        pull: await verifyPull(binding),
      })),
    );
    await withObjects(
      repository,
      [
        ...sources.map(({ mergeSha }) => mergeSha),
        ...checked.flatMap(({ pull }) => [pull.head.sha, pull.base.sha]),
      ],
      async (directory) => {
        const nativeGit = async (...args: string[]) => {
          const command = publicGitProcess(directory, args);
          return (await execute(command.file, command.args, command.options))
            .stdout;
        };
        if (emptySquash) {
          const parents: string[] = [];
          for (const { pull, mergeSha, source } of checked) {
            const [accepted, parent, ...extra] = (
              await nativeGit("rev-list", "--parents", "-n", "1", mergeSha)
            )
              .trim()
              .split(" ");
            const submitted = source.commits[0];
            const submittedRange = await nativeGit(
              "rev-list",
              "--parents",
              pull.head.sha,
              `^${pull.base.sha}`,
            );
            if (
              accepted !== mergeSha ||
              !parent ||
              !sha.test(parent) ||
              extra.length ||
              source.commits.length !== 1 ||
              submitted.sha !== pull.head.sha ||
              submitted.parentCount !== 1 ||
              submitted.parentShas?.length !== 1 ||
              submittedRange.trim() !==
                `${pull.head.sha} ${submitted.parentShas[0]}` ||
              (await changeDigest(
                directory,
                submitted.parentShas[0],
                submitted.sha,
              )) !== proof.diffSha256
            )
              throw Error(
                "Empty squash needs complete matching submitted changes",
              );
            parents.push(parent);
          }
          const [earlierParent, laterParent] = parents;
          const empty = sha256Hex("");
          const [acceptedTree, parentTree] = (
            await nativeGit(
              "rev-parse",
              `${proof.mergeSha}^{tree}`,
              `${laterParent}^{tree}`,
            )
          )
            .trim()
            .split("\n");
          if (
            !acceptedTree ||
            !sha.test(acceptedTree) ||
            acceptedTree !== parentTree
          )
            throw Error("Accepted squash changes its first-parent tree");
          if (
            proof.diffSha256 === empty ||
            (await changeDigest(
              directory,
              earlierParent,
              proof.earlierMergeSha,
            )) !== proof.diffSha256
          )
            throw Error(
              "Earlier squash does not match the complete submitted change",
            );

          try {
            await nativeGit(
              "merge-base",
              "--is-ancestor",
              proof.earlierMergeSha,
              laterParent,
            );
          } catch {
            throw Error(
              "Earlier accepted squash is absent from the later base",
            );
          }
          const paths = (
            await nativeGit(
              "diff",
              "--no-ext-diff",
              "--no-textconv",
              "--no-renames",
              "--name-only",
              "-z",
              earlierParent,
              proof.earlierMergeSha,
              "--",
            )
          ).split("\0");
          if (
            paths.pop() !== "" ||
            !paths.length ||
            paths.some((path) => !path || path.includes("\uFFFD")) ||
            new Set(paths).size !== paths.length ||
            checked.some(({ pull }) => pull.changed_files !== paths.length) ||
            (await changeDigest(
              directory,
              proof.earlierMergeSha,
              laterParent,
              paths,
            )) !== empty
          )
            throw Error(
              "Later squash base does not retain all earlier accepted paths",
            );
          return;
        }
        const fileCounts = (
          files: readonly {
            path: string;
            additions: number;
            deletions: number;
          }[],
        ) =>
          hash(
            files
              .map(
                (file) => [file.path, file.additions, file.deletions] as const,
              )
              .sort((a, b) => a[0].localeCompare(b[0])),
          );
        for (const { pull, mergeSha, source } of checked) {
          const [commit, first, second, ...extra] = (
            await nativeGit("rev-list", "--parents", "-n", "1", mergeSha)
          )
            .trim()
            .split(" ");
          if (
            commit !== mergeSha ||
            !first ||
            !sha.test(first) ||
            (second !== undefined && second !== pull.head.sha) ||
            extra.length
          )
            throw Error("Identical change needs the complete accepted merge");
          const range = new Map(
            (
              await nativeGit(
                "rev-list",
                "--parents",
                pull.head.sha,
                `^${pull.base.sha}`,
              )
            )
              .trim()
              .split("\n")
              .map((line) => {
                const [id, ...parents] = line.split(" ");
                return [id, parents] as const;
              }),
          );
          if (
            range.size !== source.commits.length ||
            source.commits.some(
              (member) =>
                !range.has(member.sha) ||
                hash(range.get(member.sha)) !== hash(member.parentShas),
            )
          )
            throw Error("Identical change has incomplete submitted commits");
          // This existing reader compares the full submitted and accepted
          // raw diffs before computing complete native file line counts.
          const readFiles = second
            ? readPullRequestGitFiles
            : readReviewedSquashGitFiles;
          const changed = await readFiles(directory, {
            repository,
            head: pull.head.sha,
            merge: {
              sha: mergeSha,
              parents: [{ sha: first }, ...(second ? [{ sha: second }] : [])],
            },
          });
          if (
            !changed.changedFiles ||
            changed.changedFiles !== pull.changed_files ||
            (await changeDigest(directory, first, mergeSha)) !==
              proof.diffSha256
          )
            throw Error("Complete accepted changes differ");
          if (source === retirement.source) {
            const submitted = source.commits[0];
            if (
              source.commits.length !== 1 ||
              submitted.sha !== source.headSha ||
              submitted.parentCount !== 1 ||
              submitted.parentShas?.length !== 1 ||
              !submitted.files ||
              submitted.files.length !== changed.changedFiles ||
              submitted.additions !== changed.additions ||
              submitted.deletions !== changed.deletions ||
              fileCounts(submitted.files) !== fileCounts(changed.files) ||
              (await changeDigest(
                directory,
                submitted.parentShas[0],
                submitted.sha,
              )) !== proof.diffSha256
            )
              throw Error(
                "Duplicate submitted commit differs from its accepted change",
              );
          }
        }
      },
    );
    await Promise.all(sources.map(verifyPull));
    verified.add(hash(retirement));
  }
  return verified;
}

/** Recheck GitHub's exact accepted squash relation before using retained bytes. */
export async function verifyHistoricalAcceptedSquashes(
  packet: HistoricalPointsPacket,
  github: Pick<GitHubClient, "graphql" | "get">,
): Promise<void> {
  for (const retirement of packet.duplicateRetirements ?? []) {
    const proof = retirement.earlierAcceptanceProof;
    if (!proof) continue;
    const root = `/repos/${packet.sourceAudit.repository}`;
    const repository = await github.get<PublicMergeRepository>(root);
    if (repository?.node_id !== retirement.source.repositoryNodeId)
      throw Error("Earlier acceptance repository changed");
    const automatic = proof.contextSources.filter(
      (source) => source.automaticMerge,
    );
    if (automatic.length)
      await withPublicGitObjects(
        repository,
        automatic.flatMap((source) => [source.headSha, source.mergeSha]),
        async (directory) => {
          for (const source of automatic) {
            const expected = source.automaticMerge;
            if (!expected)
              throw Error("Earlier automatic merge proof is missing");
            const command = publicGitProcess(directory, [
              "merge-tree",
              "--write-tree",
              "--no-messages",
              expected.baseParentSha,
              source.headSha,
            ]);
            const merged = await execute(
              command.file,
              command.args,
              command.options,
            );
            if (merged.stdout.trim() !== expected.automaticTree)
              throw Error("Earlier automatic merge tree changed");
            const treeCommand = publicGitProcess(directory, [
              "rev-parse",
              `${source.mergeSha}^{tree}`,
            ]);
            const accepted = await execute(
              treeCommand.file,
              treeCommand.args,
              treeCommand.options,
            );
            if (accepted.stdout.trim() !== expected.automaticTree)
              throw Error("Earlier accepted merge tree changed");
          }
        },
      );
    for (const source of retirement.earlierSources) {
      const audit = packet.sourceAudit.sources.find(
        (row) => row.id === source.sourceId,
      );
      const context = proof.contextSources.find(
        (row) => row.id === source.sourceId,
      );
      const number = audit?.number ?? context?.number;
      if (!number) throw Error("Earlier acceptance source is unavailable");
      const path = `${root}/pulls/${number}`;
      const pull = await github.get<Pull>(path);
      const baseSha = context?.baseSha;
      if (
        !pull ||
        pull.node_id !== source.sourceId ||
        pull.head.sha !== source.headSha ||
        pull.base.sha !== baseSha ||
        pull.commits !== source.commitCount ||
        !pull.merged_at ||
        new Date(pull.merged_at).toISOString() !== source.occurredAt ||
        (context && pull.merge_commit_sha !== context.mergeSha) ||
        pull.user.node_id !== source.author?.id ||
        pull.user.type !== source.author?.kind
      )
        throw Error("Earlier acceptance source changed");
      const commits = await pullCommits(github, root, path, pull, {
        requireImmutableRange: true,
      });
      const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
      if (
        bySha.size !== source.commits.length ||
        source.commits.some((commit) => {
          const current = bySha.get(commit.sha);
          return (
            !current ||
            JSON.stringify(current.parents.map((parent) => parent.sha)) !==
              JSON.stringify(commit.parentShas) ||
            current.author?.node_id !== commit.author?.id ||
            current.author?.type !== commit.author?.kind
          );
        })
      )
        throw Error("Earlier acceptance source omits or substitutes a commit");
      const current = await github.get<Pull>(path);
      if (
        !current ||
        current.node_id !== pull.node_id ||
        current.user.node_id !== pull.user.node_id ||
        current.user.type !== pull.user.type ||
        current.head.sha !== pull.head.sha ||
        current.base.sha !== pull.base.sha ||
        current.commits !== pull.commits ||
        current.merged_at !== pull.merged_at ||
        current.merge_commit_sha !== pull.merge_commit_sha
      )
        throw Error("Earlier acceptance changed during collection");
    }
  }
  for (const retirement of packet.duplicateRetirements ?? []) {
    if (
      !retirement.acceptedSquashes?.length &&
      !retirement.earlierAcceptanceProof
    )
      continue;
    const promotion = retirement.acceptedPromotion;
    const data = await github.graphql<{
      node: {
        id: string;
        headRefOid: string;
        mergedAt: string;
        repository: { id: string };
        mergeCommit: { oid: string };
      } | null;
    }>(
      "query HistoricalPromotionMerge($id:ID!){node(id:$id){...on PullRequest{id headRefOid mergedAt repository{id} mergeCommit{oid}}}}",
      { id: retirement.sourceId },
    );
    if (
      !promotion ||
      data.node?.id !== retirement.sourceId ||
      data.node.headRefOid !== retirement.source.headSha ||
      data.node.repository.id !== retirement.source.repositoryNodeId ||
      new Date(data.node.mergedAt).toISOString() !==
        retirement.source.occurredAt ||
      data.node.mergeCommit?.oid !== promotion.mergeSha
    )
      throw Error("Accepted promotion source changed");
  }
  for (const retirement of packet.duplicateRetirements ?? []) {
    if (
      !retirement.acceptedSquashes?.length &&
      !retirement.earlierAcceptanceProof
    )
      continue;
    const root = `/repos/${packet.sourceAudit.repository}`;
    const audited = packet.sourceAudit.sources.find(
      (source) => source.id === retirement.sourceId,
    );
    if (!audited) throw Error("Promotion source is outside the audit");
    const path = `${root}/pulls/${audited.number}`;
    const repository = await github.get<{ node_id: string }>(root);
    const pull = await github.get<Pull>(path);
    if (
      repository?.node_id !== retirement.source.repositoryNodeId ||
      !pull ||
      pull.node_id !== retirement.sourceId ||
      pull.head.sha !== retirement.source.headSha ||
      pull.merge_commit_sha !== retirement.acceptedPromotion?.mergeSha ||
      !pull.merged_at ||
      new Date(pull.merged_at).toISOString() !== retirement.source.occurredAt ||
      pull.commits !== retirement.source.commitCount ||
      (retirement.earlierAcceptanceProof &&
        (pull.base.sha !== retirement.earlierAcceptanceProof.sourceBaseSha ||
          pull.user.node_id !== retirement.source.author?.id ||
          pull.user.type !== retirement.source.author?.kind))
    )
      throw Error("Accepted promotion membership changed");
    const observed = await pullCommits(github, root, path, pull, {
      requireImmutableRange: true,
    });
    const commits = new Map(observed.map((commit) => [commit.sha, commit]));
    const head = commits.get(retirement.source.headSha);
    const headParents = /^tree [a-f0-9]{40}\n((?:parent [a-f0-9]{40}\n)*)/u
      .exec(retirement.acceptedPromotion.headCommit)?.[1]
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(7));
    if (
      commits.size !== retirement.source.commits.length ||
      !head ||
      JSON.stringify(head.parents.map((parent) => parent.sha)) !==
        JSON.stringify(headParents) ||
      retirement.source.commits.some(
        (commit) =>
          JSON.stringify(
            commits.get(commit.sha)?.parents.map((parent) => parent.sha),
          ) !== JSON.stringify(commit.parentShas) ||
          (retirement.earlierAcceptanceProof !== undefined &&
            (commits.get(commit.sha)?.author?.node_id !== commit.author?.id ||
              commits.get(commit.sha)?.author?.type !== commit.author?.kind)),
      )
    )
      throw Error("Accepted promotion source omits or substitutes a commit");
    const current = await github.get<Pull>(path);
    if (
      !current ||
      current.node_id !== pull.node_id ||
      current.head.sha !== pull.head.sha ||
      current.base.sha !== pull.base.sha ||
      current.commits !== pull.commits ||
      current.merge_commit_sha !== pull.merge_commit_sha ||
      current.merged_at !== pull.merged_at ||
      (retirement.earlierAcceptanceProof !== undefined &&
        (current.user.node_id !== pull.user.node_id ||
          current.user.type !== pull.user.type))
    )
      throw Error("Accepted promotion changed during collection");
  }
  const sources = new Map<string, HistoricalAcceptedSquash>();
  for (const retirement of packet.duplicateRetirements ?? []) {
    for (const source of retirement.acceptedSquashes ?? []) {
      const prior = sources.get(source.sourceId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(source))
        throw Error("Conflicting accepted squash identity");
      sources.set(source.sourceId, source);
    }
  }
  const rows = [...sources.values()];
  for (let offset = 0; offset < rows.length; offset += 50) {
    const batch = rows.slice(offset, offset + 50);
    const data = await github.graphql<{
      nodes: ({
        id: string;
        number: number;
        url: string;
        merged: boolean;
        mergedAt: string;
        headRefOid: string;
        repository: { id: string; nameWithOwner: string };
        author: { id: string; login: string; __typename: string } | null;
        mergeCommit: {
          oid: string;
          author: {
            user: { id: string; login: string; __typename: string } | null;
          };
          parents: {
            nodes: { oid: string }[];
            pageInfo: { hasNextPage: boolean };
          };
        } | null;
      } | null)[];
    }>(
      "query HistoricalAcceptedSquashes($ids:[ID!]!){nodes(ids:$ids){...on PullRequest{id number url merged mergedAt headRefOid repository{id nameWithOwner} author{__typename login ...on User{id} ...on Bot{id}} mergeCommit{oid author{user{__typename id login}} parents(first:10){nodes{oid} pageInfo{hasNextPage}}}}}}",
      { ids: batch.map((source) => source.sourceId) },
    );
    if (!Array.isArray(data.nodes) || data.nodes.length !== batch.length)
      throw Error("Accepted squash source unavailable");
    for (const [index, source] of batch.entries()) {
      const current = data.nodes[index];
      if (
        !current ||
        current.id !== source.sourceId ||
        !current.merged ||
        current.headRefOid !== source.headSha ||
        new Date(current.mergedAt).toISOString() !== source.occurredAt ||
        current.url !== source.sourceUrl ||
        current.repository.id !== source.repositoryNodeId ||
        current.repository.nameWithOwner.toLowerCase() !==
          packet.sourceAudit.repository.toLowerCase() ||
        current.author?.id !== source.author?.id ||
        current.author?.__typename !== source.author?.kind ||
        current.mergeCommit?.oid !== source.commit.sha ||
        current.mergeCommit.author.user?.id !== source.commit.author?.id ||
        (current.mergeCommit.author.user?.login.endsWith("[bot]")
          ? "Bot"
          : current.mergeCommit.author.user?.__typename) !==
          source.commit.author?.kind ||
        current.mergeCommit.parents.pageInfo.hasNextPage ||
        JSON.stringify(
          current.mergeCommit.parents.nodes.map((parent) => parent.oid),
        ) !== JSON.stringify(source.commit.parentShas)
      )
        throw Error("Accepted squash source changed");
    }
  }
}

/** D1 protection is rechecked by the canonical batch SQL at commit time. */
export async function verifyHistoricalProtection(
  packet: HistoricalPointsPacket,
  query: Query,
): Promise<void> {
  const rows = await query(historicalProtectionQuery(packet));
  if (
    rows.length !== 2 ||
    rows.some(
      (r) =>
        r.project_id !== packet.projectId ||
        !["2026-09", "2026-10"].includes(String(r.period)) ||
        r.protected !== 0,
    ) ||
    new Set(rows.map((r) => r.period)).size !== 2
  )
    throw Error("Historical Points are financially protected or unavailable");
}

/** Public records bind provenance. The explicit owner-reviewed packet authorizes award amounts. */
export async function verifyHistoricalValueRecords(
  packet: HistoricalPointsPacket,
  query: Query,
): Promise<void> {
  const verifiedDuplicateRecords = new Map<string, string>();
  for (const retirement of packet.duplicateRetirements ?? []) {
    for (const { rewardedUnit } of retirement.coverage) {
      if (!rewardedUnit) continue;
      if (!/^[a-f0-9]{64}$/u.test(rewardedUnit.recordDigest))
        throw Error("Invalid duplicate coverage record digest");
      const verified = verifiedDuplicateRecords.get(rewardedUnit.recordDigest);
      if (verified !== undefined) {
        if (verified !== rewardedUnit.recordJson)
          throw Error("Duplicate coverage record changed");
        continue;
      }
      const rows = await query(
        `SELECT record_json,record_digest FROM slopbot_work_unit_journal j WHERE record_digest=${quote(rewardedUnit.recordDigest)} AND NOT EXISTS (SELECT 1 FROM slopbot_work_unit_predecessors p WHERE p.predecessor_digest=j.record_digest)`,
      );
      if (
        rows.length !== 1 ||
        rows[0].record_digest !== rewardedUnit.recordDigest ||
        rows[0].record_json !== rewardedUnit.recordJson ||
        sha256Hex(rewardedUnit.recordJson) !== rewardedUnit.recordDigest
      )
        throw Error("Duplicate coverage record is missing or changed");
      verifiedDuplicateRecords.set(
        rewardedUnit.recordDigest,
        rewardedUnit.recordJson,
      );
    }
  }
  const expected = new Set(
    packet.valueSnapshot?.valueAssessmentCoverage?.flatMap((row) =>
      row.recordDigest ? [row.recordDigest] : [],
    ) ?? [],
  );
  for (const digest of expected) {
    if (!/^[a-f0-9]{64}$/u.test(digest))
      throw Error("Invalid value record binding");
    const rows = await query(
      `SELECT record_json,record_digest FROM slopbot_value_journal j WHERE record_digest=${quote(digest)} AND NOT EXISTS (SELECT 1 FROM slopbot_value_journal n WHERE n.supersedes=j.record_digest) UNION ALL SELECT record_json,record_digest FROM slopbot_work_unit_journal j WHERE record_digest=${quote(digest)} AND NOT EXISTS (SELECT 1 FROM slopbot_work_unit_predecessors p WHERE p.predecessor_digest=j.record_digest)`,
    );
    if (
      rows.length !== 1 ||
      rows[0].record_digest !== digest ||
      typeof rows[0].record_json !== "string" ||
      sha256Hex(rows[0].record_json) !== digest
    )
      throw Error("Historical value record is missing or changed");
    const record = JSON.parse(rows[0].record_json);
    const coverage =
      packet.valueSnapshot?.valueAssessmentCoverage?.filter(
        (row) => row.recordDigest === digest,
      ) ?? [];
    if (
      coverage.some(
        (row) =>
          !(
            (record.pullRequestNodeId === row.pullRequestId &&
              record.repositoryNodeId ===
                packet.sourceAudit.repositoryNodeId) ||
            record.sources?.some(
              (source: {
                pullRequestNodeId: string;
                repositoryNodeId: string;
              }) =>
                source.pullRequestNodeId === row.pullRequestId &&
                source.repositoryNodeId === packet.sourceAudit.repositoryNodeId,
            )
          ),
      )
    )
      throw Error("Historical value record source differs");
    if (record.projectId !== packet.projectId)
      throw Error("Historical value record belongs to another project");
    for (const row of coverage) {
      const audited = packet.sourceAudit.sources.find(
        (source) => source.id === row.pullRequestId,
      );
      const source =
        record.pullRequestNodeId === row.pullRequestId
          ? record
          : record.sources?.find(
              (source: { pullRequestNodeId: string }) =>
                source.pullRequestNodeId === row.pullRequestId,
            );
      if (!audited || source?.headSha !== audited.headSha)
        throw Error("Historical assessment head differs from audited source");
    }
  }
}

/** Canonical writer with same-transaction registry and account-restriction guards. */
export function historicalPointsSql(
  packet: HistoricalPointsPacket,
  candidate: PointsJournal,
  enforcementGeneration: number,
): string {
  if (!Number.isSafeInteger(enforcementGeneration) || enforcementGeneration < 0)
    throw Error("Invalid enforcement generation");
  const conditions = [
    `EXISTS (SELECT 1 FROM projects WHERE id=${quote(packet.projectId)} AND revision=${packet.revision} AND manifest_sha256=${quote(packet.manifestSha256)} AND status='active')`,
    `(SELECT COALESCE(MAX(rowid),0) FROM project_enforcements)=${enforcementGeneration}`,
  ];
  for (const actor of new Set(
    candidate.revisions
      .slice(packet.baselineRevisionCount)
      .filter(
        (r) => r.award.projectId === packet.projectId && r.award.amount > 0,
      )
      .map((r) => r.award.actor.id),
  )) {
    const id = githubUserIdFromNodeId(actor);
    if (!id) throw Error("Unknown historical actor identity");
    conditions.push(
      `NOT EXISTS (${PARTICIPATION_BAN_QUERY.replace(/\s+/gu, " ").replace("?", quote(id)).trim()})`,
    );
  }
  const guards = conditions
    .map(
      (condition) =>
        `INSERT INTO points_staging(batch_id,sequence,payload) SELECT NULL,0,NULL WHERE NOT (${condition});`,
    )
    .join("\n");
  return `${guards}\n${pointsSql(candidate)}`;
}

type PublicationPhase =
  | "trusted invocation"
  | "main source verification"
  | "private packet read"
  | "reviewed packet validation"
  | "enforcement checkpoint read"
  | "project and repository verification"
  | "owner authority verification"
  | "historical census verification"
  | "accepted squash verification"
  | "financial protection verification"
  | "value record verification"
  | "public Points read"
  | "recipient and account restriction verification"
  | "published checkpoint verification"
  | "historical Points reconstruction"
  | "import preparation"
  | "apply authority recheck"
  | "protected import and readback";

async function main(setPhase: (phase: PublicationPhase) => void) {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    process.env.GITHUB_REF !== "refs/heads/main"
  )
    throw Error(
      "Reviewed historical publication requires manual main workflow",
    );
  setPhase("main source verification");
  const checkout = (await execute("git", ["rev-parse", "HEAD"])).stdout.trim();
  const verifyMain = async () => {
    const current = (
      await execute("git", ["ls-remote", "origin", "refs/heads/main"])
    ).stdout.split(/\s/u)[0];
    if (checkout !== process.env.GITHUB_SHA || current !== checkout)
      throw Error("Historical publication source changed");
  };
  await verifyMain();
  const encoded = [1, 2, 3, 4]
    .map((n) => process.env[`HISTORICAL_POINTS_PACKET_${n}`] ?? "")
    .join("");
  const digest = process.env.REVIEWED_PACKET_SHA256 ?? "";
  const manifest = process.env.HISTORICAL_POINTS_OBJECT_MANIFEST;
  setPhase("private packet read");
  const bytes = manifest
    ? await (
        await reviewedPacketStorage(
          process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
          process.env.CLOUDFLARE_API_TOKEN ?? "",
        )
      ).read(manifest)
    : null;
  setPhase("reviewed packet validation");
  const packet =
    bytes === null
      ? decodeHistoricalPacket(encoded, digest)
      : decodeHistoricalPacketBytes(bytes, digest);
  const query: Query = async (sql) => {
    try {
      const { stdout } = await execute(
        resolve("node_modules/.bin/wrangler"),
        [
          "d1",
          "execute",
          "slop-private",
          "--remote",
          "--config",
          "workers/identity/wrangler.toml",
          "--json",
          "--command",
          sql,
        ],
        {
          env: {
            ...process.env,
            WRANGLER_LOG: "log",
            WRANGLER_WRITE_LOGS: "false",
          },
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      return octoberQueryRows(stdout);
    } catch {
      throw Error("Private historical read failed");
    }
  };
  setPhase("enforcement checkpoint read");
  const enforcement = await query(
    "SELECT COALESCE(MAX(rowid),0) AS generation FROM project_enforcements",
  );
  const generation = enforcement[0]?.generation;
  if (
    enforcement.length !== 1 ||
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation)
  )
    throw Error("Enforcement state unavailable");
  setPhase("project and repository verification");
  const registry = await fetchProjectRegistry();
  const revisions = registry.revisions as {
    projectId: string;
    revision: number;
    manifestSha256: string;
    manifest: unknown;
  }[];
  const revision = revisions.find(
    (r) => r.projectId === packet.projectId && r.revision === packet.revision,
  );
  const projects = registry.projects.map((p) => assertProjectDefinition(p));
  const project = projects.find((p) => p.id === packet.projectId);
  if (
    !project ||
    !revision ||
    revision.manifestSha256 !== packet.manifestSha256 ||
    hash(revision.manifest) !== packet.manifestSha256 ||
    JSON.stringify(project) !== JSON.stringify(revision.manifest) ||
    registry.withheld.includes(packet.projectId)
  )
    throw Error("Historical project changed");
  const policy = assertProjectDefinition(project);
  const identity = repositoryIdentity(policy, packet.sourceAudit.repository);
  if (identity?.nodeId !== packet.sourceAudit.repositoryNodeId)
    throw Error("Historical repository changed");
  setPhase("owner authority verification");
  await currentOwnerVerifier()(policy, packet.reviewerGithubId);
  setPhase("historical census verification");
  const github = GitHubClient.forToken(await resolveGitHubToken());
  await verifyHistoricalCensus(packet, github);
  setPhase("accepted squash verification");
  await verifyHistoricalAcceptedSquashes(packet, github);
  const verifiedIdenticalAcceptedChanges =
    await verifyHistoricalIdenticalAcceptedChanges(packet, github);
  setPhase("financial protection verification");
  await verifyHistoricalProtection(packet, query);
  setPhase("value record verification");
  await verifyHistoricalValueRecords(packet, query);
  setPhase("public Points read");
  const baseline = await loadPublishedPoints();
  if (!baseline) throw Error("Public Points baseline unavailable");
  setPhase("recipient and account restriction verification");
  const actors = new Set(
    [...latestPoints(baseline).values()]
      .filter((r) => r.award.projectId === packet.projectId)
      .map((r) => r.award.actor.id),
  );
  for (const correction of packet.recipientCorrections)
    for (const recipient of correction.recipients) {
      actors.add(recipient.actor.id);
      const user = await github.get<{
        id: number;
        node_id: string;
        login: string;
      }>(`/user/${recipient.githubId}`);
      if (
        !user ||
        String(user.id) !== recipient.githubId ||
        user.node_id !== recipient.actor.id ||
        user.login !== recipient.actor.login
      )
        throw Error("Reviewed recipient account changed");
    }
  const bans = await loadParticipationBans(github, fetch, actors);
  setPhase("published checkpoint verification");
  if (hash(baseline) === packet.candidateDigest) {
    const recorded = await query(
      `SELECT digest,revision_count,(SELECT COUNT(*) FROM points_staging WHERE batch_id=${quote(packet.candidateDigest)}) AS staged FROM points_batches WHERE digest=${quote(packet.candidateDigest)}`,
    );
    if (
      !correctionBatchRecorded(
        [{ success: true, results: recorded }],
        packet.candidateDigest,
        baseline.revisions.length,
      )
    )
      throw Error("Public candidate lacks D1 checkpoint");
    console.log(
      JSON.stringify({
        projectId: packet.projectId,
        enforcementGeneration: generation,
        mode: "already-published",
        candidateDigest: packet.candidateDigest,
      }),
    );
    return;
  }
  setPhase("historical Points reconstruction");
  const candidate = reconstructHistoricalPoints(
    packet,
    baseline,
    new Date().toISOString(),
    bans,
    verifiedIdenticalAcceptedChanges,
  );
  setPhase("import preparation");
  const directory = join(
    process.env.RUNNER_TEMP ?? "",
    "reviewed-historical-points",
  );
  await mkdir(directory, { mode: 0o700, recursive: true });
  const sqlPath = join(directory, "points.sql");
  await writeFile(sqlPath, historicalPointsSql(packet, candidate, generation), {
    mode: 0o600,
    flag: "wx",
  });
  if (process.env.HISTORICAL_POINTS_APPLY === "true") {
    setPhase("protected import and readback");
    await recordCorrection(candidate, {
      verifyMain: async () => {
        setPhase("apply authority recheck");
        await verifyMain();
        await currentOwnerVerifier()(policy, packet.reviewerGithubId);
        await verifyHistoricalProtection(packet, query);
        setPhase("protected import and readback");
      },
      importBatch: async () => {
        await execute(
          resolve("node_modules/.bin/wrangler"),
          [
            "d1",
            "execute",
            "slop-private",
            "--remote",
            "--config",
            "workers/identity/wrangler.toml",
            "--file",
            sqlPath,
          ],
          {
            env: {
              ...process.env,
              WRANGLER_LOG: "error",
              WRANGLER_WRITE_LOGS: "false",
            },
            maxBuffer: 1024 * 1024,
          },
        );
      },
      batchRecorded: async () =>
        correctionBatchRecorded(
          [
            {
              success: true,
              results: await query(
                `SELECT digest,revision_count,(SELECT COUNT(*) FROM points_staging WHERE batch_id=${quote(hash(candidate))}) AS staged FROM points_batches WHERE digest=${quote(hash(candidate))}`,
              ),
            },
          ],
          hash(candidate),
          candidate.revisions.length,
        ),
      loadPublic: loadPublishedPoints,
      wait: () => Bun.sleep(5000),
    });
  }
  console.log(
    JSON.stringify({
      projectId: packet.projectId,
      enforcementGeneration: generation,
      mode:
        process.env.HISTORICAL_POINTS_APPLY === "true"
          ? "verified-import"
          : "preview",
      baselineRevisions: baseline.revisions.length,
      candidateRevisions: candidate.revisions.length,
      candidateDigest: hash(candidate),
    }),
  );
}
if (import.meta.main) {
  let phase: PublicationPhase = "trusted invocation";
  await main((next) => {
    phase = next;
  }).catch(() => {
    // Error messages can contain command arguments or private responses.
    console.error(
      `Reviewed historical Points publication refused during ${phase}; private inputs retained in runner`,
    );
    process.exitCode = 1;
  });
}
