/** Real local validator and public fixture wallets. No live RPC or funds. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Page, TestInfo } from "@playwright/test";
import { handlePaymentsApi } from "../../backend/payments/handler";
import {
  readVaultTotals,
  type SolanaEscrowConfig,
  solanaBase58,
  verifySolanaDeployment,
} from "../../contracts/solana/adapter";
import { verifySolanaVaultCreation } from "../../contracts/solana/owner-creation";
import { buildInitializeVaultInstructions } from "../../contracts/solana/owner-instructions";
import { message } from "../../contracts/solana/transactions";
import { startLocalSolanaValidator } from "../../scripts/local-solana-validator.mjs";
import { formatBaseUnits } from "../../src/lib/base-units.mjs";
import { decodeBase58Bytes } from "../../src/lib/base58";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
} from "../../src/lib/escrow-policy.mjs";
import { PROJECTS } from "../../src/lib/projects.mjs";
import { registryProjectDigest } from "../../src/lib/vault-setup";
import { CONTRIBUTION } from "../project-application-manifest";
import { enlargeText } from "../text-size";
import { routeMonthlyAwardReview, selectAwardMonth } from "./award-month";
import {
  type Diagnostics,
  escapeRegExp,
  expect,
  expectAccessible,
  openProjectSecuritySettings,
  serveProjectCycleIndex,
  test,
} from "./fixtures";
import { serveProjectMaintainer } from "./project-maintainer-fixture";
import {
  connectVaultSetupServer,
  spawnVaultSetupServer,
} from "./vault-setup-server";

// Dependencies are installed by the existing Solana contract test command.
const requireSolana = createRequire(
  new URL("../../contracts/solana/package.json", import.meta.url),
);
const enabled = process.env.SLOP_E2E_SOLANA_VAULT === "1";
const anchor = enabled ? requireSolana("@coral-xyz/anchor") : null;
const web3 = enabled ? requireSolana("@solana/web3.js") : null;
const spl = enabled ? requireSolana("@solana/spl-token") : null;
const root = fileURLToPath(new URL("../..", import.meta.url));
const rpcPort = Number(process.env.SLOP_E2E_SOLANA_RPC_PORT ?? "18989");
if (!Number.isInteger(rpcPort) || rpcPort < 1024 || rpcPort > 65480)
  throw new Error(
    "SLOP_E2E_SOLANA_RPC_PORT must leave room for validator ports",
  );
const rpcUrl = `http://127.0.0.1:${rpcPort}`;
const hash = (text: string) => createHash("sha256").update(text).digest();
const owner = enabled
  ? web3.Keypair.fromSeed(hash("slop-browser-local-owner"))
  : null;
const donor = enabled
  ? web3.Keypair.fromSeed(hash("slop-browser-local-donor"))
  : null;
const identity = enabled
  ? web3.Keypair.fromSeed(hash("slop-browser-local-identity"))
  : null;
const fee = enabled
  ? web3.Keypair.fromSeed(hash("slop-browser-local-fee"))
  : null;
const rotation = enabled
  ? web3.Keypair.fromSeed(hash("slop-browser-local-rotation"))
  : null;
const connection = enabled ? new web3.Connection(rpcUrl, "confirmed") : null;
let validator: Awaited<ReturnType<typeof startLocalSolanaValidator>>;
let ledger = "";
let deployment: EscrowDeployment;
let config: SolanaEscrowConfig;
let project: (typeof PROJECTS)[number];
let unrelatedTransaction = "";

test.skip(
  process.env.SLOP_E2E_SOLANA_VAULT !== "1",
  "Requires the explicit local Solana validator workflow run.",
);
test.describe.configure({ mode: "serial", timeout: 180_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async ({ browserName }, testInfo) => {
  const idl = JSON.parse(
    readFileSync(`${root}/contracts/solana/idl/slop_escrow.json`, "utf8"),
  );
  const programId = new web3.PublicKey(idl.address);
  const binary = realpathSync(
    `${root}/contracts/solana/target/deploy/slop_escrow.so`,
  );
  // The copied browser fixture can live outside the container runtime's
  // shared paths. Keep disposable input in the shared home, and mount the
  // resolved build artifact read-only without changing its directory.
  ledger = mkdtempSync(join(homedir(), ".slop-browser-validator-"));
  // A real local mint at the canonical devnet address preserves the production
  // USDC policy without using public funds or weakening asset verification.
  const mint = new web3.PublicKey(ESCROW_NETWORKS["solana-devnet"].asset);
  const mintData = Buffer.alloc(spl.MINT_SIZE);
  spl.MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority: owner.publicKey,
      supply: 0n,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: web3.PublicKey.default,
    },
    mintData,
  );
  const mintFile = `${ledger}-usdc.json`;
  writeFileSync(
    mintFile,
    JSON.stringify({
      pubkey: mint.toBase58(),
      account: {
        lamports: 1_461_600,
        data: [mintData.toString("base64"), "base64"],
        owner: spl.TOKEN_PROGRAM_ID.toBase58(),
        executable: false,
        rentEpoch: 0,
        space: spl.MINT_SIZE,
      },
    }),
  );
  validator = await startLocalSolanaValidator({
    rpcPort,
    readonlyMounts: [binary, mintFile],
    receiptPath: testInfo.outputPath(
      `${browserName}-solana-validator-receipt.json`,
    ),
    args: [
      "--reset",
      "--quiet",
      "--ledger",
      ledger,
      "--rpc-port",
      String(rpcPort),
      "--faucet-port",
      String(rpcPort + 51),
      "--dynamic-port-range",
      `${rpcPort + 12}-${rpcPort + 41}`,
      "--account",
      mint.toBase58(),
      mintFile,
      "--upgradeable-program",
      idl.address,
      binary,
      owner.publicKey.toBase58(),
    ],
    stdio: "ignore",
  });
  const airdrop = await connection.requestAirdrop(
    owner.publicKey,
    100 * web3.LAMPORTS_PER_SOL,
  );
  unrelatedTransaction = airdrop;
  await connection.confirmTransaction(airdrop, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(owner),
    { commitment: "confirmed" },
  );
  const program = new anchor.Program(idl, provider);
  const pda = (...seeds: Buffer[]) =>
    web3.PublicKey.findProgramAddressSync(seeds, programId)[0];
  const configPda = pda(Buffer.from("config"));
  const programData = web3.PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    new web3.PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
  )[0];
  await program.methods
    .initializeConfig(identity.publicKey, fee.publicKey, rotation.publicKey)
    .accountsStrict({
      authority: owner.publicKey,
      config: configPda,
      program: programId,
      programData,
      systemProgram: web3.SystemProgram.programId,
    })
    .rpc();
  const digest = hash("slop-browser-local-project");
  const domain = hash("slop-browser-local-domain");
  const projectPda = pda(
    Buffer.from("project"),
    owner.publicKey.toBuffer(),
    digest,
    Buffer.from([0]),
  );
  const vault = pda(Buffer.from("vault"), projectPda.toBuffer());
  const initialized = await program.methods
    .initialize(
      [...digest],
      [...domain],
      identity.publicKey,
      fee.publicKey,
      new anchor.BN(3600),
      new anchor.BN(7200),
      { ordinary: {} },
    )
    .accountsStrict({
      owner: owner.publicKey,
      project: projectPda,
      mint,
      vault,
      tokenProgram: spl.TOKEN_PROGRAM_ID,
      systemProgram: web3.SystemProgram.programId,
      config: configPda,
    })
    .rpc();
  await web3.sendAndConfirmTransaction(
    connection,
    new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey: owner.publicKey,
        toPubkey: donor.publicKey,
        lamports: web3.LAMPORTS_PER_SOL,
      }),
    ),
    [owner],
  );
  const source = await spl.getOrCreateAssociatedTokenAccount(
    connection,
    owner,
    mint,
    donor.publicKey,
  );
  const minted = await spl.mintTo(
    connection,
    owner,
    mint,
    source.address,
    owner,
    100_000_000n,
  );
  await connection.confirmTransaction(minted, "finalized");
  deployment = {
    network: "solana-devnet",
    vault: vault.toBase58(),
    asset: mint.toBase58(),
    owner: owner.publicKey.toBase58(),
    identityAuthority: identity.publicKey.toBase58(),
    feeRecipient: fee.publicKey.toBase58(),
    rotationAuthority: rotation.publicKey.toBase58(),
    programId: idl.address,
    projectPda: projectPda.toBase58(),
    networkDomain: domain.toString("hex"),
    upgradeAuthority: owner.publicKey.toBase58(),
    bindingDelaySeconds: "3600",
    rotationDelaySeconds: "7200",
    factory: null,
    registrar: null,
    factoryCodeSha256: null,
    deploymentTransaction: initialized,
    sourceCommit: "a".repeat(40),
    codeSha256: createHash("sha256").update(readFileSync(binary)).digest("hex"),
  };
  config = {
    ...deployment,
    projectId: "eliza",
    mint: deployment.asset,
    rpcUrl,
    genesisHash: await connection.getGenesisHash(),
  } as SolanaEscrowConfig;
  const original = PROJECTS.find((p) => p.id === "eliza");
  if (original?.reward.kind !== "monthly-pool")
    throw new Error("Missing monthly project fixture");
  project = {
    ...original,
    reward: {
      ...original.reward,
      chain: "solana",
      currency: "TEST",
      monthlyCapDisplay: `${formatBaseUnits(original.reward.monthlyCapMinor, 6)} TEST`,
      feeBasisPoints: 200,
      paymentMode: "disabled",
      committedMinor: "0",
      fundingState: "pledged",
    },
    rewardAsset: {
      network: "solana",
      kind: "token",
      address: deployment.asset,
      symbol: "TEST",
      decimals: 6,
      chainId: null,
      cluster: "mainnet-beta",
      verifiedAt: "2026-10-22T00:00:00.000Z",
    },
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-10",
      chain: "solana",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [deployment],
    },
  } as typeof project;
});
test.afterAll(async () => {
  // A rejected start can include uncertain engine cleanup. Keep its mounted
  // input for diagnosis; only a returned handle can confirm safe removal.
  if (!validator) return;
  await validator.close();
  if (ledger) {
    rmSync(ledger, { recursive: true, force: true });
    rmSync(`${ledger}-usdc.json`, { force: true });
  }
});

function installLocalSolanaWallet() {
  const bridge = window as unknown as {
    localSolanaAccount(): Promise<{ address: string; publicKey: number[] }>;
    localSolanaSend(
      wire: number[],
      address: string,
      chain: string,
    ): Promise<{ error?: string; signature?: number[] }>;
  };
  let accounts: {
    address: string;
    publicKey: Uint8Array;
    chains: string[];
    features: string[];
  }[] = [];
  const wallet = {
    name: "Local Solana wallet",
    version: "1.0.0",
    icon: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E",
    chains: ["solana:devnet"],
    get accounts() {
      return accounts;
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          const next = await bridge.localSolanaAccount();
          accounts = [
            {
              address: next.address,
              publicKey: Uint8Array.from(next.publicKey),
              chains: ["solana:devnet"],
              features: ["solana:signMessage", "solana:signAndSendTransaction"],
            },
          ];
          return { accounts };
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async () => {
          throw new Error("Funding must not request an account-link message");
        },
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy"],
        signAndSendTransaction: async ({
          transaction,
          account,
          chain,
        }: {
          transaction: Uint8Array;
          account: { address: string };
          chain: string;
        }) => {
          const result = await bridge.localSolanaSend(
            [...transaction],
            account.address,
            chain,
          );
          if (result.error === "rejected")
            throw Object.assign(new Error("User rejected"), { code: 4001 });
          if (result.error)
            throw new Error("Transport interrupted after submission");
          return [{ signature: Uint8Array.from(result.signature ?? []) }];
        },
      },
    },
  };
  window.addEventListener("wallet-standard:app-ready", (event) =>
    (event as CustomEvent).detail.register(wallet),
  );
}

test.beforeEach(async ({ diagnostics }) => {
  diagnostics.allowPreviewApiMisses();
});

test("Solana wallet deposits, recovers after reload, and owner withdraws with verified fee", async ({
  diagnostics,
  page,
}, info) => {
  // The two funding rejections, asserted through apiRejections below.
  diagnostics.allow(
    /^(?:console Failed to load resource: the server responded with a status of 422 .* at |422 POST )http:\/\/[^ ]+\/api\/v1\/payments\/projects\/eliza\/solana-funding$/u,
  );
  // The commitment service refuses the donor wallet, the wrong transaction
  // and the repeated review below; the count is checked at the end.
  const refusedCommitment = diagnostics.allowResponse(
    422,
    "POST",
    "/api/v1/payments/projects/eliza/monthly/2026-09/solana-commitment",
  );
  let selected = donor;
  let reject = false;
  let interrupted = false;
  const sends: string[] = [];
  const apiRejections: number[] = [];
  await page.exposeFunction("localSolanaAccount", () => ({
    address: selected.publicKey.toBase58(),
    publicKey: [...selected.publicKey.toBytes()],
  }));
  await page.exposeFunction(
    "localSolanaSend",
    async (wire: number[], address: string, chain: string) => {
      expect(chain).toBe("solana:devnet");
      expect(address).toBe(selected.publicKey.toBase58());
      if (reject) return { error: "rejected" };
      const transaction = web3.Transaction.from(Uint8Array.from(wire));
      transaction.sign(selected);
      const signature = await connection.sendRawTransaction(
        transaction.serialize(),
        { skipPreflight: false, maxRetries: 0 },
      );
      sends.push(signature);
      return interrupted
        ? { error: "unknown" }
        : { signature: [...decodeBase58Bytes(signature)] };
    },
  );
  await page.addInitScript(installLocalSolanaWallet);
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
  await serveProjectMaintainer(page, () => project);
  await serveProjectCycleIndex(page, [project.id]);
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
  await page.route(
    "**/api/v1/payments/projects/eliza/solana-funding",
    async (route) => {
      const response = await handlePaymentsApi(
        new Request(
          "https://slop.cash/api/v1/payments/projects/eliza/solana-funding",
          {
            method: "POST",
            headers: {
              origin: "https://slop.cash",
              "content-type": "application/json",
            },
            body: route.request().postData(),
          },
        ),
        {
          db: {
            prepare() {
              throw new Error("No Slop login is required for funding");
            },
          } as never,
          solanaFundingConfig: async (id, network, vault) => {
            expect(id).toBe("eliza");
            expect(network).toBe(deployment.network);
            expect(vault).toBe(deployment.vault);
            return config;
          },
        },
      );
      if (!response.ok) apiRejections.push(response.status);
      await route.fulfill({
        status: response.status,
        contentType: "application/json",
        body: await response.text(),
      });
    },
  );
  await page.goto("/projects/eliza/manage", { waitUntil: "networkidle" });
  const actions = page.getByRole("region", {
    name: "Fund or withdraw · Solana Devnet (test)",
    exact: true,
  });
  const connect = () =>
    actions
      .getByRole("button", { name: "Connect Local Solana wallet", exact: true })
      .click();
  await connect();
  await actions.getByLabel("Token amount", { exact: true }).fill("101");
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
    path: info.outputPath("solana-deposit-review.png"),
    fullPage: true,
  });
  reject = true;
  await actions
    .getByRole("button", { name: "Confirm deposit in wallet", exact: true })
    .click();
  await expect(actions.getByRole("alert")).toContainText("You declined");
  expect(sends).toHaveLength(0);
  reject = false;
  interrupted = true;
  await actions
    .getByRole("button", { name: "Confirm deposit in wallet", exact: true })
    .click();
  await expect(actions.getByRole("alert")).toContainText(
    "wallet result is unclear",
  );
  await page.reload({ waitUntil: "networkidle" });
  await connect();
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
  await actions
    .getByLabel("Transaction signature from your wallet")
    .fill("1".repeat(64));
  await actions
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(actions.getByRole("status")).toContainText(
    "Waiting for finalized chain evidence",
  );
  expect(sends).toHaveLength(1);
  await page.screenshot({
    path: info.outputPath("solana-unknown-signature-pending.png"),
    fullPage: true,
  });
  await page.reload({ waitUntil: "networkidle" });
  await connect();
  const recovery = actions.getByLabel("Transaction signature from your wallet");
  await expect(recovery).toHaveValue("1".repeat(64));
  await expect(recovery).toBeEditable();
  await expect(
    actions.getByRole("button", {
      name: "Confirm deposit in wallet",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    actions.getByRole("button", {
      name: "I checked my wallet; this request was not sent",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(sends).toHaveLength(1);
  const pendingKey = `slop:vault-action:v1:${deployment.network}:${deployment.vault}:${deployment.asset}`;
  const retained = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    pendingKey,
  );
  if (!retained) throw new Error("The recovery candidate was not saved");
  expect(JSON.parse(retained).hashSource).toBe("recovery");
  // A quota failure must retain the candidate in memory without offering a
  // second send. The next successful check saves it for reload recovery.
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) {
        Storage.prototype.setItem = original;
        throw new DOMException("Storage is full", "QuotaExceededError");
      }
      return original.call(this, name, value);
    };
  }, pendingKey);
  await actions
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(actions.getByRole("status")).toContainText(
    "Not saved on this device",
  );
  await expect(recovery).toHaveValue("1".repeat(64));
  await expect(recovery).toBeEditable();
  expect(sends).toHaveLength(1);
  await actions
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  // Records from before hash provenance existed retain an editable candidate.
  await page.evaluate((key) => {
    const text = sessionStorage.getItem(key);
    if (!text) throw new Error("The recovery record is missing");
    const value = JSON.parse(text);
    delete value.hashSource;
    sessionStorage.setItem(key, JSON.stringify(value));
  }, pendingKey);
  await page.reload({ waitUntil: "networkidle" });
  await connect();
  await expect(recovery).toHaveValue("1".repeat(64));
  await expect(recovery).toBeEditable();
  // A malformed provenance marker cannot enable a new funding action.
  await page.evaluate((key) => {
    const text = sessionStorage.getItem(key);
    if (!text) throw new Error("The recovery record is missing");
    const value = JSON.parse(text);
    value.hashSource = "unrecognized";
    sessionStorage.setItem(key, JSON.stringify(value));
  }, pendingKey);
  await page.reload({ waitUntil: "networkidle" });
  await expect(actions.getByRole("alert")).toContainText(
    "saved transaction cannot be read",
  );
  await expect(
    actions.getByRole("button", {
      name: "Confirm deposit in wallet",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), {
    key: pendingKey,
    value: retained,
  });
  await page.reload({ waitUntil: "networkidle" });
  await connect();
  await expect(recovery).toHaveValue("1".repeat(64));
  await recovery.focus();
  await expect(recovery).toBeFocused();
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("solana-recovery-candidate-editable.png"),
    fullPage: true,
  });
  const restoreText = await enlargeText(page.locator("body"));
  try {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("solana-recovery-candidate-200-percent.png"),
      fullPage: true,
    });
  } finally {
    await restoreText();
  }
  await connection.confirmTransaction(unrelatedTransaction, "finalized");
  await recovery.fill(unrelatedTransaction);
  await recovery.press("Tab");
  const checkTransaction = actions.getByRole("button", {
    name: "Check transaction",
    exact: true,
  });
  await expect(checkTransaction).toBeFocused();
  await checkTransaction.press("Enter");
  await expect(actions.getByRole("alert")).toContainText(
    "does not match the pending wallet action",
  );
  await actions
    .getByLabel("Transaction signature from your wallet")
    .fill(sends[0]);
  await connection.confirmTransaction(sends[0], "finalized");
  await actions
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(actions.getByRole("status")).toContainText("Deposit verified");
  // A depositor's wallet is offered no withdrawal; the owner's wallet is.
  await expect(
    actions.getByRole("radio", { name: "Withdraw free funds", exact: true }),
  ).toHaveCount(0);
  await expect(actions).toContainText(
    "Only the vault owner's wallet can withdraw free funds.",
  );
  selected = owner;
  interrupted = false;
  await actions.getByRole("button", { name: "Choose another wallet" }).click();
  await connect();
  await actions
    .getByRole("radio", { name: "Withdraw free funds", exact: true })
    .check();
  await actions.getByLabel("Token amount", { exact: true }).fill("5");
  await actions
    .getByRole("button", { name: "Review withdrawal", exact: true })
    .click();
  await expect(
    actions.getByRole("region", { name: "Review vault action" }),
  ).toContainText("4.9");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: info.outputPath("solana-withdrawal-review.png"),
    fullPage: true,
  });
  await actions
    .getByRole("button", { name: "Confirm withdrawal in wallet", exact: true })
    .click();
  await expect.poll(() => sends.length).toBe(2);
  await connection.confirmTransaction(sends[1], "finalized");
  await actions
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(actions.getByRole("status")).toContainText(
    "Withdrawal verified",
  );
  const account = await spl.getAccount(
    connection,
    spl.getAssociatedTokenAddressSync(
      new web3.PublicKey(deployment.asset),
      owner.publicKey,
    ),
  );
  expect(account.amount).toBe(4_900_000n);
  // The donor withdrawal is blocked by the UI; only the oversized deposit
  // and mismatched recovery signature reach the API and fail.
  expect(apiRejections).toEqual([422, 422]);
  // Finalized awards and session are controlled fixtures; the API planner, wallet and
  // finalized commitment verifier below use the actual local Solana program.
  const { commitment, review } = await routeMonthlyAwardReview(
    page,
    deployment,
  );
  await page.route(
    "**/api/v1/payments/projects/eliza/monthly/2026-09/solana-commitment",
    async (route) => {
      const response = await handlePaymentsApi(
        new Request(
          "https://slop.cash/api/v1/payments/projects/eliza/monthly/2026-09/solana-commitment",
          {
            method: "POST",
            headers: {
              origin: "https://slop.cash",
              "content-type": "application/json",
              cookie: `__Host-slop_points=${"s".repeat(48)}`,
            },
            body: route.request().postData(),
          },
        ),
        {
          db: {
            prepare() {
              return {
                bind() {
                  return {
                    async first() {
                      return { github_id: "1", login: "local-owner" };
                    },
                  };
                },
              };
            },
          } as never,
          monthly: {
            commitment: async () => {
              if (!review.available)
                throw new Error("Award fixture is unavailable");
              return commitment as never;
            },
          } as never,
          solanaFundingConfig: async (id, network, vault) => {
            expect(id).toBe("eliza");
            expect(network).toBe(deployment.network);
            expect(vault).toBe(deployment.vault);
            return config;
          },
        },
      );
      await route.fulfill({
        status: response.status,
        contentType: "application/json",
        body: await response.text(),
      });
    },
  );
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Review monthly awards" }).click();
  await selectAwardMonth(page, "2026-09");
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
  const connectOwner = () =>
    ownerActions
      .getByRole("button", { name: "Connect Local Solana wallet", exact: true })
      .click();
  selected = donor;
  await connectOwner();
  await ownerActions
    .getByRole("button", { name: "Verify award and funding" })
    .click();
  await expect(ownerActions.getByRole("alert")).toContainText("owner's wallet");
  await ownerActions
    .getByRole("button", { name: "Choose another wallet" })
    .click();
  selected = owner;
  await connectOwner();
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
    path: info.outputPath("solana-commitment-review.png"),
    fullPage: true,
  });
  reject = true;
  await ownerActions
    .getByRole("button", { name: "Authorize this award in wallet" })
    .click();
  await expect(ownerActions.getByRole("alert")).toContainText("You declined");
  expect(sends).toHaveLength(2);
  reject = false;
  interrupted = true;
  await ownerActions
    .getByRole("button", { name: "Authorize this award in wallet" })
    .click();
  await expect(ownerActions.getByRole("alert")).toContainText(
    "wallet result is unclear",
  );
  expect(sends).toHaveLength(3);
  review.available = false;
  await page.reload({ waitUntil: "networkidle" });
  await connectOwner();
  expect(review.reads).toBe(1);
  await expect(
    ownerActions.getByRole("button", {
      name: "Authorize this award in wallet",
    }),
  ).toHaveCount(0);
  await ownerActions.getByLabel("Commitment transaction hash").fill(sends[0]);
  await ownerActions
    .getByRole("button", { name: "Check commitment", exact: true })
    .click();
  await expect(ownerActions.getByRole("alert")).toContainText("does not match");
  await ownerActions.getByLabel("Commitment transaction hash").fill(sends[2]);
  await connection.confirmTransaction(sends[2], "finalized");
  await ownerActions
    .getByRole("button", { name: "Check commitment", exact: true })
    .click();
  await expect(ownerActions.getByRole("status")).toContainText(
    "Award reserved on the finalized chain",
  );
  review.available = true;
  interrupted = false;
  await ownerActions
    .getByRole("button", { name: "Verify award and funding" })
    .click();
  await expect(ownerActions.getByRole("alert")).toContainText(
    "already committed",
  );
  expect(sends).toHaveLength(3);
  expect(diagnostics.count(refusedCommitment)).toBe(3);
  await expectAccessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

