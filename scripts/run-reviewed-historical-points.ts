/** Main-only private publication of an independently reviewed historical project. */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { PARTICIPATION_BAN_QUERY } from "../backend/projects/account-bans";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import { latestPoints, type PointsJournal } from "../src/lib/points";
import {
  findListedRepository,
  repositoryIdentity,
} from "../src/lib/project-repositories.mjs";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { sha256Hex } from "../src/lib/sha256";
import { GitHubClient } from "../workers/slopbot/github";
import { mergedTimeRangeQualifier } from "../workers/slopbot/value-accepted-commit-census";
import { pullCommits } from "../workers/slopbot/value-evidence";
import type { Pull } from "../workers/slopbot/value-evidence-types";
import { loadPublishedPoints, pointsSql } from "./generate-points";
import { resolveGitHubToken } from "./github-token";
import {
  assertHistoricalAssessmentFreshness,
  type HistoricalAssessmentJournalHeads,
  historicalAssessmentRecordingConditions,
  historicalPointsBaselineCondition,
  readHistoricalAssessmentCatalog,
  readHistoricalAssessmentJournalHeads,
} from "./historical-assessment-catalog";
import {
  classifyHistoricalAssessmentScope,
  type HistoricalAssessmentReceipt,
  historicalClosedContextBindings,
  historicalEmptyLegacyClosureBindings,
} from "./historical-assessment-reconciliation";
import { verifyHistoricalNetOutcomes } from "./historical-net-outcome";
import {
  type HistoricalReplayReceipt,
  verifyHistoricalReplayQualification,
} from "./historical-replay-qualification";
import {
  assertRemovedMergeGroupsPreserved,
  projectHistoricalValueChanges,
  type VerifiedClosedReviews,
  verifyHistoricalClosedReviews,
  verifyHistoricalValueReplay,
} from "./historical-value-replay";
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
  HISTORICAL_POINTS_AUDIT_WINDOW,
  type HistoricalAcceptedSquash,
  type HistoricalPointsPacket,
  historicalProtectionQuery,
  matchesCarriedAcceptance,
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

type HistoricalSourceAudit = HistoricalPointsPacket["sourceAudit"];

/** Re-read the exact closed window by immutable PR and repository identity. */
export async function collectHistoricalSourceAudit(
  scope: Omit<HistoricalSourceAudit, "sources">,
  github: Pick<GitHubClient, "graphql">,
): Promise<HistoricalSourceAudit> {
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
          query: `repo:${scope.repository} is:pr is:merged ${mergedTimeRangeQualifier(Date.parse(from), Date.parse(through) - 1000)}`,
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
        if (row.repository?.id !== scope.repositoryNodeId)
          throw Error("Historical census repository changed");
        const mergedAt = new Date(row.mergedAt).toISOString();
        if (
          typeof row.id !== "string" ||
          !row.id ||
          !Number.isSafeInteger(row.number) ||
          row.number <= 0 ||
          !/^[a-f0-9]{40}$/u.test(row.headRefOid) ||
          mergedAt < from ||
          mergedAt >= through
        )
          throw Error("Historical census source is invalid");
        rows.push({
          id: row.id,
          number: row.number,
          headSha: row.headRefOid,
          mergedAt,
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
  const sources = await collect(scope.from, scope.through);
  if (
    !sources.length ||
    new Set(sources.map(({ number }) => number)).size !== sources.length
  )
    throw Error("Historical census pull request numbers are invalid");
  return {
    repository: scope.repository,
    repositoryNodeId: scope.repositoryNodeId,
    from: scope.from,
    through: scope.through,
    sources: sources.sort((a, b) => a.number - b.number),
  };
}

export async function verifyHistoricalCensus(
  packet: HistoricalPointsPacket,
  github: Pick<GitHubClient, "graphql">,
): Promise<void> {
  const { sources, ...scope } = packet.sourceAudit;
  const current = await collectHistoricalSourceAudit(scope, github);
  const ordered = (rows: HistoricalSourceAudit["sources"]) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id));
  if (
    JSON.stringify(ordered(current.sources)) !==
    JSON.stringify(ordered(sources))
  )
    throw Error("Reviewed historical census changed");
}

