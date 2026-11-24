import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  addSecretStrings,
  CLEANER_VERSION,
  cleanEvents,
  collectKnownSecrets,
  exportSession,
  fileContains,
  findSessionFile,
  makeRepoIndex,
  OSI_LICENCES,
  readClaudeCode,
  readCodex,
  repoLicence,
  truncateToLimit,
  writeCleanedSession,
} from "../skills/project-contributor-template/scripts/session-export.mjs";

const ctx = (over = {}) => ({
  repoRoot: "/home/alice/proj",
  homeDir: "/home/alice",
  userName: "alice",
  env: {},
  keepRepoFiles: true,
  isRepoFile: () => true,
  ...over,
});
const ev = (kind, text, extra = {}) => ({
  t: "2026-11-23T10:00:00Z",
  kind,
  text,
  ...extra,
});
const clean = (events, over) => cleanEvents(events, ctx(over));

test("exports the version and licence set", () => {
  assert.equal(CLEANER_VERSION, "slop-session-cleaner-1");
  for (const id of ["MIT", "Apache-2.0", "GPL-3.0-only", "AGPL-3.0-or-later"])
    assert.ok(OSI_LICENCES.has(id), id);
  assert.ok(!OSI_LICENCES.has("Proprietary"));
});

test("replaces environment values anywhere", () => {
  const out = clean([ev("tool_result", "token is abcd1234efgh ok")], {
    env: { TOKEN_X: "abcd1234efgh", SHORT: "abc123" },
  });
  assert.equal(out.events[0].text, "token is [REDACTED:CREDENTIAL] ok");
  assert.equal(out.counts.CREDENTIAL, 1);
  const short = clean([ev("user", "keep abc123 here")], {
    env: { SHORT: "abc123" },
  });
  assert.equal(short.events[0].text, "keep abc123 here");
});

test("replaces known secret shapes", () => {
  const pem =
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\ndef==\n-----END RSA PRIVATE KEY-----";
  const texts = [
    `ghp_${"a1B2".repeat(9)}`,
    `key sk-ant-${"Zy9x".repeat(8)}`,
    pem,
    "https://bobuser:hunter2pw@example.com/repo.git",
  ];
  const out = clean(texts.map((x) => ev("tool_result", x)));
  const joined = out.events.map((e) => e.text).join("\n");
  for (const bad of ["ghp_", "sk-ant", "MIIEabc", "hunter2pw", "bobuser"])
    assert.ok(!joined.includes(bad), bad);
  assert.equal(out.counts.CREDENTIAL, 4);
  assert.ok(out.events[3].text.includes("example.com/repo.git"));
});

test("repo-relative paths and local paths", () => {
  const out = clean([
    ev("assistant", "edited /home/alice/proj/src/a.ts today"),
    ev("tool_result", "ls /home/alice/other/x\nmore"),
    ev("user", "hi alice, thanks"),
  ]);
  assert.equal(out.events[0].text, "edited src/a.ts today");
  assert.equal(out.events[1].text, "[REDACTED:OUTSIDE_REPO]");
  assert.equal(out.events[2].text, "hi [REDACTED:LOCAL_PATH], thanks");
  assert.equal(out.counts.OUTSIDE_REPO, 1);
  assert.equal(out.counts.LOCAL_PATH, 1);
});

test("urls and relative paths are not treated as outside the repo", () => {
  const out = clean([
    ev("assistant", "see https://slop.cash/a/b and src/x/y.ts"),
  ]);
  assert.equal(out.events[0].text, "see https://slop.cash/a/b and src/x/y.ts");
});

test("no licence strips repo file contents", () => {
  const out = clean([ev("tool_result", "const a = 1;", { path: "src/a.ts" })], {
    keepRepoFiles: false,
  });
  assert.equal(out.events[0].text, "[REDACTED:SOURCE]");
  assert.equal(out.counts.SOURCE, 1);
});

test("ignored file is stripped even when licensed", () => {
  const out = clean(
    [ev("tool_result", "A=1", { path: "/home/alice/proj/.env" })],
    { isRepoFile: (p) => !p.endsWith(".env") },
  );
  assert.equal(out.events[0].text, "[REDACTED:SOURCE]");
});

test("licensed tracked file is kept", () => {
  const out = clean([ev("tool_result", "const a = 1;", { path: "src/a.ts" })]);
  assert.equal(out.events[0].text, "const a = 1;");
  assert.equal(out.events[0].path, "src/a.ts");
});

test("edit arguments outside repo are dropped", () => {
  const out = clean([
    ev(undefined, undefined, {
      kind: "tool_call",
      tool: "Edit",
      args: { file_path: "/home/alice/other/b.ts", new_string: "x" },
    }),
  ]);
  assert.equal(out.events[0].args, "[REDACTED:OUTSIDE_REPO]");
});

test("edit arguments for a file that fails the rule drop their content", () => {
  const out = clean(
    [
      {
        t: "t",
        kind: "tool_call",
        tool: "Write",
        args: { file_path: "src/a.ts", content: "secret code" },
      },
    ],
    { keepRepoFiles: false },
  );
  assert.equal(out.events[0].args.content, "[REDACTED:SOURCE]");
  assert.equal(out.events[0].args.file_path, "src/a.ts");
});

test("truncates largest outputs then gives up", () => {
  const big = {
    t: "t",
    kind: "tool_result",
    text: "x".repeat(9 * 1024 * 1024),
  };
  const lines = [
    JSON.stringify({ t: "t", kind: "user", text: "go" }),
    JSON.stringify(big),
  ];
  const limit = 8 * 1024 * 1024;
  const out = truncateToLimit(lines, limit);
  assert.ok(out);
  assert.equal(out.truncated, 1);
  assert.ok(out.lines.join("\n").length < limit);
  assert.ok(out.lines[1].includes("[TRUNCATED:"));
  const many = Array.from({ length: 200 }, () =>
    JSON.stringify({ t: "t", kind: "assistant", text: "y".repeat(50 * 1024) }),
  );
  assert.equal(truncateToLimit(many, limit), null);
  assert.deepEqual(truncateToLimit(["{}"], limit), {
    lines: ["{}"],
    truncated: 0,
  });
});

test("a bare home directory path counts as outside the repo", () => {
  const out = clean([ev("assistant", "cache in /home/alice and more")]);
  assert.equal(out.events[0].text, "[REDACTED:OUTSIDE_REPO]");
});

test("unknown event fields are dropped", () => {
  const out = clean([
    {
      t: "t",
      kind: "tool_result",
      text: "ok",
      output: `ghp_${"a1B2".repeat(9)}`,
      error: "/home/bob/x failed",
    },
  ]);
  assert.deepEqual(Object.keys(out.events[0]).sort(), ["kind", "t", "text"]);
});

test("tilde, dotdot and windows paths are outside the repo", () => {
  const cases = [
    ev("tool_result", "cat ~/.ssh/config"),
    ev("tool_result", "x", { path: "~/.ssh/config" }),
    ev("assistant", "see /home/alice/proj/../other/x.ts"),
    ev("tool_result", "C:\\Users\\bob\\secrets\\k.txt"),
    ev("tool_result", "read D:/data/x"),
    ev("tool_result", "\\\\server\\share\\f.txt"),
  ];
  for (const c of cases) {
    const out = clean([c]);
    assert.equal(
      out.events[0].text,
      "[REDACTED:OUTSIDE_REPO]",
      JSON.stringify(c),
    );
  }
  const inside = clean([ev("assistant", "see /home/alice/proj/a/../b.ts")]);
  assert.equal(inside.events[0].text, "see b.ts");
});

test("secret assignments with prefixed names are replaced", () => {
  const out = clean([
    ev("tool_result", "GITHUB_TOKEN=abcdefghijklmnop1234"),
    ev("tool_result", "AWS_SECRET_ACCESS_KEY: wJalrXUtnFEMIK7MDENGbPxRfiCY"),
    ev("tool_result", '{"api_key": "zzzzzzzzzzzz1234"}'),
  ]);
  const joined = out.events.map((e) => e.text).join("\n");
  for (const bad of [
    "abcdefghijklmnop1234",
    "wJalrXUtnFEMIK7",
    "zzzzzzzzzzzz1234",
  ])
    assert.ok(!joined.includes(bad), bad);
});

test("long unbroken input cleans quickly", () => {
  const inputs = [
    "A".repeat(1_000_000),
    "a1_".repeat(300_000),
    "-".repeat(500_000),
    "token".repeat(200_000),
    "secret-".repeat(100_000),
    "password".repeat(50_000),
    `--${"token".repeat(200_000)}`,
    `-${"-token".repeat(150_000)}`,
    "abandon ".repeat(100_000),
    `https://a:${"b".repeat(500_000)}`,
  ];
  for (const text of inputs) {
    const start = performance.now();
    const out = clean([ev("tool_result", text)]);
    const ms = performance.now() - start;
    assert.ok(ms < 1000, `${text.slice(0, 20)} ${ms} ms`);
    assert.equal(out.events[0].text, text);
  }
});

