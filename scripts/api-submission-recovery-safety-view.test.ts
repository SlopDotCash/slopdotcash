/** Source-bound observation controls; native execution is separately scheduled. */
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
const model = "formal/models/api/api_submission_recovery.qnt";
const source = readFileSync(resolve(root, model), "utf8");
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const manifest = readSafetyViews(root);
const selected = (() => {
  const view = manifest.views.find((entry) => entry.model === model);
  if (!view) throw new Error("Missing reviewed submission recovery VIEW");
  return view;
})();
const enabled = process.env.SLOP_QUINT_TRANSLATOR_TEST === "1";

test("recovery VIEW binds every byte of the unchanged concrete model", () => {
  expect(sha256(source)).toBe(
    "8b39e8302787904f8979c4175aac8263a5068e3e60ca9471f7ad3099e44ea95f",
  );
  expect(bindSafetyView(manifest, selected.id, model, source)).toBe(selected);
});
test("new terminal/reentry/land/output readers require full renewed review", () => {
  for (const [before, after] of [
    [
      'Set("unused", "read").contains(sender.phase)',
      'Set("unused", "read", "done").contains(sender.phase)',
    ],
    ['sender.with("phase", "read")', 'idle.with("phase", "read")'],
    [
      'sender.phase == "ready",',
      'sender.phase == "ready", sender.response == "none",',
    ],
    [
      "s.attempts > 0, s.age < 5,",
      "s.attempts > 0, s.age < 5, s.absenceObserved,",
    ],
    [
      "s.receiptVerified, s' =",
      "s.receiptVerified, not(s.receiptReplyLost), s' =",
    ],
    ["s.senders.get(id).attempt == copy", "s.senders.get(id).chosen == copy"],
    [
      "and s.senders.get(id).posted",
      "and s.senders.get(id).matched and s.senders.get(id).posted",
    ],
    [
      'and not(Set("terminal", "retryable", "throttled").contains(s.senders.get(id).outcome))',
      'and s.senders.get(id).outcome == "created"',
    ],
    [
      "s.posts.contains(copy),",
      's.posts.contains(copy), s.senders.get(2).response == "fallback",',
    ],
    [
      "sender.posted implies sender.matched",
      "sender.posted implies sender.readRevision == s.revision and sender.matched",
    ],
    [
      "      age,\n",
      "      { nondet id = ids.oneOf() legacyClaimReadback(id) },\n      age,\n",
    ],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => bindSafetyView(manifest, selected.id, model, changed)).toThrow(
      "model changed",
    );
  }
});

const sender = `[phase |-> "done", readRevision |-> 0, readState |-> "none",
 gateRevision |-> 0, claimRevision |-> 0, attempt |-> 0, usableRevision |-> 0,
 usableState |-> "none", matched |-> FALSE, posted |-> FALSE, outcome |-> "none",
 chosen |-> 0, nextState |-> "none", nextRevision |-> 0, fallbackRevision |-> 0,
 response |-> "none"]`;
const state = `[phase |-> "draft", revision |-> 1, attempts |-> 0, age |-> 0,
 idleExpired |-> FALSE, copies |-> {}, posts |-> {}, advisory |-> 0,
 terminalFailure |-> FALSE, saved |-> FALSE, caseCount |-> 0,
 receiptVerified |-> FALSE, contactsVerified |-> FALSE, absenceObserved |-> FALSE,
 banned |-> FALSE, gateRevision |-> 1, senders |-> [id \\in {1,2} |-> initialSender],
 receiptReplyLost |-> FALSE, firstCopy |-> 1]`;
const ownClaim =
  '(r.posted => (r.matched /\\ r.usableRevision = r.claimRevision /\\ r.usableState = "submitting"))';
const postedCount =
  "Cardinality(s.posts) = Cardinality({id \\in {1,2}: s.senders[id].posted})";
const readyClaim =
  '!.senders[1].posted = TRUE, !.senders[1].matched = TRUE, !.senders[1].claimRevision = 2, !.senders[1].usableRevision = 2, !.senders[1].usableState = "submitting"';
