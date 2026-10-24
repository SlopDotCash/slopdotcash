/**
 * Private security bounty programs end to end (PRD section 8, SEC-01 to
 * SEC-18, the MVP-13 matrix rows that can run locally). It runs on the
 * shipped build with the real Pages Functions, a fresh local D1 with every
 * migration, seeded sessions for each role, and the loopback GitHub API
 * fixture for the private-reporting readiness check and the private reports
 * that verify receipt. All findings and advisories are synthetic. Nothing
 * here reaches GitHub, a model provider, a chain, or an email provider.
 */
import AxeBuilder from "@axe-core/playwright";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import type { SecurityBountyTerms } from "../../src/lib/security-bounty.mjs";
import {
  E2E_SECURITY_ACCOUNTS,
  fixtureRepository,
} from "../github-api-fixture.mjs";
import { applicationManifest } from "../project-application-manifest";

type Role = keyof typeof E2E_SECURITY_ACCOUNTS;
const TOKENS = JSON.parse(
  process.env.SLOP_E2E_SECURITY_TOKENS ?? "{}",
) as Record<Role, string>;
const ADMIN_TOKEN = process.env.SLOP_E2E_ADMIN_TOKEN ?? "";
const APPLICANT_TOKEN = process.env.SLOP_E2E_APPLICANT_TOKEN ?? "";
const GITHUB_FIXTURE = process.env.SLOP_E2E_GITHUB_API_ORIGIN ?? "";
const COOKIE = "__Host-slop_points";

test.describe.configure({ mode: "serial" });

function account(role: Role) {
  return { githubId: E2E_SECURITY_ACCOUNTS[role], githubLogin: `e2e-${role}` };
}

type Reply = { status: number; body: Record<string, unknown> };

/** The reviewed USDC asset on Base Sepolia. */
const BASE_SEPOLIA_USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";

/** A synthetic reviewed bounty vault for one program repository. */
function bountyDeployment(repository: string) {
  const id = fixtureRepository(repository).id.toString(16);
  return {
    network: "base-sepolia",
    vault: `0x1${id.padStart(39, "0")}`,
    asset: BASE_SEPOLIA_USDC,
    owner: "0x2000000000000000000000000000000000000002",
    identityAuthority: "0x3000000000000000000000000000000000000003",
    feeRecipient: "0x4000000000000000000000000000000000000004",
    factory: "0x5000000000000000000000000000000000000005",
    registrar: "0x6000000000000000000000000000000000000006",
    factoryCodeSha256: "cd".repeat(32),
    codeSha256: "ab".repeat(32),
    deploymentTransaction: `0x${"ab".repeat(32)}`,
    sourceCommit: "a".repeat(40),
    bindingDelaySeconds: "3600",
    rotationDelaySeconds: null,
    programId: null,
    projectPda: null,
    networkDomain: null,
    upgradeAuthority: null,
  };
}

/**
 * Seeds the local scanner output only: a finalized snapshot of the program's
 * bounty vault. No hosted database or chain is used. Owner decision D10:
 * this free balance, not the published terms, bounds award reservations.
 */
async function vaultSnapshot(
  projectId: string,
  deployment: { vault: string; asset: string },
  freeMinor: string,
  observedAt = new Date().toISOString(),
) {
  const persist = process.env.SLOP_E2E_PERSIST_TO;
  expect(persist).toBeTruthy();
  const { execFileSync } = await import("node:child_process");
  execFileSync(
    "node",
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "slop-private",
      "--local",
      "--persist-to",
      persist as string,
      "--command",
      `INSERT INTO security_vault_snapshots(project_id,network,chain,vault,asset_address,asset_decimals,total_deposited,total_paid,total_payout_fees,total_gross_withdrawn,total_withdrawal_fees,total_service_fees,free_balance,reserved_principal,reserved_fees,accrued_fees,reserved,block_number,block_time,observed_at) VALUES('${projectId}','base-sepolia','base','${deployment.vault}','${deployment.asset}',6,'${freeMinor}','0','0','0','0','0','${freeMinor}',NULL,NULL,NULL,'0','64','${observedAt}','${observedAt}') ON CONFLICT(project_id,network,vault) DO UPDATE SET total_deposited=excluded.total_deposited, free_balance=excluded.free_balance, block_number=CAST(CAST(block_number AS INTEGER)+1 AS TEXT), block_time=excluded.block_time, observed_at=excluded.observed_at`,
    ],
    { stdio: "pipe" },
  );
}

async function api(
  request: APIRequestContext,
  method: "GET" | "POST" | "PUT",
  path: string,
  token: string | null,
  data?: unknown,
): Promise<Reply> {
  const origin = new URL(test.info().project.use.baseURL ?? "").origin;
  const response = await request.fetch(`/api/v1/${path}`, {
    method,
    headers: {
      ...(token ? { cookie: `${COOKIE}=${token}` } : {}),
      ...(method === "GET" ? {} : { origin }),
    },
    ...(data === undefined ? {} : { data }),
  });
  return { status: response.status(), body: await response.json() };
}

function bountyTerms(
  repository: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: "1",
    status: "pending-approval",
    rewardMode: "bounty-only",
    eligibility: "critical-loss-of-funds",
    amount: {
      currency: "USDC",
      decimals: 6,
      network: "base",
      grossMinor: "10000000000",
    },
    settlement: {
      schemaVersion: "1",
      effectiveCycle: "2026-11",
      chain: "base",
      feeBasisPoints: 2500,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [bountyDeployment(repository)],
    },
    split: { researcherBasisPoints: 7500, slopBasisPoints: 2500 },
    sponsor: { name: "Slop", githubId: null },
    funding: { state: "pledged" },
    capacity: {
      awards: 1,
      closesAt: null,
      exhaustionRule:
        "Valid reports beyond capacity wait for owner-approved added funds; they are never relabeled.",
    },
    scope: {
      sourceRevisions: [{ repository, commit: "a".repeat(40) }],
      deployments: [],
      includedAssets: ["Vault deposits held by the protocol contracts"],
      excludedDependencies: [],
      testingPermission:
        "Local forks and isolated test networks only. No production testing.",
      severityRubric:
        "Critical means unauthorized loss or permanent theft of covered assets.",
      lossDefinition:
        "Unauthorized loss of covered assets caused by the defect, not market movement.",
    },
    intake: { kind: "github-private-vulnerability-reporting", repository },
    responseTargets: {
      acknowledgeHours: 24,
      triageBusinessDays: 3,
      updateIntervalDays: 7,
    },
    approvers: {
      technical: [account("security")],
      financial: [account("finance")],
      dispute: [account("dispute")],
    },
    dispute: {
      authority: "advisory",
      process: "An independent reviewer decides appeals privately in 14 days.",
    },
    disclosure:
      "The security maintainer controls disclosure. Nothing is published automatically.",
    safeHarbor:
      "Good-faith research inside this scope on local forks is authorized by the maintainers.",
    ...overrides,
  };
}

/** Creates a paused project through the owner self-service API. */
async function listProject(
  request: APIRequestContext,
  applicantToken: string,
  repository: string,
  id: string,
  overrides: Record<string, unknown>,
) {
  const facts = fixtureRepository(repository);
  const manifest = applicationManifest(id, repository, {
    steward: {
      displayName: "Bounty maintainers",
      kind: facts.owner.type === "User" ? "individual" : "organization",
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
    ...overrides,
  });
  // Creation reads the account's access through the Slopbot installation.
  const installed = await fetch(
    `${GITHUB_FIXTURE}/__fixture/slopbot/${repository}/installed`,
    { method: "PUT" },
  );
  expect(installed.status).toBe(204);
  const program = manifest.securityBounty as SecurityBountyTerms | undefined;
  const applied = await api(request, "POST", "projects", applicantToken, {
    manifest: program?.settlement
      ? {
          ...manifest,
          securityBounty: {
            ...program,
            settlement: { ...program.settlement, deployments: [] },
          },
        }
      : manifest,
  });
  expect(applied.status, JSON.stringify(applied.body)).toBe(201);
  if (program?.settlement) {
    // Fixture trust root only. An owner cannot self-attest a deployed vault.
    const registered = await revise(request, id, (current) => ({
      ...current,
      securityBounty: program,
    }));
    expect(registered.status, JSON.stringify(registered.body)).toBe(200);
  }
}

async function adminProject(request: APIRequestContext, id: string) {
  const listed = await api(request, "GET", "admin/projects", ADMIN_TOKEN);
  return (
    listed.body.projects as {
      id: string;
      revision: number;
      updatedAt: string;
      manifest: Record<string, unknown>;
    }[]
  ).find((project) => project.id === id) as {
    id: string;
    revision: number;
    updatedAt: string;
    manifest: Record<string, unknown>;
  };
}

async function revise(
  request: APIRequestContext,
  id: string,
  change: (manifest: Record<string, unknown>) => Record<string, unknown>,
): Promise<Reply> {
  const project = await adminProject(request, id);
  return api(request, "PUT", `admin/projects/${id}/manifest`, ADMIN_TOKEN, {
    manifest: change(project.manifest),
    expectedRevision: project.revision,
    reason: "Security bounty program terms",
  });
}

function openTerms(terms: Record<string, unknown>): Record<string, unknown> {
  return {
    ...terms,
    status: "open",
    funding: {
      state: "verified-available",
      evidence: "Synthetic staging funding evidence reference E2E-1",
      verifiedAt: "2026-10-19T00:00:00.000Z",
    },
  };
}

let keyCounter = 0;
function key(): string {
  keyCounter += 1;
  return `e2e-key-${Date.now()}-${keyCounter}`.padEnd(16, "0");
}

async function act(
  request: APIRequestContext,
  role: Role,
  caseId: string,
  action: string,
  fields: Record<string, unknown> = {},
  revision?: number,
): Promise<Reply> {
  let expected = revision;
  if (expected === undefined) {
    const read = await api(
      request,
      "GET",
      `security-cases/${caseId}`,
      TOKENS[role],
    );
    expected = (read.body.case as { revision: number }).revision;
  }
  return api(
    request,
    "POST",
    `security-cases/${caseId}/actions`,
    TOKENS[role],
    {
      action,
      expectedRevision: expected,
      idempotencyKey: key(),
      ...fields,
    },
  );
}

/** GitHub receives a synthetic private report from this account. */
async function githubReport(
  request: APIRequestContext,
  repository: string,
  ghsa: string,
  reporter: Role,
  createdAt: string,
) {
  const response = await request.fetch(
    `${GITHUB_FIXTURE}/__fixture/security-advisories/${repository}`,
    {
      method: "POST",
      data: {
        ghsa_id: ghsa,
        created_at: createdAt,
        state: "triage",
        summary: "Synthetic private report",
        description: "Synthetic reproduction on an isolated local fork.",
        severity: "critical",
        cwe_ids: [],
        vulnerabilities: [],
        submission: { accepted: false },
        author: {
          id: Number(account(reporter).githubId),
          login: account(reporter).githubLogin,
          type: "User",
        },
      },
    },
  );
  expect(response.status()).toBe(204);
}

/** A report sent on GitHub directly; the maintainer brings it in. */
async function importCase(
  request: APIRequestContext,
  projectId: string,
  repository: string,
  advisory: string,
  reporter: Role,
  receivedAt: string,
  maintainer: Role = "security",
): Promise<string> {
  await githubReport(request, repository, advisory, reporter, receivedAt);
  const imported = await api(
    request,
    "POST",
    "security-cases",
    TOKENS[maintainer],
    { mode: "import", projectId },
  );
  expect(imported.body, JSON.stringify(imported.body)).toEqual({
    state: "ok",
    received: 1,
  });
  const listed = await api(request, "GET", "security-cases", TOKENS[reporter]);
  return (
    listed.body.cases as { id: string; advisory?: { ghsa: string } }[]
  ).find((entry) => entry.advisory?.ghsa === advisory)?.id as string;
}

async function award(
  request: APIRequestContext,
  role: Role,
  caseId: string,
  grossMinor: string,
): Promise<Reply> {
  return act(request, role, caseId, "award", {
    decision: "amount",
    grossMinor,
    paymentDeadline: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    confirmation: true,
    reason: "Owner award for the confirmed synthetic finding.",
  });
}

const decision = (overrides: Record<string, unknown> = {}) => ({
  outcome: "confirmed",
  severity: "critical",
  loss: "verified-potential",
  inScope: true,
  relatedParty: false,
  rootCauseKey: "vault-share-rounding",
  evidenceReference: "private-advisory-comment-1",
  reason: "Reproduced on an isolated local fork at the covered revision.",
  ...overrides,
});

function observe(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/\/api\/v1\/(points|payments)\//u.test(message.location().url)
    )
      errors.push(message.text());
  });
  return errors;
}

