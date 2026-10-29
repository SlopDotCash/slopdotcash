/** Browser-to-Anvil workflow. No production RPC, credentials or funds are used. */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { encodeFunctionData, parseAbi } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import {
  buildCreateVaultCalldata,
  EVM_ESCROW_EVENT_TOPICS,
  evmVaultKey,
  readEvmMonthlyCommitment,
  verifyEvmDeployment,
  verifyEvmFactory,
} from "../../contracts/evm/adapter";
import {
  captureUpgrade,
  deployUpgradeableFactory,
} from "../../contracts/evm/integration/upgrade";
import { formatBaseUnits } from "../../src/lib/base-units.mjs";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
} from "../../src/lib/escrow-policy.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";
import {
  applicationManifest,
  CONTRIBUTION,
} from "../project-application-manifest";
import { enlargeText } from "../text-size";
import {
  escapeRegExp,
  expect,
  expectAccessible,
  openProjectSecuritySettings,
  serveProjectCycleIndex,
  test,
} from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";

test.skip(
  process.env.SLOP_E2E_VAULT_ACTIONS !== "1",
  "Requires the explicit local Anvil funding workflow run.",
);
test.describe.configure({ mode: "serial" });
test.use({ actionTimeout: 15_000 });
const root = fileURLToPath(new URL("../..", import.meta.url));
const owner = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const attester = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const registrar = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const fee = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const donor = "0x15d34aaf54267db7d7c367839aaF71a00a2C6A65".toLowerCase();
const anvilPort = Number(process.env.SLOP_E2E_ANVIL_PORT ?? "18761");
if (!Number.isInteger(anvilPort) || anvilPort < 1024 || anvilPort > 65535)
  throw new Error("SLOP_E2E_ANVIL_PORT must be an unprivileged TCP port");
const rpcUrl = `http://127.0.0.1:${anvilPort}`;
let anvil: ChildProcess;
let deployment: EscrowDeployment;
let project: (typeof PROJECTS)[number];
let otherToken: string;
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
const abi = parseAbi([
  "function mint(address,uint256)",
  "function create(bytes32,address,uint8)",
  "function vaults(bytes32) view returns (address)",
  "function balanceOf(address) view returns (uint256)",
]);

