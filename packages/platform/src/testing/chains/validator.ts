// spec/operations/localValidator.md, "Story: Run tests only against the validator owned by the current stage"; spec/operations/localValidator.md, "The awaited stop and its exact receipt settle cleanup"
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, open, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { childEnvironment, portsFree, rpc, supervised } from "./faults.ts";

export const SOLANA_TEST_IMAGE = "docker.io/anzaxyz/agave@sha256:45eee2ce535d1c72e68637172ea506ac33a7178c86cd6453159e6d7cede13b6f";
export const SOLANA_TEST_BINARY_SHA256 = "06b6f43f0705e01dd34a5569b1ef08cee8e902db5f77b0fe04b721ad5e71fff0";
export const SOLANA_TEST_VERSION = "2.1.21";

export interface ValidatorOptions {
  readonly programs?: ReadonlyArray<{ readonly id: string; readonly soPath: string }>;
  readonly upgradeablePrograms?: ReadonlyArray<{ readonly id: string; readonly soPath: string; readonly upgradeAuthority: string }>;
  readonly accounts?: ReadonlyArray<{ readonly address: string; readonly jsonPath: string }>;
  readonly rpcPort?: number;
}

export interface ProgramBuild extends AsyncDisposable {
  readonly out: string;
  close(): Promise<void>;
}

export interface Payer {
  readonly address: string;
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
}

export interface ValidatorReceipt {
  readonly owner: string;
  readonly runner: "path" | "docker";
  readonly version: string;
  readonly binarySha256?: string;
  readonly ports: ReadonlyArray<number>;
}

export interface Validator extends AsyncDisposable {
  readonly family: "solana";
  readonly url: string;
  readonly genesis: string;
  readonly payer: Payer;
  readonly receipt: ValidatorReceipt;
  rpc(method: string, params?: ReadonlyArray<unknown>): Promise<unknown>;
  airdrop(address: string, lamports: bigint): Promise<string>;
  warpSlot(slot: bigint): Promise<bigint>;
  close(): Promise<void>;
}

interface Runner {
  readonly kind: "path" | "docker";
  start(args: ReadonlyArray<string>): Promise<void>;
  failure(): Promise<Error | undefined>;
  verify(): Promise<string | undefined>;
  stop(): Promise<void>;
  purge(): Promise<void>;
}

const exec = promisify(execFile);
const ownerLabel = "org.slop.validator-fixture";
const installHint = `install solana-test-validator ${SOLANA_TEST_VERSION} on PATH, or Docker with \`docker pull ${SOLANA_TEST_IMAGE}\``;
const sbfTools = "v1.52";
const payerLamports = 1_000_000_000_000_000;
const systemProgram = "11111111111111111111111111111111";
const sbfHint = `install the Agave ${SOLANA_TEST_VERSION} CLI so that \`cargo build-sbf\` is on PATH; it fetches platform tools ${sbfTools} on first use`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isPublicKey = (text: string) => {
  try {
    return base58.decode(text).length === 32;
  } catch {
    return false;
  }
};

async function pathVersion(): Promise<string | undefined> {
  try {
    return (await exec("solana-test-validator", ["--version"], { timeout: 30_000, env: childEnvironment() })).stdout.trim();
  } catch {
    return undefined;
  }
}

async function docker(args: ReadonlyArray<string>): Promise<string> {
  return (await exec("docker", [...args], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024, env: childEnvironment(["DOCKER_CONFIG"]) })).stdout.trim();
}

async function dockerContext(): Promise<ReadonlyArray<string>> {
  let contexts: unknown;
  try {
    contexts = JSON.parse(await docker(["context", "inspect"]));
  } catch {
    throw new Error(`Neither solana-test-validator ${SOLANA_TEST_VERSION} nor Docker is available: ${installHint}`);
  }
  const current = Array.isArray(contexts) ? contexts[0] : undefined;
  const host = isRecord(current) && isRecord(current.Endpoints) && isRecord(current.Endpoints.docker) ? current.Endpoints.docker.Host : undefined;
  if (!isRecord(current) || typeof current.Name !== "string" || typeof host !== "string" || !host.startsWith("unix://")) throw new Error("The Docker context must use a local Unix socket");
  return ["--context", current.Name];
}

const portRange = (base: number) => Array.from({ length: 42 }, (_, offset) => base + offset);

async function reservePorts(fixed: number | undefined): Promise<number> {
  if (fixed !== undefined) {
    if (!Number.isSafeInteger(fixed) || fixed < 1024 || fixed + 41 > 65_535) throw new RangeError(`Validator RPC port ${fixed} leaves no room for its 42-port range`);
    if (await portsFree(portRange(fixed))) return fixed;
    throw new Error(`The validator ports ${fixed}-${fixed + 41} are not free`);
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const base = 20_000 + Math.floor(Math.random() * 40_000);
    if (await portsFree(portRange(base))) return base;
  }
  throw new Error("No free loopback port range for the validator");
}

