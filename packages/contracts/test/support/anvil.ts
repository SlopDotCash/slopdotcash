// spec/contracts/evmEscrow.md, "Simulation samples cover distinct and colliding keys, windows, allocations and signatures"
import { fileURLToPath } from "node:url";
import { type Account, type Anvil, anvil, artifact, deploy, forgeBuild, refuseMainnet } from "@repo/platform/testing/chains";
import {
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  createPublicClient,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  encodePacked,
  hashTypedData,
  hexToString,
  http,
  isHex,
  keccak256,
  pad,
  parseAbi,
  stringToHex,
  toHex,
  zeroAddress,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Leaf } from "../../gen/contracts__ledger.ts";

export const roles = ["deployer", "owner", "registrar", "attester", "nextAttester", "upgrader", "nextUpgrader", "other", "fees", "wallet"] as const;
export type Role = (typeof roles)[number];
export const isRole = (name: unknown): name is Role => roles.some((role) => role === name);

export const factoryAbi = parseAbi([
  "function initialize(address registrar_, address feeRecipient_, address identityAuthority_, uint64 bindingDelay_, address upgradeAuthority_, address vaultImplementation_)",
  "function proposeUpgradeAuthority(address next)",
  "function acceptUpgradeAuthority()",
  "function setVaultImplementation(address implementation_)",
  "function upgradeToAndCall(address newImplementation, bytes data) payable",
  "function proposeIdentityAuthority(address next)",
  "function cancelIdentityAuthorityRotation()",
  "function executeIdentityAuthorityRotation()",
  "function create(bytes32 projectId, address token, uint8 purpose) returns (address)",
  "function createWithMonthlyCommitment(bytes32 projectId, address token, uint128 cap, bool enabled) returns (address)",
  "function upgradeAuthority() view returns (address)",
  "function pendingUpgradeAuthority() view returns (address)",
  "function vaultImplementation() view returns (address)",
  "function registrar() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function bindingDelay() view returns (uint64)",
  "function identityAuthority() view returns (address)",
  "function pendingIdentityAuthority() view returns (address)",
  "function identityAuthorityEffectiveAt() view returns (uint64)",
  "event VaultCreated(bytes32 indexed projectId, address indexed token, address indexed vault, address owner, uint8 purpose, uint8 decimals)",
]);

