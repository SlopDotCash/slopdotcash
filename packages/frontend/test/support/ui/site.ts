// spec/frontend/navigation.md, "Story: Resume an authorized destination after signing in"; spec/backend/accounts.md, "A web sign-in consumes one web assertion and opens a public membership"; spec/backend/identity.md, "At most one poll receives the flow's identity"
import { join } from "node:path";
import { type Handler, bundle, migrate, startWorker } from "@repo/platform/testing";
import { githubFake } from "@repo/platform/testing/github";
import { internet } from "@repo/platform/testing/internet";
import { migrationsDir, repoRoot } from "@repo/platform/testing/paths";
import type {} from "@vitest/browser-playwright";
import { Request, Response } from "miniflare";
import type { Browser, BrowserContext, Locator, Page, Route } from "playwright";
import { createBuilder } from "vite";
import type { ViteUserConfig } from "vitest/config";
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";
import type { Diagnostics, Layout, Op, Result, Row, Sent, Shown, Target, Verification } from "./protocol.ts";
import { enlargeText } from "./textSize.ts";
import { type Wallets, injectWallets } from "./wallets.ts";

const site = "https://slop.cash";
const identityOrigin = "https://identity.slop.cash";
const appRoot = join(repoRoot, "apps/app");
const backendRoot = join(repoRoot, "apps/backend");
const roles = { ADMIN_GITHUB_IDS: "9001", PROJECT_MODERATOR_GITHUB_IDS: "9001", OPERATOR_GITHUB_IDS: "9001" };
const placeholder = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#777"/></svg>')}`;

interface Fetching {
  fetch(request: Request): Promise<Response>;
}

interface Started {
  readonly site: (request: Request) => Promise<Response>;
  readonly identity: (request: Request) => Promise<Response>;
  readonly github: ReturnType<typeof githubFake>;
  readonly rows: (text: string, params: ReadonlyArray<string | number | null>) => Promise<ReadonlyArray<Row>>;
  readonly verifications: Verification[];
}

interface Held {
  readonly released: Promise<void>;
  readonly release: () => void;
}

