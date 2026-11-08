import { describe, expect, it } from "bun:test";
import {
  POINTS_RULE,
  type PointAward,
  type PointsJournal,
  pointMembers,
} from "../src/lib/points";

const AT = "2026-11-01T00:00:00.000Z";
const MONTH = "2026-10";

function award(over: Partial<PointAward> & { key: string }): PointAward {
  return {
    actor: { id: "A1", login: "alice" },
    projectId: "slopdotcash",
    category: "merged-pull-request",
    amount: 240,
    occurredAt: "2026-09-10T00:00:00.000Z",
    sourceId: "PR_node_1",
    sourceUrl: "https://github.com/owner/repo/pull/101",
    workUnitId: "wu_joint_unit",
    provisional: true,
    ...over,
  };
}

function journal(awards: PointAward[]): PointsJournal {
  return {
    schemaVersion: "1",
    ruleVersion: POINTS_RULE,
    generatedAt: AT,
    coverage: [],
    revisions: awards.map((a, i) => ({
      id: `r${i}`,
      previous: null,
      recordedAt: AT,
      sourceDigest: "digest",
      sourceRule: POINTS_RULE,
      award: a,
    })),
  };
}

describe("work unit counted once across months", () => {
  it("counts one work unit once when its records fall in different months", () => {
    // A joint assessment re-issued under a new completion source records the
    // same work unit in a later month while the earlier record survives, so
    // splitting the dedup key by month sums both copies. A logical accepted
    // work unit earns once (protocol/points-v1.md).
    const first = award({ key: "key:joint:pr1" });
    const second = award({
      key: "key:joint:pr2",
      occurredAt: "2026-10-20T00:00:00.000Z",
      sourceId: "PR_node_2",
      sourceUrl: "https://github.com/owner/repo/pull/102",
    });
    const members = pointMembers(journal([first, second]), MONTH).filter(
      (m) => m.actor.id === "A1",
    );
    expect(members[0].total).toBe(240);
  });
});
