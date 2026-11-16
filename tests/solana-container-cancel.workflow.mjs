/** Real engine qualification. Requires the reviewed image already installed. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = process.env.SLOP_SOLANA_CONTAINER_RUNTIME;
assert.ok(
  runtime === "docker" || runtime === "podman",
  "Select the local container runtime explicitly",
);
const realRuntime = (await exec("which", [runtime])).stdout.trim();
const output = resolve(
  process.env.SLOP_CONTAINER_CANCEL_EVIDENCE ??
    `evidence/formal/container-cancel-${randomUUID()}`,
);
const port = Number(process.env.SLOP_CONTAINER_CANCEL_PORT ?? 18540);
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );
async function until(predicate) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await sleep(50);
  }
  throw new Error("Timed out waiting for the local container request");
}
function listening(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
  });
}

for (const command of ["create", "start"]) {
  const directory = join(output, command);
  await mkdir(directory, { recursive: true });
  const pending = join(directory, "pending.json");
  const release = join(directory, "release");
  const receiptPath = join(directory, "receipt.json");
  // Delay a real engine request, not a simulated engine response. The shim
  // remains alive after SIGTERM to the parent, just like a queued daemon call.
  await writeFile(
    join(directory, runtime),
    `#!${process.execPath}
import { spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
const args = process.argv.slice(2);
if (args.includes(${JSON.stringify(command)})) {
  await writeFile(${JSON.stringify(pending)}, JSON.stringify({ pid: process.pid, args }));
  while (!(await access(${JSON.stringify(release)}).then(() => true, () => false))) await sleep(50);
}
const child = spawn(${JSON.stringify(realRuntime)}, args, { stdio: "inherit" });
child.on("error", () => { process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
`,
    { mode: 0o700 },
  );
  const child = spawn(
    process.execPath,
    [
      join(root, "scripts/local-solana-validator.mjs"),
      "--",
      "--reset",
      "--quiet",
      "--ticks-per-slot",
      "8",
      "--ledger",
      join(directory, "ledger"),
      "--rpc-port",
      String(port),
      "--faucet-port",
      String(port + 41),
      "--dynamic-port-range",
      `${port + 2}-${port + 31}`,
      "--bind-address",
      "127.0.0.1",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        SLOP_SOLANA_CONTAINER_RECEIPT: receiptPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (bytes) => {
      log += bytes;
    });
  let receipt;
  try {
    await until(() => exists(pending));
    child.kill("SIGTERM");
    await sleep(600);
    assert.equal(
      child.exitCode,
      null,
      "Cancellation must wait for the pending request",
    );
    assert.equal(
      child.signalCode,
      null,
      "Cancellation must not claim early removal",
    );
    await writeFile(release, "release");
    await until(() => child.exitCode !== null || child.signalCode !== null);
    receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(receipt.state, "stopped");
    assert.equal(
      (
        await exec(realRuntime, [
          "ps",
          "-aq",
          "--filter",
          `name=^${receipt.name}$`,
        ])
      ).stdout.trim(),
      "",
    );
    assert.equal(await listening(port), false);
    assert.equal(await listening(port + 1), false);
    console.log(
      `${command}: cancellation waited, owned container removed, both host ports closed`,
    );
  } finally {
    await writeFile(release, "release");
    await until(
      () => child.exitCode !== null || child.signalCode !== null,
    ).catch(() => {});
    await writeFile(join(directory, "launcher.log"), log);
    // Only our receipt-bound resource can be removed after a failed assertion.
    receipt ??= await readFile(receiptPath, "utf8").then(
      JSON.parse,
      () => null,
    );
    if (receipt) {
      const found = await exec(realRuntime, ["inspect", receipt.name]).then(
        (r) => JSON.parse(r.stdout)[0],
        () => null,
      );
      if (
        found?.Config?.Labels?.["org.slop.validator-fixture"] === receipt.owner
      )
        await exec(realRuntime, ["rm", "--force", receipt.name]);
    }
  }
}
