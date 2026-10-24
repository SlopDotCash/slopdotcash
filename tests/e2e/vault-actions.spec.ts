/** Browser-to-Anvil workflow. No production RPC, credentials or funds are used. */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { encodeFunctionData, parseAbi } from "viem";
import {
  EVM_ESCROW_EVENT_TOPICS,
  evmVaultKey,
} from "../../contracts/evm/adapter";
import {
  captureUpgrade,
  deployUpgradeableFactory,
} from "../../contracts/evm/integration/upgrade";
import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";
import { formatAssetAmount } from "../../src/lib/project-schema.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";

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
      monthlyCapDisplay: `${formatAssetAmount(original.reward.monthlyCapMinor, 6)} TEST`,
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

test("depositor funds a real vault, recovers a submitted transaction and owner withdraws only free funds", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (event) => {
    if (event.type() === "error") errors.push(event.text());
  });
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
      route.fulfill({ json: { schemaVersion: "1", projects: [project] } }),
  );
  await page.route("**/api/v1/projects/eliza", (route) =>
    route.fulfill({ json: { project, revision: 1 } }),
  );
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
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
  );
  // The project page shows one funding line; actions live on the funding page.
  await page.goto("/projects/eliza", { waitUntil: "networkidle" });
  const summary = page.getByRole("region", { name: "Project funding" });
  await expect(summary).toContainText("no finalized vault read yet");
  await expect(
    summary.getByRole("link", { name: "Fund this project", exact: true }),
  ).toHaveAttribute("href", "/projects/eliza/funding");
  await expect(
    page.getByRole("region", { name: /^Fund or withdraw/u }),
  ).toHaveCount(0);
  await page.goto("/projects/eliza/funding", { waitUntil: "networkidle" });
  await expect(
    page
      .locator(".funding-status-grid div")
      .filter({ has: page.locator("dt", { hasText: /^Project vault$/ }) })
      .locator("dd"),
  ).toHaveText("Recorded · payments disabled");
  await expect(page.getByRole("note")).toContainText(
    "Payments are disabled for this project.",
  );
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
  await actions.evaluate((section) => {
    const sizes = [...section.querySelectorAll<HTMLElement>("*")].map(
      (element) => ({
        element,
        font: getComputedStyle(element).fontSize,
        line: getComputedStyle(element).lineHeight,
        original: element.getAttribute("style"),
      }),
    );
    for (const { element, font, line, original } of sizes) {
      element.dataset.vaultOriginalStyle = original ?? "";
      element.style.fontSize = `${parseFloat(font) * 2}px`;
      if (line !== "normal")
        element.style.lineHeight = `${parseFloat(line) * 2}px`;
    }
  });
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: info.outputPath("owner-withdrawal-200-percent-text.png"),
    fullPage: true,
  });
  await actions.evaluate((section) => {
    for (const element of section.querySelectorAll<HTMLElement>(
      "[data-vault-original-style]",
    )) {
      element.setAttribute("style", element.dataset.vaultOriginalStyle ?? "");
      delete element.dataset.vaultOriginalStyle;
    }
  });
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
    "failed on the finalized chain",
  );
  expect((await rpc("eth_getTransactionReceipt", [sends[3]])).status).toBe(
    "0x0",
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
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
  await page.goto("/projects/eliza/awards");
  await page.getByLabel("Contribution month").fill("2026-09");
  await page.getByRole("button", { name: "Load awards", exact: true }).click();
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
  await page.reload();
  await expect(ownerActions).toBeVisible();
  await ownerActions
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await expect(
    ownerActions.getByRole("button", {
      name: "Authorize this award in wallet",
    }),
  ).toHaveCount(0);
  expect(reviewReads).toBe(1);
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
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("owner turns automatic monthly payment on by default, then opts out", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (event) => {
    if (event.type() === "error") errors.push(event.text());
  });
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
      route.fulfill({ json: { schemaVersion: "1", projects: [project] } }),
  );
  await page.route("**/api/v1/projects/eliza", (route) =>
    route.fulfill({ json: { project, revision: 1 } }),
  );
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
  await page.route("**/api/v1/project-session", (route) =>
    route.fulfill({ json: { session: null } }),
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
  const cap = formatAssetAmount(project.reward.monthlyCapMinor, 6);
  await page.goto("/projects/eliza/funding", { waitUntil: "networkidle" });
  const monthly = page.getByRole("region", {
    name: "Automatic monthly payment · base-sepolia",
  });
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
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(errors).toEqual([]);
});
