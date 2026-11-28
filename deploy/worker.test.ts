import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
  hashAssetDirectory,
  resolveStage,
  StageGuardError,
  verifyDeploymentEndpoints,
} from "vibestack/alchemy";
import {
  assertSlopStageIsolation,
  findReviewedConfig,
  loadPagesRoutes,
  loadReviewedConfigs,
  PINNED_MIGRATION_COUNT,
  PINNED_MIGRATION_LEDGER_SHA256,
  PUBLICATION_ORDER,
  resolveSlopStatePrefix,
  verifyPinnedMigrationLedger,
} from "./catalog.ts";

const rootDir = path.resolve(import.meta.dirname, "..");
const appDistDir = path.join(rootDir, "apps/app/dist");
const testStage = resolveStage({ mode: "test", cwd: rootDir }).stage;

describe("slopdotcash Alchemy catalog and stage invariants", () => {
  it("loads reviewed configs, enforces stage isolation, and blocks production leakage into staging/dev", () => {
    const reviewed = loadReviewedConfigs(rootDir);
    expect(reviewed.length).toBeGreaterThanOrEqual(20);
    expect(PUBLICATION_ORDER).toContain("IdentityWorker");
    expect(PUBLICATION_ORDER.indexOf("Notify")).toBeLessThan(
      PUBLICATION_ORDER.indexOf("IdentityWorker"),
    );

    const prodTarget = resolveStage({ stage: "production", cwd: rootDir });
    const stagingTarget = resolveStage({ stage: "staging", cwd: rootDir });
    const devTarget = resolveStage({ mode: "dev", cwd: rootDir });

    expect(() => assertSlopStageIsolation(prodTarget, reviewed)).not.toThrow();
    expect(() => assertSlopStageIsolation(stagingTarget, reviewed)).not.toThrow();
    expect(() => assertSlopStageIsolation(devTarget, reviewed)).not.toThrow();

    expect(() =>
      assertSlopStageIsolation(stagingTarget, reviewed, {
        resourceIds: { SLOP_DB: "1b453124-2709-45af-8389-151a8105c461" },
      }),
    ).toThrow(StageGuardError);

    expect(() =>
      assertSlopStageIsolation(devTarget, reviewed, {
        domains: ["slop.cash"],
      }),
    ).toThrow(StageGuardError);
  });

  it("verifies the 164 pinned SQL migrations and Pages routes", () => {
    const ledger = verifyPinnedMigrationLedger(rootDir);
    expect(ledger.pinnedCount).toBe(PINNED_MIGRATION_COUNT);
    expect(ledger.pinnedSha256).toBe(PINNED_MIGRATION_LEDGER_SHA256);
    expect(ledger.count).toBeGreaterThanOrEqual(PINNED_MIGRATION_COUNT);

    const routes = loadPagesRoutes(rootDir);
    expect(routes).toContain("/api/v1/*");
    expect(routes).toContain("/");
  });

  it("isolates remote state prefixes by GitHub environment and stage", () => {
    const prodTarget = resolveStage({ stage: "production", cwd: rootDir });
    const stagingTarget = resolveStage({ stage: "staging", cwd: rootDir });
    expect(resolveSlopStatePrefix(stagingTarget, {})).toBe("alchemy/slop-staging/");
    expect(resolveSlopStatePrefix(prodTarget, {})).toBe("alchemy/slop-production/");
    expect(
      resolveSlopStatePrefix(prodTarget, { SLOP_GITHUB_ENVIRONMENT: "eliza-army-production" }),
    ).toBe("alchemy/eliza-army-production/");
  });
});

