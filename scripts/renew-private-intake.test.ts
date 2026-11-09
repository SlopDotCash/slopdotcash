// Source-authored command regressions; unexecuted during this audit. The real
// renewal function writes a temporary SQL file; a local SQLite callback stands
// in for Wrangler. No GitHub request or remote command is executed by tests.
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PRIVATE_INTAKE_STATUS_URL, renewPrivateIntake } from "./renew-private-intake.mjs";

const AT = "2026-11-09T12:00:00.000Z";
const LATER = "2026-11-09T13:00:00.000Z";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "slop-intake-renewal-test-"));
  const db = new Database(":memory:");
  db.exec("CREATE TABLE private_intake_status(singleton INTEGER PRIMARY KEY CHECK(singleton=1), enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), verified_at TEXT NOT NULL)");
  const logs: string[] = [];
  let commands = 0;
  let sql = "";
  let file = "";
  const execute = (command: string, args: readonly string[], options: unknown) => {
    commands++;
    expect(command).toBe("./node_modules/.bin/wrangler");
    expect(args.slice(0, 7)).toEqual([
      "d1", "execute", "slop-private", "--remote", "--config", "wrangler.toml", "--file",
    ]);
    expect(options).toEqual({ stdio: "inherit" });
    file = args[7]!;
    expect(dirname(file).startsWith(root)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    sql = readFileSync(file, "utf8");
    db.exec(sql);
    return Buffer.alloc(0);
  };
  return {
    root, db, logs, execute,
    options: { token: "synthetic_github_token", temporaryRoot: root, now: () => new Date(AT), execute, log: (line: string) => logs.push(line) },
    commands: () => commands, sql: () => sql, file: () => file,
    row: () => db.query("SELECT * FROM private_intake_status").get(),
    close: () => { db.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

test("enabled observation is authenticated, stored once and logged after scratch cleanup", async () => {
  const f = fixture();
  try {
    const observation = await renewPrivateIntake({ ...f.options, fetchImpl: async (url: string, init: RequestInit) => {
      expect(url).toBe(PRIVATE_INTAKE_STATUS_URL);
      expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer synthetic_github_token");
      return Response.json({ enabled: true });
    } });
    expect(observation).toEqual({ enabled: true, verifiedAt: AT });
    expect(f.commands()).toBe(1);
    expect(f.row()).toEqual({ singleton: 1, enabled: 1, verified_at: AT });
    expect(f.logs).toEqual([JSON.stringify(observation)]);
    expect(readdirSync(f.root)).toEqual([]);
  } finally { f.close(); }
});

test("disabled observation is persisted and scratch removed before command failure", async () => {
  const f = fixture();
  try {
    await expect(renewPrivateIntake({ ...f.options, fetchImpl: async () => Response.json({ enabled: false }) }))
      .rejects.toThrow("Private reporting is disabled");
    expect(f.row()).toEqual({ singleton: 1, enabled: 0, verified_at: AT });
    expect(f.commands()).toBe(1);
    expect(f.logs).toEqual([JSON.stringify({ enabled: false, verifiedAt: AT })]);
    expect(readdirSync(f.root)).toEqual([]);
  } finally { f.close(); }
});

test("a newer persisted observation cannot be overwritten by an older operator sample", async () => {
  const f = fixture();
  try {
    f.db.query("INSERT INTO private_intake_status VALUES(1,1,?)").run(LATER);
    await expect(renewPrivateIntake({ ...f.options, fetchImpl: async () => Response.json({ enabled: false }) }))
      .rejects.toThrow("Private reporting is disabled");
    expect(f.row()).toEqual({ singleton: 1, enabled: 1, verified_at: LATER });
    // Output is the checked observation; it does not claim a readback of D1.
    expect(f.logs).toEqual([JSON.stringify({ enabled: false, verifiedAt: AT })]);
  } finally { f.close(); }
});

test("an equal-timestamp observation preserves the existing value", async () => {
  const f = fixture();
  try {
    f.db.query("INSERT INTO private_intake_status VALUES(1,0,?)").run(AT);
    await renewPrivateIntake({ ...f.options, fetchImpl: async () => Response.json({ enabled: true }) });
    expect(f.row()).toEqual({ singleton: 1, enabled: 0, verified_at: AT });
  } finally { f.close(); }
});

test("missing credentials stop before any request or temporary file", async () => {
  const f = fixture();
  try {
    let fetches = 0;
    await expect(renewPrivateIntake({ ...f.options, token: "", fetchImpl: async () => {
      fetches++;
      return Response.json({ enabled: true });
    } })).rejects.toThrow("requires GITHUB_TOKEN");
    expect(fetches).toBe(0);
    expect(f.commands()).toBe(0);
    expect(readdirSync(f.root)).toEqual([]);
  } finally { f.close(); }
});

test("transport failure cannot create scratch or run the command", async () => {
  const f = fixture();
  try {
    const failure = new Error("Synthetic transport failure");
    await expect(renewPrivateIntake({ ...f.options, fetchImpl: async () => {
      throw failure;
    } })).rejects.toBe(failure);
    expect(f.commands()).toBe(0);
    expect(f.logs).toEqual([]);
    expect(readdirSync(f.root)).toEqual([]);
  } finally { f.close(); }
});

test("HTTP refusal cancels its response and never invokes Wrangler", async () => {
  for (const failCancel of [false, true]) {
    const f = fixture();
    try {
      let cancelled = false;
      const response = new Response(new ReadableStream({ cancel() {
        cancelled = true;
        if (failCancel) throw new Error("Synthetic cancellation failure");
      } }), { status: 403 });
      await expect(renewPrivateIntake({ ...f.options, fetchImpl: async () => response }))
        .rejects.toThrow("Private reporting check failed: HTTP 403");
      expect(cancelled).toBe(true);
      expect(f.commands()).toBe(0);
      expect(f.logs).toEqual([]);
      expect(readdirSync(f.root)).toEqual([]);
    } finally { f.close(); }
  }
});

test("malformed and non-boolean provider records cannot update readiness", async () => {
  for (const response of [
    Response.json(null), Response.json([]), Response.json({}),
    Response.json({ enabled: 1 }), Response.json({ enabled: "true" }),
    new Response("not-json"), new Response(new Uint8Array([255])),
  ]) {
    const f = fixture();
    try {
      await expect(renewPrivateIntake({ ...f.options, fetchImpl: async () => response })).rejects.toThrow();
      expect(f.commands()).toBe(0);
      expect(f.row()).toBeNull();
      expect(readdirSync(f.root)).toEqual([]);
    } finally { f.close(); }
  }
});

test("oversized provider response is refused and disposed before scratch creation", async () => {
  const f = fixture();
  try {
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      headers: { "content-length": String(64 * 1024 + 1) },
    });
    await expect(renewPrivateIntake({ ...f.options, fetchImpl: async () => response })).rejects.toBeInstanceOf(RangeError);
    expect(cancelled).toBe(true);
    expect(f.commands()).toBe(0);
    expect(readdirSync(f.root)).toEqual([]);
  } finally { f.close(); }
});

test("invalid observation clock stops before writing SQL", async () => {
  const f = fixture();
  try {
    await expect(renewPrivateIntake({ ...f.options, now: () => new Date(Number.NaN), fetchImpl: async () => Response.json({ enabled: true }) }))
      .rejects.toBeInstanceOf(RangeError);
    expect(f.commands()).toBe(0);
    expect(readdirSync(f.root)).toEqual([]);
  } finally { f.close(); }
});

test("Wrangler failure removes scratch, emits no success and never retries", async () => {
  const f = fixture();
  try {
    let attempts = 0;
    await expect(renewPrivateIntake({ ...f.options, fetchImpl: async () => Response.json({ enabled: true }), execute: () => {
      attempts++;
      throw new Error("Synthetic command failure");
    } })).rejects.toThrow("Synthetic command failure");
    expect(attempts).toBe(1);
    expect(f.logs).toEqual([]);
    expect(f.row()).toBeNull();
    expect(readdirSync(f.root)).toEqual([]);
  } finally { f.close(); }
});

test("a lost command reply can leave committed readiness without success output", async () => {
  const f = fixture();
  try {
    await expect(renewPrivateIntake({ ...f.options, fetchImpl: async () => Response.json({ enabled: true }), execute: (...args: Parameters<typeof f.execute>) => {
      f.execute(...args);
      throw new Error("Synthetic lost reply");
    } })).rejects.toThrow("Synthetic lost reply");
    expect(f.commands()).toBe(1);
    expect(f.row()).toEqual({ singleton: 1, enabled: 1, verified_at: AT });
    expect(f.logs).toEqual([]);
    expect(readdirSync(f.root)).toEqual([]);
  } finally { f.close(); }
});

test("output failure preserves the committed observation and completed cleanup", async () => {
  const f = fixture();
  try {
    await expect(renewPrivateIntake({ ...f.options, fetchImpl: async () => Response.json({ enabled: true }), log: () => {
      throw new Error("Synthetic output failure");
    } })).rejects.toThrow("Synthetic output failure");
    expect(f.commands()).toBe(1);
    expect(f.row()).toEqual({ singleton: 1, enabled: 1, verified_at: AT });
    expect(readdirSync(f.root)).toEqual([]);
  } finally { f.close(); }
});
