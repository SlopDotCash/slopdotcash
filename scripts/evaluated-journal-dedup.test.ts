// An evaluated award must never pay for a source the ordinary ledger
// already rewarded. The snapshot builder enforces that inside the rolling
// window, but the leaderboard generator filters older evaluated awards out
// before the snapshot is built, while generatePoints applies every
// manifest to the all-time journal through the retained history batch.
// These tests drive the production sequence (manifest loader -> window
// selection -> snapshot -> snapshot application -> retained batch) for an
// award whose source is an already scored merge.
import { expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEvaluatorAwardEvents } from "../src/lib/evaluator-awards";
import { createLeaderboardSnapshot } from "../src/lib/leaderboard";
import {
  appendPointAwards,
  applyPointsSnapshot,
  latestPoints,
  type PointAward,
  type PointRevision,
  type PointsJournal,
  pointKey,
  pointMembers,
  pointRevisionId,
} from "../src/lib/points";
import {
  GENERATED_AT,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import { selectEvaluatedContributionsForWindow } from "./generate-leaderboard";
import {
  applyRetainedHistoryBatch,
  retainedHistoryAwards,
} from "./generate-points";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const emptyJournal = (): PointsJournal => ({
  schemaVersion: "1",
  ruleVersion: "slop-points-v1",
  generatedAt: GENERATED_AT,
  coverage: [],
  revisions: [],
});
const LATER = new Date(Date.parse(GENERATED_AT) + 3_600_000).toISOString();
const AUTHOR = "MDQ6VXNlcjQy";

const duplicateAward = {
  schemaVersion: "1",
  kind: "evaluated-contribution",
  id: "award_journal_duplicate",
  projectId: "asi",
  repository: "elizaOS/asi",
  actor: {
    id: "MDQ6VXNlcjQy",
    login: "author",
    avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
    url: "https://github.com/author",
    kind: "User",
  },
  // The merged fixture pull request was scored in an earlier window; an
  // evaluated award naming it today carries the work's own (old) date.
  occurredAt: "2026-09-05T00:00:00.000Z",
  points: 2,
  source: {
    id: "PR_november",
    kind: "pull-request",
    number: 8,
    title: "fix: accepted change",
    url: "https://github.com/SlopDotCash/asi/pull/8",
  },
  reason:
    "Regression fixture: an evaluated award that names a pull request the ordinary ledger already scored and paid.",
  review: {
    reviewer: "maintainer",
    reviewedAt: GENERATED_AT,
    decisionUrl: "https://github.com/SlopDotCash/slopdotcash/pull/316",
  },
};

function load(award: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "evaluated-journal-dedup-"));
  mkdirSync(join(root, "evaluations", "asi"), { recursive: true });
  writeFileSync(
    join(root, "evaluations", "asi", "award-journal.json"),
    JSON.stringify(award),
  );
  const previous = process.cwd();
  process.chdir(root);
  try {
    return loadEvaluatorAwardEvents(join(root, "evaluations"));
  } finally {
    process.chdir(previous);
  }
}

/** The journal after the current snapshot's ordinary awards are applied. */
function journalWithOrdinaryAwards() {
  const input = penaltyScoreInput([]);
  setSystemTime(new Date(input.generatedAt));
  const snapshot = createLeaderboardSnapshot(input);
  return applyPointsSnapshot(
    emptyJournal(),
    snapshot,
    hash(JSON.stringify(snapshot)),
    GENERATED_AT,
  );
}
const memberTotal = (journal: PointsJournal) =>
  pointMembers(journal).find((m) => m.actor.id === AUTHOR)?.total;

test("an out-of-window evaluated award for a scored merge is refused by the retained batch", () => {
  const events = load(duplicateAward);
  // The window selection that protects the snapshot never sees this award.
  const input = penaltyScoreInput([]);
  expect(
    selectEvaluatedContributionsForWindow(
      events,
      new Date(input.windowFrom),
      new Date(input.windowTo),
      new Date(input.generatedAt),
    ),
  ).toHaveLength(0);
  expect(() =>
    applyRetainedHistoryBatch(
      journalWithOrdinaryAwards(),
      retainedHistoryAwards(events),
      hash(JSON.stringify(events)),
      LATER,
    ),
  ).toThrow("duplicates a score-bearing source");
});

