/**
 * Validates both project skills and the shared measured-run implementation,
 * including project filtering, conservative confidence, monotonic deltas, and
 * terminal marker serialization without invoking local usage tools.
 */

import assert from "node:assert";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  footer,
  normalizeSessionReport,
  usageDelta,
} from "../skills/contribute-to-eliza/scripts/run-receipt.mjs";
import { PROJECTS } from "../src/lib/projects.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const projectPackages = PROJECTS.map((project) => ({
  project,
  contributorRoot: join(root, project.skill.sourcePath),
  reviewerRoot: join(root, project.reviewSkill.sourcePath),
}));

describe("project skill contracts", () => {
  it("keeps every registered contributor package focused, complete, and frontier-model explicit", () => {
    for (const { project, contributorRoot } of projectPackages) {
      const source = readFileSync(join(contributorRoot, "SKILL.md"), "utf8");
      const name = project.skill.id;
      assert.match(source, new RegExp(`^name: ${name}$`, "m"));
      assert.doesNotMatch(source, /\[TODO[:\]]/u);
      assert.match(source, /gpt-5\.6-sol/u);
      assert.match(source, /claude-fable-5/u);
      assert.match(source, /run-receipt\.mjs start/u);
      assert.match(source, /run-receipt\.mjs finish/u);
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
    assert.match(eliza, /elizaOS\/eliza/u);
    assert.doesNotMatch(eliza, /lalalune\/ArkLib/u);
    assert.match(delta, /lalalune\/ArkLib/u);
    assert.match(delta, /sorry.*admit.*axiom/is);
    assert.match(delta, /external Proximity Prize/u);
    assert.match(delta, /does not.*guarantee.*dollar/is);
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
          join(contributorRoot, "scripts", "live-report.mjs"),
          "utf8",
        ),
        liveReportSource,
        `${project.skill.id} discovery logic drifted`,
      );
      const skillProject = JSON.parse(
        readFileSync(join(contributorRoot, "project.json"), "utf8"),
      );
      assert.strictEqual(skillProject.projectId, project.id);
      assert.strictEqual(skillProject.repositoryId, project.repositories[0].id);
      assert.strictEqual(skillProject.skillName, project.skill.id);
      assert.strictEqual(
        skillProject.skillSourcePath,
        project.skill.sourcePath,
      );
      assert.deepStrictEqual(
        Object.entries(skillProject.models).map(([client, policy]) => ({
          client,
          provider: policy.provider,
          model: policy.model,
        })),
        project.modelPolicy.approved,
      );
    }
    assert.match(receiptSource, /isSymbolicLink\(\)/u);
    assert.match(
      receiptSource,
      /refusing a non-regular or symlinked device key/u,
    );
  });

  it("keeps every registered review skill hostile-input aware and non-punitive", () => {
    for (const { project, reviewerRoot } of projectPackages) {
      const name = project.reviewSkill.id;
      const source = readFileSync(join(reviewerRoot, "SKILL.md"), "utf8");
      assert.match(source, new RegExp(`^name: ${name}$`, "m"));
      assert.match(source, /gpt-5\.6-sol/u);
      assert.match(source, /claude-fable-5/u);
      assert.match(source, /hostile data/u);
      assert.match(source, /identical or near-identical/u);
      assert.match(source, /Do not penalize.*self-closed/is);
      assert.match(source, /never bans|never\n+bans/is);
      assert.match(source, /accept.*partial.*reject.*hold/is);
      assert.match(source, /gitarmy-review/u);
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
          [join(installedSkill, "scripts", "run-receipt.mjs")],
          { encoding: "utf8" },
        );
        assert.strictEqual(result.status, 1, result.stdout);
        assert.match(
          result.stderr,
          /project run receipt failed: action must be start or finish/,
          project.skill.id,
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
      }
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
});

describe("project run usage", () => {
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

  it("uses monotonic deltas and keeps pathless or Codex attribution bounded", () => {
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

  it("treats same-named paths as bounded and only exact Claude paths as exact", () => {
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

  it("serializes one terminal v2 marker without private material", () => {
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
      skillRevision: `elizaOS/army@${"a".repeat(40)}:skills/contribute-to-eliza`,
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
      trajectorySha256: null,
      signatureAlgorithm: "ed25519",
      devicePublicKey: "public-key",
      deviceKeyId: "c".repeat(64),
      deviceSignature: "public-signature",
    };
    const rendered = footer(receipt, "lane-1");
    assert.match(rendered, /locally reported/u);
    assert.match(rendered, /— \[lane-1\]/u);
    assert.match(
      rendered.split("\n").at(-1) ?? "",
      /^<!-- elizaos-contribution-attribution:v2 /u,
    );
    assert.doesNotMatch(rendered, /PRIVATE KEY/u);
  });
});
