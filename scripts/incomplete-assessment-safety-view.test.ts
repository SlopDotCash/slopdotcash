/** Exact-source controls; native checks require an explicit separate flag. */
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
const selected = manifest.views.find(
  (v) => v.id === "incomplete-assessment-query-observation-safety-v1",
);
if (!selected) throw new Error("Missing reviewed incomplete-assessment VIEW");
const view: SafetyViewDefinition = selected;
const source = readFileSync(join(root, view.model), "utf8");
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
function replaceOnce(s: string, before: string, after: string) {
  if (s.split(before).length !== 2)
    throw new Error(`Expected one source boundary: ${before}`);
  return s.replace(before, after);
}
test("query VIEW binds the complete unchanged model and all23 original scenarios", () => {
  expect(view.model).toBe(
    "formal/models/api/incomplete_assessment_queries.qnt",
  );
  expect(view.operator).toBe("SlopIncompleteAssessmentQueryViewV1");
  expect(digest(source)).toBe(
    "2cd566d8f8830d594550ff9991486042a4bd79895aaa5396550bac8db25b5ca7",
  );
  expect(bindSafetyView(manifest, view.id, view.model, source)).toEqual(view);
  expect(source.match(/^ {2}run \w+\s*=/gmu)).toHaveLength(23);
});
test("query VIEW keeps its literal raw observations and exact appended binding", () => {
  expect(view.fields).toEqual([
    {
      name: "state",
      expression:
        'LET SlopIAQTerminal == (s.phase \\in {"idle", "done"}) SlopIAQPermission == (IF s.permission = "allowed" THEN "allowed" ELSE IF s.permission \\in {"unavailable", "missing", "replaced"} THEN "unavailable" ELSE "denied") IN [s EXCEPT !.ordinaryRead = FALSE, !.permission = SlopIAQPermission, !.rows = [SlopIAQDelivery \\in DOMAIN s.rows |-> [s.rows[SlopIAQDelivery] EXCEPT !.retry = -1]], !.retry = [SlopIAQPr \\in DOMAIN s.retry |-> -1], !.since = [SlopIAQPr \\in DOMAIN s.since |-> IF SlopIAQTerminal THEN -1 ELSE IF s.since[SlopIAQPr] >= 0 THEN 0 ELSE -1], !.actor = IF SlopIAQTerminal THEN 0 ELSE s.actor, !.bundled = IF SlopIAQTerminal THEN FALSE ELSE s.bundled, !.cursor = IF SlopIAQTerminal THEN 0 ELSE s.cursor, !.capturedManifest = IF SlopIAQTerminal THEN 0 ELSE s.capturedManifest, !.capturedBinding = IF SlopIAQTerminal THEN FALSE ELSE s.capturedBinding, !.contexts = IF SlopIAQTerminal THEN FALSE ELSE s.contexts, !.allowed = IF SlopIAQTerminal THEN FALSE ELSE s.allowed, !.queue = IF SlopIAQTerminal THEN "none" ELSE s.queue, !.status = IF SlopIAQTerminal THEN 0 ELSE s.status, !.ordinaryNotice = IF SlopIAQTerminal THEN FALSE ELSE s.ordinaryNotice, !.items = IF SlopIAQTerminal THEN {} ELSE s.items, !.eligibleSnapshot = IF SlopIAQTerminal THEN {} ELSE s.eligibleSnapshot, !.running = IF SlopIAQTerminal THEN {} ELSE s.running, !.nextCursor = IF SlopIAQTerminal THEN 0 ELSE s.nextCursor, !.publishedManifest = IF SlopIAQTerminal THEN 0 ELSE s.publishedManifest]',
    },
  ]);
  expect(view.clauses).toEqual([
    {
      name: "deliveryRetryLower",
      expression:
        "[SlopIAQDelivery \\in deliveries |-> (s.rows[SlopIAQDelivery].retry >= -1)]",
    },
    {
      name: "deliveryRetryUpper",
      expression:
        "[SlopIAQDelivery \\in deliveries |-> (s.rows[SlopIAQDelivery].retry <= 4)]",
    },
    {
      name: "queryItemCount",
      expression: "(Cardinality(s.items) <= 2)",
    },
    {
      name: "queryItemSubset",
      expression: "(s.items \\subseteq s.eligibleSnapshot)",
    },
    {
      name: "queryItemCursor",
      expression: "(\\A SlopIAQPr \\in s.items: SlopIAQPr > s.cursor)",
    },
    {
      name: "queryItemSince",
      expression: "(\\A SlopIAQPr \\in s.items: s.since[SlopIAQPr] >= 0)",
    },
    {
      name: "queryRunningSubset",
      expression: "(s.running \\subseteq s.items)",
    },
    {
      name: "queryNextCursor",
      expression: "((s.nextCursor # 0) => (s.nextCursor \\in s.items))",
    },
    {
      name: "queryReadyAccess",
      expression:
        '((s.queue = "ready" /\\ Cardinality(s.items) > 0) => (s.allowed /\\ s.capturedBinding))',
    },
    {
      name: "queryReadyManifest",
      expression:
        '((s.queue = "ready" /\\ s.allowed) => (s.publishedManifest = s.capturedManifest))',
    },
    {
      name: "queryUnavailable",
      expression:
        '((s.queue = "unavailable") => (s.bundled /\\ s.status = 200 /\\ s.ordinaryNotice /\\ s.items = {}))',
    },
    {
      name: "queryDoneStatus",
      expression:
        '((s.phase = "done" /\\ s.status = 200) => (s.queue \\in {"ready", "unavailable"}))',
    },
    {
      name: "queryAuthNotice",
      expression: "((s.status = 401 \\/ s.status = 403) => ~s.ordinaryNotice)",
    },
  ]);
  expect(view.translatedSha256).toBe(
    "38a24e884aa6b2ff90dcd18c381d945419c729f6ed1f30dbd436e1b616ca48c1",
  );
  expect(view.viewTlaSha256).toBe(
    "e26d2fe13e61f88478a1c48828bc8324d03c5cb43ab4aab59134d32bd2c577c9",
  );
  const originalIds = [
    "direct-bounty-journal-safety-v4",
    "owner-vault-cap-cone-safety-v8",
    "project-lookup-phase-liveness-safety-v6",
    "ui-admin-mutation-continuation-safety-v2",
    "email-preference-request-observation-safety-v1",
    "ui-project-publication-continuation-safety-v2",
    "ui-security-settings-lifetime-safety-v2",
    "solana-binding-api-observation-safety-v1",
    "solana-wallet-provider-observation-safety-v3",
    "ui-contributor-allocation-safety-v2",
    "bot-inference-attempt-id-symmetry-v1",
    "operator-keeper-continuation-safety-v1",
  ];
  const originals = manifest.views.filter((v) => originalIds.includes(v.id));
  expect(originals).toHaveLength(12);
  expect(digest(JSON.stringify(originals))).toBe(
    "5af165f8bf4ce53049074c6812560adacc0d06f3c7f785972f0edcdaef7d2442",
  );
  expect(view.fields[0].expression).not.toMatch(/\bLET (?!Slop)[A-Za-z]/u);
});
for (const [name, before, after] of [
  [
    "retry guard",
    'row.exists, row.phase == "waiting",',
    'row.exists, row.retry <= 4, row.phase == "waiting",',
  ],
  [
    "retry output consumer",
    "s.requestCount < 2,",
    "s.requestCount < 2, s.retry.get(1) == -1,",
  ],
  [
    "since consumer",
    "val eligible = if (s.allowed)",
    "val eligible = if (s.allowed and s.since.get(1) >= 0)",
  ],
  ["ordinary-read consumer", "s.now < 3,", "s.now < 3, s.ordinaryRead,"],
  [
    "terminal captured-field consumer",
    'deliveries.contains(id), Set("absent",',
    'deliveries.contains(id), s.allowed, Set("absent",',
  ],
  [
    "permission class split",
    's.permission == "allowed"',
    'Set("allowed", "private").contains(s.permission)',
  ],
  [
    "delivery domain",
    "val deliveries = Set(1, 2, 3, 4)",
    "val deliveries = Set(1, 2, 3, 4, 5)",
  ],
  ["retry invariant", "row.retry <= 4", "row.retry <= 5"],
] as const)
  test(`query VIEW refuses source drift through ${name}`, () => {
    expect(() =>
      bindSafetyView(
        manifest,
        view.id,
        view.model,
        replaceOnce(source, before, after),
      ),
    ).toThrow("model changed");
  });
