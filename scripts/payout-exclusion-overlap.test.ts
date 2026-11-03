/**
 * Payout exclusions (PRD section 7): the non-overlap rule is per actor, and
 * one actor can be named by either GitHub node ID format — the legacy base64
 * spelling or the current `U_` spelling of the same numeric ID. Entries that
 * overlap in time must refuse under either spelling, while disjoint entries
 * for one actor and overlapping entries for different actors stay valid.
 */
import { expect, test } from "bun:test";
import {
  assertPayoutExclusionTransition,
  validatePayoutExclusions,
} from "../src/lib/payout-exclusions.mjs";

// GitHub user 43 in both node ID formats (the pair the monthly payout
// exclusion test already uses through the payment path).
const LEGACY_NODE_ID = "MDQ6VXNlcjQz";
const CURRENT_NODE_ID = "U_kgDOAAAAKw";
// GitHub user 42 in the legacy format (base64 of "04:User42").
const OTHER_NODE_ID = "MDQ6VXNlcjQy";

function entry(
  nodeId: string,
  actorId: string,
  relationship: string,
  fromCycle: string,
  untilCycle: string | null,
) {
  return {
    actorId,
    nodeId,
    login: "project-owner",
    relationship,
    fromCycle,
    untilCycle,
  };
}

test("overlapping exclusions for one actor refuse under either node ID spelling", () => {
  for (const list of [
    // Same spelling twice (the refusal already in force).
    [
      entry(LEGACY_NODE_ID, "43", "owner", "2026-11", null),
      entry(LEGACY_NODE_ID, "43", "related-party", "2026-11", null),
    ],
    // The same actor written once per spelling.
    [
      entry(LEGACY_NODE_ID, "43", "owner", "2026-11", null),
      entry(CURRENT_NODE_ID, "43", "related-party", "2026-11", null),
    ],
    [
      entry(CURRENT_NODE_ID, "43", "related-party", "2026-11", null),
      entry(LEGACY_NODE_ID, "43", "owner", "2026-11", null),
    ],
    // Same relationship does not excuse the overlap either.
    [
      entry(LEGACY_NODE_ID, "43", "owner", "2026-11", "2027-03"),
      entry(CURRENT_NODE_ID, "43", "owner", "2027-01", null),
    ],
  ])
    expect(() =>
      validatePayoutExclusions(list, "reward.payoutExclusions"),
    ).toThrow("overlaps another exclusion of the actor");
});

test("a node ID respelling alone is not a transition change", () => {
  // The same actor, same relationship, same cycle range — only the node ID
  // spelling changes (legacy -> current). The transition guard keys on the
  // numeric actor identity, so this revision must not refuse.
  const previous = {
    reward: {
      payoutExclusions: [entry(LEGACY_NODE_ID, "43", "owner", "2026-10", null)],
    },
  };
  const next = {
    reward: {
      payoutExclusions: [
        entry(CURRENT_NODE_ID, "43", "owner", "2026-10", null),
      ],
    },
  };
  expect(() =>
    assertPayoutExclusionTransition(
      previous,
      next,
      new Date("2026-11-04T00:00:00.000Z"),
    ),
  ).not.toThrow();
  // A real change (different relationship) in the same month still refuses.
  const changed = {
    reward: {
      payoutExclusions: [
        entry(CURRENT_NODE_ID, "43", "related-party", "2026-10", null),
      ],
    },
  };
  expect(() =>
    assertPayoutExclusionTransition(
      previous,
      changed,
      new Date("2026-11-04T00:00:00.000Z"),
    ),
  ).toThrow("payout exclusions apply prospectively; 2026-10 cannot change");
});

test("disjoint entries for one actor and overlaps across actors stay valid", () => {
  // One actor, both spellings, adjacent non-overlapping cycles.
  expect(
    validatePayoutExclusions(
      [
        entry(LEGACY_NODE_ID, "43", "owner", "2026-11", "2026-12"),
        entry(CURRENT_NODE_ID, "43", "owner", "2026-12", null),
      ],
      "reward.payoutExclusions",
    ),
  ).toHaveLength(2);
  // Different actors may cover the same cycle.
  expect(
    validatePayoutExclusions(
      [
        entry(LEGACY_NODE_ID, "43", "owner", "2026-11", null),
        entry(OTHER_NODE_ID, "42", "related-party", "2026-11", null),
      ],
      "reward.payoutExclusions",
    ),
  ).toHaveLength(2);
});
