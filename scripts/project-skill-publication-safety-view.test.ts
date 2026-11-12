/** Exact-source and native controls for project-skill-publication observation VIEW. */
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
  (entry) => entry.id === "project-skill-publication-observation-safety-v1",
);
if (!candidate)
  throw new Error("Missing reviewed project-skill-publication VIEW");
const selected: SafetyViewDefinition = candidate;
const source = readFileSync(join(root, selected.model), "utf8");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function replaceOnce(text: string, from: string, to: string) {
  if (text.split(from).length !== 2)
    throw new Error(`Expected one source boundary: ${from}`);
  return text.replace(from, to);
}
test("project-skill-publication VIEW binds every original source byte and its literal", () => {
  expect(bindSafetyView(manifest, selected.id, selected.model, source)).toEqual(
    selected,
  );
  expect(digest(source)).toBe(
    "8e77f39ef6ffac1e1dfb4ffb7d866877141edb691d28a3f88eac09b67bcd984d",
  );
  expect(digest(selected.fields[0].expression)).toBe(
    "9b02d2d4d82d9ff51a5be1093cd4c5c3e09c799ff2a703df487f43b185a718ac",
  );
  expect(selected.clauses).toEqual([]);
});
const futureChanges = [
  [
    "delivered becomes a guard",
    'all { request.phase == "response",',
    'all { request.phase == "response", request.delivered,',
  ],
  [
    "postlookup captured present reader",
    'all { request.phase == "template",',
    'all { request.phase == "template", request.present.contains(1),',
  ],
  [
    "postlookup active consumer",
    'all { request.phase == "discovered",',
    'all { request.phase == "discovered", request.active.contains(1),',
  ],
  [
    "postlookup published consumer",
    'all { request.phase == "select",',
    'all { request.phase == "select", request.published.contains(1),',
  ],
  [
    "postlookup retired consumer",
    'all { request.phase == "render",',
    'all { request.phase == "render", not(request.retired.contains(1)),',
  ],
  [
    "postlookup restrictions consumer",
    'all { request.phase == "files", request.fileCount < 4,',
    'all { request.phase == "files", request.fileCount < 4, request.restrictions == Set(),',
  ],
  [
    "postlookup projectRead consumer",
    'all { request.phase == "template",',
    'all { request.phase == "template", request.projectRead,',
  ],
  [
    "postlookup restrictionsRead consumer",
    'all { request.phase == "discovered",',
    'all { request.phase == "discovered", request.restrictionsRead,',
  ],
  [
    "terminal slot reuse",
    's.requests.get(id).phase == "unused",',
    'Set("unused", "done").contains(s.requests.get(id).phase),',
  ],
  [
    "incomplete begin reset",
    'idle.with("method", method)',
    's.requests.get(id).with("method", method)',
  ],
  [
    "cross-slot terminal capture read",
    'all { request.phase == "template",',
    'all { request.phase == "template", s.requests.get(2).project == 1,',
  ],
  [
    "terminal new action reader",
    'all { request.phase == "render",',
    'all { Set("render", "done").contains(request.phase),',
  ],
  [
    "false-class invariant expansion",
    "request.status > 0 implies request.noStore,",
    "request.status > 0 implies request.noStore and request.delivered,",
  ],
  [
    "joined last-read boundary",
    'else request.with("phase", "template").with("candidates", Set(request.project))',
    'else request.with("phase", "files").with("candidates", Set(request.project))',
  ],
  [
    "live captured revision future reader",
    "request.renderedRevision == request.revisions.get(request.project)",
    "request.renderedRevision == request.revisions.get(request.project) and request.projectRead",
  ],
  [
    "omit phase guard",
    's.requests.get(id).phase == "unused"),',
    "s.requests.get(id).projectRead),",
  ],
  [
    "method domain extension",
    'Set("GET", "HEAD", "POST").contains(method)',
    'Set("GET", "HEAD", "POST", "PUT").contains(method)',
  ],
] as const;
for (const [name, from, to] of futureChanges)
  test(`project-skill-publication VIEW refuses ${name}`, () => {
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
    "7c76fd6292c40eed4db8aca7c4a07a62432e1620aee1cf205d123672adf929a1",
  );
  const prepared = applySafetyView(selected, {
    moduleName: selected.module,
    tlaCode,
    hasInvariant: true,
    hasTemporal: false,
  });
  expect(digest(prepared.tlaCode)).toBe(
    "7e4ec60a5134693116b227e97102787ee6bc4693f3ee2e8a64d4a5e324043e19",
  );
  expect(prepared.tlaCode).toMatch(/={80}\n$/u);
  return prepared;
}
test.skipIf(!process.env.SLOP_PROJECT_SKILL_PUBLICATION_PRODUCTION_TLA)(
  "project-skill-publication VIEW binds the actual full production TLA",
  () => {
    const path = process.env.SLOP_PROJECT_SKILL_PUBLICATION_PRODUCTION_TLA;
    if (!path) throw new Error("Missing captured production TLA");
    productionBinding(readFileSync(path, "utf8"));
  },
);
let translated: string | undefined;
function actualTranslatedModel() {
  if (translated !== undefined) return translated;
  const directory = mkdtempSync(
    join(tmpdir(), "slop-project-skill-publication-view-native-"),
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
    // The full production translation is captured before any TLC exploration.
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
    `SlopInitial == ${control.initial}\n\nq_init == s ${control.initialIsSet ? "\\in" : "="} SlopInitial`,
  );
  // Keep aliases after their actual production dependencies.
  tla = replaceOnce(
    tla,
    "q_inv == invariant",
    `SlopWitness == ${control.witness}\n\nq_inv == ~SlopWitness`,
  );
  return replaceOnce(
    tla,
    "q_step == step",
    `SlopNext == ${control.step}\n\nq_step == SlopNext`,
  );
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
    'if(result.isLeft()){if(!result.value.isViolation)process.exit(2);console.log("PROJECT_SKILL_PUBLICATION_NAMED_WITNESS_FOUND");process.exit(1);}console.log("PROJECT_SKILL_PUBLICATION_NATIVE_COMPLETE");',
  ].join("\n");
  let output = "";
  const status = await runE2ePhase({
    label: "project-skill-publication-view-native",
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

// Feasible individual RAW clauses, including dirty unused and absorbing slots.
const controls: Control[] = [
  {
    name: "unused no-store false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].status = 503, !.requests[1].noStore = TRUE]',
    step: "s' = [s EXCEPT !.requests[1].noStore = FALSE]",
    witness: "~((s.requests[1].status > 0 => s.requests[1].noStore))",
  },
  {
    name: "unused no-store healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].status = 503, !.requests[1].noStore = TRUE, !.requests[1].noStore = FALSE]',
    step: "s' = [s EXCEPT !.requests[1].noStore = TRUE]",
    witness: "(s.requests[1].status > 0 => s.requests[1].noStore)",
  },
  {
    name: "unused HEAD body false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].method = "HEAD", !.requests[1].status = 503, !.requests[1].caught = FALSE, !.requests[1].body = FALSE]',
    step: "s' = [s EXCEPT !.requests[1].body = TRUE]",
    witness:
      '~(((s.requests[1].method = "HEAD" /\\ s.requests[1].status > 0 /\\ ~s.requests[1].caught) => ~s.requests[1].body))',
  },
  {
    name: "unused HEAD body healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].method = "HEAD", !.requests[1].status = 503, !.requests[1].caught = FALSE, !.requests[1].body = FALSE, !.requests[1].body = TRUE]',
    step: "s' = [s EXCEPT !.requests[1].body = FALSE]",
    witness:
      '((s.requests[1].method = "HEAD" /\\ s.requests[1].status > 0 /\\ ~s.requests[1].caught) => ~s.requests[1].body)',
  },
  {
    name: "unused artifact completeness false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].status = 200, !.requests[1].roles = {1,2}, !.requests[1].fileCount = 4, !.requests[1].cleared = {1}, !.requests[1].candidates = {1}, !.requests[1].renderedRevision = 1, !.requests[1].revisions = [p \\in {1,2} |-> 1]]',
    step: "s' = [s EXCEPT !.requests[1].renderedRevision = 2]",
    witness:
      '~(((s.requests[1].route = "artifact" /\\ s.requests[1].status = 200) => (s.requests[1].roles = {1,2} /\\ s.requests[1].fileCount = 4 /\\ s.requests[1].project \\in s.requests[1].cleared /\\ s.requests[1].renderedRevision = s.requests[1].revisions[s.requests[1].project])))',
  },
  {
    name: "unused artifact completeness healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].status = 200, !.requests[1].roles = {1,2}, !.requests[1].fileCount = 4, !.requests[1].cleared = {1}, !.requests[1].candidates = {1}, !.requests[1].renderedRevision = 1, !.requests[1].revisions = [p \\in {1,2} |-> 1], !.requests[1].renderedRevision = 2]',
    step: "s' = [s EXCEPT !.requests[1].renderedRevision = 1]",
    witness:
      '((s.requests[1].route = "artifact" /\\ s.requests[1].status = 200) => (s.requests[1].roles = {1,2} /\\ s.requests[1].fileCount = 4 /\\ s.requests[1].project \\in s.requests[1].cleared /\\ s.requests[1].renderedRevision = s.requests[1].revisions[s.requests[1].project]))',
  },
  {
    name: "unused discovery subset false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].route = "discovery", !.requests[1].status = 200, !.requests[1].cleared = {1}, !.requests[1].candidates = {1}]',
    step: "s' = [s EXCEPT !.requests[1].cleared = {2}]",
    witness:
      '~(((s.requests[1].route = "discovery" /\\ s.requests[1].status = 200) => s.requests[1].cleared \\subseteq s.requests[1].candidates))',
  },
  {
    name: "unused discovery subset healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].route = "discovery", !.requests[1].status = 200, !.requests[1].cleared = {1}, !.requests[1].candidates = {1}, !.requests[1].cleared = {2}]',
    step: "s' = [s EXCEPT !.requests[1].cleared = {1}]",
    witness:
      '((s.requests[1].route = "discovery" /\\ s.requests[1].status = 200) => s.requests[1].cleared \\subseteq s.requests[1].candidates)',
  },
  {
    name: "unused terms bypass false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].route = "terms", !.requests[1].status = 200]',
    step: "s' = [s EXCEPT !.requests[1].template = 1]",
    witness:
      '~(((s.requests[1].route = "terms" /\\ s.requests[1].status = 200) => (s.requests[1].template = 0 /\\ s.requests[1].fileCount = 0)))',
  },
  {
    name: "unused terms bypass healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].route = "terms", !.requests[1].status = 200, !.requests[1].template = 1]',
    step: "s' = [s EXCEPT !.requests[1].template = 0]",
    witness:
      '((s.requests[1].route = "terms" /\\ s.requests[1].status = 200) => (s.requests[1].template = 0 /\\ s.requests[1].fileCount = 0))',
  },
  {
    name: "unused unconditional cleared subset false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].cleared = {}, !.requests[1].candidates = {}]',
    step: "s' = [s EXCEPT !.requests[1].cleared = {1}]",
    witness: "~((s.requests[1].cleared \\subseteq s.requests[1].candidates))",
  },
  {
    name: "unused unconditional cleared subset healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].cleared = {}, !.requests[1].candidates = {}, !.requests[1].cleared = {1}]',
    step: "s' = [s EXCEPT !.requests[1].cleared = {}]",
    witness: "(s.requests[1].cleared \\subseteq s.requests[1].candidates)",
  },
  {
    name: "unused file-count upper bound false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].fileCount = 4]',
    step: "s' = [s EXCEPT !.requests[1].fileCount = 5]",
    witness:
      "~((s.requests[1].fileCount >= 0 /\\ s.requests[1].fileCount <= 4))",
  },
  {
    name: "unused file-count upper bound healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].fileCount = 4, !.requests[1].fileCount = 5]',
    step: "s' = [s EXCEPT !.requests[1].fileCount = 4]",
    witness: "(s.requests[1].fileCount >= 0 /\\ s.requests[1].fileCount <= 4)",
  },
  {
    name: "done no-store false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].status = 503, !.requests[1].noStore = TRUE]',
    step: "s' = [s EXCEPT !.requests[1].noStore = FALSE]",
    witness: "~((s.requests[1].status > 0 => s.requests[1].noStore))",
  },
  {
    name: "done no-store healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].status = 503, !.requests[1].noStore = TRUE, !.requests[1].noStore = FALSE]',
    step: "s' = [s EXCEPT !.requests[1].noStore = TRUE]",
    witness: "(s.requests[1].status > 0 => s.requests[1].noStore)",
  },
  {
    name: "done HEAD body false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].method = "HEAD", !.requests[1].status = 503, !.requests[1].caught = FALSE, !.requests[1].body = FALSE]',
    step: "s' = [s EXCEPT !.requests[1].body = TRUE]",
    witness:
      '~(((s.requests[1].method = "HEAD" /\\ s.requests[1].status > 0 /\\ ~s.requests[1].caught) => ~s.requests[1].body))',
  },
  {
    name: "done HEAD body healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].method = "HEAD", !.requests[1].status = 503, !.requests[1].caught = FALSE, !.requests[1].body = FALSE, !.requests[1].body = TRUE]',
    step: "s' = [s EXCEPT !.requests[1].body = FALSE]",
    witness:
      '((s.requests[1].method = "HEAD" /\\ s.requests[1].status > 0 /\\ ~s.requests[1].caught) => ~s.requests[1].body)',
  },
  {
    name: "done artifact completeness false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].status = 200, !.requests[1].roles = {1,2}, !.requests[1].fileCount = 4, !.requests[1].cleared = {1}, !.requests[1].candidates = {1}, !.requests[1].renderedRevision = 1, !.requests[1].revisions = [p \\in {1,2} |-> 1]]',
    step: "s' = [s EXCEPT !.requests[1].renderedRevision = 2]",
    witness:
      '~(((s.requests[1].route = "artifact" /\\ s.requests[1].status = 200) => (s.requests[1].roles = {1,2} /\\ s.requests[1].fileCount = 4 /\\ s.requests[1].project \\in s.requests[1].cleared /\\ s.requests[1].renderedRevision = s.requests[1].revisions[s.requests[1].project])))',
  },
  {
    name: "done artifact completeness healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].status = 200, !.requests[1].roles = {1,2}, !.requests[1].fileCount = 4, !.requests[1].cleared = {1}, !.requests[1].candidates = {1}, !.requests[1].renderedRevision = 1, !.requests[1].revisions = [p \\in {1,2} |-> 1], !.requests[1].renderedRevision = 2]',
    step: "s' = [s EXCEPT !.requests[1].renderedRevision = 1]",
    witness:
      '((s.requests[1].route = "artifact" /\\ s.requests[1].status = 200) => (s.requests[1].roles = {1,2} /\\ s.requests[1].fileCount = 4 /\\ s.requests[1].project \\in s.requests[1].cleared /\\ s.requests[1].renderedRevision = s.requests[1].revisions[s.requests[1].project]))',
  },
  {
    name: "done discovery subset false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].route = "discovery", !.requests[1].status = 200, !.requests[1].cleared = {1}, !.requests[1].candidates = {1}]',
    step: "s' = [s EXCEPT !.requests[1].cleared = {2}]",
    witness:
      '~(((s.requests[1].route = "discovery" /\\ s.requests[1].status = 200) => s.requests[1].cleared \\subseteq s.requests[1].candidates))',
  },
  {
    name: "done discovery subset healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].route = "discovery", !.requests[1].status = 200, !.requests[1].cleared = {1}, !.requests[1].candidates = {1}, !.requests[1].cleared = {2}]',
    step: "s' = [s EXCEPT !.requests[1].cleared = {1}]",
    witness:
      '((s.requests[1].route = "discovery" /\\ s.requests[1].status = 200) => s.requests[1].cleared \\subseteq s.requests[1].candidates)',
  },
  {
    name: "done terms bypass false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].route = "terms", !.requests[1].status = 200]',
    step: "s' = [s EXCEPT !.requests[1].template = 1]",
    witness:
      '~(((s.requests[1].route = "terms" /\\ s.requests[1].status = 200) => (s.requests[1].template = 0 /\\ s.requests[1].fileCount = 0)))',
  },
  {
    name: "done terms bypass healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].route = "terms", !.requests[1].status = 200, !.requests[1].template = 1]',
    step: "s' = [s EXCEPT !.requests[1].template = 0]",
    witness:
      '((s.requests[1].route = "terms" /\\ s.requests[1].status = 200) => (s.requests[1].template = 0 /\\ s.requests[1].fileCount = 0))',
  },
  {
    name: "done unconditional cleared subset false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].cleared = {}, !.requests[1].candidates = {}]',
    step: "s' = [s EXCEPT !.requests[1].cleared = {1}]",
    witness: "~((s.requests[1].cleared \\subseteq s.requests[1].candidates))",
  },
  {
    name: "done unconditional cleared subset healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].cleared = {}, !.requests[1].candidates = {}, !.requests[1].cleared = {1}]',
    step: "s' = [s EXCEPT !.requests[1].cleared = {}]",
    witness: "(s.requests[1].cleared \\subseteq s.requests[1].candidates)",
  },
  {
    name: "done file-count upper bound false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].fileCount = 4]',
    step: "s' = [s EXCEPT !.requests[1].fileCount = 5]",
    witness:
      "~((s.requests[1].fileCount >= 0 /\\ s.requests[1].fileCount <= 4))",
  },
  {
    name: "done file-count upper bound healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].fileCount = 4, !.requests[1].fileCount = 5]',
    step: "s' = [s EXCEPT !.requests[1].fileCount = 4]",
    witness: "(s.requests[1].fileCount >= 0 /\\ s.requests[1].fileCount <= 4)",
  },
  {
    name: "response no-store false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "response", !.requests[1].status = 503, !.requests[1].noStore = TRUE]',
    step: "s' = [s EXCEPT !.requests[1].noStore = FALSE]",
    witness: "~((s.requests[1].status > 0 => s.requests[1].noStore))",
  },
  {
    name: "response no-store healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "response", !.requests[1].status = 503, !.requests[1].noStore = TRUE, !.requests[1].noStore = FALSE]',
    step: "s' = [s EXCEPT !.requests[1].noStore = TRUE]",
    witness: "(s.requests[1].status > 0 => s.requests[1].noStore)",
  },
  {
    name: "response HEAD body false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "response", !.requests[1].method = "HEAD", !.requests[1].status = 503, !.requests[1].caught = FALSE, !.requests[1].body = FALSE]',
    step: "s' = [s EXCEPT !.requests[1].body = TRUE]",
    witness:
      '~(((s.requests[1].method = "HEAD" /\\ s.requests[1].status > 0 /\\ ~s.requests[1].caught) => ~s.requests[1].body))',
  },
  {
    name: "response HEAD body healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "response", !.requests[1].method = "HEAD", !.requests[1].status = 503, !.requests[1].caught = FALSE, !.requests[1].body = FALSE, !.requests[1].body = TRUE]',
    step: "s' = [s EXCEPT !.requests[1].body = FALSE]",
    witness:
      '((s.requests[1].method = "HEAD" /\\ s.requests[1].status > 0 /\\ ~s.requests[1].caught) => ~s.requests[1].body)',
  },
  {
    name: "response artifact completeness false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "response", !.requests[1].status = 200, !.requests[1].roles = {1,2}, !.requests[1].fileCount = 4, !.requests[1].cleared = {1}, !.requests[1].candidates = {1}, !.requests[1].renderedRevision = 1, !.requests[1].revisions = [p \\in {1,2} |-> 1]]',
    step: "s' = [s EXCEPT !.requests[1].renderedRevision = 2]",
    witness:
      '~(((s.requests[1].route = "artifact" /\\ s.requests[1].status = 200) => (s.requests[1].roles = {1,2} /\\ s.requests[1].fileCount = 4 /\\ s.requests[1].project \\in s.requests[1].cleared /\\ s.requests[1].renderedRevision = s.requests[1].revisions[s.requests[1].project])))',
  },
  {
    name: "response artifact completeness healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "response", !.requests[1].status = 200, !.requests[1].roles = {1,2}, !.requests[1].fileCount = 4, !.requests[1].cleared = {1}, !.requests[1].candidates = {1}, !.requests[1].renderedRevision = 1, !.requests[1].revisions = [p \\in {1,2} |-> 1], !.requests[1].renderedRevision = 2]',
    step: "s' = [s EXCEPT !.requests[1].renderedRevision = 1]",
    witness:
      '((s.requests[1].route = "artifact" /\\ s.requests[1].status = 200) => (s.requests[1].roles = {1,2} /\\ s.requests[1].fileCount = 4 /\\ s.requests[1].project \\in s.requests[1].cleared /\\ s.requests[1].renderedRevision = s.requests[1].revisions[s.requests[1].project]))',
  },
  {
    name: "response unconditional cleared subset false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "response", !.requests[1].cleared = {}, !.requests[1].candidates = {}]',
    step: "s' = [s EXCEPT !.requests[1].cleared = {1}]",
    witness: "~((s.requests[1].cleared \\subseteq s.requests[1].candidates))",
  },
  {
    name: "response unconditional cleared subset healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "response", !.requests[1].cleared = {}, !.requests[1].candidates = {}, !.requests[1].cleared = {1}]',
    step: "s' = [s EXCEPT !.requests[1].cleared = {}]",
    witness: "(s.requests[1].cleared \\subseteq s.requests[1].candidates)",
  },
  {
    name: "fallthrough no-store false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "fallthrough", !.requests[1].status = 503, !.requests[1].noStore = TRUE]',
    step: "s' = [s EXCEPT !.requests[1].noStore = FALSE]",
    witness: "~((s.requests[1].status > 0 => s.requests[1].noStore))",
  },
  {
    name: "fallthrough no-store healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "fallthrough", !.requests[1].status = 503, !.requests[1].noStore = TRUE, !.requests[1].noStore = FALSE]',
    step: "s' = [s EXCEPT !.requests[1].noStore = TRUE]",
    witness: "(s.requests[1].status > 0 => s.requests[1].noStore)",
  },
  {
    name: "fallthrough HEAD body false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "fallthrough", !.requests[1].method = "HEAD", !.requests[1].status = 503, !.requests[1].caught = FALSE, !.requests[1].body = FALSE]',
    step: "s' = [s EXCEPT !.requests[1].body = TRUE]",
    witness:
      '~(((s.requests[1].method = "HEAD" /\\ s.requests[1].status > 0 /\\ ~s.requests[1].caught) => ~s.requests[1].body))',
  },
  {
    name: "fallthrough HEAD body healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "fallthrough", !.requests[1].method = "HEAD", !.requests[1].status = 503, !.requests[1].caught = FALSE, !.requests[1].body = FALSE, !.requests[1].body = TRUE]',
    step: "s' = [s EXCEPT !.requests[1].body = FALSE]",
    witness:
      '((s.requests[1].method = "HEAD" /\\ s.requests[1].status > 0 /\\ ~s.requests[1].caught) => ~s.requests[1].body)',
  },
  {
    name: "fallthrough file-count upper bound false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "fallthrough", !.requests[1].fileCount = 4]',
    step: "s' = [s EXCEPT !.requests[1].fileCount = 5]",
    witness:
      "~((s.requests[1].fileCount >= 0 /\\ s.requests[1].fileCount <= 4))",
  },
  {
    name: "fallthrough file-count upper bound healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "fallthrough", !.requests[1].fileCount = 4, !.requests[1].fileCount = 5]',
    step: "s' = [s EXCEPT !.requests[1].fileCount = 4]",
    witness: "(s.requests[1].fileCount >= 0 /\\ s.requests[1].fileCount <= 4)",
  },
  {
    name: "fallthrough envelope false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "fallthrough"]',
    step: "s' = [s EXCEPT !.requests[1].status = 404]",
    witness:
      '~((s.requests[1].phase = "fallthrough" => (s.requests[1].status = 0 /\\ ~s.requests[1].noStore)))',
  },
  {
    name: "fallthrough envelope healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "fallthrough", !.requests[1].status = 404]',
    step: "s' = [s EXCEPT !.requests[1].status = 0]",
    witness:
      '(s.requests[1].phase = "fallthrough" => (s.requests[1].status = 0 /\\ ~s.requests[1].noStore))',
  },
  {
    name: "done file-count lower bound false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done"]',
    step: "s' = [s EXCEPT !.requests[1].fileCount = -1]",
    witness:
      "~((s.requests[1].fileCount >= 0 /\\ s.requests[1].fileCount <= 4))",
  },
  {
    name: "done file-count lower bound healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].fileCount = -1]',
    step: "s' = [s EXCEPT !.requests[1].fileCount = 0]",
    witness: "(s.requests[1].fileCount >= 0 /\\ s.requests[1].fileCount <= 4)",
  },
  {
    name: "exact global present",
    initial:
      '[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]]',
    step: "s' = [s EXCEPT !.present = {}]",
    witness: "s.present = {}",
  },
  {
    name: "exact global active",
    initial:
      '[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]]',
    step: "s' = [s EXCEPT !.active = {}]",
    witness: "s.active = {}",
  },
  {
    name: "exact global published",
    initial:
      '[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]]',
    step: "s' = [s EXCEPT !.published = {}]",
    witness: "s.published = {}",
  },
  {
    name: "exact global retired",
    initial:
      '[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]]',
    step: "s' = [s EXCEPT !.retired = {1}]",
    witness: "1 \\in s.retired",
  },
  {
    name: "exact global restrictions",
    initial:
      '[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]]',
    step: "s' = [s EXCEPT !.restrictions = {1}]",
    witness: "1 \\in s.restrictions",
  },
  {
    name: "exact global revisions",
    initial:
      '[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]]',
    step: "s' = [s EXCEPT !.revisions[1] = 2]",
    witness: "s.revisions[1] = 2",
  },
  {
    name: "exact global evidence",
    initial:
      '[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]]',
    step: 's\' = [s EXCEPT !.evidence[1] = "unverified"]',
    witness: 's.evidence[1] = "unverified"',
  },
  {
    name: "exact global template",
    initial:
      '[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]]',
    step: "s' = [s EXCEPT !.template = 2]",
    witness: "s.template = 2",
  },
  {
    name: "exact global assets",
    initial:
      '[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]]',
    step: "s' = [s EXCEPT !.assets[1] = 2]",
    witness: "s.assets[1] = 2",
  },
  {
    name: "exact global livePin enabledness",
    initial:
      '[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]]',
    step: "s' = [s EXCEPT !.livePin = 2]",
    witness: "s.livePin = 2",
  },
  {
    name: "lookup exact projectRead",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup"]',
    step: "s' = [s EXCEPT !.requests[1].projectRead = TRUE]",
    witness: "s.requests[1].projectRead = TRUE",
  },
  {
    name: "lookup exact restrictionsRead",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup"]',
    step: "s' = [s EXCEPT !.requests[1].restrictionsRead = TRUE]",
    witness: "s.requests[1].restrictionsRead = TRUE",
  },
  {
    name: "lookup exact present",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup"]',
    step: "s' = [s EXCEPT !.requests[1].present = {2}]",
    witness: "s.requests[1].present = {2}",
  },
  {
    name: "lookup exact active",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup"]',
    step: "s' = [s EXCEPT !.requests[1].active = {2}]",
    witness: "s.requests[1].active = {2}",
  },
  {
    name: "lookup exact published",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup"]',
    step: "s' = [s EXCEPT !.requests[1].published = {2}]",
    witness: "s.requests[1].published = {2}",
  },
  {
    name: "lookup exact retired",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup"]',
    step: "s' = [s EXCEPT !.requests[1].retired = {2}]",
    witness: "s.requests[1].retired = {2}",
  },
  {
    name: "lookup exact restrictions",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup"]',
    step: "s' = [s EXCEPT !.requests[1].restrictions = {2}]",
    witness: "s.requests[1].restrictions = {2}",
  },
  {
    name: "lookup exact revisions",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup"]',
    step: "s' = [s EXCEPT !.requests[1].revisions = [p \\in {1,2} |-> 2]]",
    witness: "s.requests[1].revisions = [p \\in {1,2} |-> 2]",
  },
  {
    name: "future-phase exact method",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "future-phase"]',
    step: 's\' = [s EXCEPT !.requests[1].method = "HEAD"]',
    witness: 's.requests[1].method = "HEAD"',
  },
  {
    name: "future-phase exact projectRead",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "future-phase"]',
    step: "s' = [s EXCEPT !.requests[1].projectRead = TRUE]",
    witness: "s.requests[1].projectRead = TRUE",
  },
  {
    name: "future-phase exact present",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "future-phase"]',
    step: "s' = [s EXCEPT !.requests[1].present = {2}]",
    witness: "s.requests[1].present = {2}",
  },
  {
    name: "live render exact method",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: 's\' = [s EXCEPT !.requests[1].method = "HEAD"]',
    witness: 's.requests[1].method = "HEAD"',
  },
  {
    name: "live render exact route",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: 's\' = [s EXCEPT !.requests[1].route = "terms"]',
    witness: 's.requests[1].route = "terms"',
  },
  {
    name: "live render exact project",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].project = 2]",
    witness: "s.requests[1].project = 2",
  },
  {
    name: "live render exact pathExists",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].pathExists = FALSE]",
    witness: "s.requests[1].pathExists = FALSE",
  },
  {
    name: "live render exact revisions",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].revisions = [p \\in {1,2} |-> 2]]",
    witness: "s.requests[1].revisions = [p \\in {1,2} |-> 2]",
  },
  {
    name: "live render exact candidates",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].candidates = {2}]",
    witness: "s.requests[1].candidates = {2}",
  },
  {
    name: "live render exact clearanceRead",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].clearanceRead = {2}]",
    witness: "s.requests[1].clearanceRead = {2}",
  },
  {
    name: "live render exact cleared",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].cleared = {2}]",
    witness: "s.requests[1].cleared = {2}",
  },
  {
    name: "live render exact template",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].template = 2]",
    witness: "s.requests[1].template = 2",
  },
  {
    name: "live render exact fileCount",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].fileCount = 2]",
    witness: "s.requests[1].fileCount = 2",
  },
  {
    name: "live render exact roles",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].roles = {2}]",
    witness: "s.requests[1].roles = {2}",
  },
  {
    name: "live render exact renderedRevision",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].renderedRevision = 2]",
    witness: "s.requests[1].renderedRevision = 2",
  },
  {
    name: "live render exact status",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].status = 201]",
    witness: "s.requests[1].status = 201",
  },
  {
    name: "live render exact body",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].body = TRUE]",
    witness: "s.requests[1].body = TRUE",
  },
  {
    name: "live render exact noStore",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].noStore = TRUE]",
    witness: "s.requests[1].noStore = TRUE",
  },
  {
    name: "live render exact caught",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].caught = TRUE]",
    witness: "s.requests[1].caught = TRUE",
  },
  {
    name: "actual joined discovery uses the final captured intersection",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup", !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {1,2}, !.requests[1].revisions = [p \\in {1,2} |-> 2], !.requests[1].route = "discovery"]',
    step: "joined(1)",
    witness:
      's.requests[1].phase = "template" /\\ s.requests[1].candidates = {1}',
  },
  {
    name: "actual joined restriction response keeps a false subset",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup", !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {1,2}, !.requests[1].revisions = [p \\in {1,2} |-> 2], !.requests[1].restrictions = {1}, !.requests[1].cleared = {2}]',
    step: "joined(1)",
    witness:
      's.requests[1].phase = "response" /\\ s.requests[1].status = 410 /\\ ~((s.requests[1].cleared \\subseteq s.requests[1].candidates))',
  },
  {
    name: "actual partial project read overwrites before joined",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup", !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {}, !.requests[1].active = {}, !.requests[1].retired = {1}]',
    step: "IF ~s.requests[1].projectRead THEN readProjects(1) ELSE joined(1)",
    witness:
      's.requests[1].phase = "template" /\\ s.requests[1].candidates = {1} /\\ s.requests[1].revisions[1] = 1',
    minimumState: 3,
  },
  {
    name: "actual partial restriction read overwrites before joined",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup", !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = FALSE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {1,2}, !.requests[1].revisions = [p \\in {1,2} |-> 2], !.requests[1].restrictions = {1}]',
    step: "IF ~s.requests[1].restrictionsRead THEN readRestrictions(1) ELSE joined(1)",
    witness:
      's.requests[1].phase = "template" /\\ s.requests[1].candidates = {1}',
    minimumState: 3,
  },
  {
    name: "actual render reads captured revision",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render", !.requests[1].fileCount = 4, !.requests[1].revisions = [p \\in {1,2} |-> 2]]',
    step: "render(1,TRUE)",
    witness:
      's.requests[1].phase = "select" /\\ s.requests[1].renderedRevision = 2',
  },
  {
    name: "live artifact invariant reads captured revisions outside render false",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "clearance", !.requests[1].status = 200, !.requests[1].roles = {1,2}, !.requests[1].fileCount = 4, !.requests[1].cleared = {1}, !.requests[1].candidates = {1}, !.requests[1].renderedRevision = 1, !.requests[1].revisions = [p \\in {1,2} |-> 1]]',
    step: "s' = [s EXCEPT !.requests[1].revisions[1] = 2]",
    witness:
      '~(((s.requests[1].route = "artifact" /\\ s.requests[1].status = 200) => (s.requests[1].roles = {1,2} /\\ s.requests[1].fileCount = 4 /\\ s.requests[1].project \\in s.requests[1].cleared /\\ s.requests[1].renderedRevision = s.requests[1].revisions[s.requests[1].project])))',
  },
  {
    name: "live artifact invariant reads captured revisions outside render healing",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "clearance", !.requests[1].status = 200, !.requests[1].roles = {1,2}, !.requests[1].fileCount = 4, !.requests[1].cleared = {1}, !.requests[1].candidates = {1}, !.requests[1].renderedRevision = 1, !.requests[1].revisions = [p \\in {1,2} |-> 1], !.requests[1].revisions[1] = 2]',
    step: "s' = [s EXCEPT !.requests[1].revisions[1] = 1]",
    witness:
      '((s.requests[1].route = "artifact" /\\ s.requests[1].status = 200) => (s.requests[1].roles = {1,2} /\\ s.requests[1].fileCount = 4 /\\ s.requests[1].project \\in s.requests[1].cleared /\\ s.requests[1].renderedRevision = s.requests[1].revisions[s.requests[1].project]))',
  },
  {
    name: "actual dirty unused reset GET artifact",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].status = 200, !.requests[1].method = "HEAD", !.requests[1].body = TRUE, !.requests[1].noStore = FALSE, !.requests[1].fileCount = 5, !.requests[1].cleared = {2}, !.requests[1].candidates = {}, !.requests[1].template = 2, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE]',
    step: 'begin(1,"GET","artifact",2,FALSE)',
    witness:
      's.requests[1].phase = "lookup" /\\ (s.requests[1].status > 0 => s.requests[1].noStore) /\\ ((s.requests[1].method = "HEAD" /\\ s.requests[1].status > 0 /\\ ~s.requests[1].caught) => ~s.requests[1].body) /\\ ((s.requests[1].route = "artifact" /\\ s.requests[1].status = 200) => (s.requests[1].roles = {1,2} /\\ s.requests[1].fileCount = 4 /\\ s.requests[1].project \\in s.requests[1].cleared /\\ s.requests[1].renderedRevision = s.requests[1].revisions[s.requests[1].project])) /\\ ((s.requests[1].route = "discovery" /\\ s.requests[1].status = 200) => s.requests[1].cleared \\subseteq s.requests[1].candidates) /\\ ((s.requests[1].route = "terms" /\\ s.requests[1].status = 200) => (s.requests[1].template = 0 /\\ s.requests[1].fileCount = 0)) /\\ (s.requests[1].cleared \\subseteq s.requests[1].candidates) /\\ (s.requests[1].fileCount >= 0 /\\ s.requests[1].fileCount <= 4) /\\ (s.requests[1].phase = "fallthrough" => (s.requests[1].status = 0 /\\ ~s.requests[1].noStore))',
  },
  {
    name: "actual dirty unused reset POST artifact",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].status = 200, !.requests[1].method = "HEAD", !.requests[1].body = TRUE, !.requests[1].noStore = FALSE, !.requests[1].fileCount = 5, !.requests[1].cleared = {2}, !.requests[1].candidates = {}, !.requests[1].template = 2, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE]',
    step: 'begin(1,"POST","artifact",2,FALSE)',
    witness:
      's.requests[1].phase = "fallthrough" /\\ (s.requests[1].status > 0 => s.requests[1].noStore) /\\ ((s.requests[1].method = "HEAD" /\\ s.requests[1].status > 0 /\\ ~s.requests[1].caught) => ~s.requests[1].body) /\\ ((s.requests[1].route = "artifact" /\\ s.requests[1].status = 200) => (s.requests[1].roles = {1,2} /\\ s.requests[1].fileCount = 4 /\\ s.requests[1].project \\in s.requests[1].cleared /\\ s.requests[1].renderedRevision = s.requests[1].revisions[s.requests[1].project])) /\\ ((s.requests[1].route = "discovery" /\\ s.requests[1].status = 200) => s.requests[1].cleared \\subseteq s.requests[1].candidates) /\\ ((s.requests[1].route = "terms" /\\ s.requests[1].status = 200) => (s.requests[1].template = 0 /\\ s.requests[1].fileCount = 0)) /\\ (s.requests[1].cleared \\subseteq s.requests[1].candidates) /\\ (s.requests[1].fileCount >= 0 /\\ s.requests[1].fileCount <= 4) /\\ (s.requests[1].phase = "fallthrough" => (s.requests[1].status = 0 /\\ ~s.requests[1].noStore))',
  },
  {
    name: "actual dirty unused reset HEAD unmatched",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].status = 200, !.requests[1].method = "HEAD", !.requests[1].body = TRUE, !.requests[1].noStore = FALSE, !.requests[1].fileCount = 5, !.requests[1].cleared = {2}, !.requests[1].candidates = {}, !.requests[1].template = 2, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE]',
    step: 'begin(1,"HEAD","unmatched",2,FALSE)',
    witness:
      's.requests[1].phase = "fallthrough" /\\ (s.requests[1].status > 0 => s.requests[1].noStore) /\\ ((s.requests[1].method = "HEAD" /\\ s.requests[1].status > 0 /\\ ~s.requests[1].caught) => ~s.requests[1].body) /\\ ((s.requests[1].route = "artifact" /\\ s.requests[1].status = 200) => (s.requests[1].roles = {1,2} /\\ s.requests[1].fileCount = 4 /\\ s.requests[1].project \\in s.requests[1].cleared /\\ s.requests[1].renderedRevision = s.requests[1].revisions[s.requests[1].project])) /\\ ((s.requests[1].route = "discovery" /\\ s.requests[1].status = 200) => s.requests[1].cleared \\subseteq s.requests[1].candidates) /\\ ((s.requests[1].route = "terms" /\\ s.requests[1].status = 200) => (s.requests[1].template = 0 /\\ s.requests[1].fileCount = 0)) /\\ (s.requests[1].cleared \\subseteq s.requests[1].candidates) /\\ (s.requests[1].fileCount >= 0 /\\ s.requests[1].fileCount <= 4) /\\ (s.requests[1].phase = "fallthrough" => (s.requests[1].status = 0 /\\ ~s.requests[1].noStore))',
  },
  {
    name: "actual omit reads exact all-unused phases",
    initial:
      '[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]]',
    step: "omit(1)",
    witness: "~(1 \\in s.present)",
  },
  {
    name: "actual unsupported begin consumes an unused slot",
    initial:
      '[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]]',
    step: 'begin(1,"POST","artifact",1,TRUE)',
    witness: 's.requests[1].phase = "fallthrough"',
  },
  {
    name: "actual delivery carries false artifact class",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "response", !.requests[1].status = 200]',
    step: "deliver(1,FALSE)",
    witness:
      's.requests[1].phase = "done" /\\ ~(((s.requests[1].route = "artifact" /\\ s.requests[1].status = 200) => (s.requests[1].roles = {1,2} /\\ s.requests[1].fileCount = 4 /\\ s.requests[1].project \\in s.requests[1].cleared /\\ s.requests[1].renderedRevision = s.requests[1].revisions[s.requests[1].project])))',
  },
];
for (const control of controls)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native project-skill-publication VIEW retains ${control.name}`,
    async () => {
      const result = await runNative(nativeFixture(control));
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain("Invariant q_inv is violated");
      expect(result.output).toContain(`State ${control.minimumState ?? 2}:`);
      expect(result.output).not.toContain("violated by the initial state");
      expect(result.output).toContain(
        "PROJECT_SKILL_PUBLICATION_NAMED_WITNESS_FOUND",
      );
      expect(result.output).not.toContain("No error has been found");
    },
    120_000,
  );

type Pair = Omit<Control, "witness"> & {
  rawStates?: number;
  viewStates?: number;
};
const pairs: Pair[] = [
  {
    name: "template closed captured set and read-flag cone",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "template"]',
    step: "s' = [s EXCEPT !.requests[1].delivered = TRUE, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {2}, !.requests[1].retired = {1}, !.requests[1].restrictions = {2}]",
  },
  {
    name: "clearance closed captured set and read-flag cone",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "clearance"]',
    step: "s' = [s EXCEPT !.requests[1].delivered = TRUE, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {2}, !.requests[1].retired = {1}, !.requests[1].restrictions = {2}]",
  },
  {
    name: "discovered closed captured set and read-flag cone",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "discovered"]',
    step: "s' = [s EXCEPT !.requests[1].delivered = TRUE, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {2}, !.requests[1].retired = {1}, !.requests[1].restrictions = {2}]",
  },
  {
    name: "files closed captured set and read-flag cone",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "files"]',
    step: "s' = [s EXCEPT !.requests[1].delivered = TRUE, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {2}, !.requests[1].retired = {1}, !.requests[1].restrictions = {2}]",
  },
  {
    name: "render closed captured set and read-flag cone",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render"]',
    step: "s' = [s EXCEPT !.requests[1].delivered = TRUE, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {2}, !.requests[1].retired = {1}, !.requests[1].restrictions = {2}]",
  },
  {
    name: "select closed captured set and read-flag cone",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "select"]',
    step: "s' = [s EXCEPT !.requests[1].delivered = TRUE, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {2}, !.requests[1].retired = {1}, !.requests[1].restrictions = {2}]",
  },
  {
    name: "unused payloads with all eight original clauses true",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused"]',
    step: 's\' = [s EXCEPT !.requests[1].delivered = TRUE, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {2}, !.requests[1].retired = {1}, !.requests[1].restrictions = {2}, !.requests[1].method = "POST", !.requests[1].route = "unmatched", !.requests[1].project = 2, !.requests[1].pathExists = FALSE, !.requests[1].revisions = [p \\in {1,2} |-> 2], !.requests[1].template = 2, !.requests[1].roles = {2}, !.requests[1].renderedRevision = 2]',
  },
  {
    name: "unused same false file-count class",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "unused", !.requests[1].fileCount = 5]',
    step: "s' = [s EXCEPT !.requests[1].fileCount = -1]",
  },
  {
    name: "fallthrough payloads with all eight original clauses true",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "fallthrough"]',
    step: 's\' = [s EXCEPT !.requests[1].delivered = TRUE, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {2}, !.requests[1].retired = {1}, !.requests[1].restrictions = {2}, !.requests[1].method = "POST", !.requests[1].route = "unmatched", !.requests[1].project = 2, !.requests[1].pathExists = FALSE, !.requests[1].revisions = [p \\in {1,2} |-> 2], !.requests[1].template = 2, !.requests[1].roles = {2}, !.requests[1].renderedRevision = 2]',
  },
  {
    name: "fallthrough same false file-count class",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "fallthrough", !.requests[1].fileCount = 5]',
    step: "s' = [s EXCEPT !.requests[1].fileCount = -1]",
  },
  {
    name: "response payloads with all eight original clauses true",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "response"]',
    step: 's\' = [s EXCEPT !.requests[1].delivered = TRUE, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {2}, !.requests[1].retired = {1}, !.requests[1].restrictions = {2}, !.requests[1].method = "POST", !.requests[1].route = "unmatched", !.requests[1].project = 2, !.requests[1].pathExists = FALSE, !.requests[1].revisions = [p \\in {1,2} |-> 2], !.requests[1].template = 2, !.requests[1].roles = {2}, !.requests[1].renderedRevision = 2]',
  },
  {
    name: "response same false file-count class",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "response", !.requests[1].fileCount = 5]',
    step: "s' = [s EXCEPT !.requests[1].fileCount = -1]",
  },
  {
    name: "done payloads with all eight original clauses true",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done"]',
    step: 's\' = [s EXCEPT !.requests[1].delivered = TRUE, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {2}, !.requests[1].retired = {1}, !.requests[1].restrictions = {2}, !.requests[1].method = "POST", !.requests[1].route = "unmatched", !.requests[1].project = 2, !.requests[1].pathExists = FALSE, !.requests[1].revisions = [p \\in {1,2} |-> 2], !.requests[1].template = 2, !.requests[1].roles = {2}, !.requests[1].renderedRevision = 2]',
  },
  {
    name: "done same false file-count class",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "done", !.requests[1].fileCount = 5]',
    step: "s' = [s EXCEPT !.requests[1].fileCount = -1]",
  },
  {
    name: "lookup delivered output only",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup"]',
    step: "s' = [s EXCEPT !.requests[1].delivered = TRUE]",
  },
  {
    name: "unknown delivered output only",
    initial:
      '[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "future-phase"]',
    step: "s' = [s EXCEPT !.requests[1].delivered = TRUE]",
  },
  {
    name: "actual joined discovery boundary carries erased output",
    initial:
      '{[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup", !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {1,2}, !.requests[1].revisions = [p \\in {1,2} |-> 2], !.requests[1].route = "discovery"], [[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup", !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {1,2}, !.requests[1].revisions = [p \\in {1,2} |-> 2], !.requests[1].route = "discovery", !.requests[1].delivered = TRUE]}',
    step: "joined(1)",
    rawStates: 4,
    viewStates: 2,
    initialIsSet: true,
  },
  {
    name: "actual joined consumes distinct present snapshots before cut",
    initial:
      '{[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup", !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {1,2}, !.requests[1].revisions = [p \\in {1,2} |-> 2]], [[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup", !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {1,2}, !.requests[1].revisions = [p \\in {1,2} |-> 2], !.requests[1].present = {1}]}',
    step: "joined(1)",
    rawStates: 4,
    viewStates: 3,
    initialIsSet: true,
  },
  {
    name: "actual project read keeps captured revisions before cut",
    initial:
      '{[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup"], [[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "lookup", !.requests[1].delivered = TRUE]}',
    step: "readProjects(1)",
    rawStates: 4,
    viewStates: 2,
    initialIsSet: true,
  },
  {
    name: "actual template continuation keeps erased captured carriers",
    initial:
      '{[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "template", !.requests[1].candidates = {1}], [[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "template", !.requests[1].candidates = {1}, !.requests[1].delivered = TRUE, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {2}, !.requests[1].retired = {1}, !.requests[1].restrictions = {2}]}',
    step: "templateReply(1,TRUE)",
    rawStates: 4,
    viewStates: 2,
    initialIsSet: true,
  },
  {
    name: "actual render continuation uses exact captured revision",
    initial:
      '{[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render", !.requests[1].fileCount = 4, !.requests[1].revisions = [p \\in {1,2} |-> 2]], [[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "render", !.requests[1].fileCount = 4, !.requests[1].revisions = [p \\in {1,2} |-> 2], !.requests[1].delivered = TRUE, !.requests[1].projectRead = TRUE, !.requests[1].restrictionsRead = TRUE, !.requests[1].present = {1,2}, !.requests[1].active = {1}, !.requests[1].published = {2}, !.requests[1].retired = {1}, !.requests[1].restrictions = {2}]}',
    step: "render(1,TRUE)",
    rawStates: 4,
    viewStates: 2,
    initialIsSet: true,
  },
  {
    name: "actual delivery preserves a false artifact observation",
    initial:
      '{[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "response", !.requests[1].status = 200], [[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].phase = "response", !.requests[1].status = 200, !.requests[1].project = 2, !.requests[1].renderedRevision = 2]}',
    step: "deliver(1,FALSE)",
    rawStates: 4,
    viewStates: 2,
    initialIsSet: true,
  },
  {
    name: "actual dirty unused full reset",
    initial:
      '{[[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].status = 503, !.requests[1].noStore = FALSE], [[present |-> {1,2}, active |-> {1,2}, published |-> {1,2}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 1], evidence |-> [p \\in {1,2} |-> "cleared"], template |-> 1, assets |-> [f \\in {1,2,3,4} |-> 1], livePin |-> 1, requests |-> [id \\in {1,2} |-> [phase |-> "unused", method |-> "GET", route |-> "artifact", project |-> 1, pathExists |-> TRUE, projectRead |-> FALSE, restrictionsRead |-> FALSE, present |-> {}, active |-> {}, published |-> {}, retired |-> {}, restrictions |-> {}, revisions |-> [p \\in {1,2} |-> 0], candidates |-> {}, clearanceRead |-> {}, cleared |-> {}, template |-> 0, fileCount |-> 0, roles |-> {}, renderedRevision |-> 0, status |-> 0, body |-> FALSE, noStore |-> FALSE, caught |-> FALSE, delivered |-> FALSE]]] EXCEPT !.requests[1].status = 503, !.requests[1].noStore = FALSE, !.requests[1].method = "HEAD", !.requests[1].caught = TRUE]}',
    step: 'begin(1,"GET","artifact",1,TRUE)',
    rawStates: 3,
    viewStates: 2,
    initialIsSet: true,
  },
];
// TRUE alone checks the intended equivalence classes. False original clauses
// remain in several raw prefixes; they cannot satisfy an unrelated property.
for (const pair of pairs)
  test.skipIf(process.env.SLOP_QUINT_TRANSLATOR_TEST !== "1")(
    `native project-skill-publication VIEW coalesces only ${pair.name}`,
    async () => {
      const tla = nativeFixture({ ...pair, witness: "FALSE" });
      for (const [useView, count] of [
        [false, pair.rawStates ?? 2],
        [true, pair.viewStates ?? 1],
      ] as const) {
        const result = await runNative(tla, useView);
        expect(result.status, result.output).toBe(0);
        expect(result.output).toContain(
          "PROJECT_SKILL_PUBLICATION_NATIVE_COMPLETE",
        );
        expect(slopTlcTerminalCounts(result.output)).toEqual({
          distinct: count,
          queued: 0,
        });
        expect(result.output).not.toContain("Invariant q_inv is violated");
      }
    },
    240_000,
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
