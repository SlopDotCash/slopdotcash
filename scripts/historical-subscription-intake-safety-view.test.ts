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
  view = manifest.views.find(
    (v) => v.id === "historical-subscription-intake-phase-readback-safety-v2",
  );
if (!view) throw Error("Missing reviewed historical-intake VIEW");
const selected: SafetyViewDefinition = view,
  source = readFileSync(join(root, selected.model), "utf8");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function checkReviewedBoundary(model: string) {
  const start = model.indexOf("module historical_subscription_intake {"),
    end = model.indexOf("  action admitted(", start);
  if (
    start < 0 ||
    end < start ||
    digest(model.slice(start, end)) !==
      "5389907575567c2da7aa13bc5f51226fc82da65ee6995ee95418cea29c046a46"
  )
    throw Error(
      "Historical intake reads, retry guards and invariant observations need review",
    );
}
function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2)
    throw Error(`Expected one source boundary: ${from}`);
  return text.replace(from, to);
}
test("historical VIEW binds complete model and audited action/invariant boundary", () => {
  checkReviewedBoundary(source);
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
  expect(digest(source)).toBe(
    "cbc8d18d11f2c13246d83dfb9c2d6aefc5345bfa20b248e82f172258b4ee6f22",
  );
});
for (const [name, before, after] of [
  [
    "received output becoming a guard",
    'all { r.phase == "response",',
    'all { r.phase == "response", r.received,',
  ],
  [
    "a new terminal source snapshot read",
    "prior.attempt < 2,",
    "prior.attempt < 2, prior.sourceRevisions.get(1) == 0,",
  ],
  [
    "a new terminal collected-set read",
    "prior.attempt < 2,",
    "prior.attempt < 2, prior.collected.contains(1),",
  ],
  [
    "an exhausted retry being reenabled",
    "prior.attempt < 2,",
    "prior.attempt < 3,",
  ],
  [
    "a zero-attempt envelope consumer",
    "prior.attempt > 0 implies mode == prior.mode",
    "prior.attempt >= 0 implies mode == prior.mode",
  ],
  [
    "a future exhausted-envelope response consumer",
    'all { r.phase == "response",',
    'all { r.phase == "response", r.key == 2,',
  ],
  [
    "an exact response status consumer",
    'all { r.phase == "response",',
    'all { r.phase == "response", r.status == 409,',
  ],
  [
    "a cross-slot dead payload read",
    'r.phase == "append",',
    'r.phase == "append", s.requests.get(2).sourceRevisions.get(1) == 0,',
  ],
  [
    "a new invariant over received bytes",
    "r.status > 0 implies r.noStore,",
    "r.status > 0 implies r.noStore, not(r.received),",
  ],
  [
    "post-refresh source snapshot consumption",
    'all { r.phase == "prepare",',
    'all { r.phase == "prepare", r.sourceRevisions.get(1) == 1,',
  ],
  [
    "post-refresh collected-set consumption",
    'all { r.phase == "preflight",',
    'all { r.phase == "preflight", r.collected.contains(1),',
  ],
  [
    "post-refresh refreshed-set consumption",
    'all { r.phase == "readback",',
    'all { r.phase == "readback", r.refreshed.contains(1),',
  ],
  [
    "post-refresh phase regression",
    'if (valid) r.with("phase", "preflight")',
    'if (valid) r.with("phase", "refresh")',
  ],
  [
    "terminal true receipt row consumption",
    'all { r.phase == "response",',
    'all { r.phase == "response", r.returnedRow == 1,',
  ],
  [
    "terminal true receipt payload consumption",
    "prior.attempt < 2,",
    "prior.attempt < 2, prior.returnedPayload == 1,",
  ],
  [
    "existing-row overwrite instead of immutable replay",
    's\' = if (replay) s.with("requests", s.requests.set(id, nextValue))',
    's\' = if (false and replay) s.with("requests", s.requests.set(id, nextValue))',
  ],
  [
    "record deletion from an unrelated action",
    'action registryChanges = all { s.registryRevision == 1, s\' = s.with("registryRevision", 2) }',
    'action registryChanges = all { s.registryRevision == 1, s\' = s.with("registryRevision", 2).with("records", rows.mapBy(_ => absent)) }',
  ],
] as const)
  test(`future ${name} requires renewed review`, () => {
    const changed = replaceOnce(source, before, after);
    expect(() => checkReviewedBoundary(changed)).toThrow("need review");
    expect(() =>
      bindSafetyView(manifest, selected.id, selected.model, changed),
    ).toThrow("model changed");
  });
