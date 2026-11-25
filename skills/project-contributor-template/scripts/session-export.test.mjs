import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanSessionEvent,
  cleanSessionText,
  CLEANER_VERSION,
  isNameOnlyCommand,
  keepsReadResult,
  OSI_LICENCES,
  TRACE_TERMS_VERSION,
} from "./session-export.mjs";

const context = (overrides = {}) => ({
  licence: "MIT",
  repoRoot: "/repo",
  trackedPaths: new Set(["src/index.ts"]),
  ...overrides,
});

const readResult = (paths, command) => ({
  type: "read_result",
  paths,
  command,
  result: "export const answer = 42;\n",
});

test("keeps a tracked read result from an openly licensed repository", () => {
  assert.equal(keepsReadResult({ licensed: true, tracked: true, nameOnly: false, inside: true, outside: false }), true);
});

test("redacts a read result when the repository is not openly licensed", () => {
  assert.equal(keepsReadResult({ licensed: false, tracked: true, nameOnly: false, inside: true, outside: false }), false);
  const cleaned = cleanSessionEvent(readResult(["src/index.ts"]), context({ licence: "LicenseRef-Proprietary" }));
  assert.equal(cleaned.result, "[REDACTED:SOURCE]");
});

test("replaces an event naming a path outside the repository whole", () => {
  const cleaned = cleanSessionEvent(readResult(["/etc/passwd"]), context());
  assert.equal(cleaned.marker, "[REDACTED:OUTSIDE_REPO]");
  assert.equal(cleaned.result, undefined);
});

test("keeps a name-only command result for an untracked file inside the repository", () => {
  const cleaned = cleanSessionEvent(readResult(["notes/todo.md"], "git status"), context());
  assert.equal(cleaned.result, "export const answer = 42;\n");
});

test("redacts a name-only command result from an unlicensed repository", () => {
  const cleaned = cleanSessionEvent(readResult(["notes/todo.md"], "git status"), context({ licence: "LicenseRef-Proprietary" }));
  assert.equal(cleaned.result, "[REDACTED:SOURCE]");
});

test("redacts a name-only command result naming a path outside the repository", () => {
  const cleaned = cleanSessionEvent(readResult(["../outside.md"], "ls"), context());
  assert.equal(cleaned.marker, "[REDACTED:OUTSIDE_REPO]");
});

test("redacts credential shapes inside a kept result", () => {
  const cleaned = cleanSessionEvent(
    { type: "read_result", paths: ["src/index.ts"], result: "const token = \"ghp_abcdefghij1234567890\";\n" },
    context(),
  );
  assert.equal(cleaned.result, "const token = \"[REDACTED:CREDENTIAL]\";\n");
});

test("cleanSessionText replaces a line that is not a JSON object", () => {
  const cleaned = cleanSessionText("not json\n", context());
  assert.equal(cleaned.redacted, 1);
  assert.equal(cleaned.lines, 1);
  assert.equal(JSON.parse(cleaned.text).marker, "[REDACTED:SOURCE]");
});

test("the exporter tags its output with the v3 terms version and cleaner version", () => {
  assert.equal(TRACE_TERMS_VERSION, "private-trace-v3");
  assert.equal(CLEANER_VERSION, "slop-session-cleaner-1");
  assert.equal(OSI_LICENCES.has("MIT"), true);
  assert.equal(OSI_LICENCES.has("LicenseRef-Proprietary"), false);
});

test("isNameOnlyCommand accepts listing commands and rejects patch output", () => {
  assert.equal(isNameOnlyCommand("git log --oneline"), true);
  assert.equal(isNameOnlyCommand("git log -p"), false);
  assert.equal(isNameOnlyCommand("git diff --name-only"), true);
  assert.equal(isNameOnlyCommand("git diff"), false);
  assert.equal(isNameOnlyCommand("find . -name '*.ts'"), true);
  assert.equal(isNameOnlyCommand("find . -exec rm {} \\;"), false);
});
