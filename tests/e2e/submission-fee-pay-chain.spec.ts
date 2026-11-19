/**
 * The pay page against a real local chain and the compiled
 * `SubmissionDeposits` contract. A browser wallet that forwards to Anvil
 * approves and deposits through the page; the test then reads the deposit
 * from the contract itself and has the resolver refund it. Public Anvil keys
 * only: no production RPC, credentials or funds.
 *
 *   SLOP_E2E_VAULT_ACTIONS=1 SLOP_E2E_LANE=preview \
 *     bun run test:e2e tests/e2e/submission-fee-pay-chain.spec.ts --workers=1
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import {
  SUBMISSION_FEE_BURN,
  type SubmissionFeeTerms,
} from "../../src/lib/submission-fee.mjs";
import { expect, test } from "./fixtures";
import {
  feeRecord,
  installWallet,
  serveFeeRecord,
  switchFeeOn,
} from "./submission-fee-pay-fixture";

test.skip(
  process.env.SLOP_E2E_VAULT_ACTIONS !== "1",
  "Requires the explicit local Anvil funding workflow run.",
);
test.describe.configure({ mode: "serial" });
test.use({ actionTimeout: 15_000 });

const root = fileURLToPath(new URL("../..", import.meta.url));
// Public Anvil mnemonic accounts: 0 owns, 1 resolves, 3 is the fee wallet, 4 pays.
const owner = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const resolver = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const feeWallet = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const payer = "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65";
const REPOSITORY = 826170402;
const FEE = 2_000_000n;
const FUNDED = 10_000_000n;
const anvilPort = Number(process.env.SLOP_E2E_FEE_ANVIL_PORT ?? "18771");
if (!Number.isInteger(anvilPort) || anvilPort < 1024 || anvilPort > 65535)
  throw new Error("SLOP_E2E_FEE_ANVIL_PORT must be an unprivileged TCP port");
const rpcUrl = `http://127.0.0.1:${anvilPort}`;
const abi = parseAbi([
  "function mint(address,uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function depositCount() view returns (uint256)",
  "function deposits(uint256) view returns ((address payer, address token, uint128 amount, address keptTo, bytes32 item, uint64 depositedAt, uint8 state))",
  "function resolve(uint256 id, bool refund)",
]);
let anvil: ChildProcess;
let token: string;
let contract: string;
let tables: SubmissionFeeTerms;

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
/** One view call on the local chain, decoded with the ABI above. */
async function read(
  to: string,
  functionName: "balanceOf" | "allowance" | "depositCount" | "deposits",
  args: readonly unknown[],
): Promise<unknown> {
  return decodeFunctionResult({
    abi,
    functionName,
    data: await rpc("eth_call", [
      { to, data: encodeFunctionData({ abi, functionName, args } as never) },
      "latest",
    ]),
  } as never);
}
const sendAndWait = async (from: string, to: string, data: string) => {
  const hash = await rpc("eth_sendTransaction", [
    { from, to, data, gas: "0x100000" },
  ]);
  await expect
    .poll(async () => (await rpc("eth_getTransactionReceipt", [hash]))?.status)
    .toBe("0x1");
};