test.beforeAll(async () => {
  let listening = false;
  let output = "";
  let startupError: Error | undefined;
  anvil = spawn("anvil", ["--port", String(anvilPort), "--chain-id", "84532"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  anvil.on("error", (error) => {
    startupError = error;
  });
  anvil.stdout?.on("data", (chunk) => {
    output = (output + String(chunk)).slice(-4096);
    listening = output.includes(`Listening on 127.0.0.1:${anvilPort}`);
  });
  anvil.stderr?.on("data", (chunk) => {
    output = (output + String(chunk)).slice(-4096);
  });
  for (let i = 0; i < 100; i++) {
    if (startupError || anvil.exitCode !== null || anvil.signalCode !== null)
      throw new Error(
        `Local Anvil startup failed: ${startupError?.message ?? output}`,
      );
    if (listening) {
      await rpc("eth_chainId", []);
      break;
    }
    if (i === 99) throw new Error(`Local Anvil startup timed out: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const deploy = (contract: string, args: string[] = []) =>
    JSON.parse(
      execFileSync(
        "forge",
        [
          "create",
          "--root",
          `${root}/contracts/evm`,
          contract,
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
    );
  const token = deploy(
    "integration/TestDollar.sol:TestDollar",
  ).deployedTo.toLowerCase() as `0x${string}`;
  otherToken = deploy("integration/TestDollar.sol:TestDollar").deployedTo;
  const factory = deployUpgradeableFactory(
    (contract, args) => deploy(contract, args).deployedTo,
    [registrar, fee, attester, "3600"],
  ).toLowerCase() as `0x${string}`;
  const projectDigest = `0x${"a".repeat(64)}` as `0x${string}`;
  const createHashId = await rpc("eth_sendTransaction", [
    {
      from: owner,
      to: factory,
      gas: "0x7a1200",
      data: encodeFunctionData({
        abi,
        functionName: "create",
        args: [projectDigest, token, 0],
      }),
    },
  ]);
  await expect
    .poll(async () => {
      const receipt = await rpc("eth_getTransactionReceipt", [createHashId]);
      return receipt?.status;
    })
    .toBe("0x1");
  const encoded = await rpc("eth_call", [
    {
      to: factory,
      data: encodeFunctionData({
        abi,
        functionName: "vaults",
        args: [
          evmVaultKey({
            owner,
            projectId: projectDigest,
            asset: token,
          }) as `0x${string}`,
        ],
      }),
    },
    "latest",
  ]);
  const vault = `0x${encoded.slice(-40)}`;
  await rpc("eth_sendTransaction", [
    {
      from: owner,
      to: token,
      gas: "0x100000",
      data: encodeFunctionData({
        abi,
        functionName: "mint",
        args: [donor as `0x${string}`, 100_000_000n],
      }),
    },
  ]);
  await rpc("anvil_mine", ["0x40"]);
  const digest = async (address: string) =>
    createHash("sha256")
      .update(
        Buffer.from(
          (await rpc("eth_getCode", [address, "latest"])).slice(2),
          "hex",
        ),
      )
      .digest("hex");
  deployment = {
    evmUpgrade: await captureUpgrade(rpc, factory, vault),
    network: "base-sepolia",
    vault,
    asset: token,
    owner,
    identityAuthority: attester,
    feeRecipient: fee,
    factory,
    registrar,
    programId: null,
    upgradeAuthority: null,
    projectPda: null,
    networkDomain: null,
    rotationDelaySeconds: null,
    bindingDelaySeconds: "3600",
    deploymentTransaction: createHashId,
    sourceCommit: "a".repeat(40),
    codeSha256: await digest(vault),
    factoryCodeSha256: await digest(factory),
  };
  const original = PROJECTS.find((entry) => entry.id === "eliza");
  if (original?.reward.kind !== "monthly-pool")
    throw new Error("Missing monthly project fixture");
  project = {
    ...original,
    reward: {
      ...original.reward,
      chain: "base",
      currency: "TEST",
      monthlyCapDisplay: `${formatBaseUnits(original.reward.monthlyCapMinor, 6)} TEST`,
      feeBasisPoints: 200,
      paymentMode: "disabled",
      committedMinor: "0",
      fundingState: "pledged",
    },
    rewardAsset: {
      network: "base",
      kind: "token",
      address: token,
      symbol: "TEST",
      decimals: 6,
      chainId: "8453",
      cluster: null,
      verifiedAt: "2026-10-22T00:00:00.000Z",
    },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-10",
      chain: "base",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [deployment],
    },
  } as typeof project;
});
test.afterAll(() => anvil?.kill("SIGTERM"));

test.beforeEach(async ({ diagnostics }) => {
  diagnostics.allowPreviewApiMisses();
});

test("depositor funds a real vault, recovers a submitted transaction and owner withdraws only free funds", async ({
  diagnostics,
  page,
}, info) => {
  let account = donor;
  let wrongNetwork = true;
  let rejected = false;
  let ambiguous = false;
  let forceFailedTransaction = false;
  const sends: string[] = [];
  await page.exposeFunction(
    "vaultWalletRequest",
    async (method: string, params: unknown[]) => {
      if (method === "eth_chainId" && wrongNetwork) return "0x1";
      if (method === "eth_accounts" || method === "eth_requestAccounts")
        return [account];
      if (method === "eth_sendTransaction") {
        if (rejected) return { fixtureError: "rejected" };
        const requestParams = forceFailedTransaction
          ? [{ ...(params[0] as Record<string, unknown>), gas: "0x7000" }]
          : params;
        const hash = await rpc(method, requestParams);
        sends.push(hash);
        if (ambiguous) return { fixtureError: "unknown" };
        return hash;
      }
      return rpc(method, params);
    },
  );
  await page.addInitScript(() => {
    Object.assign(window, {
      ethereum: {
        isMetaMask: true,
        request: async ({
          method,
          params = [],
        }: {
          method: string;
          params?: unknown[];
        }) => {
          const value = await (
            window as unknown as {
              vaultWalletRequest: (
                method: string,
                params: unknown[],
              ) => Promise<unknown>;
            }
          ).vaultWalletRequest(method, params);
          if ((value as { fixtureError?: string })?.fixtureError === "rejected")
            throw Object.assign(new Error("User rejected"), { code: 4001 });
          if ((value as { fixtureError?: string })?.fixtureError === "unknown")
            throw new Error("Transport interrupted after send");
          return value;
        },
      },
    });
  });
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({
        json: {
          schemaVersion: "1",
          projects: PROJECTS.map((entry) =>
            entry.id === project.id ? project : entry,
          ),
        },
      }),
  );
  await serveProjectCycleIndex(page, [project.id]);
  await serveProjectMaintainer(page, () => project);
  await page.route("**/api/v1/payments/projects/eliza/vault", (route) =>
    route.fulfill({
      json: {
        projectId: "eliza",
        snapshots: [],
        staleAfterMs: 60000,
        servedAt: new Date().toISOString(),
      },
    }),
  );
  // Public totals remain visible without exposing owner wallet controls.
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  const summary = page.getByRole("region", { name: "Project escrow" });
  await expect(summary).toContainText("Totals not read yet");
  await expect(
    page.getByRole("region", { name: /^Fund or withdraw/u }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: /^Vault monthly authorization/u }),
  ).toHaveCount(0);
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  await expect(
    page.getByText("Vault: Not set up", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Payments are disabled for this project.", { exact: false }),
  ).toHaveCount(0);
  const actions = page.getByRole("region", {
    name: "Fund or withdraw · Base Sepolia (test)",
  });
  await actions
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await actions.getByLabel("Token amount", { exact: true }).fill("101");
  await actions
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  await expect(actions.getByRole("alert")).toContainText("Switch your wallet");
  wrongNetwork = false;
  await actions
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  await expect(actions.getByRole("alert")).toContainText("balance is too low");
  await actions.getByLabel("Token amount", { exact: true }).fill("10");
  await actions
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  await expect(
    actions.getByRole("region", { name: "Review vault action" }),
  ).toContainText("no refund right");
  for (const address of [deployment.vault, deployment.asset]) {
    await expect(
      actions
        .locator(".vault-contract-details")
        .getByText(address, { exact: true }),
    ).toBeVisible();
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: info.outputPath("deposit-review.png"),
    fullPage: true,
  });
  rejected = true;
  await actions
    .getByRole("button", { name: "Approve exact token amount in wallet" })
    .click();
  await expect(actions.getByRole("alert")).toContainText("You declined");
  expect(sends).toHaveLength(0);
  rejected = false;
  await actions
    .getByRole("button", { name: "Approve exact token amount in wallet" })
    .click();
  await expect.poll(() => sends.length).toBe(1);
  await rpc("anvil_mine", ["0x40"]);
  await actions
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(actions.getByRole("status")).toContainText(
    "no funds have been deposited yet",
  );
  await actions
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  ambiguous = true;
  await actions
    .getByRole("button", { name: "Confirm deposit in wallet", exact: true })
    .click();
  await expect(actions.getByRole("alert")).toContainText(
    "wallet result is unclear",
  );
  await page.reload({ waitUntil: "networkidle" });
  await actions
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  for (const address of [deployment.vault, deployment.asset]) {
    await expect(
      actions
        .locator(".vault-contract-details")
        .getByText(address, { exact: true }),
    ).toBeVisible();
  }
  await expect(
    actions.getByRole("button", {
      name: "Confirm deposit in wallet",
      exact: true,
    }),
  ).toHaveCount(0);
  await actions.getByLabel("Transaction hash from your wallet").fill(sends[0]);
  await actions
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(actions.getByRole("alert")).toContainText(
    "does not match the pending wallet action",
  );
  await actions.getByLabel("Transaction hash from your wallet").fill(sends[1]);
  await actions
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(actions.getByRole("status")).toContainText(
    "Waiting for finalized",
  );
  await rpc("anvil_mine", ["0x40"]);
  await actions
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(actions.getByRole("status")).toContainText("Deposit verified");
  const deposited = await rpc("eth_getTransactionReceipt", [sends[1]]);
  expect(
    deposited.logs.some(
      (log: { topics: string[] }) =>
        log.topics[0] === EVM_ESCROW_EVENT_TOPICS.Deposited,
    ),
  ).toBe(true);
  // A depositor's wallet is offered no withdrawal; the owner's wallet is.
  await expect(
    actions.getByRole("radio", { name: "Withdraw free funds", exact: true }),
  ).toHaveCount(0);
  await expect(actions).toContainText(
    "Only the vault owner's wallet can withdraw free funds.",
  );
  account = owner;
  ambiguous = false;
  await actions.getByRole("button", { name: "Choose another wallet" }).click();
  await actions
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await actions
    .getByRole("radio", { name: "Withdraw free funds", exact: true })
    .check();
  await actions.getByLabel("Token amount", { exact: true }).fill("11");
  await actions
    .getByRole("button", { name: "Review withdrawal", exact: true })
    .click();
  await expect(actions.getByRole("alert")).toContainText(
    "exceeds the vault's free balance",
  );
  await actions.getByLabel("Token amount", { exact: true }).fill("5");
  await actions
    .getByRole("button", { name: "Review withdrawal", exact: true })
    .click();
  await expect(
    actions.getByRole("region", { name: "Review vault action" }),
  ).toContainText("4.9");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: info.outputPath("owner-withdrawal-review.png"),
    fullPage: true,
  });
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(1);
  // Controlled text enlargement, distinct from native browser zoom.
  const restoreText = await enlargeText(actions);
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: info.outputPath("owner-withdrawal-200-percent-text.png"),
    fullPage: true,
  });
  await restoreText();
  const confirmWithdrawal = actions.getByRole("button", {
    name: "Confirm withdrawal in wallet",
  });
  await confirmWithdrawal.focus();
  await expect(confirmWithdrawal).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => sends.length).toBe(3);
  await rpc("anvil_mine", ["0x40"]);
  await actions
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(actions.getByRole("status")).toContainText(
    "Withdrawal verified",
  );
  expect(sends).toHaveLength(3);
  const balance = await rpc("eth_call", [
    {
      to: deployment.asset,
      data: encodeFunctionData({
        abi,
        functionName: "balanceOf",
        args: [owner],
      }),
    },
    "latest",
  ]);
  expect(BigInt(balance)).toBe(4_900_000n);
  // A real included transaction that runs out of gas must not count as a withdrawal.
  await actions.getByLabel("Token amount", { exact: true }).fill("1");
  await actions
    .getByRole("button", { name: "Review withdrawal", exact: true })
    .click();
  await expect(
    actions.getByRole("button", { name: "Confirm withdrawal in wallet" }),
  ).toBeVisible();
  forceFailedTransaction = true;
  await actions
    .getByRole("button", { name: "Confirm withdrawal in wallet" })
    .click();
  await expect.poll(() => sends.length).toBe(4);
  await rpc("anvil_mine", ["0x40"]);
  await actions
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(actions.getByRole("status")).toContainText(
    "The transaction failed.",
  );
  expect((await rpc("eth_getTransactionReceipt", [sends[3]])).status).toBe(
    "0x0",
  );
  await expectAccessible(page);
  // The finalized monthly awards are a controlled fixture here; wallet execution and reserve
  // verification use the actual local contract and canonical finalized blocks.
  forceFailedTransaction = false;
  ambiguous = false;
  const commitment = {
    schemaVersion: "2",
    projectId: "eliza",
    cycleId: "2026-09",
    manifestSha256: "a".repeat(64),
    snapshotSha256: "b".repeat(64),
    deployment,
    award: {
      githubUserId: "1234",
      login: "local-contributor",
      sourceDigest: "d".repeat(64),
      gross: "2000000",
      fee: "40000",
      net: "1960000",
    },
  };
  let reviewAvailable = true;
  let reviewReads = 0;
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-09",
    (route) => {
      reviewReads++;
      return route.fulfill({
        status: reviewAvailable ? 200 : 503,
        json: reviewAvailable
          ? {
              projectId: "eliza",
              period: "2026-09",
              manifestSha256: commitment.manifestSha256,
              automatic: true,
              cutoffAt: null,
              deployment,
              asset: null,
              proposal: {
                capBase: "2000000",
                allocationSequence: 0,
                allocations: [
                  {
                    githubUserId: "1234",
                    login: "local-contributor",
                    grossBase: "2000000",
                    proposedGrossBase: "2000000",
                    sourceDigest: commitment.award.sourceDigest,
                  },
                ],
              },
              run: {
                trigger: "automatic",
                frozenAt: "2026-10-03T00:00:00.000Z",
                snapshotSha256: commitment.snapshotSha256,
                totalGrossBase: "2000000",
                network: deployment.network,
                vault: deployment.vault,
                funded: true,
                awards: [
                  {
                    githubUserId: "1234",
                    login: "local-contributor",
                    grossBase: "2000000",
                    feeBase: "40000",
                    netBase: "1960000",
                    state: "awaiting-reservation",
                  },
                ],
              },
            }
          : { message: "Review temporarily unavailable" },
      });
    },
  );
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-09/commitment",
    (route) => {
      expect(route.request().postDataJSON()).toEqual({
        network: deployment.network,
        githubUserId: "1234",
        manifestSha256: commitment.manifestSha256,
        snapshotSha256: commitment.snapshotSha256,
      });
      return route.fulfill({ json: commitment });
    },
  );
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Review monthly awards" }).click();
  await expect(
    page.getByRole("navigation", { name: "Contribution month" }),
  ).toContainText("September 2026");
  await page
    .getByRole("button", { name: "Reserve award for local-contributor" })
    .click();
  const ownerActions = page.getByRole("region", {
    name: "Authorize award commitment",
    exact: true,
  });
  account = donor;
  await ownerActions
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await ownerActions
    .getByRole("button", { name: "Verify award and funding" })
    .click();
  await expect(ownerActions.getByRole("alert")).toContainText("owner's wallet");
  await ownerActions
    .getByRole("button", { name: "Choose another wallet" })
    .click();
  account = owner;
  await ownerActions
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await ownerActions
    .getByRole("button", { name: "Verify award and funding" })
    .click();
  await expect(
    ownerActions.getByRole("region", {
      name: "Commitment review",
      exact: true,
    }),
  ).toContainText("1.96");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: info.outputPath("owner-commitment-review.png"),
    fullPage: true,
  });
  rejected = true;
  await ownerActions
    .getByRole("button", { name: "Authorize this award in wallet" })
    .click();
  await expect(ownerActions.getByRole("alert")).toContainText("You declined");
  expect(sends).toHaveLength(4);
  rejected = false;
  ambiguous = true;
  await ownerActions
    .getByRole("button", { name: "Authorize this award in wallet" })
    .click();
  await expect(ownerActions.getByRole("alert")).toContainText(
    "wallet result is unclear",
  );
  expect(sends).toHaveLength(5);
  reviewAvailable = false;
  const unavailableReview = diagnostics.allowResponse(
    503,
    "GET",
    "/api/v1/payments/projects/eliza/monthly/2026-09",
  );
  await page.reload();
  await page.getByRole("button", { name: "Review monthly awards" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Review temporarily unavailable",
  );
  await expect(ownerActions).toBeVisible();
  await ownerActions
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await expect(
    ownerActions.getByRole("button", {
      name: "Authorize this award in wallet",
    }),
  ).toHaveCount(0);
  expect(reviewReads).toBe(2);
  expect(diagnostics.count(unavailableReview)).toBe(1);
  await ownerActions.getByLabel("Commitment transaction hash").fill(sends[1]);
  await ownerActions.getByRole("button", { name: "Check commitment" }).click();
  await expect(ownerActions.getByRole("alert")).toContainText(
    "does not match the pending wallet action",
  );
  await ownerActions.getByLabel("Commitment transaction hash").fill(sends[4]);
  await rpc("anvil_mine", ["0x40"]);
  await ownerActions.getByRole("button", { name: "Check commitment" }).click();
  await expect(ownerActions.getByRole("status")).toContainText(
    "Award reserved on the finalized chain",
  );
  const counters = parseAbi([
    "function reservedPrincipal() view returns (uint128)",
    "function reservedFees() view returns (uint128)",
  ]);
  for (const [functionName, expected] of [
    ["reservedPrincipal", 1960000n],
    ["reservedFees", 40000n],
  ] as const) {
    expect(
      BigInt(
        await rpc("eth_call", [
          {
            to: deployment.vault,
            data: encodeFunctionData({ abi: counters, functionName }),
          },
          "latest",
        ]),
      ),
    ).toBe(expected);
  }
  await ownerActions
    .getByRole("button", { name: "Verify award and funding" })
    .click();
  await expect(ownerActions.getByRole("alert")).toContainText(
    "already committed",
  );
  expect(sends).toHaveLength(5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expectAccessible(page);
});

test("owner turns automatic monthly payment on by default, then opts out", async ({
  page,
}, info) => {
  let account = donor;
  let rejected = false;
  let ambiguous = false;
  const sends: string[] = [];
  await page.exposeFunction(
    "monthlyWalletRequest",
    async (method: string, params: unknown[]) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts")
        return [account];
      if (method === "eth_sendTransaction") {
        if (rejected) return { fixtureError: "rejected" };
        const hash = await rpc(method, params);
        sends.push(hash);
        if (ambiguous) return { fixtureError: "unknown" };
        return hash;
      }
      return rpc(method, params);
    },
  );
  await page.addInitScript(() => {
    Object.assign(window, {
      ethereum: {
        isMetaMask: true,
        request: async ({
          method,
          params = [],
        }: {
          method: string;
          params?: unknown[];
        }) => {
          const value = await (
            window as unknown as {
              monthlyWalletRequest: (
                method: string,
                params: unknown[],
              ) => Promise<unknown>;
            }
          ).monthlyWalletRequest(method, params);
          if ((value as { fixtureError?: string })?.fixtureError === "rejected")
            throw Object.assign(new Error("User rejected"), { code: 4001 });
          if ((value as { fixtureError?: string })?.fixtureError === "unknown")
            throw new Error("Transport interrupted after send");
          return value;
        },
      },
    });
  });
  await page.route(
    /\/(?:api\/v1\/projects|data\/fixture-project-registry\.json)$/,
    (route) =>
      route.fulfill({
        json: {
          schemaVersion: "1",
          projects: PROJECTS.map((entry) =>
            entry.id === project.id ? project : entry,
          ),
        },
      }),
  );
  await serveProjectCycleIndex(page, [project.id]);
  await serveProjectMaintainer(page, () => project);
  await page.route("**/api/v1/payments/projects/eliza/vault", (route) =>
    route.fulfill({
      json: {
        projectId: "eliza",
        snapshots: [],
        staleAfterMs: 60000,
        servedAt: new Date().toISOString(),
      },
    }),
  );
  const monthlyState = parseAbi([
    "function monthlyCap() view returns (uint128)",
    "function monthlyEnabled() view returns (bool)",
  ]);
  const read = async (functionName: "monthlyCap" | "monthlyEnabled") =>
    BigInt(
      await rpc("eth_call", [
        {
          to: deployment.vault,
          data: encodeFunctionData({ abi: monthlyState, functionName }),
        },
        "latest",
      ]),
    );
  const onChain = async () => ({
    cap: await read("monthlyCap"),
    enabled: (await read("monthlyEnabled")) === 1n,
  });
  // A vault starts with the monthly commitment off and a zero cap.
  expect(await onChain()).toEqual({ cap: 0n, enabled: false });
  const matchingProject = project;
  if (!project.rewardAsset) throw new Error("Missing token reward fixture");
  project = {
    ...project,
    rewardAsset: { ...project.rewardAsset, address: otherToken.toLowerCase() },
  };
  const cap = formatBaseUnits(project.reward.monthlyCapMinor, 6);
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  const monthly = page.getByRole("region", {
    name: "Vault monthly authorization · Base Sepolia (test)",
  });
  await page.route("**/api/v1/payments/projects/eliza/monthly/*", (route) =>
    route.fulfill({
      json: {
        projectId: "eliza",
        period: new URL(route.request().url()).pathname.split("/").at(-1),
        manifestSha256: "a".repeat(64),
        automatic: false,
        cutoffAt: null,
        deployment,
        asset: null,
        proposal: null,
        run: null,
      },
    }),
  );
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page
    .getByRole("button", { name: "Review monthly awards", exact: true })
    .click();
  const authorizationLink = page.getByRole("link", {
    name: "Review current setting and cap",
    exact: true,
  });
  await expect(authorizationLink).toHaveAttribute(
    "href",
    `/projects/eliza/manage#vault-monthly-${deployment.network}-${deployment.vault}`,
  );
  await authorizationLink.click();
  await expect(monthly).toBeInViewport();
  await expect(
    monthly.getByText("Current setting", { exact: true }),
  ).toHaveCount(0);
  expect(sends).toHaveLength(0);
  expect(await onChain()).toEqual({ cap: 0n, enabled: false });
  await monthly
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  const automatic = monthly.getByRole("checkbox", {
    name: "Pay contributors automatically each month",
  });
  await expect(automatic).toBeChecked();
  await monthly
    .getByRole("button", { name: "Review monthly payment setting" })
    .click();
  await expect(monthly.getByRole("alert")).toContainText(
    "vault owner's wallet",
  );
  account = owner;
  await monthly.getByRole("button", { name: "Choose another wallet" }).click();
  await monthly
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await monthly
    .getByRole("button", { name: "Review monthly payment setting" })
    .click();
  await expect(monthly.getByRole("alert")).toContainText(
    "vault token differs from the project's reward asset",
  );
  expect(sends).toHaveLength(0);
  expect(await onChain()).toEqual({ cap: 0n, enabled: false });
  project = matchingProject;
  await page.reload({ waitUntil: "networkidle" });
  await monthly
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await monthly
    .getByRole("button", { name: "Review monthly payment setting" })
    .click();
  const review = monthly.getByRole("region", {
    name: "Review monthly payment setting",
  });
  await expect(review).toContainText("Off");
  await expect(review).toContainText(cap);
  await expect(
    monthly
      .locator(".vault-contract-details")
      .getByText(owner, { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("monthly-payment-review.png"),
    fullPage: true,
  });
  const turnOn = monthly.getByRole("button", {
    name: "Turn on automatic monthly payment in wallet",
  });
  rejected = true;
  await turnOn.click();
  await expect(monthly.getByRole("alert")).toContainText("You declined");
  expect(sends).toHaveLength(0);
  rejected = false;
  ambiguous = true;
  await turnOn.click();
  await expect(monthly.getByRole("alert")).toContainText(
    "wallet result is unclear",
  );
  expect(sends).toHaveLength(1);
  ambiguous = false;
  await page.reload({ waitUntil: "networkidle" });
  await monthly
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await expect(turnOn).toHaveCount(0);
  await expect(
    monthly
      .locator(".vault-contract-details")
      .getByText(owner, { exact: true }),
  ).toBeVisible();
  await monthly.getByLabel("Transaction hash from your wallet").fill(sends[0]);
  await monthly
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(monthly.getByRole("status")).toContainText(
    "Waiting for finalized",
  );
  await rpc("anvil_mine", ["0x40"]);
  await monthly
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(monthly.getByRole("status")).toContainText(
    "Automatic monthly payment is on",
  );
  expect(await onChain()).toEqual({
    cap: BigInt(project.reward.monthlyCapMinor),
    enabled: true,
  });
  // The same setting needs no second signature.
  await monthly
    .getByRole("button", { name: "Review monthly payment setting" })
    .click();
  await expect(review).toContainText("Nothing to sign");
  // Opting out keeps the cap and turns the commitment off.
  await automatic.uncheck();
  await monthly
    .getByRole("button", { name: "Review monthly payment setting" })
    .click();
  await monthly
    .getByRole("button", {
      name: "Turn off automatic monthly payment in wallet",
    })
    .click();
  await expect.poll(() => sends.length).toBe(2);
  await rpc("anvil_mine", ["0x40"]);
  await monthly
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(monthly.getByRole("status")).toContainText(
    "Automatic monthly payment is off",
  );
  expect(await onChain()).toEqual({
    cap: BigInt(project.reward.monthlyCapMinor),
    enabled: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expectAccessible(page);
});

test("owner creates, registers and funds a vault through the real API", async ({
  diagnostics,
  page,
}, info) => {
  test.setTimeout(180_000);
  const automatic = !info.project.name.includes("mobile");
  const apiPort = anvilPort + 2;
  const origin = `http://127.0.0.1:${apiPort}`;
  const temporary = mkdtempSync(join(tmpdir(), "slop-vault-setup-"));
  if (!project.escrow) throw new Error("Missing project vault policy");
  const target = {
    ...project,
    skill: {
      ...project.skill,
      publishAtRoot: false,
      sourcePath: "skills/project-contributor-template",
    },
    reviewSkill: {
      id: `review-${project.id}-contributions`,
      sourcePath: "skills/project-reviewer-template",
    },
    contribution: CONTRIBUTION,
    escrow: { ...project.escrow, deployments: [] },
  };
  if (!deployment.evmUpgrade) throw new Error("Missing upgrade review");
  // No project has a deployment: the first vault uses only the independently
  // reviewed local factory. No synthetic project or vault record enters D1.
  const factory = {
    network: deployment.network,
    sourceCommit: deployment.sourceCommit,
    codeSha256: deployment.codeSha256,
    factory: deployment.factory,
    factoryCodeSha256: deployment.factoryCodeSha256,
    registrar: deployment.registrar,
    identityAuthority: deployment.identityAuthority,
    feeRecipient: deployment.feeRecipient,
    bindingDelaySeconds: deployment.bindingDelaySeconds,
    evmUpgrade: deployment.evmUpgrade,
  };
  const fixturePath = join(temporary, "projects.json");
  writeFileSync(fixturePath, JSON.stringify({ project: target, factory }));
  let output = "";
  const server = spawn(
    "bun",
    [
      "scripts/vault-setup-browser-server.ts",
      fixturePath,
      String(apiPort),
      rpcUrl,
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: process.env },
  );
  server.stdout?.on("data", (s) => {
    output += String(s);
  });
  server.stderr?.on("data", (s) => {
    output += String(s);
  });
  try {
    await expect
      .poll(() => output, { timeout: 30_000 })
      .toContain("Vault setup API ready");
    const initial = await (
      await page.request.get(`${origin}/__fixture`)
    ).json();
    const headers = {
      origin,
      cookie: `__Host-slop_points=${initial.token}`,
      "content-type": "application/json",
    };
    const api = async (path: string, data: unknown) => {
      const response = await page.request.post(`${origin}/api/v1/${path}`, {
        headers,
        data,
      });
      const body = await response.json();
      expect(response.ok(), JSON.stringify(body)).toBe(true);
      return body;
    };
    // Confirm the owner wallet through the shipped claim and challenge routes.
    const claim = await api("payments/wallets/register", {
      chain: "base",
      address: donor,
    });
    const challenge = await api("payments/wallets/challenge", {
      claimId: claim.claimId,
    });
    const account = mnemonicToAccount(
      "test test test test test test test test test test test junk",
      { addressIndex: 4 },
    );
    await api("payments/wallets/authorize", {
      claimId: claim.claimId,
      challengeId: challenge.challengeId,
      signature: await account.signMessage({ message: challenge.message }),
    });
    const emptyRegistry = await (
      await page.request.get(`${origin}/__fixture`)
    ).json();
    expect(emptyRegistry.projects).toBe(1);
    expect(emptyRegistry.paymentPins).toEqual([]);
    await expect(
      verifyEvmFactory(
        { ...deployment, rpcUrl, chainId: 1n } as Parameters<
          typeof verifyEvmFactory
        >[0],
        "finalized",
        { forCreation: true },
      ),
    ).rejects.toThrow("Wrong chain");
    const input = {
      step: "review",
      expectedRevision: 1,
      claimId: claim.claimId,
      network: "base-sepolia",
      automatic,
    };
    await page.request.post(`${origin}/__fixture`, {
      data: { permitted: false },
    });
    expect(
      (
        await page.request.post(
          `${origin}/api/v1/project-vaults/${project.id}`,
          { headers, data: input },
        )
      ).status(),
    ).toBe(403);
    await page.request.post(`${origin}/__fixture`, {
      data: { permitted: true, templatesEnabled: false },
    });
    expect(
      (
        await page.request.post(
          `${origin}/api/v1/project-vaults/${project.id}`,
          { headers, data: input },
        )
      ).status(),
    ).toBe(503);
    await page.request.post(`${origin}/__fixture`, {
      data: { templatesEnabled: true },
    });
    expect(
      (
        await page.request.post(
          `${origin}/api/v1/project-vaults/${project.id}`,
          { headers, data: { ...input, claimId: "not-my-wallet" } },
        )
      ).status(),
    ).toBe(403);
    // Current chain state must match every infrastructure trust pin before review.
    for (const badReview of [
      { identityAuthority: donor },
      { registrar: donor },
      { feeRecipient: donor },
      { factoryCodeSha256: "0".repeat(64) },
      { evmUpgrade: { ...factory.evmUpgrade, authority: donor } },
      {
        evmUpgrade: {
          ...factory.evmUpgrade,
          vaultImplementationCodeSha256: "0".repeat(64),
        },
      },
      {
        evmUpgrade: {
          ...factory.evmUpgrade,
          factoryImplementationCodeSha256: "0".repeat(64),
        },
      },
    ]) {
      await page.request.post(`${origin}/__fixture`, {
        data: { factoryReview: badReview },
      });
      const refused = await page.request.post(
        `${origin}/api/v1/project-vaults/${project.id}`,
        { headers, data: input },
      );
      expect(refused.status()).toBe(503);
      await page.request.post(`${origin}/__fixture`, {
        data: { factoryReview: factory },
      });
    }
    // A real vault for another project cannot be attached to this registry entry.
    const unrelatedTransaction = await rpc("eth_sendTransaction", [
      {
        from: donor,
        to: deployment.factory,
        gas: "0x600000",
        data: buildCreateVaultCalldata({
          projectId: `0x${"f".repeat(64)}`,
          asset: deployment.asset,
          monthlyCap: project.reward.monthlyCapMinor,
          automaticMonthly: automatic,
        }),
      },
    ]);
    await rpc("anvil_mine", ["0x40"]);
    const unrelated = await page.request.post(
      `${origin}/api/v1/project-vaults/${project.id}`,
      {
        headers,
        data: {
          ...input,
          step: "register",
          transactionId: unrelatedTransaction,
        },
      },
    );
    expect(unrelated.status()).toBe(422);
    expect((await unrelated.json()).message).toContain("does not match");
    expect(
      (await (await page.request.get(`${origin}/__fixture`)).json()).revisions
        .n,
    ).toBe(1);
    const sends: string[] = [];
    let unknownSend = true;
    await page.exposeFunction(
      "setupWalletRequest",
      async (method: string, params: unknown[]) => {
        if (method === "eth_accounts" || method === "eth_requestAccounts")
          return [donor];
        if (method === "eth_sendTransaction") {
          const hash = await rpc(method, params);
          sends.push(hash);
          if (unknownSend) return { unknown: true };
          return hash;
        }
        return rpc(method, params);
      },
    );
    await page.addInitScript((token) => {
      // biome-ignore lint/suspicious/noDocumentCookie: Set the same site-session cookie used by the local registry harness.
      document.cookie = `__Host-slop_points=${token}; Path=/; Secure; SameSite=Strict`;
      Object.assign(window, {
        ethereum: {
          isMetaMask: true,
          request: async ({
            method,
            params = [],
          }: {
            method: string;
            params?: unknown[];
          }) => {
            const result = await (
              window as unknown as {
                setupWalletRequest(m: string, p: unknown[]): Promise<unknown>;
              }
            ).setupWalletRequest(method, params);
            if ((result as { unknown?: boolean })?.unknown)
              throw new Error("Transport interrupted after send");
            return result;
          },
        },
      });
    }, initial.token);
    // The recovery rejection below; failedRequests checks its timing.
    diagnostics.allow(
      new RegExp(
        `^console Failed to load resource: the server responded with a status of 422 .* at ${escapeRegExp(origin)}/api/v1/project-vaults/${escapeRegExp(project.id)}$`,
        "u",
      ),
    );
    const failedRequests: string[] = [];
    let expectedRecoveryRejection = false;
    const watch = (candidate: Page) =>
      candidate.on("response", (r) => {
        if (
          r.url().startsWith(origin) &&
          r.status() >= 400 &&
          !(
            expectedRecoveryRejection &&
            r.status() === 422 &&
            r.url().endsWith(`/project-vaults/${project.id}`)
          )
        )
          failedRequests.push(`${r.status()} ${r.url()}`);
      });
    watch(page);
    await page.goto(`${origin}/projects/${project.slug}/manage`, {
      waitUntil: "networkidle",
    });
    let setup = page.getByRole("region", { name: "Set up project vault" });
    await expect(
      setup.getByRole("button", { name: "Review vault creation", exact: true }),
    ).toBeVisible();
    await expect(
      setup.getByRole("button", {
        name: "Recover existing vault",
        exact: true,
      }),
    ).not.toBeVisible();
    await page.screenshot({
      path: info.outputPath("owner-vault-setup.png"),
      fullPage: true,
    });
    const restoreSetupText = await enlargeText(page.locator("body"));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("owner-vault-setup-zoom.png"),
      fullPage: true,
    });
    await restoreSetupText();
    await setup.getByText("Recover an existing vault", { exact: true }).focus();
    await page.keyboard.press("Enter");
    await setup
      .getByRole("button", { name: "Recover existing vault", exact: true })
      .click();
    await expect(setup.getByRole("alert")).toContainText(
      "No existing vault was found",
    );
    await expect(
      setup.getByRole("button", { name: "Create vault in wallet" }),
    ).toHaveCount(0);
    expect(sends).toHaveLength(0);
    await setup.getByRole("button", { name: "Connect MetaMask" }).click();
    const monthlySetting = setup.getByRole("combobox", {
      name: "Automatic monthly payment",
      exact: true,
    });
    await expect(monthlySetting).toHaveValue("on");
    if (!automatic) await monthlySetting.selectOption("off");
    const reviewButton = setup.getByRole("button", {
      name: "Review vault creation",
      exact: true,
    });
    // The wallet connection keeps the button disabled until it finishes.
    await expect(reviewButton).toBeEnabled();
    await reviewButton.focus();
    await expect(reviewButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      setup.getByRole("button", { name: "Create vault in wallet" }),
    ).toBeEnabled();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("owner-vault-create-review.png"),
      fullPage: true,
    });
    await setup.getByRole("button", { name: "Create vault in wallet" }).click();
    await expect(setup.getByRole("alert")).toContainText(
      "Transport interrupted",
    );
    expect(sends).toHaveLength(1);
    await page.reload({ waitUntil: "networkidle" });
    // The original tab keeps the interrupted request and offers no second send.
    await expect(setup.getByLabel("Creation transaction hash")).toHaveValue("");
    await expect(
      setup.getByText("Wallet confirms nothing was sent"),
    ).toBeVisible();
    await expect(
      setup.getByRole("button", { name: "Create vault in wallet" }),
    ).toHaveCount(0);
    // A fresh tab has the same authenticated owner but no injected wallet and
    // no saved creation request. Recover the already-sent vault without sending.
    const recoveryPage = await page.context().newPage();
    watch(recoveryPage);
    await recoveryPage.goto(`${origin}/projects/${project.slug}/manage`, {
      waitUntil: "networkidle",
    });
    const recoverySetup = recoveryPage.getByRole("region", {
      name: "Set up project vault",
    });
    await expect(
      recoverySetup.getByRole("button", { name: "Review vault creation" }),
    ).toBeDisabled();
    await expect(
      recoverySetup.getByRole("button", { name: /^Connect / }),
    ).toHaveCount(0);
    await recoverySetup
      .getByRole("combobox", { name: "Automatic monthly payment", exact: true })
      .selectOption(automatic ? "on" : "off");
    const recoverButton = recoverySetup.getByRole("button", {
      name: "Recover existing vault",
      exact: true,
    });
    await expect(recoverButton).not.toBeVisible();
    await recoverySetup
      .getByText("Recover an existing vault", { exact: true })
      .focus();
    await recoveryPage.keyboard.press("Enter");
    await expect(recoverButton).toBeEnabled();
    await expectAccessible(recoveryPage);
    await recoveryPage.screenshot({
      path: info.outputPath("owner-vault-recovery-ready-no-wallet.png"),
      fullPage: true,
    });
    await recoverButton.focus();
    await recoveryPage.keyboard.press("Enter");
    await expect(
      recoverySetup.getByRole("button", { name: "Create vault in wallet" }),
    ).toHaveCount(0);
    await expect(
      recoverySetup.getByLabel("Creation transaction hash"),
    ).toBeFocused();
    await recoveryPage.keyboard.type(sends[0]);
    await recoverySetup
      .getByRole("button", { name: "Check vault registration" })
      .click();
    await expect(recoverySetup.getByRole("status")).toContainText(
      "not finalized",
    );
    await recoveryPage.reload({ waitUntil: "networkidle" });
    await expect(
      recoverySetup.getByLabel("Creation transaction hash"),
    ).toHaveValue(sends[0]);
    await expect(
      recoverySetup.getByRole("button", { name: "Create vault in wallet" }),
    ).toHaveCount(0);
    expect(sends).toHaveLength(1);
    await recoveryPage.screenshot({
      path: info.outputPath("owner-vault-recovered-without-provider.png"),
      fullPage: true,
    });
    setup = recoverySetup;
    // Another tab may change the cap while this tab still shows the original project.
    const beforeEdit = await (
      await page.request.get(`${origin}/__fixture`)
    ).json();
    const edited = structuredClone(beforeEdit.project.manifest);
    edited.reward.monthlyCapMinor = "2000000000";
    edited.reward.monthlyCapDisplay = "2,000 TEST";
    const changed = await page.request.put(
      `${origin}/api/v1/projects/${project.id}`,
      {
        headers,
        data: { manifest: edited, expectedRevision: 1 },
      },
    );
    expect(changed.ok(), JSON.stringify(await changed.json())).toBe(true);
    const afterEdit = await (
      await page.request.get(`${origin}/__fixture`)
    ).json();
    expect(afterEdit.project.revision).toBe(2);
    await expect(setup.getByText("1,000 TEST", { exact: true })).toBeVisible();
    expectedRecoveryRejection = true;
    await setup
      .getByLabel("Creation transaction hash")
      .fill(unrelatedTransaction);
    await setup
      .getByRole("button", { name: "Check vault registration" })
      .click();
    await expect(setup.getByRole("alert")).toContainText("does not match");
    expect(sends).toHaveLength(1);
    await expect(
      setup.getByRole("button", { name: "Create vault in wallet" }),
    ).toHaveCount(0);
    expectedRecoveryRejection = false;
    await setup.getByLabel("Creation transaction hash").fill(sends[0]);
    await setup
      .getByRole("button", { name: "Check vault registration" })
      .click();
    await expect(setup.getByRole("status")).toContainText("not finalized");
    await rpc("anvil_mine", ["0x40"]);
    await setup
      .getByRole("button", { name: "Check vault registration" })
      .click();
    await expect(setup).toHaveCount(0);
    await expect(
      recoveryPage
        .getByRole("status")
        .filter({ hasText: "Creation used a monthly cap" }),
    ).toHaveText(
      "Creation used a monthly cap of 1,000 TEST. The project now uses 2,000 TEST. Use the automatic payment controls below to apply the new cap.",
    );
    await recoveryPage
      .locator("summary")
      .filter({ hasText: /^Monthly rewards$/u })
      .click();
    await expect(
      recoveryPage.getByRole("textbox", { name: /^Monthly amount/u }),
    ).toHaveValue("2000");
    const state = await (await page.request.get(`${origin}/__fixture`)).json();
    expect(state.project.revision).toBe(3);
    // Settings refresh the registered revision and read its retained clearance once.
    expect(state.scanReads).toBe(afterEdit.scanReads + 1);
    expect(state.revisions.n).toBe(3);
    expect(state.project.manifest.reward.monthlyCapMinor).toBe("2000000000");
    const created = state.project.manifest.escrow.deployments[0];
    expect(state.projects).toBe(1);
    expect(state.paymentPins).toHaveLength(1);
    expect(state.paymentPins[0]).toMatchObject({
      projectId: project.id,
      ...created,
    });
    expect(created.owner).toBe(donor);
    expect(created.deploymentTransaction).toBe(sends[0]);
    expect(created.evmUpgrade).toEqual(deployment.evmUpgrade);
    // A staged infrastructure review must not hide a newer verified D1 review.
    // The first creation above still began with no project deployment at all.
    const fallback = await page.request.post(`${origin}/__fixture`, {
      data: {
        factoryReview: { factoryCodeSha256: "0".repeat(64) },
        reviewCurrentVault: true,
        claimId: claim.claimId,
        automatic,
      },
    });
    expect(fallback.status()).toBe(200);
    expect((await fallback.json()).infrastructureReview.existingVault).toBe(
      created.vault,
    );
    await page.request.post(`${origin}/__fixture`, {
      data: { factoryReview: factory },
    });
    const monthly = await readEvmMonthlyCommitment({
      ...created,
      rpcUrl,
      chainId: 84532n,
    });
    expect(monthly.enabled).toBe(automatic);
    expect(monthly.cap).toBe("1000000000");
    await expect(
      verifyEvmDeployment(
        { ...created, rpcUrl, chainId: 84532n },
        "finalized",
        { expectedProjectId: `0x${"f".repeat(64)}` },
      ),
    ).rejects.toThrow("different registry project");
    await api(`project-vaults/${project.id}`, {
      ...input,
      step: "register",
      transactionId: sends[0],
    });
    expect(
      (await (await page.request.get(`${origin}/__fixture`)).json()).revisions
        .n,
    ).toBe(3);
    expect(
      await recoveryPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await recoveryPage.screenshot({
      path: info.outputPath("owner-vault-registered-without-provider.png"),
      fullPage: true,
    });
    await recoveryPage.close();
    await page.reload({ waitUntil: "networkidle" });
    unknownSend = false;
    const monthlyControls = page.getByRole("region", {
      name: "Vault monthly authorization · Base Sepolia (test)",
      exact: true,
    });
    await monthlyControls
      .getByRole("button", { name: "Connect MetaMask" })
      .click();
    await monthlyControls
      .getByRole("button", {
        name: "Review monthly payment setting",
        exact: true,
      })
      .click();
    await expect(monthlyControls.getByText(/^On, up to 2,000 /)).toBeVisible();
    expect(sends).toHaveLength(1);
    const funding = page.getByRole("region", { name: /Fund or withdraw/ });
    await funding.getByRole("button", { name: "Connect MetaMask" }).click();
    await funding.getByLabel("Token amount").fill("10");
    await funding
      .getByRole("button", { name: "Review deposit", exact: true })
      .click();
    await funding.getByRole("button", { name: /Approve/ }).click();
    await expect.poll(() => sends.length).toBe(2);
    await rpc("anvil_mine", ["0x40"]);
    await funding.getByRole("button", { name: /Check/ }).click();
    await expect(funding.getByRole("status")).toContainText(
      "no funds have been deposited yet",
    );
    await funding
      .getByRole("button", { name: "Review deposit", exact: true })
      .click();
    await funding
      .getByRole("button", { name: "Confirm deposit in wallet" })
      .click();
    await expect.poll(() => sends.length).toBe(3);
    await rpc("anvil_mine", ["0x40"]);
    await funding.getByRole("button", { name: /Check/ }).click();
    await expect(funding).toContainText("finalized");
    expect(
      BigInt(
        await rpc("eth_call", [
          {
            to: deployment.asset,
            data: encodeFunctionData({
              abi,
              functionName: "balanceOf",
              args: [created.vault],
            }),
          },
          "latest",
        ]),
      ),
    ).toBe(10_000_000n);
    expect(failedRequests).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expectAccessible(page);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("owner-vault-funded.png"),
      fullPage: true,
    });
    await page.goto(`${origin}/projects/${project.slug}/manage`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("region", { name: "Setup status: Ready" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Project navigation" })
        .getByRole("link", { name: "Funds & awards" }),
    ).toHaveAttribute("href", `/projects/${project.slug}/funding`);
    await expect(
      page.getByText(/Deposit needed|Payments off|Payouts are disabled/),
    ).toHaveCount(0);
    expect(failedRequests).toEqual([]);
    await expectAccessible(page);
    await page.screenshot({
      path: info.outputPath("owner-project-payment-links.png"),
      fullPage: true,
    });
  } finally {
    server.kill("SIGTERM");
    rmSync(temporary, { recursive: true, force: true });
    await info.attach("vault-setup-api.log", {
      body: output,
      contentType: "text/plain",
    });
  }
});

test("owner funds a separate bounty vault with private balances and no monthly reward", async ({
  diagnostics,
  page,
}, info) => {
  test.setTimeout(180_000);
  const apiPort = anvilPort + 2;
  const origin = `http://127.0.0.1:${apiPort}`;
  const temporary = mkdtempSync(join(tmpdir(), "slop-bounty-vault-"));
  const id = "bounty-vault-owner";
  const repository = `example/${id}`;
  const usdc = ESCROW_NETWORKS["base-sepolia"].asset;
  if (!usdc) throw new Error("Missing reviewed test-network asset");
  // A local six-decimal token at the reviewed address exercises the production
  // asset rule. No production RPC or stablecoin balance is used.
  await rpc("anvil_setCode", [
    usdc,
    await rpc("eth_getCode", [deployment.asset, "latest"]),
  ]);
  await rpc("eth_sendTransaction", [
    {
      from: owner,
      to: usdc,
      gas: "0x100000",
      data: encodeFunctionData({
        abi,
        functionName: "mint",
        args: [donor as `0x${string}`, 20_000_000n],
      }),
    },
  ]);
  const zeroReward = {
    ...project.reward,
    monthlyCapMinor: "0",
    monthlyCapDisplay: "0 TEST",
    committedMinor: "0",
    paymentMode: "disabled",
  };
  delete zeroReward.reviewBudget;
  delete zeroReward.cycleCaps;
  const contact = { githubId: "900000071", githubLogin: "vault-owner" };
  const target = applicationManifest(id, repository, {
    status: "active",
    reward: zeroReward,
    rewardAsset: project.rewardAsset,
    escrow: { ...project.escrow, deployments: [] },
    securityBounty: {
      version: "1",
      status: "paused",
      rewardMode: "bounty-only",
      eligibility: "critical-loss-of-funds",
      amount: {
        currency: "USDC",
        decimals: 6,
        network: "base",
        grossMinor: "10000000",
      },
      split: { researcherBasisPoints: 7500, slopBasisPoints: 2500 },
      sponsor: { name: "Local project", githubId: contact.githubId },
      funding: { state: "pledged" },
      capacity: {
        awards: 1,
        closesAt: null,
        exhaustionRule: "New awards wait for available funds.",
      },
      scope: {
        sourceRevisions: [{ repository, commit: "a".repeat(40) }],
        deployments: [],
        includedAssets: ["Vault deposits"],
        excludedDependencies: [],
        testingPermission: "Test on local forks only.",
        severityRubric: "Assess impact on covered funds.",
        lossDefinition: "Unauthorized loss of covered funds.",
      },
      intake: { kind: "github-private-vulnerability-reporting", repository },
      responseTargets: {
        acknowledgeHours: 24,
        triageBusinessDays: 3,
        updateIntervalDays: 7,
      },
      approvers: {
        technical: [contact],
        financial: [contact],
        dispute: [contact],
      },
      dispute: {
        authority: "advisory",
        process: "Ask Slop for a private review.",
      },
      disclosure: "Contact the maintainer before disclosure.",
      safeHarbor: "Good-faith testing within these rules is authorized.",
    },
  });
  const fixturePath = join(temporary, "projects.json");
  writeFileSync(
    fixturePath,
    JSON.stringify({
      project: target,
      template: { ...project, securityBounty: undefined },
    }),
  );
  let output = "";
  const server = spawn(
    "bun",
    [
      "scripts/vault-setup-browser-server.ts",
      fixturePath,
      String(apiPort),
      rpcUrl,
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: process.env },
  );
  server.stdout?.on("data", (s) => {
    output += String(s);
  });
  server.stderr?.on("data", (s) => {
    output += String(s);
  });
  try {
    await expect
      .poll(() => output, { timeout: 30_000 })
      .toContain("Vault setup API ready");
    const initial = await (
      await page.request.get(`${origin}/__fixture`)
    ).json();
    const headers = {
      origin,
      cookie: `__Host-slop_points=${initial.token}`,
      "content-type": "application/json",
    };
    const api = async (path: string, data: unknown) => {
      const response = await page.request.post(`${origin}/api/v1/${path}`, {
        headers,
        data,
      });
      const body = await response.json();
      expect(response.ok(), JSON.stringify(body)).toBe(true);
      return body;
    };
    const privatePath = `${origin}/api/v1/project-vaults/${id}?purpose=security-bounty`;
    expect((await page.request.get(privatePath)).status()).toBe(401);
    await page.request.post(`${origin}/__fixture`, {
      data: { permitted: false },
    });
    expect((await page.request.get(privatePath, { headers })).status()).toBe(
      403,
    );
    await page.request.post(`${origin}/__fixture`, {
      data: { permitted: true },
    });
    const claim = await api("payments/wallets/register", {
      chain: "base",
      address: donor,
    });
    const challenge = await api("payments/wallets/challenge", {
      claimId: claim.claimId,
    });
    const account = mnemonicToAccount(
      "test test test test test test test test test test test junk",
      { addressIndex: 4 },
    );
    await api("payments/wallets/authorize", {
      claimId: claim.claimId,
      challengeId: challenge.challengeId,
      signature: await account.signMessage({ message: challenge.message }),
    });
    const sends: string[] = [];
    await page.exposeFunction(
      "bountyWalletRequest",
      async (method: string, params: unknown[]) => {
        if (method === "eth_accounts" || method === "eth_requestAccounts")
          return [donor];
        const value = await rpc(method, params);
        if (method === "eth_sendTransaction") sends.push(value);
        return value;
      },
    );
    await page.addInitScript((token) => {
      // biome-ignore lint/suspicious/noDocumentCookie: Synthetic local session only.
      document.cookie = `__Host-slop_points=${token}; Path=/; Secure; SameSite=Strict`;
      Object.assign(window, {
        ethereum: {
          isMetaMask: true,
          request: ({
            method,
            params = [],
          }: {
            method: string;
            params?: unknown[];
          }) =>
            (
              window as unknown as {
                bountyWalletRequest(m: string, p: unknown[]): Promise<unknown>;
              }
            ).bountyWalletRequest(method, params),
        },
      });
    }, initial.token);
    const failed: string[] = [];
    const privateUrl = `${origin}/api/v1/project-vaults/${id}?purpose=security-bounty`;
    // The refused private reads, counted below.
    diagnostics.allow(
      new RegExp(
        `^console .*(?:403|503).* at ${escapeRegExp(privateUrl)}$`,
        "u",
      ),
    );
    let expectedPrivateErrors = 0;
    page.on("console", (event) => {
      if (
        event.type() === "error" &&
        event.location().url === privateUrl &&
        /403|503/.test(event.text())
      )
        expectedPrivateErrors++;
    });
    page.on("response", (response) => {
      if (response.url().startsWith(origin) && response.status() >= 400)
        failed.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(`${origin}/projects/${id}/manage`, {
      waitUntil: "networkidle",
    });
    await openProjectSecuritySettings(page);
    const setup = page.getByRole("region", {
      name: "Set up bounty vault",
      exact: true,
    });
    await setup.getByRole("button", { name: "Connect MetaMask" }).click();
    await expect(
      setup.getByRole("combobox", { name: /^Automatic monthly payment/ }),
    ).toHaveCount(0);
    const reviewButton = setup.getByRole("button", {
      name: "Review vault creation",
    });
    await expect(reviewButton).toBeEnabled();
    await reviewButton.focus();
    await expect(reviewButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(setup).toContainText(
      "Security bounty: 75% researcher, 25% Slop",
    );
    await page.screenshot({
      path: info.outputPath("bounty-vault-review.png"),
      fullPage: true,
    });
    await setup.getByRole("button", { name: "Create vault in wallet" }).click();
    await expect.poll(() => sends.length).toBe(1);
    await page.reload({ waitUntil: "networkidle" });
    await openProjectSecuritySettings(page);
    await rpc("anvil_mine", ["0x40"]);
    await setup
      .getByRole("button", { name: "Check vault registration" })
      .click();
    await expect(setup).toHaveCount(0);
    const state = await (await page.request.get(`${origin}/__fixture`)).json();
    const created =
      state.project.manifest.securityBounty.settlement.deployments[0];
    expect(state.project.manifest.escrow.deployments).toEqual([]);
    expect(
      state.project.manifest.securityBounty.settlement.feeBasisPoints,
    ).toBe(2500);
    expect(created.asset).toBe(usdc);
    expect(created.owner).toBe(donor);
    expect(created.vault).not.toBe(deployment.vault);
    await verifyEvmDeployment(
      { ...created, rpcUrl, chainId: 84532n, payoutPolicy: "security-bounty" },
      "finalized",
    );
    await expect(
      verifyEvmDeployment({ ...created, rpcUrl, chainId: 84532n }, "finalized"),
    ).rejects.toThrow();
    const funding = page.getByRole("region", { name: /Fund or withdraw/ });
    await funding.getByRole("button", { name: "Connect MetaMask" }).click();
    await funding.getByLabel("Token amount").fill("10");
    await funding
      .getByRole("button", { name: "Review deposit", exact: true })
      .click();
    await funding.getByRole("button", { name: /Approve/ }).click();
    await expect.poll(() => sends.length).toBe(2);
    await rpc("anvil_mine", ["0x40"]);
    await funding.getByRole("button", { name: /Check/ }).click();
    await funding
      .getByRole("button", { name: "Review deposit", exact: true })
      .click();
    await funding
      .getByRole("button", { name: "Confirm deposit in wallet" })
      .click();
    await expect.poll(() => sends.length).toBe(3);
    await rpc("anvil_mine", ["0x40"]);
    await funding.getByRole("button", { name: /Check/ }).click();
    await expect(funding).toContainText("finalized");
    const scan = await page.request.post(`${origin}/__fixture`, {
      data: { scanSecurity: true },
    });
    expect(scan.ok(), await scan.text()).toBe(true);
    await page.getByRole("button", { name: "Refresh bounty funds" }).click();
    await expect(
      page.getByRole("region", { name: "Bounty funds", exact: true }),
    ).toContainText("Available for new awards: 10 USDC");
    await expect(funding.getByRole("status")).toContainText("finalized");
    await page.request.post(`${origin}/__fixture`, {
      data: { privateReadUnavailable: true },
    });
    const unavailable = page.waitForResponse(
      (response) => response.url() === privateUrl && response.status() === 503,
    );
    await page.getByRole("button", { name: "Refresh bounty funds" }).click();
    await unavailable;
    const bountyFunds = page.getByRole("region", {
      name: "Bounty funds",
      exact: true,
    });
    await expect(bountyFunds.getByRole("alert")).toContainText(
      "Private balance read is unavailable.",
    );
    // A failed refresh must retain funded withdrawal and transaction recovery.
    await expect(funding).toBeVisible();
    await expect(funding.getByRole("status")).toContainText("finalized");
    await expect(bountyFunds).toContainText("Last verified balance");
    await expect(bountyFunds).toContainText(
      "Available for new awards: 10 USDC",
    );
    await expect(funding.getByLabel("Deposit tokens")).toHaveCount(0);
    await funding.getByLabel("Withdraw free funds").check();
    await expect(
      funding.getByRole("button", { name: "Review withdrawal", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: info.outputPath("bounty-vault-stale-funds.png"),
      fullPage: true,
    });
    await page.request.post(`${origin}/__fixture`, {
      data: { privateReadUnavailable: false },
    });
    await page.getByRole("button", { name: "Refresh bounty funds" }).click();
    await expect(bountyFunds.getByRole("alert")).toHaveCount(0);
    await expect(funding.getByLabel("Deposit tokens")).toBeVisible();
    await expect(funding.getByRole("status")).toContainText("finalized");
    await page.getByLabel("Status", { exact: true }).selectOption("open");
    await page.getByRole("button", { name: "Review bounty terms" }).click();
    await page.getByRole("button", { name: "Publish bounty terms" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Published revision" }),
    ).toBeVisible();
    const final = await (await page.request.get(`${origin}/__fixture`)).json();
    expect(final.project.manifest.securityBounty.status).toBe("open");
    expect(final.privateSnapshots.n).toBe(1);
    expect(final.publicSnapshots.n).toBe(0);
    const publicProject = await (
      await page.request.get(`${origin}/api/v1/projects/${id}`)
    ).text();
    expect(publicProject).not.toMatch(/availableMinor|freeMinor|snapshotAt/);
    expect(failed).toEqual([`503 ${privateUrl}`]);
    expect(expectedPrivateErrors).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expectAccessible(page);
    await page.screenshot({
      path: info.outputPath("bounty-vault-funded-open.png"),
      fullPage: true,
    });
    await page.goto(`${origin}/projects/${project.slug}/manage`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("heading", { name: "Manage project", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Bounty funds", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Available for new awards:", { exact: false }),
    ).toHaveCount(0);
    await page.goto(`${origin}/projects/${id}/manage`, {
      waitUntil: "networkidle",
    });
    await openProjectSecuritySettings(page);
    await expect(
      page.getByRole("region", { name: "Bounty funds", exact: true }),
    ).toContainText("Available for new awards: 10 USDC");
    await expect(funding.getByRole("status")).toHaveCount(0);
    // Unlike a transient read failure, lost authority must clear private data.
    await page.request.post(`${origin}/__fixture`, {
      data: { permitted: false },
    });
    const denied = page.waitForResponse(
      (response) => response.url() === privateUrl && response.status() === 403,
    );
    await page.getByRole("button", { name: "Refresh bounty funds" }).click();
    await denied;
    await expect(bountyFunds.getByRole("alert")).toBeVisible();
    await expect(funding).toHaveCount(0);
    await expect(bountyFunds).not.toContainText("10 USDC");
    await page.request.post(`${origin}/__fixture`, {
      data: { permitted: true },
    });
    await page.getByRole("button", { name: "Refresh bounty funds" }).click();
    await expect(bountyFunds.getByRole("alert")).toHaveCount(0);
    await expect(bountyFunds).toContainText(
      "Available for new awards: 10 USDC",
    );
    expect(failed).toEqual([`503 ${privateUrl}`, `403 ${privateUrl}`]);
    expect(expectedPrivateErrors).toBe(2);
  } finally {
    server.kill("SIGTERM");
    rmSync(temporary, { recursive: true, force: true });
    await info.attach("bounty-vault-api.log", {
      body: output,
      contentType: "text/plain",
    });
  }
});
