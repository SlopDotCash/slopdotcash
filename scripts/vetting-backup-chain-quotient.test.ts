/** Exact-source guards and native controls for four backup-chain observations. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readSafetyViews } from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";
const root = resolve(import.meta.dirname, "..");
const model = "formal/models/vetting/vetting_backup_chain.qnt";
const source = readFileSync(resolve(root, model), "utf8");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const reviewedSource =
  "61ecf280693c06a4d3d717fcf5786fc9ba39172e543f62a60fd4559a475482ef";
const selected = readSafetyViews(root).views.find(
  (v: { model: string }) => v.model === model,
);
if (!selected) throw new Error("Missing reviewed backup-chain VIEW");
function requireReviewedSource(value: string) {
  if (hash(value) !== reviewedSource)
    throw new Error("Backup observation projection needs renewed review");
}
test("backup VIEW binds every original action, domain, invariant and scenario", () => {
  requireReviewedSource(source);
  expect(selected.sourceSha256).toBe(reviewedSource);
});
test("new diagnostic consumers, stale observations and pointer reuse require review", () => {
  for (const [before, after] of [
    [
      'all { s.stage == "start-read",',
      'all { s.stage == "start-read", s.outcome == "scheduled",',
    ],
    [
      "action beginRestore(object: int): bool = all { objects.contains(object),",
      'action beginRestore(object: int): bool = all { objects.contains(object), s.restoreOutcome == "success",',
    ],
    [
      '.with("completionObserved", s.completePresent and s.completeReceipt)',
      '.with("completionObserved", s.completionObserved or (s.completePresent and s.completeReceipt))',
    ],
    [
      's.stage == "none", jobs.contains(page),',
      's.stage == "none", s.completionObserved, jobs.contains(page),',
    ],
    [
      's.with("selected", object).with("restoreStage", "chain")',
      's.with("selected", s.selected).with("restoreStage", "chain")',
    ],
    [
      "not(s.destinations.contains(object)),",
      "not(s.destinations.contains(object)), s.selected == object,",
    ],
    [
      's.phase != "idle" implies s.day == 1',
      's.phase != "idle" implies s.day == 1 and s.outcome == "scheduled"',
    ],
    [
      'action readRestoreSource = all { s.restoreStage == "source-read",',
      'action readRestoreSource = all { Set("source-read", "done").contains(s.restoreStage),',
    ],
    [
      "  val cursor = s.pages.size()",
      "  def futureRead: bool = s.selected == 1 and s.completionObserved\n  val cursor = s.pages.size()",
    ],
    ["val objects = Set(0, 1)", "val objects = Set(0, 1, 2)"],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => requireReviewedSource(changed)).toThrow("renewed review");
  }
});
const state = `[phase |-> "backup", day |-> 1, stage |-> "phase-update", job |-> 0,
 startPresent |-> TRUE, startValid |-> TRUE, present |-> {0,1}, exact |-> {0,1},
 copied |-> {0,1}, pages |-> {0,1}, validPages |-> {0,1}, pageHistory |-> {0,1},
 completePresent |-> TRUE, completeReceipt |-> TRUE, completeWitness |-> TRUE,
 completionObserved |-> TRUE, pending |-> {}, seen |-> {0,1}, deliveries |-> 1,
 replays |-> 0, acknowledgments |-> 0, outcome |-> "scheduled",
 restoreStage |-> "chain", selected |-> 0, restoreAttempts |-> 1,
 destinations |-> {0,1}, exactDestinations |-> {0,1}, restored |-> {0,1}, restoreOutcome |-> "pending"]`;
type Control = readonly [string, string, string, string];
const controls: Control[] = [];
const observations = [
  [
    "pages-history",
    "s.pages \\subseteq s.pageHistory",
    "!.pageHistory = {0}",
    "!.pageHistory = {0,1}",
  ],
  [
    "history-copied",
    "s.pageHistory \\subseteq s.copied",
    "!.copied = {0}",
    "!.copied = {0,1}",
  ],
  [
    "exact-present",
    "s.exact \\subseteq s.present",
    "!.present = {0}",
    "!.present = {0,1}",
  ],
  [
    "valid-pages",
    "s.validPages \\subseteq s.pages",
    "!.pages = {0}",
    "!.pages = {0,1}",
  ],
  [
    "completion-witness",
    "s.completePresent => s.completeWitness",
    "!.completeWitness = FALSE",
    "!.completeWitness = TRUE",
  ],
  [
    "receipt-presence-witness",
    "s.completeReceipt => (s.completePresent /\\ s.completeWitness)",
    "!.completePresent = FALSE",
    "!.completePresent = TRUE",
  ],
  [
    "restored-exact-destination",
    "s.restored \\subseteq s.exactDestinations",
    "!.exactDestinations = {0}",
    "!.exactDestinations = {0,1}",
  ],
  [
    "exact-destination-presence",
    "s.exactDestinations \\subseteq s.destinations",
    "!.destinations = {0}",
    "!.destinations = {0,1}",
  ],
  [
    "restored-copied",
    "s.restored \\subseteq s.copied",
    "!.copied = {0}",
    "!.copied = {0,1}",
  ],
  [
    "delivery-limit",
    "s.deliveries <= 6",
    "!.deliveries = 7",
    "!.deliveries = 1",
  ],
  ["replay-limit", "s.replays <= 2", "!.replays = 3", "!.replays = 0"],
  [
    "acknowledgment-limit",
    "s.acknowledgments <= s.deliveries",
    "!.acknowledgments = 2",
    "!.acknowledgments = 0",
  ],
  ["cycle-day", '(s.phase # "idle" => s.day = 1)', "!.day = 0", "!.day = 1"],
] as const;
// Each named observation is the ONLY q_inv; no other invariant can produce
// an unrelated violation. Every original clause has false and healing cases.
for (const [name, observation, corrupt, repair] of observations) {
  controls.push([name, "", corrupt, observation]);
  controls.push([`false-${name}-repair`, corrupt, repair, `~(${observation})`]);
}
controls.push([
  "active-completion-guard",
  "",
  "!.completionObserved = FALSE",
  "s.completionObserved",
]);
for (const phase of ["chain", "source-read", "put", "readback"])
  controls.push([
    `live-selected-${phase}`,
    `!.restoreStage = "${phase}"`,
    "!.selected = 1",
    "s.selected = 0",
  ]);
controls.push(
  [
    "fresh-completion-readback",
    '!.stage = "complete-read", !.completionObserved = FALSE',
    '!.stage = "phase-update", !.completionObserved = s.completePresent /\\ s.completeReceipt',
    "~s.completionObserved",
  ],
  [
    "fresh-restore-pointer",
    '!.restoreStage = "done", !.selected = 0',
    '!.restoreStage = "chain", !.selected = 1, !.restoreAttempts = s.restoreAttempts + 1, !.restoreOutcome = "pending"',
    "s.selected = 0",
  ],
  [
    "finish-consumes-active-observation",
    "",
    '!.phase = "cleanup", !.stage = "cleanup-send"',
    's.phase = "backup"',
  ],
);

for (const [name, initial, update, invariant] of controls) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native backup VIEW retains the ${name} counterexample`,
    async () => {
      const tla = `---- MODULE vetting_backup_chain ----
EXTENDS Integers, FiniteSets
VARIABLE s
initialState == ${state}
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
      const marker = `BACKUP_VIEW_COUNTEREXAMPLE_${name}`;
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
        label: `backup-view-${name}`,
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

// Exact intended coalescing, including an already-false acknowledgment clause.
// TRUE alone is a projection diagnostic, not an original-invariant proof.
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native backup VIEW coalesces only the four dead observations",
  async () => {
    const tla = `---- MODULE vetting_backup_chain ----
EXTENDS Integers, FiniteSets
VARIABLE s
initialState == ${state}
q_init == s = [initialState EXCEPT !.stage = "none", !.restoreStage = "done", !.acknowledgments = 2]
q_step == s' = [s EXCEPT !.outcome = "retry", !.restoreOutcome = "failed-after-put", !.completionObserved = FALSE, !.selected = 1]
q_inv == TRUE
====
`;
    const expression = `${selected.operator} ==\n  <<${selected.fields.map((field: { expression: string }) => field.expression).join(", ")}>>\n\n`;
    const viewed = tla.replace("====\n", `${expression}====\n`);
    const binding = {
      ...selected,
      translatedSha256: hash(tla),
      viewTlaSha256: hash(viewed),
    };
    for (const [useView, expectedDistinct] of [
      [false, 2],
      [true, 1],
    ] as const) {
      const marker = `BACKUP_COALESCING_${useView ? "VIEWED" : "RAW"}`;
      const probe = `
        import {readFileSync} from 'node:fs';
        import {createRequire} from 'node:module';
        import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from './scripts/quint-safety-view.mjs';
        const require=createRequire(import.meta.url);
        const manifest=readSafetyViews(process.cwd());
        const raw={moduleName:'vetting_backup_chain',tlaCode:${JSON.stringify(tla)},hasInvariant:true,hasTemporal:false};
        const prepared=${useView ? `applySafetyView(${JSON.stringify(binding)},raw)` : "raw"};
        const runner=loadSafetyViewTlc(require.resolve('@informalsystems/quint/dist/src/tlc.js'),manifest);
        const result=await runner.verify(prepared,'0.62.4',JSON.parse(readFileSync('formal/tlc.json','utf8')),3);
        if(result.isLeft())process.exit(2);
        console.log(${JSON.stringify(marker)});
      `;
      let output = "";
      const status = await runE2ePhase({
        label: marker,
        command: "node",
        args: ["--input-type=module", "-e", probe],
        cwd: root,
        env: process.env,
        timeoutMs: 30000,
        onStdout: (text: string) => {
          output += text;
        },
        onStderr: (text: string) => {
          output += text;
        },
      });
      expect(status, output).toBe(0);
      expect(output).toContain(marker);
      expect(output).toContain("No error has been found");
      expect(output).toContain(
        `${expectedDistinct} distinct states found, 0 states left on queue.`,
      );
      expect(output).not.toContain("Invariant q_inv is violated");
    }
  },
  70000,
);
