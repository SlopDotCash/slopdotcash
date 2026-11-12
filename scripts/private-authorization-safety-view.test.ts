/** Exact-source controls for the private-authorization safety VIEW. */
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  applySafetyView,
  bindSafetyView,
  readSafetyViews,
  type SafetyViewDefinition,
} from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = readSafetyViews(root);
const view = manifest.views.find(
  (entry) => entry.id === "api-private-authorization-continuation-safety-v3",
);
if (!view) throw new Error("Missing reviewed private authorization VIEW");
const selected: SafetyViewDefinition = view;
const source = readFileSync(join(root, selected.model), "utf8");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2)
    throw new Error(`Expected one audited boundary: ${from}`);
  return text.replace(from, to);
}
test("private authorization VIEW binds every source byte", () => {
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
  expect(digest(source)).toBe(
    "831c01a80956066e3dc1d3503f5ac6dcb8695c932db1e92d7f1340c4943f0fa2",
  );
});
for (const [name, before, after] of [
  [
    "write-only clock read",
    "s.session != 0, s.actor != 0,",
    "s.session != 0, s.actor != 0, s.flowUntil > 0,",
  ],
  [
    "used snapshot future read",
    "s.session != 0, s.actor != 0,",
    "s.session != 0, s.actor != 0, s.usedSession == s.session,",
  ],
  [
    "used-phase flow mutation",
    's.with("phase", "authorizing").with("flowCookie", id)',
    's.with("phase", s.phase).with("flowCookie", id)',
  ],
  [
    "terminal callback reuse",
    's.callbacks.get(id).phase == "unused",',
    'Set("unused", "done").contains(s.callbacks.get(id).phase),',
  ],
  [
    "unused payload consumer",
    's.callbacks.get(id).phase == "unused",',
    's.callbacks.get(id).phase == "unused", s.callbacks.get(id).actor == 0,',
  ],
  [
    "later nonce consumer",
    'all { c.phase == "exchange",',
    'all { c.phase == "exchange", c.nonce == c.flow,',
  ],
  [
    "seal actor consumer",
    'all { c.phase == "seal",',
    'all { c.phase == "seal", c.actor == 0,',
  ],
  [
    "distinct failed response consumer",
    'val accepted = c.result == "ok"',
    'val accepted = Set("ok", "error").contains(c.result)',
  ],
  [
    "terminal cross-slot consumer",
    "s.session != 0, s.actor != 0,",
    "s.session != 0, s.actor != 0, s.callbacks.get(2).at < s.now,",
  ],
] as const) {
  test(`private authorization future read through ${name} requires renewed review`, () => {
    const changed = replaceOnce(source, before, after);
    expect(() =>
      bindSafetyView(manifest, selected.id, selected.model, changed),
    ).toThrow("model changed");
  });
}
function fixtureBinding(tlaCode: string): SafetyViewDefinition {
  const end = tlaCode.match(/^={4,}[ \t]*$/gmu);
  if (end?.length !== 1 || !tlaCode.endsWith(`${end[0]}\n`))
    throw new Error("Native fixture module terminator differs");
  const expressions = [...selected.fields, ...selected.clauses].map(
    ({ expression }) => expression,
  );
  const projected =
    tlaCode.slice(0, -end[0].length - 1) +
    selected.operator +
    " ==\n  <<" +
    expressions.join(", ") +
    ">>\n\n" +
    end[0] +
    "\n";
  return {
    ...selected,
    translatedSha256: digest(tlaCode),
    viewTlaSha256: digest(projected),
  };
}

test("temporal, property and projection changes cannot reuse the private authorization VIEW", () => {
  const temporal = `${source}\ntemporal unsafeProperty = true\n`;
  expect(() =>
    bindSafetyView(
      { ...manifest, views: [{ ...selected, sourceSha256: digest(temporal) }] },
      selected.id,
      selected.model,
      temporal,
    ),
  ).toThrow("does not authorize temporal properties");
  const tlaCode = `---- MODULE ${selected.module} ----\nVARIABLE s\n====\n`;
  const binding = fixtureBinding(tlaCode);
  for (const changed of [
    { ...binding, fields: [{ name: "state", expression: "s" }] },
    {
      ...binding,
      clauses: [{ name: "unreviewedObservation", expression: "FALSE" }],
    },
    { ...binding, operator: "UnreviewedPrivateAuthorizationView" },
  ])
    expect(() =>
      applySafetyView(changed, {
        moduleName: selected.module,
        hasInvariant: true,
        hasTemporal: false,
        tlaCode,
      }),
    ).toThrow("property differs");
});

