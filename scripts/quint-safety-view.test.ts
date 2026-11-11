import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  applySafetyView,
  bindSafetyView,
  patchTlcConfig,
  readSafetyViews,
} from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = readSafetyViews(root);
const view = manifest.views[0];
const source = readFileSync(resolve(root, view.model), "utf8");
const require = createRequire(import.meta.url);
const adapter = require.resolve("@informalsystems/quint/dist/src/tlc.js");
const adapterSource = readFileSync(adapter, "utf8");
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

function fixtureBinding(tlaCode: string, selectedView = view) {
  const expressions = [
    ...selectedView.fields.map(
      (field: { expression: string }) => field.expression,
    ),
    ...selectedView.clauses.map(
      (clause: { expression: string }) => clause.expression,
    ),
  ];
  const definition = `${selectedView.operator} ==\n  <<${expressions.join(", ")}>>\n\n`;
  const expected = tlaCode.replace("====\n", `${definition}====\n`);
  return {
    expected,
    binding: {
      ...selectedView,
      translatedSha256: sha256(tlaCode),
      viewTlaSha256: sha256(expected),
    },
  };
}

test("journal view binds the reviewed model bytes and refuses other requests", () => {
  expect(bindSafetyView(manifest, view.id, view.model, source)).toEqual(view);
  expect(() => bindSafetyView(manifest, "unknown", view.model, source)).toThrow(
    "Unknown TLC safety-view request",
  );
  expect(() =>
    bindSafetyView(manifest, view.id, "formal/models/other.qnt", source),
  ).toThrow("Unknown TLC safety-view request");
  expect(() =>
    bindSafetyView(manifest, view.id, view.model, `${source}\n`),
  ).toThrow("model changed");
  const temporal = `${source}\ntemporal newProperty = true\n`;
  const temporalManifest = {
    ...manifest,
    views: [{ ...view, sourceSha256: sha256(temporal) }],
  };
  expect(() =>
    bindSafetyView(temporalManifest, view.id, view.model, temporal),
  ).toThrow("does not authorize temporal properties");
});

for (const selected of manifest.views.slice(1)) {
  test(`${selected.id} binds its own complete source and preserves the concrete TLA body`, () => {
    const model = readFileSync(resolve(root, selected.model), "utf8");
    expect(
      bindSafetyView(manifest, selected.id, selected.model, model),
    ).toEqual(selected);
    expect(() =>
      bindSafetyView(manifest, selected.id, selected.model, `${model}\n`),
    ).toThrow("model changed");
    const tlaCode = `---- MODULE ${selected.module} ----\nVARIABLE s\n====\n`;
    const { binding, expected } = fixtureBinding(tlaCode, selected);
    const config = {
      moduleName: selected.module,
      hasInvariant: true,
      hasTemporal: false,
      tlaCode,
    };
    expect(applySafetyView(binding, config).tlaCode).toBe(expected);
    expect(() =>
      applySafetyView(binding, { ...config, hasTemporal: true }),
    ).toThrow("property differs");
    expect(() =>
      applySafetyView(
        { ...binding, fields: [{ name: "state", expression: "s" }] },
        config,
      ),
    ).toThrow("property differs");
    expect(() =>
      applySafetyView({ ...binding, operator: view.operator }, config),
    ).toThrow("property differs");
    expect(() =>
      applySafetyView(binding, { ...config, tlaCode: `${tlaCode}\n` }),
    ).toThrow("generated TLA changed");
    expect(() =>
      applySafetyView({ ...binding, viewTlaSha256: "0".repeat(64) }, config),
    ).toThrow("projection changed");
  });
}

