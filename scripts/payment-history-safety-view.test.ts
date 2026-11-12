/** Exact-source controls for the payment-history V2 terminal-page safety VIEW. */
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
  (entry) => entry.id === "payment-history-terminal-page-safety-v2",
);
if (!view) throw new Error("Missing reviewed payment-history safety VIEW");
const selected: SafetyViewDefinition = view;
const source = readFileSync(join(root, selected.model), "utf8");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2)
    throw new Error(`Expected one audited source boundary: ${from}`);
  return text.replace(from, to);
}

test("payment-history VIEW binds the complete guarded model and all 25 concrete scenarios", () => {
  expect(selected.model).toBe("formal/models/payments/payment_history.qnt");
  expect(selected.module).toBe("payment_history");
  expect(selected.operator).toBe("SlopPaymentHistoryTerminalPageViewV2");
  expect(digest(source)).toBe(
    "ca6e47f6ff38fb8129738d1cadd071607d9bf742d69a21d5bbedc1c5c9a262d1",
  );
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
  expect(source.match(/^ {2}run \w+Test\b/gmu)).toHaveLength(25);
});

test("payment-history V2 keeps raw retirement and all six indexed invariant clauses", () => {
  expect(selected.fields).toEqual([
    {
      name: "state",
      expression:
        'LET retired == (LET sourceAcceptEnabled(id) == (s.pages[id].phase = "response" /\\ s.pages[id].after = s.cursor /\\ ((s.through = -1 /\\ s.pages[id].requested = -1) \\/ s.pages[id].requested = s.through) /\\ ~s.ready /\\ ~s.failed) frozenFrontier == ((\\A id \\in ids: s.pages[id].phase \\in {"response", "done"}) /\\ ~(\\E id \\in ids: sourceAcceptEnabled(id))) IN [id \\in DOMAIN s.pages |-> (s.configured /\\ (s.pages[id].phase = "done" \\/ (s.pages[id].phase = "response" /\\ (s.ready \\/ s.failed \\/ frozenFrontier))))]) IN [s EXCEPT !.monthly = {}, !.pages = [id \\in DOMAIN s.pages |-> IF retired[id] THEN [s.pages[id] EXCEPT !.months = {}, !.fetched = {}, !.after = 0, !.requested = -1, !.through = -1, !.total = -1, !.selected = {}, !.next = 0, !.result = "none"] ELSE [s.pages[id] EXCEPT !.months = {}, !.fetched = {}]]]',
    },
    {
      name: "retired",
      expression:
        'LET sourceAcceptEnabled(id) == (s.pages[id].phase = "response" /\\ s.pages[id].after = s.cursor /\\ ((s.through = -1 /\\ s.pages[id].requested = -1) \\/ s.pages[id].requested = s.through) /\\ ~s.ready /\\ ~s.failed) frozenFrontier == ((\\A id \\in ids: s.pages[id].phase \\in {"response", "done"}) /\\ ~(\\E id \\in ids: sourceAcceptEnabled(id))) IN [id \\in DOMAIN s.pages |-> (s.configured /\\ (s.pages[id].phase = "done" \\/ (s.pages[id].phase = "response" /\\ (s.ready \\/ s.failed \\/ frozenFrontier))))]',
    },
  ]);
  expect(selected.clauses).toEqual([
    {
      name: "selectedSize",
      expression:
        "[id \\in DOMAIN s.pages |-> (Cardinality(s.pages[id].selected) <= 2)]",
    },
    {
      name: "selectedSubsetFetched",
      expression:
        "[id \\in DOMAIN s.pages |-> (s.pages[id].selected \\subseteq s.pages[id].fetched)]",
    },
    {
      name: "fetchedCount",
      expression:
        "[id \\in DOMAIN s.pages |-> (Cardinality(s.pages[id].fetched) <= 3)]",
    },
    {
      name: "monthsSubset",
      expression:
        "[id \\in DOMAIN s.pages |-> (s.pages[id].months \\subseteq s.pages[id].selected)]",
    },
    {
      name: "selectedRange",
      expression:
        "[id \\in DOMAIN s.pages |-> (\\A row \\in s.pages[id].selected: row > s.pages[id].after /\\ row <= s.pages[id].through)]",
    },
    {
      name: "validResult",
      expression:
        '[id \\in DOMAIN s.pages |-> ((s.pages[id].result = "200" /\\ s.rail = "vault") => (s.pages[id].selected \\cap s.invalid = {}))]',
    },
  ]);
  expect(selected.translatedSha256).toBe(
    "fabbf107b0ae16501d1d1042c09e057b0ac6a7c6bc928f948be395a709f70622",
  );
  expect(selected.viewTlaSha256).toBe(
    "728a86901f8ddb47d20406619c9bae6544d58418cb18801517a0ac1bcffb0270",
  );
  // Bind the original ten exactly while permitting reviewed appended bindings.
  const originalBindingIds = [
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
  ];
  const originalBindings = manifest.views.filter((entry) =>
    originalBindingIds.includes(entry.id),
  );
  expect(originalBindings).toHaveLength(10);
  expect(digest(JSON.stringify(originalBindings))).toBe(
    "2bbb062c75f1e16628e28135481af3c7de60b977b53ca2194a5f8b5353a6d6e0",
  );
  const retirement = selected.fields[1].expression;
  expect(retirement).toContain("\\E id \\in ids: sourceAcceptEnabled(id)");
  expect(retirement).not.toContain('result = "200"');
  expect(retirement).toContain("s.configured /\\");
});

