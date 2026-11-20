// spec/contracts/solanaEscrow.md, "Simulation samples cover admitted and refused assets, windows, allocations and signers"; spec/contracts/solanaEscrow.md, "Block time is positive"
// A solana-test-validator 2.1.21 that runs the compiled slop-escrow program from a genesis this fixture writes, so that
// the cluster clock is exactly the spec's `now`: with a zero target tick duration the PoH estimate never moves, the
// validator's own wall-clock votes are older than the genesis time, and the clock stays at the genesis creation time.
// Moving the clock, or writing an account no instruction can create (an earlier build's project, a mint with given
// extensions), restarts the validator from a new genesis that holds every account the old one had.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { type KeyObject, createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sbfBuild } from "@repo/platform/testing/chains";
import {
  type Address,
  type Message,
  ASSOCIATED_TOKEN_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  base58Decode,
  base58Encode,
  base64Decode,
  base64Encode,
  encodeMessage,
  encodeTransaction,
  findPda,
} from "./solanaWire.ts";
type Blockhash = string;

export { ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, type Address };

export const SOLANA_VERSION = "2.1.21";
export const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111" as Address;
export const ED25519_PROGRAM = "Ed25519SigVerify111111111111111111111111111" as Address;
export const INSTRUCTIONS_SYSVAR = "Sysvar1nstructions1111111111111111111111111" as Address;
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111" as Address;
const RENT_SYSVAR = "SysvarRent111111111111111111111111111111111" as Address;
const CLOCK_SYSVAR = "SysvarC1ock11111111111111111111111111111111" as Address;
/** A program that is neither token program: the owner of a mint of `OtherProgram`. */
export const OTHER_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" as Address;
const NATIVE_MINT = "So11111111111111111111111111111111111111112" as Address;
const MEMO_V1 = "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo" as Address;
export const DEFAULT_KEY = "11111111111111111111111111111111" as Address;

export const roles = ["deployer", "owner", "upgrader", "attester", "rotator", "other", "fees", "wallet", "nextAttester"] as const;
export type Role = (typeof roles)[number];
export const isRole = (name: unknown): name is Role => roles.some((role) => role === name);

/** Raised for an event the chain cannot be sent: the check counts it as refused. */
export class Unrepresentable extends Error {}

const solanaRoot = fileURLToPath(new URL("../../solana/", import.meta.url));
const scratch = join(solanaRoot, ".local");
export const PROGRAM = JSON.parse(await readFile(join(solanaRoot, "idl", "slop_escrow.json"), "utf8")).address as Address;

export const utf8 = (text: string) => new TextEncoder().encode(text);
export const sha256 = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
};
export const keyBytes = (address: Address): Uint8Array => {
  const bytes = base58Decode(address);
  if (bytes?.length !== 32) throw new Error(`${address} is not a public key`);
  return bytes;
};
export const addressOf = (bytes: Uint8Array): Address => base58Encode(bytes) as Address;
export function pda(seeds: ReadonlyArray<Uint8Array>, program: Address = PROGRAM): Address {
  const found = findPda(seeds, program);
  if (found === undefined) throw new Error("no program address for these seeds");
  return found.address;
}
export const PROGRAM_DATA = pda([keyBytes(PROGRAM)], LOADER);
export const CONFIG = pda([utf8("config")]);

export const rentFor = (length: number): bigint => (BigInt(length) + 128n) * 6960n;

export interface Keypair {
  readonly address: Address;
  readonly secret: KeyObject;
  readonly seed: Uint8Array;
  readonly publicKey: Uint8Array;
}

const pkcs8 = Buffer.from("302e020100300506032b657004220420", "hex");

/** A keypair fixed by its label, so a restarted validator and a later walk see the same addresses. */
export function keypair(label: string): Keypair {
  const seed = sha256(utf8(`slop-solana-conformance:${label}`));
  const secret = createPrivateKey({ key: Buffer.concat([pkcs8, seed]), format: "der", type: "pkcs8" });
  const publicKey = new Uint8Array(createPublicKey(secret).export({ format: "der", type: "spki" }).subarray(-32));
  return { address: addressOf(publicKey), secret, seed, publicKey };
}

export const signed = (key: Keypair, message: Uint8Array): Uint8Array => new Uint8Array(sign(null, message, key.secret));

