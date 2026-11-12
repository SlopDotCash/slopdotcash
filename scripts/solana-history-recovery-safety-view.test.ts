/** Complete-production controls; native execution is separately scheduled. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { TlcConfig } from "@informalsystems/quint/dist/src/tlc.js";
import {
  applySafetyView,
  bindSafetyView,
  readSafetyViews,
} from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const model = "formal/models/ui/ui_solana_history_recovery.qnt";
const source = readFileSync(resolve(root, model), "utf8");
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const manifest = readSafetyViews(root);
const selected = (() => {
  const view = manifest.views.find((entry) => entry.model === model);
  if (!view) throw new Error("Missing reviewed history VIEW");
  return view;
})();
const enabled = process.env.SLOP_QUINT_TRANSLATOR_TEST === "1";
test("history VIEW binds the complete unchanged model", () => {
  expect(sha256(source)).toBe(
    "4dfd003b560905492820e104f07f6091e10de2144dbc360a925cdad41538f590",
  );
  expect(bindSafetyView(manifest, selected.id, model, source)).toBe(selected);
});
test("new proof readers, partial writes, terminal reuse and late-effect drift need review", () => {
  for (const [before, after] of [
    [
      'operation(id).phase == "unused",',
      'Set("unused", "done").contains(operation(id).phase),',
    ],
    ["s.child, s.active == 0,", 's.child, s.error == "none", s.active == 0,'],
    [
      'op.phase == "authority-ready",',
      'op.phase == "authority-ready", op.candidate.body == op.body,',
    ],
    [
      "proof.exists and proof.body == op.body",
      'proof.signature != "short" and proof.exists and proof.body == op.body',
    ],
    [
      's.cache.get(k).signature == "valid"',
      's.cache.get(k).signature == "valid" and s.cache.get(k).exists',
    ],
    ["op.local.get(op.index)", 'op.local.get(op.index).with("body", s.body)'],
    ["s.effects.union(Set(id))", "Set()"],
    [
      "operation(id).revision == s.serverRevision",
      "operation(id).revision <= s.serverRevision",
    ],
    ["operation(id).postCookie > 0,", "operation(id).postCookie >= 0,"],
    [
      "operation(id).context == s.context",
      'operation(id).context == s.context and operation(id).mode == "check"',
    ],
    ['op.with("candidate",', 'op.with("body", s.body).with("candidate",'],
    [
      '.with("backendAccepted", true)',
      '.with("backendAccepted", true).with("postCookie", s.actor)',
    ],
    [
      "      connected,",
      `      { nondet id = ids.oneOf() oldUnverifiedCache(id) },
      connected,`,
    ],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => bindSafetyView(manifest, selected.id, model, changed)).toThrow(
      "model changed",
    );
  }
});
async function verifyFixture(tla: string, viewed: boolean, name: string) {
  const definition = `${selected.operator} ==\n  <<${selected.fields.map((f) => f.expression).join(", ")}>>\n\n`;
  const end = tla.match(/^={4,}[ \t]*$/gmu);
  if (end?.length !== 1 || !tla.endsWith(`${end[0]}\n`))
    throw new Error("Native fixture has an unexpected complete TLA terminator");
  const projected = `${tla.slice(0, -end[0].length - 1)}${definition}${end[0]}\n`;
  const binding = {
    ...selected,
    translatedSha256: sha256(tla),
    viewTlaSha256: sha256(projected),
  };
  const probe = `
    import {createRequire} from 'node:module';
    import {readFileSync} from 'node:fs';
    import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from './scripts/quint-safety-view.mjs';
    const require=createRequire(import.meta.url);
    const manifest=readSafetyViews(process.cwd());
    const binding=${JSON.stringify(binding)};
    const config={moduleName:binding.module,tlaCode:${JSON.stringify(tla)},hasInvariant:true,hasTemporal:false};
    const prepared=${viewed ? "applySafetyView(binding,config)" : "config"};
    const runner=loadSafetyViewTlc(require.resolve('@informalsystems/quint/dist/src/tlc.js'),manifest);
    const result=await runner.verify(prepared,'0.62.4',JSON.parse(readFileSync('formal/tlc.json','utf8')),3);
    if(result.isLeft()) {
      if(!result.value.isViolation)process.exit(2);
      console.log(${JSON.stringify(`SOLANA_HISTORY_VIEW_VIOLATION_${name}`)});process.exit(1);
    }
    console.log(${JSON.stringify(`SOLANA_HISTORY_VIEW_COMPLETE_${name}`)});
  `;
  let output = "";
  const status = await runE2ePhase({
    label: `solana-history-view-${name}`,
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
  return { status, output };
}

let capturedProduction: Promise<TlcConfig> | undefined;
function freshProductionConfig(): Promise<TlcConfig> {
  capturedProduction ??= (async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "solana-history-native-translation-"),
    );
    const outputPath = join(directory, "complete-config.json");
    const capturePath = join(directory, "capture.mjs");
    writeFileSync(
      capturePath,
      `import {createRequire} from 'node:module';
       import {writeFileSync} from 'node:fs';
       const require=createRequire(${JSON.stringify(resolve(root, "package.json"))});
       require('@informalsystems/quint/dist/src/tlc.js').verify=async(config)=>{
         writeFileSync(${JSON.stringify(outputPath)},JSON.stringify(config));
         process.exit(0);
       };`,
    );
    const env = { ...process.env };
    delete env.SLOP_QUINT_SAFETY_VIEW;
    let output = "";
    try {
      const status = await runE2ePhase({
        label: "solana-history-production-translation-only",
        command: "node",
        args: [
          "--import",
          resolve(root, "scripts/quint-local-translator.mjs"),
          "--import",
          capturePath,
          resolve(root, "node_modules/@informalsystems/quint/dist/src/cli.js"),
          "verify",
          model,
          "--backend=tlc",
          "--verbosity=3",
          "--tlc-config=formal/tlc.json",
          "--invariant=invariant",
        ],
        cwd: root,
        env,
        timeoutMs: 90_000,
        onStdout: (text: string) => {
          output += text;
        },
        onStderr: (text: string) => {
          output += text;
        },
      });
      expect(status, output).toBe(0);
      const config = JSON.parse(readFileSync(outputPath, "utf8")) as TlcConfig;
      expect(sha256(config.tlaCode)).toBe(selected.translatedSha256);
      expect(config.tlaCode.match(/^={4,}[ \t]*$/gmu)).toEqual([
        "=".repeat(80),
      ]);
      const bound = bindSafetyView(manifest, selected.id, model, source);
      const prepared = applySafetyView(bound, config);
      expect(sha256(prepared.tlaCode)).toBe(selected.viewTlaSha256);
      expect(prepared.tlaCode.startsWith(config.tlaCode.slice(0, -81))).toBe(
        true,
      );
      return config;
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  })();
  return capturedProduction;
}

const localHelpers = String.raw`
Good1 == [exists |-> TRUE, body |-> 1, payer |-> 1, message |-> 1, signature |-> "valid"]
Good2 == [Good1 EXCEPT !.message = 2]
GoodLocal == [i \in messageIndices |-> IF i = 1 THEN Good1 ELSE Good2]
B1(r) == r.index >= 1 /\ r.index <= 2
B2(r) == r.prompts <= 2
B3(r) == r.ready \subseteq messageIndices
B4(r) == (r.authorized => r.observedRevision = r.revision)
B5(r) == (r.dispatched => (r.authorized /\ r.ready = messageIndices))
B6(r) == \A i \in r.ready: valid(r.local[i],r,i)
WrittenSafe == \A k \in s.written: s.cache[k].signature = "valid"
EffectsSafe == \A id \in s.effects: operation(id).dispatched
`;
async function fixture(
  dirty: string,
  action: string,
  property: string,
  alternativeInit?: string,
) {
  const config = await freshProductionConfig();
  const original = config.tlaCode;
  const match = original.match(/^init ==\n {2}s\n {4}= ([\s\S]*?)\n\n\(\*/mu);
  if (!match) throw new Error("Pinned production init expression changed");
  const aliases = [
    [
      "q_init == init\n",
      `${localHelpers}
SlopHistoryBase == [${match[1]} EXCEPT !.operations = [id \\in ids |-> [idle EXCEPT !.phase = "done"]]]
q_init == ${alternativeInit ?? `s = ${dirty ? `[SlopHistoryBase EXCEPT ${dirty}]` : "SlopHistoryBase"}`}
`,
    ],
    ["q_step == step\n", `q_step == ${action}\n`],
    ["q_inv == invariant\n", `q_inv == ${property}\n`],
  ] as const;
  let body = original.slice(0, -81);
  for (const [before, after] of aliases) {
    expect(body.split(before)).toHaveLength(2);
    body = body.replace(before, after);
  }
  let restored = body;
  for (const [before, after] of aliases)
    restored = restored.replace(after, before);
  expect(`${restored}${"=".repeat(80)}\n`).toBe(original);
  return `${body}${"=".repeat(80)}\n`;
}
const readyGood =
  "!.operations[1].authorized = TRUE, !.operations[1].observedRevision = 1, !.operations[1].ready = messageIndices, !.operations[1].local = GoodLocal";
