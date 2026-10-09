/**
 * Runs the complete browser matrix against the stable built-site preview and,
 * at the same time, checks redirects, artifacts, and contributor API access
 * with Pages headers. Wrangler can terminate during long browser sessions on
 * constrained hosted runners, while that focused check still exercises the
 * behavior only Pages supplies instead of replacing it with a generic
 * static-server assertion. Each phase owns its own port and output folder, so
 * the two phases run concurrently and neither can serve the other's bytes.
 */

import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnvironment } from "./child-environment.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playwright = join(packageRoot, "node_modules", ".bin", "playwright");
function runSync(command, args) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    env: childEnvironment(),
    stdio: "inherit",
    timeout: 40 * 60_000,
    killSignal: "SIGKILL",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function prefixLines(stream, label, output) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) output.write(`[${label}] ${line}\n`);
  });
  stream.on("end", () => {
    if (pending) output.write(`[${label}] ${pending}\n`);
  });
}

function runPhase(label, server, port, args) {
  return new Promise((resolvePhase) => {
    const child = spawn(playwright, ["test", ...args], {
      cwd: packageRoot,
      env: {
        ...childEnvironment(),
        SLOP_E2E_PREBUILT: "1",
        SLOP_E2E_FORCE_FRESH_SERVER: "1",
        SLOP_E2E_SERVER: server,
        SLOP_E2E_PORT: port,
        ...(process.env.SLOP_E2E_WORKERS
          ? { SLOP_E2E_WORKERS: process.env.SLOP_E2E_WORKERS }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 40 * 60_000);
    prefixLines(child.stdout, label, process.stdout);
    prefixLines(child.stderr, label, process.stderr);
    child.on("error", (error) => {
      clearTimeout(timer);
      process.stderr.write(`[${label}] ${error.message}\n`);
      resolvePhase(1);
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      if (signal) process.stderr.write(`[${label}] terminated by ${signal}\n`);
      resolvePhase(status ?? 1);
    });
  });
}

// Releases must exercise the online build without regenerating its journal.
if (process.env.SLOP_E2E_PREBUILT !== "1") runSync("bun", ["run", "build"]);
runSync("node", ["scripts/dist-manifest.mjs", "verify-local", "dist"]);

// The preview phase binds the base port and Pages binds the next one.
const basePort = Number(process.env.SLOP_E2E_PORT ?? "4466");
if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65534) {
  throw new TypeError(`Invalid SLOP_E2E_PORT: ${process.env.SLOP_E2E_PORT}`);
}
const extraArgs = process.argv.slice(2);
const statuses = await Promise.all([
  runPhase("preview", "preview", String(basePort), [
    "--grep-invert",
    "@pages-only",
    ...extraArgs,
  ]),
  runPhase("pages", "pages", String(basePort + 1), [
    "--project=wide-desktop-chromium",
    "--grep",
    "@pages",
    ...extraArgs,
  ]),
]);
const failed = statuses.find((status) => status !== 0);
if (failed !== undefined) process.exit(failed);
