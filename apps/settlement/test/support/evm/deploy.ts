// spec/settlement/escrow.md, "Events apply once, in canonical block and event order"; spec/settlement/vaultSnapshots.md, "Only a reviewed registry binding can obtain totals"
import { type Account, type Anvil, type ForgeOutput, type Receipt, deploy, forgeBuild } from "@repo/platform/testing/chains";
import { type Address, type Hex, encodeFunctionData, parseAbi } from "viem";
import { type Bytes32, type EvmAddress, evmAddress, factoryAbi } from "../../../src/chain/evm/abi.ts";
import { depositCalldata } from "../../../src/chain/evm/actions.ts";
import type { EscrowLog } from "../../../src/chain/evm/events.ts";
import { MAX_FEE_PER_GAS, MIN_PRIORITY_FEE } from "../../../src/kernels/attesterLimits.ts";
import { type Period, parsePeriod } from "../../../src/kernels/calendar.ts";
import { type VaultCreation, decodeVault, vaultCreationPlan, vaultKey, vaultsCall } from "../../../src/chain/evm/factories.ts";
import type { MonthlyEntry } from "../../../src/chain/evm/monthlyRoot.ts";

const contracts = new URL("../../../../../packages/contracts/evm", import.meta.url).pathname;
const sources = ["src/ProjectEscrow.sol", "vendor/openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol", "integration/TestDollar.sol"];
const dollarAbi = parseAbi(["function mint(address to, uint256 amount)", "function approve(address who, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

export const FEE_RECIPIENT = "0x0000000000000000000000000000000000000fee" as EvmAddress;

export interface Roles {
  readonly owner: Account;
  readonly authority: Account;
  readonly recipient: Account;
  readonly donor: Account;
  readonly registrar: Account;
  readonly upgrader: Account;
}

export interface EscrowStack extends AsyncDisposable {
  readonly chain: Anvil;
  readonly chainId: bigint;
  readonly roles: Roles;
  readonly factory: EvmAddress;
  readonly implementation: EvmAddress;
  readonly dollar: EvmAddress;
  createVault(creation: VaultCreation): Promise<EvmAddress>;
  call(to: EvmAddress, data: Hex): Promise<Hex>;
  send(from: Address, to: EvmAddress, data: Hex, value?: bigint): Promise<Receipt>;
  fund(vault: EvmAddress, amount: bigint, from: Address): Promise<Receipt>;
  logs(address: EvmAddress, fromBlock: bigint, toBlock: bigint): Promise<ReadonlyArray<EscrowLog>>;
  head(): Promise<bigint>;
  signTypedData(signer: Address, typedData: unknown): Promise<Hex>;
  signTransaction(from: Address, to: EvmAddress, data: Hex): Promise<Hex>;
  sendRaw(raw: Hex): Promise<Receipt>;
  close(): Promise<void>;
}

/** @throws {never} */
export function word(value: bigint): Bytes32 {
  return `0x${value.toString(16).padStart(64, "0")}` as Bytes32;
}

/** @throws {never} */
export function entriesFrom(first: bigint, grosses: ReadonlyArray<bigint>): ReadonlyArray<MonthlyEntry> {
  return grosses.map((gross, index) => ({ actor: 100n + BigInt(index), gross, sourceDigest: word(first + BigInt(index)) }));
}

function period(text: string): Period {
  const parsed = parsePeriod(text);
  if (parsed === undefined) throw new RangeError(`${text} is not a calendar month`);
  return parsed;
}

export const NOVEMBER_2026 = period("2026-11");

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const hexText = (value: unknown, what: string): Hex => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/u.test(value)) throw new Error(`${what} is not hex`);
  return value as Hex;
};

const logOf = (value: unknown): EscrowLog => {
  if (!isRecord(value) || !Array.isArray(value.topics)) throw new Error("eth_getLogs answered a malformed log");
  return {
    address: hexText(value.address, "log address"),
    topics: value.topics.map((topic) => hexText(topic, "log topic")),
    data: hexText(value.data, "log data"),
    blockNumber: BigInt(hexText(value.blockNumber, "log block")),
    blockHash: hexText(value.blockHash, "log block hash"),
    transactionHash: hexText(value.transactionHash, "log transaction"),
    logIndex: Number(BigInt(hexText(value.logIndex, "log index"))),
    removed: value.removed === true,
  };
};

const role = (chain: Anvil, index: number): Account => {
  const account = chain.accounts[index];
  if (account === undefined) throw new Error(`anvil has no account ${index}`);
  return account;
};

const lower = (address: Address): EvmAddress => {
  const parsed = evmAddress(address);
  if (parsed === undefined) throw new Error(`${address} is not an address`);
  return parsed;
};

