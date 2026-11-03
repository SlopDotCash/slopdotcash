import { expect, spyOn, test } from "bun:test";
import { findProject } from "../src/lib/projects.mjs";
import {
  allocateReviewBudgetMinor,
  createRewardCycleProposal,
} from "../src/lib/reward-cycle";

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

// The production i/I pair from the published 2026-10-30 snapshot, already
// used by scripts/leaderboard-locale.test.ts for this collation class.
// Equal weights leave equal remainders, so the actor-ID tie-break decides
// which contributor receives the one unallocated minor unit.
const ids = ["PR_kwDOMT5cIs8AAAABG3i2Yg", "PR_kwDOMT5cIs8AAAABG3IwgQ"];

function tiedAllocation() {
  return allocateReviewBudgetMinor(3n, [
    { actorId: ids[0], scoreThirds: 1 },
    { actorId: ids[1], scoreThirds: 1 },
  ]);
}

test("the remainder tie-break gives the extra unit to the same contributor under a Turkish default locale", () => {
  withTurkishLocale(() => {
    const allocations = tiedAllocation();
    expect(allocations.get(ids[0])).toBe(2n);
    expect(allocations.get(ids[1])).toBe(1n);
  });
});

test("the remainder tie-break matches the English order by default", () => {
  const allocations = tiedAllocation();
  expect(allocations.get(ids[0])).toBe(2n);
  expect(allocations.get(ids[1])).toBe(1n);
});

// The carried-only sort in createRewardCycleProposal mints intentIds from
// the sort order, so an unpinned locale flips both the published allocation
// order and the intentId sequence numbers under a Turkish default locale.
test("carried-only allocations keep the English order under a Turkish default locale", () => {
  const project = findProject("asi");
  if (!project) throw new Error("fixture project missing");
  const proposal = () =>
    createRewardCycleProposal({
      cycleId: "2026-10",
      generatedAt: "2026-11-05T00:00:00.000Z",
      projectId: "asi",
      archivedProject: project,
      snapshot: {
        schemaVersion: 1,
        repository: "SlopDotCash/asi",
        repositories: [
          {
            id: "elizaOS/asi",
            displayName: "SlopDotCash/asi",
            githubUrl: "https://github.com/SlopDotCash/asi",
            description: "",
            integrationBranch: "main",
          },
        ],
        ruleVersion: "test",
        generatedAt: "2026-11-05T00:00:00.000Z",
        sourceUpdatedAt: "2026-11-05T00:00:00.000Z",
        stale: false,
        window: {
          days: 31,
          from: "2026-10-01T00:00:00.000Z",
          to: "2026-11-01T00:00:00.000Z",
        },
        methodology: {},
        source: {
          verificationWindow: {
            from: "2026-10-01T00:00:00.000Z",
            to: "2026-11-01T00:00:00.000Z",
          },
          evidenceVerification: { status: "complete" },
        },
        leaders: [],
        ledger: [],
        attributions: [],
        opportunities: [],
        reviewExclusions: [],
        invalidAttributionMarkers: [],
        workQueue: { issues: [], pullRequests: [] },
        paymentReviewBasisOmitted: {
          policy: "scr-05-payments-production-v1",
          effectiveAt: "2026-10-09T23:21:35.388Z",
          reason: "no-pre-policy-reviews",
        },
      } as never,
      sourceSnapshotSha256: "ab".repeat(32),
      fundingBasis: {
        cycleId: "2026-10",
        instrumentId: null,
        fundingState: "committed",
        committedMinor: "0",
        monthlyCapMinor: "1000000000",
      },
      priorAccruedMinor: new Map([
        [ids[0], "500000"],
        [ids[1], "500000"],
      ]),
      priorActorLogins: new Map([
        [ids[0], "actor-a"],
        [ids[1], "actor-b"],
      ]),
    } as never);
  const expected = [
    "pay_asi_2026_10_0001_pr_kwdomt5cis8aaaabg3i2yg",
    "pay_asi_2026_10_0002_pr_kwdomt5cis8aaaabg3iwgq",
  ];
  withTurkishLocale(() => {
    const manifest = proposal() as unknown as {
      allocations: { intentId: string }[];
    };
    expect(manifest.allocations.map((a) => a.intentId)).toEqual(expected);
  });
  const manifest = proposal() as unknown as {
    allocations: { intentId: string }[];
  };
  expect(manifest.allocations.map((a) => a.intentId)).toEqual(expected);
});

test("distinct remainders keep their allocation under a Turkish default locale", () => {
  withTurkishLocale(() => {
    const allocations = allocateReviewBudgetMinor(5n, [
      { actorId: ids[0], scoreThirds: 1 },
      { actorId: ids[1], scoreThirds: 2 },
    ]);
    expect(allocations.get(ids[0])).toBe(2n);
    expect(allocations.get(ids[1])).toBe(3n);
  });
});
