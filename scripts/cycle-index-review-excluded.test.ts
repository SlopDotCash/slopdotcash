/**
 * Copyright 2026 The Slop Authors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A creator may exclude a row during the 14-day public review
 * (cycles/README.md, "Review lapse"): "A creator may approve, hold, exclude,
 * reduce, or increase any row during the 14-day public review." The review
 * window is the period where `proposal.json` exists and `allocation.json` does
 * not, so the published cycle stays in `state: "review"`.
 *
 * The review-state guard previously admitted only proposed / unclaimed /
 * held-below-minimum / held rows, so one legally excluded row made
 * `cycles:check` fail and froze that cycle's CI and deployment.
 *
 * `public/data/cycles/index.json` is a build output and is not committed, so
 * this test exports the tracked tree, builds the index with the real sync
 * script, and then exercises both the validator and that script.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertCycleIndex, type CycleIndex } from "../src/lib/cycle-index";
import { fixtureCheckout } from "../tests/fixture-checkout";

const repositoryRoot = resolve(import.meta.dir, "..");
const syncScript = "scripts/sync-cycle-index.ts";

let workingCopy = "";
let published: CycleIndex;

/** Runs the repository's own sync script inside the scratch copy. */
function sync(args: string[] = [], cwd = workingCopy) {
  return spawnSync(process.execPath, [join(cwd, syncScript), ...args], {
    cwd,
    encoding: "utf8",
    // `bun` needs a writable temporary directory for its own runtime files.
    // It is set on the child only: mutating the parent environment would leak
    // into every other test file the runner loads.
    env: { ...process.env, TMPDIR: join(cwd, ".bun-tmp") },
  });
}
beforeAll(() => {
  // The frozen registry and history still hold a cycle inside its public
  // review window; the committed tree no longer lists any project.
  workingCopy = fixtureCheckout("cycle-index-review-");

  // Publish the artifact the site build consumes, inside the scratch copy.
  const generated = sync();
  expect(generated.status).toBe(0);

  published = JSON.parse(
    readFileSync(join(workingCopy, "public/data/cycles/index.json"), "utf8"),
  ) as CycleIndex;
  // The unmodified export must validate before any case mutates it.
  expect(() => assertCycleIndex(published)).not.toThrow();
}, 60_000);

afterAll(() => {
  if (workingCopy) rmSync(workingCopy, { recursive: true, force: true });
});

/** A fresh deep copy so each case starts from the published bytes. */
const fixture = (): CycleIndex =>
  JSON.parse(JSON.stringify(published)) as CycleIndex;

/** The first published cycle that is still inside its public review window. */
function reviewCycle(value: CycleIndex): CycleIndex["cycles"][number] {
  const cycle = value.cycles.find((entry) => entry.state === "review");
  expect(cycle).toBeDefined();
  // A review cycle has no allocation yet: that absence is what derives the
  // state, so it is also what makes the excluded row a review-window state.
  expect(cycle?.files.allocation).toBeNull();
  expect(cycle?.reward.approvedMinor).toBe("0");
  return cycle as CycleIndex["cycles"][number];
}

/** An unclaimed, unfunded row: the legal shape a creator may exclude. */
function unclaimedRow(cycle: CycleIndex["cycles"][number]) {
  const row = cycle.contributors.find(
    (contributor) => contributor.state === "unclaimed",
  );
  expect(row).toBeDefined();
  expect(row?.approvedMinor).toBe("0");
  expect(row?.paidMinor).toBe("0");
  return row as CycleIndex["cycles"][number]["contributors"][number];
}

/** Rewrites one row's state in the scratch copy's real `proposal.json`. */
function excludeRowOnDisk(target: string, login: string) {
  const proposal = JSON.parse(readFileSync(target, "utf8")) as {
    allocations: { actor: { login: string }; state: string }[];
  };
  const allocation = proposal.allocations.find(
    (candidate) => candidate.actor.login === login,
  );
  if (!allocation) throw new Error(`${login} is not a row of ${target}`);
  allocation.state = "excluded";
  writeFileSync(target, `${JSON.stringify(proposal, null, 2)}\n`);
}

/**
 * Finds a review-window row whose exclusion the review state guard alone can
 * refuse.
 *
 * The row must be unfunded, unclaimed, and carry no adjustment reason: a row
 * that already has a reason, a settled amount, or a non-zero approval is
 * rejected by an earlier, unrelated check, so excluding it would fail the
 * surrounding assertions for the wrong reason and would not exercise the guard
 * this change modifies. The candidate is confirmed by excluding it in a
 * throwaway copy of the whole tree and requiring that the only refusal is the
 * review state mismatch.
 */
