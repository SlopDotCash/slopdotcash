import { webCrypto, sha256Hex } from "@repo/platform/crypto";
import { pointRevisionId } from "@repo/points/client";
import { REPORT_DEPOSIT_SWITCHED_ON, SECURITY_DEFAULT_EXCLUSIONS, SECURITY_ROUTINE_DECISION_NOTICE, reportDepositItem, reportDepositOn } from "@repo/security/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginPath } from "../src/platform/environment.ts";
import { REPORT_DEPOSIT_NOTICE, REPORT_DEPOSIT_SPAM_INFO } from "../src/projections/reportDeposit.ts";
import { at, named, shown, signIn, signOut, site } from "./support/ui/browser.ts";
import type { Target } from "./support/ui/protocol.ts";

const users = {
  rae: { id: 1101, login: "octo-rae" },
  max: { id: 1102, login: "octo-max" },
  fin: { id: 1103, login: "octo-fin" },
  out: { id: 1104, login: "octo-out" },
  sam: { id: 1105, login: "octo-sam" },
  root: { id: 9001, login: "octo-root" },
  mod: { id: 18633264, login: "octo-mod" },
} as const;

type User = (typeof users)[keyof typeof users];

const journeyMs = 30_000;
const vaultKit = "vault-kit";
const plainKit = "plain-kit";
const ownerLines = ["Reentrancy in the archived v1 router", "Oracle lag under 30 seconds"] as const;
const expectedFailures = ["^console Failed to load resource: the server responded with a status of 40[13]", "^40[13] (GET|POST) /api/v1/"];

const nodeIdOf = (user: User) => `U_kgDO${btoa(String.fromCharCode(...[24, 16, 8, 0].map((shift) => (user.id >>> shift) & 255))).replace(/=+$/u, "").replaceAll("+", "-").replaceAll("/", "_")}`;
const person = (user: User) => ({ githubId: String(user.id), githubLogin: user.login });
const repositoryOf = (projectId: string) => `${users.max.login}/${projectId}`;
const repositoryIdOf = (projectId: string) => (projectId === vaultKit ? 1201 : 1202);

function bountyTerms(projectId: string, technical: ReadonlyArray<User>, excludedFindings?: ReadonlyArray<string>) {
  const repository = repositoryOf(projectId);
  return {
    version: "1",
    status: "open",
    rewardMode: "bounty-only",
    eligibility: "in-scope-security",
    fundingPolicy: "after-approval",
    amount: { currency: "USDC", decimals: 6, grossMinor: "10000000", network: "base" },
    split: { researcherBasisPoints: 7500, slopBasisPoints: 2500 },
    sponsor: { name: "Slop", githubId: null },
    funding: { state: "pledged" },
    capacity: { awards: null, closesAt: null, exhaustionRule: "Each qualifying finding is decided on its own." },
    scope: {
      sourceRevisions: [{ repository, commit: "0".repeat(40) }],
      deployments: [],
      includedAssets: [repository],
      excludedDependencies: [],
      testingPermission: "Use local tests with synthetic funds only.",
      severityRubric: "Critical findings lose funds.",
      lossDefinition: "Any loss of user funds.",
      ...(excludedFindings === undefined ? {} : { excludedFindings }),
    },
    intake: { kind: "github-private-vulnerability-reporting", repository },
    responseTargets: { acknowledgeHours: 24, triageBusinessDays: 3, updateIntervalDays: 7 },
    approvers: { technical: technical.map(person), financial: [person(users.fin)], dispute: [person(users.root)] },
    dispute: { authority: "advisory", process: "Request a review through the private case appeal." },
    disclosure: "Keep reports private until the owner approves disclosure.",
    safeHarbor: "Report in good faith and follow the published testing rules.",
  };
}

function manifestOf(projectId: string, securityBounty: ReturnType<typeof bountyTerms>) {
  const repository = repositoryOf(projectId);
  const steward = users.max;
  return {
    schemaVersion: "1",
    id: projectId,
    slug: projectId,
    name: `Project ${projectId}`,
    eyebrow: "Open-source project",
    headline: "Audited vault tooling.",
    description: "Build and maintain reproducible vault tooling.",
    listingTier: "community",
    status: "active",
    steward: { displayName: steward.login, kind: "individual", github: { actorId: String(steward.id), nodeId: `U_${steward.login}`, login: steward.login, type: "User", profileUrl: `https://github.com/${steward.login}` }, website: null },
    authority: { state: "unverified", reason: "missing-repository-proof", role: "project-steward", repositoryId: String(repositoryIdOf(projectId)), repositoryNodeId: `R_kgDO${repositoryIdOf(projectId).toString(36)}`, proof: null },
    terms: {
      revision: "draft-1",
      effectiveAt: "2026-11-01T00:00:00.000Z",
      paymentTransfersIp: false,
      retroactive: false,
      receiptPolicy: { state: "pending-authority-activation", activatedAt: null, bindings: [] },
      copyright: { model: "unknown", claimedLegalHolder: null, notice: null, legalCapacity: null, governanceResolution: null },
      repositoryLicense: { state: "verified", spdx: "MIT", url: `https://github.com/${repository}/blob/${"a".repeat(40)}/LICENSE`, commitSha: "a".repeat(40), fileSha256: "b".repeat(64) },
      inbound: { mode: "unknown", termsUrl: null, commitSha: null, fileSha256: null, version: null, acceptance: null },
      assignment: null,
      externalPrize: null,
    },
    repositories: [{ id: repository, displayName: repository, githubUrl: `https://github.com/${repository}`, description: "Vault tooling.", integrationBranch: "main" }],
    skill: { id: `contribute-to-${projectId}`, publishAtRoot: false, sourcePath: "skills/project-contributor-template", publicPath: `/projects/${projectId}/skill.md` },
    reviewSkill: { id: `review-${projectId}-contributions`, sourcePath: "skills/project-reviewer-template" },
    rewardAsset: { network: "ethereum", kind: "stablecoin", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6, chainId: "1", cluster: null, verifiedAt: "2026-11-01T00:00:00.000Z" },
    contribution: {
      approvedScope: "Bug fixes and documented features in the vault.",
      contributionGuide: "Branch from main and keep one change per pull request.",
      supportedTasks: "Reproduced bugs with a failing test.",
      requiredTests: "Run the test suite and attach the output.",
      reviewExpectations: "The failing test fails on the base and passes on the head.",
      securityContact: "security@example.org",
      closurePolicy: "Maintainers close duplicates.",
      maintainerNotes: "",
    },
    reward: { kind: "monthly-pool", currency: "USDC", chain: "ethereum", rewardStartAt: "2026-11-01T00:00:00.000Z", cycle: "calendar-month-utc", monthlyCapMinor: "0", monthlyCapDisplay: "$0", committedMinor: "0", paymentMode: "disabled", feeBasisPoints: 100, unusedFunds: "rollover-without-cap-increase", fundingState: "pledged" },
    funding: { mode: "direct-noncustodial", disclosure: "Funds go directly to the project wallet. Slop does not hold or recover funds.", recordsPath: `funding/${projectId}`, addresses: [] },
    modelPolicy: { mode: "open-declared", disclosureRequired: true },
    links: { repository: `https://github.com/${repository}`, issues: `https://github.com/${repository}/issues` },
    securityBounty,
  };
}