test("secret words in prose are left alone", () => {
  const text = "the tokenizer handles words and a secretary";
  assert.equal(clean([ev("assistant", text)]).events[0].text, text);
  const flag = clean([ev("tool_result", "run --token abcdefghijklmnop1234")]);
  assert.ok(!flag.events[0].text.includes("abcdefghijklmnop1234"));
});

const MARKER = "slop-run:run-abc123";
const RECEIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../skills/project-contributor-template/scripts/run-receipt.mjs",
);
const fixture = (name, repo) =>
  readFileSync(`tests/fixtures/sessions/${name}`, "utf8").replaceAll(
    "{{REPO}}",
    repo,
  );

function world() {
  const base = mkdtempSync(join(tmpdir(), "slop-export-"));
  const homeDir = join(base, "home");
  const repoRoot = join(base, "proj");
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  mkdirSync(join(homeDir, ".claude", "projects", "p1"), { recursive: true });
  writeFileSync(join(repoRoot, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(repoRoot, ".gitignore"), "*.log\n.env\n*.pem\nsecrets/\n");
  mkdirSync(join(repoRoot, "secrets"));
  writeFileSync(join(repoRoot, "secrets", "key"), "SECRET-BODY\n");
  writeFileSync(join(repoRoot, "k.pem"), "SECRET-BODY\n");
  writeFileSync(join(repoRoot, "list.txt"), ".env\n");
  writeFileSync(
    join(repoRoot, ".env"),
    'PROPRIETARY-SRC=1\nAPI_PASS=hunter2hunter2\nOTHER="quoted-value-12345"\n',
  );
  writeFileSync(join(repoRoot, "untracked.txt"), "UNTRACKED-BODY\n");
  mkdirSync(join(base, "other"), { recursive: true });
  writeFileSync(join(base, "other", "config.json"), "OTHER-PROJECT-CONFIG");
  writeFileSync(join(repoRoot, "ignored.log"), "IGNORED-LOG-BODY\n");
  writeFileSync(join(repoRoot, "src", "new.ts"), "NEWFILE-BODY\n");
  const g = (...a) => execFileSync("git", ["-C", repoRoot, ...a]);
  g("init", "-q");
  g("add", ".gitignore", "src/a.ts");
  const session = join(homeDir, ".claude", "projects", "p1", "new.jsonl");
  writeFileSync(session, fixture("claude-code.jsonl", repoRoot));
  const opts = (over = {}) => ({
    marker: MARKER,
    repoRoot,
    repo: "o/r",
    homeDir,
    env: { USER: "alice" },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ license: { spdx_id: "MIT" } }),
    }),
    client: "claude-code",
    clientVersion: "1.0.0",
    provider: "anthropic",
    model: "m",
    startCommit: "a".repeat(40),
    endCommit: "b".repeat(40),
    outPath: join(base, "out", "trace.ndjson"),
    ...over,
  });
  return { base, homeDir, repoRoot, session, opts };
}

// Codex rollouts are not found by the export (no real rollout checked yet);
// their reader and the guard are still exercised through the writer.
async function exportCodexFile(opts) {
  const dir = join(opts.homeDir, ".codex", "sessions", "2026", "11", "23");
  const lines = readdirSync(dir)
    .filter((f) => f.startsWith("rollout-"))
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n"))
    .filter((l) => l.trim() !== "");
  return writeCleanedSession(
    readCodex(lines, opts.marker),
    "client-file",
    opts,
  );
}

test("picks newest file and drops events before the marker", async () => {
  const w = world();
  const old = join(w.homeDir, ".claude", "projects", "p1", "old.jsonl");
  writeFileSync(
    old,
    `${JSON.stringify({ type: "user", timestamp: "2026-11-22T00:00:00Z", message: { role: "user", content: `OLDER-FILE ${MARKER}` } })}\n`,
  );
  utimesSync(old, new Date(1000), new Date(1000));
  const found = findSessionFile(MARKER, { homeDir: w.homeDir });
  assert.equal(found?.path, w.session);
  assert.equal(found?.client, "claude-code");
  const res = await exportSession(w.opts());
  assert.equal(res.source, "client-file");
  const text = readFileSync(res.path, "utf8");
  assert.ok(!text.includes("OLDER-FILE"));
  assert.ok(!text.includes("EARLY-EVENT"));
  const events = text
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => JSON.parse(l));
  assert.ok(events[0].text.includes(MARKER));
  assert.ok(events.some((e) => e.text === "Please fix the bug"));
});

test("unknown record types and fields are dropped", async () => {
  const w = world();
  const text = readFileSync((await exportSession(w.opts())).path, "utf8");
  for (const bad of [
    "future-thing",
    "FUTURE-BODY",
    "LEAK-ME",
    "LEAK-TOP",
    "SECRET-THINKING",
    "API-REQUEST-BODY",
    "ATTACHMENT-BODY",
  ])
    assert.ok(!text.includes(bad), bad);
  assert.ok(text.includes("Working on it"));
});

test("reads keep repo files only when tracked or written and not ignored", async () => {
  const w = world();
  const res = await exportSession(w.opts());
  const events = readFileSync(res.path, "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => JSON.parse(l));
  const results = events.filter((e) => e.kind === "tool_result");
  const byText = (s) => results.find((e) => e.text === s);
  assert.ok(byText("export const a = 1;"));
  assert.ok(byText("[REDACTED:OUTSIDE_REPO]"));
  assert.ok(byText("[REDACTED:SOURCE]"));
  const text = JSON.stringify(events);
  assert.ok(!text.includes("TOP-SECRET-OTHER"));
  assert.ok(!text.includes("IGNORED-LOG-BODY"));
  assert.equal(res.licence, "MIT");
});

test("codex reader keeps calls and outputs, drops reasoning", () => {
  const lines = fixture("codex.jsonl", "/home/u/proj")
    .split("\n")
    .filter(Boolean);
  const events = readCodex(lines, MARKER);
  const text = JSON.stringify(events);
  for (const bad of [
    "SECRET-REASONING",
    "EVENT-MSG-BODY",
    "DEVELOPER-PROMPT",
    "ENV-CONTEXT",
    "TURN-CONTEXT-BODY",
    "FUTURE-BODY",
    "LEAK-ME",
    "EARLY-EVENT",
  ])
    assert.ok(!text.includes(bad), bad);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["tool_result", "user", "assistant", "tool_call", "tool_result"],
  );
  assert.equal(events[3].tool, "shell");
  assert.deepEqual(events[3].args.command, ["cat", "src/a.ts"]);
  assert.equal(events[4].text, "export const a = 1;");
  assert.equal(readCodex(lines, "slop-run:none").length, 0);
});

test("claude reader pairs read results with their file path", () => {
  const lines = fixture("claude-code.jsonl", "/r").split("\n").filter(Boolean);
  const events = readClaudeCode(lines, MARKER);
  const reads = events.filter((e) => e.kind === "tool_result" && e.path);
  assert.deepEqual(
    reads.map((e) => e.path),
    ["/r/src/a.ts", "/home/u/other/secret.txt", "/r/ignored.log"],
  );
});

test("licence lookup failure counts as unlicensed", async () => {
  const w = world();
  const res = await exportSession(
    w.opts({
      fetchImpl: async () => {
        throw new Error("offline");
      },
    }),
  );
  const [head, ...rest] = readFileSync(res.path, "utf8").trim().split("\n");
  const header = JSON.parse(head);
  assert.equal(header.licence, null);
  assert.equal(header.repoFilesKept, false);
  const body = rest.join("\n");
  assert.ok(!body.includes("export const a = 1;"));
  assert.ok(body.includes("[REDACTED:SOURCE]"));
  assert.equal(await repoLicence("o/r", async () => ({ ok: false })), null);
  assert.equal(
    await repoLicence("o/r", async () => ({
      ok: true,
      json: async () => ({ license: { spdx_id: "NOASSERTION" } }),
    })),
    "NOASSERTION",
  );
});

test("marker not found asks for fallback", async () => {
  const w = world();
  const res = await exportSession(w.opts({ marker: "slop-run:missing" }));
  assert.equal(res.source, "fallback-needed");
  assert.ok(!existsSync(w.opts().outPath));
});

