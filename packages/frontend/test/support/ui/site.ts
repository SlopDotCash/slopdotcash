// spec/frontend/navigation.md, "Story: Resume an authorized destination after signing in"; spec/backend/accounts.md, "A web sign-in consumes one web assertion and opens a public membership"; spec/backend/identity.md, "At most one poll receives the flow's identity"; spec/points/projectionTransport.md, "Story: Read the published projection without mistaking a reset for a refusal"
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Role, templatePaths } from "@repo/contributor/render/fields";
import { acceptedRevisions, guideRendererPaths, rendererSourcePaths, sha256Hex as templateSha, sourceRepository, templateFilePath, templateGroup, templateSha256 } from "@repo/contributor/render/templateIndex";
import { type Handler, type WorkerOptions, bundle, migrate, startWorker, storage, workerOptions } from "@repo/platform/testing";
import { type Anvil, anvil, forward } from "@repo/platform/testing/chains";
import { githubFake } from "@repo/platform/testing/github";
import { internet } from "@repo/platform/testing/internet";
import { migrationsDir, repoRoot } from "@repo/platform/testing/paths";
import { IMPLEMENTATION_SLOT, bytes32, evmAddress } from "@repo/settlement/chain/evm/abi";
import { decodeEscrowLogs } from "@repo/settlement/chain/evm/events";
import { bindCalldata } from "@repo/settlement/chain/evm/typedData";
import type {} from "@vitest/browser-playwright";
import { Request, Response } from "miniflare";
import type { Browser, BrowserContext, Download, Locator, Page, Route } from "playwright";
import { encodeFunctionData, isHex, parseAbi } from "viem";
import { createBuilder } from "vite";
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";
import { feeNetworks } from "@repo/backend/client";
import { FEE_RECIPIENT, type EscrowStack, escrowStack, word } from "@repo/settlement/testing/evm";
import type { Answered, Box, Bucket, Deployed, Diagnostics, Downloaded, Layout, LeaderboardTransport, Method, Op, Published, Result, Roles, Row, Sent, Shown, Target, VaultPurpose, Verification } from "./protocol.ts";
import { enlargeText } from "./textSize.ts";
import { type Wallets, homeChainId, injectWallets } from "./wallets.ts";

const site = "https://slop.cash";
const identityOrigin = "https://identity.slop.cash";
const appRoot = join(repoRoot, "apps/app");
const backendRoot = join(repoRoot, "apps/backend");
const slopbotRoot = join(repoRoot, "apps/slopbot");
const defaultRoles: Roles = { ADMIN_GITHUB_IDS: "9001,18633264", PROJECT_MODERATOR_GITHUB_IDS: "9001,18633264", OPERATOR_GITHUB_IDS: "9001" };
const reader = { id: 4_000_001, login: "slop-reader" };
const vaultNetwork = "base-mainnet";
const depositorFunds = 1_000_000_000n;
const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const backendRpcHost = "rpc.base-mainnet.test";
const zeroWordCode = "0x600060005260206000f3";
const fundedWordCode = `0x6f${"ff".repeat(16)}60005260206000f3`;
const placeholder = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#777"/></svg>';

interface Deployment {
  readonly roles: Roles;
  readonly rpc: boolean;
}

const defaultDeployment: Deployment = { roles: defaultRoles, rpc: false };

interface Started {
  readonly site: (request: Request) => Promise<Response>;
  readonly identity: (request: Request) => Promise<Response>;
  readonly github: ReturnType<typeof githubFake>;
  readonly rows: (text: string, params: ReadonlyArray<string | number | null>) => Promise<ReadonlyArray<Row>>;
  readonly verifications: Verification[];
  readonly deployed: () => Deployment;
  readonly deploy: (deployment: Deployment) => Promise<void>;
  readonly scanner: (method: Method, path: string, body: string) => Promise<Answered>;
  readonly replace: (bucket: Bucket, key: string, text: string) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

interface Built {
  readonly assets: string;
  readonly script: string;
  readonly identityScript: string;
  readonly slopbotScript: string;
}

interface Held {
  readonly released: Promise<void>;
  readonly release: () => void;
}

type Canned =
  | { readonly kind: "json"; readonly status: number; readonly body: unknown }
  | { readonly kind: "bytes"; readonly status: number; readonly bytes: Uint8Array; readonly contentType: string };

interface D1Handle {
  prepare(text: string): {
    bind(...params: ReadonlyArray<string | number | null>): {
      all<T>(): Promise<{ readonly results: ReadonlyArray<T> }>;
    };
  };
}

interface PublishedFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

interface PublishedFixture {
  readonly registry: Published["registry"];
  readonly files: ReadonlyArray<PublishedFile>;
  readonly transport: {
    readonly root: Uint8Array;
    readonly parts: ReadonlyArray<PublishedFile>;
  };
  readonly leaderboard: {
    readonly snapshot: {
      readonly leaders: ReadonlyArray<{ readonly actor: Published["leaders"][number] }>;
    };
  };
}

interface PointsTesting {
  readonly publishedFixture: () => Promise<PublishedFixture>;
}

interface Session {
  readonly context: BrowserContext;
  readonly tabs: Map<string, Page>;
  readonly holds: Map<string, Held>;
  readonly canned: Map<string, Canned>;
  readonly chains: Map<number, Promise<Anvil>>;
  readonly sent: Sent[];
  readonly console: string[];
  readonly failed: string[];
  allowed: ReadonlyArray<RegExp>;
  current: string;
  consenting: string;
  cookiesBlocked: boolean;
  restore: (() => Promise<void>) | undefined;
  wallets: Wallets | undefined;
  clocked: boolean;
  closed: boolean;
  downloaded: Promise<Downloaded> | undefined;
}

interface Instance {
  readonly started: Started;
  readonly session: Session;
}

interface Slot {
  instance: Instance | undefined;
  tail: Promise<void>;
  pending: number;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const sameDeployment = (left: Deployment, right: Deployment) =>
  left.rpc === right.rpc && left.roles.ADMIN_GITHUB_IDS === right.roles.ADMIN_GITHUB_IDS && left.roles.PROJECT_MODERATOR_GITHUB_IDS === right.roles.PROJECT_MODERATOR_GITHUB_IDS && left.roles.OPERATOR_GITHUB_IDS === right.roles.OPERATOR_GITHUB_IDS;

function scannerKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x ?? "", "base64url");
  return { privateKey, configured: raw.toString("base64"), id: sha256(raw) };
}

