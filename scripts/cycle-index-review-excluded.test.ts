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
 * this test copies the current working tree, builds the index with the real
 * sync script, and validates the changed historical record.
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

    const result = sync(["--check"]);
    expect(result.status).toBe(0);
  }, 60_000);
});