test("header is first and counts match", async () => {
  const w = world();
  const res = await exportSession(w.opts());
  const [head, ...rest] = readFileSync(res.path, "utf8").trim().split("\n");
  const header = JSON.parse(head);
  assert.equal(header.format, "slop-session-v1");
  assert.equal(header.source, "client-file");
  assert.equal(header.cleaner, CLEANER_VERSION);
  assert.equal(header.repository, "o/r");
  assert.equal(header.licence, "MIT");
  assert.equal(header.repoFilesKept, true);
  assert.equal(header.rules, "https://slop.cash/protocol/private-trace-v3.md");
  assert.equal(header.startedAt, "2026-11-23T10:00:03Z");
  assert.equal(header.endedAt, "2026-11-23T10:00:14Z");
  assert.deepEqual(header.counts, res.counts);
  const raw = readClaudeCode(
    fixture("claude-code.jsonl", w.repoRoot).split("\n").filter(Boolean),
    MARKER,
  );
  assert.equal(rest.length, raw.length);
  assert.ok(header.counts.OUTSIDE_REPO >= 1 && header.counts.SOURCE >= 1);
});

// ---- fix round 1 ----
const pad = (n) => String(n).padStart(2, "0");
function build(w, steps, cwd = w.repoRoot) {
  let n = 0;
  const out = [];
  let id = 0;
  const entry = (type, content, extra = {}) =>
    out.push({
      type,
      timestamp: `2026-11-23T10:00:${pad(n++)}Z`,
      cwd,
      message: { role: type, content },
      ...extra,
    });
  const call = (name, input, result, extra = {}) => {
    const tid = `x${id++}`;
    entry("assistant", [{ type: "tool_use", id: tid, name, input }], extra);
    if (result !== undefined)
      entry("user", [
        { type: "tool_result", tool_use_id: tid, content: result },
      ]);
  };
  call("Bash", { command: "node run-receipt.mjs start" }, `ok\n${MARKER}`);
  steps({ entry, call });
  writeFileSync(w.session, `${out.map((o) => JSON.stringify(o)).join("\n")}\n`);
}
const runOut = async (w, over = {}) => {
  const res = await exportSession(w.opts(over));
  assert.equal(res.source, "client-file");
  const [head, ...rest] = readFileSync(res.path, "utf8").trim().split("\n");
  return { header: JSON.parse(head), events: rest.map((l) => JSON.parse(l)) };
};
const unlicensed = {
  fetchImpl: async () => {
    throw new Error("offline");
  },
};
const results = (events) => events.filter((e) => e.kind === "tool_result");

test("unlicensed repo redacts every tool result except known confirmations", async () => {
  const w = world();
  build(w, ({ call }) => {
    call("Bash", { command: "cat .env" }, "PROPRIETARY-SRC=1");
    call(
      "Edit",
      { file_path: `${w.repoRoot}/src/a.ts` },
      "The file x has been updated. Here's the result of running `cat -n`:\n 1→PROPRIETARY-SRC",
    );
    call("Grep", { pattern: "a" }, "ignored.log:1:PROPRIETARY-SRC");
    call(
      "Write",
      { file_path: `${w.repoRoot}/src/n.ts`, content: "Z" },
      `File created successfully at: ${w.repoRoot}/src/n.ts`,
    );
    call("Bash", { command: "true" }, "");
  });
  const { events } = await runOut(w, unlicensed);
  const r = results(events).map((e) => e.text);
  assert.ok(!JSON.stringify(events).includes("PROPRIETARY-SRC"));
  assert.equal(r.filter((t) => t === "[REDACTED:SOURCE]").length, 4); // includes the untrusted start result
  assert.ok(r.includes("File created successfully at: src/n.ts"));
  const line = (n, payload) =>
    JSON.stringify({
      timestamp: `2026-11-23T10:00:0${n}Z`,
      type: "response_item",
      payload,
    });
  const fc = (id, command) => ({
    type: "function_call",
    name: "shell",
    arguments: JSON.stringify({ command }),
    call_id: id,
  });
  const home = mkdtempSync(join(tmpdir(), "slop-cx-"));
  const dir = join(home, ".codex", "sessions", "2026", "11", "23");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "rollout-1.jsonl"),
    `${[
      line(0, fc("a", ["node", "run-receipt.mjs", "start"])),
      line(1, { type: "function_call_output", call_id: "a", output: MARKER }),
      line(2, fc("b", ["bash", "-lc", "cat .env"])),
      line(3, {
        type: "function_call_output",
        call_id: "b",
        output: "PROPRIETARY-SRC=1",
      }),
    ].join("\n")}\n`,
  );
  const cx = await exportCodexFile({
    ...w.opts(unlicensed),
    homeDir: home,
    client: "codex",
  });
  const ct = readFileSync(cx.path, "utf8");
  assert.ok(!ct.includes("PROPRIETARY-SRC"));
  assert.ok(ct.includes("[REDACTED:SOURCE]"));
});

test("licensed repo redacts shell and grep results that touch non-repo files", async () => {
  const w = world();
  build(w, ({ call }) => {
    call("Bash", { command: "cat .env" }, "PROPRIETARY-SRC=1");
    call("Bash", { command: "cat src/a.ts" }, "export const a = 1;");
    call("Bash", { command: "cat untracked.txt" }, "UNTRACKED-BODY");
    call(
      "Grep",
      { pattern: "x" },
      "ignored.log:1:IGNORED-LOG-BODY\nsrc/a.ts:1:export",
    );
    call("Grep", { pattern: "y" }, "src/a.ts:1:export const a = 1;");
    call(
      "Edit",
      { file_path: `${w.repoRoot}/.env` },
      "The file .env has been updated:\n 1→PROPRIETARY-SRC=1",
    );
    call(
      "Edit",
      { file_path: `${w.repoRoot}/src/a.ts` },
      "The file has been updated:\n 1→export const a = 1;",
    );
    call(
      "Bash",
      { command: "cd ../other && cat config.json" },
      "OTHER-PROJECT-CONFIG",
    );
    call(
      "Bash",
      { command: "git -C ../other show HEAD:x" },
      "OTHER-PROJECT-CONFIG",
    );
  });
  const { events } = await runOut(w);
  const text = JSON.stringify(events);
  for (const bad of [
    "PROPRIETARY-SRC",
    "UNTRACKED-BODY",
    "IGNORED-LOG-BODY",
    "OTHER-PROJECT-CONFIG",
  ])
    assert.ok(!text.includes(bad), bad);
  const r = results(events).map((e) => e.text);
  assert.ok(r.includes("export const a = 1;"));
  assert.ok(r.includes("src/a.ts:1:export const a = 1;"));
  assert.ok(r.includes("The file has been updated:\n 1→export const a = 1;"));
  assert.equal(r.filter((t) => t === "[REDACTED:OUTSIDE_REPO]").length, 2);
});

test("entries whose working directory is outside the repo are dropped", async () => {
  const w = world();
  build(w, ({ entry }) => {
    entry("user", "INSIDE-PROMPT");
  });
  const extra = JSON.stringify({
    type: "user",
    timestamp: "2026-11-23T10:00:30Z",
    cwd: "/home/u/other",
    message: { role: "user", content: "OUTSIDE-PROMPT" },
  });
  writeFileSync(w.session, `${readFileSync(w.session, "utf8")}${extra}\n`);
  const { events } = await runOut(w);
  const text = JSON.stringify(events);
  assert.ok(text.includes("INSIDE-PROMPT"));
  assert.ok(!text.includes("OUTSIDE-PROMPT"));
  const line = (type, payload, n) =>
    JSON.stringify({ timestamp: `2026-11-23T10:00:${pad(n)}Z`, type, payload });
  const call = (id, cmd, n) =>
    line(
      "response_item",
      {
        type: "function_call",
        name: "shell",
        arguments: JSON.stringify({ command: cmd }),
        call_id: id,
      },
      n,
    );
  const out = (id, o, n) =>
    line(
      "response_item",
      { type: "function_call_output", call_id: id, output: o },
      n,
    );
  const msg = (t, n) =>
    line(
      "response_item",
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: t }],
      },
      n,
    );
  const lines = [
    line("session_meta", { cwd: w.repoRoot }, 0),
    call("a", ["node", "run-receipt.mjs", "start"], 1),
    out("a", MARKER, 2),
    msg("CODEX-INSIDE", 3),
    line("turn_context", { cwd: "/home/u/elsewhere" }, 4),
    msg("CODEX-OUTSIDE", 5),
    line("turn_context", { cwd: w.repoRoot }, 6),
    msg("CODEX-BACK", 7),
  ];
  const kept = JSON.stringify(readCodex(lines, MARKER));
  assert.ok(kept.includes("CODEX-INSIDE") && kept.includes("CODEX-OUTSIDE"));
  const home = mkdtempSync(join(tmpdir(), "slop-cx-"));
  const dir = join(home, ".codex", "sessions", "2026", "11", "23");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "rollout-1.jsonl"), `${lines.join("\n")}\n`);
  const res = await exportCodexFile({
    ...w.opts(),
    homeDir: home,
    client: "codex",
  });
  const t = readFileSync(res.path, "utf8");
  assert.ok(t.includes("CODEX-INSIDE") && t.includes("CODEX-BACK"));
  assert.ok(!t.includes("CODEX-OUTSIDE"));
});