async function answered(response: Response): Promise<Answered> {
  const text = await response.text();
  const body: unknown = text === "" ? null : (response.headers.get("content-type") ?? "").startsWith("application/json") ? JSON.parse(text) : text;
  return { status: response.status, body };
}

function notifyOf(verifications: Verification[]): Handler {
  return async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/v1/email/capabilities") return json(200, { enrollmentAvailable: true });
    if (path === "/v1/activity-notifications/eligibility") return json(200, { available: false });
    if (path === "/v1/email/verification") {
      const body = (await request.json()) as Readonly<Record<string, unknown>>;
      verifications.push({ githubId: String(body.githubId), id: String(body.id), token: String(body.token) });
      return new Response(null, { status: 204 });
    }
    return json(404, { error: "not_found" });
  };
}

function listFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full));
    else if (entry.isFile()) found.push(full);
  }
  return found.sort();
}

function writeSkillTemplates(outDir: string) {
  const roles: ReadonlyArray<Role> = ["contributor", "reviewer"];
  const groups = roles.map((role) => {
    const root = join(repoRoot, templatePaths[role]);
    const files = listFiles(root).map((file) => ({ path: file.slice(root.length + 1).split("\\").join("/"), bytes: new Uint8Array(readFileSync(file)) }));
    const grouped = templateGroup(role, files);
    if (grouped.kind !== "group") throw new Error(`${templatePaths[role]} is not a bounded template tree`);
    return { group: grouped.group, files };
  });
  const [contributor, reviewer] = groups;
  if (contributor === undefined || reviewer === undefined) throw new Error("both template groups are required");
  const sources = rendererSourcePaths.map((path) => ({ path, sha256: templateSha(new Uint8Array(readFileSync(join(repoRoot, path)))) }));
  const indexText = `${JSON.stringify({
    schemaVersion: "1",
    repository: sourceRepository,
    commit: "0".repeat(40),
    templateSha256: templateSha256({ contributor: contributor.group, reviewer: reviewer.group, rendererSources: sources, acceptedRevisions }),
    revisionStatus: "committed",
    contributor: contributor.group,
    reviewer: reviewer.group,
    renderer: { paths: [...guideRendererPaths], sources, revisionStatus: "committed" },
    acceptedRevisions: [...acceptedRevisions],
  }, null, 2)}\n`;
  const files = [{ path: "skill-templates/index.json", bytes: new TextEncoder().encode(indexText) }];
  for (const { group, files: tree } of groups) {
    for (const file of tree) files.push({ path: `skill-templates/${templateFilePath(group, { path: file.path, sha256: templateSha(file.bytes) })}`, bytes: file.bytes });
  }
  for (const file of files) {
    const target = join(outDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.bytes);
  }
}

async function builtSite(): Promise<string> {
  const outDir = join(appRoot, ".cache/site");
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const builder = await createBuilder({
      root: appRoot,
      configFile: join(appRoot, "vite.config.ts"),
      logLevel: "error",
      mode: "production",
      define: { "process.env.NODE_ENV": '"production"' },
      build: { outDir, emptyOutDir: true, sourcemap: false },
    });
    const client = builder.environments.client;
    if (client === undefined) throw new Error("apps/app builds no client");
    await builder.build(client);
    writeSkillTemplates(outDir);
    return outDir;
  } finally {
    if (prior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prior;
  }
}

async function build(): Promise<Built> {
  return {
    assets: await builtSite(),
    script: await bundle(appRoot, { entry: "_worker" }),
    identityScript: await bundle(backendRoot, { entry: "identity" }),
    slopbotScript: await bundle(slopbotRoot, { entry: "repositoryAccess" }),
  };
}

let built: Promise<Built> | undefined;

export const prepare = () => (built ??= build());

