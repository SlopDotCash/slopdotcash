/** Exact-source gates and native definitions; execution requires the native flag. */
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
  view = manifest.views.find(
    (v) => v.id === "points-disputes-phase-observation-safety-v1",
  );
if (!view) throw Error("Missing reviewed points-disputes VIEW");
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
    "315fb521122256a03108c3d87da4382f613080a78fadba32c1626bbaffd96a93"
  )
    throw Error(
      "Points-disputes phase consumers need renewed whole-source review",
    );
}
test("points-disputes VIEW binds every unchanged action, domain, invariant and scenario", () => {
  reviewed(source);
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
});
for (const [name, before, after] of [
  [
    "notification count consumer",
    "action parentLoads=all{s.mounted,",
    "action parentLoads=all{s.mounted,s.parentNotifications==0,",
  ],
  [
    "error category consumer",
    'visible,s.error!="none",',
    'visible,s.error=="identity",',
  ],
  [
    "request kind consumer",
    'all{request.phase=="session-returned",',
    'all{request.phase=="session-returned",request.kind=="read",',
  ],
  [
    "unused request payload guard",
    's.reads.get(id).phase=="unused",',
    's.reads.get(id).phase=="unused",s.reads.get(id).actor==s.actor,',
  ],
  [
    "partial request reset",
    '{epoch:s.epoch,actor:s.actor,target:s.selected,kind:"read",phase:"pending"}',
    '{epoch:s.reads.get(id).epoch,actor:s.actor,target:s.selected,kind:"read",phase:"pending"}',
  ],
  [
    "observation before overwrite",
    'request.phase=="pending",\n      s\'=if(owns(request)',
    'request.phase=="pending",s.readObservations.get(id).outcome==0,\n      s\'=if(owns(request)',
  ],
  [
    "stored success outcome distinction",
    'else if(outcome==0)finished.with("busy",false).with("error","request")',
    'else if(outcome==2)finished.with("busy",false).with("error","request")',
  ],
  [
    "raw observed actor consumer",
    "val changedIdentity=outcome!=3 and observation.actor!=request.actor",
    "val changedIdentity=outcome!=3 and observation.actor==2",
  ],
  [
    "done callback reuse",
    'request.phase=="session-returned",',
    'Set("session-returned","done").contains(request.phase),',
  ],
  [
    "dead decider consumer",
    '.with("mayDecide",payload==2 and decider)',
    '.with("mayDecide",decider)',
  ],
] as const)
  test(`future ${name} refuses the old complete-source pin`, () => {
    // Several identical source guards intentionally exist. Mutate one occurrence;
    // the complete-source pin protects every occurrence, without a syntax claim.
    expect(source).toContain(before);
    const changed = source.replace(before, after);
    expect(() => reviewed(changed)).toThrow("renewed whole-source review");
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

test("temporal, property and projection changes cannot reuse the points-disputes VIEW", () => {
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
    { ...binding, clauses: [{ name: "unreviewed", expression: "FALSE" }] },
    { ...binding, operator: "UnreviewedEmailActionsView" },
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
  const directory = mkdtempSync(join(tmpdir(), "slop-points-disputes-native-"));
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
    `const view=${JSON.stringify(binding)};`,
    "const config={moduleName:view.module,tlaCode:" +
      JSON.stringify(tla) +
      ",hasInvariant:true,hasTemporal:false};",
    "const prepared=" +
      (useView ? "applySafetyView(view,config)" : "config") +
      ";",
    'const runner=loadSafetyViewTlc(require.resolve("@informalsystems/quint/dist/src/tlc.js"),manifest);',
    'const result=await runner.verify(prepared,"0.62.4",JSON.parse(readFileSync("formal/tlc.json","utf8")),3);',
    'if(result.isLeft()){if(result.value.isViolation){console.log("POINTS_DISPUTES_VIEW_NAMED_WITNESS_FOUND");process.exitCode=1;}',
    'else{console.log("POINTS_DISPUTES_VIEW_NATIVE_ERROR");process.exitCode=2;}}else console.log("POINTS_DISPUTES_VIEW_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "points-disputes-view-native-control",
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
  '[epoch |-> 0, actor |-> 0, target |-> 0, kind |-> "none", phase |-> "unused"]';
const observation =
  "[outcome |-> 0, payload |-> 1, draft |-> FALSE, decider |-> FALSE, actor |-> 0, refused |-> FALSE]";
const initial =
  '[mounted |-> TRUE, epoch |-> 1, actor |-> 1, cookie |-> 1, parent |-> "ready", url |-> 0, keyTarget |-> 0, selected |-> 0, cursor |-> 0, page |-> 0, nextPage |-> FALSE, detail |-> 0, detailId |-> 0, privateOwner |-> 0, draft |-> FALSE, mayDecide |-> FALSE, award |-> 0, reason |-> FALSE, decision |-> FALSE, busy |-> FALSE, error |-> "none", reload |-> TRUE, activeRead |-> 0, reads |-> [i \\in {1,2} |-> ' +
  request +
  "], mutations |-> [i \\in {1,2} |-> " +
  request +
  "], accepted |-> {}, parentNotifications |-> 0, readObservations |-> [i \\in {1,2} |-> " +
  observation +
  "], mutationObservations |-> [i \\in {1,2} |-> " +
  observation +
  "]]";
const state = (changes: string) => `[${initial} EXCEPT ${changes}]`;
const readAt = (phase: string, target = 1) =>
  state(
    `!.reads[1] = [${request} EXCEPT !.phase = "${phase}", !.epoch = 1, !.actor = 1, !.target = ${target}], !.activeRead = 1, !.readObservations[1].outcome = 1, !.readObservations[1].actor = 1`,
  );
const mutateAt = (phase: string) =>
  state(
    `!.mutations[1] = [${request} EXCEPT !.phase = "${phase}", !.epoch = 1, !.actor = 1, !.target = 2], !.mutationObservations[1].outcome = 1, !.mutationObservations[1].actor = 1`,
  );
const change = (base: string, update: string) => `[${base} EXCEPT ${update}]`;
const controls: NativeCase[] = [];
for (const [name, update, witness] of [
  ["epoch lower", "!.epoch = 0", "s.epoch < 1"],
  ["epoch upper", "!.epoch = 3", "s.epoch > 2"],
  ["cursor lower", "!.cursor = -1", "s.cursor < 0"],
  ["cursor upper", "!.cursor = 2", "s.cursor > 1"],
  ["page lower", "!.page = -1", "s.page < 0"],
  ["page upper", "!.page = 3", "s.page > 2"],
  ["detail lower", "!.detail = -1", "s.detail < 0"],
  ["detail upper", "!.detail = 4", "s.detail > 3"],
  ["accepted subset", "!.accepted = {3}", "~(s.accepted \\subseteq {1,2})"],
  ["decision ownership", "!.mayDecide = TRUE", "s.mayDecide /\\ s.detail # 2"],
  [
    "private payload ownership",
    "!.page = 1",
    "s.page > 0 /\\ s.privateOwner # s.actor",
  ],
] as const)
  controls.push({
    name: `raw invariant ${name}`,
    initial,
    step: `s' = [s EXCEPT ${update}]`,
    witness,
  });
for (const [name, base, update, witness] of [
  [
    "live request epoch",
    readAt("session-returned"),
    "!.reads[1].epoch = 2",
    "s.reads[1].epoch = 2",
  ],
  [
    "live request actor",
    readAt("session-returned"),
    "!.reads[1].actor = 2",
    "s.reads[1].actor = 2",
  ],
  [
    "live request target",
    readAt("session-returned"),
    "!.reads[1].target = 2",
    "s.reads[1].target = 2",
  ],
  [
    "read transport outcome",
    readAt("session-returned"),
    "!.readObservations[1].outcome = 0",
    "s.readObservations[1].outcome = 0",
  ],
  [
    "read unavailable outcome",
    readAt("session-observed"),
    "!.readObservations[1].outcome = 3",
    "s.readObservations[1].outcome = 3",
  ],
  [
    "read refusal",
    readAt("session-returned"),
    "!.readObservations[1].refused = TRUE",
    "s.readObservations[1].refused",
  ],
  [
    "read actor mismatch",
    readAt("session-returned"),
    "!.readObservations[1].actor = 2",
    "s.readObservations[1].actor # s.reads[1].actor",
  ],
  [
    "detail payload bounds",
    readAt("session-returned"),
    "!.readObservations[1].payload = 4",
    "s.readObservations[1].payload = 4",
  ],
  [
    "detail draft",
    readAt("session-returned"),
    "!.readObservations[1].draft = TRUE",
    "s.readObservations[1].draft",
  ],
  [
    "detail decider",
    change(readAt("session-returned"), "!.readObservations[1].payload = 2"),
    "!.readObservations[1].decider = TRUE",
    "s.readObservations[1].decider",
  ],
  [
    "list payload branch",
    readAt("session-returned", 0),
    "!.readObservations[1].payload = 2",
    "s.readObservations[1].payload # 1",
  ],
  [
    "mutation actor mismatch",
    mutateAt("session-returned"),
    "!.mutationObservations[1].actor = 2",
    "s.mutationObservations[1].actor # s.mutations[1].actor",
  ],
  [
    "mutation refusal",
    mutateAt("session-observed"),
    "!.mutationObservations[1].refused = TRUE",
    "s.mutationObservations[1].refused",
  ],
  [
    "mutation unavailable",
    mutateAt("session-returned"),
    "!.mutationObservations[1].outcome = 3",
    "s.mutationObservations[1].outcome = 3",
  ],
  [
    "unknown phase observation",
    readAt("future"),
    "!.readObservations[1].payload = 4",
    "s.readObservations[1].payload = 4",
  ],
  [
    "error none distinction",
    initial,
    '!.error = "request"',
    's.error # "none"',
  ],
] as const)
  controls.push({
    name,
    initial: base,
    step: `s' = [s EXCEPT ${update}]`,
    witness,
  });
controls.push(
  {
    name: "actual detail result preserves invalid payload",
    initial: change(
      readAt("session-returned"),
      "!.readObservations[1].payload = 4",
    ),
    step: "useRead(1)",
    witness: 's.reads[1].phase = "done" /\\ s.detail = 4 /\\ ~invariant',
  },
  {
    name: "actual unavailable read keeps URL despite actor mismatch",
    initial: change(
      readAt("session-returned"),
      "!.url = 2, !.readObservations[1].outcome = 3, !.readObservations[1].actor = 2",
    ),
    step: "useRead(1)",
    witness:
      's.reads[1].phase = "done" /\\ s.parent = "loading" /\\ s.url = 2 /\\ s.error = "identity"',
  },
  {
    name: "actual changed actor read clears URL",
    initial: change(
      readAt("session-returned"),
      "!.url = 2, !.readObservations[1].actor = 2",
    ),
    step: "useRead(1)",
    witness:
      's.reads[1].phase = "done" /\\ s.parent = "loading" /\\ s.url = 0 /\\ s.error = "identity"',
  },
  {
    name: "actual refusal cannot become a detail payload",
    initial: change(
      readAt("session-returned"),
      "!.readObservations[1].refused = TRUE, !.readObservations[1].payload = 2, !.readObservations[1].decider = TRUE",
    ),
    step: "useRead(1)",
    witness:
      's.reads[1].phase = "done" /\\ s.detail = 0 /\\ ~s.mayDecide /\\ s.error = "identity"',
  },
  {
    name: "actual matching read produces private detail",
    initial: change(
      readAt("session-returned"),
      "!.readObservations[1].payload = 2, !.readObservations[1].decider = TRUE",
    ),
    step: "useRead(1)",
    witness:
      's.reads[1].phase = "done" /\\ s.detail = 2 /\\ s.mayDecide /\\ s.privateOwner = 1 /\\ invariant',
  },
  {
    name: "actual list result ignores detail controls",
    initial: change(
      readAt("session-returned", 0),
      "!.readObservations[1].payload = 3, !.readObservations[1].decider = TRUE, !.readObservations[1].draft = TRUE",
    ),
    step: "useRead(1)",
    witness:
      's.reads[1].phase = "done" /\\ s.page = 2 /\\ s.nextPage /\\ s.detail = 0 /\\ ~s.mayDecide /\\ invariant',
  },
  {
    name: "actual live actor can heal ownership on remount",
    initial: change(
      mutateAt("session-returned"),
      "!.mutations[1].epoch = 2, !.mutations[1].actor = 2, !.mutationObservations[1].actor = 2",
    ),
    step: "IF s.epoch = 1 THEN remount(2,1) ELSE useMutation(1)",
    witness:
      's.mutations[1].phase = "done" /\\ s.actor = 2 /\\ s.selected = 2 /\\ s.url = 2 /\\ invariant',
  },
  {
    name: "actual dirty unused request fully resets before observation",
    initial: state(
      "!.reads[1].epoch = 8, !.reads[1].actor = 7, !.reads[1].target = 9, !.readObservations[1].outcome = 3, !.readObservations[1].refused = TRUE",
    ),
    step: 'IF s.reads[1].phase = "unused" THEN startRead(1) ELSE observeRead(1,1,2,FALSE,TRUE)',
    witness:
      's.reads[1].phase = "session-observed" /\\ s.reads[1].epoch = 1 /\\ s.reads[1].actor = 1 /\\ s.reads[1].target = 0 /\\ ~s.readObservations[1].refused',
  },
  {
    name: "actual accepted mutation loads its exact destination",
    initial: mutateAt("session-returned"),
    step: "useMutation(1)",
    witness:
      's.mutations[1].phase = "done" /\\ s.selected = 2 /\\ s.url = 2 /\\ s.reload /\\ s.parent = "loading"',
  },
  {
    name: "actual superseded read cannot rewrite current state",
    initial: change(
      readAt("session-returned"),
      "!.activeRead = 2, !.busy = TRUE",
    ),
    step: "useRead(1)",
    witness:
      's.reads[1].phase = "done" /\\ s.detail = 0 /\\ s.activeRead = 2 /\\ s.busy',
  },
  {
    name: "actual transport failure permits explicit retry",
    initial: change(
      readAt("session-returned"),
      "!.reload = FALSE, !.readObservations[1].outcome = 0",
    ),
    step: 'IF s.reads[1].phase = "session-returned" THEN useRead(1) ELSE retryRead',
    witness: 's.reads[1].phase = "done" /\\ s.error = "request" /\\ s.reload',
  },
  {
    name: "actual refused mutation retains unavailable URL rule",
    initial: change(
      mutateAt("session-returned"),
      "!.url = 2, !.mutationObservations[1].outcome = 3, !.mutationObservations[1].refused = TRUE, !.mutationObservations[1].actor = 2",
    ),
    step: "useMutation(1)",
    witness:
      's.mutations[1].phase = "done" /\\ s.error = "identity" /\\ s.parent = "loading" /\\ s.url = 2',
  },
  {
    name: "actual stale read cannot mutate newer lifetime",
    initial: change(
      readAt("session-returned"),
      "!.epoch = 2, !.actor = 2, !.url = 2, !.activeRead = 2",
    ),
    step: "useRead(1)",
    witness:
      's.reads[1].phase = "done" /\\ s.detail = 0 /\\ s.url = 2 /\\ s.activeRead = 2',
  },
);
for (const control of controls)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native points VIEW preserves ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain(
        "POINTS_DISPUTES_VIEW_NAMED_WITNESS_FOUND",
      );
      expect(result.output).toContain("State 2:");
      if (
        control.name === "actual live actor can heal ownership on remount" ||
        control.name === "actual transport failure permits explicit retry" ||
        control.name ===
          "actual dirty unused request fully resets before observation"
      )
        expect(result.output).toContain("State 3:");
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );
const pairs: NativeCase[] = [
  {
    name: "notification and non-none error category",
    initial: state('!.error = "request"'),
    step: 's\' = [s EXCEPT !.parentNotifications = 7, !.error = "identity"]',
    witness: "FALSE",
  },
  {
    name: "unused request payload and stale observations",
    initial,
    step: "s' = [s EXCEPT !.reads[1].epoch = 7, !.reads[1].actor = 4, !.reads[1].target = 3, !.mutations[1].epoch = 8, !.readObservations[1].payload = 99, !.mutationObservations[1].refused = TRUE]",
    witness: "FALSE",
  },
  {
    name: "done requests and stale observations",
    initial: state('!.reads[1].phase = "done", !.mutations[1].phase = "done"'),
    step: "s' = [s EXCEPT !.reads[1].actor = 4, !.reads[1].target = 3, !.mutations[1].epoch = 8, !.readObservations[1].payload = 99, !.mutationObservations[1].refused = TRUE]",
    witness: "FALSE",
  },
  {
    name: "pre-observation dead values",
    initial: readAt("pending"),
    step: "s' = [s EXCEPT !.readObservations[1].payload = 99, !.readObservations[1].outcome = 3, !.readObservations[1].refused = TRUE]",
    witness: "FALSE",
  },
  {
    name: "live request write-only kind",
    initial: readAt("session-returned"),
    step: 's\' = [s EXCEPT !.reads[1].kind = "future"]',
    witness: "FALSE",
  },
  {
    name: "read accepted outcome class",
    initial: readAt("session-returned"),
    step: "s' = [s EXCEPT !.readObservations[1].outcome = 2]",
    witness: "FALSE",
  },
  {
    name: "mutation accepted outcome and dead payload",
    initial: mutateAt("session-returned"),
    step: "s' = [s EXCEPT !.mutationObservations[1].outcome = 2, !.mutationObservations[1].payload = 9, !.mutationObservations[1].draft = TRUE, !.mutationObservations[1].decider = TRUE]",
    witness: "FALSE",
  },
  {
    name: "invalid read dead payload",
    initial: change(
      readAt("session-returned"),
      "!.readObservations[1].refused = TRUE",
    ),
    step: "s' = [s EXCEPT !.readObservations[1].payload = 99, !.readObservations[1].draft = TRUE, !.readObservations[1].decider = TRUE]",
    witness: "FALSE",
  },
  {
    name: "transport read dead payload",
    initial: change(
      readAt("session-returned"),
      "!.readObservations[1].outcome = 0",
    ),
    step: "s' = [s EXCEPT !.readObservations[1].payload = 99, !.readObservations[1].draft = TRUE, !.readObservations[1].decider = TRUE]",
    witness: "FALSE",
  },
  {
    name: "nonmatching observed actor class",
    initial: change(
      readAt("session-returned"),
      "!.readObservations[1].actor = 4",
    ),
    step: "s' = [s EXCEPT !.readObservations[1].actor = 5]",
    witness: "FALSE",
  },
  {
    name: "list payload other class and dead detail flags",
    initial: change(
      readAt("session-returned", 0),
      "!.readObservations[1].payload = 2",
    ),
    step: "s' = [s EXCEPT !.readObservations[1].payload = 3, !.readObservations[1].draft = TRUE, !.readObservations[1].decider = TRUE]",
    witness: "FALSE",
  },
  {
    name: "non-decision detail dead decider",
    initial: readAt("session-returned"),
    step: "s' = [s EXCEPT !.readObservations[1].decider = TRUE]",
    witness: "FALSE",
  },
];
for (const control of pairs)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native points VIEW coalesces only ${control.name}`,
    async () => {
      const fixture = nativeFixture(control);
      for (const [useView, count] of [
        [false, 2],
        [true, 1],
      ] as const) {
        const result = await runNative(fixture, useView);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("POINTS_DISPUTES_VIEW_NATIVE_COMPLETE");
        expect(slopTlcTerminalCounts(result.output)).toEqual({
          distinct: count,
          queued: 0,
        });
      }
    },
    120_000,
  );
// Two concrete input representatives cross the unchanged real callback. Both
// outputs must close, with equal projected successor classes (RAW4 / VIEW2).
const boundaryPairs: Array<{
  name: string;
  left: string;
  right: string;
  step: string;
}> = [
  {
    name: "read success outcome branch",
    left: readAt("session-returned"),
    right: change(
      readAt("session-returned"),
      "!.readObservations[1].outcome = 2",
    ),
    step: "useRead(1)",
  },
  {
    name: "refused read dead payload",
    left: change(
      readAt("session-returned"),
      "!.readObservations[1].refused = TRUE",
    ),
    right: change(
      readAt("session-returned"),
      "!.readObservations[1].refused = TRUE, !.readObservations[1].payload = 4, !.readObservations[1].draft = TRUE, !.readObservations[1].decider = TRUE",
    ),
    step: "useRead(1)",
  },
  {
    name: "list payload other branch",
    left: change(
      readAt("session-returned", 0),
      "!.readObservations[1].payload = 2",
    ),
    right: change(
      readAt("session-returned", 0),
      "!.readObservations[1].payload = 3, !.readObservations[1].draft = TRUE",
    ),
    step: "useRead(1)",
  },
  {
    name: "mutation success outcome branch",
    left: mutateAt("session-returned"),
    right: change(
      mutateAt("session-returned"),
      "!.mutationObservations[1].outcome = 2",
    ),
    step: "useMutation(1)",
  },
  {
    name: "observed actor mismatch branch",
    left: change(readAt("session-returned"), "!.readObservations[1].actor = 4"),
    right: change(
      readAt("session-returned"),
      "!.readObservations[1].actor = 5",
    ),
    step: "useRead(1)",
  },
  {
    name: "request kind callback boundary",
    left: readAt("session-returned"),
    right: change(readAt("session-returned"), '!.reads[1].kind = "future"'),
    step: "useRead(1)",
  },
  {
    name: "unused complete request reset",
    left: state("!.reads[1].actor = 4, !.readObservations[1].payload = 9"),
    right: state("!.reads[1].actor = 5, !.readObservations[1].payload = 8"),
    step: "startRead(1)",
  },
];
for (const control of boundaryPairs)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native actual points callback commutes for ${control.name}`,
    async () => {
      const fixture = replaceOnce(
        nativeFixture({
          name: control.name,
          initial: `{${control.left},${control.right}}`,
          step: control.step,
          witness: "FALSE",
        }),
        "q_init == s = SlopControlInitial",
        "q_init == s \\in SlopControlInitial",
      );
      for (const [useView, count] of [
        [false, 4],
        [true, 2],
      ] as const) {
        const result = await runNative(fixture, useView);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("POINTS_DISPUTES_VIEW_NATIVE_COMPLETE");
        expect(slopTlcTerminalCounts(result.output)).toEqual({
          distinct: count,
          queued: 0,
        });
      }
    },
    120_000,
  );
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native no-VIEW future request-kind consumer is observable",
  async () => {
    const result = await runNative(
      nativeFixture({
        name: "new kind consumer",
        initial: readAt("session-returned"),
        step: 'IF s.reads[1].kind = "none" THEN s\' = [s EXCEPT !.reads[1].kind = "future"] ELSE useRead(1)',
        witness: 's.reads[1].phase = "done" /\\ s.detail = 1',
      }),
      false,
    );
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("POINTS_DISPUTES_VIEW_NAMED_WITNESS_FOUND");
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
