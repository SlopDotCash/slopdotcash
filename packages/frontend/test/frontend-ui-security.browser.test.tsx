import { webCrypto, sha256Hex } from "@repo/platform/crypto";
import { pointRevisionId } from "@repo/points/client";
import { SECURITY_DEFAULT_EXCLUSIONS } from "@repo/security/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { at, named, shown, signIn, signOut, site } from "./support/ui/browser.ts";

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
    split: { researcherBasisPoints: 10000, slopBasisPoints: 0 },
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
    authority: { state: "unverified", reason: "missing-repository-proof", role: "project-steward", repositoryId: String(repositoryIdOf(projectId)), repositoryNodeId: `R_${repositoryIdOf(projectId)}`, proof: null },
    terms: {
      revision: "draft-1",
      effectiveAt: "2026-11-01T00:00:00.000Z",
      paymentTransfersIp: false,
      retroactive: false,
      receiptPolicy: { state: "pending-authority-activation", activatedAt: null, bindings: [] },
      copyright: { model: "unknown", claimedLegalHolder: null, notice: null, legalCapacity: null, governanceResolution: null },
      repositoryLicense: { state: "verified", spdx: "MIT", url: `https://github.com/${repository}/blob/main/LICENSE`, commitSha: "a".repeat(40), fileSha256: "b".repeat(64) },
      inbound: { mode: "unknown", termsUrl: null, commitSha: null, fileSha256: null, version: null, acceptance: null },
      assignment: null,
      externalPrize: null,
    },
    repositories: [{ id: repository, displayName: repository, githubUrl: `https://github.com/${repository}`, description: "Vault tooling.", integrationBranch: "main" }],
    skill: { id: `contribute-to-${projectId}`, publishAtRoot: false, sourcePath: "skills/project-contributor-template", publicPath: `/projects/${projectId}/skill.md` },
    reviewSkill: { id: `review-${projectId}-contributions`, sourcePath: "skills/project-reviewer-template" },
    rewardAsset: { network: "ethereum", kind: "stablecoin", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC" },
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
    funding: { mode: "direct-noncustodial", disclosure: "Funds go directly to the project wallet.", recordsPath: `funding/${projectId}`, addresses: [] },
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
    `R_${repositoryIdOf(projectId)}`,
    now,
    now,
  );
}

async function seedPrograms() {
  await publishRevision(vaultKit, 1, bountyTerms(vaultKit, [users.max], ownerLines));
  await publishRevision(plainKit, 1, bountyTerms(plainKit, [users.max]));
}

const programPath = (projectId: string) => `/projects/${projectId}/security`;
const summaryField = named("textbox", "Summary");
const descriptionField = named("textbox", "Description");
const submissionsOf = (user: User) => site.sql("SELECT id, project_id, idempotency_key FROM security_submissions WHERE reporter_github_id = ?", String(user.id));
const casesOf = (projectId: string) => site.sql("SELECT id FROM security_cases WHERE project_id = ? ORDER BY id", projectId);
const caseButton = (caseId: string) => named("button", `Case ${caseId.slice(-8)}`, { exact: false });
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