test("a pasted marker without a start command is not a session", async () => {
  const w = world();
  const pasted = join(w.homeDir, ".claude", "projects", "p1", "pasted.jsonl");
  writeFileSync(
    pasted,
    `${JSON.stringify({ type: "user", timestamp: "2026-11-23T11:00:00Z", cwd: w.repoRoot, message: { role: "user", content: `see ${MARKER}` } })}\n`,
  );
  utimesSync(
    pasted,
    new Date(Date.now() + 60000),
    new Date(Date.now() + 60000),
  );
  assert.equal(
    findSessionFile(MARKER, { homeDir: w.homeDir })?.path,
    w.session,
  );
  assert.deepEqual(
    readClaudeCode(
      readFileSync(pasted, "utf8").split("\n").filter(Boolean),
      MARKER,
    ),
    [],
  );
  const lines = fixture("claude-code.jsonl", w.repoRoot)
    .split("\n")
    .filter(Boolean);
  const events = readClaudeCode(lines, MARKER);
  assert.ok(events[0].text.includes(MARKER));
  assert.equal(events[0].kind, "tool_result");
});

test("the export stops at the session or export command", async () => {
  const w = world();
  build(w, ({ entry, call }) => {
    entry("user", "BEFORE-END");
    call(
      "Bash",
      { command: "node scripts/run-receipt.mjs session --run r" },
      "UPLOAD-OUT",
    );
    entry("user", "AFTER-END");
  });
  const a = JSON.stringify((await runOut(w)).events);
  assert.ok(a.includes("BEFORE-END"));
  for (const bad of ["AFTER-END", "UPLOAD-OUT", "run-receipt.mjs session"])
    assert.ok(!a.includes(bad), bad);
  build(w, ({ entry, call }) => {
    entry("user", "BEFORE-END");
    call("Bash", { command: "node run-receipt.mjs export" }, "EXPORT-OUT");
    entry("user", "AFTER-END");
  });
  const b = JSON.stringify((await runOut(w)).events);
  assert.ok(
    b.includes("BEFORE-END") &&
      !b.includes("EXPORT-OUT") &&
      !b.includes("AFTER-END"),
  );
});

