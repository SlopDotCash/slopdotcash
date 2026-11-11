/** Exact-source controls for the UI security-settings safety VIEW. */
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
  (entry) => entry.id === "ui-security-settings-lifetime-safety-v1",
);
if (!view) throw new Error("Missing reviewed security-settings safety VIEW");
const selected: SafetyViewDefinition = view;
const source = readFileSync(join(root, selected.model), "utf8");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function checkReviewedBoundary(model: string) {
  const start = model.indexOf("module ui_security_settings_lifetime {");
  const end = model.indexOf("  run initialReadAndPermissionTest", start);
  if (
    start < 0 ||
    end < start ||
    digest(model.slice(start, end)) !==
      "ba24b03d4cc274fccad739ef5d48a54e24dc8f28ea3ff9a64e30fb0c49912e96"
  )
    throw new Error(
      "Security-settings field reads, slot reuse and invariant observations need review",
    );
}

function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2)
    throw new Error("Expected one audited source boundary: " + from);
  return text.replace(from, to);
}

test("security VIEW binds every audited transition, initializer, domain and invariant", () => {
  checkReviewedBoundary(source);
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
  expect(digest(source)).toBe(
    "5dfb3b1c648c9792524106c6ff425bf869c7649356ce54b25b4449ee7c60cd10",
  );
});

for (const [field, expression] of [
  ["error", 's.error == "none"'],
  ["success", "s.success == 0"],
  ["serverBody", "s.serverBody == 0"],
  ["publication body", "s.publications.get(1).body == 0"],
] as const) {
  test("a future " + field + " read refuses before VIEW selection", () => {
    const changed = replaceOnce(
      source,
      'actors.contains(actor), s\' = s.with("cookie", actor)',
      "actors.contains(actor), " +
        expression +
        ', s\' = s.with("cookie", actor)',
    );
    expect(() => checkReviewedBoundary(changed)).toThrow("need review");
    expect(() =>
      bindSafetyView(manifest, selected.id, selected.model, changed),
    ).toThrow("model changed");
  });
}

for (const [name, before, after] of [
  [
    "a dead read payload",
    'Set("unused", "done").contains(s.reads.get(id).phase),',
    'Set("unused", "done").contains(s.reads.get(id).phase), s.reads.get(id).cookie == 0,',
  ],
  [
    "a terminal publication continuation",
    's.publications.get(id).phase == "unused",',
    'Set("unused", "done").contains(s.publications.get(id).phase),',
  ],
  [
    "a cross-slot payload read",
    'actors.contains(actor), s\' = s.with("cookie", actor)',
    'actors.contains(actor), ids.forall(i => s.reads.get(i).revision == 0), s\' = s.with("cookie", actor)',
  ],
  [
    "an invariant observation of an erased output",
    "val invariant = all { s.server >= 1,",
    "val invariant = all { s.serverBody == 0, s.server >= 1,",
  ],
] as const) {
  test("source drift through " + name + " requires renewed review", () => {
    const changed = replaceOnce(source, before, after);
    expect(() => checkReviewedBoundary(changed)).toThrow("need review");
    expect(() =>
      bindSafetyView(manifest, selected.id, selected.model, changed),
    ).toThrow("model changed");
  });
}

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

