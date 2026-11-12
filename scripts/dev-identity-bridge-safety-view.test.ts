/** Exact-source guards and native observations for historical intake. */
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  applySafetyView,
  bindSafetyView,
  readSafetyViews,
  type SafetyViewDefinition,
} from "./quint-safety-view.mjs";
import { runE2ePhase } from "./run-e2e-phase.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = readSafetyViews(root),
  candidate = manifest.views.find(
    (v) => v.id === "dev-identity-bridge-phase-safety-v1",
  );
if (!candidate) throw Error("Missing reviewed dev bridge VIEW");
const selected: SafetyViewDefinition = candidate,
  source = readFileSync(join(root, selected.model), "utf8");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2)
    throw Error(`Expected one source boundary: ${from}`);
  return text.replace(from, to);
}
function reviewed(text: string) {
  if (
    digest(text) !==
    "0af658165eef1d45cdae934d4daa730832822d28b5c279769498926c81e984af"
  )
    throw Error("Bridge lifetime consumers require whole-source review");
}
test("bridge VIEW binds all original actions, domains, invariants and all 43 scenarios", () => {
  reviewed(source);
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
  expect(digest(selected.fields[0].expression)).toBe(
    "fa3778d10b8f24fe2e7b737eef38e1dc59a5009bbfee9f2771f89a0bdac05d62",
  );
  expect(selected.clauses).toEqual([]);
  expect(manifest.views.filter((v) => v.model === selected.model)).toHaveLength(
    1,
  );
});
for (const [name, before, after] of [
  [
    "start status consumer",
    'val waiting = s.startPhase == "remote"',
    'val waiting = s.startPhase == "remote" and s.startResult == "201"',
  ],
  [
    "authorize category consumer",
    's.authorizeResult == "none", exactQuery',
    'Set("none", "302").contains(s.authorizeResult), exactQuery',
  ],
  [
    "row creation-time consumer",
    'poll.phase == "store", not(s.rowPresent),',
    'poll.phase == "store", not(s.rowPresent), s.rowCreated <= s.now,',
  ],
  [
    "poll creation-time guard",
    'poll.phase == "hash",',
    'poll.phase == "hash", poll.created <= s.now,',
  ],
  [
    "early capability read",
    'poll.phase == "body", capability implies',
    'poll.phase == "body", poll.capability, capability implies',
  ],
  [
    "late remote stamp read",
    'poll.phase == "remote-clock",',
    'poll.phase == "remote-clock", poll.remoteStamp < s.remoteExpiry,',
  ],
  [
    "late issue stamp read",
    'poll.phase == "remote-write-reply", remoteReplies',
    'poll.phase == "remote-write-reply", poll.issueStamp < s.remoteExpiry, remoteReplies',
  ],
  [
    "late local expiry read",
    'poll.phase == "store-reply", writeReplies',
    'poll.phase == "store-reply", poll.expiry > s.now, writeReplies',
  ],
  [
    "local alive consumer",
    'poll.phase == "mint",',
    'poll.phase == "mint", poll.alive,',
  ],
  [
    "raw none remote result distinction",
    'if (poll.remoteResult != "200") poll.remoteResult',
    'if (poll.remoteResult != "200") "error"',
  ],
  [
    "other remote-result distinction",
    'if (poll.remoteResult != "200") poll.remoteResult',
    'if (poll.remoteResult == "410") "none" else poll.remoteResult',
  ],
  [
    "other poll desired consumer",
    'poll.phase == "finish",',
    'poll.phase == "finish", poll.desired == "503",',
  ],
  [
    "other response consumer",
    "not(s.restarted),",
    'not(s.restarted), s.polls.get(1).response == "error",',
  ],
  [
    "old consumer matches read",
    'call.phase == "body", (bearer',
    'call.phase == "body", call.matches, (bearer',
  ],
  [
    "discarded consumer stamp read",
    'call.phase == "hash",',
    'call.phase == "hash", call.stamp < s.rowExpiry,',
  ],
  [
    "partial poll reset",
    'unusedPoll.with("phase", "body")',
    's.polls.get(id).with("phase", "body")',
  ],
  [
    "partial consumer reset",
    'unusedConsume.with("phase", "body")',
    's.consumers.get(id).with("phase", "body")',
  ],
  [
    "terminal poll reuse",
    'poll.phase == "lookup",',
    'Set("lookup", "done").contains(poll.phase),',
  ],
  [
    "terminal consumer reuse",
    'call.phase == "write",',
    'Set("write", "done").contains(call.phase),',
  ],
  [
    "phase regression",
    'poll.with("phase", "store-reply")',
    'poll.with("phase", "remote-read")',
  ],
  [
    "cross-slot closed output read",
    'call.phase == "write",',
    'call.phase == "write", s.polls.get(2).created > 0,',
  ],
  [
    "new output invariant",
    "s.now >= 0, s.now <= 8,",
    "s.now >= 0, s.now <= 8, s.rowCreated >= 0,",
  ],
] as const)
  test(`future ${name} refuses the bridge pin`, () => {
    expect(source).toContain(before);
    const changed = source.replace(before, after);
    expect(() => reviewed(changed)).toThrow("whole-source review");
    expect(() =>
      bindSafetyView(manifest, selected.id, selected.model, changed),
    ).toThrow("model changed");
  });