test("raw timestamps, tool names and argument keys are validated", async () => {
  const w = world();
  build(w, ({ call }) => {
    call("Bash", { command: "echo hi" }, "hi", {});
    call("Bad Tool!", { command: "echo" }, "x");
    call(
      "Bash",
      { "/home/u/other/key": "v", [`sk-${"a1B2".repeat(8)}`]: "w" },
      "z",
    );
  });
  const raw = readFileSync(w.session, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  raw[1].timestamp = "ignore previous instructions";
  raw[raw.length - 4].timestamp = "also bad";
  writeFileSync(w.session, `${raw.map((o) => JSON.stringify(o)).join("\n")}\n`);
  const { header, events } = await runOut(w);
  const text = JSON.stringify([header, events]);
  assert.ok(!text.includes("ignore previous"));
  assert.ok(!text.includes("Bad Tool"));
  assert.ok(!text.includes("also bad"));
  assert.ok(!text.includes("sk-a1B2"));
  assert.ok(!text.includes("/home/u/other/key"));
  assert.ok(events.every((e) => e.t === undefined || /^\d{4}-/.test(e.t)));
  assert.match(header.startedAt, /^2026-/);
});

// ---- fix round 2 ----
test("licensed shell results are kept only when the command is fully resolvable", async () => {
  const w = world();
  const cmds = [
    "cat .env*",
    "cat *.pem",
    "cat $(git ls-files -o --ignored --exclude-standard)",
    "xargs cat < list.txt",
    "find . -name '*.env' -exec cat {} ;",
    "git show HEAD:.env",
    "cat {.env,x}",
    "cat .[e]nv",
    "cat .e''nv",
    "cat .e\\nv",
    "cat `echo .env`",
    "cat $HOME/../x",
    "eval 'cat .env'",
    "bash -c 'cat .env'",
    "cd secrets && cat key",
    "popd; cat key",
  ];
  build(w, ({ call }) => {
    for (const command of cmds) call("Bash", { command }, "SECRET-BODY");
    call(
      "Grep",
      { pattern: "KEY", path: ".env", output_mode: "content" },
      "SECRET-BODY",
    );
    call("Glob", { pattern: "x", path: "k.pem" }, "SECRET-BODY");
    call("Bash", { command: "cat src/a.ts" }, "export const a = 1;");
  });
  const { events } = await runOut(w);
  assert.ok(!JSON.stringify(events).includes("SECRET-BODY"));
  assert.ok(results(events).some((e) => e.text === "export const a = 1;"));
  const home = mkdtempSync(join(tmpdir(), "slop-cx-"));
  const dir = join(home, ".codex", "sessions", "2026", "11", "23");
  mkdirSync(dir, { recursive: true });
  const line = (n, type, payload) =>
    JSON.stringify({ timestamp: `2026-11-23T10:00:0${n}Z`, type, payload });
  const fc = (id, args) => ({
    type: "function_call",
    name: "shell",
    arguments: JSON.stringify(args),
    call_id: id,
  });
  writeFileSync(
    join(dir, "rollout-2.jsonl"),
    `${[
      line(0, "session_meta", { cwd: w.repoRoot }),
      line(
        1,
        "response_item",
        fc("a", { command: ["node", "run-receipt.mjs", "start"] }),
      ),
      line(2, "response_item", {
        type: "function_call_output",
        call_id: "a",
        output: MARKER,
      }),
      line(
        3,
        "response_item",
        fc("b", { command: "cat key", workdir: join(w.repoRoot, "secrets") }),
      ),
      line(4, "response_item", {
        type: "function_call_output",
        call_id: "b",
        output: "SECRET-BODY",
      }),
      line(
        5,
        "response_item",
        fc("c", { command: ["bash", "-lc", "cat .env"] }),
      ),
      line(6, "response_item", {
        type: "function_call_output",
        call_id: "c",
        output: "SECRET-BODY",
      }),
    ].join("\n")}\n`,
  );
  const cx = await exportCodexFile({
    ...w.opts(),
    homeDir: home,
    client: "codex",
  });
  assert.ok(!readFileSync(cx.path, "utf8").includes("SECRET-BODY"));
});

test("only a single receipt invocation counts as the receipt tool's own output", async () => {
  const w = world();
  const bad = [
    "cat .env && node run-receipt.mjs status",
    "cd ../other && cat s.txt; node run-receipt.mjs x",
    "git diff; node run-receipt.mjs authorize",
    "cat src/a.ts; node run-receipt.mjs status",
    "node run-receipt.mjs status | cat",
    "node run-receipt.mjs status > out.txt",
  ];
  const go = async (over, list) => {
    build(w, ({ call }) => {
      for (const command of list) call("Bash", { command }, "LEAKWORD-XYZ");
      call(
        "Bash",
        { command: `node ${RECEIPT} status --run r1` },
        "RECEIPT-OUT",
      );
    });
    const { events } = await runOut(w, over);
    const text = JSON.stringify(events);
    assert.ok(!text.includes("LEAKWORD-XYZ"));
    assert.ok(text.includes("RECEIPT-OUT"));
  };
  await go({}, bad.slice(0, 2));
  await go(unlicensed, bad);
});

test("unlicensed allowlist accepts only exact confirmations from write tools", async () => {
  const w = world();
  const file = `${w.repoRoot}/src/n.ts`;
  build(w, ({ call }) => {
    call("Bash", { command: "echo x" }, "wrote 3 bytes LEAKWORD-XYZ");
    call("Bash", { command: "echo x" }, "Successfully created LEAKWORD-XYZ");
    call(
      "Edit",
      { file_path: file },
      "The file LEAKWORD-XYZ has been updated successfully.",
    );
    call(
      "Write",
      { file_path: file, content: "Z" },
      `File created successfully at: ${file}`,
    );
    call(
      "Edit",
      { file_path: file },
      `The file ${file} has been updated successfully.`,
    );
  });
  const { events } = await runOut(w, unlicensed);
  const r = results(events).map((e) => e.text);
  assert.ok(!JSON.stringify(events).includes("LEAKWORD-XYZ"));
  assert.equal(r.filter((t) => t === "[REDACTED:SOURCE]").length, 4); // includes the untrusted start result
  assert.ok(r.includes("File created successfully at: src/n.ts"));
});

// ---- fix round 3 ----
test("known secrets from ignored files and home credential files are redacted anywhere", async () => {
  const w = world();
  writeFileSync(
    join(w.homeDir, ".npmrc"),
    "//reg/:_authToken=npmtokenvalue123\n",
  );
  mkdirSync(join(w.repoRoot, "scripts"), { recursive: true });
  writeFileSync(join(w.repoRoot, "scripts", "load.js"), "console.log(1)\n");
  execFileSync("git", ["-C", w.repoRoot, "add", "scripts/load.js"]);
  build(w, ({ entry, call }) => {
    call(
      "Bash",
      { command: "node scripts/load.js" },
      "API_PASS=hunter2hunter2 and quoted-value-12345 and npmtokenvalue123",
    );
    entry("assistant", [
      { type: "text", text: "I typed hunter2hunter2 by hand" },
    ]);
    call("Bash", { command: "echo hunter2hunter2", hunter2hunter2: "k" }, "ok");
  });
  const { header, events } = await runOut(w);
  const text = JSON.stringify([header, events]);
  for (const bad of [
    "hunter2hunter2",
    "quoted-value-12345",
    "npmtokenvalue123",
  ])
    assert.ok(!text.includes(bad), bad);
  assert.ok(header.counts.CREDENTIAL >= 5);
  assert.equal(header.contentGuard, "on");
});

test("known secrets stay fast", () => {
  const known = Array.from(
    { length: 5000 },
    (_, i) => `secret-value-${i}-${"x".repeat(i % 7)}`,
  );
  const big = `${"lorem ipsum dolor sit amet ".repeat(40000)} secret-value-4999-xxxxxxx tail`;
  const start = performance.now();
  const out = cleanEvents(
    [{ t: "2026-11-23T10:00:00Z", kind: "tool_result", text: big }],
    ctx({ knownSecrets: known }),
  );
  assert.ok(performance.now() - start < 2000);
  assert.ok(!out.events[0].text.includes("secret-value-4999"));
  assert.ok(out.counts.CREDENTIAL >= 1);
});

test("too many ignored files fail closed", async () => {
  const w = world();
  mkdirSync(join(w.repoRoot, "gen"));
  for (let i = 0; i < 5100; i++)
    writeFileSync(
      join(w.repoRoot, "gen", `f${i}.txt`),
      `line number ${i} abcdefgh\n`,
    );
  writeFileSync(
    join(w.repoRoot, ".gitignore"),
    "*.log\n.env\n*.pem\nsecrets/\ngen/\n",
  );
  build(w, ({ call }) => {
    call("Bash", { command: "cat src/a.ts" }, "LEAKWORD-XYZ");
    call(
      "Edit",
      { file_path: `${w.repoRoot}/src/a.ts` },
      "edited LEAKWORD-QQQ",
    );
  });
  const { header, events } = await runOut(w);
  assert.equal(header.contentGuard, "capped");
  const r = results(events).map((e) => e.text);
  assert.ok(!r.includes("LEAKWORD-XYZ"));
  assert.ok(r.includes("edited LEAKWORD-QQQ"));
});

test("directories, recursive flags, inline interpreters and symlinks are unresolvable", async () => {
  const w = world();
  symlinkSync(".env", join(w.repoRoot, "link"));
  execFileSync("git", ["-C", w.repoRoot, "add", "link"]);
  const cmds = [
    "grep -rh KEY .",
    "grep -rhI KEY",
    "grep -rh . secrets",
    "tar cf - secrets | tar xOf -",
    "rg KEY",
    "python3 -c 'print(open(chr(46)+chr(101)+chr(110)+chr(118)).read())'",
    "node -e 'console.log(String.fromCharCode(46))'",
    "node -p 1",
    "perl -ne print",
    "python3 -Ic 1",
    "node --eval 1",
    "ls secrets",
    "cat link",
    "node /tmp/x/run-receipt.mjs status",
  ];
  build(w, ({ call }) => {
    for (const command of cmds) call("Bash", { command }, "LEAKWORD-XYZ");
    call("Read", { file_path: `${w.repoRoot}/link` }, "LEAKWORD-XYZ");
    call("Bash", { command: "cat src/a.ts" }, "export const a = 1;");
  });
  for (const over of [{}, unlicensed]) {
    const { events } = await runOut(w, over);
    assert.ok(!JSON.stringify(events).includes("LEAKWORD-XYZ"));
  }
  const { events } = await runOut(w);
  assert.ok(results(events).some((e) => e.text === "export const a = 1;"));
});

// ---- fix round 4 ----
const runTracked = (w, rel, body) => {
  mkdirSync(dirname(join(w.repoRoot, rel)), { recursive: true });
  writeFileSync(join(w.repoRoot, rel), body);
  execFileSync("git", ["-C", w.repoRoot, "add", rel]);
  return execFileSync("node", [rel], {
    cwd: w.repoRoot,
    env: { ...process.env, HOME: w.homeDir },
  }).toString();
};

test("a gitignored file the agent edited is still read into the content guard", async () => {
  const w = world();
  writeFileSync(join(w.repoRoot, ".env"), "API_KEY=Sx9QwErTy7781abc\n");
  const printed = runTracked(
    w,
    "scripts/show.js",
    'const fs=require("fs");for(const l of fs.readFileSync(".env","utf8").split("\\n")){const i=l.indexOf("=");if(i>0)console.log(l.slice(0,i)+" is "+l.slice(i+1).trim());}\n',
  );
  assert.ok(printed.includes("Sx9QwErTy7781abc"));
  build(w, ({ call }) => {
    call(
      "Edit",
      { file_path: `${w.repoRoot}/.env`, old_string: "x", new_string: "x" },
      "The file .env has been updated successfully.",
    );
    call("Bash", { command: "node scripts/show.js" }, printed);
  });
  const { header, events } = await runOut(w);
  assert.ok(!JSON.stringify(events).includes("Sx9QwErTy7781abc"));
  assert.equal(header.contentGuard, "on");
});

test("secret values in common file formats are split out and redacted", async () => {
  const w = world();
  const vals = {
    env: "Va1ueInlineAB",
    json: "JsonTok3nValue",
    yaml: "YamlTok3nValue",
    netrc: "NetrcPassw0rd9",
    gitUser: "gitusername42",
    gitPass: "GitCredTok3n99",
  };
  writeFileSync(join(w.repoRoot, ".env"), `INLINE_KEY=${vals.env} # prod\n`);
  writeFileSync(
    join(w.repoRoot, "secrets", "c.json"),
    `{"token":"${vals.json}","x":1}\n`,
  );
  writeFileSync(
    join(w.repoRoot, "secrets", "c.yml"),
    `token: "${vals.yaml}" # main\n`,
  );
  writeFileSync(
    join(w.homeDir, ".netrc"),
    `machine example.com login me password ${vals.netrc}\n`,
  );
  writeFileSync(
    join(w.homeDir, ".git-credentials"),
    `https://${vals.gitUser}:${vals.gitPass}@github.com\n`,
  );
  const printed = runTracked(
    w,
    "scripts/show.js",
    [
      'const fs=require("fs"),os=require("os");',
      'console.log(fs.readFileSync(".env","utf8").split("=")[1].split("#")[0].trim());',
      'console.log(JSON.parse(fs.readFileSync("secrets/c.json","utf8")).token);',
      'console.log(fs.readFileSync("secrets/c.yml","utf8").split(":")[1].split("#")[0].trim().replace(/"/g,""));',
      'const n=fs.readFileSync(os.homedir()+"/.netrc","utf8").trim().split(/\\s+/);console.log(n[n.length-1]);',
      'const u=new URL(fs.readFileSync(os.homedir()+"/.git-credentials","utf8").trim());console.log(u.username);console.log(u.password);',
    ].join("\n"),
  );
  for (const v of Object.values(vals)) assert.ok(printed.includes(v), v);
  build(w, ({ call }) => {
    call("Bash", { command: "node scripts/show.js" }, printed);
  });
  const { header, events } = await runOut(w);
  const text = JSON.stringify(events);
  const leaked = Object.entries(vals).filter(([, v]) => text.includes(v));
  assert.deepEqual(
    leaked.map(([k]) => k),
    [],
  );
  assert.equal(header.contentGuard, "on");
});

// ---- fix round 5 ----
test("url user-info extraction stays linear on minified lines", () => {
  const line = "e.exports.default.a1-b2+c3".repeat(2500).slice(0, 64000);
  assert.equal(line.length, 64000);
  const start = performance.now();
  const into = new Set();
  addSecretStrings(line, into);
  assert.ok(performance.now() - start < 50, "extract took too long");
  const creds = new Set();
  addSecretStrings(
    "x https://gituser42:GitTok3n99@github.com y ftp://ftpuser1:ftppass99@h",
    creds,
  );
  for (const v of ["gituser42", "GitTok3n99", "ftpuser1", "ftppass99"])
    assert.ok(creds.has(v), v);
});

function guardRepo() {
  const repo = mkdtempSync(join(tmpdir(), "slop-guard-"));
  const put = (rel, body) => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), body);
  };
  put(".gitignore", ".env\n.next/\ncache/\n");
  put("src/index.ts", "export {}\n");
  const g = (...a) => execFileSync("git", ["-C", repo, ...a]);
  g("init", "-q");
  g("add", "-A");
  g("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "i");
  return { repo, put };
}

