/** Exact-source guards and native observations for historical intake. */
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
const manifest = readSafetyViews(root),
  candidate = manifest.views.find(
    (v) => v.id === "trace-run-phase-terminal-safety-v1",
  );
if (!candidate) throw Error("Missing reviewed trace-run VIEW");
const selected: SafetyViewDefinition = candidate,
  source = readFileSync(join(root, selected.model), "utf8");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2)
    throw Error(`Expected one source boundary: ${from}`);
  return text.replace(from, to);
}
function reviewed(model: string) {
  if (
    digest(model) !==
    "de3cd439eff487813f76d3d56eabde649bb0917b6037fa9d0fd756c61bd20cfa"
  )
    throw Error(
      "Trace-run consumers and invariant carriers require whole-source review",
    );
}
test("trace-run VIEW binds every original action, domain, invariant and all 29 scenarios", () => {
  reviewed(source);
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
  expect(digest(selected.fields[0].expression)).toBe(
    "e05182cd5f90b23c03a8089316b9169afaf5851535be4f596014350a9c80ce49",
  );
  expect(selected.clauses).toEqual([]);
  expect(manifest.views.filter((v) => v.model === selected.model)).toHaveLength(
    1,
  );
});
for (const [name, before, after] of [
  [
    "response/priorResponse consumer",
    "previous.attempt < 2,",
    'previous.attempt < 2, previous.response == "lost",',
  ],
  [
    "snapshot login consumer",
    'request.phase == "reply",',
    'request.phase == "reply", request.snapshotLogin == 1,',
  ],
  [
    "snapshot time consumer",
    'request.phase == "reply",',
    'request.phase == "reply", request.snapshotCreated == s.now,',
  ],
  [
    "snapshot state consumer",
    'request.phase == "reply",',
    'request.phase == "reply", request.snapshotState == "finalized",',
  ],
  [
    "other desired status consumer",
    'request.desired == "200" implies',
    'Set("200", "500").contains(request.desired) implies',
  ],
  [
    "other disposition consumer",
    'request.phase == "insert-result",',
    'request.phase == "insert-result", request.disposition == "conflict",',
  ],
  [
    "other insertion outcome consumer",
    'request.insertOutcome == "constraint"',
    'request.insertOutcome != "no-op"',
  ],
  [
    "early created carrier read",
    'request.phase == "prepare",',
    'request.phase == "prepare", request.created >= 0,',
  ],
  [
    "post-insert login read",
    'request.phase == "by-id-read",',
    'request.phase == "by-id-read", request.login == 1,',
  ],
  [
    "post-insert created read",
    'request.phase == "race-read",',
    'request.phase == "race-read", request.created >= 0,',
  ],
  [
    "partial request reuse",
    'idle.with("phase", "initial-ban")',
    'previous.with("phase", "initial-ban")',
  ],
  [
    "terminal callback reuse",
    'request.phase == "insert-result",',
    'Set("insert-result", "done").contains(request.phase),',
  ],
  [
    "live phase regression",
    'if (request.insertOutcome == "constraint") "race-read" else "by-id-read"',
    'if (request.insertOutcome == "constraint") "insert" else "by-id-read"',
  ],
  [
    "cross-slot closed output read",
    'request.phase == "insert",',
    'request.phase == "insert", s.requests.get(2).snapshotState == "none",',
  ],
  [
    "new local snapshot invariant",
    "request.attempt <= 2,",
    "request.attempt <= 2, request.snapshotLogin == 1,",
  ],
  [
    "changed payload domain",
    "val payloads = Set(1, 2)",
    "val payloads = Set(1, 2, 3)",
  ],
] as const)
  test(`future ${name} refuses the complete trace-run pin`, () => {
    expect(source).toContain(before);
    const changed = source.replace(before, after);
    expect(() => reviewed(changed)).toThrow("whole-source review");
    expect(() =>
      bindSafetyView(manifest, selected.id, selected.model, changed),
    ).toThrow("model changed");
  });
