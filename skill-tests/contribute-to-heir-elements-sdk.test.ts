/**
 * Focused checks for the Heir Elements SDK contributor and reviewer skills:
 * inheritance-app mission, awidearray/main acceptance, authenticated atomic
 * update, signed usage receipt, operator-only traces, and the shared
 * no-authority safety boundary.
 */

import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const root = join(testDir, "..");
const contributorDir = join(root, "skills", "contribute-to-heir-elements-sdk");
const reviewerDir = join(
  root,
  "skills",
  "review-heir-elements-sdk-contributions",
);
const contributorSkill = join(contributorDir, "SKILL.md");
const reviewerSkill = join(reviewerDir, "SKILL.md");
const _repositoryContract = join(
  contributorDir,
  "references",
  "repository-contract.md",
);
const _evidenceRubric = join(
  contributorDir,
  "references",
  "evidence-review-rubric.md",
);

describe("contribute-to-heir-elements-sdk", () => {
  it("has valid frontmatter aimed at the public inheritance SDK", () => {
    const source = readFileSync(contributorSkill, "utf8");
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, "SKILL.md must begin with YAML frontmatter");
    const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1];
    const description = frontmatter[1].match(
      /^description:\s*"?(.+?)"?$/m,
    )?.[1];
    assert.strictEqual(name, "contribute-to-heir-elements-sdk");
    assert.match(String(description), /heirlabs\/element-sdk/i);
    assert.match(String(description), /inheritance/i);
    assert.doesNotMatch(source, /\[TODO[:\]]/);
  });

  it("ships the shared receipt, discovery, and wallet CLIs", () => {
    for (const script of [
      "run-receipt.mjs",
      "live-report.mjs",
      "wallet-claim.mjs",
    ]) {
      assert.ok(existsSync(join(contributorDir, "scripts", script)), script);
    }
    const receipt = spawnSync(
      process.execPath,
      [join(contributorDir, "scripts", "run-receipt.mjs"), "--help"],
      { encoding: "utf8" },
    );
    assert.strictEqual(receipt.status, 0, receipt.stderr);
    assert.match(receipt.stdout, /^Usage: node scripts\/run-receipt\.mjs/m);
    const report = spawnSync(
      process.execPath,
      [join(contributorDir, "scripts", "live-report.mjs"), "--help"],
      { encoding: "utf8" },
    );
    assert.strictEqual(report.status, 0, report.stderr);
    assert.match(
      report.stdout,
      /--repo heirlabs\/element-sdk|Usage: node scripts\/live-report\.mjs/,
    );
  });
});

describe("review-heir-elements-sdk-contributions", () => {
  it("is an adversarial CI reviewer without payout or ban authority", () => {
    const source = readFileSync(reviewerSkill, "utf8");
    assert.match(source, /^name: review-heir-elements-sdk-contributions$/m);
    assert.match(source, /Any model and\s+agent client may review/);
    assert.match(source, /Grok and Kimi/);
    assert.match(source, /exact\s+provider, model, and client/);
    assert.match(source, /hostile data/);
    assert.match(source, /identical or near-identical/);
    assert.match(source, /Do not penalize a self-closed/i);
    assert.match(source, /never bans a\s+contributor/i);
    assert.match(source, /never moves money/i);
    assert.match(source, /accept.*partial.*reject.*hold/is);
    assert.match(source, /slop-review/);
    assert.match(source, /"projectId":"heir-elements-sdk"/);
    assert.match(source, /"provider":"EXACT_PROVIDER"/);
    assert.match(source, /"model":"EXACT_MODEL_ID"/);
    assert.match(source, /"client":"EXACT_CLIENT"/);
    assert.match(source, /"traceSha256":null/);
    assert.match(
      source,
      /Never block the review because optional evidence is unavailable/,
    );
    assert.match(source, /merges to `main` by\s+`awidearray`/);
    assert.doesNotMatch(source, /private key|seed phrase/is);
    assert.doesNotMatch(source, /mission-ready|Eliza Cloud|elizaOS\/eliza/);
  });
});