const SlopWorkerdStack = Alchemy.Stack(
  "SlopWorkerdDeployTest",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const reviewed = loadReviewedConfigs(rootDir);
    const pagesConfig = findReviewedConfig(reviewed, "app", "pages", "Staging");
    const identityConfig = findReviewedConfig(reviewed, "backend", "identity", "Staging");
    const notifyConfig = findReviewedConfig(reviewed, "operations", "notify", "Staging");
    const backupConfig = findReviewedConfig(reviewed, "operations", "backup", "Staging");
    const repoAccessConfig = findReviewedConfig(reviewed, "slopbot", "slopbot", "Staging");

    const scriptFor = (cfg: typeof identityConfig): string => {
      if (!cfg.file.main) throw new Error(`${cfg.path} missing main`);
      const scriptPath = path.resolve(rootDir, path.dirname(cfg.path), cfg.file.main);
      if (!fs.existsSync(scriptPath)) {
        throw new Error(`Missing built worker ${scriptPath}: run pnpm all build first`);
      }
      return scriptPath;
    };

    const slopDb = yield* Cloudflare.D1.Database("TestSlopDb", {
      name: `slop-${testStage}`,
    });
    const privateTraces = yield* Cloudflare.R2.Bucket("TestPrivateTraces", {
      name: `slop-traces-${testStage}`,
    });
    const vettingEvidence = yield* Cloudflare.R2.Bucket("TestVettingEvidence", {
      name: `slop-evidence-${testStage}`,
    });
    const vettingBackups = yield* Cloudflare.R2.Bucket("TestVettingBackups", {
      name: `slop-backups-${testStage}`,
    });
    const backupQueue = yield* Cloudflare.Queues.Queue("TestBackupQueue", {
      name: `slop-backup-${testStage}`,
    });
    const adminEmail = yield* Cloudflare.Email.SendEmail("ADMIN_EMAIL");

    const backup = yield* Cloudflare.Worker("TestBackup", {
      name: `slop-backup-${testStage}`,
      main: scriptFor(backupConfig),
      bundle: false,
      workersDev: true,
      compatibility: { date: backupConfig.file.compatibility_date ?? "2026-07-30" },
      env: {
        ...(backupConfig.file.vars ?? {}),
        EVIDENCE_DATABASE: slopDb,
        EVIDENCE_SOURCE: vettingEvidence,
        EVIDENCE_BACKUPS: vettingBackups,
        EVIDENCE_BACKUP_QUEUE: backupQueue,
      },
    });

    const repoAccess = yield* Cloudflare.Worker("TestRepoAccess", {
      name: `slop-repo-access-${testStage}`,
      main: scriptFor(repoAccessConfig),
      bundle: false,
      workersDev: true,
      compatibility: { date: repoAccessConfig.file.compatibility_date ?? "2026-07-30" },
      env: {
        ...(repoAccessConfig.file.vars ?? {}),
        SLOPBOT_DB: slopDb,
      },
    });

    const notify = yield* Cloudflare.Worker("TestNotify", {
      name: `slop-notify-${testStage}`,
      main: scriptFor(notifyConfig),
      bundle: false,
      workersDev: true,
      compatibility: { date: notifyConfig.file.compatibility_date ?? "2026-07-30" },
      env: {
        ...(notifyConfig.file.vars ?? {}),
        SLOP_ENVIRONMENT: "local",
        SLOP_DB: slopDb,
        SLOPBOT: repoAccess,
        ADMIN_EMAIL: adminEmail,
      },
    });

    const identity = yield* Cloudflare.Worker("TestIdentity", {
      name: `slop-identity-${testStage}`,
      main: scriptFor(identityConfig),
      bundle: false,
      workersDev: true,
      compatibility: { date: identityConfig.file.compatibility_date ?? "2026-07-30" },
      env: {
        ...(identityConfig.file.vars ?? {}),
        SLOP_ENVIRONMENT: "local",
        IDENTITY_ALLOW_LOOPBACK: "1",
        IDENTITY_PUBLIC_ORIGIN: "http://127.0.0.1:8787",
        GITHUB_APP_CLIENT_ID: "local-test-github-client-id",
        GITHUB_APP_CLIENT_SECRET: "local-test-github-client-secret",
        IDENTITY_STATE_KEY: Buffer.alloc(32, 1).toString("base64url"),
        IDENTITY_ASSERTION_KEY: Buffer.alloc(32, 2).toString("base64url"),
        IDENTITY_DB: slopDb,
        SLOP_NOTIFY: notify,
        IDENTITY_START_LIMITER: Cloudflare.Workers.RateLimit("IDENTITY_START_LIMITER", {
          namespaceId: 81001,
          simple: { limit: 60, period: 60 },
        }),
        IDENTITY_POLL_LIMITER: Cloudflare.Workers.RateLimit("IDENTITY_POLL_LIMITER", {
          namespaceId: 81002,
          simple: { limit: 600, period: 60 },
        }),
      },
    });

    const assets = hashAssetDirectory(appDistDir);
    const runWorkerFirst = loadPagesRoutes(rootDir);
    const site = yield* Cloudflare.Worker("TestSite", {
      name: `slop-site-${testStage}`,
      main: path.join(appDistDir, "_worker.js"),
      bundle: false,
      workersDev: true,
      compatibility: { date: pagesConfig.file.compatibility_date ?? "2026-07-30" },
      assets: {
        directory: assets.directory,
        hash: assets.hash,
        notFoundHandling: "single-page-application",
        runWorkerFirst: [...runWorkerFirst],
      },
      env: {
        ...(pagesConfig.file.vars ?? {}),
        SLOP_ENVIRONMENT: "local",
        SLOP_DB: slopDb,
        PRIVATE_TRACES: privateTraces,
        VETTING_EVIDENCE: vettingEvidence,
        SLOP_IDENTITY: identity,
        SLOPBOT: repoAccess,
        SLOP_NOTIFY: notify,
      },
    });

    return {
      siteUrl: site.url,
      identityUrl: identity.url,
      notifyUrl: notify.url,
      backupUrl: backup.url,
      assetHash: assets.hash,
    };
  }),
);

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
  stage: testStage,
});

