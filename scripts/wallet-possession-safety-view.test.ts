/** Exact-source controls for the wallet possession safety VIEW. */
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
const manifest = readSafetyViews(root);
const view = manifest.views.find(
  (entry) => entry.id === "wallet-possession-continuation-safety-v1",
);
if (!view) throw new Error("Missing reviewed wallet possession VIEW");
const selected: SafetyViewDefinition = view;
const source = readFileSync(join(root, selected.model), "utf8");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2)
    throw new Error(`Expected one source boundary: ${from}`);
  return text.replace(from, to);
}
test("wallet possession VIEW binds the complete unchanged model", () => {
  expect(digest(source)).toBe(
    "2519a26652bd9f9100415f5f10a5a8b7c10b25ccb3a341eb2e56092c91fa8b0b",
  );
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
});
for (const [name, before, after] of [
  [
    "a partial signature reader",
    'all { request.phase == "hash",',
    'all { request.phase == "hash", request.signatureValid,',
  ],
  [
    "a late consumed reader",
    'all { request.phase == "hash",',
    'all { request.phase == "hash", request.consumed,',
  ],
  [
    "a late challenge reader",
    'all { request.phase == "response", s\' = s.with("requests",',
    'all { request.phase == "response", request.challenge != 0, s\' = s.with("requests",',
  ],
  [
    "independent active signature repair",
    'action tick = all { s.configured, s.now < 5, s\' = s.with("now", s.now + 1) }',
    'action tick = all { s.configured, s.now < 5, s\' = s.with("now", s.now + 1).with("requests", s.requests.set(1,s.requests.get(1).with("signatureValid",true))) }',
  ],
  [
    "proof slot reuse",
    's.requests.get(id).phase == "unused", challenge == 0',
    'Set("unused", "done").contains(s.requests.get(id).phase), challenge == 0',
  ],
  [
    "issue stamp consumed before overwrite",
    'request.with("phase", "write").with("stamp", s.now)',
    'request.with("phase", "write").with("stamp", request.stamp)',
  ],
  [
    "a distinct response status invariant",
    'Set("200", "201").contains(request.response) implies',
    'request.response == "201" implies',
  ],
] as const)
  test(`wallet source drift through ${name} requires renewed review`, () => {
    const changed = replaceOnce(source, before, after);
    expect(() =>
      bindSafetyView(manifest, selected.id, selected.model, changed),
    ).toThrow("model changed");
  });