test("view insertion preserves the complete TLA body and rejects drift", () => {
  const tlaCode = "---- MODULE direct_bounty_journal ----\nVARIABLE s\n====\n";
  const { binding, expected } = fixtureBinding(tlaCode);
  const config = {
    moduleName: view.module,
    hasInvariant: true,
    hasTemporal: false,
    tlaCode,
  };
  const result = applySafetyView(binding, config);
  expect(result.tlaCode).toBe(expected);
  expect(result.slopSafetyView).toBe(view.operator);
  expect(result.viewEvidence.viewTlaSha256).toBe(sha256(result.tlaCode));
  expect(
    result.viewEvidence.clauses.map((clause: { name: string }) => clause.name),
  ).toEqual(["ownership", "frame"]);
  expect(() =>
    applySafetyView(binding, { ...config, hasTemporal: true }),
  ).toThrow("property differs");
  expect(() =>
    applySafetyView({ ...binding, operator: "Unknown" }, config),
  ).toThrow("property differs");
  expect(() =>
    applySafetyView({ ...binding, hashMode: "unreviewed" }, config),
  ).toThrow("property differs");
  expect(() =>
    applySafetyView({ ...binding, memoryCandidateMode: "unreviewed" }, config),
  ).toThrow("property differs");
  expect(() =>
    applySafetyView(binding, { ...config, moduleName: "other" }),
  ).toThrow("property differs");
  expect(() =>
    applySafetyView(binding, { ...config, tlaCode: `${tlaCode}\n` }),
  ).toThrow("generated TLA changed");
  expect(() =>
    applySafetyView({ ...binding, viewTlaSha256: "0".repeat(64) }, config),
  ).toThrow("projection changed");
  expect(() =>
    applySafetyView(
      { ...binding, clauses: binding.clauses.slice(0, 1) },
      config,
    ),
  ).toThrow("property differs");
});

test("pinned official runner changes only the config VIEW emission", () => {
  const patched = patchTlcConfig(adapterSource, manifest.quintAdapterSha256);
  const inserted =
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Match the exact generated JavaScript statement.
    "    if (config.slopSafetyView) cfg += `VIEW ${config.slopSafetyView}\\n`;\n";
  expect(patched.split(inserted)).toHaveLength(2);
  expect(patched.replace(inserted, "")).toBe(adapterSource);
  expect(() =>
    patchTlcConfig(`${adapterSource}\n`, manifest.quintAdapterSha256),
  ).toThrow("adapter changed");
  expect(() =>
    patchTlcConfig("different module", sha256("different module")),
  ).toThrow("config emitter differs");
});

test("pinned Node loads official runner exports through unchanged dependency resolution", () => {
  const output = execFileSync(
    "node",
    [
      "--input-type=module",
      "-e",
      `import {readSafetyViews,loadSafetyViewTlc} from './scripts/quint-safety-view.mjs';
       const result=loadSafetyViewTlc(${JSON.stringify(adapter)},readSafetyViews(process.cwd()));
       console.log(JSON.stringify({verify:typeof result.verify,adapter:result.adapterSha256,overlay:result.overlaySha256}));`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  expect(JSON.parse(output)).toEqual({
    verify: "function",
    adapter: manifest.quintAdapterSha256,
    overlay: sha256(patchTlcConfig(adapterSource, manifest.quintAdapterSha256)),
  });
});

for (const [kind, update, initialHash, hashInvariant] of [
  [
    "store-candidate",
    "!.store[1].candidate = 1, !.before = s.store, !.touched = 1",
    0,
    "s.store[1].candidate = 0",
  ],
  ["retained-field", "!.used = {4}", 0, "TRUE"],
  [
    "ownership-only",
    "!.wrote = TRUE, !.expected = 1, !.observed = 2",
    0,
    "TRUE",
  ],
  [
    "frame-only",
    "!.touched = 1, !.before[2] = [s.store[2] EXCEPT !.hash = 2]",
    0,
    "TRUE",
  ],
  [
    "zero-to-positive hash",
    "!.store[1].hash = 1, !.before = s.store, !.touched = 1",
    0,
    "s.store[1].hash = 0",
  ],
  [
    "positive-to-zero hash",
    "!.store[1].hash = 0, !.before = s.store, !.touched = 1",
    1,
    "s.store[1].hash > 0",
  ],
] as const) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `the real TLC view runner reports the ${kind} counterexample`,
    async () => {
      // A tiny test-only TLA input exercises the real official runner. It is not
      // added to the production allowlist and proves no application behavior.
      const tla = `---- MODULE direct_bounty_journal ----
EXTENDS Naturals, FiniteSets
VARIABLE s
entry(n) == [request |-> n, transaction |-> n, hash |-> ${initialHash}, candidate |-> 0]
initialStore == [n \\in {1,2} |-> entry(n)]
q_init == s = [store |-> initialStore,
 memory |-> [q \\in {1,2} |-> initialStore],
 held |-> [q \\in {1,2} |-> [nonce |-> 0, request |-> 0, transaction |-> 0]],
 used |-> {1,2}, mounted |-> [q \\in {1,2} |-> TRUE],
 before |-> initialStore, touched |-> 0,
 observed |-> 0, expected |-> 0, wrote |-> FALSE,
 warning |-> [q \\in {1,2} |-> FALSE], checked |-> [q \\in {1,2} |-> 0],
 emptyInput |-> [q \\in {1,2} |-> {}]]
q_step == s' = [s EXCEPT ${update}]
q_inv == s.used \\subseteq {1,2,3}
 /\\ ${view.clauses.map((clause: { expression: string }) => clause.expression).join("\n /\\ ")}
 /\\ (${hashInvariant})
====
`;
      const { binding } = fixtureBinding(tla);
      const probe = `
      import {readFileSync} from 'node:fs';
      import {createRequire} from 'node:module';
      import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from './scripts/quint-safety-view.mjs';
      const require=createRequire(import.meta.url);
      const manifest=readSafetyViews(process.cwd());
      const tla=${JSON.stringify(tla)};
      const view=${JSON.stringify(binding)};
      const prepared=applySafetyView(view,{moduleName:view.module,tlaCode:tla,hasInvariant:true,hasTemporal:false});
      const runner=loadSafetyViewTlc(require.resolve('@informalsystems/quint/dist/src/tlc.js'),manifest);
      const result=await runner.verify(prepared,'0.62.4',JSON.parse(readFileSync('formal/tlc.json','utf8')),3);
      if(!result.isLeft()||!result.value.isViolation)process.exit(2);
      console.log('VIEW_COUNTEREXAMPLE_CONFIRMED');
      process.exit(1);
    `;
      let output = "";
      const status = await runE2ePhase({
        label: "tlc-safety-view-counterexample",
        command: "node",
        args: ["--input-type=module", "-e", probe],
        cwd: root,
        env: process.env,
        timeoutMs: 170_000,
        onStdout: (text: string) => {
          output += text;
        },
        onStderr: (text: string) => {
          output += text;
        },
      });
      expect(status).toBe(1);
      expect(output).toContain("Invariant q_inv is violated");
      expect(output).toContain("VIEW_COUNTEREXAMPLE_CONFIRMED");
      expect(output).not.toContain("No error has been found");
    },
    180_000,
  );
}

