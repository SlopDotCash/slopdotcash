import { expect, test } from "bun:test";
import {
  appendPointAwards,
  emptyPointsJournal,
  type PointAward,
  pointKey,
} from "../src/lib/points";
import { previousPositiveImplementationSources } from "./accepted-implementation-history";

const repository = "elizaOS/eliza";
const projectId = "eliza";
const mergedBefore = "2026-11-01T00:00:00.000Z";
const mergedAt = "2026-10-14T01:00:00.000Z";
const before = "2026-11-02T00:00:00.000Z";
const through = "2026-11-03T00:00:00.000Z";
const after = "2026-11-04T00:00:00.000Z";
const pull = (number: number) =>
  `https://github.com/${repository}/pull/${number}`;

function award(
  id: string,
  number: number,
  overrides: Partial<PointAward> = {},
): PointAward {
  const actor = overrides.actor ?? { id: "U_creator", login: "creator" };
  const category = overrides.category ?? "merged-pull-request";
  const workUnitId = overrides.workUnitId ?? `${id}:merged`;
  return {
    actor,
    projectId,
    amount: 30,
    category,
    occurredAt: mergedAt,
    sourceId: id,
    sourceUrl: pull(number),
    workUnitId,
    provisional: true,
    ...overrides,
    key: pointKey(
      projectId,
      actor.id,
      category,
      id,
      workUnitId.startsWith("wu_") ? workUnitId : undefined,
    ),
  };
}

test("cross-window source identity requires a positive ordinary latest revision at the cutoff", () => {
  const ordinary = award("PR_keep", 10);
  const previousRecipient = award("PR_keep", 10, {
    actor: { id: "U_carrier", login: "carrier" },
  });
  const laterZero = award("PR_later_zero", 11);
  const earlierZero = award("PR_earlier_zero", 12);
  const journal = appendPointAwards(
    emptyPointsJournal(before),
    [
      ordinary,
      previousRecipient,
      laterZero,
      earlierZero,
      award("PR_joint_only", 13, { workUnitId: `wu_${"1".repeat(64)}` }),
      award("PR_at_cutoff", 14, { occurredAt: mergedBefore }),
      award("PR_fragment", 15, { sourceUrl: `${pull(15)}#discussion` }),
      award("PR_wrong_repo", 16, {
        sourceUrl: "https://github.com/other/eliza/pull/16",
      }),
      award("PR_conflicting_id", 17),
      award("PR_conflicting_id", 18, {
        actor: { id: "U_secondary", login: "secondary" },
      }),
      award("PR_number_one", 19),
      award("PR_number_two", 19),
    ],
    "a".repeat(64),
    "slop-score-v2",
    before,
  );
  const corrected = appendPointAwards(
    journal,
    [
      { ...earlierZero, amount: 0 },
      { ...previousRecipient, amount: 0 },
    ],
    "b".repeat(64),
    "slop-score-v2",
    through,
  );
  const current = appendPointAwards(
    corrected,
    [{ ...laterZero, amount: 0 }],
    "c".repeat(64),
    "slop-score-v2",
    after,
  );
  const scope = {
    projectId,
    repository,
    mergedBefore,
    recordedThrough: through,
  };
  const first = { id: ordinary.sourceId, number: 10, url: pull(10), mergedAt };
  expect(previousPositiveImplementationSources(current, scope)).toEqual([
    first,
    { id: laterZero.sourceId, number: 11, url: pull(11), mergedAt },
  ]);
  expect(
    previousPositiveImplementationSources(current, {
      ...scope,
      recordedThrough: after,
    }),
  ).toEqual([first]);
});
