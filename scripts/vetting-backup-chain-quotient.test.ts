/** Exact-source guards and native controls for backup observations and capped carriers. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applySafetyView,
  bindSafetyView,
  readSafetyViews,
} from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const model = "formal/models/vetting/vetting_backup_chain.qnt";
const source = readFileSync(resolve(root, model), "utf8");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const reviewedSource =
  "61ecf280693c06a4d3d717fcf5786fc9ba39172e543f62a60fd4559a475482ef";
const candidate = readSafetyViews(root).views.find(
  (v: { model: string }) => v.model === model,
);
if (!candidate) throw new Error("Missing reviewed backup-chain VIEW");
const selected = candidate;
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
test("carrier consumers, cap removal and counter resets require renewed review", () => {
  for (const [before, after] of [
    ['.with("replays", s.replays + 1)', '.with("replays", 0)'],
    ['.with("deliveries", s.deliveries + 1)', '.with("deliveries", 0)'],
    [
      's.with("phase", "backup").with("day", 1)',
      's.with("phase", "backup").with("day", 1).with("replays", 0)',
    ],
    [
      's.with("job", -1).with("completionObserved", false)',
      's.with("job", -1).with("completionObserved", false).with("deliveries", 0)',
    ],
    ["s.seen.contains(page), s.replays < 2,", "s.seen.contains(page),"],
    [
      "s.pending.contains(page), s.deliveries < 6,",
      "s.pending.contains(page),",
    ],
    [
      'all { s.stage == "load-start",',
      'all { s.stage == "load-start", s.pending.contains(0),',
    ],
    [
      "action beginRestore(object: int): bool = all { objects.contains(object),",
      "action beginRestore(object: int): bool = all { objects.contains(object), s.seen.contains(object),",
    ],
    [
      's.phase != "idle" implies s.day == 1',
      's.phase != "idle" implies s.day == 1 and s.pending == Set()',
    ],
    [
      "s.pages.subseteq(s.pageHistory)",
      "s.pages.subseteq(s.pageHistory) and s.seen == Set()",
    ],
    [
      '.with("job", -1).with("stage", "none").with("outcome", "retry")',
      '.with("job", -1).with("stage", if (s.pending == Set()) "none" else "failed").with("outcome", "retry")',
    ],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => requireReviewedSource(changed)).toThrow("renewed review");
  }
});
test("V2 adds only the two independently capped carriers to the V1 expression", () => {
  expect(selected.id).toBe("vetting-backup-chain-capped-carrier-safety-v2");
  expect(
    selected.fields[0].expression.replace(
      ", !.seen = IF s.replays >= 2 THEN {} ELSE s.seen, !.pending = IF s.deliveries >= 6 THEN {} ELSE s.pending",
      "",
    ),
  ).toBe(
    String.raw`[s EXCEPT !.outcome = "none", !.restoreOutcome = "none", !.completionObserved = IF s.stage = "phase-update" THEN s.completionObserved ELSE FALSE, !.selected = IF s.restoreStage \in {"none", "done"} THEN 0 ELSE s.selected]`,
  );
});
test.skipIf(!process.env.SLOP_BACKUP_PRODUCTION_TLA)(
  "V2 binds the actual complete production translation before any exploration",
  () => {
    const path = process.env.SLOP_BACKUP_PRODUCTION_TLA;
    if (!path) throw new Error("Missing captured production TLA");
    const tlaCode = readFileSync(path, "utf8");
    expect(tlaCode).toMatch(/={80}\n$/u);
    expect(hash(tlaCode)).toBe(
      "c6c7d4a872bc1cd2d99e37f432501b1db7de850ccd2f984dbdccf322d6ec051d",
    );
    const bound = bindSafetyView(
      readSafetyViews(root),
      selected.id,
      model,
      source,
    );
    const result = applySafetyView(bound, {
      moduleName: selected.module,
      tlaCode,
      hasInvariant: true,
      hasTemporal: false,
    });
    expect(result.viewEvidence.viewTlaSha256).toBe(selected.viewTlaSha256);
    expect(result.tlaCode).toMatch(/={80}\n$/u);
    const definition = `${selected.operator} ==\n  <<${selected.fields.map((field: { expression: string }) => field.expression).join(", ")}>>\n\n`;
    expect(result.tlaCode.replace(definition, "")).toBe(tlaCode);
  },
);
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

// V2 retains every original V1 control above. These actions are the original
// replay(0), replay(1), and deliver(0) substitutions, with the same guards and
// retained writes. The page-0 stage expression removes only constant-false arms.
const carrierActions = String.raw`
Replay0 == /\ 0 \in s.seen /\ s.replays < 2
 /\ s' = [s EXCEPT !.pending = @ \cup {0}, !.replays = @ + 1]
Replay1 == /\ 1 \in s.seen /\ s.replays < 2
 /\ s' = [s EXCEPT !.pending = @ \cup {1}, !.replays = @ + 1]
Deliver0 == /\ s.stage = "none" /\ 0 \in {0,1,2}
 /\ 0 \in s.pending /\ s.deliveries < 6
 /\ s' = [s EXCEPT !.pending = @ \ {0}, !.job = 0,
 !.seen = @ \cup {0}, !.deliveries = @ + 1, !.completionObserved = FALSE,
 !.stage = IF s.phase = "complete" THEN "ack"
   ELSE IF s.phase = "cleanup" THEN "cleanup-send" ELSE "load-start"]
`;
const carrierControls: Control[] = [];
for (const [name, replays, deliveries] of [
  ["seen-before-cap", 0, 1],
  ["seen-last-live", 1, 1],
  ["seen-live-after-delivery-cap", 1, 6],
  ["seen-live-after-exceeded-delivery-cap", 1, 7],
] as const)
  carrierControls.push([
    name,
    `!.replays = ${replays}, !.deliveries = ${deliveries}`,
    "s' = [s EXCEPT !.seen = {0}]",
    String.raw`1 \in s.seen`,
  ]);
for (const [name, deliveries, replays] of [
  ["pending-before-cap", 0, 0],
  ["pending-last-live", 5, 0],
  ["pending-live-after-replay-cap", 5, 2],
  ["pending-live-after-exceeded-replay-cap", 5, 3],
] as const)
  carrierControls.push([
    name,
    `!.stage = "none", !.pending = {0,1}, !.deliveries = ${deliveries}, !.replays = ${replays}`,
    "s' = [s EXCEPT !.pending = {0}]",
    String.raw`1 \in s.pending`,
  ]);
carrierControls.push(
  [
    "raw-replay-cap",
    "!.replays = 2",
    "s' = [s EXCEPT !.replays = 3]",
    "s.replays = 2",
  ],
  [
    "raw-delivery-cap",
    "!.deliveries = 6",
    "s' = [s EXCEPT !.deliveries = 7]",
    "s.deliveries = 6",
  ],
  [
    "last-replay-then-last-delivery",
    '!.stage = "none", !.seen = {0}, !.pending = {}, !.replays = 1, !.deliveries = 5',
    "Replay0 \\/ Deliver0",
    '~(s.replays = 2 /\\ s.deliveries = 6 /\\ s.job = 0 /\\ s.stage = "load-start")',
  ],
  [
    "last-delivery-then-last-replay",
    '!.stage = "none", !.seen = {1}, !.pending = {0}, !.replays = 1, !.deliveries = 5',
    '(s.stage = "none" /\\ Deliver0) \\/ (s.stage = "load-start" /\\ Replay1)',
    '~(s.replays = 2 /\\ s.deliveries = 6 /\\ s.job = 0 /\\ s.stage = "load-start")',
  ],
  [
    "last-replay-after-delivery-cap",
    '!.stage = "none", !.seen = {0}, !.pending = {}, !.replays = 1, !.deliveries = 6',
    "Replay0",
    "s.replays = 1",
  ],
  [
    "last-delivery-after-replay-cap",
    '!.stage = "none", !.seen = {}, !.pending = {0}, !.replays = 2, !.deliveries = 5',
    "Deliver0",
    "s.deliveries = 5",
  ],
);

function carrierTla(initial: string, next: string, invariant: string) {
  return `---- MODULE vetting_backup_chain ----
EXTENDS Integers, FiniteSets
VARIABLE s
initialState == ${state}
${carrierActions}
q_init == s = [initialState EXCEPT ${initial}]
q_step == ${next}
q_inv == ${invariant}
====
`;
}
async function runCarrierFixture(tla: string, name: string, useView: boolean) {
  const expression = `${selected.operator} ==\n  <<${selected.fields.map((field: { expression: string }) => field.expression).join(", ")}>>\n\n`;
  const viewed = tla.replace("====\n", `${expression}====\n`);
  const binding = {
    ...selected,
    translatedSha256: hash(tla),
    viewTlaSha256: hash(viewed),
  };
  const marker = `BACKUP_V2_${name}_${useView ? "VIEWED" : "RAW"}`;
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
    if(result.isLeft()&&!result.value.isViolation)process.exit(2);
    console.log(${JSON.stringify(marker)});
    process.exit(result.isLeft()?1:0);
  `;
  let output = "";
  const status = await runE2ePhase({
    label: marker,
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
  return { status, output, marker };
}
for (const [name, initial, next, invariant] of carrierControls)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native backup V2 retains the ${name} counterexample`,
    async () => {
      const { status, output, marker } = await runCarrierFixture(
        carrierTla(initial, next, invariant),
        name,
        true,
      );
      expect(status, output).toBe(1);
      expect(output).toContain("Invariant q_inv is violated");
      expect(output).toContain(marker);
      expect(output).toContain("State 2:");
      expect(output).not.toContain("violated by the initial state");
      expect(output).not.toContain("No error has been found");
    },
    35_000,
  );

// Exact/exceeded caps are independent. Every pair also retains a false raw
// acknowledgment clause; exceeded-cap pairs retain their false counter clauses.
// TRUE alone observes class coalescing, not the original safety property.
for (const [name, initial, update] of [
  ["seen-at-cap", "!.replays = 2, !.deliveries = 1", "!.seen = {0}"],
  ["seen-over-cap", "!.replays = 3, !.deliveries = 7", "!.seen = {0}"],
  ["pending-at-cap", "!.deliveries = 6, !.replays = 0", "!.pending = {0}"],
  ["pending-over-cap", "!.deliveries = 7, !.replays = 3", "!.pending = {0}"],
  [
    "both-at-caps",
    "!.replays = 2, !.deliveries = 6",
    "!.seen = {0}, !.pending = {0}",
  ],
  [
    "both-over-caps",
    "!.replays = 3, !.deliveries = 7",
    "!.seen = {0}, !.pending = {0}",
  ],
] as const)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native backup V2 coalesces only dead carriers for ${name}`,
    async () => {
      const tla = carrierTla(
        `${initial}, !.seen = {0,1}, !.pending = {0,1}, !.acknowledgments = 10`,
        `s' = [s EXCEPT ${update}]`,
        "TRUE",
      );
      for (const [useView, expectedDistinct] of [
        [false, 2],
        [true, 1],
      ] as const) {
        const { status, output, marker } = await runCarrierFixture(
          tla,
          name,
          useView,
        );
        expect(status, output).toBe(0);
        expect(output).toContain(marker);
        expect(output).toContain("No error has been found");
        expect(output).toContain(
          `${expectedDistinct} distinct states found, 0 states left on queue.`,
        );
        expect(output).not.toContain("Invariant q_inv is violated");
      }
    },
    70_000,
  );