const deployed = beforeAll(deploy(SlopWorkerdStack));
afterAll(destroy(SlopWorkerdStack));

test(
  "boots prebuilt Slop site, identity, notify, and backup workers offline in local workerd",
  Effect.gen(function* () {
    const outputs = yield* deployed;
    const siteUrl = outputs?.siteUrl;
    const identityUrl = outputs?.identityUrl;
    expect(siteUrl).toMatch(/^http:\/\/(?:localhost|127\.0\.0\.1):/);
    expect(identityUrl).toMatch(/^http:\/\/(?:localhost|127\.0\.0\.1):/);
    if (!siteUrl || !identityUrl) {
      throw new Error("Missing local workerd URLs from deployed stack");
    }

    const siteReceipt = yield* Effect.promise(() =>
      verifyDeploymentEndpoints(
        siteUrl,
        [
          { path: "/", expectedStatus: 200, bodyIncludes: ["slop.cash"] },
          { path: "/SKILL.md", expectedStatus: 200, bodyIncludes: ["slop"] },
          { path: "/.well-known/agent-skills/index.json", expectedStatus: 200 },
          {
            path: "/api/v1/pool-funding",
            method: "POST",
            expectedStatus: 405,
            expectJson: (parsed) =>
              typeof parsed === "object" &&
              parsed !== null &&
              "error" in parsed &&
              (parsed as { readonly error?: unknown }).error === "method_not_allowed",
          },
        ],
        { assetHash: outputs.assetHash },
      ),
    );
    expect(siteReceipt.ok).toBe(true);
    expect(siteReceipt.probes).toHaveLength(4);

    const identityReceipt = yield* Effect.promise(() =>
      verifyDeploymentEndpoints(
        identityUrl,
        [
          {
            path: "/v1/oauth/authorize",
            expectedStatus: 400,
            expectJson: (parsed) =>
              typeof parsed === "object" &&
              parsed !== null &&
              "error" in parsed &&
              (parsed as { readonly error?: unknown }).error === "https_required",
          },
        ],
        {},
      ),
    );
    expect(identityReceipt.ok).toBe(true);
  }),
);