type Control = readonly [
  name: string,
  initial: string,
  update: string,
  property: string,
  guard?: string,
];
const controls: Control[] = [
  ["attempt-bound", "!.attempts = 2", "!.attempts = 3", "s.attempts <= 2"],
  ["revision-bound", "!.revision = 12", "!.revision = 13", "s.revision <= 12"],
  ["case-bound", "!.caseCount = 1", "!.caseCount = 2", "s.caseCount <= 1"],
  [
    "saved-case-count",
    "!.saved = TRUE, !.caseCount = 1",
    "!.caseCount = 0",
    '(s.saved => (s.caseCount = 1 /\\ s.phase # "abandoned"))',
  ],
  [
    "saved-case-not-abandoned",
    "!.saved = TRUE, !.caseCount = 1",
    '!.phase = "abandoned"',
    '(s.saved => (s.caseCount = 1 /\\ s.phase # "abandoned"))',
  ],
  [
    "verified-case-phase",
    '!.receiptVerified = TRUE, !.phase = "receipt-verified", !.advisory = 1, !.caseCount = 1',
    '!.phase = "submitted"',
    '(s.receiptVerified => (s.phase = "receipt-verified" /\\ s.advisory # 0 /\\ s.caseCount = 1))',
  ],
  [
    "verified-case-advisory",
    '!.receiptVerified = TRUE, !.phase = "receipt-verified", !.advisory = 1, !.caseCount = 1',
    "!.advisory = 0",
    '(s.receiptVerified => (s.phase = "receipt-verified" /\\ s.advisory # 0 /\\ s.caseCount = 1))',
  ],
  [
    "verified-case-count",
    '!.receiptVerified = TRUE, !.phase = "receipt-verified", !.advisory = 1, !.caseCount = 1',
    "!.caseCount = 0",
    '(s.receiptVerified => (s.phase = "receipt-verified" /\\ s.advisory # 0 /\\ s.caseCount = 1))',
  ],
  [
    "advisory-copy",
    "!.advisory = 1, !.copies = {1}",
    "!.copies = {}",
    "(s.advisory # 0 => s.advisory \\in s.copies)",
  ],
  [
    "copies-within-posts",
    "!.copies = {1}, !.posts = {1}",
    "!.posts = {}",
    "s.copies \\subseteq s.posts",
  ],
  [
    "posts-domain",
    "!.posts = {1}",
    "!.posts = {3}",
    "s.posts \\subseteq {1,2}",
  ],
  [
    "posted-cardinality",
    "!.posts = {1}, !.senders[1].posted = TRUE",
    "!.senders[2].posted = TRUE",
    postedCount,
  ],
  [
    "false-posted-cardinality-heals",
    "!.posts = {1}",
    "!.senders[1].posted = TRUE",
    `~(${postedCount})`,
  ],
  [
    "terminal-posted-flag",
    "",
    "!.senders[1].posted = TRUE",
    "~s.senders[1].posted",
  ],
  [
    "terminal-attempt-identity",
    "!.senders[1].attempt = 1",
    "!.senders[1].attempt = 2",
    "s.senders[1].attempt = 1",
  ],
  [
    "terminal-phase",
    "",
    '!.senders[1].phase = "unused"',
    's.senders[1].phase = "done"',
  ],
  [
    "own-claim-matched",
    readyClaim,
    "!.senders[1].matched = FALSE",
    "OwnClaim(s.senders[1])",
  ],
  [
    "false-own-claim-matched-heals",
    `${readyClaim}, !.senders[1].matched = FALSE`,
    "!.senders[1].matched = TRUE",
    "~OwnClaim(s.senders[1])",
  ],
  [
    "own-claim-revision",
    readyClaim,
    "!.senders[1].usableRevision = 3",
    "OwnClaim(s.senders[1])",
  ],
  [
    "false-own-claim-revision-heals",
    `${readyClaim}, !.senders[1].usableRevision = 3`,
    "!.senders[1].usableRevision = 2",
    "~OwnClaim(s.senders[1])",
  ],
  [
    "own-claim-state",
    readyClaim,
    '!.senders[1].usableState = "uncertain"',
    "OwnClaim(s.senders[1])",
  ],
  [
    "false-own-claim-state-heals",
    `${readyClaim}, !.senders[1].usableState = "uncertain"`,
    '!.senders[1].usableState = "submitting"',
    "~OwnClaim(s.senders[1])",
  ],
  [
    "land-eligibility",
    '!.posts = {1}, !.senders[1].attempt = 1, !.senders[1].posted = TRUE, !.senders[1].outcome = "terminal"',
    '!.senders[1].outcome = "uncertain"',
    "~LandEnabled(1)",
  ],
  [
    "land-attempt",
    '!.posts = {1}, !.senders[1].attempt = 2, !.senders[1].posted = TRUE, !.senders[1].outcome = "uncertain"',
    "!.senders[1].attempt = 1",
    "~LandEnabled(1)",
  ],
  [
    "land-posted",
    '!.posts = {1}, !.senders[1].attempt = 1, !.senders[1].outcome = "uncertain"',
    "!.senders[1].posted = TRUE",
    "~LandEnabled(1)",
  ],
  [
    "late-land-from-done-false-own-claim",
    '!.posts = {1}, !.senders[1].attempt = 1, !.senders[1].posted = TRUE, !.senders[1].outcome = "uncertain"',
    "!.copies = s.copies \\cup {1}",
    "~(1 \\in s.copies)",
    "LandEnabled(1)",
  ],
  [
    "cross-slot-late-land",
    '!.posts = {2}, !.senders[2].attempt = 2, !.senders[2].posted = TRUE, !.senders[2].outcome = "uncertain"',
    "!.copies = s.copies \\cup {2}",
    "~(2 \\in s.copies)",
    "LandEnabled(2)",
  ],
  [
    "unused-preserves-capture",
    '!.senders[1].phase = "unused", !.senders[1].claimRevision = 2',
    "!.senders[1].claimRevision = 3",
    "s.senders[1].claimRevision = 2",
  ],
  [
    "unused-preserves-posted",
    '!.senders[1].phase = "unused"',
    "!.senders[1].posted = TRUE",
    "~s.senders[1].posted",
  ],
];
for (const [name, phase, before, after] of [
  ["readRevision", "read", "1", "2"],
  ["readState", "read", '"draft"', '"failed"'],
  ["gateRevision", "read", "1", "2"],
  ["claimRevision", "claim-readback", "2", "3"],
  ["attempt", "ready", "1", "2"],
  ["usableRevision", "outcome-write", "2", "3"],
  ["usableState", "outcome-write", '"submitting"', '"uncertain"'],
  ["matched", "ready", "FALSE", "TRUE"],
  ["posted", "provider", "FALSE", "TRUE"],
  ["outcome", "outcome-write", '"created"', '"uncertain"'],
  ["chosen", "outcome-write", "1", "2"],
  ["nextState", "outcome-readback", '"submitted"', '"failed"'],
  ["nextRevision", "outcome-readback", "3", "4"],
  ["fallbackRevision", "fallback-write", "3", "4"],
] as const)
  controls.push([
    `live-${name}`,
    `!.senders[1].phase = "${phase}", !.senders[1].${name} = ${before}`,
    `!.senders[1].${name} = ${after}`,
    `s.senders[1].${name} = ${before}`,
  ]);

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
      console.log(${JSON.stringify(`RECOVERY_VIEW_VIOLATION_${name}`)});process.exit(1);
    }
    console.log(${JSON.stringify(`RECOVERY_VIEW_COMPLETE_${name}`)});
  `;
  let output = "";
  const status = await runE2ePhase({
    label: `recovery-view-${name}`,
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
      join(tmpdir(), "recovery-native-translation-"),
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
        label: "recovery-production-translation-only",
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

const productionControls = [
  [
    "actual-read-preserves-dirty-unused-own-claim",
    '!.posts = {1}, !.senders[1] = [idle EXCEPT !.posted = TRUE, !.matched = FALSE, !.claimRevision = 9, !.usableRevision = 4, !.usableState = "uncertain", !.attempt = 1, !.outcome = "uncertain"]',
    "read(1)",
    's.senders[1].phase = "read" /\\ s.senders[1].readRevision = s.revision /\\ s.senders[1].readState = s.phase /\\ s.senders[1].gateRevision = s.gateRevision /\\ s.senders[1].posted /\\ ~s.senders[1].matched /\\ s.senders[1].claimRevision = 9 /\\ s.senders[1].usableRevision = 4 /\\ s.senders[1].usableState = "uncertain" /\\ s.senders[1].attempt = 1 /\\ s.senders[1].outcome = "uncertain" /\\ ~ownClaimOnly',
  ],
  [
    "actual-late-land-from-done-false-own-claim",
    '!.posts = {1}, !.senders[1] = [idle EXCEPT !.phase = "done", !.posted = TRUE, !.matched = FALSE, !.claimRevision = 9, !.usableRevision = 4, !.attempt = 1, !.outcome = "uncertain"]',
    "land(1)",
    '1 \\in s.copies /\\ s.senders[1].phase = "done" /\\ s.senders[1].attempt = 1 /\\ s.senders[1].posted /\\ s.senders[1].outcome = "uncertain" /\\ ~ownClaimOnly',
  ],
  [
    "actual-cross-slot-late-land",
    '!.posts = {2}, !.senders[1] = [idle EXCEPT !.phase = "done", !.posted = TRUE, !.matched = FALSE, !.claimRevision = 9, !.usableRevision = 4, !.attempt = 2, !.outcome = "uncertain"]',
    "land(2)",
    '2 \\in s.copies /\\ ~(1 \\in s.copies) /\\ s.senders[1].phase = "done" /\\ s.senders[1].attempt = 2 /\\ s.senders[1].posted /\\ s.senders[1].outcome = "uncertain" /\\ ~ownClaimOnly',
  ],
] as const;

for (const [name, dirty, actualAction, witness] of productionControls) {
  test.skipIf(!enabled)(
    `native production recovery TLA reaches ${name}`,
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
          `SlopRecoveryControlInitial == [${match[1]} EXCEPT ${dirty}]
