/** Exact-source controls for the contributor-allocation safety VIEW. */
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
  (entry) => entry.id === "ui-contributor-allocation-safety-v1",
);
if (!view)
  throw new Error("Missing reviewed contributor-allocation safety VIEW");
const selected: SafetyViewDefinition = view;
const source = readFileSync(join(root, selected.model), "utf8");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function checkReviewedBoundary(model: string) {
  const start = model.indexOf("module ui_contributor_allocation {");
  const end = model.indexOf("  action loadPublished(", start);
  if (
    start < 0 ||
    end < start ||
    digest(model.slice(start, end)) !==
      "3ef015fb30127e6f24c7289b7d5f46c21f496588894188fb83065959ac51673c"
  )
    throw new Error(
      "Contributor wallet reads, request reuse and invariant observations need review",
    );
}
function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2)
    throw new Error(`Expected one audited source boundary: ${from}`);
  return text.replace(from, to);
}
test("contributor VIEW binds every audited transition, initializer, domain and invariant", () => {
  checkReviewedBoundary(source);
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
  expect(digest(source)).toBe(
    "767f463c4c1243d01ac4e0ca77316869af0c5e9441d1d96d911c27fdf077ad59",
  );
});
for (const [name, before, after] of [
  [
    "a future late-wallet read",
    "s.mounted, actors.contains(actor),",
    's.mounted, actors.contains(actor), s.wallets.get(1).contains("late"),',
  ],
  [
    "a future whole-wallet-set read",
    "s.mounted, actors.contains(actor),",
    's.mounted, actors.contains(actor), s.wallets.get(2) == Set("none"),',
  ],
  [
    "a dead unused-request payload",
    's.requests.get(id).phase == "unused",',
    's.requests.get(id).phase == "unused", s.requests.get(id).life == 0,',
  ],
  [
    "a done-request continuation",
    's.requests.get(id).phase == "unused",',
    'Set("unused", "done").contains(s.requests.get(id).phase),',
  ],
  [
    "a cross-slot consumed snapshot read",
    "s.mounted, actors.contains(actor),",
    "s.mounted, actors.contains(actor), s.requests.get(1).recipients == 0,",
  ],
  [
    "a new wallet-class invariant",
    "val invariant = all { s.life >= 1,",
    'val invariant = all { s.wallets.get(1).contains("late"), s.life >= 1,',
  ],
] as const) {
  test(`source drift through ${name} requires renewed review`, () => {
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

test("temporal, property and projection changes cannot reuse the contributor VIEW", () => {
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
    {
      ...binding,
      clauses: [{ name: "unreviewedObservation", expression: "FALSE" }],
    },
    { ...binding, operator: "UnreviewedContributorView" },
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
    join(tmpdir(), "slop-contributor-view-native-"),
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
  '[phase |-> "unused", life |-> 0, outcome |-> "none", recipients |-> 0, transfers |-> 0, closed |-> FALSE]';
const initial =
  '[mounted |-> TRUE, life |-> 1, actor |-> 1, active |-> 0, loadScheduled |-> TRUE, document |-> "loading", error |-> FALSE, recipients |-> 0, transfers |-> 0, closed |-> FALSE, wallets |-> [i \\in {1,2} |-> {"none"}], nowExpired |-> FALSE, renderedExpired |-> FALSE, boundaryInstalled |-> FALSE, boundaryArmed |-> FALSE, publishedBy |-> 0, publishedLife |-> 0, requests |-> [i \\in {1,2} |-> ' +
  request +
  "]]";
const state = (changes: string) => `[${initial} EXCEPT ${changes}]`;
const published =
  '!.document = "published", !.recipients = 3, !.publishedBy = 1, !.publishedLife = 1';
const decoded =
  '!.loadScheduled = FALSE, !.active = 1, !.requests[1] = [phase |-> "decoded", life |-> 1, outcome |-> "valid", recipients |-> 1, transfers |-> 0, closed |-> FALSE]';
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
    'if(result.isLeft()){if(result.value.isViolation){console.log("CONTRIBUTOR_VIEW_NAMED_WITNESS_FOUND");process.exitCode=1;}',
    'else{console.log("CONTRIBUTOR_VIEW_NATIVE_ERROR");process.exitCode=2;}}else console.log("CONTRIBUTOR_VIEW_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "contributor-allocation-view-native-control",
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
    name: "the lifetime lower-bound false class",
    initial,
    step: "s' = [s EXCEPT !.life = 0]",
    witness: "s.life < 1",
  },
  {
    name: "the lifetime upper-bound false class",
    initial,
    step: "s' = [s EXCEPT !.life = 3]",
    witness: "s.life > 2",
  },
  {
    name: "the actor-domain false class",
    initial,
    step: "s' = [s EXCEPT !.actor = -1]",
    witness: "s.actor \\notin {0,1,2}",
  },
  {
    name: "the recipient-mask false class",
    initial,
    step: "s' = [s EXCEPT !.recipients = 4]",
    witness: "s.recipients \\notin {0,1,2,3}",
  },
  {
    name: "the transfer-mask false class",
    initial,
    step: "s' = [s EXCEPT !.transfers = 4]",
    witness: "s.transfers \\notin {0,1,2,3}",
  },
  {
    name: "the transfer-subset false class",
    initial: state("!.recipients = 1"),
    step: "s' = [s EXCEPT !.transfers = 2]",
    witness: "~subset(s.transfers,s.recipients)",
  },
  {
    name: "the publication-lifetime false class",
    initial: state(published),
    step: "s' = [s EXCEPT !.publishedLife = 2]",
    witness: 's.document = "published" /\\ s.publishedLife # s.life',
  },
  {
    name: "the publication-identity false class",
    initial: state(published),
    step: "s' = [s EXCEPT !.publishedBy = 0]",
    witness: 's.document = "published" /\\ s.publishedBy = 0',
  },
  {
    name: "account-one membership becoming true",
    initial: state(published),
    step: 'walletsChange(1,"on-time","none")',
    witness:
      'eligibleWallet /\\ state = "scheduled" /\\ "on-time" \\notin s.wallets[2]',
  },
  {
    name: "account-two membership becoming true",
    initial: state(published + ", !.actor = 2"),
    step: 'walletsChange(2,"wrong-chain","on-time")',
    witness:
      'eligibleWallet /\\ state = "scheduled" /\\ "on-time" \\notin s.wallets[1]',
  },
  {
    name: "account-one membership becoming false",
    initial: state(
      published + ', !.wallets[1] = {"on-time"}, !.wallets[2] = {"on-time"}',
    ),
    step: 'walletsChange(1,"wrong-chain","late")',
    witness:
      '~eligibleWallet /\\ state = "awaiting-wallet" /\\ "on-time" \\in s.wallets[2]',
  },
  {
    name: "account-two membership becoming false",
    initial: state(
      published +
        ', !.actor = 2, !.wallets[1] = {"on-time"}, !.wallets[2] = {"on-time"}',
    ),
    step: 'walletsChange(2,"unauthorized","at-deadline")',
    witness:
      '~eligibleWallet /\\ state = "awaiting-wallet" /\\ "on-time" \\in s.wallets[1]',
  },
  {
    name: "cross-account selection of the other membership",
    initial: state(published + ', !.wallets[2] = {"on-time"}'),
    step: "accountChanges(2)",
    witness: 'rowActor = 2 /\\ state = "scheduled"',
  },
  {
    name: "the concrete unused-request full reset",
    initial: state(
      '!.requests[1] = [phase |-> "unused", life |-> 2, outcome |-> "invalid", recipients |-> 3, transfers |-> 3, closed |-> TRUE]',
    ),
    step: "beginRead(1)",
    witness:
      's.requests[1].phase = "http" /\\ s.requests[1].life = 1 /\\ s.requests[1].outcome = "none" /\\ s.requests[1].recipients = 0 /\\ s.requests[1].transfers = 0 /\\ ~s.requests[1].closed',
  },
  {
    name: "a live decoded recipient snapshot before publication",
    initial: state(decoded),
    step: "IF s.requests[1].recipients = 1 THEN s' = [s EXCEPT !.requests[1].recipients = 3] ELSE publish(1)",
    witness: 's.document = "published" /\\ s.recipients = 3',
  },
  {
    name: "a live decoded transfer snapshot before publication",
    initial: state(decoded),
    step: "IF s.requests[1].transfers = 0 THEN s' = [s EXCEPT !.requests[1].transfers = 1] ELSE publish(1)",
    witness: 'state = "sent" /\\ s.transfers = 1',
  },
  {
    name: "a live decoded closed snapshot before publication",
    initial: state(decoded),
    step: "IF ~s.requests[1].closed THEN s' = [s EXCEPT !.requests[1].closed = TRUE] ELSE publish(1)",
    witness: 's.closed /\\ state = "unclaimed"',
  },
  {
    name: "a live decoded outcome before publication",
    initial: state(decoded),
    step: 'IF s.requests[1].outcome = "valid" THEN s\' = [s EXCEPT !.requests[1].outcome = "absent"] ELSE publish(1)',
    witness: 's.document = "none" /\\ ~s.error',
  },
  {
    name: "a live decoded lifetime before ownership admission",
    initial: state(decoded + ", !.requests[1].life = 2"),
    step: "IF s.requests[1].life = 2 THEN s' = [s EXCEPT !.requests[1].life = 1] ELSE publish(1)",
    witness: 's.document = "published" /\\ s.publishedLife = 1',
  },
  {
    name: "the active owner pointer before admission",
    initial: state(decoded + ", !.active = 0"),
    step: "IF s.active = 0 THEN s' = [s EXCEPT !.active = 1] ELSE publish(1)",
    witness: 's.document = "published" /\\ s.publishedBy = 1',
  },
  {
    name: "a stale live snapshot refusing remounted publication",
    initial: state(decoded + ", !.life = 2"),
    step: "publish(1)",
    witness:
      's.requests[1].phase = "done" /\\ s.document = "loading" /\\ s.publishedBy = 0',
  },
  {
    name: "global current recipients across an account switch",
    initial: state(published + ", !.recipients = 1"),
    step: "IF s.recipients = 1 THEN s' = [s EXCEPT !.recipients = 3] ELSE accountChanges(2)",
    witness: "rowActor = 2",
  },
  {
    name: "the exact deadline before boundary installation",
    initial: state(published),
    step: "IF ~s.nowExpired THEN deadline ELSE installBoundary",
    witness: 's.renderedExpired /\\ state = "unclaimed" /\\ ~s.boundaryArmed',
  },
  {
    name: "rendered deadline state",
    initial: state(published + ", !.nowExpired = TRUE"),
    step: "s' = [s EXCEPT !.renderedExpired = TRUE]",
    witness: 'state = "unclaimed"',
  },
  {
    name: "an armed timer before firing",
    initial: state(published + ", !.nowExpired = TRUE"),
    step: "IF ~s.boundaryArmed THEN s' = [s EXCEPT !.boundaryArmed = TRUE] ELSE fireBoundary",
    witness: 's.renderedExpired /\\ state = "unclaimed"',
  },
  {
    name: "the installation flag before timer refresh",
    initial: state(
      published + ", !.nowExpired = TRUE, !.boundaryInstalled = TRUE",
    ),
    step: "IF s.boundaryInstalled THEN s' = [s EXCEPT !.boundaryInstalled = FALSE] ELSE installBoundary",
    witness: "s.renderedExpired /\\ s.boundaryInstalled",
  },
  {
    name: "the scheduled-load flag before concrete read",
    initial: state("!.loadScheduled = FALSE"),
    step: "IF ~s.loadScheduled THEN s' = [s EXCEPT !.loadScheduled = TRUE] ELSE beginRead(1)",
    witness: 's.requests[1].phase = "http"',
  },
  {
    name: "the error output before concrete retry",
    initial: state("!.loadScheduled = FALSE"),
    step: "IF ~s.error THEN s' = [s EXCEPT !.error = TRUE] ELSE retry",
    witness: "s.error /\\ s.loadScheduled",
  },
];
for (const control of cases) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native contributor VIEW retains ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain("CONTRIBUTOR_VIEW_NAMED_WITNESS_FOUND");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );
}
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native contributor VIEW coalesces only wallet classes and dead request payloads",
  async () => {
    const result = await runNative(
      nativeFixture({
        name: "audited coalescing",
        initial: state('!.requests[1].phase = "done"'),
        step: 's\' = [s EXCEPT !.wallets[1] = {"late","wrong-chain"}, !.wallets[2] = {"unknown-time","unauthorized"}, !.requests[1].life = 2, !.requests[1].outcome = "valid", !.requests[1].recipients = 3, !.requests[1].transfers = 3, !.requests[1].closed = TRUE, !.requests[2].life = 2, !.requests[2].closed = TRUE]',
        witness: "FALSE",
      }),
    );
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("CONTRIBUTOR_VIEW_NATIVE_COMPLETE");
    expect(result.output).toMatch(/1 distinct states? found/u);
    expect(result.output).toMatch(/0 states? left on queue/u);
  },
  120_000,
);
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native concrete done contributor requests remain absorbing",
  async () => {
    const result = await runNative(
      nativeFixture({
        name: "done request absorption",
        initial: state('!.requests[1].phase = "done"'),
        step: "beginRead(1) \\/ s' = s",
        witness: 's.requests[1].phase # "done"',
      }),
    );
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("CONTRIBUTOR_VIEW_NATIVE_COMPLETE");
    expect(result.output).toMatch(/1 distinct states? found/u);
  },
  120_000,
);
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native no-VIEW witness shows why a future wallet-class read needs new review",
  async () => {
    const result = await runNative(
      nativeFixture({
        name: "future wallet read",
        initial,
        step: 'IF "late" \\in s.wallets[1] THEN accountChanges(2) ELSE walletsChange(1,"late","none")',
        witness: "s.actor = 2",
      }),
      false,
    );
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("CONTRIBUTOR_VIEW_NAMED_WITNESS_FOUND");
  },
  120_000,
);
