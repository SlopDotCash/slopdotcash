// Deterministic trust-boundary tests. These are NOT provider or approved-VM
// acceptance evidence, and do not qualify production closure.
import { expect, test } from "bun:test";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { parseRepositoryConfig, type Verdict } from "./contracts";
import {
  QUALITY_MARKER,
  type QualitySubject,
  verifyQualityReceipt,
} from "./quality";
import { confirmedClosure } from "./review";

const base = "a".repeat(40),
  head = "b".repeat(40),
  artifactCommit = "c".repeat(40);
const profile = "1".repeat(64),
  environment = "2".repeat(64),
  harness = "3".repeat(64);
const now = Date.now();
const rule = {
  source: "CONTRIBUTING.md",
  quote:
    "Reject removal of required behavior, reproduced regressions and contradicted result claims.",
};
const claim = "All required checks passed.";
const artifactUrl = `https://github.com/example/project/blob/${artifactCommit}/results.json`;
const subject: QualitySubject = {
  repositoryId: 42,
  nodeId: "PR_example",
  baseSha: base,
  headSha: head,
  policyDigest: "4".repeat(64),
  itemText: `${claim}\n${artifactUrl}\n-return requiredBehavior();`,
  policy: [{ path: rule.source, text: rule.quote, truncated: false }],
};
const baseline = "export function work() { return requiredBehavior(); }\n";
const candidate = "export function work() { return null; }\n";
const artifact = JSON.stringify({ checks: { passed: false } });
const key = await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
]);
const publicKey = btoa(
  String.fromCharCode(
    ...new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey)),
  ),
);
const trust = {
  SLOPBOT_QUALITY_VERIFIER_KEY: publicKey,
  SLOPBOT_QUALITY_PROFILE_SHA256: profile,
};
const files = new Map([
  [`${base}/src/work.ts`, baseline],
  [`${head}/src/work.ts`, candidate],
  [`${artifactCommit}/results.json`, artifact],
]);
const github = {
  async request<T>(
    _method: string,
    path: string,
  ): Promise<{ status: number; data: T | null }> {
    if (path.includes("/git/commits/"))
      return { status: 200, data: { sha: path.split("/").at(-1) } as T };
    return { status: 404, data: null };
  },
  async fileText(_owner: string, _repo: string, path: string, ref: string) {
    const value = files.get(`${ref}/${path}`);
    return value === undefined ? null : { text: value, truncated: false };
  },
};
async function receipt(kind: string, proof: Record<string, unknown>) {
  return {
    version: 1,
    status: "verified",
    isolation: "approved-vm",
    visibilityGaps: [],
    repositoryId: subject.repositoryId,
    nodeId: subject.nodeId,
    headSha: head,
    baseSha: base,
    policyDigest: subject.policyDigest,
    itemDigest: await sha256Hex(subject.itemText),
    profileSha256: profile,
    verifiedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString(),
    kind,
    rule,
    evidence: claim,
    repair: "Restore the required result and provide corrected evidence.",
    proof,
  };
}
async function sign(raw: unknown) {
  const payload = JSON.stringify(raw);
  const signature = btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          key.privateKey,
          new TextEncoder().encode(`${QUALITY_MARKER}\n${payload}`),
        ),
      ),
    ),
  );
  return JSON.stringify({ payload, signature });
}
async function verify(raw: unknown, current = subject) {
  return verifyQualityReceipt(
    await sign(raw),
    trust,
    current,
    github,
    "example",
    "project",
    now,
  );
}
const removal = await receipt("removed_behavior", {
  path: "src/work.ts",
  requiredBehavior: "Return the required behavior result",
  removedLines: "return requiredBehavior();",
  baselineSha256: await sha256Hex(baseline),
  candidateSha256: await sha256Hex(candidate),
  scopeChangeApproved: false,
  behaviorAbsent: true,
});
const regression = await receipt("reproduced_regression", {
  command: "python3 required_workflow.py",
  environmentSha256: environment,
  harnessSha256: harness,
  workflowUnchanged: true,
  patchCaused: true,
  externalFailure: false,
  baseline: {
    sourceSha: base,
    exitCode: 0,
    reportSha256: "5".repeat(64),
    harnessSha256: harness,
    environmentSha256: environment,
  },
  candidate: {
    sourceSha: head,
    exitCode: 1,
    reportSha256: "6".repeat(64),
    harnessSha256: harness,
    environmentSha256: environment,
  },
});
const contradiction = await receipt("contradicted_claim", {
  claim,
  path: "results.json",
  commit: artifactCommit,
  sha256: await sha256Hex(artifact),
  pointer: "/checks/passed",
  claimed: true,
  observed: false,
});

