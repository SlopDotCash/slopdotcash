/** Executable witnesses and drift guards for the manual forward safety relation. */
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verificationTransition } from "./quint-verification-step.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const model = "formal/models/api/api_owner_vault_lifecycle.qnt";
const source = readFileSync(join(root, model), "utf8");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

function actionBlock(text: string, name: string, end: string) {
  return text.slice(
    text.indexOf(`  action ${name} =`),
    text.indexOf(end, text.indexOf(`  action ${name} =`)),
  );
}

test("only the reviewed owner source selects the explicit abstract entry point", () => {
  expect(verificationTransition(model, source)).toEqual({
    step: "verificationStep",
    kind: "forward-safety-simulation-delayed-inputs",
    sourceSha256: hash(source),
    concreteStep: "step",
  });
  expect(verificationTransition("formal/models/other.qnt", source)).toBeNull();
  const step = actionBlock(source, "step", "\n  // Verification-only");
  // Frozen original concrete dispatcher: wrappers never silently replace it.
  expect(hash(step)).toBe(
    "8f8b61577355c69d3d4c8a478ba9ac5df6fa151662fcb65b08ed404022039432",
  );
  const runner = readFileSync(join(root, "scripts/check-formal.mjs"), "utf8");
  expect(runner).toContain("? verificationTransition(input, modelText)");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Match the literal runner argument.
  expect(runner).toContain("`--step=${finiteTransition.step}`");
  expect(runner).toContain(
    'finiteTransition ?? { step: "step", kind: "concrete" }',
  );
});

test("pure consumer factoring preserves the frozen original expressions", () => {
  for (const [name, end, expected] of [
    [
      "bodyResult",
      "\n  def expectedResult",
      "2d9d2ca519d94445b382cdd1ba36f69d2decf388d26edcc475bde5adec999577",
    ],
    [
      "expectedResult",
      "\n  action body",
      "83e76660a94d4745c79d7fc1695f6d4bbe99f0e8bb073c1f3f71430f5de22159",
    ],
  ]) {
    const start = source.indexOf(`  def ${name}(`);
    const expression = source
      .slice(start, source.indexOf(end, start))
      .split(": Request = ")[1];
    expect(hash(expression)).toBe(expected);
  }
  expect(source).toContain(
    'def encodedTransaction(family: str, transaction: str): int = if (transaction == "malformed") 3 else if (transaction == "exact" or (family == "evm" and transaction == "case")) 1 else 2',
  );
});

test("early reads, narrowed domains, resampling and skipped invariant clauses need renewed review", () => {
  for (const [before, after] of [
    [
      'if (r.mode != "get" and not(origin))',
      'if (r.expected == 0 or (r.mode != "get" and not(origin)))',
    ],
    ["if (not(s.present))", 'if (r.family == "solana" or not(s.present))'],
    [
      'if (not(available)) respond(r, 503, "service-unavailable")',
      'if (r.transaction == 3 or not(available)) respond(r, 503, "service-unavailable")',
    ],
    [
      "nondet revision = 0.to(3).oneOf()\n        verificationExpected",
      "nondet revision = 1.to(2).oneOf()\n        verificationExpected",
    ],
    [
      'nondet family = Set("evm", "solana").oneOf()\n        nondet tx',
      'nondet family = Set("evm").oneOf()\n        nondet tx',
    ],
    [
      'nondet tx = Set("exact", "case", "other", "malformed").oneOf()\n        verificationBody',
      'nondet tx = Set("exact", "other").oneOf()\n        verificationBody',
    ],
    [
      'all { r.phase == "expected", 0.to(3).contains(revision)',
      'all { Set("expected", "history").contains(r.phase), 0.to(3).contains(revision)',
    ],
    [
      'r.result == "existing" implies r.captured.exists',
      'r.result == "existing" implies true or r.captured.exists',
    ],
    [
      'if (r.expected == 0) respond(r, 400, "expected")',
      'if (r.expected == 0) respond(r, 200, "expected")',
    ],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => verificationTransition(model, changed)).toThrow(
      "needs source review",
    );
  }
  expect(() =>
    verificationTransition(
      model,
      `${source}\ntemporal ignoredProperty = true\n`,
    ),
  ).toThrow("needs source review");
});

