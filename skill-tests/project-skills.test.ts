/**
 * Validates both project skills and the shared measured-run implementation,
 * including project filtering, conservative confidence, monotonic deltas, and
 * terminal marker serialization without invoking local usage tools.
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  footer,
  normalizeSessionReport,
  usageDelta,
} from "../skills/contribute-to-eliza/scripts/run-receipt.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const elizaSkill = join(root, "skills", "contribute-to-eliza");
const deltaSkill = join(root, "skills", "contribute-to-delta-star");
const reviewElizaSkill = join(root, "skills", "review-eliza-contributions");
const reviewDeltaSkill = join(
  root,
  "skills",
  "review-delta-star-contributions",
);

describe("project skill contracts", () => {
  it("keeps both skill packages focused, complete, and frontier-model explicit", () => {
    const eliza = readFileSync(join(elizaSkill, "SKILL.md"), "utf8");
    const delta = readFileSync(join(deltaSkill, "SKILL.md"), "utf8");

    for (const [name, source] of [
      ["contribute-to-eliza", eliza],
      ["contribute-to-delta-star", delta],
    ]) {
      assert.match(source, new RegExp(`^name: ${name}$`, "m"));
      assert.doesNotMatch(source, /\[TODO[:\]]/u);
      assert.match(source, /gpt-5\.6-sol/u);
      assert.match(source, /claude-fable-5/u);
      assert.match(source, /run-receipt\.mjs start/u);
      assert.match(source, /run-receipt\.mjs finish/u);
      assert.match(source, /token.*never earns|receipt cannot create score/is);
      assert.match(source, /untrusted/u);
      assert.match(source, /disposable.*sandbox/is);
      assert.match(source, /Never self-approve|Leave acceptance and merge/is);
    }
    assert.match(eliza, /elizaOS\/eliza/u);
    assert.doesNotMatch(eliza, /lalalune\/ArkLib/u);
    assert.match(delta, /lalalune\/ArkLib/u);
    assert.match(delta, /sorry.*admit.*axiom/is);
    assert.match(delta, /external Proximity Prize/u);
    assert.match(delta, /does not.*guarantee.*dollar/is);
  });

  it("ships byte-identical receipt logic with project data kept declarative", () => {
    assert.strictEqual(
      readFileSync(join(elizaSkill, "scripts", "run-receipt.mjs"), "utf8"),
      readFileSync(join(deltaSkill, "scripts", "run-receipt.mjs"), "utf8"),
    );
    const eliza = JSON.parse(
      readFileSync(join(elizaSkill, "project.json"), "utf8"),
    );
    const delta = JSON.parse(
      readFileSync(join(deltaSkill, "project.json"), "utf8"),
    );
    assert.deepStrictEqual(eliza.models, delta.models);
    assert.strictEqual(eliza.repositoryId, "elizaOS/eliza");
    assert.strictEqual(delta.repositoryId, "lalalune/arklib");
    const receiptSource = readFileSync(
      join(elizaSkill, "scripts", "run-receipt.mjs"),
      "utf8",
    );
    assert.match(receiptSource, /isSymbolicLink\(\)/u);
    assert.match(
      receiptSource,
      /refusing a non-regular or symlinked device key/u,
    );
  });

  it("keeps independent review skills hostile-input aware and non-punitive", () => {
    for (const [name, directory] of [
      ["review-eliza-contributions", reviewElizaSkill],
      ["review-delta-star-contributions", reviewDeltaSkill],
    ]) {
      const source = readFileSync(join(directory, "SKILL.md"), "utf8");
      assert.match(source, new RegExp(`^name: ${name}$`, "m"));
      assert.match(source, /gpt-5\.6-sol/u);
      assert.match(source, /claude-fable-5/u);
      assert.match(source, /hostile data/u);
      assert.match(source, /identical or near-identical/u);
      assert.match(source, /Do not penalize.*self-closed/is);
      assert.match(source, /never bans|never\n+bans/is);
      assert.match(source, /accept.*partial.*reject.*hold/is);
      assert.match(source, /open-work-review/u);
      assert.doesNotMatch(source, /private key|seed phrase/is);
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