interface Session {
  readonly context: BrowserContext;
  readonly tabs: Map<string, Page>;
  readonly holds: Map<string, Held>;
  readonly sent: Sent[];
  readonly console: string[];
  readonly failed: string[];
  allowed: ReadonlyArray<RegExp>;
  current: string;
  consenting: string;
  restore: (() => Promise<void>) | undefined;
  wallets: Wallets | undefined;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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

async function builtSite(): Promise<string> {
  const outDir = join(appRoot, ".cache/site");
  const builder = await createBuilder({ root: appRoot, configFile: join(appRoot, "vite.config.ts"), logLevel: "error", mode: "production", build: { outDir, emptyOutDir: true, sourcemap: false } });
  const client = builder.environments.client;
  if (client === undefined) throw new Error("apps/app builds no client");
  await builder.build(client);
  return outDir;
}

async function start(): Promise<Started> {
  const assets = await builtSite();
  const script = await bundle(appRoot, { entry: "_worker" });
  const identityScript = await bundle(backendRoot, { entry: "identity" });
  const github = githubFake();
  const net = internet({ github: github.handler });
  const verifications: Verification[] = [];
  const mf = startWorker({
    script,
    assets,
    d1: { SLOP_DB: "slop-private" },
    r2: ["PRIVATE_TRACES", "VETTING_EVIDENCE"],
    vars: {
      ...roles,
      SLOP_ENVIRONMENT: "production",
      PUBLIC_SITE_URL: site,
      PAYMENT_NETWORKS: "[]",
      MONTHLY_PAYMENT_SCHEDULE: '{"firstPeriod":"2026-11","cutoffSecondsAfterPeriodEnd":259200}',
      SLOP_PRIVATE_INTAKE_MODE: "on",
      TRACE_AUTH_SECRET: "trace-auth-secret-for-the-browser-journeys-0001",
    },
    services: { SLOP_NOTIFY: notifyOf(verifications) },
    outbound: net.handler,
    workers: {
      SLOP_IDENTITY: {
        name: "identity",
        script: identityScript,
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
  await mf.ready;
  const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((file) => file.error !== undefined);
  if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
  const identity = (await mf.getWorker("identity")) as unknown as Fetching;
  return {
    site: (request) => mf.dispatchFetch(request),
    identity: (request) => identity.fetch(request),
    github,
    rows: async (text, params) => (await (await mf.getD1Database("SLOP_DB", "worker")).prepare(text).bind(...params).all<Row>()).results,
    verifications,
  };
}

let started: Promise<Started> | undefined;
let session: Session | undefined;

const backend = () => (started ??= start());

function current(): Session {
  if (session === undefined) throw new Error("site: start the site first");
  return session;
}

function page(): Page {
  const opened = current().tabs.get(current().current);
  if (opened === undefined) throw new Error(`site: no tab ${current().current}`);
  return opened;
}

function holdKey(method: string, path: string) {
  return `${method.toUpperCase()} ${path}`;
}

async function answer(route: Route, worker: (request: Request) => Promise<Response>, transform: (url: URL) => URL = (url) => url) {
  const asked = route.request();
  const url = transform(new URL(asked.url()));
  const headers = Object.fromEntries(Object.entries(await asked.allHeaders()).filter(([name]) => !name.startsWith(":")));
  const body = asked.postDataBuffer();
  if (url.origin === site) current().sent.push({ method: asked.method(), path: url.pathname, actor: headers["x-slop-expected-github-id"] ?? null });
  const response = await worker(new Request(url.toString(), { method: asked.method(), headers, redirect: "manual", ...(body === null ? {} : { body: new Uint8Array(body) }) }));
  const bytes = Buffer.from(await response.arrayBuffer());
  const held = url.origin === site ? current().holds.get(holdKey(asked.method(), url.pathname)) : undefined;
  if (held !== undefined) await held.released;
  const shown: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") shown[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) shown["set-cookie"] = cookies.join("\n");
  await route.fulfill({ status: response.status, headers: shown, body: bytes }).catch(() => undefined);
}

async function routed(route: Route) {
  const backendNow = await backend();
  const url = new URL(route.request().url());
  if (url.origin === site) return answer(route, backendNow.site);
  if (url.origin === identityOrigin) return answer(route, backendNow.identity);
  if (url.origin === "https://github.com" && url.pathname === "/login/oauth/authorize")
    return answer(route, async (request) => backendNow.github.handler(request), (next) => {
      next.searchParams.set("login", current().consenting);
      return next;
    });
  if (url.hostname === "avatars.githubusercontent.com") return route.fulfill({ status: 302, headers: { location: placeholder } });
  if (url.hostname === "static.cloudflareinsights.com") return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
  current().failed.push(`unexpected ${route.request().method()} ${url.origin}${url.pathname}`);
  return route.abort("blockedbyclient");
}

function watch(opened: Page, into: Session) {
  opened.on("console", (message) => {
    if (message.type() === "error") into.console.push(`console ${message.text()}`);
  });
  opened.on("pageerror", (error) => into.console.push(`pageerror ${error.message}`));
  opened.on("requestfailed", (request) => {
    if (request.url().startsWith(site)) into.failed.push(`failed ${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? ""}`);
  });
  opened.on("response", (response) => {
    if (response.url().startsWith(site) && response.status() >= 400) into.failed.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
  });
}

async function reset(context: BrowserCommandContext) {
  const previous = session;
  session = undefined;
  if (previous !== undefined) {
    await previous.wallets?.close();
    for (const held of previous.holds.values()) held.release();
    await previous.context.close();
  }
  await backend();
  const browser: Browser | null = context.context.browser();
  if (browser === null) throw new Error("site: the Vitest browser has no Playwright browser");
  const opened = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const made: Session = { context: opened, tabs: new Map(), holds: new Map(), sent: [], console: [], failed: [], allowed: [], current: "main", consenting: "", restore: undefined, wallets: undefined };
  session = made;
  await opened.route("**/*", routed);
}

async function tab(name: string): Promise<Page> {
  const into = current();
  const known = into.tabs.get(name);
  into.current = name;
  if (known !== undefined) {
    await known.bringToFront();
    return known;
  }
  const opened = await into.context.newPage();
  into.tabs.set(name, opened);
  watch(opened, into);
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

const absent: Shown = { count: 0, visible: false, text: "", value: null, disabled: false, checked: null, focused: false, href: null };

async function read(target: Target): Promise<Shown> {
  const found = locate(page(), target);
  const count = await found.count();
  if (count === 0) return absent;
  const first = found.first();
  const visible = await first.isVisible();
  const facts = await first.evaluate((element) => {
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
  });
  return { count, visible, ...facts };
}

function layout(): Promise<Layout> {
  return page().evaluate(() => {
    const shown = (element: Element) => element instanceof HTMLElement && element.offsetParent !== null && getComputedStyle(element).visibility !== "hidden";
    const named = (element: Element) => {
      const labelled = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/u).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join("");
      const labels = element instanceof HTMLInputElement ? [...(element.labels ?? [])].map((label) => label.textContent ?? "").join("") : "";
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

function leaks(text: string): Promise<boolean> {
  return page().evaluate((needle) => {
    if (document.body.innerText.includes(needle)) return true;
    for (const element of document.querySelectorAll("*")) {
      if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.value.includes(needle)) return true;
      for (const name of ["title", "aria-label", "aria-description", "alt", "placeholder", "value", "data-tooltip"]) if ((element.getAttribute(name) ?? "").includes(needle)) return true;
    }
    return false;
  }, text);
}

function diagnostics(): Diagnostics {
  const into = current();
  const allowed = (line: string) => into.allowed.some((pattern) => pattern.test(line));
  return { console: into.console.filter((line) => !allowed(line)), failed: into.failed.filter((line) => !allowed(line)) };
}

async function run(context: BrowserCommandContext, op: Op): Promise<unknown> {
  switch (op.kind) {
    case "start":
      await reset(context);
      return null;
    case "user":
      (await backend()).github.world.addUser({ id: op.id, login: op.login, nodeId: `U_${op.login}` });
      return null;
    case "github":
      current().consenting = op.login;
      return null;
    case "open": {
      const opened = await tab(op.tab ?? current().current);
      const loaded = await opened.goto(`${site}${op.path}`, { waitUntil: "load" });
      return { status: loaded?.status() ?? 0, headers: loaded?.headers() ?? {} };
    }
    case "tab":
      await tab(op.tab);
      return null;
    case "where":
      return page().url();
    case "click":
      await locate(page(), op.target).first().click();
      return null;
    case "fill":
      await locate(page(), op.target).first().fill(op.value);
      return null;
    case "press":
      await page().keyboard.press(op.keys);
      return null;
    case "read":
      return read(op.target);
    case "focused":
      return page().evaluate(() => {
        const active = document.activeElement;
        return { tag: active?.tagName.toLowerCase() ?? "", name: (active?.getAttribute("aria-label") ?? active?.textContent ?? "").trim() };
      });
    case "refocus":
      await page().evaluate(() => {
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new FocusEvent("focus"));
      });
      return null;
    case "fetch":
      return page().evaluate(async ({ method, path, body }) => {
        const response = await fetch(path, { method, credentials: "same-origin", headers: body === undefined ? {} : { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const text = await response.text();
        return { status: response.status, body: text === "" ? null : (JSON.parse(text) as unknown) };
      }, { method: op.method, path: op.path, body: op.body });
    case "leaks":
      return leaks(op.text);
    case "hold": {
      let release = () => undefined as void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      current().holds.set(holdKey(op.method, op.path), { released, release });
      return null;
    }
    case "release": {
      const key = holdKey(op.method, op.path);
      current().holds.get(key)?.release();
      current().holds.delete(key);
      return null;
    }
    case "sent":
      return [...current().sent];
    case "verifications":
      return [...(await backend()).verifications];
    case "sql":
      return (await backend()).rows(op.text, op.params);
    case "popups":
      return current().context.pages().filter((opened) => ![...current().tabs.values()].includes(opened)).length;
    case "view":
      await page().setViewportSize({ width: op.width, height: op.height });
      await page().emulateMedia({ reducedMotion: op.reducedMotion ? "reduce" : "no-preference" });
      return null;
    case "enlarge":
      await current().restore?.();
      current().restore = await enlargeText(locate(page(), op.target).first());
      return null;
    case "restore":
      await current().restore?.();
      current().restore = undefined;
      return null;
    case "layout":
      return layout();
    case "allow":
      current().allowed = [...current().allowed, ...op.patterns.map((pattern) => new RegExp(pattern, "u"))];
      return null;
    case "diagnostics":
      return diagnostics();
    case "wallets":
      current().wallets = await injectWallets(current().context, op.setup);
      return null;
    case "walletAccount":
      wallets().useAccount(op.index);
      return null;
    case "walletReject":
      wallets().rejectNext();
      return null;
    case "walletAsked":
      return [...wallets().asked];
    case "walletAddresses":
      return wallets().addresses();
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

function wallets(): Wallets {
  const injected = current().wallets;
  if (injected === undefined) throw new Error("site: inject the wallets first");
  return injected;
}

const command: BrowserCommand<[Op], Result<Op>> = (context, op) => run(context, op) as Promise<Result<Op>>;

export function siteCommands() {
  return { name: "slop:site-commands", config: (): ViteUserConfig => ({ test: { browser: { commands: { site: command } } } }) };
}