const digestOf = (text: string) => Effect.runPromise(Effect.provide(sha256Hex(text), webCrypto));

async function publishRevision(projectId: string, revision: number, terms: ReturnType<typeof bountyTerms>) {
  const text = JSON.stringify(manifestOf(projectId, terms));
  const digest = await digestOf(text);
  const now = new Date().toISOString();
  await site.sql("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES(?,?,?,?,?,?,?,?)", projectId, revision, text, digest, `Revision ${revision}`, String(users.max.id), users.max.login, now);
  if (revision === 1) {
    await site.sql("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',?,?,?,?,?)", projectId, revision, text, digest, now, now);
    await site.sql("INSERT INTO project_repositories(repository_key,project_id) VALUES(?,?)", repositoryOf(projectId), projectId);
  } else {
    await site.sql("UPDATE projects SET revision = ?, manifest = ?, manifest_sha256 = ?, updated_at = ? WHERE id = ?", revision, text, digest, now, projectId);
  }
  await site.sql(
    "INSERT INTO repository_reporting_status(project_id,project_revision,repository_key,repository_id,repository_node_id,enabled,verified_at,attempted_at,failure) VALUES(?,?,?,?,?,1,?,?,NULL)",
    projectId,
    revision,
    repositoryOf(projectId),
    String(repositoryIdOf(projectId)),
    `R_kgDO${repositoryIdOf(projectId).toString(36)}`,
    now,
    now,
  );
}

async function seedPrograms() {
  for (const projectId of [vaultKit, plainKit]) {
    const id = repositoryIdOf(projectId);
    const fullName = repositoryOf(projectId);
    await site.repository({ id, owner: users.max.login, name: projectId, fork: false, archived: false, license: "MIT", files: { "README.md": `# ${projectId}\n`, "CONTRIBUTING.md": "Open a pull request against main.\n" } });
    await site.permission(fullName, users.max.login, "admin");
    await site.installation({ id, account: users.max.login, repositories: [fullName] });
  }
  await publishRevision(vaultKit, 1, bountyTerms(vaultKit, [users.max], ownerLines));
  await publishRevision(plainKit, 1, bountyTerms(plainKit, [users.max]));
}

const programPath = (projectId: string) => `/projects/${projectId}/security`;
const summaryField = named("textbox", "Summary");
const descriptionField = named("textbox", "Description");
const submissionsOf = (user: User) => site.sql("SELECT id, project_id, idempotency_key FROM security_submissions WHERE reporter_github_id = ?", String(user.id));
const casesOf = (projectId: string) => site.sql("SELECT id FROM security_cases WHERE project_id = ? ORDER BY id", projectId);
const caseButton = (caseId: string) => named("button", `Case ${caseId.slice(-8)}`, { exact: false });
const reportCard = (caseId: string) => named("article", `Case ${caseId.slice(-8)}`, { exact: false });
const searchOf = async () => new URL(await site.where()).searchParams;

async function writeReport(summary: string, description: string) {
  await shown(summaryField).toMatchObject({ visible: true, disabled: false });
  await site.fill(summaryField, summary);
  await site.fill(descriptionField, description);
}

async function sentCount(method: string, path: string) {
  return (await site.sent()).filter((sent) => sent.method === method && sent.path === path).length;
}

beforeEach(async () => {
  await site.start();
  for (const user of Object.values(users)) await site.user(user.id, user.login);
  await seedPrograms();
});

afterEach(async () => {
  expect(await site.popups()).toBe(0);
  expect(await site.diagnostics()).toEqual({ console: [], failed: [] });
});