test("trusted receipt admission checks all three predicates and binds independent verdicts to one defect", async () => {
  const proofs = [];
  for (const input of [removal, regression, contradiction]) {
    const verified = await verify(input);
    expect(verified).not.toBeNull();
    if (verified) proofs.push(verified);
  }
  expect(new Set(proofs.map((p) => p.id)).size).toBe(3);
  const verdict = (id: string): Verdict => ({
    category: "low_quality",
    confidence: 0.99,
    objective_defect: id,
    evidence: [claim],
    rule_refs: [rule],
    limitations: [],
    summary: "Restore required behavior.",
  });
  const context = { ...subject, quality: proofs };
  for (const proof of proofs)
    expect(
      confirmedClosure(verdict(proof.id), verdict(proof.id), context),
    ).toBe(true);
  expect(
    confirmedClosure(verdict(proofs[0].id), verdict(proofs[1].id), context),
  ).toBe(false);
  expect(
    confirmedClosure(verdict(proofs[0].id), verdict(proofs[0].id), {
      ...subject,
      quality: [],
    }),
  ).toBe(false);
  expect(confirmedClosure(verdict(proofs[0].id), null, context)).toBe(false);
  expect(
    confirmedClosure(
      verdict(proofs[0].id),
      {
        ...verdict(proofs[0].id),
        limitations: ["Could not check the requirement"],
      },
      context,
    ),
  ).toBe(false);
});

test("forged, stale, incomplete or differently bound receipts never admit a defect", async () => {
  const valid = await sign(regression);
  const changed = JSON.parse(valid);
  changed.payload = changed.payload.replace("PR_example", "PR_attacker");
  expect(
    await verifyQualityReceipt(
      JSON.stringify(changed),
      trust,
      subject,
      github,
      "example",
      "project",
      now,
    ),
  ).toBeNull();
  expect(
    await verifyQualityReceipt(
      valid,
      {},
      subject,
      github,
      "example",
      "project",
      now,
    ),
  ).toBeNull();
  for (const change of [
    { repositoryId: 43 },
    { nodeId: "PR_other" },
    { headSha: base },
    { baseSha: head },
    { policyDigest: "9".repeat(64) },
    { profileSha256: "9".repeat(64) },
    { itemDigest: "9".repeat(64) },
    { status: "incomplete" },
    { isolation: "container" },
    { visibilityGaps: ["collector incomplete"] },
    { expiresAt: new Date(now).toISOString() },
    { verifiedAt: new Date(now + 5000).toISOString() },
    { kind: "style_preference" },
  ])
    expect(await verify({ ...regression, ...change })).toBeNull();
  expect(
    await verify(regression, {
      ...subject,
      itemText: `${subject.itemText} corrected claim`,
    }),
  ).toBeNull();
  expect(await verify(regression, { ...subject, policy: [] })).toBeNull();
});