test("a typical JavaScript repo keeps the content guard on", async () => {
  const w = world();
  const env = Array.from(
    { length: 20 },
    (_, i) => `SERVICE_${i}_API_KEY=sk_live_${i}${"Ab9".repeat(8)} # note ${i}`,
  ).join("\n");
  writeFileSync(join(w.repoRoot, ".env"), env);
  writeFileSync(
    join(w.repoRoot, ".gitignore"),
    "*.log\n.env\n*.pem\nsecrets/\n.next/\n",
  );
  const words = [
    "useState",
    "useEffect",
    "className",
    "createElement",
    "webpackChunk",
    "defineProperty",
    "hasOwnProperty",
    "addEventListener",
  ];
  let seed = 1;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const ident = () =>
    `${words[Math.floor(rnd() * words.length)]}_${Math.floor(rnd() * 1e6).toString(36)}`;
  mkdirSync(join(w.repoRoot, ".next", "static", "chunks"), { recursive: true });
  for (let i = 0; i < 300; i++) {
    const parts = [];
    for (let j = 0; j < 120; j++)
      parts.push(
        `${ident()}:function(e,t,n){"use strict";n.d(t,{${ident()}:()=>${ident()}})}`,
      );
    writeFileSync(
      join(w.repoRoot, ".next", "static", "chunks", `c${i}.js`),
      `(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[${i}],{${parts.join(",")}}]);`,
    );
  }
  mkdirSync(join(w.repoRoot, "notes"));
  for (let i = 0; i < 50; i++)
    writeFileSync(
      join(w.repoRoot, "notes", `n${i}.md`),
      `# Note ${i}\n\nTodo: refactor the payment adapter ${i} before release.\n`,
    );
  const secret = `sk_live_7${"Ab9".repeat(8)}`;
  build(w, ({ call }) => {
    call("Bash", { command: "cat src/a.ts" }, `export const a = 1; ${secret}`);
  });
  const { header, events } = await runOut(w);
  assert.equal(header.contentGuard, "on");
  assert.ok(!JSON.stringify(events).includes(secret));
});

test("a repo past 50,000 strings or 32 MiB fails closed", () => {
  const strings = guardRepo();
  for (let f = 0; f < 1000; f++)
    strings.put(
      `cache/f${f}.txt`,
      Array.from({ length: 50 }, (_, i) => `tok_${f}_${i}_QQQQqqqq`).join("\n"),
    );
  const at = collectKnownSecrets(makeRepoIndex([], strings.repo, null), null);
  assert.equal(at.capped, false);
  assert.equal(at.strings.length, 50000);
  strings.put("cache/extra.txt", "one_more_string_QQ\n");
  const past = collectKnownSecrets(makeRepoIndex([], strings.repo, null), null);
  assert.equal(past.capped, true);
  assert.ok(past.strings.length <= 50000);

  const bytes = guardRepo();
  const body = `${"a".repeat(999)}\n`.repeat(60);
  for (let f = 0; f < 600; f++) bytes.put(`cache/b${f}.txt`, body);
  const big = collectKnownSecrets(makeRepoIndex([], bytes.repo, null), null);
  assert.equal(big.capped, true);
});

test("collect and clean of 50,000 strings on a 4 MB session stay fast", () => {
  const r = guardRepo();
  for (let f = 0; f < 1000; f++)
    r.put(
      `cache/f${f}.txt`,
      Array.from({ length: 50 }, (_, i) => `tok_${f}_${i}_QQQQqqqq`).join("\n"),
    );
  const big = `${"lorem ipsum dolor sit amet ".repeat(155000)} tok_999_49_QQQQqqqq tail`;
  assert.ok(big.length > 4_000_000);
  const start = performance.now();
  const known = collectKnownSecrets(makeRepoIndex([], r.repo, null), null);
  const out = cleanEvents(
    [{ t: "2026-11-23T10:00:00Z", kind: "tool_result", text: big }],
    ctx({ knownSecrets: known.strings }),
  );
  const ms = performance.now() - start;
  assert.equal(known.capped, false);
  assert.ok(ms < 2000, `took ${ms}ms`);
  assert.ok(!out.events[0].text.includes("tok_999_49_QQQQqqqq"));
});

// ---- final fix wave ----
const body = (events) => JSON.stringify(events);

test("results of tools outside the allowlist are redacted and their argument values too", async () => {
  const w = world();
  build(w, ({ call }) => {
    call(
      "mcp__gmail__get_message",
      { messageId: "MSG-ID-1234567" },
      "From: Bob <bob@example.com>, phone 555-0100. MAIL-BODY",
    );
    call(
      "WebFetch",
      { url: "https://example.com/page", prompt: "FETCH-PROMPT" },
      "FETCHED-PAGE-BODY",
    );
    call(
      "Task",
      { description: "look", prompt: "TASK-PROMPT-TEXT" },
      "TASK-RESULT-BODY about another project",
    );
    call("WebSearch", { query: "SEARCH-QUERY" }, "SEARCH-RESULT-BODY");
    call("Bash", { command: "cat src/a.ts" }, "export const a = 1;");
  });
  for (const over of [{}, unlicensed]) {
    const { events } = await runOut(w, over);
    const text = body(events);
    for (const bad of [
      "MAIL-BODY",
      "bob@example.com",
      "555-0100",
      "FETCHED-PAGE-BODY",
      "TASK-RESULT-BODY",
      "SEARCH-RESULT-BODY",
      "MSG-ID-1234567",
      "example.com/page",
      "FETCH-PROMPT",
      "TASK-PROMPT-TEXT",
      "SEARCH-QUERY",
    ])
      assert.ok(!text.includes(bad), bad);
    const calls = events.filter((e) => e.kind === "tool_call");
    const mcp = calls.find((e) => e.tool === "mcp__gmail__get_message");
    assert.deepEqual(mcp.args, { messageId: "[REDACTED:SOURCE]" });
    const task = calls.find((e) => e.tool === "Task");
    assert.deepEqual(task.args, {
      description: "[REDACTED:SOURCE]",
      prompt: "[REDACTED:SOURCE]",
    });
    const bash = calls.find((e) => e.tool === "Bash" && e.args.command);
    assert.ok(bash, "shell arguments stay readable");
  }
  const { events } = await runOut(w);
  assert.ok(results(events).some((e) => e.text === "export const a = 1;"));
});

test("a codex rollout is not read by the export", async () => {
  const w = world();
  const home = mkdtempSync(join(tmpdir(), "slop-cx-"));
  const dir = join(home, ".codex", "sessions", "2026", "11", "23");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "rollout-1.jsonl"),
    `${fixture("codex.jsonl", w.repoRoot)}\n`,
  );
  assert.ok(
    readCodex(
      fixture("codex.jsonl", w.repoRoot).split("\n").filter(Boolean),
      MARKER,
    ).length > 0,
  );
  assert.equal(findSessionFile(MARKER, { homeDir: home }), null);
  const res = await exportSession({
    ...w.opts(),
    homeDir: home,
    client: "codex",
  });
  assert.equal(res.source, "fallback-needed");
  assert.ok(!existsSync(w.opts().outPath));
});

const failing = (match) => (repoRoot, args, input) => {
  if (match(args)) return { status: 128, stdout: Buffer.alloc(0) };
  const r = spawnSync("git", ["-C", repoRoot, ...args], { input });
  return r.status === null ? null : r;
};

