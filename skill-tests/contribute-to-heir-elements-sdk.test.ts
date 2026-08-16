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
const repositoryContract = join(
  contributorDir,
  "references",
  "repository-contract.md",
);
const evidenceRubric = join(
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

  it("adapts an inheritance-SDK mission instead of Eliza work criteria", () => {
    const source = readFileSync(contributorSkill, "utf8");
    const contract = readFileSync(repositoryContract, "utf8");
    const rubric = readFileSync(evidenceRubric, "utf8");

    assert.match(source, /intelligent inheritance applications/i);
    assert.match(source, /\*\*Harden\*\*/);
    assert.match(source, /\*\*Fix\*\*/);
    assert.match(source, /\*\*Prove\*\*/);
    assert.match(source, /\*\*Review\*\*/);
    assert.match(source, /heirlabs\/element-sdk/);
    assert.match(source, /origin\/main/);
    assert.match(contract, /Integration branch \| `main`/);
    assert.match(contract, /heirlabs\/element-sdk/);
    assert.match(contract, /no root `LICENSE` file/);
    assert.match(contract, /never\s+infer or claim license or copyright/i);
    assert.match(rubric, /ElementValidator|sandbox|permission/i);

    assert.doesNotMatch(source, /mission-ready/);
    assert.doesNotMatch(source, /Eliza Cloud/);
    assert.doesNotMatch(source, /elizaOS\/eliza/);
    assert.doesNotMatch(source, /Alberta Plan/);
    assert.doesNotMatch(source, /\bsorry\b|\badmit\b|axiom/i);
    assert.doesNotMatch(source, /review-preflight\.mjs/);
    assert.doesNotMatch(contract, /mission-ready/);
    assert.doesNotMatch(rubric, /Eliza app|Eliza Cloud/);
  });

  it("accepts only committed PRs that merge to main by awidearray", () => {
    const source = readFileSync(contributorSkill, "utf8");
    const contract = readFileSync(repositoryContract, "utf8");
    assert.match(source, /merges to `main` by\s+GitHub user `awidearray`/i);
    assert.match(source, /Never self-approve,\s+self-merge/);
    assert.match(contract, /merged only by `awidearray`/);
    assert.match(contract, /merges to `main` by\s+`awidearray`/);
  });

  it("requires authenticated atomic update and a signed usage receipt", () => {
    const source = readFileSync(contributorSkill, "utf8");
    assert.match(source, /authenticated installer/i);
    assert.match(source, /atomic no-op/i);
    assert.match(source, /updates only to GitHub-authorized bytes/i);
    assert.match(source, /run-receipt\.mjs preview/);
    assert.match(source, /run-receipt\.mjs doctor/);
    assert.match(source, /run-receipt\.mjs start/);
    assert.match(source, /run-receipt\.mjs finish/);
    assert.match(source, /--allow-local-usage/);
    assert.match(source, /--trajectory <path>/);
    assert.match(source, /device signature/i);
    assert.match(source, /Ed25519 device key/);
    assert.match(source, /signature proves byte\s+integrity/i);
  });

  it("allows every model and requires exact provider, model, and client", () => {
    const source = readFileSync(contributorSkill, "utf8");
    assert.match(source, /Any model and agent client may contribute/);
    assert.match(source, /Grok and Kimi/);
    assert.match(source, /exact provider, model, and client/);
    assert.match(source, /never infer or substitute/i);
    assert.match(source, /--provider openai --model gpt-5\.6-sol/);
    assert.match(source, /--client claude-code --provider anthropic/);
  });

  it("requires a permanent operator-only trace and forbids private material", () => {
    const source = readFileSync(contributorSkill, "utf8");
    assert.match(source, /permanent private\s+upload/);
    assert.match(source, /designated Slop operators/);
    assert.match(source, /GitHub receives only its SHA-256 digest/);
    assert.match(source, /If export,\s+upload, or finalization fails/);
    assert.match(source, /never contains a private key/i);
    assert.match(
      source,
      /never request, read, create, or handle a seed phrase/i,
    );
    assert.match(source, /Never grant\s+autonomous payout or ban authority/);
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
    assert.match(source, /"traceSha256":"LOWERCASE_TRACE_SHA256"/);
    assert.match(source, /If private trace upload and finalization fail/);
    assert.match(source, /merges to `main` by\s+`awidearray`/);
    assert.doesNotMatch(source, /private key|seed phrase/is);
    assert.doesNotMatch(source, /mission-ready|Eliza Cloud|elizaOS\/eliza/);
  });
});