export interface Meta {
  readonly key: Address;
  readonly signer: boolean;
  readonly writable: boolean;
}
export const meta = (key: Address, writable: boolean, signer = false): Meta => ({ key, writable, signer });
export interface Instruction {
  readonly program: Address;
  readonly accounts: ReadonlyArray<Meta>;
  readonly data: Uint8Array;
}

export interface GenesisAccount {
  readonly address: Address;
  readonly lamports: bigint;
  readonly owner: Address;
  readonly data: Uint8Array;
  readonly executable: boolean;
}

export const u32le = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
};
export const u16le = (value: number) => Uint8Array.of(value & 0xff, value >> 8);
export const u64le = (value: bigint) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
};
export const i64le = (value: bigint) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, true);
  return bytes;
};
export const concat = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
};
export const readU64 = (data: Uint8Array, at: number) => new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(at, true);
export const readI64 = (data: Uint8Array, at: number) => new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(at, true);
export const readU32 = (data: Uint8Array, at: number) => new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(at, true);
export const keyAt = (data: Uint8Array, at: number) => addressOf(data.slice(at, at + 32));

const exec = promisify(execFile);

interface RpcFailure {
  readonly code: number;
  readonly message: string;
}
class RpcError extends Error {
  readonly failure: RpcFailure;
  constructor(method: string, failure: RpcFailure) {
    super(`${method} failed: ${failure.code} ${failure.message}`);
    this.failure = failure;
  }
}

async function call(url: string, method: string, params: ReadonlyArray<unknown>): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let body: unknown;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(60_000),
      });
      body = await response.json();
    } catch (error) {
      if (attempt < 20) {
        await sleep(500);
        continue;
      }
      throw error;
    }
    const { error, result } = body as { error?: RpcFailure; result?: unknown };
    if (error !== undefined) throw new RpcError(method, error);
    return result;
  }
}

async function portsFree(ports: ReadonlyArray<number>): Promise<boolean> {
  const held: ReturnType<typeof createServer>[] = [];
  try {
    for (const port of ports) {
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve());
      });
      held.push(server);
    }
    return true;
  } catch {
    return false;
  } finally {
    await Promise.all(held.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  }
}

const portRange = (base: number) => Array.from({ length: 42 }, (_, offset) => base + offset);

async function reservePorts(): Promise<number> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const base = 20_000 + Math.floor(Math.random() * 40_000);
    if (await portsFree(portRange(base))) return base;
  }
  throw new Error("no free loopback port range for the validator");
}

interface Running {
  readonly child: ChildProcess;
  readonly ledger: string;
}

const bootstrap = { identity: keypair("validator"), vote: keypair("vote"), stake: keypair("stake"), faucet: keypair("faucet") };
const keypairFile = (key: Keypair) => JSON.stringify([...key.seed, ...key.publicKey]);

export interface Chain extends AsyncDisposable {
  readonly keys: Readonly<Record<Role, Keypair>>;
  /** The compiled current program and the earlier build that stands in for it until `upgradeProgram`. */
  readonly current: Uint8Array;
  readonly legacy: Uint8Array;
  /** Accounts every genesis carries: the SPL programs the test validator's own genesis holds. */
  readonly base: ReadonlyArray<GenesisAccount>;
  rpc(method: string, params?: ReadonlyArray<unknown>): Promise<unknown>;
  /** Stops any running validator and starts one whose genesis holds exactly `accounts`, at block time `time`. */
  boot(time: number, accounts: ReadonlyArray<GenesisAccount>): Promise<void>;
  /** Every account a restart must carry: the program's, the loader's, both token programs' and these. */
  dump(also: ReadonlyArray<Address>): Promise<GenesisAccount[]>;
  /** Sends one transaction paid by the deployer; true when it executed, false when the cluster refused it. */
  send(instructions: ReadonlyArray<Instruction>, signers: ReadonlyArray<Keypair>): Promise<boolean>;
  accounts(addresses: ReadonlyArray<Address>): Promise<ReadonlyArray<GenesisAccount | undefined>>;
  programAccounts(owner: Address, filters: ReadonlyArray<unknown>): Promise<GenesisAccount[]>;
}

