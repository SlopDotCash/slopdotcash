/** Historical score caps through the real snapshot builder, not a second scorer. */
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import type { GitHubActor } from "../src/lib/leaderboard-types";
import { REGISTERED_REPOSITORIES } from "../src/lib/repositories.mjs";
import {
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

type Source = {
  number: number;
  at: string;
  actor: GitHubActor;
  repository: string;
};
const time = (day: number, month = "07") =>
  `2026-${month}-${String(day).padStart(2, "0")}T12:00:00.000Z`;

function snapshot(sources: Source[]) {
  const input = penaltyScoreInput([], "2026-07-30T00:00:00.000Z");
  const seed = input.mergedPullRequests[0];
  if (!seed) throw new Error("Missing historical PR fixture");
  input.mergedPullRequests = sources.map((source) => ({
    ...structuredClone(seed),
    id: `PR_legacy_${source.number}`,
    number: source.number,
    url: `https://github.com/${source.repository}/pull/${source.number}`,
    author: source.actor,
    createdAt: source.at,
    updatedAt: source.at,
    mergedAt: source.at,
    closedAt: source.at,
    headRefOid: source.number.toString(16).padStart(40, "0"),
    additions: 20,
    deletions: 10,
    changedFiles: 1,
    files: [{ path: "tests/fix.test.ts", additions: 20, deletions: 10 }],
    reviews: [],
    comments: [],
  }));
  input.mergedPullRequestOutcomes = input.mergedPullRequests.map((pull) => ({
    id: pull.id,
    number: pull.number,
    title: pull.title,
    url: pull.url,
    body: pull.body,
    createdAt: pull.createdAt,
    updatedAt: pull.updatedAt,
    mergedAt: pull.mergedAt as string,
    headRefOid: pull.headRefOid,
    author: pull.author,
    additions: pull.additions,
    deletions: pull.deletions,
    baseRefName: "main",
    commits: [{ oid: pull.headRefOid, author: pull.author }],
  }));
  input.closedUnmergedPullRequests = [];
  input.sourceUpdatedAt = [...sources]
    .map((s) => s.at)
    .sort()
    .at(-1) as string;
  input.detailEligibleMergedPullRequestIds = input.mergedPullRequests.map(
    (p) => p.id,
  );
  input.source.counts.mergedPullRequests = sources.length;
  input.source.counts.detailedMergedPullRequests = sources.length;
  return createLeaderboardSnapshot(input);
}

test("Quint legacy totals and newest material-test winners survive actor/project/UTC-month isolation and input order", () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-legacy-score-"));
  try {
    execFileSync(
      "node",
      [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "test",
        "formal/models/legacy_score_caps.qnt",
        "--backend=typescript",
        "--seed=1",
        "--match=^(uncappedPositiveMergesTest|newestFiveMaterialTestsTest)$",
        `--out-itf=${join(directory, "trace-{test}-{seq}.json")}`,
      ],
      { stdio: "pipe" },
    );
    const expected = (name: string) => {
      const file = readdirSync(directory).find((value) =>
        value.startsWith(`trace-${name}-`),
      );
      if (!file) throw new Error(`Quint omitted ${name}`);
      const trace = JSON.parse(
        readFileSync(join(directory, file), "utf8"),
        (_key, value) =>
          value && typeof value === "object" && "#bigint" in value
            ? Number(value["#bigint"])
            : value,
      ) as { states: { s: { points: number; count: number } }[] };
      const final = trace.states.at(-1)?.s;
      if (!final) throw new Error("Quint omitted legacy cap state");
      return final;
    };
    const merge = expected("uncappedPositiveMergesTest"),
      material = expected("newestFiveMaterialTestsTest");
    const repository = REGISTERED_REPOSITORIES.find(
      (row) => row.projectId === "asi",
    );
    const second = REGISTERED_REPOSITORIES.find(
      (row) => row.projectId === "eliza",
    );
    if (!repository || !second)
      throw new Error("Missing canonical fixture projects");
    const groups = [
      { actor: PENALIZED_AUTHOR, repository: repository.id, month: "07" },
      { actor: PROJECT_OWNER, repository: repository.id, month: "07" },
      { actor: PENALIZED_AUTHOR, repository: second.id, month: "07" },
      { actor: PENALIZED_AUTHOR, repository: repository.id, month: "06" },
    ].map((group, bucket) =>
      Array.from(
        { length: 7 },
        (_, index): Source => ({
          ...group,
          number: 100 + bucket * 10 + index,
          // July's fifth/sixth candidates tie in time; the larger PR number wins.
          at:
            group.month === "07"
              ? time(index === 1 ? 12 : 10 + index)
              : `2026-06-28T${String(10 + index).padStart(2, "0")}:00:00.000Z`,
        }),
      ),
    );
    const source = groups.flat();
    const permuted = [...source].sort(
      (a, b) => ((a.number * 17) % 41) - ((b.number * 17) % 41),
    );
    let baseline:
      | {
          id: string;
          category: ReturnType<typeof snapshot>["ledger"][number]["category"];
          points: number;
        }[]
      | undefined;
    for (const order of [source, [...source].reverse(), permuted]) {
      const result = snapshot(order);
      const facts = result.ledger.map((event) => ({
        id: event.source.id,
        category: event.category,
        points: event.points,
      }));
      if (baseline === undefined) baseline = facts;
      else expect(facts).toEqual(baseline);
      for (const group of groups) {
        const ids = new Set(group.map((row) => `PR_legacy_${row.number}`));
        const events = result.ledger.filter((event) =>
          ids.has(event.source.id),
        );
        const merges = events.filter(
          (event) => event.category === "merged-pull-request",
        );
        const tests = events.filter(
          (event) => event.category === "material-test-change",
        );
        expect(merges).toHaveLength(merge.count);
        expect(merges.reduce((sum, row) => sum + row.points, 0)).toBe(
          merge.points,
        );
        expect(tests).toHaveLength(material.count);
        expect(tests.reduce((sum, row) => sum + row.points, 0)).toBe(
          material.points,
        );
        const winners = [...group]
          .sort(
            (a, b) =>
              Date.parse(b.at) - Date.parse(a.at) || b.number - a.number,
          )
          .slice(0, material.count)
          .map((row) => `PR_legacy_${row.number}`)
          .sort();
        expect(tests.map((row) => row.source.id).sort()).toEqual(winners);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