test("useful implementations, approved scope changes and unrelated failures are not objective removal/regression", async () => {
  for (const change of [
    { scopeChangeApproved: true },
    { behaviorAbsent: false },
    { removedLines: "invented source bytes" },
    { candidateSha256: "9".repeat(64) },
  ])
    expect(
      await verify({ ...removal, proof: { ...removal.proof, ...change } }),
    ).toBeNull();
  files.set(`${head}/src/work.ts`, baseline);
  try {
    expect(
      await verify({
        ...removal,
        proof: { ...removal.proof, candidateSha256: await sha256Hex(baseline) },
      }),
    ).toBeNull();
  } finally {
    files.set(`${head}/src/work.ts`, candidate);
  }
  for (const change of [
    { externalFailure: true },
    { patchCaused: false },
    { workflowUnchanged: false },
    { baseline: { ...(regression.proof.baseline as object), exitCode: 1 } },
    { candidate: { ...(regression.proof.candidate as object), exitCode: 0 } },
    {
      candidate: {
        ...(regression.proof.candidate as object),
        environmentSha256: "9".repeat(64),
      },
    },
    {
      candidate: {
        ...(regression.proof.candidate as object),
        harnessSha256: "9".repeat(64),
      },
    },
  ])
    expect(
      await verify({
        ...regression,
        proof: { ...regression.proof, ...change },
      }),
    ).toBeNull();
});

test("claim evidence must cite the actual immutable artifact and contradict its bytes", async () => {
  for (const change of [
    { observed: true },
    { claimed: false },
    { claim: "Another uncited claim" },
    { commit: "main" },
    { path: "missing.json" },
    { pointer: "/checks/absent" },
    { pointer: "/__proto__/passed" },
    { sha256: "9".repeat(64) },
  ])
    expect(
      await verify({
        ...contradiction,
        proof: { ...contradiction.proof, ...change },
      }),
    ).toBeNull();
  files.set(
    `${artifactCommit}/results.json`,
    JSON.stringify({ checks: { passed: true } }),
  );
  try {
    expect(await verify(contradiction)).toBeNull();
  } finally {
    files.set(`${artifactCommit}/results.json`, artifact);
  }
  const withoutCitation = { ...subject, itemText: claim };
  expect(
    await verify(
      { ...contradiction, itemDigest: await sha256Hex(claim) },
      withoutCitation,
    ),
  ).toBeNull();
  expect(
    await verifyQualityReceipt(
      await sign(contradiction),
      trust,
      subject,
      {
        ...github,
        async fileText() {
          throw new Error("artifact service unavailable");
        },
      },
      "example",
      "project",
      now,
    ),
  ).toBeNull();
  expect(
    parseRepositoryConfig(
      JSON.stringify({
        version: 1,
        audience: "protection",
        categories: { low_quality: "close" },
      }),
    ).ok,
  ).toBe(true);
  expect(
    parseRepositoryConfig(
      JSON.stringify({
        version: 1,
        audience: "protection",
        categories: { missing_evidence: "close" },
      }),
    ).ok,
  ).toBe(false);
});

test("missing provider credentials never produce a confirmation", async () => {
  const { runRoute, CONFIRM_ROUTE } = await import("./models");
  const result = await runRoute(
    {},
    CONFIRM_ROUTE,
    {
      system: "Classify this harmless acceptance probe.",
      policy: "No policy",
      item: "No defect",
    },
    "high",
    async () => true,
  );
  expect(result.verdict).toBeNull();
  expect(result.calls.every((call) => call.outcome === "failed")).toBe(true);
});