describe('Recover a report draft and an uncertain submission', () => {
  // spec/frontend/drafts.md, "Story: Recover a report draft and an uncertain submission"; spec/security/intake.md, "Story: Submit and recover one private report"
  it('a written report survives a reload, is reviewed and edited, and one send creates one receipt and one case', async () => {
    // spec/frontend/drafts.md, "A draft belongs to one account and project"; spec/frontend/drafts.md, "Editing keeps storage failures visible and invalidates the reviewed content"; spec/security/journey.md, "The receipt creates the case and the first screening version under the program's terms"
    const summary = "Vault withdraw skips the share check";
    const description = "At commit 0000000, withdraw() trusts the caller's share count; the attached test drains the vault.";
    await site.open(programPath(vaultKit));
    await shown(named("link", "Sign in with GitHub")).toMatchObject({ visible: true });
    await shown(summaryField).toMatchObject({ count: 0 });

    await signIn(users.rae.login, programPath(vaultKit));
    await writeReport(summary, description);
    await shown({ text: `Draft · @${users.rae.login}` }).toMatchObject({ visible: true });
    await site.open(programPath(vaultKit));
    await shown(summaryField).toMatchObject({ value: summary });
    await shown(descriptionField).toMatchObject({ value: description });

    await site.click(named("button", "Review report"));
    await shown(named("heading", summary)).toMatchObject({ visible: true });
    await shown(summaryField).toMatchObject({ count: 0 });
    await site.click(named("button", "Edit report"));
    await shown(summaryField).toMatchObject({ value: summary });
    await site.click(named("button", "Review report"));
    expect(await submissionsOf(users.rae)).toEqual([]);

    await site.click(named("button", "Submit private report"));
    await shown(named("heading", "Report received")).toMatchObject({ visible: true });
    await expect.poll(() => submissionsOf(users.rae), { timeout: journeyMs }).toEqual([expect.objectContaining({ project_id: vaultKit })]);
    expect(await casesOf(vaultKit)).toHaveLength(1);
    expect(await sentCount("POST", "/api/v1/security-submissions")).toBe(1);
  });

  it('a send whose answer is lost is recovered after a reload by retrying the same report under the same key', async () => {
    // spec/frontend/drafts.md, "The first send fixes a key and retries keep that key and content"; spec/frontend/drafts.md, "A reviewed or submitted draft retains its account, project and content identity"; spec/security/intake.md, "A new attempt binds authenticated identity, passes admission and keeps its idempotency key"
    await site.allow("^console Failed to load resource", "^failed POST /api/v1/security-submissions ");
    const summary = "Oracle price is read before the update";
    await signIn(users.sam.login, programPath(vaultKit));
    await writeReport(summary, "The vault reads the oracle before the keeper's update lands, so a stale price mints extra shares.");
    await site.click(named("button", "Review report"));

    await site.hold("POST", "/api/v1/security-submissions");
    await site.click(named("button", "Submit private report"));
    await expect.poll(() => sentCount("POST", "/api/v1/security-submissions"), { timeout: journeyMs }).toBe(1);
    await expect.poll(() => submissionsOf(users.sam), { timeout: journeyMs }).toHaveLength(1);
    const [first] = await submissionsOf(users.sam);
    await site.open(programPath(vaultKit));
    await site.release("POST", "/api/v1/security-submissions");

    await shown({ text: `Unconfirmed · @${users.sam.login}` }).toMatchObject({ visible: true });
    await shown(named("heading", summary)).toMatchObject({ visible: true });
    await shown(named("button", "Edit report")).toMatchObject({ count: 0 });
    await site.click(named("button", "Retry same report"));
    await shown(named("heading", "Report received")).toMatchObject({ visible: true });
    expect(await submissionsOf(users.sam)).toEqual([first]);
    expect(await sentCount("POST", "/api/v1/security-submissions")).toBe(2);
    expect(await casesOf(vaultKit)).toHaveLength(1);
  });
});

