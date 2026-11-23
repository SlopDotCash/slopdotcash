/** Prove a reviewed net duplicate from earlier accepted first-parent edges. */
import { spawnSync } from "node:child_process";
import type { CorrectionSource } from "../src/lib/points-implementation-corrections";
import { sha256Hex } from "../src/lib/sha256";
import type { GitHubClient } from "../workers/slopbot/github";
import type { HistoricalPointsPacket } from "./reviewed-historical-points";
import {
  type PublicMergeRepository,
  publicGitProcess,
  withPublicGitObjects,
} from "./value-merge-ingestion";

export interface HistoricalNetOutcome {
  mergeSha: string;
  firstParentSha: string;
  rawDiffSha256: string;
  sources: {
    id: string;
    number: number;
    mergedAt: string;
    mergeSha: string;
    awardKey: string;
    awardRevisionId: string;
  }[];
  paths: { path: string; sourceIds: string[] }[];
}

type PriorSource = HistoricalNetOutcome["sources"][number];
type Audit = HistoricalPointsPacket["sourceAudit"];
type NativeDelta = { before: string; after: string };
type NativeMerge = { sha: string; firstParent: string };
const objectId = /^[0-9a-f]{40}$/u;
const hash = /^[0-9a-f]{64}$/u;
const node = /^[A-Za-z0-9_=-]{4,256}$/u;
const zeroId = "0".repeat(40);
const nativeWindow = 32 * 1024 * 1024;

function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}

function exact(value: object, keys: string[]) {
  return Object.keys(value).sort().join(",") === keys.sort().join(",");
}