async function open({ assets, script, identityScript, slopbotScript }: Built, chains: ReadonlyMap<number, Promise<Anvil>>): Promise<Started> {
  const github = githubFake();
  github.world.addUser(reader);
  const net = internet({ github: github.handler, hosts: { [backendRpcHost]: chainRpc(chains) } });
  const verifications: Verification[] = [];
  const signer = scannerKey();
  const readToken = github.tokens.user(reader.login);
  const options = ({ roles, rpc }: Deployment): WorkerOptions => ({
    script,
    assets,
    d1: { SLOP_DB: "slop-private" },
    r2: ["PRIVATE_TRACES", "VETTING_EVIDENCE"],
    vars: {
      ...roles,
      SLOP_ENVIRONMENT: "production",
      PUBLIC_SITE_URL: site,
      PAYMENT_NETWORKS: rpc ? JSON.stringify([vaultNetwork]) : "[]",
      MONTHLY_PAYMENT_SCHEDULE: '{"firstPeriod":"2026-11","cutoffSecondsAfterPeriodEnd":259200}',
      SLOP_PRIVATE_INTAKE_MODE: "on",
      SECURITY_REPORT_DEPOSIT: "live",
      TRACE_AUTH_SECRET: "trace-auth-secret-for-the-browser-journeys-0001",
      SLOP_GITHUB_READ_TOKEN: readToken,
      VETTING_RESULT_PUBLIC_KEYS: signer.configured,
      ...(rpc ? { PAYMENT_RPC_URLS: JSON.stringify({ [vaultNetwork]: `https://${backendRpcHost}/` }) } : {}),
    },
    services: { SLOP_NOTIFY: notifyOf(verifications) },
    outbound: net.handler,
    workers: {
      SLOPBOT: {
        name: "slopbot",
        script: slopbotScript,
        d1: { SLOPBOT_DB: "slop-private" },
        vars: { SLOPBOT_APP_ID: github.app.id, SLOPBOT_APP_PRIVATE_KEY: github.app.privateKeyPem },
      },
      SLOP_IDENTITY: {
        name: "identity",
        script: identityScript,
        routes: [`${new URL(identityOrigin).host}/*`],
        d1: { IDENTITY_DB: "slop-private" },
        ratelimits: { IDENTITY_START_LIMITER: { limit: 600, period: 60 }, IDENTITY_POLL_LIMITER: { limit: 6000, period: 60 } },
        vars: {
          SLOP_ENVIRONMENT: "production",
          GITHUB_APP_CLIENT_ID: github.app.clientId,
          GITHUB_APP_CLIENT_SECRET: github.app.clientSecret,
          IDENTITY_STATE_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
          IDENTITY_ASSERTION_KEY: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
        },
      },
    },
  });
  let deployed = defaultDeployment;
  const mf = startWorker(options(deployed));
  await mf.ready;
  const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((file) => file.error !== undefined);
  if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
  return {
    site: (request) => mf.dispatchFetch(request),
    identity: (request) => mf.dispatchFetch(request),
    github,
    rows: async (text, params) => {
      const db = (await mf.getD1Database("SLOP_DB", "worker")) as unknown as D1Handle;
      return (await db.prepare(text).bind(...params).all<Row>()).results;
    },
    verifications,
    deployed: () => deployed,
    deploy: async (deployment) => {
      if (sameDeployment(deployment, deployed)) return;
      deployed = deployment;
      await mf.setOptions(workerOptions(options(deployment), []));
    },
    scanner: async (method, path, body) => {
      const bytes = new TextEncoder().encode(body);
      const timestamp = new Date().toISOString();
      const signature = sign(null, Buffer.from(["slop-vetting:v1", method, path, timestamp, sha256(bytes)].join("\n")), signer.privateKey).toString("base64");
      const headers = { "x-slop-vetting-key": signer.id, "x-slop-vetting-timestamp": timestamp, "x-slop-vetting-signature": signature, "content-type": method === "PUT" ? "application/octet-stream" : "application/json" };
      return answered(await mf.dispatchFetch(`${site}${path}`, { method, headers, redirect: "manual", ...(method === "GET" ? {} : { body: bytes }) }));
    },
    replace: async (bucket, key, text) => {
      const objects = await storage(mf, bucket);
      const found = await objects.head(key);
      if (found === null) throw new Error(`site: no ${bucket} object ${key}`);
      await objects.put(key, new TextEncoder().encode(text), { ...(found.httpMetadata === undefined ? {} : { httpMetadata: found.httpMetadata }), ...(found.customMetadata === undefined ? {} : { customMetadata: found.customMetadata }) });
    },
    dispose: () => mf.dispose(),
  };
}

const slots = new Map<string, Slot>();

function chainRpc(chains: ReadonlyMap<number, Promise<Anvil>>): Handler {
  return async (request) => {
    const chain = chains.get(homeChainId);
    if (chain === undefined) return new Response("no session chain", { status: 503 });
    return forward((await chain).url)(request);
  };
}

function slotOf(context: BrowserCommandContext): Slot {
  const id = context.sessionId;
  const existing = slots.get(id);
  if (existing !== undefined) return existing;
  const created: Slot = { instance: undefined, tail: Promise.resolve(), pending: 0 };
  slots.set(id, created);
  return created;
}

function serialize<T>(slot: Slot, work: () => Promise<T>): Promise<T> {
  slot.pending += 1;
  const next = slot.tail.then(work, work);
  slot.tail = next.then(() => undefined, () => undefined);
  return next.finally(() => {
    slot.pending -= 1;
  });
}

function runningOf(context: BrowserCommandContext): Instance {
  const running = slots.get(context.sessionId)?.instance;
  if (running === undefined) throw new Error("site: start the site first");
  return running;
}

function pageOf(into: Session): Page {
  const opened = into.tabs.get(into.current);
  if (opened === undefined) throw new Error(`site: no tab ${into.current}`);
  return opened;
}

function holdKey(method: string, path: string) {
  return `${method.toUpperCase()} ${path}`;
}

async function answer(route: Route, into: Session, worker: (request: Request) => Promise<Response>, transform: (url: URL) => URL = (url) => url) {
  const asked = route.request();
  const url = transform(new URL(asked.url()));
  const rawHeaders = await asked.allHeaders().catch(() => undefined);
  if (rawHeaders === undefined || into.closed) return route.abort("aborted").catch(() => undefined);
  const headers = Object.fromEntries(Object.entries(rawHeaders).filter(([name]) => !name.startsWith(":")));
  const body = asked.postDataBuffer();
  if (url.origin === site) into.sent.push({ method: asked.method(), path: url.pathname, actor: headers["x-slop-expected-github-id"] ?? null });
  const answered = await worker(new Request(url.toString(), { method: asked.method(), headers, redirect: "manual", ...(body === null ? {} : { body: new Uint8Array(body) }) }))
    .then(async (response) => ({ response, bytes: Buffer.from(await response.arrayBuffer()) }))
    .catch(() => undefined);
  if (answered === undefined || into.closed) return route.abort(into.closed ? "aborted" : "failed").catch(() => undefined);
  const { response, bytes } = answered;
  const held = url.origin === site ? into.holds.get(holdKey(asked.method(), url.pathname)) : undefined;
  if (held !== undefined) await held.released;
  if (into.closed) return route.abort("aborted").catch(() => undefined);
  const shown: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") shown[name] = value;
  });
  const cookies = url.origin === identityOrigin && into.cookiesBlocked ? [] : response.headers.getSetCookie();
  if (cookies.length > 0) shown["set-cookie"] = cookies.join("\n");
  const location = response.headers.get("location");
  if (asked.isNavigationRequest() && location !== null && response.status >= 300 && response.status < 400) {
    const replaced = `<!doctype html><script>location.replace(${JSON.stringify(new URL(location, url).href)})</script>`;
    const kept: Record<string, string> = cookies.length > 0 ? { "set-cookie": cookies.join("\n") } : {};
    return route.fulfill({ status: 200, headers: { ...kept, "content-type": "text/html; charset=utf-8" }, body: replaced }).catch(() => undefined);
  }
  await route.fulfill({ status: response.status, headers: shown, body: bytes }).catch(() => undefined);
}

