import { slopFeeBase, submissionFeeItem } from "@repo/backend/client";
import { sha256Hex, webCrypto } from "@repo/platform/crypto";
import { reportDepositItem } from "@repo/security/client";
import { Effect, Exit, Layer, ManagedRuntime } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { type Hex, decodeFunctionData, encodeAbiParameters, pad, parseAbi, toEventSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginPath } from "../src/platform/environment.ts";
import { FeeSetup, type FeePay, type PayAddress, openPayPage } from "../src/screens/fee/payFlow.vibe";
import { WalletChoice, walletChoiceServices } from "../src/wallets/core/discovery.vibe";
import { sessionSlots } from "../src/wallets/core/slots.ts";
import { depositedKey, feeDepositKey, publishedTerms } from "../src/wallets/fee/feeCalls.ts";
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
const listed: ReadonlyArray<Listed> = [
  { id: "j4-alpha", tier: "community", repositoryId: 1411 },
  { id: "j4-beta", tier: "community", repositoryId: 1412 },
  { id: "j4-zeta", tier: "featured", repositoryId: 1413 },
];

interface Listed {
  readonly id: string;
  readonly tier: "community" | "featured";
  readonly repositoryId: number;
  readonly description?: string;
}

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
  it('every listed project is one card in its own tier section, Featured before Community, each Community card in registry order and a points-only pool reading Points only without a promise label (spec/frontend/poolListing.md, "Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page"; spec/frontend/poolListing.md, "Each home section orders stablecoin pools by shown monthly amount, then token pools, external prizes and points only, and breaks ties by Featured then registry order"; spec/frontend/projections.md, "An owner\'s honor-system promise shows this month\'s amount as promised, never as vault-backed")', async () => {
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

describe('Pick a project from the Featured and Community sections, ten Community rows to a page (spec/frontend/poolListing.md, "Story: Pick a project from the Featured and Community sections")', () => {
  it('Community shows ten rows to a page in registry order, the next page shows the rest, a description longer than 500 characters is cut at 500, and Home has no leaderboard (spec/frontend/poolListing.md, "Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page")', async () => {
    const long = `${"Reproducible builds for every release ".repeat(14)}and more.`;
    const first: Listed = { id: "j4-c01", tier: "community", repositoryId: 1420, description: long };
    const many: ReadonlyArray<Listed> = [first, ...Array.from({ length: 11 }, (_, index): Listed => ({ id: `j4-c${String(index + 2).padStart(2, "0")}`, tier: "community", repositoryId: 1421 + index }))];
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
    expect((await site.open("/")).status).toBe(200);
    await shown(named("button", "Contributor")).toMatchObject({ visible: true });
    await shown(prompt).toMatchObject({ text: "Read https://slop.cash/contribute/SKILL.md and follow it." });

    expect(await copyOutcome()).toBe("Ready");
    await site.click(named("button", "Copy agent prompt"));
    await expect.poll(copyOutcome, { timeout: journeyMs }).not.toBe("Ready");
    const answered = await copyOutcome();
    if (answered === "Copied") await expect.poll(copyOutcome, { timeout: journeyMs }).toBe("Ready");
    else {
      expect(answered).toBe("CopyFailed");
      await site.click(named("button", "Copy agent prompt"));
      await expect.poll(copyOutcome, { timeout: journeyMs }).not.toBe("Ready");
    }

    await site.click(named("button", "Copy agent prompt"));
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
  const fetch: typeof globalThis.fetch = async (input) => {
    const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
    held.reads.push(path);
    if (path === "/api/v1/projects") return Response.json(registry);
    if (path === `/api/v1/submission-fee/items/${repositoryId}/${pullNumber}`) return answer(held.item);
    if (path === `/api/v1/submission-fee/reports/${caseId}`) return answer(held.report);
    if (path === "/api/v1/submission-fee/rate") return answer(held.rate);
    return new Response(null, { status: 404 });
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

function fakeChain(options: { atomic: boolean }) {
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