let translated: string | undefined;
function actualTranslatedModel() {
  if (translated !== undefined) return translated;
  const directory = mkdtempSync(join(tmpdir(), "slop-private-auth-v3-native-"));
  const output = join(directory, "production.tla");
  try {
    // Derive the complete real verify input under the native flag. This
    // intercepts TLC before any full-model graph starts.
    const capture = [
      'import {createRequire} from "node:module";',
      'import {realpathSync,writeFileSync} from "node:fs";',
      'import {pathToFileURL} from "node:url";',
      "const require=createRequire(import.meta.url);",
      'const cli=realpathSync("./node_modules/.bin/quint");',
      "delete process.env.SLOP_QUINT_SAFETY_VIEW;",
      'process.argv=[process.execPath,cli,"verify",' +
        JSON.stringify(selected.model) +
        ',"--backend=tlc","--invariant=invariant","--verbosity=0"];',
      'await import(pathToFileURL(process.cwd()+"/scripts/quint-local-translator.mjs").href);',
      'require("@informalsystems/quint/dist/src/tlc.js").verify=async config=>{',
      "writeFileSync(" +
        JSON.stringify(output) +
        ",config.tlaCode);process.exit(0);};",
      "await import(pathToFileURL(cli).href);",
    ].join("\n");
    execFileSync("node", ["--input-type=module", "-e", capture], {
      cwd: root,
      encoding: "utf8",
      timeout: 90_000,
    });
    translated = readFileSync(output, "utf8");
    expect(digest(translated)).toBe(selected.translatedSha256);
    // Check the real production hash and full long terminator, not just a
    // synthetic four-equals fixture. No ignored local evidence file is read.
    const prepared = applySafetyView(selected, {
      moduleName: selected.module,
      hasInvariant: true,
      hasTemporal: false,
      tlaCode: translated,
    });
    expect(digest(prepared.tlaCode)).toBe(selected.viewTlaSha256);
    const end = translated.match(/^={4,}[ \t]*$/gmu);
    if (end?.length !== 1) throw new Error("Production TLA terminator differs");
    expect(
      prepared.tlaCode.startsWith(translated.slice(0, -end[0].length - 1)),
    ).toBe(true);
    return translated;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const initial =
  '[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0]';
type NativeCase = {
  name: string;
  initial: string;
  step: string;
  witness: string;
  witnessState?: 3;
};
function nativeFixture(control: NativeCase) {
  let tla = actualTranslatedModel();
  tla = replaceOnce(
    tla,
    "q_init == init",
    "SlopControlInitial == " +
      control.initial +
      "\n\nSlopControlStep == " +
      control.step +
      "\n\nSlopControlWitness == " +
      control.witness +
      "\n\nq_init == s = SlopControlInitial",
  );
  // Only the named witness determines a negative control. An unrelated
  // production-invariant failure must never satisfy it accidentally.
  tla = replaceOnce(tla, "q_inv == invariant", "q_inv == ~SlopControlWitness");
  return replaceOnce(tla, "q_step == step", "q_step == SlopControlStep");
}

async function runNative(tla: string, useView = true) {
  const binding = fixtureBinding(tla);
  const probe = [
    'import {readFileSync} from "node:fs";',
    'import {createRequire} from "node:module";',
    'import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from "./scripts/quint-safety-view.mjs";',
    "const require=createRequire(import.meta.url);",
    "const manifest=readSafetyViews(process.cwd());",
    `const view=${JSON.stringify(binding)};`,
    "const config={moduleName:view.module,tlaCode:" +
      JSON.stringify(tla) +
      ",hasInvariant:true,hasTemporal:false};",
    "const prepared=" +
      (useView ? "applySafetyView(view,config)" : "config") +
      ";",
    'const runner=loadSafetyViewTlc(require.resolve("@informalsystems/quint/dist/src/tlc.js"),manifest);',
    'const result=await runner.verify(prepared,"0.62.4",JSON.parse(readFileSync("formal/tlc.json","utf8")),3);',
    'if(result.isLeft()){if(result.value.isViolation){console.log("PRIVATE_AUTH_VIEW_NAMED_WITNESS_FOUND");process.exitCode=1;}',
    'else{console.log("PRIVATE_AUTH_VIEW_NATIVE_ERROR");process.exitCode=2;}}else console.log("PRIVATE_AUTH_VIEW_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "private-authorization-view-native-control",
    command: "node",
    args: ["--input-type=module", "-e", probe],
    cwd: root,
    env: process.env,
    timeoutMs: 90_000,
    onStdout: (text: string) => {
      output += text;
    },
    onStderr: (text: string) => {
      output += text;
    },
  });
  return { status, output };
}

const cases: NativeCase[] = [
  {
    name: "usedSession false with another clause already false",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.phase = "used", !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.usedFlow = 1, !.usedSession = 1, !.usedActor = 1, !.usedSubmission = 1, !.usedAt = 0, !.usedUntil = 4, !.usedActor = 2]',
    step: "s' = [s EXCEPT !.usedSession = 2]",
    witness: "~(s.usedSession = flow(s.usedFlow).session)",
  },
  {
    name: "usedSession healing with another clause still false",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.phase = "used", !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.usedFlow = 1, !.usedSession = 1, !.usedActor = 1, !.usedSubmission = 1, !.usedAt = 0, !.usedUntil = 4, !.usedSession = 2, !.usedActor = 2]',
    step: "s' = [s EXCEPT !.usedSession = 1]",
    witness: "s.usedSession = flow(s.usedFlow).session",
  },
  {
    name: "usedActor false with another clause already false",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.phase = "used", !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.usedFlow = 1, !.usedSession = 1, !.usedActor = 1, !.usedSubmission = 1, !.usedAt = 0, !.usedUntil = 4, !.usedSubmission = 2]',
    step: "s' = [s EXCEPT !.usedActor = 2]",
    witness: "~(s.usedActor = flow(s.usedFlow).actor)",
  },
  {
    name: "usedActor healing with another clause still false",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.phase = "used", !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.usedFlow = 1, !.usedSession = 1, !.usedActor = 1, !.usedSubmission = 1, !.usedAt = 0, !.usedUntil = 4, !.usedActor = 2, !.usedSubmission = 2]',
    step: "s' = [s EXCEPT !.usedActor = 1]",
    witness: "s.usedActor = flow(s.usedFlow).actor",
  },
  {
    name: "usedSubmission false with another clause already false",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.phase = "used", !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.usedFlow = 1, !.usedSession = 1, !.usedActor = 1, !.usedSubmission = 1, !.usedAt = 0, !.usedUntil = 4, !.usedSession = 2]',
    step: "s' = [s EXCEPT !.usedSubmission = 2]",
    witness: "~(s.usedSubmission = flow(s.usedFlow).submission)",
  },
  {
    name: "usedSubmission healing with another clause still false",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.phase = "used", !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.usedFlow = 1, !.usedSession = 1, !.usedActor = 1, !.usedSubmission = 1, !.usedAt = 0, !.usedUntil = 4, !.usedSubmission = 2, !.usedSession = 2]',
    step: "s' = [s EXCEPT !.usedSubmission = 1]",
    witness: "s.usedSubmission = flow(s.usedFlow).submission",
  },
  {
    name: "usedAt false with another clause already false",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.phase = "used", !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.usedFlow = 1, !.usedSession = 1, !.usedActor = 1, !.usedSubmission = 1, !.usedAt = 0, !.usedUntil = 4, !.usedActor = 2]',
    step: "s' = [s EXCEPT !.usedAt = 4]",
    witness: "~(s.usedAt < s.usedUntil)",
  },
  {
    name: "usedAt healing with another clause still false",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.phase = "used", !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.usedFlow = 1, !.usedSession = 1, !.usedActor = 1, !.usedSubmission = 1, !.usedAt = 0, !.usedUntil = 4, !.usedAt = 4, !.usedActor = 2]',
    step: "s' = [s EXCEPT !.usedAt = 0]",
    witness: "s.usedAt < s.usedUntil",
  },
  {
    name: "consumed code domain",
    initial:
      '[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0]',
    step: "s' = [s EXCEPT !.consumedCodes = {3}]",
    witness: "~(s.consumedCodes \\subseteq {1,2})",
  },
  {
    name: "cookie flow existence",
    initial:
      '[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0]',
    step: "s' = [s EXCEPT !.flowCookie = 1]",
    witness: "s.flowCookie # 0 /\\ ~flow(s.flowCookie).exists",
  },
  {
    name: "grant flow existence",
    initial:
      '[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0]',
    step: "s' = [s EXCEPT !.hasGrant = TRUE, !.grant = 1]",
    witness: "s.hasGrant /\\ ~flow(s.grant).exists",
  },
  {
    name: "grant code consumption",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.flows[1].exists = TRUE]',
    step: "s' = [s EXCEPT !.hasGrant = TRUE, !.grant = 1]",
    witness: "s.hasGrant /\\ ~(s.grant \\in s.consumedCodes)",
  },
  {
    name: "nonce before validation",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.flowCookie = 1, !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.flows[2] = [exists |-> TRUE, session |-> 2, actor |-> 2, submission |-> 2, until |-> 3], !.callbacks[1] = [phase |-> "validate", flow |-> 1, nonce |-> 1, actor |-> 1, at |-> 0, result |-> "none"]]',
    step: "IF s.callbacks[1].nonce = 1 THEN s' = [s EXCEPT !.callbacks[1].nonce = 2] ELSE validate(1, TRUE, TRUE)",
    witness:
      's.callbacks[1].phase = "response" /\\ s.callbacks[1].result = "state-mismatch"',
  },
  {
    name: "captured time before validation",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.flowCookie = 1, !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.flows[2] = [exists |-> TRUE, session |-> 2, actor |-> 2, submission |-> 2, until |-> 3], !.callbacks[1] = [phase |-> "validate", flow |-> 1, nonce |-> 1, actor |-> 1, at |-> 0, result |-> "none"]]',
    step: "IF s.callbacks[1].at = 0 THEN s' = [s EXCEPT !.callbacks[1].at = 2] ELSE validate(1, TRUE, TRUE)",
    witness:
      's.callbacks[1].phase = "response" /\\ s.callbacks[1].result = "flow-missing"',
  },
  {
    name: "flow before provider exchange",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.flowCookie = 1, !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.flows[2] = [exists |-> TRUE, session |-> 2, actor |-> 2, submission |-> 2, until |-> 3], !.callbacks[1] = [phase |-> "exchange", flow |-> 1, nonce |-> 1, actor |-> 1, at |-> 0, result |-> "none"]]',
    step: "IF s.callbacks[1].flow = 1 THEN s' = [s EXCEPT !.callbacks[1].flow = 2] ELSE exchange(1, TRUE)",
    witness: "2 \\in s.consumedCodes",
  },
  {
    name: "actor through exchange and identity",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.flowCookie = 1, !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.flows[2] = [exists |-> TRUE, session |-> 2, actor |-> 2, submission |-> 2, until |-> 3], !.callbacks[1] = [phase |-> "exchange", flow |-> 1, nonce |-> 1, actor |-> 1, at |-> 0, result |-> "none"]]',
    step: 'IF s.callbacks[1].actor = 1 THEN s\' = [s EXCEPT !.callbacks[1].actor = 2] ELSE IF s.callbacks[1].phase = "exchange" THEN exchange(1, TRUE) ELSE identify(1,1,TRUE)',
    witness: 's.callbacks[1].result = "identity-mismatch"',
  },
  {
    name: "identity actor mismatch",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.flowCookie = 1, !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.flows[2] = [exists |-> TRUE, session |-> 2, actor |-> 2, submission |-> 2, until |-> 3], !.callbacks[1] = [phase |-> "identity", flow |-> 1, nonce |-> 1, actor |-> 1, at |-> 0, result |-> "none"]]',
    step: "IF s.callbacks[1].actor = 1 THEN s' = [s EXCEPT !.callbacks[1].actor = 2] ELSE identify(1,1,TRUE)",
    witness: 's.callbacks[1].result = "identity-mismatch"',
  },
  {
    name: "successful response flow",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.flowCookie = 1, !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.flows[2] = [exists |-> TRUE, session |-> 2, actor |-> 2, submission |-> 2, until |-> 3], !.callbacks[1] = [phase |-> "response", flow |-> 1, nonce |-> 1, actor |-> 1, at |-> 0, result |-> "none"], !.callbacks[1].result = "ok"]',
    step: "IF s.callbacks[1].flow = 1 THEN s' = [s EXCEPT !.callbacks[1].flow = 2] ELSE deliver(1)",
    witness: "s.grant = 2",
  },
  {
    name: "successful response captured time",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.flowCookie = 1, !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.flows[2] = [exists |-> TRUE, session |-> 2, actor |-> 2, submission |-> 2, until |-> 3], !.callbacks[1] = [phase |-> "response", flow |-> 1, nonce |-> 1, actor |-> 1, at |-> 0, result |-> "none"], !.callbacks[1].result = "ok"]',
    step: "IF s.callbacks[1].at = 0 THEN s' = [s EXCEPT !.callbacks[1].at = 1] ELSE deliver(1)",
    witness: "s.grantUntil = 5",
  },
  {
    name: "response success class",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.flowCookie = 1, !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.flows[2] = [exists |-> TRUE, session |-> 2, actor |-> 2, submission |-> 2, until |-> 3], !.callbacks[1] = [phase |-> "response", flow |-> 1, nonce |-> 1, actor |-> 1, at |-> 0, result |-> "none"], !.callbacks[1].result = "error"]',
    step: 'IF s.callbacks[1].result = "error" THEN s\' = [s EXCEPT !.callbacks[1].result = "ok"] ELSE deliver(1)',
    witness: "s.hasGrant",
  },
  {
    name: "used raw snapshot overwritten by actual use",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.phase = "used", !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.usedFlow = 1, !.usedSession = 1, !.usedActor = 1, !.usedSubmission = 1, !.usedAt = 0, !.usedUntil = 4, !.hasGrant = TRUE, !.grant = 1, !.grantUntil = 4, !.usedSession = 2, !.usedActor = 2, !.usedSubmission = 2, !.usedAt = 8]',
    step: "useGrant",
    witness:
      "s.usedSession = 1 /\\ s.usedActor = 1 /\\ s.usedSubmission = 1 /\\ s.usedAt < s.usedUntil",
  },
  {
    name: "unused full reset by actual capture",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.flowCookie = 1, !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.flows[2] = [exists |-> TRUE, session |-> 2, actor |-> 2, submission |-> 2, until |-> 3], !.callbacks[1] = [phase |-> "unused", flow |-> 1, nonce |-> 1, actor |-> 1, at |-> 0, result |-> "none"], !.callbacks[1].flow = 2, !.callbacks[1].nonce = 2, !.callbacks[1].actor = 2, !.callbacks[1].at = 7, !.callbacks[1].result = "error"]',
    step: "capture(1,1,0)",
    witness:
      's.callbacks[1].phase = "validate" /\\ s.callbacks[1].flow = 1 /\\ s.callbacks[1].at = 0 /\\ s.callbacks[1].nonce = 1 /\\ s.callbacks[1].actor = 0',
  },
];
const state = (changes: string) => `[${initial} EXCEPT ${changes}]`;
cases.push(
  {
    name: "live cookie expiry before final consumption",
    initial: state(
      "!.flowCookie = 1, !.now = 1, !.flows[1].exists = TRUE, !.flows[1].until = 2",
    ),
    step: "IF s.flows[1].until = 2 THEN s' = [s EXCEPT !.flows[1].until = 1] ELSE expireCookie",
    witness: "s.flowCookie = 0",
  },
  {
    name: "pending validation expiry after a different cookie replaces it",
    initial: state(
      '!.flowCookie = 2, !.flows[1].exists = TRUE, !.flows[1].until = 2, !.flows[2].exists = TRUE, !.callbacks[1] = [phase |-> "validate", flow |-> 1, nonce |-> 1, actor |-> 1, at |-> 1, result |-> "none"]',
    ),
    step: "IF s.flows[1].until = 2 THEN s' = [s EXCEPT !.flows[1].until = 1] ELSE validate(1,TRUE,TRUE)",
    witness: 's.callbacks[1].result = "flow-missing"',
  },
  {
    name: "false used observation healing on phase exit",
    initial: state(
      '!.phase = "used", !.usedFlow = 1, !.usedActor = 2, !.flows[1].exists = TRUE, !.flows[1].actor = 1',
    ),
    step: 's\' = [s EXCEPT !.phase = "authorizing"]',
    witness: '(s.phase = "used" => s.usedActor = flow(s.usedFlow).actor)',
  },
);
// Retired identity is dead only after every possible future reader is gone.
// Keep separate raw historical observations even in already-invalid prefixes.
for (const field of ["session", "actor", "submission"] as const) {
  const used = `used${field[0].toUpperCase()}${field.slice(1)}`;
  for (const healing of [false, true]) {
    cases.push({
      name: `retired flow ${field} ${healing ? "heals" : "breaks"} its own historical observation`,
      initial: state(
        `!.phase = "used", !.usedFlow = 1, !.usedSession = 1, !.usedActor = 1, !.usedSubmission = 1, !.usedAt = 8, !.usedUntil = 1, !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.flows[1].${field} = ${healing ? 2 : 1}`,
      ),
      step: `s' = [s EXCEPT !.flows[1].${field} = ${healing ? 1 : 2}]`,
      witness: `${healing ? "" : "~"}(s.${used} = flow(s.usedFlow).${field})`,
    });
  }
  cases.push({
    name: `current grant ${field} remains live before actual use`,
    witnessState: 3,
    initial: state(
      `!.phase = "used", !.usedFlow = 1, !.usedSession = 0, !.usedActor = 0, !.usedSubmission = 0, !.usedAt = 8, !.usedUntil = 1, !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.flows[1].${field} = 2, !.hasGrant = TRUE, !.grant = 1, !.grantUntil = 4, !.consumedCodes = {1}`,
    ),
    step: `IF s.flows[1].${field} = 2 THEN s' = [s EXCEPT !.flows[1].${field} = 1] ELSE useGrant`,
    witness: '(s.phase = "used" => s.usedAt < s.usedUntil)',
  });
  for (const [name, changes] of [
    ["current cookie", "!.flowCookie = 1"],
    [
      "pending validation",
      '!.callbacks[1].phase = "validate", !.callbacks[1].flow = 1',
    ],
    [
      "pending exchange",
      '!.callbacks[1].phase = "exchange", !.callbacks[1].flow = 1',
    ],
    [
      "pending identity",
      '!.callbacks[1].phase = "identity", !.callbacks[1].flow = 1',
    ],
    ["pending seal", '!.callbacks[1].phase = "seal", !.callbacks[1].flow = 1'],
    [
      "accepted response",
      '!.callbacks[1].phase = "response", !.callbacks[1].flow = 1, !.callbacks[1].result = "ok"',
    ],
    ["non-existing flow", "!.flows[1].exists = FALSE"],
  ] as const) {
    cases.push({
      name: `${name} conservatively retains flow ${field}`,
      initial: state(
        `!.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], ${changes}`,
      ),
      step: `s' = [s EXCEPT !.flows[1].${field} = 2]`,
      witness: `s.flows[1].${field} = 2`,
    });
  }
}
cases.push({
  name: "retained flow actor reaches the actual provider identity check",
  initial: state(
    '!.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.callbacks[1] = [phase |-> "identity", flow |-> 1, nonce |-> 1, actor |-> 0, at |-> 0, result |-> "none"]',
  ),
  step: "IF s.flows[1].actor = 1 THEN s' = [s EXCEPT !.flows[1].actor = 2] ELSE identify(1,1,TRUE)",
  witness: 's.callbacks[1].phase = "response" /\\ s.callbacks[1].result # "ok"',
});
for (const control of cases) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native private authorization VIEW retains ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain("State 2:");
      if (control.witnessState === 3)
        expect(result.output).toContain("State 3:");
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).toContain("PRIVATE_AUTH_VIEW_NAMED_WITNESS_FOUND");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );
}
const coalescingCases = [
  {
    name: "write-only output and inactive used snapshots",
    initial:
      '[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0]',
    step: "s' = [s EXCEPT !.flowUntil = 8, !.usedFlow = 2, !.usedSession = 2, !.usedActor = 2, !.usedSubmission = 2, !.usedAt = 8, !.usedUntil = 1]",
  },
  {
    name: "unused full-reset payload",
    initial:
      '[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0]',
    step: 's\' = [s EXCEPT !.callbacks[1].flow = 2, !.callbacks[1].nonce = 2, !.callbacks[1].actor = 2, !.callbacks[1].at = 8, !.callbacks[1].result = "error"]',
  },
  {
    name: "done absorbing payload",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.flowCookie = 1, !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.flows[2] = [exists |-> TRUE, session |-> 2, actor |-> 2, submission |-> 2, until |-> 3], !.callbacks[1] = [phase |-> "done", flow |-> 1, nonce |-> 1, actor |-> 1, at |-> 0, result |-> "none"]]',
    step: 's\' = [s EXCEPT !.callbacks[1].flow = 2, !.callbacks[1].nonce = 2, !.callbacks[1].actor = 2, !.callbacks[1].at = 8, !.callbacks[1].result = "error"]',
  },
  {
    name: "failed response result and ignored successful payload",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.flowCookie = 1, !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.flows[2] = [exists |-> TRUE, session |-> 2, actor |-> 2, submission |-> 2, until |-> 3], !.callbacks[1] = [phase |-> "response", flow |-> 1, nonce |-> 1, actor |-> 1, at |-> 0, result |-> "none"], !.callbacks[1].result = "error"]',
    step: 's\' = [s EXCEPT !.callbacks[1].flow = 2, !.callbacks[1].at = 8, !.callbacks[1].nonce = 2, !.callbacks[1].actor = 2, !.callbacks[1].result = "identity-mismatch"]',
  },
  {
    name: "consumed nonce and seal actor",
    initial:
      '[[phase |-> "idle", session |-> 1, actor |-> 1, submission |-> 1, now |-> 0, flowCookie |-> 0, flowUntil |-> 0, flows |-> [id \\in {1,2} |-> [exists |-> FALSE, session |-> 0, actor |-> 0, submission |-> 0, until |-> 0]], callbacks |-> [id \\in {1,2} |-> [phase |-> "unused", flow |-> 0, nonce |-> 0, actor |-> 0, at |-> 0, result |-> "none"]], consumedCodes |-> {}, hasGrant |-> FALSE, grant |-> 0, grantUntil |-> 0, grantIntact |-> TRUE, usedFlow |-> 0, usedSession |-> 0, usedActor |-> 0, usedSubmission |-> 0, usedAt |-> 0, usedUntil |-> 0] EXCEPT !.flowCookie = 1, !.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], !.flows[2] = [exists |-> TRUE, session |-> 2, actor |-> 2, submission |-> 2, until |-> 3], !.callbacks[1] = [phase |-> "seal", flow |-> 1, nonce |-> 1, actor |-> 1, at |-> 0, result |-> "none"]]',
    step: 's\' = [s EXCEPT !.callbacks[1].nonce = 2, !.callbacks[1].actor = 2, !.callbacks[1].result = "error"]',
  },
];
coalescingCases.push(
  {
    name: "non-used global phase labels",
    initial,
    step: 's\' = [s EXCEPT !.phase = "callback-error"]',
  },
  {
    name: "healthy used phase and an unobserved non-used label",
    initial: state('!.phase = "used", !.usedAt = 0, !.usedUntil = 4'),
    step: 's\' = [s EXCEPT !.phase = "idle"]',
  },
  {
    name: "a permanently retired flow expiry",
    initial: state(
      '!.flowCookie = 2, !.flows[1].exists = TRUE, !.flows[1].until = 2, !.flows[2].exists = TRUE, !.callbacks[1].phase = "identity", !.callbacks[1].flow = 1',
    ),
    step: "s' = [s EXCEPT !.flows[1].until = 7]",
  },
  {
    name: "retired expiry even with a false cookie invariant",
    initial: state(
      "!.flowCookie = 3, !.flows[1].exists = TRUE, !.flows[1].until = 2",
    ),
    step: "s' = [s EXCEPT !.flows[1].until = 7]",
  },
);
for (const [name, changes] of [
  ["retired identity with unused callback payload", "!.callbacks[1].flow = 1"],
  [
    "retired identity with a done callback",
    '!.callbacks[1].phase = "done", !.callbacks[1].flow = 1, !.callbacks[1].result = "ok"',
  ],
  [
    "retired identity with a failed response",
    '!.callbacks[1].phase = "response", !.callbacks[1].flow = 1, !.callbacks[1].result = "error"',
  ],
  ["retired identity with a consumed code", "!.consumedCodes = {1}"],
  [
    "retired identity beside another live grant",
    "!.flows[2].exists = TRUE, !.hasGrant = TRUE, !.grant = 2, !.consumedCodes = {2}",
  ],
  [
    "retired identity with three historical clauses already false",
    '!.phase = "used", !.usedFlow = 1, !.usedSession = 0, !.usedActor = 0, !.usedSubmission = 0, !.usedAt = 8, !.usedUntil = 1',
  ],
] as const) {
  coalescingCases.push({
    name,
    initial: state(
      `!.flows[1] = [exists |-> TRUE, session |-> 1, actor |-> 1, submission |-> 1, until |-> 2], ${changes}`,
    ),
    step: "s' = [s EXCEPT !.flows[1].session = 2, !.flows[1].actor = 2, !.flows[1].submission = 2]",
  });
}
for (const control of coalescingCases) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native private authorization VIEW coalesces only ${control.name}`,
    async () => {
      const tla = nativeFixture({ ...control, witness: "FALSE" });
      const raw = await runNative(tla, false);
      expect(raw.status, raw.output).toBe(0);
      expect(raw.output).toMatch(/2 distinct states? found/u);
      expect(raw.output).toMatch(/0 states? left on queue/u);
      const viewed = await runNative(tla);
      expect(viewed.status, viewed.output).toBe(0);
      expect(viewed.output).toMatch(/1 distinct states? found/u);
      expect(viewed.output).toMatch(/0 states? left on queue/u);
    },
    120_000,
  );
}

test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native private authorization V2 keeps a non-existing flow deadline conservative",
  async () => {
    const result = await runNative(
      nativeFixture({
        name: "non-existing conservative expiry",
        initial: state("!.flowCookie = 2, !.flows[1].until = 2"),
        step: "s' = [s EXCEPT !.flows[1].until = 7]",
        witness: "FALSE",
      }),
    );
    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(/2 distinct states? found/u);
  },
  120_000,
);

for (const [name, before, after] of [
  [
    "future global phase consumer",
    's.callbacks.get(id).phase == "unused",',
    's.callbacks.get(id).phase == "unused", s.phase == "idle",',
  ],
  [
    "future identity expiry consumer",
    'all { c.phase == "identity", ids.contains(providerActor),',
    'all { c.phase == "identity", ids.contains(providerActor), c.at < f.until,',
  ],
  [
    "existing-flow reselection",
    "not(flow(id).exists), s.now <= 2,",
    "true, s.now <= 2,",
  ],
  [
    "cookie restoration from a switch",
    'action switchSession = s\' = s.with("session", 2)',
    'action switchSession = s\' = s.with("session", 2).with("flowCookie", 1)',
  ],
  [
    "callback validation rewind",
    'if (accepted) c.with("phase", "identity") else response(c, "exchange-failed")',
    'if (accepted) c.with("phase", "validate") else response(c, "exchange-failed")',
  ],
  [
    "dead-flow identity read by a switch",
    'action switchSession = s\' = s.with("session", 2)',
    'action switchSession = all { flow(1).session == 1, s\' = s.with("session", 2) }',
  ],
  [
    "grant restoration from a switch",
    'action switchSession = s\' = s.with("session", 2)',
    'action switchSession = s\' = s.with("session", 2).with("grant", 1)',
  ],
  [
    "failed delivery restoring a flow grant",
    '.with("grant", if (accepted) c.flow else s.grant)',
    '.with("grant", c.flow)',
  ],
] as const) {
  test(`private authorization V3 refuses ${name}`, () => {
    const changed = replaceOnce(source, before, after);
    expect(() =>
      bindSafetyView(manifest, selected.id, selected.model, changed),
    ).toThrow("model changed");
  });
}
