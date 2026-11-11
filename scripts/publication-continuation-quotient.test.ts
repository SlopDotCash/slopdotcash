/** Exact-source guards and native controls for the publication safety VIEW. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readSafetyViews } from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const modelPath = "formal/models/ui/ui_project_publication_lifetime.qnt";
const source = readFileSync(resolve(root, modelPath), "utf8");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const reviewedSource =
  "68360360fec1f0abd036e8b78046603c14f557831fa6da7bf3ec19774d196e03";
const manifest = readSafetyViews(root);
const view = manifest.views.find(
  (entry: { model: string }) => entry.model === modelPath,
);
if (!view) throw new Error("Missing reviewed publication continuation view");

function requireReviewedSource(value: string) {
  // Bind the entire model, including domains, helpers, all concrete actions,
  // dispatcher, invariant and original scenarios. Indirect or cross-slot reads
  // and reuse require another review even if a field-token scan would miss them.
  if (hash(value) !== reviewedSource)
    throw new Error("Publication continuation liveness needs renewed review");
}

test("publication view binds the complete unchanged concrete model", () => {
  requireReviewedSource(source);
  expect(view.sourceSha256).toBe(reviewedSource);
});

test("new readers, changed invariant observations and slot reuse require review", () => {
  for (const [before, after] of [
    [
      "s.mounted, s.active == 0,",
      's.mounted, s.error == "none", s.active == 0,',
    ],
    [
      "s.mounted, s.active == 0,",
      "s.mounted, not(s.storageError), s.active == 0,",
    ],
    ["s.mounted, s.active == 0,", "s.mounted, s.referrer, s.active == 0,"],
    [
      "s.mounted, s.active == 0,",
      "s.mounted, s.storedReferrer, s.active == 0,",
    ],
    [
      "r.expected == s.serverRevision",
      "r.expected == s.serverRevision and r.draft == s.serverDraft",
    ],
    [
      'all { r.phase == "http",',
      'all { r.phase == "http" and r.outcome == "none",',
    ],
    [
      'r.phase == "failure-returned",',
      'r.phase == "failure-returned" and r.referrer,',
    ],
    [
      's.requests.get(id).phase == "unused",',
      'Set("unused", "done").contains(s.requests.get(id).phase),',
    ],
    [
      "s.mounted, s.active == 0,",
      "s.mounted, s.requests.get(1).actor == s.actor, s.active == 0,",
    ],
    [
      "s.accepted.subseteq(ids)",
      "s.accepted.subseteq(ids) and not(s.storageError)",
    ],
    [
      "  def owns(id: int): bool =",
      "  def futureRead(id: int): bool = s.requests.get(id).draft == s.stored\n  def owns(id: int): bool =",
    ],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => requireReviewedSource(changed)).toThrow("renewed review");
  }
});

// All fields are present so these probes execute the exact reviewed VIEW,
// not a reduced test projection. Each property isolates its named observation.
const initial = `[mode |-> "revision", present |-> TRUE, mounted |-> TRUE,
 lifetime |-> 1, actor |-> 1, cookie |-> 1, active |-> 1, draft |-> 1,
 draftEpoch |-> 0, referrer |-> TRUE, base |-> 1, draftBase |-> 1,
 stored |-> 1, storedBase |-> 1, storedReferrer |-> TRUE, storageError |-> FALSE,
 serverRevision |-> 1, serverDraft |-> 1, accepted |-> {1}, view |-> "editor",
 publication |-> 0, error |-> "none",
 requests |-> [i \\in {1,2} |-> [phase |-> "http", actor |-> 1, cookie |-> 1,
 lifetime |-> 1, draft |-> 1, draftEpoch |-> 0, referrer |-> TRUE,
 expected |-> 1, admitted |-> TRUE, accepted |-> TRUE, resultRevision |-> 2,
 outcome |-> "none", observedActor |-> 1]]]`;
const patched = (update: string) => `[${initial} EXCEPT ${update}]`;
const publicationClause =
  "IF s.publication = 0 THEN TRUE ELSE s.requests[s.publication].accepted";
const admissionClause =
  "(\\A i \\in {1,2}: s.requests[i].admitted => s.requests[i].cookie = s.requests[i].actor)";

const controls: readonly (readonly [string, string, string, string])[] = [
  [
    "accepted-set-domain",
    initial,
    "!.accepted = {3}",
    "s.accepted \\subseteq {1,2}",
  ],
  [
    "server-revision-lower-bound",
    initial,
    "!.serverRevision = -1",
    "s.serverRevision >= 0",
  ],
  [
    "server-revision-upper-bound",
    initial,
    "!.serverRevision = 4",
    "s.serverRevision <= 3",
  ],
  [
    "departed-view-still-mounted",
    initial,
    "!.present = FALSE",
    "(~s.present => ~s.mounted)",
  ],
  [
    "publication-selects-unaccepted-done",
    patched('!.requests[1].phase = "done", !.requests[1].accepted = FALSE'),
    "!.publication = 1",
    publicationClause,
  ],
  [
    "publication-selects-unaccepted-unused",
    patched('!.requests[1].phase = "unused", !.requests[1].accepted = FALSE'),
    "!.publication = 1",
    publicationClause,
  ],
  [
    "done-acceptance-remains-exact",
    patched('!.requests[1].phase = "done", !.publication = 1'),
    "!.requests[1].accepted = FALSE",
    publicationClause,
  ],
  [
    "unused-acceptance-remains-exact",
    patched('!.requests[1].phase = "unused", !.publication = 1'),
    "!.requests[1].accepted = FALSE",
    publicationClause,
  ],
  [
    "false-done-admission-cookie",
    patched('!.requests[1].phase = "done"'),
    "!.requests[1].cookie = 2",
    admissionClause,
  ],
  [
    "false-done-admission-actor",
    patched('!.requests[1].phase = "done"'),
    "!.requests[1].actor = 2",
    admissionClause,
  ],
  [
    "false-done-admission-flag",
    patched(
      '!.requests[1].phase = "done", !.requests[1].admitted = FALSE, !.requests[1].cookie = 2',
    ),
    "!.requests[1].admitted = TRUE",
    admissionClause,
  ],
  [
    "false-unused-admission",
    patched('!.requests[1].phase = "unused"'),
    "!.requests[1].cookie = 2",
    admissionClause,
  ],
  [
    "false-live-admission",
    initial,
    "!.requests[1].cookie = 2",
    admissionClause,
  ],
  [
    "live-request-actor",
    initial,
    "!.requests[1].actor = 2",
    "s.requests[1].actor = s.actor",
  ],
  [
    "live-request-lifetime",
    initial,
    "!.requests[1].lifetime = 2",
    "s.requests[1].lifetime = s.lifetime",
  ],
  [
    "live-request-draft",
    initial,
    "!.requests[1].draft = 2",
    "s.requests[1].draft = s.draft",
  ],
  [
    "live-request-draft-epoch",
    initial,
    "!.requests[1].draftEpoch = 1",
    "s.requests[1].draftEpoch = s.draftEpoch",
  ],
  [
    "live-request-expected-revision",
    patched('!.requests[1].phase = "server"'),
    "!.requests[1].expected = 2",
    "s.requests[1].expected = s.serverRevision",
  ],
  [
    "http-acceptance",
    initial,
    "!.requests[1].accepted = FALSE",
    "s.requests[1].accepted",
  ],
  [
    "live-result-revision",
    patched('!.requests[1].phase = "success-returned"'),
    "!.requests[1].resultRevision = 3",
    "s.requests[1].resultRevision = 2",
  ],
  [
    "observed-preflight-actor",
    patched('!.requests[1].phase = "preflight-returned"'),
    "!.requests[1].observedActor = 2",
    "s.requests[1].observedActor = s.requests[1].actor",
  ],
  [
    "observed-success-actor",
    patched('!.requests[1].phase = "success-returned"'),
    "!.requests[1].observedActor = 2",
    "s.requests[1].observedActor = s.requests[1].actor",
  ],
  [
    "observed-failure-actor",
    patched('!.requests[1].phase = "failure-returned"'),
    "!.requests[1].observedActor = 2",
    "s.requests[1].observedActor = s.requests[1].actor",
  ],
  ["current-draft-base", initial, "!.draftBase = 2", "s.draftBase = s.base"],
  [
    "retained-storage-base",
    initial,
    "!.storedBase = 2",
    "s.storedBase = s.base",
  ],
  ["retained-storage-draft", initial, "!.stored = 2", "s.stored = 1"],
  ["publication-mode", initial, '!.mode = "create"', 's.mode = "revision"'],
  [
    "access-check-view",
    initial,
    '!.view = "access-check"',
    's.view = "editor"',
  ],
];

for (const [name, state, update, invariant] of controls) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native publication VIEW retains the ${name} counterexample`,
    async () => {
      // Synthetic two-state inputs exercise fingerprint distinguishability
      // through the real pinned TLC runner. They do not replace the model or
      // mechanically prove its manually reviewed successor congruence.
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
        console.log('PUBLICATION_VIEW_COUNTEREXAMPLE_CONFIRMED');
        process.exit(1);
      `;
      let output = "";
      const status = await runE2ePhase({
        label: `publication-view-${name}`,
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
      expect(output).toContain("PUBLICATION_VIEW_COUNTEREXAMPLE_CONFIRMED");
      expect(output).not.toContain("No error has been found");
    },
    180_000,
  );
}