type Control = readonly [
  name: string,
  initial: string,
  update: string,
  property: string,
];
// Subset-false fixtures keep dispatched=false and define a valid local key 3.
// These are feasible raw observations, not freely independent Boolean tuples.
const controls: Control[] = [
  ["busy-active", "", "!.busy = 1", "s.busy = s.active"],
  ["bad-effect", "", "!.badEffect = TRUE", "~s.badEffect"],
  [
    "verify-bound",
    "!.verifyRequests = 3",
    "!.verifyRequests = 4",
    "s.verifyRequests <= 3",
  ],
  ["revision-order", "", "!.revision = 2", "s.revision <= s.serverRevision"],
  [
    "server-revision-bound",
    "!.serverRevision = 3",
    "!.serverRevision = 4",
    "s.serverRevision <= 3",
  ],
  [
    "server-change-bound",
    "!.serverChanges = 1",
    "!.serverChanges = 2",
    "s.serverChanges <= 1",
  ],
  ["refresh-bound", "!.refreshes = 1", "!.refreshes = 2", "s.refreshes <= 1"],
  [
    "active-terminal-context",
    "!.active = 1, !.busy = 1",
    "!.operations[1].context = 2",
    "current(1)",
  ],
  [
    "false-active-terminal-context-heals",
    "!.active = 1, !.busy = 1, !.operations[1].context = 2",
    "!.operations[1].context = 1",
    "~current(1)",
  ],
  [
    "written-valid-signature-nonexistent",
    '!.written = {111}, !.cache[111] = [absent EXCEPT !.signature = "valid"]',
    '!.cache[111].signature = "invalid64"',
    "WrittenSafe",
  ],
  [
    "false-written-signature-heals",
    "!.written = {111}",
    '!.cache[111].signature = "valid"',
    "~WrittenSafe",
  ],
  [
    "positive-proof-body",
    '!.active = 1, !.busy = 1, !.operations[1].phase = "cache-read", !.cache[111] = Good1',
    "!.cache[111].body = 2",
    "valid(s.cache[111],operation(1),1)",
  ],
  [
    "positive-proof-payer",
    '!.active = 1, !.busy = 1, !.operations[1].phase = "cache-read", !.cache[111] = Good1',
    "!.cache[111].payer = 2",
    "valid(s.cache[111],operation(1),1)",
  ],
  [
    "positive-proof-message",
    '!.active = 1, !.busy = 1, !.operations[1].phase = "cache-read", !.cache[111] = Good1',
    "!.cache[111].message = 2",
    "valid(s.cache[111],operation(1),1)",
  ],
  [
    "effect-dispatched",
    "!.operations[1].dispatched = TRUE, !.effects = {1}",
    "!.operations[1].dispatched = FALSE",
    "EffectsSafe",
  ],
  [
    "false-effect-dispatched-heals",
    "!.effects = {1}",
    "!.operations[1].dispatched = TRUE",
    "~EffectsSafe",
  ],
  ["index-lower", "", "!.operations[1].index = 0", "B1(operation(1))"],
  ["index-upper", "", "!.operations[1].index = 3", "B1(operation(1))"],
  [
    "false-index-heals",
    "!.operations[1].index = 0",
    "!.operations[1].index = 1",
    "~B1(operation(1))",
  ],
  [
    "prompt-bound",
    "!.operations[1].prompts = 2",
    "!.operations[1].prompts = 3",
    "B2(operation(1))",
  ],
  [
    "false-prompt-bound-heals",
    "!.operations[1].prompts = 3",
    "!.operations[1].prompts = 2",
    "~B2(operation(1))",
  ],
  [
    "ready-subset",
    "!.operations[1].local = [i \\in {1,2,3} |-> [Good1 EXCEPT !.message = i]]",
    "!.operations[1].ready = {3}",
    "B3(operation(1))",
  ],
  [
    "false-ready-subset-heals",
    "!.operations[1].local = [i \\in {1,2,3} |-> [Good1 EXCEPT !.message = i]], !.operations[1].ready = {3}",
    "!.operations[1].ready = {}",
    "~B3(operation(1))",
  ],
  [
    "authorization-revision",
    "!.operations[1].authorized = TRUE, !.operations[1].observedRevision = 1",
    "!.operations[1].observedRevision = 0",
    "B4(operation(1))",
  ],
  [
    "false-authorization-revision-heals",
    "!.operations[1].authorized = TRUE",
    "!.operations[1].observedRevision = 1",
    "~B4(operation(1))",
  ],
  [
    "dispatched-authorized",
    `${readyGood}, !.operations[1].dispatched = TRUE`,
    "!.operations[1].authorized = FALSE",
    "B5(operation(1))",
  ],
  [
    "false-dispatched-authorized-heals",
    "!.operations[1].dispatched = TRUE, !.operations[1].ready = messageIndices, !.operations[1].local = GoodLocal, !.operations[1].observedRevision = 1",
    "!.operations[1].authorized = TRUE",
    "~B5(operation(1))",
  ],
  [
    "dispatched-ready",
    `${readyGood}, !.operations[1].dispatched = TRUE`,
    "!.operations[1].ready = {1}",
    "B5(operation(1))",
  ],
  [
    "false-dispatched-ready-heals",
    "!.operations[1].dispatched = TRUE, !.operations[1].authorized = TRUE, !.operations[1].observedRevision = 1, !.operations[1].ready = {1}, !.operations[1].local = GoodLocal",
    "!.operations[1].ready = messageIndices",
    "~B5(operation(1))",
  ],
  [
    "ready-proof",
    "!.operations[1].ready = {1}, !.operations[1].local = GoodLocal",
    "!.operations[1].local[1].body = 2",
    "B6(operation(1))",
  ],
  [
    "false-ready-proof-heals",
    "!.operations[1].ready = {1}, !.operations[1].local = [GoodLocal EXCEPT ![1].body = 2]",
    "!.operations[1].local[1].body = 1",
    "~B6(operation(1))",
  ],
  [
    "raw-dispatched-with-same-local-truths",
    `${readyGood}`,
    "!.operations[1].dispatched = TRUE",
    "~operation(1).dispatched",
  ],
  [
    "late-cookie-eligibility",
    "!.operations[1].dispatched = TRUE, !.operations[1].postCookie = 2",
    "!.operations[1].postCookie = 1",
    "operation(1).postCookie # operation(1).actor",
  ],
  [
    "late-positive-cookie",
    "!.operations[1].dispatched = TRUE, !.operations[1].actor = 0",
    "!.operations[1].actor = 1, !.operations[1].postCookie = 1",
    "operation(1).postCookie <= 0",
  ],
  [
    "late-stale-revision-stays-exact",
    "!.operations[1].dispatched = TRUE, !.operations[1].postCookie = 1, !.operations[1].revision = 2",
    "!.operations[1].revision = 3",
    "operation(1).revision = 2",
  ],
  [
    "live-mode",
    '!.operations[1].phase = "verify-await", !.operations[1].mode = "check"',
    '!.operations[1].mode = "connect"',
    'operation(1).mode = "check"',
  ],
  [
    "live-context",
    '!.operations[1].phase = "verify-await", !.operations[1].context = 1',
    "!.operations[1].context = 2",
    "operation(1).context = 1",
  ],
  [
    "live-scope",
    '!.operations[1].phase = "verify-await", !.operations[1].scope = 1',
    "!.operations[1].scope = 2",
    "operation(1).scope = 1",
  ],
  [
    "live-actor",
    '!.operations[1].phase = "verify-await", !.operations[1].actor = 1',
    "!.operations[1].actor = 2",
    "operation(1).actor = 1",
  ],
  [
    "live-payer",
    '!.operations[1].phase = "verify-await", !.operations[1].payer = 1',
    "!.operations[1].payer = 2",
    "operation(1).payer = 1",
  ],
  [
    "live-body",
    '!.operations[1].phase = "verify-await", !.operations[1].body = 1',
    "!.operations[1].body = 2",
    "operation(1).body = 1",
  ],
  [
    "live-revision",
    '!.operations[1].phase = "verify-await", !.operations[1].revision = 1',
    "!.operations[1].revision = 2",
    "operation(1).revision = 1",
  ],
  [
    "live-observedRevision",
    '!.operations[1].phase = "verify-await", !.operations[1].observedRevision = 0',
    "!.operations[1].observedRevision = 1",
    "operation(1).observedRevision = 0",
  ],
  [
    "live-index",
    '!.operations[1].phase = "verify-await", !.operations[1].index = 1',
    "!.operations[1].index = 2",
    "operation(1).index = 1",
  ],
  [
    "live-next",
    '!.operations[1].phase = "verify-await", !.operations[1].next = "none"',
    '!.operations[1].next = "lookup"',
    'operation(1).next = "none"',
  ],
  [
    "live-authorized",
    '!.operations[1].phase = "verify-await", !.operations[1].authorized = FALSE',
    "!.operations[1].authorized = TRUE",
    "operation(1).authorized = FALSE",
  ],
  [
    "live-prompts",
    '!.operations[1].phase = "verify-await", !.operations[1].prompts = 0',
    "!.operations[1].prompts = 1",
    "operation(1).prompts = 0",
  ],
  [
    "live-dispatched",
    '!.operations[1].phase = "verify-await", !.operations[1].dispatched = FALSE',
    "!.operations[1].dispatched = TRUE",
    "operation(1).dispatched = FALSE",
  ],
  [
    "live-backendAccepted",
    '!.operations[1].phase = "verify-await", !.operations[1].backendAccepted = FALSE',
    "!.operations[1].backendAccepted = TRUE",
    "operation(1).backendAccepted = FALSE",
  ],
  [
    "live-postActor",
    '!.operations[1].phase = "verify-await", !.operations[1].postActor = -1',
    "!.operations[1].postActor = 1",
    "operation(1).postActor = -1",
  ],
  [
    "live-postCookie",
    '!.operations[1].phase = "verify-await", !.operations[1].postCookie = 0',
    "!.operations[1].postCookie = 1",
    "operation(1).postCookie = 0",
  ],
  [
    "unknown-phase-context",
    '!.operations[1].phase = "unknown"',
    "!.operations[1].context = 2",
    "operation(1).context = 1",
  ],
];
async function expectWitness(tla: string, name: string, state = 2) {
  const r = await verifyFixture(tla, true, name);
  expect(r.status, r.output).toBe(1);
  expect(r.output).toContain("Invariant q_inv is violated");
  expect(r.output).toContain(`SOLANA_HISTORY_VIEW_VIOLATION_${name}`);
  expect(r.output).toContain(`State ${state}:`);
  expect(r.output).not.toContain("violated by the initial state");
  expect(r.output).not.toContain("No error has been found");
}
async function expectComplete(
  tla: string,
  name: string,
  states: number,
  viewed = true,
) {
  const r = await verifyFixture(tla, viewed, name);
  expect(r.status, r.output).toBe(0);
  expect(r.output).toContain("No error has been found");
  expect(r.output).toContain(`SOLANA_HISTORY_VIEW_COMPLETE_${name}`);
  expect(slopTlcTerminalCounts(r.output)).toEqual({
    distinct: states,
    queued: 0,
  });
}
for (const [name, initial, update, property] of controls) {
  test.skipIf(!enabled)(
    `native history VIEW retains ${name}`,
    async () => {
      await expectWitness(
        await fixture(initial, `s' = [s EXCEPT ${update}]`, property),
        name,
      );
    },
    125_000,
  );
}