function cannedFor({ canned }: Session, method: string, path: string): Canned | undefined {
  return canned.get(holdKey(method, path)) ?? canned.get(holdKey("*", path));
}

async function routed(route: Route, into: Session, backendNow: Started) {
  if (into.closed) return route.abort("aborted").catch(() => undefined);
  const url = new URL(route.request().url());
  const canned = url.origin === site ? cannedFor(into, route.request().method(), url.pathname) : undefined;
  if (canned !== undefined) {
    const rawHeaders = await route.request().allHeaders().catch(() => undefined);
    if (rawHeaders === undefined || into.closed) return route.abort("aborted").catch(() => undefined);
    into.sent.push({ method: route.request().method(), path: url.pathname, actor: rawHeaders["x-slop-expected-github-id"] ?? null });
    const fulfilled = canned.kind === "json" ? { contentType: "application/json", body: JSON.stringify(canned.body) } : { contentType: canned.contentType, body: Buffer.from(canned.bytes) };
    return route.fulfill({ status: canned.status, ...fulfilled }).catch(() => undefined);
  }
  if (url.origin === site) return answer(route, into, backendNow.site);
  if (url.origin === identityOrigin) return answer(route, into, backendNow.identity);
  if (url.origin === "https://github.com" && url.pathname === "/login/oauth/authorize")
    return answer(route, into, async (request) => backendNow.github.handler(request), (next) => {
      next.searchParams.set("login", into.consenting);
      return next;
    });
  if (url.hostname === "avatars.githubusercontent.com") return route.fulfill({ status: 200, contentType: "image/svg+xml", body: placeholder }).catch(() => undefined);
  if (url.hostname === "static.cloudflareinsights.com") return route.fulfill({ status: 200, contentType: "text/javascript", body: "" }).catch(() => undefined);
  into.failed.push(`unexpected ${route.request().method()} ${url.origin}${url.pathname}`);
  return route.abort("blockedbyclient").catch(() => undefined);
}

async function downloadedOf(download: Download): Promise<Downloaded> {
  return { name: download.suggestedFilename(), sha256: sha256(await readFile(await download.path())) };
}

function watch(opened: BrowserContext, into: Session) {
  opened.on("page", (added) => {
    added.on("download", (download) => {
      into.downloaded = downloadedOf(download);
    });
  });
  opened.on("console", (message) => {
    if (!into.closed && message.type() === "error") into.console.push(`console ${message.text()}`);
  });
  opened.on("weberror", (error) => {
    if (!into.closed) into.console.push(`pageerror ${error.error().message}`);
  });
  opened.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? "";
    if (!into.closed && request.url().startsWith(site) && !(request.method() === "GET" && error === "net::ERR_ABORTED")) into.failed.push(`failed ${request.method()} ${new URL(request.url()).pathname} ${error}`);
  });
  opened.on("response", (response) => {
    if (!into.closed && response.url().startsWith(site) && response.status() >= 400) into.failed.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
  });
}

async function disposeInstance(previous: Instance): Promise<void> {
  previous.session.closed = true;
  for (const held of previous.session.holds.values()) held.release();
  await previous.session.context.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
  await previous.session.context.close().catch(() => undefined);
  await Promise.allSettled([...previous.session.chains.values()].map((chain) => chain.then((started) => started.close(), () => undefined)));
  await previous.started.dispose().catch(() => undefined);
}

async function disposeSlot(slot: Slot): Promise<void> {
  const previous = slot.instance;
  slot.instance = undefined;
  if (previous !== undefined) await disposeInstance(previous);
}

export async function close() {
  const active = [...slots.values()];
  slots.clear();
  await Promise.allSettled(active.map((slot) => serialize(slot, () => disposeSlot(slot))));
}

async function reset(context: BrowserCommandContext, slot: Slot) {
  await disposeSlot(slot);
  const chains = new Map<number, Promise<Anvil>>();
  const backendNow = await open(await prepare(), chains);
  let opened: BrowserContext | undefined;
  let made: Session | undefined;
  try {
    const browser: Browser | null = context.context.browser();
    if (browser === null) throw new Error("site: the Vitest browser has no Playwright browser");
    opened = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    made = { context: opened, tabs: new Map(), holds: new Map(), canned: new Map(), chains, sent: [], console: [], failed: [], allowed: [], current: "main", consenting: "", cookiesBlocked: false, restore: undefined, wallets: undefined, clocked: false, closed: false, downloaded: undefined };
    const created = made;
    watch(opened, created);
    await opened.route("**/*", (route) => routed(route, created, backendNow));
    slot.instance = { started: backendNow, session: created };
  } catch (error) {
    if (made !== undefined) made.closed = true;
    await opened?.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
    await opened?.close().catch(() => undefined);
    await Promise.allSettled([...chains.values()].map((chain) => chain.then((started) => started.close(), () => undefined)));
    await backendNow.dispose().catch(() => undefined);
    throw error;
  }
}