test("the same refusal applies under a legacy source id and a lowercase URL", () => {
  const events = load({
    ...duplicateAward,
    id: "award_journal_duplicate_variant",
    source: {
      ...duplicateAward.source,
      id: "MDExOlB1bGxSZXF1ZXN0OTk5",
      url: "https://github.com/slopdotcash/asi/pull/8",
    },
  });
  expect(() =>
    applyRetainedHistoryBatch(
      journalWithOrdinaryAwards(),
      retainedHistoryAwards(events),
      hash(JSON.stringify(events)),
      LATER,
    ),
  ).toThrow("duplicates a score-bearing source");
});

test("a zeroed ordinary award no longer blocks an evaluated award", () => {
  const journal = journalWithOrdinaryAwards();
  const ordinary = [...latestPoints(journal).values()]
    .map((revision) => revision.award)
    .find(
      (award) =>
        award.category === "merged-pull-request" &&
        award.sourceUrl.includes("/pull/8"),
    );
  if (!ordinary) {
    throw new Error("fixture has no merged-pull-request award for PR 8");
  }
  expect(ordinary.amount).toBeGreaterThan(0);
  // Revocations never delete a revision; they append an amount-0 one, and
  // the member projection already skips it, so no ordinary credit remains.
  const zeroed = appendPointAwards(
    journal,
    [{ ...ordinary, amount: 0 }],
    hash("zero-revocation"),
    "slop-score-v2",
    LATER,
  );
  expect(memberTotal(zeroed) ?? 0).toBeLessThan(memberTotal(journal) ?? 0);
  const events = load(duplicateAward);
  const applied = applyRetainedHistoryBatch(
    zeroed,
    retainedHistoryAwards(events),
    hash(JSON.stringify(events)),
    LATER,
  );
  // 2 evaluated score points are 60 journal points, counted exactly once.
  expect(memberTotal(applied)).toBe((memberTotal(zeroed) ?? 0) + 60);
});

test("a mixed-case pull segment still matches the ordinary award", () => {
  // The manifest loader rejects a mixed-case path today (githubWorkKey
  // throws), so this pins the guard's own case handling directly: the
  // guard promises URL-case matching, and a null work key must not let a
  // duplicate through if such an award ever reaches the batch.
  const evaluated: PointAward = {
    key: pointKey(
      "asi",
      AUTHOR,
      "evaluated-contribution",
      "MDExOlB1bGxSZXF1ZXN0NDI=",
    ),
    actor: { id: AUTHOR, login: "author" },
    projectId: "asi",
    category: "evaluated-contribution",
    amount: 60,
    occurredAt: "2026-09-05T00:00:00.000Z",
    sourceId: "MDExOlB1bGxSZXF1ZXN0NDI=",
    sourceUrl: "https://github.com/SlopDotCash/asi/PULL/8",
    workUnitId: "wu_asi_MDExOlB1bGxSZXF1ZXN0NDI=",
    provisional: false,
  };
  expect(() =>
    applyRetainedHistoryBatch(
      journalWithOrdinaryAwards(),
      [evaluated],
      hash("mixed-case-pull"),
      LATER,
    ),
  ).toThrow("duplicates a score-bearing source");
});

// The published journal's retirement zeroing, mirrored from
// scripts/generate-points.ts: a retired evaluated award is recognised only
// by this exact digest, rule and timestamp.
const RETIREMENT_ZERO_DIGEST =
  "782097740ab32fa43352c9b7d43b34cc4586f8611068c40a9cddcc58edc9aa37";

function retiredJournal(
  retiredAward: PointAward,
  extra: PointAward[],
): PointsJournal {
  const rev = (
    previous: string | null,
    recordedAt: string,
    sourceDigest: string,
    award: PointAward,
  ): PointRevision => {
    const body = {
      previous,
      recordedAt,
      sourceDigest,
      sourceRule: "slop-score-v2",
      award,
    };
    return { id: pointRevisionId(body), ...body };
  };
  const first = rev(
    null,
    "2026-10-18T00:00:00.000Z",
    hash("original-evaluated"),
    retiredAward,
  );
  const zeroed = rev(
    first.id,
    "2026-10-20T05:30:25.870Z",
    RETIREMENT_ZERO_DIGEST,
    { ...retiredAward, amount: 0 },
  );
  const rest = extra.map((award) =>
    rev(null, "2026-10-21T00:00:00.000Z", hash("ordinary-merge"), award),
  );
  return {
    schemaVersion: "1",
    ruleVersion: "slop-points-v1",
    generatedAt: GENERATED_AT,
    coverage: [],
    revisions: [first, zeroed, ...rest],
  };
}