const pairs = [
  [
    "nonexistent-valid-signature-with-written",
    '!.written = {111}, !.cache[111] = [absent EXCEPT !.signature = "valid"]',
    '!.written = {111}, !.cache[111] = [absent EXCEPT !.signature = "valid", !.body = 2, !.payer = 2, !.message = 2]',
  ],
  [
    "invalid-proof-with-false-written",
    '!.written = {111}, !.cache[111] = [Good1 EXCEPT !.signature = "invalid64"]',
    '!.written = {111}, !.cache[111] = [absent EXCEPT !.signature = "short", !.body = 2, !.payer = 2, !.message = 2]',
  ],
  [
    "active-proof-copy-boundary",
    '!.operations[1].phase = "cache-write", !.operations[1].candidate = [Good1 EXCEPT !.signature = "invalid64"], !.operations[1].local[1] = [Good1 EXCEPT !.signature = "short"]',
    '!.operations[1].phase = "cache-write", !.operations[1].candidate = [Good2 EXCEPT !.signature = "noncanonical"], !.operations[1].local[1] = [absent EXCEPT !.body = 2]',
  ],
  [
    "terminal-false-authorization",
    "!.operations[1].authorized = TRUE",
    "!.operations[1].authorized = TRUE, !.operations[1].revision = 2, !.operations[1].body = 2, !.operations[1].payer = 2, !.operations[1].candidate = Good2",
  ],
  [
    "terminal-cookie-refusal",
    "!.operations[1].dispatched = TRUE",
    "!.operations[1].dispatched = TRUE, !.operations[1].actor = 2, !.operations[1].postCookie = 1, !.operations[1].revision = 2",
  ],
  [
    "terminal-effect-already-recorded",
    "!.effects = {1}, !.operations[1].dispatched = TRUE, !.operations[1].postCookie = 1",
    "!.effects = {1}, !.operations[1].dispatched = TRUE, !.operations[1].postCookie = 1, !.operations[1].revision = 2, !.operations[1].backendAccepted = TRUE",
  ],
] as const;
for (const [name, first, second] of pairs) {
  test.skipIf(!enabled)(
    `native history VIEW coalesces ${name} raw2/view1`,
    async () => {
      const tla = await fixture(
        "",
        "s' = s",
        "TRUE",
        `(s = [SlopHistoryBase EXCEPT ${first}]) \\/ (s = [SlopHistoryBase EXCEPT ${second}])`,
      );
      await expectComplete(tla, name, 2, false);
      await expectComplete(tla, name, 1, true);
    },
    160_000,
  );
}