function fixtureBinding(tlaCode: string): SafetyViewDefinition {
  const end = tlaCode.match(/^={4,}[ \t]*$/gmu);
  if (end?.length !== 1 || !tlaCode.endsWith(`${end[0]}\n`))
    throw new Error("Native fixture module terminator differs");
  const expressions = [...view.fields, ...view.clauses].map(
    ({ expression }) => expression,
  );
  const projected =
    tlaCode.slice(0, -end[0].length - 1) +
    view.operator +
    " ==\n  <<" +
    expressions.join(", ") +
    ">>\n\n" +
    end[0] +
    "\n";
  return {
    ...view,
    translatedSha256: digest(tlaCode),
    viewTlaSha256: digest(projected),
  };
}

test("query VIEW rejects translation, temporal and expression drift", () => {
  const temporal = `${source}\ntemporal unsafeProperty = true\n`;
  expect(() =>
    bindSafetyView(
      { ...manifest, views: [{ ...view, sourceSha256: digest(temporal) }] },
      view.id,
      view.model,
      temporal,
    ),
  ).toThrow("does not authorize temporal");
  const tlaCode = `---- MODULE ${view.module} ----\nVARIABLE s\n====\n`;
  const binding = fixtureBinding(tlaCode);
  const config = {
    moduleName: view.module,
    hasInvariant: true,
    hasTemporal: false,
    tlaCode,
  };
  expect(digest(applySafetyView(binding, config).tlaCode)).toBe(
    binding.viewTlaSha256,
  );
  expect(() =>
    applySafetyView(binding, { ...config, tlaCode: `${tlaCode}\n` }),
  ).toThrow("generated TLA changed");
  expect(() =>
    applySafetyView(binding, { ...config, hasTemporal: true }),
  ).toThrow("property differs");
  for (const changed of [
    { ...binding, fields: [{ name: "state", expression: "s" }] },
    { ...binding, clauses: [] },
    { ...binding, clauses: [...binding.clauses].reverse() },
    { ...binding, operator: "UnreviewedQueryView" },
  ])
    expect(() => applySafetyView(changed, config)).toThrow("property differs");
});
let translated: string | undefined;
function actualTranslatedModel() {
  if (translated !== undefined) return translated;
  const directory = mkdtempSync(join(tmpdir(), "slop-incomplete-query-view-"));
  const output = join(directory, "production.tla");
  try {
    // This runs only under the explicit native-test flag. Capture the complete
    // production translation before TLC begins any full-model exploration.
    const capture = [
      'import {createRequire} from "node:module";',
      'import {realpathSync,writeFileSync} from "node:fs";',
      'import {pathToFileURL} from "node:url";',
      "const require=createRequire(import.meta.url);",
      'const cli=realpathSync("./node_modules/.bin/quint");',
      "delete process.env.SLOP_QUINT_SAFETY_VIEW;",
      'process.argv=[process.execPath,cli,"verify",' +
        JSON.stringify(view.model) +
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
    expect(digest(translated)).toBe(view.translatedSha256);
    const prepared = applySafetyView(view, {
      moduleName: view.module,
      hasInvariant: true,
      hasTemporal: false,
      tlaCode: translated,
    });
    expect(digest(prepared.tlaCode)).toBe(view.viewTlaSha256);
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
  witnessState?: 2 | 3;
};
function injectNativeControl(tla: string, control: NativeCase) {
  tla = replaceOnce(
    tla,
    "q_init == init",
    `SlopIAQControlInitial == ${control.initial}\n\nq_init == s = SlopIAQControlInitial`,
  );
  // Negative controls must find the exact named witness. The deliberately bad
  // raw fixtures cannot pass merely because the production invariant is false.
  tla = replaceOnce(
    tla,
    "q_inv == invariant",
    `SlopIAQControlWitness == ${control.witness}\n\nq_inv == ~SlopIAQControlWitness`,
  );
  // Production action aliases follow their dependencies. Keep the control
  // step beside q_step so every referenced original action is already bound.
  return replaceOnce(
    tla,
    "q_step == step",
    `SlopIAQControlStep == ${control.step}\n\nq_step == SlopIAQControlStep`,
  );
}
function nativeFixture(control: NativeCase) {
  return injectNativeControl(actualTranslatedModel(), control);
}

test("native aliases refer only to the named witness and follow production actions", () => {
  const fixture = injectNativeControl(
    `---- MODULE x ----\nVARIABLE s\ninit == s=0\nq_init == init\ninvariant == TRUE\nq_inv == invariant\nrecordRunning(id) == s'=s\nstep == recordRunning(1)\nq_step == step\n====\n`,
    { name: "order", initial: "0", step: "recordRunning(1)", witness: "s=1" },
  );
  expect(fixture.indexOf("SlopIAQControlStep ==")).toBeGreaterThan(
    fixture.indexOf("recordRunning(id) =="),
  );
  expect(fixture).toContain("q_inv == ~SlopIAQControlWitness");
  expect(fixture).not.toContain("q_inv == invariant");
});
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
    'if(result.isLeft()){if(result.value.isViolation){console.log("INCOMPLETE_QUERY_NAMED_WITNESS_FOUND");process.exitCode=1;}',
    'else{console.log("INCOMPLETE_QUERY_NATIVE_ERROR");process.exitCode=2;}}else console.log("INCOMPLETE_QUERY_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "incomplete-query-view-native-control",
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

const row =
  '[exists |-> TRUE, gap |-> 0, retry |-> -1, phase |-> "waiting", resolving |-> FALSE, updated |-> 0]';
const initial =
  '[rows |-> [SlopIAQId \\in deliveries |-> [exists |-> FALSE, gap |-> -1, retry |-> -1, phase |-> "absent", resolving |-> FALSE, updated |-> 0]], now |-> 0, manifest |-> 1, binding |-> TRUE, permission |-> "allowed", requestCount |-> 0, phase |-> "idle", actor |-> 0, bundled |-> FALSE, cursor |-> 0, capturedManifest |-> 0, capturedBinding |-> FALSE, contexts |-> FALSE, allowed |-> FALSE, queue |-> "none", status |-> 0, ordinaryNotice |-> FALSE, ordinaryRead |-> FALSE, items |-> {}, eligibleSnapshot |-> {}, since |-> [SlopIAQPr \\in prs |-> -1], retry |-> [SlopIAQPr \\in prs |-> -1], running |-> {}, nextCursor |-> 0, publishedManifest |-> 0]';
const state = (changes: string) => `[${initial} EXCEPT ${changes}]`;
const retryFlags = (id: number) => [
  `(s.rows[${id}].retry >= -1)`,
  `(s.rows[${id}].retry <= 4)`,
];
const queryFlags = [
  "Cardinality(s.items) <= 2",
  "s.items \\subseteq s.eligibleSnapshot",
  "\\A SlopIAQPr \\in s.items: SlopIAQPr > s.cursor",
  "\\A SlopIAQPr \\in s.items: s.since[SlopIAQPr] >= 0",
  "s.running \\subseteq s.items",
  "(s.nextCursor # 0) => (s.nextCursor \\in s.items)",
  '(s.queue = "ready" /\\ Cardinality(s.items) > 0) => (s.allowed /\\ s.capturedBinding)',
  '(s.queue = "ready" /\\ s.allowed) => (s.publishedManifest = s.capturedManifest)',
  '(s.queue = "unavailable") => (s.bundled /\\ s.status = 200 /\\ s.ordinaryNotice /\\ s.items = {})',
  '(s.phase = "done" /\\ s.status = 200) => (s.queue \\in {"ready", "unavailable"})',
  "(s.status = 401 \\/ s.status = 403) => ~s.ordinaryNotice",
].map((expression) => `(${expression})`);
const healthyQuery = queryFlags.join(" /\\ ");
const cases: NativeCase[] = [];
for (const id of [1, 2, 3, 4]) {
  const other = (id % 4) + 1;
  for (const bad of [-2, 5]) {
    for (const action of ["recordRunning", "recordCompletion"])
      cases.push({
        name: `${action} heals delivery ${id} retry ${bad} while ${other} remains false`,
        initial: state(
          `!.rows[${id}] = [${row} EXCEPT !.retry = ${bad}, !.phase = "${action === "recordRunning" ? "waiting" : "running"}"], ` +
            `!.rows[${other}] = [${row} EXCEPT !.retry = ${bad}]`,
        ),
        step:
          action === "recordRunning"
            ? `recordRunning(${id})`
            : `recordCompletion(${id}, FALSE)`,
        witness:
          `s.rows[${id}].phase = "${action === "recordRunning" ? "running" : "completed"}" /\\ ` +
          retryFlags(id).join(" /\\ ") +
          ` /\\ ~${retryFlags(other)[bad === -2 ? 0 : 1]}`,
      });
  }
  for (const now of [-3, 4])
    cases.push({
      name: `recordGap computes delivery ${id}'s retry bound from dirty now=${now}`,
      initial: state(`!.rows[${id}] = ${row}, !.now = ${now}`),
      step: `recordGap(${id})`,
      witness:
        `s.rows[${id}].updated = ${now} /\\ s.rows[${id}].retry = ${now + 1} /\\ ` +
        `~${retryFlags(id)[now < 0 ? 0 : 1]}`,
    });
}

for (const action of [
  "validateCursor",
  "readFailure",
  "observeAccess",
  "publish",
])
  cases.push({
    name: `${action} retains bundled unavailable-without-notice false class`,
    initial: state(
      `!.phase = "${action === "validateCursor" ? "cursor" : action === "readFailure" ? "rows" : action === "observeAccess" ? "access" : "manifest"}", ` +
        "!.bundled = TRUE, !.ordinaryNotice = FALSE, !.actor = 1, !.contexts = TRUE, !.capturedBinding = TRUE, " +
        '!.permission = "unavailable", !.allowed = TRUE, !.capturedManifest = 2',
    ),
    step: action === "validateCursor" ? "validateCursor(FALSE)" : action,
    witness:
      's.phase = "done" /\\ s.queue = "unavailable" /\\ s.status = 200 /\\ ' +
      `~${queryFlags[8]}`,
  });

for (const allowed of [false, true])
  cases.push({
    name: `publish preserves dirty ready access with allowed=${allowed}`,
    initial: state(
      '!.phase = "manifest", !.items = {1}, !.eligibleSnapshot = {1}, !.since[1] = 0, ' +
        `!.allowed = ${allowed ? "TRUE" : "FALSE"}, !.capturedBinding = FALSE, !.capturedManifest = 1`,
    ),
    step: "publish",
    witness: `s.phase = "done" /\\ s.queue = "ready" /\\ ~${queryFlags[6]}`,
  });

cases.push(
  {
    name: "observeContexts heals dirty ready access and manifest implications",
    initial: state(
      '!.phase = "contexts", !.queue = "ready", !.items = {1}, !.eligibleSnapshot = {1}, !.since[1] = 0, ' +
        "!.allowed = TRUE, !.binding = TRUE, !.manifest = 1, !.capturedBinding = FALSE, !.capturedManifest = 2, !.publishedManifest = 1",
    ),
    step: "observeContexts",
    witness: `s.phase = "access" /\\ ${queryFlags[6]} /\\ ${queryFlags[7]}`,
  },
  {
    name: "observeContexts breaks previously good ready access and manifest implications",
    initial: state(
      '!.phase = "contexts", !.queue = "ready", !.items = {1}, !.eligibleSnapshot = {1}, !.since[1] = 0, ' +
        "!.allowed = TRUE, !.binding = FALSE, !.manifest = 2, !.capturedBinding = TRUE, !.capturedManifest = 1, !.publishedManifest = 1",
    ),
    step: "observeContexts",
    witness: `s.phase = "access" /\\ ~${queryFlags[6]} /\\ ~${queryFlags[7]}`,
  },
  {
    name: "observeAccess denied changes allowed to false and breaks ready access",
    initial: state(
      '!.phase = "access", !.queue = "ready", !.items = {1}, !.eligibleSnapshot = {1}, !.since[1] = 0, ' +
        '!.actor = 1, !.contexts = TRUE, !.allowed = TRUE, !.capturedBinding = TRUE, !.capturedManifest = 1, !.publishedManifest = 1, !.permission = "denied"',
    ),
    step: "observeAccess",
    witness: `s.phase = "rows" /\\ ~s.allowed /\\ ~${queryFlags[6]}`,
  },
  {
    name: "observeAccess allowed changes allowed to true and heals ready access",
    initial: state(
      '!.phase = "access", !.queue = "ready", !.items = {1}, !.eligibleSnapshot = {1}, !.since[1] = 0, ' +
        '!.actor = 1, !.contexts = TRUE, !.allowed = FALSE, !.capturedBinding = TRUE, !.capturedManifest = 1, !.publishedManifest = 1, !.permission = "allowed"',
    ),
    step: "observeAccess",
    witness: `s.phase = "rows" /\\ s.allowed /\\ ${queryFlags[6]} /\\ ${queryFlags[7]}`,
  },
);

for (const action of ["recordRunning", "recordCompletion"])
  cases.push({
    name: `terminal snapshot since remains false after ${action}`,
    initial: state(
      '!.phase = "done", !.queue = "ready", !.status = 200, !.items = {1}, !.eligibleSnapshot = {1}, ' +
        "!.running = {1}, !.allowed = TRUE, !.capturedBinding = TRUE, !.capturedManifest = 1, !.publishedManifest = 1, " +
        `!.rows[1] = [${row} EXCEPT !.phase = "${action === "recordRunning" ? "waiting" : "running"}"]`,
    ),
    step:
      action === "recordRunning"
        ? "recordRunning(1)"
        : "recordCompletion(1, TRUE)",
    witness:
      `s.rows[1].phase = "${action === "recordRunning" ? "running" : "completed"}" /\\ ` +
      `s.items = {1} /\\ s.running = {1} /\\ ~${queryFlags[3]}`,
  });

const dirtyQuery =
  "!.items = {1,2,3}, !.eligibleSnapshot = {}, !.cursor = 3, !.running = {4}, !.nextCursor = 4, " +
  '!.queue = "unavailable", !.status = 401, !.bundled = FALSE, !.ordinaryNotice = TRUE, ' +
  `!.rows[2] = [${row} EXCEPT !.retry = 5]`;
for (const phase of ["idle", "done"])
  cases.push({
    name: `begin resets dirty ${phase} query while row retry remains false`,
    initial: state(`!.phase = "${phase}", ${dirtyQuery}`),
    step: "begin(1,1,FALSE,0)",
    witness: `s.phase = "cursor" /\\ s.requestCount = 1 /\\ ${healthyQuery} /\\ ~${retryFlags(2)[1]}`,
  });

for (const control of cases)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native query VIEW retains ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("INCOMPLETE_QUERY_NAMED_WITNESS_FOUND");
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain(`State ${control.witnessState ?? 2}:`);
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );

test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native query VIEW retains the captured actor in an unknown phase with RAW2/VIEW2",
  async () => {
    // Only the captured request actor changes; flags and other captures stay
    // equal. Unknown phases must follow the conservative live-field branch.
    await completePair(
      {
        name: "unknown phase captured actor",
        initial: state(
          '!.phase = "unknown", !.actor = 1, !.capturedManifest = 1, !.capturedBinding = TRUE',
        ),
        step: "s' = [s EXCEPT !.actor = 2]",
        witness: "FALSE",
      },
      2,
      2,
    );
  },
  120_000,
);