function pathRunner(directory: string): Runner {
  let child: ChildProcess | undefined;
  let spawnFailure: Error | undefined;
  return {
    kind: "path",
    start: async (args) => {
      const log = await open(join(directory, "validator.log"), "a", 0o600);
      spawnFailure = undefined;
      child = spawn("solana-test-validator", [...args, "--bind-address", "127.0.0.1"], { stdio: ["ignore", log.fd, log.fd], env: childEnvironment() });
      child.once("error", (error) => {
        spawnFailure = error;
      });
      child.once("close", () => void log.close());
    },
    failure: () => {
      if (spawnFailure !== undefined) return Promise.resolve(spawnFailure);
      if (child !== undefined && (child.exitCode !== null || child.signalCode !== null)) return Promise.resolve(new Error(`The local validator exited (${child.exitCode ?? child.signalCode})`));
      return Promise.resolve(undefined);
    },
    verify: () => Promise.resolve(undefined),
    stop: async () => {
      const running = child;
      if (running === undefined || running.exitCode !== null || running.signalCode !== null) return;
      const closed = new Promise<void>((resolve) => running.once("close", () => resolve()));
      running.kill("SIGTERM");
      await closed;
    },
    purge: () => Promise.resolve(undefined),
  };
}

async function dockerRunner(owner: string, rpcPort: number, mounts: ReadonlyArray<string>): Promise<Runner> {
  const context = await dockerContext();
  const run = (args: ReadonlyArray<string>) => docker([...context, ...args]);
  let image: unknown;
  try {
    image = JSON.parse(await run(["image", "inspect", SOLANA_TEST_IMAGE]));
  } catch {
    throw new Error(`The pinned validator image is not present: run \`docker pull ${SOLANA_TEST_IMAGE}\``);
  }
  const found = Array.isArray(image) ? image[0] : undefined;
  if (!isRecord(found) || found.Architecture !== "amd64" || found.Os !== "linux") throw new Error("The pinned validator image has an unexpected platform");
  const name = `slop-solana-test-${owner}`;
  const volume = `slop-solana-ledger-${owner}`;
  const bound = await Promise.all(mounts.map(async (path) => `type=bind,source=${await realpath(path)},destination=${path},readonly`));
  const ports = [rpcPort, rpcPort + 1];
  const owned = async () => {
    const id = await run(["ps", "-aq", "--filter", `name=^${name}$`]);
    if (id === "") return undefined;
    const inspected: unknown = JSON.parse(await run(["inspect", name]));
    const container = Array.isArray(inspected) ? inspected[0] : undefined;
    const labels = isRecord(container) && isRecord(container.Config) && isRecord(container.Config.Labels) ? container.Config.Labels : undefined;
    if (labels?.[ownerLabel] !== owner) throw new Error("Refusing to touch a validator container owned by another run");
    return container;
  };
  let volumeCreated = false;
  return {
    kind: "docker",
    start: async (args) => {
      if (!volumeCreated) await run(["volume", "create", "--label", `${ownerLabel}=${owner}`, volume]);
      volumeCreated = true;
      await run([
        "run", "--detach", "--pull=never", "--platform", "linux/amd64", "--name", name, "--label", `${ownerLabel}=${owner}`,
        ...ports.flatMap((port) => ["--publish", `127.0.0.1:${port}:${port}/tcp`]),
        "--mount", `type=volume,source=${volume},destination=/ledger`,
        ...bound.flatMap((mount) => ["--mount", mount]),
        "--entrypoint", "/usr/bin/solana-test-validator", SOLANA_TEST_IMAGE,
        ...args.map((arg) => (arg === "@ledger" ? "/ledger" : arg)),
      ]);
      const container = await owned();
      const published = isRecord(container) && isRecord(container.NetworkSettings) && isRecord(container.NetworkSettings.Ports) ? container.NetworkSettings.Ports : {};
      for (const port of ports) {
        const bindings = published[`${port}/tcp`];
        if (!Array.isArray(bindings) || bindings.length !== 1 || !isRecord(bindings[0]) || bindings[0].HostIp !== "127.0.0.1" || bindings[0].HostPort !== String(port)) {
          throw new Error("The validator port is not published only on IPv4 loopback");
        }
      }
    },
    failure: async () => {
      const container = await owned();
      const state = isRecord(container) && isRecord(container.State) ? container.State : undefined;
      return state?.Running === true ? undefined : new Error(`The validator container ${name} stopped during startup`);
    },
    verify: async () => {
      const binary = await run(["exec", name, "/usr/bin/solana-test-validator", "--version"]);
      const digest = (await run(["exec", name, "/usr/bin/sha256sum", "/usr/bin/solana-test-validator"])).split(/\s/u)[0];
      if (!binary.startsWith(`solana-test-validator ${SOLANA_TEST_VERSION} `) || digest !== SOLANA_TEST_BINARY_SHA256) throw new Error("The validator binary does not match the reviewed image");
      return digest;
    },
    stop: async () => {
      if ((await owned()) !== undefined) await run(["rm", "--force", name]);
      if ((await owned()) !== undefined) throw new Error(`The owned validator container ${name} remains`);
    },
    purge: async () => {
      if (volumeCreated) await run(["volume", "rm", "--force", volume]);
      volumeCreated = false;
    },
  };
}

