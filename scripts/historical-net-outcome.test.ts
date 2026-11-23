import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../src/lib/sha256";
import {
  assertHistoricalNetOutcome,
  type HistoricalNetOutcome,
  verifyHistoricalNetOutcomes,
} from "./historical-net-outcome";
import type { HistoricalPointsPacket } from "./reviewed-historical-points";
import { publicGitProcess } from "./value-merge-ingestion";

const repository = {
  id: 12,
  node_id: "R_test",
  private: false,
  full_name: "owner/repo",
};

const firstAward = "1".repeat(64);
const secondAward = "2".repeat(64);
const firstAcceptedAt = "2026-10-02T00:00:00.000Z";
const secondAcceptedAt = "2026-10-03T00:00:00.000Z";
const targetAcceptedAt = "2026-10-04T00:00:00.000Z";

type Input = Pick<
  HistoricalPointsPacket,
  "sourceAudit" | "duplicateRetirements"
>;
type Scope = NonNullable<Input["duplicateRetirements"]>[number];

let directory: string;
let unrelatedMerge: string;
let retirement: Scope;
let audit: Input["sourceAudit"];
let nodes: Map<string, object>;

function git(args: string[], input?: string): string {
  const command = publicGitProcess(directory, args);
  return execFileSync(command.file, command.args, {
    ...command.options,
    encoding: "utf8",
    input,
  });
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "slop-historical-net-outcome-"));
  git(["init", "--bare", "--template=", "--quiet"]);
  const commit = (content: string, parents: string[], message: string) => {
    const blob = git(["hash-object", "-w", "--stdin"], content).trim();
    const tree = git(
      ["mktree"],
      `100644 blob ${blob}\ta\n100644 blob ${blob}\tb\n`,
    ).trim();
    return git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit-tree",
      tree,
      ...parents.flatMap((sha) => ["-p", sha]),
      "-m",
      message,
    ]).trim();
  };
  const root = commit("first\n", [], "root");
  const earlier = commit("middle\n", [root], "prior accepted one");
  unrelatedMerge = commit("middle\n", [root], "independent identical patch");
  const head = commit("last\n", [earlier], "prior accepted two");
  const accepted = commit("last\n", [root, head], "later carried net result");
  const raw = git([
    "diff-tree",
    "--no-commit-id",
    "--raw",
    "--no-abbrev",
    "--no-renames",
    "-r",
    "-z",
    root,
    accepted,
  ]);
  const sourceId = "PR_target";
  const url = (number: number) =>
    `https://github.com/owner/repo/pull/${number}`;
  const source = {
    repository: repository.full_name,
    repositoryNodeId: repository.node_id,
    sourceId,
    sourceUrl: url(3),
    headSha: head,
    occurredAt: targetAcceptedAt,
    author: null,
    complete: true,
    commitCount: 2,
    commits: [
      [earlier, root],
      [head, earlier],
    ].map(([sha, parent]) => ({
      sha,
      parentCount: 1,
      parentShas: [parent],
      author: null,
      additions: 2,
      deletions: 2,
      firstAcceptedSourceId: "PR_earlier",
    })),
  };
  const anchors = [
    {
      id: "PR_earlier",
      number: 1,
      mergedAt: firstAcceptedAt,
      mergeSha: earlier,
      awardKey: firstAward,
      awardRevisionId: firstAward,
    },
    {
      id: "PR_later",
      number: 2,
      mergedAt: secondAcceptedAt,
      mergeSha: head,
      awardKey: secondAward,
      awardRevisionId: secondAward,
    },
  ];
  const proof: HistoricalNetOutcome = {
    mergeSha: accepted,
    firstParentSha: root,
    rawDiffSha256: sha256Hex(raw),
    sources: anchors,
    paths: ["a", "b"].map((path) => ({
      path,
      sourceIds: anchors.map(({ id }) => id),
    })),
  };
  retirement = {
    sourceId,
    workUnitId: "ordinary",
    source,
    earlierSources: [],
    coverage: [],
    netOutcome: proof,
    evidence: "{}",
    evidenceSha256: firstAward,
    expectedPredecessors: [],
  };
  audit = {
    repository: repository.full_name,
    repositoryNodeId: repository.node_id,
    from: "2026-09-27T00:00:00.000Z",
    through: "2026-11-01T00:00:00.000Z",
    sources: [
      { id: sourceId, number: 3, headSha: head, mergedAt: targetAcceptedAt },
    ],
  };
  nodes = new Map(
    [
      {
        id: sourceId,
        number: 3,
        mergedAt: targetAcceptedAt,
        mergeSha: accepted,
      },
      ...anchors,
    ].map(({ id, number, mergedAt, mergeSha }) => [
      id,
      {
        id,
        number,
        url: url(number),
        state: "MERGED",
        mergedAt,
        headRefOid: number === 1 ? earlier : head,
        repository: {
          id: repository.node_id,
          isPrivate: false,
          nameWithOwner: repository.full_name,
        },
        mergeCommit: { oid: mergeSha },
        commits: { totalCount: number === 3 ? 2 : 1 },
      },
    ]),
  );
}, 30000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

