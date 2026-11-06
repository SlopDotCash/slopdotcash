/**
 * Penalty apply order, Points key sorts, and canonicalJson key order must
 * stay host-stable. Mixed-case node/source ids reverse under Turkish default
 * collation (i/I), which can change which capped debit wins and digest bytes.
 * Pin English collation like #2059 review order — not open #2336/#2327/#2342.
 */
import { expect, spyOn, test } from "bun:test";
import { canonicalJson } from "../src/lib/canonical-json";
import type { PublishedPenalty, ScoreEvent } from "../src/lib/leaderboard-types";
import { penaltyDeductions } from "../src/lib/score-penalties";

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

test("Turkish host locale does not flip capped penalty apply order", () => {
  // Same actor/project/month bucket, identical occurredAt: id tie-break decides
  // which debit consumes the 10 available thirds. English order applies PEN_i
  // first; Turkish default would reverse I/i and flip the winner.
  expect("PEN_i".localeCompare("PEN_I", "en")).toBeLessThan(0);
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
  // Mixed-case keys reverse under Turkish default collation.
  expect("key_i".localeCompare("key_I", "en")).toBeLessThan(0);
  expect("key_i".localeCompare("key_I", "tr")).toBeGreaterThan(0);

  const value = { key_I: 1, key_i: 2 };
  const english = canonicalJson(value);
  expect(english).toBe('{"key_i":2,"key_I":1}');

  withTurkishLocale(() => {
    expect(canonicalJson(value)).toBe(english);
  });
});

test("Turkish host locale does not reverse Slopbot filename sort", () => {
  const files = ["filename_I.ts", "filename_i.ts"];
  const english = [...files].sort((a, b) => a.localeCompare(b, "en"));
  expect(english).toEqual(["filename_i.ts", "filename_I.ts"]);

  withTurkishLocale(() => {
    expect([...files].sort((a, b) => a.localeCompare(b, "en"))).toEqual(
      english,
    );
  });
});