function fixtureBinding(tlaCode: string): SafetyViewDefinition {
  const end = tlaCode.match(/^={4,}[ \t]*$/gmu);
  if (end?.length !== 1 || !tlaCode.endsWith(`${end[0]}\n`))
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

test("temporal, property and projection changes cannot reuse the wallet possession VIEW", () => {
  const temporal = `${source}\ntemporal unsafeProperty = true\n`;
  expect(() =>
    bindSafetyView(
      { ...manifest, views: [{ ...selected, sourceSha256: digest(temporal) }] },
      selected.id,
      selected.model,
      temporal,
    ),
  ).toThrow("does not authorize temporal properties");
  const tlaCode = `---- MODULE ${selected.module} ----\nVARIABLE s\n====\n`;
  const binding = fixtureBinding(tlaCode);
  for (const changed of [
    { ...binding, fields: [{ name: "state", expression: "s" }] },
    {
      ...binding,
      clauses: [{ name: "unreviewedObservation", expression: "FALSE" }],
    },
    { ...binding, operator: "UnreviewedWalletPossessionView" },
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
  const directory = mkdtempSync(
    join(tmpdir(), "slop-wallet-possession-native-"),
  );
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
};
function nativeFixture(control: NativeCase) {
  let tla = actualTranslatedModel();
  tla = replaceOnce(
    tla,
    "q_init == init",
    "SlopControlInitial == " +
      control.initial +
      "\n\nSlopControlStep == " +
      control.step +
      "\n\nSlopControlWitness == " +
      control.witness +
      "\n\nq_init == s = SlopControlInitial",
  );
  // Only the named witness determines a negative control. An unrelated
  // production-invariant failure must never satisfy it accidentally.
  tla = replaceOnce(tla, "q_inv == invariant", "q_inv == ~SlopControlWitness");
  return replaceOnce(tla, "q_step == step", "q_step == SlopControlStep");
}

async function runNative(tla: string, useView = true) {
  const binding = fixtureBinding(tla);
  const probe = [
    'import {readFileSync} from "node:fs";',
    'import {createRequire} from "node:module";',
    'import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from "./scripts/quint-safety-view.mjs";',
    "const require=createRequire(import.meta.url);",
    "const manifest=readSafetyViews(process.cwd());",
    `const view=${JSON.stringify(binding)};`,
    "const config={moduleName:view.module,tlaCode:" +
      JSON.stringify(tla) +
      ",hasInvariant:true,hasTemporal:false};",
    "const prepared=" +
      (useView ? "applySafetyView(view,config)" : "config") +
      ";",
    'const runner=loadSafetyViewTlc(require.resolve("@informalsystems/quint/dist/src/tlc.js"),manifest);',
    'const result=await runner.verify(prepared,"0.62.4",JSON.parse(readFileSync("formal/tlc.json","utf8")),3);',
    'if(result.isLeft()){if(result.value.isViolation){console.log("WALLET_POSSESSION_VIEW_NAMED_WITNESS_FOUND");process.exitCode=1;}',
    'else{console.log("WALLET_POSSESSION_VIEW_NATIVE_ERROR");process.exitCode=2;}}else console.log("WALLET_POSSESSION_VIEW_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "wallet-possession-view-native-control",
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

const cases: NativeCase[] = [
  {
    name: "clock lower bound",
    initial:
      '[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]]',
    step: "s' = [s EXCEPT !.now = -1]",
    witness: "s.now < 0",
  },
  {
    name: "clock upper bound",
    initial:
      '[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]]',
    step: "s' = [s EXCEPT !.now = 6]",
    witness: "s.now > 5",
  },
  {
    name: "successor existence",
    initial:
      '[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]]',
    step: "s' = [s EXCEPT !.current = 2]",
    witness: "s.current = 2 /\\ ~s.secondExists",
  },
  {
    name: "claim1 empty audit",
    initial:
      '[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]]',
    step: "s' = [s EXCEPT !.audits[1] = 1]",
    witness: "s.audits[1] # (IF s.attestations[1] = 0 THEN 0 ELSE 1)",
  },
  {
    name: "claim1 recorded audit",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.attestations[1] = 1, !.witnesses[1] = 1, !.audits[1] = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.requests[1].phase = "done", !.requests[1].claim = 1, !.requests[1].verified = TRUE, !.requests[1].consumed = TRUE, !.requests[1].committed = TRUE]',
    step: "s' = [s EXCEPT !.audits[1] = 0]",
    witness: "s.audits[1] # (IF s.attestations[1] = 0 THEN 0 ELSE 1)",
  },
  {
    name: "claim1 challenge spent",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.attestations[1] = 1, !.witnesses[1] = 1, !.audits[1] = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.requests[1].phase = "done", !.requests[1].claim = 1, !.requests[1].verified = TRUE, !.requests[1].consumed = TRUE, !.requests[1].committed = TRUE]',
    step: "s' = [s EXCEPT !.challenges[1].spent = FALSE]",
    witness: "~s.challenges[s.attestations[1]].spent",
  },
  {
    name: "claim1 challenge identity",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.attestations[1] = 1, !.witnesses[1] = 1, !.audits[1] = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.requests[1].phase = "done", !.requests[1].claim = 1, !.requests[1].verified = TRUE, !.requests[1].consumed = TRUE, !.requests[1].committed = TRUE]',
    step: "s' = [s EXCEPT !.challenges[1].claim = 2]",
    witness: "s.challenges[s.attestations[1]].claim # 1",
  },
  {
    name: "claim1 indexed verified witness",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.attestations[1] = 1, !.witnesses[1] = 1, !.audits[1] = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.requests[1].phase = "done", !.requests[1].claim = 1, !.requests[1].verified = TRUE, !.requests[1].consumed = TRUE, !.requests[1].committed = TRUE]',
    step: "s' = [s EXCEPT !.requests[1].verified = FALSE]",
    witness: "~s.requests[s.witnesses[1]].verified",
  },
  {
    name: "claim1 indexed committed witness",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.attestations[1] = 1, !.witnesses[1] = 1, !.audits[1] = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.requests[1].phase = "done", !.requests[1].claim = 1, !.requests[1].verified = TRUE, !.requests[1].consumed = TRUE, !.requests[1].committed = TRUE]',
    step: "s' = [s EXCEPT !.requests[1].committed = FALSE]",
    witness: "~s.requests[s.witnesses[1]].committed",
  },
  {
    name: "slot1 verified consumption",
    initial:
      '[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]]',
    step: "s' = [s EXCEPT !.requests[1].verified = TRUE]",
    witness: "s.requests[1].verified /\\ ~s.requests[1].consumed",
  },
  {
    name: "slot1 success without attestation",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].claim = 1]',
    step: 's\' = [s EXCEPT !.requests[1].response = "201"]',
    witness:
      's.requests[1].response \\in {"200","201"} /\\ s.attestations[s.requests[1].claim] = 0',
  },
  {
    name: "slot1 committed witness index",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].claim = 1]',
    step: "s' = [s EXCEPT !.requests[1].committed = TRUE]",
    witness: "s.requests[1].committed /\\ s.witnesses[s.requests[1].claim] # 1",
  },
  {
    name: "claim2 empty audit",
    initial:
      '[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]]',
    step: "s' = [s EXCEPT !.audits[2] = 1]",
    witness: "s.audits[2] # (IF s.attestations[2] = 0 THEN 0 ELSE 1)",
  },
  {
    name: "claim2 recorded audit",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.attestations[2] = 2, !.witnesses[2] = 2, !.audits[2] = 1, !.challenges[2] = [exists |-> TRUE, claim |-> 2, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.requests[2].phase = "done", !.requests[2].claim = 2, !.requests[2].verified = TRUE, !.requests[2].consumed = TRUE, !.requests[2].committed = TRUE]',
    step: "s' = [s EXCEPT !.audits[2] = 0]",
    witness: "s.audits[2] # (IF s.attestations[2] = 0 THEN 0 ELSE 1)",
  },
  {
    name: "claim2 challenge spent",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.attestations[2] = 2, !.witnesses[2] = 2, !.audits[2] = 1, !.challenges[2] = [exists |-> TRUE, claim |-> 2, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.requests[2].phase = "done", !.requests[2].claim = 2, !.requests[2].verified = TRUE, !.requests[2].consumed = TRUE, !.requests[2].committed = TRUE]',
    step: "s' = [s EXCEPT !.challenges[2].spent = FALSE]",
    witness: "~s.challenges[s.attestations[2]].spent",
  },
  {
    name: "claim2 challenge identity",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.attestations[2] = 2, !.witnesses[2] = 2, !.audits[2] = 1, !.challenges[2] = [exists |-> TRUE, claim |-> 2, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.requests[2].phase = "done", !.requests[2].claim = 2, !.requests[2].verified = TRUE, !.requests[2].consumed = TRUE, !.requests[2].committed = TRUE]',
    step: "s' = [s EXCEPT !.challenges[2].claim = 1]",
    witness: "s.challenges[s.attestations[2]].claim # 2",
  },
  {
    name: "claim2 indexed verified witness",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.attestations[2] = 2, !.witnesses[2] = 2, !.audits[2] = 1, !.challenges[2] = [exists |-> TRUE, claim |-> 2, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.requests[2].phase = "done", !.requests[2].claim = 2, !.requests[2].verified = TRUE, !.requests[2].consumed = TRUE, !.requests[2].committed = TRUE]',
    step: "s' = [s EXCEPT !.requests[2].verified = FALSE]",
    witness: "~s.requests[s.witnesses[2]].verified",
  },
  {
    name: "claim2 indexed committed witness",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.attestations[2] = 2, !.witnesses[2] = 2, !.audits[2] = 1, !.challenges[2] = [exists |-> TRUE, claim |-> 2, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.requests[2].phase = "done", !.requests[2].claim = 2, !.requests[2].verified = TRUE, !.requests[2].consumed = TRUE, !.requests[2].committed = TRUE]',
    step: "s' = [s EXCEPT !.requests[2].committed = FALSE]",
    witness: "~s.requests[s.witnesses[2]].committed",
  },
  {
    name: "slot2 verified consumption",
    initial:
      '[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]]',
    step: "s' = [s EXCEPT !.requests[2].verified = TRUE]",
    witness: "s.requests[2].verified /\\ ~s.requests[2].consumed",
  },
  {
    name: "slot2 success without attestation",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[2].claim = 2]',
    step: 's\' = [s EXCEPT !.requests[2].response = "201"]',
    witness:
      's.requests[2].response \\in {"200","201"} /\\ s.attestations[s.requests[2].claim] = 0',
  },
  {
    name: "slot2 committed witness index",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[2].claim = 2]',
    step: "s' = [s EXCEPT !.requests[2].committed = TRUE]",
    witness: "s.requests[2].committed /\\ s.witnesses[s.requests[2].claim] # 2",
  },
  {
    name: "false consumption repaired by actual consume",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "consume", !.requests[1].verified = TRUE, !.requests[1].challenge = 1, !.requests[1].stamp = 0, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> FALSE, known |-> TRUE]]',
    step: "consume(1)",
    witness: "(s.requests[1].verified => s.requests[1].consumed)",
  },
  {
    name: "successful terminal response healed by another commit",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "done", !.requests[1].response = "200", !.requests[2].phase = "batch", !.requests[2].claim = 1, !.requests[2].challenge = 1, !.requests[2].verified = TRUE, !.requests[2].consumed = TRUE, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE]]',
    step: "commit(2)",
    witness: "s.attestations[s.requests[1].claim] # 0",
  },
  {
    name: "terminal committed index can become false",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "done", !.requests[1].committed = TRUE, !.witnesses[1] = 1, !.requests[2].phase = "batch", !.requests[2].claim = 1, !.requests[2].challenge = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE]]',
    step: "commit(2)",
    witness: "s.requests[1].committed /\\ s.witnesses[s.requests[1].claim] # 1",
  },
  {
    name: "indexed false verification healed by actual verify",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.attestations[1] = 1, !.witnesses[1] = 1, !.audits[1] = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.requests[1].phase = "done", !.requests[1].claim = 1, !.requests[1].verified = TRUE, !.requests[1].consumed = TRUE, !.requests[1].committed = TRUE, !.requests[1].phase = "verify", !.requests[1].verified = FALSE, !.requests[1].challenge = 1]',
    step: "verify(1)",
    witness: "s.requests[s.witnesses[1]].verified",
  },
  {
    name: "committed witness becomes false on duplicate commit",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.attestations[1] = 1, !.witnesses[1] = 1, !.audits[1] = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.requests[1].phase = "done", !.requests[1].claim = 1, !.requests[1].verified = TRUE, !.requests[1].consumed = TRUE, !.requests[1].committed = TRUE, !.requests[1].phase = "batch", !.requests[1].challenge = 1]',
    step: "commit(1)",
    witness: "~s.requests[s.witnesses[1]].committed",
  },
  {
    name: "unused reset changes a retained global witness",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.attestations[1] = 1, !.witnesses[1] = 1, !.audits[1] = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.requests[1].phase = "done", !.requests[1].claim = 1, !.requests[1].verified = TRUE, !.requests[1].consumed = TRUE, !.requests[1].committed = TRUE, !.requests[1].phase = "unused"]',
    step: "beginProof(1,1,1,0,TRUE,TRUE,TRUE,TRUE)",
    witness: "~s.requests[s.witnesses[1]].verified",
  },
  {
    name: "consumed is live before verify sets verified",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "verify", !.requests[1].consumed = TRUE, !.requests[1].claim = 1, !.requests[1].challenge = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE]]',
    step: "IF s.requests[1].consumed THEN s' = [s EXCEPT !.requests[1].consumed = FALSE] ELSE verify(1)",
    witness: "s.requests[1].verified /\\ ~s.requests[1].consumed",
  },
  {
    name: "proof owner actor",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "owner"]',
    step: "IF s.requests[1].actor = 1 THEN s' = [s EXCEPT !.requests[1].actor = 2] ELSE proofOwner(1)",
    witness: 's.requests[1].phase = "response"',
  },
  {
    name: "body validity before consumption",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "body"]',
    step: "IF s.requests[1].bodyValid THEN s' = [s EXCEPT !.requests[1].bodyValid = FALSE] ELSE proofBody(1)",
    witness: 's.requests[1].phase = "response"',
  },
  {
    name: "captured consumption stamp",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "consume", !.requests[1].challenge = 1, !.requests[1].stamp = 0, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> FALSE, known |-> TRUE]]',
    step: "IF s.requests[1].stamp = 0 THEN s' = [s EXCEPT !.requests[1].stamp = 2] ELSE consume(1)",
    witness:
      's.requests[1].phase = "consume-reply" /\\ ~s.requests[1].consumed',
  },
  {
    name: "challenge binding at consume reply",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "consume-reply", !.requests[1].consumed = TRUE, !.requests[1].challenge = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.challenges[2] = [exists |-> TRUE, claim |-> 2, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE]]',
    step: "IF s.requests[1].challenge = 1 THEN s' = [s EXCEPT !.requests[1].challenge = 2] ELSE consumedReply(1,TRUE)",
    witness: 's.requests[1].phase = "response"',
  },
  {
    name: "challenge retained until commit",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "batch", !.requests[1].challenge = 1, !.requests[1].verified = TRUE, !.requests[1].consumed = TRUE, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.challenges[2] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE]]',
    step: "IF s.requests[1].challenge = 1 THEN s' = [s EXCEPT !.requests[1].challenge = 2] ELSE commit(1)",
    witness: "s.attestations[1] = 2",
  },
  {
    name: "desired response success class",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "response", !.requests[1].desired = "error"]',
    step: 'IF s.requests[1].desired = "error" THEN s\' = [s EXCEPT !.requests[1].desired = "201"] ELSE respondProof(1,TRUE)',
    witness: 's.requests[1].response \\in {"200","201"}',
  },
  {
    name: "issue actor before owner guard",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.issues[1].phase = "owner"]',
    step: "IF s.issues[1].actor = 1 THEN s' = [s EXCEPT !.issues[1].actor = 2] ELSE issueOwner(1)",
    witness: 's.issues[1].phase = "response"',
  },
  {
    name: "issue claim before write",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.issues[1].phase = "write", !.issues[1].stamp = 0]',
    step: "IF s.issues[1].claim = 1 THEN s' = [s EXCEPT !.issues[1].claim = 2] ELSE issueWrite(1)",
    witness: "s.challenges[1].claim = 2",
  },
  {
    name: "issue stamp before write",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.issues[1].phase = "write", !.issues[1].stamp = 0]',
    step: "IF s.issues[1].stamp = 0 THEN s' = [s EXCEPT !.issues[1].stamp = 1] ELSE issueWrite(1)",
    witness: "s.challenges[1].issued = 1",
  },
  {
    name: "fieldsMatch before joint verification",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "verify", !.requests[1].consumed = TRUE, !.requests[1].claim = 1, !.requests[1].challenge = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE]]',
    step: "IF s.requests[1].fieldsMatch THEN s' = [s EXCEPT !.requests[1].fieldsMatch = FALSE] ELSE verify(1)",
    witness: 's.requests[1].phase = "response" /\\ ~s.requests[1].verified',
  },
  {
    name: "signatureValid before joint verification",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "verify", !.requests[1].consumed = TRUE, !.requests[1].claim = 1, !.requests[1].challenge = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE]]',
    step: "IF s.requests[1].signatureValid THEN s' = [s EXCEPT !.requests[1].signatureValid = FALSE] ELSE verify(1)",
    witness: 's.requests[1].phase = "response" /\\ ~s.requests[1].verified',
  },
  {
    name: "windowMatch before joint verification",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "verify", !.requests[1].consumed = TRUE, !.requests[1].claim = 1, !.requests[1].challenge = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE]]',
    step: "IF s.requests[1].windowMatch THEN s' = [s EXCEPT !.requests[1].windowMatch = FALSE] ELSE verify(1)",
    witness: 's.requests[1].phase = "response" /\\ ~s.requests[1].verified',
  },
];
for (const control of cases)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native wallet possession VIEW retains ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      // State 2 proves noninitiality; a continuation may reach its named
      // witness in a later state. The initial-state violation is rejected.
      expect(result.output).toContain("State 2:");
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).toContain(
        "WALLET_POSSESSION_VIEW_NAMED_WITNESS_FOUND",
      );
      expect(result.output).not.toContain("No error has been found");
    },
    120000,
  );
