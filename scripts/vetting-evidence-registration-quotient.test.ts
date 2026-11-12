/** Exact-source and native controls for registration observation classes. */
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
const candidate = manifest.views.find(
  (entry) => entry.id === "vetting-evidence-registration-observation-safety-v1",
);
if (!candidate) throw new Error("Missing reviewed registration VIEW");
const selected: SafetyViewDefinition = candidate;
const source = readFileSync(join(root, selected.model), "utf8");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2)
    throw new Error(`Expected one source boundary: ${from}`);
  return text.replace(from, to);
}
test("registration VIEW binds the complete original model and literal projection", () => {
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
  expect(digest(source)).toBe(
    "351ba8aa9a95eacd15a068743ed99a5a75f35b4d5581446b10fa84dcdcc9f00c",
  );
  expect(digest(selected.fields[0].expression)).toBe(
    "c51bed78625615b613949ba62b8be28d3c0e5deda2fc37fd9ab15ebe18f7060b",
  );
  expect(selected.clauses).toEqual([]);
});
for (const [name, from, to] of [
  [
    "corrupt-byte consumer",
    's.bytes.get(r.hintIndex + 1 + 3 * (generation - 1)) == "valid"',
    's.bytes.get(r.hintIndex + 1 + 3 * (generation - 1)) != "missing"',
  ],
  [
    "raw-form ordering consumer",
    "if (r.raw == 3) 2 else 1",
    "if (r.raw == 2) 2 else 1",
  ],
  [
    "distinct JSON fault consumer",
    'if (Set("json", "shape", "digest", "empty", "limit").contains(r.fault))',
    'if (r.fault == "json")',
  ],
  [
    "distinct object fault consumer",
    'if (r.fault != "none")',
    'if (r.fault == "object")',
  ],
  [
    "stored membership guard",
    'all { r.phase == "hints", r.hintIndex < 3,',
    'all { r.phase == "hints", r.hintIndex < 3, r.stored.contains(1),',
  ],
  [
    "outside-poison removal",
    "r.stored.union(Set(1))",
    "r.stored.exclude(Set(3))",
  ],
  [
    "outside-poison publication",
    "r.stored.union(Set(2))",
    "r.stored.union(Set(3))",
  ],
  [
    "begin no longer resets stored",
    'idle.with("phase", "configuration")',
    'previous.with("phase", "configuration")',
  ],
  [
    "other status invariant",
    "r.status == 201 implies r.committed",
    "Set(201, 500).contains(r.status) implies r.committed",
  ],
  [
    "whole-file guard",
    'action wrongWhole = s\' = s.with("wholeMatches", false)',
    'action wrongWhole = all { s.wholeMatches, s\' = s.with("wholeMatches", false) }',
  ],
  [
    "request service guard",
    'all { r.phase == "configuration",',
    'all { r.phase == "configuration", r.service == 1,',
  ],
  [
    "request capture-time guard",
    'all { r.phase == "batch",',
    'all { r.phase == "batch", r.at <= s.now,',
  ],
  [
    "row service consumer",
    "row.manifest != 0 implies row.objects == Set(1, 2)",
    "row.manifest != 0 implies row.service == 1 and row.objects == Set(1, 2)",
  ],
  [
    "row time consumer",
    "row.manifest == 0 implies row.objects.size() == 0",
    "row.manifest == 0 implies row.at == 0 and row.objects.size() == 0",
  ],
  [
    "diagnostic cause consumer",
    'all { r.phase == "batch-reply",',
    'all { r.phase == "batch-reply", r.cause == "none",',
  ],
  [
    "delivery-history consumer",
    'Set("idle", "done").contains(previous.phase), previous.attempt < 2,',
    'Set("idle", "done").contains(previous.phase), not(previous.delivered), previous.attempt < 2,',
  ],
  [
    "changed raw domain",
    "Set(1, 2, 3).contains(raw)",
    "Set(1, 2, 3, 4).contains(raw)",
  ],
] as const)
  test(`registration VIEW refuses the ${name}`, () => {
    const changed = replaceOnce(source, from, to);
    expect(() =>
      bindSafetyView(manifest, selected.id, selected.model, changed),
    ).toThrow("model changed");
  });

