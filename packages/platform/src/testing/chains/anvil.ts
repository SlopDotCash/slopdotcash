// spec/settlement/evmScan.md, "A run first authenticates the RPC chain, including for an empty page"; spec/settlement/evmScan.md, "A page starts at the cursor and never passes the finalized head"
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { type Abi, type Address, type Hex, encodeDeployData, getAddress, isAddress, isHex } from "viem";
import type { Handler } from "../../testing.ts";
import { type RpcCall, type Served, childEnvironment, forward, freePort, mapResults, replaceStrings, replay, rewriteCalls, rpc, rpcCalls, serve, supervised } from "./faults.ts";

export interface Account {
  readonly address: Address;
  readonly privateKey: Hex;
}

export interface AnvilOptions {
  readonly chainId: 8453 | 4663 | 1 | 11155111 | number;
  readonly blockTime?: number;
  readonly finalityDepth?: number;
  readonly timestamp?: number;
}

export interface Transaction {
  readonly from: Address;
  readonly to?: Address;
  readonly data?: Hex;
  readonly value?: bigint;
}

export interface Receipt {
  readonly transactionHash: Hex;
  readonly blockNumber: bigint;
  readonly status: "success" | "reverted";
  readonly contractAddress: Address | undefined;
}

export interface Anvil extends AsyncDisposable {
  readonly family: "evm";
  readonly chainId: number;
  readonly url: string;
  readonly accounts: ReadonlyArray<Account>;
  rpc(method: string, params?: ReadonlyArray<unknown>): Promise<unknown>;
  mine(blocks?: number): Promise<bigint>;
  finalized(): Promise<bigint>;
  /** @throws {never} */
  setFinalized(block: bigint | undefined): void;
  snapshot(): Promise<string>;
  revert(id: string): Promise<void>;
  setNextBaseFee(wei: bigint): Promise<void>;
  transact(transaction: Transaction): Promise<Receipt>;
  close(): Promise<void>;
}

export interface Artifact {
  readonly abi: Abi;
  readonly bytecode: Hex;
}

export interface ForgeOutput extends AsyncDisposable {
  readonly out: string;
  close(): Promise<void>;
}

const run = promisify(execFile);
const foundryHint = "install Foundry 1.7.1 (`foundryup --install 1.7.1`) so that `anvil` and `forge` are on PATH";
const baseChainId = 8453;
const baseGasPriceOracle = "0x420000000000000000000000000000000000000f";
const zeroWordCode = "0x600060005260206000f3";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const quantity = (value: unknown, what: string): bigint => {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) throw new Error(`${what} is not a hex quantity`);
  return BigInt(value);
};

const hex = (value: bigint | number) => `0x${value.toString(16)}`;

function finality(upstream: Handler, finalizedHeight: () => Promise<bigint>, opStack: boolean): Handler {
  const tagged = (calls: ReadonlyArray<RpcCall>) => calls.some((call) => /"(finalized|safe)"/u.test(JSON.stringify(call.params ?? null)));
  const receipts = (call: RpcCall, result: unknown): unknown => {
    if (call.method === "eth_getTransactionReceipt" && isRecord(result)) return { ...result, l1Fee: "0x0" };
    if (call.method === "eth_getBlockReceipts" && Array.isArray(result)) return result.map((item) => (isRecord(item) ? { ...item, l1Fee: "0x0" } : item));
    return result;
  };
  return async (request) => {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const parsed = rpcCalls(bytes);
    if (parsed === undefined) return upstream(replay(request, bytes));
    let calls = parsed.calls;
    if (tagged(calls)) {
      const height = hex(await finalizedHeight());
      calls = calls.map((call) => ({ ...call, params: replaceStrings(call.params, (text) => (text === "finalized" || text === "safe" ? height : text)) }));
    }
    const response = await upstream(rewriteCalls(request, parsed.batch, calls));
    return opStack ? mapResults(response, calls, receipts) : response;
  };
}

async function readAccounts(path: string): Promise<ReadonlyArray<Account>> {
  const config: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(config) || !Array.isArray(config.available_accounts) || !Array.isArray(config.private_keys)) throw new Error("anvil --config-out has no accounts");
  const keys = config.private_keys;
  return config.available_accounts.map((address, index) => {
    const privateKey = keys[index];
    if (typeof address !== "string" || !isAddress(address) || typeof privateKey !== "string" || !isHex(privateKey)) throw new Error("anvil --config-out has a malformed account");
    return { address: getAddress(address), privateKey };
  });
}

async function started(child: ChildProcess, url: string, chainId: number, configOut: string, spawnError: () => Error | undefined): Promise<ReadonlyArray<Account>> {
  for (let attempt = 0; attempt < 150; attempt++) {
    const failed = spawnError();
    if (failed !== undefined) throw failed;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`anvil exited during startup (${child.exitCode ?? child.signalCode})`);
    const observed = await rpc(url, "eth_chainId").catch(() => undefined);
    if (observed !== undefined) {
      if (quantity(observed, "eth_chainId") !== BigInt(chainId)) throw new Error(`anvil answered chain ${String(observed)}, not ${chainId}`);
      const accounts = await readAccounts(configOut).catch(() => undefined);
      if (accounts !== undefined && accounts.length > 0) return accounts;
    }
    await sleep(100);
  }
  throw new Error("anvil did not become ready within 15 seconds");
}