async function ready(url: string, runner: Runner): Promise<string> {
  const until = Date.now() + 180_000;
  while (Date.now() < until) {
    const failed = await runner.failure();
    if (failed !== undefined) throw failed;
    const version = await rpc(url, "getVersion").catch(() => undefined);
    if (isRecord(version)) {
      if (version["solana-core"] !== SOLANA_TEST_VERSION) throw new Error(`The validator reported version ${String(version["solana-core"])}, not ${SOLANA_TEST_VERSION}`);
      const genesis = await rpc(url, "getGenesisHash").catch(() => undefined);
      if (typeof genesis === "string" && isPublicKey(genesis)) return genesis;
    }
    await sleep(250);
  }
  throw new Error("The local validator did not become ready within 180 seconds");
}

async function confirmed(url: string, signature: string): Promise<void> {
  for (let attempt = 0; attempt < 600; attempt++) {
    const statuses = await rpc(url, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
    const status = isRecord(statuses) && Array.isArray(statuses.value) ? statuses.value[0] : undefined;
    if (isRecord(status)) {
      if (status.err !== null) throw new Error(`Airdrop ${signature} failed: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === "finalized") return;
    }
    await sleep(200);
  }
  throw new Error(`Airdrop ${signature} was not finalized within 120 seconds`);
}

export async function solanaValidator(options: ValidatorOptions = {}): Promise<Validator> {
  const programs = options.programs ?? [];
  const upgradeable = options.upgradeablePrograms ?? [];
  const accounts = options.accounts ?? [];
  for (const { upgradeAuthority } of upgradeable) if (!isPublicKey(upgradeAuthority)) throw new RangeError(`Upgrade authority ${upgradeAuthority} is not a base58 public key`);
  for (const { id, soPath } of [...programs, ...upgradeable]) {
    if (!isPublicKey(id)) throw new RangeError(`Program id ${id} is not a base58 public key`);
    if (!isAbsolute(soPath)) throw new RangeError(`Program file ${soPath} must be an absolute path`);
  }
  for (const { address, jsonPath } of accounts) {
    if (!isPublicKey(address)) throw new RangeError(`Account ${address} is not a base58 public key`);
    if (!isAbsolute(jsonPath)) throw new RangeError(`Account file ${jsonPath} must be an absolute path`);
  }
  const files = [...programs.map(({ soPath }) => soPath), ...upgradeable.map(({ soPath }) => soPath), ...accounts.map(({ jsonPath }) => jsonPath)];
  for (const path of files) await access(path).catch(() => {
    throw new Error(`Validator fixture file not found: ${path}`);
  });
  const seed = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(seed);
  const payer: Payer = { address: base58.encode(publicKey), publicKey, secretKey: new Uint8Array([...seed, ...publicKey]) };
  const mint = base58.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
  const owner = randomUUID();
  const directory = await mkdtemp(join(tmpdir(), "slop-validator-"));
  const payerFile = join(directory, "payer.json");
  await writeFile(payerFile, JSON.stringify({ pubkey: payer.address, account: { lamports: payerLamports, data: ["", "base64"], owner: systemProgram, executable: false, rentEpoch: 0, space: 0 } }));
  const rpcPort = await reservePorts(options.rpcPort);
  const ports = [rpcPort, rpcPort + 1];
  const version = await pathVersion();
  const runner = version?.startsWith(`solana-test-validator ${SOLANA_TEST_VERSION} `)
    ? pathRunner(directory)
    : await dockerRunner(owner, rpcPort, [...files, payerFile]).catch(async (error: unknown) => {
      await rm(directory, { recursive: true, force: true });
      throw error;
    });
  const ledger = runner.kind === "path" ? join(directory, "ledger") : "@ledger";
  const args = [
    "--quiet", "--ledger", ledger, "--rpc-port", String(rpcPort), "--faucet-port", String(rpcPort + 41),
    "--dynamic-port-range", `${rpcPort + 2}-${rpcPort + 31}`, "--ticks-per-slot", "8", "--mint", mint,
    "--account", payer.address, payerFile,
    ...programs.flatMap(({ id, soPath }) => ["--bpf-program", id, soPath]),
    ...upgradeable.flatMap(({ id, soPath, upgradeAuthority }) => ["--upgradeable-program", id, soPath, upgradeAuthority]),
    ...accounts.flatMap(({ address, jsonPath }) => ["--account", address, jsonPath]),
  ];
  const url = `http://127.0.0.1:${rpcPort}`;
  const released = async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await portsFree(ports)) return true;
      await sleep(100);
    }
    return false;
  };
  const halt = async () => {
    await runner.stop();
    if (!(await released())) throw new Error(`Validator ports ${ports.join(", ")} remain open after stop`);
  };
  const close = supervised(async () => {
    try {
      await halt();
      await runner.purge();
    } catch (error) {
      throw new AggregateError([error], `Validator cleanup failed; kept ${directory} (${ownerLabel}=${owner}, ports ${ports.join(", ")})`, { cause: error });
    }
    await rm(directory, { recursive: true, force: true });
  });
  const boot = async (start: ReadonlyArray<string>) => {
    await runner.start(start);
    const genesis = await ready(url, runner);
    return { genesis, binarySha256: await runner.verify() };
  };
  const call = (method: string, params: ReadonlyArray<unknown> = []) => rpc(url, method, params);
  const slot = async () => {
    const current = await call("getSlot", [{ commitment: "processed" }]);
    if (typeof current !== "number" || !Number.isSafeInteger(current)) throw new Error("getSlot answered no slot");
    return BigInt(current);
  };
  try {
    const { genesis, binarySha256 } = await boot(["--reset", ...args]);
    return {
      family: "solana",
      url,
      genesis,
      payer,
      receipt: { owner, runner: runner.kind, version: SOLANA_TEST_VERSION, ...(binarySha256 === undefined ? {} : { binarySha256 }), ports },
      rpc: call,
      airdrop: async (address, lamports) => {
        if (!isPublicKey(address)) throw new RangeError(`${address} is not a base58 public key`);
        if (lamports < 1n || lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`Invalid airdrop of ${lamports} lamports`);
        const signature = await call("requestAirdrop", [address, Number(lamports), { commitment: "finalized" }]);
        if (typeof signature !== "string") throw new Error("requestAirdrop answered no signature");
        await confirmed(url, signature);
        return signature;
      },
      warpSlot: async (target) => {
        const before = await slot();
        if (target <= before) throw new RangeError(`Warp slot ${target} is not after the current slot ${before}`);
        const snapshotAt = (before / 100n + 1n) * 100n;
        const waitUntil = Date.now() + 120_000;
        while (Date.now() < waitUntil) {
          const current = await slot();
          if (current >= snapshotAt) {
            if (runner.kind !== "path") {
              await sleep(1_000);
              break;
            }
            const entries = await readdir(ledger).catch(() => []);
            const persisted = entries.some((name) => {
              const match = /^snapshot-(\d+)-/u.exec(name);
              return match !== null && BigInt(match[1] ?? "0") >= before;
            });
            if (persisted) break;
          }
          await sleep(250);
        }
        await halt();
        const restarted = await boot([...args, "--warp-slot", String(target)]);
        if (restarted.genesis !== genesis) throw new Error(`The warped validator answered genesis ${restarted.genesis}, not ${genesis}`);
        if (restarted.binarySha256 !== binarySha256) throw new Error("The warped validator binary differs from the one started");
        const after = await slot();
        if (after < target) throw new Error(`The validator answered slot ${after} after warping to ${target}`);
        return after;
      },
      close,
      [Symbol.asyncDispose]: close,
    };
  } catch (error) {
    await close().catch((cleanup: unknown) => {
      throw new AggregateError([error, cleanup], `Validator startup and cleanup failed (${ownerLabel}=${owner})`);
    });
    throw error;
  }
}

export async function sbfBuild(root: string, manifest: string): Promise<ProgramBuild> {
  const directory = await mkdtemp(join(tmpdir(), "slop-sbf-"));
  const close = supervised(() => rm(directory, { recursive: true, force: true }));
  try {
    await exec("cargo", ["build-sbf", "--manifest-path", join(root, manifest), "--tools-version", sbfTools, "--sbf-out-dir", directory, "--", "--locked"], {
      cwd: root,
      env: { ...childEnvironment(["CARGO_HOME", "RUSTUP_HOME"]), CARGO_TARGET_DIR: join(root, ".cache", "target") },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    await close();
    if (isRecord(error) && (error.code === "ENOENT" || (typeof error.stderr === "string" && error.stderr.includes("no such command")))) throw new Error(`cargo build-sbf is not available: ${sbfHint}`, { cause: error });
    throw error;
  }
  return { out: directory, close, [Symbol.asyncDispose]: close };
}
