/** Focused exact-source, capture and native controls for the keeper VIEW. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bindSafetyView, readSafetyViews } from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";
const root = resolve(import.meta.dirname, "..");
const model = "formal/models/payments/operator_keeper_lifecycle.qnt";
const source = readFileSync(resolve(root, model), "utf8");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const reviewedSource =
  "7377521ae45adfa5ad7469e8492170b3a87ef406d613fd22e9a83437e2f1d89d";
const manifest = readSafetyViews(root);
const selected = manifest.views.find(
  (v: { model: string }) => v.model === model,
);
if (!selected) throw new Error("Missing reviewed operator keeper VIEW");
function requireReviewedSource(text: string) {
  if (hash(text) !== reviewedSource)
    throw new Error("Keeper continuation observations need renewed review");
}
test("keeper VIEW binds every original action, domain and false invariant observation", () => {
  requireReviewedSource(source);
  expect(bindSafetyView(manifest, selected.id, model, source)).toEqual(
    selected,
  );
  expect(selected.translatedSha256).toBe(
    "56a36b8aa7f2ce2d9f63a5e4ab80f3de007e536362754ea8f2c893884b9dd1c8",
  );
  expect(selected.viewTlaSha256).toBe(
    "af827574265ba6f9381dfa6adc0a990629300acfddc92bee0fa0eb52f0bc37b6",
  );
});
test("new terminal/output/cross-slot readers or reset drift require review", () => {
  for (const [before, after] of [
    [
      'request.phase == "waiting", activeRun.phase == "settled",',
      'request.phase == "waiting", request.instance == s.instance, activeRun.phase == "settled",',
    ],
    [
      'request.phase == "body", request.caller == "cron",',
      'request.phase == "body", request.result == "pending", request.caller == "cron",',
    ],
    [
      'request.phase == "waiting", activeRun.phase == "settled",',
      'request.phase == "waiting", request.caller != "public", activeRun.phase == "settled",',
    ],
    [
      'request.phase == "body", request.caller == "cron",',
      'request.phase == "body", request.http == 503, request.caller == "cron",',
    ],
    [
      's.active == id, s.runs.get(id).phase == "core", s\' = s.with("indexed", true)',
      's.active == id, s.runs.get(id).phase == "core", not(s.indexed), s\' = s.with("indexed", true)',
    ],
    [
      'activeRun.mode == "execute", not(s.signed),',
      'activeRun.mode == "execute", activeRun.projects == s.projects, not(s.signed),',
    ],
    [
      'request.phase == "waiting", activeRun.phase == "settled",',
      'request.phase == "waiting", activeRun.instance == s.instance, activeRun.phase == "settled",',
    ],
    [
      '.with("runs", if (fresh) s.runs.set(key,',
      '.with("runs", if (fresh or s.runs.get(key).phase == "lost") s.runs.set(key,',
    ],
    [
      'unusedRun.with("phase", "mode").with("instance", s.instance)',
      'unusedRun.with("phase", "mode").with("instance", s.runs.get(key).instance)',
    ],
    [
      'not(Set("settled", "unused", "lost").contains(s.runs.get(s.active).phase))',
      'not(Set("settled").contains(s.runs.get(s.active).phase))',
    ],
    [
      'request.runId > 0 and s.runs.get(request.runId).phase == "settled"',
      "request.runId > 0 and s.runs.get(request.runId).instance == s.instance",
    ],
    [
      'activeRun.with("phase", "lost").with("staged", false)',
      'activeRun.with("phase", "core").with("staged", false)',
    ],
    [
      's.requests.get(id).phase == "unused", Set("public"',
      's.requests.get(id).phase == "unused", s.runs.get(1).mode == "off", Set("public"',
    ],
    [
      "  action configure(mode: str,",
      "  def futureRead(id: int): bool = s.runs.get(id).projects == 1\n  action configure(mode: str,",
    ],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => requireReviewedSource(changed)).toThrow("renewed review");
    expect(() => bindSafetyView(manifest, selected.id, model, changed)).toThrow(
      "model changed",
    );
  }
});
const run = `[phase |-> "core", instance |-> 1, mode |-> "execute", registry |-> 1,
 configValid |-> TRUE, projects |-> 1, staged |-> FALSE, attempted |-> FALSE, itemError |-> FALSE, outcome |-> "none"]`;
const unused = `[phase |-> "unused", instance |-> 0, mode |-> "off", registry |-> 1,
 configValid |-> TRUE, projects |-> 1, staged |-> FALSE, attempted |-> FALSE, itemError |-> FALSE, outcome |-> "none"]`;
const request = `[phase |-> "unused", caller |-> "direct", instance |-> 0, runId |-> 0, http |-> 0, result |-> "none"]`;
const state = `[instance |-> 1, mode |-> "execute", configValid |-> TRUE, registry |-> 1, projects |-> 1,
 active |-> 1, count |-> 1, runs |-> [i \\in {1,2} |-> IF i = 1 THEN initialRun ELSE unusedRun],
 requests |-> [i \\in {1,2,3} |-> IF i = 1 THEN [initialRequest EXCEPT !.phase = "waiting", !.instance = 1, !.runId = 1, !.result = "pending"] ELSE initialRequest],
 journalRegistry |-> 1, indexed |-> FALSE, signed |-> TRUE, nonce |-> TRUE, liability |-> TRUE,
 settledGas |-> FALSE, broadcasts |-> 0, safeSigning |-> TRUE]`;
const active =
  'IF s.active = 0 THEN TRUE ELSE (s.runs[s.active].instance = s.instance /\\ ~(s.runs[s.active].phase \\in {"settled","unused","lost"}))';
// Guard zero before indexing: the original runId>0 conjunct has the same
// logical false value there. Valid positive run IDs stay exact, never frozen.
const http =
  'IF r.http # 200 THEN TRUE ELSE IF r.runId <= 0 THEN FALSE ELSE s.runs[r.runId].phase = "settled"';
type Control = readonly [string, string, string, string];
const controls: Control[] = [];
for (const [name, initial, corrupt, repair, property] of [
  ["run-count-bound", "", "!.count = 3", "!.count = 1", "s.count <= 2"],
  ["instance-bound", "", "!.instance = 3", "!.instance = 1", "s.instance <= 2"],
  [
    "safe-signing",
    "",
    "!.safeSigning = FALSE",
    "!.safeSigning = TRUE",
    "s.safeSigning",
  ],
  [
    "signed-nonce",
    "",
    "!.nonce = FALSE",
    "!.nonce = TRUE",
    "s.signed = s.nonce",
  ],
  [
    "liability-signed",
    "",
    "!.signed = FALSE",
    "!.signed = TRUE",
    "s.liability => s.signed",
  ],
  [
    "settled-gas-liability",
    "!.settledGas = TRUE, !.liability = FALSE",
    "!.liability = TRUE",
    "!.liability = FALSE",
    "s.settledGas => (s.signed /\\ ~s.liability)",
  ],
  [
    "broadcast-evidence",
    "!.broadcasts = 1",
    "!.nonce = FALSE",
    "!.nonce = TRUE",
    "s.broadcasts > 0 => (s.signed /\\ s.nonce)",
  ],
] as const) {
  controls.push([name, initial, corrupt, property]);
  controls.push([
    `false-${name}-repair`,
    `${initial ? `${initial}, ` : ""}${corrupt}`,
    repair,
    `~(${property})`,
  ]);
}
controls.push(
  ["active-live-instance", "", "!.runs[1].instance = 2", "Active"],
  [
    "false-active-live-instance-heals",
    "!.runs[1].instance = 2",
    "!.runs[1].instance = 1",
    "~Active",
  ],
);
for (const phase of ["unused", "lost", "settled"]) {
  controls.push([
    `active-terminal-${phase}`,
    "",
    `!.runs[1].phase = "${phase}"`,
    "Active",
  ]);
  controls.push([
    `false-active-${phase}-heals-on-reset`,
    `!.runs[1].phase = "${phase}"`,
    "!.active = 0",
    "~Active",
  ]);
}
controls.push(
  [
    "http-breaks-on-run-phase-reuse",
    '!.runs[1].phase = "settled", !.active = 0, !.requests[1].http = 200',
    '!.runs[1].phase = "core"',
    "Http(s.requests[1])",
  ],
  [
    "false-http-heals-on-settle",
    "!.requests[1].http = 200",
    '!.active = 0, !.runs[1].phase = "settled", !.runs[1].outcome = "ok", !.runs[1].staged = FALSE',
    "~Http(s.requests[1])",
  ],
  [
    "false-http-zero-key-heals",
    '!.runs[1].phase = "settled", !.active = 0, !.requests[1].http = 200, !.requests[1].runId = 0',
    "!.requests[1].runId = 1",
    "~Http(s.requests[1])",
  ],
  [
    "false-http-exact-key-heals",
    '!.runs[1].phase = "lost", !.runs[2].phase = "settled", !.active = 0, !.requests[1].http = 200',
    "!.requests[1].runId = 2",
    "~Http(s.requests[1])",
  ],
  [
    "http-200-class",
    '!.runs[1].phase = "settled", !.active = 0',
    "!.requests[1].http = 200",
    "s.requests[1].http # 200",
  ],
  [
    "stored-cron-class",
    '!.requests[1].caller = "cron"',
    '!.requests[1].caller = "direct"',
    's.requests[1].caller = "cron"',
  ],
  [
    "settled-throw-class",
    '!.runs[1].phase = "settled", !.runs[1].outcome = "ok", !.active = 0',
    '!.runs[1].outcome = "throw"',
    's.runs[1].outcome # "throw"',
  ],
  [
    "settled-partial-class",
    '!.runs[1].phase = "settled", !.runs[1].outcome = "partial", !.active = 0',
    '!.runs[1].outcome = "ok"',
    's.runs[1].outcome = "partial"',
  ],
  [
    "unused-lost-phase",
    '!.runs[1].phase = "unused"',
    '!.runs[1].phase = "lost"',
    's.runs[1].phase = "unused"',
  ],
  [
    "lost-settled-phase",
    '!.runs[1].phase = "lost"',
    '!.runs[1].phase = "settled"',
    's.runs[1].phase = "lost"',
  ],
);
for (const phase of ["waiting", "body", "done"])
  controls.push([
    `exact-request-run-key-${phase}`,
    `!.requests[1].phase = "${phase}"`,
    "!.requests[1].runId = 2",
    "s.requests[1].runId = 1",
  ]);
for (const [field, value, property] of [
  ["instance", "2", "s.runs[1].instance = 1"],
  ["mode", '"dry_run"', 's.runs[1].mode = "execute"'],
  ["registry", "2", "s.runs[1].registry = 1"],
  ["configValid", "FALSE", "s.runs[1].configValid"],
  ["staged", "TRUE", "~s.runs[1].staged"],
  ["attempted", "TRUE", "~s.runs[1].attempted"],
  ["itemError", "TRUE", "~s.runs[1].itemError"],
  ["outcome", '"throw"', 's.runs[1].outcome = "none"'],
] as const)
  controls.push([
    `live-run-${field}`,
    "",
    `!.runs[1].${field} = ${value}`,
    property,
  ]);
for (const [field, value, property] of [
  ["mode", '"off"', 's.mode = "execute"'],
  ["registry", "2", "s.registry = 1"],
  ["configValid", "FALSE", "s.configValid"],
  ["journalRegistry", "2", "s.journalRegistry = 1"],
] as const)
  controls.push([`global-${field}`, "", `!.${field} = ${value}`, property]);
// Boundary fixtures use the original reset/settle/restart/delivery update
// shapes. q_inv remains its single named observation, never the whole invariant.
controls.push(
  [
    "true-http-breaks-on-fresh-key-reuse",
    '!.active = 0, !.count = 0, !.runs[1].phase = "settled", !.runs[1].outcome = "ok", !.requests[1].phase = "done", !.requests[1].http = 200, !.requests[2].phase = "dispatch"',
    '!.active = 1, !.count = 1, !.runs[1] = FreshRun, !.requests[2] = [s.requests[2] EXCEPT !.phase = "waiting", !.instance = s.instance, !.runId = 1]',
    "Http(s.requests[1])",
  ],
  [
    "fresh-dispatch-fully-resets-dirty-lost-run",
    '!.active = 0, !.count = 0, !.runs[1].phase = "lost", !.runs[1].instance = 2, !.runs[1].mode = "invalid", !.runs[1].staged = TRUE, !.runs[1].attempted = TRUE, !.runs[1].itemError = TRUE, !.runs[1].outcome = "throw", !.requests[2].phase = "dispatch"',
    '!.active = 1, !.count = 1, !.runs[1] = FreshRun, !.requests[2] = [s.requests[2] EXCEPT !.phase = "waiting", !.instance = s.instance, !.runId = 1]',
    's.runs[1].phase # "mode"',
  ],
  [
    "nonfresh-dispatch-does-not-resurrect-lost-run",
    '!.runs[1].phase = "lost", !.requests[2].phase = "dispatch"',
    '!.requests[2] = [s.requests[2] EXCEPT !.phase = "waiting", !.instance = s.instance, !.runId = s.active]',
    's.requests[2].phase # "waiting"',
  ],
  [
    "settled-cron-delivery-after-replacement",
    '!.instance = 2, !.mode = "off", !.active = 0, !.runs[1].phase = "settled", !.runs[1].instance = 1, !.runs[1].outcome = "ok", !.requests[1].caller = "cron"',
    '!.requests[1] = [s.requests[1] EXCEPT !.http = 200, !.phase = "body", !.result = "pending"]',
    "s.requests[1].http # 200",
  ],
  [
    "restart-interrupts-only-unsettled-waiter",
    "!.requests[1].http = 200",
    '!.instance = 2, !.mode = "off", !.active = 0, !.runs[1] = [s.runs[1] EXCEPT !.phase = "lost", !.staged = FALSE], !.requests[1] = [s.requests[1] EXCEPT !.phase = "done", !.result = "interrupted"]',
    's.requests[1].phase = "waiting"',
  ],
);

for (const [name, initial, update, invariant] of controls) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native keeper VIEW retains the ${name} counterexample`,
    async () => {
      const tla = `---- MODULE operator_keeper_lifecycle ----
EXTENDS Integers, FiniteSets
VARIABLE s
initialRun == ${run}
unusedRun == ${unused}
initialRequest == ${request}
initialState == ${state}
FreshRun == [unusedRun EXCEPT !.phase = "mode", !.instance = s.instance, !.mode = s.mode, !.configValid = s.configValid, !.registry = s.registry, !.projects = s.projects]
Active == ${active}
Http(r) == ${http}
q_init == s = ${initial ? `[initialState EXCEPT ${initial}]` : "initialState"}
q_step == s' = [s EXCEPT ${update}]
q_inv == ${invariant}
====
`;
      const expression = `${selected.operator} ==\n  <<${selected.fields.map((field: { expression: string }) => field.expression).join(", ")}>>\n\n`;
      const viewed = tla.replace("====\n", `${expression}====\n`);
      const binding = {
        ...selected,
        translatedSha256: hash(tla),
        viewTlaSha256: hash(viewed),
      };
      const marker = `KEEPER_VIEW_COUNTEREXAMPLE_${name}`;
      const probe = `
        import {readFileSync} from 'node:fs';
        import {createRequire} from 'node:module';
        import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from './scripts/quint-safety-view.mjs';
        const require=createRequire(import.meta.url);
        const manifest=readSafetyViews(process.cwd());
        const binding=${JSON.stringify(binding)};
        const prepared=applySafetyView(binding,{moduleName:binding.module,tlaCode:${JSON.stringify(tla)},hasInvariant:true,hasTemporal:false});
        const runner=loadSafetyViewTlc(require.resolve('@informalsystems/quint/dist/src/tlc.js'),manifest);
        const result=await runner.verify(prepared,'0.62.4',JSON.parse(readFileSync('formal/tlc.json','utf8')),3);
        if(!result.isLeft()||!result.value.isViolation)process.exit(2);
        console.log(${JSON.stringify(marker)});
        process.exit(1);
      `;
      let output = "";
      const status = await runE2ePhase({
        label: `keeper-view-${name}`,
        command: "node",
        args: ["--input-type=module", "-e", probe],
        cwd: root,
        env: process.env,
        timeoutMs: 30_000,
        onStdout: (text: string) => {
          output += text;
        },
        onStderr: (text: string) => {
          output += text;
        },
      });
      expect(status, output).toBe(1);
      expect(output).toContain("Invariant q_inv is violated");
      expect(output).toContain(marker);
      expect(output).toContain("State 2:");
      expect(output).not.toContain("violated by the initial state");
      expect(output).not.toContain("No error has been found");
    },
    35_000,
  );
}

// The original active and HTTP clauses are FALSE throughout this fixture.
// TRUE alone checks coalescing without assuming or conjoining those clauses.
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native keeper VIEW coalesces dead payloads while false active/http clauses persist",
  async () => {
    const tla = `---- MODULE operator_keeper_lifecycle ----
EXTENDS Integers, FiniteSets
VARIABLE s
initialRun == ${run}
unusedRun == ${unused}
initialRequest == ${request}
initialState == ${state}
q_init == s = [initialState EXCEPT !.runs[1].phase = "lost", !.runs[1].instance = 2, !.requests[1].http = 200, !.requests[1].caller = "public"]
q_step == s' = [s EXCEPT !.indexed = TRUE, !.projects = 2, !.runs[1].instance = 1, !.runs[1].mode = "invalid", !.runs[1].registry = 2, !.runs[1].staged = TRUE, !.runs[1].projects = 2, !.requests[1].instance = 2, !.requests[1].result = "response-lost", !.requests[1].caller = "wrong-route"]
q_inv == TRUE
====
`;
    const definition = `${selected.operator} ==\n  <<${selected.fields.map((f: { expression: string }) => f.expression).join(", ")}>>\n\n`;
    const viewed = tla.replace("====\n", `${definition}====\n`);
    const binding = {
      ...selected,
      translatedSha256: hash(tla),
      viewTlaSha256: hash(viewed),
    };
    for (const [useView, count] of [
      [false, 2],
      [true, 1],
    ] as const) {
      const marker = `KEEPER_COALESCING_${useView ? "VIEW" : "RAW"}`;
      const probe = `
        import {readFileSync} from 'node:fs';
        import {createRequire} from 'node:module';
        import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from './scripts/quint-safety-view.mjs';
        const require=createRequire(import.meta.url); const manifest=readSafetyViews(process.cwd());
        const raw={moduleName:'operator_keeper_lifecycle',tlaCode:${JSON.stringify(tla)},hasInvariant:true,hasTemporal:false};
        const prepared=${useView ? `applySafetyView(${JSON.stringify(binding)},raw)` : "raw"};
        const runner=loadSafetyViewTlc(require.resolve('@informalsystems/quint/dist/src/tlc.js'),manifest);
        const result=await runner.verify(prepared,'0.62.4',JSON.parse(readFileSync('formal/tlc.json','utf8')),3);
        if(result.isLeft())process.exit(2); console.log(${JSON.stringify(marker)});
      `;
      let output = "";
      const status = await runE2ePhase({
        label: marker,
        command: "node",
        args: ["--input-type=module", "-e", probe],
        cwd: root,
        env: process.env,
        timeoutMs: 30000,
        onStdout: (s: string) => {
          output += s;
        },
        onStderr: (s: string) => {
          output += s;
        },
      });
      expect(status, output).toBe(0);
      expect(output).toContain(marker);
      expect(output).toContain("No error has been found");
      expect(output).toContain(
        `${count} distinct states found, 0 states left on queue.`,
      );
      expect(output).not.toContain("Invariant q_inv is violated");
    }
  },
  70000,
);

test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native production keeper translation binds the complete original TLA before exploration",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "slop-keeper-view-capture-"));
    try {
      const capture = join(directory, "capture.mjs");
      const receipt = join(directory, "binding.json");
      const helper = pathToFileURL(
        resolve(root, "scripts/quint-safety-view.mjs"),
      ).href;
      const adapter = resolve(
        root,
        "node_modules/@informalsystems/quint/dist/src/tlc.js",
      );
      writeFileSync(
        capture,
        `
        import {createRequire} from 'node:module'; import {readFileSync,writeFileSync} from 'node:fs'; import {createHash} from 'node:crypto';
        import {readSafetyViews,bindSafetyView,applySafetyView,patchTlcConfig} from ${JSON.stringify(helper)};
        const require=createRequire(import.meta.url); const tlc=require(${JSON.stringify(adapter)}); const hash=t=>createHash('sha256').update(t).digest('hex');
        tlc.verify=async(config)=>{
          const root=${JSON.stringify(root)};const manifest=readSafetyViews(root);const model=${JSON.stringify(model)};
          const binding=bindSafetyView(manifest,${JSON.stringify(selected.id)},model,readFileSync(root+'/'+model,'utf8'));
          const out=applySafetyView(binding,config);const original=readFileSync(${JSON.stringify(adapter)},'utf8');const overlay=patchTlcConfig(original,manifest.quintAdapterSha256);
          writeFileSync(${JSON.stringify(receipt)},JSON.stringify({module:config.moduleName,hasInvariant:config.hasInvariant,hasTemporal:config.hasTemporal,originalTlaSha256:hash(config.tlaCode),viewedTlaSha256:hash(out.tlaCode),adapterSha256:hash(original),overlaySha256:hash(overlay),viewEvidence:out.viewEvidence}));
          console.log('KEEPER_PRODUCTION_TLA_BOUND_BEFORE_EXPLORATION');process.exit(0);
        };
      `,
      );
      const env = { ...process.env };
      delete env.SLOP_QUINT_SAFETY_VIEW;
      let output = "";
      const status = await runE2ePhase({
        label: "keeper-production-translation-bind",
        command: "node",
        args: [
          "--import",
          resolve(root, "scripts/quint-local-translator.mjs"),
          "--import",
          capture,
          resolve(root, "node_modules/.bin/quint"),
          "verify",
          model,
          "--backend=tlc",
          "--verbosity=3",
          "--tlc-config=formal/tlc.json",
          "--invariant=invariant",
        ],
        cwd: root,
        env,
        timeoutMs: 120000,
        onStdout: (s: string) => {
          output += s;
        },
        onStderr: (s: string) => {
          output += s;
        },
      });
      expect(status, output).toBe(0);
      expect(output).toContain(
        "KEEPER_PRODUCTION_TLA_BOUND_BEFORE_EXPLORATION",
      );
      const actual = JSON.parse(readFileSync(receipt, "utf8"));
      expect(actual.module).toBe(selected.module);
      expect(actual.hasInvariant).toBe(true);
      expect(actual.hasTemporal).toBe(false);
      expect(actual.originalTlaSha256).toBe(selected.translatedSha256);
      expect(actual.viewedTlaSha256).toBe(selected.viewTlaSha256);
      expect(actual.adapterSha256).toBe(manifest.quintAdapterSha256);
      expect(actual.overlaySha256).toBe(
        "18427ab99f12fd9e92f5e926f3ac870e3dee7fb7fa47a408d349d045ac6a46e9",
      );
      expect(actual.viewEvidence.sourceSha256).toBe(reviewedSource);
      expect(output).not.toContain("states left on queue");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  125000,
);