export async function anvil(options: AnvilOptions): Promise<Anvil> {
  const { chainId, blockTime, finalityDepth = 64, timestamp } = options;
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw new RangeError(`Invalid chain id ${chainId}`);
  if (!Number.isSafeInteger(finalityDepth) || finalityDepth < 0) throw new RangeError(`Invalid finality depth ${finalityDepth}`);
  const directory = await mkdtemp(join(tmpdir(), "slop-anvil-"));
  const configOut = join(directory, "anvil.json");
  const port = await freePort();
  const upstreamUrl = `http://127.0.0.1:${port}`;
  const args = [
    "--host", "127.0.0.1", "--port", String(port), "--chain-id", String(chainId), "--silent", "--config-out", configOut,
    ...(blockTime === undefined ? [] : ["--block-time", String(blockTime)]),
    ...(timestamp === undefined ? [] : ["--timestamp", String(timestamp)]),
  ];
  const child = spawn("anvil", args, { stdio: "ignore", env: childEnvironment() });
  let spawnFailure: Error | undefined;
  child.once("error", (error: NodeJS.ErrnoException) => {
    spawnFailure = error.code === "ENOENT" ? new Error(`anvil is not on PATH: ${foundryHint}`) : error;
  });
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  let pinned: bigint | undefined;
  const latest = async () => quantity(await rpc(upstreamUrl, "eth_blockNumber"), "eth_blockNumber");
  const finalized = async () => {
    const head = await latest();
    const height = pinned ?? head - BigInt(finalityDepth);
    return height < 0n ? 0n : height > head ? head : height;
  };
  let proxy: Served | undefined;
  const close = supervised(async () => {
    await proxy?.close();
    if (child.exitCode === null && child.signalCode === null && spawnFailure === undefined) {
      child.kill("SIGTERM");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  });
  try {
    const accounts = await started(child, upstreamUrl, chainId, configOut, () => spawnFailure);
    if (chainId === baseChainId) await rpc(upstreamUrl, "anvil_setCode", [baseGasPriceOracle, zeroWordCode]);
    proxy = await serve(finality(forward(upstreamUrl), finalized, chainId === baseChainId));
    const url = proxy.url;
    const call = (method: string, params: ReadonlyArray<unknown> = []) => rpc(url, method, params);
    const receipt = async (hash: Hex): Promise<Receipt> => {
      for (let attempt = 0; attempt < 600; attempt++) {
        const found = await call("eth_getTransactionReceipt", [hash]);
        if (isRecord(found)) {
          const contract = found.contractAddress;
          return {
            transactionHash: hash,
            blockNumber: quantity(found.blockNumber, "receipt blockNumber"),
            status: found.status === "0x1" ? "success" : "reverted",
            contractAddress: typeof contract === "string" && isAddress(contract) ? getAddress(contract) : undefined,
          };
        }
        await sleep(100);
      }
      throw new Error(`No receipt for ${hash} within 60 seconds`);
    };
    return {
      family: "evm",
      chainId,
      url,
      accounts,
      rpc: call,
      mine: async (blocks = 1) => {
        await call("anvil_mine", [hex(blocks)]);
        return latest();
      },
      finalized,
      setFinalized: (block) => {
        pinned = block;
      },
      snapshot: async () => {
        const id = await call("evm_snapshot");
        if (typeof id !== "string") throw new Error("evm_snapshot answered no id");
        return id;
      },
      revert: async (id) => {
        if ((await call("evm_revert", [id])) !== true) throw new Error(`evm_revert refused snapshot ${id}`);
      },
      setNextBaseFee: async (wei) => {
        await call("anvil_setNextBlockBaseFeePerGas", [hex(wei)]);
      },
      transact: async ({ from, to, data, value }) => {
        const hash = await call("eth_sendTransaction", [{ from, ...(to === undefined ? {} : { to }), ...(data === undefined ? {} : { data }), ...(value === undefined ? {} : { value: hex(value) }) }]);
        if (typeof hash !== "string" || !isHex(hash)) throw new Error("eth_sendTransaction answered no hash");
        return receipt(hash);
      },
      close,
      [Symbol.asyncDispose]: close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function artifact(path: string): Promise<Artifact> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.abi) || !isRecord(parsed.bytecode)) throw new Error(`${path} is not a Foundry artifact`);
  const bytecode = parsed.bytecode.object;
  if (typeof bytecode !== "string" || !isHex(bytecode) || bytecode.length <= 2) throw new Error(`${path} has no deployable bytecode`);
  return { abi: parsed.abi as Abi, bytecode };
}

export async function deploy(chain: Anvil, artifactPath: string, args: ReadonlyArray<unknown>, from: Address): Promise<Address> {
  const { abi, bytecode } = await artifact(artifactPath);
  const data = encodeDeployData({ abi, bytecode, args: [...args] });
  const receipt = await chain.transact({ from, data });
  if (receipt.status !== "success" || receipt.contractAddress === undefined) throw new Error(`Deploying ${artifactPath} reverted in ${receipt.transactionHash}`);
  return receipt.contractAddress;
}

export async function forgeBuild(root: string, sources: ReadonlyArray<string>): Promise<ForgeOutput> {
  const directory = await mkdtemp(join(tmpdir(), "slop-forge-"));
  const close = supervised(() => rm(directory, { recursive: true, force: true }));
  const out = join(directory, "out");
  try {
    await run("forge", ["build", "--root", root, "--out", out, "--cache-path", join(directory, "cache"), ...sources], { cwd: root, env: childEnvironment(), maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    await close();
    if (isRecord(error) && error.code === "ENOENT") throw new Error(`forge is not on PATH: ${foundryHint}`);
    throw error;
  }
  return { out, close, [Symbol.asyncDispose]: close };
}