test("a git check that fails counts every written untracked file as ignored", async () => {
  const w = world();
  const events = [
    {
      kind: "tool_call",
      tool: "Edit",
      args: { file_path: join(w.repoRoot, ".env") },
    },
    {
      kind: "tool_call",
      tool: "Write",
      args: { file_path: join(w.repoRoot, "src", "new.ts") },
    },
  ];
  const real = makeRepoIndex(events, w.repoRoot, w.homeDir);
  assert.equal(real.isRepoFile(join(w.repoRoot, ".env")), false);
  assert.equal(real.isRepoFile(join(w.repoRoot, "src", "new.ts")), true);
  const ignoreFails = makeRepoIndex(
    events,
    w.repoRoot,
    w.homeDir,
    failing((a) => a[0] === "check-ignore"),
  );
  assert.equal(ignoreFails.isRepoFile(join(w.repoRoot, ".env")), false);
  assert.equal(
    ignoreFails.isRepoFile(join(w.repoRoot, "src", "new.ts")),
    false,
  );
  assert.equal(ignoreFails.isRepoFile(join(w.repoRoot, "src", "a.ts")), true);
  const listFails = makeRepoIndex(
    events,
    w.repoRoot,
    w.homeDir,
    failing((a) => a[0] === "ls-files"),
  );
  assert.equal(listFails.isRepoFile(join(w.repoRoot, "src", "a.ts")), false);
  // A written path behind a symlinked directory makes check-ignore exit 128.
  symlinkSync(join(w.repoRoot, "src"), join(w.repoRoot, "link"));
  const linked = makeRepoIndex(
    [
      ...events,
      {
        kind: "tool_call",
        tool: "Write",
        args: { file_path: join(w.repoRoot, "link", "b.ts") },
      },
    ],
    w.repoRoot,
    w.homeDir,
  );
  assert.equal(linked.isRepoFile(join(w.repoRoot, ".env")), false);
  // The content guard reads a written file when the ignore list fails.
  writeFileSync(join(w.repoRoot, ".env"), "API_KEY=Zq81mmWritten77\n");
  const known = collectKnownSecrets(
    real,
    w.homeDir,
    new Set(),
    failing((a) => a.includes("-i")),
  );
  assert.ok(known.strings.includes("Zq81mmWritten77"));
});

test("token-only url user-info is redacted and stays linear", () => {
  const out = clean([
    ev(
      "tool_result",
      "origin\thttps://ghx0123456789abcdefTOKEN@github.com/o/r (fetch)",
    ),
    ev("tool_result", "ssh://git@github.com/o/r and https://bob@host.example"),
  ]);
  assert.ok(!out.events[0].text.includes("ghx0123456789abcdefTOKEN"));
  assert.ok(out.events[0].text.includes("[REDACTED:CREDENTIAL]@github.com"));
  assert.equal(
    out.events[1].text,
    "ssh://git@github.com/o/r and https://bob@host.example",
  );
  for (const [text, kept] of [
    [`https://${"a".repeat(500_000)}`, true],
    [`https://${"a".repeat(500_000)}@`, false],
    [`https://${"a".repeat(500_000)}:`, true],
  ]) {
    const start = performance.now();
    const res = clean([ev("tool_result", text)]);
    const ms = performance.now() - start;
    assert.ok(ms < 1000, `${ms} ms`);
    assert.equal(res.events[0].text === text, kept);
  }
});

test("session files older than the run are not read, and a match is found across read chunks", () => {
  const w = world();
  assert.equal(
    findSessionFile(MARKER, { homeDir: w.homeDir })?.path,
    w.session,
  );
  utimesSync(w.session, new Date(1000), new Date(1000));
  assert.equal(
    findSessionFile(MARKER, {
      homeDir: w.homeDir,
      startedAt: "2026-11-23T00:00:00.000Z",
    }),
    null,
  );
  const dir = mkdtempSync(join(tmpdir(), "slop-chunk-"));
  const needle = "slop-run:abc";
  for (let at = 0; at < 40; at++) {
    const p = join(dir, `f${at}`);
    writeFileSync(p, `${"x".repeat(at)}${needle}${"y".repeat(7)}`);
    assert.equal(fileContains(p, needle, 16), true, String(at));
  }
  const miss = join(dir, "miss");
  writeFileSync(miss, `${"x".repeat(100)}slop-run:ab`);
  assert.equal(fileContains(miss, needle, 16), false);
});

test("injected harness blocks are removed from user and tool result text", async () => {
  const w = world();
  build(w, ({ entry, call }) => {
    entry("user", "<system-reminder>SYS-REMINDER-BODY</system-reminder>");
    entry(
      "user",
      "fix it <bash-stdout>BASH-OUT-BODY</bash-stdout><bash-stderr>BASH-ERR-BODY</bash-stderr>",
    );
    entry(
      "user",
      "<local-command-stdout>LOCAL-OUT</local-command-stdout>ok <local-command-stderr>LOCAL-ERR",
    );
    call(
      "Bash",
      { command: "cat src/a.ts" },
      "export const a = 1;<system-reminder>RESULT-REMINDER</system-reminder>",
    );
  });
  const { events } = await runOut(w);
  const text = body(events);
  for (const bad of [
    "SYS-REMINDER-BODY",
    "BASH-OUT-BODY",
    "BASH-ERR-BODY",
    "LOCAL-OUT",
    "LOCAL-ERR",
    "RESULT-REMINDER",
    "system-reminder",
  ])
    assert.ok(!text.includes(bad), bad);
  const users = events.filter((e) => e.kind === "user").map((e) => e.text);
  assert.deepEqual(users, ["fix it ", "ok "]);
  assert.ok(results(events).some((e) => e.text === "export const a = 1;"));
});

test("a session the guard empties is no session record", async () => {
  const w = world();
  build(w, ({ entry }) => entry("user", "OUTSIDE"), "/home/u/other");
  const res = await exportSession(w.opts());
  assert.equal(res.source, "fallback-needed");
  assert.ok(!existsSync(w.opts().outPath));
});

test("the header records the client found in the session file", async () => {
  const w = world();
  const { header } = await runOut(w, { client: "other-client" });
  assert.equal(header.client, "other-client");
  assert.equal(header.detectedClient, "claude-code");
});

test("codex shapes still pass the guard when read directly", async () => {
  const w = world();
  const line = (n, type, payload) =>
    JSON.stringify({ timestamp: `2026-11-23T10:00:0${n}Z`, type, payload });
  const fc = (id, args) => ({
    type: "function_call",
    name: "shell",
    arguments: JSON.stringify(args),
    call_id: id,
  });
  const lines = [
    line(0, "session_meta", { cwd: w.repoRoot }),
    line(
      1,
      "response_item",
      fc("a", { command: ["node", "run-receipt.mjs", "start"] }),
    ),
    line(2, "response_item", {
      type: "function_call_output",
      call_id: "a",
      output: MARKER,
    }),
    line(
      3,
      "response_item",
      fc("b", { command: "cat key", workdir: join(w.repoRoot, "secrets") }),
    ),
    line(4, "response_item", {
      type: "function_call_output",
      call_id: "b",
      output: "SECRET-BODY",
    }),
    line(5, "response_item", fc("c", { command: ["bash", "-lc", "cat .env"] })),
    line(6, "response_item", {
      type: "function_call_output",
      call_id: "c",
      output: "SECRET-BODY",
    }),
  ];
  const res = await writeCleanedSession(
    readCodex(lines, MARKER),
    "client-file",
    {
      ...w.opts(),
      client: "codex",
    },
  );
  assert.ok(!readFileSync(res.path, "utf8").includes("SECRET-BODY"));
});

// ---- fix round 6: the first real Claude Code run ----
test("the user name is removed when it sits next to a hyphen, underscore or dot", () => {
  const over = {
    repoRoot: "/Users/drewpierson/src/proj",
    homeDir: "/Users/drewpierson",
    userName: "drewpierson",
  };
  const slug = "saved in -Users-drewpierson--claude-spares-spare-Y9YL6q/x.txt";
  const out = clean(
    [
      ev("assistant", slug),
      ev("assistant", "a drewpierson_x b drewpierson.y c x.drewpierson"),
      ev("assistant", "project -Users-drewpierson-src-proj here"),
    ],
    over,
  );
  const text = out.events.map((e) => e.text).join("\n");
  assert.ok(!text.includes("drewpierson"), text);
  assert.ok(!text.includes("-Users-"), text);
  assert.ok(text.includes("claude-spares-spare-Y9YL6q/x.txt"));
  const home = clean(
    [ev("assistant", "dir -home-bob_2--cache and bob_2.log")],
    {
      repoRoot: "/home/bob_2/proj",
      homeDir: "/home/bob_2",
      userName: "someone",
    },
  );
  assert.ok(!home.events[0].text.includes("bob_2"), home.events[0].text);
});

