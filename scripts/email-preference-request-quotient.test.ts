/** Source and native observation controls for the reviewed email safety VIEW. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readSafetyViews } from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const model = "formal/models/ui/ui_email_preference_requests.qnt";
const source = readFileSync(resolve(root, model), "utf8");
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const selected = readSafetyViews(root).views.find(
  (entry: { model: string }) => entry.model === model,
);
if (!selected) throw new Error("Missing reviewed email safety view");

function checkReviewedBoundary(text: string) {
  const start = text.indexOf("module ui_email_preference_requests {");
  const end = text.indexOf("  action sendSave", start);
  if (
    start < 0 ||
    end < start ||
    sha256(text.slice(start, end)) !==
      "7e0d53e4f93be489a2b5651b7690e8e69190d60c73ed8eb50745ab575785a34b"
  )
    throw new Error("Email request observation quotient needs review");
}

test("email view binds every schema, domain, helper, action and invariant", () => {
  checkReviewedBoundary(source);
  expect(sha256(source)).toBe(selected.sourceSha256);
});

test("new output reads require a new dependency-closure proof", () => {
  for (const read of [
    "s.draft == 1",
    "s.key",
    "s.enabled",
    "s.verificationPending",
    's.error == "request"',
    's.view == "signed-out"',
    "s.requests.get(id).target",
  ]) {
    const changed = source.replace(
      's.requests.get(id).phase == "unused",',
      `s.requests.get(id).phase == "unused", ${read},`,
    );
    expect(changed).not.toBe(source);
    expect(() => checkReviewedBoundary(changed)).toThrow("needs review");
  }
});

test("terminal reuse, cross-slot reads and new live cookie reads require review", () => {
  for (const [before, after] of [
    [
      's.requests.get(id).phase == "unused",',
      'Set("unused", "done").contains(s.requests.get(id).phase),',
    ],
    ['r.phase == "body",', 'r.phase == "body", r.cookie == r.actor,'],
    [
      'r.phase == "post-returned",',
      'r.phase == "post-returned", s.requests.get(2).status == 200,',
    ],
    ['r.phase == "pre-returned",', 'r.phase == "pre-returned", r.target,'],
    [
      'r.phase == "failure-returned",',
      'r.phase == "failure-returned", r.status == 429,',
    ],
    [
      's.requests.get(id).phase == "post",',
      's.requests.get(id).phase == "post", s.requests.get(id).observedActor == 1,',
    ],
  ]) {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => checkReviewedBoundary(changed)).toThrow("needs review");
  }
});

const request = `[kind |-> "save", phase |-> "done", generation |-> 1,
  actor |-> 1, cookie |-> 1, status |-> 200, accepted |-> TRUE,
  target |-> FALSE, observedActor |-> 1]`;
const state = String.raw`[generation |-> 1, life |-> 1, mounted |-> TRUE,
  actor |-> 1, cookie |-> 1, view |-> "ready", busy |-> FALSE,
  checking |-> FALSE, enabled |-> FALSE, draft |-> 1, editing |-> TRUE,
  key |-> FALSE, verificationPending |-> FALSE, error |-> "none",
  reads |-> 0, posts |-> 0, sessionReads |-> 0, reloads |-> 0,
  publication |-> 0, publicationGeneration |-> 0,
  requests |-> [id \in {1,2} |-> initialRequest]]`;
const auth =
  "(s.requests[1].accepted => s.requests[1].cookie = s.requests[1].actor)";

// Every fixture has exactly one named property. A violation of some unrelated
// original invariant cannot satisfy a control. These tiny TLA fixtures exercise
// the real pinned runner and reviewed expression, not application conformance.
const controls = [
  ["generation-lower-bound", "", "!.generation = 0", "s.generation >= 1"],
  ["generation-upper-bound", "", "!.generation = 7", "s.generation <= 6"],
  ["post-bound", "", "!.posts = 3", "s.posts <= 2"],
  ["read-bound", "", "!.reads = 3", "s.reads <= 2"],
  ["reload-bound", "", "!.reloads = 3", "s.reloads <= 2"],
  ["session-read-bound", "", "!.sessionReads = 7", "s.sessionReads <= 6"],
  ["accepted-cookie", "", "!.requests[1].cookie = 2", auth],
  [
    "false-accepted-cookie-repair",
    "!.requests[1].cookie = 2",
    "!.requests[1].cookie = 1",
    `~${auth}`,
  ],
  [
    "preflight-false-auth-before-actor-zero",
    '!.requests[1].kind = "read", !.requests[1].phase = "pre-returned", !.requests[1].observedActor = 0, !.requests[1].cookie = 2',
    "!.requests[1].cookie = 0",
    // Both states have false accepted-cookie equality before the concrete
    // read/signed-out branch changes actor to zero. Their future equality
    // differs, so retaining just the current auth truth would be unsound.
    "s.requests[1].cookie # 0",
  ],
  [
    "http-cookie-nonzero-guard",
    '!.requests[1].phase = "http", !.requests[1].accepted = FALSE',
    "!.requests[1].cookie = 0",
    "s.requests[1].cookie # 0",
  ],
  [
    "http-cookie-actor-guard",
    '!.requests[1].phase = "http", !.requests[1].accepted = FALSE',
    "!.requests[1].cookie = 2",
    "s.requests[1].cookie = s.requests[1].actor",
  ],
  ...["pre", "post", "failure"].flatMap((phase) =>
    ["observed", "returned"].map((boundary) => [
      `${phase}-${boundary}-actor`,
      `!.requests[1].phase = "${phase}-${boundary}"`,
      "!.requests[1].observedActor = 2",
      "s.requests[1].observedActor = 1",
    ]),
  ),
  [
    "save-200-class",
    '!.requests[1].phase = "post-returned"',
    "!.requests[1].status = 202",
    "s.requests[1].status = 200",
  ],
  [
    "verification-202-class",
    '!.requests[1].phase = "body", !.requests[1].kind = "verify", !.requests[1].status = 202',
    "!.requests[1].status = 200",
    "s.requests[1].status = 202",
  ],
  [
    "publication-mounted",
    "!.publication = 1, !.publicationGeneration = 1",
    "!.mounted = FALSE",
    "s.mounted",
  ],
  [
    "publication-generation",
    "!.publication = 1, !.publicationGeneration = 1",
    "!.publicationGeneration = 2",
    "s.publicationGeneration = s.generation",
  ],
  [
    "indexed-request-generation",
    "!.publication = 1, !.publicationGeneration = 1",
    "!.requests[1].generation = 2",
    "s.requests[s.publication].generation = s.generation",
  ],
  [
    "false-indexed-request-generation-repair",
    "!.publication = 1, !.publicationGeneration = 1, !.requests[1].generation = 2",
    "!.requests[1].generation = 1",
    "s.requests[s.publication].generation # s.generation",
  ],
  [
    "indexed-publication-observation",
    "!.publication = 1, !.publicationGeneration = 1",
    "!.requests[1].observedActor = 2",
    "s.requests[s.publication].observedActor = s.requests[s.publication].actor",
  ],
  [
    "false-indexed-publication-observation-repair",
    "!.publication = 1, !.publicationGeneration = 1, !.requests[1].observedActor = 2",
    "!.requests[1].observedActor = 1",
    "s.requests[s.publication].observedActor # s.requests[s.publication].actor",
  ],
  [
    "indexed-publication-kind-or-acceptance",
    "!.publication = 1, !.publicationGeneration = 1",
    "!.requests[1].accepted = FALSE",
    '(s.requests[s.publication].kind = "read" \\/ s.requests[s.publication].accepted)',
  ],
  [
    "false-indexed-publication-kind-repair",
    "!.publication = 1, !.publicationGeneration = 1, !.requests[1].accepted = FALSE",
    '!.requests[1].kind = "read"',
    '~(s.requests[s.publication].kind = "read" \\/ s.requests[s.publication].accepted)',
  ],
] as const;

for (const [name, initial, update, invariant] of controls) {
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `the native email view retains the ${name} counterexample`,
    async () => {
      const tla = `---- MODULE ui_email_preference_requests ----
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
      const witness = `EMAIL_VIEW_COUNTEREXAMPLE_${name}`;
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
        label: `email-view-${name}`,
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
      expect(output).not.toContain("No error has been found");
    },
    35_000,
  );
}
