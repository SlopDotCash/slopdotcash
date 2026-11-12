/** Exact-source controls for the conservative admin-vetting request VIEW. */
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
  (entry) => entry.id === "ui-admin-vetting-request-observation-safety-v1",
);
if (!view) throw new Error("Missing reviewed admin-vetting request VIEW");
const selected: SafetyViewDefinition = view;
const source = readFileSync(join(root, selected.model), "utf8");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function replaceOnce(text: string, before: string, after: string) {
  if (text.split(before).length !== 2)
    throw new Error(`Expected one audited source boundary: ${before}`);
  return text.replace(before, after);
}

test("admin-vetting VIEW binds the complete unchanged model and 32 scenarios", () => {
  expect(selected.model).toBe("formal/models/ui/ui_admin_vetting_requests.qnt");
  expect(selected.module).toBe("ui_admin_vetting_requests");
  expect(selected.operator).toBe("SlopAdminVettingRequestViewV1");
  expect(digest(source)).toBe(
    "681a1d0913f4ab5e4ab6d80c8879d96b47def92cfd8785d08e561f64e3fd7778",
  );
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
  expect(source.match(/^ {2}run \w+Test\b/gmu)).toHaveLength(32);
  expect(selected.translatedSha256).toBe(
    "738a0a9ca2103821211352471afbb0834a397bea76217037d47cdb28aec4039a",
  );
  expect(selected.viewTlaSha256).toBe(
    "adc5b7b4e95bdcba18eaf83f0286d68dc8f2cbe7b301031d849320b400e55d9e",
  );
  expect(selected.fields).toHaveLength(1);
  expect(selected.clauses).toEqual([
    { name: "refreshCountEqual", expression: "(s.refreshes = s.callbacks)" },
  ]);
});

for (const [name, before, after] of [
  [
    "payload eligibility",
    "action beginMutation = all { visible,",
    "action beginMutation = all { s.formPayload == 1, visible,",
  ],
  [
    "captured payload callback",
    'ownsMutation, s.mutation.phase == "callback-ready", s.accepted,',
    'ownsMutation, s.mutation.payload == s.formPayload, s.mutation.phase == "callback-ready", s.accepted,',
  ],
  [
    "raw refresh guard",
    "action remount = all { not(s.mounted), s.life == 1,",
    "action remount = all { s.refreshes == 0, not(s.mounted), s.life == 1,",
  ],
  [
    "read restart",
    's.mounted, not(s.invalidated), s.reads.get(id).phase == "unused",',
    's.mounted, not(s.invalidated), Set("unused", "done").contains(s.reads.get(id).phase),',
  ],
  [
    "read admin invariant",
    "s.reads.get(s.privateRead).observed == s.actor",
    "s.reads.get(s.privateRead).observed == s.actor and s.reads.get(s.privateRead).observedAdmin",
  ],
  [
    "raw request cookie consumer",
    'r.gate == "preflight"',
    'r.gate == "preflight" and r.cookie == s.cookie',
  ],
] as const)
  test(`admin-vetting source drift through ${name} needs renewed review`, () => {
    expect(() =>
      bindSafetyView(
        manifest,
        selected.id,
        selected.model,
        replaceOnce(source, before, after),
      ),
    ).toThrow("model changed");
  });

function fixtureBinding(tla: string): SafetyViewDefinition {
  const end = tla.match(/^={4,}[ \t]*$/gmu);
  if (end?.length !== 1 || !tla.endsWith(`${end[0]}\n`))
    throw new Error("Native fixture module terminator differs");
  const projected =
    tla.slice(0, -end[0].length - 1) +
    selected.operator +
    " ==\n  <<" +
    [...selected.fields, ...selected.clauses]
      .map((x) => x.expression)
      .join(", ") +
    ">>\n\n" +
    end[0] +
    "\n";
  return {
    ...selected,
    translatedSha256: digest(tla),
    viewTlaSha256: digest(projected),
  };
}