describe('Recover a report draft and an uncertain submission (spec/frontend/drafts.md, "Story: Recover a report draft and an uncertain submission"; spec/security/intake.md, "Story: Submit and recover one private report")', () => {
  it('a written report survives a reload, is reviewed and edited, and one send creates one receipt and one case (spec/frontend/drafts.md, "A draft belongs to one account and project"; spec/frontend/drafts.md, "Editing keeps storage failures visible and invalidates the reviewed content"; spec/security/journey.md, "The receipt creates the case and the first screening version under the program\'s terms")', async () => {
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

  it('a send whose answer is lost is recovered after a reload by retrying the same report under the same key (spec/frontend/drafts.md, "The first send fixes a key and retries keep that key and content"; spec/frontend/drafts.md, "A reviewed or submitted draft retains its account, project and content identity"; spec/security/intake.md, "A new attempt binds authenticated identity, passes admission and keeps its idempotency key")', async () => {
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

describe('Change accounts without disclosing the prior account\'s draft (spec/frontend/composition.md, "Story: Change accounts without disclosing the prior account\'s draft")', () => {
  it('signing out erases the report draft, and neither the next account nor the returning one sees it (spec/frontend/composition.md, "Account changes erase drafts and preserve every child invariant"; spec/frontend/composition.md, "The active draft and navigation share one authenticated actor")', async () => {
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

describe('Carry one report from durable receipt to a decision and optional forwarding (spec/security/journey.md, "Story: Carry one report from durable receipt to a decision and optional forwarding"; spec/security/cases.md, "Story: Obtain a human decision on every report the routine pass leaves open")', () => {
  it('the reporter and the current maintainer each see the case, an outsider sees none, and a maintainer whose role is revoked loses it (spec/security/cases.md, "Authority snapshots advance and triager membership is audited at the next revision"; spec/security/cases.md, "Current technical approvers and triagers request information on the current report version"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime")', async () => {
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
    await site.click(caseButton(caseId));
    await expect.poll(async () => (await searchOf()).get("case"), { timeout: journeyMs }).toBe(caseId);
    await shown(named("button", "Back to reports")).toMatchObject({ visible: true });
    await site.click(named("button", "Back to reports"));
    await expect.poll(async () => (await searchOf()).has("case"), { timeout: journeyMs }).toBe(false);
    await shown(caseButton(caseId)).toMatchObject({ visible: true });
    await signOut(users.rae.login);

    await signIn(users.out.login, "/security");
    await shown({ text: "No cases", exact: true }).toMatchObject({ visible: true });
    expect(await site.leaks(caseId.slice(-8))).toBe(false);
    await signOut(users.out.login);

    await signIn(users.max.login, `/security?case=${caseId}`);
    await shown(named("button", "Back to reports")).toMatchObject({ visible: true });
    await shown(named("region", "Case actions")).toMatchObject({ visible: true });
    await shown(caseButton(caseId)).toMatchObject({ visible: true });

    await publishRevision(vaultKit, 2, bountyTerms(vaultKit, [users.fin], ownerLines));
    await site.open("/security");
    await shown(named("heading", "Security cases", { level: 1 })).toMatchObject({ visible: true });
    await expect.poll(() => site.read(caseButton(caseId)), { timeout: journeyMs }).toMatchObject({ count: 0 });
    await shown(named("region", "Case actions")).toMatchObject({ count: 0 });
  });
});

describe('Decide an award under the terms that accompanied the report (spec/security/terms.md, "Story: Decide an award under the terms that accompanied the report")', () => {
  it('the published program lists the ten defaults, then the owner lines only when the terms carry them (spec/security/terms.md, "Exclusions are frozen with the terms and stay advice")', async () => {
    await site.open(programPath(vaultKit));
    const scope = named("region", "Scope");
    await shown(named("heading", "Does not qualify", { within: scope })).toMatchObject({ visible: true });
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

  it('only the steward manages the bounty, and the owner lines it publishes are stored trimmed and shown on the page and in the editor (spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"; spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled")', async () => {
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

describe('Read, acknowledge and escalate private case notices (spec/operations/notifications.md, "Story: Read, acknowledge and escalate private case notices")', () => {
  it('the Inbox pages notices, marks one or a whole page read, asks no acknowledgment of other notices and shows nothing of another account (spec/operations/notifications.md, "Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment"; spec/slopbot/assessmentInbox.md, "A read captures its actor, exact registry binding and response route")', async () => {
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

  it('a report receipt reaches the reporter\'s Inbox as a received notice that asks for no acknowledgment (spec/security/intake.md, "Only verified exact object bytes permit an atomic case and Inbox receipt"; spec/operations/notifications.md, "Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment")', async () => {
    await site.allow(...expectedFailures);
    await signIn(users.rae.login, programPath(vaultKit));
    await writeReport("Fee rounding moves dust to the owner", "The withdrawal fee rounds up on every leg, which the attached test sums to a loss.");
    await site.click(named("button", "Review report"));
    await site.click(named("button", "Submit private report"));
    await shown(named("heading", "Report received")).toMatchObject({ visible: true });

    await site.open("/inbox");
    const received = named("link", "received: Open security cases", { exact: false });
    await shown(received).toMatchObject({ visible: true, href: expect.stringContaining("/security") });
    await shown(named("button", "Acknowledge:", { exact: false })).toMatchObject({ count: 0 });
    await site.click(named("button", "Mark as read:", { exact: false }));
    await expect
      .poll(() => site.sql("SELECT count(*) AS unread FROM notifications WHERE recipient_github_id = ? AND kind = 'security_report_received' AND read_at IS NULL", String(users.rae.id)), { timeout: journeyMs })
      .toEqual([{ unread: 0 }]);
  });
});

describe('The author appeals and Slopbot triages first (spec/slopbot/appeals.md, "Story: The author appeals and Slopbot triages first"; spec/slopbot/appeals.md, "Story: The draft is accepted or rejected, and escalated appeals go to a moderator")', () => {
  it('an escalated contribution appeal opens from the moderator Inbox, is marked read, and shows its resolution (spec/slopbot/appeals.md, "Only a moderator other than the appellant decides an escalated appeal"; spec/operations/notifications.md, "Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment")', async () => {
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

describe('A recipient disputes their own current Points record privately (spec/points/disputes.md, "Story: A recipient disputes their own current Points record privately")', () => {
  it('the recipient files one review with a reason from the Inbox, and a moderator other than the recipient decides it once it escalates (spec/points/disputes.md, "Only the recipient of the current revision files, and a repeated filing returns the first"; spec/points/disputes.md, "Only a moderator other than the recipient reads and decides an escalated dispute, once, with a reason")', async () => {
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
