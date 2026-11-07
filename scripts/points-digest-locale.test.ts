/**
 * Penalty apply order, Points standing, canonicalJson key order, and Slopbot
 * value evidence digest bytes must stay host-stable. Mixed-case ids reverse
 * under Turkish default collation (i/I). Pin via compareEnglish — not open
 * #2336/#2327/#2342. Guards must call production code so dropping the pin fails.
 */
import { expect, spyOn, test } from "bun:test";
import { canonicalJson } from "../src/lib/canonical-json";
import { compareEnglish } from "../src/lib/collation";
import type { PublishedPenalty, ScoreEvent } from "../src/lib/leaderboard-types";
import {
  appendPointAwards,
  emptyPointsJournal,
  pointKey,
  pointMembers,
  type PointAward,
} from "../src/lib/points";
import { penaltyDeductions } from "../src/lib/score-penalties";
import {
  changeBytes,
  type FileChange,
} from "../workers/slopbot/value-evidence";

function withTurkishLocale(run: () => void) {
  const original = String.prototype.localeCompare;
  const locale = spyOn(String.prototype, "localeCompare").mockImplementation(
    function (
      this: string,
      other: string,
      locales?: Intl.LocalesArgument,
      options?: Intl.CollatorOptions,
    ) {
      return original.call(this, other, locales ?? "tr", options);
    },
  );
  try {
    run();
  } finally {
    locale.mockRestore();
  }
}

const actor = {
  id: "MDQ6VXNlcjQy",
  login: "author",
  avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
  url: "https://github.com/author",
  kind: "User" as const,
};
const repository = "https://github.com/SlopDotCash/asi";
const at = "2026-11-20T00:00:00.000Z";

function penalty(id: string): PublishedPenalty {
  return {
    id,
    actor,
    repository,
    occurredAt: "2026-11-15T12:00:00.000Z",
    category: "spam",
    tableVersion: "slopbot-penalties-v1",
    debitThirds: 10,
    source: {
      id: id,
      kind: "pull-request",
      number: 1,
      title: "spam",
      url: `${repository}/pull/1`,
    },
  };
}

function file(filename: string): FileChange {
  return {
    filename,
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: "@@ -1 +1 @@\n-a\n+b\n",
    blob_url: null,
  };
}

function award(partial: {
  actorId: string;
  login: string;
  sourceId: string;
  amount: number;
}): PointAward {
  const category = "merged-pull-request" as const;
  return {
    key: pointKey("asi", partial.actorId, category, partial.sourceId),
    actor: { id: partial.actorId, login: partial.login },
    projectId: "asi",
    category,
    amount: partial.amount,
    occurredAt: "2026-11-10T00:00:00.000Z",
    sourceId: partial.sourceId,
    sourceUrl: `${repository}/pull/1`,
    workUnitId: partial.sourceId,
    provisional: false,
  };
}

test("Turkish host locale does not flip capped penalty apply order", () => {
  expect(compareEnglish("PEN_i", "PEN_I")).toBeLessThan(0);
  expect("PEN_i".localeCompare("PEN_I", "tr")).toBeGreaterThan(0);

  const events: Pick<
    ScoreEvent,
    "actor" | "repository" | "occurredAt" | "scoreThirds" | "points"
  >[] = [
    {
      actor,
      repository,
      occurredAt: "2026-11-10T00:00:00.000Z",
      scoreThirds: 10,
      points: 10 / 3,
    },
  ];
  const penalties = [penalty("PEN_I"), penalty("PEN_i")];
  const projectOf = () => "asi";
  const english = penaltyDeductions(events, penalties, projectOf);
  expect([...english.byPenalty.entries()]).toEqual([["PEN_i", 10]]);

  withTurkishLocale(() => {
    const turkish = penaltyDeductions(events, penalties, projectOf);
    expect([...turkish.byPenalty.entries()]).toEqual([["PEN_i", 10]]);
  });
});

test("Turkish host locale does not change canonicalJson object key order", () => {
  expect(compareEnglish("key_i", "key_I")).toBeLessThan(0);
  expect("key_i".localeCompare("key_I", "tr")).toBeGreaterThan(0);

  const value = { key_I: 1, key_i: 2 };
  const english = canonicalJson(value);
  expect(english).toBe('{"key_i":2,"key_I":1}');

  withTurkishLocale(() => {
    expect(canonicalJson(value)).toBe(english);
  });
});

test("Turkish host locale does not change Slopbot changeBytes digest", () => {
  // Production comparator in workers/slopbot/value-evidence.ts. Bare
  // localeCompare reverses this pair under Turkish; dropping compareEnglish
  // from changeBytes must make this assertion fail.
  expect(compareEnglish("filename_i.ts", "filename_I.ts")).toBeLessThan(0);
  expect("filename_i.ts".localeCompare("filename_I.ts", "tr")).toBeGreaterThan(
    0,
  );

  const files = [file("filename_I.ts"), file("filename_i.ts")];
  const english = changeBytes(files);
  expect(JSON.parse(english)[0][0]).toBe("filename_i.ts");

  withTurkishLocale(() => {
    expect(changeBytes(files)).toBe(english);
  });
});

test("Turkish host locale does not flip pointMembers standing on mixed-case actor ids", () => {
  // Equal totals: standing tie-break is actor.id via compareEnglish.
  expect(compareEnglish("node_i", "node_I")).toBeLessThan(0);
  expect("node_i".localeCompare("node_I", "tr")).toBeGreaterThan(0);

  const awards = [
    award({
      actorId: "node_I",
      login: "upper",
      sourceId: "PR_upper",
      amount: 10,
    }),
    award({
      actorId: "node_i",
      login: "lower",
      sourceId: "PR_lower",
      amount: 10,
    }),
  ];
  const journal = appendPointAwards(
    emptyPointsJournal(at),
    awards,
    "a".repeat(64),
    "slop-score-v2",
    at,
  );
  const english = pointMembers(journal).map((member) => member.actor.id);
  expect(english).toEqual(["node_i", "node_I"]);

  withTurkishLocale(() => {
    expect(pointMembers(journal).map((member) => member.actor.id)).toEqual(
      english,
    );
  });
});

test("Turkish host locale keeps appendPointAwards revision order stable", () => {
  // Valid keys are sha256 hex; order is still production-sorted. Assert the
  // journal revision sequence matches English under a Turkish host mock.
  const awards = [
    award({
      actorId: actor.id,
      login: actor.login,
      sourceId: "PR_zzz",
      amount: 10,
    }),
    award({
      actorId: actor.id,
      login: actor.login,
      sourceId: "PR_aaa",
      amount: 20,
    }),
  ];
  const english = appendPointAwards(
    emptyPointsJournal(at),
    awards,
    "b".repeat(64),
    "slop-score-v2",
    at,
  ).revisions.map((revision) => revision.award.sourceId);

  withTurkishLocale(() => {
    expect(
      appendPointAwards(
        emptyPointsJournal(at),
        awards,
        "b".repeat(64),
        "slop-score-v2",
        at,
      ).revisions.map((revision) => revision.award.sourceId),
    ).toEqual(english);
  });
});
