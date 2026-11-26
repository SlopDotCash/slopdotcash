import { expect, test } from "bun:test";
import { penaltyAppliedThirds } from "./global-leaderboard";
import { journalPenaltyAppliedThirds } from "./points";

const actor = {
  id: "U_1",
  login: "contributor",
  avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
  url: "https://github.com/contributor",
  kind: "User",
};

function snapshotWith(penaltyMonth: string, credits: boolean | number) {
  const creditThirds = credits === true ? 10 : credits;
  return {
    ledger: creditThirds
      ? [
          {
            id: "event-1",
            actor,
            repository: "elizaOS/asi",
            occurredAt: `${penaltyMonth}-10T00:00:00.000Z`,
            category: "merged-pull-request",
            points: creditThirds * 10,
            scoreThirds: creditThirds,
          },
        ]
      : [],
    penalties: [
      {
        id: "PR_1:penalty",
        actor,
        repository: "elizaOS/asi",
        occurredAt: `${penaltyMonth}-20T00:00:00.000Z`,
        category: "spam",
        tableVersion: "slopbot-penalties-v1",
        debitThirds: 3,
        source: {
          id: "PR_1",
          kind: "pull-request",
          number: 1,
          title: "spam",
          url: "https://github.com/elizaOS/asi/pull/1",
        },
      },
    ],
  } as never;
}

const octoberRecord = {
  cycles: [{ projectId: "asi", cycleId: "2026-10" }],
} as never;
const otherProjectOctoberRecord = {
  cycles: [{ projectId: "eliza", cycleId: "2026-10" }],
} as never;
const noRecords = { cycles: [] } as never;

test("an archived month reads its applied debit from the journal", () => {
  const applied = penaltyAppliedThirds(
    snapshotWith("2026-10", true),
    octoberRecord,
    new Map([["PR_1:penalty", 3]]),
  );
  expect(applied.get("PR_1:penalty")).toBe(3);
});

test("an archived month without a journal amount states none", () => {
  const applied = penaltyAppliedThirds(
    snapshotWith("2026-10", true),
    octoberRecord,
    undefined,
  );
  expect(applied.has("PR_1:penalty")).toBe(false);
});

test("an open month reads the rolling ledger, including a true zero", () => {
  expect(
    penaltyAppliedThirds(snapshotWith("2026-11", true), noRecords).get(
      "PR_1:penalty",
    ),
  ).toBe(3);
  expect(
    penaltyAppliedThirds(snapshotWith("2026-11", false), noRecords).get(
      "PR_1:penalty",
    ),
  ).toBe(0);
});

test("a month without a cycle record reads the journal after the window slides", () => {
  const journal = new Map([["PR_1:penalty", 3]]);
  expect(
    penaltyAppliedThirds(
      snapshotWith("2026-10", false),
      noRecords,
      journal,
    ).get("PR_1:penalty"),
  ).toBe(3);
  expect(
    penaltyAppliedThirds(snapshotWith("2026-10", 1), noRecords, journal).get(
      "PR_1:penalty",
    ),
  ).toBe(3);
});

test("a cycle record for another project does not archive this penalty", () => {
  expect(
    penaltyAppliedThirds(
      snapshotWith("2026-10", true),
      otherProjectOctoberRecord,
      undefined,
    ).get("PR_1:penalty"),
  ).toBe(3);
});

test("the journal extraction keys applied debits by penalty work unit", () => {
  const journal = {
    revisions: [
      {
        award: {
          key: "k1",
          category: "slopbot-penalty",
          amount: -30,
          workUnitId: "PR_1:penalty",
        },
      },
      {
        award: {
          key: "k2",
          category: "merged-pull-request",
          amount: 100,
          workUnitId: "PR_2",
        },
      },
    ],
  } as never;
  expect(journalPenaltyAppliedThirds(journal).get("PR_1:penalty")).toBe(3);
  expect(journalPenaltyAppliedThirds(journal).size).toBe(1);
});

test("a zero journal debit stays positive zero", () => {
  const journal = {
    revisions: [
      {
        award: {
          key: "k1",
          category: "slopbot-penalty",
          amount: 0,
          workUnitId: "PR_1:penalty",
        },
      },
    ],
  } as never;
  expect(
    Object.is(journalPenaltyAppliedThirds(journal).get("PR_1:penalty"), 0),
  ).toBe(true);
});

test("the latest journal revision of a penalty wins", () => {
  const journal = {
    revisions: [
      {
        award: {
          key: "k1",
          category: "slopbot-penalty",
          amount: -30,
          workUnitId: "PR_1:penalty",
        },
      },
      {
        award: {
          key: "k1",
          category: "slopbot-penalty",
          amount: -90,
          workUnitId: "PR_1:penalty",
        },
      },
    ],
  } as never;
  expect(journalPenaltyAppliedThirds(journal).get("PR_1:penalty")).toBe(9);
});