async function tab(into: Session, name: string): Promise<Page> {
  const switching = into.current !== name;
  const known = into.tabs.get(name);
  into.current = name;
  if (known !== undefined) {
    if (switching) await known.bringToFront();
    return known;
  }
  const opened = await into.context.newPage();
  into.tabs.set(name, opened);
  return opened;
}

function locate(scope: Page | Locator, target: Target): Locator {
  const within = target.within === undefined ? scope : locate(scope, target.within);
  const exact = target.exact ?? true;
  if (target.role !== undefined)
    return within.getByRole(target.role, { exact, ...(target.name === undefined ? {} : { name: target.name }), ...(target.level === undefined ? {} : { level: target.level }) });
  if (target.label !== undefined) return within.getByLabel(target.label, { exact });
  if (target.text !== undefined) return within.getByText(target.text, { exact: target.exact ?? false });
  return within.locator("body");
}

async function feeChain(chainId: number): Promise<Anvil> {
  const chain = await anvil({ chainId });
  for (const terms of feeNetworks.filter((network) => network.chainId === chainId)) {
    await chain.rpc("anvil_setCode", [terms.contract, zeroWordCode]);
    for (const token of terms.tokens) await chain.rpc("anvil_setCode", [token.address, fundedWordCode]);
  }
  return chain;
}

function walletChain(into: Session, chainId: number): Promise<Anvil> {
  const known = into.chains.get(chainId);
  if (known !== undefined) return known;
  const made = feeChain(chainId);
  into.chains.set(chainId, made);
  return made;
}

type Fields = Readonly<Record<string, unknown>>;

const fieldsOf = (value: unknown): Fields | undefined => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : undefined);

function registered(manifest: Fields, deployment: Fields, purpose: VaultPurpose, now: string): Fields {
  if (purpose === "ordinary") return {
    ...manifest,
    escrow: { schemaVersion: "1", effectiveCycle: now.slice(0, 7), feeBasisPoints: 200, withdrawalFeeBasisPoints: 200, feeMode: "deduct-from-gross", ...fieldsOf(manifest.escrow), chain: "base", deployments: [deployment] },
  };
  const program = fieldsOf(manifest.securityBounty);
  const amount = fieldsOf(program?.amount);
  if (amount?.network !== vaultNetwork || amount.currency !== "USDC") throw new Error(`site: the project has no USDC bounty on ${vaultNetwork}`);
  const settlement = fieldsOf(program?.settlement) ?? {};
  return {
    ...manifest,
    securityBounty: { ...program, settlement: { schemaVersion: "1", effectiveCycle: now.slice(0, 7), chain: "base", feeBasisPoints: 2500, withdrawalFeeBasisPoints: 200, feeMode: "deduct-from-gross", ...settlement, deployments: [deployment] } },
  };
}

async function reviewedVault(stack: EscrowStack, vault: string, owner: string, block: bigint) {
  const factorySlot = String(await stack.chain.rpc("eth_getStorageAt", [stack.factory, IMPLEMENTATION_SLOT, "latest"]));
  const factoryImplementation = `0x${factorySlot.slice(-40)}`;
  const creation = decodeEscrowLogs(stack.factory, await stack.logs(stack.factory, 0n, block))
    .find((log) => log.kind === "event" && log.event.name === "VaultCreated" && log.event.vault === vault);
  if (creation === undefined) throw new Error("site: recorded vault has no creation event");
  const codeDigest = async (address: string) => sha256(Buffer.from(String(await stack.chain.rpc("eth_getCode", [address, "latest"])).slice(2), "hex"));
  return {
    network: vaultNetwork, vault, asset: stack.dollar, owner, programId: null, upgradeAuthority: null, projectPda: null, networkDomain: null,
    identityAuthority: stack.roles.authority.address.toLowerCase(), feeRecipient: FEE_RECIPIENT, deploymentTransaction: creation.at.transaction,
    sourceCommit: "a".repeat(40), codeSha256: await codeDigest(vault), bindingDelaySeconds: "0", rotationDelaySeconds: null,
    factory: stack.factory, factoryCodeSha256: await codeDigest(stack.factory), registrar: stack.roles.registrar.address.toLowerCase(),
    evmUpgrade: {
      authority: stack.roles.upgrader.address.toLowerCase(),
      vaultImplementation: stack.implementation,
      vaultImplementationCodeSha256: await codeDigest(stack.implementation),
      factoryImplementation,
      factoryImplementationCodeSha256: await codeDigest(factoryImplementation),
    },
  };
}

