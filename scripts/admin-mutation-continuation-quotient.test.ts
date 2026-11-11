/** Exact-source guards and native TLC controls for the admin continuation VIEW. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readSafetyViews } from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const modelPath = "formal/models/ui/ui_admin_mutation_identity.qnt";
const model = readFileSync(resolve(root, modelPath), "utf8");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const reviewedSource =
  "aa2359d42de5765cda3fec220fc6716ecba23ca809fe1ea838a55323049c59b8";
const manifest = readSafetyViews(root);
const view = manifest.views.find(
  (entry: { model: string }) => entry.model === modelPath,
);
if (!view) throw new Error("Missing reviewed admin continuation view");

function requireReviewedBoundary(source: string) {
  // Bind the complete schema, literal domains, helpers, concrete actions,
  // step, invariant and scenarios. A new indirect read, terminal reuse or
  // cross-slot dependency must force review, not pass a field-token scan.
  if (hash(source) !== reviewedSource)
    throw new Error("Admin continuation field liveness needs renewed review");
}

test("admin continuation liveness is bound to the complete reviewed source", () => {
  requireReviewedBoundary(model);
  expect(view.sourceSha256).toBe(reviewedSource);
});

test("new payload reads and terminal reuse cannot silently inherit the quotient", () => {
  for (const [before, after] of [
    [
      'r.phase == "recheck-returned",',
      'r.phase == "recheck-returned" and r.accepted,',
    ],
    ['r.phase == "admission",', 'r.phase == "admission" and r.observedAdmin,'],
    [
      "s.mounted, s.data, Set(1, 2, 3).contains(value)",
      "s.mounted, s.data, s.requests.get(1).observedActor == 1, Set(1, 2, 3).contains(value)",
    ],
    [
      's.requests.get(id).phase == "unused",',
      'Set("unused", "done").contains(s.requests.get(id).phase),',
    ],
    [
      "s.mounted, s.data, Set(1, 2, 3).contains(value)",
      "s.mounted, s.data, s.requests.get(1).draft == value, Set(1, 2, 3).contains(value)",
    ],
    [
      "  def owns(id: int): bool =",
      "  def futureDoneRead(id: int): bool = s.requests.get(id).actor == s.cookie\n  def owns(id: int): bool =",
    ],
  ]) {
    const changed = model.replace(before, after);
    expect(changed).not.toBe(model);
    expect(() => requireReviewedBoundary(changed)).toThrow("renewed review");
  }
});

const initial = `[present |-> TRUE, mounted |-> TRUE, lifetime |-> 1,
 actor |-> 1, cookie |-> 1, admin |-> TRUE, data |-> TRUE, draft |-> 1,
 stored |-> 1, active |-> 1, error |-> "none", accepted |-> {1}, callbacks |-> {},
 requests |-> [i \\in {1,2} |-> [phase |-> "recheck-returned", kind |-> "save",
   actor |-> 1, cookie |-> 1, lifetime |-> 1, draft |-> 1, admitted |-> TRUE,
   accepted |-> TRUE, observedActor |-> 1, observedAdmin |-> TRUE]],
 didClear |-> FALSE, clearExpected |-> 0, clearObserved |-> 0]`;
const originalInvariant = `(~s.present => ~s.mounted)
 /\\ s.callbacks \\subseteq s.accepted
 /\\ (s.didClear => s.clearExpected = s.clearObserved)
 /\\ (\\A i \\in {1,2}: s.requests[i].admitted => s.requests[i].cookie = s.requests[i].actor)`;

const controls = [
  [
    "false-clear-witness",
    initial,
    "!.didClear = TRUE, !.clearExpected = 1, !.clearObserved = 2",
    originalInvariant,
  ],
  [
    "callback-without-acceptance",
    initial,
    "!.callbacks = {2}",
    originalInvariant,
  ],
  [
    "mounted-after-dom-departure",
    initial,
    "!.present = FALSE",
    originalInvariant,
  ],
  [
    "false-terminal-admission",
    `[${initial} EXCEPT !.requests[1].phase = "done"]`,
    "!.requests[1].cookie = 2",
    originalInvariant,
  ],
  [
    "false-terminal-captured-actor",
    `[${initial} EXCEPT !.requests[1].phase = "done"]`,
    "!.requests[1].actor = 2",
    originalInvariant,
  ],
  [
    "preflight-observed-actor",
    `[${initial} EXCEPT !.requests[1].phase = "preflight-returned"]`,
    "!.requests[1].observedActor = 2",
    "s.requests[1].observedActor = s.requests[1].actor",
  ],
  [
    "preflight-observed-admin",
    `[${initial} EXCEPT !.requests[1].phase = "preflight-returned"]`,
    "!.requests[1].observedAdmin = FALSE",
    "s.requests[1].observedAdmin",
  ],
  [
    "recheck-observed-actor",
    initial,
    "!.requests[1].observedActor = 2",
    "s.requests[1].observedActor = s.requests[1].actor",
  ],
  [
    "recheck-observed-admin",
    initial,
    "!.requests[1].observedAdmin = FALSE",
    "s.requests[1].observedAdmin",
  ],
  [
    "request-error-class",
    initial,
    '!.error = "request"',
    's.error # "request"',
  ],
  [
    "saved-request-draft",
    initial,
    "!.requests[1].draft = 2",
    "s.requests[1].draft = s.draft",
  ],
  [
    "request-lifetime",
    initial,
    "!.requests[1].lifetime = 2",
    "s.requests[1].lifetime = s.lifetime",
  ],
  ["session-cookie", initial, "!.cookie = 2", "s.cookie = 1"],
  ["active-owner", initial, "!.active = 2", "s.active = 1"],
  ["stored-draft", initial, "!.stored = 2", "s.stored = 1"],
] as const;

for (const [name, state, update, invariant] of controls) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native admin VIEW retains the ${name} counterexample`,
    async () => {
      // Tiny test-only TLA inputs exercise the official native TLC runner.
      // The production model, domains/actions and allowlist are unchanged.
      // Continued-read controls show fields remain distinct in their live
      // phases; only the four safety controls use the original invariant.
      const tla = `---- MODULE ${view.module} ----
EXTENDS Integers, FiniteSets
VARIABLE s
q_init == s = ${state}
q_step == s' = [s EXCEPT ${update}]
q_inv == ${invariant}
====
`;
      const expressions = [
        ...view.fields.map((field: { expression: string }) => field.expression),
        ...view.clauses.map(
          (clause: { expression: string }) => clause.expression,
        ),
      ];
      const inserted = `${view.operator} ==\n  <<${expressions.join(", ")}>>\n\n`;
      const viewed = tla.replace("====\n", `${inserted}====\n`);
      const binding = {
        ...view,
        translatedSha256: hash(tla),
        viewTlaSha256: hash(viewed),
      };
      const probe = `
        import {readFileSync} from 'node:fs';
        import {createRequire} from 'node:module';
        import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from './scripts/quint-safety-view.mjs';
        const require=createRequire(import.meta.url);
        const manifest=readSafetyViews(process.cwd());
        const view=${JSON.stringify(binding)};
        const prepared=applySafetyView(view,{moduleName:view.module,tlaCode:${JSON.stringify(tla)},hasInvariant:true,hasTemporal:false});
        const runner=loadSafetyViewTlc(require.resolve('@informalsystems/quint/dist/src/tlc.js'),manifest);
        const result=await runner.verify(prepared,'0.62.4',JSON.parse(readFileSync('formal/tlc.json','utf8')),3);
        if(!result.isLeft()||!result.value.isViolation)process.exit(2);
        console.log('ADMIN_VIEW_COUNTEREXAMPLE_CONFIRMED');
        process.exit(1);
      `;
      let output = "";
      const status = await runE2ePhase({
        label: `admin-view-${name}`,
        command: "node",
        args: ["--input-type=module", "-e", probe],
        cwd: root,
        env: process.env,
        timeoutMs: 170_000,
        onStdout: (chunk: string) => {
          output += chunk;
        },
        onStderr: (chunk: string) => {
          output += chunk;
        },
      });
      expect(status).toBe(1);
      expect(output).toContain("Invariant q_inv is violated");
      expect(output).toContain("ADMIN_VIEW_COUNTEREXAMPLE_CONFIRMED");
      expect(output).not.toContain("No error has been found");
    },
    180_000,
  );
}