describe('Submit and recover one private report', () => {
  // spec/security/intake.md, "Story: Submit and recover one private report"; spec/security/reportDeposit.md, "Story: Hold a private report until its refundable deposit is recorded"
  const proofField = named("group", "Proof of concept");
  const proofInput: Target = { label: "Proof of concept" };
  const patch = "--- a/test/Vault.t.sol\n+++ b/test/Vault.t.sol\n@@ -1 +1,3 @@\n+function testWithdrawRounding() public {\n+  vault.withdraw(1);\n+}\n";
  const textFile = (name: string, text: string, mimeType = "text/plain") => ({ name, mimeType, bytes: [...new TextEncoder().encode(text)] });

  it('form states deposit, validates proof files, sends proof, and Inbox follows deposit to recorded', async () => {
    // spec/security/reportDeposit.md, "A deposit is asked only with a new case, at a rate in force, from a reporter who is not exempt"; spec/security/intake.md, "A report body holds between 1 and 262,144 bytes and any other size creates nothing"; spec/frontend/drafts.md, "A draft belongs to one account and project"; spec/security/reportDeposit.md, "A report that waits for its deposit belongs to its reporter alone"; spec/security/reportDeposit.md, "A paid deposit is sent back on a first response and kept only after a keeping close stood seven days"; spec/frontend/feePages.md, "The wallet is asked only after a fresh read shows the same amount due, from one saved attempt per item"
    const summary = "Withdrawal rounds shares in the wrong direction";
    const description = "At commit abc, withdraw() rounds shares down. The attached test repeats a synthetic withdrawal.";
    await site.wallets({ evm: { name: "Anvil Wallet" } });
    await signIn(users.rae.login, programPath(vaultKit));
    await shown(summaryField).toMatchObject({ visible: true, disabled: false });
    const asked = REPORT_DEPOSIT_SWITCHED_ON && reportDepositOn(manifestOf(vaultKit, bountyTerms(vaultKit, [users.max], ownerLines)));
    await shown({ text: REPORT_DEPOSIT_NOTICE, exact: true }).toMatchObject({ count: asked ? 1 : 0 });

    await site.fill(summaryField, summary);
    await site.upload({ label: "Load report from file" }, textFile("report.md", `\n${description}\n`, "text/markdown"));
    await shown(descriptionField).toMatchObject({ value: description });

    await site.upload(proofInput, textFile("WithdrawRounding.t.sol", patch));
    await shown({ text: "WithdrawRounding.t.sol", within: proofField }).toMatchObject({ visible: true });
    await site.upload(proofInput, { name: "test.patch", mimeType: "application/octet-stream", bytes: [0x2b, 0x00, 0xff, 0xfe] });
    await shown({ text: "The file must be text, not a binary file.", exact: true }).toMatchObject({ visible: true });
    await shown({ text: "WithdrawRounding.t.sol", within: proofField }).toMatchObject({ visible: true });
    await site.upload(proofInput, textFile("exploit.sh", "echo\n"));
    await shown({ text: "The proof file must end in", within: proofField }).toMatchObject({ visible: true });
    await shown({ text: "WithdrawRounding.t.sol", within: proofField }).toMatchObject({ visible: true });

    await site.open(programPath(vaultKit));
    await shown({ text: "WithdrawRounding.t.sol", within: proofField }).toMatchObject({ visible: true });
    await site.click(named("button", "Review report"));
    await shown({ text: "Proof of concept: WithdrawRounding.t.sol", exact: true }).toMatchObject({ visible: true });
    await site.click(named("button", "Submit private report"));
    await shown(named("heading", "Report received")).toMatchObject({ visible: true });
    await expect.poll(() => submissionsOf(users.rae), { timeout: journeyMs }).toEqual([expect.objectContaining({ project_id: vaultKit })]);
    expect(await sentCount("POST", "/api/v1/security-submissions")).toBe(1);

    await expect.poll(() => casesOf(vaultKit), { timeout: journeyMs }).toHaveLength(1);
    const [filed] = await casesOf(vaultKit);
    const caseId = String(filed?.id);
    const payPath = `/fee/report/${caseId}`;
    const needed = named("link", "Deposit needed: 395 SLOP");
    await site.open("/inbox");
    await shown(reportCard(caseId)).toMatchObject({ visible: true });
    await shown(named("link", "Deposit needed", { exact: false })).toMatchObject({ count: 0 });

    await site.sql(
      "INSERT INTO security_report_deposits(case_id,project_id,item,mode,slop_amount,slop_per_usd,asked_at) VALUES(?,?,?,'asked','395000000000000000000','79',?)",
      caseId,
      vaultKit,
      reportDepositItem(caseId) ?? null,
      new Date().toISOString(),
    );
    await site.open("/inbox");
    await shown(needed).toMatchObject({ visible: true, href: payPath });
    await site.click(needed);
    await at(payPath);
    const payForm = named("region", "Pay the deposit");
    const connected = named("group", "Connected wallet", { within: payForm });
    await shown(named("button", "Pay from a wallet")).toMatchObject({ visible: true, disabled: false });
    await shown(named("button", "Connect Anvil Wallet")).toMatchObject({ count: 0 });
    await site.click(named("button", "Pay from a wallet"));
    await site.click(named("button", "Connect Anvil Wallet", { within: payForm }));
    await shown(connected).toMatchObject({ visible: true });
    await shown(named("button", "Review deposit", { within: payForm })).toMatchObject({ visible: true });
    await site.click(named("button", "Choose another wallet", { within: payForm }));
    await shown(connected).toMatchObject({ count: 0 });
    await shown(named("button", "Review deposit", { within: payForm })).toMatchObject({ count: 0 });
    await shown(named("button", "Choose another wallet", { within: payForm })).toMatchObject({ count: 0 });
    await shown(named("button", "Connect Anvil Wallet", { within: payForm })).toMatchObject({ visible: true, disabled: false });
    expect((await site.walletAsked()).filter((request) => request.method === "eth_sendTransaction")).toEqual([]);

    const ratePath = "/api/v1/submission-fee/rate";
    await site.serve(ratePath, 200, { schema: "slop-submission-fee-rate-v1", slopShareBps: 5000, rate: { effectiveAt: "2026-11-01T00:00:00.000Z", slopPerUsd: "79" }, previous: null });
    await site.walletFail("eth_sendTransaction");
    await site.click(named("button", "Connect Anvil Wallet", { within: payForm }));
    await site.click(named("button", "Review deposit", { within: payForm }));
    await site.click(named("button", "Confirm deposit in wallet", { within: payForm }));
    const unsent = { text: "Nothing was sent?", exact: true, within: payForm } satisfies Target;
    await shown(unsent).toMatchObject({ visible: true });
    await site.click(unsent);
    await site.click(named("button", "Not sent — clear", { within: payForm }));
    await shown({ text: "Local request cleared. Review again before sending.", within: payForm }).toMatchObject({ visible: true });
    await shown(unsent).toMatchObject({ count: 0 });
    expect((await site.walletAsked()).filter((request) => request.method === "eth_sendTransaction")).toHaveLength(1);
    await site.unserve(ratePath);

    await site.sql("UPDATE security_report_deposits SET paid_at = ? WHERE case_id = ?", new Date().toISOString(), caseId);
    await site.open("/inbox");
    await shown({ text: "Deposit recorded", exact: true }).toMatchObject({ visible: true });
    await shown(needed).toMatchObject({ count: 0 });
    await site.sql("UPDATE security_report_deposits SET outcome = 'refund_due', outcome_reason = 'responded', outcome_at = ? WHERE case_id = ?", new Date().toISOString(), caseId);
    await site.open("/inbox");
    await shown({ text: "Deposit recorded, to be sent back", exact: true }).toMatchObject({ visible: true });
  });

  it('three tab returns keep the reporter\'s reports on the Inbox and re-read only the session', async () => {
    // spec/frontend/navigation.md, "An identity refresh applies only within the navigation lifetime that requested it"; spec/frontend/requests.md, "Only the current request may publish its validated result"
    const summary = "Share price moves on a donated deposit";
    await signIn(users.rae.login, programPath(vaultKit));
    await writeReport(summary, "A direct token transfer to the vault changes the share price, which the attached test turns into a loss.");
    await site.click(named("button", "Review report"));
    await site.click(named("button", "Submit private report"));
    await shown(named("heading", "Report received")).toMatchObject({ visible: true });
    await expect.poll(() => casesOf(vaultKit), { timeout: journeyMs }).toHaveLength(1);
    const [filed] = await casesOf(vaultKit);
    const caseId = String(filed?.id);

    await site.open("/inbox");
    await shown(reportCard(caseId)).toMatchObject({ visible: true });
    const reads = async () => {
      const sent = await site.sent();
      const count = (path: string) => sent.filter((entry) => entry.method === "GET" && entry.path === path).length;
      return { session: count("/api/v1/project-session"), cases: count("/api/v1/security-cases"), submissions: count("/api/v1/security-submissions") };
    };
    const loaded = await reads();
    for (let round = 1; round <= 3; round += 1) {
      await site.refocus();
      await expect.poll(async () => (await reads()).session, { timeout: journeyMs }).toBeGreaterThanOrEqual(loaded.session + round);
      await shown(reportCard(caseId)).toMatchObject({ visible: true });
      await shown({ text: "Checking private session…" }).toMatchObject({ count: 0 });
    }
    expect(await reads()).toMatchObject({ cases: loaded.cases, submissions: loaded.submissions });
  });
});

