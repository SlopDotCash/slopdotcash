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
  applyPointsSnapshot,
  type PointsJournal,
  pointMembers,
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
