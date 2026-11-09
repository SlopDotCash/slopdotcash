/**
 * Captures local or production evidence from an already identified site build.
 * Production mode never builds: it proves the deployed apex serves the exact
 * local dist before recording pixels, traffic, DNS, TLS, and redirect state.
 */

import { spawn, spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { connect as connectTls } from "node:tls";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { readLeaderboardBytes } from "../src/lib/leaderboard-transport.mjs";
import { PROJECTS } from "../src/lib/projects.mjs";
import { childEnvironment } from "./child-environment.mjs";
import {
  beginEvidenceTransaction,
  validateEvidenceBundle,
  withEvidenceCleanup,
} from "./evidence-bundle.mjs";
import {
  assertCommittedBuildManifest,
  assertDnsAddresses,
  assertHttpsRedirect,
  assertImmutableAssetCache,
  assertLiveLedgerReady,
  assertSecurityHeaders,
  PRODUCTION_HOSTNAME,
  PRODUCTION_ORIGIN,
  parseEvidenceMode,
  probeProductionTls,
  REMOTE_ARTIFACT_PATHS,
  readEvidenceResponseBytes,
  shouldBuildForEvidence,
  verifyRemoteArtifacts,
  withEvidenceResponse,
} from "./evidence-contract.mjs";
import {
  completeEvidenceCommand,
  observeEvidenceProcess,
  stopEvidencePreview,
} from "./evidence-process.mjs";
import { sha256Hex as hash } from "./sha256.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = packageRoot;
const distRoot = join(packageRoot, "dist");
const finalEvidenceRoot = join(packageRoot, "evidence");
const MAX_PREVIEW_MANIFEST_BYTES = 1024 * 1024;
const mode = parseEvidenceMode(process.argv.slice(2));
const rootPublishedProjects = PROJECTS.filter(
  (project) => project.skill.publishAtRoot === true,
);
const externalPrizeProjects = PROJECTS.filter(
  (project) => project.reward.kind === "external-prize-share",
);
if (rootPublishedProjects.length > 1) {
  throw new TypeError(
    "evidence capture allows at most one root-published project",
  );
}
// The registry may be empty; the walkthrough visits only listed projects.
const rootPublishedProjectId = rootPublishedProjects[0]?.id ?? null;
const representativeExternalPrizeProjectId =
  externalPrizeProjects[0]?.id ?? null;

function run(command, args) {
  const child = spawn(command, args, {
    cwd: packageRoot,
    env: childEnvironment(),
    stdio: "inherit",
  });
  return completeEvidenceCommand(command, observeEvidenceProcess(child));
}

function digest(path) {
  return hash(readFileSync(path));
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error("[Slop] could not identify the evidence revision");
  }
  const revision = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new TypeError("[Slop] evidence revision is not a full commit SHA");
  }
  return revision;
}

function readDistArtifacts() {
  return REMOTE_ARTIFACT_PATHS.map((path) => {
    const localPath = join(distRoot, ...path.split("/"));
    let contents;
    try {
      contents = readFileSync(localPath);
    } catch (error) {
      // error-policy:J2 evidence capture reports the exact missing build path.
      throw new Error(`[Slop] dist is incomplete: ${path} is not readable`, {
        cause: error,
      });
    }
    if (contents.length === 0) {
      throw new Error(`[Slop] dist artifact is empty: ${path}`);
    }
    return { contents, localPath, path };
  });
}

function findArtifact(artifacts, path) {
  const artifact = artifacts.find((candidate) => candidate.path === path);
  if (!artifact) {
    throw new TypeError(`[Slop] dist omitted required ${path}`);
  }
  return artifact;
}

function assertPreviewRunning(server, state) {
  if (state.error) {
    throw new Error("[Slop] preview process could not start", {
      cause: state.error,
    });
  }
  if (state.closed || server.exitCode !== null || server.signalCode !== null) {
    throw new Error(
      `[Slop] owned preview exited before evidence completed (code=${server.exitCode ?? "none"}, signal=${server.signalCode ?? "none"})`,
    );
  }
}

async function reserveLoopbackPort() {
  const listener = createServer();
  await new Promise((resolvePromise, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = listener.address();
  if (!address || typeof address === "string") {
    listener.close();
    throw new Error("[Slop] could not reserve a loopback port");
  }
  await new Promise((resolvePromise, reject) => {
    listener.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolvePromise();
      }
    });
  });
  return address.port;
}

