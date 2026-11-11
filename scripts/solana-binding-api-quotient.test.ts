/** Exact-source and native observation controls for the Solana API VIEW. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readSafetyViews } from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const model = "formal/models/payments/solana_binding_api.qnt";
const source = readFileSync(resolve(root, model), "utf8");
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const selected = readSafetyViews(root).views.find(
  (entry: { model: string }) => entry.model === model,
);
if (!selected)
  throw new Error("Missing reviewed Solana binding API safety view");
function checkReviewedSource(text: string) {
  if (
    sha256(text) !==
    "c9fb501258ad70a6269f234c53617cf2d7fbdc154cbe47355a82d433a87fd28d"
  )
    throw new Error("Solana binding observation quotient needs review");
}
test("Solana VIEW binds the complete reviewed concrete model", () => {
  checkReviewedSource(source);
  expect(sha256(source)).toBe(selected.sourceSha256);
});
test("new output, ledger, terminal or cross-slot reads require renewed review", () => {
  for (const [before, after] of [
    ['request.phase == "json",', 'request.phase == "json", request.emptyId,'],
    [
      'request.phase == "inflight",',
      'request.phase == "inflight", request.response == "lost",',
    ],
    [
      'request.phase == "response",',
      'request.phase == "response", request.desired == "503-unavailable",',
    ],
    [
      's.ledger.get(scope) != "unavailable"',
      's.ledger.get(scope) == "prepared"',
    ],
    [
      's.requests.get(id).phase == "unused",',
      'Set("unused", "done").contains(s.requests.get(id).phase),',
    ],
    [
      'request.phase == "response",',
      'request.phase == "response", request.claim == s.claim,',
    ],
    [
      "s.requests.get(id).dispatched,",
      "s.requests.get(id).dispatched, s.requests.get(id).dispatchClaim == s.claim,",
    ],
    [
      'request.phase == "audit-write",',
      'request.phase == "audit-write", s.requests.get(2).owner,',
    ],
    [
      "s.requests.get(id).dispatched,",
      "s.requests.get(id).dispatched, s.requests.get(id).stamp == s.now,",
    ],
    [
      "scopes.contains(s.claim),",
      "scopes.contains(s.claim), s.requests.get(1).emptyId,",
    ],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => checkReviewedSource(changed)).toThrow("needs review");
  }
});
const request = `[phase |-> "done", mode |-> "prepare", stamp |-> -1,
 admitted |-> FALSE, scope |-> 0, claim |-> 0, attempt |-> 0,
 owner |-> FALSE, audited |-> FALSE, context |-> FALSE, contextClaim |-> 0,
 dispatched |-> FALSE, dispatchScope |-> 0, dispatchClaim |-> 0,
 dispatchAttempt |-> 0, requestTransaction |-> FALSE, replyTransaction |-> FALSE,
 replyContext |-> FALSE, emptyId |-> FALSE, desired |-> "none", response |-> "none"]`;
const state = `[configured |-> TRUE, now |-> 0, claim |-> 1, profile |-> "both",
 deployments |-> TRUE, owned |-> TRUE,
 ledger |-> [scope \\in {1,2} |-> "prepared"], audits |-> {},
 auditStamps |-> [id \\in {1,2} |-> 0], effects |-> {},
 requests |-> [id \\in {1,2} |-> initialRequest]]`;
// Each native probe has one named property alone. False-to-true controls and
// dirty unused resets intentionally do not assume the model invariant holds.
const controls = [
  ["clock-domain", "", "!.now = 3", "s.now \\in {0,1,2}"],
  ["claim-domain", "", "!.claim = 3", "s.claim \\in {1,2}"],
  ["audit-domain", "", "!.audits = {3}", "s.audits \\subseteq {1,2}"],
  ["effect-domain", "", "!.effects = {3}", "s.effects \\subseteq {1,2}"],
  [
    "audit-membership",
    "",
    "!.audits = {1}",
    "s.requests[1].audited = (1 \\in s.audits)",
  ],
  [
    "false-audit-membership-repair",
    "!.audits = {1}",
    "!.audits = {}",
    "~(s.requests[1].audited = (1 \\in s.audits))",
  ],
  [
    "audit-owner",
    "!.requests[1].audited = TRUE, !.requests[1].owner = TRUE, !.requests[1].stamp = 0, !.audits = {1}",
    "!.requests[1].owner = FALSE",
    "(s.requests[1].audited => (s.requests[1].owner /\\ s.auditStamps[1] = s.requests[1].stamp))",
  ],
  [
    "false-audit-owner-repair",
    "!.requests[1].audited = TRUE, !.requests[1].owner = FALSE, !.requests[1].stamp = 0, !.audits = {1}",
    "!.requests[1].owner = TRUE",
    "~((s.requests[1].audited => (s.requests[1].owner /\\ s.auditStamps[1] = s.requests[1].stamp)))",
  ],
  [
    "audit-captured-stamp",
    "!.requests[1].audited = TRUE, !.requests[1].owner = TRUE, !.requests[1].stamp = 0, !.audits = {1}",
    "!.auditStamps[1] = 1",
    "(s.requests[1].audited => (s.requests[1].owner /\\ s.auditStamps[1] = s.requests[1].stamp))",
  ],
  [
    "private-scope-authority",
    "!.requests[1].scope = 1",
    "!.requests[1].scope = 2",
    "(s.requests[1].scope = 2 => (s.requests[1].owner /\\ s.requests[1].audited))",
  ],
  [
    "false-private-scope-repair",
    "!.requests[1].scope = 2",
    "!.requests[1].scope = 1",
    "~((s.requests[1].scope = 2 => (s.requests[1].owner /\\ s.requests[1].audited)))",
  ],
  [
    "dispatch-snapshot",
    "!.requests[1].dispatched = TRUE, !.requests[1].admitted = TRUE, !.requests[1].scope = 1, !.requests[1].claim = 1, !.requests[1].attempt = 11, !.requests[1].dispatchScope = 1, !.requests[1].dispatchClaim = 1, !.requests[1].dispatchAttempt = 11",
    "!.requests[1].dispatchClaim = 2",
    '(s.requests[1].dispatched => (s.requests[1].admitted /\\ s.requests[1].scope \\in {1, 2} /\\ s.requests[1].dispatchScope = s.requests[1].scope /\\ s.requests[1].dispatchClaim = s.requests[1].claim /\\ s.requests[1].dispatchAttempt = s.requests[1].attempt /\\ s.requests[1].requestTransaction = (s.requests[1].mode = "complete")))',
  ],
  [
    "false-dispatch-snapshot-repair",
    "!.requests[1].dispatched = TRUE, !.requests[1].admitted = TRUE, !.requests[1].scope = 1, !.requests[1].claim = 1, !.requests[1].attempt = 11, !.requests[1].dispatchScope = 1, !.requests[1].dispatchClaim = 1, !.requests[1].dispatchAttempt = 11, !.requests[1].dispatchClaim = 2",
    "!.requests[1].dispatchClaim = 1",
    '~((s.requests[1].dispatched => (s.requests[1].admitted /\\ s.requests[1].scope \\in {1, 2} /\\ s.requests[1].dispatchScope = s.requests[1].scope /\\ s.requests[1].dispatchClaim = s.requests[1].claim /\\ s.requests[1].dispatchAttempt = s.requests[1].attempt /\\ s.requests[1].requestTransaction = (s.requests[1].mode = "complete"))))',
  ],
  [
    "effect-needs-dispatch",
    "",
    "!.effects = {1}",
    "((1 \\in s.effects) => s.requests[1].dispatched)",
  ],
  [
    "false-effect-needs-dispatch-repair",
    "!.effects = {1}",
    "!.requests[1].dispatched = TRUE",
    "~(((1 \\in s.effects) => s.requests[1].dispatched))",
  ],
  [
    "context-claim",
    "!.requests[1].context = TRUE, !.requests[1].claim = 1, !.requests[1].contextClaim = 1",
    "!.requests[1].contextClaim = 2",
    '(s.requests[1].context => (s.requests[1].mode = "prepare" /\\ s.requests[1].contextClaim = s.requests[1].claim))',
  ],
  [
    "false-context-claim-repair",
    "!.requests[1].context = TRUE, !.requests[1].claim = 1, !.requests[1].contextClaim = 1, !.requests[1].contextClaim = 2",
    "!.requests[1].contextClaim = 1",
    '~((s.requests[1].context => (s.requests[1].mode = "prepare" /\\ s.requests[1].contextClaim = s.requests[1].claim)))',
  ],
  [
    "transaction-reply-mode",
    '!.requests[1].replyTransaction = TRUE, !.requests[1].desired = "200"',
    '!.requests[1].mode = "complete"',
    '(s.requests[1].replyTransaction => (s.requests[1].mode = "prepare" /\\ s.requests[1].desired = "200"))',
  ],
  [
    "false-transaction-reply-mode-repair",
    '!.requests[1].replyTransaction = TRUE, !.requests[1].desired = "200", !.requests[1].mode = "complete"',
    '!.requests[1].mode = "prepare"',
    '~((s.requests[1].replyTransaction => (s.requests[1].mode = "prepare" /\\ s.requests[1].desired = "200")))',
  ],
  [
    "context-reply",
    '!.requests[1].replyContext = TRUE, !.requests[1].context = TRUE, !.requests[1].claim = 1, !.requests[1].contextClaim = 1, !.requests[1].desired = "200"',
    "!.requests[1].context = FALSE",
    '(s.requests[1].replyContext => (s.requests[1].context /\\ s.requests[1].desired = "200"))',
  ],
  [
    "false-context-reply-repair",
    '!.requests[1].replyContext = TRUE, !.requests[1].context = TRUE, !.requests[1].claim = 1, !.requests[1].contextClaim = 1, !.requests[1].desired = "200", !.requests[1].context = FALSE',
    "!.requests[1].context = TRUE",
    '~((s.requests[1].replyContext => (s.requests[1].context /\\ s.requests[1].desired = "200")))',
  ],
  [
    "success-needs-dispatch",
    "",
    '!.requests[1].desired = "200"',
    '(s.requests[1].desired = "200" => s.requests[1].dispatched)',
  ],
  [
    "false-success-needs-dispatch-repair",
    '!.requests[1].desired = "200"',
    '!.requests[1].desired = "none"',
    '~((s.requests[1].desired = "200" => s.requests[1].dispatched))',
  ],
  [
    "terminal-effect-guard",
    "!.requests[1].dispatched = TRUE, !.requests[1].admitted = TRUE, !.requests[1].scope = 1, !.requests[1].claim = 1, !.requests[1].attempt = 11, !.requests[1].dispatchScope = 1, !.requests[1].dispatchClaim = 1, !.requests[1].dispatchAttempt = 11, !.requests[1].dispatched = FALSE",
    "!.requests[1].dispatched = TRUE",
    "~s.requests[1].dispatched",
  ],
  [
    "unused-reset-audit-membership",
    '!.requests[1].dispatched = TRUE, !.requests[1].admitted = TRUE, !.requests[1].scope = 1, !.requests[1].claim = 1, !.requests[1].attempt = 11, !.requests[1].dispatchScope = 1, !.requests[1].dispatchClaim = 1, !.requests[1].dispatchAttempt = 11, !.requests[1].phase = "unused", !.requests[1].audited = TRUE, !.requests[1].owner = TRUE, !.requests[1].stamp = 0, !.audits = {1}, !.effects = {1}',
    '!.requests[1] = [initialRequest EXCEPT !.phase = "origin", !.mode = "complete", !.stamp = s.now]',
    "s.requests[1].audited = (1 \\in s.audits)",
  ],
  [
    "unused-reset-effect-dependency",
    '!.requests[1].dispatched = TRUE, !.requests[1].admitted = TRUE, !.requests[1].scope = 1, !.requests[1].claim = 1, !.requests[1].attempt = 11, !.requests[1].dispatchScope = 1, !.requests[1].dispatchClaim = 1, !.requests[1].dispatchAttempt = 11, !.requests[1].phase = "unused", !.requests[1].audited = TRUE, !.requests[1].owner = TRUE, !.requests[1].stamp = 0, !.audits = {1}, !.effects = {1}',
    '!.requests[1] = [initialRequest EXCEPT !.phase = "origin", !.mode = "complete", !.stamp = s.now]',
    "((1 \\in s.effects) => s.requests[1].dispatched)",
  ],
  [
    "live-mode",
    '!.requests[1].phase = "body", !.requests[1].mode = "prepare"',
    '!.requests[1].mode = "complete"',
    's.requests[1].mode = "prepare"',
  ],
  [
    "live-stamp",
    '!.requests[1].phase = "audit-write", !.requests[1].stamp = 0',
    "!.requests[1].stamp = 1",
    "s.requests[1].stamp = 0",
  ],
  [
    "live-scope",
    '!.requests[1].phase = "context", !.requests[1].scope = 1',
    "!.requests[1].scope = 2",
    "s.requests[1].scope = 1",
  ],
  [
    "live-claim",
    '!.requests[1].phase = "context", !.requests[1].claim = 1',
    "!.requests[1].claim = 2",
    "s.requests[1].claim = 1",
  ],
  [
    "live-attempt",
    '!.requests[1].phase = "dispatch", !.requests[1].attempt = 11',
    "!.requests[1].attempt = 12",
    "s.requests[1].attempt = 11",
  ],
  [
    "live-owner",
    '!.requests[1].phase = "owner-query", !.requests[1].owner = FALSE',
    "!.requests[1].owner = TRUE",
    "s.requests[1].owner = FALSE",
  ],
  [
    "live-audited",
    '!.requests[1].phase = "private-query", !.requests[1].audited = FALSE',
    "!.requests[1].audited = TRUE",
    "s.requests[1].audited = FALSE",
  ],
  [
    "live-context",
    '!.requests[1].phase = "json", !.requests[1].context = FALSE',
    "!.requests[1].context = TRUE",
    "s.requests[1].context = FALSE",
  ],
  [
    "live-contextClaim",
    '!.requests[1].phase = "json", !.requests[1].contextClaim = 1',
    "!.requests[1].contextClaim = 2",
    "s.requests[1].contextClaim = 1",
  ],
  [
    "live-dispatchScope",
    '!.requests[1].phase = "inflight", !.requests[1].dispatchScope = 1',
    "!.requests[1].dispatchScope = 2",
    "s.requests[1].dispatchScope = 1",
  ],
  [
    "live-dispatchClaim",
    '!.requests[1].phase = "inflight", !.requests[1].dispatchClaim = 1',
    "!.requests[1].dispatchClaim = 2",
    "s.requests[1].dispatchClaim = 1",
  ],
  [
    "live-dispatchAttempt",
    '!.requests[1].phase = "inflight", !.requests[1].dispatchAttempt = 11',
    "!.requests[1].dispatchAttempt = 12",
    "s.requests[1].dispatchAttempt = 11",
  ],
  [
    "live-requestTransaction",
    '!.requests[1].phase = "inflight", !.requests[1].requestTransaction = FALSE',
    "!.requests[1].requestTransaction = TRUE",
    "s.requests[1].requestTransaction = FALSE",
  ],
] as const;

for (const [name, initial, update, invariant] of controls) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `the native Solana binding view retains the ${name} counterexample`,
    async () => {
      const tla = `---- MODULE solana_binding_api ----
EXTENDS Integers, FiniteSets
VARIABLE s
initialRequest == ${request}
initialState == ${state}
q_init == s = ${initial ? `[initialState EXCEPT ${initial}]` : "initialState"}
q_step == s' = [s EXCEPT ${update}]
q_inv == ${invariant}
====
`;
      const definition = `${selected.operator} ==\n  <<${selected.fields.map((field: { expression: string }) => field.expression).join(", ")}>>\n\n`;
      const viewed = tla.replace("====\n", `${definition}====\n`);
      const binding = {
        ...selected,
        translatedSha256: sha256(tla),
        viewTlaSha256: sha256(viewed),
      };
      const witness = `SOLANA_BINDING_VIEW_COUNTEREXAMPLE_${name}`;
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
        label: `solana-binding-view-${name}`,
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