const prefix = `
  action verificationChecked(id: int, mode: str, purpose: int): bool = verificationBegin(id, mode, purpose)
    .then(headers(id, true)).then(session(id, true)).then(project(id)).then(enforcements(id)).then(authority(id))
  action verificationReady(id: int, mode: str, family: str, tx: str, revision: int): bool = verificationChecked(id, mode, 1)
    .then(service(id, true)).then(verificationBody(id, true, family, tx)).then(verificationExpected(id, revision))
  action verificationPrepared(id: int): bool = verificationReady(id, "register", "evm", "exact", 1)
    .then(chain(id, "valid")).then(appendGeneration(id)).then(appendValidation(id, true))
`;

const encodingCases = ["evm", "solana"]
  .flatMap((family) =>
    ["exact", "case", "other", "malformed"].map((tx) => {
      const encoded =
        tx === "malformed"
          ? 3
          : tx === "exact" || (family === "evm" && tx === "case")
            ? 1
            : 2;
      return `run delayedEncoding${family}${tx}Test = init.then(verificationChecked(1, "register", 1)).then(service(1, true))
      .then(verificationBody(1, true, "${family}", "${tx}"))
      .expect(s.requests.get(1).family == "${family}" and s.requests.get(1).transaction == ${encoded}
        and s.requests.get(1).phase == "expected" and invariant)`;
    }),
  )
  .join("\n");
const expectedCases = [0, 1, 2, 3]
  .map(
    (revision) => `run delayedExpected${revision}Test = init
  .then(verificationReady(1, "register", "evm", "exact", ${revision}))
  .expect(s.requests.get(1).expected == ${revision} and s.requests.get(1).phase == "${revision === 0 ? "response" : revision === 1 ? "chain" : "history"}" and invariant)`,
  )
  .join("\n");
const scenarios = `
${prefix}
${encodingCases}
${expectedCases}
  run delayedEvmReplayPrecedesExpectedTest = init.then(seedDeployment(1, "evm"))
    .then(verificationChecked(1, "register", 1)).then(service(1, true)).then(verificationBody(1, true, "evm", "case"))
    .expect(s.requests.get(1).result == "existing" and not(s.requests.get(1).chainCalled) and invariant)
  run delayedSolanaCaseIsDistinctTest = init.then(seedDeployment(1, "solana"))
    .then(verificationReady(1, "register", "solana", "case", 1)).expect(s.requests.get(1).result == "already-registered" and invariant)
  run delayedExpectedZeroPrecedesExistingAndMalformedTest = init.then(seedDeployment(1, "evm"))
    .then(verificationReady(1, "register", "evm", "malformed", 0)).expect(s.requests.get(1).result == "expected" and invariant)
  run delayedMalformedTransactionRefusesTest = init.then(verificationReady(1, "register", "solana", "malformed", 1))
    .expect(s.requests.get(1).result == "transaction" and invariant)
  run delayedInvalidBodyPrecedesReplayTest = init.then(seedDeployment(1, "evm"))
    .then(verificationChecked(1, "register", 1)).then(service(1, true)).then(verificationBody(1, false, "evm", "case"))
    .expect(s.requests.get(1).result == "body" and invariant)
  run delayedInvalidPurposePrecedesExpectedTest = init.then(verificationChecked(1, "register", 0)).then(service(1, true))
    .then(verificationBody(1, true, "solana", "malformed")).expect(s.requests.get(1).result == "body" and invariant)
  run delayedServicePrecedesReplayTest = init.then(seedDeployment(1, "evm"))
    .then(verificationChecked(1, "register", 1)).then(service(1, false)).expect(s.requests.get(1).result == "service-unavailable" and invariant)
  run delayedStaleReviewRefusesTest = init.then(edit("cap")).then(verificationReady(1, "review", "solana", "malformed", 1))
    .expect(s.requests.get(1).result == "stale-review" and invariant)
  run delayedHistoricalCapRemainsCapturedTest = init.then(edit("cap"))
    .then(verificationReady(1, "register", "evm", "exact", 1)).then(history(1))
    .expect(s.requests.get(1).creationCap == 1 and s.requests.get(1).cap == 2 and invariant)
  run delayedHistoricalPolicyChangeRefusesTest = init.then(edit("policy"))
    .then(verificationReady(1, "register", "evm", "exact", 1)).then(history(1))
    .expect(s.requests.get(1).result == "changed-policy" and invariant)
  run delayedMissingHistoryRefusesTest = init.then(verificationReady(1, "register", "evm", "exact", 3)).then(history(1))
    .expect(s.requests.get(1).result == "missing-history" and invariant)
  run delayedConcurrentRegistrationsKeepCasTest = init.then(verificationPrepared(1)).then(verificationPrepared(2))
    .then(commit(1, "ok")).then(commit(2, "ok"))
    .expect(s.head == 2 and s.requests.get(2).result == "cas" and invariant)
`;