function fixtureBinding(tlaCode: string): SafetyViewDefinition {
  const end = tlaCode.match(/^={4,}[ \t]*$/gmu);
  if (end?.length !== 1 || !tlaCode.endsWith(end[0] + "\n"))
    throw new Error("Native fixture module terminator differs");
  const expressions = [...selected.fields, ...selected.clauses].map(
    ({ expression }) => expression,
  );
  const projected =
    tlaCode.slice(0, -end[0].length - 1) +
    selected.operator +
    " ==\n  <<" +
    expressions.join(", ") +
    ">>\n\n" +
    end[0] +
    "\n";
  return {
    ...selected,
    translatedSha256: digest(tlaCode),
    viewTlaSha256: digest(projected),
  };
}

test("bridge VIEW refuses temporal, property and literal changes", () => {
  const temporal = source + "\ntemporal unsafeProperty = true\n";
  expect(() =>
    bindSafetyView(
      { ...manifest, views: [{ ...selected, sourceSha256: digest(temporal) }] },
      selected.id,
      selected.model,
      temporal,
    ),
  ).toThrow("does not authorize temporal properties");
  const tlaCode =
      "---- MODULE " + selected.module + " ----\nVARIABLE s\n====\n",
    binding = fixtureBinding(tlaCode);
  for (const changed of [
    { ...binding, fields: [{ name: "state", expression: "s" }] },
    { ...binding, clauses: [{ name: "future", expression: "FALSE" }] },
    { ...binding, operator: "UnreviewedBridgeView" },
  ])
    expect(() =>
      applySafetyView(changed, {
        moduleName: selected.module,
        hasInvariant: true,
        hasTemporal: false,
        tlaCode,
      }),
    ).toThrow("property differs");
});
let translated: string | undefined;
function actualTranslatedModel() {
  if (translated !== undefined) return translated;
  const directory = mkdtempSync(join(tmpdir(), "slop-dev-bridge-native-"));
  const output = join(directory, "production.tla");
  try {
    // Derive the complete real verify input under the native flag. This
    // intercepts TLC before any full-model graph starts.
    const capture = [
      'import {createRequire} from "node:module";',
      'import {realpathSync,writeFileSync} from "node:fs";',
      'import {pathToFileURL} from "node:url";',
      "const require=createRequire(import.meta.url);",
      'const cli=realpathSync("./node_modules/.bin/quint");',
      "delete process.env.SLOP_QUINT_SAFETY_VIEW;",
      'process.argv=[process.execPath,cli,"verify",' +
        JSON.stringify(selected.model) +
        ',"--backend=tlc","--invariant=invariant","--verbosity=0"];',
      'await import(pathToFileURL(process.cwd()+"/scripts/quint-local-translator.mjs").href);',
      'require("@informalsystems/quint/dist/src/tlc.js").verify=async config=>{',
      "writeFileSync(" +
        JSON.stringify(output) +
        ",config.tlaCode);process.exit(0);};",
      "await import(pathToFileURL(cli).href);",
    ].join("\n");
    execFileSync("node", ["--input-type=module", "-e", capture], {
      cwd: root,
      encoding: "utf8",
      timeout: 90_000,
    });
    translated = readFileSync(output, "utf8");
    expect(digest(translated)).toBe(selected.translatedSha256);
    const operators = new Set(
      [
        ...translated.matchAll(
          /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^\n]*\))?\s*==/gmu,
        ),
      ].map((match) => match[1]),
    );
    for (const name of ["p", "c", "id"])
      expect(operators.has(name)).toBe(false);

    // Check the real production hash and full long terminator, not just a
    // synthetic four-equals fixture. No ignored local evidence file is read.
    const prepared = applySafetyView(selected, {
      moduleName: selected.module,
      hasInvariant: true,
      hasTemporal: false,
      tlaCode: translated,
    });
    expect(digest(prepared.tlaCode)).toBe(selected.viewTlaSha256);
    const end = translated.match(/^={4,}[ \t]*$/gmu);
    if (end?.length !== 1) throw new Error("Production TLA terminator differs");
    expect(
      prepared.tlaCode.startsWith(translated.slice(0, -end[0].length - 1)),
    ).toBe(true);
    return translated;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

