/** Tests the Eliza review compatibility classifier with deterministic live-path fixtures. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessReviewCompatibility } from "../skills/contribute-to-eliza/scripts/review-preflight.mjs";

const branchSha = "1".repeat(40);
const commitId = "65455082b87f12ddf5ea4a40e4e8734dbae9e961";
const marker = {
  provider: "openai",
  model: "gpt-5.6-sol",
  client: "codex",
  skill_revision: `elizaOS/slopdotcash@${"2".repeat(40)}:skills/contribute-to-eliza`,
  run: {
    schema_version: "1",
    run_id: "run_01M001JJ3EJEXAR11GKPE15MXM",
    project: "eliza",
    repository: "elizaOS/eliza",
    signature_algorithm: "ed25519",
    device_public_key: "public-key",
    device_signature: "signature",
  },
};

function fixture() {
  return {
    branchSha,
    policy:
      "Every review ends with <!-- eliza-computer-attribution:v1 {...} -->",
    proofReview: {
      id: 4936838769,
      commit_id: commitId,
      html_url:
        "https://github.com/elizaOS/eliza/pull/19560#pullrequestreview-4936838769",
      submitted_at: "2026-08-14T11:48:42Z",
      state: "CHANGES_REQUESTED",
      body: `Verified review\n<!-- slop-contribution-attribution:v1 ${JSON.stringify(marker)} -->`,
    },
    validator: "const marker = 'eliza-computer-attribution:v1';",
    workflows: [
      {
        path: ".github/workflows/pr.yaml",
        source:
          "on:\n  pull_request:\nsteps:\n  - run: node scripts/check-agent-comment-attribution.mjs",
      },
      {
        path: ".github/workflows/claude.yml",
        source: "on:\n  pull_request_review:\nsteps:\n  - run: echo unrelated",
      },
    ],
  };
}

describe("Eliza review compatibility preflight", () => {
  it("reports documentation drift without inventing a publishing blocker", () => {
    const result = assessReviewCompatibility(fixture());
    assert.equal(result.status, "supported-with-documentation-drift");
    assert.equal(result.safeToPublish, true);
    assert.equal(result.documentation, "legacy-only-drift");
    assert.equal(result.enforcement, "not-wired-for-reviews");
    assert.equal(result.forwardProof.valid, true);
  });

  it("blocks when a review-event workflow invokes the incompatible validator", () => {
    const input = fixture();
    input.workflows.push({
      path: ".github/workflows/review-policy.yml",
      source:
        "on:\n  pull_request_review:\nsteps:\n  - run: node scripts/check-agent-comment-attribution.mjs",
    });
    const result = assessReviewCompatibility(input);
    assert.equal(result.status, "blocked");
    assert.equal(result.safeToPublish, false);
    assert.equal(result.enforcement, "incompatible");
    assert.deepEqual(result.enforcingWorkflows, [
      ".github/workflows/review-policy.yml",
    ]);
  });

  it("accepts explicit Slop-aware review enforcement", () => {
    const input = fixture();
    input.validator += "\nconst slop = 'slop-contribution-attribution:v1';";
    input.policy +=
      "\nSigned reviews may end with slop-contribution-attribution:v1.";
    input.workflows.push({
      path: ".github/workflows/review-policy.yml",
      source:
        "on:\n  pull_request_review:\nsteps:\n  - run: node scripts/check-agent-comment-attribution.mjs\n# slop-contribution-attribution:v1",
    });
    const result = assessReviewCompatibility(input);
    assert.equal(result.status, "supported");
    assert.equal(result.safeToPublish, true);
    assert.equal(result.documentation, "aligned");
    assert.equal(result.enforcement, "compatible");
  });

  it("fails closed when the known proof loses its terminal marker", () => {
    const input = fixture();
    input.proofReview.body += "\ntrailing prose";
    const result = assessReviewCompatibility(input);
    assert.equal(result.status, "unknown");
    assert.equal(result.safeToPublish, false);
    assert.equal(result.forwardProof.valid, false);
  });

  it("rejects unbounded or malformed workflow inventories", () => {
    const input = fixture();
    input.workflows = Array.from({ length: 129 }, (_, index) => ({
      path: `.github/workflows/${index}.yml`,
      source: "on: pull_request",
    }));
    assert.throws(
      () => assessReviewCompatibility(input),
      /workflow inventory is missing or unbounded/u,
    );
  });
});