test("admin-vetting property, translation and observation drift fail closed", () => {
  const temporal = `${source}\ntemporal unreviewed = true\n`;
  expect(() =>
    bindSafetyView(
      { ...manifest, views: [{ ...selected, sourceSha256: digest(temporal) }] },
      selected.id,
      selected.model,
      temporal,
    ),
  ).toThrow("does not authorize temporal properties");
  const tlaCode =
    "---- MODULE ui_admin_vetting_requests ----\nVARIABLE s\n====\n";
  const binding = fixtureBinding(tlaCode);
  const config = {
    moduleName: selected.module,
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
  for (const changed of [
    { ...config, hasInvariant: false },
    { ...config, hasTemporal: true },
  ])
    expect(() => applySafetyView(binding, changed)).toThrow("property differs");
  expect(() =>
    applySafetyView({ ...binding, viewTlaSha256: "0".repeat(64) }, config),
  ).toThrow("projection changed");
  for (const changed of [
    { ...binding, clauses: [] },
    {
      ...binding,
      clauses: [{ name: "refreshCountEqual", expression: "TRUE" }],
    },
    { ...binding, fields: [{ name: "state", expression: "s" }] },
    {
      ...binding,
      fields: selected.fields.map((field) => ({
        ...field,
        expression: field.expression.replace(
          "SlopAdminMutation.observedAdmin",
          "TRUE",
        ),
      })),
    },
    { ...binding, operator: "UnreviewedAdminVettingView" },
  ])
    expect(() => applySafetyView(changed, config)).toThrow("property differs");
});

let translated: string | undefined;
function actualTranslatedModel() {
  if (translated !== undefined) return translated;
  const directory = mkdtempSync(join(tmpdir(), "slop-admin-vetting-view-"));
  const output = join(directory, "production.tla");
  try {
    // Only native-flagged tests reach this function. Always derive the fresh
    // COMPLETE production translation; never run a hand-written reduced model.
    const capture = [
      'import {createRequire} from "node:module";',
      'import {realpathSync,writeFileSync} from "node:fs";',
      'import {pathToFileURL} from "node:url";',
      'const require=createRequire(process.cwd()+"/package.json");',
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
    for (const marker of [
      "ownsRead(",
      "ownsMutation ==",
      "invokeMutationCallback(",
      "readResponse(",
      "admitMutation(",
      "q_init == init",
      "q_inv == invariant",
      "q_step == step",
    ])
      expect(translated).toContain(marker);
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
  '[life |-> 1, generation |-> 1, actor |-> 1, cookie |-> 1, phase |-> "done", failure |-> "", observed |-> 1, observedAdmin |-> TRUE, gate |-> "postflight"]';
const emptyRead =
  '[life |-> 0, generation |-> 0, actor |-> 0, cookie |-> 0, phase |-> "unused", failure |-> "", observed |-> 0, observedAdmin |-> FALSE, gate |-> "none"]';
const mutation =
  '[life |-> 1, ownerRead |-> 1, actor |-> 1, cookie |-> 1, phase |-> "callback-ready", failure |-> "", payload |-> 1, observed |-> 1, observedAdmin |-> TRUE, gate |-> "postflight"]';
const emptyMutation =
  '[life |-> 0, ownerRead |-> 0, actor |-> 0, cookie |-> 0, phase |-> "unused", failure |-> "", payload |-> 0, observed |-> 0, observedAdmin |-> FALSE, gate |-> "none"]';
const initial =
  "[present |-> TRUE, mounted |-> TRUE, life |-> 1, actor |-> 1, cookie |-> 1, admin |-> TRUE, identityAvailable |-> TRUE, generation |-> 1, activeRead |-> 1, reads |-> [id \\in {1,2} |-> IF id = 1 THEN " +
  read +
  " ELSE " +
  emptyRead +
  "], mutation |-> " +
  emptyMutation +
  ", privateRead |-> 1, formPayload |-> 1, note |-> FALSE, error |-> FALSE, invalidated |-> FALSE, accepted |-> FALSE, callbacks |-> 0, refreshes |-> 0]";
const state = (changes: string) => `[${initial} EXCEPT ${changes}]`;
const selectedSlot = (id: number, phase = "done", extra = "") =>
  state(
    `!.activeRead = ${id}, !.privateRead = ${id}, !.reads = [slot \\in {1,2} |-> IF slot = ${id} THEN [${read} EXCEPT !.phase = "${phase}"] ELSE ${emptyRead}]${extra ? `, ${extra}` : ""}`,
  );

type NativeCase = {
  name: string;
  initial: string;
  step: string;
  witness: string;
  raw?: boolean;
};
function injectNativeControl(tla: string, control: NativeCase) {
  tla = replaceOnce(
    tla,
    "q_init == init",
    `SlopAdminControlInitial == ${control.initial}\n\nq_init == s = SlopAdminControlInitial`,
  );
  // Mechanically rule out an initial-state witness even for false-prefix
  // fixtures. Only the exact named successor witness can satisfy the test.
  tla = replaceOnce(
    tla,
    "q_inv == invariant",
    `SlopAdminControlWitness == s # SlopAdminControlInitial /\\ (${control.witness})\n\nq_inv == ~SlopAdminControlWitness`,
  );
  return replaceOnce(
    tla,
    "q_step == step",
    `SlopAdminControlStep == ${control.step}\n\nq_step == SlopAdminControlStep`,
  );
}
function nativeFixture(control: NativeCase) {
  return injectNativeControl(actualTranslatedModel(), control);
}

test("admin-vetting controller aliases use full production actions and a noninitial named witness", () => {
  const tla =
    "---- MODULE ui_admin_vetting_requests ----\nVARIABLE s\ninit == s = 0\nq_init == init\ninvariant == TRUE\nq_inv == invariant\nuseReadIdentity(id) == s' = s\nstep == useReadIdentity(1)\nq_step == step\n====\n";
  const fixture = injectNativeControl(tla, {
    name: "alias order",
    initial: "0",
    step: "useReadIdentity(1)",
    witness: "s = 1",
  });
  expect(fixture.indexOf("SlopAdminControlInitial ==")).toBeLessThan(
    fixture.indexOf("q_init == s = SlopAdminControlInitial"),
  );
  expect(fixture).toContain(
    "SlopAdminControlWitness == s # SlopAdminControlInitial /\\ (s = 1)",
  );
  expect(fixture.indexOf("SlopAdminControlStep ==")).toBeGreaterThan(
    fixture.indexOf("useReadIdentity(id) =="),
  );
  expect(fixture.indexOf("SlopAdminControlStep ==")).toBeLessThan(
    fixture.indexOf("q_step == SlopAdminControlStep"),
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
    'if(result.isLeft()){if(result.value.isViolation){console.log("ADMIN_VETTING_NAMED_WITNESS_FOUND");process.exitCode=1;}else{console.log("ADMIN_VETTING_NATIVE_ERROR");process.exitCode=2;}}else console.log("ADMIN_VETTING_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "admin-vetting-view-native-control",
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

// All 41 labeled parameter instances, evaluated by native ENABLED, not a
// JavaScript reimplementation. Present is guard-inert but retained in the VIEW;
// changing it gives a named noninitial witness without changing any guard input.
const guardMatrix: [string, boolean][] = [
  ...[0, 1, 2].map(
    (actor) => [`cookieChanges(${actor})`, true] as [string, boolean],
  ),
  ...["FALSE", "TRUE"].flatMap(
    (flag) =>
      [
        [`identityAvailability(${flag})`, true],
        [`adminRole(${flag})`, true],
      ] as [string, boolean][],
  ),
  ...[1, 2].map((id) => [`editPayload(${id})`, true] as [string, boolean]),
  ["depart", true],
  ["remount", false],
  ...[1, 2].flatMap(
    (id) =>
      [
        [`beginRead(${id})`, id === 2],
        [`observeReadIdentity(${id})`, false],
        [`returnReadIdentity(${id})`, false],
        [`useReadIdentity(${id})`, false],
        [`dispatchRead(${id})`, false],
        [`readResponse(${id},FALSE)`, false],
        [`readResponse(${id},TRUE)`, false],
        [`readTemporaryFailure(${id})`, false],
        [`dropRead(${id})`, false],
      ] as [string, boolean][],
  ),
  ["beginMutation", true],
  ["observeMutationIdentity", false],
  ["returnMutationIdentity", false],
  ["useMutationIdentity", false],
  ["dispatchMutation", false],
  ["admitMutation(FALSE)", false],
  ["admitMutation(TRUE)", false],
  ["mutationTemporaryFailure", false],
  ["invokeMutationCallback(1)", false],
  ["invokeMutationCallback(2)", false],
  ["dropMutation", false],
  ["s' = s", true],
];
const erasedNoise = state(
  '!.error = TRUE, !.formPayload = 2, !.reads[1].generation = 91, !.reads[1].cookie = 2, !.reads[1].failure = "access", !.reads[1].observedAdmin = FALSE, !.reads[1].gate = "preflight", !.reads[2] = [' +
    emptyRead +
    ' EXCEPT !.life = 9, !.generation = 8, !.actor = 2, !.cookie = 2, !.failure = "access", !.observed = 2, !.observedAdmin = TRUE, !.gate = "postflight"], !.mutation = [' +
    emptyMutation +
    ' EXCEPT !.life = 9, !.ownerRead = 2, !.actor = 2, !.cookie = 2, !.observed = 2, !.payload = 2, !.failure = "access", !.gate = "preflight"]',
);
for (const [name, seed] of [
  ["healthy", initial],
  ["equivalent erased fields", erasedNoise],
  ["false refresh equality one", state("!.refreshes = 1")],
  ["false refresh equality two", state("!.refreshes = 2")],
] as const)
  cases.push({
    name: `all 41 same-parameter guards from ${name}`,
    initial: seed,
    step: "s' = [s EXCEPT !.present = FALSE]",
    witness:
      "~s.present /\\ " +
      guardMatrix
        .map(
          ([action, enabled]) => `${enabled ? "" : "~"}(ENABLED (${action}))`,
        )
        .join(" /\\ "),
  });

test("admin-vetting native guard matrix covers every original labeled parameter instance", () => {
  expect(guardMatrix).toHaveLength(41);
  expect(new Set(guardMatrix.map(([action]) => action)).size).toBe(41);
});

for (const [name, change, witness] of [
  [
    "committed removal",
    "!.present = FALSE",
    "~s.present /\\ s.mounted /\\ ~invariant",
  ],
  [
    "callback count",
    `!.mutation = ${mutation}, !.accepted = TRUE, !.callbacks = 2, !.refreshes = 2`,
    "s.callbacks = 2 /\\ ~invariant",
  ],
  [
    "refresh count equality",
    "!.refreshes = 1",
    "s.refreshes # s.callbacks /\\ ~invariant",
  ],
  [
    "callback acceptance",
    `!.mutation = ${mutation}, !.callbacks = 1, !.refreshes = 1`,
    "s.callbacks = 1 /\\ ~s.accepted /\\ ~invariant",
  ],
  [
    "accepted cookie",
    "!.accepted = TRUE, !.mutation.cookie = 1",
    "s.accepted /\\ s.mutation.cookie # s.mutation.actor /\\ ~invariant",
  ],
  [
    "invalidated selection",
    "!.invalidated = TRUE",
    "s.invalidated /\\ s.privateRead # 0 /\\ ~invariant",
  ],
  [
    "invalidated note",
    "!.invalidated = TRUE, !.privateRead = 0, !.note = TRUE",
    "s.invalidated /\\ s.note /\\ ~invariant",
  ],
  [
    "callback observed actor",
    `!.mutation = [${mutation} EXCEPT !.observed = 2], !.accepted = TRUE, !.callbacks = 1, !.refreshes = 1`,
    "s.callbacks = 1 /\\ s.mutation.observed # s.mutation.actor /\\ ~invariant",
  ],
  [
    "callback admin",
    `!.mutation = [${mutation} EXCEPT !.observedAdmin = FALSE], !.accepted = TRUE, !.callbacks = 1, !.refreshes = 1`,
    "s.callbacks = 1 /\\ ~s.mutation.observedAdmin /\\ ~invariant",
  ],
  ["generation bound", "!.generation = 3", "s.generation = 3 /\\ ~invariant"],
  [
    "lifetime bound",
    "!.life = 3, !.reads[1].life = 3",
    "s.life = 3 /\\ ~invariant",
  ],
] as const)
  cases.push({
    name: `independent false ${name}`,
    initial,
    step: `s' = [s EXCEPT ${change}]`,
    witness,
  });

for (const id of [1, 2]) {
  for (const field of ["actor", "life", "observed"])
    cases.push({
      name: `selected read ${id} false ${field}`,
      initial: selectedSlot(id),
      step: `s' = [s EXCEPT !.reads[${id}].${field} = 2]`,
      witness: `visible /\\ s.reads[${id}].${field} = 2 /\\ ~invariant`,
    });
  cases.push({
    name: `read ${id} unknown-phase stale drop`,
    initial: selectedSlot(id, "unknown", "!.activeRead = 0"),
    step: `dropRead(${id})`,
    witness: `s.reads[${id}].phase = "done"`,
  });
  cases.push({
    name: `read ${id} unknown-phase owned drop refusal`,
    initial: selectedSlot(id, "unknown"),
    step: "s' = [s EXCEPT !.present = FALSE]",
    witness: `~s.present /\\ ~(ENABLED dropRead(${id}))`,
  });
  cases.push({
    name: `read ${id} HTTP stale drop remains enabled`,
    initial: selectedSlot(id, "http", "!.activeRead = 0"),
    step: `dropRead(${id})`,
    witness: `s.reads[${id}].phase = "done"`,
  });
  for (const [allow, cookie, phase] of [
    ["TRUE", 1, "postflight"],
    ["TRUE", 2, "failure"],
    ["FALSE", 1, "failure"],
  ] as const)
    cases.push({
      name: `read ${id} captured-cookie response ${allow}/${cookie}`,
      initial: selectedSlot(
        id,
        "http",
        `!.cookie = 2, !.reads[${id}].cookie = ${cookie}`,
      ),
      step: `readResponse(${id},${allow})`,
      witness: `s.reads[${id}].phase = "${phase}" /\\ ${phase === "failure" ? "" : "~"}(s.reads[${id}].failure = "access")`,
    });
  cases.push({
    name: `read ${id} temporary failure overwrites old access`,
    initial: selectedSlot(id, "http", `!.reads[${id}].failure = "access"`),
    step: `readTemporaryFailure(${id})`,
    witness: `s.reads[${id}].phase = "failure" /\\ s.reads[${id}].failure # "access"`,
  });
  cases.push({
    name: `read ${id} dispatch replaces a mismatched snapshot`,
    initial: selectedSlot(id, "checked", `!.reads[${id}].cookie = 2`),
    step: `dispatchRead(${id})`,
    witness: `s.reads[${id}].phase = "http" /\\ s.reads[${id}].cookie = s.reads[${id}].actor`,
  });
  for (const phase of ["preflight", "postflight", "failure"])
    cases.push({
      name: `read ${id} ${phase} observes a fresh identity`,
      initial: selectedSlot(
        id,
        phase,
        `!.reads[${id}].observed = 2, !.reads[${id}].observedAdmin = FALSE, !.reads[${id}].gate = "unknown"`,
      ),
      step: `observeReadIdentity(${id})`,
      witness: `s.reads[${id}].phase = "identity-observed" /\\ s.reads[${id}].observed = 1 /\\ s.reads[${id}].observedAdmin /\\ s.reads[${id}].gate = "${phase}" /\\ invariant`,
    });
  cases.push({
    name: `read ${id} returned identity carries captured admin`,
    initial: selectedSlot(
      id,
      "identity-observed",
      `!.admin = FALSE, !.cookie = 2`,
    ),
    step: `returnReadIdentity(${id})`,
    witness: `s.reads[${id}].phase = "identity-returned" /\\ s.reads[${id}].observed = 1 /\\ s.reads[${id}].observedAdmin`,
  });
  for (const [gate, failure, observed, admin, expected, invalidated] of [
    ["preflight", "", 1, "TRUE", "checked", false],
    ["postflight", "", 1, "TRUE", "done", false],
    ["unknown", "local", 1, "TRUE", "done", false],
    ["failure", "", 1, "TRUE", "done", false],
    ["postflight", "access", 1, "TRUE", "done", true],
    ["postflight", "", 2, "TRUE", "done", true],
    ["postflight", "", 1, "FALSE", "done", true],
  ] as const)
    cases.push({
      name: `read ${id} identity use ${gate}/${failure}/${observed}/${admin}`,
      initial: selectedSlot(
        id,
        "identity-returned",
        `!.reads[${id}].gate = "${gate}", !.reads[${id}].failure = "${failure}", !.reads[${id}].observed = ${observed}, !.reads[${id}].observedAdmin = ${admin}`,
      ),
      step: `useReadIdentity(${id})`,
      witness: `s.reads[${id}].phase = "${expected}" /\\ ${invalidated ? "" : "~"}s.invalidated${invalidated ? " /\\ s.privateRead = 0" : ""}`,
    });
  cases.push({
    name: `read ${id} begin heals malformed selected unused record`,
    initial: selectedSlot(
      id,
      "unused",
      `!.reads[${id}].life = 2, !.reads[${id}].actor = 2, !.reads[${id}].observed = 2, !.reads[${id}].failure = "access", !.reads[${id}].cookie = 2`,
    ),
    step: `beginRead(${id})`,
    witness: `s.reads[${id}].phase = "preflight" /\\ s.privateRead = 0 /\\ s.reads[${id}].life = s.life /\\ s.reads[${id}].actor = s.actor /\\ s.reads[${id}].observed = 0 /\\ invariant`,
  });
}

for (const [observed, admin] of [
  [0, "FALSE"],
  [0, "TRUE"],
  [1, "FALSE"],
  [1, "TRUE"],
] as const)
  cases.push({
    name: `callback-ready dormant observed/admin ${observed}/${admin} activates`,
    initial: state(
      `!.accepted = TRUE, !.mutation = [${mutation} EXCEPT !.observed = ${observed}, !.observedAdmin = ${admin}]`,
    ),
    step: "invokeMutationCallback(2)",
    witness: `s.callbacks = 1 /\\ s.refreshes = 1 /\\ s.mutation.phase = "done" /\\ ${observed === 1 && admin === "TRUE" ? "" : "~"}invariant`,
  });
cases.push({
  name: "paired increment preserves false refresh equality",
  initial: state(
    `!.accepted = TRUE, !.refreshes = 2, !.mutation = ${mutation}`,
  ),
  step: "invokeMutationCallback(2)",
  witness: "s.callbacks = 1 /\\ s.refreshes # s.callbacks /\\ ~invariant",
});
cases.push({
  name: "mutation unknown-phase stale drop",
  initial: state(
    `!.mutation = [${mutation} EXCEPT !.phase = "unknown", !.life = 2]`,
  ),
  step: "dropMutation",
  witness: 's.mutation.phase = "done"',
});
cases.push({
  name: "mutation unknown-phase owned drop refusal",
  initial: state(`!.mutation = [${mutation} EXCEPT !.phase = "unknown"]`),
  step: "s' = [s EXCEPT !.present = FALSE]",
  witness: "~s.present /\\ ~(ENABLED dropMutation)",
});
cases.push({
  name: "HTTP mutation cannot be dropped before admission",
  initial: state(
    `!.mutation = [${mutation} EXCEPT !.phase = "http", !.life = 2]`,
  ),
  step: "s' = [s EXCEPT !.present = FALSE]",
  witness: "~s.present /\\ ~(ENABLED dropMutation)",
});
cases.push({
  name: "begin mutation overwrites malformed unused captures",
  initial: state(
    "!.mutation = [" +
      emptyMutation +
      ' EXCEPT !.life = 2, !.ownerRead = 2, !.actor = 2, !.cookie = 2, !.observed = 2, !.observedAdmin = TRUE, !.failure = "access", !.gate = "postflight", !.payload = 2]',
  ),
  step: "beginMutation",
  witness:
    's.mutation.phase = "preflight" /\\ s.mutation.life = s.life /\\ s.mutation.ownerRead = s.privateRead /\\ s.mutation.actor = s.actor /\\ s.mutation.cookie # s.mutation.actor /\\ s.mutation.observed # s.mutation.actor /\\ ~s.mutation.observedAdmin',
});
for (const phase of ["preflight", "postflight", "failure"])
  cases.push({
    name: `mutation ${phase} observes fresh identity`,
    initial: state(
      `!.mutation = [${mutation} EXCEPT !.phase = "${phase}", !.observed = 2, !.observedAdmin = FALSE, !.gate = "unknown"]`,
    ),
    step: "observeMutationIdentity",
    witness: `s.mutation.phase = "identity-observed" /\\ s.mutation.observed = s.mutation.actor /\\ s.mutation.observedAdmin /\\ s.mutation.gate = "${phase}"`,
  });
cases.push({
  name: "mutation return retains captured identity after environment change",
  initial: state(
    `!.cookie = 2, !.admin = FALSE, !.mutation = [${mutation} EXCEPT !.phase = "identity-observed"]`,
  ),
  step: "returnMutationIdentity",
  witness:
    's.mutation.phase = "identity-returned" /\\ s.mutation.observed = s.mutation.actor /\\ s.mutation.observedAdmin',
});
for (const [gate, failure, observed, admin, expected, invalidated] of [
  ["preflight", "", 1, "TRUE", "checked", false],
  ["postflight", "", 1, "TRUE", "callback-ready", false],
  ["unknown", "local", 1, "TRUE", "done", false],
  ["failure", "", 1, "TRUE", "done", false],
  ["postflight", "access", 1, "TRUE", "done", true],
  ["postflight", "", 2, "TRUE", "done", true],
  ["postflight", "", 1, "FALSE", "done", true],
] as const)
  cases.push({
    name: `mutation identity use ${gate}/${failure}/${observed}/${admin}`,
    initial: state(
      `!.mutation = [${mutation} EXCEPT !.phase = "identity-returned", !.gate = "${gate}", !.failure = "${failure}", !.observed = ${observed}, !.observedAdmin = ${admin}]`,
    ),
    step: "useMutationIdentity",
    witness: `s.mutation.phase = "${expected}" /\\ ${invalidated ? "" : "~"}s.invalidated${invalidated ? " /\\ s.privateRead = 0" : ""}`,
  });
cases.push({
  name: "mutation dispatch overwrites mismatched cookie",
  initial: state(
    `!.mutation = [${mutation} EXCEPT !.phase = "checked", !.cookie = 2]`,
  ),
  step: "dispatchMutation",
  witness: 's.mutation.phase = "http" /\\ s.mutation.cookie = s.mutation.actor',
});
for (const [allow, cookie, phase, accepted] of [
  ["TRUE", 1, "postflight", true],
  ["TRUE", 2, "failure", false],
  ["FALSE", 1, "failure", false],
] as const)
  cases.push({
    name: `mutation captured-cookie admission ${allow}/${cookie}`,
    initial: state(
      `!.cookie = 2, !.mutation = [${mutation} EXCEPT !.phase = "http", !.cookie = ${cookie}]`,
    ),
    step: `admitMutation(${allow})`,
    witness: `s.mutation.phase = "${phase}" /\\ ${accepted ? "" : "~"}s.accepted /\\ ${accepted ? "~" : ""}(s.mutation.failure = "access")`,
  });
cases.push({
  name: "mutation temporary failure overwrites access",
  initial: state(
    `!.mutation = [${mutation} EXCEPT !.phase = "http", !.failure = "access"]`,
  ),
  step: "mutationTemporaryFailure",
  witness: 's.mutation.phase = "failure" /\\ s.mutation.failure # "access"',
});
cases.push({
  name: "departure heals invalidated private selection and note",
  initial: state("!.invalidated = TRUE, !.note = TRUE"),
  step: "depart",
  witness: "~s.mounted /\\ s.privateRead = 0 /\\ ~s.note /\\ invariant",
});
cases.push({
  name: "remount heals old private false prefix without healing old ownership",
  initial: state(
    "!.present = FALSE, !.mounted = FALSE, !.invalidated = TRUE, !.note = TRUE, !.cookie = 2, !.mutation = [" +
      mutation +
      ' EXCEPT !.phase = "identity-returned"]',
  ),
  step: "remount",
  witness:
    "s.mounted /\\ s.actor = 2 /\\ s.life = 2 /\\ s.privateRead = 0 /\\ ~s.invalidated /\\ ~ownsMutation /\\ invariant",
});
cases.push({
  name: "old lifetime return cannot invalidate replacement",
  initial: state(
    `!.life = 2, !.actor = 2, !.privateRead = 0, !.mutation = [${mutation} EXCEPT !.phase = "identity-returned", !.failure = "access"]`,
  ),
  step: "useMutationIdentity",
  witness: 's.mutation.phase = "done" /\\ ~s.invalidated /\\ s.actor = 2',
});
cases.push({
  name: "parent refresh retires child before returned identity use",
  initial: state(
    `!.privateRead = 0, !.activeRead = 2, !.mutation = [${mutation} EXCEPT !.phase = "identity-returned", !.gate = "preflight"]`,
  ),
  step: "useMutationIdentity",
  witness:
    's.mutation.phase = "done" /\\ ~s.invalidated /\\ s.mutation.cookie = s.mutation.actor',
});
cases.push({
  name: "historical passive departure still violates committed ownership",
  initial,
  step: "oldPassiveDepart",
  witness: "~s.present /\\ s.mounted /\\ ~invariant",
});
cases.push({
  name: "historical passive cleanup permits a departed dispatch",
  initial: state(
    `!.present = FALSE, !.mutation = [${mutation} EXCEPT !.phase = "checked"]`,
  ),
  step: "dispatchMutation",
  witness: '~s.present /\\ s.mutation.phase = "http" /\\ ~invariant',
});
cases.push({
  name: "historical passive cleanup permits a departed callback",
  initial: state(
    `!.present = FALSE, !.accepted = TRUE, !.mutation = ${mutation}`,
  ),
  step: "invokeMutationCallback(2)",
  witness:
    '~s.present /\\ s.callbacks = 1 /\\ s.refreshes = 1 /\\ s.reads[2].phase = "preflight" /\\ ~invariant',
});

// Identical production actions must replace the real carrier fields from both
// raw representatives. These witnesses use the supported projected outputs.
for (const [name, action, left, right, witness] of [
  [
    "begin read",
    "beginRead(2)",
    initial,
    erasedNoise,
    's.reads[2].phase = "preflight" /\\ s.reads[2].actor = 1 /\\ s.reads[2].life = 1 /\\ s.reads[2].generation = 2 /\\ s.reads[2].observed = 0 /\\ s.privateRead = 0',
  ],
  [
    "begin mutation",
    "beginMutation",
    initial,
    erasedNoise,
    's.mutation.phase = "preflight" /\\ s.mutation.actor = 1 /\\ s.mutation.life = 1 /\\ s.mutation.ownerRead = 1 /\\ s.mutation.cookie # s.mutation.actor /\\ s.mutation.observed # s.mutation.actor /\\ ~s.mutation.observedAdmin',
  ],
  [
    "dispatch read cookie",
    "dispatchRead(1)",
    selectedSlot(1, "checked", "!.reads[1].cookie = 0"),
    selectedSlot(1, "checked", "!.reads[1].cookie = 2"),
    's.reads[1].phase = "http" /\\ s.reads[1].cookie = s.reads[1].actor',
  ],
  [
    "observe selected read",
    "observeReadIdentity(1)",
    selectedSlot(
      1,
      "failure",
      '!.reads[1].observed = 0, !.reads[1].failure = "local"',
    ),
    selectedSlot(
      1,
      "failure",
      '!.reads[1].observed = 2, !.reads[1].failure = ""',
    ),
    's.reads[1].phase = "identity-observed" /\\ s.reads[1].observed = 1 /\\ s.reads[1].observedAdmin /\\ s.reads[1].failure # "access" /\\ invariant',
  ],
  [
    "observe mutation identity",
    "observeMutationIdentity",
    state(
      `!.mutation = [${mutation} EXCEPT !.phase = "failure", !.observed = 0, !.observedAdmin = FALSE, !.failure = "local"]`,
    ),
    state(
      `!.mutation = [${mutation} EXCEPT !.phase = "failure", !.observed = 2, !.observedAdmin = FALSE, !.failure = ""]`,
    ),
    's.mutation.phase = "identity-observed" /\\ s.mutation.observed = s.mutation.actor /\\ s.mutation.observedAdmin /\\ s.mutation.failure # "access"',
  ],
  [
    "dispatch mutation cookie",
    "dispatchMutation",
    state(
      `!.mutation = [${mutation} EXCEPT !.phase = "checked", !.cookie = 0]`,
    ),
    state(
      `!.mutation = [${mutation} EXCEPT !.phase = "checked", !.cookie = 2]`,
    ),
    's.mutation.phase = "http" /\\ s.mutation.cookie = s.mutation.actor',
  ],
  [
    "read mismatched response",
    "readResponse(1,TRUE)",
    selectedSlot(1, "http", "!.reads[1].cookie = 0"),
    selectedSlot(1, "http", "!.reads[1].cookie = 2"),
    's.reads[1].phase = "failure" /\\ s.reads[1].failure = "access"',
  ],
  [
    "mutation mismatched identity use",
    "useMutationIdentity",
    state(
      `!.mutation = [${mutation} EXCEPT !.phase = "identity-returned", !.observed = 0]`,
    ),
    state(
      `!.mutation = [${mutation} EXCEPT !.phase = "identity-returned", !.observed = 2]`,
    ),
    's.mutation.phase = "done" /\\ s.invalidated /\\ s.privateRead = 0 /\\ s.mutation.observed # s.mutation.actor',
  ],
] as const)
  for (const [side, seed] of [
    ["left", left],
    ["right", right],
  ] as const)
    cases.push({
      name: `actual ${name} overwrite pair ${side}`,
      initial: seed,
      step: action,
      witness,
    });

for (const id of [1, 2]) {
  cases.push({
    name: `read ${id} observation carries access failure`,
    initial: selectedSlot(id, "failure", `!.reads[${id}].failure = "access"`),
    step: `observeReadIdentity(${id})`,
    witness: `s.reads[${id}].phase = "identity-observed" /\\ s.reads[${id}].failure = "access"`,
  });
  cases.push({
    name: `read ${id} return carries access failure`,
    initial: selectedSlot(
      id,
      "identity-observed",
      `!.reads[${id}].failure = "access"`,
    ),
    step: `returnReadIdentity(${id})`,
    witness: `s.reads[${id}].phase = "identity-returned" /\\ s.reads[${id}].failure = "access"`,
  });
}
for (const [phase, action, next] of [
  ["failure", "observeMutationIdentity", "identity-observed"],
  ["identity-observed", "returnMutationIdentity", "identity-returned"],
] as const)
  cases.push({
    name: `mutation ${phase} carries access failure`,
    initial: state(
      `!.mutation = [${mutation} EXCEPT !.phase = "${phase}", !.failure = "access"]`,
    ),
    step: action,
    witness: `s.mutation.phase = "${next}" /\\ s.mutation.failure = "access"`,
  });

// Exact payload output remains a concrete-source scenario, outside the VIEW.
for (const id of [1, 2])
  cases.push({
    name: `concrete edit payload ${id}`,
    initial: state(`!.formPayload = ${3 - id}`),
    step: `editPayload(${id})`,
    witness: `s.formPayload = ${id}`,
    raw: true,
  });
cases.push({
  name: "concrete captured payload survives later editing",
  initial: state("!.formPayload = 2"),
  step: "beginMutation",
  witness: 's.mutation.phase = "preflight" /\\ s.mutation.payload = 2',
  raw: true,
});

for (const control of cases)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native admin-vetting VIEW retains ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control), !control.raw);
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain("ADMIN_VETTING_NAMED_WITNESS_FOUND");
      expect(result.output).toContain("State 2:");
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );

async function expectComplete(tla: string, useView: boolean, distinct: number) {
  const result = await runNative(tla, useView);
  expect(result.status, result.output).toBe(0);
  expect(result.output).toContain("ADMIN_VETTING_NATIVE_COMPLETE");
  expect(result.output).toContain("No error has been found");
  // Read terminal counts, not an earlier progress line with the desired count.
  const counts = [
    ...result.output.matchAll(/([0-9,]+) distinct states? found/gu),
  ];
  const queues = [
    ...result.output.matchAll(/([0-9,]+) states? left on queue/gu),
  ];
  expect(counts.length).toBeGreaterThan(0);
  expect(queues.length).toBeGreaterThan(0);
  expect(Number(counts.at(-1)?.[1].replaceAll(",", ""))).toBe(distinct);
  expect(Number(queues.at(-1)?.[1].replaceAll(",", ""))).toBe(0);
}
for (const [name, seed, target] of [
  ["jointly erased early payloads and terminal metadata", initial, erasedNoise],
  [
    "raw refresh counts with false equality",
    state("!.refreshes = 1"),
    state("!.refreshes = 2"),
  ],
  [
    "non-HTTP read cookies",
    selectedSlot(1, "checked", "!.reads[1].cookie = 0"),
    selectedSlot(1, "checked", "!.reads[1].cookie = 2"),
  ],
  [
    "local failure and other gate strings",
    selectedSlot(
      1,
      "identity-returned",
      '!.reads[1].failure = "local", !.reads[1].gate = "failure"',
    ),
    selectedSlot(
      1,
      "identity-returned",
      '!.reads[1].failure = "", !.reads[1].gate = "none"',
    ),
  ],
  [
    "mutation raw mismatched cookie and observed values",
    state(
      `!.mutation = [${mutation} EXCEPT !.phase = "http", !.cookie = 0, !.observed = 0]`,
    ),
    state(
      `!.mutation = [${mutation} EXCEPT !.phase = "http", !.cookie = 2, !.observed = 2]`,
    ),
  ],
] as const)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native admin-vetting RAW/VIEW coalesces ${name}`,
    async () => {
      const fixture = nativeFixture({
        name,
        initial: seed,
        step: `s' = ${target}`,
        witness: "FALSE",
      });
      await expectComplete(fixture, false, 2);
      await expectComplete(fixture, true, 1);
    },
    120_000,
  );