function decoded(address: Address, raw: unknown): GenesisAccount | undefined {
  if (raw === null || raw === undefined) return undefined;
  const { lamports, owner, data, executable } = raw as { lamports: number; owner: string; data: [string, string]; executable: boolean };
  const bytes = base64Decode(data[0]);
  if (bytes === undefined) throw new Error(`${address} answered undecodable data`);
  return { address, lamports: BigInt(lamports), owner: owner as Address, data: bytes, executable };
}

/** solana-genesis reads a map of base64 accounts (JSON is YAML). */
const primordial = (accounts: ReadonlyArray<GenesisAccount>) =>
  JSON.stringify(Object.fromEntries(accounts.map((account) => [account.address, {
    balance: Number(account.lamports),
    owner: account.owner,
    data: base64Encode(account.data),
    executable: account.executable,
  }])));

async function validatorVersion(): Promise<void> {
  const { stdout } = await exec("solana-test-validator", ["--version"], { timeout: 60_000 });
  if (!stdout.startsWith(`solana-test-validator ${SOLANA_VERSION} `)) throw new Error(`solana-test-validator ${SOLANA_VERSION} must be on PATH; found ${stdout.trim()}`);
}

/**
 * The test validator votes with its vote account's own keypair, where solana-genesis makes the identity the voter.
 * The bootstrap vote account is therefore the test validator's genesis one, with this fixture's keys in it.
 */
async function templateVote(ledger: string): Promise<GenesisAccount> {
  const genesis = new Uint8Array(await readFile(join(ledger, "genesis.bin")));
  const keyOfFile = async (name: string) => new Uint8Array(JSON.parse(await readFile(join(ledger, name), "utf8"))).slice(32, 64);
  const [identity, vote] = [await keyOfFile("validator-keypair.json"), await keyOfFile("vote-account-keypair.json")];
  let at = 16;
  for (let left = Number(readU64(genesis, 8)); left > 0; left--) {
    const address = genesis.slice(at, at + 32);
    const lamports = readU64(genesis, at + 32);
    const length = Number(readU64(genesis, at + 40));
    const data = genesis.slice(at + 48, at + 48 + length);
    const owner = addressOf(genesis.slice(at + 48 + length, at + 80 + length));
    at += 48 + length + 32 + 1 + 8;
    if (owner !== "Vote111111111111111111111111111111111111111" || !address.every((byte, index) => byte === vote[index])) continue;
    const replace = (from: Uint8Array, to: Uint8Array) => {
      for (let i = 0; i + 32 <= data.length; i++) if (from.every((byte, index) => data[i + index] === byte)) data.set(to, i);
    };
    replace(vote, bootstrap.vote.publicKey);
    replace(identity, bootstrap.identity.publicKey);
    return { address: bootstrap.vote.address, lamports, owner, data, executable: false };
  }
  throw new Error("the test validator's genesis holds no vote account");
}

/** The bytes of the program with its declared ID changed, so that every instruction fails as no current one exists. */
function earlierBuild(current: Uint8Array): Uint8Array {
  const id = keyBytes(PROGRAM);
  const other = sha256(utf8("slop-escrow earlier build"));
  const bytes = new Uint8Array(current);
  let found = 0;
  for (let at = 0; at + 32 <= bytes.length; at++) {
    if (id.every((byte, index) => bytes[at + index] === byte)) {
      bytes.set(other, at);
      found++;
    }
  }
  if (found === 0) throw new Error("the program bytes do not hold its declared ID");
  return bytes;
}

