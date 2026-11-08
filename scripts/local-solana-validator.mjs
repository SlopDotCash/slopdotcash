/** Pinned disposable validator, contained behind explicitly loopback-published ports. */
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { childEnvironment } from "./child-environment.mjs";

const exec = promisify(execFile);
export const SOLANA_TEST_IMAGE =
  "docker.io/anzaxyz/agave@sha256:45eee2ce535d1c72e68637172ea506ac33a7178c86cd6453159e6d7cede13b6f";
export const SOLANA_TEST_BINARY_SHA256 =
  "06b6f43f0705e01dd34a5569b1ef08cee8e902db5f77b0fe04b721ad5e71fff0";
const OWNER_LABEL = "org.slop.validator-fixture";
const active = new Set();
let stopping = false;

async function stopOnSignal(signal) {
  if (stopping) return;
  stopping = true;
  const results = await Promise.allSettled([...active].map((close) => close()));
  for (const result of results) {
    if (result.status === "rejected") console.error(result.reason);
  }
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onTerminate);
  process.kill(process.pid, signal);
}
const onInterrupt = () => void stopOnSignal("SIGINT");
const onTerminate = () => void stopOnSignal("SIGTERM");

async function portAcceptsConnections(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Validator port state could not be established"));
    });
  });
}

async function localRuntime(name) {
  if (name !== "docker" && name !== "podman")
    throw new Error("Select docker or podman for the local Solana container");
  const run = async (args) =>
    (
      await exec(name, args, {
        env: childEnvironment(),
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      })
    ).stdout.trim();
  if (name === "docker") {
    const contexts = JSON.parse(await run(["context", "inspect"]));
    const current = contexts[0];
    if (!current?.Endpoints?.docker?.Host?.startsWith("unix://"))
      throw new Error("The Docker context must use a local Unix socket");
    const prefix = ["--context", current.Name];
    return { name, prefix, run: (args) => run([...prefix, ...args]) };
  }
  const connections = JSON.parse(
    await run(["system", "connection", "list", "--format", "json"]),
  );
  const current = connections.find((entry) => entry.Default);
  if (current) {
    const url = new URL(current.URI);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      url.protocol !== "unix:"
    )
      throw new Error("The Podman connection must target this machine");
    const prefix = ["--connection", current.Name];
    return { name, prefix, run: (args) => run([...prefix, ...args]) };
  }
  if (process.platform !== "linux")
    throw new Error("No local Podman connection is configured");
  return { name, prefix: [], run };
}

/**
 * Starts the exact 2.1.21 Linux image without mounting the caller's ledger.
 * Additional fixture files must be declared as read-only mounts. No host path
 * is mounted implicitly. Explicit clone arguments retain their read-only
 * upstream RPC semantics; containment does not restrict outbound networking.
 * Catchable termination stops only this instance. SIGKILL/VM loss may leave an
 * owned container; its unique name and ownership label remain in the receipt.
 */