for (const phase of [
  "unused",
  "done",
  "preflight",
  "checked",
  "http",
  "postflight",
  "failure",
  "identity-observed",
  "identity-returned",
  "callback-ready",
  "unknown",
])
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native admin-vetting ${phase} mutation retains all eight raw invariant combinations`,
    async () => {
      const seed = state(
        `!.accepted = TRUE, !.callbacks = 1, !.refreshes = 1, !.mutation = [${mutation} EXCEPT !.phase = "${phase}"]`,
      );
      const steps = [0, 1].flatMap((cookie) =>
        [0, 1].flatMap((observed) =>
          ["FALSE", "TRUE"].map(
            (admin) =>
              `s' = [s EXCEPT !.mutation.cookie = ${cookie}, !.mutation.observed = ${observed}, !.mutation.observedAdmin = ${admin}]`,
          ),
        ),
      );
      await expectComplete(
        nativeFixture({
          name: `${phase} raw mutation combinations`,
          initial: seed,
          step: steps.map((step) => `(${step})`).join(" \\/ "),
          witness: "FALSE",
        }),
        true,
        8,
      );
    },
    120_000,
  );

for (const id of [1, 2])
  for (const phase of ["identity-observed", "identity-returned"])
    test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
      `native admin-vetting read ${id}/${phase} keeps all 36 captured identity/failure/gate classes`,
      async () => {
        const seed = selectedSlot(
          id,
          phase,
          "!.admin = FALSE, !.cookie = 2, !.identityAvailable = FALSE",
        );
        const steps = [0, 1, 2].flatMap((observed) =>
          ["FALSE", "TRUE"].flatMap((admin) =>
            ["", "access"].flatMap((failure) =>
              ["preflight", "postflight", "other"].map(
                (gate) =>
                  `s' = [s EXCEPT !.reads[${id}].observed = ${observed}, !.reads[${id}].observedAdmin = ${admin}, !.reads[${id}].failure = "${failure}", !.reads[${id}].gate = "${gate}"]`,
              ),
            ),
          ),
        );
        await expectComplete(
          nativeFixture({
            name: "all live read snapshot classes",
            initial: seed,
            step: steps.map((step) => `(${step})`).join(" \\/ "),
            witness: "FALSE",
          }),
          true,
          36,
        );
      },
      120_000,
    );
