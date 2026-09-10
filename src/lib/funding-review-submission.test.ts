import {
  link,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyFundingReviewFiles,
  parseApplyFundingReviewArguments,
} from "../../scripts/apply-funding-review";
import {
  applyFundingReviewSubmission,
  createFundingReviewSubmission,
  type FundingReviewSubmission,
  fundingReviewProposalSha256,
} from "./funding-review-submission";
import {
  assertRewardAllocationManifest,
  type RewardAllocationManifest,
} from "./rewards";

const NOW = Date.parse("2026-08-05T00:00:00.000Z");
function proposal(): RewardAllocationManifest {
  const commit = "a".repeat(40);
  return assertRewardAllocationManifest({
    schemaVersion: "1",
    kind: "reward-allocation",
    projectId: "eliza",
    cycleId: "2026-07",
    status: "proposed",
    generatedAt: "2026-08-02T00:00:00.000Z",
    approvedAt: null,
    contributionWindow: {
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    },
    review: {
      days: 14,
      lastMaterialChangeAt: "2026-08-02T00:00:00.000Z",
      endsAt: "2026-08-16T00:00:00.000Z",
    },
    currency: "USDC",
    chain: "solana",
    capMinor: "10000000",
    carriedMinor: "0",
    minimumTransferMinor: "2000000",
    feeBasisPoints: 100,
    scoringRuleVersion: "gitarmy-v1",
    sourceSnapshotSha256: "b".repeat(64),
    allocations: ["one", "two"].map((login, index) => ({
      intentId: `pay_eliza_2026_07_000${index + 1}_u_${login}`,
      actor: { id: `U_${login}`, login },
      score: 10,
      suggestedMinor: "5000000",
      accruedMinor: "5000000",
      approvedMinor: "0",
      state: index ? "unclaimed" : "proposed",
      wallet: index
        ? null
        : {
            address: "11111111111111111111111111111111",
            chain: "solana",
            observedAt: "2026-08-02T00:00:00.000Z",
            sourceCommit: commit,
            sourceUrl: `https://github.com/${login}/${login}/blob/${commit}/README.md`,
          },
      evidenceEventIds: [`event_${index}`],
      adjustmentReason: null,
      relatedParty: false,
      platformApproval: null,
    })),
    totals: { suggestedMinor: "10000000", approvedMinor: "0", feeMinor: "0" },
  });
}
async function input(value = proposal()) {
  const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  const submission: FundingReviewSubmission = {
    schemaVersion: "1",
    kind: "funding-review-submission",
    projectId: value.projectId,
    cycleId: value.cycleId,
    sourceProposalSha256: await fundingReviewProposalSha256(bytes),
    adjustments: [
      {
        actorId: "U_one",
        decision: "include",
        amountMinor: "3000000",
        reason: "Reduced after public evidence review.",
      },
    ],
  };
  return { bytes, submission };
}