export async function startLocalSolanaValidator({
  args,
  rpcPort,
  runtime = process.env.SLOP_SOLANA_CONTAINER_RUNTIME ?? "docker",
  readonlyMounts = [],
  stdio = ["ignore", "inherit", "inherit"],
  receiptPath,
}) {
  if (!Number.isSafeInteger(rpcPort) || rpcPort < 1024 || rpcPort > 65534)
    throw new Error("Invalid local validator RPC port");
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string"))
    throw new Error("Validator arguments must be strings");
  const portIndex = args.indexOf("--rpc-port");
  const ledgerIndex = args.indexOf("--ledger");
  if (
    portIndex < 0 ||
    args[portIndex + 1] !== String(rpcPort) ||
    args.filter((arg) => arg === "--rpc-port").length !== 1 ||
    ledgerIndex < 0 ||
    !args[ledgerIndex + 1] ||
    args.filter((arg) => arg === "--ledger").length !== 1
  )
    throw new Error(
      "Validator arguments must bind the requested RPC port and one ledger",
    );
  const effectiveArgs = [...args];
  effectiveArgs[ledgerIndex + 1] = "/tmp/slop-validator-ledger";
  const mounts = [];
  for (const path of readonlyMounts) {
    if (!isAbsolute(path) || path === "/" || path.includes(","))
      throw new Error("Declare an absolute fixture file or directory mount");
    mounts.push({ source: await realpath(path), target: path, readOnly: true });
  }
  const engine = await localRuntime(runtime);
  // This inspects the local image only. Setup must pull the reviewed digest.
  const image = JSON.parse(
    await engine.run(["image", "inspect", SOLANA_TEST_IMAGE]),
  )[0];
  if (image.Architecture !== "amd64" || image.Os !== "linux")
    throw new Error("The pinned validator image has an unexpected platform");
  const owner = randomUUID();
  const name = `slop-solana-test-${owner}`;
  const record = {
    schemaVersion: 1,
    name,
    owner,
    runtime: engine.name,
    runtimeArguments: engine.prefix,
    image: SOLANA_TEST_IMAGE,
    imageId: image.Id,
    platform: "linux/amd64",
    originalArgs: args,
    effectiveArgs,
    mounts,
    publishedPorts: [rpcPort, rpcPort + 1].map((port) => ({
      host: "127.0.0.1",
      hostPort: port,
      containerPort: port,
    })),
    state: "prepared",
  };
  const save = async () => {
    if (!receiptPath) return;
    await mkdir(dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
    });
  };
  await save();
  const createCommand = [
    "create",
    "--pull=never",
    "--platform",
    "linux/amd64",
    "--name",
    name,
    "--label",
    `${OWNER_LABEL}=${owner}`,
    ...record.publishedPorts.flatMap(({ host, hostPort, containerPort }) => [
      "--publish",
      `${host}:${hostPort}:${containerPort}/tcp`,
    ]),
    ...mounts.flatMap(({ source, target }) => [
      "--mount",
      `type=bind,source=${source},destination=${target},readonly`,
    ]),
    "--entrypoint",
    "/usr/bin/solana-test-validator",
    SOLANA_TEST_IMAGE,
    ...effectiveArgs,
  ];
  record.createCommand = [engine.name, ...engine.prefix, ...createCommand];
  record.startCommand = [engine.name, ...engine.prefix, "start", name];
  record.attachCommand = [
    engine.name,
    ...engine.prefix,
    "attach",
    "--sig-proxy=false",
    name,
  ];
  // A client timeout is not proof that the engine discarded its request.
  // Keep every mutating request settled (or explicitly unknown) before cleanup.
  const mutations = [];
  const mutate = (command) => {
    const result = engine.run(command).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
    mutations.push(result);
    return result;
  };
  let child;
  let spawnError;
  let closing;
  const inspectOwned = async () => {
    const ids = await engine.run(["ps", "-aq", "--filter", `name=^${name}$`]);
    if (!ids) return null;
    const found = JSON.parse(await engine.run(["inspect", name]))[0];
    if (found.Config?.Labels?.[OWNER_LABEL] !== owner)
      throw new Error(
        "Refusing to stop a validator container owned by another run",
      );
    return found;
  };
  const close = () => {
    closing ??= (async () => {
      const errors = [];
      const recordState = async () => {
        try {
          await save();
        } catch (error) {
          errors.push(error);
        }
      };
      record.state = "stopping";
      await recordState();
      let completionUnknown = false;
      for (const mutation of mutations) {
        const result = await mutation;
        if (!result.ok) {
          completionUnknown = true;
          errors.push(result.error);
        }
      }
      try {
        const found = await inspectOwned();
        if (found) {
          if (found.State?.Running)
            await engine.run(["stop", "--time", "5", name]).catch(() => {
              record.forcedRemovalNeeded = true;
            });
          if (await inspectOwned()) await engine.run(["rm", "--force", name]);
        }
        if (await inspectOwned())
          throw new Error("The owned validator container remains");
        for (const { hostPort } of record.publishedPorts) {
          let open = true;
          for (let attempt = 0; attempt < 10 && open; attempt++) {
            open = await portAcceptsConnections(hostPort);
            if (open) await new Promise((resolve) => setTimeout(resolve, 100));
          }
          if (open)
            throw new Error(
              "A validator port remains open after container removal",
            );
        }
        if (completionUnknown)
          throw new Error(
            "A container mutation did not acknowledge completion",
          );
        record.state = "stopped";
      } catch (error) {
        record.state = "cleanup-unknown";
        errors.push(error);
      }
      await recordState();
      active.delete(close);
      if (active.size === 0) {
        process.removeListener("SIGINT", onInterrupt);
        process.removeListener("SIGTERM", onTerminate);
      }
      if (errors.length)
        throw new AggregateError(
          errors,
          `Validator cleanup or its receipt failed: ${name} (${OWNER_LABEL}=${owner})`,
        );
    })();
    return closing;
  };
  if (active.size === 0) {
    stopping = false;
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTerminate);
  }
  active.add(close);
  try {
    record.state = "creating";
    await save();
    if (closing) throw new Error("Validator startup was canceled");
    const created = await mutate(createCommand);
    if (!created.ok) throw created.error;
    // Cancellation while create was pending owns a stopped container, and
    // must remove it without ever starting the validator.
    if (closing) throw new Error("Validator startup was canceled");
    record.state = "created";
    await save();
    if (closing) throw new Error("Validator startup was canceled");
    const started = await mutate(["start", name]);
    if (!started.ok) throw started.error;
    if (closing) throw new Error("Validator startup was canceled");
    child = spawn(
      engine.name,
      [...engine.prefix, "attach", "--sig-proxy=false", name],
      {
        env: childEnvironment(),
        stdio,
      },
    );
    child.on("error", (error) => {
      spawnError = error;
    });
    const until = Date.now() + 60_000;
    let version;
    while (Date.now() < until) {
      if (closing) throw new Error("Validator startup was canceled");
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(
          "The disposable validator container stopped during startup",
        );
      const found = await inspectOwned();
      if (found?.State?.Running) {
        for (const { hostPort, containerPort } of record.publishedPorts) {
          const bindings =
            found.NetworkSettings?.Ports?.[`${containerPort}/tcp`];
          if (
            bindings?.length !== 1 ||
            bindings[0].HostIp !== "127.0.0.1" ||
            bindings[0].HostPort !== String(hostPort)
          )
            throw new Error(
              "The validator port is not published only on IPv4 loopback",
            );
        }
        try {
          const response = await fetch(`http://127.0.0.1:${rpcPort}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "getVersion",
            }),
            signal: AbortSignal.timeout(2_000),
          });
          const body = await response.json();
          if (body.result?.["solana-core"] === "2.1.21") {
            version = body.result;
            break;
          }
          if (body.result)
            throw new Error("The validator reported the wrong version");
        } catch (error) {
          if (String(error).includes("wrong version")) throw error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!version)
      throw new Error("The disposable validator did not become ready");
    const binary = await engine.run([
      "exec",
      name,
      "/usr/bin/solana-test-validator",
      "--version",
    ]);
    const digest = await engine.run([
      "exec",
      name,
      "/usr/bin/sha256sum",
      "/usr/bin/solana-test-validator",
    ]);
    if (
      !binary.startsWith("solana-test-validator 2.1.21 ") ||
      digest.split(/\s/u)[0] !== SOLANA_TEST_BINARY_SHA256
    )
      throw new Error("The validator binary does not match the reviewed image");
    if (closing) throw new Error("Validator startup was canceled");
    record.state = "ready";
    record.version = version;
    record.binary = binary;
    record.binarySha256 = SOLANA_TEST_BINARY_SHA256;
    await save();
    return { process: child, close, receipt: record };
  } catch (error) {
    if (closing) {
      await close();
      throw error;
    }
    record.state = "refused";
    record.refusal = String(error);
    const errors = [error];
    try {
      await save();
    } catch (receiptError) {
      errors.push(receiptError);
    }
    try {
      await close();
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
    if (errors.length > 1)
      throw new AggregateError(
        errors,
        `Validator startup and cleanup failed: ${name} (${OWNER_LABEL}=${owner})`,
      );
    throw new Error(
      `Validator startup failed: ${name} (${OWNER_LABEL}=${owner})`,
      { cause: error },
    );
  }
}

// Optional CLI adapter for existing shell-based local validator workflows.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const input = process.argv.slice(2);
  const separator = input.indexOf("--");
  const wrapperArgs = separator < 0 ? [] : input.slice(0, separator);
  const args = separator < 0 ? input : input.slice(separator + 1);
  const readonlyMounts = [];
  for (let i = 0; i < wrapperArgs.length; i += 2) {
    if (wrapperArgs[i] !== "--readonly-mount" || !wrapperArgs[i + 1])
      throw new Error(
        "Use --readonly-mount <path> before -- for explicit fixture mounts",
      );
    readonlyMounts.push(wrapperArgs[i + 1]);
  }
  const index = args.indexOf("--rpc-port");
  const fixture = await startLocalSolanaValidator({
    args,
    rpcPort: Number(args[index + 1]),
    readonlyMounts,
    receiptPath: process.env.SLOP_SOLANA_CONTAINER_RECEIPT,
  });
  console.log(`Local Solana validator ready: ${fixture.receipt.name}`);
  if (fixture.process.exitCode === null && fixture.process.signalCode === null)
    await new Promise((resolve) => fixture.process.once("exit", resolve));
  await fixture.close();
  if (fixture.process.exitCode) process.exitCode = fixture.process.exitCode;
}
