/// <reference types="bun-types" />
import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { applyFundingReviewSubmission } from "../src/lib/funding-review-submission";
import {
  assertRewardAllocationManifest,
  type RewardAllocationManifest,
} from "../src/lib/rewards";
import { checkUnsafeDestinationTransitions } from "./check-unsafe-destination-transitions";

// Every amount change in a funding review restarts the 14-day public review.
// cycles:check only compares a proposal with its frozen regeneration, so it
// cannot tell whether the window restarted after the latest change. The
// trusted transition gate reads the accepted proposal from the base revision.
// These cases replay two reviews of the July Eliza cycle: a reduction on
// 2026-08-25 (review until 2026-09-08) and a second one on 2026-09-07, which
// must move the review to 2026-09-21.
const PATH = "cycles/eliza/2026-07/proposal.json";
const source = readFileSync(resolve(import.meta.dir, "..", PATH));
const frozen = assertRewardAllocationManifest(
  JSON.parse(source.toString("utf8")),
);
const REASON = "Adjusted after the public review of the merged work.";
const [first] = frozen.allocations.filter((row) => row.suggestedMinor !== "0");

function bytes(proposal: RewardAllocationManifest): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(proposal, null, 2)}\n`);
}

/** The candidate that the funding review writes for one row at `at`. */
function review(
  proposal: RewardAllocationManifest,
  amountMinor: string,
  at: string,
  reason = REASON,
): Promise<RewardAllocationManifest> {
  const proposalBytes = bytes(proposal);
  return applyFundingReviewSubmission(
    proposalBytes,
    {
      schemaVersion: "1",
      kind: "funding-review-submission",
      projectId: proposal.projectId,
      cycleId: proposal.cycleId,
      sourceProposalSha256: createHash("sha256")
        .update(proposalBytes)
        .digest("hex"),
      adjustments: [
        {
          actorId: first.actor.id,
          decision: "include",
          amountMinor,
          reason,
        },
      ],
    },
    Date.parse(at),
  );
}

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/** Commits the accepted and the proposed file, then runs the gate from base. */
function transition(
  base: RewardAllocationManifest,
  head: RewardAllocationManifest,
) {
  const root = mkdtempSync(join(tmpdir(), "slop-review-transition-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q", "-b", "development");
  mkdirSync(join(root, dirname(PATH)), { recursive: true });
  const commit = (proposal: RewardAllocationManifest) => {
    writeFileSync(join(root, PATH), bytes(proposal));
    git("add", PATH);
    git(
      "-c",
      "user.name=Review test",
      "-c",
      "user.email=review@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "-m",
      "cycle",
    );
    return git("rev-parse", "HEAD");
  };
  const baseSha = commit(base);
  const headSha = commit(head);
  git("checkout", "-q", "--detach", baseSha);
  return () =>
    checkUnsafeDestinationTransitions({
      baseSha,
      headSha,
      repositoryRoot: root,
    });
}

const third = (amount: string) => (BigInt(amount) / 3n).toString();
const reduced = third((BigInt(first.suggestedMinor) * 2n).toString());
const firstReview = await review(frozen, reduced, "2026-08-25T00:00:00Z");
const secondReview = await review(
  firstReview,
  third(first.suggestedMinor),
  "2026-09-07T00:00:00Z",
);

describe("review amount changes against the accepted proposal", () => {
  it("accepts the first review of the generated proposal", () => {
    expect(firstReview.review.endsAt).toBe("2026-09-08T00:00:00.000Z");
    expect(transition(frozen, firstReview)()).toEqual({
      preservedFiles: 1,
      checkedFiles: 1,
    });
  });

  it("accepts a second amount change that restarts the review", () => {
    expect(secondReview.review.endsAt).toBe("2026-09-21T00:00:00.000Z");
    expect(transition(firstReview, secondReview)().checkedFiles).toBe(1);
  });

  it("keeps the review of a decision that records only a reason", async () => {
    const reasonOnly = await review(
      firstReview,
      reduced,
      "2026-09-07T00:00:00Z",
      "Kept after a second look at the merged work.",
    );
    expect(reasonOnly.review).toEqual(firstReview.review);
    expect(transition(firstReview, reasonOnly)().checkedFiles).toBe(1);
  });

  it("refuses a second amount change that keeps the first review window", () => {
    expect(
      transition(firstReview, { ...secondReview, review: firstReview.review }),
    ).toThrow("must restart its public review");
  });

  it("refuses a change back to the generated amount that keeps the first review window", async () => {
    const restored = await review(
      firstReview,
      first.suggestedMinor,
      "2026-09-07T00:00:00Z",
    );
    expect(
      transition(firstReview, { ...restored, review: firstReview.review }),
    ).toThrow("must restart its public review");
  });

  it("refuses a restarted review that keeps the first deadline", () => {
    expect(
      transition(firstReview, {
        ...secondReview,
        review: {
          ...firstReview.review,
          lastMaterialChangeAt: secondReview.review.lastMaterialChangeAt,
        },
      }),
    ).toThrow("allocation review end must be 14 days after change");
  });
});
