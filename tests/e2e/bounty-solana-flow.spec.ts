import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { encodeBase58Bytes } from "../../src/lib/base58";
import { rewardFields } from "../../src/lib/project-proposal";
import { privateBountyTerms } from "../../src/lib/security-bounty-proposal";
import {
  E2E_SECURITY_ACCOUNTS,
  fixtureRepository,
} from "../github-api-fixture.mjs";
import { applicationManifest } from "../project-application-manifest";
import { expect, expectAccessible, projectSuffix, test } from "./fixtures";

const tokens = JSON.parse(
  process.env.SLOP_E2E_SECURITY_TOKENS ?? "{}",
) as Record<string, string>;
const bridge = process.env.SLOP_E2E_SOLANA_WALLET_URL;

function installWallet() {
  const target = window as unknown as {
    bountySolanaAccount(): Promise<{ payer: string; publicKey: number[] }>;
    bountySolanaSend(bytes: number[]): Promise<number[]>;
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
    chains: ["solana:mainnet"],
    get accounts() {
      return accounts;
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          const info = await target.bountySolanaAccount();
          accounts = [
            {
              address: info.payer,
              publicKey: Uint8Array.from(info.publicKey),
              chains: ["solana:mainnet"],
              features: ["solana:signMessage", "solana:signAndSendTransaction"],
            },
          ];
          return { accounts };
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async () => {
          throw new Error("Payment must not request a message signature");
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
          const info = await target.bountySolanaAccount();
          if (account.address !== info.payer || chain !== "solana:mainnet")
            throw new Error("Unexpected wallet account or chain");
          return [
            {
              signature: Uint8Array.from(
                await target.bountySolanaSend([...transaction]),
              ),
            },
          ];
        },
      },
    },
  };
  window.addEventListener("wallet-standard:app-ready", (event) =>
    (event as CustomEvent).detail.register(wallet),
  );
}

