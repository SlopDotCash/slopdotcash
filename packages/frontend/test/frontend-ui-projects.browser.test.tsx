// spec/frontend/projectLinks.md, "The project page names each vault network once, with its asset only when every vault on it agrees, and shows the website and X account only when present"; spec/backend/projects.md, "Owner revisions publish at once against the expected revision"
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { at, named, shown, signIn, signOut, site } from "./support/ui/browser.ts";
import type { Target } from "./support/ui/protocol.ts";

const users = {
  oli: { id: 2001, login: "octo-oli" },
  pia: { id: 2002, login: "octo-pia" },
  eli: { id: 2003, login: "octo-eli" },
  ron: { id: 2004, login: "octo-ron" },
  sam: { id: 2005, login: "octo-sam" },
  tia: { id: 2006, login: "octo-tia" },
  uma: { id: 2007, login: "octo-uma" },
  root: { id: 9001, login: "octo-root" },
  operator: { id: 18633264, login: "octo-operator" },
} as const;

type User = (typeof users)[keyof typeof users];

const roles = { ADMIN_GITHUB_IDS: "9001", PROJECT_MODERATOR_GITHUB_IDS: "9001", OPERATOR_GITHUB_IDS: "9001,18633264" };
const refusedLoads = "^console Failed to load resource: the server responded with a status of 40[0139]";
const missingSnapshots = ["^404 GET /data/", "^console Failed to load resource: the server responded with a status of 404"] as const;
const settings = named("heading", "Settings", { level: 1 });
const publish = named("button", "Publish changes");
const closure = named("checkbox", "Slopbot may close Slop-skill PRs · authors can appeal");
const readyLabel = named("checkbox", "Label pull requests that are ready to merge");
const field = (label: string): Target => ({ label });
const text = (value: string, exact = false): Target => ({ text: value, exact });
const within = (outer: Target, inner: Target): Target => ({ ...inner, within: outer });

let repositoryIds = 70_000;

async function repository(owner: User, name: string, more: { readonly fork?: boolean; readonly archived?: boolean; readonly installed?: boolean } = {}) {
  repositoryIds += 1;
  await site.repository({ id: repositoryIds, owner: owner.login, name, fork: more.fork ?? false, archived: more.archived ?? false, license: "MIT", files: { "README.md": `# ${name}\n`, "CONTRIBUTING.md": "Open a pull request against main.\n" } });
  await site.permission(`${owner.login}/${name}`, owner.login, "admin");
  if (more.installed ?? true) await site.installation({ id: repositoryIds, account: owner.login, repositories: [`${owner.login}/${name}`] });
  return `${owner.login}/${name}`;
}

async function chooseRepository(fullName: string) {
  if ((await site.read(named("textbox", "GitHub repository"))).count === 0) await site.select(field("GitHub repository"), "Enter repository…");
  await site.fill(named("textbox", "GitHub repository"), fullName);
  await shown(field("Integration branch")).toMatchObject({ disabled: false });
  await site.select(field("Integration branch"), "main");
}

async function fillProject(fullName: string, name: string, links: { readonly website?: string; readonly x?: string } = {}) {
  await chooseRepository(fullName);
  await site.fill(field("Project name"), name);
  await site.fill(field("Short description"), `${name} keeps its engine fast and correct.`);
  await site.fill(field("Goal"), `Make ${name} the dependable engine contributors reach for first.`);
  if (links.website !== undefined) await site.fill(field("Website (optional)"), links.website);
  if (links.x !== undefined) await site.fill(field("X account (optional)"), links.x);
  await site.fill(field("Acceptance criteria"), "Every change ships with a passing test and a short note.");
}

async function createProject(owner: User, fullName: string, name: string, links: { readonly website?: string; readonly x?: string } = {}): Promise<string> {
  await signIn(owner.login, "/projects/new");
  await fillProject(fullName, name, links);
  await site.click(named("button", "Next"));
  await shown(field("Points only")).toMatchObject({ checked: true });
  await site.click(named("button", "Next"));
  await shown(named("article", "Listing preview")).toMatchObject({ text: expect.stringContaining(name) as unknown });
  await site.click(named("button", "Create project"));
  await shown(named("heading", "Project created", { level: 1 })).toMatchObject({ focused: true });
  await site.click(named("link", "Manage project"));
  await expect.poll(async () => new URL(await site.where()).pathname, { timeout: 30_000 }).toMatch(/^\/projects\/[^/]+\/manage$/u);
  const id = decodeURIComponent(new URL(await site.where()).pathname.split("/")[2] ?? "");
  await shown(publish).toMatchObject({ visible: true });
  await shown(text("Check details", true)).toMatchObject({ visible: true });
  return id;
}

async function manage(id: string, tab?: string) {
  await site.open(`/projects/${encodeURIComponent(id)}/manage`, tab);
  await shown(publish).toMatchObject({ visible: true });
  await shown(text("Check details", true)).toMatchObject({ visible: true });
}

const shareField = field("Maintainer share (%, 0 to 30, optional)");
const capField = field("Pause new contributors when this many outside pull requests are open (optional)");
const groupProbes: Readonly<Record<string, Target>> = { "Project listing": field("Short description"), "Contribution rules": field("Acceptance criteria"), Repositories: field("GitHub repository"), "Monthly rewards": shareField };

async function openGroup(summary: string) {
  if ((await site.read(groupProbes[summary] ?? field(summary))).count === 0) await site.click(text(summary, true));
}

const cycleOf = (monthsAhead: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAhead, 1));
};
const cycleText = (monthsAhead: number) => cycleOf(monthsAhead).toISOString().slice(0, 7);
const monthName = (monthsAhead: number) => new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(cycleOf(monthsAhead));
const deciders = "split among the maintainers who merge or close outside pull requests";

const revisions = (id: string) =>
  site.sql(
    "SELECT revision, json_extract(manifest, '$.status') AS status, json_extract(manifest, '$.headline') AS headline, json_extract(manifest, '$.links') AS links, json_extract(manifest, '$.slopbot') AS slopbot, json_extract(manifest, '$.repositories') AS repositories, actor_github_login FROM project_revisions WHERE project_id = ? ORDER BY revision",
    id,
  );

const lastRevision = async (id: string) => (await revisions(id)).at(-1);
const parsed = (value: unknown): unknown => (typeof value === "string" ? JSON.parse(value) : value);
const rewardOf = async (id: string) => parsed((await site.sql("SELECT json_extract(manifest, '$.reward') AS reward FROM projects WHERE id = ?", id))[0]?.reward) as Readonly<Record<string, unknown>>;
const closes = (row: Readonly<Record<string, unknown>> | undefined) => (parsed(row?.slopbot) as { readonly automaticClosure?: boolean } | null)?.automaticClosure === true;
const writes = async (id: string) => (await site.sent()).filter((sent) => sent.method !== "GET" && sent.path.startsWith(`/api/v1/projects/${id}`));

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const privateScanFinding = "Private fixture finding text";
const privateScanGap = "Private fixture coverage note";
const privateScanPath = "slop-skill-template/private-fixture.md";

async function incompleteAssessment(projectId: string, id: string, repository?: string) {
  const commit = "c".repeat(40);
  const template = "d".repeat(64);
  const at = new Date().toISOString();
  const [current] = await site.sql("SELECT revision, manifest_sha256 FROM projects WHERE id = ?", projectId);
  const assessed = { commitSha: commit, templateSha256: template };
  const result = JSON.stringify({
    schemaVersion: "slop-vetting-result-v2",
    assessmentId: id,
    disposition: "incomplete",
    assessed,
    ...(repository === undefined ? {} : {
      projectId,
      revision: current?.revision,
      manifestSha256: current?.manifest_sha256,
      policyVersion: "fixture",
      assessed: { ...assessed, repository, inputManifestSha256: "a".repeat(64), dependencyLocks: [] },
      scan: { runId: "scan-1", startedAt: new Date(Date.now() - 1000).toISOString(), completedAt: at, reportSha256: "b".repeat(64) },
      coverage: Object.fromEntries(["source", "manifests", "dependencies", "installScripts", "downloads", "agentInstructions"].map((surface) => [surface, { state: "complete", items: 1 }])),
      checks: Object.fromEntries(["wallet-drainer", "credential-theft", "secret-exfiltration", "unsafe-execution", "prompt-injection"].map((check) => [check, "passed"])),
      visibilityGaps: [privateScanGap],
      execution: null,
      reusedAssessmentId: null,
      primaryReview: { provider: "fixture", model: "fixture-reviewer", promptPolicyRevision: "fixture-policy", inputManifestSha256: "a".repeat(64), runId: "primary", status: "completed", verdict: "findings", risk: "ambiguous", findingCount: 1 },
      specialistReview: { provider: "fixture", model: "fixture-reviewer", promptPolicyRevision: "fixture-policy", inputManifestSha256: "a".repeat(64), runId: "specialist", status: "completed", verdict: "findings", risk: "ambiguous", findingCount: 1 },
      artifacts: [],
      findings: [{ severity: "medium", category: "other", summary: privateScanFinding, evidence: privateScanPath }],
      confirmation: null,
    }),
  });
  await site.sql(
    "INSERT INTO vetting_assessments(id, project_id, revision, manifest_sha256, content_sha256, commit_sha, template_sha256, requested_by_github_id, requested_by_github_login, requested_at, request_reason, state, policy_version, result, result_sha256, signing_key_sha256, completed_at) SELECT ?, id, revision, manifest_sha256, ?, ?, ?, '9001', 'octo-root', ?, 'Browser journey fixture', 'incomplete', 'fixture', ?, ?, ?, ? FROM projects WHERE id = ?",
    id, "b".repeat(64), commit, template, at, result, await sha256(result), "e".repeat(64), at, projectId,
  );
}

