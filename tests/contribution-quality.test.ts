import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  allocateQualityWeights,
  assertQualityEvidence,
  calculateQualityReview,
  type QualityEvidence,
  verifyQualityEventIds,
} from "../src/lib/contribution-quality";
import {
  assertFundingPreparation,
  createFundingReview,
} from "../src/lib/funding-review-data";

const evidence: QualityEvidence = {
  schemaVersion: "1",
  projectId: "p",
  cycleId: "2026-08",
  sourceSnapshotSha256: "a".repeat(64),
  closureCensus: {
    method: "repository-created-order-v1",
    sourceSha256: "b".repeat(64),
    observedAt: "2026-09-10T00:00:00Z",
    discussionSourceSha256: null,
  },
  events: [
    {
      id: "a",
      actorId: "alice",
      url: "https://github.com/org/repo/pull/1",
      title: "One fix",
      kind: "implementation",
      scoreThirds: 1,
      weight: "10000",
      flags: [],
    },
    {
      id: "b",
      actorId: "alice",
      url: "https://github.com/org/repo/pull/2",
      title: "Release same fix",
      kind: "implementation",
      scoreThirds: 1,
      weight: "10000",
      flags: [],
    },
    {
      id: "c",
      actorId: "bob",
      url: "https://github.com/org/repo/pull/3",
      title: "Small critical fix",
      kind: "implementation",
      scoreThirds: 1,
      weight: "10000",
      flags: [],
    },
  ],
  closures: [1, 2].map((n) => ({
    id: `closed${n}`,
    actorId: "alice",
    actorLogin: "alice",
    flags: [],
    url: `https://github.com/org/repo/pull/${n + 10}`,
    title: "Closed",
    createdInCycle: true,
  })),
};
const decision = {
  eventIds: ["a", "b"],
  tier: "micro",
  reason: "Same accepted fix promoted to the release branch",
  evidenceUrls: ["https://github.com/org/repo/pull/1"],
};
describe("source-bound contribution quality proposals", () => {
  it("groups split and release work once, while retaining every actor", () => {
    const result = calculateQualityReview(evidence, [decision], "100");
    expect(Object.fromEntries(result.after)).toEqual({
      alice: "50",
      bob: "50",
    });
    expect(result.reviewedEvents).toBe(2);
    expect(result.unresolvedEvents).toBe(1);
  });
  it("allows a tiny critical fix to outweigh a low-value large change without using LOC or role", () => {
    const result = calculateQualityReview(
      evidence,
      [{ ...decision, eventIds: ["c"], tier: "large" }],
      "2600",
    );
    expect(result.after.get("bob")).toBe("2400");
    expect(result.after.get("alice")).toBe("200");
  });
  it("cannot count a source twice or silently merge shared authorship", () => {
    expect(() =>
      calculateQualityReview(evidence, [decision, decision], "100"),
    ).toThrow(/twice/);
    expect(() =>
      calculateQualityReview(
        evidence,
        [{ ...decision, eventIds: ["a", "c"] }],
        "100",
      ),
    ).toThrow(/one contributor/);
    expect(() =>
      calculateQualityReview(
        evidence,
        [{ ...decision, eventIds: ["closed1"] }],
        "100",
      ),
    ).toThrow(/Unknown/);
  });
  it("does not infer a penalty from closures, and retains an explicitly proposed deduction", () => {
    const original = calculateQualityReview(evidence, [], "300");
    expect(original.after.get("alice")).toBe("200");
    const burden = {
      actorId: "alice",
      closedPrIds: ["closed1", "closed2"],
      deductionBasisPoints: 1000,
      reason: "Repeated duplicate submissions after explicit maintainer notice",
      evidenceUrls: evidence.closures.map((row) => row.url),
    };
    const result = calculateQualityReview(evidence, [], "300", [burden]);
    expect(result.after.get("alice")).toBe("180");
    expect(result.after.get("bob")).toBe("100");
    expect(result.retainedMinor).toBe("20");
    expect(() =>
      calculateQualityReview(evidence, [], "300", [
        { ...burden, closedPrIds: ["closed1", "closed1"] },
      ]),
    ).toThrow(/two distinct/);
    expect(() =>
      calculateQualityReview(
        {
          ...evidence,
          closures: evidence.closures.map((row) => ({
            ...row,
            createdInCycle: false,
          })),
        },
        [],
        "300",
        [burden],
      ),
    ).toThrow(/two distinct/);
  });
  it("conserves integer USDC beyond Number limits and is permutation invariant", () => {
    const cap = "9999999999999999999";
    const a = allocateQualityWeights(
      new Map([
        ["a", 7n],
        ["b", 7n],
        ["z", 0n],
      ]),
      cap,
    );
    const b = allocateQualityWeights(
      new Map([
        ["z", 0n],
        ["b", 7n],
        ["a", 7n],
      ]),
      cap,
    );
    expect([...a]).toEqual([...b]);
    expect([...a.values()].reduce((s, v) => s + BigInt(v), 0n)).toBe(
      BigInt(cap),
    );
    expect(a.get("z")).toBe("0");
  });
  it("reconciles all August actors, event IDs and scores with the frozen preparation", async () => {
    const preparation = assertFundingPreparation(
      JSON.parse(
        await readFile("funding/preparations/eliza-2026-08.json", "utf8"),
      ),
    );
    const quality = assertQualityEvidence(
      JSON.parse(await readFile("funding/quality/eliza-2026-08.json", "utf8")),
      preparation,
    );
    await verifyQualityEventIds(quality, preparation);
    expect(quality.events).toHaveLength(7061);
    expect(quality.closures).toHaveLength(2642);
    expect(() =>
      assertQualityEvidence(
        {
          ...quality,
          closures: [
            ...quality.closures,
            { ...quality.closures[0], id: "forged-second-id" },
          ],
        },
        preparation,
      ),
    ).toThrow(/distinct unmerged/);
    expect(() =>
      assertQualityEvidence(
        {
          ...quality,
          closures: [
            {
              ...quality.closures[0],
              url: quality.events.find(
                (event) => event.kind === "implementation",
              )?.url,
            },
          ],
        },
        preparation,
      ),
    ).toThrow(/distinct unmerged/);
    const result = calculateQualityReview(quality, [], "10000000000");
    expect(result.after.size).toBe(108);
    for (const actor of createFundingReview(preparation).contributors)
      expect(result.before.get(actor.actor.id)).toBe(actor.simulatedMinor);
    expect(() =>
      assertQualityEvidence(
        { ...quality, sourceSnapshotSha256: "b".repeat(64) },
        preparation,
      ),
    ).toThrow(/exact cycle/);
    expect(() =>
      assertQualityEvidence(
        { ...quality, events: quality.events.slice(1) },
        preparation,
      ),
    ).toThrow(/reconcile/);
  });
});