function scoped(retirement: Scope, checks: (() => Promise<void>)[] = []) {
  return verifyHistoricalNetOutcomes(
    { sourceAudit: audit, duplicateRetirements: [retirement] },
    {
      get: async <T>() => repository as T,
      graphql: async <T>(_query: string, input: Record<string, unknown>) =>
        ({
          nodes: (input.ids as string[]).map((id) => nodes.get(id) ?? null),
        }) as T,
    },
    async (actual, roots, read) => {
      expect(actual).toEqual(repository);
      const proof = retirement.netOutcome;
      if (!proof) throw Error("Fixture proof missing");
      expect(roots).toEqual([proof.mergeSha]);
      return read(directory);
    },
    checks,
  );
}

test("authenticates the whole native net outcome and rechecks sources before import", async () => {
  const checking: (() => Promise<void>)[] = [];
  expect(await scoped(retirement, checking)).toEqual(
    new Set([sha256Hex(JSON.stringify(retirement))]),
  );
  expect(checking).toHaveLength(1);
  const prior = nodes.get("PR_later");
  if (!prior) throw Error("Fixture prior source missing");
  nodes.delete("PR_later");
  try {
    await expect(checking[0]()).rejects.toThrow("source lifecycle changed");
  } finally {
    nodes.set("PR_later", prior);
  }
}, 30000);

test("refuses missing final paths, an unbound first-parent delta, and partial submitted ranges", async () => {
  const fewer = structuredClone(retirement);
  fewer.netOutcome?.paths.pop();
  await expect(scoped(fewer)).rejects.toThrow(
    "does not cover the complete accepted first-parent diff",
  );
  const altered = structuredClone(retirement);
  if (!altered.netOutcome) throw Error("Fixture proof missing");
  altered.netOutcome.rawDiffSha256 = "9".repeat(64);
  await expect(scoped(altered)).rejects.toThrow(
    "does not cover the complete accepted first-parent diff",
  );
  const partial = structuredClone(retirement);
  partial.source.commits.pop();
  await expect(scoped(partial)).rejects.toThrow(
    "submission range is incomplete",
  );
}, 30000);

test("refuses a path whose earlier edges omit its exact preimage or reverse chronology", async () => {
  const bad = structuredClone(retirement);
  if (!bad.netOutcome) throw Error("Fixture proof missing");
  bad.netOutcome.paths[0].sourceIds = ["PR_later"];
  await expect(scoped(bad)).rejects.toThrow(
    "does not match the native path preimage",
  );
  const reversed = structuredClone(retirement);
  if (!reversed.netOutcome) throw Error("Fixture proof missing");
  reversed.netOutcome.paths[0].sourceIds.reverse();
  const proof = reversed.netOutcome;
  expect(() => assertHistoricalNetOutcome(proof, reversed.source)).toThrow(
    "source order changed",
  );
}, 30000);

test("refuses an identical earlier patch outside the target native range", async () => {
  const unrelated = structuredClone(retirement);
  const proof = unrelated.netOutcome;
  const prior = nodes.get("PR_earlier");
  if (!proof || !prior) throw Error("Fixture prior source missing");
  proof.sources[0].mergeSha = unrelatedMerge;
  nodes.set("PR_earlier", { ...prior, mergeCommit: { oid: unrelatedMerge } });
  try {
    await expect(scoped(unrelated)).rejects.toThrow(
      "outside the native submitted range",
    );
  } finally {
    nodes.set("PR_earlier", prior);
  }
}, 30000);
