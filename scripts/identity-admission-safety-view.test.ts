/** Exact-source guards and scheduled native controls for identity admission. */
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
const model = "formal/models/api/api_identity_admission.qnt";
const source = readFileSync(resolve(root, model), "utf8");
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const manifest = readSafetyViews(root);
const selected = (() => {
  const view = manifest.views.find((entry) => entry.model === model);
  if (!view) throw new Error("Missing reviewed identity admission VIEW");
  return view;
})();

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
    ["s.now < 6,", "s.now < 6, s.requests.get(1).generation == 0,"],
    [
      's.requests.get(id).phase == "unused",',
      's.requests.get(id).phase == "unused", s.requests.get(id).generation == 0,',
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
    "allowed-zero-generation-enters-quota",
    '!.requests[1].result = "allowed", !.requests[1].generation = 1, !.requests[2].result = "allowed", !.requests[2].generation = 1, !.requests[3].result = "allowed", !.requests[3].generation = 0',
    "!.requests[3].generation = 1",
    "Quota",
  ],
  [
    "false-quota-heals-to-outside-generation",
    '!.requests[1].result = "allowed", !.requests[1].generation = 1, !.requests[2].result = "allowed", !.requests[2].generation = 1, !.requests[3].result = "allowed", !.requests[3].generation = 1',
    "!.requests[3].generation = 5",
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

// These pairs have the same phase/allowed generation/allowed bit and all four
// clause truths. q_inv TRUE intentionally permits the already-false C1 pair.
for (const [name, first, second] of [
  [
    "terminal-nonallowed-generation",
    "!.requests[1].generation = 1",
    "!.requests[1].generation = 2",
  ],
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

let capturedProduction: Promise<TlcConfig> | undefined;
function freshProductionConfig(): Promise<TlcConfig> {
  capturedProduction ??= (async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "identity-native-translation-"),
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
        label: "identity-production-translation-only",
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
      expect(config.tlaCode.endsWith(`${"=".repeat(80)}\n`)).toBe(true);
      const prepared = applySafetyView(
        bindSafetyView(manifest, selected.id, model, source),
        config,
      );
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

const allowed =
  '[unused EXCEPT !.phase = "done", !.result = "allowed", !.generation = 1, !.count = 1, !.expiry = 3, !.retryAfter = 3]';
const productionControls = [
  [
    "actual-unused-reset-heals-false-quota-and-local-clause",
    `!.now = 3, !.requests[1] = [${allowed} EXCEPT !.phase = "unused", !.count = 0], !.requests[2] = ${allowed}, !.requests[3] = ${allowed}`,
    "capture(1, 2)",
    String.raw`s.requests[1].phase = "hash" /\ s.requests[1].key = 2 /\ s.requests[1].stamp = 3 /\ s.requests[1].generation = 0 /\ s.requests[1].result = "none" /\ s.requests[1].count = 0 /\ s.requests[1].expiry = 0 /\ s.requests[1].retryAfter = 0 /\ invariant`,
  ],
  [
    "actual-nonallowed-unused-reset-clears-dirty-generation",
    '!.now = 5, !.requests[1] = [unused EXCEPT !.generation = 4, !.result = "503", !.retryAfter = 1]',
    "capture(1, 1)",
    String.raw`s.requests[1].phase = "hash" /\ s.requests[1].key = 1 /\ s.requests[1].stamp = 5 /\ s.requests[1].generation = 0 /\ s.requests[1].result = "none" /\ s.requests[1].retryAfter = 0 /\ invariant`,
  ],
  [
    "actual-other-slot-reply-makes-generation-quota-false",
    `!.requests[1] = ${allowed}, !.requests[2] = ${allowed}, !.requests[3] = [unused EXCEPT !.phase = "committed", !.generation = 1, !.count = 1, !.expiry = 3]`,
    "reply(3, TRUE)",
    String.raw`s.requests[3].phase = "done" /\ s.requests[3].result = "allowed" /\ s.requests[3].generation = 1 /\ Cardinality({i \in ids: s.requests[i].generation = 1 /\ s.requests[i].result = "allowed"}) = 3 /\ ~invariant`,
  ],
] as const;
for (const [name, dirty, actualAction, witness] of productionControls) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native production identity TLA reaches ${name}`,
    async () => {
      const config = await freshProductionConfig();
      const original = config.tlaCode;
      const match = original.match(
        /^init ==\n {2}s\n {4}= ([\s\S]*?)\n\n\(\*/mu,
      );
      if (!match) throw new Error("Pinned production init expression changed");
      const aliases = [
        [
          "q_init == init\n",
          `SlopIdentityControlInitial == [${match[1]} EXCEPT ${dirty}]
SlopIdentityControlWitness == ${witness}
q_init == s = SlopIdentityControlInitial
`,
        ],
        ["q_step == step\n", `q_step == ${actualAction}\n`],
        ["q_inv == invariant\n", "q_inv == ~SlopIdentityControlWitness\n"],
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
      const tla = `${body}${"=".repeat(80)}\n`;
      const definition = `${selected.operator} ==\n  <<${selected.fields.map((field) => field.expression).join(", ")}>>\n\n`;
      const binding = {
        ...selected,
        translatedSha256: sha256(tla),
        viewTlaSha256: sha256(`${body}${definition}${"=".repeat(80)}\n`),
      };
      const marker = `IDENTITY_PRODUCTION_WITNESS_${name}`;
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
        console.log(${JSON.stringify(marker)});process.exit(1);
      `;
      let output = "";
      const status = await runE2ePhase({
        label: `identity-production-${name}`,
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
    125_000,
  );
}