describe('Change accounts without disclosing the prior account\'s draft', () => {
  // spec/frontend/composition.md, "Story: Change accounts without disclosing the prior account's draft"
  it('signing out erases the report draft, and neither the next account nor the returning one sees it', async () => {
    // spec/frontend/composition.md, "Account changes erase drafts and preserve every child invariant"; spec/frontend/composition.md, "The active draft and navigation share one authenticated actor"
    await site.allow(...expectedFailures);
    const summary = "Private draft that must not survive sign-out";
    await signIn(users.rae.login, programPath(plainKit));
    await writeReport(summary, "Details that only octo-rae typed and that no later account may read.");
    await signOut(users.rae.login);
    await expect.poll(() => site.leaks(summary), { timeout: journeyMs }).toBe(false);

    await signIn(users.out.login, programPath(plainKit));
    await shown(summaryField).toMatchObject({ value: "" });
    expect(await site.leaks(summary)).toBe(false);
    await signOut(users.out.login);

    await signIn(users.rae.login, programPath(plainKit));
    await shown(summaryField).toMatchObject({ value: "" });
    expect(await site.leaks(summary)).toBe(false);
    expect(await submissionsOf(users.rae)).toEqual([]);
  });
});

describe('Carry one report from receipt to decision', () => {
  // spec/security/journey.md, "Story: Carry one report from durable receipt to a decision and optional forwarding"; spec/security/cases.md, "Story: Obtain a human decision on every report the routine pass leaves open"
  it('reporter and maintainer see case, outsider sees none, spam mark sends, revoked role loses access', async () => {
    // spec/security/cases.md, "Authority snapshots advance and triager membership is audited at the next revision"; spec/security/cases.md, "Current technical approvers and triagers request information on the current report version"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/security/cases.md, "A technical decision records the finding, duplicate identity and relatedness"; spec/security/reportDeposit.md, "A paid deposit is sent back on a first response and kept only after a keeping close stood seven days"
    await site.allow(...expectedFailures);
    await signIn(users.rae.login, programPath(vaultKit));
    await writeReport("Share rounding lets a deposit mint for free", "Depositing one wei rounds the share price down to zero at the attached commit.");
    await site.click(named("button", "Review report"));
    await site.click(named("button", "Submit private report"));
    await shown(named("heading", "Report received")).toMatchObject({ visible: true });
    await expect.poll(() => casesOf(vaultKit), { timeout: journeyMs }).toHaveLength(1);
    const [received] = await casesOf(vaultKit);
    const caseId = String(received?.id);

    await site.open("/security");
    await shown(named("heading", "Security cases", { level: 1 })).toMatchObject({ visible: true });
    await site.click(named("button", "Open case", { within: reportCard(caseId) }));
    await expect.poll(async () => (await searchOf()).get("case"), { timeout: journeyMs }).toBe(caseId);
    await shown(named("button", "Back to reports")).toMatchObject({ visible: true });
    await site.click(named("button", "Back to reports"));
    await expect.poll(async () => (await searchOf()).has("case"), { timeout: journeyMs }).toBe(false);
    await shown(reportCard(caseId)).toMatchObject({ visible: true });
    await signOut(users.rae.login);

    await signIn(users.out.login, "/security");
    await shown({ text: "No reports", exact: true }).toMatchObject({ visible: true });
    expect(await site.leaks(caseId.slice(-8))).toBe(false);
    await signOut(users.out.login);

    await signIn(users.max.login, `/security?case=${caseId}`);
    await shown(named("button", "Back to reports")).toMatchObject({ visible: true });
    await shown(named("region", "Case actions")).toMatchObject({ visible: true });
    await shown(reportCard(caseId)).toMatchObject({ visible: true });

    const decision = named("form", "Decide");
    const outcome: Target = { label: "Outcome", within: decision };
    const spam = named("checkbox", `Spam · ${REPORT_DEPOSIT_SPAM_INFO}`, { within: decision });
    await site.click(named("button", "Decide", { within: named("region", "Case actions") }));
    await shown(outcome).toMatchObject({ visible: true });
    await shown(spam).toMatchObject({ count: 0 });
    await site.select(outcome, "Duplicate");
    await shown(spam).toMatchObject({ count: 0 });
    await site.select(outcome, "Rejected");
    await shown(spam).toMatchObject({ visible: true, checked: false });
    await site.click(spam);
    await shown(spam).toMatchObject({ checked: true });
    await site.select({ label: "Severity", within: decision }, "Informational");
    await site.fill(named("textbox", "Reason", { exact: false, within: decision }), "Generated text with no finding in it.");
    await site.click(named("button", "Record decision", { within: decision }));
    await expect
      .poll(() => site.sql("SELECT json_extract(detail, '$.outcome') AS outcome, json_extract(detail, '$.spam') AS spam FROM security_case_events WHERE case_id = ? AND kind = 'decide'", caseId), { timeout: journeyMs })
      .toEqual([{ outcome: "rejected", spam: 1 }]);

    await publishRevision(vaultKit, 2, bountyTerms(vaultKit, [users.fin], ownerLines));
    await site.open("/security");
    await shown(named("heading", "Security cases", { level: 1 })).toMatchObject({ visible: true });
    await expect.poll(() => site.read(reportCard(caseId)), { timeout: journeyMs }).toMatchObject({ count: 0 });
    await shown(caseButton(caseId)).toMatchObject({ count: 0 });
    await shown(named("region", "Case actions")).toMatchObject({ count: 0 });
  });
});