const cacheRead =
  '!.active = 1, !.busy = 1, !.operations[1].phase = "cache-read"';
const cacheWrite =
  '!.active = 1, !.busy = 1, !.operations[1].phase = "cache-write", !.operations[1].candidate = Good1';
const late =
  "!.operations[1].dispatched = TRUE, !.operations[1].postCookie = 1";
const boundaryWitnesses = [
  [
    "actual-cache-read",
    `${cacheRead}, !.cache[111] = Good1`,
    "readCache(1)",
    String.raw`operation(1).phase = "loop-authorize" /\ valid(operation(1).local[1],operation(1),1)`,
  ],
  [
    "actual-candidate-construction",
    '!.active = 1, !.busy = 1, !.operations[1].phase = "signing", !.operations[1].body = 2, !.operations[1].payer = 2, !.operations[1].index = 2',
    'signatureReturns(1, "valid")',
    String.raw`operation(1).phase = "cache-authorize" /\ valid(operation(1).candidate,operation(1),2)`,
  ],
  [
    "actual-cache-write-copy",
    cacheWrite,
    "cacheWrite(1, TRUE)",
    String.raw`operation(1).phase = "advance" /\ 111 \in s.written /\ 1 \in operation(1).ready /\ valid(s.cache[111],operation(1),1) /\ valid(operation(1).local[1],operation(1),1)`,
  ],
  [
    "actual-dirty-unused-reset-breaks-effects-clause",
    `${late}, !.effects = {1}, !.operations[1].phase = "unused"`,
    'start(1, "check")',
    String.raw`operation(1).phase = "identity" /\ ~operation(1).dispatched /\ ~EffectsSafe`,
  ],
  [
    "actual-verify-return-keeps-late-inputs",
    `${late}, !.operations[1].phase = "verify-await", !.operations[1].revision = 2`,
    "verifyReturns(1, FALSE)",
    String.raw`operation(1).phase = "done" /\ operation(1).dispatched /\ operation(1).revision = 2 /\ operation(1).postCookie = operation(1).actor /\ operation(1).postCookie > 0 /\ ~B5(operation(1))`,
  ],
] as const;
for (const [name, initial, action, witness] of boundaryWitnesses) {
  test.skipIf(!enabled)(
    `native production history boundary ${name}`,
    async () => {
      await expectWitness(
        await fixture(initial, action, `~(${witness})`),
        name,
      );
    },
    125_000,
  );
}
const positiveGuards = [
  [
    "cache-read-valid",
    `${cacheRead}, !.cache[111] = Good1`,
    "readCache(1)",
    "invariant",
    2,
  ],
  [
    "cache-read-invalid-miss",
    `${cacheRead}, !.cache[111] = [Good1 EXCEPT !.signature = "invalid64"]`,
    "readCache(1)",
    "invariant",
    2,
  ],
  ["cache-write-valid", cacheWrite, "cacheWrite(1, TRUE)", "invariant", 2],
  [
    "cache-write-invalid-guard",
    `${cacheWrite}, !.operations[1].candidate = [Good1 EXCEPT !.signature = "short"]`,
    "cacheWrite(1, TRUE)",
    "invariant",
    1,
  ],
  [
    "cache-write-departed-keeps-storage",
    '!.operations[1].phase = "cache-write", !.operations[1].candidate = Good1',
    "cacheWrite(1, TRUE)",
    String.raw`WrittenSafe /\ s.written = {}`,
    2,
  ],
  ["late-effect-eligible", late, "externalEffect(1)", "TRUE", 2],
  [
    "late-effect-cookie-refused",
    `${late}, !.operations[1].postCookie = 2`,
    "externalEffect(1)",
    "TRUE",
    1,
  ],
  [
    "late-effect-nonpositive-cookie",
    `${late}, !.operations[1].actor = 0, !.operations[1].postCookie = 0`,
    "externalEffect(1)",
    "TRUE",
    1,
  ],
  [
    "late-effect-already-recorded",
    `${late}, !.effects = {1}`,
    "externalEffect(1)",
    "TRUE",
    1,
  ],
  [
    "unused-late-effect",
    `${late}, !.operations[1].phase = "unused"`,
    "externalEffect(1)",
    "TRUE",
    2,
  ],
  [
    "late-effect-after-unmount",
    `${late}, ${readyGood}, !.active = 1, !.busy = 1, !.operations[1].phase = "verify-await"`,
    String.raw`unmount \/ externalEffect(1)`,
    "invariant",
    4,
  ],
] as const;
for (const [name, initial, action, property, states] of positiveGuards) {
  test.skipIf(!enabled)(
    `native production history queue0 ${name}`,
    async () => {
      await expectComplete(
        await fixture(initial, action, property),
        name,
        states,
      );
    },
    125_000,
  );
}

