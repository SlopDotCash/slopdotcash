/** Authenticated health renewal independent of application releases. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedJson } from "../src/lib/browser-json.ts";

export const PRIVATE_INTAKE_STATUS_URL =
  "https://api.github.com/repos/SlopDotCash/slopdotcash/private-vulnerability-reporting";
const MAX_STATUS_BYTES = 64 * 1024;

/**
 * One observation and one monotonic D1 write; failures never retry the command.
 * @param {object} [options]
 * @param {string} [options.token]
 * @param {(url: string, init: RequestInit) => Promise<Response>} [options.fetchImpl]
 * @param {() => Date} [options.now]
 * @param {(file: string, args: readonly string[], options: {stdio: "inherit"}) => unknown} [options.execute]
 * @param {string} [options.temporaryRoot]
 * @param {(line: string) => void} [options.log]
 */
export async function renewPrivateIntake({
  token = process.env.GITHUB_TOKEN,
  fetchImpl = fetch,
  now = () => new Date(),
  execute = execFileSync,
  temporaryRoot = tmpdir(),
  log = console.log,
} = {}) {
  if (!token)
    throw new Error("Authenticated GitHub health check requires GITHUB_TOKEN");
  const response = await fetchImpl(PRIVATE_INTAKE_STATUS_URL, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // Keep the provider refusal if disposing its response also fails.
    }
    throw new Error(`Private reporting check failed: HTTP ${response.status}`);
  }
  const status = await readBoundedJson(
    response,
    MAX_STATUS_BYTES,
    "Private reporting response",
  );
  if (
    typeof status !== "object" ||
    status === null ||
    Array.isArray(status) ||
    typeof status.enabled !== "boolean"
  )
    throw new Error("Invalid private reporting response");
  const verifiedAt = now().toISOString();
  const directory = mkdtempSync(join(temporaryRoot, "slop-intake-"));
  try {
    const file = join(directory, "status.sql");
    writeFileSync(
      file,
      `INSERT INTO private_intake_status(singleton, enabled, verified_at) VALUES (1, ${status.enabled ? 1 : 0}, '${verifiedAt}') ON CONFLICT(singleton) DO UPDATE SET enabled=excluded.enabled, verified_at=excluded.verified_at WHERE excluded.verified_at > private_intake_status.verified_at;\n`,
      { mode: 0o600 },
    );
    execute(
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
  const observation = { enabled: status.enabled, verifiedAt };
  // This records the provider observation after a successful command. An
  // already-newer D1 observation remains authoritative under the SQL guard.
  log(JSON.stringify(observation));
  if (!status.enabled)
    throw new Error(
      "Private reporting is disabled; optional trace uploads are stopped",
    );
  return observation;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await renewPrivateIntake();
}