describe('Close and reopen an account without losing history', () => {
  // spec/backend/accounts.md, "Story: Close and reopen an account without losing history"
  it('closing keeps unpaid award and private case unread until explicit reopen', async () => {
    // spec/backend/accounts.md, "Confirmed closure ends every session, hides the membership, disconnects X and withdraws both email consents"; spec/backend/accounts.md, "An ordinary sign-in cannot reopen a closed account; explicit reopening can"; spec/settlement/payment.md, "An approved obligation retains its immutable amount and purpose"
    await site.allow("^console Failed to load resource: the server responded with a status of 40[139]", "^40[13] (GET|POST) /api/v1/", "^409 POST /api/v1/points/join$");
    await signIn(users.rae.login, programPath(vaultKit));
    await writeReport("Withdraw queue skips a paused vault", "Withdrawals queued while the vault is paused bypass the share check at the attached commit.");
    await site.click(named("button", "Review report"));
    await site.click(named("button", "Submit private report"));
    await shown(named("heading", "Report received")).toMatchObject({ visible: true });
    await expect.poll(() => casesOf(vaultKit), { timeout: journeyMs }).toHaveLength(1);
    const [received] = await casesOf(vaultKit);
    const caseId = String(received?.id);
    const reporter = String(users.rae.id);
    await site.sql(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES('obligation-closing',?,?,'base-mainnet','base',?,'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',6,'100000000','2000000',?,'reserved',?)",
      vaultKit,
      reporter,
      `0x${"2".repeat(40)}`,
      "9".repeat(64),
      new Date().toISOString(),
    );
    const retained = async () => ({
      obligations: await site.sql("SELECT id, state, gross_base, fee_base FROM payment_obligations WHERE github_user_id = ?", reporter),
      cases: await site.sql("SELECT id, receipt_state, revision FROM security_cases WHERE reporter_github_id = ?", reporter),
      submissions: await submissionsOf(users.rae),
    });
    const before = await retained();
    expect({ obligations: before.obligations.length, cases: before.cases.length, submissions: before.submissions.length }).toEqual({ obligations: 1, cases: 1, submissions: 1 });

    expect(await site.fetch("POST", "/api/v1/points/account/close", { login: users.rae.login })).toMatchObject({ status: 200, body: { closed: true } });
    expect(await site.fetch("GET", "/api/v1/security-cases")).toMatchObject({ status: 401 });
    expect(await site.fetch("GET", "/api/v1/payments/me")).toMatchObject({ status: 401 });
    expect(await retained()).toEqual(before);

    await site.github(users.rae.login);
    await site.open(loginPath("/security"));
    await site.click(named("button", "Continue with GitHub"));
    await shown(named("button", "Reopen account")).toMatchObject({ visible: true, disabled: false });
    await shown(named("button", "Continue with GitHub")).toMatchObject({ count: 0 });
    expect(await retained()).toEqual(before);
    await site.click(named("button", "Reopen account"));
    await at("/security");
    await shown(reportCard(caseId)).toMatchObject({ visible: true });
    expect(await retained()).toEqual(before);
  });
});

describe('Decide an award under the terms that accompanied the report', () => {
  // spec/security/terms.md, "Story: Decide an award under the terms that accompanied the report"
  it('published program lists ten defaults with routine notice, plus owner lines when present', async () => {
    // spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"; spec/security/routineDecisions.md, "Duplicates, published lines and the proof clock close; a report on GitHub and every hold go to the owner"
    await site.open(programPath(vaultKit));
    const scope = named("region", "Scope");
    await shown(named("heading", "Does not qualify", { within: scope })).toMatchObject({ visible: true });
    await shown({ text: SECURITY_ROUTINE_DECISION_NOTICE, exact: true, within: scope }).toMatchObject({ count: 1, visible: true });
    await shown(named("heading", "Also does not qualify for this program", { within: scope })).toMatchObject({ visible: true });
    const text = (await site.read(scope)).text;
    const order = [...SECURITY_DEFAULT_EXCLUSIONS, ...ownerLines].map((line) => text.indexOf(line));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));

    await site.open(programPath(plainKit));
    await shown(named("heading", "Does not qualify", { within: scope })).toMatchObject({ visible: true });
    await shown(named("heading", "Also does not qualify for this program")).toMatchObject({ count: 0 });
    const plain = (await site.read(scope)).text;
    expect(SECURITY_DEFAULT_EXCLUSIONS.every((line) => plain.includes(line))).toBe(true);
  });

  it('only steward manages bounty and published owner lines are stored trimmed and displayed', async () => {
    // spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"; spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"
    await site.allow(...expectedFailures);
    const settings = `${programPath(plainKit)}#security-settings`;
    await signIn(users.out.login, settings);
    await shown({ text: "Only the current project steward or a repository administrator can manage this bounty." }).toMatchObject({ visible: true });
    await shown(named("button", "Retry management access")).toMatchObject({ visible: true });
    await shown(named("textbox", "Also does not qualify")).toMatchObject({ count: 0 });
    expect((await site.sent()).filter((sent) => sent.path === `/api/v1/project-setup/${plainKit}`).length).toBeGreaterThan(0);
    await signOut(users.out.login);

    const lines = ["Gas refunds below one cent", "Reports about the retired faucet"];
    await signIn(users.max.login, settings);
    await site.click({ text: "Scope and testing", exact: true });
    const field = named("textbox", "Also does not qualify");
    await shown(field).toMatchObject({ visible: true, value: "" });
    await site.fill(field, `  ${lines.join("\n\n")}\n`);
    await site.click(named("button", "Review bounty terms"));
    await site.click(named("button", "Publish bounty terms"));
    await expect
      .poll(async () => (await site.sql("SELECT json_extract(manifest, '$.securityBounty.scope.excludedFindings') AS lines FROM projects WHERE id = ?", plainKit))[0]?.lines, { timeout: journeyMs })
      .toBe(JSON.stringify(lines));

    await site.open(settings);
    await shown(named("heading", "Also does not qualify for this program")).toMatchObject({ visible: true });
    const scope = (await site.read(named("region", "Scope"))).text;
    expect(lines.every((line) => scope.includes(line))).toBe(true);
    await site.click({ text: "Scope and testing", exact: true });
    await shown(named("textbox", "Also does not qualify")).toMatchObject({ value: lines.join("\n") });

    await site.fill(named("textbox", "Also does not qualify"), "");
    await site.click(named("button", "Review bounty terms"));
    await site.click(named("button", "Publish bounty terms"));
    await expect
      .poll(async () => (await site.sql("SELECT json_type(manifest, '$.securityBounty.scope.excludedFindings') AS kind FROM projects WHERE id = ?", plainKit))[0]?.kind, { timeout: journeyMs })
      .toBeNull();
  });
});

