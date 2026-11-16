/** Bind the owner-vault safety quotient to the reviewed field-liveness proof. */
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const path = "formal/models/api/api_owner_vault_lifecycle.qnt";
const source = readFileSync(path, "utf8");
const erased = [
  "expected",
  "transaction",
  "policy",
  "cap",
  "creationRevision",
  "creationCap",
  "restricted",
  "banned",
  "canSetup",
  "appendGeneration",
  "received",
];

function checkReviewedBoundary(model: string) {
  // Include scenarios/comments as well as the transition boundary. The loader
  // independently pins these complete source bytes and the generated TLA.
  if (
    createHash("sha256").update(model).digest("hex") !==
    "68da3beb9833d621fd150cba1642b0b82739bba614ca4a5132e953b629cea378"
  )
    throw new Error(
      "Owner-vault terminal-field deadness and continuation need review",
    );
  const start = model.indexOf("module api_owner_vault_lifecycle {");
  const end = model.indexOf("  action checked(", start);
  if (start < 0 || end < start)
    throw new Error("Missing owner-vault safety boundary");
  // This binds domains, schema, all concrete transition definitions, helpers
  // and invariant; the loader separately binds the VIEW definition. A new
  // read through a helper or alias must also
  // force a new review; a token-only field search would not establish that.
  const digest = createHash("sha256")
    .update(model.slice(start, end))
    .digest("hex");
  if (
    digest !==
    "88c39b664e6e64ef1e9a6a9fb2d6e274e12bc5cc564deec2b6811594219221d3"
  )
    throw new Error(
      "Owner-vault terminal-field deadness and continuation need review",
    );
  const invariant = model.slice(model.indexOf("  val invariant =", start), end);
  for (const field of erased)
    if (new RegExp(`\\br\\.${field}\\b`, "u").test(invariant))
      throw new Error(`The invariant reads erased terminal field ${field}`);
}

test("owner-vault quotient remains bound to its complete audited transition and invariant boundary", () => {
  checkReviewedBoundary(source);
});

test("a future read of an erased terminal payload cannot silently reuse the quotient proof", () => {
  for (const field of erased) {
    const changed = source.replace(
      'all { r.phase == "response", s\' =',
      `all { r.phase == "response" and r.${field} == idle.${field}, s' =`,
    );
    expect(() => checkReviewedBoundary(changed)).toThrow(
      "deadness and continuation need review",
    );
  }
});

test("future GET or Review input reads require a new phase-liveness review", () => {
  for (const [mode, field, phase] of [
    ["get", "expected", "service"],
    ["get", "transaction", "service"],
    ["get", "family", "service"],
    ["review", "transaction", "chain"],
    ["review", "family", "chain"],
    ["get", "current", "service"],
    ["get", "policy", "service"],
    ["get", "cap", "service"],
    ["get", "captured", "service"],
    ["get", "appendGeneration", "service"],
    ["review", "policy", "chain"],
    ["review", "cap", "chain"],
    ["review", "current", "chain"],
    ["review", "expected", "chain"],
    ["review", "captured", "chain"],
    ["register", "expected", "chain"],
    ["register", "restricted", "commit"],
    ["register", "banned", "commit"],
    ["register", "policy", "postcommit"],
    ["register", "cap", "postcommit"],
    ["register", "transaction", "postcommit"],
    ["register", "family", "postcommit"],
    ["register", "appendGeneration", "postcommit"],
  ]) {
    const changed = source.replace(
      `all { r.phase == "${phase}",`,
      `all { r.phase == "${phase}" and (r.mode != "${mode}" or r.${field} == idle.${field}),`,
    );
    expect(() => checkReviewedBoundary(changed)).toThrow(
      "deadness and continuation need review",
    );
  }
});

