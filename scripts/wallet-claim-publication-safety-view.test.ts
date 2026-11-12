/** Exact-source controls for the wallet claim publication safety VIEW. */
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
  (entry) => entry.id === "wallet-claim-publication-continuation-safety-v1",
);
if (!view) throw new Error("Missing reviewed wallet claim publication VIEW");
const selected: SafetyViewDefinition = view;
const source = readFileSync(join(root, selected.model), "utf8");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2)
    throw new Error(`Expected one source boundary: ${from}`);
  return text.replace(from, to);
}
test("wallet claim publication VIEW binds the complete unchanged model", () => {
  expect(digest(source)).toBe(
    "2f2532269fc71a1e85482284bfe132ea278c1fc89254d1462d2cb7b7bb5b3151",
  );
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
});
for (const [name, before, after] of [
  [
    "a created-time digest reader",
    "and a.observed == b.observed",
    "and a.created == b.created and a.observed == b.observed",
  ],
  [
    "a request existence reader",
    'all { request.phase == "batch", s\' = s',
    'all { request.phase == "batch", request.claim.exists, s\' = s',
  ],
  [
    "material read before capture",
    'val accepted = valid and (request.mode != "operator" or request.claim.observed <= s.now)',
    'val accepted = valid and request.claim.material == 1 and (request.mode != "operator" or request.claim.observed <= s.now)',
  ],
  [
    "source overwritten during capture",
    'val claim = request.claim.with("id", 2 + (slot - 1) * 2 + request.attempt)',
    'val claim = request.claim.with("source", "registry").with("id", 2 + (slot - 1) * 2 + request.attempt)',
  ],
  [
    "retry without a full claim reset",
    'val claim = absent.with("actor", actor)',
    'val claim = prior.claim.with("actor", actor)',
  ],
  [
    "terminal activation of committed state",
    'request.with("phase", "done").with("response", if (delivered) request.desired else "lost")',
    'request.with("phase", "done").with("outcome", "committed").with("response", if (delivered) request.desired else "lost")',
  ],
  [
    "a distinct noncommitted outcome reader",
    'request.outcome == "committed" and received and metadataValid',
    'Set("committed", "constraint").contains(request.outcome) and received and metadataValid',
  ],
  [
    "a terminal desired-status guard",
    'all { request.phase == "reply", s\' = s.with("requests",',
    'all { request.phase == "reply", request.desired == "409", s\' = s.with("requests",',
  ],
  [
    "a retained creation invariant",
    "request.attempt >= 0, request.attempt <= 2,",
    "request.attempt >= 0, request.attempt <= 2, request.claim.created >= 0,",
  ],
] as const)
  test(`wallet claim source drift through ${name} requires renewed review`, () => {
    const changed = replaceOnce(source, before, after);
    expect(() =>
      bindSafetyView(manifest, selected.id, selected.model, changed),
    ).toThrow("model changed");
  });
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

