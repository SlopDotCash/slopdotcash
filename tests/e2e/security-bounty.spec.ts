/**
 * Private security bounty programs end to end (PRD section 8, SEC-01 to
 * SEC-18, the MVP-13 matrix rows that can run locally). It runs on the
 * shipped build with the real Pages Functions, a fresh local D1 with every
 * migration, seeded sessions for each role, and the loopback GitHub API
 * fixture for the private-reporting readiness check and the private reports
 * that verify receipt. All findings and advisories are synthetic. Nothing
 * here reaches GitHub, a model provider, a chain, or an email provider.
 */
import type { APIRequestContext, Locator, Page, Route } from "@playwright/test";
import { HISTORICAL_PROJECTS } from "../../src/lib/projects.mjs";
import type { SecurityBountyTerms } from "../../src/lib/security-bounty.mjs";
import {
  E2E_SECURITY_ACCOUNTS,
  fixtureRepository,
} from "../github-api-fixture.mjs";
import { applicationManifest } from "../project-application-manifest";
import {
  CANCELED,
  expect,
  expectAccessible,
  openProjectSecuritySettings,
  projectSuffix,
  test,
} from "./fixtures";

type Role = keyof typeof E2E_SECURITY_ACCOUNTS;
const TOKENS = JSON.parse(
  process.env.SLOP_E2E_SECURITY_TOKENS ?? "{}",
) as Record<Role, string>;
const ADMIN_TOKEN = process.env.SLOP_E2E_ADMIN_TOKEN ?? "";
const APPLICANT_TOKEN = process.env.SLOP_E2E_APPLICANT_TOKEN ?? "";
const GITHUB_FIXTURE = process.env.SLOP_E2E_GITHUB_API_ORIGIN ?? "";
const COOKIE = "__Host-slop_points";

test.describe.configure({ mode: "serial" });

// The points and payments APIs reject this local origin; only application
// failures count.
test.beforeEach(({ diagnostics }) => {
  diagnostics.allow(
    /^(?:console .* at |403 GET )http:\/\/[^ ]+\/api\/v1\/(?:points|payments)\//u,
  );
  diagnostics.allowCanceledBackgroundReads();
});

async function openPrivateDelivery(page: Page) {
  const options = page.locator(".security-intake-card > details");
  await expect(options).toBeVisible();
  await expect(
    options.getByText("Loading private reporting status…", { exact: true }),
  ).toHaveCount(0);
  if ((await options.getAttribute("open")) === null)
    await options.locator("summary").click();
}

async function chooseCaseAction(
  scope: Page | Locator,
  action: string | { label: string },
) {
  await scope
    .locator(".security-action")
    .first()
    .waitFor({ state: "attached" });
  const selector = scope.getByRole("combobox", {
    name: "Action",
    exact: true,
    includeHidden: true,
  });
  if (
    typeof action === "string" &&
    (await scope.locator(`[data-case-action-selector="${action}"]`).count())
  )
    await scope.locator(`[data-case-action-selector="${action}"]`).click();
  else if (await selector.count()) {
    if (!(await selector.isVisible()))
      await scope.getByText("Other case actions", { exact: true }).click();
    await selector.selectOption(action);
  } else if (typeof action === "string")
    await expect(
      scope.locator(`form[data-case-action="${action}"]`),
    ).toBeVisible();
  else
    await expect(
      scope.getByRole("form", { name: action.label, exact: true }),
    ).toBeVisible();
}

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

/** The steward and authority claim for a fixture repository's owner. */
function ownership(repository: string) {
  const facts = fixtureRepository(repository);
  return {
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
  };
}

async function installSlopbot(repository: string) {
  const installed = await fetch(
    `${GITHUB_FIXTURE}/__fixture/slopbot/${repository}/installed`,
    { method: "PUT" },
  );
  expect(installed.status).toBe(204);
}

