/**
 * Validates both project skills and the shared measured-run implementation,
 * including project filtering, conservative confidence, monotonic deltas, and
 * terminal marker serialization without invoking local usage tools.
 */

import assert from "node:assert";
import { spawnSync } from "node:child_process";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { declaredIdentity as asiDeclaredIdentity } from "../skills/contribute-to-asi/scripts/run-receipt.mjs";
import {
  completedIdentityIsValid as deltaCompletedIdentityIsValid,
  declaredIdentity as deltaDeclaredIdentity,
} from "../skills/contribute-to-delta-star/scripts/run-receipt.mjs";
import {
  disclosePrivateTrace,
  declaredIdentity as elizaDeclaredIdentity,
  footer,
  normalizeSessionReport,
  signingPayload,
  slopIdentityAssertion,
  uploadPrivateTrace,
  usageDelta,
} from "../skills/contribute-to-eliza/scripts/run-receipt.mjs";
import { registerWalletClaim } from "../skills/contribute-to-eliza/scripts/wallet-claim.mjs";
import { declaredIdentity as heirElementsDeclaredIdentity } from "../skills/contribute-to-heir-elements-sdk/scripts/run-receipt.mjs";
import { assessModelAttribution } from "../src/lib/leaderboard";
import { MODEL_IDENTITY_CONFORMANCE_CASES } from "../src/lib/model-identity-corpus";
import { PROJECTS } from "../src/lib/projects.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const projectPackages = PROJECTS.map((project) => ({
  project,
  contributorRoot: join(root, project.skill.sourcePath),
  reviewerRoot: join(root, project.reviewSkill.sourcePath),
}));

