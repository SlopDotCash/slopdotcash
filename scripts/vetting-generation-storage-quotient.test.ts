/** Exact-source and native controls for generation-storage observation VIEW. */
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
const candidate = manifest.views.find(
  (entry) => entry.id === "vetting-generation-storage-observation-safety-v1",
);
if (!candidate) throw new Error("Missing reviewed generation-storage VIEW");
const selected: SafetyViewDefinition = candidate;
const source = readFileSync(join(root, selected.model), "utf8");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2)
    throw new Error(`Expected one source boundary: ${from}`);
  return text.replace(from, to);
}
test("generation-storage VIEW binds every original source byte and its literal", () => {
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
  expect(digest(source)).toBe(
    "1beb326e7630b58014e64b30cce756404d334917d07b37abb5a85c88d735dd80",
  );
  expect(digest(selected.fields[0].expression)).toBe(
    "631c8593718d6901023a801f0026d61e607976f86d3abedfed5bda4823d7124f",
  );
  expect(selected.clauses).toEqual([]);
});
for (const [name, from, to] of [
  [
    "published consumer",
    'all { r.phase == "put", r.reserved,',
    'all { r.phase == "put", r.reserved, r.published,',
  ],
  [
    "database flag changes the success class",
    'if (r.dbFailure) "reservation-error" else "retired"',
    'if (r.dbFailure) "stored" else "retired"',
  ],
  [
    "database flag changes a guard",
    'all { r.phase == "winner",',
    'all { r.phase == "winner", not(r.dbFailure),',
  ],
  [
    "other result becomes an invariant observation",
    'r.result != "stored" or',
    'not(Set("stored", "put-error").contains(r.result)) or',
  ],
  [
    "done slot reuse",
    'targets.contains(candidate), r.phase == "idle",',
    'targets.contains(candidate), Set("idle", "done").contains(r.phase),',
  ],
  ["incomplete idle reset", 'idle.with("mode", mode)', 'r.with("mode", mode)'],
  [
    "late pending mode reader",
    "all { r.putPending,",
    'all { r.putPending, r.mode == "store",',
  ],
  [
    "late settled reader",
    "all { r.putPending,",
    "all { r.putPending, not(r.putSettled),",
  ],
  [
    "terminal pending removed",
    "all { r.putPending,",
    'all { r.putPending, r.phase == "put-await",',
  ],
  [
    "late selected pointer reader",
    'val creates = bodyAt(r.candidate) == "missing"',
    'val creates = bodyAt(r.selected) == "missing"',
  ],
  [
    "terminal current-body reader",
    'all { r.phase == "verify-candidate",',
    'all { Set("verify-candidate", "done").contains(r.phase),',
  ],
  [
    "exact terminal selected observation",
    'r.result != "stored" or (r.verified and r.activeAccepted and r.selected > 0)',
    'r.result != "stored" or (r.verified and r.activeAccepted and r.selected == 1)',
  ],
  [
    "pending identity gains a new field",
    "not(r.putPending) or (r.reserved and identity(r.candidate).generation == r.generation",
    'not(r.putPending) or (r.mode == "store" and r.reserved and identity(r.candidate).generation == r.generation',
  ],
  [
    "cross-slot terminal payload reader",
    'all { r.phase == "reserve",',
    'all { r.phase == "reserve", s.requests.get(2).expected == 0,',
  ],
  [
    "new mode domain",
    'Set("store", "read").contains(mode)',
    'Set("store", "read", "inspect").contains(mode)',
  ],
] as const)
  test(`generation-storage VIEW refuses ${name}`, () => {
    const changed = replaceOnce(source, from, to);
    expect(() =>
      bindSafetyView(manifest, selected.id, selected.model, changed),
    ).toThrow("model changed");
  });