function completedGraphCounts(output: string, expectedDistinct: number) {
  const markers = [
    ...output.matchAll(/^INCOMPLETE_QUERY_NATIVE_COMPLETE\r?$/gmu),
  ];
  if (markers.length !== 1)
    throw new Error("Expected one successful complete marker");
  // TLC prints its terminal summary before the caller's complete marker.
  // Anchor the whole summary line so startup/progress lines cannot qualify.
  const beforeComplete = output.slice(0, markers[0].index);
  const terminal = [
    ...beforeComplete.matchAll(
      /^[\t ]*([0-9][0-9,]*) states? generated, ([0-9][0-9,]*) distinct states? found, ([0-9][0-9,]*) states? left on queue\.[\t ]*\r?$/gmu,
    ),
  ].at(-1);
  if (!terminal) throw new Error("Missing terminal state-count summary");
  const distinct = Number(terminal[2].replaceAll(",", ""));
  const queued = Number(terminal[3].replaceAll(",", ""));
  if (!Number.isSafeInteger(distinct) || !Number.isSafeInteger(queued))
    throw new Error("Invalid terminal state counts");
  if (distinct !== expectedDistinct || queued !== 0)
    throw new Error(
      `Expected ${expectedDistinct} distinct and 0 queued; got ${distinct} distinct and ${queued} queued`,
    );
  return { distinct, queued };
}