export async function launch(): Promise<Chain> {
  await validatorVersion();
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "conformance-"));
  const build = await sbfBuild(solanaRoot, "programs/slop-escrow/Cargo.toml");
  const current = new Uint8Array(await readFile(join(build.out, "slop_escrow.so")));
  await build.close();
  const legacy = earlierBuild(current);
  const port = await reservePorts();
  const url = `http://127.0.0.1:${port}`;
  const rpc = (method: string, params: ReadonlyArray<unknown> = []) => call(url, method, params);
  let running: Running | undefined;
  let generation = 0;
  let nonce = 0;

  const halt = async () => {
    const stopping = running;
    running = undefined;
    if (stopping === undefined) return;
    if (stopping.child.exitCode === null && stopping.child.signalCode === null) {
      const closed = new Promise<void>((resolve) => stopping.child.once("close", () => resolve()));
      stopping.child.kill("SIGTERM");
      await closed;
    }
    for (let attempt = 0; attempt < 100 && !(await portsFree([port, port + 1])); attempt++) await sleep(200);
    await rm(stopping.ledger, { recursive: true, force: true });
  };

  const start = async (ledger: string, args: ReadonlyArray<string>) => {
    const log = await open(join(ledger, "..", `validator-${generation}.log`), "w", 0o600);
    const child = spawn("solana-test-validator", [
      ...args, "--ledger", ledger, "--quiet", "--rpc-port", String(port), "--faucet-port", String(port + 41),
      "--dynamic-port-range", `${port + 2}-${port + 31}`, "--bind-address", "127.0.0.1",
    ], { stdio: ["ignore", log.fd, log.fd] });
    child.once("close", () => void log.close());
    running = { child, ledger };
    const until = Date.now() + 600_000;
    while (Date.now() < until) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`the validator exited during startup; see ${join(ledger, "..", `validator-${generation}.log`)}`);
      const version = await call(url, "getVersion", []).catch(() => undefined);
      if (version !== undefined) {
        if ((version as Record<string, unknown>)["solana-core"] !== SOLANA_VERSION) throw new Error(`the validator reported ${JSON.stringify(version)}, not ${SOLANA_VERSION}`);
        const slot = await call(url, "getSlot", [{ commitment: "confirmed" }]).catch(() => 0);
        if (typeof slot === "number" && slot >= 1) return slot;
      }
      await sleep(500);
    }
    throw new Error("the validator did not become ready within 600 seconds");
  };

  // The SPL programs come from the test validator's own genesis, as an ordinary run of it would hold them.
  const template = join(directory, "template");
  await mkdir(template);
  generation++;
  await start(template, ["--reset", "--mint", bootstrap.faucet.address]);
  const loaded = (await rpc("getMultipleAccounts", [[TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, MEMO_V1, OTHER_PROGRAM, NATIVE_MINT], { encoding: "base64" }])) as { value: unknown[] };
  const programs = [TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, MEMO_V1, OTHER_PROGRAM, NATIVE_MINT].map((address, index) => {
    const account = decoded(address, loaded.value[index]);
    if (account === undefined) throw new Error(`the test validator's genesis holds no ${address}`);
    return account;
  });
  const upgradeable = programs.filter((account) => account.owner === LOADER).map((account) => keyAt(account.data, 4));
  const voting = await templateVote(template);
  const data = (await rpc("getMultipleAccounts", [upgradeable, { encoding: "base64" }])) as { value: unknown[] };
  const base: GenesisAccount[] = [...programs, ...upgradeable.map((address, index) => {
    const account = decoded(address, data.value[index]);
    if (account === undefined) throw new Error(`the test validator's genesis holds no program data ${address}`);
    return account;
  })];
  await halt();
  base.push(voting);

  const keys = Object.fromEntries(roles.map((role) => [role, keypair(role)])) as Record<Role, Keypair>;
  const byAddress = new Map<string, Keypair>([...Object.values(keys)].map((key) => [key.address, key]));

  const accounts = async (addresses: ReadonlyArray<Address>) => {
    const found: (GenesisAccount | undefined)[] = [];
    for (let at = 0; at < addresses.length; at += 100) {
      const slice = addresses.slice(at, at + 100);
      const reply = (await rpc("getMultipleAccounts", [slice, { encoding: "base64", commitment: "confirmed" }])) as { value: unknown[] };
      found.push(...slice.map((address, index) => decoded(address, reply.value[index])));
    }
    return found;
  };
  const programAccounts = async (owner: Address, filters: ReadonlyArray<unknown>) => {
    const reply = (await rpc("getProgramAccounts", [owner, { encoding: "base64", commitment: "confirmed", filters }])) as { pubkey: string; account: unknown }[];
    return reply.flatMap(({ pubkey, account }) => {
      const found = decoded(pubkey as Address, account);
      return found === undefined ? [] : [found];
    });
  };

  const blockhash = async (): Promise<Blockhash> => {
    const reply = (await rpc("getLatestBlockhash", [{ commitment: "confirmed" }])) as { value: { blockhash: Blockhash } };
    return reply.value.blockhash;
  };

  const compile = (payer: Address, instructions: ReadonlyArray<Instruction>, recent: Blockhash): Message => {
    const seen = new Map<Address, { signer: boolean; writable: boolean }>([[payer, { signer: true, writable: true }]]);
    const mark = (key: Address, signer: boolean, writable: boolean) => {
      const was = seen.get(key);
      seen.set(key, { signer: (was?.signer ?? false) || signer, writable: (was?.writable ?? false) || writable });
    };
    for (const instruction of instructions) {
      for (const account of instruction.accounts) mark(account.key, account.signer, account.writable);
      mark(instruction.program, false, false);
    }
    const others = [...seen].filter(([key]) => key !== payer);
    const pick = (signer: boolean, writable: boolean) => others.filter(([, role]) => role.signer === signer && role.writable === writable).map(([key]) => key);
    const keysInOrder = [payer, ...pick(true, true), ...pick(true, false), ...pick(false, true), ...pick(false, false)];
    const index = new Map(keysInOrder.map((key, at) => [key, at]));
    const role = (key: Address) => seen.get(key) as { signer: boolean; writable: boolean };
    const signers = keysInOrder.filter((key) => role(key).signer);
    return {
      header: {
        requiredSignatures: signers.length,
        readonlySigned: signers.filter((key) => !role(key).writable).length,
        readonlyUnsigned: keysInOrder.filter((key) => !role(key).signer && !role(key).writable).length,
      },
      accountKeys: keysInOrder,
      recentBlockhash: recent,
      instructions: instructions.map((instruction) => ({
        programIndex: index.get(instruction.program) as number,
        accounts: instruction.accounts.map((account) => index.get(account.key) as number),
        data: instruction.data,
      })),
    };
  };

  const confirmed = async (signature: string): Promise<boolean | undefined> => {
    for (let attempt = 0; attempt < 600; attempt++) {
      const reply = (await rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: true }])) as { value: ({ err: unknown; confirmationStatus: string } | null)[] };
      const status = reply.value[0];
      if (status !== null && status !== undefined && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return status.err === null;
      await sleep(200);
    }
    return undefined;
  };

  const send = async (instructions: ReadonlyArray<Instruction>, signers: ReadonlyArray<Keypair>): Promise<boolean> => {
    for (const signer of signers) byAddress.set(signer.address, signer);
    // A distinct compute limit makes each transaction unique, so a repeated event is never "already processed".
    const unique: Instruction = { program: COMPUTE_BUDGET, accounts: [], data: concat(Uint8Array.of(2), u32le(1_400_000 - (nonce++ % 200_000))) };
    for (let attempt = 0; attempt < 5; attempt++) {
      const message = compile(keys.deployer.address, [unique, ...instructions], await blockhash());
      const bytes = encodeMessage(message);
      const required = message.accountKeys.slice(0, message.header.requiredSignatures);
      const signatures = required.map((key) => {
        const signer = byAddress.get(key);
        if (signer === undefined) throw new Unrepresentable(`no key signs for ${key}`);
        return signed(signer, bytes);
      });
      const wire = encodeTransaction(signatures, bytes);
      if (wire.length > 1232) throw new Unrepresentable(`a transaction of ${wire.length} bytes is too large`);
      try {
        await rpc("sendTransaction", [base64Encode(wire), { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 10 }]);
      } catch (error) {
        if (!(error instanceof RpcError)) throw error;
        // -32002: the preflight simulation failed, which is the program refusing the transaction.
        if (error.failure.code === -32002 && !/Blockhash not found/u.test(error.failure.message)) return false;
        if (/Blockhash not found/u.test(error.failure.message)) continue;
        throw error;
      }
      const outcome = await confirmed(base58Encode(signatures[0] as Uint8Array));
      if (outcome !== undefined) return outcome;
    }
    throw new Error("a transaction was neither confirmed nor refused after five attempts");
  };

  const boot = async (time: number, genesis: ReadonlyArray<GenesisAccount>) => {
    await halt();
    generation++;
    const ledger = join(directory, `ledger-${generation}`);
    await mkdir(ledger);
    const file = join(directory, `accounts-${generation}.json`);
    await writeFile(file, primordial(genesis));
    await exec("solana-genesis", [
      "--ledger", ledger,
      "--bootstrap-validator", bootstrap.identity.address, bootstrap.vote.address, bootstrap.stake.address,
      "--faucet-pubkey", bootstrap.faucet.address, "--faucet-lamports", "500000000000000000",
      "--bootstrap-validator-lamports", "500000000000", "--bootstrap-validator-stake-lamports", "1000000000000000",
      "--creation-time", new Date(time * 1000).toISOString(), "--cluster-type", "development",
      // A zero tick duration stops the PoH clock estimate; ticks follow hashing instead.
      "--target-tick-duration", "0", "--hashes-per-tick", "1000", "--ticks-per-slot", "8",
      "--max-genesis-archive-unpacked-size", "1073741824", "--primordial-accounts-file", file,
    ], { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
    await rm(file, { force: true });
    await Promise.all([
      writeFile(join(ledger, "validator-keypair.json"), keypairFile(bootstrap.identity)),
      writeFile(join(ledger, "vote-account-keypair.json"), keypairFile(bootstrap.vote)),
      writeFile(join(ledger, "stake-account-keypair.json"), keypairFile(bootstrap.stake)),
      writeFile(join(ledger, "faucet-keypair.json"), keypairFile(bootstrap.faucet)),
    ]);
    const slot = await start(ledger, []);
    let clock: unknown;
    for (let attempt = 0; attempt < 120 && typeof clock !== "number"; attempt++) {
      clock = await rpc("getBlockTime", [slot]).catch(() => undefined);
      if (typeof clock !== "number") await sleep(500);
    }
    if (clock !== time) throw new Error(`the validator's clock reads ${String(clock)}, not the genesis time ${time}`);
  };

  const dump = async (also: ReadonlyArray<Address>) => {
    const owned = (await Promise.all([PROGRAM, LOADER, TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map((owner) => programAccounts(owner, [])))).flat();
    const extra = (await accounts(also)).flatMap((account) => (account === undefined ? [] : [account]));
    // A program's data records the slot it was deployed in; a new genesis starts at slot 0, where a later slot would
    // keep the program invisible.
    return [...owned, ...extra].map((account) => {
      if (account.owner !== LOADER || account.data.length < 13 || readU32(account.data, 0) !== 3) return account;
      const data = new Uint8Array(account.data);
      data.set(u64le(0n), 4);
      return { ...account, data };
    });
  };

  const close = async () => {
    await halt();
    await rm(directory, { recursive: true, force: true });
  };

  return {
    keys,
    current,
    legacy,
    base,
    rpc,
    boot,
    dump,
    send,
    accounts,
    programAccounts,
    [Symbol.asyncDispose]: close,
  };
}

/** The upgradeable loader's accounts: the program, its data holding `elf` with `authority`, and a staged buffer. */
export function programAccounts(elf: Uint8Array, authority: Address, staged: Uint8Array, buffer: Address, bufferAuthority: Address): GenesisAccount[] {
  const pointer = concat(u32le(2), keyBytes(PROGRAM_DATA));
  const data = concat(u32le(3), u64le(0n), Uint8Array.of(1), keyBytes(authority), elf);
  const held = concat(u32le(1), Uint8Array.of(1), keyBytes(bufferAuthority), staged);
  return [
    { address: PROGRAM, lamports: rentFor(pointer.length), owner: LOADER, data: pointer, executable: true },
    { address: PROGRAM_DATA, lamports: rentFor(data.length), owner: LOADER, data, executable: false },
    { address: buffer, lamports: rentFor(held.length), owner: LOADER, data: held, executable: false },
  ];
}

/** The upgradeable loader's `Upgrade`: the buffer's bytes replace the program's, signed by its upgrade authority. */
export const upgradeInstruction = (buffer: Address, spill: Address, authority: Address): Instruction => ({
  program: LOADER,
  accounts: [meta(PROGRAM_DATA, true), meta(PROGRAM, true), meta(buffer, true), meta(spill, true), meta(RENT_SYSVAR, false), meta(CLOCK_SYSVAR, false), meta(authority, false, true)],
  data: u32le(3),
});

/** The upgradeable loader's `SetAuthority`, with no successor making the account immutable. */
export const setAuthorityInstruction = (account: Address, authority: Address, successor: Address | undefined): Instruction => ({
  program: LOADER,
  accounts: [meta(account, true), meta(authority, false, true), ...(successor === undefined ? [] : [meta(successor, false)])],
  data: u32le(4),
});

export const systemAccount = (address: Address, lamports: bigint): GenesisAccount => ({ address, lamports, owner: SYSTEM_PROGRAM, data: new Uint8Array(), executable: false });