describe("project skill contracts", () => {
  it("keeps every packaged CLI aligned with the shared identity corpus", () => {
    for (const validate of [
      elizaDeclaredIdentity,
      asiDeclaredIdentity,
      deltaDeclaredIdentity,
      heirElementsDeclaredIdentity,
    ]) {
      for (const { field, value, valid } of MODEL_IDENTITY_CONFORMANCE_CASES) {
        const attempt = () => validate(value, field, field, 128);
        if (valid) assert.strictEqual(attempt(), value);
        else assert.throws(attempt, /identifier/u);
      }
    }
  });

  it("keeps every registered contributor package focused and open to declared models", () => {
    for (const { project, contributorRoot } of projectPackages) {
      const source = readFileSync(join(contributorRoot, "SKILL.md"), "utf8");
      const name = project.skill.id;
      assert.match(source, new RegExp(`^name: ${name}$`, "m"));
      assert.doesNotMatch(source, /\[TODO[:\]]/u);
      assert.match(source, /Any model and agent client may contribute/u);
      assert.match(source, /Grok and Kimi/u);
      assert.match(source, /run-receipt\.mjs start/u);
      assert.match(source, /run-receipt\.mjs finish/u);
      assert.match(source, /run-receipt\.mjs preview/u);
      assert.match(source, /run-receipt\.mjs doctor/u);
      assert.match(source, /--allow-local-usage/u);
      assert.match(source, /--usage-unavailable/u);
      assert.match(
        source,
        /invokes no package manager.*reads no usage logs.*usage evidence is diagnostic.*never changes score/is,
      );
      assert.match(source, /--trajectory <path>/u);
      assert.match(source, /permanent\s+private\s+upload/u);
      assert.match(
        source,
        /https:\/\/slop\.cash\/protocol\/private-trace-v1\.md/u,
      );
      assert.match(source, /SlopDotCash\/slopdotcash/u);
      assert.match(source, /gh auth status --hostname github\.com/u);
      assert.match(source, /gh api user --jq '\.login'/u);
      assert.match(source, /upstream\s+permission/is);
      assert.match(source, /stars are\s+optional/u);
      if (project.reward.kind === "monthly-pool") {
        assert.match(source, /explicit approval before registration/is);
      }
      assert.match(source, /live-report\.mjs --repo/u);
      assert.match(source, /token.*never earns|receipt cannot create score/is);
      assert.match(source, /untrusted/u);
      assert.match(source, /disposable.*sandbox/is);
      assert.match(source, /Never self-approve|Leave acceptance and merge/is);
    }
    const eliza = readFileSync(
      join(root, "skills", "contribute-to-eliza", "SKILL.md"),
      "utf8",
    );
    const delta = readFileSync(
      join(root, "skills", "contribute-to-delta-star", "SKILL.md"),
      "utf8",
    );
    const asi = readFileSync(
      join(root, "skills", "contribute-to-asi", "SKILL.md"),
      "utf8",
    );
    const asiReview = readFileSync(
      join(root, "skills", "review-asi-contributions", "SKILL.md"),
      "utf8",
    );
    const deltaReview = readFileSync(
      join(root, "skills", "review-delta-star-contributions", "SKILL.md"),
      "utf8",
    );
    assert.match(eliza, /elizaOS\/eliza/u);
    assert.match(eliza, /review-preflight\.mjs/u);
    assert.match(eliza, /supported-with-documentation-drift/u);
    assert.doesNotMatch(eliza, /lalalune\/ArkLib/u);
    assert.match(asi, /SlopDotCash\/asi/u);
    assert.match(delta, /SlopDotCash\/proximityprize/u);
    assert.match(asiReview, /github\.com\/SlopDotCash\/asi\/pull\/NUMBER/u);
    assert.match(
      deltaReview,
      /github\.com\/SlopDotCash\/proximityprize\/pull\/NUMBER/u,
    );
    assert.doesNotMatch(delta, /lalalune\/ArkLib/u);
    assert.match(delta, /sorry.*admit.*axiom/is);
    assert.match(delta, /external Proximity Prize/u);
    assert.match(delta, /does not.*guarantee.*dollar/is);
  });

  it("clears PRs, issues, and workflows before new work", {
    timeout: 30_000,
  }, () => {
    for (const { project, contributorRoot, reviewerRoot } of projectPackages) {
      const contributor = readFileSync(
        join(contributorRoot, "SKILL.md"),
        "utf8",
      );
      const reviewer = readFileSync(join(reviewerRoot, "SKILL.md"), "utf8");
      const contributorLauncher = readFileSync(
        join(contributorRoot, "agents", "openai.yaml"),
        "utf8",
      );
      const reviewerLauncher = readFileSync(
        join(reviewerRoot, "agents", "openai.yaml"),
        "utf8",
      );
      const issuePriority = contributor.search(
        /finish every existing issue without a PR|finish the oldest[\s\S]{0,220}open issue/iu,
      );
      const reviewPriority = contributor.search(
        /review and test every current PR/iu,
      );
      const workflowPriority = contributor.search(
        /restore (?:`develop`|integration-branch) workflow health|inspect every required GitHub Actions\s+workflow/iu,
      );

      assert.ok(
        reviewPriority >= 0,
        `${project.skill.id} must prioritize current-head PR review`,
      );
      assert.ok(
        issuePriority > reviewPriority,
        `${project.skill.id} must place uncovered issues after PR review`,
      );
      assert.ok(
        workflowPriority > issuePriority,
        `${project.skill.id} must place workflow repair after the issue queue`,
      );
      assert.match(
        contributor,
        /\*\*merge\*\*, \*\*fix\*\*, or \*\*close\*\*/iu,
      );
      assert.match(contributor, /exact current head|exact-head/iu);
      assert.match(contributor, /--epoch-only/u);
      assert.match(contributor, /--complete-epoch/u);
      assert.match(contributor, /recommendationUrl/u);
      const newIssueGate = contributor.search(
        /(?:a new (?:issue|one)\s+requires|open a new\s+issue only)/iu,
      );
      assert.ok(newIssueGate >= 0);
      const gateText = contributor.slice(newIssueGate, newIssueGate + 900);
      assert.match(gateText, /every current PR/iu);
      assert.match(gateText, /every existing\s+issue/iu);
      assert.match(
        gateText,
        /workflow[\s\S]{0,100}green[\s\S]{0,100}current\s+integration head/iu,
      );
      assert.match(
        gateText,
        /external[\s\S]{0,80}blocker\s+keeps[\s\S]{0,80}gate closed/iu,
      );
      assert.match(
        contributor,
        /trivial fixes|trivial work|trivial requests/iu,
      );
      assert.match(
        contributor,
        /generic ["-]?improvements?|generic-improvement/iu,
      );
      assert.match(reviewer, /recommend `reject`[\s\S]{0,220}trivial/iu);
      assert.match(
        reviewer,
        /tests with no\s+demonstrated\s+behavioral risk|tests that prove no meaningful/iu,
      );
      assert.match(reviewer, /## Clear the review queue first/iu);
      assert.match(reviewer, /\*\*merge\*\*, \*\*fix\*\*, or \*\*close\*\*/iu);
      assert.match(
        reviewer,
        /Do not open new issues[\s\S]{0,320}reviewable PR remains[\s\S]{0,320}existing issue lacks a PR[\s\S]{0,320}workflow/iu,
      );
      assert.match(
        contributorLauncher,
        /review and test every current PR first[\s\S]*existing issues through PRs second[\s\S]*workflows third/iu,
      );
      assert.match(reviewerLauncher, /current-head PR reviews first/iu);
      assert.match(reviewerLauncher, /merge, fix, or close recommendation/iu);
    }

    const asi = readFileSync(
      join(root, "skills", "contribute-to-asi", "SKILL.md"),
      "utf8",
    );
    const asiReview = readFileSync(
      join(root, "skills", "review-asi-contributions", "SKILL.md"),
      "utf8",
    );
    assert.match(
      asi,
      /benchmark hill climb[\s\S]*measured port or decisive experimental[\s\S]*actual reproduced/iu,
    );
    assert.match(asi, /Do not make random\s+improvements/iu);
    assert.match(
      asi,
      /test that merely looks weak, stale, or flaky is\s+not enough without a reproduced behavioral failure/iu,
    );
    assert.match(
      asiReview,
      /reproducible benchmark hill climb[\s\S]*actual reproduced/iu,
    );
  });

  it("ships byte-identical receipt logic with policy derived from the project inventory", () => {
    const [canonicalPackage] = projectPackages;
    const receiptSource = readFileSync(
      join(canonicalPackage.contributorRoot, "scripts", "run-receipt.mjs"),
      "utf8",
    );
    const liveReportSource = readFileSync(
      join(canonicalPackage.contributorRoot, "scripts", "live-report.mjs"),
      "utf8",
    );
    const termsPreflightSource = readFileSync(
      join(canonicalPackage.contributorRoot, "scripts", "terms-preflight.mjs"),
      "utf8",
    );
    for (const { project, contributorRoot } of projectPackages) {
      assert.strictEqual(
        readFileSync(
          join(contributorRoot, "scripts", "run-receipt.mjs"),
          "utf8",
        ),
        receiptSource,
        `${project.skill.id} receipt logic drifted`,
      );
      assert.strictEqual(
        readFileSync(
          join(contributorRoot, "scripts", "terms-preflight.mjs"),
          "utf8",
        ),
        termsPreflightSource,
        `${project.skill.id} terms preflight drifted`,
      );
      assert.strictEqual(
        readFileSync(
          join(contributorRoot, "scripts", "live-report.mjs"),
          "utf8",
        ),
        liveReportSource,
        `${project.skill.id} discovery logic drifted`,
      );
      assert.match(
        liveReportSource,
        /readProjectSelectionPolicy\(\)\.repositoryId/u,
      );
      assert.doesNotMatch(
        liveReportSource,
        /defaultRepository\s*=\s*"elizaOS\/eliza"/u,
      );
      const skillProject = JSON.parse(
        readFileSync(join(contributorRoot, "project.json"), "utf8"),
      );
      assert.strictEqual(skillProject.projectId, project.id);
      assert.strictEqual(
        skillProject.repositoryId,
        new URL(project.repositories[0].githubUrl).pathname.replace(/^\//u, ""),
      );
      assert.strictEqual(skillProject.skillName, project.skill.id);
      assert.strictEqual(skillProject.policyAuthority, "https://slop.cash");
      if (project.id === "eliza") {
        assert.deepStrictEqual(skillProject.selection, {
          eligibleIssueLabels: ["mission-ready"],
        });
      } else {
        assert.strictEqual(skillProject.selection, undefined);
      }
      assert.strictEqual(
        skillProject.skillSourcePath,
        project.skill.sourcePath,
      );
      assert.deepStrictEqual(skillProject.usageAdapters, {
        codex: "codex",
        "claude-code": "claude",
        "grok-build": "grok",
      });
      assert.deepStrictEqual(project.modelPolicy, {
        mode: "open-declared",
        disclosureRequired: true,
      });
    }
    assert.match(receiptSource, /isSymbolicLink\(\)/u);
    assert.match(
      receiptSource,
      /refusing a non-regular or symlinked device key/u,
    );
  });

  it("accepts the transferred canonical repository as bundled skill provenance", () => {
    const [canonicalPackage] = projectPackages;
    const receiptSource = readFileSync(
      join(canonicalPackage.contributorRoot, "scripts", "run-receipt.mjs"),
      "utf8",
    );
    for (const remote of [
      "https://github.com/elizaos/army",
      "https://github.com/elizaos/slopdotcash",
      "https://github.com/slopdotcash/slopdotcash",
    ]) {
      assert.ok(
        receiptSource.includes(`"${remote}",`),
        `bundled-source provenance must accept ${remote}`,
      );
    }
  });

  it("accepts only exact signed Delta Star migration-era receipt identities", () => {
    const sha = "a".repeat(40);
    for (const [repositoryId, skillRepository] of [
      ["lalalune/arklib", "elizaOS/army"],
      ["lalalune/arklib", "elizaOS/slopdotcash"],
      ["elizaOS/proximityprize", "elizaOS/slopdotcash"],
    ]) {
      assert.strictEqual(
        deltaCompletedIdentityIsValid(
          {
            repositoryId,
            schemaVersion: "1",
            skillRevision: `${skillRepository}@${sha}:skills/contribute-to-delta-star`,
          },
          true,
        ),
        true,
      );
    }
    assert.strictEqual(
      deltaCompletedIdentityIsValid(
        {
          repositoryId: "lalalune/arklib",
          schemaVersion: "1",
          skillRevision: `attacker/slopdotcash@${sha}:skills/contribute-to-delta-star`,
        },
        true,
      ),
      false,
    );
    assert.strictEqual(
      deltaCompletedIdentityIsValid(
        {
          repositoryId: "lalalune/arklib",
          schemaVersion: "2",
          skillRevision: `elizaOS/slopdotcash@${sha}:skills/contribute-to-delta-star`,
        },
        true,
      ),
      false,
    );
    assert.strictEqual(
      deltaCompletedIdentityIsValid(
        {
          repositoryId: "elizaOS/proximityprize",
          schemaVersion: "1",
          skillRevision: `elizaOS/slopdotcash@${sha}:skills/contribute-to-delta-star`,
        },
        false,
      ),
      false,
    );
  });

  it("renders the same bounded payout claim for every monthly pool skill", () => {
    const monthlyPackages = projectPackages.filter(
      ({ project }) => project.reward.kind === "monthly-pool",
    );
    assert.strictEqual(monthlyPackages.length, 3);
    const [canonicalPackage] = monthlyPackages;
    const canonicalSource = readFileSync(
      join(canonicalPackage.contributorRoot, "scripts", "wallet-claim.mjs"),
      "utf8",
    );
    for (const { project, contributorRoot } of monthlyPackages) {
      const script = join(contributorRoot, "scripts", "wallet-claim.mjs");
      assert.strictEqual(
        readFileSync(script, "utf8"),
        canonicalSource,
        `${project.skill.id} wallet claim logic drifted`,
      );
      const result = spawnSync(
        process.execPath,
        [script, "--address", "11111111111111111111111111111111"],
        { encoding: "utf8" },
      );
      assert.strictEqual(result.status, 0, result.stderr);
      const plan = JSON.parse(result.stdout);
      assert.deepStrictEqual(plan, {
        action: "register-wallet",
        address: "11111111111111111111111111111111",
        authority: "https://api.slop.cash/api/v1/wallet-claims",
        authentication: "one-time-github-oauth",
        storage: "append-only-d1",
        writes: false,
      });
      const authority = new URL(plan.authority);
      assert.strictEqual(
        `${authority.origin}${authority.pathname}`,
        "https://api.slop.cash/api/v1/wallet-claims",
      );
    }
    const invalid = spawnSync(
      process.execPath,
      [
        join(canonicalPackage.contributorRoot, "scripts", "wallet-claim.mjs"),
        "--address",
        "not-a-wallet",
      ],
      { encoding: "utf8" },
    );
    assert.notStrictEqual(invalid.status, 0);
    assert.match(invalid.stderr, /refused.*canonical 32-byte Solana/u);
  });

  it("registers a wallet only after one-time identity authentication", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const responses = [
      Response.json({
        expiresAt: "2026-08-15T00:10:00.000Z",
        token: "private_test_bearer_token_value",
        tokenType: "Bearer",
      }),
      Response.json({ error: "not_found" }, { status: 404 }),
      Response.json(
        {
          schemaVersion: 1,
          claimId: "wallet_claim_01",
          githubActorId: "123456",
          githubLogin: "octocat",
          address: "11111111111111111111111111111111",
          source: "d1_registry",
          issueRepository: null,
          issueNumber: null,
          sourceBodySha256: "a".repeat(64),
          observedAt: "2026-08-15T00:00:00.000Z",
          recordDigest: "b".repeat(64),
          supersedesClaimId: null,
        },
        { status: 201 },
      ),
    ];
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      const response = responses.shift();
      assert.ok(response);
      return response;
    };
    const registered = await registerWalletClaim(
      "11111111111111111111111111111111",
      {
        fetch: fetchMock,
        assertionProvider: async () => "one_time_identity_assertion_value",
      },
    );
    assert.strictEqual(registered.claimId, "wallet_claim_01");
    assert.deepStrictEqual(
      calls.map(({ input }) => input),
      [
        "https://api.slop.cash/api/v1/auth/session",
        "https://api.slop.cash/api/v1/wallet-claims/current",
        "https://api.slop.cash/api/v1/wallet-claims",
      ],
    );
    assert.match(
      String(calls[1].init?.headers && Object.values(calls[1].init.headers)[0]),
      /^Bearer private_test_/u,
    );
  });

  it("rejects invalid wallet addresses before authentication or network access", async () => {
    let called = false;
    await assert.rejects(
      registerWalletClaim("not-a-wallet", {
        fetch: async () => {
          called = true;
          throw new Error("unexpected network access");
        },
        assertionProvider: async () => {
          called = true;
          return "unexpected assertion";
        },
      }),
      /canonical 32-byte Solana/u,
    );
    assert.strictEqual(called, false);
  });

  it("cancels oversized wallet responses before parsing them", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(40 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    await assert.rejects(
      registerWalletClaim("11111111111111111111111111111111", {
        fetch: async () => new Response(body),
        assertionProvider: async () => "one_time_identity_assertion_value",
      }),
      /response exceeded its bound/u,
    );
    assert.strictEqual(cancelled, true);
  });

  it("keeps every registered review skill hostile-input aware and non-punitive", () => {
    for (const { project, reviewerRoot } of projectPackages) {
      const name = project.reviewSkill.id;
      const source = readFileSync(join(reviewerRoot, "SKILL.md"), "utf8");
      assert.match(source, new RegExp(`^name: ${name}$`, "m"));
      assert.match(source, /Any model and\s+agent client may review/u);
      assert.match(source, /Grok and Kimi/u);
      assert.match(source, /exact\s+provider,\s+model, and client/u);
      assert.match(source, /hostile data/u);
      assert.match(source, /identical or near-identical/u);
      assert.match(source, /Do not penalize.*self-closed/is);
      assert.match(source, /never bans|never\n+bans/is);
      assert.match(source, /accept.*partial.*reject.*hold/is);
      assert.match(source, /slop-review/u);
      assert.match(source, /"provider":"EXACT_PROVIDER"/u);
      assert.match(source, /"model":"EXACT_MODEL_ID"/u);
      assert.match(source, /"client":"EXACT_CLIENT"/u);
      assert.match(source, /"traceSha256":"LOWERCASE_TRACE_SHA256"/u);
      assert.match(source, /If private trace upload and finalization fail/u);
      assert.doesNotMatch(source, /private key|seed phrase/is);
    }
  });

  it("executes every contributor CLI through an installed-style skill symlink", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "slop-installed-skills-"));
    try {
      const skillsRoot = join(fixtureRoot, "skills");
      mkdirSync(skillsRoot);
      for (const { project, contributorRoot } of projectPackages) {
        const installedSkill = join(skillsRoot, project.skill.id);
        symlinkSync(contributorRoot, installedSkill);
        const result = spawnSync(
          process.execPath,
          [join(installedSkill, "scripts", "run-receipt.mjs"), "--help"],
          { encoding: "utf8" },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(
          result.stdout,
          /^Usage: node scripts\/run-receipt\.mjs/m,
          project.skill.id,
        );
        assert.match(result.stdout, /preview[\s\S]+doctor[\s\S]+status/u);
        assert.match(result.stdout, /--usage-unavailable/u);
        assert.match(
          result.stdout,
          /exactly one:[\s\S]+--allow-package-execution[\s\S]+--usage-unavailable/u,
        );
        assert.match(
          result.stdout,
          /signed zero-usage receipt; usage never affects scoring/u,
        );
        const reportResult = spawnSync(
          process.execPath,
          [join(installedSkill, "scripts", "live-report.mjs"), "--help"],
          { encoding: "utf8" },
        );
        assert.strictEqual(reportResult.status, 0, reportResult.stderr);
        assert.match(
          reportResult.stdout,
          /^Usage: node scripts\/live-report\.mjs/m,
        );
        if (project.id === "eliza") {
          const preflightResult = spawnSync(
            process.execPath,
            [
              join(installedSkill, "scripts", "review-preflight.mjs"),
              "--unsupported",
            ],
            { encoding: "utf8" },
          );
          assert.notStrictEqual(preflightResult.status, 0);
          assert.match(
            preflightResult.stderr,
            /Usage: node scripts\/review-preflight\.mjs/u,
          );
        }
      }
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
});

describe("project run usage", () => {
  it("renders the immutable trace facts before authorization", () => {
    const writes: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: Uint8Array | string) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      disclosePrivateTrace({
        absolutePath: "/private/example/trace.ndjson",
        sha256: "a".repeat(64),
        sizeBytes: 123,
        contentType: "application/x-ndjson",
      });
    } finally {
      process.stderr.write = originalWrite;
    }
    const rendered = writes.join("");
    assert.match(rendered, /authorization has not started/u);
    assert.match(
      rendered,
      /https:\/\/slop\.cash\/protocol\/private-trace-v1\.md/u,
    );
    assert.match(rendered, /\/private\/example\/trace\.ndjson/u);
    assert.match(rendered, /Size: 123 bytes/u);
    assert.match(rendered, /Content-Type: application\/x-ndjson/u);
    assert.match(rendered, new RegExp(`SHA-256: ${"a".repeat(64)}`, "u"));
    assert.match(rendered, /Automatic redaction: none/u);
    assert.match(rendered, /retained permanently/u);
  });

  const repositoryRoot = "/work/eliza";
  const before = normalizeSessionReport(
    {
      sessions: [
        {
          sessionId: "matching",
          projectPath: repositoryRoot,
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          totalCost: 0.01,
        },
        {
          sessionId: "other-project",
          projectPath: "/work/private-client",
          totalTokens: 1_000_000,
        },
        { sessionId: "pathless", totalTokens: 10 },
      ],
    },
    repositoryRoot,
  );

  it("excludes explicit other-project sessions and hashes every retained id", () => {
    assert.strictEqual(Object.keys(before.sessions).length, 2);
    assert.ok(
      Object.keys(before.sessions).every((value) =>
        /^[0-9a-f]{64}$/u.test(value),
      ),
    );
    assert.strictEqual(
      Object.values(before.sessions).reduce(
        (total: number, session: { totalTokens: number }) =>
          total + session.totalTokens,
        0,
      ),
      160,
    );
  });

  it("rejects unsafe ccusage counters before they can become persisted state", () => {
    const invalidSessions = [
      {
        sessionId: "individual-overflow",
        projectPath: repositoryRoot,
        inputTokens: Number.MAX_SAFE_INTEGER + 1,
      },
      {
        sessionId: "aggregate-overflow",
        projectPath: repositoryRoot,
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 1,
      },
      {
        sessionId: "cost-overflow",
        projectPath: repositoryRoot,
        totalCost: Number.MAX_SAFE_INTEGER,
      },
      {
        sessionId: "negative-counter",
        projectPath: repositoryRoot,
        inputTokens: -1,
      },
      {
        sessionId: "fractional-counter",
        projectPath: repositoryRoot,
        inputTokens: 1.5,
      },
      {
        sessionId: "nonfinite-counter",
        projectPath: repositoryRoot,
        inputTokens: Number.POSITIVE_INFINITY,
      },
      {
        sessionId: "negative-cost",
        projectPath: repositoryRoot,
        totalCost: -0.01,
      },
    ];
    for (const invalidSession of invalidSessions) {
      assert.throws(
        () =>
          normalizeSessionReport(
            { sessions: [invalidSession] },
            repositoryRoot,
          ),
        /invalid|unsafe/u,
      );
    }
  });

  it("uses monotonic deltas and keeps pathless attribution bounded", () => {
    const after = normalizeSessionReport(
      {
        sessions: [
          {
            sessionId: "matching",
            projectPath: repositoryRoot,
            inputTokens: 300,
            outputTokens: 150,
            totalTokens: 450,
            totalCost: 0.03,
          },
          { sessionId: "pathless", totalTokens: 110 },
        ],
      },
      repositoryRoot,
    );
    assert.deepStrictEqual(usageDelta(before, after, "codex"), {
      source: "ccusage-session-v20",
      confidence: "bounded",
      inputTokens: 200,
      outputTokens: 100,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 400,
      costMicroUsd: "20000",
      sessionCount: 2,
    });
    assert.strictEqual(
      usageDelta(before, after, "claude-code").confidence,
      "bounded",
    );
  });

  it("treats same-named paths as bounded and exact roots as exact", () => {
    const reports = (projectPath: string, totalTokens: number) =>
      normalizeSessionReport(
        { sessions: [{ sessionId: "one", projectPath, totalTokens }] },
        repositoryRoot,
      );
    assert.strictEqual(
      usageDelta(
        reports("/unrelated/eliza", 10),
        reports("/unrelated/eliza", 20),
        "claude-code",
      ).confidence,
      "bounded",
    );
    assert.strictEqual(
      usageDelta(
        reports(repositoryRoot, 10),
        reports(repositoryRoot, 20),
        "claude-code",
      ).confidence,
      "exact",
    );
    const codexBefore = normalizeSessionReport(
      {
        sessions: [
          { sessionId: "codex", directory: repositoryRoot, totalTokens: 10 },
        ],
      },
      repositoryRoot,
    );
    const codexAfter = normalizeSessionReport(
      {
        sessions: [
          { sessionId: "codex", directory: repositoryRoot, totalTokens: 20 },
        ],
      },
      repositoryRoot,
    );
    assert.strictEqual(
      usageDelta(codexBefore, codexAfter, "codex").confidence,
      "exact",
    );
  });

  it("fails closed when local counters regress", () => {
    const after = structuredClone(before);
    const session = Object.values(after.sessions)[0];
    session.totalTokens = 1;
    assert.deepStrictEqual(usageDelta(before, after, "codex"), {
      source: "ccusage-session-v20",
      confidence: "unavailable",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      costMicroUsd: "0",
      sessionCount: 0,
    });
  });

  it("uploads and finalizes a bounded private trace without exposing identity credentials", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "slop-trace-upload-"));
    try {
      const trajectory = join(fixtureRoot, "trace.ndjson");
      const contents = '{"event":"complete"}\n';
      writeFileSync(trajectory, contents);
      const digest = createHash("sha256").update(contents).digest("hex");
      const serverRunId = "srv_test";
      const calls: Array<{ url: string; options: RequestInit }> = [];
      const sequence: string[] = [];
      let disclosure: Record<string, unknown> | null = null;
      const responses = [
        {
          enabled: true,
          source: "github-public-status",
          verifiedAt: "2026-08-25T12:00:00.000Z",
        },
        {
          token: "s".repeat(32),
          tokenType: "Bearer",
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
        {
          serverRunId,
          clientRunId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          state: "awaiting_trace",
        },
        {
          serverRunId,
          uploadUrl: "https://api.slop.cash/api/v1/trace-capabilities/test",
          expiresAt: "2030-01-01T00:00:00.000Z",
          sha256: digest,
          sizeBytes: Buffer.byteLength(contents),
          contentType: "application/x-ndjson",
        },
        {
          serverRunId,
          clientRunId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          traceObjectId: `sha256:${digest}`,
          traceSha256: digest,
          sizeBytes: Buffer.byteLength(contents),
          state: "trace_uploaded",
        },
        {
          serverRunId,
          clientRunId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          traceObjectId: `sha256:${digest}`,
          traceSha256: digest,
          state: "finalized",
        },
      ];
      const evidence = await uploadPrivateTrace(
        {
          runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          projectId: "eliza",
          repositoryId: "elizaOS/eliza",
          revision: "a".repeat(40),
          provider: "moonshot",
          model: "kimi-k2",
          client: "kimi-cli",
        },
        trajectory,
        "1.2.3",
        {
          disclosure: (value: Record<string, unknown>) => {
            sequence.push("disclosure");
            disclosure = value;
            writeFileSync(trajectory, '{"event":"changed-after-snapshot"}\n');
          },
          assertionProvider: () => {
            sequence.push("authorization");
            return "i".repeat(32);
          },
          fetchImpl: async (url, options = {}) => {
            calls.push({ url: String(url), options });
            return new Response(JSON.stringify(responses.shift()), {
              status: 200,
            });
          },
        },
      );
      assert.deepStrictEqual(evidence, {
        authority: "https://api.slop.cash",
        serverRunId,
        objectId: `sha256:${digest}`,
        sha256: digest,
      });
      assert.deepStrictEqual(sequence, ["disclosure", "authorization"]);
      assert.deepStrictEqual(disclosure, {
        absolutePath: trajectory,
        sha256: digest,
        sizeBytes: Buffer.byteLength(contents),
        contentType: "application/x-ndjson",
        privacyContract: "https://slop.cash/protocol/private-trace-v1.md",
        automaticRedaction: "none",
        retention: "permanent",
      });
      assert.strictEqual(calls.length, 6);
      assert.strictEqual(
        Buffer.from(calls[4].options.body as Uint8Array).toString("utf8"),
        contents,
      );
      assert.strictEqual(
        (calls[4].options.headers as Record<string, string>).Digest,
        `sha-256=${digest}`,
      );
      assert.strictEqual(
        calls[0].url,
        "https://api.slop.cash/api/v1/private-request-intake",
      );
      assert.strictEqual(calls[0].options.method, "GET");
      assert.strictEqual(
        calls[1].url,
        "https://api.slop.cash/api/v1/auth/session",
      );
      assert.strictEqual(
        (calls[1].options.headers as Record<string, string>)[
          "X-Slop-Identity-Assertion"
        ],
        "i".repeat(32),
      );
      assert.ok(
        calls.every(({ options }) => !JSON.stringify(options).includes("gho_")),
      );
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("blocks private trace upload before authorization when private intake is disabled", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "slop-trace-intake-"));
    try {
      const trajectory = join(fixtureRoot, "trace.ndjson");
      writeFileSync(trajectory, '{"event":"complete"}\n');
      let authorizationStarted = false;
      const requests: string[] = [];
      await assert.rejects(
        uploadPrivateTrace(
          {
            runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
            projectId: "eliza",
            repositoryId: "elizaOS/eliza",
            revision: "a".repeat(40),
            provider: "moonshot",
            model: "kimi-k2",
            client: "kimi-cli",
          },
          trajectory,
          "1.2.3",
          {
            disclosure: () => {},
            assertionProvider: () => {
              authorizationStarted = true;
              return "i".repeat(32);
            },
            fetchImpl: async (url) => {
              requests.push(String(url));
              return new Response(
                JSON.stringify({
                  enabled: false,
                  source: "github-public-status",
                  verifiedAt: "2026-08-25T12:00:00.000Z",
                }),
                { status: 200 },
              );
            },
          },
        ),
        /private request intake is unavailable/u,
      );
      assert.strictEqual(authorizationStarted, false);
      assert.deepStrictEqual(requests, [
        "https://api.slop.cash/api/v1/private-request-intake",
      ]);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("requests a fresh upload capability when retrying a failed run", async () => {
    const root = mkdtempSync(join(tmpdir(), "slop-trace-resume-"));
    try {
      const path = join(root, "trace.ndjson");
      const contents = '{"event":"complete"}\n';
      writeFileSync(path, contents);
      const digest = createHash("sha256").update(contents).digest("hex");
      const state = {
        runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        projectId: "eliza",
        repositoryId: "elizaOS/eliza",
        revision: "a".repeat(40),
        provider: "openai",
        model: "gpt-6-astra",
        client: "codex",
      };
      const keys: string[] = [];
      let failed = false;
      const options = {
        disclosure: () => {},
        assertionProvider: () => "i".repeat(32),
        fetchImpl: async (
          url: RequestInfo | URL,
          request: RequestInit = {},
        ) => {
          const target = String(url);
          const identity = {
            serverRunId: "srv_resume",
            clientRunId: state.runId,
          };
          if (target.endsWith("private-request-intake"))
            return Response.json({
              enabled: true,
              source: "github-public-status",
              verifiedAt: "2026-08-25T12:00:00.000Z",
            });
          if (target.endsWith("auth/session"))
            return Response.json({
              token: "s".repeat(32),
              tokenType: "Bearer",
              expiresAt: "2030-01-01T00:00:00.000Z",
            });
          if (target.endsWith("/runs"))
            return Response.json({ ...identity, state: "awaiting_trace" });
          if (target.endsWith("trace-intents")) {
            keys.push(
              new Headers(request.headers).get("Idempotency-Key") ?? "",
            );
            return Response.json({
              serverRunId: identity.serverRunId,
              uploadUrl: "https://api.slop.cash/api/v1/trace-uploads/fresh",
              expiresAt: "2030-01-01T00:00:00.000Z",
              sha256: digest,
              sizeBytes: Buffer.byteLength(contents),
              contentType: "application/x-ndjson",
            });
          }
          if (request.method === "PUT") {
            if (!failed) {
              failed = true;
              return Response.json(
                { error: "internal_error" },
                { status: 500 },
              );
            }
            return Response.json({
              ...identity,
              state: "trace_uploaded",
              traceSha256: digest,
              traceObjectId: `sha256:${digest}`,
              sizeBytes: Buffer.byteLength(contents),
            });
          }
          return Response.json({
            ...identity,
            state: "finalized",
            traceSha256: digest,
            traceObjectId: `sha256:${digest}`,
          });
        },
      };
      await assert.rejects(
        uploadPrivateTrace(state, path, "1.2.3", options),
        /HTTP 500/u,
      );
      const recovered = await uploadPrivateTrace(state, path, "1.2.3", options);
      assert.strictEqual(recovered.sha256, digest);
      assert.strictEqual(keys.length, 2);
      assert.notStrictEqual(keys[0], keys[1]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("finalizes an idempotently recovered run whose trace was already uploaded", async () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "slop-trace-finalize-recovery-"),
    );
    try {
      const trajectory = join(fixtureRoot, "trace.ndjson");
      const contents = '{"event":"complete"}\n';
      writeFileSync(trajectory, contents);
      const digest = createHash("sha256").update(contents).digest("hex");
      const serverRunId = "srv_recovered";
      const requests: Array<{ method: string; url: string }> = [];
      const responses = [
        {
          enabled: true,
          source: "github-public-status",
          verifiedAt: "2026-08-25T12:00:00.000Z",
        },
        {
          token: "s".repeat(32),
          tokenType: "Bearer",
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
        {
          serverRunId,
          clientRunId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          state: "trace_uploaded",
        },
        {
          serverRunId,
          clientRunId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          traceObjectId: `sha256:${digest}`,
          traceSha256: digest,
          state: "finalized",
        },
      ];
      const evidence = await uploadPrivateTrace(
        {
          runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
          projectId: "eliza",
          repositoryId: "elizaOS/eliza",
          revision: "a".repeat(40),
          provider: "openai",
          model: "gpt-5.6-sol",
          client: "codex",
        },
        trajectory,
        "1.2.3",
        {
          disclosure: () => {},
          assertionProvider: () => "i".repeat(32),
          fetchImpl: async (url, options = {}) => {
            requests.push({
              method: options.method ?? "GET",
              url: String(url),
            });
            return Response.json(responses.shift(), { status: 200 });
          },
        },
      );
      assert.deepStrictEqual(evidence, {
        authority: "https://api.slop.cash",
        serverRunId,
        objectId: `sha256:${digest}`,
        sha256: digest,
      });
      assert.deepStrictEqual(
        requests.map(({ method, url }) => ({
          method,
          path: new URL(url).pathname,
        })),
        [
          { method: "GET", path: "/api/v1/private-request-intake" },
          { method: "POST", path: "/api/v1/auth/session" },
          { method: "POST", path: "/api/v1/runs" },
          { method: "POST", path: `/api/v1/runs/${serverRunId}/finalize` },
        ],
      );
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("reports private intake rate-limit reset before authorization", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "slop-trace-intake-rate-"));
    try {
      const trajectory = join(fixtureRoot, "trace.ndjson");
      writeFileSync(trajectory, '{"event":"complete"}\n');
      let authorizationStarted = false;
      await assert.rejects(
        uploadPrivateTrace(
          {
            runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
            projectId: "eliza",
            repositoryId: "elizaOS/eliza",
            revision: "a".repeat(40),
            provider: "moonshot",
            model: "kimi-k2",
            client: "kimi-cli",
          },
          trajectory,
          "1.2.3",
          {
            disclosure: () => {},
            assertionProvider: () => {
              authorizationStarted = true;
              return "i".repeat(32);
            },
            fetchImpl: async () =>
              new Response(
                JSON.stringify({
                  error: "private_intake_rate_limited",
                  resetAt: "2027-01-15T08:00:00.000Z",
                }),
                { status: 503 },
              ),
          },
        ),
        /private request intake verification is rate limited until 2027-01-15T08:00:00.000Z/u,
      );
      assert.strictEqual(authorizationStarted, false);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("rejects a symlinked private trace before disclosure or network access", async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "slop-trace-symlink-"));
    try {
      const target = join(fixtureRoot, "secret.ndjson");
      const trajectory = join(fixtureRoot, "trace.ndjson");
      writeFileSync(target, '{"secret":"must-not-snapshot"}\n');
      symlinkSync(target, trajectory);
      let disclosed = false;
      let fetched = false;
      await assert.rejects(
        uploadPrivateTrace(
          {
            runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
            projectId: "eliza",
            repositoryId: "elizaOS/eliza",
            revision: "a".repeat(40),
            provider: "moonshot",
            model: "kimi-k2",
            client: "kimi-cli",
          },
          trajectory,
          "1.2.3",
          {
            disclosure: () => {
              disclosed = true;
            },
            fetchImpl: async () => {
              fetched = true;
              return new Response("{}", { status: 200 });
            },
          },
        ),
        /non-symlinked regular file/u,
      );
      assert.strictEqual(disclosed, false);
      assert.strictEqual(fetched, false);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("completes the one-time browser identity bridge without exposing its capabilities", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const responses = [
      new Response(
        JSON.stringify({
          flowId: `flow_${"f".repeat(32)}`,
          authorizationUrl: `https://identity.slop.cash/v1/oauth/authorize?flow=${"f".repeat(32)}`,
          pollCapability: "p".repeat(48),
          expiresAt: "2030-01-01T00:05:00.000Z",
          pollAfterSeconds: 2,
        }),
        { status: 201 },
      ),
      new Response(
        JSON.stringify({ status: "pending", retryAfterSeconds: 2 }),
        { status: 202 },
      ),
      new Response(
        JSON.stringify({
          status: "complete",
          assertion: `slop_assert_v1_${"a".repeat(48)}`,
          assertionType: "SlopIdentity",
          expiresAt: "2030-01-01T00:01:30.000Z",
        }),
        { status: 200 },
      ),
    ];
    const delays: number[] = [];
    const originalWrite = process.stderr.write;
    let displayed = "";
    process.stderr.write = ((value: string | Uint8Array) => {
      displayed += String(value);
      return true;
    }) as typeof process.stderr.write;
    try {
      const assertion = await slopIdentityAssertion(
        async (url, options = {}) => {
          requests.push({
            url: String(url),
            body: typeof options.body === "string" ? options.body : "",
          });
          const response = responses.shift();
          assert.ok(response);
          return response;
        },
        async (milliseconds) => {
          delays.push(milliseconds);
        },
      );
      assert.strictEqual(assertion, `slop_assert_v1_${"a".repeat(48)}`);
    } finally {
      process.stderr.write = originalWrite;
    }
    assert.deepStrictEqual(delays, [2_000, 2_000]);
    assert.strictEqual(requests.length, 3);
    assert.match(
      displayed,
      /https:\/\/identity\.slop\.cash\/v1\/oauth\/authorize/u,
    );
    assert.ok(!displayed.includes("p".repeat(48)));
    assert.ok(!displayed.includes("slop_assert_v1_"));
  });

  it("cancels oversized identity responses before parsing them", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(40 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    await assert.rejects(
      slopIdentityAssertion(
        async () => new Response(body),
        async () => {},
      ),
      /response exceeded its bound/u,
    );
    assert.strictEqual(cancelled, true);
  });

  it("includes the identity error code when a poll fails mid-flow", async () => {
    const responses = [
      new Response(
        JSON.stringify({
          flowId: `flow_${"f".repeat(32)}`,
          authorizationUrl: `https://identity.slop.cash/v1/oauth/authorize?flow=${"f".repeat(32)}`,
          pollCapability: "p".repeat(48),
          expiresAt: "2030-01-01T00:05:00.000Z",
          pollAfterSeconds: 2,
        }),
        { status: 201 },
      ),
      new Response(
        JSON.stringify({
          error: "flow_unavailable",
          message: "Identity flow is unavailable",
        }),
        { status: 410 },
      ),
    ];
    const originalWrite = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      await assert.rejects(
        slopIdentityAssertion(
          async () => {
            const response = responses.shift();
            assert.ok(response);
            return response;
          },
          async () => {},
        ),
        /returned HTTP 410 \(flow_unavailable\)/u,
      );
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("reports a deadline miss as expiry instead of a bare 410", async () => {
    const responses = [
      new Response(
        JSON.stringify({
          flowId: `flow_${"f".repeat(32)}`,
          authorizationUrl: `https://identity.slop.cash/v1/oauth/authorize?flow=${"f".repeat(32)}`,
          pollCapability: "p".repeat(48),
          expiresAt: new Date(Date.now() + 2_500).toISOString(),
          pollAfterSeconds: 2,
        }),
        { status: 201 },
      ),
      new Response(
        JSON.stringify({
          error: "flow_unavailable",
          message: "Identity flow is unavailable",
        }),
        { status: 410 },
      ),
    ];
    const originalWrite = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      await assert.rejects(
        slopIdentityAssertion(
          async () => {
            const response = responses.shift();
            assert.ok(response);
            return response;
          },
          async () => {},
        ),
        /authorization expired before completion/u,
      );
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("serializes one terminal Slop marker without private material", () => {
    const key = generateKeyPairSync("ed25519");
    const publicDer = createPublicKey(key.privateKey).export({
      format: "der",
      type: "spki",
    });
    const receipt = {
      schemaVersion: "1",
      runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      projectId: "eliza",
      repositoryId: "elizaOS/eliza",
      startedAt: "2026-07-29T10:00:00.000Z",
      completedAt: "2026-07-29T11:00:00.000Z",
      provider: "openai",
      model: "gpt-5.6-sol",
      client: "codex",
      skillRevision: `elizaOS/slopdotcash@${"a".repeat(40)}:skills/contribute-to-eliza`,
      skillSha256: "b".repeat(64),
      usage: {
        source: "ccusage-session-v20",
        confidence: "bounded",
        inputTokens: 10,
        outputTokens: 20,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 30,
        costMicroUsd: "42",
        sessionCount: 1,
      },
      trajectorySha256: "c".repeat(64),
      signatureAlgorithm: "ed25519",
      devicePublicKey: Buffer.from(publicDer).toString("base64url"),
      deviceKeyId: createHash("sha256").update(publicDer).digest("hex"),
      deviceSignature: "pending",
    };
    receipt.deviceSignature = sign(
      null,
      Buffer.from(signingPayload(receipt), "utf8"),
      key.privateKey,
    ).toString("base64url");
    const rendered = footer(receipt, "lane-1");
    assert.match(rendered, /locally reported/u);
    assert.match(rendered, /— \[lane-1\]/u);
    assert.match(
      rendered.split("\n").at(-1) ?? "",
      /^<!-- slop-contribution-attribution:v1 /u,
    );
    assert.doesNotMatch(rendered, /PRIVATE KEY/u);
    const assessed = assessModelAttribution([
      {
        id: "COMMENT_RECEIPT",
        artifactId: "PR_1",
        kind: "comment",
        body: rendered,
        url: "https://github.com/elizaOS/eliza/pull/1#issuecomment-1",
        createdAt: "2026-07-29T11:00:00.000Z",
        updatedAt: "2026-07-29T11:00:00.000Z",
        author: {
          id: "U_1",
          login: "builder",
          avatarUrl: "https://avatars.githubusercontent.com/builder",
          url: "https://github.com/builder",
          kind: "User",
        },
        authorAssociation: "MEMBER",
      },
    ]);
    assert.deepStrictEqual(assessed.invalidMarkers, []);
    assert.strictEqual(assessed.declarations[0]?.run?.runId, receipt.runId);
  });
});