SlopRecoveryControlWitness == ${witness}
q_init == s = SlopRecoveryControlInitial
`,
        ],
        ["q_step == step\n", `q_step == ${actualAction}\n`],
        ["q_inv == invariant\n", "q_inv == ~SlopRecoveryControlWitness\n"],
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
      // Production read/land definitions stay byte-exact. Only the native
      // harness aliases, dirty initial state and named witness are inserted.
      // The harness definitions precede their first use in q_init/q_inv.
      const tla = `${body}${"=".repeat(80)}\n`;
      const result = await verifyFixture(tla, true, name);
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain(`RECOVERY_VIEW_VIOLATION_${name}`);
      expect(result.output).toContain("State 2:");
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).not.toContain("No error has been found");
    },
    125_000,
  );
}

for (const [name, initial, update, property, guard = "TRUE"] of controls) {
  test.skipIf(!enabled)(
    `native recovery VIEW retains ${name}`,
    async () => {
      const tla = `---- MODULE api_submission_recovery ----
EXTENDS Integers, FiniteSets
VARIABLE s
initialSender == ${sender}
initialState == ${state}
OwnClaim(r) == ${ownClaim}
LandEnabled(copy) == copy \\in {1,2} /\\ copy \\in s.posts /\\
 (\\E id \\in {1,2}: s.senders[id].attempt = copy /\\ s.senders[id].posted /\\ ~(s.senders[id].outcome \\in {"terminal","retryable","throttled"}))