export const vaultAbi = parseAbi([
  "struct MonthlyAward { uint64 actorId; uint128 gross; bytes32 sourceDigest; }",
  "struct MonthlyReservation { bytes32 allocationDigest; bytes32 allocationRoot; uint128 wholeGross; uint128 remainingGross; uint32 count; uint256 sourceSequence; }",
  "struct AllocationNode { bytes32 hash; uint128 total; }",
  "function deposit(uint128 amount) payable",
  "function commitAward(bytes32 id, uint64 actorId, uint128 gross, bytes32 sourceDigest)",
  "function commitBountyAward(bytes32 id, uint64 actorId, uint128 gross, bytes32 sourceDigest)",
  "function setMonthlyCommitment(uint128 cap, bool enabled)",
  "function commitMonthly(uint32 period, MonthlyAward[] entries, bytes attestation)",
  "function reserveMonthly(uint32 period, MonthlyReservation reservation, bytes attestation)",
  "function commitMonthlyLeaf(uint32 period, MonthlyAward entry, uint32 index, AllocationNode[] proof)",
  "function releaseMonthlyReserve(uint32 period, uint128 expectedRemaining, uint128 releasedGross, bytes attestation)",
  "function bindDestination(uint64 actorId, address destination, uint64 expectedVersion, bytes32 claimDigest, uint64 expiresAt, bytes walletSignature)",
  "function cancelBinding(uint64 actorId, uint64 expectedVersion)",
  "function pay(bytes32 id, uint64 expectedBindingVersion)",
  "function withdrawUnused(uint128 gross)",
  "function claimFees()",
  "function upgradeToAndCall(address newImplementation, bytes data) payable",
  "function token() view returns (address)",
  "function projectId() view returns (bytes32)",
  "function owner() view returns (address)",
  "function purpose() view returns (uint8)",
  "function feeRecipient() view returns (address)",
  "function bindingDelay() view returns (uint64)",
  "function totals() view returns (uint128 deposited, uint128 paid, uint128 payoutFees, uint128 grossWithdrawn, uint128 withdrawalFees, uint128 free, uint128 principalReserved, uint128 feesReserved, uint128 feesAccrued, uint256 balance)",
  "function pendingMonthlyGross() view returns (uint128)",
  "function monthlyCap() view returns (uint128)",
  "function monthlyEnabled() view returns (bool)",
  "function ordinarySourceSequence() view returns (uint256)",
  "function awards(bytes32 id) view returns (uint64 actorId, uint128 gross, uint128 fee, bytes32 sourceDigest, uint64 committedAt, bool paid)",
  "function bindings(uint64 actorId) view returns (address destination, uint64 version, bytes32 claimDigest, uint64 activatesAt, bool cancelled)",
  "function paidVersion(uint64 actorId) view returns (uint64)",
  "function cancelCount(uint64 actorId) view returns (uint8)",
  "function payableBinding(uint64 actorId) view returns (address destination, uint64 version)",
  "function monthlyRoots(uint32 period) view returns (bytes32)",
  "function monthlyReserves(uint32 period) view returns (bytes32 allocationDigest, uint128 total, uint128 remaining, uint32 count, uint64 admittedAt)",
  "function monthlyReleased(uint32 period) view returns (uint128)",
  "event AwardCommitted(bytes32 indexed id, uint64 indexed actorId, uint128 gross, uint128 fee, bytes32 sourceDigest)",
  "event DestinationBound(uint64 indexed actorId, address indexed destination, uint64 version, bytes32 claimDigest, uint64 activatesAt)",
  "event FeesClaimed(address indexed feeRecipient, uint128 amount)",
  "event Paid(bytes32 indexed id, uint64 indexed actorId, address indexed destination, uint64 version, uint128 gross, uint128 net, uint128 fee)",
  "event UnusedWithdrawn(address indexed destination, uint128 gross, uint128 net, uint128 fee)",
  "event MonthlyCommitmentSet(uint128 cap, bool enabled)",
  "event MonthlyCommitted(uint32 indexed period, bytes32 allocationRoot, uint128 gross, uint256 awards)",
  "event MonthlyReserved(uint32 indexed period, bytes32 allocationDigest, bytes32 allocationRoot, uint128 wholeGross, uint128 remainingGross, uint32 count, uint256 sourceSequence)",
]);

export const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address who, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function blockAddress(address who)",
]);

const proxyAbi = parseAbi(["constructor(address implementation, bytes _data) payable"]);

const evmRoot = fileURLToPath(new URL("../../evm/", import.meta.url));
const chainId = 31337;
const setupTime = 1_790_000_000;
const gasLimit = 15_000_000n;
const minted = 10n ** 24n;
export const implementationSlot: Hex = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const codeless: Address = "0x000000000000000000000000000000000000dEaD";

export class Unrepresentable extends Error {}

export interface Fixture extends AsyncDisposable {
  readonly chain: Anvil;
  readonly client: PublicClient;
  readonly accounts: Readonly<Record<Role, Account>>;
  readonly factoryLogic: readonly [Address, Address];
  readonly vaultLogic: readonly [Address, Address];
  readonly token: Address;
  readonly notUups: Address;
  readonly proxyBytecode: Hex;
  reset(): Promise<void>;
}

export async function launch(): Promise<Fixture> {
  const chain = await anvil({ chainId, timestamp: setupTime });
  await refuseMainnet({ url: chain.url, family: "evm" });
  if (chain.accounts.length < roles.length) throw new Error(`anvil offers ${chain.accounts.length} fixture accounts; the driver names ${roles.length}`);
  const accounts = Object.fromEntries(roles.map((role, index) => [role, chain.accounts[index]])) as Record<Role, Account>;
  const from = accounts.deployer.address;
  const build = await forgeBuild(evmRoot, ["src/ProjectEscrow.sol", "integration/TestDollar.sol"]);
  const path = (file: string, contract: string) => `${build.out}/${file}/${contract}.json`;
  const vault = path("ProjectEscrow.sol", "ProjectEscrow");
  const factory = path("ProjectEscrow.sol", "EscrowFactory");
  const dollar = path("TestDollar.sol", "TestDollar");
  const proxyBytecode = (await artifact(path("ERC1967Proxy.sol", "ERC1967Proxy"))).bytecode;
  const vaultLogic = [await deploy(chain, vault, [], from), await deploy(chain, vault, [], from)] as const;
  const factoryLogic = [await deploy(chain, factory, [], from), await deploy(chain, factory, [], from)] as const;
  const token = await deploy(chain, dollar, [], from);
  const notUups = await deploy(chain, dollar, [], from);
  await build.close();
  for (const role of roles) {
    const mint = await chain.transact({ from, to: token, data: encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [accounts[role].address, minted] }) });
    if (mint.status !== "success") throw new Error(`minting the test dollar for ${role} reverted`);
  }
  const client = createPublicClient({ transport: http(chain.url) });
  const snapshotTime = (await client.getBlock({ blockTag: "latest" })).timestamp;
  let snapshot = await chain.snapshot();
  return {
    chain,
    client,
    accounts,
    factoryLogic,
    vaultLogic,
    token,
    notUups,
    proxyBytecode,
    reset: async () => {
      await chain.revert(snapshot);
      await chain.rpc("evm_setTime", [toHex(snapshotTime)]);
      snapshot = await chain.snapshot();
    },
    [Symbol.asyncDispose]: () => chain.close(),
  };
}