test.beforeAll(async () => {
  let output = "";
  let startupError: Error | undefined;
  // Base's chain id, so the page's own network check is the one that ships.
  anvil = spawn("anvil", ["--port", String(anvilPort), "--chain-id", "8453"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  anvil.on("error", (error) => {
    startupError = error;
  });
  for (const stream of [anvil.stdout, anvil.stderr])
    stream?.on("data", (chunk) => {
      output = (output + String(chunk)).slice(-4096);
    });
  for (let i = 0; i < 100; i++) {
    if (startupError || anvil.exitCode !== null || anvil.signalCode !== null)
      throw new Error(
        `Local Anvil startup failed: ${startupError?.message ?? output}`,
      );
    if (output.includes(`Listening on 127.0.0.1:${anvilPort}`)) {
      await rpc("eth_chainId", []);
      break;
    }
    if (i === 99) throw new Error(`Local Anvil startup timed out: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const deploy = (name: string, args: string[] = []) =>
    (
      JSON.parse(
        execFileSync(
          "forge",
          [
            "create",
            "--root",
            `${root}/contracts/evm`,
            name,
            "--rpc-url",
            rpcUrl,
            "--unlocked",
            "--from",
            owner,
            "--broadcast",
            "--json",
            ...(args.length ? ["--constructor-args", ...args] : []),
          ],
          { encoding: "utf8" },
        ),
      ).deployedTo as string
    ).toLowerCase();
  token = deploy("integration/TestDollar.sol:TestDollar");
  // The contract as deployed on mainnet: same source, 30-day reclaim delay.
  contract = deploy("src/SubmissionDeposits.sol:SubmissionDeposits", [
    owner,
    resolver,
    String(30 * 24 * 60 * 60),
  ]);
  await sendAndWait(
    owner,
    token,
    encodeFunctionData({
      abi,
      functionName: "mint",
      args: [payer as `0x${string}`, FUNDED],
    }),
  );
  // The local chain's addresses stand in for the published tables.
  tables = {
    tokens: { "base-mainnet": { usdc: token } },
    contracts: { "base-mainnet": contract },
    keptTo: { "base-mainnet": feeWallet },
    chainIds: { "base-mainnet": 8453 },
    burn: SUBMISSION_FEE_BURN,
  };
});
test.afterAll(() => anvil?.kill("SIGTERM"));

test.beforeEach(async ({ diagnostics }) => {
  diagnostics.allowPreviewApiMisses();
});

test("a wallet pays the real deposit contract through the page, and the resolver refunds that deposit", async ({
  page,
}, info) => {
  // The desktop and the 320 px run share one chain; each pays its own pull request.
  const pullNumber = info.project.name.endsWith("mobile") ? 8 : 7;
  const record = feeRecord(REPOSITORY, pullNumber, tables);
  expect(record.due).toHaveLength(1);
  const before = Number(await read(contract, "depositCount", []));
  await serveFeeRecord(page, REPOSITORY, pullNumber, () => record);
  await switchFeeOn(page, tables);
  const sent: { to: string }[] = [];
  await installWallet(page, async (method, params) => {
    if (method === "eth_accounts" || method === "eth_requestAccounts")
      return [payer];
    if (method === "eth_sendTransaction")
      sent.push(params[0] as { to: string });
    try {
      return await rpc(method, params);
    } catch (error) {
      // Anvil does not batch (EIP-5792); the wallet says so, as wallets do.
      if (method.startsWith("wallet_")) return { walletError: 4200 };
      throw error;
    }
  });
  await page.goto(`/fee/elizaOS/eliza/${pullNumber}`, {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByRole("region", { name: "Fee due" }).getByRole("listitem"),
  ).toHaveText(["2 USDC on Base"]);
  await page
    .getByRole("button", { name: "Pay from a wallet", exact: true })
    .click();
  const pay = page.getByRole("region", { name: "Pay the fee" });
  await pay
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await pay
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  const review = pay.getByRole("region", { name: "Review deposit" });
  await expect(review).toContainText(contract);
  await expect(review).toContainText(token);
  await expect(review).toContainText(feeWallet);

  // The exact approval, checked on chain without a click.
  await review
    .getByRole("button", {
      name: "Approve exact token amount in wallet",
      exact: true,
    })
    .click();
  const confirm = pay.getByRole("button", {
    name: "Confirm deposit in wallet",
    exact: true,
  });
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  expect(await read(token, "allowance", [payer, contract])).toBe(FEE);
  expect(await read(contract, "depositCount", [])).toBe(BigInt(before));

  await confirm.click();
  await expect(pay.getByRole("status")).toContainText(
    "Deposit received in a Base block.",
    { timeout: 30_000 },
  );
  expect(sent.map((transaction) => transaction.to.toLowerCase())).toEqual([
    token,
    contract,
  ]);
  // The contract's own record: this payer, token, amount, kept-to address and item.
  const id = BigInt(before + 1);
  expect(await read(contract, "depositCount", [])).toBe(id);
  const stored = (await read(contract, "deposits", [id])) as {
    payer: string;
    token: string;
    amount: bigint;
    keptTo: string;
    item: string;
    state: number;
  };
  expect({
    payer: stored.payer.toLowerCase(),
    token: stored.token.toLowerCase(),
    amount: stored.amount,
    keptTo: stored.keptTo.toLowerCase(),
    item: stored.item,
    state: stored.state,
  }).toEqual({
    payer,
    token,
    amount: FEE,
    keptTo: feeWallet,
    item: record.item,
    // Open: held by the contract until the resolver settles it.
    state: 1,
  });
  const afterDeposit = (await read(token, "balanceOf", [payer])) as bigint;

  // Final on chain: the page finishes its saved request by itself.
  await rpc("anvil_mine", ["0x80"]);
  await expect(pay.getByRole("status")).toContainText(
    "Deposit verified on the finalized Base chain.",
    { timeout: 30_000 },
  );
  await expect(
    pay.getByText("awaiting verification", { exact: false }),
  ).toHaveCount(0);

  // A merge refunds: the resolver sends that deposit back to the wallet that paid.
  await sendAndWait(
    resolver,
    contract,
    encodeFunctionData({ abi, functionName: "resolve", args: [id, true] }),
  );
  expect(await read(token, "balanceOf", [payer])).toBe(afterDeposit + FEE);
  expect(await read(token, "balanceOf", [feeWallet])).toBe(0n);
});