const ownerState = `[head |-> 1,
  history |-> [r \\in {1,2,3} |-> [exists |-> r = 1]],
  deployments |-> [p \\in {1,2} |-> [exists |-> p = 1]],
  requests |-> [i \\in {1,2} |-> [phase |-> "response", status |-> 200, noStore |-> TRUE,
    expected |-> 2, transaction |-> 2, policy |-> 2, cap |-> 2, creationRevision |-> 2,
    creationCap |-> 2, restricted |-> TRUE, banned |-> TRUE, canSetup |-> TRUE,
    appendGeneration |-> 2, received |-> TRUE, result |-> "none", committed |-> 0,
    purpose |-> 1, mode |-> "get", family |-> "evm", captured |-> [exists |-> FALSE, family |-> "evm"],
    current |-> 0, responseRevision |-> 0, chainCalled |-> FALSE]]]`;

const lookupState = `[session |-> 1, loginVersion |-> [a \\in {1,2} |-> 1], dataVersion |-> 1,
  cache |-> [k \\in {1,2,3,4} |-> [version |-> 1, subject |-> 1]],
  legacyCache |-> [k \\in {1,2} |-> [version |-> 1, subject |-> 1]],
  requests |-> [i \\in {1,2} |-> [phase |-> "response", attempt |-> 1, route |-> "owned",
    hit |-> FALSE, actor |-> 1, providerReads |-> 0, status |-> 200, policy |-> "private-300",
    method |-> "POST", transport |-> FALSE, expected |-> 2, loginValid |-> FALSE,
    repository |-> 2, cacheEnabled |-> FALSE, login |-> 2, selected |-> 0,
    selectedExpected |-> 2, delivered |-> TRUE, key |-> 1, payload |-> 1,
    subject |-> 1, waitUntil |-> TRUE, putPending |-> FALSE]]]`;

