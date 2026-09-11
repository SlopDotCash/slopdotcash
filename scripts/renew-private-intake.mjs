/** Authenticated health renewal independent of application releases. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = process.env.GITHUB_TOKEN;
if (!token)
  throw new Error("Authenticated GitHub health check requires GITHUB_TOKEN");
const response = await fetch(
  "https://api.github.com/repos/SlopDotCash/slopdotcash/private-vulnerability-reporting",
  {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  },
);
if (!response.ok)
  throw new Error(`Private reporting check failed: HTTP ${response.status}`);
const status = await response.json();
if (typeof status.enabled !== "boolean")
  throw new Error("Invalid private reporting response");
const verifiedAt = new Date().toISOString();
const directory = mkdtempSync(join(tmpdir(), "slop-intake-"));
try {
  const file = join(directory, "status.sql");
  writeFileSync(
    file,
    `INSERT INTO private_intake_status(singleton, enabled, verified_at) VALUES (1, ${status.enabled ? 1 : 0}, '${verifiedAt}') ON CONFLICT(singleton) DO UPDATE SET enabled=excluded.enabled, verified_at=excluded.verified_at WHERE excluded.verified_at > private_intake_status.verified_at;\n`,
  );
  execFileSync(
    "./node_modules/.bin/wrangler",
    [
      "d1",
      "execute",
      "slop-private",
      "--remote",
      "--config",
      "wrangler.toml",
      "--file",
      file,
    ],
    { stdio: "inherit" },
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ enabled: status.enabled, verifiedAt }));
if (!status.enabled)
  throw new Error(
    "Private reporting is disabled; optional trace uploads are stopped",
  );
