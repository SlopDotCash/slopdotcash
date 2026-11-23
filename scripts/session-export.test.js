import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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
  writeFileSync(join(repoRoot, ".gitignore"), "*.log\n.env\n");
  writeFileSync(join(repoRoot, ".env"), "PROPRIETARY-SRC=1\n");
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
      "File created successfully at: src/n.ts",
    );
    call("Bash", { command: "true" }, "");
  });
  const { events } = await runOut(w, unlicensed);
  const r = results(events).map((e) => e.text);
  assert.ok(!JSON.stringify(events).includes("PROPRIETARY-SRC"));
  assert.equal(r.filter((t) => t === "[REDACTED:SOURCE]").length, 3);
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