function fixtureBinding(tlaCode: string): SafetyViewDefinition {
  const end = tlaCode.match(/^={4,}[ \t]*$/gmu);
  if (end?.length !== 1 || !tlaCode.endsWith(`${end[0]}\n`))
    throw new Error("Fixture terminator differs");
  const definition = `${selected.operator} ==\n  <<${[...selected.fields, ...selected.clauses].map(({ expression }) => expression).join(", ")}>>\n\n`;
  const viewed = `${tlaCode.slice(0, -end[0].length - 1)}${definition}${end[0]}\n`;
  return {
    ...selected,
    translatedSha256: digest(tlaCode),
    viewTlaSha256: digest(viewed),
  };
}
function productionBinding(tlaCode: string) {
  expect(tlaCode).toMatch(/={80}\n$/u);
  expect(digest(tlaCode)).toBe(
    "3388b5c753ed3c871a00e2d3584f61e4608edaba67aec546578513335c954eae",
  );
  const prepared = applySafetyView(selected, {
    moduleName: selected.module,
    tlaCode,
    hasInvariant: true,
    hasTemporal: false,
  });
  expect(digest(prepared.tlaCode)).toBe(
    "81f21385a81587b0ced0b773290a118695a784c9d26e96b4977956f999f582a3",
  );
  expect(prepared.tlaCode).toMatch(/={80}\n$/u);
  return prepared;
}
test.skipIf(!process.env.SLOP_REGISTRATION_PRODUCTION_TLA)(
  "registration VIEW binds the actual complete production TLA",
  () => {
    const path = process.env.SLOP_REGISTRATION_PRODUCTION_TLA;
    if (!path) throw new Error("Missing captured production TLA");
    productionBinding(readFileSync(path, "utf8"));
  },
);
let translated: string | undefined;
function actualTranslatedModel() {
  if (translated !== undefined) return translated;
  const directory = mkdtempSync(
    join(tmpdir(), "slop-registration-view-native-"),
  );
  const output = join(directory, "production.tla");
  try {
    const capture = [
      'import {createRequire} from "node:module";',
      'import {realpathSync,writeFileSync} from "node:fs";',
      'import {pathToFileURL} from "node:url";',
      "const require=createRequire(import.meta.url);",
      'const cli=realpathSync("./node_modules/.bin/quint");',
      "delete process.env.SLOP_QUINT_SAFETY_VIEW;",
      `process.argv=[process.execPath,cli,"verify",${JSON.stringify(selected.model)},"--backend=tlc","--verbosity=3","--tlc-config=formal/tlc.json","--invariant=invariant"];`,
      'await import(pathToFileURL(process.cwd()+"/scripts/quint-local-translator.mjs").href);',
      `require("@informalsystems/quint/dist/src/tlc.js").verify=async config=>{writeFileSync(${JSON.stringify(output)},config.tlaCode);process.exit(0);};`,
      "await import(pathToFileURL(cli).href);",
    ].join("\n");
    // Capture the full real verify input and stop before TLC exploration.
    execFileSync("node", ["--input-type=module", "-e", capture], {
      cwd: root,
      encoding: "utf8",
      timeout: 90_000,
    });
    translated = readFileSync(output, "utf8");
    productionBinding(translated);
    return translated;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const row =
  "[generation |-> 1, manifest |-> 1, objects |-> {1,2}, audited |-> TRUE, service |-> 1, at |-> 0]";
const emptyRow =
  "[generation |-> 0, manifest |-> 0, objects |-> {}, audited |-> FALSE, service |-> 0, at |-> 0]";
const initial = `[now |-> 0, assessment |-> TRUE, generation |-> 1, wholeMatches |-> TRUE,
 rows |-> [id \\in {1,2} |-> ${row}], bytes |-> [part \\in {1,2,3,4,5,6} |-> "valid"],
 requests |-> [id \\in {1,2} |-> [phase |-> "hints", attempt |-> 1, scope |-> id, raw |-> 1, manifest |-> 1, fault |-> "none", service |-> id, at |-> 0, committed |-> TRUE, cause |-> "none", status |-> 201, replayed |-> FALSE, hintIndex |-> 0, stored |-> {}, delivered |-> FALSE]]]`;
const state = (patch: string) => `[${initial} EXCEPT ${patch}]`;
type Control = {
  name: string;
  initial: string;
  step: string;
  witness: string;
  minimumState?: 2 | 3;
  initialIsSet?: boolean;
};
function nativeFixture(control: Control) {
  let tla = actualTranslatedModel();
  tla = replaceOnce(
    tla,
    "q_init == init",
    `SlopInitial == ${control.initial}\n\nSlopNext == ${control.step}\n\nSlopWitness == ${control.witness}\n\nq_init == s ${control.initialIsSet ? "\\in" : "="} SlopInitial`,
  );
  tla = replaceOnce(tla, "q_inv == invariant", "q_inv == ~SlopWitness");
  return replaceOnce(tla, "q_step == step", "q_step == SlopNext");
}
async function runNative(tlaCode: string, useView = true) {
  const binding = fixtureBinding(tlaCode);
  const probe = [
    'import {readFileSync} from "node:fs";',
    'import {createRequire} from "node:module";',
    'import {applySafetyView,loadSafetyViewTlc,readSafetyViews} from "./scripts/quint-safety-view.mjs";',
    "const require=createRequire(import.meta.url);",
    "const manifest=readSafetyViews(process.cwd());",
    `const raw={moduleName:${JSON.stringify(selected.module)},tlaCode:${JSON.stringify(tlaCode)},hasInvariant:true,hasTemporal:false};`,
    `const prepared=${useView ? `applySafetyView(${JSON.stringify(binding)},raw)` : "raw"};`,
    'const runner=loadSafetyViewTlc(require.resolve("@informalsystems/quint/dist/src/tlc.js"),manifest);',
    'const result=await runner.verify(prepared,"0.62.4",JSON.parse(readFileSync("formal/tlc.json","utf8")),3);',
    'if(result.isLeft()){if(!result.value.isViolation)process.exit(2);console.log("REGISTRATION_NAMED_WITNESS_FOUND");process.exit(1);}console.log("REGISTRATION_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "registration-view-native",
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
const controls: Control[] = [];
function observation(
  name: string,
  property: string,
  corrupt: string,
  repair: string,
  initialPatch = "",
) {
  controls.push({
    name: `${name} false`,
    initial: initialPatch ? state(initialPatch) : initial,
    step: `s' = [s EXCEPT ${corrupt}]`,
    witness: `~(${property})`,
  });
  controls.push({
    name: `${name} healing`,
    initial: state([initialPatch, corrupt].filter(Boolean).join(", ")),
    step: `s' = [s EXCEPT ${repair}]`,
    witness: property,
  });
}

observation(
  "row manifest/audit equivalence",
  "(s.rows[1].manifest # 0) = s.rows[1].audited",
  "!.rows[1].audited = FALSE",
  "!.rows[1].audited = TRUE",
);
const registered =
  "(s.rows[1].manifest # 0 => (s.rows[1].objects = {1,2} /\\ s.assessment /\\ s.rows[1].generation \\in {1,2}))";
observation(
  "registered objects",
  registered,
  "!.rows[1].objects = {1}",
  "!.rows[1].objects = {1,2}",
);
observation(
  "registered generation",
  registered,
  "!.rows[1].generation = 0",
  "!.rows[1].generation = 1",
);
observation(
  "registered assessment",
  registered,
  "!.assessment = FALSE",
  "!.assessment = TRUE",
);
observation(
  "empty row objects",
  "(s.rows[1].manifest = 0 => s.rows[1].objects = {})",
  "!.rows[1].objects = {1}",
  "!.rows[1].objects = {}",
  `!.rows[1] = ${emptyRow}`,
);
observation(
  "attempt bound",
  "s.requests[1].attempt <= 2",
  "!.requests[1].attempt = 3",
  "!.requests[1].attempt = 1",
);
observation(
  "stored subset",
  "s.requests[1].stored \\subseteq {1,2}",
  "!.requests[1].stored = {3}",
  "!.requests[1].stored = {}",
);
for (const status of [200, 201])
  observation(
    `success binding ${status}`,
    "(s.requests[1].status \\in {200,201} => s.rows[s.requests[1].scope].manifest = s.requests[1].manifest)",
    "!.requests[1].manifest = 2",
    "!.requests[1].manifest = 1",
    `!.requests[1].status = ${status}`,
  );
observation(
  "201 requires committed",
  "(s.requests[1].status = 201 => s.requests[1].committed)",
  "!.requests[1].committed = FALSE",
  "!.requests[1].committed = TRUE",
);
const replay =
  '(s.requests[1].replayed => (s.requests[1].status = 200 /\\ s.requests[1].phase # "batch"))';
observation(
  "replay status",
  replay,
  "!.requests[1].status = 500",
  "!.requests[1].status = 200",
  "!.requests[1].status = 200, !.requests[1].replayed = TRUE",
);
observation(
  "replay phase",
  replay,
  '!.requests[1].phase = "batch"',
  '!.requests[1].phase = "hints"',
  "!.requests[1].status = 200, !.requests[1].replayed = TRUE",
);
controls.push(
  {
    name: "other-to-201 reveals false committed clause",
    initial: state(
      "!.requests[1].status = 500, !.requests[1].committed = FALSE",
    ),
    step: "s' = [s EXCEPT !.requests[1].status = 201]",
    witness: "~(s.requests[1].status = 201 => s.requests[1].committed)",
  },
  {
    name: "201-to-200 heals committed clause",
    initial: state(
      "!.requests[1].status = 201, !.requests[1].committed = FALSE",
    ),
    step: "s' = [s EXCEPT !.requests[1].status = 200]",
    witness: "(s.requests[1].status = 201 => s.requests[1].committed)",
  },
);
for (const [name, patch, property] of [
  ["scope", "!.requests[1].scope = 2", "s.requests[1].scope = 1"],
  ["manifest", "!.requests[1].manifest = 2", "s.requests[1].manifest = 1"],
  ["hint cursor", "!.requests[1].hintIndex = 1", "s.requests[1].hintIndex = 0"],
  ["current generation", "!.generation = 2", "s.generation = 1"],
  ["row generation", "!.rows[1].generation = 2", "s.rows[1].generation = 1"],
  ["global clock", "!.now = 1", "s.now = 0"],
  [
    "physical-byte domain",
    '!.bytes = [part \\in {1,2,3,4,5} |-> "valid"]',
    "DOMAIN s.bytes = {1,2,3,4,5,6}",
  ],
] as const)
  controls.push({
    name: `exact live ${name}`,
    initial,
    step: `s' = [s EXCEPT ${patch}]`,
    witness: `~(${property})`,
  });
for (const part of [1, 2, 3, 4, 5, 6])
  controls.push({
    name: `validity of physical part ${part}`,
    initial,
    step: `changePart(${part},"corrupt")`,
    witness: `s.bytes[${part}] # "valid"`,
  });
controls.push(
  {
    name: "early JSON class reaches original refusal",
    initial: state(
      '!.requests[1].phase = "json", !.requests[1].fault = "none", !.requests[1].status = 0',
    ),
    step: 'IF s.requests[1].fault = "none" THEN s\' = [s EXCEPT !.requests[1].fault = "shape"] ELSE json(1)',
    witness: 's.requests[1].phase = "response"',
    minimumState: 3,
  },
  {
    name: "early JSON differs from object faults before assessment",
    initial: state(
      '!.requests[1].phase = "json", !.requests[1].fault = "object", !.requests[1].status = 0',
    ),
    step: 'IF s.requests[1].fault = "object" THEN s\' = [s EXCEPT !.requests[1].fault = "digest"] ELSE json(1)',
    witness: 's.requests[1].phase = "response"',
    minimumState: 3,
  },
  {
    name: "object fault reaches original per-object refusal",
    initial: state(
      '!.requests[1].phase = "objects", !.requests[1].fault = "none", !.requests[1].status = 0',
    ),
    step: 'IF s.requests[1].fault = "none" THEN s\' = [s EXCEPT !.requests[1].fault = "assembly"] ELSE objects(1)',
    witness: 's.requests[1].phase = "response"',
    minimumState: 3,
  },
  {
    name: "none class reaches original canonical phase",
    initial: state(
      '!.requests[1].phase = "objects", !.requests[1].fault = "duplicate", !.requests[1].status = 0',
    ),
    step: 'IF s.requests[1].fault = "duplicate" THEN s\' = [s EXCEPT !.requests[1].fault = "none"] ELSE objects(1)',
    witness: 's.requests[1].phase = "canonical"',
    minimumState: 3,
  },
  {
    name: "raw3 reaches original changed manifest",
    initial: state(
      '!.requests[1].phase = "canonical", !.requests[1].raw = 1, !.requests[1].manifest = 0, !.requests[1].status = 0',
    ),
    step: "IF s.requests[1].raw = 1 THEN s' = [s EXCEPT !.requests[1].raw = 3] ELSE canonical(1)",
    witness: "s.requests[1].manifest = 2",
    minimumState: 3,
  },
  {
    name: "nonvalid second part takes original skip",
    initial: state("!.requests[1].hintIndex = 1"),
    step: 'IF s.bytes[2] = "valid" THEN s\' = [s EXCEPT !.bytes[2] = "missing"] ELSE hint(1,TRUE)',
    witness: "s.requests[1].hintIndex = 3",
    minimumState: 3,
  },
  {
    name: "outside stored poison carries through original hint",
    initial: state("!.requests[1].stored = {3}"),
    step: "hint(1,TRUE)",
    witness:
      "s.requests[1].hintIndex = 1 /\\ ~(s.requests[1].stored \\subseteq {1,2})",
  },
  {
    name: "begin fully resets outside stored poison",
    initial: state(
      '!.requests[1].phase = "done", !.requests[1].stored = {3}, !.requests[1].committed = FALSE',
    ),
    step: 'begin(1,1,2,"none",1)',
    witness:
      's.requests[1].phase = "configuration" /\\ s.requests[1].attempt = 2 /\\ (s.requests[1].stored \\subseteq {1,2})',
  },
  {
    name: "assessment remains an original live gate",
    initial: state(
      '!.requests[1].phase = "assessment", !.requests[1].status = 0',
    ),
    step: "IF s.assessment THEN s' = [s EXCEPT !.assessment = FALSE] ELSE assessment(1,TRUE)",
    witness: 's.requests[1].phase = "response"',
    minimumState: 3,
  },
);
for (const control of controls)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native registration VIEW retains ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain(`State ${control.minimumState ?? 2}:`);
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).toContain("REGISTRATION_NAMED_WITNESS_FOUND");
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );

type Pair = Omit<Control, "witness"> & {
  rawStates?: number;
  viewStates?: number;
};
const pairs: Pair[] = [];
for (const part of [1, 2, 3, 4, 5, 6])
  pairs.push({
    name: `nonvalid physical part ${part}`,
    initial: state(`!.requests[1].attempt = 3, !.bytes[${part}] = "missing"`),
    step: `changePart(${part},"corrupt")`,
  });
pairs.push(
  {
    name: "early JSON fault names",
    initial: state('!.requests[1].fault = "shape", !.requests[1].attempt = 3'),
    step: 's\' = [s EXCEPT !.requests[1].fault = "limit"]',
  },
  {
    name: "later object fault names",
    initial: state('!.requests[1].fault = "layout", !.requests[1].attempt = 3'),
    step: 's\' = [s EXCEPT !.requests[1].fault = "trace"]',
  },
  {
    name: "the two canonical raw orderings",
    initial: state("!.requests[1].attempt = 3"),
    step: "s' = [s EXCEPT !.requests[1].raw = 2]",
  },
  {
    name: "other status with false replay clause",
    initial: state("!.requests[1].status = 500, !.requests[1].replayed = TRUE"),
    step: "s' = [s EXCEPT !.requests[1].status = 409]",
  },
  {
    name: "inside stored subsets",
    initial: state("!.requests[1].attempt = 3"),
    step: "s' = [s EXCEPT !.requests[1].stored = {1,2}]",
  },
  {
    name: "outside stored poison values",
    initial: state("!.requests[1].stored = {3}, !.requests[1].attempt = 3"),
    step: "s' = [s EXCEPT !.requests[1].stored = {1,4}]",
  },
  {
    name: "the complete write-only and copy cone",
    initial: state("!.requests[1].attempt = 3"),
    step: 's\' = [s EXCEPT !.wholeMatches = FALSE, !.requests[1].service = 2, !.requests[1].at = 2, !.rows[1].service = 2, !.rows[1].at = 2, !.requests[1].cause = "unique", !.requests[1].delivered = TRUE]',
  },
);
const batchPrefix = `!.rows[1] = ${emptyRow}, !.now = 2, !.requests[1].phase = "batch", !.requests[1].status = 0, !.requests[1].committed = FALSE, !.requests[1].stored = {3}`;
pairs.push({
  name: "copy cone through the actual batch",
  initial: `{${state(`${batchPrefix}, !.requests[1].service = 1, !.requests[1].at = 0`)}, ${state(`${batchPrefix}, !.requests[1].service = 2, !.requests[1].at = 1`)}}`,
  initialIsSet: true,
  step: "batch(1,TRUE)",
  rawStates: 4,
  viewStates: 2,
});
pairs.push({
  name: "outside poison through the actual hint",
  initial: `{${state("!.requests[1].stored = {3}")}, ${state("!.requests[1].stored = {4}")}}`,
  initialIsSet: true,
  step: "IF s.requests[1].hintIndex = 0 THEN hint(1,TRUE) ELSE s' = s",
  rawStates: 4,
  viewStates: 2,
});
// TRUE alone is the coalescing diagnostic. Already-false clauses remain in raw
// initial states, but no unrelated invariant may accidentally satisfy a test.
for (const pair of pairs)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native registration VIEW coalesces only ${pair.name}`,
    async () => {
      const tla = nativeFixture({ ...pair, witness: "FALSE" });
      for (const [useView, count] of [
        [false, pair.rawStates ?? 2],
        [true, pair.viewStates ?? 1],
      ] as const) {
        const result = await runNative(tla, useView);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain("REGISTRATION_NATIVE_COMPLETE");
        expect(result.output).toMatch(
          new RegExp(`${count} distinct states? found`),
        );
        expect(result.output).toMatch(/0 states? left on queue/u);
        expect(result.output).not.toContain("Invariant q_inv is violated");
      }
    },
    240_000,
  );
