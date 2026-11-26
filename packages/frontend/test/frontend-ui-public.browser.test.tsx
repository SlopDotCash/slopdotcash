import { slopFeeBase, submissionFeeItem } from "@repo/backend/client";
import { sha256Hex, webCrypto } from "@repo/platform/crypto";
import { reportDepositItem } from "@repo/security/client";
import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { type Hex, decodeFunctionData, encodeAbiParameters, pad, parseAbi, toEventSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { overLimitNotice } from "../gen/backend__backlogRule.ts";
import { pausedNotice } from "../gen/backend__intakeCap.ts";
import { wantedLabelName } from "../gen/backend__mergeActivity.ts";
import { promiseNoticeText } from "../gen/frontend__projections.ts";
import { contributorPullSearchUrl, type RegisteredRepository } from "@repo/points/client";
import { formatDateTime } from "../src/app/format.ts";
import { formatRewardMinor } from "../src/kernels/assetText.ts";
import { loginPath } from "../src/platform/environment.ts";
import { paidCycle } from "../src/screens/cycles/fixtures.ts";
import { pointsText } from "../src/screens/cycles/labels.ts";
import { FeeSetup, type FeePay, type PayAddress, openPayPage } from "../src/screens/fee/payFlow.vibe";
import { formatMonth } from "../src/screens/projects/summary.ts";
import { WalletChoice, walletChoiceServices } from "../src/wallets/core/discovery.vibe";
import { sessionSlots } from "../src/wallets/core/slots.ts";
import { depositedKey, feeDepositKey, publishedTerms } from "../src/wallets/fee/feeCalls.ts";
import type { LeaderboardTransport, PublishedActor, Target } from "./support/ui/protocol.ts";
import { accessible, at, named, shown, signIn, site } from "./support/ui/browser.ts";

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

interface Listed {
  readonly id: string;
  readonly tier: "community" | "featured";
  readonly repositoryId: number;
  readonly description?: string;
  readonly reward?: Readonly<Record<string, unknown>>;
  readonly slopbot?: Readonly<Record<string, unknown>>;
}

const nameOf = (project: Listed) => `Project ${project.id}`;

const pool = (id: string, repositoryNumber: number, monthlyCapMinor: string, monthlyCapDisplay: string, more: Omit<Listed, "id" | "tier" | "repositoryId"> & { readonly tier?: Listed["tier"] } = {}): Listed => ({
  id,
  tier: "community",
  repositoryId: repositoryNumber,
  ...more,
  reward: { monthlyCapMinor, monthlyCapDisplay, ...more.reward },
});

const listed: ReadonlyArray<Listed> = [
  pool("j4-alpha", 1411, "50000000", "$50"),
  pool("j4-beta", 1412, "50000000", "$50"),
  pool("j4-zeta", 1413, "50000000", "$50", { tier: "featured" }),
];
const unpaid: Listed = { id: "j4-gamma", tier: "community", repositoryId: 1414 };

function manifestOf(project: Listed) {
  const repository = `${steward.login}/${project.id}`;
  return {
    schemaVersion: "1",
    id: project.id,
    slug: project.id,
    name: nameOf(project),
    eyebrow: "Open-source project",
    headline: "Reproducible build tooling.",
    description: project.description ?? "Build and maintain reproducible build tooling.",
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
    reward: { kind: "monthly-pool", currency: "USDC", chain: "ethereum", rewardStartAt: "2026-11-01T00:00:00.000Z", cycle: "calendar-month-utc", monthlyCapMinor: "0", monthlyCapDisplay: "$0", committedMinor: "0", paymentMode: "disabled", feeBasisPoints: 100, unusedFunds: "rollover-without-cap-increase", fundingState: "pledged", ...project.reward },
    funding: { mode: "direct-noncustodial", disclosure: "Funds go directly to the project wallet.", recordsPath: `funding/${project.id}`, addresses: [] },
    modelPolicy: { mode: "open-declared", disclosureRequired: true },
    links: { repository: `https://github.com/${repository}`, issues: `https://github.com/${repository}/issues` },
    ...(project.slopbot === undefined ? {} : { slopbot: project.slopbot }),
  };
}

async function list(project: Listed) {
  const text = JSON.stringify(manifestOf(project));
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

const readingHeight = 560;
const paymentStages = named("heading", "Payment stages", { level: 2 });

async function paymentsTop() {
  return (await site.box(paymentStages))?.top ?? Number.POSITIVE_INFINITY;
}

async function scrollSettled() {
  let previous = Number.NaN;
  let steady = 0;
  await expect
    .poll(async () => {
      const current = await site.scrollY();
      steady = current === previous ? steady + 1 : 0;
      previous = current;
      return steady;
    }, { timeout: journeyMs })
    .toBeGreaterThanOrEqual(3);
  return previous;
}

async function openPayments() {
  await site.view(1280, readingHeight, false);
  await opened("/how-it-works", "How Slop works");
  await site.click(named("link", "monthly cutoff"));
  await at("/how-it-works#payments");
  await expect.poll(async () => Math.abs(await paymentsTop()), { timeout: journeyMs }).toBeLessThan(1);
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
      ["/points", "Contributors"],
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

  it('a fragment link aligns its section to the top, a wheel hands the page back to the reader, and a fragment opened while the page renders is aligned once it appears (spec/frontend/routes.md, "A fragment destination opens its section and stays aligned until it settles or the reader takes over")', async () => {
    await openPayments();

    const aligned = await scrollSettled();
    await site.wheel(0, -300);
    await expect.poll(() => site.scrollY(), { timeout: journeyMs }).toBeLessThan(aligned);
    const reading = await scrollSettled();
    expect(await paymentsTop()).toBeGreaterThan(100);
    expect(await site.scrollY()).toBe(reading);
    await at("/how-it-works#payments");

    expect((await site.open("/how-it-works#payments")).status).toBe(200);
    await expect.poll(async () => Math.abs(await paymentsTop()), { timeout: journeyMs }).toBeLessThan(1);
    await accessible();
  });

  for (const late of [false, true])
    it(`Back and Forward restore the fragment reading position after ${late ? "a destination that renders late" : "immediate navigation"} (spec/frontend/routes.md, "A fragment destination opens its section and stays aligned until it settles or the reader takes over")`, async () => {
      const sessionRead = "/api/v1/project-session";
      const sessionReads = async () => (await site.sent()).filter((sent) => sent.method === "GET" && sent.path === sessionRead).length;
      const near = (position: number) => async () => Math.abs((await site.scrollY()) - position);
      await site.allow("^failed GET /\\S+ net::ERR_ABORTED$");
      await openPayments();

      const fromBottom = async () => Math.abs((await site.scrollY()) - (await site.scrollEnd()));
      while ((await fromBottom()) >= 2) {
        const before = await site.scrollY();
        await site.wheel(0, Math.min(readingHeight, await fromBottom()));
        await expect.poll(() => site.scrollY(), { timeout: journeyMs }).not.toBe(before);
        await scrollSettled();
      }
      const destination = named("link", "Payouts", { within: { text: "Track it in" } });
      await site.reveal(destination);
      const reading = await scrollSettled();
      expect(await paymentsTop()).toBeLessThan(-100);
      await site.stamp("retained");

      const asked = await sessionReads();
      if (late) await site.hold("GET", sessionRead);
      await site.click(destination);
      await at("/earnings");
      if (late) await expect.poll(sessionReads, { timeout: journeyMs }).toBeGreaterThan(asked);
      await site.back();
      await site.release("GET", sessionRead);
      await at("/how-it-works#payments");
      await shown(paymentStages).toMatchObject({ count: 1 });
      await expect.poll(near(reading), { timeout: journeyMs }).toBeLessThan(2);
      expect(Math.abs((await scrollSettled()) - reading)).toBeLessThan(2);
      expect(await site.stamped()).toBe("retained");

      await site.wheel(0, -120);
      await expect.poll(() => site.scrollY(), { timeout: journeyMs }).not.toBe(reading);
      const continued = await scrollSettled();
      await site.back();
      await at("/how-it-works");
      await site.forward();
      await at("/how-it-works#payments");
      await shown(paymentStages).toMatchObject({ count: 1 });
      await expect.poll(near(continued), { timeout: journeyMs }).toBeLessThan(2);
      expect(Math.abs((await scrollSettled()) - continued)).toBeLessThan(2);
      await accessible();
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
  it('while the registry read is stalled Home keeps its heading and agent setup and shows no projects while it loads, then says there are none (spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"; spec/frontend/requests.md, "Loading, empty, stale, denied, invalid and unavailable remain distinct")', async () => {
    await site.hold("GET", "/api/v1/projects");
    expect((await site.open("/")).status).toBe(200);
    await shown(contributorHeading).toMatchObject({ visible: true });
    await shown(prompt).toMatchObject({ visible: true, text: "Read https://slop.cash/contribute/SKILL.md and follow it." });
    await shown({ text: "Loading", exact: true, within: projects }).toMatchObject({ count: 0 });
    await shown({ text: "No projects yet." }).toMatchObject({ count: 0 });

    await site.release("GET", "/api/v1/projects");
    await shown({ text: "No projects yet.", within: projects }).toMatchObject({ visible: true });
    await shown({ text: "Loading", exact: true, within: projects }).toMatchObject({ count: 0 });
    await shown(named("link", "Add a project", { within: projects })).toMatchObject({ href: "/projects/new" });
  });
});

describe('Pick a project from the Featured and Community sections (spec/frontend/poolListing.md, "Story: Pick a project from the Featured and Community sections")', () => {
  it('every listed project is one card in its own tier section, Featured before Community, each Community card in registry order, a configured month reads Configured and Not vaulted without a promise label, and a pool with no amount this month is left out (spec/frontend/poolListing.md, "Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page"; spec/frontend/poolListing.md, "Each home section orders stablecoin pools by shown monthly amount, then token pools, external prizes and points only, and breaks ties by Featured then registry order"; spec/frontend/poolListing.md, "A monthly pool is listed only while this month\'s configured amount is positive"; spec/frontend/projections.md, "Listings tag a positive current amount as Vaulted, Promised or Configured, and say when it is not vaulted"; spec/frontend/projections.md, "An owner\'s honor-system promise shows this month\'s amount as promised, never as vault-backed")', async () => {
    for (const project of [...listed, unpaid]) await list(project);
    expect((await site.open("/")).status).toBe(200);
    const featured = named("region", "Featured", { within: projects });
    const community = named("region", "Community", { within: projects });
    await shown(featured).toMatchObject({ visible: true });
    await shown(community).toMatchObject({ visible: true });

    for (const project of listed) {
      const card = named("link", nameOf(project), { exact: false, within: project.tier === "featured" ? featured : community });
      await shown(card).toMatchObject({ count: 1, visible: true, href: `/projects/${project.id}` });
      const text = await textOf(card);
      expect(["$50", "Configured", "Not vaulted", "Points only", "Promised"].filter((part) => text.includes(part))).toEqual(["$50", "Configured", "Not vaulted"]);
      await shown(named("link", nameOf(project), { exact: false, within: project.tier === "featured" ? community : featured })).toMatchObject({ count: 0 });
    }

    const grid = await textOf(projects);
    expect(grid.indexOf("Featured")).toBeLessThan(grid.indexOf("Community"));
    const communityText = await textOf(community);
    expect(communityText.indexOf(nameOf(listed[0]))).toBeLessThan(communityText.indexOf(nameOf(listed[1])));
    await shown({ text: "Promised", within: projects }).toMatchObject({ count: 0 });
    await shown({ text: "Points only", within: projects }).toMatchObject({ count: 0 });
    await shown(named("link", nameOf(unpaid), { exact: false, within: projects })).toMatchObject({ count: 0 });
  });
});

describe('Pick a project from the Featured and Community sections, ten Community rows to a page (spec/frontend/poolListing.md, "Story: Pick a project from the Featured and Community sections")', () => {
  it('Community shows ten rows to a page in registry order, the next page shows the rest, a description longer than 500 characters is cut at 500, and Home has no leaderboard (spec/frontend/poolListing.md, "Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page")', async () => {
    const long = `${"Reproducible builds for every release ".repeat(14)}and more.`;
    const first = pool("j4-a01", 1420, "100000000", "$100", { description: long });
    const many: ReadonlyArray<Listed> = [first, ...Array.from({ length: 11 }, (_, index) => pool(`j4-a${String(index + 2).padStart(2, "0")}`, 1421 + index, "100000000", "$100"))];
    for (const project of many) await list(project);
    expect((await site.open("/")).status).toBe(200);
    const community = named("region", "Community", { within: projects });
    const pages: Target = { label: "Community project pages", within: community };
    const row = (project: Listed) => named("link", nameOf(project), { exact: false, within: community });
    await shown(row(first)).toMatchObject({ count: 1, visible: true });
    for (const project of many.slice(0, 10)) await shown(row(project)).toMatchObject({ count: 1 });
    for (const project of many.slice(10)) await shown(row(project)).toMatchObject({ count: 0 });
    await shown({ text: "1 / 2", exact: true, within: community }).toMatchObject({ visible: true });
    const cut = `${Array.from(long).slice(0, 500).join("").trimEnd()}...`;
    expect(Array.from(long).length).toBeGreaterThan(500);
    expect(await textOf(row(first))).toContain(cut);

    await site.click(named("button", "Next page", { within: community }));
    await shown({ text: "2 / 2", exact: true, within: community }).toMatchObject({ visible: true });
    for (const project of many.slice(10)) await shown(row(project)).toMatchObject({ count: 1, visible: true });
    await shown(row(first)).toMatchObject({ count: 0 });
    await shown(pages).toMatchObject({ visible: true });
    await shown(named("heading", "Leaderboard")).toMatchObject({ count: 0 });
  });
});

describe('Choose the contributor or maintainer journey on Home (spec/frontend/presentation.md, "Story: Choose the contributor or maintainer journey on Home"; spec/ui/copy.md, "Story: Copy a value and know whether it worked")', () => {
  it('the switch sets the heading, the prompt and the address together, and a copy answer does not carry across journeys (spec/frontend/presentation.md, "Home offers a Contributor / Maintainer switch whose journey sets the heading, the prompt and every agent\'s skill address together"; spec/ui/copy.md, "Copying starts from ready and reports the browser\'s answer"; spec/ui/copy.md, "Success settles back to ready; failure stays until the next attempt")', async () => {
    // spec/frontend/presentation.md, "Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt"
    const contributorPrompt = "Read https://slop.cash/contribute/SKILL.md and follow it.";
    const maintainerPrompt = "Read https://slop.cash/maintain/SKILL.md and follow it.";
    expect((await site.open("/")).status).toBe(200);
    await shown(named("button", "Contributor")).toMatchObject({ visible: true });
    await shown(prompt).toMatchObject({ text: contributorPrompt });
    await shown(named("link", "Claude Code")).toMatchObject({ visible: true, href: `claude://code/new?q=${encodeURIComponent(contributorPrompt)}` });
    await shown(named("link", "Codex")).toMatchObject({ visible: true, href: `codex://new?prompt=${encodeURIComponent(contributorPrompt)}` });
    await shown(named("link", "Cursor")).toMatchObject({ visible: true, href: `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(encodeURIComponent(contributorPrompt))}` });
    await shown(named("link", "Antigravity")).toMatchObject({ visible: true, href: `antigravity://open?prompt=${encodeURIComponent(contributorPrompt)}` });
    await shown(named("link", "OpenClaw")).toMatchObject({ visible: true, href: `openclaw://agent?message=${encodeURIComponent(contributorPrompt)}` });
    await shown(named("link", "Hermes Agent")).toMatchObject({ visible: true, href: `hermes://skill/install?identifier=${encodeURIComponent("https://slop.cash/contribute/SKILL.md")}` });
    await shown(named("link", "GitHub Copilot")).toMatchObject({ visible: true, href: `ghapp://session/new?prompt=${encodeURIComponent(contributorPrompt)}` });
    await shown(named("link", "Grok Bot")).toMatchObject({ visible: true, href: `grokbot://app/v1/prompt?text=${encodeURIComponent(contributorPrompt)}` });
    await shown(named("link", "Meta Muse")).toMatchObject({ visible: true, href: "https://agent.meta.ai/chat" });
    await shown(named("link", "OpenCode")).toMatchObject({ visible: true, href: "opencode://" });
    await shown(named("link", "Meta AI (Muse Spark)")).toMatchObject({ count: 0 });
    await shown(named("link", "ChatGPT")).toMatchObject({ count: 0 });

    const copyButton = named("button", "Copy agent prompt", { exact: false });
    expect(await copyOutcome()).toBe("Ready");
    await site.click(copyButton);
    await expect.poll(copyOutcome, { timeout: journeyMs }).not.toBe("Ready");
    const answered = await copyOutcome();
    if (answered === "Copied") await expect.poll(copyOutcome, { timeout: journeyMs }).toBe("Ready");
    else {
      expect(answered).toBe("CopyFailed");
      await site.click(copyButton);
      await expect.poll(copyOutcome, { timeout: journeyMs }).not.toBe("Ready");
    }

    await site.click(copyButton);
    await expect.poll(copyOutcome, { timeout: journeyMs }).not.toBe("Ready");
    await site.click(named("button", "Maintainer"));
    await at("/?audience=maintainer");
    await shown(maintainerHeading).toMatchObject({ visible: true });
    await shown(contributorHeading).toMatchObject({ count: 0 });
    await shown(prompt).toMatchObject({ text: maintainerPrompt });
    await shown(named("link", "Claude Code")).toMatchObject({ href: `claude://code/new?q=${encodeURIComponent(maintainerPrompt)}` });
    await shown(named("link", "Hermes Agent")).toMatchObject({ href: `hermes://skill/install?identifier=${encodeURIComponent("https://slop.cash/maintain/SKILL.md")}` });
    expect(await copyOutcome()).toBe("Ready");

    await site.click(named("button", "Contributor"));
    await at("/");
    await shown(contributorHeading).toMatchObject({ visible: true });
    await shown(prompt).toMatchObject({ text: contributorPrompt });
    await shown(named("link", "Hermes Agent")).toMatchObject({ href: `hermes://skill/install?identifier=${encodeURIComponent("https://slop.cash/contribute/SKILL.md")}` });

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

  it('with motion the campaign deletes its action and types the next one without changing its accessible name or height, and reduced motion puts the whole heading back (spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion")', async () => {
    await site.view(1280, 900, false);
    expect((await site.open("/")).status).toBe(200);
    const visible = async () => (await textOf(contributorHeading)).replace(/\s+/gu, " ");
    const height = async () => {
      const box = await site.box(contributorHeading);
      return box === null ? 0 : box.bottom - box.top;
    };
    await shown(contributorHeading).toMatchObject({ count: 1, visible: true });
    const before = await height();
    expect(before).toBeGreaterThan(0);
    await expect.poll(visible, { timeout: journeyMs }).toBe("MAKE MONEY SECURING THE WEB.");
    await shown(contributorHeading).toMatchObject({ count: 1, visible: true });
    expect(await height()).toBe(before);

    await site.view(1280, 900, true);
    await expect.poll(visible, { timeout: journeyMs }).toBe("MAKE MONEY SHIPPING OPEN SOURCE.");
    await shown(contributorHeading).toMatchObject({ count: 1, visible: true });
    expect(await height()).toBe(before);
  });
});

const directory = Array.from({ length: 26 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return { actorId: `U_cdir${number}`, githubId: String(4_200_001 + index), login: `cdir-${number}` };
});

describe('Find a contributor in the public directory (spec/backend/accounts.md, "Story: Sign in with GitHub and keep one immutable account"; spec/ui/pagination.md, "Story: Move through pages without leaving the list")', () => {
  it('Contributors lists the public members matching ?q in login order, 24 to a page, with no Points figures or ranking, and keeps the Points rules behind Rules (spec/backend/accounts.md, "Public reads show only public open members and never publish anything"; spec/ui/pagination.md, "The page stays within the pages that exist"; spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"; spec/frontend/navigation.md, "The browser remembers its requested page independently of authentication")', async () => {
    for (const member of directory) await site.sql("INSERT OR IGNORE INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,'2026-11-01T00:00:00.000Z',1)", member.actorId, member.githubId, member.login);
    const people = named("region", "People");
    const person = (login: string) => named("link", login, { within: people });

    await opened("/points?q=cdir-", "Contributors");
    await shown({ text: "26 people", exact: true, within: people }).toMatchObject({ visible: true });
    for (const member of directory.slice(0, 24)) await shown(person(member.login)).toMatchObject({ count: 1, href: `/contributors/${member.login}` });
    for (const member of directory.slice(24)) await shown(person(member.login)).toMatchObject({ count: 0 });
    await shown({ text: "1 / 2", exact: true, within: people }).toMatchObject({ visible: true });
    await shown(named("button", "Retry contributors", { within: people })).toMatchObject({ visible: true });
    expect(await textOf(people)).not.toMatch(/points/iu);
    await shown(named("heading", "Leaderboard")).toMatchObject({ count: 0 });
    await shown(named("group", "Leaderboard period")).toMatchObject({ count: 0 });

    await site.click(named("button", "Next page", { within: people }));
    await shown({ text: "2 / 2", exact: true, within: people }).toMatchObject({ visible: true });
    for (const member of directory.slice(24)) await shown(person(member.login)).toMatchObject({ count: 1, visible: true });
    await shown(person("cdir-01")).toMatchObject({ count: 0 });

    await shown(named("link", "Rules")).toMatchObject({ count: 0 });
    await site.click(named("button", "Rules"));
    await shown(named("link", "Rules")).toMatchObject({ visible: true, href: "/protocol/points-v1.md" });
    await shown(named("link", "JSON")).toMatchObject({ visible: true, href: "/data/points.json" });

    await opened("/points?q=cdir-1", "Contributors");
    await shown({ text: "10 people", exact: true, within: people }).toMatchObject({ visible: true });
    await shown(person("cdir-10")).toMatchObject({ count: 1, visible: true });
    await shown(person("cdir-01")).toMatchObject({ count: 0 });
    await shown({ label: "People pages", within: people }).toMatchObject({ count: 0 });

    await opened("/points#people", "Contributors");
    await shown(people).toMatchObject({ visible: true });
    expect((await site.layout()).mains).toBe(1);
  });
});

function pointsManifest(projectId: string, repositories: ReadonlyArray<RegisteredRepository>) {
  const manifest = manifestOf({ id: projectId, tier: "community", repositoryId: 0 });
  return {
    ...manifest,
    authority: { ...manifest.authority, repositoryNodeId: repositories[0]?.nodeId ?? "" },
    repositories: repositories.map(({ id, aliases, displayName, githubUrl, description, integrationBranch, nodeId }) => ({ id, aliases, displayName, githubUrl, description, integrationBranch, nodeId })),
  };
}

const censusCounts = { merged: 17, open: 3, closed: 2 } as const;
const profileOnly = { id: "MDQ6VXNlcjEyMzQ1Njc=", login: "profile-only-contributor", avatarUrl: "https://avatars.githubusercontent.com/u/1234567", counts: { merged: 0, open: 3, closed: 2 } } as const;
const pullRequestLinks = [["Merged", "is:merged", "merged"], ["Open", "is:open", "open"], ["Closed", "is:closed is:unmerged", "closed"]] as const;

async function publishPoints(leaderboard: LeaderboardTransport = "whole") {
  const published = await site.published(leaderboard);
  const { registered } = published.registry;
  const projectIds = [...new Set(registered.map((repository) => repository.projectId))];
  await site.serve("/api/v1/projects", 200, { schemaVersion: "1", projects: projectIds.map((id) => pointsManifest(id, registered.filter((repository) => repository.projectId === id))) });
  const [leader] = published.leaders;
  const [primary] = registered;
  if (leader === undefined || primary === undefined) throw new Error("the published Points fixture has no leader or repository");
  const now = new Date().toISOString();
  await site.serve("/data/profiles.json", 200, {
    schemaVersion: "1",
    startedAt: now,
    generatedAt: now,
    repositories: registered.map((repository) => ({ repository: repository.id, count: repository.id === primary.id ? [censusCounts, profileOnly.counts].reduce((sum, counts) => sum + counts.merged + counts.open + counts.closed, 0) : 0, excluded: 0 })),
    people: [
      { id: leader.id, login: leader.login, avatarUrl: leader.avatarUrl, repositories: [{ repository: primary.id, ...censusCounts }] },
      { id: profileOnly.id, login: profileOnly.login, avatarUrl: profileOnly.avatarUrl, repositories: [{ repository: primary.id, ...profileOnly.counts }] },
    ],
  });
  return { ...published, leader, primary };
}

const slopPoints = named("region", "Slop Points");
const contributorProfile = named("region", "Contributor profile");
const pointsIndexPath = "/data/points.json";
const shardPathPattern = /^\/data\/points\/[0-9a-f]\.json$/u;

async function readsOf(matches: (path: string) => boolean) {
  return (await site.sent()).filter((sent) => sent.method === "GET" && matches(sent.path)).length;
}

async function profileOf(leader: PublishedActor) {
  await site.open(`/contributors/${leader.login}`);
  await shown(heading(leader.login)).toMatchObject({ visible: true });
}

describe('Read a contributor\'s profile over the published Points record (spec/frontend/views.md, "Story: Read a contributor\'s profile"; spec/points/projectionTransport.md, "Story: Read the published projection without mistaking a reset for a refusal")', () => {
  it('a contributor\'s address shows who they are and their pull requests from the published snapshot, census and journal without a Points figure, a contributor only the census names keeps the same record at 320 px with 200% text, and a login no record names is not found (spec/frontend/views.md, "A profile login resolves through membership, current actors, directory and journal in that order, and any current source vetoes a stale login")', async () => {
    const { leader } = await publishPoints();
    await profileOf(leader);
    await shown(named("link", `GitHub · @${leader.login}`)).toMatchObject({ visible: true, href: `https://github.com/${leader.login}` });
    await shown(contributorProfile).toMatchObject({ visible: true });
    for (const [label, query, key] of pullRequestLinks)
      await shown(named("link", `${censusCounts[key]} ${label}`, { within: contributorProfile })).toMatchObject({ visible: true, href: contributorPullSearchUrl(leader.login, query) });
    await expect.poll(() => readsOf((path) => shardPathPattern.test(path)), { timeout: journeyMs }).toBeGreaterThanOrEqual(16);
    expect(await readsOf((path) => path === pointsIndexPath)).toBeGreaterThanOrEqual(1);
    await shown(named("button", "Retry points", { within: slopPoints })).toMatchObject({ count: 0 });
    expect(await textOf(slopPoints)).not.toMatch(/\bpts\b|\bTotal\b/u);
    await accessible();

    expect((await site.open("/contributors/no-such-slop-login-zz9")).status).toBe(200);
    await shown(named("heading", "@no-such-slop-login-zz9 not found")).toMatchObject({ visible: true });
    await shown(named("link", "Find a contributor")).toMatchObject({ visible: true, href: "/points" });
    await shown(named("link", "GitHub · @no-such-slop-login-zz9")).toMatchObject({ count: 0 });

    await profileOf(profileOnly);
    await shown(named("link", `GitHub · @${profileOnly.login}`)).toMatchObject({ visible: true, href: `https://github.com/${profileOnly.login}` });
    for (const [label, query, key] of pullRequestLinks)
      await shown(named("link", `${profileOnly.counts[key]} ${label}`, { within: contributorProfile })).toMatchObject({ visible: true, href: contributorPullSearchUrl(profileOnly.login, query) });
    await shown({ text: "Total", exact: true }).toMatchObject({ count: 0 });
    await shown({ text: "Penalty history" }).toMatchObject({ count: 0 });
    await accessible();
    await site.view(320, 640, false);
    await site.enlarge(named("main"));
    await accessible();
    await site.restore();
  });

  it('a Points journal that cannot load keeps the confirmed contributor and offers Retry points without a stale notice, and Retry reads the journal once more and clears the notice (spec/frontend/requests.md, "Loading, empty, stale, denied, invalid and unavailable remain distinct"; spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"; spec/points/projectionTransport.md, "A reset read of the published index or a shard is repeated at most three times")', async () => {
    const { leader } = await publishPoints();
    await site.allow(`^503 GET ${pointsIndexPath}$`, "^console Failed to load resource: the server responded with a status of 503");
    await site.fail("GET", pointsIndexPath, 503, "Points temporarily unavailable");
    await profileOf(leader);
    const retry = named("button", "Retry points", { within: slopPoints });
    await shown(retry).toMatchObject({ visible: true });
    await shown({ text: "Could not load", within: slopPoints }).toMatchObject({ visible: true });
    await shown(named("link", `GitHub · @${leader.login}`)).toMatchObject({ visible: true });
    await shown({ text: "Data last updated", within: slopPoints }).toMatchObject({ count: 0 });
    expect(await readsOf((path) => shardPathPattern.test(path))).toBe(0);

    const before = await readsOf((path) => path === pointsIndexPath);
    expect(before).toBe(1);
    await site.unfail("GET", pointsIndexPath);
    await site.click(retry);
    await expect.poll(() => readsOf((path) => shardPathPattern.test(path)), { timeout: journeyMs }).toBe(16);
    await shown(retry).toMatchObject({ count: 0 });
    expect(await readsOf((path) => path === pointsIndexPath)).toBe(before + 1);
    await shown({ text: "Data last updated", within: slopPoints }).toMatchObject({ count: 0 });
  });

  for (const corrupted of [false, true])
    it(`a profile reads a leaderboard published in parts ${corrupted ? "and refuses the generation when a part does not match its digest, showing no record until Retry reads matching parts" : "as one generation"} (spec/points/ingestion.md, "A multi-part leaderboard is read as one content-addressed generation"; spec/frontend/snapshotCache.md, "A cached snapshot is fresh for 60 seconds, stale 8 hours after generation, and a failed read retries once after 400 ms unless aborted")`, async () => {
      const { leader, parts } = await publishPoints("parts");
      const [first] = parts;
      expect(first).toBeDefined();
      if (corrupted && first !== undefined) await site.serveBytes(first, 200, new TextEncoder().encode("changed"), "text/plain; charset=utf-8");
      await profileOf(leader);
      if (!corrupted) {
        await shown(contributorProfile).toMatchObject({ visible: true });
        await shown(named("link", `GitHub · @${leader.login}`)).toMatchObject({ visible: true });
        expect(await readsOf((path) => path === "/data/leaderboard.json")).toBeGreaterThanOrEqual(1);
        expect(await readsOf((path) => parts.includes(path))).toBeGreaterThanOrEqual(parts.length);
        return;
      }
      await shown(named("button", "Retry")).toMatchObject({ visible: true });
      await shown({ text: "Could not load" }).toMatchObject({ visible: true });
      await shown(contributorProfile).toMatchObject({ count: 0 });
      await shown(named("link", `GitHub · @${leader.login}`)).toMatchObject({ count: 0 });
      expect(await readsOf((path) => path === first)).toBeGreaterThanOrEqual(1);

      await site.published("parts");
      await site.click(named("button", "Retry"));
      await shown(contributorProfile).toMatchObject({ visible: true });
      await shown(named("link", `GitHub · @${leader.login}`)).toMatchObject({ visible: true });
    });

  it('a contributor renamed since an archived cycle keeps that cycle on the current profile, which opens the cycle and shows the same record again on Back (spec/frontend/views.md, "A profile login resolves through membership, current actors, directory and journal in that order, and any current source vetoes a stale login")', async () => {
    const { leader, primary } = await publishPoints();
    const [paid] = paidCycle.contributors;
    expect(paid).toBeDefined();
    if (paid === undefined) return;
    const archived = {
      ...paidCycle,
      projectId: primary.projectId,
      cycleId: "2026-07",
      generatedAt: "2026-08-10T00:00:00.000Z",
      contributionWindow: { from: "2026-07-01T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" },
      reviewEndsAt: "2026-08-15T00:00:00.000Z",
      approvedAt: "2026-08-05T00:00:00.000Z",
      settledAt: "2026-08-08T00:00:00.000Z",
      contributors: [{ ...paid, actor: { id: leader.id, login: `${leader.login}-old` }, score: 70 }],
    };
    await site.serve("/data/cycles/index.json", 200, { schemaVersion: "1", generatedAt: archived.generatedAt, cycles: [archived] });
    const payments = named("region", "Awards and payments");
    const pastCycle = named("link", `Project ${primary.projectId} · ${formatMonth("2026-07")}`, { within: payments });

    await profileOf(leader);
    await shown(pastCycle).toMatchObject({ visible: true, href: `/cycles/${primary.projectId}/2026-07` });
    await expect.poll(() => textOf(payments), { timeout: journeyMs }).toContain(`${pointsText(210)} pts`);
    expect(await textOf(payments)).toContain(`${formatRewardMinor(BigInt(paid.paidMinor))} USDC`);
    await shown(named("link", `GitHub · @${leader.login}`)).toMatchObject({ visible: true });
    await expect.poll(() => readsOf((path) => shardPathPattern.test(path)), { timeout: journeyMs }).toBeGreaterThanOrEqual(16);
    await shown({ text: "Loading", exact: true, within: slopPoints }).toMatchObject({ count: 0 });

    await site.click(pastCycle);
    await at(`/cycles/${primary.projectId}/2026-07`);
    await shown(heading(`Project ${primary.projectId} · ${formatMonth("2026-07")}`)).toMatchObject({ visible: true });
    await site.back();
    await at(`/contributors/${leader.login}`);
    await shown(pastCycle).toMatchObject({ visible: true });
    await profileOf(leader);
    await shown(pastCycle).toMatchObject({ visible: true });
    await accessible();
  });
});

const configuredPool = pool("j4-pool-set", 1440, "500000000", "$500");
const promisedPool = pool("j4-pool-promise", 1441, "250000000", "$250", { reward: { honorSystem: true } });

describe('Show a monthly amount only while the vault holds it (spec/frontend/projections.md, "Story: Show a monthly amount only while the vault holds it")', () => {
  it('Home and /sponsors tag a configured pool Configured and an owner\'s honor-system promise Promised, each beside Not vaulted, and only the promised project\'s page keeps the month as a promise (spec/frontend/projections.md, "Listings tag a positive current amount as Vaulted, Promised or Configured, and say when it is not vaulted"; spec/frontend/poolListing.md, "A monthly pool is listed only while this month\'s configured amount is positive"; spec/frontend/projections.md, "An owner\'s honor-system promise shows this month\'s amount as promised, never as vault-backed")', async () => {
    for (const project of [configuredPool, promisedPool]) await list(project);
    expect((await site.open("/")).status).toBe(200);
    const community = named("region", "Community", { within: projects });
    const card = (project: Listed) => named("link", nameOf(project), { exact: false, within: community });
    await shown(card(configuredPool)).toMatchObject({ count: 1, visible: true, href: `/projects/${configuredPool.id}` });
    await shown(card(promisedPool)).toMatchObject({ count: 1, visible: true, href: `/projects/${promisedPool.id}` });
    const configured = await textOf(card(configuredPool));
    const promised = await textOf(card(promisedPool));
    expect([configured, promised].map((text) => ["$500", "$250", "Configured", "Promised", "Not vaulted", "Points only"].filter((part) => text.includes(part)))).toEqual([
      ["$500", "Configured", "Not vaulted"],
      ["$250", "Promised", "Not vaulted"],
    ]);

    await opened("/sponsors", "Fund a project");
    await shown(named("link", nameOf(configuredPool), { exact: false })).toMatchObject({ visible: true, href: `/projects/${configuredPool.id}/funding` });
    await shown({ text: "$500 monthly · Configured · Not vaulted" }).toMatchObject({ visible: true });
    await shown({ text: "$250 monthly · Promised · Not vaulted" }).toMatchObject({ visible: true });

    expect((await site.open(`/projects/${promisedPool.id}`)).status).toBe(200);
    await shown({ text: "/mo · Promised · Not vaulted" }).toMatchObject({ visible: true });
    await shown({ text: promiseNoticeText, exact: true }).toMatchObject({ visible: true });
    await shown({ text: "Points only", exact: true }).toMatchObject({ count: 0 });

    expect((await site.open(`/projects/${configuredPool.id}`)).status).toBe(200);
    await shown({ text: "Points only", exact: true }).toMatchObject({ visible: true });
    await shown({ text: promiseNoticeText, exact: true }).toMatchObject({ count: 0 });
  });

  it('a pool whose registered vault held this month\'s amount at the month start and still holds it is tagged Vaulted on Home and in the vault on /sponsors, never Not vaulted (spec/frontend/projections.md, "Listings tag a positive current amount as Vaulted, Promised or Configured, and say when it is not vaulted"; spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/settlement/vaultSnapshots.md, "The first finalized read of each UTC month is recorded once per vault and never changes")', async () => {
    const funded = pool("j4-pool-vaulted", 1444, "50000000", "$50", { reward: { chain: "base" } });
    await list(funded);
    const deployed = await site.vault({ projectId: funded.id });
    const now = new Date().toISOString();
    await site.sql("UPDATE vault_snapshots SET total_deposited = '60000000', free_balance = '60000000', observed_at = ? WHERE project_id = ?", now, funded.id);
    await site.sql(
      "INSERT OR IGNORE INTO vault_month_starts(project_id,network,vault,period,free_balance,total_gross_withdrawn,block_number,block_time,observed_at) VALUES(?,'base-mainnet',?,?,'60000000','0','1',?,?)",
      funded.id,
      deployed.vault,
      now.slice(0, 7),
      now,
      now,
    );

    expect((await site.open("/")).status).toBe(200);
    const card = named("link", nameOf(funded), { exact: false, within: projects });
    await shown(card).toMatchObject({ count: 1, visible: true, href: `/projects/${funded.id}` });
    const text = await textOf(card);
    expect(["$50", "Vaulted", "Not vaulted", "Configured", "Promised", "Points only"].filter((part) => text.includes(part))).toEqual(["$50", "Vaulted"]);

    await opened("/sponsors", "Fund a project");
    await shown({ text: "$50 monthly · in the vault" }).toMatchObject({ visible: true });
  });
});

const capped = pool("j4-capped", 1442, "300000000", "$300", { slopbot: { intakeCap: 2, wantedIssues: true } });
const belowCap = pool("j4-below-cap", 1443, "300000000", "$300", { slopbot: { intakeCap: 5 } });
const backlog = pool("j4-backlog", 1446, "300000000", "$300");
const activeNoCap = pool("j4-active-no-cap", 1447, "300000000", "$300");
const wantedIssue = { number: 7, title: "Fix the build cache", url: `https://github.com/${steward.login}/${capped.id}/issues/7`, openPullRequests: 0 };

async function observed(project: Listed, openOutside: number, wanted: ReadonlyArray<typeof wantedIssue> | null, waitingOutside = 0, at: string | null = null) {
  const now = at ?? new Date().toISOString();
  const label = wanted === null ? null : wantedLabelName;
  await site.sql(
    "INSERT OR REPLACE INTO repository_merge_activity(project_id,repository,observed_at,attempted_at,failure,last_merged_at,waiting_outside,waiting_capped,merged_outside_30d,median_merge_hours,open_outside,open_outside_capped,wanted_label,wanted_issues,wanted_label_ready) VALUES(?,?,?,?,NULL,?,?,0,1,30,?,0,?,?,?)",
    project.id,
    `${steward.login}/${project.id}`,
    now,
    now,
    now,
    waitingOutside,
    openOutside,
    label,
    wanted === null ? null : JSON.stringify(wanted),
    label,
  );
}

describe('Pause new contributors while the review queue is full (spec/backend/intakeCap.md, "Story: Pause new contributors while the review queue is full"; spec/frontend/views.md, "Story: Read a project\'s rewards and activity at a glance")', () => {
  it('a project at its intake cap is left out of Home and /sponsors and its page says why and lists its wanted issue, while one below its cap is listed as before (spec/backend/intakeCap.md, "The lists leave a paused project out, its page says why, and a failed read lists it as before"; spec/frontend/views.md, "Suggested work lists the wanted issues first, unclaimed before taken, at most ten, and a failed wanted read leaves the suggestions as before")', async () => {
    for (const project of [capped, belowCap]) await list(project);
    await observed(capped, 2, [wantedIssue]);
    await observed(belowCap, 2, null);

    expect((await site.open("/")).status).toBe(200);
    const listedCard = (project: Listed) => named("link", nameOf(project), { exact: false, within: projects });
    await shown(listedCard(belowCap)).toMatchObject({ count: 1, visible: true });
    await shown(listedCard(capped)).toMatchObject({ count: 0 });

    await opened("/sponsors", "Fund a project");
    await shown(named("link", nameOf(belowCap), { exact: false })).toMatchObject({ visible: true, href: `/projects/${belowCap.id}/funding` });
    await shown(named("link", nameOf(capped), { exact: false })).toMatchObject({ count: 0 });

    expect((await site.open(`/projects/${capped.id}`)).status).toBe(200);
    await shown({ text: pausedNotice, exact: true }).toMatchObject({ visible: true });
    const work = named("region", "Suggested work");
    await shown(named("link", `Wanted. Issue #${wantedIssue.number}: ${wantedIssue.title}`, { within: work })).toMatchObject({ visible: true, href: wantedIssue.url });
  });
});

describe('Backlog rule on Home and /sponsors (spec/backend/backlogRule.md, "Story: Keep the lists to projects whose maintainers are keeping up")', () => {
  it('hides an over-limit project on Home and /sponsors even with no intake cap (spec/backend/backlogRule.md, "The lists leave an out-of-rotation project out and its page says why")', async () => {
    for (const project of [backlog, activeNoCap]) await list(project);
    await site.clock("2026-12-02T00:00:00.000Z");
    await observed(backlog, 0, null, 50, "2026-12-02T00:00:00.000Z");
    await observed(activeNoCap, 2, null, 0, "2026-12-02T00:00:00.000Z");

    expect((await site.open("/")).status).toBe(200);
    const listedCard = (project: Listed) => named("link", nameOf(project), { exact: false, within: projects });
    await shown(listedCard(activeNoCap)).toMatchObject({ count: 1, visible: true });
    await shown(listedCard(backlog)).toMatchObject({ count: 0 });

    await opened("/sponsors", "Fund a project");
    await shown(named("link", nameOf(activeNoCap), { exact: false })).toMatchObject({ visible: true, href: `/projects/${activeNoCap.id}/funding` });
    await shown(named("link", nameOf(backlog), { exact: false })).toMatchObject({ count: 0 });

    expect((await site.open(`/projects/${backlog.id}`)).status).toBe(200);
    await shown({ text: overLimitNotice, exact: true }).toMatchObject({ visible: true });
  });
});


describe('Keep browsing on the last published registry when the live read fails (spec/frontend/registry.md, "Story: Keep browsing on the last published registry when the live read fails")', () => {
  it('/sponsors whose live registry read times out with no published copy keeps the header and footer and offers Try again, which opens the page once the read answers (spec/frontend/registry.md, "A failed live registry read installs the last published registry labelled stale with its sync time, and both failing shows the error"; spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"; spec/frontend/requests.md, "Loading, empty, stale, denied, invalid and unavailable remain distinct")', async () => {
    await site.allow("^failed GET /api/v1/projects ");
    await site.hold("GET", "/api/v1/projects");
    expect((await site.open("/sponsors")).status).toBe(200);
    await shown({ text: "Projects unavailable" }).toMatchObject({ visible: true });
    await shown(heading("Projects are unavailable")).toMatchObject({ visible: true });
    await shown(heading("Fund a project")).toMatchObject({ count: 0 });
    await shown(named("link", "Slop home")).toMatchObject({ visible: true, href: "/" });
    await shown(named("link", "GitHub")).toMatchObject({ visible: true });
    await at("/sponsors");
    expect((await site.layout()).mains).toBe(1);

    await site.release("GET", "/api/v1/projects");
    await site.click(named("button", "Try again"));
    await shown(heading("Fund a project")).toMatchObject({ visible: true });
    await shown({ text: "Projects unavailable" }).toMatchObject({ count: 0 });
    await at("/sponsors");
  });

  it('a failed live registry read lists the last published projects under a stale label with their sync time, a project page keeps the label, the manage page asks for current data, an account page shows no label, and Try again clears it once the live read answers (spec/frontend/registry.md, "A failed live registry read installs the last published registry labelled stale with its sync time, and both failing shows the error"; spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"; spec/frontend/requests.md, "Loading, empty, stale, denied, invalid and unavailable remain distinct")', async () => {
    const cached = pool("j4-cached", 1445, "75000000", "$75");
    await list(cached);
    const syncedAt = "2026-10-16T12:00:00.000Z";
    const notice = { label: "Project data status" } satisfies Target;
    const listedCard = named("link", nameOf(cached), { exact: false, within: projects });
    await site.allow("^503 GET /api/v1/projects$", "^console Failed to load resource: the server responded with a status of 503");
    await site.fail("GET", "/api/v1/projects", 503, { error: "unavailable", message: "The project registry is unavailable." });
    await site.serve("/data/project-registry.json", 200, { schemaVersion: "1", syncedAt, projects: [manifestOf(cached)] });

    expect((await site.open("/")).status).toBe(200);
    await shown(notice).toMatchObject({ visible: true, text: expect.stringContaining(`Projects stale · ${formatDateTime(syncedAt)}`) });
    await shown(named("button", "Try again", { within: notice })).toMatchObject({ visible: true });
    await shown(listedCard).toMatchObject({ count: 1, visible: true, href: `/projects/${cached.id}` });
    await shown(heading("Projects are unavailable")).toMatchObject({ count: 0 });
    await accessible();

    expect((await site.open(`/projects/${cached.id}`)).status).toBe(200);
    await shown(named("heading", nameOf(cached), { level: 1, exact: false })).toMatchObject({ visible: true });
    await shown(notice).toMatchObject({ visible: true });

    expect((await site.open(`/projects/${cached.id}/manage`)).status).toBe(200);
    await shown(heading("Projects are unavailable")).toMatchObject({ visible: true });
    await shown({ text: "This page needs current project data." }).toMatchObject({ visible: true });
    await shown(notice).toMatchObject({ count: 0 });

    expect((await site.open("/account")).status).toBe(200);
    await shown(heading("Settings")).toMatchObject({ visible: true });
    await shown(notice).toMatchObject({ count: 0 });

    expect((await site.open("/")).status).toBe(200);
    await shown(notice).toMatchObject({ visible: true });
    await site.unfail("GET", "/api/v1/projects");
    await site.click(named("button", "Try again", { within: notice }));
    await shown(notice).toMatchObject({ count: 0 });
    await shown(listedCard).toMatchObject({ count: 1, visible: true });
    await site.unserve("/data/project-registry.json");
  });
});

describe('Every part reads the same published fee terms (spec/backend/submissionFeeTerms.md, "Story: Every part reads the same published fee terms"; spec/settlement/maintainerShare.md, "Story: Take the maintainer share out of the monthly amount"; spec/security/reportDeposit.md, "Story: Hold a private report until its refundable deposit is recorded")', () => {
  it('How it works answers whether maintainers are paid, whether opening a pull request costs a fee and whether a security report needs a deposit (spec/settlement/maintainerShare.md, "The share is a floor of the monthly amount and is split by decisions with ties to the lower account"; spec/settlement/maintainerShare.md, "A change starts with the next UTC month, and a month is proposed only from a complete read"; spec/backend/submissionFeeTerms.md, "The submission fee terms are published constants that change only by a reviewed change"; spec/security/reportDeposit.md, "A paid deposit is sent back on a first response and kept only after a keeping close stood seven days")', async () => {
    await opened("/how-it-works#faq", "How Slop works");
    const faq = named("region", "Questions");
    for (const question of ["Can maintainers be paid?", "Is there a fee to open a pull request?", "Is there a deposit to file a security report?"])
      await shown(named("heading", question, { level: 3, within: faq })).toMatchObject({ visible: true });
    const answers = [
      "when a project sets a maintainer share",
      "up to 30% of the monthly amount",
      "a close counts the same as a merge",
      "starts with the next UTC month",
      "the whole amount stays with contributors",
      "Only on a project whose owner turned on the refundable submission fee",
      "2 USDC on Base or 2 USDG on Robinhood Chain",
      "in SLOP on Robinhood Chain at half",
      "a merge sends it back, and so do 14 days without a maintainer decision",
      "closed without a merge for 7 days",
      "never closed for that reason",
      "The report is stored at once and screened once the deposit is recorded",
      "A report is never closed or deleted for an unpaid deposit.",
    ];
    for (const answer of answers) await shown({ text: answer, within: faq }).toMatchObject({ visible: true });
  });
});

const recipient = { id: 2183, login: "octo-alloc" } as const;
const allocation = named("region", "Contributor allocation");
const allocationPath = "/contributor-allocation.json";

describe('See my contributor allocation on Payouts (spec/frontend/projections.md, "Story: See my contributor allocation on Payouts")', () => {
  it('a timed-out read is Allocation unavailable with Retry, and Retry shows only the signed-in account\'s row, awaiting a wallet, with where to add it, and from the deadline the same row is Unclaimed with no wallet link (spec/frontend/projections.md, "Payouts shows only the signed-in account\'s allocation row, and a failed read is unavailable, never absent"; spec/frontend/projections.md, "The row is Sent with a transfer, Unclaimed after the final batch, Scheduled with a timely wallet, and otherwise Awaiting wallet until the deadline and Unclaimed from it")', async () => {
    await site.clock(new Date().toISOString());
    await site.user(recipient.id, recipient.login);
    await site.allow(`^failed GET ${allocationPath} `);
    await site.hold("GET", allocationPath);
    await signIn(recipient.login, "/earnings");
    await shown({ text: "Allocation unavailable" }).toMatchObject({ visible: true });
    await shown(allocation).toMatchObject({ count: 0 });

    await site.release("GET", allocationPath);
    await site.click(named("button", "Retry", { exact: true }));
    await shown(allocation).toMatchObject({ visible: true });
    await shown({ text: "Allocation unavailable" }).toMatchObject({ count: 0 });
    const row = await textOf(allocation);
    expect(["1,536", "SLOP", "Awaiting wallet", "9,753", "Scheduled", "Sent"].filter((part) => row.includes(part))).toEqual(["1,536", "SLOP", "Awaiting wallet"]);
    await shown(named("link", "Add Robinhood Chain wallet", { within: allocation })).toMatchObject({ visible: true, href: "/account#wallets" });

    await site.clock("2027-02-08T16:59:45.000Z");
    expect((await site.open("/earnings")).status).toBe(200);
    await shown({ text: "Awaiting wallet", within: allocation }).toMatchObject({ visible: true });
    await shown({ text: "Unclaimed", exact: true, within: allocation }).toMatchObject({ visible: true });
    await shown({ text: "Awaiting wallet", within: allocation }).toMatchObject({ count: 0 });
    await shown(named("link", "Add Robinhood Chain wallet", { within: allocation })).toMatchObject({ count: 0 });
    const missed = await textOf(allocation);
    expect(["1,536", "SLOP", "Unclaimed", "Scheduled", "Sent"].filter((part) => missed.includes(part))).toEqual(["1,536", "SLOP", "Unclaimed"]);
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

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const payerAddress = account.address.toLowerCase();
const base = publishedTerms.networks.find((network) => network.network === "base-mainnet");
const robinhood = publishedTerms.networks.find((network) => network.network === "robinhood-mainnet");
if (base === undefined || robinhood === undefined) throw new Error("published terms name base-mainnet and robinhood-mainnet");
const usdc = base.tokens.find((token) => token.symbol === "USDC");
const slop = robinhood.tokens.find((token) => token.symbol === "SLOP");
if (usdc === undefined || slop === undefined) throw new Error("published terms name USDC and SLOP");
const repositoryId = "123456";
const pullNumber = 7;
const caseId = "sc_reportcase01";
const pullItem = submissionFeeItem(repositoryId, pullNumber) ?? "";
const reportItem = reportDepositItem(caseId) ?? "";
const stableMinor = "2000000";
const rate = "250";
const slopAmount = slopFeeBase(stableMinor, rate) ?? "";
const reportAmount = (395n * 10n ** 18n).toString();
const depositedTopic = toEventSelector("Deposited(uint256,bytes32,address,address,uint128,address)");
const depositAbi = parseAbi(["function deposit(bytes32 item, address token, uint128 amount, address keptTo) returns (uint256 id)", "function approve(address,uint256) returns (bool)"]);
const askedAt = "2026-11-20T10:00:00.000Z";
const pullAddress: PayAddress = { kind: "pullRequest", owner: "acme", repo: "widget", number: String(pullNumber) };
const reportAddress: PayAddress = { kind: "report", caseId };
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  sessionStorage.clear();
});

const quantity = (value: bigint) => `0x${value.toString(16)}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const blockHash = (block: bigint) => `0x${block.toString(16).padStart(64, "b")}`;

function stableWay(overrides: Record<string, unknown> = {}) {
  return { network: base?.network, chainId: base?.chainId, contract: base?.contract, token: usdc?.address, symbol: "USDC", decimals: 6, amount: stableMinor, minimumAccepted: stableMinor, keptTo: publishedTerms.feeWallet, ...overrides };
}

function slopWay(amount: string, overrides: Record<string, unknown> = {}) {
  return { network: robinhood?.network, chainId: robinhood?.chainId, contract: robinhood?.contract, token: slop?.address, symbol: "SLOP", decimals: 18, amount, minimumAccepted: amount, keptTo: publishedTerms.burn, ...overrides };
}

function paid(network: string, token: string, amount: string, finalized: boolean) {
  return { at: "2026-11-20T11:00:00.000Z", network, depositId: 1, token, amount, transaction: `0x${"a".repeat(64)}`, finalized };
}

function pullRecord(due: ReadonlyArray<unknown>, settled: Record<string, unknown> = {}) {
  return { schema: "slop-submission-fee-item-v1", repositoryId: Number(repositoryId), pullNumber, projectId: "demo", item: pullItem, stableMinor, askedAt, due, paid: null, outcome: null, outcomeAt: null, resolveTransaction: null, ...settled };
}

function reportRecord(due: ReadonlyArray<unknown>, settled: Record<string, unknown> = {}) {
  return { schema: "slop-report-deposit-v1", caseId, item: reportItem, askedAt, due, paid: null, outcome: null, outcomeReason: null, outcomeAt: null, resolveTransaction: null, ...settled };
}

const registry = { schemaVersion: "1", projects: [{ id: "demo", name: "Demo", slug: "demo", status: "active", listingTier: "listed", authority: { repositoryId }, repositories: [{ id: "acme/widget", aliases: [] }] }] };

interface Api {
  item: unknown;
  report: unknown;
  rate: unknown;
  reads: string[];
}

function api(state: Partial<Api> = {}) {
  const held: Api = { item: undefined, report: undefined, rate: { schema: "slop-submission-fee-rate-v1", slopShareBps: 5000, rate: { effectiveAt: askedAt, slopPerUsd: rate }, previous: null }, reads: [], ...state };
  const answer = (body: unknown) => (body === undefined ? new Response(null, { status: 404 }) : body === "down" ? new Response(null, { status: 503 }) : Response.json(body));
  const fetch: typeof globalThis.fetch = (input) => {
    const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
    held.reads.push(path);
    if (path === "/api/v1/projects") return Promise.resolve(Response.json(registry));
    if (path === `/api/v1/submission-fee/items/${repositoryId}/${pullNumber}`) return Promise.resolve(answer(held.item));
    if (path === `/api/v1/submission-fee/reports/${caseId}`) return Promise.resolve(answer(held.report));
    if (path === "/api/v1/submission-fee/rate") return Promise.resolve(answer(held.rate));
    return Promise.resolve(new Response(null, { status: 404 }));
  };
  return { held, fetch };
}

interface Mined {
  readonly hash: string;
  readonly from: string;
  readonly to: string;
  readonly input: string;
  readonly block: bigint;
  readonly logs: ReadonlyArray<{ address: string; topics: string[]; data: string }>;
}

function fakeChain(options: { atomic: boolean; unclear?: boolean }) {
  let chain = 1n;
  let finalized = 0n;
  const allowances = new Map<string, bigint>();
  const mined: Mined[] = [];
  const seen: string[] = [];
  const savedAtPrompt: Array<string | null> = [];
  let watchedKey = "";
  const mine = (transaction: { to: string; data: string }) => {
    const block = BigInt(mined.length + 10);
    const decoded = decodeFunctionData({ abi: depositAbi, data: transaction.data as Hex });
    const logs = [];
    if (decoded.functionName === "approve") allowances.set(transaction.to.toLowerCase(), BigInt(decoded.args[1]));
    else {
      const [item, token, amount, keptTo] = decoded.args;
      logs.push({ address: transaction.to, topics: [depositedTopic, word(1n), item, pad(payerAddress as Hex)], data: encodeAbiParameters([{ type: "address" }, { type: "uint128" }, { type: "address" }], [token, amount, keptTo]) });
    }
    const entry: Mined = { hash: `0x${(mined.length + 1).toString(16).padStart(64, "c")}`, from: payerAddress, to: transaction.to, input: transaction.data, block, logs };
    mined.push(entry);
    return entry;
  };
  const provider = {
    async request({ method, params = [] }: { method: string; params?: ReadonlyArray<unknown> }) {
      seen.push(method);
      const [first] = params as ReadonlyArray<Record<string, unknown>>;
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account.address];
      if (method === "eth_chainId") return quantity(chain);
      if (method === "wallet_switchEthereumChain") {
        chain = BigInt(String(first?.chainId));
        return null;
      }
      if (method === "eth_getCode") return "0x6080";
      if (method === "eth_call") {
        const data = String(first?.data);
        if (data.startsWith("0x70a08231")) return word(10n ** 30n);
        if (data.startsWith("0xdd62ed3e")) return word(allowances.get(String(first?.to).toLowerCase()) ?? 0n);
        return word(0n);
      }
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "wallet_getCapabilities") return options.atomic ? { [quantity(chain)]: { atomic: { status: "supported" } } } : {};
      if (method === "eth_sendTransaction") {
        savedAtPrompt.push(sessionStorage.getItem(watchedKey));
        if (options.unclear === true) throw Object.assign(new Error("The wallet lost the request."), { code: -32603 });
        return mine(first as unknown as { to: string; data: string }).hash;
      }
      if (method === "wallet_sendCalls") {
        savedAtPrompt.push(sessionStorage.getItem(watchedKey));
        const last = (first as unknown as { calls: Array<{ to: string; data: string }> }).calls.map(mine).at(-1);
        return { id: `batch-${last?.hash ?? ""}` };
      }
      if (method === "wallet_getCallsStatus") return { status: 200, receipts: [{ transactionHash: String(params[0]).slice(6) }] };
      if (method === "eth_getTransactionReceipt") {
        const entry = mined.find((item) => item.hash === params[0]);
        return entry === undefined ? null : { status: "0x1", transactionHash: entry.hash, blockNumber: quantity(entry.block), blockHash: blockHash(entry.block), logs: entry.logs.map((log, index) => ({ ...log, blockNumber: quantity(entry.block), blockHash: blockHash(entry.block), transactionHash: entry.hash, logIndex: quantity(BigInt(index)), removed: false })) };
      }
      if (method === "eth_getTransactionByHash") {
        const entry = mined.find((item) => item.hash === params[0]);
        return entry === undefined ? null : { from: entry.from, to: entry.to, input: entry.input, value: "0x0" };
      }
      if (method === "eth_getBlockByNumber") return params[0] === "finalized" ? { number: quantity(finalized), hash: blockHash(finalized) } : { number: params[0], hash: blockHash(BigInt(String(params[0]))) };
      throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
    },
  };
  return {
    provider,
    seen,
    mined,
    savedAtPrompt,
    watch: (key: string) => {
      watchedKey = key;
    },
    finalize: () => {
      finalized = 1_000n;
    },
  };
}

function announce(uuid: string, provider: unknown) {
  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid, name: "Payer wallet", rdns: "test.payer", icon: "data:image/svg+xml,<svg/>" }, provider }) }));
}

function started(fetch: typeof globalThis.fetch, switches: { submissionFee: boolean; reportDeposit: boolean } = { submissionFee: true, reportDeposit: true }) {
  const setup = Layer.succeed(FeeSetup, { ...switches, terms: publishedTerms });
  const runtime = ManagedRuntime.make(Layer.mergeAll(walletChoiceServices, webCrypto, FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetch), setup));
  cleanups.push(() => void runtime.dispose());
  return runtime;
}

const walletId = Effect.gen(function* () {
  const choice = yield* WalletChoice;
  return (yield* choice.current()).find((offer) => offer.name === "Payer wallet")?.id ?? 0;
});

const shownPage = (pay: FeePay) => Effect.gen(function* () {
  const state = yield* pay.machine.get();
  const shown = yield* pay.shown();
  return { page: state.page, dueWays: state.dueWays, due: shown.record?.due.map((way) => way.symbol) ?? [], withheld: shown.record?.slopWithheld ?? false, paid: shown.record?.paid?.depositId ?? 0, refused: shown.message !== "" };
});

describe('Pay a refundable deposit for a pull request or a private report from any wallet (spec/frontend/feePages.md, "Story: Pay a refundable deposit for a pull request or a private report from any wallet"; spec/frontend/feePages.md, "A pay page offers a way to pay only from a record that equals the published terms"; spec/frontend/feePages.md, "Nothing is offered while the deposit is switched off, and a recorded deposit is still shown")', () => {
  it("a switched-off build offers nothing and still shows a recorded deposit, an unlisted repository, a bad address and an unasked record each say so, and a record off the published terms or rate offers nothing while an unread rate withholds only SLOP", async () => {
    const opened = async (address: PayAddress, held: Partial<Api>, switches?: { submissionFee: boolean; reportDeposit: boolean }) => {
      const runtime = started(api(held).fetch, switches);
      return runtime.runPromise(Effect.flatMap(openPayPage(address, sessionSlots()), shownPage));
    };
    const dueBoth = pullRecord([stableWay(), slopWay(slopAmount)]);
    const result = {
      switchedOff: await opened(pullAddress, { item: dueBoth }, { submissionFee: false, reportDeposit: false }),
      reportSwitchedOff: await opened(reportAddress, { report: reportRecord([slopWay(reportAmount)]) }, { submissionFee: false, reportDeposit: false }),
      recordedWhileOff: await opened(pullAddress, { item: pullRecord([], { paid: paid("base-mainnet", usdc.address, stableMinor, false), outcome: "refund_due" }) }, { submissionFee: false, reportDeposit: false }),
      badAddress: await opened({ ...pullAddress, number: "07" }, {}),
      badCase: await opened({ kind: "report", caseId: "sc_x" }, {}),
      unlisted: await opened({ ...pullAddress, repo: "elsewhere" }, {}),
      noFee: await opened(pullAddress, {}),
      noDeposit: await opened(reportAddress, {}),
      due: await opened(pullAddress, { item: dueBoth }),
      otherContract: await opened(pullAddress, { item: pullRecord([stableWay({ contract: `0x${"1".repeat(40)}` })]) }),
      otherDestination: await opened(pullAddress, { item: pullRecord([stableWay({ keptTo: publishedTerms.burn })]) }),
      otherNetwork: await opened(pullAddress, { item: pullRecord([stableWay({ chainId: 1 })]) }),
      otherCase: await opened(reportAddress, { report: { ...reportRecord([slopWay(reportAmount)]), caseId: "sc_anothercase1" } }),
      reportInStable: await opened(reportAddress, { report: reportRecord([stableWay()]) }),
      offRate: await opened(pullAddress, { item: pullRecord([stableWay(), slopWay((BigInt(slopAmount) + 1n).toString())]) }),
      rateUnread: await opened(pullAddress, { item: dueBoth, rate: "down" }),
    };
    const nothing = { dueWays: 0, due: [] };
    expect(result).toMatchObject({
      switchedOff: { page: "SwitchedOff", ...nothing },
      reportSwitchedOff: { page: "SwitchedOff", dueWays: 0 },
      recordedWhileOff: { page: "Recorded", dueWays: 0, paid: 1 },
      badAddress: { page: "NotAddressed", ...nothing },
      badCase: { page: "NotAddressed", ...nothing },
      unlisted: { page: "NotRegistered", ...nothing },
      noFee: { page: "NothingAsked", ...nothing },
      noDeposit: { page: "NothingAsked", ...nothing },
      due: { page: "Due", dueWays: 2, due: ["USDC", "SLOP"], withheld: false },
      otherContract: { page: "Failed", ...nothing, refused: true },
      otherDestination: { page: "Failed", ...nothing, refused: true },
      otherNetwork: { page: "Failed", ...nothing, refused: true },
      otherCase: { page: "Failed", ...nothing, refused: true },
      reportInStable: { page: "Failed", ...nothing, refused: true },
      offRate: { page: "Failed", ...nothing, refused: true },
      rateUnread: { page: "Due", dueWays: 1, due: ["USDC"], withheld: true },
    });
  });
});

describe('Pay from a wallet and follow the deposit to final (spec/frontend/feePages.md, "The wallet is asked only after a fresh read shows the same amount due, from one saved attempt per item"; spec/frontend/feePages.md, "A deposit is received at canonical inclusion and finished only at finality, and a deposit from the tab blocks another for an hour"; spec/frontend/walletAttempt.md, "A wallet prompt starts only after storage creates an empty slot"; spec/frontend/batchedDeposit.md, "A separate approval proceeds at canonical inclusion and never counts as funding")', () => {
  const separately = (address: PayAddress, held: Partial<Api>, item: string, recorded: (api: Api) => void) => async () => {
    const key = feeDepositKey(item);
    const chain = fakeChain({ atomic: false });
    chain.watch(key);
    const { held: served, fetch } = api(held);
    const runtime = started(fetch);
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce(crypto.randomUUID(), chain.provider);
      const pay = yield* openPayPage(address, sessionSlots());
      yield* pay.connect(yield* walletId);
      yield* pay.review();
      const switched = chain.seen.includes("wallet_switchEthereumChain");
      yield* pay.pay();
      const approval = yield* pay.check("");
      yield* pay.review();
      yield* pay.pay();
      const included = yield* pay.check("");
      const kept = sessionStorage.getItem(key) !== null;
      chain.finalize();
      recorded(served);
      const final = yield* pay.check("");
      const page = yield* shownPage(pay);
      return { switched, approval: [approval.phase, approval.notice], included: [included.evidence, included.phase], kept, final: [final.evidence, final.notice, final.phase], page: page.page, slot: sessionStorage.getItem(key), marker: sessionStorage.getItem(depositedKey(item)) !== null };
    }));
    const [, deposit] = chain.mined;
    expect({
      ...result,
      calls: chain.mined.length,
      depositTo: deposit?.to.toLowerCase(),
      savedBeforePrompt: chain.savedAtPrompt.every((text) => text !== null),
      sends: chain.seen.filter((method) => method === "eth_sendTransaction").length,
    }).toMatchObject({
      switched: true,
      approval: ["Reviewed", "ApprovalConfirmed"],
      included: ["Received", "Sent"],
      kept: true,
      final: ["Finished", "VerifiedNotice", "Idle"],
      page: "Recorded",
      slot: null,
      marker: true,
      calls: 2,
      depositTo: (address.kind === "report" ? robinhood : base).contract.toLowerCase(),
      savedBeforePrompt: true,
      sends: 2,
    });
  };

  it("a wallet on another chain switches, approves the exact amount, deposits exactly the published call into the fee contract and is followed to final for a pull request", separately(pullAddress, { item: pullRecord([stableWay()]) }, pullItem, (served) => {
    served.item = pullRecord([], { paid: paid("base-mainnet", usdc.address, stableMinor, true) });
  }));

  it("the same pay form pays a report's SLOP deposit on Robinhood Chain and follows it to final", separately(reportAddress, { report: reportRecord([slopWay(reportAmount)]) }, reportItem, (served) => {
    served.report = reportRecord([], { paid: paid("robinhood-mainnet", slop.address, reportAmount, true) });
  }));

  it("an unclear wallet answer is kept until the payer says nothing was sent, which clears the saved request, and the wallet can then be disconnected", async () => {
    const chain = fakeChain({ atomic: false, unclear: true });
    const key = feeDepositKey(pullItem);
    chain.watch(key);
    const { fetch } = api({ item: pullRecord([stableWay()]) });
    const runtime = started(fetch);
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce(crypto.randomUUID(), chain.provider);
      const pay = yield* openPayPage(pullAddress, sessionSlots());
      yield* pay.connect(yield* walletId);
      yield* pay.review();
      const sent = yield* Effect.exit(pay.pay());
      const unclear = yield* pay.machine.get();
      const kept = sessionStorage.getItem(key) !== null;
      const cleared = yield* pay.clearUnsent();
      const notice = (yield* pay.shown()).notice;
      const slot = sessionStorage.getItem(key);
      const disconnected = yield* pay.disconnect();
      return { refused: Exit.isFailure(sent), unclear: unclear.phase, kept, cleared: [cleared.phase, cleared.notice], notice, slot, wallet: disconnected.wallet === undefined, connected: (yield* pay.machine.get()).connected };
    }));
    expect({ ...result, sends: chain.seen.filter((method) => method === "eth_sendTransaction").length, calls: chain.mined.length }).toEqual({
      refused: true,
      unclear: "Unclear",
      kept: true,
      cleared: ["Idle", "LocalCleared"],
      notice: "Local request cleared. Review again before sending.",
      slot: null,
      wallet: true,
      connected: false,
      sends: 1,
      calls: 0,
    });
  });

  it("a batching wallet pays SLOP in one request, and a deposit of the tab already on chain stops a second payment", async () => {
    const chain = fakeChain({ atomic: true });
    const key = feeDepositKey(pullItem);
    chain.watch(key);
    const { fetch } = api({ item: pullRecord([stableWay(), slopWay(slopAmount)]) });
    const runtime = started(fetch);
    const result = await runtime.runPromise(Effect.gen(function* () {
      announce(crypto.randomUUID(), chain.provider);
      const pay = yield* openPayPage(pullAddress, sessionSlots());
      yield* pay.connect(yield* walletId);
      yield* pay.choose(`robinhood-mainnet:${slop.address.toLowerCase()}`);
      yield* pay.review();
      const reference = yield* pay.pay();
      chain.finalize();
      const final = yield* pay.check("");
      yield* pay.review();
      const again = yield* Effect.exit(pay.pay());
      return { batched: reference.startsWith("batch-"), final: [final.evidence, final.phase], again: Exit.isFailure(again), within: (yield* pay.machine.get()).dueWays > 0 };
    }));
    expect({ ...result, batches: chain.seen.filter((method) => method === "wallet_sendCalls").length, sends: chain.seen.filter((method) => method === "eth_sendTransaction").length, calls: chain.mined.length }).toMatchObject({
      batched: true,
      final: ["Finished", "Idle"],
      again: true,
      within: true,
      batches: 1,
      sends: 0,
      calls: 2,
    });
  });
});