test("temporal, property and projection changes cannot reuse the wallet claim publication VIEW", () => {
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
    { ...binding, operator: "UnreviewedWalletClaimPublicationView" },
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
  const directory = mkdtempSync(
    join(tmpdir(), "slop-wallet-claim-publication-native-"),
  );
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
    "SlopClaimControlBase == " +
      initial +
      "\n\nSlopControlInitial == " +
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
    'if(result.isLeft()){if(result.value.isViolation){console.log("WALLET_CLAIM_VIEW_NAMED_WITNESS_FOUND");process.exitCode=1;}',
    'else{console.log("WALLET_CLAIM_VIEW_NATIVE_ERROR");process.exitCode=2;}}else console.log("WALLET_CLAIM_VIEW_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "wallet-claim-publication-view-native-control",
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

const initial =
  "[configured |-> TRUE, now |-> 0, history |-> [i \\in {1,2,3,4,5,6} |-> absent], heads |-> [i \\in {1,2,3,4,5,6,7,8} |-> 0], audits |-> {}, notices |-> {}, requests |-> [i \\in {1,2} |-> idle], reads |-> 0, observedCurrent |-> 0]";
const cases: NativeCase[] = [
  {
    name: "clock lower bound",
    initial: "SlopClaimControlBase",
    step: "s' = [s EXCEPT !.now = -1]",
    witness: "s.now < 0",
  },
  {
    name: "clock upper bound",
    initial: "SlopClaimControlBase",
    step: "s' = [s EXCEPT !.now = 3]",
    witness: "s.now > 2",
  },
  {
    name: "audits exactly covers new rows",
    initial: "SlopClaimControlBase",
    step: "s' = [s EXCEPT !.audits = {3}]",
    witness: "s.audits # {i \\in {3,4,5,6}: s.history[i].exists}",
  },
  {
    name: "notices exactly covers new rows",
    initial: "SlopClaimControlBase",
    step: "s' = [s EXCEPT !.notices = {3}]",
    witness: "s.notices # {i \\in {3,4,5,6}: s.history[i].exists}",
  },
  {
    name: "history id",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry")]',
    step: "s' = [s EXCEPT !.history[3].id = 4]",
    witness: "s.history[3].id # 3",
  },
  {
    name: "history actor",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry")]',
    step: "s' = [s EXCEPT !.history[3].actor = 3]",
    witness: "~(s.history[3].actor \\in {1,2})",
  },
  {
    name: "history chain",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry")]',
    step: "s' = [s EXCEPT !.history[3].chain = 5]",
    witness: "~(s.history[3].chain \\in {1,2,3,4})",
  },
  {
    name: "history predecessor",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry")]',
    step: "s' = [s EXCEPT !.history[3].predecessor = 1]",
    witness:
      "s.history[3].predecessor # 0 /\\ ~claimAt(s.history[3].predecessor).exists",
  },
  {
    name: "digest uniqueness",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry"), !.history[4] = [seed(4,1,1,"registry") EXCEPT !.address = 2]]',
    step: "s' = [s EXCEPT !.history[4].address = 1]",
    witness: "sameDigest(s.history[3],s.history[4])",
  },
  {
    name: "root uniqueness",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[1] = seed(1,1,1,"registry"), !.history[2] = seed(2,2,1,"registry")]',
    step: "s' = [s EXCEPT !.history[2].actor = 1]",
    witness:
      "s.history[1].predecessor = 0 /\\ s.history[2].predecessor = 0 /\\ s.history[1].actor = s.history[2].actor /\\ s.history[1].chain = s.history[2].chain",
  },
  {
    name: "successor uniqueness",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = [seed(3,1,1,"registry") EXCEPT !.predecessor = 1], !.history[4] = [seed(4,1,1,"registry") EXCEPT !.predecessor = 2]]',
    step: "s' = [s EXCEPT !.history[4].predecessor = 1]",
    witness:
      "s.history[3].predecessor # 0 /\\ s.history[3].predecessor = s.history[4].predecessor",
  },
  {
    name: "head existence",
    initial: "SlopClaimControlBase",
    step: "s' = [s EXCEPT !.heads[1] = 3]",
    witness: "s.heads[1] # 0 /\\ ~claimAt(s.heads[1]).exists",
  },
  {
    name: "head lineage",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry"), !.heads[1] = 3]',
    step: "s' = [s EXCEPT !.history[3].actor = 2]",
    witness: "lineage(claimAt(s.heads[1]).actor,claimAt(s.heads[1]).chain) # 1",
  },
  {
    name: "head has no later successor",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry"), !.history[4] = seed(4,1,1,"registry"), !.heads[1] = 3]',
    step: "s' = [s EXCEPT !.history[4].predecessor = 3]",
    witness: "s.history[4].predecessor = s.heads[1]",
  },
  {
    name: "slot1 attempt bound -1",
    initial: '[SlopClaimControlBase EXCEPT !.requests[1].phase = "done"]',
    step: "s' = [s EXCEPT !.requests[1].attempt = -1]",
    witness: "s.requests[1].attempt < 0 \\/ s.requests[1].attempt > 2",
  },
  {
    name: "slot1 attempt bound 3",
    initial: '[SlopClaimControlBase EXCEPT !.requests[1].phase = "done"]',
    step: "s' = [s EXCEPT !.requests[1].attempt = 3]",
    witness: "s.requests[1].attempt < 0 \\/ s.requests[1].attempt > 2",
  },
  {
    name: "slot1 returned row missing",
    initial: '[SlopClaimControlBase EXCEPT !.requests[1].phase = "done"]',
    step: "s' = [s EXCEPT !.requests[1].returned = 3]",
    witness:
      "~(s.requests[1].returned = 0 \\/ (claimAt(s.requests[1].returned).exists /\\ claimAt(s.requests[1].returned).actor = s.requests[1].claim.actor /\\ claimAt(s.requests[1].returned).chain = s.requests[1].claim.chain))",
  },
  {
    name: "slot1 returned row actor",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry"), !.requests[1] = [idle EXCEPT !.phase = "done", !.returned = 3]]',
    step: "s' = [s EXCEPT !.requests[1].claim.actor = 2]",
    witness:
      "~(s.requests[1].returned = 0 \\/ (claimAt(s.requests[1].returned).exists /\\ claimAt(s.requests[1].returned).actor = s.requests[1].claim.actor /\\ claimAt(s.requests[1].returned).chain = s.requests[1].claim.chain))",
  },
  {
    name: "slot1 returned row chain",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry"), !.requests[1] = [idle EXCEPT !.phase = "done", !.returned = 3]]',
    step: "s' = [s EXCEPT !.requests[1].claim.chain = 2]",
    witness:
      "~(s.requests[1].returned = 0 \\/ (claimAt(s.requests[1].returned).exists /\\ claimAt(s.requests[1].returned).actor = s.requests[1].claim.actor /\\ claimAt(s.requests[1].returned).chain = s.requests[1].claim.chain))",
  },
  {
    name: "slot1 desired creation class",
    initial: '[SlopClaimControlBase EXCEPT !.requests[1].phase = "done"]',
    step: 's\' = [s EXCEPT !.requests[1].desired = "201"]',
    witness:
      '~(s.requests[1].desired = "201" => (s.requests[1].outcome = "committed" /\\ s.requests[1].returned = s.requests[1].claim.id))',
  },
  {
    name: "slot1 committed lookup",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "done", !.claim = seed(3,1,1,"registry")]]',
    step: 's\' = [s EXCEPT !.requests[1].outcome = "committed"]',
    witness:
      '~(s.requests[1].outcome = "committed" => (claimAt(s.requests[1].claim.id).exists /\\ s.requests[1].claim.id \\in s.audits))',
  },
  {
    name: "slot1 committed audit",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry"), !.audits = {3}, !.requests[1] = [idle EXCEPT !.phase = "done", !.outcome = "committed", !.claim = seed(3,1,1,"registry")]]',
    step: "s' = [s EXCEPT !.audits = {}]",
    witness:
      '~(s.requests[1].outcome = "committed" => (claimAt(s.requests[1].claim.id).exists /\\ s.requests[1].claim.id \\in s.audits))',
  },
  {
    name: "slot2 attempt bound -1",
    initial: '[SlopClaimControlBase EXCEPT !.requests[2].phase = "done"]',
    step: "s' = [s EXCEPT !.requests[2].attempt = -1]",
    witness: "s.requests[2].attempt < 0 \\/ s.requests[2].attempt > 2",
  },
  {
    name: "slot2 attempt bound 3",
    initial: '[SlopClaimControlBase EXCEPT !.requests[2].phase = "done"]',
    step: "s' = [s EXCEPT !.requests[2].attempt = 3]",
    witness: "s.requests[2].attempt < 0 \\/ s.requests[2].attempt > 2",
  },
  {
    name: "slot2 returned row missing",
    initial: '[SlopClaimControlBase EXCEPT !.requests[2].phase = "done"]',
    step: "s' = [s EXCEPT !.requests[2].returned = 3]",
    witness:
      "~(s.requests[2].returned = 0 \\/ (claimAt(s.requests[2].returned).exists /\\ claimAt(s.requests[2].returned).actor = s.requests[2].claim.actor /\\ claimAt(s.requests[2].returned).chain = s.requests[2].claim.chain))",
  },
  {
    name: "slot2 returned row actor",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry"), !.requests[2] = [idle EXCEPT !.phase = "done", !.returned = 3]]',
    step: "s' = [s EXCEPT !.requests[2].claim.actor = 2]",
    witness:
      "~(s.requests[2].returned = 0 \\/ (claimAt(s.requests[2].returned).exists /\\ claimAt(s.requests[2].returned).actor = s.requests[2].claim.actor /\\ claimAt(s.requests[2].returned).chain = s.requests[2].claim.chain))",
  },
  {
    name: "slot2 returned row chain",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry"), !.requests[2] = [idle EXCEPT !.phase = "done", !.returned = 3]]',
    step: "s' = [s EXCEPT !.requests[2].claim.chain = 2]",
    witness:
      "~(s.requests[2].returned = 0 \\/ (claimAt(s.requests[2].returned).exists /\\ claimAt(s.requests[2].returned).actor = s.requests[2].claim.actor /\\ claimAt(s.requests[2].returned).chain = s.requests[2].claim.chain))",
  },
  {
    name: "slot2 desired creation class",
    initial: '[SlopClaimControlBase EXCEPT !.requests[2].phase = "done"]',
    step: 's\' = [s EXCEPT !.requests[2].desired = "201"]',
    witness:
      '~(s.requests[2].desired = "201" => (s.requests[2].outcome = "committed" /\\ s.requests[2].returned = s.requests[2].claim.id))',
  },
  {
    name: "slot2 committed lookup",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[2] = [idle EXCEPT !.phase = "done", !.claim = seed(3,1,1,"registry")]]',
    step: 's\' = [s EXCEPT !.requests[2].outcome = "committed"]',
    witness:
      '~(s.requests[2].outcome = "committed" => (claimAt(s.requests[2].claim.id).exists /\\ s.requests[2].claim.id \\in s.audits))',
  },
  {
    name: "slot2 committed audit",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry"), !.audits = {3}, !.requests[2] = [idle EXCEPT !.phase = "done", !.outcome = "committed", !.claim = seed(3,1,1,"registry")]]',
    step: "s' = [s EXCEPT !.audits = {}]",
    witness:
      '~(s.requests[2].outcome = "committed" => (claimAt(s.requests[2].claim.id).exists /\\ s.requests[2].claim.id \\in s.audits))',
  },
  {
    name: "returned row heals on actual other-slot batch",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "done", !.returned = 3], !.requests[2] = [idle EXCEPT !.phase = "batch", !.attempt = 1, !.claim = seed(3,1,1,"registry")]]',
    step: "batch(2,TRUE)",
    witness:
      "(s.requests[1].returned = 0 \\/ (claimAt(s.requests[1].returned).exists /\\ claimAt(s.requests[1].returned).actor = s.requests[1].claim.actor /\\ claimAt(s.requests[1].returned).chain = s.requests[1].claim.chain))",
  },
  {
    name: "committed row heals on actual other-slot batch",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "done", !.outcome = "committed", !.claim = seed(3,1,1,"registry")], !.requests[2] = [idle EXCEPT !.phase = "batch", !.attempt = 1, !.claim = seed(3,1,1,"registry")]]',
    step: "batch(2,TRUE)",
    witness:
      '(s.requests[1].outcome = "committed" => (claimAt(s.requests[1].claim.id).exists /\\ s.requests[1].claim.id \\in s.audits))',
  },
  {
    name: "returned row can break on a false-prefix overwrite",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry"), !.audits = {3}, !.notices = {3}, !.requests[1] = [idle EXCEPT !.phase = "done", !.returned = 3], !.requests[2] = [idle EXCEPT !.phase = "batch", !.attempt = 1, !.claim = [seed(3,2,1,"registry") EXCEPT !.address = 2]]]',
    step: "batch(2,TRUE)",
    witness:
      "~(s.requests[1].returned = 0 \\/ (claimAt(s.requests[1].returned).exists /\\ claimAt(s.requests[1].returned).actor = s.requests[1].claim.actor /\\ claimAt(s.requests[1].returned).chain = s.requests[1].claim.chain))",
  },
  {
    name: "pre-capture ID remains live under 201",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry"), !.audits = {3}, !.requests[1] = [idle EXCEPT !.phase = "authority", !.desired = "201", !.returned = 3, !.outcome = "committed", !.claim = seed(3,1,1,"registry")]]',
    step: "s' = [s EXCEPT !.requests[1].claim.id = 4]",
    witness:
      '~(s.requests[1].desired = "201" => (s.requests[1].outcome = "committed" /\\ s.requests[1].returned = s.requests[1].claim.id))',
  },
  {
    name: "pre-capture ID remains live under commit",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry"), !.audits = {3}, !.requests[1] = [idle EXCEPT !.phase = "authority", !.outcome = "committed", !.claim = seed(3,1,1,"registry")]]',
    step: "s' = [s EXCEPT !.requests[1].claim.id = 4]",
    witness:
      '~(s.requests[1].outcome = "committed" => (claimAt(s.requests[1].claim.id).exists /\\ s.requests[1].claim.id \\in s.audits))',
  },
  {
    name: "retry retains actor",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "done", !.attempt = 1, !.claim.actor = 2]]',
    step: 'IF s.requests[1].claim.actor = 2 THEN s\' = [s EXCEPT !.requests[1].claim.actor = 1] ELSE begin(1,"contributor",1,1,1,1,0,"registry",0,1)',
    witness: 's.requests[1].phase = "authority"',
    witnessState: 3,
  },
  {
    name: "retry retains chain",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "done", !.attempt = 1, !.claim.chain = 2]]',
    step: 'IF s.requests[1].claim.chain = 2 THEN s\' = [s EXCEPT !.requests[1].claim.chain = 1] ELSE begin(1,"contributor",1,1,1,1,0,"registry",0,1)',
    witness: 's.requests[1].phase = "authority"',
    witnessState: 3,
  },
  {
    name: "retry retains mode",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "done", !.attempt = 1, !.mode = "operator"]]',
    step: 'IF s.requests[1].mode = "operator" THEN s\' = [s EXCEPT !.requests[1].mode = "contributor"] ELSE begin(1,"contributor",1,1,1,1,0,"registry",0,1)',
    witness: 's.requests[1].phase = "authority"',
    witnessState: 3,
  },
  {
    name: "actual retry resets an already false201 condition",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "done", !.attempt = 1, !.desired = "201", !.claim = seed(3,1,1,"registry")]]',
    step: 'begin(1,"contributor",1,1,1,1,0,"registry",0,1)',
    witness:
      '(s.requests[1].desired = "201" => (s.requests[1].outcome = "committed" /\\ s.requests[1].returned = s.requests[1].claim.id))',
  },
  {
    name: "live contributor source reaches the digest reader",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[1] = seed(1,1,1,"registry"), !.requests[1] = [idle EXCEPT !.phase = "digest-read", !.attempt = 1, !.claim = [seed(3,1,1,"registry") EXCEPT !.source = "historical"]]]',
    step: 'IF s.requests[1].claim.source = "historical" THEN s\' = [s EXCEPT !.requests[1].claim.source = "registry"] ELSE readDigest(1,TRUE)',
    witness: "s.requests[1].returned = 1",
    witnessState: 3,
  },
  {
    name: "operator observation is live before body",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "body", !.mode = "operator", !.claim = seed(3,1,1,"registry")]]',
    step: "IF s.requests[1].claim.observed = 0 THEN s' = [s EXCEPT !.requests[1].claim.observed = 1] ELSE body(1,TRUE)",
    witness: 's.requests[1].phase = "reply"',
    witnessState: 3,
  },
  {
    name: "operator observed remains live after capture",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[1] = seed(1,1,1,"registry"), !.requests[1] = [idle EXCEPT !.phase = "digest-read", !.attempt = 1, !.mode = "operator", !.claim = seed(3,1,1,"registry")]]',
    step: "IF s.requests[1].claim.observed = 0 THEN s' = [s EXCEPT !.requests[1].claim.observed = 1] ELSE readDigest(1,TRUE)",
    witness: 's.requests[1].phase = "batch"',
    witnessState: 3,
  },
  {
    name: "operator material remains live after capture",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[1] = seed(1,1,1,"registry"), !.requests[1] = [idle EXCEPT !.phase = "digest-read", !.attempt = 1, !.mode = "operator", !.claim = seed(3,1,1,"registry")]]',
    step: "IF s.requests[1].claim.material = 1 THEN s' = [s EXCEPT !.requests[1].claim.material = 2] ELSE readDigest(1,TRUE)",
    witness: 's.requests[1].phase = "batch"',
    witnessState: 3,
  },
  {
    name: "contributor observed remains live after capture",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[1] = seed(1,1,1,"registry"), !.requests[1] = [idle EXCEPT !.phase = "digest-read", !.attempt = 1, !.mode = "contributor", !.claim = seed(3,1,1,"registry")]]',
    step: "IF s.requests[1].claim.observed = 0 THEN s' = [s EXCEPT !.requests[1].claim.observed = 1] ELSE readDigest(1,TRUE)",
    witness: 's.requests[1].phase = "batch"',
    witnessState: 3,
  },
  {
    name: "contributor material remains live after capture",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[1] = seed(1,1,1,"registry"), !.requests[1] = [idle EXCEPT !.phase = "digest-read", !.attempt = 1, !.mode = "contributor", !.claim = seed(3,1,1,"registry")]]',
    step: "IF s.requests[1].claim.material = 1 THEN s' = [s EXCEPT !.requests[1].claim.material = 2] ELSE readDigest(1,TRUE)",
    witness: 's.requests[1].phase = "batch"',
    witnessState: 3,
  },
  {
    name: "actual contributor capture overwrites only dead inputs",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "capture", !.attempt = 1, !.claim = [seed(6,1,1,"registry") EXCEPT !.observed = 2, !.material = 2, !.created = 2]]]',
    step: "capture(1)",
    witness:
      's.requests[1].phase = "hash" /\\ s.requests[1].claim.id = 3 /\\ s.requests[1].claim.observed = s.now /\\ s.requests[1].claim.material = 1',
  },
  {
    name: "committed class reaches actual batch-result",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry"), !.audits = {3}, !.requests[1] = [idle EXCEPT !.phase = "batch-result", !.attempt = 1, !.claim = seed(3,1,1,"registry")]]',
    step: 'IF s.requests[1].outcome # "committed" THEN s\' = [s EXCEPT !.requests[1].outcome = "committed"] ELSE batchResult(1,TRUE,TRUE)',
    witness: 's.requests[1].phase = "reply"',
    witnessState: 3,
  },
];
const coalescingCases = [
  {
    name: "write-only read and reply outputs",
    initial: "SlopClaimControlBase",
    step: 's\' = [s EXCEPT !.observedCurrent = 6, !.requests[1].tip = 6, !.requests[1].disposition = "created", !.requests[1].response = "lost"]',
  },
  {
    name: "whole creation copy cone",
    initial:
      '[SlopClaimControlBase EXCEPT !.history[3] = seed(3,1,1,"registry")]',
    step: "s' = [s EXCEPT !.history[3].created = 2, !.requests[1].claim.created = 2, !.requests[2].claim.created = 1]",
  },
  {
    name: "candidate existence before batch",
    initial: '[SlopClaimControlBase EXCEPT !.requests[1].phase = "batch"]',
    step: "s' = [s EXCEPT !.requests[1].claim.exists = TRUE]",
  },
  {
    name: "inactive pre-capture ID",
    initial: '[SlopClaimControlBase EXCEPT !.requests[1].phase = "authority"]',
    step: "s' = [s EXCEPT !.requests[1].claim.id = 6]",
  },
  {
    name: "contributor authority overwritten observation/material",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "authority", !.claim = seed(3,1,1,"registry")]]',
    step: "s' = [s EXCEPT !.requests[1].claim.observed = 2, !.requests[1].claim.material = 2]",
  },
  {
    name: "contributor body overwritten observation/material",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "body", !.claim = seed(3,1,1,"registry")]]',
    step: "s' = [s EXCEPT !.requests[1].claim.observed = 2, !.requests[1].claim.material = 2]",
  },
  {
    name: "contributor tip overwritten observation/material",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "tip", !.claim = seed(3,1,1,"registry")]]',
    step: "s' = [s EXCEPT !.requests[1].claim.observed = 2, !.requests[1].claim.material = 2]",
  },
  {
    name: "contributor capture overwritten observation/material",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "capture", !.claim = seed(3,1,1,"registry")]]',
    step: "s' = [s EXCEPT !.requests[1].claim.observed = 2, !.requests[1].claim.material = 2]",
  },
  {
    name: "unused nonidentity payload",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "unused", !.attempt = 1]]',
    step: 's\' = [s EXCEPT !.requests[1].claim.id = 6, !.requests[1].claim.address = 2, !.requests[1].claim.login = 3, !.requests[1].claim.source = "historical", !.requests[1].claim.observed = 2, !.requests[1].claim.created = 2, !.requests[1].claim.predecessor = 6, !.requests[1].claim.material = 2]',
  },
  {
    name: "reply nonidentity payload",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "reply", !.attempt = 1]]',
    step: 's\' = [s EXCEPT !.requests[1].claim.id = 6, !.requests[1].claim.address = 2, !.requests[1].claim.login = 3, !.requests[1].claim.source = "historical", !.requests[1].claim.observed = 2, !.requests[1].claim.created = 2, !.requests[1].claim.predecessor = 6, !.requests[1].claim.material = 2]',
  },
  {
    name: "done nonidentity payload",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "done", !.attempt = 1]]',
    step: 's\' = [s EXCEPT !.requests[1].claim.id = 6, !.requests[1].claim.address = 2, !.requests[1].claim.login = 3, !.requests[1].claim.source = "historical", !.requests[1].claim.observed = 2, !.requests[1].claim.created = 2, !.requests[1].claim.predecessor = 6, !.requests[1].claim.material = 2]',
  },
  {
    name: "noncommitted classes before their only consumer",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "batch-result", !.outcome = "rolled-back"]]',
    step: 's\' = [s EXCEPT !.requests[1].outcome = "constraint"]',
  },
  {
    name: "non201 desired outputs",
    initial:
      '[SlopClaimControlBase EXCEPT !.requests[1] = [idle EXCEPT !.phase = "reply", !.desired = "409"]]',
    step: 's\' = [s EXCEPT !.requests[1].desired = "500"]',
  },
];