/** Creates a paused project through the owner self-service API. */
async function listProject(
  request: APIRequestContext,
  applicantToken: string,
  repository: string,
  id: string,
  overrides: Record<string, unknown>,
) {
  const manifest = applicationManifest(id, repository, {
    ...ownership(repository),
    ...overrides,
  });
  // Creation reads the account's access through the Slopbot installation.
  await installSlopbot(repository);
  const program = manifest.securityBounty as SecurityBountyTerms | undefined;
  const creatorRole = (Object.keys(TOKENS) as Role[]).find(
    (role) => TOKENS[role] === applicantToken,
  );
  if (program && !creatorRole) throw new Error("Unknown fixture creator");
  const creator = creatorRole ? account(creatorRole) : undefined;
  const applied = await api(request, "POST", "projects", applicantToken, {
    manifest: program?.settlement
      ? {
          ...manifest,
          securityBounty: {
            ...program,
            sponsor: { ...program.sponsor, githubId: creator?.githubId },
            approvers: {
              technical: [creator],
              financial: [creator],
              dispute: [creator],
            },
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

async function signIn(page: Page, token: string) {
  await page.goto("/how-it-works", { waitUntil: "networkidle" });
  await page.evaluate(
    ([name, value]) => {
      document.cookie = `${name}=${value}; Path=/; Secure; SameSite=Strict`;
    },
    [COOKIE, token],
  );
}

async function refreshReporting(request: APIRequestContext) {
  const endpoint = process.env.SLOP_E2E_REPORTING_REFRESH;
  expect(endpoint).toBeTruthy();
  const response = await request.post(endpoint as string);
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.checked).toBeGreaterThan(0);
  return result;
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
  await refreshReporting(request);
}

/**
 * An outsider who tries to open the program, with the stored manifest and
 * with its own Slopbot-installed repository in every repository field, gets
 * only the authority refusal. The answer never depends on the vault's funds.
 */
async function expectOutsiderRefused(
  request: APIRequestContext,
  id: string,
  repository: string,
) {
  const own = `e2e-reporter-a/${id}-claim`;
  await installSlopbot(own);
  const claimed = applicationManifest(id, own, ownership(own));
  for (const claim of [false, true]) {
    const stored = await adminProject(request, id);
    const program = {
      ...(stored.manifest.securityBounty as object),
      status: "open",
    };
    const outsider = await api(
      request,
      "PUT",
      `projects/${id}`,
      TOKENS["reporter-a"],
      {
        expectedRevision: stored.revision,
        manifest: claim
          ? {
              ...stored.manifest,
              repositories: claimed.repositories,
              steward: claimed.steward,
              authority: claimed.authority,
              securityBounty: JSON.parse(
                JSON.stringify(program).replaceAll(
                  `"${repository}"`,
                  `"${own}"`,
                ),
              ),
            }
          : { ...stored.manifest, securityBounty: program },
      },
    );
    expect(outsider.status, JSON.stringify(outsider.body)).toBe(403);
    expect(outsider.body.error).toBe("authority_required");
  }
}

test("maintainers can verify or reject a manually linked private report @registry", async ({
  page,
  request,
}) => {
  const id = `manual-report-${projectSuffix()}`;
  const repository = `e2e-security/${id}`;
  await listProject(request, TOKENS.security, repository, id, {});
  const claims = [];
  for (const advisory of ["GHSA-2c3f-4g5h-6j7m", "GHSA-3c4f-5g6h-7j8m"]) {
    const claimed = await api(
      request,
      "POST",
      "security-cases",
      TOKENS["reporter-a"],
      {
        mode: "claim",
        projectId: id,
        advisory,
        idempotencyKey: key(),
      },
    );
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(201);
    claims.push((claimed.body.case as { id: string }).id);
  }
  await signIn(page, TOKENS.security);
  await page.goto("/security", { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: new RegExp(`${id} GHSA-2c3f-4g5h-6j7m`) })
    .click();
  const detail = page.locator(`[aria-labelledby="case-${claims[0]}"]`);
  await chooseCaseAction(detail, "verify-link");
  const verify = detail.getByRole("form", { name: "Verify the GitHub report" });
  await expect(
    verify.getByRole("button", { name: "Verify report", exact: true }),
  ).toBeVisible();
  const receivedAt = new Date(Date.now() - 60_000).toISOString().slice(0, 16);
  await verify
    .getByLabel("Time GitHub received the report (UTC)")
    .fill(receivedAt);
  await verify.getByRole("checkbox").check();
  await verify
    .getByRole("button", { name: "Verify report", exact: true })
    .click();
  await expect(
    detail
      .getByRole("status")
      .filter({ hasText: "Verify the GitHub report: saved." }),
  ).toBeVisible();
  const verified = await api(
    request,
    "GET",
    `security-cases/${claims[0]}`,
    TOKENS.security,
  );
  expect(verified.body.case).toMatchObject({
    submissionState: "verified",
    receivedAt: `${receivedAt}:00.000Z`,
    receivedAtSource: "maintainer-attested",
  });

  await page
    .getByRole("button", { name: "Back to reports", exact: true })
    .click();
  await page
    .getByRole("button", { name: new RegExp(`${id} GHSA-3c4f-5g6h-7j8m`) })
    .click();
  const rejectedDetail = page.locator(`[aria-labelledby="case-${claims[1]}"]`);
  await chooseCaseAction(rejectedDetail, "reject-link");
  const reject = rejectedDetail.getByRole("form", { name: "Reject this link" });
  const reason = "The advisory does not identify this account as the reporter.";
  await reject.getByLabel("Private reason").fill(reason);
  await expect(reject.getByLabel("Private reason")).toHaveValue(reason);
  await reject
    .getByRole("button", { name: "Reject link", exact: true })
    .click();
  await expect(
    rejectedDetail
      .getByRole("status")
      .filter({ hasText: "Reject this link: saved." }),
  ).toBeVisible();
  const rejected = await api(
    request,
    "GET",
    `security-cases/${claims[1]}`,
    TOKENS.security,
  );
  expect(rejected.body.case).toMatchObject({
    submissionState: "link-rejected",
  });
  await expectAccessible(page);
  await page.screenshot({
    path: test.info().outputPath("manual-report-decision.png"),
    fullPage: true,
  });
});

test("owners publish and control bounty programs with verified funding @registry", async ({
  browser,
  diagnostics,
  request,
}) => {
  test.setTimeout(180_000);
  const suffix = projectSuffix();
  const id = `owner-bounty-${suffix}`;
  const repository = `e2e-security/${id}`;
  await listProject(request, TOKENS.security, repository, id, {});
  const context = await browser.newContext({
    viewport: test.info().project.use.viewport,
    recordVideo: { dir: test.info().outputPath("owner-bounty-video") },
  });
  const page = await context.newPage();
  try {
    await signIn(page, TOKENS.security);
    await page.goto(`/projects/${id}/manage`, { waitUntil: "networkidle" });
    await openProjectSecuritySettings(page);
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
    for (const group of [
      "Scope and testing",
      "Award criteria",
      "Researcher terms",
    ])
      await page.locator("summary").filter({ hasText: group }).click();
    for (const [label, value] of Object.entries(values))
      await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "Review bounty terms" }).click();
    await expect(
      page.getByRole("heading", { name: "Review before publishing" }),
    ).toBeVisible();
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
    // An account without repository access gets the authority refusal,
    // never the funding answer, even when it sends its own repository.
    await expectOutsiderRefused(request, id, repository);
    // Owners manage their own contacts without a Slop admin queue.
    const originalProgram = stored.manifest
      .securityBounty as SecurityBountyTerms;
    const contacts = await api(
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
            approvers: {
              technical: [account("reporter-a")],
              financial: [account("reporter-a")],
              dispute: [account("reporter-a")],
            },
          },
        },
      },
    );
    expect.soft(contacts.status, JSON.stringify(contacts.body)).toBe(200);
    if (contacts.status === 200) {
      stored = await adminProject(request, id);
      expect(stored.manifest.securityBounty).toMatchObject({
        approvers: { technical: [account("reporter-a")] },
      });
      // A repository admin can also manage contacts, without being the
      // recorded steward or a Slop admin.
      const permission = (level: string) =>
        fetch(
          `${GITHUB_FIXTURE}/__fixture/slopbot/${repository}/permission/e2e-reporter-b/${level}`,
          { method: "PUT" },
        );
      expect((await permission("admin")).status).toBe(204);
      try {
        const restored = await api(
          request,
          "PUT",
          `projects/${id}`,
          TOKENS["reporter-b"],
          {
            expectedRevision: stored.revision,
            manifest: {
              ...stored.manifest,
              securityBounty: {
                ...(stored.manifest.securityBounty as object),
                approvers: originalProgram.approvers,
              },
            },
          },
        );
        expect(restored.status, JSON.stringify(restored.body)).toBe(200);
      } finally {
        expect((await permission("none")).status).toBe(204);
      }
    }
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
    // The refusal is the same when the vault has available funds.
    await expectOutsiderRefused(request, id, repository);
    await page.reload({ waitUntil: "networkidle" });
    await openProjectSecuritySettings(page);
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
    await page.getByRole("button", { name: "Review bounty terms" }).click();
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
    await page.getByLabel("Status", { exact: true }).selectOption("closed");
    await page.getByRole("button", { name: "Review bounty terms" }).click();
    await page.getByRole("button", { name: "Publish bounty terms" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: `Published revision ${stored.revision + 1}.` }),
    ).toBeVisible();
    expect(
      (await adminProject(request, id)).manifest.securityBounty,
    ).toMatchObject({ status: "closed" });
    // Moving these controls to the public Security workspace grants no
    // authority to another signed-in reader, even with a funded vault.
    const beforeRefusal = await adminProject(request, id);
    diagnostics.allowResponse(403, "GET", `/api/v1/project-setup/${id}`);
    diagnostics.allowResponse(
      403,
      "GET",
      `/api/v1/project-setup/${id}?attempt=0`,
    );
    await signIn(page, TOKENS["reporter-b"]);
    await page.goto(`/projects/${id}/security#security-settings`, {
      waitUntil: "networkidle",
    });
    await openProjectSecuritySettings(page);
    await expect(page.getByRole("alert")).toContainText(
      /access|authority|permission/iu,
    );
    await expect(
      page.getByRole("region", { name: "Bounty funds" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Status", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Publish bounty terms" }),
    ).toHaveCount(0);
    const refused = await api(
      request,
      "PUT",
      `projects/${id}`,
      TOKENS["reporter-b"],
      {
        expectedRevision: beforeRefusal.revision,
        manifest: {
          ...beforeRefusal.manifest,
          securityBounty: {
            ...(beforeRefusal.manifest.securityBounty as object),
            status: "paused",
          },
        },
      },
    );
    expect(refused.status).toBe(403);
    const afterRefusal = await adminProject(request, id);
    expect(afterRefusal.revision).toBe(beforeRefusal.revision);
    expect(afterRefusal.manifest.securityBounty).toEqual(
      beforeRefusal.manifest.securityBounty,
    );
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("nonowner-security-settings-refused.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test("private security bounty programs keep cases restricted from intake to award @registry", async ({
  browser,
  diagnostics,
  request,
}) => {
  test.setTimeout(300_000);
  const suffix = projectSuffix();
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

  // Opening a program now fetches and caches readiness automatically. Set the
  // disabled fixture before any page visit so the later handoff assertion
  // does not race a previously cached enabled response.
  await setIntake(request, b.repository, "disabled");

  await test.step("intake readiness gates the GitHub handoff", async () => {
    // Each program page here makes that program's first readiness read, so no
    // cached edge answer is waited out. The stale and ready transitions of
    // the reporting observation are covered in
    // backend/security/submissions.test.ts.
    const context = await browser.newContext({
      viewport: test.info().project.use.viewport,
      recordVideo: { dir: test.info().outputPath("workflow-video") },
    });
    const page = await context.newPage();
    await page.clock.install();
    // The page checks readiness on open; no click is needed.
    await page.goto(`/projects/${a.id}/security`);
    await openPrivateDelivery(page);
    const handoff = page.getByRole("link", {
      name: /^(Or report directly|Report privately) on GitHub$/u,
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
    await page.goto(`/projects/${b.id}/security`);
    await openPrivateDelivery(page);
    await expect(page.getByRole("alert")).toContainText(
      "private vulnerability reporting is turned off",
    );
    await expect(
      page.getByRole("link", { name: "Report privately on GitHub" }),
    ).toHaveCount(0);
    // A removed App makes the last verified observation stale. Program C is
    // new, so its first read shows what the background refresh recorded.
    const c = {
      id: `bounty-c-${suffix}`,
      repository: `e2e-security/bounty-c-${suffix}`,
    };
    await listProject(request, TOKENS.security, c.repository, c.id, {
      reward: {
        ...(applicationManifest(c.id, c.repository).reward as object),
        monthlyCapMinor: "0",
        monthlyCapDisplay: "$0",
      },
      securityBounty: bountyTerms(c.repository),
    });
    expect(
      (
        await revise(request, c.id, (m) => ({
          ...m,
          securityBounty: openTerms(
            m.securityBounty as Record<string, unknown>,
          ),
        }))
      ).status,
    ).toBe(200);
    await refreshReporting(request);
    expect(
      (
        await request.fetch(
          `${GITHUB_FIXTURE}/__fixture/intake-app/${c.repository}/missing`,
          { method: "PUT" },
        )
      ).status(),
    ).toBe(204);
    await refreshReporting(request);
    await page.goto(`/projects/${c.id}/security`);
    await openPrivateDelivery(page);
    await expect(page.getByRole("alert")).toContainText("is out of date");
    await expect(handoff).toHaveCount(0);
    await context.close();
    for (const state of ["forbidden", "unavailable"]) {
      await setIntake(request, b.repository, state);
      const checked = await api(
        request,
        "GET",
        `security-programs/${b.id}/intake?state=${state}`,
        null,
      );
      expect(checked.body).toMatchObject({
        state: "disabled",
        stale: true,
        handoffUrl: null,
      });
    }
  });

  await test.step("public terms and amounts", async () => {
    const context = await browser.newContext({
      viewport: test.info().project.use.viewport,
      recordVideo: { dir: test.info().outputPath("workflow-video") },
    });
    const page = await context.newPage();
    // Production retains historical registry rows. Keep the published ledger's
    // registry alongside this test's new D1 projects, which take precedence.
    await page.route("**/api/v1/projects", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const currentIds = new Set(
        body.projects.map((project: { id: string }) => project.id),
      );
      await route.fulfill({
        response,
        json: {
          ...body,
          projects: [
            ...HISTORICAL_PROJECTS.filter(
              (project) => !currentIds.has(project.id),
            ),
            ...body.projects,
          ],
        },
      });
    });
    await page.goto(`/projects/${a.id}/security`);
    await expect(page.locator(".route-page-header .route-lead")).toHaveText(
      "10,000 USDC security bounty",
    );
    await page.getByText("Full award terms", { exact: true }).click();
    const offer = page.getByRole("region", { name: "Published bounty offer" });
    await expect(offer).toContainText("7,500 USDC to the researcher");
    await expect(offer).toContainText(
      "10,000 USDC total award · 2,500 USDC to Slop",
    );
    const facts = page.getByRole("region", { name: "Award terms" });
    await expect(facts).toContainText("Researcher · 75%7,500 USDC");
    await expect(facts).toContainText("Awards are discretionary.");
    await expect(facts).toContainText("Slop · 25%2,500 USDC");
    await expect(facts).toContainText("Bounty only.");
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("program-terms.png"),
      fullPage: true,
    });
    await page.goto(`/projects/${b.id}/security`);
    await expect(page.locator(".route-page-header .route-lead")).toContainText(
      "100,000 USDC security bounty",
    );
    await page.getByText("Full award terms", { exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Published bounty offer" }),
    ).toContainText("75,000 USDC to the researcher");
    const split = page.getByRole("region", { name: "Award split" });
    await expect(split).toContainText("Researcher · 75%75,000 USDC");
    await expect(split).toContainText("Slop · 25%25,000 USDC");
    // Finish the overview background reads before explicitly closing this context.
    // Strict diagnostics must still catch unexpected request cancellations.
    await page.goto(`/projects/${a.id}`, { waitUntil: "networkidle" });
    await expect(
      page.getByText("Loading records…", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Data could not load.", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      `Project ${a.id}`,
    );
    await expect(page.locator(".project-reward-status")).toContainText(
      "per critical vulnerability",
    );
    await context.close();
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
    // A write collaborator cannot name an outside approver, nor remove the
    // recorded ones: approvers read every private case of the program.
    const permission = (level: string) =>
      fetch(
        `${GITHUB_FIXTURE}/__fixture/slopbot/${a.repository}/permission/e2e-reporter-b/${level}`,
        { method: "PUT" },
      );
    expect((await permission("write")).status).toBe(204);
    try {
      const current = await adminProject(request, a.id);
      const program = current.manifest.securityBounty as SecurityBountyTerms;
      for (const approvers of [
        {
          ...program.approvers,
          technical: [...program.approvers.technical, account("reporter-b")],
        },
        {
          technical: [account("reporter-b")],
          financial: [account("reporter-b")],
          dispute: [account("reporter-b")],
        },
      ]) {
        const reply = await api(
          request,
          "PUT",
          `projects/${a.id}`,
          TOKENS["reporter-b"],
          {
            expectedRevision: current.revision,
            manifest: {
              ...current.manifest,
              securityBounty: { ...program, approvers },
            },
          },
        );
        expect(reply.status, JSON.stringify(reply.body)).toBe(422);
        expect(reply.body.error).toBe("security_contacts_restricted");
      }
      expect((await adminProject(request, a.id)).revision).toBe(
        current.revision,
      );
      expect((await read("reporter-b", caseA)).status).toBe(404);
    } finally {
      expect((await permission("none")).status).toBe(204);
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
    await signIn(page, TOKENS.dispute);
    await page.goto("/security", { waitUntil: "networkidle" });
    await page
      .getByRole("button", {
        name: new RegExp(`${b.id} GHSA-8c9f-2g3h-4j5m`, "u"),
      })
      .click();
    const detail = page.locator(`[aria-labelledby="case-${declared}"]`);
    await expect(detail).toContainText("Waiting for an independent reviewer");
    await expect(detail).toContainText("Received by GitHub");
    await chooseCaseAction(detail, { label: "Related-party award review" });
    const form = detail.getByRole("form", {
      name: "Related-party award review",
    });
    await form.getByLabel("Outcome").selectOption("approve");
    await form
      .getByLabel("Private reason")
      .fill("The reporter has no control over the payer or the decision.");
    await form.getByRole("button", { name: "Record review" }).click();
    await expect(
      detail
        .getByRole("status")
        .filter({ hasText: "Related-party award review: saved." }),
    ).toBeVisible();
    await expect(detail).toContainText("Approved by an independent reviewer");
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("related-party-review.png"),
      fullPage: true,
    });
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
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Security notice acknowledged." }),
    ).toBeVisible();
    await expect(
      page.getByText("Acknowledged", { exact: true }).first(),
    ).toBeVisible();
    await page.reload();
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
    // The disclosure step cancels no request.
    const canceled = diagnostics.count(CANCELED);
    const page = await context.newPage();
    await signIn(page, TOKENS.security);
    await page.goto("/security", { waitUntil: "networkidle" });
    await page
      .getByRole("button", {
        name: new RegExp(`${a.id} GHSA-2c3f-4g5h-6j7m`, "u"),
      })
      .click();
    await chooseCaseAction(page.getByRole("region", { name: "Case actions" }), {
      label: "Disclosure",
    });
    const form = page.getByRole("form", { name: "Disclosure", exact: true });
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
    await expect(
      page
        .locator(`[aria-labelledby="case-${caseA}"]`)
        .getByRole("status")
        .filter({ hasText: "Disclosure: saved." }),
    ).toBeVisible();
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
    expect(diagnostics.count(CANCELED)).toBe(canceled);
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
    await chooseCaseAction(detail, "recognition");
    await detail.getByLabel("Show my name publicly").selectOption("opt-in");
    await detail.getByRole("button", { name: "Save my choice" }).click();
    await expect(
      detail
        .getByRole("status")
        .filter({ hasText: "Public recognition: saved." }),
    ).toBeVisible();
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("reporter-case.png"),
      fullPage: true,
    });
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
  const suffix = projectSuffix();
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
  await signIn(page, TOKENS["reporter-a"]);
  await page.goto("/security", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: new RegExp(`^${id} `) }).click();
  await chooseCaseAction(
    page.getByRole("region", { name: "Case actions" }),
    "consent-payment",
  );
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
  await chooseCaseAction(
    page.getByRole("region", { name: "Case actions" }),
    "prepare-payment",
  );
  await page.getByLabel(/^I approve .* on this network/u).check();
  await page
    .getByRole("button", { name: "Prepare unsigned payment", exact: true })
    .click();
  await expect(page.locator(".security-case > .admin-facts")).toContainText(
    "Waiting for the vault owner",
  );
  await page.getByText("Case details and history", { exact: true }).click();
  await page.getByRole("button", { name: "Copy case ID" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    caseId,
  );
  await page.getByText("Case details and history", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Unsigned owner request", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy unsigned request" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Request copied." }),
  ).toBeVisible();
  // The Windows clipboard stores line breaks as CRLF, so Chromium reads the
  // copied request back with "\r\n".
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).replaceAll(
      "\r\n",
      "\n",
    ),
  ).toBe(
    await page
      .getByRole("textbox", { name: "Unsigned transaction request" })
      .inputValue(),
  );
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
  await expectAccessible(page, { everyRule: true });
  await page.screenshot({
    path: test.info().outputPath("private-settlement.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expectAccessible(page, { everyRule: true });
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
  const suffix = projectSuffix();
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

test("admin placement and explicit bounty type drive generic project pages @registry", async ({
  page,
  request,
}) => {
  const id = `home-bounty-${projectSuffix()}`;
  const repository = `e2e-security/${id}`;
  await listProject(request, TOKENS.security, repository, id, {});
  const base = (await adminProject(request, id)).manifest;
  const terms = bountyTerms(repository);
  const project = {
    ...base,
    name: "Security test program",
    status: "active",
    listingTier: "featured",
    reward: {
      ...(base.reward as object),
      monthlyCapMinor: "0",
      monthlyCapDisplay: "$0",
    },
    securityBounty: {
      ...terms,
      status: "open",
      fundingPolicy: "after-approval",
      capacity: { ...(terms.capacity as object), awards: null },
    },
  };
  const closed = {
    ...project,
    status: "paused",
    securityBounty: { ...project.securityBounty, status: "closed" },
  };
  let shown: Record<string, unknown> = project;
  // One public project at a time: first verify its published open state.
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "1",
        projects: [shown],
        restrictions: [],
      },
    }),
  );
  await page.goto("/", { waitUntil: "networkidle" });
  const section = page.getByRole("region", {
    name: "Security bounties",
    exact: true,
  });
  await expect(section.locator(".project-card")).toHaveCount(1);
  const featured = page.locator('[aria-labelledby="featured-projects"]');
  await expect(featured.locator(".project-card")).toHaveCount(1);
  await expect(featured).toContainText("$10k");
  await expect(featured).toContainText("Pledged");
  await expect(featured).not.toContainText("Points only");
  await expect(section).toContainText("$10k");
  await expect(section).not.toContainText("7,500 USDC");
  await expect(
    page.getByRole("link", { name: "Your private reports", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#community-projects")).toHaveCount(0);
  const link = section.getByRole("link").filter({
    has: page.getByRole("heading", {
      name: "Security test program",
      exact: true,
    }),
  });
  await expect(link).toHaveAttribute("href", `/projects/${id}`);
  await link.focus();
  await expect(link).toBeFocused();
  await expectAccessible(page);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.screenshot({
    path: test.info().outputPath("home-security-bounty.png"),
    fullPage: true,
  });
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expectAccessible(page);
  }
  await link.click();
  await expect(
    page.getByRole("heading", {
      name: "Security test program",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Copy this into your agent." }),
  ).toBeVisible();
  await expect(
    page.getByText("Points only · no cash rewards", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Payment history" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("No activity collected yet.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Report malicious code in this project", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Full award terms", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("region", { name: "Published bounty offer" }),
  ).toHaveCount(0);
  await expectAccessible(page);
  await page
    .getByRole("link", { name: "Report privately", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/security$`));
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    new RegExp(`/projects/${id}/security$`),
  );
  await expect(
    page.getByRole("heading", { name: "Private report", exact: true }),
  ).toBeVisible();

  // Clearing Featured moves the same bounty to Community without changing its offer.
  shown = { ...project, listingTier: "community" };
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(featured).toHaveCount(0);
  const community = page.locator(".community-projects");
  const row = community.locator(`a[href="/projects/${id}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("$10k / Critical");
  await expect(row).toContainText("Pledged");
  await expect(row).not.toContainText("Points only");

  // Zero ordinary cash does not silently convert a separate bounty into a bounty-only project.
  shown = {
    ...project,
    listingTier: "community",
    securityBounty: { ...project.securityBounty, rewardMode: "separate" },
  };
  await page.reload({ waitUntil: "networkidle" });
  await expect(row).toContainText("Points only");
  await expect(section.locator(".project-card")).toHaveAttribute(
    "href",
    `/projects/${id}/security`,
  );
  const ordinarySnapshot = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/data/leaderboard.json",
  );
  await row.click();
  await (await ordinarySnapshot).finished();
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByLabel("Agent prompt", { exact: true }),
  ).not.toContainText("private security reporting");
  await expect(
    page.getByText("Checking project clearance…", { exact: true }),
  ).toHaveCount(0);

  shown = closed;
  await page.goto("/", { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await expect(section.locator(".project-card")).toHaveCount(0);
  await expect(section).toContainText("No paid security bounties are open.");
});

test("Slop receives a private report before GitHub and keeps it in Inbox @registry @private-intake", async ({
  browser,
  request,
  diagnostics,
}) => {
  test.skip(
    process.env.SLOP_E2E_PRIVATE_INTAKE !== "1",
    "Durable private intake is not activated in this lane",
  );
  test.setTimeout(180_000);
  diagnostics.allow(/net::ERR_FAILED.*security-submissions/u);
  // Independent viewport journeys use distinct seeded reporters. The real
  // same-actor workload cap remains covered by the API integration cases.
  const reporterRole = test.info().project.name.endsWith("-mobile")
    ? "reporter-b"
    : "reporter-a";
  const otherReporterRole =
    reporterRole === "reporter-a" ? "reporter-b" : "reporter-a";
  const reporterToken = TOKENS[reporterRole];
  const otherReporterToken = TOKENS[otherReporterRole];
  const suffix = projectSuffix();
  const id = `slop-report-${suffix}`;
  // Researchers can report without maintainer setup permission.
  diagnostics.allowResponse(403, "GET", `/api/v1/project-setup/${id}`);
  const repository = `e2e-security/${id}`;
  const summary = `Local vault authorization failure ${suffix}`;
  const description = `At the reviewed local revision, withdrawing without the owner check can transfer another account's deposit. Reproduce in an isolated test chain with a funded fixture account; no production funds are moved. Private marker ${suffix}.`;
  await listProject(request, TOKENS.security, repository, id, {});
  await setIntake(request, repository, "disabled");
  const context = await browser.newContext({
    viewport: test.info().project.use.viewport,
    recordVideo: { dir: test.info().outputPath("slop-report-video") },
  });
  const page = await context.newPage();
  const privateReads: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      /^\/api\/v1\/security-submissions\/ss_[A-Za-z0-9_-]+$/u.test(
        new URL(request.url()).pathname,
      )
    )
      privateReads.push(request.url());
  });
  try {
    await signIn(page, reporterToken);
    await page.goto(`/projects/${id}/security`, { waitUntil: "networkidle" });
    await expect(
      page.getByText("No published bounty terms, so no award is promised."),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Summary", exact: true })
      .fill(summary);
    await page
      .getByRole("textbox", { name: /^Description/u })
      .fill(description);
    page.once("dialog", (dialog) => dialog.accept());
    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.getByRole("textbox", { name: "Summary", exact: true }),
    ).toHaveValue(summary);
    await expect(
      page.getByRole("textbox", { name: /^Description/u }),
    ).toHaveValue(description);
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await page.screenshot({
      path: test.info().outputPath("slop-report-before.png"),
      fullPage: true,
    });
    const attempts: unknown[] = [];
    let interrupted = false;
    await page.route("**/api/v1/security-submissions", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      attempts.push(route.request().postDataJSON());
      if (!interrupted) {
        interrupted = true;
        // Persist the real report, then lose only its response.
        const accepted = await route.fetch();
        expect(accepted.status()).toBe(201);
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .getByRole("button", { name: "Review report", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Review your private report" }),
    ).toBeFocused();
    await expect(page.locator(".report-preview")).toHaveText(description);
    await page
      .getByRole("button", { name: "Submit private report", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry same report" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit report" })).toHaveCount(
      0,
    );
    page.once("dialog", (dialog) => dialog.accept());
    await page.reload({ waitUntil: "networkidle" });
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/security-submissions",
    );
    await page.getByRole("button", { name: "Retry same report" }).click();
    const response = await created;
    expect(response.status()).toBe(200);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    const payload = response.request().postDataJSON();
    await expect(page).toHaveURL(
      /\/inbox\?view=reports&submission=ss_[A-Za-z0-9_-]+$/u,
    );
    const submissionId = new URL(page.url()).searchParams.get(
      "submission",
    ) as string;
    const ownList = await api(
      request,
      "GET",
      "security-submissions",
      reporterToken,
    );
    expect(ownList.status).toBe(200);
    const submitted = (
      ownList.body.submissions as {
        id: string;
        caseId: string;
        intake: { receivedAt: string };
      }[]
    ).find((entry) => entry.id === submissionId);
    expect(submitted).toBeDefined();
    const result = { submission: submitted as NonNullable<typeof submitted> };
    expect(result.submission.caseId).toMatch(/^sc_/u);
    expect(result.submission.intake.receivedAt).toBeTruthy();
    expect(JSON.stringify(ownList.body)).not.toContain(description);
    const report = page.locator(
      `[aria-labelledby="submission-${submissionId}"]`,
    );
    await expect(page.locator(".security-report-text")).toHaveCount(0);
    await expect(page.getByText(description, { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Case actions" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Notifications", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Link or import a GitHub report", { exact: true }),
    ).toHaveCount(0);
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("slop-report-inbox-compact.png"),
      fullPage: true,
    });
    expect(privateReads).toHaveLength(0);
    // Keep the real stored report and its authorization route. Hide just its
    // row from the recent projection, as the API does after 100 newer receipts.
    // The API regression separately creates all 101 receipts with real migrations.
    const withoutFocusedReceipt = async (route: Route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.submissions = body.submissions.filter(
        (entry: { id: string }) => entry.id !== submissionId,
      );
      await route.fulfill({ response, json: body });
    };
    await page.route("**/api/v1/security-submissions", withoutFocusedReceipt);
    await page.reload({ waitUntil: "networkidle" });
    await expect(report).toHaveClass(/is-focused/u);
    expect(privateReads.length).toBeGreaterThan(0);
    expect(
      privateReads.every(
        (url) => new URL(url).searchParams.get("view") === "receipt",
      ),
    ).toBe(true);
    await expect(page.locator(".security-report-text")).toHaveCount(0);
    await page.unroute("**/api/v1/security-submissions", withoutFocusedReceipt);
    const missingReceipt = "ss_missing_receipt_fixture";
    diagnostics.allowResponse(
      404,
      "GET",
      `/api/v1/security-submissions/${missingReceipt}?view=receipt`,
    );
    await page.goto(`/inbox?view=reports&submission=${missingReceipt}`, {
      waitUntil: "networkidle",
    });
    await expect(report).toBeVisible();
    await expect(
      page.getByText(/Report status could not refresh/),
    ).toBeVisible();
    // A stale link must report its error even when this account has no reports.
    await signIn(page, APPLICANT_TOKEN);
    await page.goto(`/inbox?view=reports&submission=${missingReceipt}`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByText(/Report status could not refresh/),
    ).toBeVisible();
    await expect(
      page.getByText("You have no private reports yet."),
    ).toHaveCount(0);
    await signIn(page, reporterToken);
    await page.goto(`/inbox?view=reports&submission=${submissionId}`, {
      waitUntil: "networkidle",
    });
    await report
      .getByRole("button", { name: "Open case", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      new RegExp(
        `/inbox\\?view=reports&submission=${submissionId}&case=${result.submission.caseId}$`,
        "u",
      ),
    );
    await report.getByText("Read private report", { exact: true }).click();
    await expect(report.getByRole("heading", { level: 4 })).toHaveText(summary);
    await expect(report.locator(".security-report-text")).toHaveText(
      description,
    );
    // Collapsing report content must not hide the case's next action or award state.
    const reportDisclosure = report.locator(":scope > details > summary");
    await reportDisclosure.click();
    await expect(report.locator(".private-report-next")).toBeVisible();
    await expect(
      report.getByRole("button", { name: "Open case", exact: true }),
    ).toBeVisible();
    await expect(report.locator(".security-report-text")).not.toBeVisible();
    await reportDisclosure.click();
    expect(result.submission).toMatchObject({ state: "draft", advisory: null });
    // Model a request/worker ending after persisting intake but before the
    // queued or running attempt can finish. Recovery uses the retained bytes.
    for (const state of ["queued", "running"] as const) {
      const persist = process.env.SLOP_E2E_PERSIST_TO;
      expect(persist).toBeTruthy();
      expect(submissionId).toMatch(/^ss_[A-Za-z0-9_-]+$/u);
      const { execFileSync } = await import("node:child_process");
      const stale = new Date(Date.now() - 16 * 60 * 1000).toISOString();
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
          `UPDATE security_submission_intake SET screening_state='${state}',screening_started_at='${stale}',screening_finished_at=NULL,screening_reason=NULL,routed_at=NULL,revision=revision+1 WHERE submission_id='${submissionId}'`,
        ],
        { stdio: "pipe" },
      );
      await page.reload({ waitUntil: "networkidle" });
      await report.getByText("Read private report", { exact: true }).click();
      await expect(report.locator(".security-report-text")).toHaveText(
        description,
      );
      const retry = report.getByRole("button", {
        name: "Retry screening",
        exact: true,
      });
      await expect(retry).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath(`recovery-${state}.png`),
        fullPage: true,
      });
      await retry.focus();
      const retried = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/api/v1/security-submissions/${submissionId}/screen`,
      );
      await page.keyboard.press("Enter");
      const retryResponse = await retried;
      expect(retryResponse.status()).toBe(200);
      await expect
        .poll(async () => {
          const refreshed = await api(
            request,
            "GET",
            `security-submissions/${submissionId}`,
            reporterToken,
          );
          return (refreshed.body.submission as { intake: { state: string } })
            .intake.state;
        })
        .toBe("legitimate");
      await page
        .getByRole("button", { name: "Refresh reports", exact: true })
        .click();
      await expect(retry).not.toBeVisible();
      await expect(report.locator(".security-report-text")).toHaveText(
        description,
      );
    }
    await expectAccessible(page);
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await page.screenshot({
      path: test.info().outputPath("slop-report-inbox.png"),
      fullPage: true,
    });
    if ((page.viewportSize()?.width ?? 0) >= 640) {
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await expectAccessible(page);
      await page.screenshot({
        path: test.info().outputPath("slop-report-inbox-zoom.png"),
        fullPage: true,
      });
    }
    await page.reload({ waitUntil: "networkidle" });
    await report.getByText("Read private report", { exact: true }).click();
    await expect(report.locator(".security-report-text")).toHaveText(
      description,
    );
    await page.goto(`/inbox?submission=${submissionId}`, {
      waitUntil: "networkidle",
    });
    await expect(page.locator(".security-report-text")).toHaveCount(0);
    await expect(
      page.locator(`[aria-labelledby="submission-${submissionId}"]`),
    ).toHaveCount(1);
    await page.screenshot({
      path: test.info().outputPath("slop-report-inbox-final.png"),
      fullPage: true,
    });
    const replay = await api(
      request,
      "POST",
      "security-submissions",
      reporterToken,
      payload,
    );
    expect(replay.status).toBe(200);
    expect((replay.body.submission as { id: string }).id).toBe(submissionId);
    const privateRead = await api(
      request,
      "GET",
      `security-submissions/${submissionId}`,
      otherReporterToken,
    );
    expect(privateRead.status).toBe(404);
    const caseReply = await api(
      request,
      "GET",
      `security-cases/${result.submission.caseId}`,
      reporterToken,
    );
    expect(caseReply.body.case).toMatchObject({
      receivedAtSource: "slop-received",
      advisory: null,
    });
    for (const path of ["/api/v1/projects", `/api/v1/projects/${id}`, "/"]) {
      const publicText = await (await request.get(path)).text();
      expect(publicText).not.toContain(description);
      expect(publicText).not.toContain(submissionId);
    }
  } finally {
    await context.close();
  }
});

/**
 * Automatic private intake (PRD section 8 "Private reporting is automatic",
 * SEC-07, SEC-17). Runs only with SLOP_E2E_PRIVATE_INTAKE=1, which turns on
 * the intake bindings against the loopback GitHub fixture; the default
 * registry lane keeps intake off and the manual path above.
 */
test("Slop-first intake preserves private GitHub forwarding and reconciliation @registry @private-intake", async ({
  browser,
  request,
  diagnostics,
}) => {
  test.skip(
    process.env.SLOP_E2E_PRIVATE_INTAKE !== "1",
    "Automatic intake bindings are off in this lane",
  );
  test.setTimeout(240_000);
  // Independent viewport journeys use distinct seeded reporters. The real
  // same-actor workload cap remains covered by the API integration cases.
  const reporterRole = test.info().project.name.endsWith("-mobile")
    ? "reporter-b"
    : "reporter-a";
  const otherReporterRole =
    reporterRole === "reporter-a" ? "reporter-b" : "reporter-a";
  const reporterToken = TOKENS[reporterRole];
  const otherReporterToken = TOKENS[otherReporterRole];
  const suffix = projectSuffix();
  const program = {
    id: `bounty-intake-${suffix}`,
    repository: `e2e-security/bounty-intake-${suffix}`,
  };
  const otherProgram = {
    id: `bounty-intake-other-${suffix}`,
    repository: `e2e-security/bounty-intake-other-${suffix}`,
  };
  const noProgram = {
    id: `report-only-${suffix}`,
    repository: `e2e-security/report-only-${suffix}`,
  };
  // Private reporters do not need maintainer setup permission.
  diagnostics.allowResponse(
    403,
    "GET",
    `/api/v1/project-setup/${noProgram.id}`,
  );
  const sentinel = `E2E-PRIVATE-SENTINEL-${suffix}`;
  const report = {
    summary: `Vault withdraw skips the owner check ${sentinel}`,
    description: `A crafted proof drains the vault on a local fork. ${sentinel}`,
    cvssVectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
  };
  const origin = new URL(test.info().project.use.baseURL ?? "").origin;
  // Cookies are carried by hand: the grant cookie is path-scoped and Secure.
  const jar = new Map<string, string>([[COOKIE, reporterToken]]);
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
  /** Stores the report, obtains owner routing review, then completes GitHub consent. */
  const authorized = async (projectId = program.id) => {
    const created = await intakeApi("POST", "security-submissions", {
      projectId,
      idempotencyKey: key(),
      origin: "slop",
      report,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const stored = created.body.submission as {
      id: string;
      revision: number;
      caseId: string;
      intake: { receivedAt: string };
    };
    expect(stored.caseId).toMatch(/^sc_/u);
    // The fixture does not qualify the model's screening judgment. A current
    // owner explicitly clears this synthetic report for private forwarding.
    await expect
      .poll(async () => {
        const view = await api(
          request,
          "GET",
          `security-submissions/${stored.id}`,
          TOKENS.security,
        );
        expect(view.status).toBe(200);
        const intake = (
          view.body.submission as {
            intake: { state: string; routingState: string };
          }
        ).intake;
        return intake.state === "legitimate" && intake.routingState !== "routed"
          ? "running"
          : intake.state;
      })
      .not.toMatch(/^(queued|running)$/u);
    const current = await api(
      request,
      "GET",
      `security-submissions/${stored.id}`,
      TOKENS.security,
    );
    const reviewable = current.body.submission as {
      intake: { revision: number };
    };
    const reviewed = await api(
      request,
      "POST",
      `security-submissions/${stored.id}/review`,
      TOKENS.security,
      {
        expectedRevision: reviewable.intake.revision,
        decision: "forward",
        reason:
          "The owner reviewed the isolated synthetic reproduction and approved private routing.",
      },
    );
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    expect(
      (reviewed.body.submission as { intake: { canForward: boolean } }).intake
        .canForward,
    ).toBe(true);
    const authorization = await intakeApi(
      "POST",
      `security-submissions/${stored.id}/authorize`,
      {},
    );
    expect(authorization.status, JSON.stringify(authorization.body)).toBe(200);
    const github = await request.fetch(
      String(authorization.body.authorizeUrl),
      {
        maxRedirects: 0,
      },
    );
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
    return stored;
  };
  const advisoryCount = async () =>
    (
      (await (
        await request.fetch(
          `${GITHUB_FIXTURE}/__fixture/advisories/${program.repository}/count`,
        )
      ).json()) as { count: number }
    ).count;

  for (const currentProgram of [program, otherProgram, noProgram]) {
    await test.step("program setup with the intake app installed", async () => {
      await listProject(
        request,
        TOKENS.security,
        currentProgram.repository,
        currentProgram.id,
        {
          reward: {
            ...(applicationManifest(
              currentProgram.id,
              currentProgram.repository,
            ).reward as object),
            monthlyCapMinor: "0",
            monthlyCapDisplay: "$0",
          },
          ...(currentProgram === noProgram
            ? {}
            : { securityBounty: bountyTerms(currentProgram.repository) }),
        },
      );
      if (currentProgram !== noProgram) {
        const opened = await revise(request, currentProgram.id, (m) => ({
          ...m,
          securityBounty: openTerms(
            m.securityBounty as Record<string, unknown>,
          ),
        }));
        expect(opened.status).toBe(200);
        // The bounty vault holds one published award of finalized free funds.
        await vaultSnapshot(
          currentProgram.id,
          bountyDeployment(currentProgram.repository),
          "10000000000",
        );
      }
      await setIntake(request, currentProgram.repository, "enabled");
      const installed = await request.fetch(
        `${GITHUB_FIXTURE}/__fixture/intake-app/${currentProgram.repository}/installed`,
        { method: "PUT" },
      );
      expect(installed.status()).toBe(204);
      await refreshReporting(request);
      const readiness = await api(
        request,
        "GET",
        `security-programs/${currentProgram.id}/intake?installed=1`,
        null,
      );
      expect(readiness.body).toMatchObject({
        state: "ready",
        automatic: "ready",
      });
    });
  }

  await test.step("a project without paid terms accepts a private report", async () => {
    const context = await browser.newContext({
      viewport: test.info().project.use.viewport,
      recordVideo: { dir: test.info().outputPath("report-only-video") },
    });
    const page = await context.newPage();
    try {
      await signIn(page, reporterToken);
      await setIntake(request, noProgram.repository, "unavailable");
      await page.goto(`/projects/${noProgram.id}/security`, {
        waitUntil: "networkidle",
      });
      await expect(
        page.getByRole("heading", {
          name: /^Report a security issue in /,
        }),
      ).toBeVisible();
      await expect(
        page.getByText("No published bounty terms, so no award is promised."),
      ).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Summary", exact: true }),
      ).toBeVisible();
      await expectAccessible(page);
      await page.screenshot({
        path: test.info().outputPath("report-only-intake.png"),
        fullPage: true,
      });
      await openPrivateDelivery(page);
      await expect(page.getByRole("alert")).toContainText("is out of date");
      // The effective layout of the native desktop review at 200% zoom.
      // Backward keyboard navigation must not hide focus under the header.
      const originalViewport = page.viewportSize();
      await page.setViewportSize({ width: 864, height: 498 });
      const retry = page.getByRole("button", {
        name: "Check again",
        exact: true,
      });
      await retry.focus();
      await expect(retry).toBeFocused();
      const focus = await retry.evaluate((element) => ({
        top: element.getBoundingClientRect().top,
        headerBottom: document
          .querySelector(".site-header")
          ?.getBoundingClientRect().bottom,
      }));
      expect(focus.headerBottom).toBeDefined();
      expect(focus.top).toBeGreaterThanOrEqual((focus.headerBottom ?? 0) + 6);
      await page.screenshot({
        path: test.info().outputPath("reporting-keyboard-focus.png"),
      });
      if (originalViewport) await page.setViewportSize(originalViewport);
      await setIntake(request, noProgram.repository, "enabled");
      // The page retains the stale observation; current authenticated intake
      // can still proceed once GitHub is available again.
      const submission = await authorized(noProgram.id);
      await setIntake(request, noProgram.repository, "disabled");
      const blockedForward = await intakeApi(
        "POST",
        `security-submissions/${submission.id}/send`,
        { expectedRevision: submission.revision },
      );
      expect(blockedForward.status).toBe(409);
      expect(blockedForward.body.error).toBe("intake_unavailable");
      const retained = await api(
        request,
        "GET",
        `security-submissions/${submission.id}`,
        reporterToken,
      );
      expect(retained.status).toBe(200);
      expect(retained.body.report).toMatchObject(report);
      expect(retained.body.submission).toMatchObject({
        state: "draft",
        advisory: null,
        caseId: submission.caseId,
      });
      await setIntake(request, noProgram.repository, "enabled");
      const unavailable = await request.fetch(
        `${GITHUB_FIXTURE}/__fixture/slopbot/${noProgram.repository}/unavailable`,
        { method: "PUT" },
      );
      expect(unavailable.status()).toBe(204);
      let sent = await intakeApi(
        "POST",
        `security-submissions/${submission.id}/send`,
        { expectedRevision: submission.revision },
      );
      expect(sent.status, JSON.stringify(sent.body)).toBe(202);
      expect(sent.body.submission).toMatchObject({ state: "submitted" });
      await installSlopbot(noProgram.repository);
      sent = await intakeApi(
        "POST",
        `security-submissions/${submission.id}/reconcile`,
        {
          expectedRevision: (sent.body.submission as { revision: number })
            .revision,
        },
      );
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      expect(sent.body.submission).toMatchObject({ state: "receipt-verified" });
      const caseId = (sent.body.submission as { caseId: string }).caseId;
      const own = await api(
        request,
        "GET",
        `security-cases/${caseId}`,
        reporterToken,
      );
      expect(own.body.case).toMatchObject({
        view: "reporter",
        submissionState: "verified",
        awardState: "not-applicable",
        paymentState: "not-applicable",
      });
      const maintainer = await api(
        request,
        "GET",
        `security-cases/${caseId}`,
        TOKENS.security,
      );
      expect(maintainer.status, JSON.stringify(maintainer.body)).toBe(200);
      expect(maintainer.body.case).toMatchObject({
        view: "restricted",
        terms: null,
      });
      expect(
        (
          await api(
            request,
            "GET",
            `security-cases/${caseId}`,
            otherReporterToken,
          )
        ).status,
      ).toBe(404);
      await page.goto("/security", { waitUntil: "networkidle" });
      const reportCard = page.locator(
        `[aria-labelledby="submission-${submission.id}"]`,
      );
      const choice = reportCard.getByRole("button", {
        name: "Open case",
        exact: true,
      });
      await expect(choice).toHaveCount(1);
      await choice.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.locator(`[aria-labelledby="case-${caseId}"]`),
      ).toBeVisible();
      await expectAccessible(page);
      await page.screenshot({
        path: test.info().outputPath("report-only-receipt.png"),
        fullPage: true,
      });
      await request.fetch(
        `${GITHUB_FIXTURE}/__fixture/slopbot/${noProgram.repository}/unavailable`,
        { method: "PUT" },
      );
      await page.reload();
      const reports = page.getByRole("region", {
        name: "Private reports",
        exact: true,
      });
      const decisions = page.getByRole("region", {
        name: "Decisions and payments",
        exact: true,
      });
      for (const section of [reports, decisions]) {
        await expect(
          section.getByText("Some maintainer access could not be checked.", {
            exact: false,
          }),
        ).toBeVisible();
      }
      await expect(
        reportCard.getByRole("button", { name: "Open case", exact: true }),
      ).toHaveCount(1);
      await page.screenshot({
        path: test.info().outputPath("report-only-partial-access.png"),
        fullPage: true,
      });
      await expectAccessible(page);
      await installSlopbot(noProgram.repository);
      for (const section of [reports, decisions]) {
        const retry = section.getByRole("button", {
          name: "Retry access check",
        });
        await retry.focus();
        await page.keyboard.press("Enter");
        await expect(retry).toHaveCount(0);
      }
      const revoked = await request.fetch(
        `${GITHUB_FIXTURE}/__fixture/slopbot/${noProgram.repository}/permission/e2e-security/read`,
        { method: "PUT" },
      );
      expect(revoked.status()).toBe(204);
      expect(
        (await api(request, "GET", `security-cases/${caseId}`, TOKENS.security))
          .status,
      ).toBe(404);
      expect(
        (await api(request, "GET", `security-cases/${caseId}`, reporterToken))
          .status,
      ).toBe(200);
    } finally {
      await context.close();
    }
  });

  await test.step("the program page offers the private form with consent", async () => {
    const context = await browser.newContext({
      viewport: test.info().project.use.viewport,
      recordVideo: { dir: test.info().outputPath("workflow-video") },
    });
    const page = await context.newPage();
    await signIn(page, reporterToken);
    await page.clock.install();
    await page.goto(`/projects/${program.id}/security`);
    await expect(
      page.getByText(`Draft kept in this tab for @e2e-${reporterRole}.`, {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review report", exact: true }),
    ).toBeVisible();
    await openPrivateDelivery(page);
    await expectAccessible(page);
    // An expired readiness answer keeps the form and the typed draft.
    const summary = page.getByRole("textbox", { name: "Summary" });
    const description = page.getByRole("textbox", { name: "Description" });
    await summary.fill("Draft survives readiness expiry");
    await description.fill("Typed before the readiness answer expired.");
    const classification = page.locator(".security-classification");
    await expect(classification).not.toHaveAttribute("open", "");
    await classification
      .getByText("Additional classification", { exact: false })
      .click();
    const severity = page.getByRole("combobox", {
      name: "Severity (optional)",
      exact: true,
    });
    const cvss = page.getByLabel(
      "CVSS vector (optional, instead of severity)",
      { exact: true },
    );
    await severity.selectOption("high");
    await cvss.fill(report.cvssVectorString);
    await expect(severity).toBeDisabled();
    await page
      .getByLabel("CWE IDs (optional)", { exact: true })
      .fill("CWE-284");
    await cvss.fill("");
    await severity.selectOption("");
    await page.getByLabel("CWE IDs (optional)", { exact: true }).fill("");
    await expect(classification).toHaveAttribute("open", "");
    await cvss.fill(report.cvssVectorString);
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
    await expect(cvss).toHaveValue(report.cvssVectorString);
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(
      page.getByRole("link", { name: /Or report directly on GitHub/u }),
    ).toBeVisible();
    await expect(summary).toHaveValue("Draft survives readiness expiry");
    await page.evaluate((path) => {
      history.pushState({}, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, `/projects/${otherProgram.id}/security`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      otherProgram.id,
    );
    await openPrivateDelivery(page);
    await expect(
      page.getByRole("link", { name: /Or report directly on GitHub/u }),
    ).toHaveAttribute("href", new RegExp(otherProgram.id));
    await expect(summary).toHaveValue("");
    await expect(description).toHaveValue("");
    await expect(cvss).toHaveValue("");
    await context.close();
  });

  let firstCase = "";
  let firstSubmission = "";
  let secondCase = "";
  await test.step("a private report reaches a verified receipt", async () => {
    const submission = await authorized();
    firstSubmission = submission.id;
    const before = await advisoryCount();
    const sent = await intakeApi(
      "POST",
      `security-submissions/${submission.id}/send`,
      { expectedRevision: submission.revision },
    );
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.submission).toMatchObject({ state: "receipt-verified" });
    expect(JSON.stringify(sent.body)).not.toContain(sentinel);
    expect(await advisoryCount()).toBe(before + 1);
    const caseId = (sent.body.submission as { caseId: string }).caseId;
    expect(caseId).toBe(submission.caseId);
    firstCase = caseId;
    const mine = await api(
      request,
      "GET",
      `security-cases/${caseId}`,
      reporterToken,
    );
    expect(mine.body.case).toMatchObject({
      receivedAtSource: "slop-received",
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
      receivedAtSource: "slop-received",
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
      { expectedRevision: submission.revision },
    );
    expect(sent.body.submission).toMatchObject({ state: "uncertain" });
    const resend = await intakeApi(
      "POST",
      `security-submissions/${submission.id}/send`,
      {
        expectedRevision: (sent.body.submission as { revision: number })
          .revision,
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
    expect(secondCase).toBe(submission.caseId);
  });

  await test.step("a GitHub rate limit reopens the draft instead of a refusal", async () => {
    const submission = await authorized();
    const before = await advisoryCount();
    const fault = await request.fetch(
      `${GITHUB_FIXTURE}/__fixture/advisories/create/secondary-rate-limit`,
      { method: "PUT" },
    );
    expect(fault.status()).toBe(204);
    const sent = await intakeApi(
      "POST",
      `security-submissions/${submission.id}/send`,
      { expectedRevision: submission.revision },
    );
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.submission).toMatchObject({
      state: "draft",
      failureCode: null,
      retryAllowed: true,
    });
    expect(sent.body.rateLimited).toEqual({ retryAfterSeconds: null });
    expect(await advisoryCount()).toBe(before);
    // The throttle cleared, so the next send needs no reconcile.
    const again = await intakeApi(
      "POST",
      `security-submissions/${submission.id}/send`,
      {
        expectedRevision: (sent.body.submission as { revision: number })
          .revision,
      },
    );
    expect(again.body.submission).toMatchObject({
      state: "receipt-verified",
    });
    expect(await advisoryCount()).toBe(before + 1);
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
    // The full technical analysis is separate from the intake routing screen.
    for (const id of [firstCase, secondCase]) {
      const analyzed = await act(request, "security", id, "analyze");
      expect(analyzed.status, JSON.stringify(analyzed.body)).toBe(200);
      await expect
        .poll(async () => (await ownerCase(id)).analysis?.state, {
          timeout: 30_000,
        })
        .toBe("complete");
    }
    // Only the configured provider read the report text; D1 and every case
    // view keep the proposal, never the report.
    const provider = (await (
      await request.fetch(
        `${GITHUB_FIXTURE}/__fixture/analysis/requests?containing=${sentinel}`,
      )
    ).json()) as { count: number; containing: number };
    expect(provider.containing).toBeGreaterThanOrEqual(2);
    for (const role of ["security", reporterRole, "finance"] as const) {
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
    await signIn(page, TOKENS.security);
    await page.goto("/security", { waitUntil: "networkidle" });
    await page
      .locator(`[aria-labelledby="submission-${firstSubmission}"]`)
      .getByRole("button", { name: "Open case", exact: true })
      .click();
    const detail = page.locator(`[aria-labelledby="case-${firstCase}"]`);
    await expect(detail).toContainText(
      "Fixture proposal: the withdraw path skips the owner check",
    );
    const actions = page.getByRole("region", { name: "Case actions" });
    await chooseCaseAction(actions, "award");
    await expect(actions.getByRole("form")).toHaveCount(1);
    const form = page.getByRole("form", { name: "Award" });
    await form.getByLabel("Gross award (USDC)").fill("4000");
    await chooseCaseAction(actions, "remediation");
    await expect(actions.getByRole("form")).toHaveCount(1);
    await chooseCaseAction(actions, "award");
    await expect(form.getByLabel("Gross award (USDC)")).toHaveValue("4000");
    await expect(form.getByRole("status")).toHaveText(
      "Researcher 3,000 USDC · Slop 1,000 USDC",
    );
    const deadline = new Date(Date.now() + 14 * 86_400_000)
      .toISOString()
      .slice(0, 16);
    await form.getByLabel("Payment deadline (UTC)").fill(deadline);
    await form
      .getByLabel(
        new RegExp(`^I approve this award for @e2e-${reporterRole}`, "u"),
      )
      .check();
    await form
      .getByLabel("Private reason")
      .fill("Owner award for the confirmed synthetic vault finding.");
    await expectAccessible(page);
    await page.screenshot({
      path: test.info().outputPath("private-award-form.png"),
      fullPage: true,
    });
    await form.getByRole("button", { name: "Record award decision" }).click();
    await expect(
      detail.getByRole("status").filter({ hasText: "Award: saved." }),
    ).toBeVisible();
    await expect(detail).toContainText(
      "3,000 USDC to the researcher · 1,000 USDC to Slop · 4,000 USDC gross",
    );
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
      reporterToken,
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

  await test.step("without the GitHub app Slop still receives reports privately", async () => {
    await request.fetch(
      `${GITHUB_FIXTURE}/__fixture/intake-app/${program.repository}/missing`,
      { method: "PUT" },
    );
    await refreshReporting(request);
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
    const before = await advisoryCount();
    const accepted = await intakeApi("POST", "security-submissions", {
      projectId: program.id,
      idempotencyKey: key(),
      origin: "slop",
      report,
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body.submission).toMatchObject({
      state: "draft",
      advisory: null,
      caseId: expect.stringMatching(/^sc_/u),
    });
    expect(accepted.body).not.toHaveProperty("authorizeUrl");
    expect(await advisoryCount()).toBe(before);
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

test("a registered Slop bounty vault keeps its split while the owner publishes terms @registry", async ({
  page,
  request,
}) => {
  const id = "slopdotcash";
  const repository = "SlopDotCash/slopdotcash";
  await installSlopbot(repository);
  const permission = await fetch(
    `${GITHUB_FIXTURE}/__fixture/slopbot/${repository}/permission/e2e-security/admin`,
    { method: "PUT" },
  );
  expect(permission.status).toBe(204);
  const terms = bountyTerms(repository, { rewardMode: "separate" });
  const prior = await adminProject(request, id);
  if (!prior)
    await listProject(request, TOKENS.security, repository, id, {
      securityBounty: terms,
    });
  const gross = prior ? "8000" : "9000";
  await signIn(page, TOKENS.security);
  await page.goto(`/projects/${id}/manage`, { waitUntil: "networkidle" });
  await openProjectSecuritySettings(page);
  await expect(page.getByRole("checkbox", { name: /full award/i })).toHaveCount(
    0,
  );
  await expect(page.locator(".security-program-editor")).toContainText(
    "USDC · Base",
  );
  await expect(
    page
      .locator(".security-program-editor")
      .getByRole("group", { name: "Asset", exact: true }),
  ).toHaveCount(0);
  await expectAccessible(page);
  await page.screenshot({
    path: test.info().outputPath("registered-vault-locked.png"),
    fullPage: true,
  });
  await page.getByLabel("Published gross award (USDC)").fill(gross);
  await page.getByRole("button", { name: "Review bounty terms" }).click();
  await expect(
    page.getByRole("heading", { name: "Review before publishing" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish bounty terms" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Published revision" }),
  ).toBeVisible();
  const stored = await adminProject(request, id);
  expect(stored.manifest.securityBounty).toMatchObject({
    amount: { grossMinor: `${gross}000000` },
    split: { researcherBasisPoints: 7500, slopBasisPoints: 2500 },
    settlement: terms.settlement,
  });
  await page.screenshot({
    path: test.info().outputPath("registered-vault-published.png"),
    fullPage: true,
  });
});

test("an owner preserves admin-approved full-award terms on any project @registry", async ({
  page,
  request,
}) => {
  const id = `full-award-${projectSuffix()}`;
  const repository = `e2e-security/${id}`;
  await listProject(request, TOKENS.security, repository, id, {});
  const terms = bountyTerms(repository, {
    rewardMode: "separate",
    status: "open",
    fundingPolicy: "after-approval",
    split: { researcherBasisPoints: 10000, slopBasisPoints: 0 },
    settlement: undefined,
    capacity: {
      awards: null,
      closesAt: null,
      exhaustionRule: "The sponsor funds each approved finding after review.",
    },
    sponsor: { name: "Independent project sponsor", githubId: null },
  });
  const approved = await revise(request, id, (manifest) => ({
    ...manifest,
    securityBounty: terms,
  }));
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  await signIn(page, TOKENS.security);
  await page.goto(`/projects/${id}/manage`, { waitUntil: "networkidle" });
  await openProjectSecuritySettings(page);
  await expect(page.getByRole("checkbox", { name: /full award/i })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Published gross award (USDC)")).toHaveValue(
    "10000",
  );
  await page.getByLabel("Published gross award (USDC)").fill("8000");
  await page.getByRole("button", { name: "Review bounty terms" }).click();
  await expect(
    page.getByRole("heading", { name: "Review before publishing" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Published bounty offer" }),
  ).toContainText("8,000 USDC to the researcher");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Publish bounty terms" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Published revision" }),
  ).toBeVisible();
  const saved = await adminProject(request, id);
  expect(saved.manifest.securityBounty).toMatchObject({
    split: { researcherBasisPoints: 10000, slopBasisPoints: 0 },
    amount: { grossMinor: "8000000000" },
    fundingPolicy: "after-approval",
    sponsor: { name: "Independent project sponsor", githubId: null },
  });
  expect(
    (saved.manifest.securityBounty as Record<string, unknown>).settlement,
  ).toBeUndefined();
  await page.screenshot({
    path: test.info().outputPath("generic-full-award-preserved.png"),
    fullPage: true,
  });
});