type NativeCase = {
  name: string;
  initial: string;
  step: string;
  witness: string;
  minimumState?: number;
  initialIsSet?: boolean;
};
function nativeFixture(control: NativeCase) {
  let tla = actualTranslatedModel();
  // Keep each test alias after its dependencies: q_step follows all actions;
  // q_inv follows the complete invariant. No forward-reference fixture shortcut.
  tla = replaceOnce(
    tla,
    "q_init == init",
    `SlopControlInitial == ${control.initial}\n\nq_init == s ${control.initialIsSet ? "\\in" : "="} SlopControlInitial`,
  );
  tla = replaceOnce(
    tla,
    "q_inv == invariant",
    `SlopControlWitness == ${control.witness}\n\nq_inv == ~SlopControlWitness`,
  );
  return replaceOnce(
    tla,
    "q_step == step",
    `SlopControlStep == ${control.step}\n\nq_step == SlopControlStep`,
  );
}
async function runNative(tla: string, useView = true) {
  const binding = fixtureBinding(tla);
  const probe = [
    'import {readFileSync} from "node:fs";',
    'import {createRequire} from "node:module";',
    'import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from "./scripts/quint-safety-view.mjs";',
    "const require=createRequire(import.meta.url);",
    "const manifest=readSafetyViews(process.cwd());",
    "const view=" + JSON.stringify(binding) + ";",
    "const config={moduleName:view.module,tlaCode:" +
      JSON.stringify(tla) +
      ",hasInvariant:true,hasTemporal:false};",
    "const prepared=" +
      (useView ? "applySafetyView(view,config)" : "config") +
      ";",
    'const runner=loadSafetyViewTlc(require.resolve("@informalsystems/quint/dist/src/tlc.js"),manifest);',
    'const result=await runner.verify(prepared,"0.62.4",JSON.parse(readFileSync("formal/tlc.json","utf8")),3);',
    'if(result.isLeft()){if(result.value.isViolation){console.log("DEV_BRIDGE_VIEW_NAMED_WITNESS_FOUND");process.exitCode=1;}',
    'else{console.log("DEV_BRIDGE_VIEW_NATIVE_ERROR");process.exitCode=2;}}else console.log("DEV_BRIDGE_VIEW_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "dev-bridge-view-native-control",
    command: "node",
    args: ["--input-type=module", "-e", probe],
    cwd: root,
    env: process.env,
    timeoutMs: 90_000,
    onStdout: (text: string) => {
      output += text;
    },
    onStderr: (text: string) => {
      output += text;
    },
  });
  return { status, output };
}

const poll =
  '[phase |-> "unused", alive |-> TRUE, capability |-> FALSE, remoteStamp |-> -1, issueStamp |-> -1, claimed |-> FALSE, remoteResult |-> "none", expiry |-> -1, created |-> -1, desired |-> "none", response |-> "none"]';
const consumer =
  '[phase |-> "unused", matches |-> FALSE, stamp |-> -1, accepted |-> FALSE, response |-> "none"]';
const initial = `[now |-> 0, restarted |-> FALSE, startPhase |-> "unused", startResult |-> "none", remoteCreated |-> FALSE, remotePresent |-> FALSE, remoteStatus |-> "absent", remoteExpiry |-> -1, remoteClaims |-> 0, mapPresent |-> FALSE, flowKnown |-> FALSE, authorizeResult |-> "none", rowPresent |-> FALSE, rowCreated |-> -1, rowExpiry |-> -1, rowConsumed |-> FALSE, localWrites |-> 0, tokenKnown |-> FALSE, consumeCommits |-> 0, polls |-> [pollId \\in {1,2} |-> ${poll}], consumers |-> [callId \\in {1,2} |-> ${consumer}]]`;
const state = (changes: string) => `[${initial} EXCEPT ${changes}]`;
const change = (base: string, changes: string) => `[${base} EXCEPT ${changes}]`;
const pollAt = (phase: string, changes = "") =>
  state(`!.polls[1].phase = "${phase}"${changes ? `, ${changes}` : ""}`);
const consumeAt = (phase: string, changes = "") =>
  state(`!.consumers[1].phase = "${phase}"${changes ? `, ${changes}` : ""}`);
const readyRemote =
  '!.remoteCreated = TRUE, !.remotePresent = TRUE, !.remoteStatus = "complete", !.remoteExpiry = 4';
const readyLocal =
  "!.remoteCreated = TRUE, !.remoteClaims = 1, !.localWrites = 1, !.rowPresent = TRUE, !.rowExpiry = 2, !.tokenKnown = TRUE";
const claimed = "(s.polls[1].claimed => s.remoteClaims = 1)";
const issued =
  '(s.polls[1].response = "200" => (s.polls[1].claimed /\\ s.localWrites = 1 /\\ s.tokenKnown))';
const accepted =
  "(s.consumers[1].accepted => (s.rowConsumed /\\ s.consumers[1].stamp < s.rowExpiry))";