test.skipIf(!enabled)(
  "native terminal stale revision heals after server advance",
  async () => {
    const initial = `${late}, !.operations[1].revision = 2`;
    await expectWitness(
      await fixture(
        initial,
        String.raw`serverRevisionAdvances \/ externalEffect(1)`,
        "~(1 \\in s.effects)",
      ),
      "terminal-stale-heals",
      3,
    );
  },
  125_000,
);
test.skipIf(!enabled)(
  "native stale revision alternatives remain distinct through later healing",
  async () => {
    const a = `[SlopHistoryBase EXCEPT ${late}, !.operations[1].revision = 2]`;
    const b = `[SlopHistoryBase EXCEPT ${late}, !.operations[1].revision = 3]`;
    const tla = await fixture(
      "",
      String.raw`serverRevisionAdvances \/ externalEffect(1)`,
      "TRUE",
      `(s = ${a}) \\/ (s = ${b})`,
    );
    await expectComplete(tla, "stale-alternatives", 5, false);
    await expectComplete(tla, "stale-alternatives", 5, true);
  },
  160_000,
);

// Only original actions are called. A formerly mismatched positive proof must
// survive the messages replacement, reconnect and next check without prompting.
const changedBodyInitial =
  "!.wallet = TRUE, !.seeded = TRUE, !.cache[111] = [Good1 EXCEPT !.body = 2], !.operations = [id \\in ids |-> idle]";