async function waitForServer(baseUrl, server, state, expectedFingerprint) {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    assertPreviewRunning(server, state);
    let response;
    try {
      response = await fetch(
        `${baseUrl}/skill-manifest.json?build=${expectedFingerprint}`,
        {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
          signal: AbortSignal.timeout(5_000),
        },
      );
    } catch {
      // error-policy:J5 Connection failures are observed by the owned-process check and bounded timeout.
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      continue;
    }
    const servedFingerprint = await withEvidenceResponse(response, async () => {
      if (!response.ok) {
        throw new Error(
          `[Slop] owned preview returned ${response.status} for the build fingerprint`,
        );
      }
      const bytes = await readEvidenceResponseBytes(
        response,
        MAX_PREVIEW_MANIFEST_BYTES,
        "[Slop] owned preview build fingerprint",
      );
      return hash(bytes);
    });
    if (servedFingerprint !== expectedFingerprint) {
      throw new Error(
        "[Slop] preview served a build other than the selected dist",
      );
    }
    return;
  }
  throw new Error("[Slop] preview server did not become ready");
}

async function stopPreview(server) {
  await stopEvidencePreview(server, previewState);
}

function hashedAssetPath(indexHtml) {
  const match = indexHtml.match(/(?:href|src)="(\/assets\/[^"?]+)"/);
  if (!match) {
    throw new TypeError(
      "[Slop] built index omitted a hashed /assets reference",
    );
  }
  return match[1];
}

