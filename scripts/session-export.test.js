import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLEANER_VERSION,
  cleanEvents,
  OSI_LICENCES,
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