beforeEach(async () => {
  await site.start();
  await site.deploy(roles);
  await site.allow(...missingSnapshots);
  for (const user of Object.values(users)) await site.user(user.id, user.login);
});

afterEach(async () => {
  expect(await site.popups()).toBe(0);
  expect(await site.diagnostics()).toEqual({ console: [], failed: [] });
});

afterAll(() => site.stop());

// spec/frontend/presentation.md, "Story: Complete project setup with explicit independent readiness"; spec/backend/projects.md, "Story: Create or publish a project without routine approval"; spec/frontend/projectDrafts.md, "Story: Keep a project setup draft per browser document"
describe("Complete project setup with explicit independent", () => {
  // spec/frontend/projectDrafts.md, "A project setup draft belongs to one live document slot that a duplicated tab cannot take"; spec/frontend/projectDrafts.md, "Each saved setup draft has a strictly greater revision than the record it replaces"; spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"; spec/backend/projects.md, "Creation and stored-application publication record a paused revision 1"
  it("the setup draft survives a reload, a second document", async () => {
    const fullName = await repository(users.oli, "engine");
    await signIn(users.oli.login, "/projects/new");
    await shown(field("Setup steps")).toMatchObject({ text: expect.stringContaining("Rewards") as unknown });
    await shown(closure).toMatchObject({ checked: false });
    for (const choice of ["Ask outside contributors for a refundable submission fee", "List the issues you most want done", "Ask reporters for a refundable SLOP deposit"]) await shown(named("checkbox", choice)).toMatchObject({ checked: true });
    await fillProject(fullName, "Engine", { x: "@elizaOS" });
    await expect.poll(async () => (await site.read(text("Saving draft…"))).count, { timeout: 30_000 }).toBe(0);

    await site.open("/projects/new");
    await shown(field("Project name")).toMatchObject({ value: "Engine" });
    await shown(closure).toMatchObject({ checked: false });

    await site.open("/projects/new", "copy");
    await shown(field("Project name")).toMatchObject({ value: "Engine" });
    await site.fill(field("Project name"), "Engine copy");
    await expect.poll(async () => (await site.read(text("Saving draft…"))).count, { timeout: 30_000 }).toBe(0);
    await site.tab("main");
    await site.open("/projects/new");
    await shown(field("Project name")).toMatchObject({ value: "Engine" });
    await shown(field("Integration branch")).toMatchObject({ disabled: false });

    await site.click(named("button", "Next"));
    await shown(field("Points only")).toMatchObject({ checked: true });
    await site.click(named("button", "Next"));
    await shown(named("article", "Listing preview")).toMatchObject({ text: expect.stringContaining("Engine") as unknown });
    await shown(text("Auto-close")).toMatchObject({ visible: true });
    await site.click(named("button", "Create project"));
    await shown(named("heading", "Project created", { level: 1 })).toMatchObject({ focused: true });
    await shown(text("GitHub access", true)).toMatchObject({ visible: true });
    await shown(text("Slopbot", true)).toMatchObject({ visible: true });
    await shown(text("Security scan", true)).toMatchObject({ visible: true });
    await shown(text("Passed", true)).toMatchObject({ count: 0 });
    const href = (await site.read(named("link", "Manage project"))).href ?? "";
    const id = decodeURIComponent(href.split("/")[2] ?? "");
    await site.click(named("button", "Add another"));
    await shown(field("Project name")).toMatchObject({ value: "" });
    await site.open("/projects/new");
    await shown(field("Project name")).toMatchObject({ value: "" });

    await manage(id);
    expect(await revisions(id)).toEqual([expect.objectContaining({ revision: 1, status: "paused", actor_github_login: users.oli.login })]);
    expect(closes(await lastRevision(id))).toBe(false);
    expect(await site.sql("SELECT project_id FROM project_repositories WHERE repository_key = ?", fullName.toLowerCase())).toEqual([{ project_id: id }]);

    const checks = () => site.sent().then((sent) => sent.filter((each) => each.method === "POST" && each.path === `/api/v1/project-setup/${id}/check`).length);
    const before = await checks();
    await shown(named("button", "Check again")).toMatchObject({ visible: true, disabled: false });
    await site.click(named("button", "Check again"));
    await expect.poll(checks, { timeout: 30_000 }).toBe(before + 1);
    await shown(named("button", "Check again")).toMatchObject({ visible: true, disabled: false });
    await manage(id);
    await shown(named("button", "Check again")).toMatchObject({ visible: true });
    expect(await checks()).toBe(before + 2);
  });

  // spec/backend/projects.md, "Authority is one read bound to the acting account and the stored repository"
  it("a repository already on Slop is refused at creation", async () => {
    await site.allow(refusedLoads, "^409 POST /api/v1/projects$");
    const fullName = await repository(users.pia, "listed");
    const id = await createProject(users.pia, fullName, "Listed");
    await site.open("/projects/new");
    await fillProject(fullName, "Listed again");
    await site.click(named("button", "Next"));
    await site.click(named("button", "Next"));
    await site.click(named("button", "Create project"));
    await shown(named("alert")).toMatchObject({ text: expect.stringContaining("is already li") as unknown });
    expect(await site.sql("SELECT project_id FROM project_repositories WHERE repository_key = ?", fullName.toLowerCase())).toEqual([{ project_id: id }]);
  });
});