for (const [name, before, after] of [
  [
    "a future raw fetched-size guard",
    'all { page.phase == "response", page.after == s.cursor,',
    'all { page.phase == "response", page.fetched.size() <= 3, page.after == s.cursor,',
  ],
  [
    "a future returned-month consumer",
    'all { page.phase == "validate", s\' =',
    'all { page.phase == "validate", page.months == Set(), s\' =',
  ],
  [
    "a future global-month eligibility read",
    "s.present.contains(row) and scoped(row) and",
    "s.present.contains(row) and scoped(row) and not(s.monthly.contains(row)) and",
  ],
  [
    "a future old-fetched input to readPage",
    "val fetched = first(s.present.filter",
    "val fetched = first(page.fetched.union(s.present).filter",
  ],
  [
    "a changed ordinary-row domain",
    "val ordinaryIds = Set(1, 2, 3, 4, 5)",
    "val ordinaryIds = Set(1, 2, 3, 4, 5, 6)",
  ],
  [
    "a future cross-state monthly invariant",
    "page.fetched.size() <= 3, page.months.subseteq(page.selected),",
    "page.fetched.size() <= 3, page.months.subseteq(page.selected), page.months.subseteq(s.monthly),",
  ],
  [
    "a done-page restart",
    's.configured, ids.contains(id), s.pages.get(id).phase == "unused",',
    's.configured, ids.contains(id), Set("unused", "done").contains(s.pages.get(id).phase),',
  ],
] as const) {
  test(`payment-history source drift through ${name} requires renewed review`, () => {
    expect(() =>
      bindSafetyView(
        manifest,
        selected.id,
        selected.model,
        replaceOnce(source, before, after),
      ),
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

test("payment-history temporal, translation, property and expression drift fail closed", () => {
  const temporal = `${source}\ntemporal unsafeProperty = true\n`;
  expect(() =>
    bindSafetyView(
      { ...manifest, views: [{ ...selected, sourceSha256: digest(temporal) }] },
      selected.id,
      selected.model,
      temporal,
    ),
  ).toThrow("does not authorize temporal properties");
  const tlaCode = "---- MODULE payment_history ----\nVARIABLE s\n====\n";
  const binding = fixtureBinding(tlaCode);
  const config = {
    moduleName: selected.module,
    hasInvariant: true,
    hasTemporal: false,
    tlaCode,
  };
  const prepared = applySafetyView(binding, config);
  expect(digest(prepared.tlaCode)).toBe(binding.viewTlaSha256);
  expect(() =>
    applySafetyView(binding, { ...config, tlaCode: `${tlaCode}\n` }),
  ).toThrow("generated TLA changed");
  expect(() =>
    applySafetyView(binding, { ...config, hasInvariant: false }),
  ).toThrow("property differs");
  expect(() =>
    applySafetyView(binding, { ...config, hasTemporal: true }),
  ).toThrow("property differs");
  expect(() =>
    applySafetyView({ ...binding, viewTlaSha256: "0".repeat(64) }, config),
  ).toThrow("projection changed");
  for (const changed of [
    { ...binding, fields: [{ name: "state", expression: "s" }] },
    { ...binding, clauses: [] },
    { ...binding, clauses: [...binding.clauses].reverse() },
    {
      ...binding,
      clauses: binding.clauses.map((clause, index) =>
        index === 0 ? { ...clause, expression: "TRUE" } : clause,
      ),
    },
    { ...binding, operator: "UnreviewedPaymentHistoryView" },
  ])
    expect(() => applySafetyView(changed, config)).toThrow("property differs");
});

let translated: string | undefined;
function actualTranslatedModel() {
  if (translated !== undefined) return translated;
  const directory = mkdtempSync(join(tmpdir(), "slop-payment-history-view-"));
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

const page =
  '[phase |-> "done", after |-> 0, requested |-> -1, through |-> 2, total |-> 1, fetched |-> {1}, selected |-> {1}, months |-> {}, next |-> 0, result |-> "none"]';
const initial =
  '[configured |-> TRUE, rail |-> "vault", scope |-> "all", testnets |-> FALSE, present |-> {1,2}, hidden |-> {2}, invalid |-> {}, unmatched |-> {}, monthly |-> {}, pages |-> [id \\in ids |-> ' +
  page +
  "], through |-> -1, total |-> -1, cursor |-> 0, collected |-> {}, ready |-> FALSE, failed |-> FALSE, privateTablePresent |-> FALSE]";
const state = (changes: string) => `[${initial} EXCEPT ${changes}]`;
const flags = (id: number) => [
  `(s.pages[${id}].months \\subseteq s.pages[${id}].selected)`,
  `(s.pages[${id}].selected \\subseteq s.pages[${id}].fetched)`,
  `(Cardinality(s.pages[${id}].fetched) <= 3)`,
];
const healthyFlags = (id: number) => flags(id).join(" /\\ ");
const falseFlags = (id: number) =>
  flags(id)
    .map((flag) => `~${flag}`)
    .join(" /\\ ");
const badFields = (id: number) =>
  `!.pages[${id}].months = {2}, !.pages[${id}].fetched = {2,3,4,5}`;
const invariantFlags = (id: number) => [
  `(Cardinality(s.pages[${id}].selected) <= 2)`,
  `(s.pages[${id}].selected \\subseteq s.pages[${id}].fetched)`,
  `(Cardinality(s.pages[${id}].fetched) <= 3)`,
  `(s.pages[${id}].months \\subseteq s.pages[${id}].selected)`,
  `(\\A row \\in s.pages[${id}].selected: row > s.pages[${id}].after /\\ row <= s.pages[${id}].through)`,
  `((s.pages[${id}].result = "200" /\\ s.rail = "vault") => (s.pages[${id}].selected \\cap s.invalid = {}))`,
];
const allInvariantFlags = (id: number) => invariantFlags(id).join(" /\\ ");
const firstFiveFlags = (id: number) =>
  invariantFlags(id).slice(0, 5).join(" /\\ ");
const allSixFalseFields = (id: number, after = 1) =>
  `!.pages[${id}].selected = {1,2,3}, !.pages[${id}].fetched = {2,3,4,5}, ` +
  `!.pages[${id}].months = {4}, !.pages[${id}].after = ${after}, !.pages[${id}].through = 2, ` +
  `!.pages[${id}].result = "200", !.invalid = {1}`;

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
    `SlopControlInitial == ${control.initial}\n\nq_init == s = SlopControlInitial`,
  );
  // Negative controls must find the exact named witness. The deliberately bad
  // raw fixtures cannot pass merely because the production invariant is false.
  tla = replaceOnce(
    tla,
    "q_inv == invariant",
    `SlopControlWitness == ${control.witness}\n\nq_inv == ~SlopControlWitness`,
  );
  // The real translation defines readPage after q_init/q_inv. Keep the step
  // alias beside q_step so every referenced production action is already bound.
  return replaceOnce(
    tla,
    "q_step == step",
    `SlopControlStep == ${control.step}\n\nq_step == SlopControlStep`,
  );
}
function nativeFixture(control: NativeCase) {
  return injectNativeControl(actualTranslatedModel(), control);
}

test("native control aliases follow the translated action definition order", () => {
  const tla = [
    "---- MODULE payment_history ----",
    "EXTENDS Integers",
    "VARIABLE s",
    "init == s = 0",
    "q_init == init",
    "invariant == TRUE",
    "q_inv == invariant",
    "readPage(id) == s' = s",
    "step == readPage(1)",
    "q_step == step",
    "====",
    "",
  ].join("\n");
  const fixture = injectNativeControl(tla, {
    name: "definition order",
    initial: "0",
    step: "readPage(1)",
    witness: "s = 1",
  });
  expect(fixture.indexOf("SlopControlInitial == 0")).toBeLessThan(
    fixture.indexOf("q_init == s = SlopControlInitial"),
  );
  expect(fixture.indexOf("SlopControlWitness == s = 1")).toBeLessThan(
    fixture.indexOf("q_inv == ~SlopControlWitness"),
  );
  expect(fixture.indexOf("SlopControlStep == readPage(1)")).toBeGreaterThan(
    fixture.indexOf("readPage(id) =="),
  );
  expect(fixture.indexOf("SlopControlStep == readPage(1)")).toBeLessThan(
    fixture.indexOf("q_step == SlopControlStep"),
  );
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
    'if(result.isLeft()){if(result.value.isViolation){console.log("PAYMENT_HISTORY_NAMED_WITNESS_FOUND");process.exitCode=1;}',
    'else{console.log("PAYMENT_HISTORY_NATIVE_ERROR");process.exitCode=2;}}else console.log("PAYMENT_HISTORY_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "payment-history-view-native-control",
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

const cases: NativeCase[] = [];
for (const id of [1, 2]) {
  for (const [index, name, change] of [
    [0, "month-subset", `!.pages[${id}].months = {2}`],
    [1, "selected-subset-fetched", `!.pages[${id}].fetched = {}`],
    [2, "fetched-count", `!.pages[${id}].fetched = {1,2,3,4}`],
  ] as const)
    cases.push({
      name: `page ${id}'s independent ${name} false class`,
      initial,
      step: `s' = [s EXCEPT ${change}]`,
      witness: flags(id)
        .map((flag, current) => (index === current ? `~${flag}` : flag))
        .join(" /\\ "),
    });

  for (const [name, change] of [
    ["month-subset", `!.pages[${id}].months = {2}`],
    ["selected-subset-fetched", `!.pages[${id}].fetched = {}`],
    ["fetched-count", `!.pages[${id}].fetched = {1,2,3,4}`],
    ["all three false flags", badFields(id)],
  ] as const)
    cases.push({
      name: `readPage healing page ${id}'s ${name}`,
      initial: state(`!.pages[${id}].phase = "page", ${change}`),
      step: `readPage(${id})`,
      witness: `s.pages[${id}].phase = "validate" /\\ ${healthyFlags(id)}`,
    });

  cases.push({
    name: `begin resetting page ${id}'s malformed unused fields`,
    initial: state(`!.pages[${id}].phase = "unused", ${badFields(id)}`),
    step: `begin(${id},0,-1,TRUE)`,
    witness:
      `s.pages[${id}].phase = "boundary" /\\ s.pages[${id}].selected = {} /\\ ` +
      `s.pages[${id}].fetched = {} /\\ s.pages[${id}].months = {} /\\ ${healthyFlags(id)}`,
  });
  cases.push({
    name: `validate preserving all page ${id} false flags`,
    initial: state(`!.pages[${id}].phase = "validate", ${badFields(id)}`),
    step: `validate(${id})`,
    witness: `s.pages[${id}].phase = "response" /\\ s.pages[${id}].result = "200" /\\ ${falseFlags(id)}`,
  });
  for (const phase of ["boundary", "count", "page", "validate"])
    cases.push({
      name: `queryFailure preserving page ${id} false flags from ${phase}`,
      initial: state(`!.pages[${id}].phase = "${phase}", ${badFields(id)}`),
      step: `queryFailure(${id})`,
      witness: `s.pages[${id}].phase = "response" /\\ s.pages[${id}].result = "503" /\\ ${falseFlags(id)}`,
    });
  cases.push({
    name: `accept preserving page ${id} false flags through publication`,
    initial: state(
      `!.pages[${id}].phase = "response", !.pages[${id}].result = "200", ${badFields(id)}`,
    ),
    step: `accept(${id})`,
    witness: `s.pages[${id}].phase = "done" /\\ s.ready /\\ ~s.failed /\\ ${falseFlags(id)}`,
  });
}

// These controls call unchanged production actions on deliberately malformed,
// well-typed states. They do not assume the invariant already holds.
for (const id of [1, 2]) {
  cases.push({
    name: `begin resetting all six page ${id} false clauses`,
    initial: state(`!.pages[${id}].phase = "unused", ${allSixFalseFields(id)}`),
    step: `begin(${id},0,-1,TRUE)`,
    witness: `s.pages[${id}].phase = "boundary" /\\ ${allInvariantFlags(id)}`,
  });
  cases.push({
    name: `readPage healing first five page ${id} clauses but retaining poisoned result`,
    initial: state(
      `!.pages[${id}].phase = "page", ${allSixFalseFields(id, 0)}`,
    ),
    step: `readPage(${id})`,
    witness:
      `s.pages[${id}].phase = "validate" /\\ ${firstFiveFlags(id)} /\\ ` +
      `~${invariantFlags(id)[5]}`,
  });
  for (const action of ["validate", "queryFailure"])
    cases.push({
      name: `${action} healing only page ${id}'s invalid-result clause`,
      initial: state(
        `!.pages[${id}].phase = "validate", ${allSixFalseFields(id)}`,
      ),
      step: `${action}(${id})`,
      witness:
        `s.pages[${id}].phase = "response" /\\ ` +
        invariantFlags(id)
          .map((flag, index) => (index === 5 ? flag : `~${flag}`))
          .join(" /\\ "),
    });
  cases.push({
    name: `boundary healing page ${id}'s selected-range clause`,
    initial: state(
      `!.pages[${id}].phase = "boundary", !.pages[${id}].through = 0`,
    ),
    step: `boundary(${id})`,
    witness: `s.pages[${id}].phase = "count" /\\ ${allInvariantFlags(id)}`,
  });
  cases.push({
    name: `boundary falsifying page ${id}'s selected-range clause`,
    initial: state(
      `!.pages[${id}].phase = "boundary", !.pages[${id}].requested = 0`,
    ),
    step: `boundary(${id})`,
    witness:
      `s.pages[${id}].phase = "count" /\\ ` +
      invariantFlags(id)
        .map((flag, index) => (index === 4 ? `~${flag}` : flag))
        .join(" /\\ "),
  });
  cases.push({
    name: `boundary refusal healing page ${id}'s result without healing range`,
    initial: state(
      `!.pages[${id}].phase = "boundary", !.pages[${id}].requested = 6, ` +
        `!.pages[${id}].through = 0, !.pages[${id}].result = "200", !.invalid = {1}`,
    ),
    step: `boundary(${id})`,
    witness:
      `s.pages[${id}].phase = "response" /\\ s.pages[${id}].result = "400" /\\ ` +
      invariantFlags(id)
        .map((flag, index) => (index === 4 ? `~${flag}` : flag))
        .join(" /\\ "),
  });
}

// Initially the response is frozen. Unlocking only after/requested makes the
// real accept guard enabled even though the response is bad. For result=none,
// the RAW retirement marker is the only VIEW difference on unlock. The separate
// 400 control checks bad-response enabledness; its unretired result also differs.
// Losing the required distinction suppresses the named State 3 failure.
for (const result of ["none", "400"])
  cases.push({
    name:
      result === "none"
        ? "raw retirement marker preserves actual bad-none acceptance"
        : "actual bad-400 response remains accept-enabled",
    initial: state(
      `!.pages[1] = [unused EXCEPT !.phase = "response", !.after = 6, !.requested = 6, !.result = "${result}"]`,
    ),
    step:
      '((s.pages[1].phase = "response" /\\ s.pages[1].after = 6) /\\ ' +
      "s' = [s EXCEPT !.pages[1].after = 0, !.pages[1].requested = -1]) \\/ accept(1)",
    witness: 's.failed /\\ s.pages[1].phase = "done"',
    witnessState: 3,
  });

cases.push({
  name: "unconfigured done-result poison remains visible through actual configure",
  initial: state('!.configured = FALSE, !.pages[1].result = "none"'),
  step:
    '((~s.configured /\\ s.pages[1].result = "none") /\\ ' +
    's\' = [s EXCEPT !.pages[1].result = "200"]) \\/ ' +
    '(s.pages[1].result = "200" /\\ configure("vault",2,FALSE,1,0))',
  witness: `s.configured /\\ s.invalid = {1} /\\ ~${invariantFlags(1)[5]}`,
  witnessState: 3,
});

for (const control of cases)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native payment-history VIEW retains ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain("PAYMENT_HISTORY_NAMED_WITNESS_FOUND");
      expect(result.output).toContain(`State ${control.witnessState ?? 2}:`);
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );

const flagRepresentatives = [false, true].flatMap((monthSubset) =>
  [false, true].flatMap((selectedSubset) =>
    [false, true].map((count) => ({
      months: monthSubset ? "{}" : "{2}",
      fetched: count
        ? selectedSubset
          ? "{1}"
          : "{}"
        : selectedSubset
          ? "{1,2,3,4}"
          : "{2,3,4,5}",
    })),
  ),
);
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native payment-history VIEW distinguishes all 64 indexed two-page flag combinations",
  async () => {
    // These are native TLA fixture states, not a JavaScript action controller.
    // All retained data is identical; only the six raw clause observations
    // differ. Dropping any flag/index reduces the completed graph below 64.
    const steps = flagRepresentatives.flatMap((one) =>
      flagRepresentatives.map(
        (two) =>
          `(s' = [s EXCEPT !.pages[1].months = ${one.months}, !.pages[1].fetched = ${one.fetched}, !.pages[2].months = ${two.months}, !.pages[2].fetched = ${two.fetched}])`,
      ),
    );
    const result = await runNative(
      nativeFixture({
        name: "every raw indexed flag combination",
        initial,
        step: steps.join(" \\/\n"),
        witness: "FALSE",
      }),
    );
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("PAYMENT_HISTORY_NATIVE_COMPLETE");
    expect(result.output).toMatch(/64 distinct states? found/u);
    expect(result.output).toMatch(/0 states? left on queue/u);
  },
  120_000,
);

const terminalPage =
  '[phase |-> "done", after |-> 0, requested |-> -1, through |-> 5, total |-> 1, fetched |-> {1}, selected |-> {1}, months |-> {}, next |-> 0, result |-> "none"]';
const isolatedRepresentatives = [
  terminalPage,
  `[${terminalPage} EXCEPT !.selected = {1,2,3}, !.fetched = {1,2,3}]`,
  `[${terminalPage} EXCEPT !.fetched = {}]`,
  `[${terminalPage} EXCEPT !.fetched = {1,2,3,4}]`,
  `[${terminalPage} EXCEPT !.months = {2}]`,
  `[${terminalPage} EXCEPT !.after = 1]`,
  `[${terminalPage} EXCEPT !.result = "200"]`,
];
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native payment-history V2 retains all 49 paired healthy and isolated six-clause false classes",
  async () => {
    // Each page is either healthy or violates exactly one of the six clauses.
    // All differing payload is retired; globals, phases and retirement markers
    // stay constant. Every raw clause is observed BEFORE the payload is masked.
    const fixture = nativeFixture({
      name: "49 independent indexed false classes",
      initial: state(
        `!.invalid = {1}, !.pages = [id \\in ids |-> ${terminalPage}]`,
      ),
      step: isolatedRepresentatives
        .flatMap((one) =>
          isolatedRepresentatives.map(
            (two) =>
              `(s' = [s EXCEPT !.pages[1] = ${one}, !.pages[2] = ${two}])`,
          ),
        )
        .join(" \\/\n"),
      witness: "FALSE",
    });
    for (const useView of [false, true]) {
      const result = await runNative(fixture, useView);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain("PAYMENT_HISTORY_NATIVE_COMPLETE");
      expect(result.output).toMatch(/49 distinct states? found/u);
      expect(result.output).toMatch(/0 states? left on queue/u);
    }
  },
  120_000,
);

for (const [name, change] of [
  ["after", "!.pages[1].after = 5"],
  ["requested", "!.pages[1].requested = 5"],
  ["through", "!.pages[1].through = 5"],
  ["total", "!.pages[1].total = 5"],
  ["selected", "!.pages[1].selected = {2}"],
  ["next", "!.pages[1].next = 5"],
  ["result", '!.pages[1].result = "400"'],
] as const)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native payment-history V2 retains blocked response ${name} while another page is unused`,
    async () => {
      const result = await runNative(
        nativeFixture({
          name: `blocked response with live unused peer: ${name}`,
          initial: state(
            '!.pages[1].phase = "response", !.pages[1].after = 6, !.pages[1].requested = 6, !.pages[1].fetched = {1,2}, !.pages[2] = unused',
          ),
          step: `s' = [s EXCEPT ${change}]`,
          witness: "FALSE",
        }),
      );
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain("PAYMENT_HISTORY_NATIVE_COMPLETE");
      expect(result.output).toMatch(/2 distinct states? found/u);
      expect(result.output).toMatch(/0 states? left on queue/u);
    },
    120_000,
  );

