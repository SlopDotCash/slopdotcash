// spec/settlement/referralDistributor.md, "Only exact token deposits increase the balance"; spec/settlement/referralDistributor.md, "Voiding the latest unclaimed epoch restores prior live spacing and high water"
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Account, type Anvil, anvil, deploy, forgeBuild } from "@repo/platform/testing/chains";
import { type Address, type Hex, encodeFunctionData, keccak256, parseAbi } from "viem";

const contracts = new URL("../../../../packages/contracts/evm", import.meta.url).pathname;
const sources = ["src/ReferralDistributor.sol", "integration/MockReferralToken.sol"];
const tokenAbi = parseAbi(["function mint(address to, uint256 amount)", "function transfer(address to, uint256 amount) returns (bool)"]);
const distributorAbi = parseAbi(["function voidRoot(uint256 index)", "function pause()", "function claim(uint256 cumulative, bytes32[] proof)"]);

export const TOKEN_UNIT = 10n ** 18n;
export const POOL_BASE = 2_000_000n * TOKEN_UNIT;

export interface ReferralChain extends AsyncDisposable {
  readonly chain: Anvil;
  readonly owner: Account;
  readonly poster: Account;
  readonly funder: Account;
  readonly referrer: Account;
  readonly token: Address;
  readonly distributor: Address;
  readonly deploymentBlock: bigint;
  readonly codeHash: Hex;
  voidRoot(epoch: number): Promise<void>;
  claim(wallet: Address, cumulative: bigint, proof: ReadonlyArray<Hex>): Promise<void>;
  close(): Promise<void>;
}

/** @throws {Error} */
function account(chain: Anvil, index: number): Account {
  const found = chain.accounts[index];
  if (found === undefined) throw new Error(`anvil has no account ${index}`);
  return found;
}

/** @throws {never} */
export async function referralChain(postSpacing = 0n, timestamp?: number): Promise<ReferralChain> {
  const built = await forgeBuild(contracts, sources);
  const chain = await anvil({ chainId: 46630, finalityDepth: 0, ...(timestamp === undefined ? {} : { timestamp }) });
  const [owner, poster, funder, referrer] = [account(chain, 0), account(chain, 1), account(chain, 2), account(chain, 3)];
  const token = await deploy(chain, join(built.out, "MockReferralToken.sol/MockReferralToken.json"), [], funder.address);
  const distributor = await deploy(chain, join(built.out, "ReferralDistributor.sol/ReferralDistributor.json"), [token, owner.address, poster.address, POOL_BASE, postSpacing], owner.address);
  await chain.transact({ from: funder.address, to: token, data: encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [funder.address, POOL_BASE] }) });
  const funded = await chain.transact({ from: funder.address, to: token, data: encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [distributor, POOL_BASE] }) });
  const code = await chain.rpc("eth_getCode", [distributor, "latest"]);
  if (typeof code !== "string") throw new Error("the distributor has no code");
  const close = async () => {
    await chain.close();
    await built.close();
  };
  return {
    chain, owner, poster, funder, referrer, token: token.toLowerCase() as Address, distributor: distributor.toLowerCase() as Address,
    deploymentBlock: funded.blockNumber - 3n,
    codeHash: keccak256(code as Hex),
    voidRoot: async (epoch) => {
      await chain.transact({ from: owner.address, to: distributor, data: encodeFunctionData({ abi: distributorAbi, functionName: "voidRoot", args: [BigInt(epoch)] }) });
    },
    claim: async (wallet, cumulative, proof) => {
      await chain.transact({ from: wallet, to: distributor, data: encodeFunctionData({ abi: distributorAbi, functionName: "claim", args: [cumulative, [...proof]] }) });
    },
    close,
    [Symbol.asyncDispose]: close,
  };
}

/** @throws {Error} */
export function bundleText(path: string): string {
  return readFileSync(path, "utf8");
}
