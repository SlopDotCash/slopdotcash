// spec/fees/conversion.md, "Story: Sign only a reserved, inspected, same-wallet send"; spec/fees/conversion.md, "Only a finalized receipt of one of the row's own attempts settles it"; spec/fees/buyback.md, "Story: Bridge the available share through one exact order at a time"
import type { Handler } from "@repo/platform/testing";
import { type Anvil, type ForgeOutput, artifact, forgeBuild, refuseMainnet } from "@repo/platform/testing/chains";
import { type QuotesFake, kyberNative, parsedJson } from "@repo/platform/testing/quotes";
import { Response } from "miniflare";
import { type Address, type Hex, decodeFunctionData, decodeFunctionResult, encodeFunctionData, erc20Abi, parseAbi } from "viem";
import { kyberRouterAbi } from "../../../src/kyber/swap.ts";
import { baseGasPriceOracle, kyberswap } from "../../../src/runtime/pins.ts";

export interface FeeTokens {
  readonly chain: Anvil;
  readonly feeToken: Address;
  readonly dustToken: Address;
  readonly usdc: Address;
}

export const unit = 10n ** 18n;
export const router = kyberswap.router as Address;

const contracts = new URL("../../../../../packages/contracts/evm", import.meta.url).pathname;
const fixtureFile = "FeeConverterFixture.sol";
const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const simpleModeCaller = "0x0000000000000000000000000000000000000001" as Address;
const routerFunding = 10_000_000_000n;
const zeroWordCode = "0x60206000f3" as Hex;

function lower(address: Address): Address {
  return address.toLowerCase() as Address;
}

function quantity(value: unknown, what: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]*$/iu.test(value)) throw new Error(`${what} answered no quantity`);
  return value === "0x" ? 0n : BigInt(value);
}

export function fixtureBuild(): Promise<ForgeOutput> {
  return forgeBuild(contracts, [`test/${fixtureFile}`]);
}

function deployer(chain: Anvil): Address {
  const [first] = chain.accounts;
  if (first === undefined) throw new Error("anvil has no accounts");
  return first.address;
}

export async function mint(chain: Anvil, token: Address, to: Address, amount: bigint): Promise<void> {
  const receipt = await chain.transact({ from: deployer(chain), to: token, data: encodeFunctionData({ abi: mintAbi, functionName: "mint", args: [to, amount] }) });
  if (receipt.status !== "success") throw new Error(`minting ${token} reverted in ${receipt.transactionHash}`);
}

export async function feeTokens(chain: Anvil, out: string, usdcAt: Address): Promise<FeeTokens> {
  await refuseMainnet({ url: chain.url, family: "evm" });
  const from = deployer(chain);
  const created = async (name: string) => {
    const { bytecode } = await artifact(`${out}/${fixtureFile}/${name}.json`);
    const receipt = await chain.transact({ from, data: bytecode });
    if (receipt.contractAddress === undefined) throw new Error(`${name} was not deployed`);
    return receipt.contractAddress;
  };
  const feeToken = await created("FeeConverterToken");
  const dustToken = await created("FeeConverterToken");
  await chain.rpc("anvil_setCode", [usdcAt, await chain.rpc("eth_getCode", [await created("FeeConverterUSDC"), "latest"])]);
  await chain.rpc("anvil_setCode", [router, await chain.rpc("eth_getCode", [await created("FeeConverterRouter"), "latest"])]);
  await chain.rpc("anvil_setCode", [baseGasPriceOracle.address, await chain.rpc("eth_getCode", [await created("FeeConverterL1Oracle"), "latest"])]);
  await mint(chain, usdcAt, router, routerFunding);
  return { chain, feeToken: lower(feeToken), dustToken: lower(dustToken), usdc: lower(usdcAt) };
}

async function read(chain: Anvil, to: Address, data: Hex): Promise<Hex> {
  const answer = await chain.rpc("eth_call", [{ to, data }, "latest"]);
  if (typeof answer !== "string") throw new Error(`eth_call to ${to} answered no data`);
  return answer as Hex;
}

export async function balanceOf(chain: Anvil, token: Address, owner: Address): Promise<bigint> {
  const data = await read(chain, token, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] }));
  return decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data });
}

export async function allowanceOf(chain: Anvil, token: Address, owner: Address, spender: Address): Promise<bigint> {
  const data = await read(chain, token, encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner, spender] }));
  return decodeFunctionResult({ abi: erc20Abi, functionName: "allowance", data });
}

export async function nonceOf(chain: Anvil, address: Address): Promise<bigint> {
  return quantity(await chain.rpc("eth_getTransactionCount", [address, "latest"]), "eth_getTransactionCount");
}

export async function landed(chain: Anvil, txId: string): Promise<boolean> {
  const receipt = await chain.rpc("eth_getTransactionReceipt", [txId]);
  return typeof receipt === "object" && receipt !== null && "status" in receipt && receipt.status === "0x1";
}

export async function finalize(chain: Anvil): Promise<void> {
  await chain.mine(65);
}

export async function zeroFeeSource(chain: Anvil, source: Address): Promise<void> {
  await chain.rpc("anvil_setCode", [source, zeroWordCode]);
}

/** @throws {never} */
export function kyberRoutes(quotes: QuotesFake, tokens: FeeTokens): void {
  const chain = "base";
  quotes.kyberswap.route({ chain, tokenIn: tokens.feeToken, tokenOut: tokens.usdc, amountOut: (amountIn) => amountIn / 2_000_000_000_000n, routerAddress: router, amountInUsd: "1000", amountOutUsd: "1000", gasUsd: "0.5", l1FeeUsd: "0" });
  quotes.kyberswap.route({ chain, tokenIn: tokens.dustToken, tokenOut: tokens.usdc, amountOut: (amountIn) => amountIn / 1_000_000_000n, routerAddress: router, amountInUsd: "6", amountOutUsd: "6", gasUsd: "0.01", l1FeeUsd: "0" });
  quotes.kyberswap.route({ chain, tokenIn: kyberNative, tokenOut: tokens.usdc, amountOut: (wei) => (wei * 3n) / 1_000_000_000n, routerAddress: router, gasUsd: "0", l1FeeUsd: "0" });
}

/** @throws {never} */
export function simpleModeRouter(handler: Handler): Handler {
  return async (request) => {
    const answer = await handler(request);
    if (!new URL(request.url).pathname.endsWith("/route/build") || answer.status !== 200) return answer;
    const body = parsedJson(await answer.text()) as { readonly data: { readonly data: Hex } };
    const decoded = decodeFunctionData({ abi: kyberRouterAbi, data: body.data.data });
    if (decoded.functionName !== "swap") return Response.json(body);
    const data = encodeFunctionData({ abi: kyberRouterAbi, functionName: "swapSimpleMode", args: [simpleModeCaller, decoded.args[0].desc, "0x", "0x"] });
    return Response.json({ ...body, data: { ...body.data, data } });
  };
}