test("completed graph counts use the final summary rather than progress", () => {
  const progress =
    "Progress(1) at time: 1 states generated (1 s/min), 1 distinct states found (1 ds/min), 0 states left on queue.\n";
  const output = `${progress}4 states generated, 2 distinct states found, 0 states left on queue.\nINCOMPLETE_QUERY_NATIVE_COMPLETE\n`;
  expect(() => completedGraphCounts(output, 1)).toThrow("got 2 distinct");
  expect(completedGraphCounts(output, 2)).toEqual({ distinct: 2, queued: 0 });
  const nonemptyFinal = `${progress}1 states generated, 1 distinct states found, 0 states left on queue.\n4 states generated, 2 distinct states found, 1 states left on queue.\nINCOMPLETE_QUERY_NATIVE_COMPLETE\n`;
  expect(() => completedGraphCounts(nonemptyFinal, 2)).toThrow("1 queued");
  expect(() => completedGraphCounts(progress, 1)).toThrow("complete marker");
  expect(() =>
    completedGraphCounts(`${progress}INCOMPLETE_QUERY_NATIVE_COMPLETE\n`, 1),
  ).toThrow("terminal state-count summary");
});

async function completePair(
  control: NativeCase,
  rawCount: number,
  viewCount: number,
) {
  const fixture = nativeFixture(control);
  for (const useView of [false, true]) {
    const result = await runNative(fixture, useView);
    expect(result.status, result.output).toBe(0);
    expect(
      completedGraphCounts(result.output, useView ? viewCount : rawCount),
    ).toEqual({
      distinct: useView ? viewCount : rawCount,
      queued: 0,
    });
  }
}