// spec/backend/projects.md, "Story: Maintain a live project with current GitHub authority"
describe("Maintain a live project with current GitHub authority", () => {
  // spec/backend/projects.md, "Owner revisions publish at once against the expected revision"
  it("owners publish and clear the website and X account", async () => {
    await site.allow(refusedLoads, "^404 GET /data/", "^console Failed to load resource: the server responded with a status of 404", "^failed GET /\\S+ net::ERR_ABORTED$");
    const fullName = await repository(users.eli, "eliza");
    const id = await createProject(users.eli, fullName, "Eliza", { x: "@elizaOS" });
    await openGroup("Project listing");
    await shown(field("X account (optional)")).toMatchObject({ value: "@elizaOS" });

    const mark = (await writes(id)).length;
    await site.click(publish);
    await shown(text("Nothing changed.", true)).toMatchObject({ visible: true });
    expect((await writes(id)).length).toBe(mark);

    await site.fill(field("Website (optional)"), "http://elizaos.example");
    await site.click(publish);
    await shown(text("Use an https:// address.", true)).toMatchObject({ visible: true });
    expect((await writes(id)).length).toBe(mark);
    expect((await revisions(id)).length).toBe(1);

    await site.fill(field("Website (optional)"), "elizaos.example");
    await site.fill(field("X account (optional)"), "https://twitter.com/elizaOS_ai");
    const changes = named("region", "Changes");
    await shown({ text: "Live now", exact: true, within: changes }).toMatchObject({ count: 2 });
    await shown({ text: "Rescan", within: changes }).toMatchObject({ count: 0 });
    await site.click(publish);
    await shown(text("Rev 2", true)).toMatchObject({ visible: true });
    await shown(named("img", "Draft saved on this device")).toMatchObject({ visible: true });
    expect(parsed((await lastRevision(id))?.links)).toEqual({ repository: `https://github.com/${fullName}`, issues: `https://github.com/${fullName}/issues`, website: "https://elizaos.example", x: "https://x.com/elizaOS_ai" });

    expect((await site.open(`/projects/${encodeURIComponent(id)}`)).status).toBe(200);
    await shown(named("link", "elizaos.example")).toMatchObject({ visible: true, href: "https://elizaos.example" });
    await shown(named("link", "@elizaOS_ai")).toMatchObject({ visible: true, href: "https://x.com/elizaOS_ai" });

    await manage(id);
    await openGroup("Project listing");
    await site.fill(field("X account (optional)"), "");
    await site.click(publish);
    await shown(text("Rev 3", true)).toMatchObject({ visible: true });
    await shown(named("img", "Draft saved on this device")).toMatchObject({ visible: true });
    expect(parsed((await lastRevision(id))?.links)).toEqual({ repository: `https://github.com/${fullName}`, issues: `https://github.com/${fullName}/issues`, website: "https://elizaos.example" });

    expect((await site.open(`/projects/${encodeURIComponent(id)}`)).status).toBe(200);
    await shown(named("link", "elizaos.example")).toMatchObject({ visible: true, href: "https://elizaos.example" });
    await shown(named("link", "@elizaOS_ai")).toMatchObject({ count: 0 });
  });

  // spec/frontend/readyLabelForm.md, "The control starts off with the defaults when nothing is saved, saves only bounded settings while on, and keeps the owner's numbers when turned off"; spec/backend/readyLabelSettings.md, "Ready-label settings are bounded, off when absent or disabled, and only add protected paths"
  it("the ready label starts off at 1/400/20, refuses 11", async () => {
    await site.allow(refusedLoads);
    const fullName = await repository(users.ron, "ready");
    const id = await createProject(users.ron, fullName, "Ready");
    await openGroup("Contribution rules");
    await shown(readyLabel).toMatchObject({ checked: false });
    await site.click(readyLabel);
    await shown(field("Approvals required")).toMatchObject({ value: "1" });
    await shown(field("Most changed lines")).toMatchObject({ value: "400" });
    await shown(field("Most changed files")).toMatchObject({ value: "20" });

    const mark = (await writes(id)).length;
    await site.fill(field("Approvals required"), "11");
    await site.click(publish);
    await shown(text("Enter a whole number from 1 to 10.", true)).toMatchObject({ visible: true });
    expect((await writes(id)).length).toBe(mark);

    await site.fill(field("Approvals required"), "2");
    await shown(text("On: 2 approvals, at most 400 lines in 20 files", true)).toMatchObject({ visible: true });
    await site.click(publish);
    await expect.poll(async () => (await lastRevision(id))?.revision, { timeout: 30_000 }).toBe(2);
    expect(parsed((await lastRevision(id))?.slopbot)).toMatchObject({ readyLabel: { enabled: true, approvals: 2, maxChangedLines: 400, maxChangedFiles: 20, protectedPaths: [] } });

    await manage(id);
    await openGroup("Contribution rules");
    await shown(readyLabel).toMatchObject({ checked: true });
    await site.click(readyLabel);
    await site.click(publish);
    await expect.poll(async () => (await lastRevision(id))?.revision, { timeout: 30_000 }).toBe(3);
    expect(parsed((await lastRevision(id))?.slopbot)).toMatchObject({ readyLabel: { enabled: false, approvals: 2, maxChangedLines: 400, maxChangedFiles: 20 } });
  });

  // spec/backend/projects.md, "Automatic-closure consent changes only by an owner revision or an administrator exception"; spec/backend/projects.md, "Owner revisions publish at once against the expected revision"
  it("one Publish carries consent and headline as revision", async () => {
    await site.allow(refusedLoads);
    const fullName = await repository(users.sam, "consent");
    const id = await createProject(users.sam, fullName, "Consent");
    await shown(closure).toMatchObject({ checked: false });
    await site.click(closure);
    await openGroup("Project listing");
    await site.fill(field("Short description"), "Consent keeps its engine honest.");
    await site.click(publish);
    await expect.poll(async () => (await lastRevision(id))?.revision, { timeout: 30_000 }).toBe(2);
    expect(await lastRevision(id)).toMatchObject({ headline: "Consent keeps its engine honest." });
    expect(closes(await lastRevision(id))).toBe(true);

    await manage(id);
    await shown(closure).toMatchObject({ checked: true });
    await site.click(closure);
    await site.click(publish);
    await expect.poll(async () => (await lastRevision(id))?.revision, { timeout: 30_000 }).toBe(3);
    expect(closes(await lastRevision(id))).toBe(false);

    await manage(id);
    await openGroup("Project listing");
    await site.fill(field("Short description"), "A draft from the older revision.");
    await expect.poll(async () => (await site.read(named("img", "Draft saved on this device"))).count, { timeout: 30_000 }).toBe(1);
    await signOut(users.sam.login);
    await signIn(users.root.login, `/admin?project=${encodeURIComponent(id)}&section=settings`);
    await site.fill(field("Project name"), "Consent, renamed");
    await site.fill({ label: "Reason", exact: false }, "Rename for browser journey.");
    await site.click(named("button", "Save revision 4"));
    await expect.poll(async () => (await lastRevision(id))?.revision, { timeout: 30_000 }).toBe(4);
    await signOut(users.root.login);

    await signIn(users.sam.login, `/projects/${encodeURIComponent(id)}/manage`);
    await shown(text("Draft is from rev 3; now rev 4.", true)).toMatchObject({ visible: true });
    await shown(publish).toMatchObject({ disabled: true });
    await site.click(named("button", "Keep"));
    await shown(publish).toMatchObject({ disabled: false });
    await site.click(publish);
    await expect.poll(async () => (await lastRevision(id))?.revision, { timeout: 30_000 }).toBe(5);
    expect(await lastRevision(id)).toMatchObject({ headline: "A draft from the older revision." });
  });

  // spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"; spec/backend/projects.md, "A current repository administrator moves the integration branch with a committed declaration"
  it("adding a repository refuses a fork, an archived and", async () => {
    await site.allow(refusedLoads);
    const fullName = await repository(users.tia, "core");
    const fork = await repository(users.tia, "core-fork", { fork: true });
    const attic = await repository(users.tia, "attic", { archived: true });
    const extra = await repository(users.tia, "extras");
    const id = await createProject(users.tia, fullName, "Core");
    await openGroup("Repositories");
    await site.click(named("button", "Change integration branch"));
    await shown(text("No other branch head is available.", true)).toMatchObject({ visible: true });
    await shown(field("New integration branch")).toMatchObject({ count: 0 });

    const add = async (name: string) => {
      await site.fill(named("textbox", "GitHub repository"), name);
      await site.click(named("button", "Add"));
    };
    await add(fork);
    await shown(text(`${fork} is a fork. Add the original repository instead.`, true)).toMatchObject({ visible: true });
    await add(attic);
    await shown(text(`${attic} is archived on GitHub.`, true)).toMatchObject({ visible: true });
    await add(fullName);
    await shown(text(`${fullName} is already listed.`, true)).toMatchObject({ visible: true });
    await add(extra);
    await shown(named("button", `Remove ${extra}`)).toMatchObject({ visible: true });
    await shown(text("an active project pauses until the scan clears")).toMatchObject({ visible: true });

    await site.click(publish);
    await expect.poll(async () => (await lastRevision(id))?.revision, { timeout: 30_000 }).toBe(2);
    const now = new Date();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
    const repositories = parsed((await lastRevision(id))?.repositories) as ReadonlyArray<{ readonly id: string; readonly countsFrom?: string }>;
    expect(repositories.find((entry) => entry.id.toLowerCase() === extra.toLowerCase())?.countsFrom?.slice(0, 7)).toBe(nextMonth);
    expect(await lastRevision(id)).toMatchObject({ status: "paused" });
  });

  // spec/backend/projects.md, "A current repository administrator moves the integration branch with a committed declaration"
  it("the owner moves the integration branch to a branch", async () => {
    await site.allow(refusedLoads, "^409 PUT /api/v1/projects/");
    const fullName = await repository(users.eli, "routing");
    const id = await createProject(users.eli, fullName, "Routing");
    const [record] = await site.sql("SELECT manifest FROM projects WHERE id = ?", id);
    const manifest = parsed(record?.manifest) as { readonly terms: { readonly revision: unknown }; readonly authority: { readonly repositoryId: unknown }; readonly steward: { readonly github: { readonly actorId: unknown; readonly nodeId: unknown } } };
    const branch = "proof-routing";
    const guide = "Work from proof-routing and show evidence in each pull request.";
    const declaration = {
      kind: "slop-project-authority",
      schemaVersion: "1",
      projectId: id,
      policyRevision: manifest.terms.revision,
      repository: { fullName, id: manifest.authority.repositoryId, integrationBranch: branch },
      steward: { actorId: manifest.steward.github.actorId, nodeId: manifest.steward.github.nodeId },
    };
    await site.branch(fullName, branch, { ".github/slop-project.json": JSON.stringify(declaration) });

    const load = named("button", "Change integration branch");
    await openGroup("Repositories");
    await site.click(load);
    await site.select(field("New integration branch"), branch);
    await openGroup("Contribution rules");
    await openGroup("More rules");
    await site.fill(field("Contribution guide"), guide);
    await site.branch(fullName, branch, { "NOTES.md": "The head moved after the branches were read.\n" });
    await site.click(publish);
    await shown(text("The GitHub branch moved. Reload and verify its current head.")).toMatchObject({ visible: true });
    expect((await revisions(id)).length).toBe(1);

    await site.click(load);
    await site.select(field("New integration branch"), branch);
    await site.click(publish);
    await expect.poll(async () => (await lastRevision(id))?.revision, { timeout: 30_000 }).toBe(2);
    const [primary] = parsed((await lastRevision(id))?.repositories) as ReadonlyArray<{ readonly integrationBranch?: string }>;
    expect(primary?.integrationBranch).toBe(branch);
    expect(await site.sql("SELECT json_extract(manifest, '$.contribution.contributionGuide') AS guide, status FROM projects WHERE id = ?", id)).toEqual([{ guide, status: "paused" }]);
  });

  // spec/backend/projects.md, "Authority is one read bound to the acting account and the stored repository"
  it("access is checked against current GitHub authority", async () => {
    await site.allow(refusedLoads, "^console Failed to load resource: the server responded with a status of 50[23]", "^40[0139] (PUT|POST) /api/v1/projects/", "^(40[13]|50[23]) GET /api/v1/project-setup/");
    const fullName = await repository(users.uma, "authority");
    const id = await createProject(users.uma, fullName, "Authority");

    await site.githubFail(`/repos/${fullName}/collaborators/`, 503);
    await site.open(`/projects/${encodeURIComponent(id)}/manage`);
    await shown(text("Project access could not be checked. Retry.")).toMatchObject({ visible: true });
    await site.click(named("button", "Retry"));
    await shown(settings).toMatchObject({ visible: true });
    await shown(text("GitHub access", true)).toMatchObject({ visible: true });

    await signOut(users.uma.login);
    await signIn(users.pia.login, `/projects/${encodeURIComponent(id)}/manage`);
    await shown(text("Maintainers only", true)).toMatchObject({ visible: true });
    await shown(publish).toMatchObject({ count: 0 });
    const forged = await site.fetch("PUT", `/api/v1/projects/${encodeURIComponent(id)}`, { expectedRevision: 1, manifest: { id, headline: "A stranger's headline." } });
    expect(forged.status).toBeGreaterThanOrEqual(400);
    const removal = await site.fetch("POST", `/api/v1/projects/${encodeURIComponent(id)}/remove`, { expectedRevision: 1 });
    expect(removal.status).toBeGreaterThanOrEqual(400);
    expect(await revisions(id)).toHaveLength(1);

    await signOut(users.pia.login);
    await signIn(users.uma.login, `/projects/${encodeURIComponent(id)}/manage`);
    await shown(settings).toMatchObject({ visible: true });
    await shown(text("GitHub access", true)).toMatchObject({ visible: true });
    await site.permission(fullName, users.uma.login, "read");
    await site.open(`/projects/${encodeURIComponent(id)}/manage`);
    await shown(text("Maintainers only", true)).toMatchObject({ visible: true });
    expect((await site.fetch("POST", `/api/v1/projects/${encodeURIComponent(id)}/remove`, { expectedRevision: 1 })).status).toBeGreaterThanOrEqual(400);
    expect(await site.sql("SELECT status FROM projects WHERE id = ?", id)).toEqual([{ status: "paused" }]);
  });

  // spec/backend/intakeCap.md, "A recent count at or above the cap of an active project pauses it"; spec/backend/intakeCap.md, "Story: Pause new contributors while the review queue is full"
  it("the owner sets, changes and clears the intake cap: 0", async () => {
    await site.allow(refusedLoads);
    const fullName = await repository(users.pia, "intake");
    const id = await createProject(users.pia, fullName, "Intake");
    await openGroup("Contribution rules");
    await shown(capField).toMatchObject({ value: "" });

    const mark = (await writes(id)).length;
    await site.fill(capField, "0");
    await site.click(publish);
    await shown(text("Enter a whole number from 1 to 500, or leave it empty.", true)).toMatchObject({ visible: true });
    expect((await writes(id)).length).toBe(mark);
    expect((await revisions(id)).length).toBe(1);

    await site.fill(capField, "20");
    const changes = named("region", "Changes");
    await shown({ text: "At 20 open outside pull requests", within: changes }).toMatchObject({ visible: true });
    await shown({ text: "Live now", exact: true, within: changes }).toMatchObject({ visible: true });
    await site.click(publish);
    await expect.poll(async () => (await lastRevision(id))?.revision, { timeout: 30_000 }).toBe(2);
    expect(closes(await lastRevision(id))).toBe(false);
    expect(parsed((await lastRevision(id))?.slopbot)).toMatchObject({ intakeCap: 20 });

    await manage(id);
    await openGroup("Contribution rules");
    await shown(capField).toMatchObject({ value: "20" });
    await site.fill(capField, "");
    await site.click(publish);
    await expect.poll(async () => (await lastRevision(id))?.revision, { timeout: 30_000 }).toBe(3);
    expect((parsed((await lastRevision(id))?.slopbot) as { readonly intakeCap?: unknown }).intakeCap).toBeUndefined();
  });

  // spec/backend/projects.md, "A current maintainer removes a project and a lost reply can be retried"; spec/ui/confirmation.md, "Only an explicit confirm starts the work"
  it("removal is asked once, a stale revision keeps the", async () => {
    await site.allow(refusedLoads, "^409 POST /api/v1/projects/[^/]+/remove$", "^404 GET /api/v1/projects/");
    const fullName = await repository(users.oli, "removable");
    const id = await createProject(users.oli, fullName, "Removable");
    const projectPath = `/api/v1/projects/${encodeURIComponent(id)}`;
    const removals = async () => (await site.sent()).filter((sent) => sent.method === "POST" && sent.path === `/api/v1/projects/${id}/remove`).length;
    const dialog = named("alertdialog", "Remove Removable from Slop?");

    await site.click(named("button", "Remove project"));
    await shown(dialog).toMatchObject({ visible: true });
    await site.click(within(dialog, named("button", "Keep project")));
    await shown(dialog).toMatchObject({ count: 0 });
    expect(await removals()).toBe(0);

    await manage(id, "other");
    await openGroup("Project listing");
    await site.fill(field("Short description"), "Removable changed in another tab.");
    await site.click(publish);
    await expect.poll(async () => (await lastRevision(id))?.revision, { timeout: 30_000 }).toBe(2);

    await site.tab("main");
    await site.click(named("button", "Remove project"));
    await site.click(within(dialog, named("button", "Remove project")));
    await shown(within(dialog, named("button", "Reload"))).toMatchObject({ visible: true });
    await shown(dialog).toMatchObject({ visible: true });
    expect(await site.sql("SELECT status FROM projects WHERE id = ?", id)).toEqual([{ status: "paused" }]);

    await site.hold("GET", projectPath);
    try {
      await site.click(within(dialog, named("button", "Reload")));
      await shown(within(dialog, named("button", "Reload"))).toMatchObject({ visible: true });
    } finally {
      await site.release("GET", projectPath);
    }
    await shown(dialog).toMatchObject({ count: 0 });
    await shown(settings).toMatchObject({ visible: true });
    await shown(named("button", "Remove project")).toMatchObject({ focused: true });
    await site.click(named("button", "Remove project"));
    await site.click(within(dialog, named("button", "Remove project")));
    await shown(named("heading", "Project removed", { level: 1 })).toMatchObject({ visible: true });
    expect(await removals()).toBe(2);
    expect((await lastRevision(id))?.revision).toBe(3);
    expect(await site.diagnostics()).toEqual({ console: [], failed: [] });
    await site.allow("^console Failed to load resource: the server responded with a status of 404 \\(Not Found\\)$");
    expect((await site.fetch("GET", projectPath)).status).toBe(404);
  });
});