async function vault(running: Instance, projectId: string, purpose: VaultPurpose): Promise<Deployed> {
  const { started, session } = running;
  const chain = await walletChain(session, homeChainId);
  const [depositor, owner] = [chain.accounts[0], chain.accounts[6]];
  const ownerAddress = owner === undefined ? undefined : evmAddress(owner.address);
  if (depositor === undefined || ownerAddress === undefined) throw new Error("site: the wallet anvil has no accounts 0 and 6");
  const stack = await escrowStack(chain);
  try {
    const projectWord = word(BigInt(`0x${sha256(`slop-project:${projectId}`)}`));
    const created = await stack.createVault(
      purpose === "security-bounty"
        ? { owner: ownerAddress, projectId: projectWord, asset: stack.dollar, purpose: "BountyPurpose" }
        : { owner: ownerAddress, projectId: projectWord, asset: stack.dollar, purpose: "OrdinaryPurpose", monthlyCap: 0n, monthlyEnabled: false },
    );
    await stack.send(depositor.address, stack.dollar, encodeFunctionData({ abi: mintAbi, functionName: "mint", args: [depositor.address, depositorFunds] }));
    const block = await stack.head();
    chain.setFinalized(block);
    const codeDigest = async (at: string) => sha256(Buffer.from(String(await chain.rpc("eth_getCode", [at, "latest"])).slice(2), "hex"));
    const [codeSha256, vaultImplementationCodeSha256] = await Promise.all([codeDigest(created), codeDigest(stack.implementation)]);
    const [record] = await started.rows("SELECT revision, manifest FROM projects WHERE id = ?", [projectId]);
    const [author] = await started.rows("SELECT actor_github_id, actor_github_login FROM project_revisions WHERE project_id = ? ORDER BY revision LIMIT 1", [projectId]);
    if (record === undefined || author === undefined) throw new Error(`site: no project ${projectId}`);
    const recorded = fieldsOf(JSON.parse(String(record.manifest))) ?? {};
    const deployment = purpose === "ordinary"
      ? await reviewedVault(stack, created, ownerAddress, block)
      : {
          network: vaultNetwork,
          vault: created,
          asset: stack.dollar,
          owner: ownerAddress,
          factory: stack.factory,
          feeRecipient: FEE_RECIPIENT,
          bindingDelaySeconds: "0",
          codeSha256,
          evmUpgrade: { vaultImplementation: stack.implementation, vaultImplementationCodeSha256 },
        };
    const now = new Date().toISOString();
    const active = { ...recorded, status: "active" };
    const revisions = [
      ...(recorded.status === "active" ? [] : [{ kind: "Activated", reason: `Activated automatically after setup checks for @${String(author.actor_github_login)}.`, manifest: active }]),
      { kind: "VaultRegistered", reason: "Owner registered a finalized vault verified against the reviewed factory and project policy.", manifest: registered(active, deployment, purpose, now) },
    ];
    for (const [index, appended] of revisions.entries()) {
      const revision = Number(record.revision) + index + 1;
      const manifest = JSON.stringify(appended.manifest);
      const digest = sha256(manifest);
      await started.rows("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES(?,?,?,?,?,?,?,?)", [projectId, revision, manifest, digest, appended.reason, String(author.actor_github_id), String(author.actor_github_login), now]);
      await started.rows("INSERT INTO project_revision_kinds(project_id,revision,kind) VALUES(?,?,?)", [projectId, revision, appended.kind]);
      await started.rows("UPDATE projects SET status = 'active', revision = ?, manifest = ?, manifest_sha256 = ?, updated_at = ? WHERE id = ?", [revision, manifest, digest, now, projectId]);
    }
    await started.rows(
      `INSERT INTO ${purpose === "security-bounty" ? "security_vault_snapshots" : "vault_snapshots"}(project_id,network,chain,vault,asset_address,asset_decimals,total_deposited,total_paid,total_payout_fees,total_gross_withdrawn,total_withdrawal_fees,total_service_fees,free_balance,reserved_principal,reserved_fees,accrued_fees,reserved,block_number,block_time,observed_at) VALUES(?,?,'base',?,?,6,'0','0','0','0','0','0','0','0','0','0','0',?,?,?)`,
      [projectId, vaultNetwork, created, stack.dollar, block.toString(), now, now],
    );
    return { vault: created, asset: stack.dollar };
  } finally {
    await stack.close();
  }
}

async function bindPayout(running: Instance, githubId: string, vault: string) {
  const [row] = await running.started.rows("SELECT b.signature, b.expires_at, b.expected_version, w.wallet_address, w.record_sha256 FROM payment_binding_authorizations b JOIN wallet_claims w ON w.id = b.claim_id WHERE b.github_user_id = ? AND b.vault = ?", [githubId, vault]);
  const chain = await walletChain(running.session, homeChainId);
  const authority = chain.accounts[1];
  const to = evmAddress(vault);
  const destination = evmAddress(String(row?.wallet_address));
  const claimDigest = bytes32(`0x${String(row?.record_sha256)}`);
  const walletSignature = String(row?.signature);
  if (row === undefined || authority === undefined || to === undefined || destination === undefined || claimDigest === undefined || !isHex(walletSignature))
    throw new Error("site: no stored binding consent to relay");
  const data = bindCalldata({ actor: BigInt(githubId), destination, expectedVersion: BigInt(String(row.expected_version)), claimDigest, expiresAt: BigInt(String(row.expires_at)), walletSignature });
  const receipt = await chain.transact({ from: authority.address, to, data });
  if (receipt.status !== "success") throw new Error("site: local binding reverted");
}

async function published(context: BrowserCommandContext, into: Session, leaderboard: LeaderboardTransport): Promise<Published> {
  const { publishedFixture } = await context.project.import<PointsTesting>("@repo/points/testing");
  const fixture = await publishedFixture();
  const transport = [{ path: "/data/leaderboard.json", bytes: fixture.transport.root }, ...fixture.transport.parts];
  const files = leaderboard === "whole" ? fixture.files : [...fixture.files.filter((file) => file.path !== "/data/leaderboard.json" && !file.path.startsWith("/data/leaderboard/")), ...transport];
  for (const file of files) into.canned.set(holdKey("*", file.path), { kind: "bytes", status: 200, bytes: file.bytes, contentType: file.path.endsWith(".part") ? "text/plain; charset=utf-8" : "application/json" });
  return {
    registry: fixture.registry,
    leaders: fixture.leaderboard.snapshot.leaders.map(({ actor }) => ({ id: actor.id, login: actor.login, avatarUrl: actor.avatarUrl })),
    parts: fixture.transport.parts.map((part) => part.path),
  };
}

const absent: Shown = { count: 0, visible: false, text: "", value: null, disabled: false, checked: null, focused: false, href: null };

async function read(into: Session, target: Target): Promise<Shown> {
  const found = locate(pageOf(into), target);
  const count = await found.count();
  if (count === 0) return absent;
  const first = found.first();
  const visible = await first.isVisible();
  const facts = await first
    .evaluate(
      (element) => {
        const active = document.activeElement;
        const aria = element.getAttribute("aria-checked");
        const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : null;
        const checked = aria === "true" ? true : aria === "false" ? false : element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio") ? element.checked : null;
        return {
          text: element instanceof HTMLElement ? element.innerText.trim() : (element.textContent ?? "").trim(),
          value,
          disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
          checked,
          focused: active !== null && (element === active || element.contains(active)),
          href: element.getAttribute("href"),
        };
      },
      undefined,
      { timeout: 1_000 },
    )
    .catch(() => null);
  if (facts === null) return (await found.count()) === 0 ? absent : { ...absent, count, visible };
  return { count, visible, ...facts };
}