test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native query VIEW retains RAW81/VIEW81 feasible indexed retry classes",
  async () => {
    const combinations = [-2, -1, 5].flatMap((one) =>
      [-2, -1, 5].flatMap((two) =>
        [-2, -1, 5].flatMap((three) =>
          [-2, -1, 5].map((four) => [one, two, three, four]),
        ),
      ),
    );
    await completePair(
      {
        name: "81 feasible bound vectors",
        initial: state(`!.rows = [SlopIAQId \\in deliveries |-> ${row}]`),
        step: combinations
          .map(
            (values) =>
              `(s' = [s EXCEPT ${values.map((value, index) => `!.rows[${index + 1}].retry = ${value}`).join(", ")}])`,
          )
          .join(" \\/\n"),
        witness: "FALSE",
      },
      81,
      81,
    );
  },
  120_000,
);

test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native query VIEW closes observeRows retry copy with RAW4/VIEW2",
  async () => {
    // The raw graph includes both original observeRows executions. Fixture
    // mutations expose both same-class source and output alternatives even
    // after VIEW coalesces one predecessor; JS does not model observeRows.
    const flip = "IF s.rows[1].retry = 1 THEN 2 ELSE 1";
    await completePair(
      {
        name: "closed retry copy cone",
        initial: state(
          `!.phase = "rows", !.allowed = TRUE, !.capturedBinding = TRUE, !.rows[1] = [${row} EXCEPT !.retry = 1]`,
        ),
        step: `observeRows \\/ ((s.phase = "rows") /\\ s' = [s EXCEPT !.rows[1].retry = ${flip}]) \\/ ((s.phase = "manifest") /\\ s' = [s EXCEPT !.rows[1].retry = ${flip}, !.retry[1] = ${flip}])`,
        witness: "FALSE",
      },
      4,
      2,
    );
  },
  120_000,
);