async function inspectProductionNetwork(cacheKey, assetPath) {
  const addresses = assertDnsAddresses(
    await lookup(PRODUCTION_HOSTNAME, { all: true, verbatim: true }),
  );
  const tls = await probeProductionTls(connectTls);
  const httpUrl = new URL(`http://${PRODUCTION_HOSTNAME}/`);
  httpUrl.searchParams.set("verify", cacheKey);
  const redirectResponse = await fetch(httpUrl, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  const redirect = await withEvidenceResponse(redirectResponse, () =>
    assertHttpsRedirect(
      redirectResponse.status,
      redirectResponse.headers.get("location"),
    ),
  );
  const httpsUrl = new URL("/", PRODUCTION_ORIGIN);
  httpsUrl.searchParams.set("verify", cacheKey);
  const httpsResponse = await fetch(httpsUrl, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const securityHeaders = await withEvidenceResponse(httpsResponse, () => {
    if (!httpsResponse.ok) {
      throw new Error(
        `[Slop] production apex returned HTTP ${httpsResponse.status}`,
      );
    }
    if (new URL(httpsResponse.url).origin !== PRODUCTION_ORIGIN) {
      throw new Error(
        `[Slop] production HTTPS request left ${PRODUCTION_ORIGIN}`,
      );
    }
    return assertSecurityHeaders(httpsResponse.headers);
  });
  const assetUrl = new URL(assetPath, PRODUCTION_ORIGIN);
  assetUrl.searchParams.set("verify", cacheKey);
  const assetResponse = await fetch(assetUrl, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const assetCacheControl = await withEvidenceResponse(assetResponse, () => {
    if (!assetResponse.ok) {
      throw new Error(
        `[Slop] production asset returned HTTP ${assetResponse.status}`,
      );
    }
    return assertImmutableAssetCache(assetResponse.headers);
  });
  return {
    asset: {
      cacheControl: assetCacheControl,
      status: assetResponse.status,
      url: assetResponse.url,
    },
    dns: { addresses, hostname: PRODUCTION_HOSTNAME },
    https: { status: httpsResponse.status, url: httpsResponse.url },
    redirect,
    securityHeaders,
    tls,
  };
}

function firstParty(url, expectedOrigin) {
  try {
    return new URL(url).origin === expectedOrigin;
  } catch {
    // error-policy:J3 malformed browser telemetry is an explicit non-first-party value.
    return false;
  }
}

if (shouldBuildForEvidence(mode)) {
  await run("bun", ["run", "build"]);
}

const artifacts = readDistArtifacts();
const indexArtifact = findArtifact(artifacts, "index.html");
const manifestArtifact = findArtifact(artifacts, "skill-manifest.json");
const leaderboardArtifact = findArtifact(artifacts, "data/leaderboard.json");
const buildFingerprint = hash(manifestArtifact.contents);
const ledger = assertLiveLedgerReady(
  await readLeaderboardBytes(leaderboardArtifact.contents, async (path) => {
    const relative = path.slice(1);
    let artifact = artifacts.find((candidate) => candidate.path === relative);
    if (!artifact) {
      const localPath = join(distRoot, relative);
      artifact = {
        path: relative,
        localPath,
        contents: readFileSync(localPath),
      };
      artifacts.push(artifact);
    }
    return artifact.contents;
  }),
);
const revision = gitHead();
const cacheKey = `${revision}-${Date.now()}`;

let baseUrl;
let previewServer;
let previewState;
let verification;

if (mode === "production") {
  const manifest = assertCommittedBuildManifest(
    manifestArtifact.contents,
    revision,
  );
  const remoteArtifacts = await verifyRemoteArtifacts({
    artifacts,
    cacheKey,
  });
  const network = await inspectProductionNetwork(
    cacheKey,
    hashedAssetPath(indexArtifact.contents.toString("utf8")),
  );
  baseUrl = PRODUCTION_ORIGIN;
  verification = {
    schemaVersion: "1",
    capturedAt: new Date().toISOString(),
    mode,
    origin: PRODUCTION_ORIGIN,
    buildFingerprint,
    ledger,
    manifest,
    network,
    remoteArtifacts,
    revision,
  };
} else {
  const previewPort = await reserveLoopbackPort();
  baseUrl = `http://127.0.0.1:${previewPort}`;
  previewServer = spawn(
    process.execPath,
    [
      join(packageRoot, "node_modules", "vite", "bin", "vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(previewPort),
      "--strictPort",
    ],
    {
      cwd: packageRoot,
      env: childEnvironment(),
      stdio: "inherit",
    },
  );
  previewState = observeEvidenceProcess(previewServer);
  try {
    await waitForServer(baseUrl, previewServer, previewState, buildFingerprint);
  } catch (error) {
    // error-policy:J6 a failed local preview is terminated before its startup error is rethrown.
    await withEvidenceCleanup(async () => {
      throw error;
    }, [{ label: "preview shutdown", run: () => stopPreview(previewServer) }]);
  }
  verification = {
    schemaVersion: "1",
    capturedAt: new Date().toISOString(),
    mode,
    origin: baseUrl,
    buildFingerprint,
    ledger,
    revision,
  };
}

let evidenceTransaction;
try {
  evidenceTransaction = beginEvidenceTransaction(finalEvidenceRoot);
} catch (error) {
  // error-policy:J6 a local preview is terminated if evidence staging cannot begin.
  await withEvidenceCleanup(async () => {
    throw error;
  }, [{ label: "preview shutdown", run: () => stopPreview(previewServer) }]);
}
const evidenceRoot = evidenceTransaction.stagingRoot;
const videoRoot = join(evidenceRoot, ".video");

async function captureEvidence() {
  mkdirSync(videoRoot, { recursive: true });
  writeFileSync(
    join(evidenceRoot, "site-verification.json"),
    `${JSON.stringify(verification, null, 2)}\n`,
  );

  const browser = await chromium.launch();
  const log = {
    capturedAt: verification.capturedAt,
    baseUrl,
    buildFingerprint,
    mode,
    console: [],
    network: [],
    pageErrors: [],
    requestFailures: [],
  };
  const expectedOrigin = new URL(baseUrl).origin;

  async function capture(
    name,
    viewport,
    recordVideo = false,
    captureScreenshot = true,
  ) {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      extraHTTPHeaders: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      recordVideo: recordVideo
        ? { dir: videoRoot, size: { width: 1440, height: 900 } }
        : undefined,
      viewport,
    });
    const page = await context.newPage();
    // The site reads the project registry from D1 at startup. A local
    // preview has no Pages Functions, so it serves the committed snapshot
    // the build ingested; production evidence reads the live API.
    if (mode !== "production")
      await page.route("**/api/v1/projects", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify({ schemaVersion: "1", projects: PROJECTS }),
        }),
      );
    page.on("console", (message) => {
      log.console.push({
        page: name,
        type: message.type(),
        text: message.text(),
      });
    });
    page.on("pageerror", (error) => {
      log.pageErrors.push({
        page: name,
        message: error.message,
      });
    });
    page.on("response", (response) => {
      log.network.push({
        page: name,
        method: response.request().method(),
        status: response.status(),
        url: response.url(),
      });
    });
    page.on("requestfailed", (request) => {
      log.requestFailures.push({
        page: name,
        error: request.failure()?.errorText ?? "unknown",
        method: request.method(),
        url: request.url(),
      });
    });

    await page.goto(`${baseUrl}/?evidence=${cacheKey}`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("heading", {
        name: "MAKE MONEY SHIPPING OPEN SOURCE.",
        level: 1,
      })
      .waitFor({
        state: "visible",
        timeout: 20_000,
      });
    await page.locator("#projects").waitFor({ state: "visible" });
    await page
      .locator("#leaderboard")
      .getByLabel("Period", { exact: true })
      .selectOption("lifetime");
    await page
      .locator("#leaderboard table")
      .first()
      .waitFor({ state: "visible" });
    if (previewServer && previewState) {
      assertPreviewRunning(previewServer, previewState);
    }
    if (captureScreenshot) {
      await page.screenshot({
        fullPage: true,
        path: join(evidenceRoot, `${name}.jpg`),
        quality: 88,
        type: "jpeg",
      });
    }

    let video;
    if (recordVideo) {
      video = page.video();
      await page.locator("#projects").scrollIntoViewIfNeeded();
      await page.waitForTimeout(900);
      await page.locator("#leaderboard").scrollIntoViewIfNeeded();
      await page.waitForTimeout(900);

      if (rootPublishedProjectId !== null) {
        await page.goto(
          `${baseUrl}/projects/${rootPublishedProjectId}?evidence=${cacheKey}`,
          {
            waitUntil: "networkidle",
          },
        );
        await page.locator("h1").waitFor({ state: "visible" });
        await page.locator("#start").scrollIntoViewIfNeeded();
        await page.waitForTimeout(900);
        await page.locator("#contributors").scrollIntoViewIfNeeded();
        await page.waitForTimeout(900);
      }

      if (representativeExternalPrizeProjectId !== null) {
        await page.goto(
          `${baseUrl}/projects/${representativeExternalPrizeProjectId}?evidence=${cacheKey}`,
          { waitUntil: "networkidle" },
        );
        await page.locator("h1").waitFor({ state: "visible" });
        await page.waitForTimeout(900);
      }

      await page.goto(`${baseUrl}/projects/new?evidence=${cacheKey}`, {
        waitUntil: "networkidle",
      });
      await page.locator("h1").waitFor({ state: "visible" });
      await page.waitForTimeout(900);
      await page.locator("header").scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
    }
    await context.close();
    if (video) {
      await video.saveAs(join(evidenceRoot, "walkthrough.webm"));
    }
  }

  await withEvidenceCleanup(async () => {
    await capture("after-desktop", { width: 1440, height: 1000 });
    await capture("walkthrough", { width: 1440, height: 900 }, true, false);
    await capture("after-mobile", { width: 320, height: 800 });
    if (previewServer && previewState) {
      assertPreviewRunning(previewServer, previewState);
    }
  }, [{ label: "browser close", run: () => browser.close() }]);

  const webmPath = join(evidenceRoot, "walkthrough.webm");
  const mp4Path = join(evidenceRoot, "walkthrough.mp4");
  await run("ffmpeg", [
    "-y",
    "-i",
    webmPath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    mp4Path,
  ]);
  rmSync(webmPath);
  rmSync(videoRoot, { force: true, recursive: true });

  writeFileSync(
    join(evidenceRoot, "browser-log.json"),
    `${JSON.stringify(log, null, 2)}\n`,
  );

  const consoleErrors = log.console.filter((entry) => entry.type === "error");
  const pageErrors = log.pageErrors;
  const failedFirstPartyResponses = log.network.filter(
    (entry) => firstParty(entry.url, expectedOrigin) && entry.status >= 400,
  );
  const failedFirstPartyRequests = log.requestFailures.filter((entry) =>
    firstParty(entry.url, expectedOrigin),
  );
  const artifactNames = [
    "after-desktop.jpg",
    "after-mobile.jpg",
    "walkthrough.mp4",
    "browser-log.json",
    "site-verification.json",
  ];
  const recordedArtifacts = artifactNames.map((name) => ({
    name,
    sha256: digest(join(evidenceRoot, name)),
  }));
  writeFileSync(
    join(evidenceRoot, "manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1",
        capturedAt: log.capturedAt,
        buildFingerprint,
        mode,
        artifacts: recordedArtifacts,
        validation: {
          consoleErrors: consoleErrors.length,
          failedFirstPartyRequests: failedFirstPartyRequests.length,
          failedFirstPartyResponses: failedFirstPartyResponses.length,
          pageErrors: pageErrors.length,
        },
      },
      null,
      2,
    )}\n`,
  );
  if (
    consoleErrors.length > 0 ||
    pageErrors.length > 0 ||
    failedFirstPartyResponses.length > 0 ||
    failedFirstPartyRequests.length > 0
  ) {
    throw new Error(
      `[Slop] evidence captured browser errors: console=${consoleErrors.length}, page=${pageErrors.length}, responses=${failedFirstPartyResponses.length}, requests=${failedFirstPartyRequests.length}`,
    );
  }
  validateEvidenceBundle(evidenceRoot, { buildFingerprint, mode });
  evidenceTransaction.publish();
}

await withEvidenceCleanup(captureEvidence, [
  { label: "preview shutdown", run: () => stopPreview(previewServer) },
  { label: "evidence staging cleanup", run: () => evidenceTransaction.abort() },
]);
console.log(`[Slop] ${mode} evidence written to ${finalEvidenceRoot}`);
