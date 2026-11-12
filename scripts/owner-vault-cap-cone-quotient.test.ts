/** Source guards and non-exploring control definitions for the cap-only cone. */
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

const root = resolve(import.meta.dirname, ".."),
  manifest = readSafetyViews(root),
  view = manifest.views.find((v) => v.id === "owner-vault-cap-cone-safety-v8");
if (!view) throw Error("Missing reviewed owner-vault cap VIEW");
const selected: SafetyViewDefinition = view,
  source = readFileSync(join(root, selected.model), "utf8"),
  digest = (s: string) => createHash("sha256").update(s).digest("hex");
function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2)
    throw Error(`Expected one source boundary: ${from}`);
  return text.replace(from, to);
}
function reviewed(model: string) {
  if (
    digest(model) !==
    "68da3beb9833d621fd150cba1642b0b82739bba614ca4a5132e953b629cea378"
  )
    throw Error("Owner-vault cap copy cone needs renewed review");
}
test("cap VIEW binds the complete unchanged model and all concrete scenarios", () => {
  reviewed(source);
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
});
for (const [name, before, after] of [
  [
    "a request cap guard",
    'else if (not(valid)) respond(r, 422, "manifest")',
    'else if (not(valid) or r.cap <= 0) respond(r, 422, "manifest")',
  ],
  [
    "a creation-cap guard",
    "val matches = r.current == s.head and r.appendGeneration == s.generation",
    "val matches = r.current == s.head and r.appendGeneration == s.generation and r.creationCap > 0",
  ],
  [
    "a cap lookup key",
    "val old = policyAt(r.expected)",
    "val old = policyAt(r.cap)",
  ],
  [
    "an invariant cap consumer",
    "revisions.contains(s.head), policyAt(s.head).exists,",
    "revisions.contains(s.head), policyAt(s.head).exists, policyAt(s.head).cap > 0,",
  ],
  [
    "cap leaking into a retained policy kind",
    "kind: r.policy, cap: r.cap",
    "kind: r.cap, cap: r.cap",
  ],
  [
    "full-policy equality including cap",
    'kind != "policy" or purposes.forall',
    'policyAt(s.head) != absentPolicy, kind != "policy" or purposes.forall',
  ],
  [
    "cap leaking into a response class",
    '.with("status", status).with("result", result)',
    '.with("status", status).with("result", if (r.cap == 0) "none" else result)',
  ],
] as const)
  test(`future ${name} requires whole-source review`, () => {
    const changed = replaceOnce(source, before, after);
    expect(() => reviewed(changed)).toThrow("renewed review");
    expect(() =>
      bindSafetyView(manifest, selected.id, selected.model, changed),
    ).toThrow("model changed");
  });
