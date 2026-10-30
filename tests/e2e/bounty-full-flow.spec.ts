import { readFile } from "node:fs/promises";
import type {
  APIRequestContext,
  Browser,
  Locator,
  Page,
} from "@playwright/test";
import { rewardFields } from "../../src/lib/project-proposal";
import { privateBountyTerms } from "../../src/lib/security-bounty-proposal";
import {
  rotateVerifiedBountyWallet,
  seedVerifiedBountyWallets,
  startLocalDirectEvmFixture,
} from "../direct-bounty-chain";
import {
  E2E_SECURITY_ACCOUNTS,
  fixtureRepository,
} from "../github-api-fixture.mjs";
import { capturedNotifyEmails } from "../notify-worker-fixture.mjs";
import { applicationManifest } from "../project-application-manifest";
import {
  escapeRegExp,
  expect,
  expectAccessible,
  projectSuffix,
  test,
} from "./fixtures";

const enabled = process.env.SLOP_E2E_DIRECT_BOUNTY === "1";
const nativeEther = process.env.SLOP_E2E_NATIVE_ETH === "1";
const assetSymbol = nativeEther ? "ETH" : "USDC";
const tokens = JSON.parse(
  process.env.SLOP_E2E_SECURITY_TOKENS ?? "{}",
) as Record<string, string>;
const github = process.env.SLOP_E2E_GITHUB_API_ORIGIN ?? "";
const owner = {
  githubId: E2E_SECURITY_ACCOUNTS.security,
  githubLogin: "e2e-security",
};
type Transaction = {
  from: string;
  to: string;
  value: string;
  data: string;
  chainId?: string;
  nonce?: string;
};
type CaseRecord = {
  id: string;
  revision: number;
  receiptState: string;
  awardState: string;
  paymentState: string;
  paymentRail: string;
  nextStep: string;
  analysis: null | {
    state: string;
    sourceReportVersion: number | null;
    advisoryDigest: string | null;
    summary: string | null;
    proposedSeverity: string | null;
    potentialLoss: string | null;
  };
  terms: {
    eligibility?: string;
    grossMinor: string;
    researcherMinor: string;
    slopMinor: string;
  };
  settlement: null | {
    state: string;
    generation: number;
    recovery?: {
      mode: string;
      target: { address: string } | null;
      cancellationRequest?: Transaction;
    } | null;
    confirmedTransactionIds?: string[];
    remainingTransfers?: {
      recipient: string;
      amountBase: string;
      role: string;
    }[];
    ownerRequest: null | { transactions: Transaction[] };
  };
};
let chain: Awaited<ReturnType<typeof startLocalDirectEvmFixture>>;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  if (!enabled) return;
  const endpoint = process.env.SLOP_E2E_DIRECT_RPC_URL;
  const persist = process.env.SLOP_E2E_PERSIST_TO;
  if (!endpoint || !persist)
    throw new Error("Missing local direct-payment fixture");
  chain = await startLocalDirectEvmFixture(Number(new URL(endpoint).port));
  seedVerifiedBountyWallets(persist, [
    { ...owner, address: chain.payer },
    {
      githubId: E2E_SECURITY_ACCOUNTS["reporter-a"],
      githubLogin: "e2e-reporter-a",
      address: chain.reporter,
    },
  ]);
});
test.afterAll(async () => {
  await chain?.close();
});