export async function submit(fixture: Fixture, from: Address, call: { readonly to?: Address; readonly data: Hex; readonly value?: bigint }, at: number): Promise<TransactionReceipt> {
  await fixture.chain.rpc("evm_setNextBlockTimestamp", [toHex(at)]);
  const hash = await fixture.chain.rpc("eth_sendTransaction", [{ from, ...(call.to === undefined ? {} : { to: call.to }), data: call.data, value: toHex(call.value ?? 0n), gas: toHex(gasLimit) }]);
  if (typeof hash !== "string" || !isHex(hash)) throw new Error("eth_sendTransaction answered no hash");
  return fixture.client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
}

export const send = async (fixture: Fixture, from: Address, call: { readonly to?: Address; readonly data: Hex; readonly value?: bigint }, at: number) =>
  (await submit(fixture, from, call, at)).status === "success";

export async function withoutFunds(fixture: Fixture, holder: Address, run: () => Promise<boolean>): Promise<boolean> {
  const balance = await fixture.client.getBalance({ address: holder });
  await fixture.chain.rpc("anvil_setBalance", [holder, toHex(0n)]);
  const accepted = await run();
  await fixture.chain.rpc("anvil_setBalance", [holder, toHex(balance)]);
  return accepted;
}

export async function blocking(fixture: Fixture, recipient: Address, at: number, run: () => Promise<boolean>): Promise<boolean> {
  const block = (who: Address) => send(fixture, fixture.accounts.deployer.address, { to: fixture.token, data: encodeFunctionData({ abi: tokenAbi, functionName: "blockAddress", args: [who] }) }, at);
  if (!(await block(recipient))) throw new Error("blocking a test dollar recipient reverted");
  const accepted = await run();
  if (!(await block(zeroAddress))) throw new Error("unblocking the test dollar reverted");
  return accepted;
}

export function uint(value: number, bits: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || BigInt(value) >= 2n ** BigInt(bits)) throw new Unrepresentable(`${value} is not a uint${bits}`);
  return BigInt(value);
}

export const small = (value: number, bits: number): number => Number(uint(value, bits));