test("temporal, property and projection changes cannot reuse the security VIEW", () => {
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
    { ...binding, clauses: [] },
    { ...binding, operator: "UnreviewedSecurityView" },
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
  const directory = mkdtempSync(join(tmpdir(), "slop-security-view-native-"));
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

const read =
  '[kind |-> "permission", phase |-> "unused", actor |-> 0, cookie |-> 0, life |-> 0, ok |-> FALSE, revision |-> 0]';
const publication =
  '[phase |-> "unused", actor |-> 0, cookie |-> 0, life |-> 0, expected |-> 0, body |-> 0, accepted |-> FALSE, revision |-> 0]';
const initial =
  "[actor |-> 1, cookie |-> 1, life |-> 1, mounted |-> TRUE, gate |-> FALSE, editor |-> FALSE, read |-> 0, reads |-> [i \\in {1,2} |-> " +
  read +
  "], active |-> 0, publications |-> [i \\in {1,2} |-> " +
  publication +
  '], server |-> 1, serverBody |-> 0, base |-> 1, parent |-> 1, success |-> 0, error |-> "none", identityRefresh |-> FALSE]';
const state = (changes: string) => "[" + initial + " EXCEPT " + changes + "]";
type NativeCase = {
  name: string;
  initial: string;
  step: string;
  witness: string;
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
    "const view=" + JSON.stringify(binding) + ";",
    "const config={moduleName:view.module,tlaCode:" +
      JSON.stringify(tla) +
      ",hasInvariant:true,hasTemporal:false};",
    "const prepared=" +
      (useView ? "applySafetyView(view,config)" : "config") +
      ";",
    'const runner=loadSafetyViewTlc(require.resolve("@informalsystems/quint/dist/src/tlc.js"),manifest);',
    'const result=await runner.verify(prepared,"0.62.4",JSON.parse(readFileSync("formal/tlc.json","utf8")),3);',
    'if(result.isLeft()){if(result.value.isViolation){console.log("SECURITY_VIEW_NAMED_WITNESS_FOUND");process.exitCode=1;}',
    'else{console.log("SECURITY_VIEW_NATIVE_ERROR");process.exitCode=2;}}else console.log("SECURITY_VIEW_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "security-settings-view-native-control",
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
    name: "the server lower-bound false class",
    initial,
    step: "s' = [s EXCEPT !.server = 0]",
    witness: "s.server < 1",
  },
  {
    name: "the server upper-bound false class",
    initial,
    step: "s' = [s EXCEPT !.server = 4]",
    witness: "s.server > 3",
  },
  {
    name: "the parent-revision false class",
    initial,
    step: "s' = [s EXCEPT !.parent = 2]",
    witness: "s.parent > s.server",
  },
  {
    name: "the detached-editor false class",
    initial: state("!.mounted = FALSE"),
    step: "s' = [s EXCEPT !.editor = TRUE]",
    witness: "s.editor /\\ ~s.mounted",
  },
  {
    name: "the unpermitted-editor false class",
    initial,
    step: "s' = [s EXCEPT !.editor = TRUE]",
    witness: "s.editor /\\ ~s.gate",
  },
  {
    name: "a false terminal publication identity",
    initial: state('!.publications[1].phase = "done"'),
    step: "s' = [s EXCEPT !.publications[1].accepted = TRUE, !.publications[1].actor = 1, !.publications[1].cookie = 2]",
    witness:
      "s.publications[1].accepted /\\ s.publications[1].cookie # s.publications[1].actor",
  },
  {
    name: "one false identity healing while another stays false",
    initial: state(
      '!.publications[1].phase = "done", !.publications[1].accepted = TRUE, !.publications[1].actor = 1, !.publications[1].cookie = 2, !.publications[2].phase = "done", !.publications[2].accepted = TRUE, !.publications[2].actor = 1, !.publications[2].cookie = 2',
    ),
    step: "s' = [s EXCEPT !.publications[1].cookie = 1]",
    witness:
      "s.publications[1].cookie = s.publications[1].actor /\\ s.publications[2].accepted /\\ s.publications[2].cookie # s.publications[2].actor",
  },
  {
    name: "the concrete reusable-read reset",
    initial: state(
      '!.gate = TRUE, !.reads[1] = [kind |-> "revision", phase |-> "done", actor |-> 2, cookie |-> 2, life |-> 2, ok |-> TRUE, revision |-> 3]',
    ),
    step: 'beginRead(1, "permission")',
    witness:
      's.reads[1].phase = "pre" /\\ s.reads[1].actor = 1 /\\ s.reads[1].life = 1 /\\ s.reads[1].cookie = 0 /\\ ~s.reads[1].ok /\\ s.reads[1].revision = 0',
  },
  {
    name: "the concrete unused-publication reset with a false old observation",
    initial: state(
      "!.gate = TRUE, !.editor = TRUE, !.publications[1].accepted = TRUE, !.publications[1].actor = 1, !.publications[1].cookie = 2, !.publications[1].expected = 3",
    ),
    step: "beginPublish(1, 2)",
    witness:
      's.publications[1].phase = "pre" /\\ ~s.publications[1].accepted /\\ s.publications[1].expected = 1 /\\ s.publications[1].cookie = 0',
  },
  {
    name: "live publication expected revision before concrete admission",
    initial: state(
      '!.active = 1, !.publications[1] = [phase |-> "server", actor |-> 1, cookie |-> 1, life |-> 1, expected |-> 0, body |-> 1, accepted |-> FALSE, revision |-> 0]',
    ),
    step: "IF s.publications[1].expected = 0 THEN s' = [s EXCEPT !.publications[1].expected = 1] ELSE serverResult(1, TRUE)",
    witness: "s.server = 2 /\\ s.publications[1].accepted",
  },
  {
    name: "live publication cookie before concrete admission",
    initial: state(
      '!.active = 1, !.publications[1] = [phase |-> "server", actor |-> 1, cookie |-> 2, life |-> 1, expected |-> 1, body |-> 1, accepted |-> FALSE, revision |-> 0]',
    ),
    step: "IF s.publications[1].cookie = 2 THEN s' = [s EXCEPT !.publications[1].cookie = 1] ELSE serverResult(1, TRUE)",
    witness: "s.server = 2 /\\ s.publications[1].accepted",
  },
  {
    name: "live publication actor before concrete preflight",
    initial: state(
      '!.active = 1, !.publications[1] = [phase |-> "pre", actor |-> 2, cookie |-> 0, life |-> 1, expected |-> 1, body |-> 1, accepted |-> FALSE, revision |-> 0]',
    ),
    step: "IF s.publications[1].actor = 2 THEN s' = [s EXCEPT !.publications[1].actor = 1] ELSE publishPreflight(1, 1)",
    witness: 's.publications[1].phase = "dispatch"',
  },
  {
    name: "live publication lifetime before concrete preflight",
    initial: state(
      '!.active = 1, !.publications[1] = [phase |-> "pre", actor |-> 1, cookie |-> 0, life |-> 2, expected |-> 1, body |-> 1, accepted |-> FALSE, revision |-> 0]',
    ),
    step: "IF s.publications[1].life = 2 THEN s' = [s EXCEPT !.publications[1].life = 1] ELSE publishPreflight(1, 1)",
    witness: 's.publications[1].phase = "dispatch"',
  },
  {
    name: "live read revision before concrete parent publication",
    initial: state(
      '!.read = 1, !.gate = TRUE, !.server = 2, !.reads[1] = [kind |-> "revision", phase |-> "post", actor |-> 1, cookie |-> 0, life |-> 1, ok |-> TRUE, revision |-> 1]',
    ),
    step: 'IF s.reads[1].phase = "post" /\\ s.reads[1].revision = 1 THEN s\' = [s EXCEPT !.reads[1].revision = 2] ELSE readPostflight(1, 1)',
    witness: "s.parent = 2 /\\ s.base = 2 /\\ s.editor",
  },
  {
    name: "live base revision before concrete publication capture",
    initial: state("!.base = 2, !.gate = TRUE, !.editor = TRUE"),
    step: "IF s.base = 2 THEN s' = [s EXCEPT !.base = 1] ELSE beginPublish(1, 1)",
    witness:
      's.publications[1].phase = "pre" /\\ s.publications[1].expected = 1',
  },
];

for (const control of cases) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    "native security VIEW retains " + control.name,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain("SECURITY_VIEW_NAMED_WITNESS_FOUND");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );
}

