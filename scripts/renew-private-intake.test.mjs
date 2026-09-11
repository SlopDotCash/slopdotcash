import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("renews independently, records disabled reporting, and never refreshes a failed observation", () => {
  const root = mkdtempSync(join(tmpdir(), "slop-intake-renewal-"));
  try {
    const db = join(root, "health.db");
    execFileSync(
      "python3",
      [
        "-c",
        "import sqlite3,sys; sqlite3.connect(sys.argv[1]).executescript(sys.stdin.read())",
        db,
      ],
      { input: readFileSync("migrations/0006_private_intake_status.sql") },
    );
    const bin = join(root, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "wrangler"),
      `#!/usr/bin/env node
const {execFileSync} = require("node:child_process");
const {readFileSync} = require("node:fs");
const file=process.argv[process.argv.indexOf("--file")+1];
execFileSync("python3", ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.stdin.read()); c.commit()", process.env.FIXTURE_DB], {input:readFileSync(file)});
`,
      { mode: 0o755 },
    );
    const fixture = join(root, "fetch.mjs");
    writeFileSync(
      fixture,
      `globalThis.fetch = async (_url, options) => {
if(options.headers.Authorization !== "Bearer synthetic-fixture") throw new Error("Missing authentication");
return new Response(JSON.stringify({ enabled: process.env.DISABLED !== "1" }), { status: process.env.OUTAGE ? 503 : 200 });
};`,
    );
    const run = (extra = {}) =>
      spawnSync(
        "node",
        ["--import", fixture, resolve("scripts/renew-private-intake.mjs")],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            GITHUB_TOKEN: "synthetic-fixture",
            FIXTURE_DB: db,
            ...extra,
          },
        },
      );
    const read = () =>
      JSON.parse(
        execFileSync(
          "python3",
          [
            "-c",
            "import sqlite3,json,sys; print(json.dumps(sqlite3.connect(sys.argv[1]).execute('SELECT enabled, verified_at FROM private_intake_status').fetchone()))",
            db,
          ],
          { encoding: "utf8" },
        ),
      );
    const healthy = run();
    expect(healthy.status, healthy.stderr).toBe(0);
    const observed = read();
    expect(observed[0]).toBe(1);
    expect(run({ OUTAGE: "1" }).status).not.toBe(0);
    expect(read()).toEqual(observed);
    expect(run({ DISABLED: "1" }).status).not.toBe(0);
    expect(read()[0]).toBe(0);
    expect(healthy.stdout).not.toContain("synthetic-fixture");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