function findExcludableRow(): { target: string; login: string } | null {
  const candidates: {
    target: string;
    login: string;
    projectId: string;
    cycleId: string;
  }[] = [];
  for (const cycle of published.cycles) {
    if (cycle.state !== "review") continue;
    const target = join(
      workingCopy,
      "cycles",
      cycle.projectId,
      cycle.cycleId,
      "proposal.json",
    );
    let proposal: {
      allocations: {
        actor: { login: string };
        state: string;
        approvedMinor?: string;
        paidMinor?: string;
        adjustmentReason?: string | null;
        wallet?: unknown;
      }[];
    };
    try {
      proposal = JSON.parse(readFileSync(target, "utf8"));
    } catch {
      continue;
    }
    for (const allocation of proposal.allocations) {
      if (allocation.state !== "unclaimed") continue;
      if (allocation.approvedMinor !== "0") continue;
      if (allocation.adjustmentReason) continue;
      if (allocation.wallet) continue;
      candidates.push({
        target,
        login: allocation.actor.login,
        projectId: cycle.projectId,
        cycleId: cycle.cycleId,
      });
    }
  }
  // Prefer the row the guard rejects with a review state mismatch. Excluding a
  // row can also fail the frozen-snapshot baseline check, which is a different
  // defect, so the candidate is verified rather than assumed: the pre-change
  // guard is reconstructed by dropping the clause this change adds, because
  // the fixed guard accepts every excluded row and so cannot discriminate
  // between the two failures.
  const current = readFileSync(
    join(repositoryRoot, "src/lib/cycle-index.ts"),
    "utf8",
  );
  const preChange = current.replace(
    /\s*&&\s*\/\/ A creator may exclude a row[\s\S]*?contributor\.state !== "excluded",/u,
    "",
  );
  if (preChange === current) return null;
  for (const candidate of candidates) {
    const probe = fixtureCheckout("cycle-index-review-");
    writeFileSync(join(probe, "src/lib/cycle-index.ts"), preChange);
    excludeRowOnDisk(
      join(
        probe,
        "cycles",
        candidate.projectId,
        candidate.cycleId,
        "proposal.json",
      ),
      candidate.login,
    );
    const result = sync(["--check"], probe);
    rmSync(probe, { recursive: true, force: true });
    if (result.stderr.includes("does not match its immutable files")) {
      return { target: candidate.target, login: candidate.login };
    }
  }
  return null;
}

describe("cycle index review window", () => {
  test("an excluded row keeps the cycle in its review window", () => {
    const value = fixture();
    const row = unclaimedRow(reviewCycle(value));
    row.state = "excluded";
    // An excluded row carries no wallet and no approved amount.
    row.wallet = null;
    row.approvedMinor = "0";
    row.paidMinor = "0";

    expect(() => assertCycleIndex(value)).not.toThrow();
  });

  test("an excluded row still fails once the cycle is funded outside review", () => {
    const value = fixture();
    const cycle = reviewCycle(value);
    const row = unclaimedRow(cycle);
    row.state = "excluded";
    row.wallet = null;
    // Review state requires an unfunded cycle, so an approved cycle total is
    // immutable evidence that the cycle left review. A creator must not be
    // able to hide that behind an excluded row. That total is caught before
    // the review-state guard by the reward reconciliation, which is part of
    // the same fail-closed contract.
    cycle.reward.approvedMinor = "1000000";

    expect(() => assertCycleIndex(value)).toThrow(
      /reward money totals do not reconcile/,
    );
  });

  test("a paid row is still rejected inside the review window", () => {
    const value = fixture();
    const row = unclaimedRow(reviewCycle(value));
    row.state = "paid";

    expect(() => assertCycleIndex(value)).toThrow(
      /wallet contradicts its state/,
    );
  });

  test("the sync script accepts an excluded row end to end", () => {
    // Proves the guard change through the same entry point CI runs, not only
    // through the in-process validator. The row is selected so the review state
    // guard is the only gate it can trip: a row that already carries an
    // adjustment reason is refused earlier by an unrelated check, which would
    // make this test pass whether or not the guard admits `excluded`.
    expect(sync(["--check"]).status).toBe(0);

    const candidate = findExcludableRow();
    if (!candidate) throw new Error("no review row isolates the state guard");
    excludeRowOnDisk(candidate.target, candidate.login);
    expect(readFileSync(candidate.target, "utf8")).toContain('"excluded"');

    const result = sync(["--check"]);
    expect(result.stderr).not.toContain("refused");
    expect(result.stdout).toContain("validated");
    expect(result.status).toBe(0);
  }, 60_000);
});