test("V8 changes only the history cap map and old live cap expression", () => {
  const expression = selected.fields[0].expression;
  const history =
    "[s EXCEPT !.history = [rev \\in DOMAIN s.history |-> [s.history[rev] EXCEPT !.cap = 0]], !.requests = ";
  const priorCap =
    '!.cap = IF r.mode \\in {"get", "review"} \\/ r.phase = "postcommit" THEN 0 ELSE r.cap';
  const restored = replaceOnce(
    replaceOnce(expression, history, "[s EXCEPT !.requests = "),
    "!.cap = 0, !.captured =",
    priorCap + ", !.captured =",
  );
  expect(digest(restored)).toBe(
    "5131d4e1e96d4a41c7f80d64938bf4c488b1d30fd85621d59919b584f04fb02c",
  );
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

test("temporal, property and projection changes cannot reuse the owner-cap-v8 VIEW", () => {
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
    { ...binding, operator: "UnreviewedOwnerVaultCapView" },
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
  const directory = mkdtempSync(join(tmpdir(), "slop-owner-cap-v8-native-"));
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
        ',"--backend=tlc","--invariant=invariant","--step=verificationStep","--verbosity=0"];',
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
    "q_step == verificationStep",
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
    'if(result.isLeft()){if(result.value.isViolation){console.log("OWNER_CAP_VIEW_NAMED_WITNESS_FOUND");process.exitCode=1;}',
    'else{console.log("OWNER_CAP_VIEW_NATIVE_ERROR");process.exitCode=2;}}else console.log("OWNER_CAP_VIEW_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "owner-cap-view-native-control",
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
  '[present |-> TRUE, head |-> 1, history |-> [revisionId \\in {1,2,3} |-> IF revisionId = 1 THEN [exists |-> TRUE, kind |-> 1, cap |-> 1] ELSE absentPolicy], deployments |-> [purposeId \\in {1,2} |-> absentDeployment], generation |-> 0, restricted |-> FALSE, banned |-> FALSE, authority |-> "owner", requests |-> [requestId \\in {1,2} |-> idle]]';
const state = (changes: string) => `[${initial} EXCEPT ${changes}]`;
const projectReady =
  '!.requests[1] = [idle EXCEPT !.phase = "project", !.mode = "register", !.purpose = 1, !.family = "evm", !.transaction = 1, !.expected = 1]';
const ordinaryPipeline = (deferred = false) =>
  'CASE s.requests[1].phase = "project" -> project(1) [] s.requests[1].phase = "enforcements" -> enforcements(1) [] s.requests[1].phase = "authority" -> authority(1) [] s.requests[1].phase = "service" -> service(1,TRUE) [] s.requests[1].phase = "body" -> ' +
  (deferred ? 'verificationBody(1,TRUE,"evm","exact")' : "body(1,TRUE)") +
  ' [] s.requests[1].phase = "expected" -> ' +
  (deferred ? "verificationExpected(1,1)" : "expected(1)") +
  ' [] s.requests[1].phase = "history" -> history(1) [] s.requests[1].phase = "chain" -> chain(1,"valid") [] s.requests[1].phase = "append-generation" -> appendGeneration(1) [] s.requests[1].phase = "append-validation" -> appendValidation(1,TRUE) [] s.requests[1].phase = "commit" -> commit(1,"ok") [] OTHER -> s\' = s';
const commitWitness = (revision: number) =>
  `s.head = ${revision} /\\ s.requests[1].committed = ${revision} /\\ s.requests[1].phase = "postcommit" /\\ policyAt(${revision}).exists /\\ policyAt(${revision}).kind = 1 /\\ deploymentAt(1).exists`;
const cases: NativeCase[] = [
  {
    name: "head-domain false class remains visible",
    initial,
    step: "s' = [s EXCEPT !.head = 4]",
    witness: "s.head \\notin {1,2,3}",
  },
  {
    name: "head-policy existence false class remains visible",
    initial,
    step: "s' = [s EXCEPT !.history[1].exists = FALSE]",
    witness: "~policyAt(s.head).exists",
  },
  {
    name: "head-policy existence healing stays visible with dirty cap",
    initial: state("!.history[1].exists = FALSE, !.history[1].cap = -5"),
    step: "s' = [s EXCEPT !.history[1].exists = TRUE]",
    witness: "policyAt(s.head).exists",
  },
  {
    name: "historical kind remains live while its cap is erased",
    initial: state(
      '!.head = 2, !.history[2] = [exists |-> TRUE, kind |-> 1, cap |-> 9], !.history[1].kind = 2, !.requests[1] = [idle EXCEPT !.phase = "history", !.mode = "register", !.purpose = 1, !.expected = 1, !.current = 2, !.policy = 1, !.cap = 9]',
    ),
    step: "IF s.history[1].kind = 2 THEN s' = [s EXCEPT !.history[1].kind = 1] ELSE history(1)",
    witness: 's.requests[1].phase = "chain"',
  },
  {
    name: "historical existence remains live with a dirty cap",
    initial: state(
      '!.head = 2, !.history[2] = [exists |-> TRUE, kind |-> 1, cap |-> 9], !.history[1].exists = FALSE, !.history[1].cap = -5, !.requests[1] = [idle EXCEPT !.phase = "history", !.mode = "register", !.purpose = 1, !.expected = 1, !.current = 2, !.policy = 1, !.cap = 9]',
    ),
    step: "IF ~s.history[1].exists THEN s' = [s EXCEPT !.history[1].exists = TRUE] ELSE history(1)",
    witness: 's.requests[1].phase = "chain"',
  },
];
for (const deferred of [false, true])
  for (const cap of [1, 99])
    cases.push({
      name: `actual ${deferred ? "deferred" : "concrete"} project-to-commit copy cone with cap ${cap}`,
      initial: state(projectReady + `, !.history[1].cap = ${cap}`),
      step: ordinaryPipeline(deferred),
      witness: commitWitness(2),
    });
for (const deferred of [false, true])
  cases.push({
    name: `actual ${deferred ? "deferred" : "concrete"} historical creation/current cap copy cone`,
    initial: state(
      projectReady +
        ", !.head = 2, !.history[1].cap = 7, !.history[2] = [exists |-> TRUE, kind |-> 1, cap |-> 9]",
    ),
    step: ordinaryPipeline(deferred),
    witness: commitWitness(3),
  });
const terminalObligation =
  "(s.requests[2].committed > 0 => (policyAt(s.requests[2].committed).exists /\\ deploymentAt(s.requests[2].purpose).exists))";
for (const heals of [false, true])
  cases.push({
    name: `actual commit ${heals ? "heals" : "preserves"} another terminal false obligation with dirty caps`,
    initial: state(
      projectReady +
        `, !.history[1].cap = -7, !.requests[2] = [idle EXCEPT !.phase = "done", !.committed = ${heals ? 2 : 3}, !.purpose = ${heals ? 1 : 2}]`,
    ),
    step: ordinaryPipeline(),
    witness: `${commitWitness(2)} /\\ ${heals ? "" : "~"}${terminalObligation}`,
  });
for (const kind of ["cap", "other"])
  cases.push({
    name: `actual edit ${kind} still advances exact revision/kind/existence`,
    initial,
    step: `edit("${kind}")`,
    witness: "s.head = 2 /\\ policyAt(2).exists /\\ policyAt(2).kind = 1",
  });
for (const control of cases)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native owner cap VIEW retains ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain("OWNER_CAP_VIEW_NAMED_WITNESS_FOUND");
      expect(result.output).toContain("State 2:");
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );
const coalescing: NativeCase[] = [
  {
    name: "retargeted active-register-cap observation",
    initial: state(
      '!.requests[1] = [idle EXCEPT !.phase = "commit", !.mode = "register", !.cap = 1]',
    ),
    step: "s' = [s EXCEPT !.requests[1].cap = 2]",
    witness: "FALSE",
  },
  {
    name: "all request/history/creation caps while another invariant is false",
    initial: state(
      '!.history[1].exists = FALSE, !.history[1].cap = -1, !.requests[1] = [idle EXCEPT !.phase = "commit", !.mode = "register", !.cap = -2], !.requests[2] = [idle EXCEPT !.phase = "body", !.mode = "register", !.cap = 7]',
    ),
    step: "s' = [s EXCEPT !.history[1].cap = 99, !.history[2].cap = -8, !.history[3].cap = 42, !.requests[1].cap = 9, !.requests[1].creationCap = 4, !.requests[2].cap = 8, !.requests[2].creationCap = 3]",
    witness: "FALSE",
  },
];
for (const revision of [1, 2, 3])
  coalescing.push({
    name: `history cap at exact revision ${revision}`,
    initial,
    step: `s' = [s EXCEPT !.history[${revision}].cap = 17]`,
    witness: "FALSE",
  });
for (const control of coalescing)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native owner cap VIEW coalesces only ${control.name}`,
    async () => {
      const fixture = nativeFixture(control);
      for (const [useView, count] of [
        [false, 2],
        [true, 1],
      ] as const) {
        const result = await runNative(fixture, useView);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("OWNER_CAP_VIEW_NATIVE_COMPLETE");
        expect(result.output).toMatch(
          new RegExp(`${count} distinct states? found`, "u"),
        );
        expect(result.output).toMatch(/0 states? left on queue/u);
      }
    },
    120_000,
  );
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native no-VIEW future history-cap guard exposes the cone boundary",
  async () => {
    const result = await runNative(
      nativeFixture({
        name: "future cap consumer",
        initial,
        step: "IF s.history[1].cap = 1 THEN s' = [s EXCEPT !.history[1].cap = 2] ELSE s' = [s EXCEPT !.head = 2]",
        witness: "s.head = 2",
      }),
      false,
    );
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("OWNER_CAP_VIEW_NAMED_WITNESS_FOUND");
    expect(result.output).toContain("State 2:");
    expect(result.output).not.toContain("violated by the initial state");
    expect(result.output).not.toContain("No error has been found");
  },
  120_000,
);