q_init == s = ${initial ? `[initialState EXCEPT ${initial}]` : "initialState"}
q_step == ${guard} /\\ s' = [s EXCEPT ${update}]
q_inv == ${property}
====
`;
      const result = await verifyFixture(tla, true, name);
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain(`RECOVERY_VIEW_VIOLATION_${name}`);
      expect(result.output).toContain("State 2:");
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).not.toContain("No error has been found");
    },
    35_000,
  );
}

for (const [name, first, second] of [
  [
    "write-only-and-dead-terminal-payload",
    "!.senders[1].attempt = 1, !.senders[1].readRevision = 1",
    '!.senders[1].attempt = 1, !.senders[1].readRevision = 8, !.senders[1].response = "lost", !.absenceObserved = TRUE, !.receiptReplyLost = TRUE',
  ],
  [
    "already-false-own-claim",
    `${readyClaim}, !.posts = {1}, !.senders[1].attempt = 1, !.senders[1].matched = FALSE`,
    `${readyClaim}, !.posts = {1}, !.senders[1].attempt = 1, !.senders[1].usableRevision = 3`,
  ],
] as const) {
  test.skipIf(!enabled)(
    `native recovery VIEW coalesces ${name} raw2/view1`,
    async () => {
      const tla = `---- MODULE api_submission_recovery ----
EXTENDS Integers, FiniteSets
VARIABLE s
initialSender == ${sender}
initialState == ${state}
q_init == (s = [initialState EXCEPT ${first}]) \\/ (s = [initialState EXCEPT ${second}])
q_step == s' = s
q_inv == TRUE
====
`;
      for (const viewed of [false, true]) {
        const result = await verifyFixture(tla, viewed, name);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("No error has been found");
        expect(result.output).toContain(`RECOVERY_VIEW_COMPLETE_${name}`);
        expect(result.output).toContain(
          `${viewed ? 1 : 2} distinct states found, 0 states left on queue`,
        );
      }
    },
    70_000,
  );
}