async function signedIn(browser: Browser, role: string) {
  const context = await browser.newContext({
    viewport: test.info().project.use.viewport,
    recordVideo: { dir: test.info().outputPath(`${role}-video`) },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto("/how-it-works", { waitUntil: "commit" });
  await page.evaluate((token) => {
    document.cookie = `__Host-slop_points=${token}; Path=/; Secure; SameSite=Strict`;
  }, tokens[role]);
  return { page, context };
}
async function api(
  request: APIRequestContext,
  page: Page,
  role: string,
  method: string,
  path: string,
  data?: unknown,
) {
  const response = await request.fetch(`/api/v1/${path}`, {
    method,
    headers: {
      origin: new URL(page.url()).origin,
      cookie: `__Host-slop_points=${tokens[role]}`,
    },
    ...(data === undefined ? {} : { data }),
  });
  return { status: response.status(), body: await response.json() };
}
async function action(page: Page, name: string) {
  await page.locator(`[data-case-action-selector="${name}"]`).click();
  return page.locator(`form[data-case-action="${name}"]`);
}
async function submit(page: Page, name: string) {
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/actions") &&
      response.request().postDataJSON().action === name,
  );
  await page
    .locator(`form[data-case-action="${name}"]`)
    .getByRole("button")
    .click();
  expect((await response).status()).toBe(200);
}

test("native SOL bounty pays through the browser wallet and recovers an uncertain signature @registry @private-intake", async ({
  browser,
  request,
  diagnostics,
}) => {
  test.skip(!bridge, "Disposable Solana validator required");
  test.setTimeout(360_000);
  diagnostics.allowCanceledBackgroundReads();
  diagnostics.allow(
    /^(?:console .* at |403 GET )http:\/\/[^ ]+\/api\/v1\/(?:points|payments)\//u,
  );
  const info = (await (await fetch(`${bridge}/info`)).json()) as {
    payer: string;
    reporter: string;
    fee: string;
    recoveryAddress: string;
    publicKey: number[];
  };
  const reset = await fetch(`${bridge}/reset-reporter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(reset.status).toBe(200);
  const balance = async (address: string) =>
    BigInt(
      (await (await fetch(`${bridge}/balance?address=${address}`)).json())
        .balance,
    );
  const owner = await signedIn(browser, "security");
  const reporter = await signedIn(browser, "reporter-a");
  let submittedSignature = "";
  let sent = 0;
  await owner.page.exposeFunction("bountySolanaAccount", () => info);
  await owner.page.exposeFunction(
    "bountySolanaSend",
    async (bytes: number[]) => {
      const response = await fetch(`${bridge}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transaction: Buffer.from(bytes).toString("base64"),
        }),
      });
      expect(response.status).toBe(200);
      const signed = (await response.json()) as { signature: string };
      const signature = Buffer.from(signed.signature, "base64");
      submittedSignature = encodeBase58Bytes(signature);
      sent += 1;
      throw new Error("Fixture lost the finalized wallet response");
    },
  );
  await owner.page.addInitScript(installWallet);
  try {
    const suffix = projectSuffix();
    const id = `sol-bounty-${suffix}`;
    const repository = `e2e-security/${id}`;
    const installed = await fetch(
      `${process.env.SLOP_E2E_GITHUB_API_ORIGIN}/__fixture/slopbot/${repository}/installed`,
      { method: "PUT" },
    );
    expect(installed.status).toBe(204);
    const facts = fixtureRepository(repository);
    const actor = {
      githubId: E2E_SECURITY_ACCOUNTS.security,
      githubLogin: "e2e-security",
    };
    const funding = {
      mode: "monthly" as const,
      network: "solana",
      assetKind: "native" as const,
      tokenAddress: "",
      tokenSymbol: "",
      monthlyAmount: "0.04",
    };
    const manifest = applicationManifest(id, repository, {
      ...rewardFields({ ...funding, mode: "none" }, new Date()),
      name: "Native SOL bounty",
      steward: {
        displayName: "e2e-security",
        kind: "individual",
        github: {
          actorId: String(facts.owner.id),
          nodeId: facts.owner.node_id,
          login: facts.owner.login,
          type: facts.owner.type,
          profileUrl: `https://github.com/${facts.owner.login}`,
        },
        website: null,
      },
      authority: {
        state: "unverified",
        reason: "missing-repository-proof",
        role: "project-steward",
        repositoryId: String(facts.id),
        repositoryNodeId: facts.node_id,
        proof: null,
      },
      securityBounty: privateBountyTerms({
        name: "Native SOL bounty",
        repository,
        commit: "a".repeat(40),
        scope: "Protect private account data.",
        criteria: "Accept a safe local authorization reproduction.",
        testing: "Use synthetic accounts only.",
        funding,
        actor,
      }),
    });
    delete manifest.rewardAsset;
    delete manifest.escrow;
    const created = await api(
      request,
      owner.page,
      "security",
      "POST",
      "projects",
      { manifest, bountyAmount: "0.04" },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    await reporter.page.goto(`/projects/${id}/security`, {
      waitUntil: "networkidle",
    });
    await reporter.page
      .getByRole("textbox", { name: "Summary", exact: true })
      .fill(`Private authorization bypass solana-${suffix}`);
    await reporter.page
      .getByRole("textbox", { name: /^Description/u })
      .fill(
        "A synthetic local account reads another account's private report title without permission. Reproduce with two local accounts; no funds are at risk.",
      );
    await reporter.page
      .getByRole("button", { name: "Review report", exact: true })
      .click();
    const received = reporter.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/security-submissions",
    );
    await reporter.page
      .getByRole("button", { name: "Submit private report", exact: true })
      .click();
    expect((await received).status()).toBe(201);
    await expect(reporter.page).toHaveURL(
      /\/inbox\?view=reports&submission=ss_/u,
    );
    const submission = new URL(reporter.page.url()).searchParams.get(
      "submission",
    );
    const readReport = async () =>
      (
        await api(
          request,
          reporter.page,
          "reporter-a",
          "GET",
          `security-submissions/${submission}?view=receipt`,
        )
      ).body.submission;
    await expect
      .poll(async () => (await readReport()).intake.state)
      .toBe("legitimate");
    const caseId = (await readReport()).caseId as string;
    diagnostics.allowResponse(
      409,
      "POST",
      `/api/v1/security-cases/${caseId}/actions`,
    );
    await owner.page.goto(`/security?case=${caseId}`, {
      waitUntil: "networkidle",
    });
    let form = await action(owner.page, "decide");
    await form.getByLabel(/^Outcome/u).selectOption("confirmed");
    await form.getByLabel(/^Severity/u).selectOption("high");
    await form.getByLabel(/^Loss of funds/u).selectOption("not-verified");
    await form
      .getByLabel("The affected asset is in scope", { exact: true })
      .check();
    await form
      .getByLabel(/^Root cause key/u)
      .fill(`solana-authorization-${suffix}`);
    await form
      .getByLabel(/^Private reason/u)
      .fill(
        "Confirmed the private authorization defect with synthetic local accounts.",
      );
    await submit(owner.page, "decide");
    form = await action(owner.page, "award");
    await form
      .getByLabel("Payment deadline (UTC)", { exact: true })
      .fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16));
    await form.getByLabel(/^I approve this award/u).check();
    await form
      .getByLabel(/^Private reason/u)
      .fill(
        "Approve the published native SOL award for this qualifying finding.",
      );
    await submit(owner.page, "award");
    await reporter.page.goto(`/security?case=${caseId}`, {
      waitUntil: "networkidle",
    });
    form = await action(reporter.page, "consent-payment");
    await form
      .getByLabel(/^I understand that chain transactions reveal my wallet/u)
      .check();
    await submit(reporter.page, "consent-payment");
    await owner.page.reload({ waitUntil: "networkidle" });
    form = await action(owner.page, "prepare-payment");
    await form.getByLabel(/^I approve .* on this network/u).check();
    await submit(owner.page, "prepare-payment");
    const beforeReporter = await balance(info.reporter),
      beforeFee = await balance(info.fee);
    const pay = owner.page.getByRole("region", {
      name: "Pay from your Solana wallet",
      exact: true,
    });
    await pay
      .getByRole("button", { name: "Connect Local Solana wallet", exact: true })
      .click();
    await pay
      .getByRole("button", { name: "Pay approved award", exact: true })
      .click();
    await expect(pay.getByRole("alert")).toContainText("uncertain", {
      timeout: 180_000,
    });
    expect(sent).toBe(1);
    const rotated = await fetch(`${bridge}/rotate-reporter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(rotated.status).toBe(200);
    await owner.page.reload({ waitUntil: "networkidle" });
    await expect(
      owner.page.getByRole("button", {
        name: "Pay approved award",
        exact: true,
      }),
    ).toHaveCount(0);
    const verification = owner.page.getByRole("region", {
      name: "Submitted payment recovery",
      exact: true,
    });
    const signatureField = verification.getByLabel("Transaction signature 1", {
      exact: true,
    });
    await signatureField.fill("1".repeat(64));
    const wrong = owner.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/actions") &&
        response.request().postDataJSON().action === "verify-payment",
    );
    await verification
      .getByRole("button", { name: "Verify submitted payments", exact: true })
      .click();
    expect((await wrong).status()).toBe(409);
    await expect(signatureField).toBeEditable();
    await owner.page.reload({ waitUntil: "networkidle" });
    await expect(signatureField).toHaveValue("1".repeat(64));
    await signatureField.fill(submittedSignature);
    await verification
      .getByRole("button", { name: "Verify submitted payments", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await api(
              request,
              owner.page,
              "security",
              "GET",
              `security-cases/${caseId}`,
            )
          ).body.case.paymentState,
      )
      .toBe("paid");
    expect(sent).toBe(1);
    expect((await balance(info.reporter)) - beforeReporter).toBe(30_000_000n);
    expect((await balance(info.fee)) - beforeFee).toBe(10_000_000n);
    expect(await balance(info.recoveryAddress)).toBe(0n);
    await expectAccessible(owner.page);
    if ((owner.page.viewportSize()?.width ?? 0) >= 640) {
      await owner.page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      expect(
        await owner.page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await owner.page.evaluate(() => {
        document.documentElement.style.zoom = "1";
      });
    }
    await owner.page
      .locator(".security-payment-panel")
      .scrollIntoViewIfNeeded();
    await owner.page.screenshot({
      path: test.info().outputPath("native-sol-paid.png"),
    });
  } finally {
    await owner.context.close();
    await reporter.context.close();
  }
});