const changedBodySteps = String.raw`
contextChanges("messages")
\/ (s.context = 2 /\ start(1,"connect"))
\/ authorize(1) \/ parentObservation(1) \/ parentCompletion(1,TRUE)
\/ continueAuthorized(1) \/ walletReturns(1,TRUE)
\/ (s.context = 2 /\ s.wallet /\ operation(1).phase = "done" /\ start(2,"check"))
\/ identityReply(2,TRUE) \/ readCache(2)
\/ authorize(2) \/ parentObservation(2) \/ parentCompletion(2,TRUE)
\/ sessionReply(2,TRUE) \/ continueAuthorized(2) \/ lookup(2,TRUE)`;
const changedBodyWitness = String.raw`operation(2).phase = "advance" /\ operation(2).body = 2 /\ 1 \in operation(2).ready /\ operation(2).prompts = 0 /\ valid(operation(2).local[1],operation(2),1)`;
test.skipIf(!enabled)(
  "native positive cached mismatch becomes usable in the new context",
  async () => {
    await expectWitness(
      await fixture(
        changedBodyInitial,
        changedBodySteps,
        `~(${changedBodyWitness})`,
      ),
      "positive-proof-context-heals",
      17,
    );
  },
  125_000,
);
test.skipIf(!enabled)(
  "native context-healing sequence completes queue0 with invariant",
  async () => {
    await expectComplete(
      await fixture(changedBodyInitial, changedBodySteps, "invariant"),
      "positive-proof-context-queue0",
      17,
    );
  },
  125_000,
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