const noticeAt = (minute: number) => new Date(Date.UTC(2026, 10, 1, 0, minute)).toISOString();

async function seedNotices(user: User, count: number) {
  await site.sql(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO notifications(event_key,recipient_github_id,kind,subject,action_path,source_at,created_at)
     SELECT printf('project-revision:paging-%03d:1', i), ?, 'project_revision', printf('Paging %03d', i), '/projects/${vaultKit}', strftime('%Y-%m-%dT%H:%M:%fZ', '2026-11-01', printf('+%d minutes', i)), ? FROM n`,
    count,
    String(user.id),
    noticeAt(0),
  );
}

const unreadOf = (user: User) => site.sql("SELECT count(*) AS unread FROM notifications WHERE recipient_github_id = ? AND read_at IS NULL", String(user.id));
const noticeLink = (subject: string) => named("link", `${subject} settings changed: Open project`);

describe('Read, acknowledge and escalate private case notices', () => {
  // spec/operations/notifications.md, "Story: Read, acknowledge and escalate private case notices"
  it('Inbox pages notices, marks read, omits unneeded acknowledgments and isolates accounts', async () => {
    // spec/operations/notifications.md, "Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment"; spec/slopbot/assessmentInbox.md, "A read captures its actor, exact registry binding and response route"
    await site.allow(...expectedFailures);
    await seedNotices(users.rae, 101);
    await signIn(users.rae.login, "/inbox");
    await shown(named("heading", "Inbox", { level: 1 })).toMatchObject({ visible: true });
    await shown({ text: "101 unread" }).toMatchObject({ visible: true });
    await shown(noticeLink("Paging 101")).toMatchObject({ visible: true });
    await shown(noticeLink("Paging 001")).toMatchObject({ count: 0 });
    await shown(named("button", "Acknowledge:", { exact: false })).toMatchObject({ count: 0 });
    expect((await site.sent()).filter((sent) => sent.path === "/api/v1/notifications/incomplete-assessments")).toEqual([]);

    await site.click(named("button", "Mark as read: Paging 101 settings changed", { exact: false }));
    await shown(named("button", "Mark as read: Paging 101 settings changed", { exact: false })).toMatchObject({ count: 0 });
    await shown(noticeLink("Paging 101")).toMatchObject({ visible: true });
    await expect.poll(() => unreadOf(users.rae), { timeout: journeyMs }).toEqual([{ unread: 100 }]);

    await site.click(named("button", "Mark page read"));
    await shown({ text: "Marked read", exact: true }).toMatchObject({ visible: true });
    await shown(named("img", "Unread")).toMatchObject({ count: 0 });
    await expect.poll(() => unreadOf(users.rae), { timeout: journeyMs }).toEqual([{ unread: 1 }]);

    await site.click(named("button", "Older notifications"));
    await shown(noticeLink("Paging 001")).toMatchObject({ visible: true });
    await shown(named("img", "Unread")).toMatchObject({ count: 1 });
    await shown(named("button", "Newer notifications")).toMatchObject({ disabled: false });
    await site.click(named("button", "Newer notifications"));
    await shown(noticeLink("Paging 101")).toMatchObject({ visible: true });

    await site.open("/inbox?points");
    await site.open("/account", "other");
    await signOut(users.rae.login);
    await signIn(users.out.login, "/account", "other");
    await site.tab("main");
    await site.refocus();
    await shown(named("button", users.out.login, { exact: false })).toMatchObject({ visible: true });
    await shown({ text: "Nothing yet", exact: true }).toMatchObject({ visible: true });
    await expect.poll(async () => (await searchOf()).has("points"), { timeout: journeyMs }).toBe(false);
    expect(await site.leaks("Paging 0")).toBe(false);
    expect(await site.leaks(users.rae.login)).toBe(false);
    expect(await unreadOf(users.rae)).toEqual([{ unread: 1 }]);
  });

  it('a report receipt reaches the reporter\'s Inbox as a received notice that asks for no acknowledgment', async () => {
    // spec/security/intake.md, "Only verified exact object bytes permit an atomic case and Inbox receipt"; spec/operations/notifications.md, "Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment"
    await site.allow(...expectedFailures);
    await signIn(users.rae.login, programPath(vaultKit));
    await writeReport("Fee rounding moves dust to the owner", "The withdrawal fee rounds up on every leg, which the attached test sums to a loss.");
    await site.click(named("button", "Review report"));
    await site.click(named("button", "Submit private report"));
    await shown(named("heading", "Report received")).toMatchObject({ visible: true });

    await site.open("/inbox");
    const received = named("link", "received: Open security cases", { exact: false });
    await shown(received).toMatchObject({ visible: true, href: expect.stringContaining("/inbox?submission=") });
    await shown(named("button", "Acknowledge:", { exact: false })).toMatchObject({ count: 0 });
    await site.click(named("button", "Mark as read:", { exact: false }));
    await expect
      .poll(() => site.sql("SELECT count(*) AS unread FROM notifications WHERE recipient_github_id = ? AND kind = 'security_report_received' AND read_at IS NULL", String(users.rae.id)), { timeout: journeyMs })
      .toEqual([{ unread: 0 }]);
  });
});

describe('The author appeals and Slopbot triages first', () => {
  // spec/slopbot/appeals.md, "Story: The author appeals and Slopbot triages first"; spec/slopbot/appeals.md, "Story: The draft is accepted or rejected, and escalated appeals go to a moderator"
  it('escalated appeal opens from moderator Inbox, marks read, and shows resolution', async () => {
    // spec/slopbot/appeals.md, "Only a moderator other than the appellant decides an escalated appeal"; spec/operations/notifications.md, "Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment"
    await site.allow(...expectedFailures);
    const key = "appeal:browser-journey:revision";
    const at = new Date().toISOString();
    const job = JSON.stringify({ owner: users.max.login, repo: vaultKit, itemKind: "pull_request", number: 5 });
    await site.sql(
      "INSERT INTO slopbot_appeals(appeal_key,repository_id,item_node_id,appellant_github_id,job_json,opened_at,due_at,escalated_at,escalation) VALUES(?,1,?,?,?,?,'2099-01-01T00:00:00.000Z',?,'A moderator decision is required')",
      key,
      key,
      String(users.sam.id),
      job,
      at,
      at,
    );
    const path = `/api/v1/notifications/appeals/${encodeURIComponent(key)}`;
    await site.sql("INSERT INTO notifications(event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES(?,?,'slopbot_appeal_review','Contribution appeal',?,?,?)", `slopbot-${key}`, String(users.root.id), path, at, at);

    await signIn(users.root.login, "/inbox");
    const open = named("link", "Appeal to decide: Open appeal on GitHub");
    await shown(open).toMatchObject({ visible: true, href: path });
    await shown(named("img", "Unread")).toMatchObject({ count: 1 });
    await shown(named("button", "Acknowledge:", { exact: false })).toMatchObject({ count: 0 });
    await site.click(named("button", "Mark as read: Appeal to decide", { exact: false }));
    await shown(named("img", "Unread")).toMatchObject({ count: 0 });
    await shown(named("button", "Mark as read: Appeal to decide", { exact: false })).toMatchObject({ count: 0 });
    await expect.poll(() => site.sql("SELECT read_at FROM notifications WHERE event_key = ?", `slopbot-${key}`), { timeout: journeyMs }).toEqual([{ read_at: expect.any(String) }]);

    await site.sql("UPDATE slopbot_appeals SET resolved_at = ?, resolution = 'denied', resolved_by = 'moderator' WHERE appeal_key = ?", new Date().toISOString(), key);
    await site.open("/inbox");
    await shown({ text: "Appeal resolved" }).toMatchObject({ visible: true });
    await shown(open).toMatchObject({ count: 0 });
  });
});

async function seedAward(user: User, amount: number) {
  const recordedAt = new Date().toISOString();
  const revision = {
    previous: null,
    recordedAt,
    sourceDigest: "b".repeat(64),
    sourceRule: "slop-score-v2",
    award: {
      key: "7".repeat(64),
      actor: { id: nodeIdOf(user), login: user.login },
      projectId: vaultKit,
      category: "evaluated-contribution",
      amount,
      occurredAt: recordedAt,
      sourceId: `${vaultKit}-7`,
      sourceUrl: `https://github.com/${repositoryOf(vaultKit)}/pull/7`,
      workUnitId: `${vaultKit}-7`,
      provisional: false,
    },
  } satisfies Parameters<typeof pointRevisionId>[0];
  const id = await Effect.runPromise(Effect.provide(pointRevisionId(revision), webCrypto));
  await site.sql("INSERT INTO points_revisions(id,source_key,previous,recorded_at,payload) VALUES(?,?,NULL,?,?)", id, revision.award.key, recordedAt, JSON.stringify({ id, ...revision }));
  return id;
}