function fixtureBinding(tlaCode: string): SafetyViewDefinition {
  const end = tlaCode.match(/^={4,}[ \t]*$/gmu);
  if (end?.length !== 1 || !tlaCode.endsWith(end[0] + "\n"))
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

test("trace-run property/operator/projection changes refuse reuse", () => {
  const temporal = source + "\ntemporal unsafeProperty = true\n";
  expect(() =>
    bindSafetyView(
      { ...manifest, views: [{ ...selected, sourceSha256: digest(temporal) }] },
      selected.id,
      selected.model,
      temporal,
    ),
  ).toThrow("does not authorize temporal properties");
  const tlaCode =
      "---- MODULE " + selected.module + " ----\nVARIABLE s\n====\n",
    binding = fixtureBinding(tlaCode);
  for (const changed of [
    { ...binding, fields: [{ name: "state", expression: "s" }] },
    { ...binding, clauses: [{ name: "future", expression: "FALSE" }] },
    { ...binding, operator: "UnreviewedTraceView" },
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
  const directory = mkdtempSync(join(tmpdir(), "slop-trace-run-native-"));
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
  minimumState?: number;
  initialIsSet?: boolean;
};
function nativeFixture(control: NativeCase) {
  let tla = actualTranslatedModel();
  // Keep each test alias after its dependencies: q_step follows all actions;
  // q_inv follows the complete invariant. No forward-reference fixture shortcut.
  tla = replaceOnce(
    tla,
    "q_init == init",
    `SlopControlInitial == ${control.initial}\n\nq_init == s ${control.initialIsSet ? "\\in" : "="} SlopControlInitial`,
  );
  tla = replaceOnce(
    tla,
    "q_inv == invariant",
    `SlopControlWitness == ${control.witness}\n\nq_inv == ~SlopControlWitness`,
  );
  return replaceOnce(
    tla,
    "q_step == step",
    `SlopControlStep == ${control.step}\n\nq_step == SlopControlStep`,
  );
}
async function runNative(tla: string, useView = true) {
  const binding = fixtureBinding(tla);
  const probe = [
    'import {readFileSync} from "node:fs";',
    'import {createRequire} from "node:module";',
    'import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from "./scripts/quint-safety-view.mjs";',
    "const require=createRequire(import.meta.url);",
    "const manifest=readSafetyViews(process.cwd());",
    "const view=" + JSON.stringify(binding) + ";",
    "const config={moduleName:view.module,tlaCode:" +
      JSON.stringify(tla) +
      ",hasInvariant:true,hasTemporal:false};",
    "const prepared=" +
      (useView ? "applySafetyView(view,config)" : "config") +
      ";",
    'const runner=loadSafetyViewTlc(require.resolve("@informalsystems/quint/dist/src/tlc.js"),manifest);',
    'const result=await runner.verify(prepared,"0.62.4",JSON.parse(readFileSync("formal/tlc.json","utf8")),3);',
    'if(result.isLeft()){if(result.value.isViolation){console.log("TRACE_RUN_VIEW_NAMED_WITNESS_FOUND");process.exitCode=1;}',
    'else{console.log("TRACE_RUN_VIEW_NATIVE_ERROR");process.exitCode=2;}}else console.log("TRACE_RUN_VIEW_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "trace-run-view-native-control",
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

const request =
  '[phase |-> "done", attempt |-> 1, actor |-> 1, key |-> 1, payload |-> 1, login |-> 1, generatedId |-> 1, created |-> 0, insertOutcome |-> "none", snapshotId |-> 0, snapshotActor |-> 0, snapshotPayload |-> 0, snapshotLogin |-> 0, snapshotCreated |-> -1, snapshotState |-> "none", disposition |-> "none", desired |-> "none", response |-> "none", priorResponse |-> "none"]';
const absent =
  '[exists |-> FALSE, id |-> 0, actor |-> 0, key |-> 0, payload |-> 0, login |-> 0, created |-> -1, state |-> "absent"]';
const stored =
  '[exists |-> TRUE, id |-> 1, actor |-> 1, key |-> 1, payload |-> 1, login |-> 1, created |-> 0, state |-> "awaiting_trace"]';
const initial = `[now |-> 0, bans |-> {}, rows |-> [rowId \\in {1,2,3,4} |-> IF rowId = 1 THEN ${stored} ELSE ${absent}], requests |-> [slotId \\in {1,2} |-> ${request}], insertions |-> 1]`;
const state = (changes: string) => `[${initial} EXCEPT ${changes}]`;
const change = (base: string, updates: string) => `[${base} EXCEPT ${updates}]`;
const empty = state(`!.rows[1] = ${absent}, !.insertions = 0`);
const phase = (name: string, updates = "") =>
  state(`!.requests[1].phase = "${name}"${updates ? `, ${updates}` : ""}`);
const localSnapshot =
  "(s.requests[1].snapshotId > 0 => (s.requests[1].snapshotActor = s.requests[1].actor /\\ s.requests[1].snapshotPayload = s.requests[1].payload))";
const local201 =
  '(s.requests[1].desired = "201" => (s.requests[1].disposition = "created" /\\ s.requests[1].snapshotId = s.requests[1].generatedId))';
const local200 =
  '(s.requests[1].desired = "200" => (s.requests[1].disposition = "existing" /\\ s.requests[1].snapshotId > 0))';
const localBinding =
  '(s.requests[1].insertOutcome = "inserted" => s.rows[index(s.requests[1].actor,s.requests[1].key)].id = s.requests[1].generatedId)';
const controls: NativeCase[] = [];
function observation(
  name: string,
  property: string,
  corrupt: string,
  repair: string,
  base = initial,
) {
  controls.push({
    name: `${name} false`,
    initial: base,
    step: `s' = [s EXCEPT ${corrupt}]`,
    witness: `~(${property})`,
  });
  controls.push({
    name: `${name} healing`,
    initial: change(base, corrupt),
    step: `s' = [s EXCEPT ${repair}]`,
    witness: property,
  });
}
for (const [name, property, corrupt, repair] of [
  ["clock lower", "s.now >= 0", "!.now = -1", "!.now = 0"],
  ["clock upper", "s.now <= 2", "!.now = 3", "!.now = 0"],
  [
    "insertion count",
    "s.insertions = Cardinality({k \\in {1,2,3,4}: s.rows[k].exists})",
    "!.insertions = 0",
    "!.insertions = 1",
  ],
  [
    "insertion cap",
    "s.insertions <= 2",
    "!.insertions = 3",
    "!.insertions = 1",
  ],
  [
    "row actor-key index",
    "index(s.rows[1].actor,s.rows[1].key) = 1",
    "!.rows[1].actor = 2",
    "!.rows[1].actor = 1",
  ],
  ["row ID lower", "s.rows[1].id >= 1", "!.rows[1].id = 0", "!.rows[1].id = 1"],
  ["row ID upper", "s.rows[1].id <= 4", "!.rows[1].id = 5", "!.rows[1].id = 1"],
  [
    "row payload class",
    "s.rows[1].payload \\in {1,2}",
    "!.rows[1].payload = 3",
    "!.rows[1].payload = 1",
  ],
  [
    "row login class",
    "s.rows[1].login \\in {1,2}",
    "!.rows[1].login = 3",
    "!.rows[1].login = 1",
  ],
  [
    "row creation lower",
    "s.rows[1].created >= 0",
    "!.rows[1].created = -1",
    "!.rows[1].created = 0",
  ],
  [
    "row creation upper",
    "s.rows[1].created <= 2",
    "!.rows[1].created = 3",
    "!.rows[1].created = 0",
  ],
  [
    "request attempt lower",
    "s.requests[1].attempt >= 0",
    "!.requests[1].attempt = -1",
    "!.requests[1].attempt = 1",
  ],
  [
    "request attempt upper",
    "s.requests[1].attempt <= 2",
    "!.requests[1].attempt = 3",
    "!.requests[1].attempt = 1",
  ],
] as const)
  observation(name, property, corrupt, repair);
observation(
  "global row ID uniqueness",
  "s.rows[1].id # s.rows[2].id",
  "!.rows[2].id = 1",
  "!.rows[2].id = 2",
  state(`!.rows[2] = [${stored} EXCEPT !.id = 2, !.key = 2], !.insertions = 2`),
);
observation(
  "snapshot actor clause",
  localSnapshot,
  "!.requests[1].snapshotId = 1, !.requests[1].snapshotActor = 2, !.requests[1].snapshotPayload = 1",
  "!.requests[1].snapshotActor = 1",
);
observation(
  "snapshot payload clause",
  localSnapshot,
  "!.requests[1].snapshotId = 1, !.requests[1].snapshotActor = 1, !.requests[1].snapshotPayload = 2",
  "!.requests[1].snapshotPayload = 1",
);
observation(
  "201 disposition clause",
  local201,
  '!.requests[1].desired = "201", !.requests[1].snapshotId = 1',
  '!.requests[1].disposition = "created"',
);
observation(
  "201 generated ID clause",
  local201,
  '!.requests[1].desired = "201", !.requests[1].disposition = "created", !.requests[1].snapshotId = 2',
  "!.requests[1].snapshotId = 1",
);
observation(
  "200 disposition clause",
  local200,
  '!.requests[1].desired = "200", !.requests[1].snapshotId = 1',
  '!.requests[1].disposition = "existing"',
);
observation(
  "200 positive snapshot clause",
  local200,
  '!.requests[1].desired = "200", !.requests[1].disposition = "existing"',
  "!.requests[1].snapshotId = 1",
);
observation(
  "dynamic inserted binding",
  localBinding,
  '!.requests[1].insertOutcome = "inserted", !.requests[1].generatedId = 2',
  "!.requests[1].generatedId = 1",
);
const otherInsert = `!.requests[2] = [${request} EXCEPT !.phase = "insert", !.generatedId = 3]`;
controls.push(
  {
    name: "FALSE terminal binding heals through other-slot actual insert",
    initial: change(
      empty,
      `!.requests[1].insertOutcome = "inserted", !.requests[1].generatedId = 3, ${otherInsert}`,
    ),
    step: "insert(2)",
    witness: `s.requests[2].phase = "insert-result" /\\ ${localBinding}`,
  },
  {
    name: "TRUE binding to absent metadata breaks on other-slot actual insert",
    initial: change(
      empty,
      `!.rows[1].id = 1, !.requests[1].insertOutcome = "inserted", ${otherInsert}`,
    ),
    step: "insert(2)",
    witness: `s.requests[2].phase = "insert-result" /\\ ~${localBinding}`,
  },
  {
    name: "exact terminal key before other-slot binding healing",
    initial: change(
      empty,
      `!.requests[1].insertOutcome = "inserted", !.requests[1].generatedId = 3, !.requests[1].key = 2, ${otherInsert}`,
    ),
    step: "IF s.requests[1].key = 2 THEN s' = [s EXCEPT !.requests[1].key = 1] ELSE insert(2)",
    witness: `s.requests[2].phase = "insert-result" /\\ ${localBinding}`,
    minimumState: 3,
  },
  {
    name: "exact terminal actor before other-slot binding healing",
    initial: change(
      empty,
      `!.requests[1].insertOutcome = "inserted", !.requests[1].generatedId = 3, !.requests[1].actor = 2, ${otherInsert}`,
    ),
    step: "IF s.requests[1].actor = 2 THEN s' = [s EXCEPT !.requests[1].actor = 1] ELSE insert(2)",
    witness: `s.requests[2].phase = "insert-result" /\\ ${localBinding}`,
    minimumState: 3,
  },
  {
    name: "actual prepare heals a dirty 201 generated-ID implication",
    initial: phase(
      "prepare",
      '!.requests[1].desired = "201", !.requests[1].disposition = "created", !.requests[1].snapshotId = 1, !.requests[1].generatedId = 9',
    ),
    step: "prepare(1,TRUE,TRUE)",
    witness: `s.requests[1].phase = "lookup" /\\ ${local201}`,
  },
  {
    name: "reinstatement before initial ban read preserves recovery",
    initial: phase("initial-ban", "!.bans = {1}"),
    step: "IF 1 \\in s.bans THEN reinstate(1) ELSE initialBanRead(1,TRUE)",
    witness: 's.requests[1].phase = "body"',
    minimumState: 3,
  },
  {
    name: "constraint outcome still selects actual race read",
    initial: phase("insert-result"),
    step: 'IF s.requests[1].insertOutcome = "none" THEN s\' = [s EXCEPT !.requests[1].insertOutcome = "constraint"] ELSE insertResult(1,TRUE)',
    witness: 's.requests[1].phase = "race-read"',
    minimumState: 3,
  },
  {
    name: "actual prepare captures exact generated ID and clock",
    initial: phase("prepare"),
    step: "prepare(1,TRUE,TRUE)",
    witness:
      's.requests[1].phase = "lookup" /\\ s.requests[1].generatedId = 1 /\\ s.requests[1].created = s.now',
  },
  {
    name: "known terminal reply carries a false snapshot clause",
    initial: phase(
      "reply",
      "!.requests[1].snapshotId = 1, !.requests[1].snapshotActor = 2, !.requests[1].snapshotPayload = 1",
    ),
    step: "respond(1,TRUE)",
    witness: `s.requests[1].phase = "done" /\\ ~${localSnapshot}`,
  },
  {
    name: "begin resets false snapshot, 201 and binding clauses",
    initial: state(
      '!.requests[1].snapshotId = 1, !.requests[1].snapshotActor = 2, !.requests[1].snapshotPayload = 2, !.requests[1].desired = "201", !.requests[1].disposition = "existing", !.requests[1].generatedId = 2, !.requests[1].insertOutcome = "inserted"',
    ),
    step: "begin(1,1,1,2,2)",
    witness: `s.requests[1].phase = "initial-ban" /\\ s.requests[1].attempt = 2 /\\ s.requests[1].payload = 2 /\\ s.requests[1].login = 2 /\\ ${localSnapshot} /\\ ${local201} /\\ ${local200} /\\ ${localBinding}`,
  },
  {
    name: "begin resets a separate FALSE200 clause",
    initial: state(
      '!.requests[1].desired = "200", !.requests[1].disposition = "created"',
    ),
    step: "begin(1,1,1,2,2)",
    witness: `s.requests[1].phase = "initial-ban" /\\ ${localSnapshot} /\\ ${local201} /\\ ${local200} /\\ ${localBinding}`,
  },
  {
    name: "late ban no-op can retry with new payload/login after reinstatement",
    initial: change(empty, '!.bans = {1}, !.requests[1].phase = "insert"'),
    step: 'IF s.requests[1].phase = "insert" THEN insert(1) ELSE IF s.requests[1].phase = "insert-result" THEN insertResult(1,TRUE) ELSE IF s.requests[1].phase = "by-id-read" THEN createdRead(1,TRUE) ELSE IF s.requests[1].phase = "conflict-ban" THEN conflictBanRead(1,TRUE) ELSE IF s.requests[1].phase = "reply" THEN respond(1,TRUE) ELSE IF 1 \\in s.bans THEN reinstate(1) ELSE begin(1,1,1,2,2)',
    witness:
      's.requests[1].phase = "initial-ban" /\\ s.requests[1].attempt = 2 /\\ s.requests[1].payload = 2 /\\ s.requests[1].login = 2',
    minimumState: 8,
  },
  {
    name: "unknown phase keeps exact would-be dead fields",
    initial: phase("future"),
    step: 's\' = [s EXCEPT !.requests[1].response = "lost", !.requests[1].created = 9, !.requests[1].login = 9]',
    witness:
      's.requests[1].response = "lost" /\\ s.requests[1].created = 9 /\\ s.requests[1].login = 9',
  },
);
for (const live of ["lookup", "insert"] as const)
  for (const [field, value] of [
    ["login", 3],
    ["created", 3],
  ] as const)
    controls.push({
      name: `${live} preserves invalid ${field} until actual insert`,
      initial: change(
        empty,
        `!.requests[1].phase = "${live}", !.requests[1].${field} = ${value}`,
      ),
      step:
        live === "lookup"
          ? 'IF s.requests[1].phase = "lookup" THEN readExisting(1,TRUE) ELSE insert(1)'
          : "insert(1)",
      witness: `s.rows[1].exists /\\ s.rows[1].${field} = ${value} /\\ ~invariant`,
      minimumState: live === "lookup" ? 3 : 2,
    });
for (const control of controls)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native trace VIEW preserves ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain("TRACE_RUN_VIEW_NAMED_WITNESS_FOUND");
      expect(result.output).toContain(`State ${control.minimumState ?? 2}:`);
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );
type Pair = NativeCase & { rawStates?: number; viewStates?: number };
const pairs: Pair[] = [];
for (const terminal of ["idle", "reply", "done"] as const) {
  pairs.push({
    name: `${terminal} dead data with all local clauses TRUE`,
    initial: phase(terminal),
    step: 's\' = [s EXCEPT !.requests[1].payload = 2, !.requests[1].login = 2, !.requests[1].created = 2, !.requests[1].generatedId = 9, !.requests[1].snapshotActor = 2, !.requests[1].snapshotPayload = 2, !.requests[1].snapshotLogin = 2, !.requests[1].snapshotCreated = 2, !.requests[1].snapshotState = "finalized", !.requests[1].desired = "500", !.requests[1].response = "lost", !.requests[1].priorResponse = "201", !.requests[1].insertOutcome = "constraint"]',
    witness: "FALSE",
  });
  pairs.push({
    name: `${terminal} separate FALSE snapshot clause`,
    initial: phase(
      terminal,
      "!.requests[1].snapshotId = 1, !.requests[1].snapshotActor = 2, !.requests[1].snapshotPayload = 1",
    ),
    step: 's\' = [s EXCEPT !.requests[1].snapshotActor = 3, !.requests[1].snapshotPayload = 9, !.requests[1].response = "lost"]',
    witness: "FALSE",
  });
}
for (const early of ["initial-ban", "body", "prepare"] as const)
  pairs.push({
    name: `${early} overwritten creation time`,
    initial: phase(early),
    step: "s' = [s EXCEPT !.requests[1].created = 9]",
    witness: "FALSE",
  });
for (const post of [
  "insert-result",
  "race-read",
  "by-id-read",
  "conflict-ban",
] as const)
  pairs.push({
    name: `${post} consumed login/time`,
    initial: phase(post),
    step: "s' = [s EXCEPT !.requests[1].created = 9, !.requests[1].login = 9]",
    witness: "FALSE",
  });
pairs.push(
  {
    name: "live closed response and snapshot output cones",
    initial: phase("body"),
    step: 's\' = [s EXCEPT !.requests[1].snapshotLogin = 9, !.requests[1].snapshotCreated = 9, !.requests[1].snapshotState = "future", !.requests[1].response = "lost", !.requests[1].priorResponse = "201"]',
    witness: "FALSE",
  },
  {
    name: "live other desired status",
    initial: phase("body", '!.requests[1].desired = "400"'),
    step: 's\' = [s EXCEPT !.requests[1].desired = "500"]',
    witness: "FALSE",
  },
  {
    name: "live other disposition",
    initial: phase("body"),
    step: 's\' = [s EXCEPT !.requests[1].disposition = "conflict"]',
    witness: "FALSE",
  },
  {
    name: "live other insertion outcome",
    initial: phase("insert-result"),
    step: 's\' = [s EXCEPT !.requests[1].insertOutcome = "no-op"]',
    witness: "FALSE",
  },
  {
    name: "terminal FALSE 201 bit",
    initial: state('!.requests[1].desired = "201"'),
    step: 's\' = [s EXCEPT !.requests[1].disposition = "existing", !.requests[1].generatedId = 9]',
    witness: "FALSE",
  },
  {
    name: "terminal FALSE 200 bit",
    initial: state('!.requests[1].desired = "200"'),
    step: 's\' = [s EXCEPT !.requests[1].disposition = "created", !.requests[1].generatedId = 9]',
    witness: "FALSE",
  },
  {
    name: "dead outputs preserve FALSE inserted binding",
    initial: state(
      '!.requests[1].insertOutcome = "inserted", !.requests[1].generatedId = 2',
    ),
    step: 's\' = [s EXCEPT !.requests[1].snapshotState = "finalized", !.requests[1].response = "lost"]',
    witness: "FALSE",
  },
  {
    name: "actual insertResult preserves other-outcome class",
    initial: `{${phase("insert-result")},${phase("insert-result", '!.requests[1].insertOutcome = "no-op"')}}`,
    initialIsSet: true,
    step: "insertResult(1,TRUE)",
    witness: "FALSE",
    rawStates: 4,
    viewStates: 2,
  },
  {
    name: "actual prepare overwrites early creation capture",
    initial: `{${phase("prepare")},${phase("prepare", "!.requests[1].created = 9")}}`,
    initialIsSet: true,
    step: "prepare(1,TRUE,TRUE)",
    witness: "FALSE",
    rawStates: 3,
    viewStates: 2,
  },
  {
    name: "actual response closes differing output status",
    initial: `{${phase("reply", '!.requests[1].desired = "400"')},${phase("reply", '!.requests[1].desired = "500"')}}`,
    initialIsSet: true,
    step: "respond(1,TRUE)",
    witness: "FALSE",
    rawStates: 4,
    viewStates: 2,
  },
);
for (const control of pairs)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native trace VIEW coalesces only ${control.name}`,
    async () => {
      const fixture = nativeFixture(control);
      for (const [useView, count] of [
        [false, control.rawStates ?? 2],
        [true, control.viewStates ?? 1],
      ] as const) {
        const result = await runNative(fixture, useView);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("TRACE_RUN_VIEW_NATIVE_COMPLETE");
        expect(slopTlcTerminalCounts(result.output)).toEqual({
          distinct: count,
          queued: 0,
        });
        expect(result.output).not.toContain("Invariant q_inv is violated");
      }
    },
    240_000,
  );
for (const control of [
  {
    name: "future closed response consumer",
    initial: phase("reply"),
    step: 'IF s.requests[1].response = "none" THEN s\' = [s EXCEPT !.requests[1].response = "lost"] ELSE respond(1,TRUE)',
    witness: 's.requests[1].phase = "done"',
  },
  {
    name: "future early time consumer",
    initial: phase("prepare"),
    step: "IF s.requests[1].created = 0 THEN s' = [s EXCEPT !.requests[1].created = 9] ELSE prepare(1,TRUE,TRUE)",
    witness: 's.requests[1].phase = "lookup"',
  },
] as const)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native no-VIEW trace witness exposes ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control), false);
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("TRACE_RUN_VIEW_NAMED_WITNESS_FOUND");
      expect(result.output).toContain("State 3:");
      expect(result.output).not.toContain("violated by the initial state");
    },
    120_000,
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