/** A PR reporting an earlier merge may already carry the other PR's merge. */
export async function verifyHistoricalDuplicateAcceptanceOrder(
  packet: Pick<HistoricalPointsPacket, "sourceAudit" | "duplicateRetirements">,
  github: Pick<GitHubClient, "get">,
): Promise<void> {
  const retirements = (packet.duplicateRetirements ?? []).filter(
    (item) => !item.identicalAcceptedChange,
  );
  if (!retirements.length) return;
  const audit = packet.sourceAudit;
  const root = `/repos/${audit.repository}`;
  const repository = await github.get<PublicMergeRepository>(root);
  if (
    repository?.node_id !== audit.repositoryNodeId ||
    repository.full_name?.toLowerCase() !== audit.repository.toLowerCase()
  )
    throw Error("Duplicate acceptance repository changed");
  const sha = /^[a-f0-9]{40}$/u;
  const auditedSources = new Map(audit.sources.map((row) => [row.id, row]));
  const pulls = new Map<number, Promise<Pull | null>>();
  const checked = new Set<string>();
  type Source = Pick<
    (typeof retirements)[number]["source"],
    "sourceId" | "sourceUrl" | "headSha" | "occurredAt" | "repositoryNodeId"
  >;
  async function readSource(
    source: Source,
    number: number | undefined,
    ...expectedMerges: (string | undefined)[]
  ) {
    if (
      number === undefined ||
      !Number.isSafeInteger(number) ||
      number <= 0 ||
      source.repositoryNodeId !== audit.repositoryNodeId ||
      source.sourceUrl !==
        `https://github.com/${audit.repository}/pull/${number}`
    )
      throw Error("Duplicate acceptance source is outside the reviewed scope");
    let pending = pulls.get(number);
    if (!pending) {
      pending = github.get<Pull>(`${root}/pulls/${number}`);
      pulls.set(number, pending);
    }
    const pull = await pending;
    if (
      !pull ||
      pull.number !== number ||
      pull.node_id !== source.sourceId ||
      pull.state !== "closed" ||
      pull.html_url !== source.sourceUrl ||
      pull.head.sha !== source.headSha ||
      !sha.test(pull.head.sha) ||
      !pull.merged_at ||
      new Date(pull.merged_at).toISOString() !== source.occurredAt ||
      !pull.merge_commit_sha ||
      !sha.test(pull.merge_commit_sha) ||
      expectedMerges.some(
        (merge) => merge !== undefined && merge !== pull.merge_commit_sha,
      )
    )
      throw Error("Duplicate acceptance source changed");
    return { head: pull.head.sha, merge: pull.merge_commit_sha };
  }
  for (const retirement of retirements) {
    const retired = await readSource(
      retirement.source,
      auditedSources.get(retirement.sourceId)?.number,
      retirement.acceptedPromotion?.mergeSha,
      retirement.unchangedPromotion?.merge.sha,
    );
    for (const source of [
      ...retirement.earlierSources,
      ...(retirement.acceptedSquashes ?? []),
    ]) {
      const context = retirement.earlierAcceptanceProof?.contextSources.find(
        (row) => row.id === source.sourceId,
      );
      const squash = retirement.acceptedSquashes?.find(
        (row) => row.sourceId === source.sourceId,
      );
      const earlier = await readSource(
        source,
        auditedSources.get(source.sourceId)?.number ?? context?.number,
        context?.mergeSha,
        squash?.commit.sha,
      );
      if (retired.merge === earlier.merge) continue;
      for (const earlierRevision of new Set([earlier.head, earlier.merge])) {
        const pair = `${retired.merge}...${earlierRevision}`;
        if (checked.has(pair)) continue;
        const comparison = await github.get<{
          status: string;
          behind_by: number;
          base_commit: { sha: string };
          merge_base_commit: { sha: string };
        }>(`${root}/compare/${pair}?per_page=1&page=1`);
        const common = comparison?.merge_base_commit?.sha;
        if (
          comparison?.base_commit?.sha !== retired.merge ||
          !common ||
          !sha.test(common) ||
          !Number.isSafeInteger(comparison.behind_by) ||
          comparison.behind_by < 0
        )
          throw Error("Duplicate acceptance ancestry is unavailable");
        if (
          (comparison.status === "ahead" ||
            comparison.status === "identical") &&
          comparison.behind_by === 0 &&
          common === retired.merge
        )
          throw Error("Earlier source already carries the retiring PR's merge");
        if (
          (comparison.status !== "behind" &&
            comparison.status !== "diverged") ||
          comparison.behind_by === 0 ||
          common === retired.merge
        )
          throw Error("Duplicate acceptance ancestry is inconsistent");
        checked.add(pair);
      }
    }
  }
}