// spec/backend/projects.md, "Story: Administrators handle exceptions and restrictions, not routine approval"; spec/frontend/projectDrafts.md, "Story: Keep an administrator's manifest edit until it is accepted"
describe("Administrators handle exceptions and restrictions", () => {
  // spec/frontend/projectDrafts.md, "An administrator's manifest draft is cleared only after its exact submitted text was accepted or on discard"; spec/backend/projects.md, "Administrators hold, delist, change the steward or place a project"; spec/backend/projects.md, "A restriction retires the listing and reinstatement restores only a paused Community listing"; spec/fees/feeReport.md, "Only an administrator reads the fee report, and it never contains a signed transaction or secret"
  it("a non-admin sees \"Admins only\", the admin's manifest", async () => {
    await site.allow(refusedLoads, "^403 (GET|PUT|POST) /api/v1/admin/");
    const fullName = await repository(users.pia, "governed");
    const id = await createProject(users.pia, fullName, "Governed");
    await shown(named("link", "Admin")).toMatchObject({ count: 0 });
    const forged = await site.fetch("PUT", `/api/v1/admin/projects/${encodeURIComponent(id)}/manifest`, { expectedRevision: 1, manifest: { id, listingTier: "featured" } });
    expect(forged.status).toBe(403);
    await site.open("/admin");
    await shown(text("Admins only", true)).toMatchObject({ visible: true });
    await signOut(users.pia.login);

    const editor = `/admin?project=${encodeURIComponent(id)}&section=settings`;
    await signIn(users.root.login, "/admin");
    await site.fill(field("Find a project"), "Governed");
    await shown(text(id)).toMatchObject({ visible: true });

    await site.open(editor);
    await site.fill(field("Project name"), "Governed by admins");
    await site.open(editor);
    await shown(field("Project name")).toMatchObject({ value: "Governed by admins" });
    await site.click(named("button", "Discard draft"));
    await shown(field("Project name")).toMatchObject({ value: "Governed" });
    await site.open(editor);
    await shown(field("Project name")).toMatchObject({ value: "Governed" });

    await site.fill(field("Project name"), "Governed by admins");
    await site.fill({ label: "Reason", exact: false }, "Admin rename for browser journey.");
    await site.click(named("button", "Save revision 2"));
    await expect.poll(async () => (await lastRevision(id))?.revision, { timeout: 30_000 }).toBe(2);
    expect(await lastRevision(id)).toMatchObject({ actor_github_login: users.root.login });
    await site.open(editor);
    await shown(field("Project name")).toMatchObject({ value: "Governed by admins" });
    await shown(named("checkbox", "Featured")).toMatchObject({ disabled: false });

    await site.open(`/admin?project=${encodeURIComponent(id)}&section=overview`);
    const delists = async () => (await site.sent()).filter((sent) => sent.method !== "GET" && sent.path.includes("/delist")).length;
    await site.click(named("button", "Delist"));
    await shown(named("alertdialog", "Delist?")).toMatchObject({ visible: true });
    await site.click(within(named("alertdialog", "Delist?"), named("button", "Cancel")));
    expect(await delists()).toBe(0);
    expect((await revisions(id)).length).toBe(2);

    await site.select(field("Action"), "Quarantine");
    await site.fill(field("Reason"), "Browser journey quarantine of a governed project.");
    await site.fill(field("Evidence"), "case-browser-journey");
    await site.click(named("button", "Preview"));
    await site.click(named("button", "Confirm: Quarantine"));
    await shown(text("Recorded.")).toMatchObject({ visible: true });
    await site.open(editor);
    await shown(named("checkbox", "Featured")).toMatchObject({ disabled: true });

    await site.open("/admin?section=fees");
    await shown(named("link", "Fee conversions")).toMatchObject({ visible: true });
    await shown(text("No conversions", true)).toMatchObject({ visible: true });

    await site.deploy({ ADMIN_GITHUB_IDS: "", PROJECT_MODERATOR_GITHUB_IDS: "", OPERATOR_GITHUB_IDS: "" });
    await site.open("/admin");
    await shown(text("Admins only", true)).toMatchObject({ visible: true });
    expect((await site.fetch("GET", "/api/v1/admin/projects")).status).toBe(403);
    expect((await site.fetch("GET", "/api/v1/admin/fee-conversions")).status).toBe(403);
    await site.deploy(roles);
    await site.open("/admin");
    await shown(field("Find a project")).toMatchObject({ visible: true });
  });
});

// spec/security/enforcement.md, "Story: Exempt only by the frozen set or an audited owner-approved grant"
describe("Exempt only by the frozen set or an audited", () => {
  // spec/security/enforcement.md, "An administrator records an audited exemption only for a current authorized steward"; spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"
  it("an administrator records an owner-approved exemption", async () => {
    await site.allow(refusedLoads);
    const fullName = await repository(users.eli, "exempt");
    const id = await createProject(users.eli, fullName, "Exempt");
    const assessment = `vet_${"7".repeat(32)}`;
    await incompleteAssessment(id, assessment, fullName.toUpperCase());
    await manage(id);
    const reasons = named("region", "Why the scan did not clear");
    await shown(reasons).toMatchObject({ visible: true });
    await expect.poll(async () => (await site.read(reasons)).text, { timeout: 30_000 }).toContain("Specialist: ambiguous");
    await shown(text("The last scan finished, but it did not establish clearance. Findings in Slop's skill template were recorded.", true)).toMatchObject({ visible: true });
    await shown(named("button", "Rescan")).toMatchObject({ visible: true });
    const checkPath = `/api/v1/project-setup/${encodeURIComponent(id)}/check`;
    const ownerSetup = await site.fetch("POST", checkPath, {});
    expect(ownerSetup.status).toBe(200);
    expect(JSON.stringify(ownerSetup)).not.toMatch(/Private fixture|private-fixture/iu);
    const privateReason = /Slop's skill template|Specialist: ambiguous|Private fixture|private-fixture/iu;
    const publicProject = await site.fetch("GET", `/api/v1/projects/${encodeURIComponent(id)}`);
    expect(JSON.stringify(publicProject)).not.toMatch(privateReason);
    await signOut(users.eli.login);
    await signIn(users.pia.login, "/");
    const strangerSetup = await site.fetch("POST", checkPath, {});
    expect(JSON.stringify(strangerSetup)).not.toMatch(privateReason);
    await signOut(users.pia.login);

    await signIn(users.eli.login, `/projects/${encodeURIComponent(id)}/manage`);
    await shown(text("GitHub access", true)).toMatchObject({ visible: true });
    await incompleteAssessment(id, `vet_${"9".repeat(32)}`, "other/repository");
    const inconsistent = await site.fetch("POST", checkPath, {});
    expect(JSON.stringify(inconsistent)).toContain("The last scan did not clear the project.");
    expect(JSON.stringify(inconsistent)).not.toMatch(privateReason);
    await signOut(users.eli.login);

    await signIn(users.root.login, `/admin?project=${encodeURIComponent(id)}&section=security`);
    await shown(named("heading", "Owner-approved exemption")).toMatchObject({ visible: true });
    const record = named("button", "Record exemption");
    await site.fill(named("textbox", "Exemption reason"), "The owner approved this repository after a manual review.");
    await site.fill(field("Decision link"), "https://github.com/slop-cash/decisions/issues/7");
    await shown(record).toMatchObject({ disabled: true });
    await site.click(named("checkbox", "Owner authorized this"));
    await site.click(record);
    await expect.poll(() => site.sql("SELECT project_id, granted_by_github_login FROM vetting_admission_exemptions WHERE project_id = ?", id), { timeout: 30_000 }).toEqual([{ project_id: id, granted_by_github_login: users.root.login }]);
    await shown(named("region", "Exemption history")).toMatchObject({ text: expect.stringContaining("Active") as unknown });
    await signOut(users.root.login);

    await signIn(users.eli.login, `/projects/${encodeURIComponent(id)}/manage`);
    await shown(text("Owner-approved exemption", true)).toMatchObject({ visible: true });
    await shown(text("Passed", true)).toMatchObject({ count: 0 });
    await signOut(users.eli.login);

    await signIn(users.root.login, `/admin?project=${encodeURIComponent(id)}&section=security`);
    await site.fill(named("textbox", "Exemption reason"), "The owner withdrew the approval for this repository.");
    await site.fill(field("Decision link"), "https://github.com/slop-cash/decisions/issues/8");
    await site.click(named("checkbox", "Owner authorized this"));
    await site.click(named("button", "Revoke exemption"));
    await expect.poll(() => site.sql("SELECT count(*) AS revoked FROM vetting_admission_exemption_revocations r JOIN vetting_admission_exemptions e ON e.id = r.exemption_id WHERE e.project_id = ?", id), { timeout: 30_000 }).toEqual([{ revoked: 1 }]);
    await shown(named("region", "Exemption history")).toMatchObject({ text: expect.stringContaining("Revoked") as unknown });
  });
});

// spec/security/privacy.md, "Story: Read only authorized retained evidence"
describe("Read only authorized retained evidence", () => {
  // spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"; spec/security/privacy.md, "A scanner evidence grant is redeemed once, and a download needs exactly one grant cookie, a same-origin GET and no range"; spec/security/evidence.md, "References, permanent admission and pending uploads are separate"
  it("retained evidence reads as verified text or", async () => {
    await site.allow(refusedLoads, "^40[0139] (GET|POST) /api/v1/operator/vetting-evidence(/|$)");
    const fullName = await repository(users.ron, "evidence");
    const id = await createProject(users.ron, fullName, "Evidence");
    const assessment = `vet_${"8".repeat(32)}`;
    await incompleteAssessment(id, assessment);
    const trace = "harmless scanner trace for the browser journey";
    const binary = "harmless binary bytes for the browser journey";
    const traceSha = await sha256(trace);
    const binarySha = await sha256(binary);
    const declared = { traceSha256: traceSha, objects: [{ sha256: traceSha, sizeBytes: trace.length, kind: "trace", label: "trace", contentType: "text/plain" }, { sha256: binarySha, sizeBytes: binary.length, kind: "artifact", label: "artifact", contentType: "application/octet-stream" }] };
    const run = `/api/v1/vetting/evidence/${assessment}/run-1`;
    expect((await site.scanner("POST", run, JSON.stringify(declared))).status).toBeLessThan(300);
    expect((await site.scanner("PUT", `${run}/${traceSha}`, trace)).status).toBeLessThan(300);
    expect((await site.scanner("PUT", `${run}/${binarySha}`, binary)).status).toBeLessThan(300);
    const page = `/vetting-evidence?assessmentId=${assessment}&runId=run-1`;
    await signOut(users.ron.login);

    await signIn(users.pia.login, page);
    await shown(text("Evidence could not be loaded")).toMatchObject({ visible: true });
    await expect.poll(() => site.leaks(trace), { timeout: 30_000 }).toBe(false);
    await signOut(users.pia.login);

    await signIn(users.operator.login, page);
    await shown(text("Evidence inventory", true)).toMatchObject({ visible: true });
    const traceItem = named("article", "trace");
    await site.click(named("button", "trace", { exact: false }));
    await site.fill(within(traceItem, field("Reason")), "Inspect the harmless trace");
    await site.click(named("button", "Read trace"));
    await shown(named("textbox", "trace verified content")).toMatchObject({ value: trace });
    await shown(within(traceItem, text("Verified"))).toMatchObject({ visible: true });

    const artifactItem = named("article", "artifact");
    await site.click(named("button", "artifact", { exact: false }));
    await site.fill(within(artifactItem, field("Reason")), "Download the harmless artifact");
    await site.click(named("button", "Download artifact"));
    await expect.poll(() => site.download(), { timeout: 30_000 }).toEqual({ name: `${binarySha}.bin`, sha256: binarySha });
    await shown(within(artifactItem, text("Do not execute"))).toMatchObject({ visible: true });
    expect(await site.sql("SELECT count(*) AS audited FROM vetting_evidence_audit WHERE assessment_id = ?", assessment)).toEqual([{ audited: expect.any(Number) as unknown }]);

    const [head] = await site.sql("SELECT target_key FROM vetting_evidence_heads WHERE sha256 = ?", traceSha);
    await site.object("VETTING_EVIDENCE", String(head?.target_key), "tampered trace bytes of the same length!!!!!!!");
    await site.open(page);
    await site.click(named("button", "trace", { exact: false }));
    await site.fill(within(named("article", "trace"), field("Reason")), "Inspect the harmless trace again");
    await site.click(named("button", "Read trace"));
    await shown(within(named("article", "trace"), named("alert"))).toMatchObject({ visible: true });
    await shown(named("textbox", "trace verified content")).toMatchObject({ count: 0 });
    expect(await site.leaks("tampered trace bytes")).toBe(false);
  });
});

const awardPeriod = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
};

type Manifest = Readonly<Record<string, unknown>>;

async function monthlyPool(id: string, owner: User, more: { readonly active?: boolean; readonly escrow?: boolean; readonly org?: boolean; readonly reward?: Manifest } = {}) {
  const [current] = await site.sql("SELECT revision, status, manifest FROM projects WHERE id = ?", id);
  const revision = Number(current?.revision) + 1;
  const recorded = parsed(current?.manifest) as Manifest;
  const escrow = recorded.escrow as { readonly deployments?: ReadonlyArray<{ readonly asset?: string }> } | undefined;
  const withEscrow = more.escrow === true || escrow !== undefined;
  const status = more.active === true || more.escrow === true ? "active" : String(current?.status);
  const recordedSteward = recorded.steward as { readonly github?: Manifest } & Manifest;
  const manifest = {
    ...recorded,
    status,
    ...(more.org === true ? { steward: { ...recordedSteward, kind: "organization", github: { ...recordedSteward.github, type: "Organization" } } } : {}),
    rewardAsset: { network: "base", chainId: "8453", cluster: null, kind: "stablecoin", address: escrow?.deployments?.[0]?.asset ?? "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6, verifiedAt: "2026-11-01T00:00:00.000Z" },
    reward: { kind: "monthly-pool", currency: "USDC", chain: "base", rewardStartAt: `${awardPeriod()}-01T00:00:00.000Z`, cycle: "calendar-month-utc", monthlyCapMinor: "5000000", monthlyCapDisplay: "$5", committedMinor: "0", paymentMode: "disabled", feeBasisPoints: withEscrow ? 200 : 100, unusedFunds: "rollover-without-cap-increase", fundingState: "pledged", ...more.reward },
    ...(withEscrow ? { escrow: { schemaVersion: "1", feeBasisPoints: 200, withdrawalFeeBasisPoints: 200, feeMode: "deduct-from-gross", ...escrow, effectiveCycle: awardPeriod(), chain: "base", deployments: escrow?.deployments ?? [] } } : {}),
  };
  const now = new Date().toISOString();
  const kind = status === "active" && String(current?.status) !== "active" ? "Activated" : "OwnerUpdate";
  const written = JSON.stringify(manifest);
  const digest = await sha256(written);
  await site.sql("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES(?,?,?,?,?,?,?,?)", id, revision, written, digest, "Monthly awards", String(owner.id), owner.login, now);
  await site.sql("INSERT INTO project_revision_kinds(project_id,revision,kind) VALUES(?,?,?)", id, revision, kind);
  await site.sql("UPDATE projects SET status = ?, revision = ?, manifest = ?, manifest_sha256 = ?, updated_at = ? WHERE id = ?", status, revision, written, digest, now, id);
}

async function proposeMonth(id: string, rows: ReadonlyArray<readonly [User, string]>) {
  const period = awardPeriod();
  const cap = rows.reduce((sum, [, gross]) => sum + BigInt(gross), 0n).toString();
  await site.sql(
    "INSERT INTO monthly_reward_bases(project_id, period, manifest, manifest_sha256, source_snapshot_sha256, cap_base, recipient_count, created_at) SELECT id, ?, manifest, manifest_sha256, ?, ?, ?, ? FROM projects WHERE id = ?",
    period, "f".repeat(64), cap, rows.length, new Date().toISOString(), id,
  );
  for (const [index, [user, gross]] of rows.entries()) {
    await site.sql("INSERT INTO monthly_reward_base_rows(project_id, period, github_user_id, github_login, gross_base, source_digest) VALUES(?,?,?,?,?,?)", id, period, String(user.id), user.login, gross, String(index + 1).padStart(64, "a"));
  }
}

async function openAwards(id: string) {
  await site.open(`/projects/${encodeURIComponent(id)}/funding`);
  const awards = named("region", "Monthly awards");
  await shown(awards).toMatchObject({ visible: true });
  await site.click(named("button", "Open", { exact: true, within: awards }));
  await shown({ label: "Contribution month", within: awards }).toMatchObject({ visible: true });
  return awards;
}

// spec/frontend/ownerMonthly.md, "Story: Edit the month's awards with public, noticed cuts"; spec/settlement/monthly.md, "Story: Owners change amounts before the freeze, and cuts are public"
describe("Edit the month's awards with public, noticed cuts", () => {
  // spec/frontend/ownerMonthly.md, "A cut needs a 20 to 500 character public reason, and a save names the sequence it read"; spec/frontend/ownerMonthly.md, "Only a current manager edits, and the editor closes at the cutoff"; spec/settlement/monthly.md, "A change below the proposed amount is a public cut with a reason and one Inbox notice"; spec/settlement/monthly.md, "Only a current owner, steward or repository administrator changes another recipient's amount"
  it("the owner lowers an award only with a 20 to 500", async () => {
    await site.allow(refusedLoads, "^404 GET /data/", "^console Failed to load resource: the server responded with a status of 404");
    const fullName = await repository(users.oli, "awards");
    const id = await createProject(users.oli, fullName, "Awards");
    await site.permission(fullName, users.pia.login, "write");
    await monthlyPool(id, users.oli, { escrow: true, org: true });
    await proposeMonth(id, [[users.pia, "3000000"], [users.eli, "2000000"]]);

    const awards = await openAwards(id);
    await autoFinalizeOff(awards, id);
    const award = named("textbox", `Award for ${users.pia.login}`, { exact: false, within: awards });
    const save = named("button", `Save ${users.pia.login}`, { within: awards });
    const reason = field("Reason (shown publicly and sent to the contributor)");
    await shown(award).toMatchObject({ visible: true, disabled: false, value: expect.stringMatching(/^(3|3000000)$/u) as unknown });
    await shown(save).toMatchObject({ disabled: true });
    const units = (await site.read(award)).value === "3" ? 1_000_000n : 1n;

    await site.fill(award, "1");
    await shown(reason).toMatchObject({ visible: true });
    await site.fill(reason, "Too short.");
    await shown(save).toMatchObject({ disabled: true });
    const why = "The second half of the change duplicated work already merged in October.";
    await site.fill(reason, why);
    await shown(save).toMatchObject({ disabled: false });
    await site.click(save);
    await shown({ text: "Saved", exact: true, within: awards }).toMatchObject({ visible: true });
    await expect
      .poll(() => site.sql("SELECT github_user_id, proposed_gross_base, gross_base, reason FROM monthly_allocation_cut_reasons WHERE project_id = ? AND period = ?", id, awardPeriod()), { timeout: 30_000 })
      .toEqual([{ github_user_id: String(users.pia.id), proposed_gross_base: "3000000", gross_base: units.toString(), reason: why }]);

    await openAwards(id);
    await shown(award).toMatchObject({ value: "1" });
    await shown(reason).toMatchObject({ count: 0 });
    expect(await site.sql("SELECT count(*) AS changes FROM monthly_allocation_changes WHERE project_id = ? AND period = ?", id, awardPeriod())).toEqual([{ changes: 1 }]);

    await signOut(users.oli.login);
    await signIn(users.pia.login, `/projects/${encodeURIComponent(id)}/funding`);
    const viewed = await openAwards(id);
    await shown({ text: "View only", exact: true, within: viewed }).toMatchObject({ visible: true });
    await shown(named("button", `Save ${users.eli.login}`, { within: viewed })).toMatchObject({ count: 0 });
    expect((await writes(id)).filter((sent) => sent.actor === String(users.pia.id))).toEqual([]);
  });
});

async function autoFinalizeOff(awards: Target, id: string) {
  const automatic = named("switch", "Auto-finalize", { within: awards });
  await shown(automatic).toMatchObject({ checked: true });
  await site.click(automatic);
  await shown(automatic).toMatchObject({ checked: false });
  await expect.poll(() => site.sql("SELECT automatic FROM monthly_payment_settings WHERE project_id = ? ORDER BY sequence DESC LIMIT 1", id), { timeout: 30_000 }).toEqual([{ automatic: 0 }]);
}

// spec/settlement/monthly.md, "Story: Freeze exactly one execution snapshot"; spec/settlement/monthlySettings.md, "Story: Change the automatic default with current authority"
describe("Freeze exactly one execution snapshot", () => {
  // spec/settlement/monthly.md, "The owner may finalize early; the coordinator freezes at the cutoff unless the default is off"; spec/settlement/monthlySettings.md, "The default starts on, and each change appends the next sequence"; spec/frontend/ownerMonthly.md, "Only a current manager edits, and the editor closes at the cutoff"
  it("the owner turns Auto-finalize off, finalizes the", async () => {
    await site.allow(refusedLoads);
    const fullName = await repository(users.ron, "finals");
    const id = await createProject(users.ron, fullName, "Finals");
    await site.backendRpc();
    await site.vault({ projectId: id });
    await monthlyPool(id, users.ron);
    await proposeMonth(id, [[users.pia, "3000000"], [users.eli, "2000000"]]);

    const awards = await openAwards(id);
    await autoFinalizeOff(awards, id);
    const finalize = named("button", "Finalize awards", { within: awards });
    await shown(finalize).toMatchObject({ disabled: false });
    await site.click(finalize);
    await shown({ text: "Final · you", within: awards }).toMatchObject({ visible: true });
    await shown({ text: "Underfunded", exact: true, within: awards }).toMatchObject({ visible: true });
    await shown(finalize).toMatchObject({ count: 0 });
    await shown(named("textbox", `Award for ${users.pia.login}`, { exact: false, within: awards })).toMatchObject({ count: 0 });
    for (const user of [users.pia, users.eli]) await shown({ text: user.login, exact: true, within: awards }).toMatchObject({ visible: true });
    expect(await site.sql("SELECT trigger, actor_id, allocation_sequence FROM monthly_payment_runs WHERE project_id = ? AND period = ?", id, awardPeriod())).toEqual([{ trigger: "owner", actor_id: String(users.ron.id), allocation_sequence: 0 }]);

    await openAwards(id);
    await shown({ text: "Final · you", within: awards }).toMatchObject({ visible: true });
    expect((await site.sql("SELECT count(*) AS runs FROM monthly_payment_runs WHERE project_id = ?", id))).toEqual([{ runs: 1 }]);
  });
});

// spec/frontend/ownerMonthly.md, "Story: Edit the month's awards with public, noticed cuts"; spec/frontend/requests.md, "Only the current request may publish its validated result"
describe("Edit the month's awards after leaving the page", () => {
  // spec/frontend/requests.md, "Only the current request may publish its validated result"; spec/frontend/ownerMonthly.md, "A cut needs a 20 to 500 character public reason, and a save names the sequence it read"; spec/settlement/monthly.md, "A change below the proposed amount is a public cut with a reason and one Inbox notice"
  it("a cut saved while the owner leaves for Home is kept", async () => {
    const fullName = await repository(users.sam, "departed");
    const id = await createProject(users.sam, fullName, "Departed");
    const path = `/api/v1/payments/projects/${id}/monthly/${awardPeriod()}/allocations`;
    await site.allow(refusedLoads, "^404 GET /data/", "^console Failed to load resource: the server responded with a status of 404", `^failed POST ${path} net::ERR_ABORTED$`);
    await monthlyPool(id, users.sam, { escrow: true });
    await proposeMonth(id, [[users.pia, "3000000"], [users.eli, "2000000"]]);

    const awards = await openAwards(id);
    await autoFinalizeOff(awards, id);
    const why = "The second half of the change duplicated work already merged earlier.";
    await site.fill(named("textbox", `Award for ${users.pia.login}`, { exact: false, within: awards }), "1");
    await site.fill(field("Reason (shown publicly and sent to the contributor)"), why);
    await site.hold("POST", path);
    await site.click(named("button", `Save ${users.pia.login}`, { within: awards }));
    await expect.poll(() => site.sql("SELECT reason FROM monthly_allocation_cut_reasons WHERE project_id = ? AND period = ?", id, awardPeriod()), { timeout: 30_000 }).toEqual([{ reason: why }]);

    await site.click(named("link", "Slop home"));
    await at("/");
    await site.release("POST", path);
    await expect.poll(async () => (await site.sent()).filter((sent) => sent.method === "POST" && sent.path === path).length, { timeout: 30_000 }).toBe(1);
    await shown({ text: "Saved", exact: true }).toMatchObject({ count: 0 });
    await at("/");
    expect(await site.sql("SELECT count(*) AS changes FROM monthly_allocation_changes WHERE project_id = ? AND period = ?", id, awardPeriod())).toEqual([{ changes: 1 }]);
  });

  // spec/frontend/ownerMonthly.md, "A cut needs a 20 to 500 character public reason, and a save names the sequence it read"; spec/frontend/requests.md, "Loading, empty, stale, denied, invalid and unavailable remain distinct"
  it("a save the allocation service cannot take keeps the", async () => {
    const fullName = await repository(users.tia, "outage");
    const id = await createProject(users.tia, fullName, "Outage");
    const path = `/api/v1/payments/projects/${id}/monthly/${awardPeriod()}/allocations`;
    await site.allow(refusedLoads, "^404 GET /data/", "^console Failed to load resource: the server responded with a status of 404", `^503 POST ${path}$`, "^console Failed to load resource: the server responded with a status of 503");
    await monthlyPool(id, users.tia, { escrow: true });
    await proposeMonth(id, [[users.pia, "3000000"], [users.eli, "2000000"]]);

    const awards = await openAwards(id);
    await autoFinalizeOff(awards, id);
    const award = named("textbox", `Award for ${users.pia.login}`, { exact: false, within: awards });
    const reason = field("Reason (shown publicly and sent to the contributor)");
    const save = named("button", `Save ${users.pia.login}`, { within: awards });
    const why = "The second half of the change duplicated work already merged earlier.";
    await site.fill(award, "1");
    await site.fill(reason, why);
    await site.fail("POST", path, 503, { error: "unavailable", message: "Allocation service unavailable." });
    await site.click(save);
    await shown({ text: "Allocation service unavailable.", within: awards }).toMatchObject({ visible: true });
    await shown(award).toMatchObject({ value: "1", disabled: false });
    await shown(reason).toMatchObject({ value: why });
    await shown({ text: "Saved", exact: true, within: awards }).toMatchObject({ count: 0 });
    expect(await site.sql("SELECT count(*) AS changes FROM monthly_allocation_changes WHERE project_id = ? AND period = ?", id, awardPeriod())).toEqual([{ changes: 0 }]);

    await site.unfail("POST", path);
    await site.click(save);
    await shown({ text: "Saved", exact: true, within: awards }).toMatchObject({ visible: true });
    await expect.poll(() => site.sql("SELECT reason FROM monthly_allocation_cut_reasons WHERE project_id = ? AND period = ?", id, awardPeriod()), { timeout: 30_000 }).toEqual([{ reason: why }]);
  });

  // spec/frontend/requests.md, "Only the current request may publish its validated result"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/frontend/composition.md, "A focus identity refresh changes the account only through sign-in or sign-out"
  it("a save answered after another tab signed in a", async () => {
    await site.allow(refusedLoads, "^404 GET /data/", "^console Failed to load resource: the server responded with a status of 404", "^403 GET /api/v1/payments/projects/[^/]+/monthly/");
    const fullName = await repository(users.uma, "handover");
    const id = await createProject(users.uma, fullName, "Handover");
    await monthlyPool(id, users.uma, { escrow: true });
    await proposeMonth(id, [[users.pia, "3000000"], [users.eli, "2000000"]]);

    const awards = await openAwards(id);
    await autoFinalizeOff(awards, id);
    const award = named("textbox", `Award for ${users.pia.login}`, { exact: false, within: awards });
    const path = `/api/v1/payments/projects/${id}/monthly/${awardPeriod()}/allocations`;
    await site.fill(award, "1");
    await site.fill(field("Reason (shown publicly and sent to the contributor)"), "The second half of the change duplicated work already merged earlier.");
    await site.hold("POST", path);
    await site.click(named("button", `Save ${users.pia.login}`, { within: awards }));
    await expect.poll(async () => (await site.sent()).filter((sent) => sent.method === "POST" && sent.path === path).map((sent) => sent.actor), { timeout: 30_000 }).toEqual([String(users.uma.id)]);

    await site.open("/", "other");
    await signOut(users.uma.login);
    await signIn(users.pia.login, "/", "other");
    await site.tab("main");
    await site.refocus();
    await site.release("POST", path);
    await shown(award).toMatchObject({ count: 0 });
    await shown({ text: "Saved", exact: true }).toMatchObject({ count: 0 });
    await shown(named("button", `Save ${users.pia.login}`)).toMatchObject({ count: 0 });
  });
});

// spec/settlement/maintainerShare.md, "Story: Take the maintainer share out of the monthly amount"; spec/frontend/views.md, "Story: Read a project's rewards and activity at a glance"
describe("Take the maintainer share out of the monthly amount", () => {
  // spec/backend/projects.md, "The maintainer share is an owner setting whose history only the server writes"; spec/settlement/maintainerShare.md, "A change starts with the next UTC month, and a month is proposed only from a complete read"; spec/frontend/views.md, "A published maintainer share shows this month's share, and next month's while a change waits"
  it("the owner sets, changes and clears the maintainer", async () => {
    await site.allow(refusedLoads, "^404 GET /data/", "^console Failed to load resource: the server responded with a status of 404");
    const fullName = await repository(users.eli, "sharecrop");
    const id = await createProject(users.eli, fullName, "Sharecrop");
    await monthlyPool(id, users.eli, { active: true });

    await manage(id);
    await openGroup("Monthly rewards");
    await shown(shareField).toMatchObject({ value: "" });
    expect((await rewardOf(id)).maintainerShare).toBeUndefined();

    const mark = (await writes(id)).length;
    await site.fill(shareField, "31");
    await site.click(publish);
    await shown(text("Enter a whole number from 0 to 30, or leave it empty.", true)).toMatchObject({ visible: true });
    expect((await writes(id)).length).toBe(mark);
    expect((await revisions(id)).length).toBe(2);

    await site.fill(shareField, "20");
    const changes = named("region", "Changes");
    await shown({ text: "20%", within: changes }).toMatchObject({ visible: true });
    await shown({ text: `From ${cycleText(1)}`, within: changes }).toMatchObject({ visible: true });
    await site.click(publish);
    await expect.poll(async () => (await lastRevision(id))?.revision, { timeout: 30_000 }).toBe(3);
    expect(await rewardOf(id)).toMatchObject({ maintainerShare: 2000, maintainerShareHistory: [{ throughCycle: cycleText(0), basisPoints: 0 }] });

    const changing = `Maintainer share: none of the monthly amount this month, 20% from ${monthName(1)}, ${deciders}.`;
    expect((await site.open(`/projects/${encodeURIComponent(id)}`)).status).toBe(200);
    await shown(text(changing, true)).toMatchObject({ visible: true });
    expect((await site.open("/")).status).toBe(200);
    await shown(named("link", "Sharecrop", { exact: false, within: named("region", "Projects") })).toMatchObject({ text: expect.stringContaining(`Maintainer share 20% from ${monthName(1)}`) as unknown });
    expect((await site.open("/sponsors")).status).toBe(200);
    await shown(text(`Maintainer share 20% from ${monthName(1)}`, true)).toMatchObject({ visible: true });

    await manage(id);
    await openGroup("Monthly rewards");
    await shown(shareField).toMatchObject({ value: "20" });
    await site.fill(shareField, "");
    await site.click(publish);
    await expect.poll(async () => (await lastRevision(id))?.revision, { timeout: 30_000 }).toBe(4);
    const cleared = await rewardOf(id);
    expect(cleared.maintainerShare).toBeUndefined();
    expect(cleared.maintainerShareHistory).toEqual([{ throughCycle: cycleText(0), basisPoints: 0 }]);
    expect((await site.open(`/projects/${encodeURIComponent(id)}`)).status).toBe(200);
    await shown(named("heading", "Sharecrop", { level: 1, exact: false })).toMatchObject({ visible: true });
    await shown(text("Maintainer share")).toMatchObject({ count: 0 });
  });

  // spec/frontend/views.md, "A published maintainer share shows this month's share, and next month's while a change waits"; spec/settlement/maintainerShare.md, "The share is a floor of the monthly amount and is split by decisions with ties to the lower account"
  it("a share in force this month reads as the same share", async () => {
    await site.allow(refusedLoads, "^404 GET /data/", "^console Failed to load resource: the server responded with a status of 404");
    const fullName = await repository(users.uma, "shared-now");
    const id = await createProject(users.uma, fullName, "Shared now");
    await monthlyPool(id, users.uma, { active: true, reward: { maintainerShare: 2000 } });
    await signOut(users.uma.login);

    expect((await site.open(`/projects/${encodeURIComponent(id)}`)).status).toBe(200);
    await shown(text(`Maintainer share: 20% of the monthly amount, ${deciders}.`, true)).toMatchObject({ visible: true });
    expect((await site.open("/")).status).toBe(200);
    const card = named("link", "Shared now", { exact: false, within: named("region", "Projects") });
    await shown(card).toMatchObject({ text: expect.stringContaining("Maintainer share 20%") as unknown });
    expect((await site.read(card)).text).not.toContain("Maintainer share 20% from");
    expect((await site.open("/sponsors")).status).toBe(200);
    await shown(text("Maintainer share 20%", true)).toMatchObject({ visible: true });
  });
});

// spec/settlement/monthlySettlement.md, "Story: Fund, reserve and pay one month through its own vault"; spec/settlement/vaultDeposits.md, "Story: Record every finalized deposit of an ordinary EVM vault once"
describe("Fund, reserve and pay one month through its own vault", () => {
  // spec/frontend/ownerVault.md, "A flow sends only after storage saves its attempt"; spec/frontend/walletAttempt.md, "A wallet prompt starts only after storage creates an empty slot"; spec/settlement/vaultDeposits.md, "A record row is a positive amount of one finalized deposit event"
  it("any wallet deposits into the registered vault from", async () => {
    const fullName = await repository(users.tia, "vaulted");
    const id = await createProject(users.tia, fullName, "Vaulted");
    const deployed = await site.vault({ projectId: id });
    await signOut(users.tia.login);
    await site.wallets({ evm: { name: "Anvil Wallet" } });
    await signIn(users.uma.login, `/projects/${encodeURIComponent(id)}/funding`);

    const escrow = named("region", "Project escrow");
    const card: Target = { label: "Fund this project ·", exact: false };
    await shown({ text: "Depositors have no refund right.", within: escrow }).toMatchObject({ visible: true });
    await shown({ text: "The project owner can withdraw free funds, less a 2% fee.", within: escrow }).toMatchObject({ visible: true });
    await shown(card).toMatchObject({ count: 0 });
    await site.click(named("button", "Fund this project", { exact: false, within: escrow }));
    await shown(card).toMatchObject({ visible: true });
    await shown({ text: deployed.vault, within: card }).toMatchObject({ count: 1 });
    await site.click(named("button", "Connect Anvil Wallet", { within: card }));
    await shown(field("Token amount")).toMatchObject({ visible: true, disabled: false });
    await shown(field("Deposit tokens")).toMatchObject({ checked: true });
    await shown(field("Withdraw free funds")).toMatchObject({ count: 0 });
    await shown({ text: "Withdraw free funds", exact: true }).toMatchObject({ count: 0 });
    expect(await site.walletAsked()).not.toContainEqual(expect.objectContaining({ method: "eth_sendTransaction" }));

    await site.fill(field("Token amount"), "5");
    await site.click(named("button", "Review deposit", { within: card }));
    const review = named("region", "Review vault action", { within: card });
    await shown(review).toMatchObject({ visible: true });
    await shown({ text: "Depositors have no refund right.", within: review }).toMatchObject({ visible: true });
    expect((await site.walletAsked()).filter((asked) => asked.method === "eth_sendTransaction" || asked.method === "wallet_sendCalls")).toEqual([]);

    await site.click(named("button", "in wallet", { exact: false, within: review }));
    await expect.poll(async () => (await site.walletAsked()).some((asked) => asked.method === "eth_sendTransaction" || asked.method === "wallet_sendCalls"), { timeout: 30_000 }).toBe(true);
    await shown({ text: "Withdraw free funds", exact: true }).toMatchObject({ count: 0 });
  });

  // spec/frontend/projections.md, "The public page offers only a deposit, after the no-refund disclosure"; spec/frontend/ownerVault.md, "A flow sends only after storage saves its attempt"; spec/frontend/walletAttempt.md, "A wallet prompt starts only after storage creates an empty slot"
  it("a signed-out visitor deposits from the public", async () => {
    const fullName = await repository(users.pia, "open-vault");
    const id = await createProject(users.pia, fullName, "Open vault");
    const deployed = await site.vault({ projectId: id });
    await signOut(users.pia.login);
    await site.wallets({ evm: { name: "Anvil Wallet" } });
    expect((await site.open(`/projects/${encodeURIComponent(id)}/funding`)).status).toBe(200);
    await shown(named("link", "Log in")).toMatchObject({ visible: true });

    const escrow = named("region", "Project escrow");
    const card: Target = { label: "Fund this project ·", exact: false };
    await shown({ text: "Depositors have no refund right.", within: escrow }).toMatchObject({ visible: true });
    await shown(card).toMatchObject({ count: 0 });
    await site.click(named("button", "Fund this project", { exact: false, within: escrow }));
    await shown(card).toMatchObject({ visible: true });
    await shown({ text: deployed.vault, within: card }).toMatchObject({ count: 1 });
    await shown(named("link", "Sign in with GitHub", { within: card })).toMatchObject({ count: 0 });
    await site.click(named("button", "Connect Anvil Wallet", { within: card }));
    await shown(field("Deposit tokens")).toMatchObject({ checked: true });
    await shown(field("Withdraw free funds")).toMatchObject({ count: 0 });

    await site.fill(field("Token amount"), "5");
    await site.click(named("button", "Review deposit", { within: card }));
    const review = named("region", "Review vault action", { within: card });
    await shown({ text: "Depositors have no refund right.", within: review }).toMatchObject({ visible: true });
    expect((await site.walletAsked()).filter((asked) => asked.method === "eth_sendTransaction" || asked.method === "wallet_sendCalls")).toEqual([]);
    await site.click(named("button", "in wallet", { exact: false, within: review }));
    await expect.poll(async () => (await site.walletAsked()).some((asked) => asked.method === "eth_sendTransaction" || asked.method === "wallet_sendCalls"), { timeout: 30_000 }).toBe(true);
    await shown({ text: "Withdraw free funds", exact: true }).toMatchObject({ count: 0 });
    expect((await site.sent()).filter((sent) => sent.method !== "GET" && sent.path.startsWith(`/api/v1/projects/${id}`))).toEqual([]);
  });
});

// spec/settlement/escrow.md, "Story: Deposit and withdraw only free funds"
describe("Deposit and withdraw only free funds", () => {
  // spec/settlement/escrow.md, "Only the owner withdraws unused free funds, to itself, less a 2% fee rounded up"; spec/frontend/ownerVault.md, "A flow sends only after storage saves its attempt"
  it("on the manage page only the vault owner's wallet is", async () => {
    await site.allow(refusedLoads);
    const fullName = await repository(users.oli, "withdrawn");
    const id = await createProject(users.oli, fullName, "Withdrawn");
    await site.vault({ projectId: id });
    await site.wallets({ evm: { name: "Anvil Wallet" } });
    await site.walletAccount(6);
    await manage(id);

    const card: Target = { label: "Fund or withdraw ·", exact: false };
    await shown(card).toMatchObject({ visible: true });
    await site.click(named("button", "Connect Anvil Wallet", { within: card }));
    await shown(field("Withdraw free funds")).toMatchObject({ visible: true });
    await site.click(field("Withdraw free funds"));
    await site.fill(field("Token amount"), "1");
    await site.click(named("button", "Review withdrawal", { within: card }));
    await shown({ text: "The amount exceeds the vault's free balance. Reserved awards cannot be withdrawn.", within: card }).toMatchObject({ visible: true });
    await shown(named("region", "Review vault action", { within: card })).toMatchObject({ count: 0 });
    expect((await site.walletAsked()).filter((asked) => asked.method === "eth_sendTransaction" || asked.method === "wallet_sendCalls")).toEqual([]);

    await site.click(named("button", "Choose another wallet", { within: card }));
    await site.walletAccount(0);
    await site.click(named("button", "Connect Anvil Wallet", { within: card }));
    await shown(field("Deposit tokens")).toMatchObject({ checked: true });
    await shown(field("Withdraw free funds")).toMatchObject({ count: 0 });
    await shown({ text: "Only the vault owner's wallet can withdraw free funds.", within: card }).toMatchObject({ visible: true });
  });
});

// spec/frontend/navigation.md, "Story: Resume an authorized destination after signing in"
describe("Resume an authorized destination after signing in", () => {
  // spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"
  it("a signed-out manage page keeps its URL and returns", async () => {
    const fullName = await repository(users.sam, "resume");
    const id = await createProject(users.sam, fullName, "Resume");
    await signOut(users.sam.login);
    const path = `/projects/${encodeURIComponent(id)}/manage`;
    await site.open(path);
    await shown(named("link", "Sign in with GitHub")).toMatchObject({ visible: true });
    await at(path);
    await signIn(users.sam.login, path);
    await shown(settings).toMatchObject({ visible: true });
  });
});