const isolatedQueryFalse = [
  "!.items = {1,2,3}, !.eligibleSnapshot = {1,2,3}, !.since = [SlopIAQPr \\in prs |-> 0]",
  "!.items = {1}, !.since[1] = 0",
  "!.items = {1}, !.eligibleSnapshot = {1}, !.cursor = 1, !.since[1] = 0",
  "!.items = {1}, !.eligibleSnapshot = {1}",
  "!.running = {1}",
  "!.nextCursor = 1",
  '!.queue = "ready", !.items = {1}, !.eligibleSnapshot = {1}, !.since[1] = 0',
  '!.queue = "ready", !.allowed = TRUE, !.capturedBinding = TRUE, !.publishedManifest = 1',
  '!.queue = "unavailable", !.bundled = TRUE, !.status = 200',
  "!.status = 200",
  "!.status = 401, !.ordinaryNotice = TRUE",
];
for (const [index, change] of isolatedQueryFalse.entries())
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native query VIEW keeps terminal isolated query clause ${index + 1}`,
    async () => {
      await completePair(
        {
          name: `isolated query flag ${index + 1}`,
          initial: state('!.phase = "done"'),
          step: `s' = [${state('!.phase = "done"')} EXCEPT ${change}]`,
          witness: "FALSE",
        },
        2,
        2,
      );
    },
    120_000,
  );

