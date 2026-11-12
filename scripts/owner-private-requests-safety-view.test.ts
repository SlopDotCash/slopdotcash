/** Exact-source guards and native observations for terminal private requests. */
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
    (v) => v.id === "owner-private-terminal-safety-v1",
  );
if (!view) throw Error("Missing reviewed owner-private VIEW");
const selected: SafetyViewDefinition = view,
  source = readFileSync(join(root, selected.model), "utf8");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2)
    throw Error(`Expected one source boundary: ${from}`);
  return text.replace(from, to);
}
function checkReviewedBoundary(model: string) {
  const start = model.indexOf("module ui_owner_private_requests {"),
    end = model.indexOf("  run mutationRefusalClearsBeforeRecheckTest", start);
  if (
    start < 0 ||
    end < start ||
    digest(model.slice(start, end)) !==
      "a968686a0b5db74fc219b819ea88d2347d37645fe383154a4694a3a861a4e45f"
  )
    throw Error(
      "Owner private request terminal reuse and invariant observations need review",
    );
}
test("owner-private VIEW binds the complete model and future-read boundary", () => {
  checkReviewedBoundary(source);
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
  expect(digest(source)).toBe(
    "10f3857b1869eede164399bb95e8690243f18b83552fca833717ef8c37a85b6c",
  );
});
for (const [name, before, after] of [
  [
    "write-only error becoming a guard",
    "s.active == 0,",
    's.active == 0, s.error == "none",',
  ],
  [
    "unused payload influencing begin",
    's.requests.get(id).phase == "unused",',
    's.requests.get(id).phase == "unused", s.requests.get(id).cookie == 1,',
  ],
  [
    "done slots becoming reusable",
    's.requests.get(id).phase == "unused",',
    'Set("unused", "done").contains(s.requests.get(id).phase),',
  ],
  [
    "done ownership being consumed",
    'r.phase == "dispatch", owns(id),',
    'Set("dispatch", "done").contains(r.phase), owns(id),',
  ],
  [
    "a late terminal response",
    'r.phase == "http" or (r.phase == "admission" and outcome == "temporary"),',
    'r.phase == "done" or r.phase == "http" or (r.phase == "admission" and outcome == "temporary"),',
  ],
  [
    "cross-slot terminal cookie reads",
    "s.active == 0,",
    "s.active == 0, s.requests.get(2).cookie == 1,",
  ],
  [
    "a changed actor lower-bound observation",
    "s.requests.get(id).actor >= 0,",
    "s.requests.get(id).actor > 0,",
  ],
  [
    "a new invariant error observation",
    "s.accepted.subseteq(ids),",
    's.accepted.subseteq(ids), s.error == "none",',
  ],
] as const)
  test(`future ${name} requires renewed review`, () => {
    const changed = replaceOnce(source, before, after);
    expect(() => checkReviewedBoundary(changed)).toThrow("need review");
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

test("temporal, property and projection changes cannot reuse the owner-private VIEW", () => {
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
    { ...binding, operator: "UnreviewedOwnerPrivateView" },
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
  const directory = mkdtempSync(join(tmpdir(), "slop-owner-private-native-"));
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
    'if(result.isLeft()){if(result.value.isViolation){console.log("OWNER_PRIVATE_VIEW_NAMED_WITNESS_FOUND");process.exitCode=1;}',
    'else{console.log("OWNER_PRIVATE_VIEW_NATIVE_ERROR");process.exitCode=2;}}else console.log("OWNER_PRIVATE_VIEW_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "owner-private-view-native-control",
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
  '[phase |-> "done", kind |-> "read", actor |-> 1, cookie |-> 1, admitted |-> TRUE, lifetime |-> 1, outcome |-> "success", setup |-> FALSE, observed |-> 0, available |-> FALSE]';
const initial =
  '[mode |-> "awards", present |-> TRUE, mounted |-> TRUE, lifetime |-> 1, session |-> 1, knownActor |-> 1, data |-> TRUE, draft |-> TRUE, stale |-> FALSE, canSetup |-> FALSE, error |-> "none", active |-> 0, requests |-> [requestId \\in {1,2} |-> ' +
  request +
  "], accepted |-> {}]";
const state = (changes: string) => `[${initial} EXCEPT ${changes}]`;
const cases: NativeCase[] = [];
const globals = [
  [
    "present-mounted",
    "s.present \\/ ~s.mounted",
    "!.present = FALSE",
    "!.present = TRUE",
  ],
  [
    "private-data-actor",
    "~s.data \\/ s.knownActor > 0",
    "!.knownActor = 0",
    "!.knownActor = 1",
  ],
  [
    "stale-funds-state",
    '~s.stale \\/ (s.mode = "funds" /\\ s.data /\\ ~s.canSetup)',
    "!.stale = TRUE",
    "!.stale = FALSE",
  ],
  [
    "detached-data",
    "s.mounted \\/ ~s.data",
    "!.mounted = FALSE",
    "!.mounted = TRUE",
  ],
  [
    "accepted-id-domain",
    "s.accepted \\subseteq {1,2}",
    "!.accepted = {3}",
    "!.accepted = {}",
  ],
] as const;
for (const [name, observation, corrupt, repair] of globals) {
  cases.push({
    name: `global ${name} false class`,
    initial,
    step: `s' = [s EXCEPT ${corrupt}]`,
    witness: `~(${observation})`,
  });
  cases.push({
    name: `global false ${name} healing`,
    initial: state(corrupt),
    step: `s' = [s EXCEPT ${repair}]`,
    witness: observation,
  });
}
const observations = [
  [
    "actor-lower-bound",
    "s.requests[1].actor >= 0",
    "!.requests[1].actor = -1",
    "!.requests[1].actor = 1",
  ],
  [
    "actor-upper-bound",
    "s.requests[1].actor <= 2",
    "!.requests[1].actor = 3",
    "!.requests[1].actor = 1",
  ],
  [
    "admitted-cookie-equality",
    "(s.requests[1].admitted => s.requests[1].cookie = s.requests[1].actor)",
    "!.requests[1].cookie = 2",
    "!.requests[1].cookie = 1",
  ],
] as const;
for (const phase of ["unused", "done"])
  for (const [name, observation, corrupt, repair] of observations) {
    cases.push({
      name: `${phase} ${name} false class`,
      initial: state(`!.requests[1].phase = "${phase}"`),
      step: `s' = [s EXCEPT ${corrupt}]`,
      witness: `~(${observation})`,
    });
    cases.push({
      name: `${phase} false ${name} healing`,
      initial: state(`!.requests[1].phase = "${phase}", ${corrupt}`),
      step: `s' = [s EXCEPT ${repair}]`,
      witness: observation,
    });
  }
cases.push(
  {
    name: "live lifetime before concrete dispatch",
    initial: state(
      '!.active = 1, !.requests[1].phase = "dispatch", !.requests[1].lifetime = 2',
    ),
    step: "IF s.requests[1].lifetime = 2 THEN s' = [s EXCEPT !.requests[1].lifetime = 1] ELSE dispatch(1)",
    witness: 's.requests[1].phase = "admission"',
  },
  {
    name: "live actor before preflight use",
    initial: state(
      '!.active = 1, !.requests[1].phase = "preflight-returned", !.requests[1].kind = "mutation", !.requests[1].observed = 2, !.requests[1].available = TRUE',
    ),
    step: "IF s.requests[1].actor = 1 THEN s' = [s EXCEPT !.requests[1].actor = 2] ELSE usePreflight(1)",
    witness: 's.requests[1].phase = "dispatch" /\\ s.requests[1].actor = 2',
  },
  {
    name: "live cookie before admission",
    initial: state(
      '!.active = 1, !.requests[1].phase = "admission", !.requests[1].cookie = 2, !.requests[1].admitted = FALSE',
    ),
    step: "IF s.requests[1].cookie = 2 THEN s' = [s EXCEPT !.requests[1].cookie = 1] ELSE admit(1)",
    witness: 's.requests[1].phase = "http" /\\ s.requests[1].admitted',
  },
  {
    name: "live admission before accepted mutation",
    initial: state(
      '!.active = 1, !.requests[1].phase = "http", !.requests[1].kind = "mutation", !.requests[1].admitted = FALSE',
    ),
    step: 'IF ~s.requests[1].admitted THEN s\' = [s EXCEPT !.requests[1].admitted = TRUE] ELSE response(1,"success",FALSE)',
    witness: "s.accepted = {1}",
  },
  {
    name: "live kind before accepted mutation",
    initial: state('!.active = 1, !.requests[1].phase = "http"'),
    step: 'IF s.requests[1].kind = "read" THEN s\' = [s EXCEPT !.requests[1].kind = "mutation"] ELSE response(1,"success",FALSE)',
    witness: "s.accepted = {1}",
  },
  {
    name: "live outcome before private data publication",
    initial: state(
      '!.active = 1, !.data = FALSE, !.requests[1].phase = "recheck-returned", !.requests[1].outcome = "invalid", !.requests[1].observed = 1, !.requests[1].available = TRUE',
    ),
    step: 'IF s.requests[1].outcome = "invalid" THEN s\' = [s EXCEPT !.requests[1].outcome = "success"] ELSE useRecheck(1)',
    witness: 's.requests[1].phase = "done" /\\ s.data',
  },
  {
    name: "live setup before funds child publication",
    initial: state(
      '!.mode = "funds", !.active = 1, !.data = FALSE, !.requests[1].phase = "recheck-returned", !.requests[1].observed = 1, !.requests[1].available = TRUE',
    ),
    step: "IF ~s.requests[1].setup THEN s' = [s EXCEPT !.requests[1].setup = TRUE] ELSE useRecheck(1)",
    witness: "s.canSetup",
  },
  {
    name: "live observed actor before preflight use",
    initial: state(
      '!.active = 1, !.requests[1].phase = "preflight-returned", !.requests[1].available = TRUE',
    ),
    step: "IF s.requests[1].observed = 0 THEN s' = [s EXCEPT !.requests[1].observed = 1] ELSE usePreflight(1)",
    witness: 's.requests[1].phase = "dispatch"',
  },
  {
    name: "live availability before preflight use",
    initial: state(
      '!.active = 1, !.requests[1].phase = "preflight-returned", !.requests[1].observed = 1',
    ),
    step: "IF ~s.requests[1].available THEN s' = [s EXCEPT !.requests[1].available = TRUE] ELSE usePreflight(1)",
    witness: 's.requests[1].phase = "dispatch"',
  },
  {
    name: "dirty unused full reset heals raw false classes",
    initial: state(
      '!.requests[1].phase = "unused", !.requests[1].actor = -1, !.requests[1].cookie = 2, !.requests[1].admitted = TRUE, !.requests[1].lifetime = 2, !.requests[1].outcome = "invalid", !.requests[1].setup = TRUE, !.requests[1].observed = 2, !.requests[1].available = TRUE',
    ),
    step: 'begin(1,"read")',
    witness:
      's.requests[1].phase = "preflight" /\\ s.requests[1].kind = "read" /\\ s.requests[1].actor = 0 /\\ s.requests[1].cookie = 0 /\\ ~s.requests[1].admitted /\\ s.requests[1].lifetime = 1 /\\ s.requests[1].outcome = "success" /\\ ~s.requests[1].setup /\\ s.requests[1].observed = 0 /\\ ~s.requests[1].available',
  },
  {
    name: "unused reset preserves a new false upper bound from exact global actor",
    initial: state('!.knownActor = 3, !.requests[1].phase = "unused"'),
    step: 'begin(1,"mutation")',
    witness: 's.requests[1].phase = "preflight" /\\ s.requests[1].actor > 2',
  },
);
for (const control of cases)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native owner-private VIEW retains ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain("OWNER_PRIVATE_VIEW_NAMED_WITNESS_FOUND");
      expect(result.output).toContain("State 2:");
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );
const coalescing: NativeCase[] = [
  {
    name: "write-only global error",
    initial,
    step: 's\' = [s EXCEPT !.error = "identity"]',
    witness: "FALSE",
  },
];
for (const phase of ["unused", "done"]) {
  coalescing.push({
    name: `${phase} dead payload with true raw observations`,
    initial: state(`!.requests[1].phase = "${phase}"`),
    step: 's\' = [s EXCEPT !.requests[1].kind = "mutation", !.requests[1].actor = 2, !.requests[1].cookie = 2, !.requests[1].lifetime = 2, !.requests[1].outcome = "invalid", !.requests[1].setup = TRUE, !.requests[1].observed = 2, !.requests[1].available = TRUE]',
    witness: "FALSE",
  });
  coalescing.push({
    name: `${phase} dead payload with false raw observations`,
    initial: state(
      `!.requests[1].phase = "${phase}", !.requests[1].actor = -1, !.requests[1].cookie = 0`,
    ),
    step: 's\' = [s EXCEPT !.requests[1].actor = -2, !.requests[1].cookie = 1, !.requests[1].outcome = "invalid", !.requests[1].lifetime = 2]',
    witness: "FALSE",
  });
}
for (const control of coalescing)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native owner-private VIEW coalesces only ${control.name}`,
    async () => {
      const fixture = nativeFixture(control);
      for (const [useView, count] of [
        [false, 2],
        [true, 1],
      ] as const) {
        const result = await runNative(fixture, useView);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("OWNER_PRIVATE_VIEW_NATIVE_COMPLETE");
        expect(terminalCounts(result.output)).toEqual({
          distinct: count,
          queued: 0,
        });
      }
    },
    120_000,
  );
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native done request cannot begin again",
  async () => {
    const result = await runNative(
      nativeFixture({
        name: "done no reuse",
        initial,
        step: 'begin(1,"read") \\/ s\' = s',
        witness: 's.requests[1].phase # "done"',
      }),
    );
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("OWNER_PRIVATE_VIEW_NATIVE_COMPLETE");
    expect(terminalCounts(result.output)).toEqual({ distinct: 1, queued: 0 });
  },
  120_000,
);
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native no-VIEW future error read exposes lost successor",
  async () => {
    const result = await runNative(
      nativeFixture({
        name: "future error consumer",
        initial,
        step: 'IF s.error = "none" THEN s\' = [s EXCEPT !.error = "identity"] ELSE s\' = [s EXCEPT !.data = FALSE]',
        witness: "~s.data",
      }),
      false,
    );
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("OWNER_PRIVATE_VIEW_NAMED_WITNESS_FOUND");
    expect(result.output).toContain("State 2:");
    expect(result.output).not.toContain("violated by the initial state");
    expect(result.output).not.toContain("No error has been found");
  },
  120_000,
);

function terminalCounts(output: string) {
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
test("owner-private control evidence uses the final complete summary", () => {
  expect(
    terminalCounts(
      "1 states generated, 1 distinct state found, 0 states left on queue.\n3 states generated, 2 distinct states found, 0 states left on queue.\n",
    ),
  ).toEqual({ distinct: 2, queued: 0 });
  expect(
    terminalCounts(
      "5,002 states generated, 4,001 distinct states found, 2,003 states left on queue.",
    ),
  ).toEqual({ distinct: 4001, queued: 2003 });
  expect(() =>
    terminalCounts(
      "Progress(1): 1 states generated, 1 distinct state found, 0 states left on queue.",
    ),
  ).toThrow("Missing final TLC state counts");
  expect(() =>
    terminalCounts("1 distinct state found\n0 states left on queue"),
  ).toThrow("Missing final TLC state counts");
});