export const count = (value: bigint): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${value} read from the chain is beyond 2^53`);
  return Number(value);
};

export function word(name: string): Hex {
  if (name === "") return zeroHash;
  if (new TextEncoder().encode(name).length > 32) throw new Unrepresentable(`"${name}" does not fit in bytes32`);
  return stringToHex(name, { size: 32 });
}

export const wordName = (value: Hex): string => hexToString(value, { size: 32 });

export const digestOf = (source: number): Hex => pad(toHex(uint(source, 256)), { size: 32 });

export const awardId = (vault: Address, sourceDigest: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "bytes32" }], [BigInt(chainId), vault, sourceDigest]));

export const entry = (leaf: Leaf) => ({ actorId: uint(leaf.actor, 64), gross: uint(leaf.gross, 128), sourceDigest: digestOf(leaf.source) });

const leafHash = (leaf: Leaf): Hex => {
  const { actorId, gross, sourceDigest } = entry(leaf);
  return keccak256(encodePacked(["uint8", "uint64", "uint128", "bytes32"], [0, actorId, gross, sourceDigest]));
};

const fold = <T>(level: readonly T[], join: (left: T, right: T) => T): readonly T[] =>
  Array.from({ length: Math.ceil(level.length / 2) }, (_, i) => (2 * i + 1 < level.length ? join(level[2 * i], level[2 * i + 1]) : level[2 * i]));

export function allocationRoot(leaves: readonly Leaf[]): Hex {
  let level = leaves.map(leafHash);
  while (level.length > 1) level = [...fold(level, (left, right) => keccak256(encodePacked(["uint8", "bytes32", "bytes32"], [1, left, right])))];
  return level[0] ?? zeroHash;
}

interface SumNode {
  readonly hash: Hex;
  readonly total: bigint;
}

const sumNode = (left: SumNode, right: SumNode): SumNode => ({
  hash: keccak256(encodePacked(["uint8", "bytes32", "uint128", "bytes32", "uint128"], [1, left.hash, left.total, right.hash, right.total])),
  total: left.total + right.total,
});

const sumLeaves = (leaves: readonly Leaf[]): readonly SumNode[] => leaves.map((leaf) => ({ hash: leafHash(leaf), total: uint(leaf.gross, 128) }));

export function sumRoot(leaves: readonly Leaf[]): Hex {
  let level = sumLeaves(leaves);
  while (level.length > 1) level = fold(level, sumNode);
  return level[0]?.hash ?? zeroHash;
}

export function sumProof(leaves: readonly Leaf[], index: number): readonly SumNode[] {
  const proof: SumNode[] = [];
  let level = sumLeaves(leaves);
  for (let at = index; level.length > 1; at = Math.floor(at / 2)) {
    if (at % 2 === 1 || at + 1 < level.length) proof.push(level[at % 2 === 1 ? at - 1 : at + 1]);
    level = fold(level, sumNode);
  }
  return proof;
}

const domain = (vault: Address) => ({ name: "SlopProjectEscrow", version: "5", chainId, verifyingContract: vault }) as const;

const sign = (key: Hex, digest: Hex): Promise<Hex> => privateKeyToAccount(key).sign({ hash: digest });

export const signBinding = (key: Hex, vault: Address, message: { actorId: bigint; destination: Address; expectedVersion: bigint; claimDigest: Hex; expiresAt: bigint }) =>
  sign(key, hashTypedData({
    domain: domain(vault),
    types: { DestinationBinding: [
      { name: "actorId", type: "uint64" }, { name: "destination", type: "address" }, { name: "expectedVersion", type: "uint64" },
      { name: "claimDigest", type: "bytes32" }, { name: "expiresAt", type: "uint64" },
    ] },
    primaryType: "DestinationBinding",
    message,
  }));

export const signAllocation = (key: Hex, vault: Address, message: { period: number; allocationRoot: Hex }) =>
  sign(key, hashTypedData({
    domain: domain(vault),
    types: { MonthlyAllocation: [{ name: "period", type: "uint32" }, { name: "allocationRoot", type: "bytes32" }] },
    primaryType: "MonthlyAllocation",
    message,
  }));

export const signReservation = (key: Hex, vault: Address, message: { period: number; allocationDigest: Hex; allocationRoot: Hex; wholeGross: bigint; remainingGross: bigint; count: number; sourceSequence: bigint }) =>
  sign(key, hashTypedData({
    domain: domain(vault),
    types: { MonthlyReserveV2: [
      { name: "period", type: "uint32" }, { name: "allocationDigest", type: "bytes32" }, { name: "allocationRoot", type: "bytes32" },
      { name: "wholeGross", type: "uint128" }, { name: "remainingGross", type: "uint128" }, { name: "count", type: "uint32" },
      { name: "sourceSequence", type: "uint256" },
    ] },
    primaryType: "MonthlyReserveV2",
    message,
  }));

export const signRelease = (key: Hex, vault: Address, message: { period: number; allocationDigest: Hex; allocationRoot: Hex; remainingGross: bigint; releasedGross: bigint }) =>
  sign(key, hashTypedData({
    domain: domain(vault),
    types: { MonthlyRelease: [
      { name: "period", type: "uint32" }, { name: "allocationDigest", type: "bytes32" }, { name: "allocationRoot", type: "bytes32" },
      { name: "remainingGross", type: "uint128" }, { name: "releasedGross", type: "uint128" },
    ] },
    primaryType: "MonthlyRelease",
    message,
  }));

export const deployProxy = (fixture: Fixture, implementation: Address, initialization: Hex): Hex =>
  encodeDeployData({ abi: proxyAbi, bytecode: fixture.proxyBytecode, args: [implementation, initialization] });
