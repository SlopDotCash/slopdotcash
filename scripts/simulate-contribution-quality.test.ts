import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import {
  assertQualityEvidence,
  calculateQualityReview,
  qualityEvidenceBinding,
} from "../src/lib/contribution-quality";
import {
  assertFundingPreparation,
  createFundingReview,
} from "../src/lib/funding-review-data";

it("recalculates a bound proposal and rejects forged sources and output replacement", () => {
  const root = mkdtempSync(join(tmpdir(), "slop-quality-cli-"));
  try {
    const preparationPath = resolve("funding/preparations/eliza-2026-08.json");
    const evidencePath = resolve("funding/quality/eliza-2026-08.json");
    const preparation = assertFundingPreparation(
      JSON.parse(readFileSync(preparationPath, "utf8")),
    );
    const evidence = assertQualityEvidence(
      JSON.parse(readFileSync(evidencePath, "utf8")),
      preparation,
    );
    const capMinor = createFundingReview(preparation).capMinor;
    if (!capMinor) throw new Error("Fixture has no budget");
    const proposal = {
      schemaVersion: "1",
      kind: "contribution-quality-proposal",
      projectId: preparation.projectId,
      cycleId: preparation.cycleId,
      sourceSnapshotSha256: preparation.sourceSnapshotSha256,
      sourceQualityBinding: qualityEvidenceBinding(evidence),
      capMinor,
      paymentAuthorized: false,
      decisions: [],
      burdens: [],
    };
    const proposalPath = join(root, "proposal.json");
    const outputPath = join(root, "output.json");
    writeFileSync(proposalPath, JSON.stringify(proposal));
    const run = () =>
      spawnSync(
        "bun",
        [
          "scripts/simulate-contribution-quality.ts",
          preparationPath,
          evidencePath,
          proposalPath,
          outputPath,
        ],
        {
          encoding: "utf8",
          env: { PATH: process.env.PATH, HOME: process.env.HOME },
          timeout: 30_000,
        },
      );
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const bytes = readFileSync(outputPath, "utf8");
    const output = JSON.parse(bytes);
    const expected = calculateQualityReview(evidence, [], capMinor, []);
    expect(output.paymentAuthorized).toBe(false);
    expect(
      output.contributors.map(
        (row: { actor: { id: string }; proposedMinor: string }) => [
          row.actor.id,
          row.proposedMinor,
        ],
      ),
    ).toEqual(
      preparation.contributors.map((row) => [
        row.actor.id,
        expected.after.get(row.actor.id),
      ]),
    );
    expect(run().status).not.toBe(0);
    writeFileSync(
      proposalPath,
      JSON.stringify({ ...proposal, sourceSnapshotSha256: "f".repeat(64) }),
    );
    expect(run().stderr).toContain("Proposal does not match the exact source");
    expect(readFileSync(outputPath, "utf8")).toBe(bytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