/** Verify the complete duplicate changes, including paths and both object IDs. */
export async function verifyHistoricalIdenticalAcceptedChanges(
  packet: Pick<HistoricalPointsPacket, "sourceAudit" | "duplicateRetirements">,
  github: Pick<GitHubClient, "get">,
  withObjects = withPublicGitObjects,
  options?: {
    integrationBranch: string;
    beforeImportChecks: (() => Promise<void>)[];
    fetchBranchTip?: (
      directory: string,
      previous: string,
      current: string,
    ) => Promise<void>;
  },
): Promise<ReadonlySet<string>> {
  const candidates = (packet.duplicateRetirements ?? []).filter(
    (retirement) => retirement.identicalAcceptedChange !== undefined,
  );
  if (!candidates.length) return new Set();
  const root = `/repos/${packet.sourceAudit.repository}`;
  const repository = await github.get<PublicMergeRepository>(root);
  if (
    repository?.node_id !== packet.sourceAudit.repositoryNodeId ||
    repository.full_name?.toLowerCase() !==
      packet.sourceAudit.repository.toLowerCase()
  )
    throw Error("Reviewed identical change repository changed");
  const objects = new Set<string>();
  const branches = new Map<
    string,
    { tip: string; retiringMerges: Set<string> }
  >();
  const sha = /^[a-f0-9]{40}$/u;
  function sameRepository(other: PublicMergeRepository | null | undefined) {
    return (
      other?.node_id === repository?.node_id &&
      other?.id === repository?.id &&
      other?.private === false &&
      repository?.private === false &&
      other.full_name?.toLowerCase() === repository.full_name?.toLowerCase()
    );
  }
  async function readBranchTip(ref: string) {
    const result = await github.get<{
      ref: string;
      object: { sha: string; type: string };
    }>(
      `${root}/git/ref/heads/${ref.split("/").map(encodeURIComponent).join("/")}`,
    );
    if (
      result?.ref !== `refs/heads/${ref}` ||
      result.object?.type !== "commit" ||
      !sha.test(result.object.sha) ||
      !sameRepository(await github.get<PublicMergeRepository>(root))
    )
      throw Error("Surviving carrier branch is unavailable");
    return result.object.sha;
  }
  const checks: {
    verifyNative: (directory: string) => Promise<void>;
    recheck: () => Promise<void>;
    digest: string;
  }[] = [];
  for (const retirement of candidates) {
    const proof = retirement.identicalAcceptedChange;
    const earlier = retirement.earlierSources.find(
      (source) => source.sourceId === proof?.earlierSourceId,
    );
    if (!proof || !earlier) throw Error("Reviewed earlier source is missing");
    const originalCommit = retirement.source.commits[0];
    const originalAuthor = retirement.source.author;
    const emptySquash = proof.emptySquash === true;
    const sharedMerge = proof.earlierMergeSha === proof.mergeSha;
    const survivingCarrier = proof.survivingCarrier === true;
    const carried = proof.carriedAcceptance === true;
    if (
      !sha.test(proof.earlierMergeSha) ||
      !sha.test(proof.mergeSha) ||
      (sharedMerge &&
        (emptySquash ||
          earlier.sourceId === retirement.source.sourceId ||
          earlier.headSha !== retirement.source.headSha)) ||
      !/^[a-f0-9]{64}$/u.test(proof.diffSha256) ||
      (proof.survivingCarrier !== undefined &&
        (!survivingCarrier || emptySquash || sharedMerge)) ||
      (proof.carriedAcceptance !== undefined &&
        (!carried ||
          emptySquash ||
          sharedMerge ||
          survivingCarrier ||
          !matchesCarriedAcceptance(
            retirement.source,
            earlier,
            proof.earlierMergeSha,
          ))) ||
      (proof.emptySquash !== undefined && proof.emptySquash !== true)
    )
      throw Error("Reviewed identical change identity is invalid");
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
      const pull = await github.get<
        Pull & { base: { repo?: PublicMergeRepository | null } }
      >(`${root}/pulls/${audit.number}`);
      if (
        !pull ||
        ((survivingCarrier || carried) && !sameRepository(pull.base.repo)) ||
        pull.node_id !== source.sourceId ||
        pull.number !== audit.number ||
        pull.head.sha !== source.headSha ||
        !sha.test(pull.head.sha) ||
        !sha.test(pull.base.sha) ||
        pull.merge_commit_sha !== mergeSha ||
        !pull.merged_at ||
        new Date(pull.merged_at).toISOString() !== source.occurredAt ||
        pull.commits !== source.commitCount ||
        ((emptySquash || sharedMerge || survivingCarrier || carried) &&
          (pull.state !== "closed" ||
            pull.html_url !== source.sourceUrl ||
            pull.user?.node_id !== source.author?.id ||
            pull.user?.type !== source.author?.kind))
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
    if (sharedMerge && checked[0].pull.base.sha !== checked[1].pull.base.sha)
      throw Error("Shared acceptance has differing submitted bases");
    if (
      carried &&
      (!Number.isSafeInteger(checked[0].pull.changed_files) ||
        checked[0].pull.changed_files < 1 ||
        checked[0].pull.changed_files !== checked[1].pull.changed_files ||
        proof.diffSha256 === sha256Hex(""))
    )
      throw Error("Carried merge has different or empty accepted changes");
    async function verifyOriginalAuthor() {
      const recorded = await github.get<{
        sha: string;
        author: { node_id: string; type: string } | null;
      }>(`${root}/commits/${originalCommit.sha}`);
      if (
        recorded?.sha !== originalCommit.sha ||
        recorded.author?.node_id !== originalAuthor?.id ||
        recorded.author?.type !== "User"
      )
        throw Error("Surviving carrier original commit author changed");
    }
    let branchTip: string | undefined;
    if (survivingCarrier) {
      const base = checked[0].pull.base;
      const other = checked[1].pull.base;
      if (
        !base.ref ||
        base.ref !== other.ref ||
        base.sha !== other.sha ||
        (options && base.ref !== options.integrationBranch)
      )
        throw Error("Surviving carrier needs one reported integration base");
      if (
        originalAuthor?.kind !== "User" ||
        retirement.source.commits.length !== 1 ||
        originalCommit.sha !== retirement.source.headSha ||
        originalCommit.parentCount !== 1 ||
        originalCommit.parentShas?.length !== 1 ||
        originalCommit.parentShas[0] !== base.sha ||
        originalCommit.author?.id !== originalAuthor.id ||
        originalCommit.author?.kind !== "User" ||
        !earlier.commits.some((commit) => commit.sha === proof.mergeSha) ||
        !earlier.commits.some((commit) => commit.sha === originalCommit.sha)
      )
        throw Error("Surviving carrier needs the original author's commit");
      await verifyOriginalAuthor();
      let branch = branches.get(base.ref);
      if (!branch) {
        branch = {
          tip: await readBranchTip(base.ref),
          retiringMerges: new Set(),
        };
        branches.set(base.ref, branch);
      }
      branch.retiringMerges.add(proof.mergeSha);
      branchTip = branch.tip;
      objects.add(branchTip);
    }
    for (const { mergeSha, pull } of checked) {
      objects.add(mergeSha);
      objects.add(pull.head.sha);
      objects.add(pull.base.sha);
    }
    checks.push({
      digest: hash(retirement),
      async recheck() {
        await Promise.all(
          checked.map(async (binding) => {
            const before = binding.pull;
            const after = await verifyPull(binding);
            if (
              after.base.sha !== before.base.sha ||
              after.base.ref !== before.base.ref ||
              after.changed_files !== before.changed_files
            )
              throw Error(
                "Reviewed identical change source changed during verification",
              );
          }),
        );
        if (survivingCarrier) await verifyOriginalAuthor();
      },
      async verifyNative(directory) {
        const nativeGit = async (...args: string[]) => {
          const command = publicGitProcess(directory, args);
          return (await execute(command.file, command.args, command.options))
            .stdout;
        };
        if (branchTip) {
          const base = checked[0].pull.base.sha;
          const [submitted, integrated, trees] = await Promise.all([
            nativeGit(
              "rev-list",
              "--first-parent",
              checked[0].pull.head.sha,
              `^${base}`,
            ),
            nativeGit("rev-list", "--first-parent", branchTip, `^${base}`),
            nativeGit(
              "rev-parse",
              `${proof.earlierMergeSha}^{tree}`,
              `${proof.mergeSha}^{tree}`,
            ),
          ]);
          const [carrierTree, originalTree] = trees.trim().split("\n");
          const firstParent = new Set(integrated.trim().split("\n"));
          if (
            !submitted.trim().split("\n").includes(proof.mergeSha) ||
            !firstParent.has(proof.earlierMergeSha) ||
            firstParent.has(proof.mergeSha) ||
            !sha.test(carrierTree) ||
            carrierTree !== originalTree
          )
            throw Error(
              "Surviving carrier does not match the published first-parent edge",
            );
        } else if (!sharedMerge) {
          const earlierRevisions = new Set([
            checked[0].pull.head.sha,
            proof.earlierMergeSha,
          ]);
          for (const revision of earlierRevisions) {
            try {
              await nativeGit(
                "merge-base",
                "--is-ancestor",
                proof.mergeSha,
                revision,
              );
            } catch (error) {
              if (
                error &&
                typeof error === "object" &&
                "code" in error &&
                error.code === 1
              )
                continue;
              throw error;
            }
            throw Error(
              "Earlier source already carries the retiring PR's merge",
            );
          }
        }
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
        let carriedBaseTree: string | undefined;
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
            ((sharedMerge || survivingCarrier) && first !== pull.base.sha) ||
            ((survivingCarrier || carried) && second === undefined) ||
            (second !== undefined && second !== pull.head.sha) ||
            extra.length
          )
            throw Error("Identical change needs the complete accepted merge");
          const matchesRange = async (base: string) => {
            const range = new Map(
              (
                await nativeGit(
                  "rev-list",
                  "--parents",
                  pull.head.sha,
                  `^${base}`,
                )
              )
                .trim()
                .split("\n")
                .map((line) => {
                  const [id, ...parents] = line.split(" ");
                  return [id, parents] as const;
                }),
            );
            return (
              range.size === source.commits.length &&
              range.size ===
                new Set(source.commits.map(({ sha }) => sha)).size &&
              source.commits.every(
                (member) =>
                  range.has(member.sha) &&
                  hash(range.get(member.sha)) === hash(member.parentShas),
              )
            );
          };
          if (
            !(await matchesRange(pull.base.sha)) ||
            (carried && first !== pull.base.sha && !(await matchesRange(first)))
          )
            throw Error("Identical change has incomplete submitted commits");
          if (carried) {
            const baseTree = (
              await nativeGit("rev-parse", `${first}^{tree}`)
            ).trim();
            const headTree = (
              await nativeGit("rev-parse", `${pull.head.sha}^{tree}`)
            ).trim();
            const acceptedTree = (
              await nativeGit("rev-parse", `${mergeSha}^{tree}`)
            ).trim();
            if (
              headTree !== acceptedTree ||
              (carriedBaseTree !== undefined && carriedBaseTree !== baseTree)
            )
              throw Error("Carried merge has different base or accepted trees");
            carriedBaseTree = baseTree;
            if (
              source === retirement.source &&
              (
                await nativeGit(
                  "merge-tree",
                  "--write-tree",
                  "--no-messages",
                  first,
                  pull.head.sha,
                )
              ).trim() !== acceptedTree
            )
              throw Error("Carried merge has independent resolution changes");
            // Both complete accepted code changes must match the reviewed raw diff.
            if (
              (await changeDigest(directory, first, mergeSha)) !==
              proof.diffSha256
            )
              throw Error("Complete accepted changes differ");
            continue;
          }
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
          // A shared native object with the same complete range covers the
          // entire earlier and later record, including submitted merges.
          if (!sharedMerge && source === retirement.source) {
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
    });
  }
  async function recheckSources() {
    for (const check of checks) await check.recheck();
  }
  const branchChecks: (() => Promise<void>)[] = [];
  const refreshed = false;
  // Keep the verified graph available when checking a mutable carrier branch.
  await withObjects(repository, [...objects], async (directory) => {
    for (const check of checks) await check.verifyNative(directory);
    if (!branches.size) return;
    await recheckSources();
    for (const [ref, { tip, retiringMerges }] of branches) {
      const current = await readBranchTip(ref);
      const verifyTip = async () => {
        if ((await readBranchTip(ref)) !== current)
          throw Error("Surviving carrier integration branch changed");
      };
      if (current !== tip) {
        if (options?.fetchBranchTip) {
          await options.fetchBranchTip(directory, tip, current);
        } else {
          // Keep the same verified repository and secure Git options. The
          // previous tip lets Git transfer only objects missing from this graph.
          const acquisition = publicGitProcess(directory, [
            "fetch",
            "--no-tags",
            "--no-recurse-submodules",
            "--no-write-fetch-head",
            `--negotiation-tip=${tip}`,
            `https://github.com/${repository.full_name}.git`,
            current,
          ]);
          await execute(acquisition.file, acquisition.args, {
            ...acquisition.options,
            timeout: 1_800_000,
          });
        }
        const command = publicGitProcess(directory, [
          "rev-list",
          "--parents",
          "--first-parent",
          "--exclude-first-parent-only",
          current,
          `^${tip}`,
        ]);
        const { stdout } = await execute(
          command.file,
          command.args,
          command.options,
        );
        const added = stdout
          .trim()
          .split("\n")
          .map((row) => row.split(" "));
        // The oldest added commit must extend the proved first-parent chain.
        if (
          added.at(-1)?.[1] !== tip ||
          added.some(([commit]) => retiringMerges.has(commit))
        )
          throw Error("Surviving carrier integration branch changed");
        await verifyTip();
      }
      options?.beforeImportChecks.push(verifyTip);
    }
  });
  if (!branches.size || refreshed) await recheckSources();
  if (refreshed) {
    for (const verifyTip of branchChecks) await verifyTip();
  }
  options?.beforeImportChecks.push(...branchChecks);
  return new Set(checks.map(({ digest }) => digest));
}

/** Recheck GitHub's exact accepted squash relation before using retained bytes. */
export async function verifyHistoricalAcceptedSquashes(
  packet: HistoricalPointsPacket,
  github: Pick<GitHubClient, "graphql" | "get">,
  withObjects = withPublicGitObjects,
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
      await withObjects(
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
    const repository = await github.get<PublicMergeRepository>(root);
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
    if (retirement.earlierAcceptanceProof?.acceptedMergeEdges?.length) {
      const mergeSha = pull.merge_commit_sha;
      if (!mergeSha) throw Error("Accepted promotion merge is unavailable");
      const expectedMembers = new Set(
        retirement.source.commits.map(({ sha, parentShas }) =>
          [sha, ...(parentShas ?? [])].join(" "),
        ),
      );
      const maxBuffer = [...expectedMembers].reduce(
        (bytes, line) => bytes + line.length + 1,
        1024 * 1024,
      );
      await withObjects(repository, [mergeSha], async (directory) => {
        const git = async (...args: string[]) => {
          const command = publicGitProcess(directory, args);
          return (
            await execute(command.file, command.args, {
              ...command.options,
              maxBuffer,
            })
          ).stdout.trim();
        };
        const [parentLine, acceptedTree] = await Promise.all([
          git("show", "--no-patch", "--format=%P", mergeSha),
          git("rev-parse", `${mergeSha}^{tree}`),
        ]);
        const parents = parentLine.split(" ");
        if (
          parents.length !== 2 ||
          parents[1] !== pull.head.sha ||
          !parents.every((parent) => /^[a-f0-9]{40}$/u.test(parent))
        )
          throw Error("Carried acceptance promotion has different parents");
        const nativeMembers = (
          await git("rev-list", "--parents", parents[1], `^${parents[0]}`, "--")
        ).split("\n");
        if (
          nativeMembers.length !== expectedMembers.size ||
          nativeMembers.some((member) => !expectedMembers.delete(member))
        )
          throw Error(
            "Carried acceptance promotion has different native members",
          );
        const automatic = await git(
          "merge-tree",
          "--write-tree",
          "--no-messages",
          parents[0],
          parents[1],
        );
        if (automatic !== acceptedTree)
          throw Error(
            "Carried acceptance promotion has independent merge changes",
          );
      });
    }
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
  options: { qualifiedReplay?: true } = {},
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
  // An authenticated replay qualification already verified the canonical
  // snapshot at its captured heads, including stale or unresolved records.
  if (options.qualifiedReplay) return;
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

/** Canonical writer with registry, account-restriction and assessment guards. */
export function historicalPointsSql(
  packet: HistoricalPointsPacket,
  candidate: PointsJournal,
  enforcementGeneration: number,
  assessmentHeads: HistoricalAssessmentJournalHeads,
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
  const assessmentConditions = historicalAssessmentRecordingConditions(
    {
      projectId: packet.projectId,
      repositoryNodeId: packet.sourceAudit.repositoryNodeId,
    },
    assessmentHeads,
  );
  assessmentConditions.push(
    historicalPointsBaselineCondition(
      packet.baselineDigest,
      packet.baselineRevisionCount,
    ),
  );
  return `${guards}\n${pointsSql(candidate, assessmentConditions)}`;
}

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

type PublicationPhase =
  | "trusted invocation"
  | "main source verification"
  | "private packet read"
  | "reviewed packet validation"
  | "enforcement checkpoint read"
  | "project and repository verification"
  | "owner authority verification"
  | "historical census verification"
  | "duplicate acceptance order verification"
  | "accepted squash verification"
  | "financial protection verification"
  | "assessment journal checkpoint read"
  | "trusted replay receipt read"
  | "assessment qualification match"
  | "value record verification"
  | "complete assessment catalog read"
  | "assessment source reconciliation"
  | "historical assessment replay"
  | "assessment qualification recheck"
  | "private replay review staging"
  | "assessment receipt"
  | "public Points read"
  | "recipient and account restriction verification"
  | "published checkpoint verification"
  | "historical Points reconstruction"
  | "import preparation"
  | "apply authority recheck"
  | "protected import and readback";

export function historicalAssessmentAuditInputs(
  env: Readonly<Record<string, string | undefined>>,
  replay = false,
) {
  if (
    (env.HISTORICAL_POINTS_APPLY ?? "false") !== "false" ||
    env.REVIEWED_PACKET_SHA256
  )
    throw Error(
      "Assessment audit requires a read-only invocation without a packet",
    );
  const projectId = env.HISTORICAL_ASSESSMENT_PROJECT ?? "";
  const sourceDigest = env.HISTORICAL_SOURCE_AUDIT_SHA256 ?? "";
  const expectedPointsDigest = env.HISTORICAL_POINTS_BASELINE_SHA256 ?? "";
  const review = env.HISTORICAL_ASSESSMENT_STAGE_REVIEW ?? "false";
  if (
    !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(projectId) ||
    ![sourceDigest, expectedPointsDigest].every((digest) =>
      /^[a-f0-9]{64}$/u.test(digest),
    )
  )
    throw Error("Assessment audit requires exact scope and baseline digests");
  if (
    review !== "false" &&
    (review !== "true" ||
      !replay ||
      !env.GITHUB_REPOSITORY ||
      env.GITHUB_WORKFLOW_REF !==
        `${env.GITHUB_REPOSITORY}/.github/workflows/reviewed-historical-points.yml@refs/heads/main` ||
      env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA ||
      !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? ""))
  )
    throw Error("Historical review staging requires the exact replay workflow");
  return {
    projectId,
    sourceDigest,
    expectedPointsDigest,
    stageReview: review === "true",
  };
}

async function auditHistoricalAssessments(
  setPhase: (phase: PublicationPhase) => void,
  verifyMain: () => Promise<void>,
  replay: boolean,
): Promise<void> {
  const { projectId, sourceDigest, expectedPointsDigest, stageReview } =
    historicalAssessmentAuditInputs(process.env, replay);

  setPhase("project and repository verification");
  const registry = await fetchProjectRegistry();
  const project = registry.projects
    .map(assertProjectDefinition)
    .find((row) => row.id === projectId);
  const revisions = registry.revisions as {
    projectId: string;
    revision: number;
    manifestSha256: string;
    manifest: unknown;
  }[];
  const revision = revisions
    .filter((row) => row.projectId === projectId)
    .sort((a, b) => b.revision - a.revision)[0];
  if (
    !project ||
    !revision ||
    registry.withheld.includes(projectId) ||
    project.repositories.length !== 1 ||
    hash(project) !== revision.manifestSha256 ||
    hash(revision.manifest) !== revision.manifestSha256 ||
    JSON.stringify(project) !== JSON.stringify(revision.manifest)
  )
    throw Error("Assessment audit requires the complete current project scope");
  const repository = project.repositories[0].id;
  const identity = repositoryIdentity(project, repository);
  if (!identity) throw Error("Historical repository identity unavailable");
  const token = await resolveGitHubToken();
  const github = GitHubClient.forToken(token);
  const liveRepository = await github.get<PublicMergeRepository>(
    `/repos/${repository}`,
  );
  if (
    liveRepository?.node_id !== identity.nodeId ||
    String(liveRepository.id) !== String(identity.githubId) ||
    liveRepository.full_name?.toLowerCase() !== repository.toLowerCase() ||
    liveRepository.private !== false
  )
    throw Error("Historical repository identity changed");
  setPhase("historical census verification");
  const sourceAudit = await collectHistoricalSourceAudit(
    {
      repository,
      repositoryNodeId: identity.nodeId,
      ...HISTORICAL_POINTS_AUDIT_WINDOW,
    },
    github,
  );
  if (hash(sourceAudit) !== sourceDigest)
    throw Error("Assessment audit source digest changed");

  setPhase("complete assessment catalog read");
  const scope = {
    projectId,
    repositoryNodeId: identity.nodeId,
    revision: revision.revision,
    manifestSha256: revision.manifestSha256,
    expectedPointsDigest,
  };
  const catalog = await readHistoricalAssessmentCatalog(scope, query);
  setPhase("public Points read");
  const baseline = await loadPublishedPoints();
  if (
    !baseline ||
    hash(baseline) !== expectedPointsDigest ||
    baseline.revisions.length !== catalog.heads.d1PointsCount
  )
    throw Error(
      "Assessment audit Points baseline differs from the public journal",
    );

  setPhase("assessment source reconciliation");
  const receipt = await classifyHistoricalAssessmentScope(
    catalog,
    sourceAudit,
    projectId,
    github,
    { baseline, integrationBranch: project.repositories[0].integrationBranch },
  );
  const report = {
    schemaVersion: "1",
    projectId,
    mode: replay ? "assessment-replay" : "assessment-audit",
    status: receipt.status,
    sourceDigest,
    sourceCount: sourceAudit.sources.length,
    sourceRepositoryNodeId: scope.repositoryNodeId,
    sourceFrom: sourceAudit.from,
    sourceThrough: sourceAudit.through,
    sourceCommit: process.env.GITHUB_SHA,
    expectedPointsDigest,
    baselineRevisionCount: baseline.revisions.length,
    registryRevision: catalog.heads.registryRevision,
    registryManifestSha256: catalog.heads.registryManifestSha256,
    enforcementGeneration: catalog.heads.enforcementGeneration,
    jointThrough: catalog.heads.jointThrough,
    legacyThrough: catalog.heads.legacyThrough,
    jointRecords: catalog.heads.jointScopedCount,
    legacyRecords: catalog.heads.legacyRepoCount,
    receiptDigest: receipt.receiptSha256,
  };
  if (receipt.status === "incomplete") {
    console.log(JSON.stringify({ ...report, blockerCodes: receipt.blockers }));
    throw Error("Assessment catalog could not be reconciled");
  }
  let replayResult: HistoricalReplayReceipt["replay"] | undefined;
  let valueSnapshot: HistoricalPointsPacket["valueSnapshot"] = null;
  let valueKeys: HistoricalPointsPacket["valueKeys"] = [];
  if (replay && receipt.status === "requires-value-replay") {
    setPhase("historical assessment replay");
    const { generateHistoricalLeaderboardFromGitHub, GitHubGraphqlClient } =
      await import("./generate-leaderboard");
    let lastPhase = "";
    const snapshot = await generateHistoricalLeaderboardFromGitHub(
      new GitHubGraphqlClient(token),
      {
        scope: { ...scope, repository },
        audit: sourceAudit,
        catalog,
        baseline,
        closedContexts: historicalClosedContextBindings(receipt),
        emptyLegacyClosures: historicalEmptyLegacyClosureBindings(receipt),
      },
      {
        evidenceToken: token,
        onProgress: ({ phase, completed, total }) => {
          if (phase !== lastPhase || completed === total) {
            console.log(JSON.stringify({ phase, completed, total }));
            lastPhase = phase;
          }
        },
      },
    );
    const closedUnmergedCoverageCount =
      snapshot.source.counts.closedUnmergedPullRequests ?? 0;
    const binding = {
      projectId,
      sourceAudit,
      revision: scope.revision,
      manifestSha256: scope.manifestSha256,
      baselineDigest: expectedPointsDigest,
      baselineRevisionCount: baseline.revisions.length,
    };
    const closedReviews = await verifyHistoricalClosedReviews(
      snapshot,
      receipt,
      catalog,
      github,
    );
    const allocation = projectHistoricalValueChanges(
      binding,
      baseline,
      snapshot,
      closedReviews,
    );
    valueSnapshot = snapshot;
    valueKeys = allocation.rows.map((row) => row.award.key);
    const qualificationSha256 = verifyHistoricalValueReplay(
      { ...binding, valueSnapshot, valueKeys },
      baseline,
      receipt,
      snapshot,
      closedReviews,
    );
    replayResult = {
      snapshotSha256: hash(snapshot),
      valueCoverageCount: snapshot.valueAssessmentCoverage?.length ?? 0,
      closedUnmergedCoverageCount,
      valueEventCount: snapshot.ledger.filter((row) =>
        row.scoreDecisionSourceId?.startsWith("value:"),
      ).length,
      qualificationSha256,
    };
  } else if (replay) {
    replayResult = {
      snapshotSha256: null,
      valueCoverageCount: 0,
      closedUnmergedCoverageCount: 0,
      valueEventCount: 0,
      qualificationSha256: verifyHistoricalValueReplay(
        {
          projectId,
          sourceAudit,
          revision: scope.revision,
          manifestSha256: scope.manifestSha256,
          baselineDigest: expectedPointsDigest,
          baselineRevisionCount: baseline.revisions.length,
          valueSnapshot: null,
          valueKeys: [],
        },
        baseline,
        receipt,
        null,
      ),
    };
  }
  setPhase("assessment qualification recheck");
  await verifyMain();
  await assertHistoricalAssessmentFreshness(scope, catalog.heads, query);
  const summary = {
    ...report,
    ...(replayResult ? { replay: replayResult } : {}),
  };
  let output = summary;
  if (stageReview) {
    setPhase("private replay review staging");
    if (!replayResult?.qualificationSha256)
      throw Error("Only a qualified replay can stage a private review");
    const [{ stageHistoricalReplayReview }, { privatePacketPreviewStorage }] =
      await Promise.all([
        import("./historical-replay-review"),
        import("./private-packet-preview"),
      ]);
    const privateReviewManifest = await stageHistoricalReplayReview(
      {
        sourceAudit,
        valueSnapshot,
        valueKeys,
        qualificationSha256: replayResult.qualificationSha256,
      },
      privatePacketPreviewStorage(
        process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
        process.env.CLOUDFLARE_API_TOKEN ?? "",
      ),
    );
    setPhase("assessment qualification recheck");
    await verifyMain();
    await assertHistoricalAssessmentFreshness(scope, catalog.heads, query);
    output = { ...summary, replay: { ...replayResult, privateReviewManifest } };
  }
  setPhase("assessment receipt");
  const directory = join(
    process.env.RUNNER_TEMP ?? "",
    "historical-assessment-audit",
  );
  await mkdir(directory, { mode: 0o700, recursive: true });
  await writeFile(
    join(directory, "receipt.json"),
    `${JSON.stringify(output)}\n`,
    {
      mode: 0o600,
      flag: "wx",
    },
  );
  console.log(JSON.stringify(summary));
}

async function readTrustedHistoricalReplay(
  reference: NonNullable<HistoricalPointsPacket["replayQualification"]>,
  sourceCommit: string,
): Promise<HistoricalReplayReceipt> {
  const token = process.env.HISTORICAL_REPLAY_ACTIONS_TOKEN;
  if (!token?.trim()) throw new Error("Trusted replay read token unavailable");
  const { stdout } = await execute(
    "python3",
    [
      "-I",
      "scripts/restore-historical-assessment-replay.py",
      String(reference.runId),
      String(reference.attempt),
      String(reference.artifactId),
      sourceCommit,
    ],
    {
      env: { ...process.env, GH_TOKEN: token },
      timeout: 120_000,
      maxBuffer: 256 * 1024,
    },
  );
  return JSON.parse(stdout) as HistoricalReplayReceipt;
}

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
  const flags = process.argv.slice(2);
  if (
    flags.length === 1 &&
    (flags[0] === "--audit-assessments" || flags[0] === "--replay-assessments")
  )
    return auditHistoricalAssessments(
      setPhase,
      verifyMain,
      flags[0] === "--replay-assessments",
    );
  if (flags.length !== 0) throw Error("Unknown historical Points operation");
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
  setPhase("duplicate acceptance order verification");
  await verifyHistoricalDuplicateAcceptanceOrder(packet, github);
  setPhase("accepted squash verification");
  await verifyHistoricalAcceptedSquashes(packet, github);
  const carrierBranchChecks: (() => Promise<void>)[] = [];
  const integration = findListedRepository(
    policy.repositories,
    packet.sourceAudit.repository,
  );
  const verifiedIdenticalAcceptedChanges =
    await verifyHistoricalIdenticalAcceptedChanges(
      packet,
      github,
      withPublicGitObjects,
      {
        integrationBranch: integration?.repository.integrationBranch ?? "",
        beforeImportChecks: carrierBranchChecks,
      },
    );
  const verifiedDuplicateChanges = new Set([
    ...verifiedIdenticalAcceptedChanges,
    ...(await verifyHistoricalNetOutcomes(
      packet,
      github,
      withPublicGitObjects,
      carrierBranchChecks,
    )),
  ]);
  setPhase("financial protection verification");
  await verifyHistoricalProtection(packet, query);
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
  let assessmentHeads: HistoricalAssessmentJournalHeads;
  let closedReviews: VerifiedClosedReviews | undefined;
  let assessmentReceipt: HistoricalAssessmentReceipt | undefined;
  if (packet.replayQualification) {
    setPhase("trusted replay receipt read");
    const donor = await readTrustedHistoricalReplay(
      packet.replayQualification,
      checkout,
    );
    setPhase("assessment qualification match");
    ({
      heads: assessmentHeads,
      closedReviews,
      receipt: assessmentReceipt,
    } = await verifyHistoricalReplayQualification(
      packet,
      baseline,
      donor,
      checkout,
      generation,
      query,
      github,
      integration?.repository.integrationBranch,
    ));
  } else {
    setPhase("assessment journal checkpoint read");
    if (process.env.HISTORICAL_POINTS_APPLY === "true")
      throw new Error(
        "Applying historical Points requires a reviewed replay qualification",
      );
    assessmentHeads = await readHistoricalAssessmentJournalHeads(query);
  }
  setPhase("value record verification");
  await verifyHistoricalValueRecords(
    packet,
    query,
    packet.replayQualification ? { qualifiedReplay: true } : {},
  );
  setPhase("historical Points reconstruction");
  const candidate = reconstructHistoricalPoints(
    packet,
    baseline,
    new Date().toISOString(),
    bans,
    verifiedDuplicateChanges,
    closedReviews,
  );
  if (assessmentReceipt)
    assertRemovedMergeGroupsPreserved(
      candidate.revisions.slice(baseline.revisions.length),
      assessmentReceipt,
      latestPoints(baseline),
    );
  setPhase("import preparation");
  const directory = join(
    process.env.RUNNER_TEMP ?? "",
    "reviewed-historical-points",
  );
  await mkdir(directory, { mode: 0o700, recursive: true });
  const sqlPath = join(directory, "points.sql");
  await writeFile(
    sqlPath,
    historicalPointsSql(packet, candidate, generation, assessmentHeads),
    {
      mode: 0o600,
      flag: "wx",
    },
  );
  if (process.env.HISTORICAL_POINTS_APPLY === "true") {
    setPhase("protected import and readback");
    await recordCorrection(candidate, {
      verifyMain: async () => {
        setPhase("apply authority recheck");
        await verifyMain();
        await currentOwnerVerifier()(policy, packet.reviewerGithubId);
        await verifyHistoricalProtection(packet, query);
        for (const check of carrierBranchChecks) await check();
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