function instant(value: string) {
  return (
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function assertHistoricalNetOutcome(
  proof: HistoricalNetOutcome,
  source: CorrectionSource,
): void {
  check(
    proof &&
      exact(proof, [
        "mergeSha",
        "firstParentSha",
        "rawDiffSha256",
        "sources",
        "paths",
      ]) &&
      objectId.test(proof.mergeSha) &&
      objectId.test(proof.firstParentSha) &&
      hash.test(proof.rawDiffSha256) &&
      source.occurredAt !== null &&
      Array.isArray(proof.sources) &&
      proof.sources.length > 0 &&
      Array.isArray(proof.paths) &&
      proof.paths.length > 0,
    "Invalid reviewed net outcome",
  );
  const byId = new Map<string, PriorSource>();
  const merges = new Set<string>();
  for (const earlier of proof.sources) {
    check(
      earlier &&
        exact(earlier, [
          "id",
          "number",
          "mergedAt",
          "mergeSha",
          "awardKey",
          "awardRevisionId",
        ]) &&
        node.test(earlier.id) &&
        earlier.id !== source.sourceId &&
        Number.isSafeInteger(earlier.number) &&
        earlier.number > 0 &&
        instant(earlier.mergedAt) &&
        earlier.mergedAt < source.occurredAt &&
        objectId.test(earlier.mergeSha) &&
        earlier.mergeSha !== proof.mergeSha &&
        hash.test(earlier.awardKey) &&
        hash.test(earlier.awardRevisionId) &&
        !byId.has(earlier.id) &&
        !merges.has(earlier.mergeSha),
      "Reviewed net outcome repeats or lacks an earlier accepted source",
    );
    byId.set(earlier.id, earlier);
    merges.add(earlier.mergeSha);
  }
  const uniquePaths = new Set<string>();
  const used = new Set<string>();
  for (const row of proof.paths) {
    check(
      row &&
        exact(row, ["path", "sourceIds"]) &&
        typeof row.path === "string" &&
        row.path.length > 0 &&
        !row.path.includes("\0") &&
        !uniquePaths.has(row.path) &&
        Array.isArray(row.sourceIds) &&
        row.sourceIds.length > 0,
      "Reviewed net outcome repeats or lacks a path",
    );
    uniquePaths.add(row.path);
    let previous = "";
    for (const id of row.sourceIds) {
      const earlier = byId.get(id);
      check(
        earlier && previous < earlier.mergedAt,
        "Net outcome source order changed",
      );
      previous = earlier.mergedAt;
      used.add(id);
    }
  }
  check(
    used.size === byId.size,
    "Reviewed net outcome names an unused earlier source",
  );
}

interface PullScope {
  id: string;
  number: number;
  url: string;
  state: string;
  mergedAt: string;
  headRefOid: string;
  repository: { id: string; isPrivate: boolean; nameWithOwner: string };
  mergeCommit: { oid: string };
  commits: { totalCount: number };
}

async function observeSources(
  github: Pick<GitHubClient, "graphql">,
  audit: Audit,
  refs: readonly {
    id: string;
    number: number;
    mergedAt: string;
    mergeSha: string;
  }[],
): Promise<Map<string, PullScope>> {
  const observed = new Map<string, PullScope>();
  const query = `query ReviewedNetOutcome($ids:[ID!]!) {
    nodes(ids:$ids) {
      ... on PullRequest {
        id number url state mergedAt headRefOid commits { totalCount }
        repository { id isPrivate nameWithOwner } mergeCommit { oid }
      }
    }
  }`;
  for (let i = 0; i < refs.length; i += 40) {
    const page = refs.slice(i, i + 40);
    const { nodes } = await github.graphql<{ nodes: (PullScope | null)[] }>(
      query,
      { ids: page.map(({ id }) => id) },
    );
    check(
      Array.isArray(nodes) && nodes.length === page.length,
      "Net outcome lifecycle read is incomplete",
    );
    for (const [index, row] of nodes.entries()) {
      const ref = page[index];
      check(
        row &&
          row.id === ref.id &&
          row.number === ref.number &&
          row.url ===
            `https://github.com/${audit.repository}/pull/${ref.number}` &&
          row.state === "MERGED" &&
          new Date(row.mergedAt).toISOString() === ref.mergedAt &&
          row.repository?.id === audit.repositoryNodeId &&
          row.repository?.isPrivate === false &&
          row.repository?.nameWithOwner.toLowerCase() ===
            audit.repository.toLowerCase() &&
          objectId.test(row.headRefOid) &&
          row.mergeCommit?.oid === ref.mergeSha,
        "Reviewed net outcome source lifecycle changed",
      );
      observed.set(ref.id, row);
    }
  }
  return observed;
}

function readGit(directory: string, args: string[], input?: string): Buffer {
  const { file, args: nativeArgs, options } = publicGitProcess(directory, args);
  const result = spawnSync(file, nativeArgs, {
    ...options,
    input,
    maxBuffer: nativeWindow,
  });
  check(
    result.status === 0 && !result.error,
    "Complete native net-outcome objects unavailable",
  );
  return result.stdout;
}

/** One native stream, with each pinned commit and its actual first parent. */
function acceptedDiffs(directory: string, merges: readonly NativeMerge[]) {
  const input = merges
    .map(({ sha, firstParent }) => `${sha} ${firstParent}\n`)
    .join("");
  const raw = readGit(
    directory,
    [
      "diff-tree",
      "--stdin",
      "--raw",
      "--no-abbrev",
      "--no-renames",
      "-r",
      "-z",
    ],
    input,
  );
  const groups = new Map<
    string,
    { paths: Map<string, NativeDelta>; raw: Buffer }
  >();
  const expected = new Set(merges.map(({ sha }) => sha));
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let index = 0;
  let cursor = raw.indexOf(0);
  let groupStart = 0;
  let group: { paths: Map<string, NativeDelta>; raw: Buffer } | undefined;
  while (index < raw.length) {
    check(cursor >= index, "Native net outcome is truncated");
    const field = decoder.decode(raw.subarray(index, cursor));
    if (expected.has(field)) {
      if (group) group.raw = raw.subarray(groupStart, index);
      check(!groups.has(field), "Native net outcome repeats an acceptance");
      group = { paths: new Map(), raw: Buffer.alloc(0) };
      groups.set(field, group);
      groupStart = cursor + 1;
    } else {
      const match =
        /^:(000000|100644|100755|120000|160000) (000000|100644|100755|120000|160000) ([0-9a-f]{40}) ([0-9a-f]{40}) [ADMT]$/u.exec(
          field,
        );
      check(group && match, "Native net outcome has an unsupported raw delta");
      const end = raw.indexOf(0, cursor + 1);
      check(end > cursor + 1, "Native net outcome has an invalid path");
      const path = decoder.decode(raw.subarray(cursor + 1, end));
      const [, oldMode, newMode, oldId, newId] = match;
      check(
        (oldMode === "000000") === (oldId === zeroId) &&
          (newMode === "000000") === (newId === zeroId) &&
          !group.paths.has(path),
        "Native net outcome repeats or changes a path identity",
      );
      group.paths.set(path, {
        before: oldMode + oldId,
        after: newMode + newId,
      });
      cursor = end;
    }
    index = cursor + 1;
    cursor = raw.indexOf(0, index);
  }
  if (group) group.raw = raw.subarray(groupStart);
  check(
    groups.size === expected.size,
    "Native net outcome omits an accepted source",
  );
  return groups;
}

function verifyNativeOutcome(
  directory: string,
  proof: HistoricalNetOutcome,
  source: CorrectionSource,
): void {
  const target = readGit(directory, [
    "rev-list",
    "--parents",
    "-n",
    "1",
    proof.mergeSha,
  ])
    .toString()
    .trim()
    .split(" ");
  check(
    target.length === 3 &&
      target[0] === proof.mergeSha &&
      target[1] === proof.firstParentSha &&
      target[2] === source.headSha,
    "Net outcome acceptance parents changed",
  );
  const submitted = readGit(directory, [
    "rev-list",
    "--parents",
    source.headSha,
    `^${proof.firstParentSha}`,
  ])
    .toString()
    .trim()
    .split("\n");
  const parents = new Map(
    submitted.map((line) => {
      const [sha, ...edges] = line.split(" ");
      return [sha, edges] as const;
    }),
  );
  check(
    parents.has(source.headSha) &&
      parents.size === source.commits.length &&
      new Set(source.commits.map(({ sha }) => sha)).size === parents.size &&
      source.commits.every(({ sha, parentShas, parentCount }) => {
        const native = parents.get(sha);
        return (
          native &&
          native.length === parentCount &&
          JSON.stringify(native) === JSON.stringify(parentShas)
        );
      }),
    "Net outcome submission range is incomplete",
  );
  const merges = [{ sha: proof.mergeSha, firstParent: proof.firstParentSha }];
  for (const { mergeSha } of proof.sources) {
    const own = parents.get(mergeSha);
    check(
      own?.length && objectId.test(own[0]),
      "Earlier net outcome is outside the native submitted range",
    );
    merges.push({ sha: mergeSha, firstParent: own[0] });
  }
  const groups = acceptedDiffs(directory, merges);
  const targetDiff = groups.get(proof.mergeSha);
  check(
    targetDiff &&
      targetDiff.paths.size === proof.paths.length &&
      sha256Hex(targetDiff.raw) === proof.rawDiffSha256,
    "Reviewed net outcome does not cover the complete accepted first-parent diff",
  );
  const earlierById = new Map(
    proof.sources.map(({ id, mergeSha }) => [id, groups.get(mergeSha)]),
  );
  for (const { path, sourceIds } of proof.paths) {
    const accepted = targetDiff.paths.get(path);
    check(
      accepted,
      "Reviewed net outcome names a path outside the accepted diff",
    );
    let state = accepted.before;
    for (const id of sourceIds) {
      const pathDelta = earlierById.get(id)?.paths.get(path);
      check(
        pathDelta?.before === state,
        "Earlier net outcome does not match the native path preimage",
      );
      state = pathDelta.after;
    }
    check(
      state === accepted.after,
      "Earlier net outcome does not cover the native path output",
    );
  }
}

/** Only the protected native reader can qualify this exact reviewed retirement. */
export async function verifyHistoricalNetOutcomes(
  packet: Pick<HistoricalPointsPacket, "sourceAudit" | "duplicateRetirements">,
  github: Pick<GitHubClient, "graphql" | "get">,
  withObjects = withPublicGitObjects,
  beforeImportChecks: (() => Promise<void>)[] = [],
): Promise<Set<string>> {
  const verified = new Set<string>();
  for (const retirement of packet.duplicateRetirements ?? []) {
    const proof = retirement.netOutcome;
    if (!proof) continue;
    const source = retirement.source;
    assertHistoricalNetOutcome(proof, source);
    const audit = packet.sourceAudit;
    const target = audit.sources.find(({ id }) => id === source.sourceId);
    check(
      target &&
        target.headSha === source.headSha &&
        target.mergedAt === source.occurredAt,
      "Net outcome target is outside the complete audit",
    );
    const repository = await github.get<PublicMergeRepository>(
      `/repos/${audit.repository}`,
    );
    check(
      repository?.node_id === audit.repositoryNodeId &&
        repository.full_name?.toLowerCase() ===
          audit.repository.toLowerCase() &&
        repository.private === false,
      "Net outcome repository identity changed",
    );
    const read = async () => {
      const rows = await observeSources(github, audit, [
        { ...target, mergeSha: proof.mergeSha },
        ...proof.sources,
      ]);
      const observed = rows.get(target.id);
      check(
        observed?.headRefOid === target.headSha &&
          observed.commits.totalCount === source.commitCount,
        "Net outcome target scope changed",
      );
      return JSON.stringify([...rows]);
    };
    const lifecycle = await read();
    await withObjects(repository, [proof.mergeSha], async (directory) =>
      verifyNativeOutcome(directory, proof, source),
    );
    const recheck = async () => {
      check(
        (await read()) === lifecycle,
        "Net outcome lifecycle changed during verification",
      );
    };
    await recheck();
    beforeImportChecks.push(recheck);
    verified.add(sha256Hex(JSON.stringify(retirement)));
  }
  return verified;
}