export async function escrowStack(chain: Anvil): Promise<EscrowStack> {
  const built: ForgeOutput = await forgeBuild(contracts, sources);
  try {
    const roles: Roles = { owner: role(chain, 0), authority: role(chain, 1), recipient: role(chain, 2), donor: role(chain, 3), registrar: role(chain, 4), upgrader: role(chain, 5) };
    const path = (file: string, name: string) => `${built.out}/${file}/${name}.json`;
    const deployer = roles.registrar.address;
    const implementation = lower(await deploy(chain, path("ProjectEscrow.sol", "ProjectEscrow"), [], deployer));
    const factoryImplementation = await deploy(chain, path("ProjectEscrow.sol", "EscrowFactory"), [], deployer);
    const initialize = encodeFunctionData({ abi: factoryAbi, functionName: "initialize", args: [roles.registrar.address, FEE_RECIPIENT, roles.authority.address, 0n, roles.upgrader.address, implementation] });
    const factory = lower(await deploy(chain, path("ERC1967Proxy.sol", "ERC1967Proxy"), [factoryImplementation, initialize], deployer));
    const dollar = lower(await deploy(chain, path("TestDollar.sol", "TestDollar"), [], deployer));
    const call = async (to: EvmAddress, data: Hex) => hexText(await chain.rpc("eth_call", [{ to, data }, "latest"]), "eth_call answer");
    const send = async (from: Address, to: EvmAddress, data: Hex, value?: bigint) => {
      const receipt = await chain.transact({ from, to, data, ...(value === undefined ? {} : { value }) });
      if (receipt.status !== "success") throw new Error(`${data.slice(0, 10)} to ${to} reverted in ${receipt.transactionHash}`);
      return receipt;
    };
    const quantity = (value: bigint) => `0x${value.toString(16)}`;
    const head = async () => BigInt(hexText(await chain.rpc("eth_blockNumber"), "eth_blockNumber"));
    const receiptOf = async (hash: Hex): Promise<Receipt> => {
      let found = await chain.rpc("eth_getTransactionReceipt", [hash]);
      if (!isRecord(found)) {
        await chain.rpc("evm_mine");
        found = await chain.rpc("eth_getTransactionReceipt", [hash]);
      }
      if (!isRecord(found)) throw new Error(`no receipt for ${hash}`);
      return { transactionHash: hash, blockNumber: BigInt(hexText(found.blockNumber, "receipt block")), status: found.status === "0x1" ? "success" : "reverted", contractAddress: undefined };
    };
    const close = () => built.close();
    return {
      chain,
      chainId: BigInt(chain.chainId),
      roles,
      factory,
      implementation,
      dollar,
      call,
      send,
      createVault: async (creation) => {
        const plan = vaultCreationPlan(factory, creation);
        await send(plan.from, plan.to, plan.data);
        const vault = decodeVault(await call(factory, vaultsCall(vaultKey(creation))));
        if (vault === null || vault === undefined) throw new Error("the factory recorded no vault for the creation key");
        return vault;
      },
      fund: async (vault, amount, from) => {
        await send(from, dollar, encodeFunctionData({ abi: dollarAbi, functionName: "mint", args: [from, amount] }));
        await send(from, dollar, encodeFunctionData({ abi: dollarAbi, functionName: "approve", args: [vault, amount] }));
        return send(from, vault, depositCalldata(amount));
      },
      logs: async (address, fromBlock, toBlock) => {
        const answer = await chain.rpc("eth_getLogs", [{ address, fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` }]);
        if (!Array.isArray(answer)) throw new Error("eth_getLogs answered no list");
        return answer.map(logOf);
      },
      head,
      signTypedData: async (signer, typedData) => hexText(await chain.rpc("eth_signTypedData_v4", [signer, typedData]), "typed-data signature"),
      signTransaction: async (from, to, data) => {
        const nonce = hexText(await chain.rpc("eth_getTransactionCount", [from, "pending"]), "nonce");
        const request = { from, to, data, value: "0x0", nonce, chainId: quantity(BigInt(chain.chainId)), type: "0x2", gas: quantity(500_000n), maxFeePerGas: quantity(MAX_FEE_PER_GAS), maxPriorityFeePerGas: quantity(MIN_PRIORITY_FEE) };
        return hexText(await chain.rpc("eth_signTransaction", [request]), "signed transaction");
      },
      sendRaw: async (raw) => receiptOf(hexText(await chain.rpc("eth_sendRawTransaction", [raw]), "transaction hash")),
      close,
      [Symbol.asyncDispose]: close,
    };
  } catch (error) {
    await built.close();
    throw error;
  }
}