function fixtureBinding(tlaCode: string): SafetyViewDefinition {
  const end = tlaCode.match(/^={4,}[ \t]*$/gmu);
  if (end?.length !== 1 || !tlaCode.endsWith(`${end[0]}\n`))
    throw new Error("Fixture terminator differs");
  const definition = `${selected.operator} ==\n  <<${[...selected.fields, ...selected.clauses].map(({ expression }) => expression).join(", ")}>>\n\n`;
  const viewed = `${tlaCode.slice(0, -end[0].length - 1)}${definition}${end[0]}\n`;
  return {
    ...selected,
    translatedSha256: digest(tlaCode),
    viewTlaSha256: digest(viewed),
  };
}
function productionBinding(tlaCode: string) {
  expect(tlaCode).toMatch(/={80}\n$/u);
  expect(digest(tlaCode)).toBe(
    "30365ae6d173c92c54c501d3f2600f9a252c13c9734e524996710f9fe2a57d37",
  );
  const prepared = applySafetyView(selected, {
    moduleName: selected.module,
    tlaCode,
    hasInvariant: true,
    hasTemporal: false,
  });
  expect(digest(prepared.tlaCode)).toBe(
    "84de8a367f8e33996a0f770dc15decb889160900765bac6d34e177f8e8eeec2a",
  );
  expect(prepared.tlaCode).toMatch(/={80}\n$/u);
  return prepared;
}
test.skipIf(!process.env.SLOP_GENERATION_STORAGE_PRODUCTION_TLA)(
  "generation-storage VIEW binds the actual full production TLA",
  () => {
    const path = process.env.SLOP_GENERATION_STORAGE_PRODUCTION_TLA;
    if (!path) throw new Error("Missing captured production TLA");
    productionBinding(readFileSync(path, "utf8"));
  },
);
let translated: string | undefined;
function actualTranslatedModel() {
  if (translated !== undefined) return translated;
  const directory = mkdtempSync(
    join(tmpdir(), "slop-generation-storage-view-native-"),
  );
  const output = join(directory, "production.tla");
  try {
    const capture = [
      'import {createRequire} from "node:module";',
      'import {realpathSync,writeFileSync} from "node:fs";',
      'import {pathToFileURL} from "node:url";',
      "const require=createRequire(import.meta.url);",
      'const cli=realpathSync("./node_modules/.bin/quint");',
      "delete process.env.SLOP_QUINT_SAFETY_VIEW;",
      `process.argv=[process.execPath,cli,"verify",${JSON.stringify(selected.model)},"--backend=tlc","--verbosity=3","--tlc-config=formal/tlc.json","--invariant=invariant"];`,
      'await import(pathToFileURL(process.cwd()+"/scripts/quint-local-translator.mjs").href);',
      `require("@informalsystems/quint/dist/src/tlc.js").verify=async config=>{writeFileSync(${JSON.stringify(output)},config.tlaCode);process.exit(0);};`,
      "await import(pathToFileURL(cli).href);",
    ].join("\n");
    // The full production translation is captured before any TLC exploration.
    execFileSync("node", ["--input-type=module", "-e", capture], {
      cwd: root,
      encoding: "utf8",
      timeout: 90_000,
    });
    translated = readFileSync(output, "utf8");
    productionBinding(translated);
    return translated;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const noTarget = "[generation |-> 0, descriptor |-> 0]";
const bindingOne = "[generation |-> 1, descriptor |-> 1]";
const idle =
  '[phase |-> "idle", mode |-> "store", generation |-> 1, descriptor |-> 1, candidate |-> 0, expected |-> 0, selected |-> 0, reserved |-> FALSE, published |-> FALSE, verified |-> FALSE, activeAccepted |-> FALSE, dbFailure |-> FALSE, putPending |-> FALSE, putSettled |-> FALSE, result |-> "none"]';
const initial = `[generations |-> [g \\in {1,2} |-> IF g = 1 THEN "active" ELSE "absent"], targets |-> [t \\in {1,2,3,4} |-> ${noTarget}], heads |-> [k \\in {1,2,3,4} |-> 0], bodies |-> [t \\in {1,2,3,4} |-> "missing"], retiredTargets |-> {}, requests |-> [id \\in {1,2} |-> ${idle}], safePublication |-> TRUE, createOnly |-> TRUE]`;
const state = (patch: string) => `[${initial} EXCEPT ${patch}]`;
const stored =
  '(s.requests[1].result # "stored" \\/ (s.requests[1].verified /\\ s.requests[1].activeAccepted /\\ s.requests[1].selected > 0))';
const read =
  '(s.requests[1].result # "read" \\/ (s.requests[1].verified /\\ s.requests[1].selected > 0))';
const pending =
  "(~s.requests[1].putPending \\/ (s.requests[1].reserved /\\ identity(s.requests[1].candidate).generation = s.requests[1].generation /\\ identity(s.requests[1].candidate).descriptor = s.requests[1].descriptor))";
type Control = {
  name: string;
  initial: string;
  step: string;
  witness: string;
  minimumState?: 2 | 3;
  initialIsSet?: boolean;
};
function nativeFixture(control: Control) {
  let tla = actualTranslatedModel();
  tla = replaceOnce(
    tla,
    "q_init == init",
    `SlopInitial == ${control.initial}\n\nq_init == s ${control.initialIsSet ? "\\in" : "="} SlopInitial`,
  );
  // Keep aliases after their actual production dependencies.
  tla = replaceOnce(
    tla,
    "q_inv == invariant",
    `SlopWitness == ${control.witness}\n\nq_inv == ~SlopWitness`,
  );
  return replaceOnce(
    tla,
    "q_step == step",
    `SlopNext == ${control.step}\n\nq_step == SlopNext`,
  );
}
async function runNative(tlaCode: string, useView = true) {
  const binding = fixtureBinding(tlaCode);
  const probe = [
    'import {readFileSync} from "node:fs";',
    'import {createRequire} from "node:module";',
    'import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from "./scripts/quint-safety-view.mjs";',
    "const require=createRequire(import.meta.url);",
    "const manifest=readSafetyViews(process.cwd());",
    `const raw={moduleName:${JSON.stringify(selected.module)},tlaCode:${JSON.stringify(tlaCode)},hasInvariant:true,hasTemporal:false};`,
    `const prepared=${useView ? `applySafetyView(${JSON.stringify(binding)},raw)` : "raw"};`,
    'const runner=loadSafetyViewTlc(require.resolve("@informalsystems/quint/dist/src/tlc.js"),manifest);',
    'const result=await runner.verify(prepared,"0.62.4",JSON.parse(readFileSync("formal/tlc.json","utf8")),3);',
    'if(result.isLeft()){if(!result.value.isViolation)process.exit(2);console.log("GENERATION_STORAGE_NAMED_WITNESS_FOUND");process.exit(1);}console.log("GENERATION_STORAGE_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "generation-storage-view-native",
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
const controls: Control[] = [];
function observation(
  name: string,
  property: string,
  corrupt: string,
  repair: string,
  initialPatch = "",
) {
  controls.push({
    name: `${name} false`,
    initial: initialPatch ? state(initialPatch) : initial,
    step: `s' = [s EXCEPT ${corrupt}]`,
    witness: `~(${property})`,
  });
  controls.push({
    name: `${name} healing`,
    initial: state([initialPatch, corrupt].filter(Boolean).join(", ")),
    step: `s' = [s EXCEPT ${repair}]`,
    witness: property,
  });
}

observation(
  "safe publication global",
  "s.safePublication",
  "!.safePublication = FALSE",
  "!.safePublication = TRUE",
);
observation(
  "create-only global",
  "s.createOnly",
  "!.createOnly = FALSE",
  "!.createOnly = TRUE",
);
observation(
  "one active generation",
  'Cardinality({g \\in {1,2}: s.generations[g] = "active"}) <= 1',
  '!.generations[2] = "active"',
  '!.generations[2] = "absent"',
);
observation(
  "retired marker observation",
  '\\A t \\in s.retiredTargets: s.bodies[t] = "marker"',
  '!.bodies[1] = "bytes"',
  '!.bodies[1] = "marker"',
  '!.retiredTargets = {1}, !.bodies[1] = "marker"',
);
const heads =
  "\\A k \\in {1,2,3,4}: s.heads[k] = 0 \\/ tuple(identity(s.heads[k]).generation, identity(s.heads[k]).descriptor) = k";
observation(
  "head identity observation",
  heads,
  "!.heads[1] = 1",
  "!.heads[1] = 0",
);
for (const phase of ["idle", "done"]) {
  observation(
    `${phase} stored bit`,
    stored,
    "!.requests[1].verified = FALSE",
    "!.requests[1].verified = TRUE",
    `!.safePublication = FALSE, !.requests[1].phase = "${phase}", !.requests[1].result = "stored", !.requests[1].verified = TRUE, !.requests[1].activeAccepted = TRUE, !.requests[1].selected = 1`,
  );
  observation(
    `${phase} read bit`,
    read,
    "!.requests[1].verified = FALSE",
    "!.requests[1].verified = TRUE",
    `!.safePublication = FALSE, !.requests[1].phase = "${phase}", !.requests[1].result = "read", !.requests[1].verified = TRUE, !.requests[1].selected = 1`,
  );
  observation(
    `${phase} pending flag`,
    pending,
    "!.requests[1].putPending = TRUE",
    "!.requests[1].putPending = FALSE",
    `!.safePublication = FALSE, !.requests[1].phase = "${phase}", !.requests[1].candidate = 1`,
  );
}
for (const [name, property, corrupt, repair, extra] of [
  [
    "stored active acceptance",
    stored,
    "!.requests[1].activeAccepted = FALSE",
    "!.requests[1].activeAccepted = TRUE",
    '!.requests[1].result = "stored", !.requests[1].verified = TRUE, !.requests[1].activeAccepted = TRUE, !.requests[1].selected = 1',
  ],
  [
    "stored positive selection",
    stored,
    "!.requests[1].selected = 0",
    "!.requests[1].selected = 1",
    '!.requests[1].result = "stored", !.requests[1].verified = TRUE, !.requests[1].activeAccepted = TRUE, !.requests[1].selected = 1',
  ],
  [
    "read positive selection",
    read,
    "!.requests[1].selected = 0",
    "!.requests[1].selected = 1",
    '!.requests[1].result = "read", !.requests[1].verified = TRUE, !.requests[1].selected = 1',
  ],
] as const)
  observation(
    name,
    property,
    corrupt,
    repair,
    `!.safePublication = FALSE, !.requests[1].phase = "done", ${extra}`,
  );
const pendingBase = `!.requests[1].phase = "done", !.requests[1].putPending = TRUE, !.requests[1].candidate = 1, !.requests[1].reserved = TRUE, !.targets[1] = ${bindingOne}`;
for (const [name, corrupt, repair] of [
  ["candidate", "!.requests[1].candidate = 2", "!.requests[1].candidate = 1"],
  [
    "generation",
    "!.requests[1].generation = 2",
    "!.requests[1].generation = 1",
  ],
  [
    "descriptor",
    "!.requests[1].descriptor = 2",
    "!.requests[1].descriptor = 1",
  ],
  [
    "reservation",
    "!.requests[1].reserved = FALSE",
    "!.requests[1].reserved = TRUE",
  ],
  [
    "global target identity",
    "!.targets[1].descriptor = 2",
    "!.targets[1].descriptor = 1",
  ],
] as const)
  observation(
    `terminal pending ${name}`,
    pending,
    corrupt,
    repair,
    `${pendingBase}, !.safePublication = FALSE`,
  );
for (const [field, before, after] of [
  ["mode", '"store"', '"read"'],
  ["generation", "1", "2"],
  ["descriptor", "1", "2"],
  ["candidate", "1", "2"],
  ["expected", "0", "1"],
  ["selected", "0", "1"],
  ["reserved", "FALSE", "TRUE"],
  ["verified", "FALSE", "TRUE"],
  ["activeAccepted", "FALSE", "TRUE"],
  ["putPending", "FALSE", "TRUE"],
  ["putSettled", "FALSE", "TRUE"],
] as const)
  controls.push({
    name: `unknown phase keeps exact ${field}`,
    initial: state(
      `!.requests[1].phase = "future-phase", !.requests[1].candidate = 1`,
    ),
    step: `s' = [s EXCEPT !.requests[1].${field} = ${after}]`,
    witness: `s.requests[1].${field} # ${before}`,
  });
for (const result of ["stored", "read"])
  controls.push({
    name: `live ${result} result class`,
    initial: state(
      '!.requests[1].phase = "reserve", !.requests[1].candidate = 1',
    ),
    step: `s' = [s EXCEPT !.requests[1].result = "${result}"]`,
    witness: `s.requests[1].result = "${result}"`,
  });
controls.push({
  name: "live read differs from stored",
  initial: state(
    '!.requests[1].phase = "reserve", !.requests[1].result = "stored"',
  ),
  step: 's\' = [s EXCEPT !.requests[1].result = "read"]',
  witness: 's.requests[1].result = "read"',
});
controls.push(
  {
    name: "live mode reaches the original head-read branch",
    initial: state(
      '!.requests[1].phase = "lookup", !.requests[1].candidate = 1',
    ),
    step: 'IF s.requests[1].mode = "store" THEN s\' = [s EXCEPT !.requests[1].mode = "read"] ELSE headRead(1,TRUE)',
    witness: 's.requests[1].phase = "done"',
    minimumState: 3,
  },
  {
    name: "live expected pointer reaches actual publication",
    initial: state(
      `!.requests[1].phase = "publish", !.requests[1].candidate = 1, !.requests[1].expected = 1, !.requests[1].reserved = TRUE, !.targets[1] = ${bindingOne}`,
    ),
    step: "IF s.requests[1].expected = 1 THEN s' = [s EXCEPT !.requests[1].expected = 0] ELSE publish(1,TRUE)",
    witness: "s.heads[1] = 1",
    minimumState: 3,
  },
  {
    name: "live selected pointer reaches the existing-copy read",
    initial: state(
      '!.requests[1].phase = "current", !.requests[1].selected = 1, !.bodies[2] = "bytes"',
    ),
    step: "IF s.requests[1].selected = 1 THEN s' = [s EXCEPT !.requests[1].selected = 2] ELSE currentRead(1,TRUE)",
    witness: 's.requests[1].phase = "current-active"',
    minimumState: 3,
  },
  {
    name: "live put-settled admits the actual reply",
    initial: state(
      '!.requests[1].phase = "put-await", !.requests[1].candidate = 1',
    ),
    step: "IF ~s.requests[1].putSettled THEN s' = [s EXCEPT !.requests[1].putSettled = TRUE] ELSE putReply(1,TRUE)",
    witness: 's.requests[1].phase = "verify-candidate"',
    minimumState: 3,
  },
  {
    name: "live reservation admits the actual put",
    initial: state(
      `!.requests[1].phase = "put", !.requests[1].candidate = 1, !.targets[1] = ${bindingOne}`,
    ),
    step: "IF ~s.requests[1].reserved THEN s' = [s EXCEPT !.requests[1].reserved = TRUE] ELSE startPut(1)",
    witness: 's.requests[1].phase = "put-await" /\\ s.requests[1].putPending',
    minimumState: 3,
  },
  {
    name: "live verification reaches the raw stored observation",
    initial: state(
      '!.requests[1].phase = "current-active", !.requests[1].selected = 1',
    ),
    step: "IF ~s.requests[1].verified THEN s' = [s EXCEPT !.requests[1].verified = TRUE] ELSE activeCheck(1,TRUE)",
    witness: `s.requests[1].phase = "done" /\\ ${stored}`,
    minimumState: 3,
  },
  {
    name: "actual lost put reply leaves a terminal late write",
    initial: state(`${pendingBase}, !.requests[1].phase = "put-await"`),
    step: 'IF s.requests[1].phase = "put-await" THEN putReply(1,FALSE) ELSE settlePut(1)',
    witness:
      's.requests[1].phase = "done" /\\ ~s.requests[1].putPending /\\ s.bodies[1] = "bytes"',
    minimumState: 3,
  },
  {
    name: "terminal pending candidate controls the actual late body write",
    initial: state(pendingBase),
    step: "IF s.requests[1].candidate = 1 THEN s' = [s EXCEPT !.requests[1].candidate = 2] ELSE settlePut(1)",
    witness: '~s.requests[1].putPending /\\ s.bodies[2] = "bytes"',
    minimumState: 3,
  },
  {
    name: "terminal pending put respects an existing marker",
    initial: state(
      `${pendingBase}, !.generations[1] = "retiring", !.bodies[1] = "marker", !.retiredTargets = {1}`,
    ),
    step: "settlePut(1)",
    witness: '~s.requests[1].putPending /\\ s.bodies[1] = "marker"',
  },
  {
    name: "idle full reset clears dirty pending and all captures",
    initial: state(
      `${pendingBase}, !.requests[1].phase = "idle", !.requests[1].expected = 4, !.requests[1].selected = 3, !.requests[1].verified = TRUE, !.requests[1].putSettled = TRUE`,
    ),
    step: 'begin(1,"read",2,2,4,TRUE)',
    witness:
      's.requests[1].phase = "lookup" /\\ s.requests[1].generation = 2 /\\ s.requests[1].descriptor = 2 /\\ s.requests[1].candidate = 4 /\\ ~s.requests[1].putPending /\\ ~s.requests[1].putSettled /\\ ~s.requests[1].reserved /\\ ~s.requests[1].verified /\\ s.requests[1].selected = 0 /\\ s.requests[1].expected = 0',
  },
);
for (const result of ["stored", "read"])
  controls.push({
    name: `idle reset heals false ${result} bit`,
    initial: state(
      `!.requests[1].result = "${result}", !.safePublication = FALSE`,
    ),
    step: 'begin(1,"store",1,1,1,FALSE)',
    witness: `s.requests[1].phase = "done" /\\ ${stored} /\\ ${read}`,
  });
const falsePending =
  '!.requests[1].phase = "done", !.requests[1].putPending = TRUE, !.requests[1].reserved = TRUE, !.requests[1].candidate = 1, !.requests[2].phase = "reserve", !.requests[2].candidate = 1';
controls.push({
  name: "other slot actual reserve heals terminal pending identity",
  initial: state(`${falsePending}, !.safePublication = FALSE`),
  step: "reserve(2,TRUE)",
  witness: pending,
});
for (const [name, oldValue, newValue, firstPatch, secondPatch, globalPatch] of [
  ["candidate", "1", "2", "", "!.requests[2].candidate = 2", ""],
  [
    "generation",
    "1",
    "2",
    "",
    "!.requests[2].generation = 2",
    '!.generations[1] = "retired", !.generations[2] = "active"',
  ],
  ["descriptor", "1", "2", "", "!.requests[2].descriptor = 2", ""],
  ["reserved", "FALSE", "TRUE", "!.requests[1].reserved = FALSE", "", ""],
] as const)
  controls.push({
    name: `terminal pending ${name} matters before other-slot healing`,
    initial: state(
      [falsePending, firstPatch, secondPatch, globalPatch]
        .filter(Boolean)
        .join(", "),
    ),
    step: `IF s.requests[1].${name} = ${oldValue} THEN s' = [s EXCEPT !.requests[1].${name} = ${newValue}] ELSE reserve(2,TRUE)`,
    witness: pending,
    minimumState: 3,
  });
for (const control of controls)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native generation-storage VIEW retains ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain(`State ${control.minimumState ?? 2}:`);
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).toContain("GENERATION_STORAGE_NAMED_WITNESS_FOUND");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );

type Pair = Omit<Control, "witness"> & {
  rawStates?: number;
  viewStates?: number;
};
const pairs: Pair[] = [];
for (const phase of ["idle", "done"]) {
  pairs.push(
    {
      name: `${phase} dead payload with two true result implications`,
      initial: state(
        `!.requests[1].phase = "${phase}", !.safePublication = FALSE`,
      ),
      step: 's\' = [s EXCEPT !.requests[1].mode = "read", !.requests[1].generation = 2, !.requests[1].descriptor = 2, !.requests[1].candidate = 4, !.requests[1].expected = 4, !.requests[1].selected = 2, !.requests[1].reserved = TRUE, !.requests[1].verified = TRUE, !.requests[1].activeAccepted = TRUE, !.requests[1].putSettled = TRUE, !.requests[1].published = TRUE, !.requests[1].dbFailure = TRUE, !.requests[1].result = "put-error"]',
    },
    {
      name: `${phase} healthy stored/read results share the same raw implications`,
      initial: state(
        `!.requests[1].phase = "${phase}", !.requests[1].result = "stored", !.requests[1].verified = TRUE, !.requests[1].activeAccepted = TRUE, !.requests[1].selected = 1`,
      ),
      step: 's\' = [s EXCEPT !.requests[1].result = "read", !.requests[1].activeAccepted = FALSE]',
    },
    {
      name: `${phase} false stored implication stays false`,
      initial: state(
        `!.requests[1].phase = "${phase}", !.requests[1].result = "stored", !.requests[1].verified = TRUE, !.requests[1].activeAccepted = FALSE, !.requests[1].selected = 1`,
      ),
      step: "s' = [s EXCEPT !.requests[1].verified = FALSE, !.requests[1].activeAccepted = TRUE, !.requests[1].selected = 2]",
    },
    {
      name: `${phase} false read implication stays false`,
      initial: state(
        `!.requests[1].phase = "${phase}", !.requests[1].result = "read", !.requests[1].verified = FALSE, !.requests[1].selected = 1`,
      ),
      step: "s' = [s EXCEPT !.requests[1].verified = TRUE, !.requests[1].selected = 0]",
    },
    {
      name: `${phase} pending tail retains its identity but drops unrelated fields`,
      initial: state(`${pendingBase}, !.requests[1].phase = "${phase}"`),
      step: 's\' = [s EXCEPT !.requests[1].mode = "read", !.requests[1].expected = 4, !.requests[1].selected = 3, !.requests[1].verified = TRUE, !.requests[1].activeAccepted = TRUE, !.requests[1].putSettled = TRUE, !.requests[1].published = TRUE, !.requests[1].dbFailure = TRUE, !.requests[1].result = "put-error"]',
    },
  );
}
for (const phase of [
  "reserve",
  "reservation-readback",
  "winner",
  "future-phase",
])
  pairs.push({
    name: `${phase} published/database/error diagnostics`,
    initial: state(
      `!.requests[1].phase = "${phase}", !.requests[1].candidate = 1, !.safePublication = FALSE`,
    ),
    step: 's\' = [s EXCEPT !.requests[1].published = TRUE, !.requests[1].dbFailure = TRUE, !.requests[1].result = "database-error"]',
  });
for (const [name, phase, step] of [
  [
    "actual reservation-readback error labels",
    "reservation-readback",
    "reservationReadback(1,TRUE)",
  ],
  ["actual winner-read error labels", "winner", "winnerRead(1,TRUE)"],
] as const) {
  const common = `!.requests[1].phase = "${phase}", !.requests[1].candidate = 1`;
  pairs.push({
    name,
    initial: `{${state(`${common}, !.requests[1].dbFailure = FALSE`)}, ${state(`${common}, !.requests[1].dbFailure = TRUE`)}}`,
    initialIsSet: true,
    step,
    rawStates: 4,
    viewStates: 2,
  });
}
pairs.push({
  name: "actual lost reply then terminal late settlement",
  initial: `{${state(`${pendingBase}, !.requests[1].phase = "put-await", !.requests[1].dbFailure = FALSE`)}, ${state(`${pendingBase}, !.requests[1].phase = "put-await", !.requests[1].dbFailure = TRUE`)}}`,
  initialIsSet: true,
  step: 'IF s.requests[1].phase = "put-await" THEN putReply(1,FALSE) ELSE IF s.requests[1].putPending THEN settlePut(1) ELSE s\' = s',
  rawStates: 6,
  viewStates: 3,
});
pairs.push({
  name: "actual idle full reset with a dirty pending tail",
  initial: `{${state(`${pendingBase}, !.requests[1].phase = "idle", !.requests[1].mode = "store", !.requests[1].expected = 0`)}, ${state(`${pendingBase}, !.requests[1].phase = "idle", !.requests[1].mode = "read", !.requests[1].expected = 4`)}}`,
  initialIsSet: true,
  step: 'begin(1,"store",1,2,2,TRUE)',
  rawStates: 3,
  viewStates: 2,
});
pairs.push({
  name: "actual terminal late settlement carries a false stored bit",
  initial: `{${state(`${pendingBase}, !.requests[1].result = "stored", !.requests[1].verified = TRUE, !.requests[1].activeAccepted = FALSE, !.requests[1].selected = 1`)}, ${state(`${pendingBase}, !.requests[1].result = "stored", !.requests[1].verified = FALSE, !.requests[1].activeAccepted = TRUE, !.requests[1].selected = 2`)}}`,
  initialIsSet: true,
  step: "settlePut(1)",
  rawStates: 4,
  viewStates: 2,
});
pairs.push({
  name: "actual other-slot reservation heals pending identity dynamically",
  initial: `{${state(`${falsePending}, !.requests[1].mode = "store"`)}, ${state(`${falsePending}, !.requests[1].mode = "read`)}}`,
  initialIsSet: true,
  step: "reserve(2,TRUE)",
  rawStates: 4,
  viewStates: 2,
});
// TRUE alone checks the intended equivalence classes. False original clauses
// remain in several raw prefixes; they cannot satisfy an unrelated property.
for (const pair of pairs)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native generation-storage VIEW coalesces only ${pair.name}`,
    async () => {
      const tla = nativeFixture({ ...pair, witness: "FALSE" });
      for (const [useView, count] of [
        [false, pair.rawStates ?? 2],
        [true, pair.viewStates ?? 1],
      ] as const) {
        const result = await runNative(tla, useView);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("GENERATION_STORAGE_NATIVE_COMPLETE");
        expect(slopTlcTerminalCounts(result.output)).toEqual({
          distinct: count,
          queued: 0,
        });
        expect(result.output).not.toContain("Invariant q_inv is violated");
      }
    },
    240_000,
  );

function slopTlcTerminalCounts(output: string) {
  const last = [
    ...output.matchAll(
      /^([\d,]+) states? generated, ([\d,]+) distinct states? found, ([\d,]+) states? left on queue\.\r?$/gmu,
    ),
  ].at(-1);
  if (!last) throw new Error("Missing final TLC state counts");
  return {
    distinct: Number(last[2].replaceAll(",", "")),
    queued: Number(last[3].replaceAll(",", "")),
  };
}
test("native evidence requires final counts rather than an earlier progress line", () => {
  expect(
    slopTlcTerminalCounts(
      "1 states generated, 1 distinct state found, 0 states left on queue.\n5 states generated, 4 distinct states found, 0 states left on queue.\n",
    ),
  ).toEqual({ distinct: 4, queued: 0 });
  expect(
    slopTlcTerminalCounts(
      "5,002 states generated, 4,001 distinct states found, 2,003 states left on queue.",
    ),
  ).toEqual({ distinct: 4001, queued: 2003 });
  expect(() =>
    slopTlcTerminalCounts(
      "Progress(1): 2 states generated, 1 distinct state found, 0 states left on queue.",
    ),
  ).toThrow("Missing final TLC state counts");
  expect(() =>
    slopTlcTerminalCounts("2 distinct states found\n0 states left on queue"),
  ).toThrow("Missing final TLC state counts");
  expect(() => slopTlcTerminalCounts("No error has been found")).toThrow(
    "Missing final TLC state counts",
  );
});