const coalescingCases = [
  {
    name: "unused issue payload",
    initial:
      '[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]]',
    step: 's\' = [s EXCEPT !.issues[1].claim = 2, !.issues[1].actor = 2, !.issues[1].stamp = 3, !.issues[1].desired = "201", !.issues[1].response = "200"]',
  },
  {
    name: "terminal issue payload",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.issues[1].phase = "response"]',
    step: 's\' = [s EXCEPT !.issues[1].claim = 2, !.issues[1].actor = 2, !.issues[1].stamp = 3, !.issues[1].desired = "201", !.issues[1].response = "200"]',
  },
  {
    name: "written issue payload after challenge materialization",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.issues[1].phase = "written"]',
    step: "s' = [s EXCEPT !.issues[1].claim = 2, !.issues[1].actor = 2, !.issues[1].stamp = 3]",
  },
  {
    name: "issue prepare stamp before overwrite",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.issues[1].phase = "prepare"]',
    step: "s' = [s EXCEPT !.issues[1].stamp = 3, !.issues[1].actor = 2]",
  },
  {
    name: "unused proof payload while keeping invariant observations",
    initial:
      '[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]]',
    step: 's\' = [s EXCEPT !.requests[1].actor = 2, !.requests[1].challenge = 2, !.requests[1].bodyValid = FALSE, !.requests[1].fieldsMatch = FALSE, !.requests[1].signatureValid = FALSE, !.requests[1].windowMatch = FALSE, !.requests[1].stamp = 4, !.requests[1].desired = "201", !.requests[1].consumed = TRUE]',
  },
  {
    name: "done proof payload while keeping claim and witness bits",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "done"]',
    step: 's\' = [s EXCEPT !.requests[1].actor = 2, !.requests[1].challenge = 2, !.requests[1].bodyValid = FALSE, !.requests[1].fieldsMatch = FALSE, !.requests[1].stamp = 4, !.requests[1].desired = "201", !.requests[1].consumed = TRUE]',
  },
  {
    name: "two successful status codes in an already false prefix",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "done", !.requests[1].response = "200"]',
    step: 's\' = [s EXCEPT !.requests[1].response = "201"]',
  },
  {
    name: "three flags with the same false conjunction",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "verify", !.requests[1].consumed = TRUE, !.requests[1].claim = 1, !.requests[1].challenge = 1, !.challenges[1] = [exists |-> TRUE, claim |-> 1, issued |-> 0, expires |-> 2, spent |-> TRUE, known |-> TRUE], !.requests[1].fieldsMatch = FALSE]',
    step: "s' = [s EXCEPT !.requests[1].fieldsMatch = TRUE, !.requests[1].signatureValid = FALSE]",
  },
  {
    name: "post-verification payload with false verified flag",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "hash"]',
    step: "s' = [s EXCEPT !.requests[1].actor = 2, !.requests[1].bodyValid = FALSE, !.requests[1].fieldsMatch = FALSE, !.requests[1].signatureValid = FALSE, !.requests[1].stamp = 3, !.requests[1].consumed = TRUE]",
  },
  {
    name: "proof body stamp before overwrite",
    initial:
      '[[configured |-> TRUE, firstKind |-> "solana", now |-> 0, current |-> 1, secondExists |-> FALSE, challenges |-> [i \\in {0,1,2} |-> noChallenge], issues |-> [i \\in {1,2} |-> noIssue], requests |-> [i \\in {1,2} |-> noProof], attestations |-> [i \\in {1,2} |-> 0], witnesses |-> [i \\in {1,2} |-> 0], audits |-> [i \\in {1,2} |-> 0]] EXCEPT !.requests[1].phase = "body"]',
    step: "s' = [s EXCEPT !.requests[1].stamp = 4, !.requests[1].actor = 2]",
  },
];
for (const control of coalescingCases)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native wallet possession VIEW coalesces only ${control.name}`,
    async () => {
      const tla = nativeFixture({ ...control, witness: "FALSE" });
      const raw = await runNative(tla, false);
      expect(raw.status, raw.output).toBe(0);
      expect(raw.output).toMatch(/2 distinct states? found/u);
      expect(raw.output).toMatch(/0 states? left on queue/u);
      const viewed = await runNative(tla);
      expect(viewed.status, viewed.output).toBe(0);
      expect(viewed.output).toMatch(/1 distinct states? found/u);
      expect(viewed.output).toMatch(/0 states? left on queue/u);
    },
    120000,
  );