test("quality qualification binds recorded evidence, the same verifier and explicit approval without an age or count gate", async () => {
  const { Database } = await import("bun:sqlite");
  const { readFileSync } = await import("node:fs");
  const { qualityQualified } = await import("./review");
  const sql = new Database(":memory:");
  sql.exec(
    readFileSync(
      new URL("../../migrations/0013_slopbot.sql", import.meta.url),
      "utf8",
    ),
  );
  sql.exec(
    readFileSync(
      new URL(
        "../../migrations/0040_slopbot_quality_shadow.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const db = {
    async batch() {
      throw new Error("Unexpected transaction in shadow qualification");
    },
    prepare(query: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          args = values;
          return statement;
        },
        async first<T>() {
          return sql.prepare(query).get(...(args as string[])) as T | null;
        },
        async run() {
          sql.prepare(query).run(...(args as string[]));
          return { success: true };
        },
      };
      return statement;
    },
  };
  const proof = await verify(regression);
  expect(proof).not.toBeNull();
  if (!proof) throw Error("test receipt failed");
  const env = {
    ...trust,
    SLOPBOT_DB: db,
    SLOPBOT_APP_ID: "test",
    SLOPBOT_APP_USER_ID: "test",
    SLOPBOT_APP_PRIVATE_KEY: "unused",
  };
  const job = {
    kind: "review" as const,
    repositoryId: 42,
    installationId: 1,
    deliveryId: "test",
    owner: "example",
    repo: "project",
    itemKind: "pull_request" as const,
    number: 1,
  };
  const qualified = {
    ...env,
    SLOPBOT_QUALITY_QUALIFIED_PROFILE_SHA256: profile,
  };
  const later = Date.parse("2026-12-01T00:00:00Z");
  try {
    expect(await qualityQualified(qualified, job, proof, later)).toBe(false);
    sql
      .prepare("INSERT INTO slopbot_quality_shadow VALUES (?,?,?,?,?,?,?,?,?)")
      .run(
        "review",
        42,
        "PR_example",
        head,
        subject.policyDigest,
        profile,
        publicKey,
        proof.id,
        "2026-11-01T00:00:00.000Z",
      );
    // This is synthetic evidence for the controls, not real-case qualification.
    // No completed-review quota or elapsed installation time creates authority.
    expect(await qualityQualified(qualified, job, proof, later)).toBe(true);
    expect(await qualityQualified(env, job, proof, later)).toBe(false);
    expect(
      await qualityQualified(
        qualified,
        job,
        proof,
        Date.parse("2026-11-02T00:00:00Z"),
      ),
    ).toBe(true);
    expect(
      await qualityQualified(
        qualified,
        job,
        proof,
        Date.parse("2026-10-31T23:59:59Z"),
      ),
    ).toBe(false);
    expect(
      await qualityQualified(
        { ...qualified, SLOPBOT_QUALITY_VERIFIER_KEY: "rotated" },
        job,
        proof,
        later,
      ),
    ).toBe(false);
    expect(
      await qualityQualified(
        qualified,
        { ...job, repositoryId: 43 },
        proof,
        later,
      ),
    ).toBe(false);
  } finally {
    sql.close();
  }
});

test("a signed-evidence comment queues only identifiers and can arrive after the bot review", async () => {
  const { jobFor } = await import("./index");
  const payload = {
    action: "created",
    installation: { id: 1 },
    repository: {
      id: 42,
      name: "project",
      private: false,
      owner: { login: "example" },
    },
    sender: { id: 999, type: "Bot" },
    issue: { number: 1, pull_request: {} },
    comment: { id: 55, body: `${QUALITY_MARKER}\n${await sign(regression)}` },
  };
  expect(jobFor("issue_comment", "receipt", payload, "999")).toEqual({
    kind: "review",
    deliveryId: "receipt",
    installationId: 1,
    repositoryId: 42,
    owner: "example",
    repo: "project",
    itemKind: "pull_request",
    number: 1,
    qualityCommentId: 55,
  });
  expect(
    jobFor(
      "issue_comment",
      "own-review",
      { ...payload, comment: { id: 55, body: "<!-- slopbot:review -->" } },
      "999",
    ),
  ).toBeNull();
});

test("receipt webhook reads preserve the same deduplication identity as ordinary intake", async () => {
  const { loadQualityEvidence } = await import("./quality");
  const first = { body: `${QUALITY_MARKER}\n${await sign(removal)}` };
  const second = { body: `${QUALITY_MARKER}\n${await sign(regression)}` };
  const reader = {
    ...github,
    async get(path: string) {
      return path.includes("/issues/comments/") ? first : [first, second];
    },
  } as unknown as Parameters<typeof loadQualityEvidence>[0];
  const ordinary = await loadQualityEvidence(
    reader,
    trust,
    subject,
    "example",
    "project",
    1,
  );
  const repeated = await loadQualityEvidence(
    reader,
    trust,
    subject,
    "example",
    "project",
    1,
    55,
  );
  expect(ordinary.length).toBe(2);
  expect(repeated.map((r) => r.id).sort()).toEqual(
    ordinary.map((r) => r.id).sort(),
  );
});