test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native VIEW coalesces only audited dead payloads and write-only outputs",
  async () => {
    const tla = nativeFixture({
      name: "audited dead fields",
      initial: state(
        '!.reads[1].phase = "done", !.publications[1].phase = "done"',
      ),
      step: 's\' = [s EXCEPT !.error = "request", !.success = 3, !.serverBody = 2, !.reads[1].actor = 2, !.reads[1].cookie = 2, !.reads[1].life = 2, !.reads[1].ok = TRUE, !.reads[1].revision = 3, !.publications[1].body = 2, !.publications[2].body = 1]',
      witness: "FALSE",
    });
    const result = await runNative(tla);
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("SECURITY_VIEW_NATIVE_COMPLETE");
    expect(result.output).toMatch(/1 distinct states? found/u);
    expect(result.output).toMatch(/0 states? left on queue/u);
  },
  120_000,
);

test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native concrete done-publication slots remain absorbing",
  async () => {
    const result = await runNative(
      nativeFixture({
        name: "done publication absorption",
        initial: state(
          '!.gate = TRUE, !.editor = TRUE, !.publications[1].phase = "done"',
        ),
        step: "beginPublish(1, 1) \\/ s' = s",
        witness: 's.publications[1].phase # "done"',
      }),
    );
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("SECURITY_VIEW_NATIVE_COMPLETE");
    expect(result.output).toMatch(/1 distinct states? found/u);
  },
  120_000,
);

test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native no-VIEW witness shows why a future read requires a fresh proof",
  async () => {
    // Deliberately unreviewed test-only transition. The source guards refuse
    // that read; the unprojected runner must independently find its witness.
    const result = await runNative(
      nativeFixture({
        name: "future-read drift",
        initial,
        step: 'IF s.error = "none" THEN s\' = [s EXCEPT !.error = "request"] ELSE cookieChanges(2)',
        witness: "s.cookie = 2",
      }),
      false,
    );
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("SECURITY_VIEW_NAMED_WITNESS_FOUND");
  },
  120_000,
);