test("recovering a retired evaluated award refused when ordinary credit exists", () => {
  const retiredAward: PointAward = {
    key: pointKey("asi", AUTHOR, "evaluated-contribution", "PR_retired"),
    actor: { id: AUTHOR, login: "author" },
    projectId: "asi",
    category: "evaluated-contribution",
    amount: 60,
    occurredAt: "2026-09-05T00:00:00.000Z",
    sourceId: "PR_retired",
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/7",
    workUnitId: "wu_asi_PR_retired",
    provisional: false,
  };
  const ordinaryAward: PointAward = {
    key: pointKey("asi", AUTHOR, "merged-pull-request", "PR_retired"),
    actor: { id: AUTHOR, login: "author" },
    projectId: "asi",
    category: "merged-pull-request",
    amount: 30,
    occurredAt: "2026-10-21T00:00:00.000Z",
    sourceId: "PR_retired",
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/7",
    workUnitId: "wu_asi_PR_retired",
    provisional: false,
  };
  const journal = retiredJournal(retiredAward, [ordinaryAward]);
  const before = memberTotal(journal);
  expect(() =>
    applyRetainedHistoryBatch(journal, [], hash("recovery-batch"), LATER),
  ).toThrow("duplicates a score-bearing source");
  expect(memberTotal(journal)).toBe(before);
});

test("a retired award is refused when a supplied award names the same work", () => {
  const retiredAward: PointAward = {
    key: pointKey("asi", AUTHOR, "evaluated-contribution", "PR_retired_legacy"),
    actor: { id: AUTHOR, login: "author" },
    projectId: "asi",
    category: "evaluated-contribution",
    amount: 60,
    occurredAt: "2026-09-05T00:00:00.000Z",
    sourceId: "PR_retired_legacy",
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/7",
    workUnitId: "wu_asi_PR_retired_legacy",
    provisional: false,
  };
  const events = load({
    ...duplicateAward,
    id: "award_journal_retired_duplicate",
    occurredAt: "2026-09-06T00:00:00.000Z",
    source: {
      ...duplicateAward.source,
      id: "PR_retired_current",
      number: 7,
      url: "https://github.com/SlopDotCash/asi/pull/7",
    },
  });
  expect(() =>
    applyRetainedHistoryBatch(
      retiredJournal(retiredAward, []),
      retainedHistoryAwards(events),
      hash(JSON.stringify(events)),
      LATER,
    ),
  ).toThrow("duplicates a score-bearing source");
});

test("an evaluated award for unscored work still applies and counts once", () => {
  const events = load({
    ...duplicateAward,
    id: "award_journal_unscored",
    occurredAt: "2026-09-06T00:00:00.000Z",
    source: {
      id: "PR_unscored",
      kind: "pull-request",
      number: 999,
      title: "unmerged diagnosis",
      url: "https://github.com/SlopDotCash/asi/pull/999",
    },
  });
  const journal = journalWithOrdinaryAwards();
  const before = memberTotal(journal);
  const awards = retainedHistoryAwards(events);
  const applied = applyRetainedHistoryBatch(
    journal,
    awards,
    hash(JSON.stringify(events)),
    LATER,
  );
  // 2 evaluated score points are 60 journal points, counted exactly once
  // even when the same batch is replayed.
  expect(memberTotal(applied)).toBe((before ?? 0) + 60);
  const replayed = applyRetainedHistoryBatch(
    applied,
    awards,
    hash(JSON.stringify(events)),
    new Date(Date.parse(LATER) + 3_600_000).toISOString(),
  );
  expect(memberTotal(replayed)).toBe((before ?? 0) + 60);
});
