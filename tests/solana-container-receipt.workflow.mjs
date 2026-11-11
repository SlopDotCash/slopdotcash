/** Real container, with a controlled pause only at the final receipt write. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = process.env.SLOP_SOLANA_CONTAINER_RUNTIME;
assert.ok(runtime === "docker" || runtime === "podman");
const bun = (await exec("which", ["bun"])).stdout.trim();
const directory = resolve(
  process.env.SLOP_CONTAINER_RECEIPT_EVIDENCE ??
    `evidence/formal/container-receipt-${randomUUID()}`,
);
await mkdir(directory, { recursive: true });
const receiptPath = join(directory, "receipt.json");
const blocked = join(directory, "blocked");
const release = join(directory, "release");
const returned = join(directory, "returned.json");
const target = join(directory, "child.mjs");
const port = Number(process.env.SLOP_CONTAINER_RECEIPT_PORT ?? 18560);
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );
async function until(predicate) {
  const end = Date.now() + 90_000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await sleep(20);
  }
  throw new Error("Timed out at the receipt write boundary");
}
// The native engine, binary, HTTP readiness and cleanup remain real. Only the
// timing of the final filesystem write is controlled, through Bun's mock API.
await writeFile(
  target,
  `import { mock } from "bun:test";
import * as fs from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
const write = fs.writeFile;
mock.module("node:fs/promises", () => ({ ...fs, writeFile: async (path, bytes, options) => {
  if (path === ${JSON.stringify(receiptPath)} && String(bytes).includes('"state": "ready"')) {
    await write(${JSON.stringify(blocked)}, "blocked");
    while (!(await fs.access(${JSON.stringify(release)}).then(() => true, () => false))) await sleep(10);
  }
  return write(path, bytes, options);
}}));
const { startLocalSolanaValidator } = await import(${JSON.stringify(join(root, "scripts/local-solana-validator.mjs"))});
const fixture = await startLocalSolanaValidator({ runtime: ${JSON.stringify(runtime)}, rpcPort: ${port},
  args: ["--reset", "--quiet", "--ticks-per-slot", "8", "--ledger", "/tmp/slop-receipt-cancel", "--rpc-port", "${port}", "--faucet-port", "${port + 41}", "--dynamic-port-range", "${port + 2}-${port + 31}", "--bind-address", "127.0.0.1"],
  receiptPath: ${JSON.stringify(receiptPath)}, stdio: "ignore" });
await write(${JSON.stringify(returned)}, JSON.stringify({ state: fixture.receipt.state }));
await new Promise(() => {});
`,
);
const child = spawn(bun, [target], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (bytes) => {
    log += bytes;
  });
try {
  await until(() => exists(blocked));
  child.kill("SIGTERM");
  await sleep(150);
  await writeFile(release, "release");
  await until(() => child.exitCode !== null || child.signalCode !== null);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(
    await exists(returned),
    false,
    "A canceled ready write must not return an instance",
  );
  assert.equal(
    receipt.state,
    "stopped",
    "A ready write must not overwrite terminal cleanup",
  );
  const found = await exec(runtime, [
    ...receipt.runtimeArguments,
    "ps",
    "-aq",
    "--filter",
    `name=^${receipt.name}$`,
  ]);
  assert.equal(found.stdout.trim(), "");
  console.log(
    "ready receipt: cancellation refused return, terminal receipt retained, owned container removed",
  );
} finally {
  await writeFile(release, "release");
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await until(() => child.exitCode !== null || child.signalCode !== null);
  }
  await writeFile(join(directory, "child.log"), log);
}