for (const phase of ["idle", "done"])
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native query VIEW keeps exhausted ${phase} begin disabled`,
    async () => {
      await completePair(
        {
          name: "exhausted request counter",
          initial: state(
            `!.phase = "${phase}", !.requestCount = 2, ${dirtyQuery}`,
          ),
          step: "begin(1,1,FALSE,0)",
          witness: "FALSE",
        },
        1,
        1,
      );
    },
    120_000,
  );

test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native query VIEW coalesces only output details with RAW2/VIEW1",
  async () => {
    await completePair(
      {
        name: "same predicates and raw flags",
        initial: state(
          `!.phase = "rows", !.permission = "missing", !.items = {1}, !.eligibleSnapshot = {1}, !.since[1] = 0, !.rows[1] = ${row}`,
        ),
        step: 's\' = [s EXCEPT !.ordinaryRead = TRUE, !.permission = "replaced", !.since[1] = 7, !.retry[1] = 3, !.rows[1].retry = 2]',
        witness: "FALSE",
      },
      2,
      1,
    );
  },
  120_000,
);

for (const actor of [1, 2, 3])
  for (const bundled of [false, true])
    test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
      `native query VIEW keeps all permission labels for actor ${actor}, bundled=${bundled}`,
      async () => {
        // All six original action labels remain present. Only their observed
        // source predicates are grouped, including the admin outage bypass.
        const labels = [
          "allowed",
          "denied",
          "private",
          "unavailable",
          "missing",
          "replaced",
        ];
        await completePair(
          {
            name: "permission predicates through actual access observation",
            initial: state(
              `!.phase = "access", !.contexts = TRUE, !.capturedBinding = TRUE, !.actor = ${actor}, !.bundled = ${bundled ? "TRUE" : "FALSE"}, !.ordinaryNotice = ${bundled ? "TRUE" : "FALSE"}`,
            ),
            step: `(s.phase = "access" /\\ (${labels.map((label) => `permission("${label}")`).join(" \\/ ")})) \\/ observeAccess`,
            witness: "FALSE",
          },
          12,
          6,
        );
      },
      120_000,
    );

for (const phase of ["rows", "done"])
  for (const field of ["since", "retry"])
    test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
      `native query VIEW retains actual ${field} domain in ${phase}`,
      async () => {
        await completePair(
          {
            name: "actual output map domain",
            initial: state(`!.phase = "${phase}"`),
            step: `s' = [s EXCEPT !.${field} = [SlopIAQPr \\in ((DOMAIN s.${field}) \\cup {4}) |-> -1]]`,
            witness: "FALSE",
          },
          2,
          2,
        );
      },
      120_000,
    );
