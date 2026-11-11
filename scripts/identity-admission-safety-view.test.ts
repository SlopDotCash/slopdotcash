/** Exact-source guards and scheduled native controls for identity admission. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bindSafetyView, readSafetyViews } from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const model = "formal/models/api/api_identity_admission.qnt";
const source = readFileSync(resolve(root, model), "utf8");
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const manifest = readSafetyViews(root);
const selected = manifest.views.find((entry) => entry.model === model);
if (!selected) throw new Error("Missing reviewed identity admission VIEW");

function checkReviewedSource(text: string) {
  if (
    sha256(text) !==
    "e1c0aa22340edbcca2f64c27fba1336a4e24bc48bc5cfa67799a79827d1cbe4c"
  )
    throw new Error("Identity admission terminal observation needs review");
}
test("identity VIEW binds the complete unchanged model", () => {
  checkReviewedSource(source);
  expect(bindSafetyView(manifest, selected.id, model, source)).toEqual(
    selected,
  );
});
test("terminal readers, reuse, quota changes and reset drift require review", () => {
  for (const [before, after] of [
    [
      's.requests.get(id).phase == "unused",',
      's.requests.get(id).phase == "unused", s.requests.get(id).key == key,',
    ],
    [
      'request.phase == "ready",',
      'Set("ready", "done").contains(request.phase),',
    ],
    [
      'request.phase == "hash",',
      'request.phase == "hash", s.requests.get(2).retryAfter == 0,',
    ],
    ['.with("stamp", s.now)', '.with("stamp", s.now).with("generation", key)'],
    [
      'and s.requests.get(id).result == "allowed"',
      'and Set("allowed", "429").contains(s.requests.get(id).result)',
    ],
    ["s.now < 6,", "s.now < 6, s.requests.get(1).expiry > s.now,"],
    ["else row\n", 'else row.with("count", s.requests.get(1).count)\n'],
    [
      'request.result == "503" implies request.retryAfter == 0',
      'request.result == "503" implies request.retryAfter == 0 and request.key == 1',
    ],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => checkReviewedSource(changed)).toThrow("needs review");
    expect(() => bindSafetyView(manifest, selected.id, model, changed)).toThrow(
      "model changed",
    );
  }
});

const request = `[phase |-> "done", key |-> 0, stamp |-> 0, count |-> 0,
 expiry |-> 0, generation |-> 0, result |-> "none", retryAfter |-> 0]`;
const state = `[now |-> 0,
 counters |-> [key \\in {1,2} |-> [present |-> FALSE, count |-> 0,
 started |-> 0, expiry |-> 0, generation |-> 0]],
 requests |-> [id \\in {1,2,3,4} |-> initialRequest],
 cleanupPhase |-> "idle", cleanupStamp |-> 0]`;
const c1 = '(r.result = "allowed" => (r.count >= 1 /\\ r.count <= 2))';
const c2 =
  '(r.result \\in {"allowed", "429"} => (r.expiry > r.stamp /\\ r.retryAfter = r.expiry - r.stamp /\\ r.retryAfter >= 1))';
const c3 = '(r.result = "429" => r.count > 2)';
const c4 = '(r.result = "503" => r.retryAfter = 0)';
const quota =
  '\\A generation \\in {1,2,3,4}: Cardinality({id \\in {1,2,3,4}: s.requests[id].generation = generation /\\ s.requests[id].result = "allowed"}) <= 2';
type Control = readonly [string, string, string, string];
const controls: Control[] = [
  ["clock-lower-bound", "", "!.now = -1", "s.now >= 0"],
  ["clock-upper-bound", "", "!.now = 7", "s.now <= 6"],
  [
    "counter-positive",
    "!.counters[1].present = TRUE, !.counters[1].count = 1",
    "!.counters[1].count = 0",
    "s.counters[1].count > 0",
  ],
  [
    "counter-upper-bound",
    "!.counters[1].count = 4",
    "!.counters[1].count = 5",
    "s.counters[1].count <= 4",
  ],
  [
    "counter-expiry",
    "!.counters[1].expiry = 1",
    "!.counters[1].expiry = 0",
    "s.counters[1].expiry > s.counters[1].started",
  ],
  [
    "counter-generation",
    "!.counters[1].generation = 1",
    "!.counters[1].generation = 5",
    "s.counters[1].generation \\in {1,2,3,4}",
  ],
  [
    "absent-row-exactness",
    "",
    "!.counters[1].count = 1",
    "s.counters[1] = initialState.counters[1]",
  ],
  [
    "allowed-count-lower",
    '!.requests[1].result = "allowed", !.requests[1].count = 1',
    "!.requests[1].count = 0",
    "C1(s.requests[1])",
  ],
  [
    "allowed-count-upper",
    '!.requests[1].result = "allowed", !.requests[1].count = 2',
    "!.requests[1].count = 3",
    "C1(s.requests[1])",
  ],
  [
    "false-allowed-count-heals",
    '!.requests[1].result = "allowed", !.requests[1].count = 0',
    "!.requests[1].count = 1",
    "~C1(s.requests[1])",
  ],
  [
    "allowed-expiry",
    '!.requests[1].result = "allowed", !.requests[1].expiry = 3, !.requests[1].retryAfter = 3',
    "!.requests[1].expiry = 0",
    "C2(s.requests[1])",
  ],
  [
    "allowed-retry-difference",
    '!.requests[1].result = "allowed", !.requests[1].expiry = 3, !.requests[1].retryAfter = 3',
    "!.requests[1].retryAfter = 2",
    "C2(s.requests[1])",
  ],
  [
    "false-allowed-retry-heals",
    '!.requests[1].result = "allowed", !.requests[1].expiry = 3, !.requests[1].retryAfter = 2',
    "!.requests[1].retryAfter = 3",
    "~C2(s.requests[1])",
  ],
  [
    "denied-retry-positive",
    '!.requests[1].result = "429", !.requests[1].expiry = 1, !.requests[1].retryAfter = 1',
    "!.requests[1].retryAfter = 0",
    "C2(s.requests[1])",
  ],
  [
    "false-denied-retry-heals",
    '!.requests[1].result = "429", !.requests[1].expiry = 1, !.requests[1].retryAfter = 0',
    "!.requests[1].retryAfter = 1",
    "~C2(s.requests[1])",
  ],
  [
    "denied-count",
    '!.requests[1].result = "429", !.requests[1].count = 3',
    "!.requests[1].count = 2",
    "C3(s.requests[1])",
  ],
  [
    "false-denied-count-heals",
    '!.requests[1].result = "429", !.requests[1].count = 2',
    "!.requests[1].count = 3",
    "~C3(s.requests[1])",
  ],
  [
    "failure-retry",
    '!.requests[1].result = "503"',
    "!.requests[1].retryAfter = 1",
    "C4(s.requests[1])",
  ],
  [
    "false-failure-retry-heals",
    '!.requests[1].result = "503", !.requests[1].retryAfter = 1',
    "!.requests[1].retryAfter = 0",
    "~C4(s.requests[1])",
  ],
  [
    "terminal-generation-even-nonallowed",
    "!.requests[1].generation = 1",
    "!.requests[1].generation = 2",
    "s.requests[1].generation = 1",
  ],
  [
    "terminal-allowed-bit",
    "!.requests[1].count = 1, !.requests[1].expiry = 1, !.requests[1].retryAfter = 1",
    '!.requests[1].result = "allowed"',
    's.requests[1].result # "allowed"',
  ],
  [
    "terminal-phase",
    '!.requests[1].phase = "unused"',
    '!.requests[1].phase = "done"',
    's.requests[1].phase = "unused"',
  ],
  [
    "quota-allowed-membership",
    '!.requests[1].result = "allowed", !.requests[1].generation = 1, !.requests[2].result = "allowed", !.requests[2].generation = 1, !.requests[3].generation = 1',
    '!.requests[3].result = "allowed"',
    "Quota",
  ],
  [
    "quota-generation-membership",
    '!.requests[1].result = "allowed", !.requests[1].generation = 1, !.requests[2].result = "allowed", !.requests[2].generation = 1, !.requests[3].result = "allowed", !.requests[3].generation = 2',
    "!.requests[3].generation = 1",
    "Quota",
  ],
  [
    "false-quota-generation-heals",
    '!.requests[1].result = "allowed", !.requests[1].generation = 1, !.requests[2].result = "allowed", !.requests[2].generation = 1, !.requests[3].result = "allowed", !.requests[3].generation = 1',
    "!.requests[3].generation = 2",
    "~Quota",
  ],
  [
    "dirty-unused-capture-removes-quota-contribution",
    '!.requests[1].phase = "unused", !.requests[1].result = "allowed", !.requests[1].generation = 1, !.requests[2].result = "allowed", !.requests[2].generation = 1, !.requests[3].result = "allowed", !.requests[3].generation = 1',
    '!.requests[1] = [initialRequest EXCEPT !.phase = "hash", !.key = 1, !.stamp = s.now]',
    "~Quota",
  ],
  [
    "dirty-unused-capture-repairs-local-clause",
    '!.requests[1].phase = "unused", !.requests[1].result = "503", !.requests[1].retryAfter = 1',
    '!.requests[1] = [initialRequest EXCEPT !.phase = "hash", !.key = 2, !.stamp = s.now]',
    "~C4(s.requests[1])",
  ],
];
for (const [name, initial, update, property] of [
  ["key", "!.key = 1", "!.key = 2", "s.requests[1].key = 1"],
  ["captured-clock", "!.stamp = 1", "!.stamp = 2", "s.requests[1].stamp = 1"],
  ["count", "!.count = 1", "!.count = 2", "s.requests[1].count = 1"],
  ["expiry", "!.expiry = 3", "!.expiry = 4", "s.requests[1].expiry = 3"],
  [
    "generation",
    "!.generation = 1",
    "!.generation = 2",
    "s.requests[1].generation = 1",
  ],
  [
    "result",
    '!.result = "none"',
    '!.result = "503"',
    's.requests[1].result = "none"',
  ],
  [
    "retry",
    "!.retryAfter = 1",
    "!.retryAfter = 2",
    "s.requests[1].retryAfter = 1",
  ],
] as const) {
  controls.push([
    `live-${name}`,
    `!.requests[1].phase = "committed", ${initial.replaceAll("!.", "!.requests[1].")}`,
    update.replaceAll("!.", "!.requests[1]."),
    property,
  ]);
}

for (const [name, initial, update, property] of controls) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native identity VIEW retains ${name}`,
    async () => {
      const tla = `---- MODULE api_identity_admission ----
EXTENDS Integers, FiniteSets
VARIABLE s
initialRequest == ${request}
initialState == ${state}
C1(r) == ${c1}
C2(r) == ${c2}
C3(r) == ${c3}
C4(r) == ${c4}
Quota == ${quota}
q_init == s = ${initial ? `[initialState EXCEPT ${initial}]` : "initialState"}
q_step == s' = [s EXCEPT ${update}]
q_inv == ${property}
====
`;
      const definition = `${selected.operator} ==\n  <<${selected.fields.map((field) => field.expression).join(", ")}>>\n\n`;
      const viewed = tla.replace("====\n", `${definition}====\n`);
      const binding = {
        ...selected,
        translatedSha256: sha256(tla),
        viewTlaSha256: sha256(viewed),
      };
      const witness = `IDENTITY_ADMISSION_VIEW_COUNTEREXAMPLE_${name}`;
      const probe = `
        import {createRequire} from 'node:module';
        import {readFileSync} from 'node:fs';
        import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from './scripts/quint-safety-view.mjs';
        const require=createRequire(import.meta.url);
        const manifest=readSafetyViews(process.cwd());
        const binding=${JSON.stringify(binding)};
        const prepared=applySafetyView(binding,{moduleName:binding.module,tlaCode:${JSON.stringify(tla)},hasInvariant:true,hasTemporal:false});
        const runner=loadSafetyViewTlc(require.resolve('@informalsystems/quint/dist/src/tlc.js'),manifest);
        const result=await runner.verify(prepared,'0.62.4',JSON.parse(readFileSync('formal/tlc.json','utf8')),3);
        if(!result.isLeft()||!result.value.isViolation)process.exit(2);
        console.log(${JSON.stringify(witness)});
        process.exit(1);
      `;
      let output = "";
      const status = await runE2ePhase({
        label: `identity-admission-view-${name}`,
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
      expect(output).toContain(witness);
      expect(output).toContain("State 2:");
      expect(output).not.toContain("violated by the initial state");
      expect(output).not.toContain("No error has been found");
    },
    35_000,
  );
}

// These pairs have the same exact phase/generation/allowed bit and all four
// clause truths. q_inv TRUE intentionally permits the already-false C1 pair.
for (const [name, first, second] of [
  [
    "terminal-nonallowed-dead-payload",
    "!.requests[1].key = 1",
    "!.requests[1].key = 2, !.requests[1].stamp = 6, !.requests[1].count = 4, !.requests[1].expiry = 2, !.requests[1].retryAfter = 1",
  ],
  [
    "terminal-already-false-count-clause",
    '!.requests[1].key = 1, !.requests[1].generation = 1, !.requests[1].result = "allowed", !.requests[1].count = 0, !.requests[1].expiry = 3, !.requests[1].retryAfter = 3',
    '!.requests[1].key = 2, !.requests[1].generation = 1, !.requests[1].result = "allowed", !.requests[1].count = 3, !.requests[1].expiry = 3, !.requests[1].retryAfter = 3',
  ],
] as const) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native identity VIEW coalesces only the ${name} diagnostic pair`,
    async () => {
      const tla = `---- MODULE api_identity_admission ----
EXTENDS Integers, FiniteSets
VARIABLE s
initialRequest == ${request}
initialState == ${state}
q_init == (s = [initialState EXCEPT ${first}]) \\/ (s = [initialState EXCEPT ${second}])
q_step == s' = s
q_inv == TRUE
====
`;
      const definition = `${selected.operator} ==\n  <<${selected.fields.map((field) => field.expression).join(", ")}>>\n\n`;
      const binding = {
        ...selected,
        translatedSha256: sha256(tla),
        viewTlaSha256: sha256(tla.replace("====\n", `${definition}====\n`)),
      };
      for (const viewed of [false, true]) {
        const witness = `IDENTITY_ADMISSION_VIEW_DIAGNOSTIC_${name}_${viewed}`;
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
          if(result.isLeft())process.exit(2);
          console.log(${JSON.stringify(witness)});
        `;
        let output = "";
        const status = await runE2ePhase({
          label: `identity-admission-diagnostic-${name}-${viewed}`,
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
        expect(status, output).toBe(0);
        expect(output).toContain("No error has been found");
        expect(output).toContain(witness);
        expect(output).toContain(
          `${viewed ? 1 : 2} distinct states found, 0 states left on queue`,
        );
      }
    },
    70_000,
  );
}