async function ownerSetupWorkflow(
  { diagnostics, page }: { diagnostics: Diagnostics; page: Page },
  info: TestInfo,
  bounty: boolean,
) {
  test.setTimeout(480_000);
  const automatic = !bounty && !info.project.name.includes("mobile");
  const temporary = mkdtempSync(join(tmpdir(), "slop-solana-setup-"));
  const apiPort = rpcPort + 60;
  const origin = `http://127.0.0.1:${apiPort}`;
  const target = {
    ...project,
    contribution: CONTRIBUTION,
    skill: {
      ...project.skill,
      publishAtRoot: false,
      sourcePath: "skills/project-contributor-template",
    },
    reviewSkill: {
      id: `review-${project.id}-contributions`,
      sourcePath: "skills/project-reviewer-template",
    },
    reward: {
      ...project.reward,
      monthlyCapMinor: "1000000000",
      monthlyCapDisplay: "1,000 TEST",
    },
    escrow: { ...project.escrow, deployments: [] },
  };
  if (bounty) {
    Object.assign(target.reward, {
      monthlyCapMinor: "0",
      monthlyCapDisplay: "0 TEST",
      committedMinor: "0",
      paymentMode: "disabled",
    });
    delete target.reward.reviewBudget;
    delete target.reward.cycleCaps;
    const contact = { githubId: "900000071", githubLogin: "vault-owner" };
    const repository = target.repositories[0].id;
    Object.assign(target, {
      securityBounty: {
        version: "1",
        status: "paused",
        rewardMode: "bounty-only",
        eligibility: "critical-loss-of-funds",
        amount: {
          currency: "USDC",
          decimals: 6,
          network: "solana",
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
        intake: {
          kind: "github-private-vulnerability-reporting",
          repository,
        },
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
  }

  // The first vault has reviewed program infrastructure but no template project.
  const program = {
    network: deployment.network,
    sourceCommit: deployment.sourceCommit,
    programId: deployment.programId,
    networkDomain: deployment.networkDomain,
    codeSha256: deployment.codeSha256,
    upgradeAuthority: deployment.upgradeAuthority,
    identityAuthority: deployment.identityAuthority,
    feeRecipient: deployment.feeRecipient,
    rotationAuthority: deployment.rotationAuthority,
    bindingDelaySeconds: deployment.bindingDelaySeconds,
    rotationDelaySeconds: deployment.rotationDelaySeconds,
  };
  const file = join(temporary, "projects.json");
  writeFileSync(file, JSON.stringify({ project: target, program }));
  // Only the isolated harness bundle changes the expected public-cluster identity.
  // The RPC, program code, Config, transactions, signatures and balances remain real.
  mkdirSync(join(temporary, "tests"));
  symlinkSync(join(root, "migrations"), join(temporary, "migrations"), "dir");
  const bundle = join(temporary, "tests", "server.mjs");
  execFileSync(
    "bun",
    [
      "build",
      "scripts/vault-setup-browser-server.ts",
      "--target=bun",
      `--outfile=${bundle}`,
    ],
    { cwd: root },
  );
  const original = readFileSync(bundle, "utf8");
  const publicGenesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
  expect(original.includes(publicGenesis)).toBe(true);
  const overlaid = original.replaceAll(publicGenesis, config.genesisHash);
  writeFileSync(bundle, overlaid);
  await info.attach("local-network-overlay.json", {
    body: JSON.stringify(
      {
        originalBundleSha256: hash(original).toString("hex"),
        bundleSha256: hash(overlaid).toString("hex"),
        network: "solana-devnet",
        publicGenesis,
        localGenesis: config.genesisHash,
        note: "Only the isolated test bundle changes its expected cluster identity; production source is unchanged.",
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  const { server, output } = spawnVaultSetupServer(
    [bundle, file, String(apiPort), rpcUrl],
    { cwd: root, env: { ...process.env, SLOP_E2E_VAULT_ACTIONS: "1" } },
  );
  const sends: string[] = [];
  let interrupted = true;
  try {
    const { initial, headers, api } = await connectVaultSetupServer(
      page,
      origin,
      output,
    );
    expect(initial.projects).toBe(1);
    const setupStatus = () =>
      page.request
        .get(`${origin}/api/v1/project-vaults/${project.id}`, { headers })
        .then((r) => r.json());
    expect((await setupStatus()).networks).toEqual(["solana-devnet"]);
    await page.request.post(`${origin}/__fixture`, {
      data: { templatesEnabled: false },
    });
    expect((await setupStatus()).networks).toEqual([]);
    await page.request.post(`${origin}/__fixture`, {
      data: { templatesEnabled: true },
    });
    const claim = await api("payments/wallets/register", {
      chain: "solana",
      address: donor.publicKey.toBase58(),
    });
    const challenge = await api("payments/wallets/challenge", {
      claimId: claim.claimId,
    });
    await api("payments/wallets/authorize", {
      claimId: claim.claimId,
      challengeId: challenge.challengeId,
      signature: Buffer.from(
        ed25519.sign(
          new TextEncoder().encode(challenge.message),
          donor.secretKey.slice(0, 32),
        ),
      ).toString("base64"),
    });
    const reviewed = await api(`project-vaults/${project.id}`, {
      step: "review",
      expectedRevision: 1,
      network: "solana-devnet",
      claimId: claim.claimId,
      automatic,
      payoutPolicy: bounty ? "security-bounty" : "ordinary",
    });
    expect(
      await verifySolanaVaultCreation(
        config,
        reviewed.review.creation,
        solanaBase58(new Uint8Array(64)),
      ),
    ).toBeNull();
    await page.exposeFunction("localSolanaAccount", () => ({
      address: donor.publicKey.toBase58(),
      publicKey: [...donor.publicKey.toBytes()],
    }));
    await page.exposeFunction(
      "localSolanaSend",
      async (wire: number[], address: string, chain: string) => {
        expect(address).toBe(donor.publicKey.toBase58());
        expect(chain).toBe("solana:devnet");
        const transaction = web3.Transaction.from(Uint8Array.from(wire));
        transaction.sign(donor);
        const signature = await connection.sendRawTransaction(
          transaction.serialize(),
          { skipPreflight: false, maxRetries: 0 },
        );
        sends.push(signature);
        return interrupted
          ? { error: "unknown" }
          : { signature: [...decodeBase58Bytes(signature)] };
      },
    );
    await page.addInitScript(installLocalSolanaWallet);
    await page.addInitScript((token) => {
      // biome-ignore lint/suspicious/noDocumentCookie: The actual local API session is reused by the browser.
      document.cookie = `__Host-slop_points=${token}; Path=/; Secure; SameSite=Strict`;
    }, initial.token);
    // The wrong-signature rejection and the private read outage below;
    // failedRequests checks their timing.
    diagnostics.allow(
      new RegExp(
        `^console Failed to load resource: the server responded with a status of (?:422|503) .* at ${escapeRegExp(origin)}/api/v1/`,
        "u",
      ),
    );
    const failedRequests: string[] = [];
    let wrongSignature = false;
    let privateUnavailable = false;
    let privateErrors = 0;
    page.on("console", (event) => {
      if (
        event.type() === "error" &&
        privateUnavailable &&
        event.text().includes("503")
      )
        privateErrors++;
    });
    page.on("response", (response) => {
      if (
        response.url().startsWith(origin) &&
        response.status() >= 400 &&
        !(wrongSignature && response.status() === 422) &&
        !(privateUnavailable && response.status() === 503)
      )
        failedRequests.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(`${origin}/projects/${project.slug}/manage`, {
      waitUntil: "networkidle",
    });
    if (bounty) await openProjectSecuritySettings(page);
    const setup = page.getByRole("region", {
      name: bounty ? "Set up bounty vault" : "Set up project vault",
    });
    const reviewUrl = `${origin}/api/v1/project-vaults/${project.id}`;
    if (bounty) {
      // New bounties use direct payments. The retained vault API still admits
      // existing vault-backed programs; qualify it before their funding UI.
      await expect(setup).toHaveCount(0);
      const transaction = web3.Transaction.from(
        Buffer.from(reviewed.review.transaction.transaction, "base64"),
      );
      transaction.sign(donor);
      sends.push(await connection.sendRawTransaction(transaction.serialize()));
    } else {
      await setup
        .getByRole("button", { name: "Connect Local Solana wallet" })
        .click();
      const monthly = setup.getByRole("combobox", {
        name: "Automatic monthly payment",
        exact: true,
      });
      if (bounty) await expect(monthly).toHaveCount(0);
      else {
        await expect(monthly).toHaveValue("on");
        if (!automatic) await monthly.selectOption("off");
      }
      // Capture the reply in a route: Chrome can drop a streamed body before
      // response.json() reads it through DevTools.
      let browserReview:
        | { transaction: { blockhash: string; lastValidBlockHeight: number } }
        | undefined;
      await page.route(reviewUrl, async (route) => {
        const request = route.request();
        if (
          request.method() !== "POST" ||
          request.postDataJSON().step !== "review"
        )
          return route.fallback();
        const response = await route.fetch();
        const body = await response.json();
        browserReview ??= body.review;
        await route.fulfill({ response, json: body });
      });
      await setup
        .getByRole("button", { name: "Review vault creation" })
        .click();
      await expect(
        setup.getByRole("button", { name: "Create vault in wallet" }),
      ).toBeEnabled();
      await page.unroute(reviewUrl);
      if (!browserReview)
        throw new Error("The browser review reply was not captured.");
      await page.screenshot({
        path: info.outputPath("solana-create-review.png"),
        fullPage: true,
      });
      if (automatic) {
        // A normal owner can leave this review open past the Solana transaction lifetime.
        await expect
          .poll(() => connection.getBlockHeight("confirmed"), {
            timeout: 240_000,
            intervals: [1000],
          })
          .toBeGreaterThan(browserReview.transaction.lastValidBlockHeight);
        const validity = await connection.isBlockhashValid(
          browserReview.transaction.blockhash,
          "confirmed",
        );
        expect(validity.value).toBe(false);
        await info.attach("expired-creation-review.json", {
          body: JSON.stringify({
            blockhash: browserReview.transaction.blockhash,
            lastValidBlockHeight:
              browserReview.transaction.lastValidBlockHeight,
            blockHeightBeforeCreate:
              await connection.getBlockHeight("confirmed"),
            validBeforeCreate: validity.value,
          }),
          contentType: "application/json",
        });
      }
      await setup
        .getByRole("button", { name: "Create vault in wallet" })
        .click();
      await expect(setup.getByRole("alert")).toContainText(
        "Transport interrupted",
      );
      expect(sends).toHaveLength(1);
    }
    await page.reload({ waitUntil: "networkidle" });
    if (bounty) await openProjectSecuritySettings(page);
    if (!bounty) {
      const edited = structuredClone(target);
      edited.reward.monthlyCapMinor = "2000000000";
      edited.reward.monthlyCapDisplay = "2,000 TEST";
      const changed = await page.request.put(
        `${origin}/api/v1/projects/${project.id}`,
        { headers, data: { manifest: edited, expectedRevision: 1 } },
      );
      expect(changed.ok(), JSON.stringify(await changed.json())).toBe(true);
    }
    wrongSignature = true;
    if (bounty) {
      const mismatch = await page.request.post(reviewUrl, {
        headers,
        data: {
          step: "register",
          expectedRevision: 1,
          network: "solana-devnet",
          claimId: claim.claimId,
          automatic,
          payoutPolicy: "security-bounty",
          transactionId: deployment.deploymentTransaction,
        },
      });
      expect(mismatch.status()).toBe(422);
    } else {
      await setup
        .getByLabel("Creation transaction signature")
        .fill(deployment.deploymentTransaction);
      await setup
        .getByRole("button", { name: "Check vault registration" })
        .click();
      await expect(setup.getByRole("alert")).toContainText("does not match");
    }
    wrongSignature = false;
    await connection.confirmTransaction(sends[0], "finalized");
    // A new infrastructure pin must not strand an already finalized creation
    // under an earlier reviewed domain. The account alone is not a review.
    const newDomain = hash("slop-browser-new-domain").toString("hex");
    await page.request.post(`${origin}/__fixture`, {
      data: { programReview: { networkDomain: newDomain } },
    });
    const registration = {
      step: "register",
      expectedRevision: 1,
      network: "solana-devnet",
      claimId: claim.claimId,
      automatic,
      payoutPolicy: bounty ? "security-bounty" : "ordinary",
      transactionId: sends[0],
    };
    const unreviewed = await page.request.post(reviewUrl, {
      headers,
      data: registration,
    });
    expect(unreviewed.status()).toBe(422);
    expect((await unreviewed.json()).error).toBe("vault_creation_invalid");
    const other = PROJECTS.filter(
      (p) => p.id !== project.id && p.reward.kind === "monthly-pool",
    )[bounty ? 1 : 0];
    if (!other) throw new Error("Second registry fixture missing");
    const retainedCreation = {
      ...reviewed.review.creation,
      owner: owner.publicKey.toBase58(),
      projectDigest: registryProjectDigest(other.id),
      payoutPolicy: "ordinary" as const,
      monthlyCap: project.reward.monthlyCapMinor,
      automaticMonthly: false,
    };
    const retainedPlan = buildInitializeVaultInstructions(retainedCreation);
    const retainedBlock = await connection.getLatestBlockhash("finalized");
    const retainedTransaction = web3.Transaction.from(
      Buffer.concat([
        Buffer.from([1]),
        Buffer.alloc(64),
        message(
          retainedCreation.owner,
          retainedBlock.blockhash,
          retainedPlan.instructions,
        ),
      ]),
    );
    retainedTransaction.sign(owner);
    const retainedSignature = await connection.sendRawTransaction(
      retainedTransaction.serialize(),
    );
    await connection.confirmTransaction(retainedSignature, "finalized");
    const retainedDeployment = {
      ...deployment,
      projectPda: retainedPlan.projectPda,
      vault: retainedPlan.vault,
      deploymentTransaction: retainedSignature,
    };
    await verifySolanaDeployment(
      {
        ...config,
        projectPda: retainedPlan.projectPda,
        vault: retainedPlan.vault,
        payoutPolicy: "ordinary",
      },
      retainedCreation.projectDigest,
    );
    const retainedProject = {
      ...other,
      reward: project.reward,
      rewardAsset: project.rewardAsset,
      escrow: { ...project.escrow, deployments: [retainedDeployment] },
    };
    await page.request.post(`${origin}/__fixture`, {
      data: { retainedProject },
    });
    await info.attach("retained-domain-recovery.json", {
      body: JSON.stringify(
        {
          previousReviewedDomain: deployment.networkDomain,
          newReviewedDomain: newDomain,
          retainedProject: other.id,
          retainedSignature,
          refusedWithoutRetainedReview: unreviewed.status(),
          targetSignature: sends[0],
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    if (bounty) {
      await api(`project-vaults/${project.id}`, registration);
      await page.reload({ waitUntil: "networkidle" });
      await openProjectSecuritySettings(page);
    } else {
      await setup.getByLabel("Creation transaction signature").fill(sends[0]);
      await setup
        .getByRole("button", { name: "Check vault registration" })
        .click();
      await expect(setup).toHaveCount(0);
    }
    if (!bounty) {
      await page
        .locator("summary")
        .filter({ hasText: /^Monthly rewards$/u })
        .click();
      await expect(
        page.getByRole("textbox", { name: /^Monthly amount/u }),
      ).toHaveValue("2000");
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Creation used a monthly cap" }),
      ).toContainText("1,000 TEST. The project now uses 2,000 TEST");
    }
    const state = await (await page.request.get(`${origin}/__fixture`)).json();
    expect(state.project.revision).toBe(bounty ? 2 : 3);
    expect(state.revisions.n).toBe(bounty ? 2 : 3);
    const created = bounty
      ? state.project.manifest.securityBounty.settlement.deployments[0]
      : state.project.manifest.escrow.deployments[0];
    expect(created.owner).toBe(donor.publicKey.toBase58());
    expect(created.deploymentTransaction).toBe(sends[0]);
    expect(created.networkDomain).toBe(deployment.networkDomain);
    const program = new anchor.Program(
      JSON.parse(
        readFileSync(`${root}/contracts/solana/idl/slop_escrow.json`, "utf8"),
      ),
      new anchor.AnchorProvider(connection, new anchor.Wallet(owner), {
        commitment: "finalized",
      }),
    );
    const account = await program.account.project.fetch(
      new web3.PublicKey(created.projectPda),
      "finalized",
    );
    expect(account.monthlyEnabled).toBe(automatic);
    expect(account.monthlyCap.toString()).toBe(bounty ? "0" : "1000000000");
    const createdConfig = {
      ...config,
      ...created,
      mint: created.asset,
      payoutPolicy: bounty
        ? ("security-bounty" as const)
        : ("ordinary" as const),
    };
    const digest = registryProjectDigest(project.id);
    await expect(
      verifySolanaDeployment(createdConfig, "f".repeat(64)),
    ).rejects.toThrow("different registry project");
    await expect(
      verifySolanaDeployment(
        { ...createdConfig, projectPda: deployment.projectPda },
        digest,
      ),
    ).rejects.toThrow("different registry project");
    await expect(
      verifySolanaDeployment(
        { ...createdConfig, owner: owner.publicKey.toBase58() },
        digest,
      ),
    ).rejects.toThrow();
    await expect(
      verifySolanaDeployment(
        { ...createdConfig, mint: owner.publicKey.toBase58() },
        digest,
      ),
    ).rejects.toThrow("asset mismatch");
    // A real duplicate initialize fails. Only its exact signed message qualifies as failed.
    const duplicatePlan = buildInitializeVaultInstructions(
      reviewed.review.creation,
    );
    const duplicateBlock = await connection.getLatestBlockhash("finalized");
    const duplicateTx = web3.Transaction.from(
      Buffer.concat([
        Buffer.from([1]),
        Buffer.alloc(64),
        message(
          donor.publicKey.toBase58(),
          duplicateBlock.blockhash,
          duplicatePlan.instructions,
        ),
      ]),
    );
    duplicateTx.sign(donor);
    const failedCreation = await connection.sendRawTransaction(
      duplicateTx.serialize(),
      { skipPreflight: true, maxRetries: 0 },
    );
    // web3.js may either return a failed signature notification or throw its
    // error from the HTTP status race. This case expects failure: require the
    // exact finalized receipt before testing its rejection by the verifier.
    await expect
      .poll(
        async () => {
          const receipt = await connection.getTransaction(failedCreation, {
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          });
          return (
            receipt?.transaction.signatures[0] === failedCreation &&
            receipt.meta?.err != null
          );
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    await expect(
      verifySolanaVaultCreation(
        config,
        reviewed.review.creation,
        failedCreation,
      ),
    ).rejects.toThrow("exact vault creation transaction failed");

    await api(`project-vaults/${project.id}`, {
      step: "register",
      expectedRevision: 1,
      network: "solana-devnet",
      claimId: claim.claimId,
      automatic,
      payoutPolicy: bounty ? "security-bounty" : "ordinary",
      transactionId: sends[0],
    });
    expect(
      (await (await page.request.get(`${origin}/__fixture`)).json()).revisions
        .n,
    ).toBe(bounty ? 2 : 3);
    interrupted = false;
    const funding = page.getByRole("region", { name: /Fund or withdraw/ });
    await funding
      .getByRole("button", { name: "Connect Local Solana wallet" })
      .click();
    await funding.getByLabel("Token amount").fill("10");
    await funding
      .getByRole("button", { name: "Review deposit", exact: true })
      .click();
    await funding
      .getByRole("button", { name: "Confirm deposit in wallet" })
      .click();
    await expect.poll(() => sends.length).toBe(2);
    await connection.confirmTransaction(sends[1], "finalized");
    await funding.getByRole("button", { name: /Check/ }).click();
    await expect(funding).toContainText("finalized");
    expect(
      (
        await spl.getAccount(
          connection,
          new web3.PublicKey(created.vault),
          "finalized",
        )
      ).amount,
    ).toBe(10_000_000n);
    if (bounty) {
      const fundingBody = {
        step: "review",
        operation: "deposit",
        network: "solana-devnet",
        vault: created.vault,
        wallet: donor.publicKey.toBase58(),
        amount: "1",
      };
      const privatePath = `${origin}/api/v1/project-vaults/${project.id}/solana-funding`;
      const anonymous = await page.request.post(privatePath, {
        headers: { origin, "content-type": "application/json" },
        data: fundingBody,
      });
      expect(anonymous.status()).toBe(401);
      await page.request.post(`${origin}/__fixture`, {
        data: { permitted: false },
      });
      expect(
        (
          await page.request.post(privatePath, {
            headers,
            data: fundingBody,
          })
        ).status(),
      ).toBe(403);
      await page.request.post(`${origin}/__fixture`, {
        data: { permitted: true },
      });
      // Private balances never resolve through the public funding route.
      // Invalid input is rejected before any registry configuration lookup.
      for (const [data, status, error] of [
        [fundingBody, 503, "payments_unavailable"],
        [Buffer.from("{"), 400, "invalid_funding_action"],
      ] as const) {
        const rejected = await page.request.post(
          `${origin}/api/v1/payments/projects/${project.id}/solana-funding`,
          {
            headers,
            data,
          },
        );
        expect(rejected.status()).toBe(status);
        expect(await rejected.json()).toEqual({ error });
      }
      const scan = await page.request.post(`${origin}/__fixture`, {
        data: { scanSecurity: true },
      });
      expect(scan.ok(), await scan.text()).toBe(true);
      const scanState = await scan.json();
      expect(scanState.publicSnapshots.n).toBe(0);
      expect(scanState.privateSnapshots.n).toBe(1);
      await page.getByRole("button", { name: "Refresh bounty funds" }).click();
      const funds = page.getByRole("region", {
        name: "Bounty funds",
        exact: true,
      });
      await expect(funds).toContainText("Available for new awards: 10 USDC");
      privateUnavailable = true;
      await page.request.post(`${origin}/__fixture`, {
        data: { privateReadUnavailable: true },
      });
      await page.getByRole("button", { name: "Refresh bounty funds" }).click();
      await expect(funds.getByRole("alert")).toContainText(
        "Last verified balance is stale",
      );
      await expect(funding).toContainText("finalized");
      await expect(funding.getByLabel("Deposit tokens")).toHaveCount(0);
      await funding.getByLabel("Withdraw free funds").check();
      await expect(
        funding.getByRole("button", {
          name: "Review withdrawal",
          exact: true,
        }),
      ).toBeEnabled();
      await page.request.post(`${origin}/__fixture`, {
        data: { privateReadUnavailable: false },
      });
      await page.getByRole("button", { name: "Refresh bounty funds" }).click();
      await expect(funds.getByRole("alert")).toHaveCount(0);
      privateUnavailable = false;
      expect(privateErrors).toBe(1);
      await page.getByLabel("Status", { exact: true }).selectOption("open");
      await page.getByRole("button", { name: "Review bounty terms" }).click();
      await page.getByRole("button", { name: "Publish bounty terms" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Published revision" }),
      ).toBeVisible();
      const opened = await (
        await page.request.get(`${origin}/__fixture`)
      ).json();
      expect(opened.project.manifest.securityBounty.status).toBe("open");
      expect(opened.project.revision).toBe(3);
      // The same private route must preserve the owner's existing withdrawal.
      const donorAccount = spl.getAssociatedTokenAddressSync(
        new web3.PublicKey(created.asset),
        donor.publicKey,
      );
      const beforeWithdrawal = (
        await spl.getAccount(connection, donorAccount, "finalized")
      ).amount;
      await funding.getByLabel("Withdraw free funds").check();
      await funding.getByLabel("Token amount").fill("0.500001");
      await funding
        .getByRole("button", { name: "Review withdrawal", exact: true })
        .click();
      await expect(
        funding.getByRole("region", { name: "Review vault action" }),
      ).toContainText("0.49");
      await funding
        .getByRole("button", {
          name: "Confirm withdrawal in wallet",
          exact: true,
        })
        .click();
      await expect.poll(() => sends.length).toBe(3);
      await connection.confirmTransaction(sends[2], "finalized");
      await funding
        .getByRole("button", { name: "Check transaction", exact: true })
        .click();
      await expect(funding.getByRole("status")).toContainText(
        "Withdrawal verified",
      );
      expect(
        (await spl.getAccount(connection, donorAccount, "finalized")).amount -
          beforeWithdrawal,
      ).toBe(490_000n);
      expect(
        (
          await spl.getAccount(
            connection,
            new web3.PublicKey(created.vault),
            "finalized",
          )
        ).amount,
      ).toBe(9_510_000n);
      const withdrawn = await readVaultTotals(createdConfig);
      expect(withdrawn.totalGrossWithdrawn).toBe("500001");
      expect(withdrawn.totalWithdrawalFees).toBe("10001");
      expect(withdrawn.accruedFees).toBe("10001");
      expect(withdrawn.freeBalance).toBe("9499999");
      expect(withdrawn.reserved).toBe("0");
      await info.attach("private-withdrawal-totals.json", {
        body: JSON.stringify(withdrawn, null, 2),
        contentType: "application/json",
      });
      const publicProject = await (
        await page.request.get(`${origin}/api/v1/projects/${project.id}`)
      ).text();
      expect(publicProject).not.toMatch(/availableMinor|freeMinor|snapshotAt/);
    }
    await expectAccessible(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(failedRequests).toEqual([]);
    await page.screenshot({
      path: info.outputPath(
        bounty ? "solana-bounty-funded-open.png" : "solana-created-funded.png",
      ),
      fullPage: true,
    });
  } finally {
    await info.attach("solana-setup-api.log", {
      body: output(),
      contentType: "text/plain",
    });
    if (server.exitCode === null) {
      const stopped = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await stopped;
    }
    rmSync(temporary, { recursive: true, force: true });
  }
}

for (const bounty of [false, true])
  test(
    bounty
      ? "owner registers and funds a retained private Solana bounty vault through the API"
      : "owner creates, recovers, registers and funds a Solana vault through the API",
    ({ diagnostics, page }, info) =>
      ownerSetupWorkflow({ diagnostics, page }, info, bounty),
  );
