/**
 * Copyright 2026 The Slop Authors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A wallet claim records only the authenticated account's statement of an
 * address (PRD section 3, "Wallet registration and recovery": "Bind a wallet
 * with both authenticated account evidence and the destination wallet's
 * signature. Neither proof establishes the other identity."). A claim proof
 * used as a cycle-index wallet proof must therefore reference the
 * destination's possession attestation (`sourceAttestationSha256`, the
 * digest published by the claim's public possession view); a proof without
 * it is rejected at every layer that accepts the proof form.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertCycleIndex, type CycleIndex } from "../src/lib/cycle-index";
import { assertFundingPreparation } from "../src/lib/funding-review-data";
import { assertRewardAllocationManifest } from "../src/lib/rewards";
import { fixtureCheckout } from "../tests/fixture-checkout";

const repositoryRoot = resolve(import.meta.dir, "..");

/** Deep copy without the attestation reference on every claim proof. */
function withoutAttestation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAttestation);
  if (value !== null && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key !== "sourceAttestationSha256")
        copy[key] = withoutAttestation(entry);
    }
    return copy;
  }
  return value;
}

function readFixture(relative: string): unknown {
  return JSON.parse(
    readFileSync(join(repositoryRoot, relative), "utf8"),
  ) as unknown;
}

describe("wallet claim proofs require a possession attestation", () => {
  test("allocation manifest rejects a claim proof without attestation", () => {
    const proposal = readFixture(
      "tests/fixtures/history/cycles/asi/2026-09/proposal.json",
    );
    expect(() => assertRewardAllocationManifest(proposal)).not.toThrow();
    expect(() =>
      assertRewardAllocationManifest(withoutAttestation(proposal)),
    ).toThrow(/unexpected or missing fields/u);
  });

  test("funding preparation rejects a claim proof without attestation", () => {
    const preparation = readFixture(
      "tests/fixtures/history/funding/preparations/asi-2026-08.json",
    );
    expect(() => assertFundingPreparation(preparation)).not.toThrow();
    expect(() =>
      assertFundingPreparation(withoutAttestation(preparation)),
    ).toThrow(/sourceAttestationSha256/u);
  });

  test("cycle index rejects a claim proof without attestation", () => {
    const workingCopy = fixtureCheckout("wallet-claim-attestation-");
    try {
      const generated = spawnSync(
        process.execPath,
        [join(workingCopy, "scripts/sync-cycle-index.ts")],
        {
          cwd: workingCopy,
          encoding: "utf8",
          env: { ...process.env, TMPDIR: join(workingCopy, ".bun-tmp") },
        },
      );
      expect(generated.status).toBe(0);
      const published = JSON.parse(
        readFileSync(
          join(workingCopy, "public/data/cycles/index.json"),
          "utf8",
        ),
      ) as CycleIndex;
      const claimWallets = published.cycles.flatMap((cycle) =>
        cycle.contributors.filter(
          (contributor) =>
            contributor.wallet && "sourceClaimId" in contributor.wallet,
        ),
      );
      expect(claimWallets.length).toBeGreaterThan(0);
      expect(() => assertCycleIndex(published)).not.toThrow();
      expect(() => assertCycleIndex(withoutAttestation(published))).toThrow(
        /unexpected or missing fields/u,
      );
    } finally {
      rmSync(workingCopy, { recursive: true, force: true });
    }
  }, 60_000);
});
