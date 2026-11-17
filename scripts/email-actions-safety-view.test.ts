/** Exact-source gates and native definitions for the email OPEN/CLOSED VIEW. */
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
    (v) => v.id === "email-actions-phase-carrier-safety-v1",
  );
if (!view) throw Error("Missing reviewed email-actions VIEW");
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
    "25c1c3d0f59066177b8aac797912fea84be0663efb5d29eab297ed9206b7ec48"
  )
    throw Error("Email phase consumers and closed carriers need review");
}
test("email VIEW binds the whole unchanged QNT, including scenarios", () => {
  reviewed(source);
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
});
for (const [name, before, after] of [
  [
    "a stored-value guard",
    "not(s.busy), s.request.attempt < 2,",
    "not(s.busy), s.stored == 1, s.request.attempt < 2,",
  ],
  [
    "an exact error-category retry",
    'or (s.actor == -1 and s.error != "none" and s.errorGeneration == s.generation),',
    'or (s.actor == -1 and s.error == "account-changed" and s.errorGeneration == s.generation),',
  ],
  [
    "non-none error without fresh generation",
    '.with("errorGeneration", if (ownsRequest) s.request.generation else s.errorGeneration)',
    '.with("errorGeneration", s.errorGeneration)',
  ],
  [
    "an unused check payload read",
    's.checks.get(id).phase == "unused",',
    's.checks.get(id).phase == "unused", s.checks.get(id).generation == s.generation,',
  ],
  [
    "a waiting observation consumer",
    's.checks.get(id).phase == "waiting",',
    's.checks.get(id).phase == "waiting", s.checks.get(id).observed == s.session,',
  ],
  [
    "done check payload reuse",
    'check.phase == "observed",',
    'Set("observed", "done").contains(check.phase),',
  ],
  [
    "cookie use after server reply",
    's.request.phase == "body",',
    's.request.phase == "body", s.request.cookie == s.request.actor,',
  ],
  [
    "loss of the preflight cookie overwrite",
    '.with("phase", "http").with("cookie", s.session)',
    '.with("phase", "http").with("cookie", s.request.cookie)',
  ],
  [
    "finally acquiring ownership gating",
    'action releaseBusy = all { s.request.phase == "finally",',
    'action releaseBusy = all { s.request.phase == "finally", ownsRequest,',
  ],
  [
    "restore reopening a closed loaded page",
    "s.present, not(s.loaded), kinds.contains(kind),",
    "s.present, kinds.contains(kind),",
  ],
  [
    "a third request attempt",
    "not(s.busy), s.request.attempt < 2,",
    "not(s.busy), s.request.attempt < 3,",
  ],
  [
    "departure past the closed generation cap",
    "action depart = all { s.present, s.generation < 4,",
    "action depart = all { s.present, s.generation <= 4,",
  ],
  [
    "retention changing another invariant carrier",
    '.with("stored", 2).with("storedActor", 0)',
    '.with("stored", 2).with("storedActor", 0).with("doneLink", 2)',
  ],
  [
    "a scrubbed-output consumer",
    "s.present, not(s.loaded), kinds.contains(kind),",
    "s.present, s.scrubbed, not(s.loaded), kinds.contains(kind),",
  ],
] as const)
  test(`future ${name} requires renewed whole-source review`, () => {
    const changed = replaceOnce(source, before, after);
    expect(() => reviewed(changed)).toThrow("need review");
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

test("temporal, property and projection changes cannot reuse the email-actions VIEW", () => {
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
  const directory = mkdtempSync(join(tmpdir(), "slop-email-actions-native-"));
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
    'if(result.isLeft()){if(result.value.isViolation){console.log("EMAIL_ACTIONS_VIEW_NAMED_WITNESS_FOUND");process.exitCode=1;}',
    'else{console.log("EMAIL_ACTIONS_VIEW_NATIVE_ERROR");process.exitCode=2;}}else console.log("EMAIL_ACTIONS_VIEW_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "email-actions-view-native-control",
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

const check =
  '[phase |-> "unused", generation |-> 1, link |-> 0, bound |-> 0, observed |-> 0, available |-> FALSE]';
const request =
  '[phase |-> "idle", attempt |-> 0, generation |-> 1, link |-> 0, kind |-> "verify", actor |-> 0, observed |-> 0, available |-> FALSE, cookie |-> 0, accepted |-> FALSE, cause |-> "none"]';
const initial =
  '[loaded |-> TRUE, present |-> TRUE, generation |-> 1, captures |-> 1, link |-> 1, kind |-> "verify", tokenValid |-> TRUE, actionActor |-> 0, actor |-> 1, session |-> 1, stored |-> 1, storedActor |-> 1, scrubbed |-> TRUE, done |-> FALSE, doneLink |-> 0, error |-> "none", errorGeneration |-> 0, busy |-> FALSE, activeCheck |-> 0, checks |-> [checkId \\in {1,2} |-> ' +
  check +
  "], request |-> " +
  request +
  ", effects |-> {}]";
const open = (changes: string) => `[${initial} EXCEPT ${changes}]`;
const closedBase = open(
  "!.present = FALSE, !.generation = 4, !.captures = 2, !.request = [" +
    request +
    ' EXCEPT !.phase = "done", !.attempt = 2, !.generation = 4, !.link = 1, !.actor = 1, !.cookie = 1, !.accepted = TRUE], !.checks = [closedCheckId \\in {1,2} |-> [' +
    check +
    ' EXCEPT !.phase = "done", !.generation = 4]], !.effects = {1}',
);
const closed = (changes: string) => `[${closedBase} EXCEPT ${changes}]`;
const isClosed =
  '(s.loaded /\\ s.generation >= 4 /\\ s.request.attempt >= 2 /\\ s.request.phase \\in {"idle", "done"} /\\ (\\A checkId \\in {1,2}: s.checks[checkId].phase = "done"))';
const authEq =
  '((s.request.accepted /\\ s.request.kind = "verify") => s.request.cookie = s.request.actor)';
const authPositive =
  '((s.request.accepted /\\ s.request.kind = "verify") => s.request.actor > 0)';
const storedBounds =
  "(s.stored >= 0 /\\ s.stored <= 2 /\\ s.storedActor >= 0 /\\ s.storedActor <= 2)";
const effects = "(s.effects \\subseteq {1,2})";
const errorGeneration =
  '((s.present /\\ s.link > 0 /\\ s.error # "none") => s.errorGeneration = s.generation)';
const doneEffect = "((s.done /\\ s.link > 0) => s.doneLink \\in s.effects)";
const observations = [
  [
    "generation-lower",
    "s.generation >= 1",
    "!.generation = 0",
    "!.generation = 4",
  ],
  [
    "generation-upper",
    "s.generation <= 4",
    "!.generation = 5",
    "!.generation = 4",
  ],
  ["captures-upper", "s.captures <= 2", "!.captures = 3", "!.captures = 2"],
  [
    "attempt-upper",
    "s.request.attempt <= 2",
    "!.request.attempt = 3",
    "!.request.attempt = 2",
  ],
  ["stored-lower", "s.stored >= 0", "!.stored = -1", "!.stored = 1"],
  ["stored-upper", "s.stored <= 2", "!.stored = 3", "!.stored = 1"],
  [
    "stored-actor-lower",
    "s.storedActor >= 0",
    "!.storedActor = -1",
    "!.storedActor = 1",
  ],
  [
    "stored-actor-upper",
    "s.storedActor <= 2",
    "!.storedActor = 3",
    "!.storedActor = 1",
  ],
  ["effects-domain", effects, "!.effects = {3}", "!.effects = {1}"],
  [
    "done-link-equality",
    "((s.done /\\ s.link > 0) => s.doneLink = s.link)",
    "!.done = TRUE, !.doneLink = 2, !.effects = {1,2}",
    "!.doneLink = 1",
  ],
  [
    "done-effect-membership",
    doneEffect,
    "!.done = TRUE, !.doneLink = 1, !.effects = {}",
    "!.effects = {1}",
  ],
  [
    "error-generation",
    errorGeneration,
    '!.present = TRUE, !.error = "account-changed", !.errorGeneration = 3',
    "!.errorGeneration = 4",
  ],
  [
    "done-busy",
    '(s.request.phase = "done" => ~s.busy)',
    "!.busy = TRUE",
    "!.busy = FALSE",
  ],
  [
    "verify-cookie-equality",
    authEq,
    "!.request.cookie = 2",
    "!.request.cookie = 1",
  ],
  [
    "verify-positive-actor",
    authPositive,
    "!.request.actor = 0, !.request.cookie = 0",
    "!.request.actor = 1, !.request.cookie = 1",
  ],
] as const;
const cases: NativeCase[] = [];
for (const [name, observation, corrupt, repair] of observations) {
  // A negative generation cannot satisfy the CLOSED predicate; that case
  // deliberately crosses the class boundary rather than inventing a false C.
  cases.push({
    name: `closed/raw-boundary ${name} false class`,
    initial: closedBase,
    step: `s' = [s EXCEPT ${corrupt}]`,
    witness: `~(${observation})`,
  });
  cases.push({
    name: `closed/raw-boundary false ${name} healing`,
    initial: closed(corrupt),
    step: `s' = [s EXCEPT ${repair}]`,
    witness: observation,
  });
}
for (const [name, observation, corrupt, repair] of observations.slice(4, 8)) {
  cases.push({
    name: `open ${name} false class`,
    initial,
    step: `s' = [s EXCEPT ${corrupt}]`,
    witness: `~(${observation})`,
  });
  cases.push({
    name: `open false ${name} healing`,
    initial: open(corrupt),
    step: `s' = [s EXCEPT ${repair}]`,
    witness: observation,
  });
}
cases.push(
  {
    name: "done check generation before another check starts",
    initial: open('!.checks[1].phase = "done"'),
    step: "IF s.checks[1].generation = 1 THEN s' = [s EXCEPT !.checks[1].generation = 2] ELSE startCheck(2)",
    witness: 's.checks[2].phase = "waiting"',
  },
  {
    name: "future generation recovers an observed check despite failed owns now",
    initial: open(
      "!.activeCheck = 1, !.checks[1] = [" +
        check +
        ' EXCEPT !.phase = "observed", !.generation = 2, !.link = 2, !.observed = 2, !.available = TRUE]',
    ),
    step: "IF s.generation = 1 THEN sessionEvent ELSE useCheck(1,TRUE)",
    witness: "s.actor = 2",
  },
  {
    name: "unused check reset of retained waiting captures",
    initial: open(
      "!.checks[1] = [" +
        check +
        " EXCEPT !.generation = 4, !.link = 2, !.bound = 2, !.observed = 2, !.available = TRUE]",
    ),
    step: "startCheck(1)",
    witness:
      's.checks[1].phase = "waiting" /\\ s.checks[1].generation = 1 /\\ s.checks[1].link = 1 /\\ s.checks[1].bound = 0',
  },
  {
    name: "non-none error generation stays live while its implication guard is false",
    initial: closed(
      '!.loaded = FALSE, !.present = TRUE, !.link = 0, !.error = "account-changed", !.errorGeneration = 4',
    ),
    step: 'IF s.errorGeneration = 4 THEN s\' = [s EXCEPT !.errorGeneration = 3] ELSE restore("verify",TRUE,0,TRUE,TRUE)',
    witness: `${isClosed} /\\ ~${errorGeneration}`,
  },
  {
    name: "preflight cookie overwrite exposes a new false authentication class",
    initial: open(
      "!.session = 2, !.request = [" +
        request +
        ' EXCEPT !.phase = "preflight-observed", !.attempt = 1, !.link = 1, !.actor = 1, !.observed = 1, !.available = TRUE, !.cookie = 1, !.accepted = TRUE]',
    ),
    step: "usePreflight",
    witness: `~${authEq}`,
  },
  {
    name: "preflight cookie overwrite heals false authentication",
    initial: open(
      "!.request = [" +
        request +
        ' EXCEPT !.phase = "preflight-observed", !.attempt = 1, !.link = 1, !.actor = 1, !.observed = 1, !.available = TRUE, !.cookie = 2, !.accepted = TRUE]',
    ),
    step: "usePreflight",
    witness: `s.request.phase = "http" /\\ ${authEq}`,
  },
  {
    name: "preflight retains accepted before the cookie overwrite",
    initial: open(
      "!.session = 2, !.request = [" +
        request +
        ' EXCEPT !.phase = "preflight-observed", !.attempt = 1, !.link = 1, !.actor = 1, !.observed = 1, !.available = TRUE, !.cookie = 1]',
    ),
    step: "IF ~s.request.accepted THEN s' = [s EXCEPT !.request.accepted = TRUE] ELSE usePreflight",
    witness: `~${authEq}`,
  },
  {
    name: "late departed server effect heals the exact done-link reference",
    initial: open(
      "!.present = FALSE, !.generation = 2, !.done = TRUE, !.doneLink = 1, !.request = [" +
        request +
        ' EXCEPT !.phase = "http", !.attempt = 1, !.link = 2, !.kind = "unsubscribe"]',
    ),
    step: "IF s.request.link = 2 THEN s' = [s EXCEPT !.request.link = 1] ELSE serverEffect(TRUE)",
    witness: doneEffect,
  },
  {
    name: "stale finally releases shared busy before a replacement submission",
    initial: open(
      '!.generation = 2, !.link = 2, !.kind = "unsubscribe", !.busy = TRUE, !.request = [' +
        request +
        ' EXCEPT !.phase = "finally", !.attempt = 1]',
    ),
    step: 'IF s.request.phase = "finally" THEN releaseBusy ELSE submit',
    witness: 's.busy /\\ s.request.phase = "http" /\\ s.request.link = 2',
  },
  {
    name: "terminal submit reset heals false auth without retaining dead payload",
    initial: open(
      '!.kind = "unsubscribe", !.request = [' +
        request +
        ' EXCEPT !.phase = "done", !.attempt = 1, !.actor = 0, !.cookie = 1, !.accepted = TRUE]',
    ),
    step: "submit",
    witness: `s.request.phase = "http" /\\ s.request.attempt = 2 /\\ ${authEq} /\\ ${authPositive}`,
  },
  {
    name: "future generation recovers an in-flight request despite failed owns now",
    initial: open(
      "!.request = [" +
        request +
        ' EXCEPT !.phase = "body", !.attempt = 1, !.generation = 2, !.link = 1, !.kind = "unsubscribe"], !.effects = {1}',
    ),
    step: "IF s.generation = 1 THEN sessionEvent ELSE body(TRUE,TRUE)",
    witness: "s.done",
  },
  {
    name: "preflight-observed availability is a live caller input",
    initial: open(
      "!.request = [" +
        request +
        ' EXCEPT !.phase = "preflight-observed", !.attempt = 1, !.link = 1, !.actor = 1, !.observed = 1]',
    ),
    step: "IF ~s.request.available THEN s' = [s EXCEPT !.request.available = TRUE] ELSE usePreflight",
    witness: 's.request.phase = "http"',
  },
  {
    name: "preflight-observed identity is a live caller input",
    initial: open(
      "!.request = [" +
        request +
        ' EXCEPT !.phase = "preflight-observed", !.attempt = 1, !.link = 1, !.actor = 1, !.available = TRUE]',
    ),
    step: "IF s.request.observed = 0 THEN s' = [s EXCEPT !.request.observed = 1] ELSE usePreflight",
    witness: 's.request.phase = "http"',
  },
  {
    name: "postflight-observed availability remains live",
    initial: open(
      "!.request = [" +
        request +
        ' EXCEPT !.phase = "postflight-observed", !.attempt = 1, !.link = 1, !.actor = 1, !.observed = 1], !.effects = {1}',
    ),
    step: "IF ~s.request.available THEN s' = [s EXCEPT !.request.available = TRUE] ELSE usePostflight(TRUE)",
    witness: "s.done",
  },
  {
    name: "postflight-observed identity remains live",
    initial: open(
      "!.request = [" +
        request +
        ' EXCEPT !.phase = "postflight-observed", !.attempt = 1, !.link = 1, !.actor = 1, !.available = TRUE], !.effects = {1}',
    ),
    step: "IF s.request.observed = 0 THEN s' = [s EXCEPT !.request.observed = 1] ELSE usePostflight(TRUE)",
    witness: "s.done",
  },
  {
    name: "HTTP captured cookie is consumed before a late effect",
    initial: open(
      "!.request = [" +
        request +
        ' EXCEPT !.phase = "http", !.attempt = 1, !.link = 1, !.actor = 1, !.cookie = 2]',
    ),
    step: "IF s.request.cookie = 2 THEN s' = [s EXCEPT !.request.cookie = 1] ELSE serverEffect(TRUE)",
    witness: "1 \\in s.effects",
  },
  {
    name: "HTTP captured actor remains distinct from the cookie",
    initial: open(
      "!.request = [" +
        request +
        ' EXCEPT !.phase = "http", !.attempt = 1, !.link = 1, !.actor = 2, !.cookie = 1]',
    ),
    step: "IF s.request.actor = 2 THEN s' = [s EXCEPT !.request.actor = 1] ELSE serverEffect(TRUE)",
    witness: "1 \\in s.effects",
  },
  {
    name: "HTTP kind retains the unsubscribe capability boundary",
    initial: open(
      "!.request = [" +
        request +
        ' EXCEPT !.phase = "http", !.attempt = 1, !.link = 1]',
    ),
    step: 'IF s.request.kind = "verify" THEN s\' = [s EXCEPT !.request.kind = "unsubscribe"] ELSE serverEffect(TRUE)',
    witness: "1 \\in s.effects",
  },
  {
    name: "catch cause none-class before generation-guarded publication",
    initial: open(
      "!.request = [" + request + ' EXCEPT !.phase = "catch", !.attempt = 1]',
    ),
    step: 'IF s.request.cause = "none" THEN s\' = [s EXCEPT !.request.cause = "account-changed"] ELSE handleCaught',
    witness: 's.error # "none"',
  },
  {
    name: "unknown request phase conservatively retains all payload",
    initial: open('!.request.phase = "future"'),
    step: "s' = [s EXCEPT !.request.cookie = 2]",
    witness: "s.request.cookie = 2",
  },
  {
    name: "unknown check phase conservatively retains all payload",
    initial: open('!.checks[1].phase = "future"'),
    step: "s' = [s EXCEPT !.checks[1].observed = 2]",
    witness: "s.checks[1].observed = 2",
  },
  {
    name: "closed present retains the other-view action guard",
    initial: closed("!.present = TRUE, !.stored = -1"),
    step: "IF s.present THEN s' = [s EXCEPT !.present = FALSE] ELSE retainFromOtherView",
    witness: storedBounds,
  },
  {
    name: "closed exact terminal request phase",
    initial: closed('!.request.phase = "idle"'),
    step: 's\' = [s EXCEPT !.request.phase = "done"]',
    witness: 's.request.phase = "done"',
  },
);
for (const [name, , corrupt] of observations.slice(4, 8))
  cases.push({
    name: `closed retention heals ${name} while auth/effects stay false`,
    initial: closed(
      corrupt + ", !.effects = {3}, !.request.actor = 0, !.request.cookie = 1",
    ),
    step: "retainFromOtherView",
    witness: `${storedBounds} /\\ ~${effects} /\\ ~${authEq} /\\ ~${authPositive}`,
  });
const staleAuth = "!.request.actor = 0, !.request.cookie = 1";
const entryCases: NativeCase[] = [
  {
    name: "restore enters closed with a false error-generation observation",
    initial: closed(
      '!.loaded = FALSE, !.present = TRUE, !.link = 0, !.error = "account-changed", !.errorGeneration = 3',
    ),
    step: 'restore("verify",TRUE,0,TRUE,TRUE)',
    witness: `${isClosed} /\\ ~${errorGeneration}`,
  },
  {
    name: "capture enters closed carrying a false auth observation",
    initial: closed(
      "!.present = TRUE, !.generation = 3, !.captures = 1, " + staleAuth,
    ),
    step: 'capture("unsubscribe",TRUE,TRUE)',
    witness: `${isClosed} /\\ ~${authEq}`,
  },
  {
    name: "session event enters closed carrying a false auth observation",
    initial: closed("!.present = TRUE, !.generation = 3, " + staleAuth),
    step: "sessionEvent",
    witness: `${isClosed} /\\ ~${authEq}`,
  },
  {
    name: "discard enters closed carrying a false auth observation",
    initial: closed("!.present = TRUE, !.generation = 3, " + staleAuth),
    step: "discard(TRUE)",
    witness: `${isClosed} /\\ ~${authEq}`,
  },
  {
    name: "depart enters closed carrying a false auth observation",
    initial: closed("!.present = TRUE, !.generation = 3, " + staleAuth),
    step: "depart",
    witness: `${isClosed} /\\ ~${authEq}`,
  },
  {
    name: "last check enters closed with newly false storage bounds",
    initial: closed(
      "!.present = TRUE, !.activeCheck = 2, !.checks[2] = [" +
        check +
        ' EXCEPT !.phase = "observed", !.generation = 4, !.link = 3, !.observed = 3, !.available = TRUE]',
    ),
    step: "useCheck(2,TRUE)",
    witness: `${isClosed} /\\ s.stored > 2 /\\ s.storedActor > 2`,
  },
  {
    name: "unscoped busy release enters closed carrying false auth",
    initial: closed('!.request.phase = "finally", !.busy = TRUE, ' + staleAuth),
    step: "releaseBusy",
    witness: `${isClosed} /\\ ~s.busy /\\ ~${authEq}`,
  },
];
cases.push(...entryCases);
for (const control of cases)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native email VIEW retains ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain("EMAIL_ACTIONS_VIEW_NAMED_WITNESS_FOUND");
      expect(result.output).toContain("State 2:");
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );
const coalescing: NativeCase[] = [
  {
    name: "open storage values with the same four raw bound bits",
    initial,
    step: "s' = [s EXCEPT !.stored = 2, !.storedActor = 2]",
    witness: "FALSE",
  },
  {
    name: "open error categories in the same non-none class",
    initial: open('!.error = "account-unavailable"'),
    step: 's\' = [s EXCEPT !.error = "account-changed"]',
    witness: "FALSE",
  },
  {
    name: "error generation only when error is none",
    initial,
    step: "s' = [s EXCEPT !.errorGeneration = 3]",
    witness: "FALSE",
  },
  {
    name: "write-only scrubbed output",
    initial,
    step: "s' = [s EXCEPT !.scrubbed = FALSE]",
    witness: "FALSE",
  },
  {
    name: "unused check payload before its complete reset",
    initial,
    step:
      "s' = [s EXCEPT !.checks[1] = [" +
      check +
      " EXCEPT !.generation = 4, !.link = 2, !.bound = 2, !.observed = 2, !.available = TRUE]]",
    witness: "FALSE",
  },
  {
    name: "waiting observation before its producer overwrites it",
    initial: open('!.checks[1].phase = "waiting"'),
    step: "s' = [s EXCEPT !.checks[1].observed = 2, !.checks[1].available = TRUE]",
    witness: "FALSE",
  },
  {
    name: "done check payload while exact generation remains",
    initial: open('!.checks[1].phase = "done"'),
    step: "s' = [s EXCEPT !.checks[1].link = 2, !.checks[1].bound = 2, !.checks[1].observed = 2, !.checks[1].available = TRUE]",
    witness: "FALSE",
  },
  {
    name: "catch dead payload and same non-none cause class",
    initial: open(
      "!.request = [" +
        request +
        ' EXCEPT !.phase = "catch", !.cause = "account-unavailable"]',
    ),
    step: 's\' = [s EXCEPT !.request.cookie = 2, !.request.observed = 2, !.request.available = TRUE, !.request.cause = "account-changed"]',
    witness: "FALSE",
  },
  {
    name: "live preflight dead inputs before their overwrite",
    initial: open('!.request.phase = "preflight"'),
    step: 's\' = [s EXCEPT !.request.cookie = 2, !.request.observed = 2, !.request.available = TRUE, !.request.cause = "request-unavailable"]',
    witness: "FALSE",
  },
  {
    name: "live body dead cookie and session inputs",
    initial: open('!.request.phase = "body"'),
    step: 's\' = [s EXCEPT !.request.cookie = 2, !.request.observed = 2, !.request.available = TRUE, !.request.cause = "request-unavailable"]',
    witness: "FALSE",
  },
  {
    name: "closed carriers with true raw observations",
    initial: closedBase,
    step: 's\' = [s EXCEPT !.session = 2, !.actor = 0, !.kind = "unsubscribe", !.tokenValid = FALSE, !.actionActor = 2, !.captures = 1, !.stored = 2, !.storedActor = 2, !.scrubbed = FALSE, !.doneLink = 2, !.error = "account-changed", !.errorGeneration = 3, !.activeCheck = 2, !.checks[1].generation = 1, !.request.generation = 1, !.request.link = 2, !.request.actor = 2, !.request.cookie = 2, !.effects = {2}]',
    witness: "FALSE",
  },
  {
    name: "closed carriers while independent raw observations stay false",
    initial: closed(
      "!.stored = -1, !.storedActor = 3, !.effects = {3}, !.request.actor = 0, !.request.cookie = 1",
    ),
    step: "s' = [s EXCEPT !.stored = -2, !.storedActor = 4, !.session = 2, !.effects = {4}, !.request.actor = -1, !.request.cookie = 2]",
    witness: "FALSE",
  },
];
for (const phase of ["idle", "done", "finally"])
  coalescing.push({
    name: `open ${phase} dead payload with raw auth preserved`,
    initial: open(
      "!.request = [" +
        request +
        ` EXCEPT !.phase = "${phase}", !.attempt = 1, !.actor = 1, !.cookie = 1, !.accepted = TRUE]`,
    ),
    step: 's\' = [s EXCEPT !.request.generation = 3, !.request.link = 2, !.request.kind = "verify", !.request.actor = 2, !.request.cookie = 2, !.request.observed = 2, !.request.available = TRUE, !.request.cause = "account-changed"]',
    witness: "FALSE",
  });
function terminalStateCounts(output: string) {
  const results = [
    ...output.matchAll(
      /^(\d+) states? generated, (\d+) distinct states? found, (\d+) states? left on queue\.\r?$/gmu,
    ),
  ];
  const terminal = results.at(-1);
  if (!terminal) throw new Error("Missing terminal TLC state counts");
  return {
    generated: Number(terminal[1]),
    distinct: Number(terminal[2]),
    queued: Number(terminal[3]),
  };
}
test("email action pair counts use the final complete TLC line", () => {
  const progress =
    "Progress(1): 1 states generated, 1 distinct states found, 1 states left on queue.";
  const early =
    "1 states generated, 1 distinct states found, 0 states left on queue.";
  const final =
    "3 states generated, 2 distinct states found, 0 states left on queue.";
  expect(terminalStateCounts(`${progress}\n${early}\n${final}\n`)).toEqual({
    generated: 3,
    distinct: 2,
    queued: 0,
  });
  expect(
    terminalStateCounts(
      `${final}\n1 states generated, 1 distinct states found, 4 states left on queue.\n`,
    ),
  ).toEqual({ generated: 1, distinct: 1, queued: 4 });
  expect(() => terminalStateCounts(progress)).toThrow("Missing terminal");
  expect(() =>
    terminalStateCounts("2 distinct states found\n0 states left on queue"),
  ).toThrow("Missing terminal");
});

for (const control of coalescing)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native email VIEW coalesces only ${control.name}`,
    async () => {
      const fixture = nativeFixture(control);
      for (const [useView, count] of [
        [false, 2],
        [true, 1],
      ] as const) {
        const result = await runNative(fixture, useView);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("EMAIL_ACTIONS_VIEW_NATIVE_COMPLETE");
        expect(terminalStateCounts(result.output)).toMatchObject({
          distinct: count,
          queued: 0,
        });
      }
    },
    120_000,
  );
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native no-VIEW future storage guard exposes hidden-value drift",
  async () => {
    const result = await runNative(
      nativeFixture({
        name: "future stored-value consumer",
        initial,
        step: "IF s.stored = 1 THEN s' = [s EXCEPT !.stored = 2] ELSE s' = [s EXCEPT !.busy = TRUE]",
        witness: "s.busy",
      }),
      false,
    );
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("EMAIL_ACTIONS_VIEW_NAMED_WITNESS_FOUND");
    expect(result.output).toContain("State 2:");
    expect(result.output).not.toContain("violated by the initial state");
    expect(result.output).not.toContain("No error has been found");
  },
  120_000,
);