test("historical V2 keeps the reviewed three cuts literal and raw", () => {
  expect(digest(selected.fields[0].expression)).toBe(
    "38ae0b6161c2d901ce44dcc1937c7cbc54f15d8018ba30eef4c02137873998c4",
  );
  expect(selected.clauses).toEqual([]);
  expect(
    manifest.views.filter((entry) => entry.model === selected.model),
  ).toHaveLength(1);
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

test("temporal, property and projection changes cannot reuse the historical VIEW", () => {
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
    "---- MODULE " + selected.module + " ----\nVARIABLE s\n====\n";
  const binding = fixtureBinding(tlaCode);
  for (const changed of [
    { ...binding, fields: [{ name: "state", expression: "s" }] },
    { ...binding, clauses: [{ name: "unreviewed", expression: "FALSE" }] },
    { ...binding, operator: "UnreviewedHistoricalView" },
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
    join(tmpdir(), "slop-historical-intake-native-"),
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

const request =
  '[phase |-> "done", attempt |-> 2, mode |-> "single", key |-> 1, parent |-> 0, payload |-> 1, bundle |-> FALSE, members |-> {}, collected |-> {}, refreshed |-> {}, sourceRevisions |-> [sourceId \\in {1,2} |-> 0], registryRevision |-> 0, status |-> 0, returnedRow |-> 0, returnedPayload |-> 0, noStore |-> FALSE, received |-> FALSE]';
const record =
  '[exists |-> FALSE, mode |-> "single", parent |-> 0, payload |-> 0, members |-> {}]';
const initial =
  "[requests |-> [requestId \\in {1,2} |-> " +
  request +
  "], sourceRevisions |-> [globalSourceId \\in {1,2} |-> 1], registryRevision |-> 1, active |-> TRUE, installed |-> TRUE, selected |-> {1,2}, tip |-> 0, records |-> [recordId \\in {1,2,3,4} |-> " +
  record +
  "], sourceIndex |-> [sourceRowId \\in {1,2,3,4} |-> {}], claimIndex |-> [claimRowId \\in {1,2,3,4} |-> {}], parentIndex |-> [parentRowId \\in {1,2,3,4} |-> {}]]";
const state = (changes: string) => `[${initial} EXCEPT ${changes}]`;
const noStore = "(s.requests[1].status > 0 => s.requests[1].noStore)";
const refreshed =
  "(s.requests[1].refreshed \\subseteq s.requests[1].collected)";
const collected = "(s.requests[1].collected \\subseteq s.requests[1].members)";
const readback =
  "(s.requests[1].status = 200 => (rowAt(s.requests[1].returnedRow).exists /\\ s.requests[1].returnedPayload = rowAt(s.requests[1].returnedRow).payload))";
const appendSecond =
  "!.requests[2] = [" +
  request +
  ' EXCEPT !.phase = "append", !.attempt = 1, !.members = {1}, !.registryRevision = 1]';
type NativeCase = {
  name: string;
  initial: string;
  step: string;
  witness: string;
  minimumState?: 2 | 3 | 4;
};
function nativeFixture(control: NativeCase) {
  let tla = actualTranslatedModel();
  // Keep each test alias after its dependencies: q_step follows all actions;
  // q_inv follows rowAt/invariant. No forward-reference fixture shortcut.
  tla = replaceOnce(
    tla,
    "q_init == init",
    `SlopControlInitial == ${control.initial}\n\nq_init == s = SlopControlInitial`,
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
    'if(result.isLeft()){if(result.value.isViolation){console.log("HISTORICAL_VIEW_NAMED_WITNESS_FOUND");process.exitCode=1;}',
    'else{console.log("HISTORICAL_VIEW_NATIVE_ERROR");process.exitCode=2;}}else console.log("HISTORICAL_VIEW_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "historical-intake-view-native-control",
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
    name: "tip-domain false class",
    initial,
    step: "s' = [s EXCEPT !.tip = 5]",
    witness: "s.tip \\notin {0,1,2,3,4}",
  },
  {
    name: "missing-tip false class",
    initial,
    step: "s' = [s EXCEPT !.tip = 1]",
    witness: "s.tip > 0 /\\ ~rowAt(s.tip).exists",
  },
  {
    name: "source-index false class",
    initial,
    step: "s' = [s EXCEPT !.sourceIndex[1] = {1}]",
    witness: "s.sourceIndex[1] # {}",
  },
  {
    name: "claim-index false class",
    initial,
    step: "s' = [s EXCEPT !.claimIndex[1] = {1}]",
    witness: "s.claimIndex[1] # s.sourceIndex[1]",
  },
  {
    name: "parent-index false class",
    initial,
    step: "s' = [s EXCEPT !.parentIndex[1] = {2}]",
    witness: "s.parentIndex[1] # {}",
  },
  {
    name: "missing-record-parent false class",
    initial,
    step: 's\' = [s EXCEPT !.records[1] = [exists |-> TRUE, mode |-> "single", parent |-> 2, payload |-> 1, members |-> {1}]]',
    witness:
      "rowAt(1).exists /\\ rowAt(1).parent > 0 /\\ ~rowAt(rowAt(1).parent).exists",
  },
  {
    name: "terminal no-store false class",
    initial,
    step: "s' = [s EXCEPT !.requests[1].status = 409]",
    witness: `~${noStore}`,
  },
  {
    name: "terminal false no-store healing",
    initial: state("!.requests[1].status = 409"),
    step: "s' = [s EXCEPT !.requests[1].noStore = TRUE]",
    witness: noStore,
  },
  {
    name: "refreshed-subset false class",
    initial,
    step: "s' = [s EXCEPT !.requests[1].refreshed = {1}]",
    witness: `~${refreshed}`,
  },
  {
    name: "false refreshed-subset healing",
    initial: state("!.requests[1].refreshed = {1}"),
    step: "s' = [s EXCEPT !.requests[1].collected = {1}]",
    witness: refreshed,
  },
  {
    name: "collected-subset false class",
    initial,
    step: "s' = [s EXCEPT !.requests[1].collected = {1}]",
    witness: `~${collected}`,
  },
  {
    name: "false collected-subset healing",
    initial: state("!.requests[1].collected = {1}"),
    step: "s' = [s EXCEPT !.requests[1].members = {1}]",
    witness: collected,
  },
  {
    name: "one subset healing while the other remains false",
    initial: state(
      "!.requests[1].refreshed = {1,2}, !.requests[1].collected = {1}",
    ),
    step: "s' = [s EXCEPT !.requests[1].collected = {1,2}]",
    witness: `${refreshed} /\\ ~${collected}`,
  },
  {
    name: "status-success false readback class",
    initial: state(
      "!.requests[1].status = 409, !.requests[1].noStore = TRUE, !.requests[1].returnedRow = 1, !.requests[1].returnedPayload = 1",
    ),
    step: "s' = [s EXCEPT !.requests[1].status = 200]",
    witness: `~${readback}`,
  },
  {
    name: "returned payload false class",
    initial: state(
      '!.requests[1].status = 200, !.requests[1].noStore = TRUE, !.requests[1].returnedRow = 1, !.requests[1].returnedPayload = 1, !.records[1] = [exists |-> TRUE, mode |-> "single", parent |-> 0, payload |-> 1, members |-> {1}]',
    ),
    step: "s' = [s EXCEPT !.requests[1].returnedPayload = 2]",
    witness: `~${readback}`,
  },
  {
    name: "row reference before another request heals a false receipt",
    initial: state(
      "!.requests[1].status = 200, !.requests[1].noStore = TRUE, !.requests[1].returnedRow = 2, !.requests[1].returnedPayload = 1, " +
        appendSecond,
    ),
    step: "IF s.requests[1].returnedRow = 2 THEN s' = [s EXCEPT !.requests[1].returnedRow = 1] ELSE appendRecord(2, FALSE)",
    witness: `rowAt(1).exists /\\ ${readback}`,
  },
  {
    name: "payload reference before another request heals a false receipt",
    initial: state(
      "!.requests[1].status = 200, !.requests[1].noStore = TRUE, !.requests[1].returnedRow = 1, !.requests[1].returnedPayload = 2, " +
        appendSecond,
    ),
    step: "IF s.requests[1].returnedPayload = 2 THEN s' = [s EXCEPT !.requests[1].returnedPayload = 1] ELSE appendRecord(2, FALSE)",
    witness: `rowAt(1).exists /\\ ${readback}`,
  },
  {
    name: "exact attempt before retry admission",
    initial: state("!.requests[1].attempt = 2"),
    step: 'IF s.requests[1].attempt = 2 THEN s\' = [s EXCEPT !.requests[1].attempt = 1] ELSE begin(1, "single", 1, 0, 1, FALSE)',
    witness: 's.requests[1].phase = "headers" /\\ s.requests[1].attempt = 2',
  },
  {
    name: "zero-attempt full envelope reset",
    initial: state(
      '!.requests[1].phase = "unused", !.requests[1].attempt = 0, !.requests[1].mode = "joint", !.requests[1].key = 2, !.requests[1].parent = 4, !.requests[1].payload = 2, !.requests[1].bundle = TRUE',
    ),
    step: 'begin(1, "single", 1, 0, 1, FALSE)',
    witness:
      's.requests[1].phase = "headers" /\\ s.requests[1].attempt = 1 /\\ s.requests[1].mode = "single" /\\ s.requests[1].key = 1 /\\ s.requests[1].parent = 0 /\\ s.requests[1].payload = 1 /\\ ~s.requests[1].bundle',
  },
  {
    name: "concrete retry resets the false no-store class",
    initial: state("!.requests[1].attempt = 1, !.requests[1].status = 409"),
    step: 'begin(1, "single", 1, 0, 1, FALSE)',
    witness: `s.requests[1].phase = "headers" /\\ ${noStore}`,
  },
  {
    name: "concrete retry resets a false subset class",
    initial: state("!.requests[1].attempt = 1, !.requests[1].refreshed = {1}"),
    step: 'begin(1, "single", 1, 0, 1, FALSE)',
    witness: `s.requests[1].phase = "headers" /\\ ${refreshed}`,
  },
  {
    name: "response-send carries false observations",
    initial: state(
      '!.requests[1].phase = "response", !.requests[1].status = 409',
    ),
    step: "send(1, TRUE)",
    witness: `s.requests[1].phase = "done" /\\ ~${noStore}`,
  },
];
for (const [field, oldValue, newValue] of [
  ["mode", '"joint"', '"single"'],
  ["key", "2", "1"],
  ["parent", "1", "0"],
  ["payload", "2", "1"],
  ["bundle", "TRUE", "FALSE"],
] as const)
  cases.push({
    name: `retryable exact ${field} envelope before concrete begin`,
    initial: state(
      `!.requests[1].attempt = 1, !.requests[1].${field} = ${oldValue}`,
    ),
    step: `IF s.requests[1].${field} = ${oldValue} THEN s' = [s EXCEPT !.requests[1].${field} = ${newValue}] ELSE begin(1, "single", 1, 0, 1, FALSE)`,
    witness: 's.requests[1].phase = "headers" /\\ s.requests[1].attempt = 2',
  });
// V2 additions: all preceding V1 named cases remain unchanged. No original
// exact-output witness needs retargeting: the old row/payload changes enter
// FALSE receipt classes before any healing, and those references remain exact.
const ready =
  '!.requests[1].phase = "prepare", !.requests[1].attempt = 1, !.requests[1].members = {1}, !.requests[1].registryRevision = 1, !.requests[1].collected = {}, !.requests[1].refreshed = {1}, !.requests[1].sourceRevisions[1] = 1';
const existingOne =
  '!.records[1] = [exists |-> TRUE, mode |-> "single", parent |-> 0, payload |-> 1, members |-> {1}]';
const existingTwo =
  '!.records[2] = [exists |-> TRUE, mode |-> "single", parent |-> 0, payload |-> 2, members |-> {1}]';
cases.push(
  {
    name: "actual last refresh enters the cut with only refreshed subset false",
    initial: state(
      '!.requests[1].phase = "refresh", !.requests[1].attempt = 1, !.requests[1].members = {1}, !.requests[1].sourceRevisions[1] = 1',
    ),
    step: "refresh(1, 1, TRUE)",
    witness: `s.requests[1].phase = "prepare" /\\ ~${refreshed} /\\ ${collected}`,
  },
  {
    name: "actual last refresh enters the cut with only collected subset false",
    initial: state(
      '!.requests[1].phase = "refresh", !.requests[1].attempt = 1, !.requests[1].members = {1}, !.requests[1].collected = {1,2}, !.requests[1].sourceRevisions[1] = 1',
    ),
    step: "refresh(1, 1, TRUE)",
    witness: `s.requests[1].phase = "prepare" /\\ ${refreshed} /\\ ~${collected}`,
  },
  {
    name: "actual refresh still reads the exact pre-cut source revision",
    initial: state(
      '!.requests[1].phase = "refresh", !.requests[1].attempt = 1, !.requests[1].members = {1}, !.requests[1].collected = {1}',
    ),
    step: "IF s.requests[1].sourceRevisions[1] = 0 THEN s' = [s EXCEPT !.requests[1].sourceRevisions[1] = 1] ELSE refresh(1, 1, TRUE)",
    witness: 's.requests[1].phase = "prepare"',
    minimumState: 3,
  },
  {
    name: "post-refresh source revision map domain remains exact",
    initial: state(ready),
    step: "s' = [s EXCEPT !.requests[1].sourceRevisions = [onlySourceId \\in {1} |-> 1]]",
    witness: "DOMAIN s.requests[1].sourceRevisions # {1,2}",
  },
  {
    name: "unknown phase source revision values remain exact",
    initial: state('!.requests[1].phase = "future-phase"'),
    step: "s' = [s EXCEPT !.requests[1].sourceRevisions[1] = 2]",
    witness: "s.requests[1].sourceRevisions[1] = 2",
  },
  {
    name: "unknown phase subset payloads remain exact",
    initial: state(
      '!.requests[1].phase = "future-phase", !.requests[1].members = {1}',
    ),
    step: "s' = [s EXCEPT !.requests[1].collected = {1}]",
    witness: "s.requests[1].collected = {1}",
  },
  {
    name: "post-refresh exact members still govern original append",
    initial: state(
      `${ready}, !.requests[1].phase = "append", !.requests[1].members = {2}, !.selected = {1}`,
    ),
    step: "IF s.requests[1].members = {2} THEN s' = [s EXCEPT !.requests[1].members = {1}] ELSE appendRecord(1, FALSE)",
    witness: "rowAt(1).exists",
    minimumState: 3,
  },
  {
    name: "actual post-cut failure send retry resets both independent false subsets",
    initial: state(
      `${ready}, !.requests[1].members = {}, !.requests[1].collected = {1}, !.requests[1].refreshed = {2}`,
    ),
    step: 'IF s.requests[1].phase = "prepare" THEN failure(1) ELSE IF s.requests[1].phase = "response" THEN send(1, FALSE) ELSE begin(1, "single", 1, 0, 1, FALSE)',
    witness: `s.requests[1].phase = "headers" /\\ s.requests[1].attempt = 2 /\\ ${refreshed} /\\ ${collected} /\\ ${readback}`,
    minimumState: 4,
  },
  {
    name: "actual unused begin resets false receipt and both false subsets",
    initial: state(
      '!.requests[1].phase = "unused", !.requests[1].attempt = 0, !.requests[1].status = 200, !.requests[1].returnedRow = 1, !.requests[1].returnedPayload = 1, !.requests[1].collected = {1}, !.requests[1].refreshed = {2}',
    ),
    step: 'begin(1, "single", 1, 0, 1, FALSE)',
    witness: `s.requests[1].phase = "headers" /\\ ${readback} /\\ ${refreshed} /\\ ${collected}`,
  },
  {
    name: "FALSE receipt heals through another slot actual append",
    initial: state(
      `!.requests[1].status = 200, !.requests[1].noStore = TRUE, !.requests[1].returnedRow = 1, !.requests[1].returnedPayload = 1, ${appendSecond}`,
    ),
    step: "appendRecord(2, FALSE)",
    witness: `s.requests[1].phase = "done" /\\ rowAt(1).exists /\\ ${readback}`,
  },
  {
    name: "FALSE mismatched payload remains false through other slot append",
    initial: state(
      `!.requests[1].status = 200, !.requests[1].noStore = TRUE, !.requests[1].returnedRow = 1, !.requests[1].returnedPayload = 2, ${appendSecond}`,
    ),
    step: "appendRecord(2, FALSE)",
    witness: `rowAt(1).exists /\\ ~${readback}`,
  },
  {
    name: "FALSE out-of-domain receipt references remain exact",
    initial: state(
      "!.requests[1].status = 200, !.requests[1].noStore = TRUE, !.requests[1].returnedRow = 5, !.requests[1].returnedPayload = 1",
    ),
    step: "s' = [s EXCEPT !.requests[1].returnedRow = 6]",
    witness: `s.requests[1].returnedRow = 6 /\\ ~${readback}`,
  },
  {
    name: "TRUE receipt cannot be overwritten by another slot replay",
    initial: state(
      `!.requests[1].status = 200, !.requests[1].noStore = TRUE, !.requests[1].returnedRow = 1, !.requests[1].returnedPayload = 1, ${existingOne}, ${appendSecond}, !.requests[2].payload = 2`,
    ),
    step: "appendRecord(2, FALSE)",
    witness: `s.requests[2].phase = "readback" /\\ rowAt(1).payload = 1 /\\ ${readback}`,
  },
  {
    name: "terminal send carries FALSE readback and both subset bits",
    initial: state(
      '!.requests[1].phase = "response", !.requests[1].status = 200, !.requests[1].returnedRow = 1, !.requests[1].returnedPayload = 1, !.requests[1].members = {}, !.requests[1].collected = {1}, !.requests[1].refreshed = {2}',
    ),
    step: "send(1, TRUE)",
    witness: `s.requests[1].phase = "done" /\\ ~${readback} /\\ ~${refreshed} /\\ ~${collected}`,
  },
);
for (const [phase, step, next] of [
  ["prepare", "prepare(1, TRUE)", "preflight"],
  ["preflight", "preflight(1)", "append"],
  ["append", "appendRecord(1, FALSE)", "readback"],
  ["readback", "readback(1, TRUE)", "response"],
] as const)
  cases.push({
    name: `actual ${phase} carries separate false refreshed subset`,
    initial: state(
      `${ready}, !.requests[1].phase = "${phase}"${phase === "readback" ? `, ${existingOne}` : ""}`,
    ),
    step,
    witness: `s.requests[1].phase = "${next}" /\\ ~${refreshed} /\\ ${collected}`,
  });
for (const phase of ["unused", "response", "done"] as const)
  cases.push({
    name: `${phase} keeps exact retry attempt and envelope after TRUE receipt erase`,
    initial: state(
      `!.requests[1].phase = "${phase}", !.requests[1].attempt = 1, !.requests[1].status = 200, !.requests[1].noStore = TRUE, !.requests[1].returnedRow = 1, !.requests[1].returnedPayload = 1, ${existingOne}`,
    ),
    step:
      phase === "response"
        ? "send(1, TRUE)"
        : 'begin(1, "single", 1, 0, 1, FALSE)',
    witness:
      phase === "response"
        ? `s.requests[1].phase = "done" /\\ s.requests[1].attempt = 1 /\\ ${readback}`
        : `s.requests[1].phase = "headers" /\\ s.requests[1].attempt = 2 /\\ ${readback}`,
  });

for (const control of cases)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native historical VIEW retains ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain("HISTORICAL_VIEW_NAMED_WITNESS_FOUND");
      expect(result.output).not.toContain("No error has been found");
      expect(result.output).toContain(`State ${control.minimumState ?? 2}:`);
      expect(result.output).not.toContain("violated by the initial state");
    },
    120_000,
  );
const coalescing: NativeCase[] = [
  {
    name: "live write-only received output",
    initial: state('!.requests[1].phase = "append"'),
    step: "s' = [s EXCEPT !.requests[1].received = TRUE]",
    witness: "FALSE",
  },
  ...[0, 2].map((attempt) => ({
    name: `terminal envelope with nonretryable attempt ${attempt}`,
    initial: state(`!.requests[1].attempt = ${attempt}`),
    step: 's\' = [s EXCEPT !.requests[1].mode = "joint", !.requests[1].key = 2, !.requests[1].parent = 4, !.requests[1].payload = 2, !.requests[1].bundle = TRUE]',
    witness: "FALSE",
  })),
  {
    name: "terminal non-success statuses and dead snapshots",
    initial: state("!.requests[1].status = 409, !.requests[1].noStore = TRUE"),
    step: "s' = [s EXCEPT !.requests[1].status = 503, !.requests[1].registryRevision = 2, !.requests[1].sourceRevisions[1] = 2, !.requests[1].members = {1,2}, !.requests[1].collected = {1}, !.requests[1].refreshed = {1}, !.requests[1].received = TRUE]",
    witness: "FALSE",
  },
  {
    name: "terminal raw sets while separate false observations stay false",
    initial: state("!.requests[1].status = 409, !.requests[1].refreshed = {1}"),
    step: "s' = [s EXCEPT !.requests[1].status = 503, !.requests[1].refreshed = {2}, !.requests[1].members = {1}]",
    witness: "FALSE",
  },
];
// V2 pairs keep all global records, indices and live members exact. FALSE
// receipt references are not coalesced; only original TRUE implications are.
for (const phase of ["unused", "response", "done"] as const) {
  coalescing.push(
    {
      name: `TRUE200 immutable receipt indices in ${phase}`,
      initial: state(
        `!.requests[1].phase = "${phase}", !.requests[1].attempt = 1, !.requests[1].status = 200, !.requests[1].noStore = TRUE, !.requests[1].returnedRow = 1, !.requests[1].returnedPayload = 1, ${existingOne}, ${existingTwo}`,
      ),
      step: "s' = [s EXCEPT !.requests[1].returnedRow = 2, !.requests[1].returnedPayload = 2]",
      witness: "FALSE",
    },
    {
      name: `TRUE non200 guard-false receipt indices in ${phase}`,
      initial: state(
        `!.requests[1].phase = "${phase}", !.requests[1].attempt = 1, !.requests[1].status = 409, !.requests[1].noStore = TRUE, !.requests[1].returnedRow = 1, !.requests[1].returnedPayload = 1`,
      ),
      step: "s' = [s EXCEPT !.requests[1].returnedRow = 2, !.requests[1].returnedPayload = 2]",
      witness: "FALSE",
    },
  );
}
for (const phase of ["prepare", "preflight", "append", "readback"] as const) {
  coalescing.push({
    name: `post-refresh source revision values in ${phase} with a false subset`,
    initial: state(`${ready}, !.requests[1].phase = "${phase}"`),
    step: "s' = [s EXCEPT !.requests[1].sourceRevisions[1] = 2, !.requests[1].sourceRevisions[2] = 2]",
    witness: "FALSE",
  });
  for (const [name, before, after] of [
    [
      "both true",
      "!.requests[1].collected = {}, !.requests[1].refreshed = {}",
      "!.requests[1].collected = {1}, !.requests[1].refreshed = {1}",
    ],
    [
      "first false second true",
      "!.requests[1].collected = {}, !.requests[1].refreshed = {1}",
      "!.requests[1].collected = {}, !.requests[1].refreshed = {1,2}",
    ],
    [
      "first true second false",
      "!.requests[1].collected = {1,2}, !.requests[1].refreshed = {1}",
      "!.requests[1].collected = {1,2,3}, !.requests[1].refreshed = {1,2}",
    ],
    [
      "both false",
      "!.requests[1].collected = {2}, !.requests[1].refreshed = {1}",
      "!.requests[1].collected = {2,3}, !.requests[1].refreshed = {1,4}",
    ],
  ] as const)
    coalescing.push({
      name: `post-refresh ${name} raw subsets in ${phase}`,
      initial: state(`${ready}, !.requests[1].phase = "${phase}", ${before}`),
      step: `s' = [s EXCEPT ${after}]`,
      witness: "FALSE",
    });
}

for (const control of coalescing)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native historical VIEW coalesces only ${control.name}`,
    async () => {
      const fixture = nativeFixture(control);
      const raw = await runNative(fixture, false);
      expect(raw.status, raw.output).toBe(0);
      expect(raw.output).toContain("HISTORICAL_VIEW_NATIVE_COMPLETE");
      expect(raw.output).toMatch(/2 distinct states? found/u);
      expect(raw.output).toMatch(/0 states? left on queue/u);
      const result = await runNative(fixture);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain("HISTORICAL_VIEW_NATIVE_COMPLETE");
      expect(result.output).toMatch(/1 distinct states? found/u);
      expect(result.output).toMatch(/0 states? left on queue/u);
    },
    120_000,
  );
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native exhausted terminal request cannot restart",
  async () => {
    const result = await runNative(
      nativeFixture({
        name: "exhausted begin remains disabled",
        initial,
        step: 'begin(1, "single", 1, 0, 1, FALSE) \\/ s\' = s',
        witness: 's.requests[1].phase # "done"',
      }),
    );
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("HISTORICAL_VIEW_NATIVE_COMPLETE");
    expect(result.output).toMatch(/1 distinct states? found/u);
  },
  120_000,
);

test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native no-VIEW witness exposes future exhausted-envelope consumption",
  async () => {
    const result = await runNative(
      nativeFixture({
        name: "future exhausted-envelope consumer",
        initial: state('!.requests[1].phase = "response"'),
        step: "IF s.requests[1].key = 1 THEN s' = [s EXCEPT !.requests[1].key = 2] ELSE send(1, TRUE)",
        witness: 's.requests[1].phase = "done"',
      }),
      false,
    );
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("HISTORICAL_VIEW_NAMED_WITNESS_FOUND");
    expect(result.output).not.toContain("No error has been found");
    expect(result.output).toContain("State 2:");
    expect(result.output).not.toContain("violated by the initial state");
  },
  120_000,
);

// These deliberately unviewed future consumers show why the old source pin
// cannot authorize new post-cut reads or terminal receipt routing.
for (const control of [
  {
    name: "future post-refresh snapshot consumption",
    initial: state('!.requests[1].phase = "prepare"'),
    step: "IF s.requests[1].sourceRevisions[1] = 0 THEN s' = [s EXCEPT !.requests[1].sourceRevisions[1] = 1] ELSE prepare(1, TRUE)",
    witness: 's.requests[1].phase = "preflight"',
  },
  {
    name: "future TRUE receipt output consumption",
    initial: state('!.requests[1].phase = "response"'),
    step: "IF s.requests[1].returnedRow = 0 THEN s' = [s EXCEPT !.requests[1].returnedRow = 1] ELSE send(1, TRUE)",
    witness: 's.requests[1].phase = "done"',
  },
] as const)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native no-VIEW witness exposes ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control), false);
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain("HISTORICAL_VIEW_NAMED_WITNESS_FOUND");
      expect(result.output).toContain("State 3:");
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );
