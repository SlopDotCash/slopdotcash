import { sha256Hex, webCrypto } from "@repo/platform/crypto";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginPath } from "../src/platform/environment.ts";
import type { Target } from "./support/ui/protocol.ts";
import { accessible, at, named, shown, site } from "./support/ui/browser.ts";

const journeyMs = 30_000;
const copied = { text: "Copied", exact: true } satisfies Target;
const copyFailed = { text: "Copy failed. Select and copy the text." } satisfies Target;
const prompt = named("group", "Agent prompt");
const projects = named("region", "Projects");
const contributorHeading = named("heading", "MAKE MONEY SHIPPING OPEN SOURCE.", { level: 1 });
const maintainerHeading = named("heading", "SHIP FASTER. WITH CONTRIBUTORS.", { level: 1 });
const missingSnapshots = ["^404 GET /data/", "^console Failed to load resource: the server responded with a status of 404"];

const heading = (name: string) => named("heading", name, { level: 1 });

const steward = { id: 1401, login: "octo-lin" } as const;
const listed = [
  { id: "j4-alpha", tier: "community", repositoryId: 1411 },
  { id: "j4-beta", tier: "community", repositoryId: 1412 },
  { id: "j4-zeta", tier: "featured", repositoryId: 1413 },
] as const;

type Listed = (typeof listed)[number];

const nameOf = (project: Listed) => `Project ${project.id}`;

function pointsOnlyManifest(project: Listed) {
  const repository = `${steward.login}/${project.id}`;
  return {
    schemaVersion: "1",
    id: project.id,
    slug: project.id,
    name: nameOf(project),
    eyebrow: "Open-source project",
    headline: "Reproducible build tooling.",
    description: "Build and maintain reproducible build tooling.",
    listingTier: project.tier,
    status: "active",
    steward: { displayName: steward.login, kind: "individual", github: { actorId: String(steward.id), nodeId: `U_${steward.login}`, login: steward.login, type: "User", profileUrl: `https://github.com/${steward.login}` }, website: null },
    authority: { state: "unverified", reason: "missing-repository-proof", role: "project-steward", repositoryId: String(project.repositoryId), repositoryNodeId: `R_${project.repositoryId}`, proof: null },
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
    repositories: [{ id: repository, displayName: repository, githubUrl: `https://github.com/${repository}`, description: "Build tooling.", integrationBranch: "main" }],
    skill: { id: `contribute-to-${project.id}`, publishAtRoot: false, sourcePath: "skills/project-contributor-template", publicPath: `/projects/${project.id}/skill.md` },
    reviewSkill: { id: `review-${project.id}-contributions`, sourcePath: "skills/project-reviewer-template" },
    reward: { kind: "monthly-pool", currency: "USDC", chain: "ethereum", rewardStartAt: "2026-11-01T00:00:00.000Z", cycle: "calendar-month-utc", monthlyCapMinor: "0", monthlyCapDisplay: "$0", committedMinor: "0", paymentMode: "disabled", feeBasisPoints: 100, unusedFunds: "rollover-without-cap-increase", fundingState: "pledged" },
    funding: { mode: "direct-noncustodial", disclosure: "Funds go directly to the project wallet.", recordsPath: `funding/${project.id}`, addresses: [] },
    modelPolicy: { mode: "open-declared", disclosureRequired: true },
    links: { repository: `https://github.com/${repository}`, issues: `https://github.com/${repository}/issues` },
  };
}

async function list(project: Listed) {
  const text = JSON.stringify(pointsOnlyManifest(project));
  const digest = await Effect.runPromise(Effect.provide(sha256Hex(text), webCrypto));
  const now = new Date().toISOString();
  await site.sql("INSERT OR REPLACE INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES(?,1,?,?,'Revision 1',?,?,?)", project.id, text, digest, String(steward.id), steward.login, now);
  await site.sql("INSERT OR REPLACE INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)", project.id, text, digest, now, now);
  await site.sql("INSERT OR REPLACE INTO project_repositories(repository_key,project_id) VALUES(?,?)", `${steward.login}/${project.id}`.toLowerCase(), project.id);
}

async function textOf(target: Target) {
  return (await site.read(target)).text;
}

async function opened(path: string, title: string) {
  expect((await site.open(path)).status).toBe(200);
  await shown(heading(title)).toMatchObject({ visible: true });
  await at(path);
}

async function copyOutcome(): Promise<"Ready" | "Copied" | "CopyFailed"> {
  if ((await site.read(copied)).count > 0) return "Copied";
  if ((await site.read(copyFailed)).count > 0) return "CopyFailed";
  return "Ready";
}

beforeEach(async () => {
  await site.start();
  await site.allow(...missingSnapshots);
});

afterEach(async () => {
  expect(await site.popups()).toBe(0);
  expect(await site.diagnostics()).toEqual({ console: [], failed: [] });
});

describe('Open every product route at its existing address (spec/frontend/navigation.md, "Story: Open every product route at its existing address"; spec/app/index.md, "Story: Open a page by its address")', () => {
  it('each public address opens its one page with one main and one named heading (spec/frontend/navigation.md, "Every existing product route is one Page and only private destinations need an account"; spec/app/index.md, "Every opening shows a page"; spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes")', async () => {
    const pages: ReadonlyArray<readonly [string, string]> = [
      ["/how-it-works", "How Slop works"],
      ["/sponsors", "Fund a project"],
      ["/cycles", "Payment cycles"],
      ["/points", "Leaderboard"],
      ["/login", "Log in"],
    ];
    for (const [path, title] of pages) {
      await opened(path, title);
      await accessible();
    }
    expect((await site.open("/")).status).toBe(200);
    await shown(contributorHeading).toMatchObject({ visible: true });
    await accessible();
  });

  it('a signed-out private destination keeps its address and shows sign-in in place without a private read (spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"; spec/frontend/navigation.md, "Navigation gates private destinations on a signed-in account")', async () => {
    const privatePages: ReadonlyArray<readonly [string, string, string | undefined]> = [
      ["/account", "Settings", undefined],
      ["/inbox", "Inbox", undefined],
      ["/admin?section=security", "Admin", undefined],
      ["/vetting-evidence", "Private vetting evidence", undefined],
      ["/security", "Security cases", "Sign in to see your security cases."],
      ["/projects/slop/manage", "Manage project", "Maintainers only"],
    ];
    for (const [path, title, purpose] of privatePages) {
      await opened(path, title);
      await shown(named("link", "Sign in with GitHub")).toMatchObject({ visible: true, href: loginPath(path) });
      if (purpose !== undefined) await shown({ text: purpose }).toMatchObject({ visible: true });
    }
    const privateReads = (await site.sent()).filter((sent) => /^\/api\/v1\/(payments|admin|points\/me)/u.test(sent.path));
    expect(privateReads).toEqual([]);
  });

  it('an old address opens the page that replaced it and keeps its query and fragment (spec/app/index.md, "An old address opens the page that replaced it"; spec/frontend/navigation.md, "The browser remembers its requested page independently of authentication")', async () => {
    await site.allow("^404 GET /api/v1/projects/nobody$", "^404 GET /api/v1/projects/nobody/");
    await opened("/wallet", "Settings");
    await shown(named("link", "Sign in with GitHub")).toMatchObject({ href: loginPath("/wallet") });

    await site.open("/verification");
    await at("/how-it-works");
    await shown(heading("How Slop works")).toMatchObject({ visible: true });

    await site.open("/projects");
    await at("/#projects");
    await shown(projects).toMatchObject({ visible: true });

    await site.open("/projects/nobody/funding?x=1#monthly-awards");
    await at("/projects/nobody/funding?x=1#monthly-awards");
    await shown(heading("Project not found")).toMatchObject({ visible: true });

    await site.open("/projects/nobody/awards");
    await at("/projects/nobody/awards");
    await shown(heading("Project not found")).toMatchObject({ visible: true });
    expect((await site.layout()).mains).toBe(1);
  });

  it('an address that names no route kind, or does not decode, is the not-found page (spec/app/index.md, "Each address names exactly one route kind, and an address that names none is unknown")', async () => {
    await site.allow("^404 GET /nope$");
    expect((await site.open("/nope")).status).toBe(404);
    await shown(heading("Page not found")).toMatchObject({ visible: true });
    await shown(named("link", "See open projects")).toMatchObject({ href: "/" });

    expect((await site.open("/contributors/%E0%A4%A")).status).toBe(200);
    await shown(heading("Page not found")).toMatchObject({ visible: true });
    await at("/contributors/%E0%A4%A");
    expect((await site.layout()).mains).toBe(1);
  });
});

describe('Start contribution or private reporting when discovery is unavailable (spec/frontend/presentation.md, "Story: Start contribution or private reporting when discovery is unavailable"; spec/frontend/requests.md, "Story: Read current data without losing the last good result")', () => {
  it('while the registry read is stalled Home keeps its heading and agent setup and shows the projects as loading, then as empty (spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"; spec/frontend/requests.md, "Loading, empty, stale, denied, invalid and unavailable remain distinct")', async () => {
    await site.hold("GET", "/api/v1/projects");
    expect((await site.open("/")).status).toBe(200);
    await shown(contributorHeading).toMatchObject({ visible: true });
    await shown(prompt).toMatchObject({ visible: true, text: "Read https://slop.cash/contribute/SKILL.md and follow it." });
    await shown({ text: "Loading", exact: true, within: projects }).toMatchObject({ count: 1 });
    await shown({ text: "No projects yet." }).toMatchObject({ count: 0 });

    await site.release("GET", "/api/v1/projects");
    await shown({ text: "No projects yet.", within: projects }).toMatchObject({ visible: true });
    await shown({ text: "Loading", exact: true, within: projects }).toMatchObject({ count: 0 });
    await shown(named("link", "Add a project", { within: projects })).toMatchObject({ href: "/projects/new" });
  });
});

describe('Pick a project from the Featured and Community sections (spec/frontend/poolListing.md, "Story: Pick a project from the Featured and Community sections")', () => {
  it('every listed project is one card in its own tier section, Featured before Community, each Community card in registry order and a points-only pool reading Points only without a promise label (spec/frontend/poolListing.md, "Home shows the open Featured and Community projects in their own sections whatever this month\'s funding, leaving bounty cards to the security bounties section"; spec/frontend/poolListing.md, "Each home section orders stablecoin pools by shown monthly amount, then token pools, external prizes and points only, and breaks ties by Featured then registry order"; spec/frontend/projections.md, "An owner\'s honor-system promise shows this month\'s amount as promised, never as vault-backed")', async () => {
    for (const project of listed) await list(project);
    expect((await site.open("/")).status).toBe(200);
    const featured = named("region", "Featured", { within: projects });
    const community = named("region", "Community", { within: projects });
    await shown(featured).toMatchObject({ visible: true });
    await shown(community).toMatchObject({ visible: true });

    for (const project of listed) {
      const card = named("link", nameOf(project), { exact: false, within: project.tier === "featured" ? featured : community });
      await shown(card).toMatchObject({ count: 1, visible: true, href: `/projects/${project.id}` });
      expect(await textOf(card)).toContain("Points only");
      await shown(named("link", nameOf(project), { exact: false, within: project.tier === "featured" ? community : featured })).toMatchObject({ count: 0 });
    }

    const grid = await textOf(projects);
    expect(grid.indexOf("Featured")).toBeLessThan(grid.indexOf("Community"));
    const communityText = await textOf(community);
    expect(communityText.indexOf(nameOf(listed[0]))).toBeLessThan(communityText.indexOf(nameOf(listed[1])));
    await shown({ text: "Promised", within: projects }).toMatchObject({ count: 0 });
  });
});

describe('Choose the contributor or maintainer journey on Home (spec/frontend/presentation.md, "Story: Choose the contributor or maintainer journey on Home"; spec/ui/copy.md, "Story: Copy a value and know whether it worked")', () => {
  it('the switch sets the heading, the prompt and the address together, and a copy answer does not carry across journeys (spec/frontend/presentation.md, "Home offers a Contributor / Maintainer switch whose journey sets the heading, the prompt and every agent\'s skill address together"; spec/ui/copy.md, "Copying starts from ready and reports the browser\'s answer"; spec/ui/copy.md, "Success settles back to ready; failure stays until the next attempt")', async () => {
    expect((await site.open("/")).status).toBe(200);
    await shown(named("button", "Contributor")).toMatchObject({ visible: true });
    await shown(prompt).toMatchObject({ text: "Read https://slop.cash/contribute/SKILL.md and follow it." });

    expect(await copyOutcome()).toBe("Ready");
    await site.click(named("button", "Copy"));
    await expect.poll(copyOutcome, { timeout: journeyMs }).not.toBe("Ready");
    const answered = await copyOutcome();
    if (answered === "Copied") await expect.poll(copyOutcome, { timeout: journeyMs }).toBe("Ready");
    else {
      expect(answered).toBe("CopyFailed");
      await site.click(named("button", "Copy"));
      await expect.poll(copyOutcome, { timeout: journeyMs }).not.toBe("Ready");
    }

    await site.click(named("button", "Copy"));
    await expect.poll(copyOutcome, { timeout: journeyMs }).not.toBe("Ready");
    await site.click(named("button", "Maintainer"));
    await at("/?audience=maintainer");
    await shown(maintainerHeading).toMatchObject({ visible: true });
    await shown(contributorHeading).toMatchObject({ count: 0 });
    await shown(prompt).toMatchObject({ text: "Read https://slop.cash/maintain/SKILL.md and follow it." });
    expect(await copyOutcome()).toBe("Ready");

    await site.click(named("button", "Contributor"));
    await at("/");
    await shown(contributorHeading).toMatchObject({ visible: true });
    await shown(prompt).toMatchObject({ text: "Read https://slop.cash/contribute/SKILL.md and follow it." });

    await site.open("/?audience=maintainer#projects");
    await shown(maintainerHeading).toMatchObject({ visible: true });
    await shown(projects).toMatchObject({ visible: true });
  });

  it('the campaign keeps one whole accessible heading with reduced motion and on a narrow screen (spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion"; spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes")', async () => {
    expect((await site.open("/")).status).toBe(200);
    await site.view(1280, 900, true);
    await shown(contributorHeading).toMatchObject({ count: 1, visible: true });
    await site.view(375, 812, false);
    await shown(contributorHeading).toMatchObject({ count: 1, visible: true });
    await accessible();
  });
});

describe('Read Points standings with equal ranks for equal totals (spec/frontend/projections.md, "Story: Read Points standings with equal ranks for equal totals")', () => {
  it('the period switch writes only the period into the address and the people view opens from its fragment (spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"; spec/frontend/navigation.md, "The browser remembers its requested page independently of authentication")', async () => {
    await opened("/points", "Leaderboard");
    await shown(named("group", "Leaderboard period")).toMatchObject({ visible: true });

    await site.click({ text: "All time", exact: true });
    await at("/points?period=lifetime");
    await shown({ text: "All time", exact: true }).toMatchObject({ checked: true });

    await site.click({ text: "This month", exact: true });
    await at("/points");
    await shown({ text: "This month", exact: true }).toMatchObject({ checked: true });

    await opened("/points#people", "Leaderboard");
    await shown(named("group", "Leaderboard period")).toMatchObject({ count: 0 });
    expect((await site.layout()).mains).toBe(1);
  });
});

describe('Lock months from the owner\'s wallet (spec/frontend/monthLock.md, "Story: Lock months from the owner\'s wallet")', () => {
  it('How it works answers whether the owner can take this month\'s pool back (spec/frontend/projections.md, "Slop\'s pages refuse a withdrawal below the promised amount")', async () => {
    await opened("/how-it-works", "How Slop works");
    await shown(named("heading", "Can the owner take this month's pool back?", { level: 3 })).toMatchObject({ visible: true });
    await shown({ text: "the vault contract refuses to withdraw it" }).toMatchObject({ visible: true });
    await shown({ text: "Without a lock, Slop's pages refuse that withdrawal but the contract does not." }).toMatchObject({ visible: true });
  });
});