for (const [id, observation, initial, update, invariant] of [
  [
    "owner-vault-terminal-safety-v3",
    "no-store",
    ownerState,
    "!.requests[1].noStore = FALSE",
    "(s.requests[1].status > 0 => s.requests[1].noStore)",
  ],
  [
    "owner-vault-terminal-safety-v3",
    "existing-replay",
    ownerState,
    '!.requests[1].result = "existing"',
    '(s.requests[1].result = "existing" => (s.requests[1].captured.exists /\\ s.requests[1].captured.family = s.requests[1].family /\\ ~s.requests[1].chainCalled /\\ s.requests[1].committed = 0 /\\ s.requests[1].responseRevision = s.requests[1].current))',
  ],
  [
    "owner-vault-terminal-safety-v3",
    "registered-receipt",
    ownerState,
    '!.requests[1].result = "registered"',
    '(s.requests[1].result = "registered" => (s.requests[1].committed > 0 /\\ s.requests[1].responseRevision = s.requests[1].committed))',
  ],
  [
    "owner-vault-terminal-safety-v3",
    "pending-without-commit",
    `[${ownerState} EXCEPT !.requests[1].committed = 1]`,
    '!.requests[1].result = "pending"',
    '(s.requests[1].result = "pending" => s.requests[1].committed = 0)',
  ],
  [
    "owner-vault-terminal-safety-v3",
    "bounty-funds-authority",
    ownerState,
    '!.requests[1].result = "funds"',
    '(s.requests[1].result = "funds" => (s.requests[1].mode = "get" /\\ s.requests[1].purpose = 2))',
  ],
  [
    "owner-vault-terminal-safety-v3",
    "committed-history-index",
    ownerState,
    "!.requests[1].committed = 2",
    "(s.requests[1].committed > 0 => (s.history[s.requests[1].committed].exists /\\ s.deployments[s.requests[1].purpose].exists))",
  ],
  [
    "owner-vault-terminal-safety-v3",
    "committed-purpose-index",
    `[${ownerState} EXCEPT !.requests[1].committed = 1]`,
    "!.requests[1].purpose = 2",
    "(s.requests[1].committed > 0 => (s.history[s.requests[1].committed].exists /\\ s.deployments[s.requests[1].purpose].exists))",
  ],
  [
    "owner-vault-terminal-safety-v3",
    "active-review-expected",
    `[${ownerState} EXCEPT !.requests[1].phase = "expected", !.requests[1].mode = "review", !.requests[1].expected = 1, !.requests[1].current = 1]`,
    "!.requests[1].expected = 2",
    "s.requests[1].expected = s.requests[1].current",
  ],
  [
    "owner-vault-terminal-safety-v3",
    "active-register-expected",
    `[${ownerState} EXCEPT !.requests[1].phase = "expected", !.requests[1].mode = "register", !.requests[1].expected = 1]`,
    "!.requests[1].expected = 2",
    "s.requests[1].expected = 1",
  ],
  [
    "owner-vault-terminal-safety-v3",
    "active-register-transaction",
    `[${ownerState} EXCEPT !.requests[1].phase = "body", !.requests[1].mode = "register", !.requests[1].transaction = 1]`,
    "!.requests[1].transaction = 2",
    "s.requests[1].transaction = 1",
  ],
  [
    "owner-vault-terminal-safety-v3",
    "active-register-family",
    `[${ownerState} EXCEPT !.requests[1].phase = "body", !.requests[1].mode = "register", !.requests[1].family = "evm"]`,
    '!.requests[1].family = "solana"',
    's.requests[1].family = "evm"',
  ],
  [
    "owner-vault-terminal-safety-v3",
    "active-operation-mode",
    `[${ownerState} EXCEPT !.requests[1].phase = "headers", !.requests[1].mode = "get"]`,
    '!.requests[1].mode = "review"',
    's.requests[1].mode = "get"',
  ],
  [
    "project-lookup-cache-observation-safety-v3",
    "cache-hit-authority",
    `[${lookupState} EXCEPT !.requests[1].actor = 0]`,
    "!.requests[1].hit = TRUE",
    "(s.requests[1].hit => s.requests[1].actor # 0 /\\ s.requests[1].providerReads = 0 /\\ s.requests[1].status = 200)",
  ],
  [
    "project-lookup-cache-observation-safety-v3",
    "wrong-owned-subject",
    lookupState,
    "!.requests[1].subject = 2",
    '(s.requests[1].route = "owned" /\\ s.requests[1].status = 200 => s.requests[1].subject = s.requests[1].actor /\\ s.requests[1].actor # 0)',
  ],
  [
    "project-lookup-cache-observation-safety-v3",
    "authenticated-actor",
    lookupState,
    "!.requests[1].actor = 0",
    '(s.requests[1].route = "owned" /\\ s.requests[1].status = 200 => s.requests[1].subject = s.requests[1].actor /\\ s.requests[1].actor # 0)',
  ],
  [
    "project-lookup-cache-observation-safety-v3",
    "pending-put-key",
    `[${lookupState} EXCEPT !.requests[1].putPending = TRUE]`,
    "!.requests[1].key = 2",
    "s.requests[1].key = 1",
  ],
  [
    "project-lookup-cache-observation-safety-v3",
    "retry-attempt-bound",
    lookupState,
    "!.requests[1].attempt = 3",
    "s.requests[1].attempt <= 2",
  ],
  [
    "project-lookup-cache-observation-safety-v3",
    "pending-payload-positivity",
    `[${lookupState} EXCEPT !.requests[1].putPending = TRUE]`,
    "!.requests[1].payload = 0",
    "(s.requests[1].putPending => s.requests[1].status = 200 /\\ s.requests[1].payload > 0)",
  ],
  [
    "project-lookup-cache-observation-safety-v3",
    "cache-version-positivity",
    lookupState,
    "!.cache[1].version = 0",
    "s.cache[1].version > 0",
  ],
  [
    "project-lookup-cache-observation-safety-v3",
    "cache-subject-partition",
    lookupState,
    "!.cache[1].subject = 2",
    "s.cache[1].subject = 1",
  ],
  [
    "project-lookup-cache-observation-safety-v3",
    "data-version-positivity",
    lookupState,
    "!.dataVersion = 0",
    "s.dataVersion > 0",
  ],
  [
    "project-lookup-cache-observation-safety-v3",
    "public-response-policy",
    lookupState,
    '!.requests[1].policy = "no-store"',
    '(s.requests[1].status = 200 /\\ s.requests[1].route \\in {"owned", "repository"} => s.requests[1].policy = "private-300")',
  ],
  [
    "project-lookup-cache-observation-safety-v3",
    "selected-actor-handoff",
    `[${lookupState} EXCEPT !.requests[1].phase = "enforcement-handoff", !.requests[1].selected = 1, !.requests[1].providerReads = 1]`,
    "!.requests[1].selected = 0",
    '(s.requests[1].phase = "enforcement-handoff" => s.requests[1].selected # 0 /\\ s.requests[1].providerReads = 1)',
  ],
  [
    "project-lookup-cache-observation-safety-v3",
    "active-selection-expected",
    `[${lookupState} EXCEPT !.requests[1].phase = "selection-actor", !.requests[1].selectedExpected = 1]`,
    "!.requests[1].selectedExpected = 2",
    "s.requests[1].selectedExpected = 1",
  ],
  [
    "project-lookup-cache-observation-safety-v3",
    "matched-dispatch-expected",
    `[${lookupState} EXCEPT !.requests[1].phase = "dispatch", !.requests[1].method = "GET", !.requests[1].transport = TRUE, !.requests[1].expected = 1]`,
    "!.requests[1].expected = 2",
    "s.requests[1].expected = 1",
  ],
] as const) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `the real ${id} runner retains the ${observation} counterexample`,
    async () => {
      const selected = manifest.views.find(
        (candidate: { id: string }) => candidate.id === id,
      );
      if (!selected) throw new Error("Missing reviewed safety view");
      const tla = `---- MODULE ${selected.module} ----
EXTENDS Integers, FiniteSets
VARIABLE s
q_init == s = ${initial}
q_step == s' = [s EXCEPT ${update}]
q_inv == ${invariant}
====
`;
      const { binding } = fixtureBinding(tla, selected);
      const probe = `
        import {readFileSync} from 'node:fs';
        import {createRequire} from 'node:module';
        import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from './scripts/quint-safety-view.mjs';
        const require=createRequire(import.meta.url);
        const manifest=readSafetyViews(process.cwd());
        const view=${JSON.stringify(binding)};
        const prepared=applySafetyView(view,{moduleName:view.module,tlaCode:${JSON.stringify(tla)},hasInvariant:true,hasTemporal:false});
        const runner=loadSafetyViewTlc(require.resolve('@informalsystems/quint/dist/src/tlc.js'),manifest);
        const result=await runner.verify(prepared,'0.62.4',JSON.parse(readFileSync('formal/tlc.json','utf8')),3);
        if(!result.isLeft()||!result.value.isViolation)process.exit(2);
        console.log('VIEW_COUNTEREXAMPLE_CONFIRMED');
        process.exit(1);
      `;
      let output = "";
      const status = await runE2ePhase({
        label: "tlc-safety-view-counterexample",
        command: "node",
        args: ["--input-type=module", "-e", probe],
        cwd: root,
        env: process.env,
        timeoutMs: 170_000,
        onStdout: (text: string) => {
          output += text;
        },
        onStderr: (text: string) => {
          output += text;
        },
      });
      expect(status).toBe(1);
      expect(output).toContain("Invariant q_inv is violated");
      expect(output).toContain("VIEW_COUNTEREXAMPLE_CONFIRMED");
      expect(output).not.toContain("No error has been found");
    },
    180_000,
  );
}
