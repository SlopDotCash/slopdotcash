import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CLEANER_VERSION,
  TRACE_TERMS_VERSION,
  cleanSessionEvent,
  cleanSessionText,
  isNameOnlyCommand,
  keepsReadResult,
  redactLocalPaths,
  OSI_LICENCES,
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

test("isNameOnlyCommand accepts listing commands and rejects patch output", () => {
  assert.equal(isNameOnlyCommand("ls"), true);
  assert.equal(isNameOnlyCommand("git log --oneline"), true);
  assert.equal(isNameOnlyCommand("git log -p"), false);
  assert.equal(isNameOnlyCommand("git diff"), false);
  assert.equal(isNameOnlyCommand("git diff --name-only"), true);
  assert.equal(isNameOnlyCommand("git log --name-only"), true);
  assert.equal(isNameOnlyCommand("rm -rf /"), false);
});

test("isNameOnlyCommand rejects content-emitting commands and shell operators", () => {
  for (const command of [
    "find . -execdir cat {} \\;",
    "find . -ok cat {} \\;",
    "find . -fprint out.txt",
    "find . -printf '%p'",
    "tree --fromfile notes/secret.md",
    "ls | cat notes/secret.md",
    "ls && cat notes/secret.md",
    "git log -U3",
    "git log --unified=3",
    "git log --patch-with-stat",
    "git log -c",
    "git log --cc",
    "git log --patch",
    "git diff --stat",
  ]) {
    assert.equal(isNameOnlyCommand(command), false, command);
  }
  assert.equal(isNameOnlyCommand("git log --name-only"), true);
  assert.equal(isNameOnlyCommand("git log --oneline"), true);
  assert.equal(isNameOnlyCommand("tree"), true);
});

test("redacts both result and output when an event is not kept", () => {
  const cleaned = cleanSessionEvent(
    { type: "read_result", paths: ["notes/untracked.md"], result: "export const answer = 42;\n", output: "FULL UNTRACKED SOURCE BODY\n" },
    context(),
  );
  assert.equal(cleaned.result, "[REDACTED:SOURCE]");
  assert.equal(cleaned.output, "[REDACTED:SOURCE]");
});

test("redactLocalPaths keeps relative paths and public URLs", () => {
  assert.equal(redactLocalPaths("src/index.ts", "/repo"), "src/index.ts");
  assert.equal(redactLocalPaths("https://github.com/SlopDotCash/slopdotcash/pull/3335", "/repo"), "https://github.com/SlopDotCash/slopdotcash/pull/3335");
  assert.equal(redactLocalPaths("read /etc/passwd", "/repo"), "read [REDACTED:LOCAL_PATH]");
  const cleaned = cleanSessionEvent(readResult(["notes/secret.md"], "git status"), context());
  assert.deepEqual(cleaned.paths, ["notes/secret.md"]);
});

test("keeps a tracked read result named by an absolute path", () => {
  const cleaned = cleanSessionEvent(readResult(["/repo/src/index.ts"]), context());
  assert.equal(cleaned.result, "export const answer = 42;\n");
});

test("replaces an event naming a tracked symlink that points outside the repository whole", () => {
  const repo = mkdtempSync(join(tmpdir(), "session-export-repo-"));
  const outsideDir = mkdtempSync(join(tmpdir(), "session-export-outside-"));
  try {
    const outside = join(outsideDir, "outside.md");
    writeFileSync(outside, "secret source\n");
    symlinkSync(outside, join(repo, "link-out"));
    const cleaned = cleanSessionEvent(readResult(["link-out"]), context({ repoRoot: repo, trackedPaths: new Set(["link-out"]) }));
    assert.deepEqual(cleaned, { type: "redacted", marker: "[REDACTED:OUTSIDE_REPO]", cleaner: CLEANER_VERSION });
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("tags the cleaned session with trace terms v3 and the cleaner version", () => {
  const input = [
    JSON.stringify({ type: "read_result", paths: ["src/index.ts"], result: "export const answer = 42;\n" }),
    "not json",
    JSON.stringify({ type: "read_result", paths: ["src/index.ts"], result: "export const answer = 42;\n" }),
  ].join("\n");
  const cleaned = cleanSessionText(input, context());
  assert.equal(cleaned.lines, 3);
  assert.equal(cleaned.kept, 2);
  assert.equal(cleaned.redacted, 1);
  assert.equal(cleaned.text.split("\n")[1], JSON.stringify({ type: "redacted", marker: "[REDACTED:SOURCE]", cleaner: CLEANER_VERSION }));
  assert.equal(TRACE_TERMS_VERSION, "private-trace-v3");
  assert.equal(OSI_LICENCES.has("MIT"), true);
});