describe("GitHub funding review submission", () => {
  it("changes exact proposed amounts, preserves identity and source, resets fourteen days without approving", async () => {
    const { bytes, submission } = await input();
    const before = bytes.slice();
    const candidate = await applyFundingReviewSubmission(
      bytes,
      submission,
      NOW,
    );
    expect(bytes).toEqual(before);
    expect(candidate.allocations[0]).toEqual({
      ...proposal().allocations[0],
      suggestedMinor: "3000000",
      accruedMinor: "3000000",
      adjustmentReason: submission.adjustments[0].reason,
    });
    expect(candidate.allocations[1]).toEqual(proposal().allocations[1]);
    expect(candidate).toMatchObject({
      status: "proposed",
      approvedAt: null,
      totals: { suggestedMinor: "8000000", approvedMinor: "0", feeMinor: "0" },
      review: {
        lastMaterialChangeAt: "2026-08-05T00:00:00.000Z",
        endsAt: "2026-08-19T00:00:00.000Z",
      },
    });
    expect(assertRewardAllocationManifest(candidate)).toEqual(candidate);
  });
  it("exports an app handoff with preserved funding basis and rejects invalid exports", async () => {
    const value = proposal();
    value.fundingBasis = {
      cycleId: value.cycleId,
      fundingState: "committed",
      committedMinor: "10000000",
      monthlyCapMinor: "10000000",
      instrumentId: `sablier-lockup-v4:base:0x${"1".repeat(40)}:1`,
    };
    const { bytes, submission } = await input(value);
    const exported = await createFundingReviewSubmission(
      bytes,
      submission.adjustments,
      NOW,
    );
    const candidate = await applyFundingReviewSubmission(bytes, exported, NOW);
    expect(exported).toEqual(submission);
    expect(candidate.fundingBasis).toEqual(value.fundingBasis);
    expect(candidate.sourceSnapshotSha256).toEqual(value.sourceSnapshotSha256);
    await expect(
      createFundingReviewSubmission(
        bytes,
        [{ ...submission.adjustments[0], amountMinor: "90000000" }],
        NOW,
      ),
    ).rejects.toThrow(/cap/);
  });
  it("preserves existing carry without increasing the monthly cap", async () => {
    const value = proposal();
    value.carriedMinor = "1000000";
    const { bytes, submission } = await input(value);
    submission.adjustments[0].amountMinor = "6000000";
    const candidate = await applyFundingReviewSubmission(
      bytes,
      submission,
      NOW,
    );
    expect(candidate.capMinor).toBe("10000000");
    expect(candidate.carriedMinor).toBe("1000000");
    expect(candidate.totals.suggestedMinor).toBe("11000000");
    submission.adjustments[0].amountMinor = "6000001";
    await expect(
      applyFundingReviewSubmission(bytes, submission, NOW),
    ).rejects.toThrow(/cap/);
  });
  it("hashes and parses the same snapshot when callers reuse their source buffer", async () => {
    const { bytes, submission } = await input();
    const pending = applyFundingReviewSubmission(bytes, submission, NOW);
    bytes.fill(0);
    const candidate = await pending;
    expect(candidate.allocations[0].suggestedMinor).toBe("3000000");
    expect(candidate.allocations[0].wallet).toEqual(
      proposal().allocations[0].wallet,
    );
  });
  it("keeps missing wallets unclaimed, excludes only with reasons, and holds small amounts", async () => {
    const { bytes, submission } = await input();
    submission.adjustments[0].amountMinor = "1000000";
    submission.adjustments.push({
      actorId: "U_two",
      decision: "include",
      amountMinor: "6000000",
      reason: "Additional accepted work verified.",
    });
    const adjusted = await applyFundingReviewSubmission(bytes, submission, NOW);
    expect(adjusted.allocations.map((row) => row.state)).toEqual([
      "held-below-minimum",
      "unclaimed",
    ]);
    submission.adjustments[0] = {
      actorId: "U_one",
      decision: "exclude",
      amountMinor: "0",
      reason: "Excluded duplicated accepted work.",
    };
    const excluded = await applyFundingReviewSubmission(bytes, submission, NOW);
    expect(excluded.allocations[0]).toMatchObject({
      state: "excluded",
      suggestedMinor: "0",
      approvedMinor: "0",
      wallet: proposal().allocations[0].wallet,
    });
  });
  it("does not reset review for no-ops or reason-only edits", async () => {
    const { bytes, submission } = await input();
    submission.adjustments[0].amountMinor = "5000000";
    expect(
      (await applyFundingReviewSubmission(bytes, submission, NOW)).review,
    ).toEqual(proposal().review);
  });
  it.each([
    [
      "stale hash",
      (s: FundingReviewSubmission) => {
        s.sourceProposalSha256 = "0".repeat(64);
      },
      /Stale/,
    ],
    [
      "wrong project",
      (s: FundingReviewSubmission) => {
        s.projectId = "other";
      },
      /project\/cycle/,
    ],
    [
      "wrong cycle",
      (s: FundingReviewSubmission) => {
        s.cycleId = "2026-08";
      },
      /project\/cycle/,
    ],
    [
      "unknown actor",
      (s: FundingReviewSubmission) => {
        s.adjustments[0].actorId = "unknown";
      },
      /Unknown actor/,
    ],
    [
      "duplicate actor",
      (s: FundingReviewSubmission) => {
        s.adjustments.push({ ...s.adjustments[0] });
      },
      /Duplicate/,
    ],
    [
      "wallet edit",
      (s: FundingReviewSubmission) => {
        Object.assign(s.adjustments[0], { wallet: null });
      },
      /forbidden/,
    ],
    [
      "approval injection",
      (s: FundingReviewSubmission) => {
        Object.assign(s, { approvedAt: "2026-08-05T00:00:00.000Z" });
      },
      /forbidden/,
    ],
    [
      "over cap",
      (s: FundingReviewSubmission) => {
        s.adjustments[0].amountMinor = "5000001";
      },
      /cap/,
    ],
    [
      "fraction",
      (s: FundingReviewSubmission) => {
        s.adjustments[0].amountMinor = "1.5";
      },
      /integer/,
    ],
    [
      "negative",
      (s: FundingReviewSubmission) => {
        s.adjustments[0].amountMinor = "-1";
      },
      /integer/,
    ],
    [
      "missing reason",
      (s: FundingReviewSubmission) => {
        s.adjustments[0].reason = "";
      },
      /public reason/,
    ],
    [
      "exclusion without reason",
      (s: FundingReviewSubmission) => {
        Object.assign(s.adjustments[0], {
          decision: "exclude",
          amountMinor: "0",
          reason: "",
        });
      },
      /public reason/,
    ],
    [
      "positive exclusion",
      (s: FundingReviewSubmission) => {
        s.adjustments[0].decision = "exclude";
      },
      /zero amount/,
    ],
  ])("rejects %s", async (_name, mutate, error) => {
    const { bytes, submission } = await input();
    mutate(submission);
    await expect(
      applyFundingReviewSubmission(bytes, submission, NOW),
    ).rejects.toThrow(error);
  });
  it("binds formatting bytes, rejects deadline and pre-review execution", async () => {
    const { bytes, submission } = await input();
    await expect(
      applyFundingReviewSubmission(bytes.slice(0, -1), submission, NOW),
    ).rejects.toThrow(/Stale/);
    for (const time of [
      Date.parse(proposal().review.endsAt),
      Date.parse(proposal().generatedAt) - 1,
    ])
      await expect(
        applyFundingReviewSubmission(bytes, submission, time),
      ).rejects.toThrow(/expired or has not started/);
  });
  it("rejects nonproposals and even valid proposed manifests containing approved principal", async () => {
    const value = proposal();
    value.allocations[0].state = "approved";
    value.allocations[0].approvedMinor = "5000000";
    value.totals.approvedMinor = "5000000";
    value.totals.feeMinor = "50000";
    const approvedRow = await input(value);
    await expect(
      applyFundingReviewSubmission(
        approvedRow.bytes,
        approvedRow.submission,
        NOW,
      ),
    ).rejects.toThrow(/zero approved/);
    value.status = "approved";
    value.approvedAt = value.review.endsAt;
    const approved = await input(value);
    await expect(
      applyFundingReviewSubmission(approved.bytes, approved.submission, NOW),
    ).rejects.toThrow(/Only proposed/);
  });
  it("writes a separate usable manifest once and refuses source aliases or replacement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "funding-review-"));
    try {
      const { bytes, submission } = await input();
      const args = {
        proposalPath: join(directory, "proposal.json"),
        submissionPath: join(directory, "review.json"),
        outputPath: join(directory, "candidate.json"),
      };
      await writeFile(args.proposalPath, bytes);
      await writeFile(args.submissionPath, JSON.stringify(submission));
      const stale = { ...submission, sourceProposalSha256: "0".repeat(64) };
      await writeFile(args.submissionPath, JSON.stringify(stale));
      await expect(applyFundingReviewFiles(args, NOW)).rejects.toThrow(/Stale/);
      await expect(readFile(args.outputPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await writeFile(args.submissionPath, JSON.stringify(submission));
      const candidate = await applyFundingReviewFiles(args, NOW);
      expect(JSON.parse(await readFile(args.outputPath, "utf8"))).toEqual(
        candidate,
      );
      await expect(applyFundingReviewFiles(args, NOW)).rejects.toThrow(
        /Refusing to replace/,
      );
      await expect(
        applyFundingReviewFiles(
          { ...args, outputPath: args.proposalPath },
          NOW,
        ),
      ).rejects.toThrow(/separate/);
      const alias = join(directory, "alias.json");
      await symlink(args.proposalPath, alias);
      await expect(
        applyFundingReviewFiles({ ...args, outputPath: alias }, NOW),
      ).rejects.toThrow(/Refusing to replace/);
      const hardAlias = join(directory, "hard-alias.json");
      await link(args.proposalPath, hardAlias);
      await expect(
        applyFundingReviewFiles({ ...args, outputPath: hardAlias }, NOW),
      ).rejects.toThrow(/Refusing to replace/);
      await expect(
        applyFundingReviewFiles(
          { ...args, outputPath: args.submissionPath },
          NOW,
        ),
      ).rejects.toThrow(/separate/);
      expect(JSON.parse(await readFile(args.submissionPath, "utf8"))).toEqual(
        submission,
      );
      expect(Array.from(await readFile(args.proposalPath))).toEqual(
        Array.from(bytes),
      );
      expect(
        parseApplyFundingReviewArguments([
          "--proposal",
          args.proposalPath,
          "--submission",
          args.submissionPath,
          "--output",
          args.outputPath,
        ]),
      ).toEqual(args);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
