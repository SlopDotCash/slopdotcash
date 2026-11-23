import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
  CLEANER_VERSION,
  cleanEvents,
  exportSession,
  findSessionFile,
  OSI_LICENCES,
  readClaudeCode,
  readCodex,
  repoLicence,
  truncateToLimit,
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
    `https://${"a".repeat(500_000)}@`,
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
  const cx = await exportSession({
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
  const res = await exportSession({
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
  const cx = await exportSession({
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
  for (let i = 0; i < 2100; i++)
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
