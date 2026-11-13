/** Native observation controls for the exact eight-ID permutation quotient. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bindSafetyView, readSafetyViews } from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const model = "formal/models/slopbot/bot_inference_retention.qnt";
const source = readFileSync(resolve(root, model), "utf8");
const manifest = readSafetyViews(root);
const view = manifest.views.find(
  (entry: { model: string }) => entry.model === model,
);
if (!view) throw new Error("Missing reviewed inference ID symmetry");
const selected = view;
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const enabled = process.env.SLOP_QUINT_TRANSLATOR_TEST === "1";

test("inference symmetry binds the complete unchanged eight-ID model", () => {
  expect(sha256(source)).toBe(
    "01644b21ca4172dc45be3abb9585a55ce4cd1b2341d2e3328d01da2c5b5ce60f",
  );
  expect(bindSafetyView(manifest, selected.id, model, source)).toBe(selected);
});

test("new ID observations, bounds and state require a renewed symmetry review", () => {
  for (const [before, after] of [
    ["Set(1, 2, 3, 4, 5, 6, 7, 8)", "Set(1, 2, 3, 4, 5, 6, 7, 8, 9)"],
    [
      "ids.contains(id), s.current == 0",
      "ids.contains(id), id != 1, s.current == 0",
    ],
    ["s.current > 0", "s.current == 1"],
    ["s.retained > 0 implies", "s.retained == 1 implies"],
    ["published: bool }", "published: bool, extra: int }"],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => bindSafetyView(manifest, selected.id, model, changed)).toThrow(
      "model changed",
    );
  }
});

const bits = [
  "admitted",
  "reserved",
  "called",
  "usage",
  "free",
  "valid",
  "completed",
  "zeroReconciled",
] as const;
const empty = `[${bits.map((bit) => `${bit} |-> FALSE`).join(", ")}]`;
const base = `[rows |-> [id \\in 1..8 |-> empty], current |-> 0,
 retained |-> 0, published |-> FALSE]`;
const counted = `Cardinality({id \\in 1..8 : s.rows[id].reserved
 /\\ ~(s.rows[id].usage /\\ s.rows[id].free)
 /\\ ~(s.rows[id].completed /\\ s.rows[id].zeroReconciled /\\ ~s.rows[id].usage)})`;
const retained = `(s.retained > 0 => (s.rows[s.retained].usage /\\ s.rows[s.retained].valid))`;

// These fixtures exercise the production VIEW and actual official TLC runner.
// They are observation controls, not substitute proofs of the source model.
async function verify(tla: string, viewed: boolean) {
  const definition = `${selected.operator} ==\n  <<${selected.fields
    .map((field: { expression: string }) => field.expression)
    .join(", ")}>>\n\n`;
  const binding = {
    ...selected,
    translatedSha256: sha256(tla),
    viewTlaSha256: sha256(tla.replace("====\n", `${definition}====\n`)),
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
      console.log('BOT_INFERENCE_SYMMETRY_VIOLATION');
      process.exit(1);
    }
    console.log('BOT_INFERENCE_SYMMETRY_COMPLETE');
  `;
  let output = "";
  const status = await runE2ePhase({
    label: "bot-inference-symmetry",
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

const controls: Array<readonly [string, string, string, string]> = bits.map(
  (bit) => [
    `row-${bit}`,
    "",
    `!.rows[1].${bit} = TRUE`,
    `\\A id \\in 1..8 : ~s.rows[id].${bit}`,
  ],
);
controls.push(
  [
    "counted-row-multiplicity",
    "!.rows = [id \\in 1..8 |-> IF id <= 3 THEN [empty EXCEPT !.reserved = TRUE] ELSE empty]",
    "!.rows[4].reserved = TRUE",
    `${counted} <= 3`,
  ],
  [
    "call-reservation",
    "!.rows[1].called = TRUE, !.rows[1].reserved = TRUE",
    "!.rows[1].reserved = FALSE",
    "\\A id \\in 1..8 : (s.rows[id].called => s.rows[id].reserved)",
  ],
  [
    "zero-completion",
    "!.rows[1].zeroReconciled = TRUE, !.rows[1].completed = TRUE",
    "!.rows[1].completed = FALSE",
    "\\A id \\in 1..8 : (s.rows[id].zeroReconciled => (s.rows[id].completed /\\ ~s.rows[id].called))",
  ],
  [
    "zero-no-call",
    "!.rows[1].zeroReconciled = TRUE, !.rows[1].completed = TRUE",
    "!.rows[1].called = TRUE",
    "\\A id \\in 1..8 : (s.rows[id].zeroReconciled => (s.rows[id].completed /\\ ~s.rows[id].called))",
  ],
  [
    "retained-row-usage-role",
    "!.retained = 1, !.rows[1].usage = TRUE, !.rows[1].valid = TRUE, !.rows[2].valid = TRUE",
    "!.retained = 2",
    retained,
  ],
  [
    "retained-row-valid-role",
    "!.retained = 1, !.rows[1].usage = TRUE, !.rows[1].valid = TRUE, !.rows[2].usage = TRUE",
    "!.retained = 2",
    retained,
  ],
  [
    "publication-retention",
    "",
    "!.published = TRUE",
    "(s.published => s.retained > 0)",
  ],
  [
    "current-row-role",
    "!.current = 1, !.rows[1].admitted = TRUE",
    "!.current = 2",
    "(s.current = 0 \\/ s.rows[s.current].admitted)",
  ],
  [
    "current-retained-identity-overlap",
    "!.current = 1, !.retained = 1",
    "!.current = 2",
    "s.current = s.retained",
  ],
);

for (const [name, initial, update, invariant] of controls) {
  test.skipIf(!enabled)(
    `native inference symmetry retains the ${name} counterexample`,
    async () => {
      const tla = `---- MODULE bot_inference_retention ----
EXTENDS Integers, FiniteSets
VARIABLE s
empty == ${empty}
initialState == ${base}
q_init == s = ${initial ? `[initialState EXCEPT ${initial}]` : "initialState"}
q_step == s' = [s EXCEPT ${update}]
q_inv == ${invariant}
====
`;
      const result = await verify(tla, true);
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain("BOT_INFERENCE_SYMMETRY_VIOLATION");
      expect(result.output).toContain("State 2:");
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).not.toContain("No error has been found");
    },
    35_000,
  );
}

for (const [name, first, second] of [
  [
    "overlapping-roles",
    "!.current = 1, !.retained = 1, !.rows[1].admitted = TRUE",
    "!.current = 7, !.retained = 7, !.rows[7].admitted = TRUE",
  ],
  [
    "separate-roles",
    "!.current = 1, !.retained = 2, !.rows[1].called = TRUE, !.rows[2].usage = TRUE",
    "!.current = 8, !.retained = 3, !.rows[8].called = TRUE, !.rows[3].usage = TRUE",
  ],
] as const) {
  test.skipIf(!enabled)(
    `native inference symmetry identifies only the renamed ${name} states`,
    async () => {
      const tla = `---- MODULE bot_inference_retention ----
EXTENDS Integers, FiniteSets
VARIABLE s
empty == ${empty}
initialState == ${base}
q_init == (s = [initialState EXCEPT ${first}]) \\/ (s = [initialState EXCEPT ${second}])
q_step == s' = s
q_inv == TRUE
====
`;
      for (const viewed of [false, true]) {
        const result = await verify(tla, viewed);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("No error has been found");
        expect(result.output).toContain("BOT_INFERENCE_SYMMETRY_COMPLETE");
        expect(result.output).toContain(
          `${viewed ? 1 : 2} distinct states found, 0 states left on queue`,
        );
      }
    },
    70_000,
  );
}