test("concrete GET and Review paths keep the original inputs and expected-revision refusals", () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-owner-view-paths-"));
  try {
    const model = join(directory, "api_owner_vault_lifecycle.qnt");
    // Extend only this temporary copy. The checked-in actions, input domains
    // and named scenarios remain concrete and unchanged by the VIEW.
    const cases = `
  run v3GetNetworkInputsRemainConcreteTest = init
    .then(checked(1, "get", 1, "solana", 0, "malformed")).then(service(1, true))
    .expect(s.requests.get(1).status == 200 and s.requests.get(1).result == "networks"
      and s.requests.get(1).expected == 0 and s.requests.get(1).transaction == 3
      and s.requests.get(1).family == "solana" and s.requests.get(1).committed == 0 and invariant)
  run v3GetBountyInputsRemainConcreteTest = init
    .then(checked(1, "get", 2, "solana", 0, "malformed")).then(funds(1, true))
    .expect(s.requests.get(1).status == 200 and s.requests.get(1).result == "funds"
      and s.requests.get(1).expected == 0 and s.requests.get(1).transaction == 3
      and s.requests.get(1).family == "solana" and s.requests.get(1).committed == 0 and invariant)
  run v3ReviewInputsRemainConcreteTest = init
    .then(writeReady(1, "review", "solana", 1, "malformed")).then(chain(1, "valid"))
    .expect(s.requests.get(1).status == 200 and s.requests.get(1).result == "review"
      and s.requests.get(1).transaction == 3 and s.requests.get(1).family == "solana"
      and s.requests.get(1).committed == 0 and invariant)
  run v3ReviewExpectedStillRefusesTest = init
    .then(writeReady(1, "review", "solana", 0, "malformed"))
    .expect(s.requests.get(1).status == 400 and s.requests.get(1).result == "expected"
      and not(s.requests.get(1).chainCalled) and invariant)
`;
    writeFileSync(model, source.replace(/\n\}\s*$/u, `${cases}\n}\n`));
    const output = execFileSync(
      "node",
      [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "test",
        model,
        "--main=api_owner_vault_lifecycle",
        "--backend=typescript",
        "--seed=20261107",
        "--max-samples=1",
        "--match=^v3.*Test$",
      ],
      { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    expect(output).toContain("4 passing");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

test("new existence regressions or terminal index writes require a new monotonicity review", () => {
  for (const [before, after] of [
    [
      "val nextPolicy: Policy = { exists: true, kind:",
      "val nextPolicy: Policy = { exists: false, kind:",
    ],
    [
      "{ exists: true, transaction: 1, family: family }",
      "{ exists: false, transaction: 1, family: family }",
    ],
    [
      "{ exists: true, transaction: r.transaction, family: r.family }",
      "{ exists: false, transaction: r.transaction, family: r.family }",
    ],
    [
      's.requests.get(id).phase == "unused"',
      'Set("unused", "done").contains(s.requests.get(id).phase)',
    ],
    [
      'r.with("phase", "done").with("received", received)',
      'r.with("phase", "done").with("received", received).with("committed", 0)',
    ],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => checkReviewedBoundary(changed)).toThrow(
      "deadness and continuation need review",
    );
  }
});

test("terminal phase collapse rejects reuse, backward continuations and cross-slot reads", () => {
  for (const [before, after] of [
    [
      's.requests.get(id).phase == "unused"',
      'Set("unused", "done").contains(s.requests.get(id).phase)',
    ],
    [
      'r.with("phase", "done").with("received", received)',
      'r.with("phase", "body").with("received", received)',
    ],
    [
      'all { r.phase == "headers",',
      'all { r.phase == "headers" and s.requests.get(2).phase != "response",',
    ],
    [
      'all { r.phase == "response",',
      'all { r.phase == "response" and not(r.received),',
    ],
    [
      "all { r.status > 0 implies r.noStore,",
      'all { r.phase != "done", r.status > 0 implies r.noStore,',
    ],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => checkReviewedBoundary(changed)).toThrow(
      "deadness and continuation need review",
    );
  }
});

test("both concrete and verification dispatchers retain unconditional stuttering", () => {
  for (const name of ["step", "verificationStep"]) {
    const start = source.indexOf(`  action ${name} = any {`);
    const end = source.indexOf("\n  }", start);
    const block = source.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(block.endsWith("    s' = s")).toBe(true);
    const changed =
      source.slice(0, start) +
      block.replace("    s' = s", "    false") +
      source.slice(end);
    expect(changed).not.toBe(source);
    expect(() => checkReviewedBoundary(changed)).toThrow(
      "deadness and continuation need review",
    );
  }
});