test("deferred consumers retain encodings, all expected values, refusal order, history and concurrency", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "slop-owner-delayed-scenarios-"),
  );
  try {
    const path = join(directory, "api_owner_vault_lifecycle.qnt");
    writeFileSync(path, source.replace(/\n\}\s*$/u, `${scenarios}\n}\n`));
    const output = execFileSync(
      "node",
      [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "test",
        path,
        "--main=api_owner_vault_lifecycle",
        "--backend=typescript",
        "--seed=20261107",
        "--max-samples=1",
        "--match=^delayed.*Test$",
      ],
      { encoding: "utf8", timeout: 90000, maxBuffer: 1024 * 1024 },
    );
    expect(output).toContain("24 passing");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90000);

for (const [label, phase, deployment, materialized, witness] of [
  [
    "evm-replay",
    "body",
    '{ exists: true, transaction: 1, family: "evm" }',
    "",
    'r.result == "existing" and r.family == "evm" and r.transaction == 1',
  ],
  [
    "solana-nonreplay",
    "body",
    '{ exists: true, transaction: 1, family: "solana" }',
    "",
    'r.phase == "expected" and r.family == "solana" and r.transaction == 2',
  ],
  [
    "expected-zero-before-malformed",
    "expected",
    "absentDeployment",
    '.with("transaction", 3)',
    'r.result == "expected" and r.expected == 0',
  ],
  [
    "expected-three-remains-live",
    "expected",
    "absentDeployment",
    "",
    'r.phase == "history" and r.expected == 3',
  ],
  [
    "malformed-transaction-refusal",
    "expected",
    "absentDeployment",
    '.with("transaction", 3)',
    'r.result == "transaction" and r.expected == 1',
  ],
  [
    "stale-review-refusal",
    "expected",
    "absentDeployment",
    '.with("mode", "review").with("current", 2)',
    'r.result == "stale-review" and r.expected == 1',
  ],
] as const) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native delayed-input control reaches ${label}`,
    async () => {
      const directory = mkdtempSync(
        join(tmpdir(), "slop-owner-delayed-native-"),
      );
      try {
        const path = join(directory, "api_owner_vault_lifecycle.qnt");
        const control = `
  action controlInit = s' = { present: true, head: 1,
    history: revisions.mapBy(rev => if (rev == 1) { exists: true, kind: 1, cap: 1 } else absentPolicy),
    deployments: purposes.mapBy(_ => absentDeployment), generation: 0, restricted: false,
    banned: false, authority: "owner", requests: slots.mapBy(id => if (id == 1) idle.with("phase", "${phase}")
      .with("mode", "register").with("current", 1).with("policy", 1).with("cap", 1).with("captured", ${deployment})${materialized}
      else idle.with("phase", "done")) }
  val controlInvariant = { val r = s.requests.get(1); not(${witness}) }
`;
        writeFileSync(path, source.replace(/\n\}\s*$/u, `${control}\n}\n`));
        const env = { ...process.env };
        delete env.SLOP_QUINT_SAFETY_VIEW;
        let output = "";
        const status = await runE2ePhase({
          label: `owner-delayed-${label}`,
          command: "node",
          args: [
            "--import",
            join(root, "scripts/quint-local-translator.mjs"),
            resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
            "verify",
            path,
            "--backend=tlc",
            "--verbosity=3",
            `--tlc-config=${join(root, "formal/tlc.json")}`,
            "--init=controlInit",
            "--step=verificationStep",
            "--invariant=controlInvariant",
          ],
          cwd: root,
          env,
          timeoutMs: 170000,
          onStdout: (s: string) => {
            output += s;
          },
          onStderr: (s: string) => {
            output += s;
          },
        });
        expect(status).not.toBe(0);
        expect(output).toContain("Invariant q_inv is violated");
        expect(output).not.toContain("No error has been found");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    180000,
  );
}