const replied = '(s.consumers[1].response = "200" => s.consumers[1].accepted)';
const controls: NativeCase[] = [];
function observation(
  name: string,
  property: string,
  corrupt: string,
  repair: string,
  base = initial,
) {
  controls.push({
    name: `${name} FALSE`,
    initial: base,
    step: `s' = [s EXCEPT ${corrupt}]`,
    witness: `~(${property})`,
  });
  controls.push({
    name: `${name} healing`,
    initial: change(base, corrupt),
    step: `s' = [s EXCEPT ${repair}]`,
    witness: property,
  });
}
for (const [name, property, corrupt, repair] of [
  ["clock lower", "s.now >= 0", "!.now = -1", "!.now = 0"],
  ["clock upper", "s.now <= 8", "!.now = 9", "!.now = 0"],
  [
    "remote claim cap",
    "s.remoteClaims <= 1",
    "!.remoteClaims = 2",
    "!.remoteClaims = 0",
  ],
  [
    "local write cap",
    "s.localWrites <= 1",
    "!.localWrites = 2",
    "!.localWrites = 0",
  ],
  [
    "consume commit cap",
    "s.consumeCommits <= 1",
    "!.consumeCommits = 2",
    "!.consumeCommits = 0",
  ],
  [
    "map requires creation",
    "s.mapPresent => s.remoteCreated",
    "!.mapPresent = TRUE",
    "!.remoteCreated = TRUE",
  ],
  [
    "remote presence requires creation",
    "s.remotePresent => s.remoteCreated",
    "!.remotePresent = TRUE",
    "!.remoteCreated = TRUE",
  ],
  [
    "one claim requires creation",
    "s.remoteClaims = 1 => s.remoteCreated",
    "!.remoteClaims = 1",
    "!.remoteCreated = TRUE",
  ],
  [
    "local write requires claim and row",
    "s.localWrites = 1 => (s.remoteClaims = 1 /\\ s.rowPresent)",
    "!.localWrites = 1",
    "!.remoteClaims = 1, !.rowPresent = TRUE",
  ],
  [
    "known token requires write and row",
    "s.tokenKnown => (s.localWrites = 1 /\\ s.rowPresent)",
    "!.tokenKnown = TRUE",
    "!.localWrites = 1, !.rowPresent = TRUE",
  ],
  [
    "consumed row requires commit and token",
    "s.rowConsumed => (s.consumeCommits = 1 /\\ s.tokenKnown)",
    "!.rowConsumed = TRUE",
    "!.consumeCommits = 1, !.tokenKnown = TRUE",
  ],
  [
    "consume commit requires row",
    "s.consumeCommits = 1 => s.rowPresent",
    "!.consumeCommits = 1",
    "!.rowPresent = TRUE",
  ],
] as const)
  observation(name, property, corrupt, repair);