async function signedIn(
  browser: Browser,
  role: string,
  walletRequest?: (input: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>,
) {
  const context = await browser.newContext({
    viewport: test.info().project.use.viewport,
    ...(browser.browserType().name() === "chromium"
      ? { permissions: ["clipboard-read", "clipboard-write"] }
      : {}),
    ...(process.env.SLOP_E2E_VIDEO === "1"
      ? { recordVideo: { dir: test.info().outputPath(`${role}-video`) } }
      : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  if (walletRequest) {
    await page.exposeFunction("bountyFixtureWallet", walletRequest);
    await page.addInitScript(() => {
      const target = window as unknown as Window & {
        ethereum?: unknown;
        bountyFixtureWallet: (input: unknown) => Promise<unknown>;
      };
      target.ethereum = {
        isMetaMask: true,
        request: (input: unknown) => target.bountyFixtureWallet(input),
      };
    });
  }
  await page.goto("/how-it-works", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "How Slop works", exact: true }),
  ).toBeVisible();
  if (!tokens[role]) throw new Error(`Missing fixture session for ${role}`);
  await page.evaluate((value) => {
    document.cookie = `__Host-slop_points=${value}; Path=/; Secure; SameSite=Strict`;
  }, tokens[role]);
  return { context, page };
}

async function api<T>(
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
  return { status: response.status(), body: (await response.json()) as T };
}

async function action(page: Page, name: string) {
  await page.locator(`[data-case-action-selector="${name}"]`).click();
  const form = page.locator(`form[data-case-action="${name}"]`);
  await expect(form).toBeVisible();
  return form;
}

async function openPrivateReport(report: Locator) {
  const summary = report.getByText("Read private report", { exact: true });
  const details = summary.locator("..");
  if ((await details.getAttribute("open")) === null) await summary.click();
  await expect(details).toHaveAttribute("open", "");
}

async function enrollSecurityEmail(
  page: Page,
  request: APIRequestContext,
  role: string,
  address: string,
) {
  await page.bringToFront();
  await page.goto("/account#notifications", { waitUntil: "commit" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const preferences = page.getByRole("region", {
    name: "Email preferences",
    exact: true,
  });
  const input = preferences.getByRole("textbox", {
    name: "Email address",
    exact: true,
  });
  await expect(preferences).toBeVisible();
  await expect
    .poll(
      async () =>
        (await input.isVisible()) ||
        (await preferences
          .getByRole("button", { name: "Add or change email", exact: true })
          .isVisible()),
    )
    .toBe(true);
  for (const name of ["Activity email", "Security email"]) {
    const toggle = preferences.getByRole("switch", { name, exact: true });
    if ((await toggle.isVisible()) && (await toggle.isChecked())) {
      await toggle.click();
      await expect(toggle).not.toBeChecked();
      await expect(toggle).toHaveAttribute("aria-busy", "false");
    }
  }
  if (!(await input.isVisible()))
    await preferences
      .getByRole("button", { name: "Add or change email", exact: true })
      .click();
  await input.fill(address);
  await preferences
    .getByRole("checkbox", { name: "Security email", exact: true })
    .check();
  await preferences
    .getByRole("checkbox", { name: "Activity email", exact: true })
    .uncheck();
  let releaseFocusRead = () => {};
  const focusReadGate = new Promise<void>((resolve) => {
    releaseFocusRead = resolve;
  });
  await page.route("**/api/v1/notifications/email", async (route) => {
    await focusReadGate;
    await route.continue();
  });
  const focusRequest = page.waitForRequest(
    (request) =>
      request.method() === "GET" &&
      new URL(request.url()).pathname === "/api/v1/notifications/email",
  );
  const focusedRead = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/v1/notifications/email",
  );
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await focusRequest;
    await expect(input).toBeEditable();
    await expect(input).toHaveValue(address);
    await expect(
      preferences.getByRole("button", {
        name: "Send verification",
        exact: true,
      }),
    ).toBeDisabled();
  } finally {
    releaseFocusRead();
  }
  expect((await focusedRead).status()).toBe(200);
  await page.unroute("**/api/v1/notifications/email");
  await expect(input).toHaveValue(address);
  await expect(
    preferences.getByRole("checkbox", { name: "Security email", exact: true }),
  ).toBeChecked();
  await expect(
    preferences.getByRole("checkbox", { name: "Activity email", exact: true }),
  ).not.toBeChecked();
  const sent = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        "/api/v1/notifications/email/verification",
  );
  await preferences
    .getByRole("button", { name: "Send verification", exact: true })
    .click();
  expect((await sent).status()).toBe(202);
  const origin = process.env.SLOP_E2E_NOTIFY_ORIGIN as string;
  const findLink = async () => {
    const emails = await capturedNotifyEmails(origin);
    return emails
      .filter((email: { to: string[] }) => email.to.includes(address))
      .map(
        (email: { text?: string }) =>
          email.text?.match(/#verify-email=([a-f0-9]{64})/u)?.[1],
      )
      .find(Boolean);
  };
  await expect.poll(findLink).toBeTruthy();
  const token = await findLink();
  await page.goto(`/inbox#verify-email=${token}`, { waitUntil: "commit" });
  await expect(
    page.getByRole("region", { name: "Verify email", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  const before = await api<{ securityEnabled: boolean }>(
    request,
    page,
    role,
    "GET",
    "notifications/email",
  );
  expect(before.body.securityEnabled).toBe(false);
  const action = page.getByRole("region", {
    name: "Verify email",
    exact: true,
  });
  const verified = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/notifications/email/verify",
  );
  await action
    .getByRole("button", { name: "Verify email", exact: true })
    .click();
  const verifiedResponse = await verified;
  expect(verifiedResponse.status()).toBe(200);
  expect(await verifiedResponse.finished()).toBeNull();
  await expect(action.getByRole("status")).toHaveText("Email verified.");
  const after = await api<{
    enabled: boolean;
    securityEnabled: boolean;
    email: string;
  }>(request, page, role, "GET", "notifications/email");
  expect(after.body).toMatchObject({
    enabled: false,
    securityEnabled: true,
    email: address,
  });
}

async function submitAction(page: Page, name: string, expected = 200) {
  const result = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/actions") &&
      response.request().postDataJSON().action === name,
  );
  await page
    .locator(`form[data-case-action="${name}"]`)
    .getByRole("button", { name: /.+/u })
    .click();
  const response = await result;
  const body = (await response.json()) as {
    case: CaseRecord;
    error?: string;
    message?: string;
  };
  expect(response.status(), JSON.stringify(body)).toBe(expected);
  return body;
}

async function copiedPaymentRequest(page: Page) {
  const form = await action(page, "verify-payment");
  const field = form.getByLabel(/^Transaction IDs/u);
  await field.fill("");
  await field.press("ControlOrMeta+V");
  const copied = JSON.parse(await field.inputValue()) as {
    transactions: Transaction[];
    transfers: { role: string }[];
  };
  await field.fill("");
  return copied;
}

test(`a private ${assetSymbol} bounty runs from reporter intake to partial recovery and finalized payment @registry @private-intake`, async ({
  browser,
  page,
  request,
  diagnostics,
}) => {
  test.skip(
    !enabled,
    "Disposable Anvil and private intake fixtures are required",
  );
  test.setTimeout(240_000);
  diagnostics.allowCanceledBackgroundReads();
  diagnostics.allow(
    /^(?:console .* at |403 GET )http:\/\/[^ ]+\/api\/v1\/(?:points|payments)\//u,
  );
  const suffix = projectSuffix();
  const id = `full-bounty-${suffix}`;
  const repository = `e2e-security/${id}`;
  const amount = suffix.includes("mobile") ? "44" : "40";
  const gross = BigInt(amount) * (nativeEther ? 10n ** 18n : 1_000_000n);
  const balance = (address: string) =>
    chain.balance(address, nativeEther ? "native" : chain.token);
  const summary = `Private authorization bypass ${suffix}`;
  const description = `A missing permission check lets one signed-in account read another account's private report metadata. Reproduce locally with two synthetic users at the selected revision. This is a high-severity disclosure defect; no funds are at risk. Marker ${id}.`;
  const walletSends: { transaction: Transaction; hash: string }[] = [];
  let loseFirstWalletResponse = true;
  let finalizeWalletSends = true;
  const walletRequest = async (input: {
    method: string;
    params?: unknown[];
  }) => {
    if (["eth_requestAccounts", "eth_accounts"].includes(input.method))
      return [chain.payer];
    if (input.method === "wallet_switchEthereumChain") return null;
    const result = await chain.request(input.method, input.params ?? []);
    if (input.method === "eth_sendTransaction") {
      walletSends.push({
        transaction: input.params?.[0] as Transaction,
        hash: result as string,
      });
      if (finalizeWalletSends) await chain.mine();
      if (loseFirstWalletResponse) {
        loseFirstWalletResponse = false;
        throw new Error("Fixture wallet lost its response after sending");
      }
    }
    return result;
  };
  const actors = await Promise.all([
    signedIn(browser, "security", walletRequest),
    signedIn(browser, "reporter-a"),
    signedIn(browser, "finance"),
    signedIn(browser, "security-b"),
  ]);
  const [maintainer, researcher, finance, otherMaintainer] = actors.map(
    (entry) => entry.page,
  );
  const emailActors = [
    { role: "security", page: maintainer },
    { role: "reporter-a", page: researcher },
    { role: "finance", page: finance },
    { role: "security-b", page: otherMaintainer },
  ].map((actor) => ({
    ...actor,
    address: `${actor.role}-${suffix}@example.com`,
  }));
  try {
    for (const actor of emailActors) {
      await enrollSecurityEmail(actor.page, request, actor.role, actor.address);
      console.info(
        `[bounty-full-flow] ${suffix}: ${actor.role} email verified`,
      );
    }
    const facts = fixtureRepository(repository);
    const installed = await fetch(
      `${github}/__fixture/slopbot/${repository}/installed`,
      { method: "PUT" },
    );
    expect(installed.status).toBe(204);
    const funding = {
      mode: "monthly" as const,
      network: "base",
      assetKind: nativeEther ? ("native" as const) : ("stablecoin" as const),
      tokenAddress: "",
      tokenSymbol: "",
      monthlyAmount: amount,
    };
    const program = privateBountyTerms({
      name: "Full private bounty",
      repository,
      commit: "a".repeat(40),
      scope: "Fix private account authorization leaks.",
      criteria:
        "Accept a safe local reproduction of an in-scope private-data disclosure.",
      testing: "Use synthetic local accounts and data only.",
      funding,
      actor: owner,
    });
    const manifest = applicationManifest(id, repository, {
      ...rewardFields({ ...funding, mode: "none" }, new Date()),
      name: "Full private bounty",
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
      securityBounty: program,
    });
    delete manifest.rewardAsset;
    delete manifest.escrow;
    const created = await api<{ project: { id: string } }>(
      request,
      maintainer,
      "security",
      "POST",
      "projects",
      { manifest, bountyAmount: amount },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const adminToken = process.env.SLOP_E2E_ADMIN_TOKEN ?? "";
    const adminResponse = await request.get("/api/v1/admin/projects", {
      headers: { cookie: `__Host-slop_points=${adminToken}` },
    });
    const current = (await adminResponse.json()).projects.find(
      (entry: { id: string }) => entry.id === id,
    );
    const updated = await request.put(`/api/v1/admin/projects/${id}/manifest`, {
      headers: {
        origin: new URL(maintainer.url()).origin,
        cookie: `__Host-slop_points=${adminToken}`,
      },
      data: {
        expectedRevision: current.revision,
        reason:
          "Assign synthetic review and finance roles for the local full workflow",
        manifest: {
          ...current.manifest,
          securityBounty: {
            ...current.manifest.securityBounty,
            approvers: {
              technical: [
                owner,
                {
                  githubId: E2E_SECURITY_ACCOUNTS["security-b"],
                  githubLogin: "e2e-security-b",
                },
              ],
              financial: [
                {
                  githubId: E2E_SECURITY_ACCOUNTS.finance,
                  githubLogin: "e2e-finance",
                },
              ],
              dispute: [
                {
                  githubId: E2E_SECURITY_ACCOUNTS.dispute,
                  githubLogin: "e2e-dispute",
                },
              ],
            },
          },
        },
      },
    });
    expect(updated.status(), await updated.text()).toBe(200);

    await researcher.goto(`/projects/${id}/security`, {
      waitUntil: "networkidle",
    });
    await researcher
      .getByRole("textbox", { name: "Summary", exact: true })
      .fill(summary);
    await researcher
      .getByRole("textbox", { name: /^Description/u })
      .fill(description);
    await researcher
      .getByRole("button", { name: "Review report", exact: true })
      .click();
    const submitted = researcher.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/security-submissions",
    );
    await researcher
      .getByRole("button", { name: "Submit private report", exact: true })
      .click();
    const received = await submitted;
    expect(received.status()).toBe(201);
    await expect(researcher).toHaveURL(
      /\/inbox\?view=reports&submission=ss_[^&]+$/u,
    );
    const submissionId = new URL(researcher.url()).searchParams.get(
      "submission",
    ) as string;
    const report = async () =>
      (
        await api<{
          submission: { caseId: string; intake: { state: string } };
        }>(
          request,
          researcher,
          "reporter-a",
          "GET",
          `security-submissions/${submissionId}?view=receipt`,
        )
      ).body.submission;
    await expect
      .poll(async () => (await report()).intake.state)
      .toBe("legitimate");
    const caseId = (await report()).caseId;
    console.info(`[bounty-full-flow] ${suffix}: private report screened`);
    const readCase = async (role: string) =>
      (
        await api<{ case: CaseRecord }>(
          request,
          maintainer,
          role,
          "GET",
          `security-cases/${caseId}`,
        )
      ).body.case;
    diagnostics.allowResponse(
      409,
      "POST",
      `/api/v1/security-cases/${caseId}/actions`,
    );
    expect((await readCase("security")).terms.eligibility).toBe(
      "in-scope-security",
    );
    await expect
      .poll(
        async () => {
          const analysis = (await readCase("security")).analysis;
          return [analysis?.state, analysis?.sourceReportVersion];
        },
        { timeout: 30_000 },
      )
      .toEqual(["complete", 1]);
    const firstAnalysis = (await readCase("security")).analysis;
    expect(firstAnalysis?.advisoryDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(firstAnalysis?.proposedSeverity).toBe("high");
    expect(firstAnalysis?.potentialLoss).toBe("unlikely");
    await maintainer.goto(
      `/security?case=${caseId}&submission=${submissionId}`,
      { waitUntil: "networkidle" },
    );
    const ownerReport = maintainer.locator(
      `[aria-labelledby="submission-${submissionId}"]`,
    );
    await openPrivateReport(ownerReport);
    await expect(ownerReport.locator(".security-report-text")).toContainText(
      description,
    );
    const assessment = maintainer.getByRole("region", {
      name: "Advisory assessment",
      exact: true,
    });
    await expect(assessment).toContainText(
      "Fixture assessment: private account authorization bypass; confirm the two local account roles.",
    );
    await expectAccessible(maintainer);
    let form = await action(maintainer, "request-information");
    await form
      .getByLabel(/^What you need/u)
      .fill(
        "Please add the two local account roles and the exact denied-versus-leaked response.",
      );
    await submitAction(maintainer, "request-information");
    await researcher.reload({ waitUntil: "networkidle" });
    const researcherReport = researcher.locator(
      `[aria-labelledby="submission-${submissionId}"]`,
    );
    await openPrivateReport(researcherReport);
    await researcherReport
      .getByText("Add evidence or correct report", { exact: true })
      .click();
    await researcherReport
      .getByRole("textbox", { name: /^Description/u })
      .fill(
        `${description} Account A is a maintainer of a local test project; account B has no project role. B receives A's private title instead of a denied response.`,
      );
    await researcherReport
      .getByRole("button", { name: "Save and screen again", exact: true })
      .click();
    await expect
      .poll(async () => (await report()).intake.state)
      .toBe("legitimate");
    await expect
      .poll(
        async () => {
          const analysis = (await readCase("security")).analysis;
          return [analysis?.state, analysis?.sourceReportVersion];
        },
        { timeout: 30_000 },
      )
      .toEqual(["complete", 2]);
    const revisedAnalysis = (await readCase("security")).analysis;
    expect(revisedAnalysis?.advisoryDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(revisedAnalysis?.advisoryDigest).not.toBe(
      firstAnalysis?.advisoryDigest,
    );
    console.info(`[bounty-full-flow] ${suffix}: requested evidence received`);
    await maintainer.reload({ waitUntil: "networkidle" });
    await expect(assessment).toContainText(
      "Fixture assessment: account B reads account A's private report title without a project role.",
    );
    await expect(assessment).not.toContainText(
      firstAnalysis?.summary as string,
    );
    form = await action(maintainer, "decide");
    await form.getByLabel(/^Outcome/u).selectOption("confirmed");
    await form.getByLabel(/^Severity/u).selectOption("high");
    await form.getByLabel(/^Loss of funds/u).selectOption("not-verified");
    await form
      .getByLabel("The affected asset is in scope", { exact: true })
      .check();
    await form.getByLabel(/^Root cause key/u).fill(`authorization-${suffix}`);
    await form
      .getByLabel(/^Private reason/u)
      .fill(
        "Confirmed with two synthetic local accounts. The unauthorized disclosure meets the published criteria.",
      );
    await submitAction(maintainer, "decide");
    form = await action(maintainer, "award");
    await expect(
      form.getByLabel(new RegExp(`^Gross award \\(${assetSymbol}\\)`, "u")),
    ).toHaveValue(amount);
    await form
      .getByLabel("Payment deadline (UTC)", { exact: true })
      .fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16));
    await form.getByLabel(/^I approve this award/u).check();
    await form
      .getByLabel(/^Private reason/u)
      .fill(
        "Approve the fixed bounty for the first qualifying private authorization finding.",
      );
    await submitAction(maintainer, "award");
    expect((await readCase("security")).awardState).toBe("approved");
    console.info(`[bounty-full-flow] ${suffix}: award approved`);
    form = await action(maintainer, "prepare-payment");
    await form.getByLabel(/^I approve .* on this network/u).check();
    expect((await submitAction(maintainer, "prepare-payment", 409)).error).toBe(
      "payment_consent_required",
    );
    await researcher.goto(`/security?case=${caseId}`, {
      waitUntil: "networkidle",
    });
    form = await action(researcher, "consent-payment");
    await form
      .getByLabel(/^I understand that chain transactions reveal my wallet/u)
      .check();
    await submitAction(researcher, "consent-payment");
    await maintainer.reload({ waitUntil: "networkidle" });
    form = await action(maintainer, "prepare-payment");
    await form.getByLabel(/^I approve .* on this network/u).check();
    await submitAction(maintainer, "prepare-payment");
    const payment = maintainer.getByRole("region", {
      name: "Unsigned owner request",
      exact: true,
    });
    await expect(payment).toBeVisible();
    await expect(payment.locator("details")).toHaveCount(0);
    await expect(payment.getByRole("textbox")).toHaveCount(0);
    await expect(payment).toContainText(
      `${(BigInt(amount) * 3n) / 4n} ${assetSymbol}`,
    );
    await expect(payment).toContainText(chain.payer);
    await payment
      .getByRole("button", { name: "Copy unsigned request", exact: true })
      .focus();
    await maintainer.keyboard.press("Enter");
    const copied = await copiedPaymentRequest(maintainer);
    expect(copied.transactions).toHaveLength(2);
    const downloading = maintainer.waitForEvent("download");
    await payment
      .getByRole("button", { name: "Download unsigned request", exact: true })
      .click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("private-payment-request.json");
    const downloadedPath = await download.path();
    if (!downloadedPath) throw new Error("Payment request download is missing");
    expect(JSON.parse(await readFile(downloadedPath, "utf8"))).toEqual(copied);
    await expect(
      payment
        .getByRole("status")
        .filter({ hasText: /^Request download started\.$/u }),
    ).toBeVisible();
    const beforeReporter = await balance(chain.reporter);
    const beforeRecovery = await balance(chain.recoveryAddress);
    const beforeFee = await balance(chain.fee);
    form = await action(maintainer, "verify-payment");
    await form.getByLabel(/^Transaction IDs/u).fill(`0x${"f".repeat(64)}`);
    await form
      .getByLabel("These transactions pay the approved award.", { exact: true })
      .check();
    expect((await submitAction(maintainer, "verify-payment", 409)).error).toBe(
      "payment_unverified",
    );
    expect(
      (await readCase("security")).settlement?.confirmedTransactionIds,
    ).toHaveLength(0);
    rotateVerifiedBountyWallet(process.env.SLOP_E2E_PERSIST_TO as string, {
      githubId: E2E_SECURITY_ACCOUNTS["reporter-a"],
      githubLogin: "e2e-reporter-a",
      address: chain.recoveryAddress,
    });
    await researcher.reload({ waitUntil: "networkidle" });
    expect((await readCase("security")).settlement?.recovery?.mode).toBe(
      "consent-required",
    );
    form = await action(researcher, "consent-payment");
    await form
      .getByLabel(/^I understand that chain transactions reveal my wallet/u)
      .check();
    await submitAction(researcher, "consent-payment");
    await maintainer.reload({ waitUntil: "networkidle" });
    expect((await readCase("security")).settlement?.recovery?.mode).toBe(
      "fee-pending",
    );
    await expect(
      maintainer.getByRole("button", {
        name: "Cancel old transfer",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(payment).not.toContainText(chain.reporter);
    const payerControls = maintainer.getByRole("region", {
      name: "Pay from your wallet",
      exact: true,
    });
    await payerControls
      .getByRole("button", { name: "Connect MetaMask", exact: true })
      .click();
    await payerControls
      .getByRole("button", { name: "Pay remaining transfers", exact: true })
      .click();
    await expect(payerControls.getByRole("alert")).toContainText("uncertain");
    expect(walletSends).toHaveLength(1);
    const feeIndex = copied.transfers.findIndex(
      (entry) => entry.role === "fee",
    );
    expect(walletSends[0].transaction).toEqual(copied.transactions[feeIndex]);
    const feeTransaction = walletSends[0].hash;
    await maintainer.reload({ waitUntil: "networkidle" });
    const savedFee = maintainer.getByRole("region", {
      name: "Submitted payment recovery",
      exact: true,
    });
    await expect(savedFee).toBeVisible();
    await expect(
      maintainer.getByRole("button", {
        name: "Pay remaining transfers",
        exact: true,
      }),
    ).toHaveCount(0);
    const recoveredHash = savedFee.getByLabel("Transaction hash 1", {
      exact: true,
    });
    const wrongHash = `0x${"e".repeat(64)}`;
    await recoveredHash.fill(wrongHash);
    const rejectedHash = maintainer.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/actions") &&
        response.request().postDataJSON()?.action === "verify-payment",
    );
    await savedFee
      .getByRole("button", { name: "Verify submitted payments", exact: true })
      .click();
    expect((await rejectedHash).status()).toBe(409);
    await expect(recoveredHash).toHaveValue(wrongHash);
    await maintainer.reload({ waitUntil: "networkidle" });
    await expect(recoveredHash).toHaveValue(wrongHash);
    expect(walletSends).toHaveLength(1);
    await recoveredHash.fill(feeTransaction);
    let lost = false;
    const actionUrl = `${new URL(maintainer.url()).origin}/api/v1/security-cases/${caseId}/actions`;
    const lostRequest = new RegExp(
      `^(?:net::ERR_FAILED|NS_ERROR_FAILURE) POST ${escapeRegExp(actionUrl)}$`,
      "u",
    );
    diagnostics.allow(
      lostRequest,
      new RegExp(
        `^console Failed to load resource: net::ERR_FAILED at ${escapeRegExp(actionUrl)}$`,
        "u",
      ),
    );
    await maintainer.route(
      `**/api/v1/security-cases/${caseId}/actions`,
      async (route) => {
        if (
          !lost &&
          route.request().postDataJSON().action === "verify-payment"
        ) {
          lost = true;
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          await route.abort("failed");
        } else await route.continue();
      },
    );
    await savedFee
      .getByRole("button", { name: "Verify submitted payments", exact: true })
      .click();
    await expect(savedFee.getByRole("alert")).toBeVisible();
    await maintainer.unroute(`**/api/v1/security-cases/${caseId}/actions`);
    await maintainer.reload({ waitUntil: "networkidle" });
    await expect(
      maintainer.getByText("Partly paid", { exact: true }).first(),
    ).toBeVisible();
    const partial = await readCase("security");
    expect(partial.settlement?.confirmedTransactionIds).toEqual([
      feeTransaction,
    ]);
    expect(partial.settlement?.remainingTransfers).toHaveLength(1);
    console.info(`[bounty-full-flow] ${suffix}: partial payment recovered`);
    expect((await readCase("reporter-a")).settlement?.ownerRequest).toBeNull();
    await researcher.reload({ waitUntil: "networkidle" });
    const reporterRecovery = researcher.getByRole("group", {
      name: "Payment recovery",
      exact: true,
    });
    await expect(reporterRecovery).toContainText(chain.recoveryAddress);
    await expect(reporterRecovery).toContainText("Waiting for the payer");
    expect((await readCase("security")).settlement?.recovery?.mode).toBe(
      "cancellation-required",
    );
    const cancellation = maintainer.getByRole("region", {
      name: "Cancel superseded transfer",
      exact: true,
    });
    await cancellation
      .getByRole("button", { name: "Connect MetaMask", exact: true })
      .click();
    finalizeWalletSends = false;
    await cancellation
      .getByRole("button", { name: "Cancel old transfer", exact: true })
      .click();
    await expect(
      cancellation.getByRole("button", {
        name: "Verify cancellation",
        exact: true,
      }),
    ).toBeVisible();
    const premature = maintainer.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.action === "recover-payment",
    );
    await cancellation
      .getByRole("button", { name: "Verify cancellation", exact: true })
      .click();
    expect((await premature).status()).toBe(409);
    await chain.mine();
    finalizeWalletSends = true;
    const recovered = maintainer.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.action === "recover-payment",
    );
    await cancellation
      .getByRole("button", { name: "Verify cancellation", exact: true })
      .click();
    expect((await recovered).status()).toBe(200);
    await expect
      .poll(async () => (await readCase("security")).settlement?.generation)
      .toBe(partial.settlement!.generation + 1);
    await maintainer.evaluate(() => window.scrollTo(0, 0));
    await maintainer.screenshot({
      path: test.info().outputPath("partial-payment.png"),
      fullPage: true,
    });
    await maintainer
      .locator(".security-payment-panel")
      .scrollIntoViewIfNeeded();
    await maintainer.screenshot({
      path: test.info().outputPath("partial-payment-viewport.png"),
    });
    await payment
      .getByRole("button", { name: "Copy unsigned request", exact: true })
      .click();
    const remaining = await copiedPaymentRequest(maintainer);
    expect(remaining.transactions).toHaveLength(1);
    await expect(payment).not.toContainText("Slop fee");
    await expect(payment).toContainText(chain.recoveryAddress);
    await payerControls
      .getByRole("button", { name: "Connect MetaMask", exact: true })
      .click();
    await payerControls
      .getByRole("button", { name: "Pay remaining transfers", exact: true })
      .click();
    await expect(
      payerControls.getByRole("button", {
        name: "Verify submitted payments",
        exact: true,
      }),
    ).toBeVisible();
    expect(walletSends).toHaveLength(3);
    expect(walletSends[2].transaction).toEqual(remaining.transactions[0]);
    await payerControls
      .getByRole("button", { name: "Verify submitted payments", exact: true })
      .click();
    await expect
      .poll(async () => (await readCase("security")).paymentState)
      .toBe("paid");
    const finalCase = await readCase("security");
    console.info(`[bounty-full-flow] ${suffix}: exact payment finalized`);
    expect((await balance(chain.reporter)) - beforeReporter).toBe(0n);
    expect((await balance(chain.recoveryAddress)) - beforeRecovery).toBe(
      (gross * 3n) / 4n,
    );
    expect((await balance(chain.fee)) - beforeFee).toBe(gross / 4n);
    await researcher.reload({ waitUntil: "networkidle" });
    await finance.goto(`/security?case=${caseId}`, {
      waitUntil: "networkidle",
    });
    await otherMaintainer.goto(`/inbox`, { waitUntil: "networkidle" });
    for (const role of ["reporter-a", "finance", "security-b"]) {
      const notices = await api<{
        notifications: {
          eventKey: string;
          subject: string;
          actionPath: string;
        }[];
      }>(request, maintainer, role, "GET", "notifications");
      expect(
        notices.body.notifications.some(
          (entry) =>
            entry.eventKey ===
              `security-case:${caseId}:${finalCase.revision}` &&
            entry.subject === caseId &&
            entry.actionPath.includes(caseId),
        ),
      ).toBe(true);
    }
    const notice = otherMaintainer
      .getByRole("list", { name: "Notifications", exact: true })
      .getByRole("link")
      .filter({ hasText: caseId })
      .first();
    await expect(notice).toBeVisible();
    await notice.click();
    await expect(otherMaintainer).toHaveURL(new RegExp(`case=${caseId}`, "u"));
    await expect(finance.getByText(summary, { exact: true })).toHaveCount(0);
    const forbiddenReport = await api(
      request,
      finance,
      "finance",
      "GET",
      `security-submissions/${submissionId}`,
    );
    expect(forbiddenReport.status).toBe(404);
    const outsiderCase = await api(
      request,
      researcher,
      "reporter-b",
      "GET",
      `security-cases/${caseId}`,
    );
    expect(outsiderCase.status).toBe(404);
    expect((await readCase("reporter-a")).settlement?.ownerRequest).toBeNull();
    await expectAccessible(maintainer);
    await expectAccessible(researcher);
    if ((maintainer.viewportSize()?.width ?? 0) >= 640) {
      await maintainer.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      expect(
        await maintainer.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await expectAccessible(maintainer);
      await maintainer.evaluate(() => {
        document.documentElement.style.zoom = "1";
      });
    }
    await maintainer.evaluate(() => window.scrollTo(0, 0));
    await maintainer.screenshot({
      path: test.info().outputPath("paid-owner.png"),
      fullPage: true,
    });
    await maintainer
      .locator(".security-payment-panel")
      .scrollIntoViewIfNeeded();
    await maintainer.screenshot({
      path: test.info().outputPath("paid-owner-viewport.png"),
    });
    await researcher.evaluate(() => window.scrollTo(0, 0));
    await researcher.screenshot({
      path: test.info().outputPath("paid-reporter.png"),
      fullPage: true,
    });
    // A second finding exercises a same-generation journal with a credited
    // fee and a sent researcher transfer whose recipient then changes.
    await researcher.goto(`/projects/${id}/security`, {
      waitUntil: "networkidle",
    });
    await researcher
      .getByRole("textbox", { name: "Summary", exact: true })
      .fill(`Private attachment authorization ${suffix}`);
    await researcher
      .getByRole("textbox", { name: /^Description/u })
      .fill(
        `A separate attachment download route omits its account authorization check. Reproduce with two local synthetic accounts and a harmless text attachment. No funds are at risk. Marker ${id}-attachment.`,
      );
    await researcher
      .getByRole("button", { name: "Review report", exact: true })
      .click();
    const secondSubmission = researcher.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/security-submissions",
    );
    await researcher
      .getByRole("button", { name: "Submit private report", exact: true })
      .click();
    expect((await secondSubmission).status()).toBe(201);
    await expect(researcher).toHaveURL(/submission=ss_/u);
    const secondSubmissionId = new URL(researcher.url()).searchParams.get(
      "submission",
    );
    const secondReport = async () =>
      (
        await api<{
          submission: { caseId: string; intake: { state: string } };
        }>(
          request,
          researcher,
          "reporter-a",
          "GET",
          `security-submissions/${secondSubmissionId}?view=receipt`,
        )
      ).body.submission;
    await expect
      .poll(async () => (await secondReport()).intake.state)
      .toBe("legitimate");
    const secondCaseId = (await secondReport()).caseId;
    const secondCase = async () =>
      (
        await api<{ case: CaseRecord }>(
          request,
          maintainer,
          "security",
          "GET",
          `security-cases/${secondCaseId}`,
        )
      ).body.case;
    await maintainer.goto(`/security?case=${secondCaseId}`, {
      waitUntil: "networkidle",
    });
    form = await action(maintainer, "decide");
    await form.getByLabel(/^Outcome/u).selectOption("confirmed");
    await form.getByLabel(/^Severity/u).selectOption("high");
    await form.getByLabel(/^Loss of funds/u).selectOption("not-verified");
    await form
      .getByLabel("The affected asset is in scope", { exact: true })
      .check();
    await form.getByLabel(/^Root cause key/u).fill(`attachment-${suffix}`);
    await form
      .getByLabel(/^Private reason/u)
      .fill("Confirmed a separate attachment authorization defect locally.");
    await submitAction(maintainer, "decide");
    form = await action(maintainer, "award");
    await form
      .getByLabel("Payment deadline (UTC)", { exact: true })
      .fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16));
    await form.getByLabel(/^I approve this award/u).check();
    await form
      .getByLabel(/^Private reason/u)
      .fill("Approve the published award for the separate qualifying finding.");
    await submitAction(maintainer, "award");
    await researcher.goto(`/security?case=${secondCaseId}`, {
      waitUntil: "networkidle",
    });
    form = await action(researcher, "consent-payment");
    await form
      .getByLabel(/^I understand that chain transactions reveal my wallet/u)
      .check();
    await submitAction(researcher, "consent-payment");
    await maintainer.reload({ waitUntil: "networkidle" });
    form = await action(maintainer, "prepare-payment");
    await form.getByLabel(/^I approve .* on this network/u).check();
    await submitAction(maintainer, "prepare-payment");
    await payerControls
      .getByRole("button", { name: "Connect MetaMask", exact: true })
      .click();
    loseFirstWalletResponse = true;
    await payerControls
      .getByRole("button", { name: "Pay remaining transfers", exact: true })
      .click();
    await expect(payerControls.getByRole("alert")).toBeVisible();
    expect(walletSends).toHaveLength(4);
    const secondFee = walletSends[3].hash;
    await payerControls.getByRole("textbox").fill(secondFee);
    await payerControls
      .getByRole("button", { name: "Verify submitted payments", exact: true })
      .click();
    await expect
      .poll(
        async () => (await secondCase()).settlement?.confirmedTransactionIds,
      )
      .toEqual([secondFee]);
    await payerControls
      .getByRole("button", { name: "Pay remaining transfers", exact: true })
      .click();
    await expect.poll(() => walletSends.length).toBe(5);
    const secondResearcher = walletSends[4].hash;
    rotateVerifiedBountyWallet(process.env.SLOP_E2E_PERSIST_TO as string, {
      githubId: E2E_SECURITY_ACCOUNTS["reporter-a"],
      githubLogin: "e2e-reporter-a",
      address: chain.reporter,
    });
    await maintainer.reload({ waitUntil: "networkidle" });
    const savedPayments = maintainer.getByRole("region", {
      name: "Submitted payment recovery",
      exact: true,
    });
    await expect(savedPayments.getByRole("textbox")).toHaveCount(1);
    await expect(savedPayments.getByRole("textbox")).toHaveValue(
      secondResearcher,
    );
    expect((await secondCase()).settlement?.ownerRequest).toBeNull();
    await savedPayments
      .getByRole("button", { name: "Verify submitted payments", exact: true })
      .click();
    await expect
      .poll(async () => (await secondCase()).paymentState)
      .toBe("paid");
    expect(walletSends).toHaveLength(5);
    expect((await balance(chain.recoveryAddress)) - beforeRecovery).toBe(
      (gross * 3n) / 2n,
    );
    expect((await balance(chain.fee)) - beforeFee).toBe(gross / 2n);
    console.info(
      `[bounty-full-flow] ${suffix}: credited fee excluded from held journal`,
    );
    // Finish Pages reads before the separate local Worker writes the shared
    // SQLite fixture through its own Miniflare runtime.
    await Promise.all(actors.map((entry) => entry.context.close()));
    const notifyOrigin = process.env.SLOP_E2E_NOTIFY_ORIGIN as string;
    expect(
      (
        await fetch(`${notifyOrigin}/__fixture/security-dispatch`, {
          method: "POST",
        })
      ).status,
    ).toBe(204);
    const emails = (await capturedNotifyEmails(notifyOrigin)) as {
      to: string[];
      subject?: string;
      raw?: string;
      rawBase64?: string;
      text?: string;
      html?: string;
    }[];
    for (const actor of emailActors)
      expect(emails.some((email) => email.to.includes(actor.address))).toBe(
        true,
      );
    for (const email of emails) {
      const text = [
        email.subject,
        email.text,
        email.html,
        email.raw,
        email.rawBase64
          ? Buffer.from(email.rawBase64, "base64").toString("utf8")
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      expect(text).toContain("https://staging.slop.cash/inbox");
      for (const privateValue of [
        summary,
        description,
        caseId,
        submissionId,
        id,
      ])
        expect(text).not.toContain(privateValue);
    }
    const unsubscribe = emails
      .filter((email) => email.to.includes(emailActors[1].address))
      .map(
        (email) =>
          email.text?.match(
            /#unsubscribe-email=([a-f0-9]{64}\.[a-f0-9]{64})/u,
          )?.[1],
      )
      .find(Boolean);
    expect(unsubscribe).toBeTruthy();
    await page.goto(`/inbox#unsubscribe-email=${unsubscribe}`, {
      waitUntil: "networkidle",
    });
    expect(new URL(page.url()).hash).toBe("");
    const stopEmail = page.getByRole("region", {
      name: "Unsubscribe",
      exact: true,
    });
    await stopEmail
      .getByRole("button", { name: "Unsubscribe", exact: true })
      .click();
    await expect(stopEmail.getByRole("status")).toBeVisible();
    const stopped = await api<{ enabled: boolean; securityEnabled: boolean }>(
      request,
      page,
      "reporter-a",
      "GET",
      "notifications/email",
    );
    expect(stopped.body).toMatchObject({
      enabled: false,
      securityEnabled: false,
    });
    expect(diagnostics.count(lostRequest)).toBe(1);
    await page.screenshot({
      path: test.info().outputPath("email-unsubscribed.png"),
      fullPage: true,
    });
  } finally {
    await Promise.all(actors.map((entry) => entry.context.close()));
    for (const [index, actor] of actors.entries()) {
      const video = actor.page.video();
      if (video)
        await test.info().attach(`participant-${index + 1}`, {
          path: await video.path(),
          contentType: "video/webm",
        });
    }
  }
});