function layout(into: Session): Promise<Layout> {
  return pageOf(into).evaluate(() => {
    const shown = (element: Element) => element instanceof HTMLElement && element.offsetParent !== null && getComputedStyle(element).visibility !== "hidden" && element.getAttribute("aria-hidden") !== "true";
    const named = (element: Element) => {
      const labelled = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/u).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join("");
      const labels = "labels" in element && element.labels instanceof NodeList ? [...element.labels].map((label) => label.textContent ?? "").join("") : "";
      const images = [...element.querySelectorAll("img[alt], [role=img][aria-label]")].map((image) => image.getAttribute("alt") ?? image.getAttribute("aria-label") ?? "").join("");
      return [element.getAttribute("aria-label"), labelled, labels, element.getAttribute("title"), element.textContent, images].some((text) => (text ?? "").trim() !== "");
    };
    const controls = [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=switch], [role=checkbox], [role=link], [role=menuitem]")].filter(shown);
    const fixed = [...document.querySelectorAll("button, h1, h2, h3, label, [role=status], [role=alert]")].filter(shown).filter((element) => {
      const style = getComputedStyle(element);
      return element.scrollWidth > element.clientWidth + 1 && style.overflowX !== "visible" && style.textOverflow !== "ellipsis";
    });
    return {
      mains: document.querySelectorAll("main").length,
      headings: document.querySelectorAll("h1").length,
      unnamed: controls.filter((element) => !named(element)).map((element) => element.outerHTML.slice(0, 160)),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      clipped: fixed.map((element) => (element.textContent ?? "").trim().slice(0, 80)),
    };
  });
}

function leaks(into: Session, text: string): Promise<boolean> {
  return pageOf(into).evaluate((needle) => {
    if (document.body.innerText.includes(needle)) return true;
    for (const element of document.querySelectorAll("*")) {
      if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.value.includes(needle)) return true;
      for (const name of ["title", "aria-label", "aria-description", "alt", "placeholder", "value", "data-tooltip"]) if ((element.getAttribute(name) ?? "").includes(needle)) return true;
    }
    return false;
  }, text);
}

function diagnostics(into: Session): Diagnostics {
  const allowed = (line: string) => into.allowed.some((pattern) => pattern.test(line));
  return { console: into.console.filter((line) => !allowed(line)), failed: into.failed.filter((line) => !allowed(line)) };
}

