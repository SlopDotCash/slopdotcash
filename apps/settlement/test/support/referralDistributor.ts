// spec/settlement/referralDistributor.md, "Deployment fixes token, growth cap and spacing, with distinct owner and poster"; spec/settlement/referralDistributor.md, "The wallet signs a valid active-root claim and receives its exact difference"
import { fileURLToPath } from "node:url";
import { type Account, type Anvil, anvil, artifact, deploy, forgeBuild, refuseMainnet } from "@repo/platform/testing/chains";
import { type Address, type Hex, type PublicClient, type TransactionReceipt, concat, createPublicClient, encodeAbiParameters, encodeFunctionData, http, isHex, keccak256, parseAbi, toHex } from "viem";

export const parties = ["deployer", "owner", "poster", "successor", "nextPoster", "wallet", "wrong"] as const;
export type Party = (typeof parties)[number];
export const isParty = (name: unknown): name is Party => parties.some((party) => party === name);

export const distributorAbi = parseAbi([
  "constructor(address token_, address owner_, address poster_, uint256 epochCap_, uint64 postSpacing_)",
  "function token() view returns (address)",
  "function epochCap() view returns (uint256)",
  "function postSpacing() view returns (uint64)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function poster() view returns (address)",
  "function paused() view returns (bool)",
  "function epochCount() view returns (uint256)",
  "function epochAt(uint256 index) view returns ((bytes32 root, uint256 total, uint64 postedAt, bool voided))",
  "function totalClaimed() view returns (uint256)",
  "function claimed(address account) view returns (uint256)",
  "function lastUnpausedAt() view returns (uint64)",
  "function postRoot(uint256 index, bytes32 root, uint256 newTotal)",
  "function voidRoot(uint256 index)",
  "function pause()",
  "function unpause()",
  "function setPoster(address newPoster)",
  "function transferOwnership(address newOwner)",
  "function acceptOwnership()",
  "function rescue(address to)",
  "function claim(uint256 cumulative, bytes32[] proof)",
  "event Rescued(address indexed to, uint256 amount)",
]);

export const dollarAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address who) view returns (uint256)",
  "function blockAddress(address who)",
]);

const evmRoot = fileURLToPath(new URL("../../../../packages/contracts/evm/", import.meta.url));
const chainId = 31337;
const setupTime = 1_790_000_000;
const gasLimit = 15_000_000n;
const minted = 10n ** 30n;

export class Unrepresentable extends Error {}

export interface ReferralFixture extends AsyncDisposable {
  readonly chain: Anvil;
  readonly client: PublicClient;
  readonly accounts: Readonly<Record<Party, Account>>;
  readonly tokens: Readonly<Record<"token" | "wrong", Address>>;
  readonly distributorBytecode: Hex;
  readonly epoch: number;
  reset(): Promise<void>;
}

export async function launchReferral(): Promise<ReferralFixture> {
  const chain = await anvil({ chainId, timestamp: setupTime });
  await refuseMainnet({ url: chain.url, family: "evm" });
  if (chain.accounts.length < parties.length) throw new Error(`anvil offers ${chain.accounts.length} fixture accounts; the driver names ${parties.length}`);
  const accounts = Object.fromEntries(parties.map((party, index) => [party, chain.accounts[index]])) as Record<Party, Account>;
  const from = accounts.deployer.address;
  const build = await forgeBuild(evmRoot, ["src/ReferralDistributor.sol", "integration/TestDollar.sol"]);
  const dollar = `${build.out}/TestDollar.sol/TestDollar.json`;
  const tokens = { token: await deploy(chain, dollar, [], from), wrong: await deploy(chain, dollar, [], from) };
  for (const token of Object.values(tokens)) {
    const mint = await chain.transact({ from, to: token, data: encodeFunctionData({ abi: dollarAbi, functionName: "mint", args: [from, minted] }) });
    if (mint.status !== "success") throw new Error("minting the test dollar for the deployer reverted");
  }
  const { bytecode } = await artifact(`${build.out}/ReferralDistributor.sol/ReferralDistributor.json`);
  await build.close();
  const client = createPublicClient({ transport: http(chain.url) });
  const epoch = Number((await client.getBlock({ blockTag: "latest" })).timestamp);
  let snapshot = await chain.snapshot();
  return {
    chain,
    client,
    accounts,
    tokens,
    distributorBytecode: bytecode,
    epoch,
    reset: async () => {
      await chain.revert(snapshot);
      await chain.rpc("evm_setTime", [toHex(epoch)]);
      snapshot = await chain.snapshot();
    },
    [Symbol.asyncDispose]: () => chain.close(),
  };
}

export async function submitAt(fixture: ReferralFixture, from: Address, call: { readonly to?: Address; readonly data: Hex }, at: number): Promise<TransactionReceipt> {
  await fixture.chain.rpc("evm_setNextBlockTimestamp", [toHex(fixture.epoch + at)]);
  const hash = await fixture.chain.rpc("eth_sendTransaction", [{ from, ...(call.to === undefined ? {} : { to: call.to }), data: call.data, gas: toHex(gasLimit) }]);
  if (typeof hash !== "string" || !isHex(hash)) throw new Error("eth_sendTransaction answered no hash");
  return fixture.client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
}

export async function refusingTransfersTo(fixture: ReferralFixture, token: Address, recipient: Address, at: number, run: () => Promise<boolean>): Promise<boolean> {
  const block = async (who: Address) => {
    const receipt = await submitAt(fixture, fixture.accounts.deployer.address, { to: token, data: encodeFunctionData({ abi: dollarAbi, functionName: "blockAddress", args: [who] }) }, at);
    if (receipt.status !== "success") throw new Error("blocking a test dollar recipient reverted");
  };
  await block(recipient);
  const accepted = await run();
  await block("0x0000000000000000000000000000000000000000");
  return accepted;
}

export const leafOf = (account: Address, cumulative: bigint): Hex =>
  keccak256(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [account, cumulative])));

const pair = (a: Hex, b: Hex): Hex => (BigInt(a) <= BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a])));

export interface Tree {
  readonly root: Hex;
  proof(leaf: Hex): readonly Hex[] | undefined;
}

export function treeOf(leaves: readonly Hex[]): Tree {
  const levels: Hex[][] = [[...new Set(leaves)].sort()];
  while (levels.at(-1)!.length > 1) {
    const below = levels.at(-1)!;
    const above: Hex[] = [];
    for (let i = 0; i < below.length; i += 2) above.push(i + 1 < below.length ? pair(below[i], below[i + 1]) : below[i]);
    levels.push(above);
  }
  return {
    root: levels.at(-1)![0],
    proof: (leaf) => {
      let index = levels[0].indexOf(leaf);
      if (index < 0) return undefined;
      const proof: Hex[] = [];
      for (const level of levels.slice(0, -1)) {
        const sibling = index % 2 === 0 ? index + 1 : index - 1;
        if (sibling < level.length) proof.push(level[sibling]);
        index = Math.floor(index / 2);
      }
      return proof;
    },
  };
}
