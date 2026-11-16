/** Source guards and native observation probes for the wallet-provider VIEW. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readSafetyViews } from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const model = "formal/models/ui/solana_wallet_provider.qnt";
const source = readFileSync(resolve(root, model), "utf8");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const reviewedSource =
  "5256522b9bcddb34689d809d593abbddc172aa4a211349029dda65dbc4da9c48";
const selected = readSafetyViews(root).views.find(
  (view: { model: string }) => view.model === model,
);
if (!selected) throw new Error("Missing reviewed wallet-provider VIEW");
function requireReviewedSource(text: string) {
  if (hash(text) !== reviewedSource)
    throw new Error("Wallet-provider observation quotient needs review");
}
test("wallet VIEW binds the entire unchanged concrete model", () => {
  requireReviewedSource(source);
  expect(selected.sourceSha256).toBe(reviewedSource);
});
test("new output, terminal, effect or cross-slot reads require review", () => {
  for (const [before, after] of [
    [
      'op.phase == "provider-wait",',
      'op.phase == "provider-wait", op.usedObject == s.accountObject,',
    ],
    [
      'op.phase == "provider-wait",',
      'op.phase == "provider-wait", op.result == "provider-error",',
    ],
    [
      's.operations.get(id).phase == "unused",',
      'Set("unused", "done").contains(s.operations.get(id).phase),',
    ],
    [
      'all { op.invoked, op.method == "send",',
      'all { op.invoked, op.method == "send", op.address == s.address,',
    ],
    [
      'all { op.invoked, op.method == "send",',
      'all { op.invoked, op.method == "send", op.usedObject == s.accountObject,',
    ],
    [
      's.phase == "connected", ids.contains(id),',
      's.phase == "connected", s.operations.get(2).checked, ids.contains(id),',
    ],
    ['op.result == "ok"', 'Set("ok", "provider-error").contains(op.result)'],
    [
      'not(s.configured), Set("standard", "legacy").contains(kind),',
      'not(s.configured), s.operations.get(1).reconnected, Set("standard", "legacy").contains(kind),',
    ],
    [
      "  def ended(op: Operation, result: str): Operation =",
      "  def futureRead(id: int): bool = s.operations.get(id).usedObject == s.accountObject\n  def ended(op: Operation, result: str): Operation =",
    ],
    [
      'all { op.invoked, op.method == "send",',
      'all { op.invoked, op.method == "send", s.sendFeature,',
    ],
    [
      'all { op.phase == "provider-wait", outcomes(op.method).contains(outcome),',
      'all { op.phase == "provider-wait", s.messageFeature, outcomes(op.method).contains(outcome),',
    ],
    [
      's.phase == "connected" implies addresses.contains(s.capturedAddress),',
      's.phase == "connected" implies addresses.contains(s.capturedAddress) and s.exposedSend,',
    ],
    [
      'else if (method == "transaction") s.with("transactionFeature", false) else s.with("sendFeature", false)',
      'else if (method == "transaction") s.with("transactionFeature", false).with("address", if (s.transactionFeature) 1 else 2) else s.with("sendFeature", false)',
    ],
    [
      'def ended(op: Operation, result: str): Operation = op.with("phase", "done").with("result", result)',
      'def ended(op: Operation, result: str): Operation = op.with("phase", "unused").with("result", result)',
    ],
    [
      'all { op.phase == "provider-wait", outcomes(op.method).contains(outcome),',
      'all { op.phase == "provider-wait", op.address == s.address, outcomes(op.method).contains(outcome),',
    ],
    [
      'all { op.phase == "provider-wait", outcomes(op.method).contains(outcome),',
      'all { op.phase == "provider-wait", s.chains.contains(op.chain), outcomes(op.method).contains(outcome),',
    ],
    [
      'val accepted = outcome == "exact"',
      'val accepted = op.result == "ok" or outcome == "exact"',
    ],
    [
      'val accepted = outcome == "exact"',
      'val accepted = op.encoded or outcome == "exact"',
    ],
    [
      'all { op.phase == "provider-wait", outcomes(op.method).contains(outcome),',
      'all { op.phase == "provider-wait", s.operations.get(2).checked, outcomes(op.method).contains(outcome),',
    ],
    [
      'all { op.phase == "reconnect-wait",',
      'all { Set("reconnect-wait", "provider-wait").contains(op.phase),',
    ],
    [
      "op.invoked implies op.checked and op.matched",
      "op.address == 1 and (op.invoked implies op.checked and op.matched)",
    ],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => requireReviewedSource(changed)).toThrow("needs review");
  }
});

const operation = `[phase |-> "done", method |-> "text", address |-> 1, chain |-> 1,
 checked |-> TRUE, matched |-> TRUE, registered |-> TRUE, feature |-> TRUE,
 chainMatch |-> TRUE, legacyFormat |-> TRUE, usedObject |-> 1, reconnected |-> TRUE,
 callback |-> TRUE, invoked |-> TRUE, encoded |-> FALSE, result |-> "none"]`;
const fresh = `[phase |-> "gate", method |-> "message", address |-> 1, chain |-> 1,
 checked |-> FALSE, matched |-> FALSE, registered |-> FALSE, feature |-> FALSE,
 chainMatch |-> FALSE, legacyFormat |-> FALSE, usedObject |-> 0, reconnected |-> FALSE,
 callback |-> FALSE, invoked |-> FALSE, encoded |-> FALSE, result |-> "none"]`;
const state = `[configured |-> FALSE, kind |-> "standard", phase |-> "connected",
 registered |-> TRUE, address |-> 1, accountObject |-> 1, capturedAddress |-> 1,
 exposedTransaction |-> TRUE, exposedSend |-> TRUE, messageFeature |-> TRUE,
 transactionFeature |-> TRUE, sendFeature |-> TRUE, chains |-> {1,2},
 transactionLegacy |-> TRUE, sendLegacy |-> TRUE,
 operations |-> [id \\in {1,2} |-> IF id = 2 THEN [initialOperation EXCEPT !.phase = "unused"] ELSE initialOperation], effects |-> {}]`;
const b1 =
  "(s.operations[1].invoked => (s.operations[1].checked /\\ s.operations[1].matched /\\ s.operations[1].feature /\\ s.operations[1].chainMatch /\\ s.operations[1].legacyFormat))";
const b2 = "(s.operations[1].invoked => s.operations[1].registered)";
const b3 = "(s.operations[1].invoked => s.operations[1].reconnected)";
const originalB2 =
  '(s.operations[1].invoked /\\ s.kind = "standard" => s.operations[1].registered)';
const originalB3 =
  '(s.operations[1].invoked /\\ s.kind = "legacy" => s.operations[1].reconnected)';
const b4 =
  '(s.operations[1].invoked /\\ s.operations[1].method = "send" => s.operations[1].callback)';
const b5 =
  '(s.operations[1].encoded => (s.operations[1].method = "text" /\\ s.operations[1].result = "ok"))';
const b6 =
  '((1 \\in s.effects) => (s.operations[1].invoked /\\ s.operations[1].method = "send"))';
type Control = readonly [string, string, string, string];
// Each property isolates its named observation. No unrelated original
// invariant conjunct can make a reachability probe pass accidentally.
const controls: Control[] = [
  ["address-domain", "", "!.address = 3", "s.address \\in {0,1,2}"],
  [
    "captured-address-domain",
    "",
    "!.capturedAddress = 3",
    "s.capturedAddress \\in {0,1,2}",
  ],
  ["effect-domain", "", "!.effects = {3}", "s.effects \\subseteq {1,2}"],
  [
    "connected-captured-address",
    "",
    "!.capturedAddress = 0",
    '(s.phase = "connected" => s.capturedAddress \\in {1,2})',
  ],
  [
    "false-invocation-repair",
    "!.operations[1].checked = FALSE",
    "!.operations[1].checked = TRUE",
    `~${b1}`,
  ],
  [
    "standard-registration",
    "",
    "!.operations[1].registered = FALSE",
    originalB2,
  ],
  [
    "false-standard-registration-repair",
    "!.operations[1].registered = FALSE",
    "!.operations[1].registered = TRUE",
    `~${originalB2}`,
  ],
  [
    "dormant-registration-observation",
    '!.kind = "legacy"',
    "!.operations[1].registered = FALSE",
    b2,
  ],
  [
    "configure-exposes-false-registration",
    '!.kind = "legacy", !.operations[1].registered = FALSE',
    '!.kind = "standard", !.configured = TRUE',
    originalB2,
  ],
  [
    "legacy-reconnect",
    '!.kind = "legacy"',
    "!.operations[1].reconnected = FALSE",
    originalB3,
  ],
  [
    "false-legacy-reconnect-repair",
    '!.kind = "legacy", !.operations[1].reconnected = FALSE',
    "!.operations[1].reconnected = TRUE",
    `~${originalB3}`,
  ],
  [
    "dormant-reconnect-observation",
    "",
    "!.operations[1].reconnected = FALSE",
    b3,
  ],
  [
    "configure-exposes-false-reconnect",
    "!.operations[1].reconnected = FALSE",
    '!.kind = "legacy", !.configured = TRUE',
    originalB3,
  ],
  [
    "send-callback",
    '!.operations[1].method = "send"',
    "!.operations[1].callback = FALSE",
    b4,
  ],
  [
    "false-send-callback-repair",
    '!.operations[1].method = "send", !.operations[1].callback = FALSE',
    "!.operations[1].callback = TRUE",
    `~${b4}`,
  ],
  [
    "encoded-result",
    '!.operations[1].encoded = TRUE, !.operations[1].result = "ok"',
    '!.operations[1].result = "invalid-result"',
    b5,
  ],
  [
    "false-encoded-result-repair",
    "!.operations[1].encoded = TRUE",
    '!.operations[1].result = "ok"',
    `~${b5}`,
  ],
  [
    "encoded-method",
    '!.operations[1].encoded = TRUE, !.operations[1].result = "ok"',
    '!.operations[1].method = "message"',
    b5,
  ],
  [
    "effect-needs-send-invocation",
    '!.operations[1].method = "send", !.effects = {1}',
    "!.operations[1].invoked = FALSE",
    b6,
  ],
  [
    "false-effect-invocation-repair",
    '!.operations[1].method = "send", !.operations[1].invoked = FALSE, !.effects = {1}',
    "!.operations[1].invoked = TRUE",
    `~${b6}`,
  ],
  [
    "effect-needs-send-method",
    '!.operations[1].method = "send", !.effects = {1}',
    '!.operations[1].method = "text"',
    b6,
  ],
  [
    "late-effect-invoked-guard",
    '!.operations[1].invoked = FALSE, !.operations[1].method = "send"',
    "!.operations[1].invoked = TRUE",
    "~s.operations[1].invoked",
  ],
  [
    "late-effect-method-guard",
    "",
    '!.operations[1].method = "send"',
    's.operations[1].method # "send"',
  ],
  [
    "late-effect-after-terminal",
    '!.operations[1].method = "send"',
    "!.effects = s.effects \\cup {1}",
    "~(1 \\in s.effects)",
  ],
  [
    "dirty-unused-invocation-reset",
    '!.operations[1].phase = "unused", !.operations[1].checked = FALSE',
    "!.operations[1] = freshOperation",
    `~${b1}`,
  ],
  [
    "dirty-unused-effect-reset",
    '!.operations[1].phase = "unused", !.operations[1].method = "send", !.effects = {1}',
    "!.operations[1] = freshOperation",
    b6,
  ],
  [
    "live-method",
    '!.operations[1].phase = "provider-wait"',
    '!.operations[1].method = "message"',
    's.operations[1].method = "text"',
  ],
  [
    "live-captured-address",
    '!.operations[1].phase = "gate"',
    "!.operations[1].address = 2",
    "s.operations[1].address = s.address",
  ],
  [
    "live-requested-chain",
    '!.operations[1].phase = "gate"',
    "!.operations[1].chain = 2",
    "s.operations[1].chain = 1",
  ],
  [
    "pre-gate-result-class",
    '!.operations[1].phase = "gate", !.operations[1].result = "ok"',
    '!.operations[1].result = "provider-error"',
    's.operations[1].result = "ok"',
  ],
  [
    "global-account-object-guard",
    "",
    "!.accountObject = 2",
    "s.accountObject = 1",
  ],
  [
    "current-message-feature",
    "",
    "!.messageFeature = FALSE",
    "s.messageFeature",
  ],
  ["current-registration", "", "!.registered = FALSE", "s.registered"],
  ["current-chain-membership", "", "!.chains = {2}", "1 \\in s.chains"],
];
for (const field of [
  "checked",
  "matched",
  "feature",
  "chainMatch",
  "legacyFormat",
])
  controls.push([
    `invocation-${field}`,
    "",
    `!.operations[1].${field} = FALSE`,
    b1,
  ]);

// The original fixtures keep a spare unused operation, so active capability
// consumers remain observable. These additional fixtures close both slots.
const closed = (initial: string) =>
  `!.operations[2].phase = "done"${initial ? `, ${initial}` : ""}`;
for (const name of [
  "address-domain",
  "captured-address-domain",
  "effect-domain",
  "connected-captured-address",
  "false-invocation-repair",
  "standard-registration",
  "false-standard-registration-repair",
  "dormant-registration-observation",
  "configure-exposes-false-registration",
  "legacy-reconnect",
  "false-legacy-reconnect-repair",
  "dormant-reconnect-observation",
  "configure-exposes-false-reconnect",
  "send-callback",
  "false-send-callback-repair",
  "encoded-result",
  "false-encoded-result-repair",
  "encoded-method",
  "effect-needs-send-invocation",
  "false-effect-invocation-repair",
  "global-account-object-guard",
  "current-registration",
  "current-chain-membership",
  "invocation-checked",
  "invocation-matched",
  "invocation-feature",
  "invocation-chainMatch",
  "invocation-legacyFormat",
]) {
  const original = controls.find(([label]) => label === name);
  if (!original)
    throw new Error(`Missing original closed-cone control: ${name}`);
  controls.push([
    `closed-${name}`,
    closed(original[1]),
    original[2],
    original[3],
  ]);
}
controls.push(
  [
    "closed-provider-method",
    closed('!.operations[1].phase = "provider-wait"'),
    '!.operations[1].method = "message"',
    's.operations[1].method = "text"',
  ],
  [
    "last-gate-captured-address",
    closed('!.operations[1].phase = "gate"'),
    "!.operations[1].address = 2",
    "s.operations[1].address = 1",
  ],
  [
    "last-gate-requested-chain",
    closed('!.operations[1].phase = "gate"'),
    "!.operations[1].chain = 2",
    "s.operations[1].chain = 1",
  ],
  [
    "last-gate-result-class",
    closed('!.operations[1].phase = "gate", !.operations[1].result = "ok"'),
    '!.operations[1].result = "provider-error"',
    's.operations[1].result = "ok"',
  ],
  // Exact begin/update shapes isolate last-boundary captures before erasure.
  [
    "last-begin-unsupported-capture",
    "!.exposedTransaction = FALSE, !.capturedAddress = 2",
    '!.operations[2] = [freshOperation EXCEPT !.phase = "done", !.method = "transaction", !.address = s.capturedAddress, !.chain = 2, !.result = "unsupported"]',
    's.operations[2].phase = "unused"',
  ],
  [
    "last-standard-gate-invokes",
    '!.operations[2] = [freshOperation EXCEPT !.phase = "gate"], !.messageFeature = TRUE',
    '!.operations[2] = [s.operations[2] EXCEPT !.phase = "provider-wait", !.checked = TRUE, !.matched = TRUE, !.registered = s.registered, !.feature = s.messageFeature, !.chainMatch = TRUE, !.legacyFormat = TRUE, !.usedObject = s.accountObject, !.invoked = TRUE]',
    "~s.operations[2].invoked",
  ],
  [
    "last-legacy-reconnect-invokes",
    '!.kind = "legacy", !.operations[2] = [freshOperation EXCEPT !.phase = "reconnect-wait", !.reconnected = TRUE]',
    '!.operations[2] = [s.operations[2] EXCEPT !.phase = "provider-wait", !.checked = TRUE, !.matched = TRUE, !.feature = TRUE, !.chainMatch = TRUE, !.legacyFormat = TRUE, !.usedObject = s.accountObject, !.invoked = TRUE]',
    "~s.operations[2].invoked",
  ],
  [
    "connect-reply-captures-before-mask",
    closed('!.phase = "connecting", !.capturedAddress = 0'),
    '!.phase = "connected", !.capturedAddress = 2, !.exposedTransaction = TRUE, !.exposedSend = TRUE',
    "s.capturedAddress = 0",
  ],
);

// V3 keeps the prior invariant controls and retargets only four probes of
// diagnostic values consumed before provider-wait to the still-exact gate.
// A waiting operation now exposes the six truth observations, not those bytes.
const waiting = (initial: string) =>
  `!.operations[1].phase = "provider-wait"${initial ? `, ${initial}` : ""}`;
for (const name of [
  "false-invocation-repair",
  "standard-registration",
  "false-standard-registration-repair",
  "dormant-registration-observation",
  "configure-exposes-false-registration",
  "legacy-reconnect",
  "false-legacy-reconnect-repair",
  "dormant-reconnect-observation",
  "configure-exposes-false-reconnect",
  "send-callback",
  "false-send-callback-repair",
  "encoded-result",
  "false-encoded-result-repair",
  "encoded-method",
  "effect-needs-send-invocation",
  "false-effect-invocation-repair",
  "effect-needs-send-method",
  "invocation-checked",
  "invocation-matched",
  "invocation-feature",
  "invocation-chainMatch",
  "invocation-legacyFormat",
  "late-effect-invoked-guard",
  "late-effect-method-guard",
  "late-effect-after-terminal",
]) {
  const original = controls.find(([label]) => label === name);
  if (!original) throw new Error(`Missing waiting control: ${name}`);
  controls.push([
    `waiting-${name}`,
    waiting(original[1]),
    original[2],
    original[3],
  ]);
}
for (const name of [
  "configure-exposes-false-registration",
  "configure-exposes-false-reconnect",
]) {
  const original = controls.find(([label]) => label === name);
  if (!original)
    throw new Error(`Missing drained waiting kind control: ${name}`);
  controls.push([
    `drained-waiting-${name}`,
    closed(waiting(original[1])),
    original[2],
    original[3],
  ]);
}
controls.push(
  [
    "waiting-accepted-reply-repairs-false-B5",
    closed(
      waiting(
        '!.operations[1].encoded = TRUE, !.operations[1].result = "none"',
      ),
    ),
    '!.operations[1] = [s.operations[1] EXCEPT !.phase = "done", !.encoded = TRUE, !.result = "ok"]',
    `~${b5}`,
  ],
  [
    "waiting-refused-reply-repairs-false-B5",
    closed(
      waiting(
        '!.operations[1].encoded = TRUE, !.operations[1].result = "none"',
      ),
    ),
    '!.operations[1] = [s.operations[1] EXCEPT !.phase = "done", !.encoded = FALSE, !.result = "provider-error"]',
    `~${b5}`,
  ],
);

// Successful first-use crossings carry a potentially false incoming B5;
// only providerReply may replace it with the proven true post-reply value.
const secondB5 = b5.replaceAll("[1]", "[2]");
controls.push(
  [
    "last-dirty-standard-gate-carries-false-B5",
    '!.operations[2] = [freshOperation EXCEPT !.phase = "gate", !.method = "text", !.encoded = TRUE, !.result = "none"]',
    '!.operations[2] = [s.operations[2] EXCEPT !.phase = "provider-wait", !.checked = TRUE, !.matched = TRUE, !.registered = s.registered, !.feature = s.messageFeature, !.chainMatch = TRUE, !.legacyFormat = TRUE, !.usedObject = s.accountObject, !.callback = FALSE, !.invoked = TRUE]',
    `(s.operations[2].phase = "provider-wait" => ${secondB5})`,
  ],
  [
    "last-dirty-legacy-reconnect-carries-false-B5",
    '!.kind = "legacy", !.operations[2] = [freshOperation EXCEPT !.phase = "reconnect-wait", !.method = "text", !.encoded = TRUE, !.result = "none", !.reconnected = TRUE]',
    '!.operations[2] = [s.operations[2] EXCEPT !.phase = "provider-wait", !.checked = TRUE, !.matched = TRUE, !.feature = TRUE, !.chainMatch = TRUE, !.legacyFormat = TRUE, !.usedObject = s.accountObject, !.invoked = TRUE]',
    `(s.operations[2].phase = "provider-wait" => ${secondB5})`,
  ],
  [
    "last-gate-refusal-preserves-raw-terminal-B5",
    '!.registered = FALSE, !.operations[2] = [freshOperation EXCEPT !.phase = "gate", !.method = "text", !.encoded = TRUE, !.result = "ok"]',
    '!.operations[2] = [s.operations[2] EXCEPT !.phase = "done", !.checked = TRUE, !.matched = TRUE, !.registered = FALSE, !.feature = s.messageFeature, !.chainMatch = TRUE, !.legacyFormat = TRUE, !.usedObject = s.accountObject, !.callback = FALSE, !.invoked = FALSE, !.result = "wallet-changed"]',
    secondB5,
  ],
);

for (const [name, initial, update, invariant] of controls) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native wallet VIEW retains the ${name} counterexample`,
    async () => {
      const tla = `---- MODULE solana_wallet_provider ----
EXTENDS Integers, FiniteSets
VARIABLE s
initialOperation == ${operation}
freshOperation == ${fresh}
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
      const marker = `WALLET_VIEW_COUNTEREXAMPLE_${name}`;
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
        label: `wallet-view-${name}`,
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

// Positive projection diagnostic: a false B1 remains false while its consumed
// operands and output bytes change. The named property is TRUE alone; no
// unrelated original invariant can manufacture a counterexample or a pass.
test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
  "native waiting VIEW coalesces consumed payloads while retaining a false B1",
  async () => {
    const initial = closed(waiting("!.operations[1].matched = FALSE"));
    const update =
      '!.operations[1].address = 2, !.operations[1].chain = 2, !.operations[1].checked = FALSE, !.operations[1].feature = FALSE, !.operations[1].chainMatch = FALSE, !.operations[1].legacyFormat = FALSE, !.operations[1].usedObject = 2, !.operations[1].callback = FALSE, !.operations[1].encoded = TRUE, !.operations[1].result = "ok"';
    const tla = `---- MODULE solana_wallet_provider ----
EXTENDS Integers, FiniteSets
VARIABLE s
initialOperation == ${operation}
initialState == ${state}
q_init == s = [initialState EXCEPT ${initial}]
q_step == s' = [s EXCEPT ${update}]
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
      const marker = `WAITING_COALESCING_${useView ? "VIEWED" : "RAW"}`;
      const probe = `
        import {readFileSync} from 'node:fs';
        import {createRequire} from 'node:module';
        import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from './scripts/quint-safety-view.mjs';
        const require=createRequire(import.meta.url);
        const manifest=readSafetyViews(process.cwd());
        const raw={moduleName:'solana_wallet_provider',tlaCode:${JSON.stringify(tla)},hasInvariant:true,hasTemporal:false};
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
        timeoutMs: 30_000,
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
  70_000,
);