test("a secret inside the repo path does not stop the path becoming repo-relative", () => {
  const repoRoot = "/home/alice/work-b76b10fbcafe42/proj";
  const out = clean(
    [
      ev("assistant", `edited ${repoRoot}/src/a.ts and ${repoRoot}`),
      ev("tool_call", undefined, {
        tool: "Read",
        args: { file_path: `${repoRoot}/src/a.ts` },
      }),
    ],
    {
      repoRoot,
      knownSecrets: ["b76b10fbcafe42"],
      env: { SESSION_ID: "work-b76b10fbcafe42" },
    },
  );
  assert.equal(out.events[0].text, "edited src/a.ts and .");
  assert.equal(out.events[1].args.file_path, "src/a.ts");
  const text = JSON.stringify(out.events);
  for (const bad of ["alice", "/home", "b76b10fbcafe42", "LOCAL_PATH"])
    assert.ok(!text.includes(bad), bad);
});

test("home credential files give only credential values to the guard, never host names", () => {
  const into = new Set();
  addSecretStrings(
    "github.com: x\nexample.co.uk\nhost=api.example.com\n",
    into,
  );
  for (const s of into) assert.ok(!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(s), s);
  const w = world();
  mkdirSync(join(w.homeDir, ".config", "gh"), { recursive: true });
  const tok = `gho_${"FAKEtoken1234".repeat(3)}`;
  writeFileSync(
    join(w.homeDir, ".config", "gh", "hosts.yml"),
    `github.com:\n    user: drew-dot-com\n    oauth_token: ${tok}\n    git_protocol: https\n`,
  );
  mkdirSync(join(w.homeDir, ".aws"), { recursive: true });
  writeFileSync(
    join(w.homeDir, ".aws", "credentials"),
    "[default]\nregion = eu-west-1-example\naws_secret_access_key = AwsSecretValue123\n",
  );
  writeFileSync(
    join(w.homeDir, ".pypirc"),
    "[pypi]\nrepository = https://upload.pypi.org/legacy/\nusername = __token__\npassword = pypi-AgEIcHlwaS5vcmcFAKE\n",
  );
  const index = makeRepoIndex([], w.repoRoot, w.homeDir);
  const known = collectKnownSecrets(index, w.homeDir).strings;
  assert.ok(known.includes(tok));
  assert.ok(known.includes("AwsSecretValue123"));
  assert.ok(known.includes("pypi-AgEIcHlwaS5vcmcFAKE"));
  for (const bad of [
    "github.com",
    "drew-dot-com",
    "git_protocol",
    "eu-west-1-example",
    "https://upload.pypi.org/legacy/",
    "upload.pypi.org",
    "__token__",
  ])
    assert.ok(!known.includes(bad), bad);
  const out = clean(
    [
      ev(
        "assistant",
        `see https://github.com/toon-protocol/toon-plugins and ${tok}`,
      ),
    ],
    { knownSecrets: known },
  );
  assert.ok(
    out.events[0].text.includes(
      "https://github.com/toon-protocol/toon-plugins",
    ),
    out.events[0].text,
  );
  assert.ok(!out.events[0].text.includes(tok));
});

test("name-only commands and globs over repo files keep their output", async () => {
  const w = world();
  mkdirSync(join(w.repoRoot, "checks"), { recursive: true });
  writeFileSync(join(w.repoRoot, "checks", "a.test.mjs"), "test(1)\n");
  writeFileSync(join(w.repoRoot, "checks", "b.test.mjs"), "test(2)\n");
  writeFileSync(join(w.repoRoot, "notes.txt"), "NOTES-BODY\n");
  execFileSync("git", [
    "-C",
    w.repoRoot,
    "add",
    "checks/a.test.mjs",
    "checks/b.test.mjs",
  ]);
  const status =
    "On branch main\nUntracked files:\n\tlist.txt\n\tnotes.txt\n\tsrc/new.ts\n\tuntracked.txt\n";
  const keep = [
    ["ls checks", "a.test.mjs\nb.test.mjs"],
    ["git status", status],
    ["node --test checks/*.test.mjs", "# pass 2\n# fail 0"],
    ["git log --oneline -3", "abc1234 first commit"],
    ["git diff --stat", " checks/a.test.mjs | 1 +\n 1 file changed"],
    ["find checks -name '*.mjs' -type f", "checks/a.test.mjs"],
    ["git branch", "* main"],
    ["tree checks", "checks\n├── a.test.mjs\n└── b.test.mjs"],
    ["git status --short && git diff --name-only", "?? notes.txt"],
    [`ls ${w.repoRoot}/checks`, "a.test.mjs"],
  ];
  const strip = [
    ["cat *.env", "LEAKWORD-A"],
    ["cat .e*", "LEAKWORD-B"],
    ["ls ~", "LEAKWORD-C"],
    ["git log -p -- .env", "LEAKWORD-D"],
    ["ls secrets", "LEAKWORD-E"],
    ["cat *.txt", "LEAKWORD-F"],
    ["find . -name x -exec cat {} ;", "LEAKWORD-G"],
    ["git log --stat -p -- notes.txt", "LEAKWORD-H"],
    ["ls checks > out.txt; cat notes.txt", "LEAKWORD-I"],
    ["cat check*", "LEAKWORD-J"],
  ];
  build(w, ({ call }) => {
    for (const [command, out] of [...keep, ...strip])
      call("Bash", { command }, out);
  });
  const { events } = await runOut(w);
  const r = results(events).map((e) => e.text);
  for (const [command, out] of keep)
    assert.ok(r.includes(out), `${command} should be kept`);
  const text = JSON.stringify(events);
  for (const [command, out] of strip)
    assert.ok(!text.includes(out), `${command} should be redacted`);
  assert.ok(!text.includes("NOTES-BODY"));
  const off = await runOut(w, unlicensed);
  for (const [, out] of keep.slice(0, 3))
    assert.ok(!results(off.events).some((e) => e.text === out));
});

test("header counts equal the markers in the written events", async () => {
  const w = world();
  build(w, ({ call }) => {
    call("Bash", { command: "cat .env" }, "API_PASS=hunter2hunter2");
    call(
      "WebFetch",
      { url: "https://x.example", prompt: "p" },
      "hunter2hunter2",
    );
    call(
      "Bash",
      { command: "cat /etc/hosts", description: "x" },
      "hunter2hunter2",
    );
  });
  const { header, events } = await runOut(w);
  const text = events.map((e) => JSON.stringify(e)).join("\n");
  const found = {};
  for (const m of text.matchAll(/\[REDACTED:([A-Z_]+)\]/g))
    found[m[1]] = (found[m[1]] ?? 0) + 1;
  assert.deepEqual(header.counts, found);
});

test("sessions in subagent folders are found", () => {
  const w = world();
  const sub = join(
    w.homeDir,
    ".claude",
    "projects",
    "p1",
    "sess1",
    "subagents",
  );
  mkdirSync(sub, { recursive: true });
  const lines = readFileSync(w.session, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.stringify({ ...JSON.parse(l), isSidechain: true }));
  writeFileSync(join(sub, "agent-a1.jsonl"), `${lines.join("\n")}\n`);
  writeFileSync(w.session, "{}\n");
  const found = findSessionFile(MARKER, { homeDir: w.homeDir });
  assert.equal(found?.path, join(sub, "agent-a1.jsonl"));
  const deeper = join(w.homeDir, ".claude", "projects", "p1", "sess2");
  mkdirSync(deeper, { recursive: true });
  writeFileSync(join(deeper, "x.jsonl"), `${lines.join("\n")}\n`);
  utimesSync(join(sub, "agent-a1.jsonl"), new Date(1000), new Date(1000));
  assert.equal(
    findSessionFile(MARKER, { homeDir: w.homeDir })?.path,
    join(deeper, "x.jsonl"),
  );
  assert.equal(
    findSessionFile(MARKER, {
      homeDir: w.homeDir,
      startedAt: new Date(Date.now() + 60000).toISOString(),
    }),
    null,
  );
});

test("an exported subagent session keeps its events", async () => {
  const w = world();
  const sub = join(w.homeDir, ".claude", "projects", "p1", "s", "subagents");
  mkdirSync(sub, { recursive: true });
  const lines = readFileSync(w.session, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.stringify({ ...JSON.parse(l), isSidechain: true }));
  writeFileSync(join(sub, "agent-b.jsonl"), `${lines.join("\n")}\n`);
  writeFileSync(w.session, "{}\n");
  const res = await exportSession(w.opts());
  assert.equal(res.source, "client-file");
});

test("a name-only command does not hide a second command", async () => {
  const w = world();
  writeFileSync(join(w.repoRoot, "notes"), "NOTES-BODY\n");
  const cmds = [
    "ls & cat notes",
    "ls (cat notes)",
    "git status | head notes",
    "ls; cat notes",
    "git log --oneline || cat notes",
    "ls checks > x && cat notes",
  ];
  build(w, ({ call }) => {
    for (const command of cmds) call("Bash", { command }, "NOTES-BODY");
  });
  const { events } = await runOut(w);
  assert.ok(!JSON.stringify(events).includes("NOTES-BODY"));
});