import { contributionDiffSignals } from "../scripts/contribution-diff-signals";

describe("conservative diff inspection", () => {
  it("recognizes blank-line cleanup without misclassifying Python indentation or whitespace in strings", () => {
    const file = {
      filename: "a.py",
      status: "modified",
      additions: 0,
      deletions: 1,
      patch: "@@ -1,2 +1 @@\n print('x')\n-",
    };
    expect(contributionDiffSignals([file], 1, 0, 1).blankLinesOnly).toBe(true);
    expect(
      contributionDiffSignals(
        [
          {
            ...file,
            additions: 1,
            patch: "@@ -1 +1 @@\n-  return 1\n+    return 1",
          },
        ],
        1,
        1,
        1,
      ).blankLinesOnly,
    ).toBe(false);
    expect(
      contributionDiffSignals(
        [
          {
            ...file,
            additions: 1,
            patch: "@@ -1 +1 @@\n-s = 'a b'\n+s = 'ab'",
          },
        ],
        1,
        1,
        1,
      ).blankLinesOnly,
    ).toBe(false);
  });
  it("fails closed on missing files, binary patches and truncated hunks", () => {
    const file = {
      filename: "a.ts",
      status: "modified",
      additions: 2,
      deletions: 0,
      patch: "@@ -1 +1 @@\n+x",
    };
    expect(contributionDiffSignals([file], 2, 2, 0).complete).toBe(false);
    expect(contributionDiffSignals([file], 1, 2, 0).complete).toBe(false);
    expect(
      contributionDiffSignals([{ ...file, patch: undefined }], 1, 2, 0)
        .complete,
    ).toBe(false);
  });
  it("matches reordered identical patches, but preserves file identity and meaningful whitespace", () => {
    const file = {
      filename: "a.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@ -1 +1 @@\n+x",
    };
    const original = contributionDiffSignals([file], 1, 1, 0).patchSha256;
    expect(
      contributionDiffSignals([{ ...file, patch: "@@ -4 +8 @@\n+x" }], 1, 1, 0)
        .patchSha256,
    ).toBe(original);
    expect(
      contributionDiffSignals([{ ...file, filename: "b.ts" }], 1, 1, 0)
        .patchSha256,
    ).not.toBe(original);
    expect(
      contributionDiffSignals([{ ...file, patch: "@@ -1 +1 @@\n+ x" }], 1, 1, 0)
        .patchSha256,
    ).not.toBe(original);
  });
});

import { closureDiscussionSignals } from "../scripts/closure-discussion-signals";

it("keeps salvage and duplicate mentions visible together, marks missing context, and never assigns a deduction", () => {
  expect(
    closureDiscussionSignals(
      ["Duplicate scope; useful tests were incorporated into the replacement."],
      false,
    ),
  ).toEqual([
    "discussion mentions duplication: inspect rationale",
    "discussion mentions salvage or replacement: preserve useful credit",
    "discussion capture incomplete: inspect remaining GitHub context",
  ]);
  expect(
    closureDiscussionSignals(
      ["```\nduplicate\n```\n> no caller\n<!-- duplicate -->"],
      true,
    ),
  ).toEqual(["closure reason needs review; no categorical signal detected"]);
});

it("uses canonical contributor login tie breaks when allocating the last micro-unit", () => {
  const result = allocateQualityWeights(
    new Map([
      ["a", 1n],
      ["b", 1n],
    ]),
    "1",
    new Map([
      ["a", "Zoe"],
      ["b", "Amy"],
    ]),
  );
  expect(result.get("b")).toBe("1");
  expect(result.get("a")).toBe("0");
});