const disputesOf = (revisionId: string) => site.sql("SELECT appeal_key, appellant_github_id, statement, resolution, resolved_by, resolver_github_id FROM points_disputes WHERE revision_id = ?", revisionId);

describe('A recipient disputes their own current Points record privately', () => {
  // spec/points/disputes.md, "Story: A recipient disputes their own current Points record privately"
  it('recipient files review from Inbox and another moderator decides once escalated', async () => {
    // spec/points/disputes.md, "Only the recipient of the current revision files, and a repeated filing returns the first"; spec/points/disputes.md, "Only a moderator other than the recipient reads and decides an escalated dispute, once, with a reason"
    await site.allow(...expectedFailures);
    const revisionId = await seedAward(users.rae, 40);
    const statement = "This pull request fixed the vault test suite; the score missed the second commit.";
    await signIn(users.rae.login, "/inbox?points");
    const review = named("region", "Points review");
    await shown(named("heading", "Review Points", { within: review })).toMatchObject({ visible: true });
    await site.click(named("button", "Review", { within: review }));
    await shown(named("button", "Request review")).toMatchObject({ disabled: true });
    await site.fill(named("textbox", "Reason"), statement);
    await site.click(named("button", "Request review"));
    await expect.poll(() => disputesOf(revisionId), { timeout: journeyMs }).toEqual([expect.objectContaining({ appellant_github_id: String(users.rae.id), statement, resolution: null })]);
    const [filed] = await disputesOf(revisionId);
    const appealKey = String(filed?.appeal_key);
    await shown(named("link", "Points history", { within: review })).toMatchObject({ visible: true });
    await shown(named("textbox", "Decision reason")).toMatchObject({ count: 0 });

    await site.open("/inbox?points");
    await shown(named("link", "Open review", { within: review })).toMatchObject({ visible: true, href: `/inbox?pointsDispute=${encodeURIComponent(appealKey)}` });
    await signOut(users.rae.login);

    await site.sql("UPDATE points_disputes SET escalated_at = ?, escalation = 'Original work evidence needs independent moderator review' WHERE appeal_key = ?", new Date().toISOString(), appealKey);
    await signIn(users.mod.login, `/inbox?pointsDispute=${encodeURIComponent(appealKey)}`);
    await shown({ text: statement }).toMatchObject({ visible: true });
    await shown(named("button", "Deny dispute")).toMatchObject({ disabled: true });
    await site.fill(named("textbox", "Decision reason"), "The second commit only reformatted tests; the score stands.");
    await site.click(named("button", "Deny dispute"));
    await expect
      .poll(() => disputesOf(revisionId), { timeout: journeyMs })
      .toEqual([expect.objectContaining({ appeal_key: appealKey, resolution: "denied", resolved_by: "moderator", resolver_github_id: String(users.mod.id) })]);
    await shown(named("textbox", "Decision reason")).toMatchObject({ count: 0 });
    await at(`/inbox?pointsDispute=${encodeURIComponent(appealKey)}`);
  });
});