async function run(context: BrowserCommandContext, op: Op): Promise<unknown> {
  if (op.kind === "start") {
    const slot = slotOf(context);
    await serialize(slot, () => reset(context, slot));
    return null;
  }
  if (op.kind === "stop") {
    const id = context.sessionId;
    const slot = slots.get(id);
    if (slot !== undefined) {
      await serialize(slot, () => disposeSlot(slot));
      if (slot.pending === 0 && slot.instance === undefined && slots.get(id) === slot) slots.delete(id);
    }
    return null;
  }
  const running = runningOf(context);
  const { started, session } = running;
  switch (op.kind) {
    case "user": {
      const { world } = started.github;
      if (world.accountById(op.id) === undefined) world.addUser({ id: op.id, login: op.login, nodeId: `U_${op.login}` });
      return null;
    }
    case "deploy": {
      await started.deploy({ ...started.deployed(), roles: op.roles });
      return null;
    }
    case "repository": {
      const { id, owner, name, fork, archived, license, files } = op.setup;
      started.github.world.addRepo({ id, owner, name, fork, archived, description: `${name} open-source repository on GitHub.`, license: { spdx: license }, files });
      return null;
    }
    case "permission":
      started.github.world.setPermission(op.repository, op.login, op.level);
      return null;
    case "installation":
      started.github.world.addInstallation({ ...op.setup, permissions: { contents: "read", issues: "write", pull_requests: "write" } });
      return null;
    case "githubFail":
      started.github.failNext(op.path, { status: op.status });
      return null;
    case "scanner":
      return started.scanner(op.method, op.path, op.body);
    case "object":
      await started.replace(op.bucket, op.key, op.text);
      return null;
    case "vault":
      return vault(running, op.projectId, op.purpose);
    case "bindPayout":
      await bindPayout(running, op.githubId, op.vault);
      return null;
    case "backendRpc": {
      if (op.enabled) await walletChain(session, homeChainId);
      await started.deploy({ ...started.deployed(), rpc: op.enabled });
      return null;
    }
    case "finalize": {
      const chain = await walletChain(session, op.chainId);
      const head = BigInt(String(await chain.rpc("eth_blockNumber")));
      chain.setFinalized(head);
      return Number(head);
    }
    case "branch": {
      const { world } = started.github;
      const repository = world.repo(op.repository);
      const head = repository.branches.get(op.name) ?? repository.branches.get(repository.defaultBranch);
      return world.addCommit(op.repository, { branch: op.name, files: op.files, parents: head === undefined ? [] : [head] });
    }
    case "github":
      session.consenting = op.login;
      return null;
    case "open": {
      const opened = await tab(session, op.tab ?? session.current);
      const destination = `${site}${op.path}`;
      const loaded = opened.url() === destination
        ? await opened.reload({ waitUntil: "load" })
        : await opened.goto(destination, { waitUntil: "load" });
      return { status: loaded?.status() ?? 0, headers: loaded?.headers() ?? {} };
    }
    case "tab":
      await tab(session, op.tab);
      return null;
    case "where":
      return pageOf(session).url();
    case "click":
      await locate(pageOf(session), op.target).first().click();
      return null;
    case "fill":
      await locate(pageOf(session), op.target).first().fill(op.value);
      return null;
    case "select":
      await locate(pageOf(session), op.target).first().selectOption({ label: op.label });
      return null;
    case "press":
      await pageOf(session).keyboard.press(op.keys);
      return null;
    case "read":
      return read(session, op.target);
    case "focused":
      return pageOf(session).evaluate(() => {
        const active = document.activeElement;
        return { tag: active?.tagName.toLowerCase() ?? "", name: (active?.getAttribute("aria-label") ?? active?.textContent ?? "").trim() };
      });
    case "refocus":
      await pageOf(session).evaluate(() => {
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new FocusEvent("focus"));
      });
      return null;
    case "blockCookies":
      session.cookiesBlocked = true;
      return null;
    case "upload":
      await locate(pageOf(session), op.target).first().locator("xpath=descendant-or-self::input[@type='file']").first().setInputFiles({ name: op.file.name, mimeType: op.file.mimeType, buffer: Buffer.from(op.file.bytes) });
      return null;
    case "fetch":
      return pageOf(session).evaluate(async ({ method, path, body }) => {
        const response = await fetch(path, { method, credentials: "same-origin", headers: body === undefined ? {} : { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const text = await response.text();
        return { status: response.status, body: text === "" ? null : (JSON.parse(text) as unknown) };
      }, { method: op.method, path: op.path, body: op.body });
    case "download":
      return (await session.downloaded) ?? null;
    case "leaks":
      return leaks(session, op.text);
    case "hold": {
      let release = () => undefined as void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      session.holds.set(holdKey(op.method, op.path), { released, release });
      return null;
    }
    case "release": {
      const key = holdKey(op.method, op.path);
      session.holds.get(key)?.release();
      session.holds.delete(key);
      return null;
    }
    case "fail":
      session.canned.set(holdKey(op.method, op.path), { kind: "json", status: op.status, body: op.body });
      return null;
    case "unfail":
      session.canned.delete(holdKey(op.method, op.path));
      return null;
    case "serve":
      session.canned.set(
        holdKey("*", op.path),
        op.bytes === undefined ? { kind: "json", status: op.status, body: op.body } : { kind: "bytes", status: op.status, bytes: new Uint8Array(Buffer.from(op.bytes, "base64")), contentType: op.contentType ?? "application/octet-stream" },
      );
      return null;
    case "published":
      return published(context, session, op.leaderboard);
    case "unserve":
      session.canned.delete(holdKey("*", op.path));
      return null;
    case "clock": {
      if (session.clocked) await session.context.clock.setSystemTime(op.iso);
      else await session.context.clock.install({ time: op.iso });
      session.clocked = true;
      return null;
    }
    case "sent":
      return [...session.sent];
    case "verifications":
      return [...started.verifications];
    case "sql":
      return started.rows(op.text, op.params);
    case "popups":
      return session.context.pages().filter((opened) => ![...session.tabs.values()].includes(opened)).length;
    case "view": {
      const opened = await tab(session, session.current);
      await opened.setViewportSize({ width: op.width, height: op.height });
      await opened.emulateMedia({ reducedMotion: op.reducedMotion ? "reduce" : "no-preference" });
      return null;
    }
    case "enlarge":
      await session.restore?.();
      session.restore = await enlargeText(locate(pageOf(session), op.target).first());
      return null;
    case "restore":
      await session.restore?.();
      session.restore = undefined;
      return null;
    case "layout":
      return layout(session);
    case "box": {
      const found = locate(pageOf(session), op.target);
      if ((await found.count()) === 0) return null;
      const box = await found.first().boundingBox();
      return box === null ? null : ({ top: box.y, bottom: box.y + box.height } satisfies Box);
    }
    case "scrollY":
      return pageOf(session).evaluate(() => window.scrollY);
    case "wheel":
      await pageOf(session).mouse.wheel(op.dx, op.dy);
      return null;
    case "scrollEnd":
      return pageOf(session).evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    case "reveal":
      await locate(pageOf(session), op.target).first().scrollIntoViewIfNeeded();
      await pageOf(session).evaluate(() => document.fonts.ready.then(() => undefined));
      return null;
    case "back":
      await pageOf(session).goBack({ waitUntil: "load" });
      return null;
    case "forward":
      await pageOf(session).goForward({ waitUntil: "load" });
      return null;
    case "stamp":
      await pageOf(session).evaluate((value) => history.replaceState({ ...(history.state as object | null), readerState: value }, ""), op.value);
      return null;
    case "stamped":
      return pageOf(session).evaluate(() => {
        const state: unknown = history.state;
        return typeof state === "object" && state !== null && "readerState" in state && typeof state.readerState === "string" ? state.readerState : null;
      });
    case "allow":
      session.allowed = [...session.allowed, ...op.patterns.map((pattern) => new RegExp(pattern, "u"))];
      return null;
    case "diagnostics":
      return diagnostics(session);
    case "wallets":
      session.wallets = await injectWallets(session.context, op.setup, op.setup.evm === undefined ? undefined : (chainId) => walletChain(session, chainId));
      return null;
    case "walletAccount":
      walletsOf(session).useAccount(op.index);
      return null;
    case "walletReject":
      walletsOf(session).rejectNext();
      return null;
    case "walletFail":
      walletsOf(session).failNext(op.method);
      return null;
    case "walletAsked":
      return [...walletsOf(session).asked];
    case "walletAddresses":
      return walletsOf(session).addresses();
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

function walletsOf(into: Session): Wallets {
  const injected = into.wallets;
  if (injected === undefined) throw new Error("site: inject the wallets first");
  return injected;
}

export const command: BrowserCommand<[Op], Result<Op>> = (context, op) => run(context, op) as Promise<Result<Op>>;