observation(
  "poll claimed dynamic clause",
  claimed,
  "!.polls[1].claimed = TRUE",
  "!.remoteClaims = 1",
);
observation(
  "poll200 dynamic clause",
  issued,
  '!.polls[1].response = "200"',
  "!.polls[1].claimed = TRUE, !.localWrites = 1, !.tokenKnown = TRUE",
);
observation(
  "consumer accepted dynamic clause",
  accepted,
  "!.consumers[1].accepted = TRUE",
  "!.rowConsumed = TRUE, !.rowExpiry = 1",
);
observation(
  "accepted stamp boundary",
  accepted,
  "!.consumers[1].stamp = 2",
  "!.consumers[1].stamp = 0",
  state(
    "!.consumers[1].accepted = TRUE, !.consumers[1].stamp = 0, !.rowConsumed = TRUE, !.rowExpiry = 2",
  ),
);
observation(
  "consumer200 requires acceptance",
  replied,
  '!.consumers[1].response = "200"',
  "!.consumers[1].accepted = TRUE",
);
controls.push(
  {
    name: "error class permits actual abandoned remote creation",
    initial: state('!.startPhase = "done"'),
    step: 'IF s.startResult = "none" THEN s\' = [s EXCEPT !.startResult = "error"] ELSE captureStartClock',
    witness: "s.remoteExpiry = 4",
    minimumState: 3,
  },
  {
    name: "authorize none remains a live guard for actual pruning",
    initial: state(
      '!.authorizeResult = "302", !.mapPresent = TRUE, !.remoteCreated = TRUE, !.remoteExpiry = 0',
    ),
    step: 'IF s.authorizeResult # "none" THEN s\' = [s EXCEPT !.authorizeResult = "none"] ELSE authorize(TRUE,FALSE)',
    witness: '~s.mapPresent /\\ s.authorizeResult # "none"',
    minimumState: 3,
  },
  {
    name: "remote none bypasses identity predicate in original body",
    initial: pollAt("remote-body"),
    step: "pollResponseBody(1,TRUE,FALSE)",
    witness: 's.polls[1].phase = "delete-map"',
  },
  {
    name: "remote200 differs from none at original body",
    initial: pollAt("remote-body", '!.polls[1].remoteResult = "200"'),
    step: 'IF s.polls[1].remoteResult = "200" THEN s\' = [s EXCEPT !.polls[1].remoteResult = "none"] ELSE pollResponseBody(1,TRUE,FALSE)',
    witness: 's.polls[1].phase = "delete-map"',
    minimumState: 3,
  },
  {
    name: "lookup capability remains exact through actual lookup",
    initial: pollAt(
      "lookup",
      `!.mapPresent = TRUE, !.remoteCreated = TRUE, !.flowKnown = TRUE`,
    ),
    step: "IF ~s.polls[1].capability THEN s' = [s EXCEPT !.polls[1].capability = TRUE] ELSE lookupFlow(1)",
    witness:
      's.polls[1].phase = "remote-read" /\\ s.polls[1].remoteStamp = s.now',
    minimumState: 3,
  },
  {
    name: "remote read uses captured cutoff rather than current time",
    initial: pollAt(
      "remote-read",
      `${readyRemote}, !.polls[1].remoteStamp = 4`,
    ),
    step: "IF s.polls[1].remoteStamp = 4 THEN s' = [s EXCEPT !.polls[1].remoteStamp = 3] ELSE readRemote(1)",
    witness: 's.polls[1].phase = "remote-clock"',
    minimumState: 3,
  },
  {
    name: "remote claim uses captured issue cutoff even with lost caller",
    initial: pollAt(
      "remote-write",
      `${readyRemote}, !.polls[1].alive = FALSE, !.polls[1].issueStamp = 4`,
    ),
    step: "IF s.polls[1].issueStamp = 4 THEN s' = [s EXCEPT !.polls[1].issueStamp = 3] ELSE claimRemote(1)",
    witness:
      's.polls[1].phase = "remote-write-reply" /\\ s.polls[1].claimed /\\ ~s.polls[1].alive',
    minimumState: 3,
  },
  {
    name: "caller loss does not prevent actual remote commit",
    initial: pollAt(
      "remote-write",
      `${readyRemote}, !.polls[1].issueStamp = 0`,
    ),
    step: "IF s.polls[1].alive THEN loseRemoteCaller(1) ELSE claimRemote(1)",
    witness:
      's.polls[1].phase = "remote-write-reply" /\\ ~s.polls[1].alive /\\ s.remoteClaims = 1',
    minimumState: 3,
  },
  {
    name: "restart does not prevent actual remote commit",
    initial: pollAt(
      "remote-write",
      `${readyRemote}, !.polls[1].issueStamp = 0`,
    ),
    step: "IF ~s.restarted THEN restart ELSE claimRemote(1)",
    witness:
      's.polls[1].phase = "remote-write-reply" /\\ ~s.polls[1].alive /\\ s.remoteClaims = 1',
    minimumState: 3,
  },
  {
    name: "restart clears200 from formerly live remote caller",
    initial: pollAt("remote-write", '!.polls[1].response = "200"'),
    step: "restart",
    witness:
      's.restarted /\\ s.polls[1].phase = "remote-write" /\\ ~s.polls[1].alive /\\ s.polls[1].response # "200"',
  },
  {
    name: "restart preserves200 from already dead remote caller",
    initial: pollAt(
      "remote-write",
      '!.polls[1].alive = FALSE, !.polls[1].response = "200"',
    ),
    step: "restart",
    witness:
      's.restarted /\\ s.polls[1].phase = "remote-write" /\\ ~s.polls[1].alive /\\ s.polls[1].response = "200"',
  },
  {
    name: "body carries false alive into later remote phases",
    initial: pollAt(
      "body",
      "!.polls[1].alive = FALSE, !.flowKnown = TRUE, !.mapPresent = TRUE, !.remoteCreated = TRUE",
    ),
    step: 'IF s.polls[1].phase = "body" THEN pollBody(1,TRUE,TRUE,TRUE) ELSE lookupFlow(1)',
    witness: 's.polls[1].phase = "remote-read" /\\ ~s.polls[1].alive',
    minimumState: 3,
  },
  {
    name: "late second claim breaks an already true terminal claimed clause",
    initial: state(
      `!.remoteCreated = TRUE, !.remotePresent = TRUE, !.remoteStatus = "complete", !.remoteExpiry = 4, !.remoteClaims = 1, !.polls[1].phase = "done", !.polls[1].claimed = TRUE, !.polls[2].phase = "remote-write", !.polls[2].issueStamp = 0`,
    ),
    step: "claimRemote(2)",
    witness: `s.polls[2].phase = "remote-write-reply" /\\ ~${claimed}`,
  },
  {
    name: "another poll response heals an old false200 implication",
    initial: state(
      '!.polls[1].phase = "done", !.polls[1].claimed = TRUE, !.polls[1].response = "200", !.polls[2].phase = "finish", !.polls[2].desired = "200", !.localWrites = 1',
    ),
    step: "pollReply(2,TRUE)",
    witness: `s.polls[2].phase = "done" /\\ ${issued}`,
  },
  {
    name: "finish desired200 remains live despite dirty failed obligation",
    initial: pollAt("finish", "!.polls[1].alive = FALSE"),
    step: 'IF s.polls[1].desired = "none" THEN s\' = [s EXCEPT !.polls[1].desired = "200"] ELSE pollReply(1,TRUE)',
    witness: 's.polls[1].phase = "done" /\\ s.tokenKnown',
    minimumState: 3,
  },
  {
    name: "local store preserves exact captured expiry",
    initial: pollAt("store", "!.polls[1].expiry = 3"),
    step: "storeAssertion(1)",
    witness:
      's.polls[1].phase = "store-reply" /\\ s.rowExpiry = 3 /\\ s.localWrites = 1',
  },
  {
    name: "hash carries exact expiry into original store",
    initial: pollAt("hash", "!.polls[1].expiry = 3"),
    step: 'IF s.polls[1].phase = "hash" THEN assertionHash(1,TRUE) ELSE storeAssertion(1)',
    witness: "s.rowPresent /\\ s.rowExpiry = 3",
    minimumState: 3,
  },
  {
    name: "actual consume stamp exactly at expiry is refused",
    initial: consumeAt(
      "write",
      `${readyLocal}, !.consumers[1].matches = TRUE, !.consumers[1].stamp = 2`,
    ),
    step: "consumeWrite(1)",
    witness:
      's.consumers[1].phase = "reply" /\\ ~s.consumers[1].accepted /\\ ~s.rowConsumed',
  },
  {
    name: "actual consume uses earlier captured stamp",
    initial: consumeAt(
      "write",
      `${readyLocal}, !.consumers[1].matches = TRUE, !.consumers[1].stamp = 2`,
    ),
    step: "IF s.consumers[1].stamp = 2 THEN s' = [s EXCEPT !.consumers[1].stamp = 1] ELSE consumeWrite(1)",
    witness:
      's.consumers[1].phase = "reply" /\\ s.consumers[1].accepted /\\ s.rowConsumed',
    minimumState: 3,
  },
  {
    name: "FALSE accepted stamp heals through another slot actual store",
    initial: state(
      '!.rowConsumed = TRUE, !.rowExpiry = 1, !.consumers[1].phase = "done", !.consumers[1].accepted = TRUE, !.consumers[1].stamp = 1, !.polls[2].phase = "store", !.polls[2].expiry = 2',
    ),
    step: "storeAssertion(2)",
    witness: `s.polls[2].phase = "store-reply" /\\ ${accepted}`,
  },
  {
    name: "TRUE accepted stamp breaks through another slot actual store",
    initial: state(
      '!.rowConsumed = TRUE, !.rowExpiry = 2, !.consumers[1].phase = "done", !.consumers[1].accepted = TRUE, !.consumers[1].stamp = 1, !.polls[2].phase = "store", !.polls[2].expiry = 1',
    ),
    step: "storeAssertion(2)",
    witness: `s.polls[2].phase = "store-reply" /\\ ~${accepted}`,
  },
  {
    name: "accepted body stamp survives failure into done",
    initial: consumeAt(
      "body",
      "!.consumers[1].accepted = TRUE, !.consumers[1].stamp = 2",
    ),
    step: "consumeBody(1,FALSE,FALSE,FALSE,FALSE)",
    witness: `s.consumers[1].phase = "done" /\\ s.consumers[1].accepted /\\ s.consumers[1].stamp = 2 /\\ ~${accepted}`,
  },
  {
    name: "accepted hash stamp survives failure into done",
    initial: consumeAt(
      "hash",
      "!.consumers[1].accepted = TRUE, !.consumers[1].stamp = 2",
    ),
    step: "consumeHash(1,FALSE)",
    witness: `s.consumers[1].phase = "done" /\\ s.consumers[1].accepted /\\ s.consumers[1].stamp = 2 /\\ ~${accepted}`,
  },
  {
    name: "dirty unused poll fully resets claimed and200 flags",
    initial: state(
      '!.polls[1].claimed = TRUE, !.polls[1].response = "200", !.polls[1].desired = "200", !.polls[1].alive = FALSE',
    ),
    step: "beginPoll(1,TRUE)",
    witness:
      's.polls[1].phase = "body" /\\ ~s.polls[1].claimed /\\ s.polls[1].response # "200" /\\ s.polls[1].alive',
  },
  {
    name: "dirty unused consume fully resets accepted and200 flags",
    initial: state(
      '!.consumers[1].accepted = TRUE, !.consumers[1].stamp = 9, !.consumers[1].response = "200"',
    ),
    step: "beginConsume(1)",
    witness:
      's.consumers[1].phase = "body" /\\ ~s.consumers[1].accepted /\\ s.consumers[1].response # "200"',
  },
  {
    name: "unknown poll keeps otherwise live capability and stamps",
    initial: pollAt("future"),
    step: "s' = [s EXCEPT !.polls[1].capability = TRUE, !.polls[1].remoteStamp = 9, !.polls[1].issueStamp = 9, !.polls[1].expiry = 9, !.polls[1].alive = FALSE]",
    witness:
      "s.polls[1].capability /\\ s.polls[1].remoteStamp = 9 /\\ s.polls[1].issueStamp = 9 /\\ s.polls[1].expiry = 9 /\\ ~s.polls[1].alive",
  },
  {
    name: "unknown consume keeps old matches and stamp",
    initial: consumeAt("future"),
    step: "s' = [s EXCEPT !.consumers[1].matches = TRUE, !.consumers[1].stamp = 9]",
    witness: "s.consumers[1].matches /\\ s.consumers[1].stamp = 9",
  },
);
for (const control of controls)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native bridge VIEW preserves ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain("DEV_BRIDGE_VIEW_NAMED_WITNESS_FOUND");
      expect(result.output).toContain(`State ${control.minimumState ?? 2}:`);
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );
type Pair = NativeCase & { rawStates?: number; viewStates?: number };
const pairs: Pair[] = [
  {
    name: "uniform other consumer response in unknown phase",
    initial: consumeAt("future", '!.consumers[1].response = "error"'),
    step: 's\' = [s EXCEPT !.consumers[1].response = "process-lost"]',
    witness: "FALSE",
  },
  {
    name: "start errors share the late-creation class",
    initial: state('!.startPhase = "done", !.startResult = "error"'),
    step: 's\' = [s EXCEPT !.startResult = "process-lost"]',
    witness: "FALSE",
  },
  {
    name: "other start outputs share absence of late creation",
    initial: state('!.startResult = "403"'),
    step: 's\' = [s EXCEPT !.startResult = "201"]',
    witness: "FALSE",
  },
  {
    name: "non-none authorize outputs",
    initial: state(
      '!.authorizeResult = "302", !.mapPresent = TRUE, !.remoteCreated = TRUE, !.remoteExpiry = 0',
    ),
    step: 's\' = [s EXCEPT !.authorizeResult = "410"]',
    witness: "FALSE",
  },
  {
    name: "closed poll-created to rowCreated cone",
    initial: pollAt("store"),
    step: "s' = [s EXCEPT !.polls[1].created = 9, !.rowCreated = 9]",
    witness: "FALSE",
  },
  {
    name: "other remote results",
    initial: pollAt("remote-body", '!.polls[1].remoteResult = "410"'),
    step: 's\' = [s EXCEPT !.polls[1].remoteResult = "500"]',
    witness: "FALSE",
  },
  {
    name: "other desired and response categories",
    initial: pollAt(
      "hash",
      '!.polls[1].desired = "503", !.polls[1].response = "error"',
    ),
    step: 's\' = [s EXCEPT !.polls[1].desired = "error", !.polls[1].response = "lost"]',
    witness: "FALSE",
  },
];
for (const terminal of ["unused", "finish", "done"] as const)
  pairs.push({
    name: `poll ${terminal} dead fields with a false claimed implication`,
    initial: pollAt(terminal, "!.polls[1].claimed = TRUE"),
    step: 's\' = [s EXCEPT !.polls[1].alive = FALSE, !.polls[1].capability = TRUE, !.polls[1].remoteStamp = 8, !.polls[1].issueStamp = 7, !.polls[1].expiry = 6, !.polls[1].created = 5, !.polls[1].remoteResult = "200"]',
    witness: "FALSE",
  });