function terminalStateCounts(output: string) {
  const results = [
    ...output.matchAll(
      /^(\d+) states? generated, (\d+) distinct states? found, (\d+) states? left on queue\.\r?$/gmu,
    ),
  ];
  const terminal = results.at(-1);
  if (!terminal) throw new Error("Missing terminal TLC state counts");
  return {
    generated: Number(terminal[1]),
    distinct: Number(terminal[2]),
    queued: Number(terminal[3]),
  };
}
test("wallet claim pair counts use the final complete TLC line", () => {
  const progress =
    "Progress(1): 1 states generated, 1 distinct states found, 1 states left on queue.";
  const early =
    "1 states generated, 1 distinct states found, 0 states left on queue.";
  const final =
    "3 states generated, 2 distinct states found, 0 states left on queue.";
  expect(terminalStateCounts(`${progress}\n${early}\n${final}\n`)).toEqual({
    generated: 3,
    distinct: 2,
    queued: 0,
  });
  expect(
    terminalStateCounts(
      `${final}\n1 states generated, 1 distinct states found, 4 states left on queue.\n`,
    ),
  ).toEqual({ generated: 1, distinct: 1, queued: 4 });
  expect(() => terminalStateCounts(progress)).toThrow("Missing terminal");
  expect(() =>
    terminalStateCounts("2 distinct states found\n0 states left on queue"),
  ).toThrow("Missing terminal");
});

for (const control of cases)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native wallet claim VIEW retains ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain("State 2:");
      if (control.witnessState === 3)
        expect(result.output).toContain("State 3:");
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).toContain("WALLET_CLAIM_VIEW_NAMED_WITNESS_FOUND");
      expect(result.output).not.toContain("No error has been found");
    },
    120000,
  );
for (const control of coalescingCases)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native wallet claim VIEW coalesces only ${control.name}`,
    async () => {
      const tla = nativeFixture({ ...control, witness: "FALSE" });
      const raw = await runNative(tla, false);
      expect(raw.status, raw.output).toBe(0);
      expect(terminalStateCounts(raw.output)).toMatchObject({
        distinct: 2,
        queued: 0,
      });
      const viewed = await runNative(tla);
      expect(viewed.status, viewed.output).toBe(0);
      expect(terminalStateCounts(viewed.output)).toMatchObject({
        distinct: 1,
        queued: 0,
      });
    },
    120000,
  );