for (const id of [1, 2])
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native admin-vetting HTTP read ${id} keeps both captured-cookie classes`,
    async () => {
      const seed = selectedSlot(
        id,
        "http",
        `!.cookie = 2, !.reads[${id}].cookie = 0`,
      );
      await expectComplete(
        nativeFixture({
          name: "HTTP captured read cookie",
          initial: seed,
          step: `(s' = [s EXCEPT !.reads[${id}].cookie = 0]) \\/ (s' = [s EXCEPT !.reads[${id}].cookie = 1])`,
          witness: "FALSE",
        }),
        true,
        2,
      );
    },
    120_000,
  );

for (const id of [1, 2])
  for (const phase of ["unused", "done"])
    for (const [visibility, changes] of [
      ["visible", "!.mounted = TRUE, !.present = TRUE"],
      ["departed", "!.mounted = FALSE, !.present = FALSE"],
      [
        "invalidated",
        "!.mounted = TRUE, !.present = TRUE, !.invalidated = TRUE",
      ],
    ] as const)
      test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
        `native admin-vetting selected ${id}/${phase}/${visibility} retains eight raw identity combinations`,
        async () => {
          const seed = selectedSlot(id, phase, changes);
          const steps = [1, 2].flatMap((actor) =>
            [1, 2].flatMap((life) =>
              [1, 2].map(
                (observed) =>
                  `s' = [s EXCEPT !.reads[${id}].actor = ${actor}, !.reads[${id}].life = ${life}, !.reads[${id}].observed = ${observed}]`,
              ),
            ),
          );
          await expectComplete(
            nativeFixture({
              name: "selected raw identity",
              initial: seed,
              step: steps.map((step) => `(${step})`).join(" \\/ "),
              witness: "FALSE",
            }),
            true,
            8,
          );
        },
        120_000,
      );

for (const [name, seed, change] of [
  ...["life", "generation", "actor"].map((field) => [
    `stale nonterminal read ${field}`,
    state(`!.reads[2] = [${read} EXCEPT !.phase = "unknown"]`),
    `!.reads[2].${field} = 2`,
  ]),
  ...["life", "ownerRead", "actor"].map((field) => [
    `stale nonterminal mutation ${field}`,
    state(`!.mutation = [${mutation} EXCEPT !.phase = "unknown"]`),
    `!.mutation.${field} = 2`,
  ]),
  ["callback count", initial, "!.callbacks = 1"],
  ["private index", initial, "!.privateRead = 2"],
  ["active index", initial, "!.activeRead = 2"],
  ["identity availability", initial, "!.identityAvailable = FALSE"],
  ["current cookie", initial, "!.cookie = 2"],
  ["current admin", initial, "!.admin = FALSE"],
])
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native admin-vetting retains exact ${name}`,
    async () => {
      await expectComplete(
        nativeFixture({
          name,
          initial: seed,
          step: `s' = [s EXCEPT ${change}]`,
          witness: "FALSE",
        }),
        true,
        2,
      );
    },
    120_000,
  );
