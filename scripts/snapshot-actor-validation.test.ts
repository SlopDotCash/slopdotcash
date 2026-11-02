import { afterEach, expect, setSystemTime, test } from "bun:test";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
} from "../src/lib/leaderboard";
import {
  AFTER_NOVEMBER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";

afterEach(() => setSystemTime());

function snapshot() {
  setSystemTime(new Date(AFTER_NOVEMBER));
  return structuredClone(
    createLeaderboardSnapshot(penaltyScoreInput([], AFTER_NOVEMBER)),
  );
}

test("a repeated actor must still pass every changed identity field", () => {
  const original = snapshot();
  expect(() => assertLeaderboardSnapshot(original)).not.toThrow();
  for (const [field, invalid] of [
    ["login", "bad name"],
    ["avatarUrl", "http://avatars.githubusercontent.com/u/42"],
    ["url", "https://github.com/a-different-person"],
    ["kind", "Invalid"],
  ]) {
    const altered = structuredClone(original);
    altered.ledger[0].actor = { ...altered.ledger[0].actor, [field]: invalid };
    expect(() => assertLeaderboardSnapshot(altered)).toThrow();
  }
});

test("successful identity checks do not survive a later snapshot validation", () => {
  const value = snapshot();
  assertLeaderboardSnapshot(value);
  value.ledger[0].actor = {
    ...value.ledger[0].actor,
    avatarUrl: "http://avatars.githubusercontent.com/u/42",
  };
  expect(() => assertLeaderboardSnapshot(value)).toThrow();
});

test("individually valid actor fields still require snapshot-wide identity coherence", () => {
  const value = snapshot();
  const actor = value.ledger[0].actor;
  value.ledger[0].actor = {
    ...actor,
    url: `https://github.com/${actor.login.toUpperCase()}`,
  };
  expect(() => assertLeaderboardSnapshot(value)).toThrow("changes identity");
});