async function signIn(page: Page, token: string) {
  await page.goto("/how-it-works", { waitUntil: "networkidle" });
  await page.evaluate(
    ([name, value]) => {
      document.cookie = `${name}=${value}; Path=/; Secure; SameSite=Strict`;
    },
    [COOKIE, token],
  );
}

async function expectAccessible(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

async function setIntake(
  request: APIRequestContext,
  repository: string,
  state: string,
) {
  const response = await request.fetch(
    `${GITHUB_FIXTURE}/__fixture/private-vulnerability-reporting/${repository}/${state}`,
    { method: "PUT" },
  );
  expect(response.status()).toBe(204);
}

test("owners publish and control bounty programs with verified funding @registry", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const suffix = test.info().project.name.replace(/-chromium$/u, "");
  const id = `owner-bounty-${suffix}`;
  const repository = `e2e-security/${id}`;
  await listProject(request, TOKENS.security, repository, id, {});
  const context = await browser.newContext({
    viewport: test.info().project.use.viewport,
    recordVideo: { dir: test.info().outputPath("owner-bounty-video") },
  });
  const page = await context.newPage();
  const errors = observe(page);
  try {
    await signIn(page, TOKENS.security);
    await page.goto(`/projects/${id}/manage`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Set bounty terms" }).click();
    await page.getByLabel("Published gross award (USDC)").fill("100");
    await page.getByLabel(`Source commit (${repository})`).fill("a".repeat(40));
    const values = {
      "Covered assets": "Vault deposits",
      "Test rules": "Test on local forks only.",
      "Severity guide": "Assess impact on covered funds.",
      "Loss of funds": "Unauthorized loss of covered funds.",
      "When funds run out": "New awards wait for available funds.",
      Disputes: "Ask Slop for a private review.",
      Disclosure: "Contact the maintainer before disclosure.",
      "Researcher protection":
        "Good-faith testing within these rules is authorized.",
    };
    for (const [label, value] of Object.entries(values))
      await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "Publish bounty terms" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: "Published revision" }),
    ).toBeVisible();
    let stored = await adminProject(request, id);
    expect((stored.manifest.securityBounty as { status: string }).status).toBe(
      "paused",
    );
    // Program settings cannot self-attest funds or register a contract.
    const unsupported = await api(
      request,
      "PUT",
      `projects/${id}`,
      TOKENS.security,
      {
        expectedRevision: stored.revision,
        manifest: {
          ...stored.manifest,
          securityBounty: {
            ...(stored.manifest.securityBounty as object),
            status: "open",
          },
        },
      },
    );
    expect(unsupported.status).toBe(422);
    expect(unsupported.body.error).toBe("security_funding_unavailable");
    const reviewed = bountyTerms(repository).settlement;
    expect(
      (
        await revise(request, id, (manifest) => ({
          ...manifest,
          securityBounty: {
            ...(manifest.securityBounty as object),
            settlement: reviewed,
          },
        }))
      ).status,
    ).toBe(200);
    await vaultSnapshot(id, bountyDeployment(repository), "200000000");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Edit bounty settings" }).click();
    await page.getByLabel("Status", { exact: true }).selectOption("open");
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("owner-bounty-settings.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Publish bounty terms" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Published revision" }),
    ).toBeVisible();
    stored = await adminProject(request, id);
    expect(stored.manifest.securityBounty).toMatchObject({
      status: "open",
      funding: { state: "verified-available" },
      split: { researcherBasisPoints: 7500, slopBasisPoints: 2500 },
    });
    await page.getByRole("button", { name: "Edit bounty settings" }).click();
    await page.getByLabel("Status", { exact: true }).selectOption("closed");
    await page.getByRole("button", { name: "Publish bounty terms" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: `Published revision ${stored.revision + 1}.` }),
    ).toBeVisible();
    expect(
      (await adminProject(request, id)).manifest.securityBounty,
    ).toMatchObject({ status: "closed" });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("private security bounty programs keep cases restricted from intake to award @registry", async ({
  browser,
  request,
}) => {
  test.setTimeout(300_000);
  const suffix = test.info().project.name.replace(/-chromium$/u, "");
  const a = {
    id: `bounty-a-${suffix}`,
    repository: `e2e-security/bounty-a-${suffix}`,
  };
  const b = {
    id: `bounty-b-${suffix}`,
    repository: `e2e-security-b/bounty-b-${suffix}`,
  };

  await test.step("program setup: opt in during setup, admins open by revision", async () => {
    // Bounty-only needs no monthly pool: the application pledges $0.
    await listProject(request, TOKENS.security, a.repository, a.id, {
      reward: {
        ...(applicationManifest(a.id, a.repository).reward as object),
        monthlyCapMinor: "0",
        monthlyCapDisplay: "$0",
      },
      securityBounty: bountyTerms(a.repository),
    });
    await listProject(request, TOKENS["security-b"], b.repository, b.id, {});
    const bTerms = bountyTerms(b.repository, {
      rewardMode: "separate",
      sponsor: { name: "Example Foundation", githubId: null },
      amount: {
        currency: "USDC",
        decimals: 6,
        network: "base",
        grossMinor: "100000000000",
      },
      capacity: {
        awards: 3,
        closesAt: null,
        exhaustionRule:
          "New paid research pauses when three awards are reserved.",
      },
      approvers: {
        technical: [account("security-b")],
        financial: [account("finance")],
        dispute: [account("dispute")],
      },
    });
    // Invalid terms never become a revision.
    const refusals = await Promise.all([
      revise(request, b.id, (m) => ({
        ...m,
        securityBounty: openTerms({
          ...bTerms,
          amount: { ...(bTerms.amount as object), grossMinor: "100000000001" },
        }),
      })),
      revise(request, b.id, (m) => ({
        ...m,
        securityBounty: { ...bTerms, status: "open" },
      })),
      revise(request, b.id, (m) => ({
        ...m,
        securityBounty: openTerms({ ...bTerms, rewardMode: "bounty-only" }),
      })),
    ]);
    expect(refusals.map((reply) => reply.status)).toEqual([422, 422, 422]);
    expect(String(refusals[0].body.message)).toContain("divisible by four");
    expect(String(refusals[1].body.message)).toContain(
      "open requires verified available funding",
    );
    expect(
      (
        await revise(request, b.id, (m) => ({
          ...m,
          securityBounty: openTerms(bTerms),
        }))
      ).status,
    ).toBe(200);
    const opened = await revise(request, a.id, (m) => ({
      ...m,
      securityBounty: openTerms(m.securityBounty as Record<string, unknown>),
    }));
    expect(opened.status).toBe(200);
    // A program is closed by revision, never removed.
    const removed = await revise(request, a.id, (m) => {
      const { securityBounty: _removed, ...rest } = m;
      return rest;
    });
    expect(removed.status).toBe(422);
    const terms = await request.get(`/projects/${a.id}/terms.json`);
    expect(await terms.json()).toMatchObject({
      securityBounty: {
        status: "open",
        rewardMode: "bounty-only",
        amount: { grossMinor: "10000000000", currency: "USDC" },
      },
    });
    const revisions = await api(request, "GET", "project-revisions", null);
    expect(
      (revisions.body.revisions as { projectId: string }[]).filter(
        (entry) => entry.projectId === a.id,
      ),
    ).toHaveLength(3);
  });

  const opened = await adminProject(request, a.id);
  // A receipt before the program opened freezes no paid terms.
  const beforeOpen = new Date(
    Date.parse(opened.updatedAt) - 60_000,
  ).toISOString();
  const afterOpen = new Date(Date.parse(opened.updatedAt) + 1).toISOString();
  await expect.poll(() => Date.now() > Date.parse(afterOpen) + 5).toBe(true);

  await test.step("public terms and amounts", async () => {
    const context = await browser.newContext({
      viewport: test.info().project.use.viewport,
      recordVideo: { dir: test.info().outputPath("workflow-video") },
    });
    const page = await context.newPage();
    const errors = observe(page);
    await page.goto(`/projects/${a.id}/security`, { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toHaveText("Security bounty");
    await expect(page.locator(".security-lead")).toHaveText(
      "Published award: 10,000 USDC gross per finding, 7,500 USDC to the researcher. Funded by Slop.",
    );
    const facts = page.getByRole("region", { name: "Award terms" });
    await expect(facts).toContainText("Researcher · 75%7,500 USDC");
    await expect(facts).toContainText(
      "Published gross award per finding10,000 USDC",
    );
    await expect(facts).toContainText("Awards are discretionary.");
    await expect(facts).toContainText("Slop · 25%2,500 USDC");
    await expect(facts).toContainText("Bounty only.");
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("program-terms.png"),
      fullPage: true,
    });
    await page.goto(`/projects/${b.id}/security`, { waitUntil: "networkidle" });
    await expect(page.locator(".security-lead")).toContainText(
      "100,000 USDC gross per finding, 75,000 USDC to the researcher",
    );
    await expect(
      page.getByRole("region", { name: "Award terms" }),
    ).toContainText("Published gross award per finding100,000 USDC");
    // The project page links the program.
    await page.goto(`/projects/${a.id}`, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("link", { name: "Security bounty" }),
    ).toHaveAttribute("href", `/projects/${a.id}/security`);
    expect(errors).toEqual([]);
    await context.close();
  });

  await test.step("intake readiness gates the GitHub handoff", async () => {
    await setIntake(request, b.repository, "disabled");
    // Without the slopdotcash App the page offers only the GitHub handoff,
    // also in the lane where automatic intake is on.
    const app = (state: "installed" | "missing") =>
      request.fetch(
        `${GITHUB_FIXTURE}/__fixture/intake-app/${a.repository}/${state}`,
        { method: "PUT" },
      );
    expect((await app("missing")).status()).toBe(204);
    const context = await browser.newContext({
      viewport: test.info().project.use.viewport,
      recordVideo: { dir: test.info().outputPath("workflow-video") },
    });
    const page = await context.newPage();
    const errors = observe(page);
    await page.clock.install();
    // The page checks readiness on open; no click is needed.
    await page.goto(`/projects/${a.id}/security`, { waitUntil: "networkidle" });
    const handoff = page.getByRole("link", {
      name: "Report privately on GitHub",
    });
    await expect(handoff).toHaveAttribute(
      "href",
      `https://github.com/${a.repository}/security/advisories/new`,
    );
    await expectAccessible(page);
    await page.screenshot({ path: test.info().outputPath("intake-ready.png") });
    // An old answer stops the handoff until the check runs again.
    await page.clock.fastForward(31_000);
    await expect(page.getByRole("alert")).toContainText("is out of date");
    await expect(handoff).toHaveCount(0);
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(handoff).toBeVisible();
    await page.goto(`/projects/${b.id}/security`, { waitUntil: "networkidle" });
    await expect(page.getByRole("alert")).toContainText(
      "private vulnerability reporting is turned off",
    );
    await expect(
      page.getByRole("link", { name: "Report privately on GitHub" }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
    for (const state of ["forbidden", "unavailable"]) {
      await setIntake(request, b.repository, state);
      const checked = await api(
        request,
        "GET",
        `security-programs/${b.id}/intake?state=${state}`,
        null,
      );
      expect(checked.body).toMatchObject({ state, handoffUrl: null });
    }
    // The App reads the program's private reports from here on.
    expect((await app("installed")).status()).toBe(204);
  });

  let caseA = "";
  let caseB = "";
  // The reporter-authorized submission flow is covered by @private-intake below.
  // Here, reports filed directly on GitHub enter the same award workflow.
  await test.step("GitHub receipts create private cases for the original reporters", async () => {
    caseA = await importCase(
      request,
      a.id,
      a.repository,
      "GHSA-2c3f-4g5h-6j7m",
      "reporter-a",
      afterOpen,
    );
    caseB = await importCase(
      request,
      a.id,
      a.repository,
      "GHSA-3c4f-5g6h-7j8m",
      "reporter-b",
      afterOpen,
    );
    for (const [role, id] of [
      ["reporter-a", caseA],
      ["reporter-b", caseB],
    ] as const) {
      const read = await api(
        request,
        "GET",
        `security-cases/${id}`,
        TOKENS[role],
      );
      expect(read.body.case).toMatchObject({
        submissionState: "verified",
        receivedAt: afterOpen,
        receivedAtSource: "github-verified",
        policyRevision: opened.revision,
        terms: {
          grossMinor: "10000000000",
          researcherMinor: "7500000000",
          slopMinor: "2500000000",
        },
        awardState: "pending",
      });
    }
  });

  await test.step("a report sent on GitHub directly is brought in without typing", async () => {
    // Only a security maintainer can import.
    expect(
      (
        await api(request, "POST", "security-cases", TOKENS["reporter-b"], {
          mode: "import",
          projectId: a.id,
        })
      ).status,
    ).toBe(403);
    const direct = await importCase(
      request,
      a.id,
      a.repository,
      "GHSA-7c8f-9g2h-3j4m",
      "reporter-b",
      afterOpen,
    );
    const read = await api(
      request,
      "GET",
      `security-cases/${direct}`,
      TOKENS.security,
    );
    expect(read.body.case).toMatchObject({
      submissionState: "verified",
      receivedAtSource: "github-verified",
      reporter: { githubLogin: "e2e-reporter-b" },
    });
    // Importing again records nothing twice.
    expect(
      (
        await api(request, "POST", "security-cases", TOKENS.security, {
          mode: "import",
          projectId: a.id,
        })
      ).body,
    ).toEqual({ state: "ok", received: 0 });
  });

  await test.step("identity and access stay isolated", async () => {
    const read = (role: Role | "admin" | "applicant" | null, id: string) =>
      api(
        request,
        "GET",
        `security-cases/${id}`,
        role === null
          ? null
          : role === "admin"
            ? ADMIN_TOKEN
            : role === "applicant"
              ? APPLICANT_TOKEN
              : TOKENS[role],
      );
    expect((await read(null, caseA)).status).toBe(401);
    expect((await api(request, "GET", "security-cases", null)).status).toBe(
      401,
    );
    // Reporter A cannot read reporter B, and neither can outsiders.
    for (const [role, id] of [
      ["reporter-a", caseB],
      ["reporter-b", caseA],
      ["admin", caseA],
      ["applicant", caseA],
      ["security-b", caseA],
      ["finance", caseA],
      ["dispute", caseA],
    ] as const) {
      const reply = await read(role, id);
      expect(reply.status, `${role} reading ${id}`).toBe(404);
    }
    const adminList = await api(request, "GET", "security-cases", ADMIN_TOKEN);
    expect(
      (adminList.body.cases as { projectId: string }[]).filter(
        (entry) => entry.projectId === a.id,
      ),
    ).toEqual([]);
    const own = await read("reporter-a", caseA);
    expect(own.body.case).toMatchObject({
      view: "reporter",
      viewerRoles: ["reporter"],
    });
    expect(own.body.case).not.toHaveProperty("rootCauseKey");
    expect(own.body.case).not.toHaveProperty("triagers");
    // Triagers see only assigned cases, and lose access at once.
    expect(
      (
        await act(
          request,
          "security",
          caseA,
          "assign-triager",
          account("triager"),
        )
      ).status,
    ).toBe(200);
    expect((await read("triager", caseA)).status).toBe(200);
    expect((await read("triager", caseB)).status).toBe(404);
    expect(
      (await act(request, "triager", caseA, "decide", decision())).status,
    ).toBe(403);
    expect(
      (
        await act(request, "triager", caseA, "request-information", {
          reason: "Which fork block reproduces the rounding loss?",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await act(request, "security", caseA, "revoke-triager", {
          githubId: account("triager").githubId,
        })
      ).status,
    ).toBe(200);
    expect((await read("triager", caseA)).status).toBe(404);
  });

  await test.step("the owner's award reserves exactly once per root cause", async () => {
    const before = await api(
      request,
      "GET",
      `security-cases/${caseA}`,
      TOKENS.security,
    );
    const revision = (before.body.case as { revision: number }).revision;
    const decide = (idempotencyKey: string) =>
      api(request, "POST", `security-cases/${caseA}/actions`, TOKENS.security, {
        action: "decide",
        expectedRevision: revision,
        idempotencyKey,
        ...decision(),
      });
    const keys = [key(), key()];
    const replies = await Promise.all(keys.map(decide));
    // Two decisions from the same revision cannot both land.
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    const landed = keys[replies.findIndex((reply) => reply.status === 200)];
    const replay = await decide(landed);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    const decided = await api(
      request,
      "GET",
      `security-cases/${caseA}`,
      TOKENS.security,
    );
    // A technical decision reserves nothing; the owner decides the award.
    expect(decided.body.case).toMatchObject({
      receiptState: "confirmed",
      awardState: "pending",
      reservation: null,
    });
    // Neither the reporter nor finance can award.
    expect(
      (await award(request, "reporter-a", caseA, "10000000000")).status,
    ).toBe(403);
    // The bounty vault's finalized free balance holds one published award.
    await vaultSnapshot(a.id, bountyDeployment(a.repository), "10000000000");
    const awarded = await award(request, "security", caseA, "10000000000");
    expect(awarded.status, JSON.stringify(awarded.body)).toBe(200);
    expect(awarded.body.case).toMatchObject({
      awardState: "approved",
      paymentState: "rail-unavailable",
      award: {
        grossMinor: "10000000000",
        researcherMinor: "7500000000",
        slopMinor: "2500000000",
      },
      reservation: {
        rootCauseKey: "vault-share-rounding",
        grossMinor: "10000000000",
      },
    });
    // The same root cause cannot hold a second award through another report.
    expect(
      (await act(request, "security", caseB, "decide", decision())).body.error,
    ).toBe("root_cause_reserved");
    const duplicate = await act(
      request,
      "security",
      caseB,
      "decide",
      decision({
        outcome: "duplicate",
        duplicateOf: caseA,
        reason: "An earlier complete report covers this root cause.",
      }),
    );
    expect(duplicate.status, JSON.stringify(duplicate.body)).toBe(200);
    expect(duplicate.body.case).toMatchObject({ awardState: "ineligible" });
    // The reporter learns the decision, never the other report.
    const seen = await api(
      request,
      "GET",
      `security-cases/${caseB}`,
      TOKENS["reporter-b"],
    );
    expect(JSON.stringify(seen.body)).not.toContain(caseA);
    expect(seen.body.case).not.toHaveProperty("duplicateOf");
  });

  await test.step("severity guides the owner; funds bound the award; receipt freezes terms", async () => {
    const third = await importCase(
      request,
      a.id,
      a.repository,
      "GHSA-4c5f-6g7h-8j9m",
      "reporter-a",
      afterOpen,
    );
    // A high-severity finding without verified loss is not barred.
    const decided = await act(
      request,
      "security",
      third,
      "decide",
      decision({
        rootCauseKey: "oracle-staleness",
        severity: "high",
        loss: "not-verified",
      }),
    );
    expect(decided.body.case).toMatchObject({
      receiptState: "confirmed",
      awardState: "pending",
    });
    // The vault's finalized free balance (one award) is already reserved.
    const short = await award(request, "security", third, "4000000000");
    expect(short.status).toBe(409);
    expect(short.body.error).toBe("insufficient_funds");
    expect(
      (await api(request, "GET", `security-cases/${third}`, TOKENS.security))
        .body.case,
    ).toMatchObject({ awardState: "pending", reservation: null });
    // An amount that cannot split exactly 75/25 is refused.
    expect(
      (await award(request, "security", third, "4000000002")).body.error,
    ).toBe("invalid_amount");
    // A stale snapshot proves nothing, even when it shows enough money.
    await vaultSnapshot(
      a.id,
      bountyDeployment(a.repository),
      "14000000000",
      new Date(Date.now() - 31 * 60_000).toISOString(),
    );
    expect(
      (await award(request, "security", third, "4000000000")).body.error,
    ).toBe("funds_unavailable");
    // A finalized deposit raises the free balance; the terms do not change.
    await vaultSnapshot(a.id, bountyDeployment(a.repository), "14000000000");
    const funded = await award(request, "security", third, "4000000000");
    expect(funded.status, JSON.stringify(funded.body)).toBe(200);
    expect(funded.body.case).toMatchObject({
      awardState: "approved",
      receivedAtSource: "github-verified",
      reservation: { grossMinor: "4000000000" },
    });
    const history = await api(
      request,
      "GET",
      `security-cases/${third}`,
      TOKENS["reporter-a"],
    );
    expect(
      (history.body.case as { events: { kind: string }[] }).events.map(
        (event) => event.kind,
      ),
    ).toEqual(["receive", "decide", "award"]);
    // A report GitHub received before the program opened has no paid terms.
    const early = await importCase(
      request,
      a.id,
      a.repository,
      "GHSA-5c6f-7g8h-9j2m",
      "reporter-b",
      beforeOpen,
    );
    expect(
      (await api(request, "GET", `security-cases/${early}`, TOKENS.security))
        .body.case,
    ).toMatchObject({ terms: null, awardState: "not-applicable" });
  });

  await test.step("a related-party award needs an independent reviewer", async () => {
    // Declared by the technical decider.
    const declared = await importCase(
      request,
      b.id,
      b.repository,
      "GHSA-8c9f-2g3h-4j5m",
      "reporter-b",
      new Date(Date.now() - 1000).toISOString(),
      "security-b",
    );
    expect(
      (
        await act(
          request,
          "security-b",
          declared,
          "decide",
          decision({ rootCauseKey: "related-declared", relatedParty: true }),
        )
      ).status,
    ).toBe(200);
    await vaultSnapshot(b.id, bountyDeployment(b.repository), "100000000000");
    const pending = await award(request, "security-b", declared, "40000000000");
    expect(pending.body.case).toMatchObject({
      receiptState: "confirmed",
      awardState: "pending",
      relatedParty: "related",
      relatedPartyReview: "pending",
      reservation: null,
    });
    // Finance sees nothing before an award is reserved.
    expect(
      (await api(request, "GET", `security-cases/${declared}`, TOKENS.finance))
        .status,
    ).toBe(404);
    // The technical decider cannot review its own related-party case.
    expect(
      (
        await act(request, "security-b", declared, "decide-related-party", {
          outcome: "approve",
          reason: "Approved after independent review.",
        })
      ).status,
    ).toBe(409);
    // A program approver as reporter is always a related party.
    const approverReport = await importCase(
      request,
      b.id,
      b.repository,
      "GHSA-9c2f-3g4h-5j6m",
      "finance",
      new Date(Date.now() - 1000).toISOString(),
      "security-b",
    );
    await act(
      request,
      "security-b",
      approverReport,
      "decide",
      decision({ rootCauseKey: "related-approver" }),
    );
    const automatic = await award(
      request,
      "security-b",
      approverReport,
      "20000000000",
    );
    expect(automatic.body.case).toMatchObject({
      relatedParty: "related",
      relatedPartyReview: "pending",
      awardState: "pending",
    });

    // The dispute reviewer approves in the real UI.
    const context = await browser.newContext({
      viewport: test.info().project.use.viewport,
      recordVideo: { dir: test.info().outputPath("workflow-video") },
    });
    const page = await context.newPage();
    const errors = observe(page);
    await signIn(page, TOKENS.dispute);
    await page.goto("/security", { waitUntil: "networkidle" });
    await page
      .getByRole("button", {
        name: new RegExp(`${b.id} GHSA-8c9f-2g3h-4j5m`, "u"),
      })
      .click();
    const detail = page.locator(`[aria-labelledby="case-${declared}"]`);
    await expect(detail).toContainText("Waiting for an independent reviewer");
    await expect(detail.getByText(/\(verified from GitHub\)/u)).toBeVisible();
    const form = detail.getByRole("form", {
      name: "Related-party award review",
    });
    await form.getByLabel("Outcome").selectOption("approve");
    await form
      .getByLabel("Private reason")
      .fill("The reporter has no control over the payer or the decision.");
    await form.getByRole("button", { name: "Record review" }).click();
    await expect(detail.getByRole("status")).toContainText(
      "Related-party award review: saved.",
    );
    await expect(detail).toContainText("Approved by an independent reviewer");
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("related-party-review.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    await context.close();
    expect(
      (await api(request, "GET", `security-cases/${declared}`, TOKENS.finance))
        .body.case,
    ).toMatchObject({
      awardState: "approved",
      relatedPartyReview: "approved",
      award: { grossMinor: "40000000000" },
      // The program's reviewed bounty vault is the payment rail.
      allowedActions: ["prepare-payment"],
    });

    // A refusal makes the award ineligible; the refuser cannot hear the appeal.
    const refused = await act(
      request,
      "dispute",
      approverReport,
      "decide-related-party",
      {
        outcome: "refuse",
        reason: "The approver controls payment for this program.",
      },
    );
    expect(refused.body.case).toMatchObject({
      awardState: "ineligible",
      relatedPartyReview: "refused",
    });
    expect(
      (
        await act(request, "finance", approverReport, "appeal", {
          reason: "I had no part in the decision or the payment for this case.",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await act(request, "dispute", approverReport, "decide-appeal", {
          outcome: "uphold",
          reason: "The refusal stands.",
        })
      ).status,
    ).toBe(403);
  });

  await test.step("appeal goes to an independent reviewer", async () => {
    expect(
      (
        await act(request, "reporter-b", caseB, "appeal", {
          reason:
            "My report describes a different withdrawal path with its own fix.",
        })
      ).status,
    ).toBe(200);
    const disputed = await api(
      request,
      "GET",
      `security-cases/${caseB}`,
      TOKENS.dispute,
    );
    expect(disputed.body.case).toMatchObject({
      receiptState: "disputed",
      allowedActions: ["decide-appeal"],
    });
    // PRD section 8: Slopbot triages the appeal first and drafts a
    // resolution; a private security case always escalates to a moderator.
    await expect
      .poll(
        async () =>
          (
            (
              await api(
                request,
                "GET",
                `security-cases/${caseB}`,
                TOKENS.dispute,
              )
            ).body.case as { appealTriage: { state: string } | null }
          ).appealTriage?.state,
      )
      .toBe("complete");
    const triaged = (
      await api(request, "GET", `security-cases/${caseB}`, TOKENS.dispute)
    ).body.case as {
      projectId: string;
      advisory: { ghsa: string };
      allowedActions: string[];
      appealTriage: Record<string, unknown>;
    };
    expect(triaged.appealTriage).toMatchObject({
      state: "complete",
      provider: "surplus",
      model: "claude-opus-5.5",
      promptRevision: "slop-security-appeal-triage-1",
      proposedOutcome: "return",
      confidence: 0.72,
      escalationReasons: ["private-security-case", "confidence-below-floor"],
    });
    expect(triaged.allowedActions).toEqual(["decide-appeal"]);
    // The reporter's own view shows no draft.
    expect(
      (
        await api(
          request,
          "GET",
          `security-cases/${caseB}`,
          TOKENS["reporter-b"],
        )
      ).body.case,
    ).not.toHaveProperty("appealTriage");
    const context = await browser.newContext({
      viewport: test.info().project.use.viewport,
      recordVideo: { dir: test.info().outputPath("appeal-triage-video") },
    });
    const page = await context.newPage();
    const errors = observe(page);
    await signIn(page, TOKENS.dispute);
    await page.goto("/security", { waitUntil: "networkidle" });
    await page
      .getByRole("button", {
        name: new RegExp(`^${triaged.projectId} ${triaged.advisory.ghsa} `),
      })
      .click();
    const panel = page.getByRole("region", { name: "Slopbot appeal triage" });
    await expect(panel).toContainText(
      "Return the case for a new technical review",
    );
    await expect(panel).toContainText("72%");
    await expect(panel).toContainText(
      "Every private security case goes to a moderator; Slopbot's confidence is below 0.9",
    );
    await expect(panel).toContainText(
      "Fixture draft: the appeal names a separate withdrawal path",
    );
    await expect(
      panel.getByRole("button", { name: "Run the appeal triage again" }),
    ).toHaveCount(0);
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("appeal-triage.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    await context.close();
    // The technical decider is not a dispute reviewer.
    expect(
      (
        await act(request, "security", caseB, "decide-appeal", {
          outcome: "uphold",
          reason: "The original decision stands.",
        })
      ).status,
    ).toBe(409);
    const returned = await act(request, "dispute", caseB, "decide-appeal", {
      outcome: "return",
      reason: "The withdrawal path needs a new technical review.",
    });
    expect(returned.body.case).toMatchObject({
      receiptState: "triaging",
      appealState: "returned",
      awardState: "pending",
    });
  });

  await test.step("finance sees only award and payment fields; nothing becomes paid", async () => {
    const finance = await api(
      request,
      "GET",
      `security-cases/${caseA}`,
      TOKENS.finance,
    );
    expect(finance.body.case).toMatchObject({
      view: "financial",
      awardState: "approved",
      paymentState: "rail-unavailable",
      // No settlement exists yet; the reviewed bounty vault allows one.
      paymentRail: "unavailable",
      payee: { githubLogin: "e2e-reporter-a" },
      allowedActions: ["prepare-payment"],
    });
    expect(finance.body.case).not.toHaveProperty("analysis");
    expect(finance.body.case).not.toHaveProperty("advisory");
    expect(finance.body.case).not.toHaveProperty("severity");
    // A financial approver never sees cases without an award.
    expect(
      (await api(request, "GET", `security-cases/${caseB}`, TOKENS.finance))
        .status,
    ).toBe(404);
    // Remediation and disclosure stay separate: fixed and paid publish nothing.
    expect(
      (
        await act(request, "security", caseA, "remediation", {
          remediationState: "resolved",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await act(request, "security", caseA, "remediation", {
          remediationState: "resolved",
          evidenceReference: "private exact-head test log 1",
        })
      ).status,
    ).toBe(200);
    const after = await api(
      request,
      "GET",
      `security-cases/${caseA}`,
      TOKENS["reporter-a"],
    );
    expect(after.body.case).toMatchObject({
      remediationState: "resolved",
      awardState: "approved",
      disclosureState: "embargoed",
      recognition: "private",
    });
  });

  await test.step("a security inbox notice requires explicit acknowledgment, separately from read", async () => {
    const context = await browser.newContext({
      viewport: test.info().project.use.viewport,
      recordVideo: { dir: test.info().outputPath("acknowledgment-video") },
    });
    const page = await context.newPage();
    const errors = observe(page);
    await signIn(page, TOKENS["reporter-a"]);
    await page.goto("/inbox", { waitUntil: "networkidle" });
    const notice = page
      .getByRole("listitem")
      .filter({
        has: page.getByRole("button", {
          name: /^Acknowledge: Private security case /u,
        }),
      })
      .first();
    await expect(notice).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("security-notice-before.png"),
      fullPage: true,
    });
    const acknowledge = notice.getByRole("button", {
      name: /^Acknowledge: Private security case /u,
    });
    await acknowledge.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText(
      "Security notice acknowledged.",
    );
    await expect(
      page.getByText("Acknowledged", { exact: true }).first(),
    ).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.getByText("Acknowledged", { exact: true }).first(),
    ).toBeVisible();
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("security-notice-acknowledged.png"),
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect(
      page.getByText("Acknowledged", { exact: true }).first(),
    ).toBeVisible();
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("security-notice-zoom.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    await context.close();
  });

  await test.step("disclosure records bind approved bytes without publishing or identity consent", async () => {
    const digest = "a".repeat(64);
    const decision = {
      disclosureState: "redaction-approved",
      reason: "Independent human approval of the synthetic redacted text",
      evidenceReference: "private advisory approval record version 1",
    };
    expect(
      (await act(request, "security", caseA, "disclosure", decision)).status,
    ).toBe(400);
    expect(
      (
        await act(request, "reporter-a", caseA, "disclosure", {
          ...decision,
          redactedContentDigest: digest,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await act(request, "security", caseA, "disclosure", {
          ...decision,
          disclosureState: "disclosed",
          redactedContentDigest: digest,
        })
      ).status,
    ).toBe(409);
    const context = await browser.newContext({
      viewport: test.info().project.use.viewport,
      recordVideo: { dir: test.info().outputPath("disclosure-video") },
    });
    const page = await context.newPage();
    const errors = observe(page);
    await signIn(page, TOKENS.security);
    const failures: string[] = [];
    page.on("requestfailed", (request) => {
      if (new URL(request.url()).origin === new URL(page.url()).origin)
        failures.push(new URL(request.url()).pathname);
    });
    await page.goto("/security", { waitUntil: "networkidle" });
    await page
      .getByRole("button", {
        name: new RegExp(`${a.id} GHSA-2c3f-4g5h-6j7m`, "u"),
      })
      .click();
    const form = page.locator("form").filter({
      has: page.getByRole("button", { name: "Save disclosure decision" }),
    });
    await form
      .getByLabel("Disclosure state")
      .selectOption("redaction-approved");
    await form
      .getByLabel("Private disclosure approval evidence")
      .fill(decision.evidenceReference);
    await form.getByLabel("Approved redacted content SHA-256").fill(digest);
    await form
      .getByLabel("Approved embargo change")
      .fill(
        "Maintainer approved extending the embargo until the private retest is complete.",
      );
    await form.getByLabel("Private reason").fill(decision.reason);
    await form
      .getByRole("button", { name: "Save disclosure decision" })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Disclosure: saved.");
    await page.getByText("Case details and history", { exact: true }).click();
    await expect(page.locator(".security-history")).toContainText(digest);
    await expect(page.locator(".security-history")).toContainText(
      "extending the embargo",
    );
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("disclosure-approved.png"),
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("disclosure-zoom.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    expect(failures).toEqual([]);
    await context.close();
    expect(
      (
        await act(request, "security", caseA, "disclosure", {
          ...decision,
          disclosureState: "disclosed",
          redactedContentDigest: "b".repeat(64),
        })
      ).status,
    ).toBe(409);
    const disclosureKey = key();
    const disclosedFields = {
      ...decision,
      disclosureState: "disclosed",
      redactedContentDigest: digest,
      idempotencyKey: disclosureKey,
    };
    const disclosed = await act(
      request,
      "security",
      caseA,
      "disclosure",
      disclosedFields,
    );
    expect(disclosed.status).toBe(200);
    const replay = await act(
      request,
      "security",
      caseA,
      "disclosure",
      disclosedFields,
    );
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    const after = await api(
      request,
      "GET",
      `security-cases/${caseA}`,
      TOKENS["reporter-a"],
    );
    expect(after.body.case).toMatchObject({
      disclosureState: "disclosed",
      recognition: "private",
    });
    const history = await api(
      request,
      "GET",
      `security-cases/${caseA}`,
      TOKENS.security,
    );
    const events = (
      history.body.case as {
        events: {
          kind: string;
          revision: number;
          detail: {
            disclosureState: string;
            redactedContentDigest: string;
            approvalRevision: number | null;
            embargoChange: string | null;
          };
        }[];
      }
    ).events.filter((event) => event.kind === "disclosure");
    expect(events).toHaveLength(2);
    const approval = events.find(
      (event: { detail: { disclosureState: string } }) =>
        event.detail.disclosureState === "redaction-approved",
    );
    const receipt = events.find(
      (event: { detail: { disclosureState: string } }) =>
        event.detail.disclosureState === "disclosed",
    );
    expect(receipt?.detail).toMatchObject({
      redactedContentDigest: digest,
      approvalRevision: approval?.revision,
      embargoChange: null,
    });
  });

  await test.step("the reporter sees the case in the inbox UI", async () => {
    const context = await browser.newContext({
      viewport: test.info().project.use.viewport,
      recordVideo: { dir: test.info().outputPath("workflow-video") },
    });
    const page = await context.newPage();
    const errors = observe(page);
    await signIn(page, TOKENS["reporter-a"]);
    await page.goto("/security", { waitUntil: "networkidle" });
    await page
      .getByRole("button", {
        name: new RegExp(`${a.id} GHSA-2c3f-4g5h-6j7m`, "u"),
      })
      .click();
    const detail = page.locator(`[aria-labelledby="case-${caseA}"]`);
    await expect(detail).toContainText(
      "7,500 USDC to the researcher · 2,500 USDC to Slop · 10,000 USDC gross",
    );
    await expect(detail).toContainText("Approved, not paid yet");
    await expect(detail).toContainText("Received by GitHub");
    await expect(detail).not.toContainText("AI summary");
    await detail.getByText("More actions", { exact: true }).click();
    await detail.getByLabel("Show my name publicly").selectOption("opt-in");
    await detail.getByRole("button", { name: "Save my choice" }).click();
    await expect(detail.getByRole("status")).toContainText(
      "Public recognition: saved.",
    );
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("reporter-case.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    await context.close();
  });

  await test.step("no case data reaches public outputs", async () => {
    const outputs = await Promise.all(
      [
        "/api/v1/projects",
        "/api/v1/project-revisions",
        `/api/v1/projects/${a.id}`,
        `/projects/${a.id}/terms.json`,
        "/.well-known/slop/projects.json",
        `/projects/${a.id}/security`,
        "/",
      ].map(async (path) => (await request.get(path)).text()),
    );
    for (const text of outputs) {
      expect(text).not.toContain("GHSA-");
      expect(text).not.toContain(caseA);
      expect(text).not.toMatch(/sc_[A-Za-z0-9]{8}/u);
    }
  });
});

// This is UI evidence against real Pages/D1. The finalized snapshot is an
// explicit local fixture; payments.integration.ts proves the chain separately.
test("private settlement requires visibility consent and produces an unsigned request @registry", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const suffix = test.info().project.name.replace(/-chromium$/u, "");
  const id = `private-pay-${suffix}`;
  const repository = `e2e-security/${id}`;
  const deployment = {
    network: "base-sepolia",
    vault: "0x1000000000000000000000000000000000000001",
    asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    owner: "0x2000000000000000000000000000000000000002",
    identityAuthority: "0x3000000000000000000000000000000000000003",
    feeRecipient: "0x4000000000000000000000000000000000000004",
    factory: "0x5000000000000000000000000000000000000005",
    registrar: "0x6000000000000000000000000000000000000006",
    factoryCodeSha256: "cd".repeat(32),
    codeSha256: "ab".repeat(32),
    deploymentTransaction: `0x${"ab".repeat(32)}`,
    sourceCommit: "a".repeat(40),
    bindingDelaySeconds: "3600",
    rotationDelaySeconds: null,
    programId: null,
    projectPda: null,
    networkDomain: null,
    upgradeAuthority: null,
  };
  const terms = bountyTerms(repository, {
    rewardMode: "separate",
    amount: {
      currency: "USDC",
      decimals: 6,
      network: "base",
      grossMinor: "100000000",
    },
    settlement: {
      schemaVersion: "1",
      effectiveCycle: "2026-11",
      chain: "base",
      feeBasisPoints: 2500,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [deployment],
    },
  });
  await listProject(request, TOKENS.security, repository, id, {
    securityBounty: terms,
  });
  const revised = await revise(request, id, (m) => ({
    ...m,
    securityBounty: openTerms(terms),
  }));
  expect(revised.status, JSON.stringify(revised.body)).toBe(200);
  const caseId = await importCase(
    request,
    id,
    repository,
    "GHSA-2345-6789-cfgh",
    "reporter-a",
    new Date().toISOString(),
  );
  await vaultSnapshot(id, deployment, "100000000");
  expect(
    (await act(request, "security", caseId, "decide", decision())).status,
  ).toBe(200);
  expect((await award(request, "security", caseId, "100000000")).status).toBe(
    200,
  );
  expect(
    (
      await act(request, "finance", caseId, "prepare-payment", {
        network: "base-sepolia",
        confirmation: true,
      })
    ).body.error,
  ).toBe("payment_consent_required");
  const context = await browser.newContext({
    viewport: test.info().project.use.viewport,
    recordVideo: { dir: test.info().outputPath("settlement-video") },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  const errors = observe(page);
  await signIn(page, TOKENS["reporter-a"]);
  await page.goto("/security", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: new RegExp(`^${id} `) }).click();
  await page.getByText("Accept payment visibility", { exact: true }).click();
  await page
    .getByLabel(/^I understand that chain transactions reveal/u)
    .check();
  await page
    .getByRole("button", { name: "Accept visibility", exact: true })
    .click();
  // An old snapshot does not prove the vault still holds the award.
  await vaultSnapshot(
    id,
    deployment,
    "100000000",
    new Date(Date.now() - 31 * 60_000).toISOString(),
  );
  await expect
    .poll(
      async () =>
        (
          await act(request, "finance", caseId, "prepare-payment", {
            network: "base-sepolia",
            confirmation: true,
          })
        ).body.error,
    )
    .toBe("payment_vault_unverified");
  // A current finalized snapshot lets finance prepare the payment.
  await vaultSnapshot(id, deployment, "100000000");
  await signIn(page, TOKENS.finance);
  await page.goto("/security", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: new RegExp(`^${id} `) }).click();
  await page.getByText("Prepare private payment", { exact: true }).click();
  await page.getByLabel(/^I approve .* on this network/u).check();
  await page
    .getByRole("button", { name: "Prepare unsigned payment", exact: true })
    .click();
  await expect(page.locator(".security-case > .admin-facts")).toContainText(
    "Waiting for the vault owner",
  );
  await page.getByText("Unsigned owner request", { exact: true }).click();
  await page.getByRole("button", { name: "Copy unsigned request" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Request copied." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download unsigned request" }).focus();
  await page.keyboard.press("Enter");
  const file = await download;
  expect(file.suggestedFilename()).toBe("private-payment-request.json");
  await file.saveAs(test.info().outputPath("unsigned-request.json"));
  await expect(
    page.getByRole("status").filter({ hasText: "Request download started." }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("private-settlement.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("private-settlement-zoom.png"),
    fullPage: true,
  });
  // The existing site supports a minimum layout width of 320 CSS pixels.
  // At 200% on a 320px viewport it scrolls to that minimum; the request
  // must not expand the page beyond it.
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        Math.max(window.innerWidth, 640) + 1,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

/**
 * PRD section 10, Continuity: an approved award and its reservation stay
 * owed through role loss, an approver replacement, a quarantine, and a ban.
 * Case roles come from the current revision on each request, so a replaced
 * approver loses access at once, the new owner gets it, and the reporter
 * keeps the case. A restricted project takes no new reports and starts no
 * new award commitment (PRD section 11, Restricted projects).
 */
test("private bounty obligations continue through role loss, approver replacement, and a ban @registry", async ({
  request,
}) => {
  test.setTimeout(180_000);
  const suffix = test.info().project.name.replace(/-chromium$/u, "");
  const id = `bounty-move-${suffix}`;
  const repository = `e2e-security/${id}`;
  const deployment = bountyDeployment(repository);
  const terms = bountyTerms(repository);
  // Bounty-only needs no monthly pool: the application pledges $0.
  await listProject(request, TOKENS.security, repository, id, {
    reward: {
      ...(applicationManifest(id, repository).reward as object),
      monthlyCapMinor: "0",
      monthlyCapDisplay: "$0",
    },
    securityBounty: terms,
  });
  expect(
    (
      await revise(request, id, (m) => ({
        ...m,
        securityBounty: openTerms(terms),
      }))
    ).status,
  ).toBe(200);
  const caseId = await importCase(
    request,
    id,
    repository,
    "GHSA-4567-89cf-ghjm",
    "reporter-a",
    new Date().toISOString(),
  );
  await vaultSnapshot(id, deployment, "10000000000");
  expect(
    (await act(request, "security", caseId, "decide", decision())).status,
  ).toBe(200);
  expect((await award(request, "security", caseId, "10000000000")).status).toBe(
    200,
  );
  expect(
    (
      await act(
        request,
        "security",
        caseId,
        "assign-triager",
        account("triager"),
      )
    ).status,
  ).toBe(200);

  // A second confirmed finding that has no award yet.
  const pendingId = await importCase(
    request,
    id,
    repository,
    "GHSA-5678-9cfg-hjmp",
    "reporter-b",
    new Date().toISOString(),
  );
  expect(
    (
      await act(
        request,
        "security",
        pendingId,
        "decide",
        decision({ rootCauseKey: "vault-oracle-staleness" }),
      )
    ).status,
  ).toBe(200);

  const read = (role: Role) =>
    api(request, "GET", `security-cases/${caseId}`, TOKENS[role]);
  const listed = async (role: Role) =>
    (
      (await api(request, "GET", "security-cases", TOKENS[role])).body
        .cases as { id: string }[]
    ).some((entry) => entry.id === caseId);
  // The obligation: the decision, the award, and its reservation.
  const obligation = (body: Record<string, unknown>) => {
    const view = body.case as Record<string, unknown>;
    return {
      receiptState: view.receiptState,
      awardState: view.awardState,
      award: view.award,
      reservation: view.reservation,
    };
  };
  const owed = obligation((await read("security")).body);
  expect(owed).toMatchObject({
    receiptState: "confirmed",
    awardState: "approved",
    award: {
      grossMinor: "10000000000",
      researcherMinor: "7500000000",
      slopMinor: "2500000000",
    },
    reservation: {
      rootCauseKey: "vault-share-rounding",
      grossMinor: "10000000000",
    },
  });
  // The reporter sees the award; reservations stay internal.
  const reporterOwed = { ...owed, reservation: undefined };
  const reporterStart = (await read("reporter-a")).body.case as Record<
    string,
    unknown
  >;
  expect(obligation({ case: reporterStart })).toEqual(reporterOwed);
  expect(reporterStart).toMatchObject({
    awardState: "approved",
    allowedActions: expect.arrayContaining(["consent-payment"]),
  });
  expect((await read("finance")).status).toBe(200);
  expect((await read("security-b")).status).toBe(404);

  await test.step("a revision that replaces the approvers moves access at once", async () => {
    const before = (await read("security")).body.case as { revision: number };
    const transferred = await revise(request, id, (m) => ({
      ...m,
      securityBounty: {
        ...(m.securityBounty as Record<string, unknown>),
        approvers: {
          technical: [account("security-b")],
          financial: [account("security-b")],
          dispute: [account("dispute")],
        },
      },
    }));
    expect(transferred.status, JSON.stringify(transferred.body)).toBe(200);
    // The replaced technical and financial approvers lose every route.
    for (const role of ["security", "finance"] as const) {
      expect((await read(role)).status, `${role} reads`).toBe(404);
      expect(await listed(role), `${role} lists`).toBe(false);
    }
    expect(
      (
        await act(
          request,
          "security",
          caseId,
          "remediation",
          {
            remediationState: "resolved",
            evidenceReference: "private exact-head test log 2",
          },
          before.revision,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await act(
          request,
          "finance",
          caseId,
          "prepare-payment",
          { network: deployment.network, confirmation: true },
          before.revision,
        )
      ).status,
    ).toBe(404);
    // The new owner holds both roles and the same obligation.
    const owner = await read("security-b");
    expect(owner.status).toBe(200);
    expect(owner.body.case).toMatchObject({
      viewerRoles: ["financial", "security-maintainer"],
      allowedActions: expect.arrayContaining(["prepare-payment"]),
    });
    expect(obligation(owner.body)).toEqual(owed);
    expect(await listed("security-b")).toBe(true);
    // A transfer is not a change to the case: its revision did not move.
    expect((owner.body.case as { revision: number }).revision).toBe(
      before.revision,
    );
    // The reporter keeps the case and the award.
    expect(obligation((await read("reporter-a")).body)).toEqual(reporterOwed);
    // The new owner controls who else reads the case.
    expect(
      (
        await act(request, "security-b", caseId, "revoke-triager", {
          githubId: account("triager").githubId,
        })
      ).status,
    ).toBe(200);
    expect((await read("triager")).status).toBe(404);
  });

  const enforce = async (action: "quarantine" | "ban") => {
    const project = (await adminProject(request, id)) as unknown as {
      revision: number;
      enforcement: { nextSequence: number };
    };
    return api(
      request,
      "POST",
      `admin/projects/${id}/enforcement`,
      ADMIN_TOKEN,
      {
        action,
        reason: `Synthetic ${action} for the continuity check`,
        evidenceReference: `private moderation note E2E-${action}`,
        expectedRevision: project.revision,
        expectedSequence: project.enforcement.nextSequence,
      },
    );
  };

  for (const action of ["quarantine", "ban"] as const) {
    await test.step(`a ${action} stops new reports and keeps the obligation`, async () => {
      const restricted = await enforce(action);
      expect(restricted.status, JSON.stringify(restricted.body)).toBe(200);
      const manifest = (await adminProject(request, id)).manifest;
      expect(manifest).toMatchObject({
        status: "paused",
        listingTier: "retired",
      });
      // No new report enters a restricted program, and there is no
      // public fallback.
      const readiness = await api(
        request,
        "GET",
        `security-programs/${id}/intake?after=${action}`,
        null,
      );
      expect(readiness.status).toBe(404);
      expect(
        (
          await api(request, "POST", "security-cases", TOKENS["security-b"], {
            mode: "import",
            projectId: id,
          })
        ).status,
      ).toBe(404);
      // The reporter and the current owner keep the case and its award;
      // the replaced approvers stay out.
      expect(obligation((await read("reporter-a")).body)).toEqual(reporterOwed);
      expect(obligation((await read("security-b")).body)).toEqual(owed);
      expect((await read("security")).status).toBe(404);
      expect((await read("finance")).status).toBe(404);
      // Funds cover a second award, but no new commitment starts.
      await vaultSnapshot(id, deployment, "20000000000");
      const refused = await award(
        request,
        "security-b",
        pendingId,
        "10000000000",
      );
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body.error).toBe("program_restricted");
    });
  }

  await test.step("the banned program still pays the owed award", async () => {
    expect(
      (
        await act(request, "reporter-a", caseId, "consent-payment", {
          network: deployment.network,
          confirmation: true,
        })
      ).status,
    ).toBe(200);
    await vaultSnapshot(id, deployment, "10000000000");
    const prepared = await act(
      request,
      "security-b",
      caseId,
      "prepare-payment",
      { network: deployment.network, confirmation: true },
    );
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
    // An unsigned owner request only: nothing is paid.
    expect(prepared.body.case).toMatchObject({
      awardState: "approved",
      reservation: owed.reservation,
    });
    expect(prepared.body.case).not.toMatchObject({ paymentState: "paid" });
  });
});

/**
 * Automatic private intake (PRD section 8 "Private reporting is automatic",
 * SEC-07, SEC-17). Runs only with SLOP_E2E_PRIVATE_INTAKE=1, which turns on
 * the intake bindings against the loopback GitHub fixture; the default
 * registry lane keeps intake off and the manual path above.
 */
test("automatic private intake files as the reporter and verifies receipt @registry @private-intake", async ({
  browser,
  request,
}) => {
  test.skip(
    process.env.SLOP_E2E_PRIVATE_INTAKE !== "1",
    "Automatic intake bindings are off in this lane",
  );
  test.setTimeout(240_000);
  const suffix = test.info().project.name.replace(/-chromium$/u, "");
  const program = {
    id: `bounty-intake-${suffix}`,
    repository: `e2e-security/bounty-intake-${suffix}`,
  };
  const sentinel = `E2E-PRIVATE-SENTINEL-${suffix}`;
  const report = {
    summary: `Vault withdraw skips the owner check ${sentinel}`,
    description: `A crafted proof drains the vault on a local fork. ${sentinel}`,
    cvssVectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
  };
  const origin = new URL(test.info().project.use.baseURL ?? "").origin;
  // Cookies are carried by hand: the grant cookie is path-scoped and Secure.
  const jar = new Map<string, string>([[COOKIE, TOKENS["reporter-a"]]]);
  const remember = (headers: { name: string; value: string }[]) => {
    for (const header of headers) {
      if (header.name.toLowerCase() !== "set-cookie") continue;
      for (const line of header.value.split("\n")) {
        const [pair, ...attributes] = line.split(";");
        const name = pair.slice(0, pair.indexOf("=")).trim();
        if (attributes.some((part) => part.trim() === "Max-Age=0"))
          jar.delete(name);
        else jar.set(name, pair.slice(pair.indexOf("=") + 1));
      }
    }
  };
  const intakeApi = async (
    method: "GET" | "POST",
    path: string,
    data?: unknown,
  ): Promise<Reply> => {
    const response = await request.fetch(`/api/v1/${path}`, {
      method,
      maxRedirects: 0,
      headers: {
        cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
        ...(method === "GET" ? {} : { origin }),
      },
      ...(data === undefined ? {} : { data }),
    });
    remember(response.headersArray());
    const text = await response.text();
    return { status: response.status(), body: text ? JSON.parse(text) : {} };
  };
  /** Creates a submission and completes the fixture's GitHub consent. */
  const authorized = async () => {
    const created = await intakeApi("POST", "security-submissions", {
      projectId: program.id,
      idempotencyKey: key(),
      origin: "slop",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const github = await request.fetch(String(created.body.authorizeUrl), {
      maxRedirects: 0,
    });
    expect(github.status()).toBe(302);
    const callback = new URL(github.headers().location as string);
    const returned = await request.fetch(
      `${callback.pathname}${callback.search}`,
      {
        maxRedirects: 0,
        headers: {
          cookie: [...jar]
            .filter(([name]) => name !== COOKIE)
            .map(([name, value]) => `${name}=${value}`)
            .join("; "),
        },
      },
    );
    expect(returned.status()).toBe(303);
    remember(returned.headersArray());
    expect(jar.has("__Secure-slop_intake_grant")).toBe(true);
    return created.body.submission as { id: string; revision: number };
  };
  const advisoryCount = async () =>
    (
      (await (
        await request.fetch(
          `${GITHUB_FIXTURE}/__fixture/advisories/${program.repository}/count`,
        )
      ).json()) as { count: number }
    ).count;

  await test.step("program setup with the intake app installed", async () => {
    await listProject(
      request,
      TOKENS.security,
      program.repository,
      program.id,
      {
        reward: {
          ...(applicationManifest(program.id, program.repository)
            .reward as object),
          monthlyCapMinor: "0",
          monthlyCapDisplay: "$0",
        },
        securityBounty: bountyTerms(program.repository),
      },
    );
    const opened = await revise(request, program.id, (m) => ({
      ...m,
      securityBounty: openTerms(m.securityBounty as Record<string, unknown>),
    }));
    expect(opened.status).toBe(200);
    // The bounty vault holds one published award of finalized free funds.
    await vaultSnapshot(
      program.id,
      bountyDeployment(program.repository),
      "10000000000",
    );
    await setIntake(request, program.repository, "enabled");
    const installed = await request.fetch(
      `${GITHUB_FIXTURE}/__fixture/intake-app/${program.repository}/installed`,
      { method: "PUT" },
    );
    expect(installed.status()).toBe(204);
    const readiness = await api(
      request,
      "GET",
      `security-programs/${program.id}/intake?installed=1`,
      null,
    );
    expect(readiness.body).toMatchObject({
      state: "ready",
      automatic: "ready",
    });
  });

  await test.step("the program page offers the private form with consent", async () => {
    const context = await browser.newContext({
      viewport: test.info().project.use.viewport,
      recordVideo: { dir: test.info().outputPath("workflow-video") },
    });
    const page = await context.newPage();
    const errors = observe(page);
    await signIn(page, TOKENS["reporter-a"]);
    await page.clock.install();
    await page.goto(`/projects/${program.id}/security`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByText(
        "The Slop private intake app will file this on GitHub as @e2e-reporter-a",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Authorize GitHub to submit as you" }),
    ).toBeVisible();
    await expect(page.getByText("Slop stores no report text.")).toBeVisible();
    await expectAccessible(page);
    // An expired readiness answer keeps the form and the typed draft.
    const summary = page.getByRole("textbox", { name: "Summary" });
    const description = page.getByRole("textbox", { name: "Description" });
    await summary.fill("Draft survives readiness expiry");
    await description.fill("Typed before the readiness answer expired.");
    await page.clock.fastForward(31_000);
    await expect(page.getByRole("alert")).toContainText("is out of date");
    await expect(page.getByRole("alert")).toContainText("Your draft is kept");
    await expect(
      page.getByRole("link", { name: /Or report directly on GitHub/u }),
    ).toHaveCount(0);
    await expect(summary).toHaveValue("Draft survives readiness expiry");
    await expect(description).toHaveValue(
      "Typed before the readiness answer expired.",
    );
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(
      page.getByRole("link", { name: /Or report directly on GitHub/u }),
    ).toBeVisible();
    await expect(summary).toHaveValue("Draft survives readiness expiry");
    expect(errors).toEqual([]);
    await context.close();
  });

  let firstCase = "";
  let secondCase = "";
  await test.step("a private report reaches a verified receipt", async () => {
    const submission = await authorized();
    const before = await advisoryCount();
    const sent = await intakeApi(
      "POST",
      `security-submissions/${submission.id}/send`,
      { expectedRevision: submission.revision, report },
    );
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.submission).toMatchObject({ state: "receipt-verified" });
    expect(JSON.stringify(sent.body)).not.toContain(sentinel);
    expect(await advisoryCount()).toBe(before + 1);
    const caseId = (sent.body.submission as { caseId: string }).caseId;
    firstCase = caseId;
    const mine = await api(
      request,
      "GET",
      `security-cases/${caseId}`,
      TOKENS["reporter-a"],
    );
    expect(mine.body.case).toMatchObject({
      receivedAtSource: "github-verified",
      view: "reporter",
      // The automatic analysis never shows in fields the reporter sees.
      nextStep: "Waiting for the project owner's response.",
    });
    // The maintainer's case needs no link check, only triage.
    const maintainer = await api(
      request,
      "GET",
      `security-cases/${caseId}`,
      TOKENS.security,
    );
    expect(maintainer.body.case).toMatchObject({
      submissionState: "verified",
      receivedAtSource: "github-verified",
      nextStep:
        "Review the report and the AI summary, then decide or ask the reporter for information.",
    });
    expect(
      (maintainer.body.case as { allowedActions: string[] }).allowedActions,
    ).not.toContain("verify-link");
  });

  await test.step("an interrupted send is reconciled to one advisory", async () => {
    const submission = await authorized();
    const before = await advisoryCount();
    const fault = await request.fetch(
      `${GITHUB_FIXTURE}/__fixture/advisories/create/timeout-after-create`,
      { method: "PUT" },
    );
    expect(fault.status()).toBe(204);
    const sent = await intakeApi(
      "POST",
      `security-submissions/${submission.id}/send`,
      { expectedRevision: submission.revision, report },
    );
    expect(sent.body.submission).toMatchObject({ state: "uncertain" });
    const resend = await intakeApi(
      "POST",
      `security-submissions/${submission.id}/send`,
      {
        expectedRevision: (sent.body.submission as { revision: number })
          .revision,
        report,
      },
    );
    expect(resend.body.error).toBe("reconcile_required");
    const reconciled = await intakeApi(
      "POST",
      `security-submissions/${submission.id}/reconcile`,
      {
        expectedRevision: (sent.body.submission as { revision: number })
          .revision,
      },
    );
    expect(reconciled.body.submission).toMatchObject({
      state: "receipt-verified",
    });
    expect(await advisoryCount()).toBe(before + 1);
    secondCase = (reconciled.body.submission as { caseId: string }).caseId;
  });

  await test.step("the owner triages with the private AI summary and decides a funds-checked 75/25 award", async () => {
    const ownerCase = async (id: string) =>
      (await api(request, "GET", `security-cases/${id}`, TOKENS.security)).body
        .case as {
        analysis: { state: string; summary: string | null } | null;
        awardState: string;
        award: Record<string, string> | null;
        reservation: { grossMinor: string } | null;
      };
    // The analysis runs after the receipt response; wait for its proposal.
    for (const id of [firstCase, secondCase])
      await expect
        .poll(async () => (await ownerCase(id)).analysis?.state, {
          timeout: 30_000,
        })
        .toBe("complete");
    // Only the configured provider read the report text; D1 and every case
    // view keep the proposal, never the report.
    const provider = (await (
      await request.fetch(
        `${GITHUB_FIXTURE}/__fixture/analysis/requests?containing=${sentinel}`,
      )
    ).json()) as { count: number; containing: number };
    expect(provider.containing).toBeGreaterThanOrEqual(2);
    for (const role of ["security", "reporter-a", "finance"] as const) {
      const view = await api(
        request,
        "GET",
        `security-cases/${firstCase}`,
        TOKENS[role],
      );
      expect(JSON.stringify(view.body)).not.toContain(sentinel);
    }
    // Severity and loss are guidance, not eligibility: a high finding with
    // unverified loss can still be awarded at the owner's discretion.
    expect(
      (
        await act(
          request,
          "security",
          firstCase,
          "decide",
          decision({
            severity: "high",
            loss: "not-verified",
            rootCauseKey: "vault-withdraw-owner-check",
          }),
        )
      ).status,
    ).toBe(200);
    expect(await ownerCase(firstCase)).toMatchObject({
      awardState: "pending",
      reservation: null,
    });
    const context = await browser.newContext({
      viewport: test.info().project.use.viewport,
      recordVideo: { dir: test.info().outputPath("private-award-video") },
    });
    const page = await context.newPage();
    const errors = observe(page);
    await signIn(page, TOKENS.security);
    await page.goto("/security", { waitUntil: "networkidle" });
    const ghsa = (
      (
        await api(
          request,
          "GET",
          `security-cases/${firstCase}`,
          TOKENS.security,
        )
      ).body.case as { advisory: { ghsa: string } }
    ).advisory.ghsa;
    await page
      .getByRole("button", { name: new RegExp(`^${program.id} ${ghsa} `) })
      .click();
    const detail = page.locator(".security-case");
    await expect(detail).toContainText("AI summary");
    await expect(detail).toContainText(
      "Fixture proposal: the withdraw path skips the owner check",
    );
    await expect(detail).toContainText("Likely path to loss of funds");
    await expect(detail).toContainText(
      "Next step: Choose an award amount or no award.",
    );
    const form = page.getByRole("form", { name: "Award" });
    await form.getByLabel("Gross award (USDC)").fill("4000");
    await expect(form.getByRole("status")).toHaveText(
      "Researcher 3,000 USDC · Slop 1,000 USDC",
    );
    const deadline = new Date(Date.now() + 14 * 86_400_000)
      .toISOString()
      .slice(0, 16);
    await form.getByLabel("Payment deadline (UTC)").fill(deadline);
    await form.getByLabel(/^I approve this award for @e2e-reporter-a/u).check();
    await form
      .getByLabel("Private reason")
      .fill("Owner award for the confirmed synthetic vault finding.");
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("private-award-form.png"),
      fullPage: true,
    });
    await form.getByRole("button", { name: "Record award decision" }).click();
    await expect(page.getByRole("status").first()).toContainText(
      "Award: saved.",
    );
    await expect(detail).toContainText(
      "3,000 USDC to the researcher · 1,000 USDC to Slop · 4,000 USDC gross",
    );
    expect(errors).toEqual([]);
    await context.close();
    // Approval reserved exactly the chosen gross amount.
    expect(await ownerCase(firstCase)).toMatchObject({
      awardState: "approved",
      award: {
        grossMinor: "4000000000",
        researcherMinor: "3000000000",
        slopMinor: "1000000000",
      },
      reservation: { grossMinor: "4000000000" },
    });
    // The vault's finalized free balance is 10,000 USDC; 6,000 USDC is left,
    // so a larger second award reserves nothing.
    expect(
      (
        await act(
          request,
          "security",
          secondCase,
          "decide",
          decision({ rootCauseKey: "vault-withdraw-second-path" }),
        )
      ).status,
    ).toBe(200);
    const short = await award(request, "security", secondCase, "8000000000");
    expect(short.status).toBe(409);
    expect(short.body.error).toBe("insufficient_funds");
    expect(await ownerCase(secondCase)).toMatchObject({
      awardState: "pending",
      reservation: null,
    });
    // The reporter sees the receipt, the response and the 75/25 payout only.
    const reporter = await api(
      request,
      "GET",
      `security-cases/${firstCase}`,
      TOKENS["reporter-a"],
    );
    expect(reporter.body.case).toMatchObject({
      view: "reporter",
      awardState: "approved",
      award: { researcherMinor: "3000000000", slopMinor: "1000000000" },
      // The program has a reviewed private payment rail; the reporter acts next.
      nextStep:
        "Accept payment visibility so the payer can prepare your payment.",
    });
    expect(reporter.body.case).not.toHaveProperty("analysis");
    expect(reporter.body.case).not.toHaveProperty("rootCauseKey");
    const finance = await api(
      request,
      "GET",
      `security-cases/${firstCase}`,
      TOKENS.finance,
    );
    expect(finance.body.case).toMatchObject({ view: "financial" });
    expect(finance.body.case).not.toHaveProperty("analysis");
  });

  await test.step("without the app the automatic path is refused, never public", async () => {
    await request.fetch(
      `${GITHUB_FIXTURE}/__fixture/intake-app/${program.repository}/missing`,
      { method: "PUT" },
    );
    const readiness = await api(
      request,
      "GET",
      `security-programs/${program.id}/intake?installed=0`,
      null,
    );
    expect(readiness.body).toMatchObject({
      state: "ready",
      automatic: "app-not-installed",
    });
    const refused = await intakeApi("POST", "security-submissions", {
      projectId: program.id,
      idempotencyKey: key(),
      origin: "slop",
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("intake_unavailable");
    // Public outputs carry no report content.
    for (const path of [
      `/projects/${program.id}/terms.json`,
      "/api/v1/projects",
    ]) {
      const response = await request.get(path);
      expect(await response.text()).not.toContain(sentinel);
    }
  });
});