test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native payment-history VIEW coalesces only month and fetched detail with identical indexed flags",
  async () => {
    const fixture = nativeFixture({
      name: "same-observation raw payloads",
      initial,
      step: "s' = [s EXCEPT !.monthly = {1,2,3,4,5}, !.pages[1].months = {1}, !.pages[1].fetched = {1,2,3}, !.pages[2].months = {1}, !.pages[2].fetched = {1,3}]",
      witness: "FALSE",
    });
    // Compare the same exact fixture serially. The complete raw graph has two
    // states; only the reviewed observation quotient may coalesce them to one.
    for (const useView of [false, true]) {
      const result = await runNative(fixture, useView);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain("PAYMENT_HISTORY_NATIVE_COMPLETE");
      expect(result.output).toMatch(
        useView ? /1 distinct states? found/u : /2 distinct states? found/u,
      );
      expect(result.output).toMatch(/0 states? left on queue/u);
    }
  },
  120_000,
);

for (const [name, change] of [
  ["selected", "!.pages[1].selected = {2}"],
  ["next", "!.pages[1].next = 1"],
  ["after", "!.pages[1].after = 1"],
  ["requested", "!.pages[1].requested = 2"],
  ["through", "!.pages[1].through = 3"],
  ["total", "!.pages[1].total = 2"],
  ["result", '!.pages[1].result = "200"'],
  ["phase", '!.pages[1].phase = "response"'],
] as const)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native payment-history VIEW retains exact page ${name}`,
    async () => {
      const result = await runNative(
        nativeFixture({
          name: `exact retained ${name}`,
          initial: state(
            '!.pages[1].phase = "page", !.pages[1].fetched = {1,2}',
          ),
          step: `s' = [s EXCEPT ${change}]`,
          witness: "FALSE",
        }),
      );
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain("PAYMENT_HISTORY_NATIVE_COMPLETE");
      expect(result.output).toMatch(/2 distinct states? found/u);
      expect(result.output).toMatch(/0 states? left on queue/u);
    },
    120_000,
  );

test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native concrete payment-history month output remains outside the VIEW claim",
  async () => {
    const result = await runNative(
      nativeFixture({
        name: "concrete month output",
        initial: state('!.pages[1].phase = "page", !.monthly = {1}'),
        step: "readPage(1)",
        witness: 's.pages[1].phase = "validate" /\\ s.pages[1].months = {1}',
      }),
      false,
    );
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("Invariant q_inv is violated");
    expect(result.output).toContain("PAYMENT_HISTORY_NAMED_WITNESS_FOUND");
    expect(result.output).toContain("State 2:");
    expect(result.output).not.toContain("violated by the initial state");
    expect(result.output).not.toContain("No error has been found");
  },
  120_000,
);