for (const terminal of ["unused", "reply", "done"] as const)
  pairs.push({
    name: `consume ${terminal} dead matches and unaccepted stamp`,
    initial: consumeAt(terminal),
    step: "s' = [s EXCEPT !.consumers[1].matches = TRUE, !.consumers[1].stamp = 8]",
    witness: "FALSE",
  });
for (const phase of [
  "body",
  "lookup",
  "remote-read",
  "remote-clock",
  "remote-write",
  "remote-write-reply",
  "remote-reply",
  "remote-body",
  "delete-map",
  "mint",
  "hash",
  "store",
  "store-reply",
  "readback",
] as const) {
  const dead: string[] = [];
  if (phase !== "lookup") dead.push("!.polls[1].capability = TRUE");
  if (phase !== "remote-read") dead.push("!.polls[1].remoteStamp = 8");
  if (phase !== "remote-write") dead.push("!.polls[1].issueStamp = 8");
  if (!["hash", "store"].includes(phase)) dead.push("!.polls[1].expiry = 8");
  if (
    ![
      "body",
      "lookup",
      "remote-read",
      "remote-clock",
      "remote-write",
      "remote-write-reply",
      "remote-reply",
    ].includes(phase)
  )
    dead.push("!.polls[1].alive = FALSE");
  pairs.push({
    name: `reviewed dead carriers in poll ${phase}`,
    initial: pollAt(phase),
    step: `s' = [s EXCEPT ${dead.join(", ")}]`,
    witness: "FALSE",
  });
}
pairs.push(
  {
    name: "consume body old matches and unaccepted stamp",
    initial: consumeAt("body"),
    step: "s' = [s EXCEPT !.consumers[1].matches = TRUE, !.consumers[1].stamp = 8]",
    witness: "FALSE",
  },
  {
    name: "consume hash unaccepted old stamp",
    initial: consumeAt("hash"),
    step: "s' = [s EXCEPT !.consumers[1].stamp = 8]",
    witness: "FALSE",
  },
  {
    name: "actual abandoned start capture",
    initial: `{${state('!.startPhase = "done", !.startResult = "error"')},${state('!.startPhase = "done", !.startResult = "process-lost"')}}`,
    initialIsSet: true,
    step: "captureStartClock",
    witness: "FALSE",
    rawStates: 4,
    viewStates: 2,
  },
  {
    name: "actual closed timestamp copy through store",
    initial: `{${pollAt("store", "!.polls[1].created = 0")},${pollAt("store", "!.polls[1].created = 1")}}`,
    initialIsSet: true,
    step: "storeAssertion(1)",
    witness: "FALSE",
    rawStates: 4,
    viewStates: 2,
  },
  {
    name: "actual other remote result consumption",
    initial: `{${pollAt("remote-body", '!.polls[1].remoteResult = "410"')},${pollAt("remote-body", '!.polls[1].remoteResult = "500"')}}`,
    initialIsSet: true,
    step: "pollResponseBody(1,TRUE,FALSE)",
    witness: "FALSE",
    rawStates: 4,
    viewStates: 2,
  },
  {
    name: "actual body overwrites old consume matches",
    initial: `{${consumeAt("body", `${readyLocal}, !.consumers[1].matches = FALSE`)},${consumeAt("body", `${readyLocal}, !.consumers[1].matches = TRUE`)}}`,
    initialIsSet: true,
    step: "consumeBody(1,TRUE,TRUE,TRUE,TRUE)",
    witness: "FALSE",
    rawStates: 3,
    viewStates: 2,
  },
  {
    name: "actual hash overwrites unaccepted stamp",
    initial: `{${consumeAt("hash", "!.consumers[1].stamp = 3")},${consumeAt("hash", "!.consumers[1].stamp = 4")}}`,
    initialIsSet: true,
    step: "consumeHash(1,TRUE)",
    witness: "FALSE",
    rawStates: 3,
    viewStates: 2,
  },
);
for (const control of pairs)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native bridge VIEW coalesces only ${control.name}`,
    async () => {
      const fixture = nativeFixture(control);
      for (const [useView, count] of [
        [false, control.rawStates ?? 2],
        [true, control.viewStates ?? 1],
      ] as const) {
        const result = await runNative(fixture, useView);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("DEV_BRIDGE_VIEW_NATIVE_COMPLETE");
        expect(slopTlcTerminalCounts(result.output)).toEqual({
          distinct: count,
          queued: 0,
        });
        expect(result.output).not.toContain("Invariant q_inv is violated");
      }
    },
    240_000,
  );
for (const control of [
  {
    name: "future rowCreated guard",
    initial: state("!.rowCreated = -1"),
    step: "IF s.rowCreated = -1 THEN s' = [s EXCEPT !.rowCreated = 0] ELSE s' = [s EXCEPT !.tokenKnown = TRUE]",
    witness: "s.tokenKnown",
  },
  {
    name: "future dead expiry read",
    initial: pollAt("readback"),
    step: "IF s.polls[1].expiry = -1 THEN s' = [s EXCEPT !.polls[1].expiry = 8] ELSE readLocalAssertion(1,FALSE)",
    witness: 's.polls[1].phase = "finish"',
  },
] as const)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native no-VIEW bridge exposes ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control), false);
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("DEV_BRIDGE_VIEW_NAMED_WITNESS_FOUND");
      expect(result.output).toContain("State 3:");
      expect(result.output).not.toContain("violated by the initial state");
    },
    120_000,
  );

function slopTlcTerminalCounts(output: string) {
  const last = [
    ...output.matchAll(
      /^([\d,]+) states? generated, ([\d,]+) distinct states? found, ([\d,]+) states? left on queue\.\r?$/gmu,
    ),
  ].at(-1);
  if (!last) throw new Error("Missing final TLC state counts");
  return {
    distinct: Number(last[2].replaceAll(",", "")),
    queued: Number(last[3].replaceAll(",", "")),
  };
}
test("native evidence requires final counts rather than an earlier progress line", () => {
  expect(
    slopTlcTerminalCounts(
      "1 states generated, 1 distinct state found, 0 states left on queue.\n5 states generated, 4 distinct states found, 0 states left on queue.\n",
    ),
  ).toEqual({ distinct: 4, queued: 0 });
  expect(
    slopTlcTerminalCounts(
      "5,002 states generated, 4,001 distinct states found, 2,003 states left on queue.",
    ),
  ).toEqual({ distinct: 4001, queued: 2003 });
  expect(() =>
    slopTlcTerminalCounts(
      "Progress(1): 2 states generated, 1 distinct state found, 0 states left on queue.",
    ),
  ).toThrow("Missing final TLC state counts");
  expect(() =>
    slopTlcTerminalCounts("2 distinct states found\n0 states left on queue"),
  ).toThrow("Missing final TLC state counts");
  expect(() => slopTlcTerminalCounts("No error has been found")).toThrow(
    "Missing final TLC state counts",
  );
});
