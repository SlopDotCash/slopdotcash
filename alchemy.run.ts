import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import {
  hashAssetDirectory,
  resolveStage,
  verifyDeploymentEndpoints,
  type EndpointCheck,
} from "vibestack/alchemy";
import {
  assertSlopStageIsolation,
  findReviewedConfig,
  IDENTITY_DOMAINS,
  isServiceReleaseEnabled,
  loadPagesRoutes,
  loadReviewedConfigs,
  SITE_ORIGINS,
  verifyPinnedMigrationLedger,
  verifyReleaseManifest,
  type ReviewedConfig,
  type SlopEnvironment,
} from "./deploy/catalog.ts";
import { resolveSlopStateLayer } from "./deploy/state.ts";

const rootDir = import.meta.dirname;
const appDistDir = path.join(rootDir, "apps/app/dist");

function resolveWorkerScript(config: ReviewedConfig): string {
  const mainRel = config.file.main;
  if (!mainRel) {
    throw new Error(`${config.path} does not declare a Worker main script`);
  }
  return path.resolve(rootDir, path.dirname(config.path), mainRel);
}

function workerCompatibility(config: ReviewedConfig): {
  readonly date?: string;
  readonly flags?: string[];
} {
  return {
    ...(config.file.compatibility_date ? { date: config.file.compatibility_date } : {}),
    ...(config.file.compatibility_flags && config.file.compatibility_flags.length > 0
      ? { flags: [...config.file.compatibility_flags] }
      : {}),
  };
}

function workerObservability(config: ReviewedConfig): {
  readonly enabled: boolean;
  readonly logs?: { readonly enabled: boolean; readonly invocationLogs: boolean };
} {
  const enabled = config.file.observability?.enabled ?? false;
  if (!enabled) return { enabled: false };
  return {
    enabled: true,
    logs: {
      enabled: true,
      invocationLogs: config.file.observability?.logs?.invocation_logs ?? false,
    },
  };
}

const localIdentityVars: Readonly<Record<string, string>> = {
  SLOP_ENVIRONMENT: "local",
  IDENTITY_ALLOW_LOOPBACK: "1",
  IDENTITY_PUBLIC_ORIGIN: "http://127.0.0.1:8787",
  GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID ?? "local-dev-github-client-id",
  GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET ?? "local-dev-github-client-secret",
  IDENTITY_STATE_KEY:
    process.env.IDENTITY_STATE_KEY ?? Buffer.alloc(32, 1).toString("base64url"),
  IDENTITY_ASSERTION_KEY:
    process.env.IDENTITY_ASSERTION_KEY ?? Buffer.alloc(32, 2).toString("base64url"),
};

function workerVars(
  config: ReviewedConfig,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    ...(config.file.vars ?? {}),
    ...extra,
  };
}

function buildLiveChecks(includeSkillDiscovery: boolean): readonly EndpointCheck[] {
  return [
    { path: "/", expectedStatus: 200 },
    { path: "/SKILL.md", expectedStatus: 200 },
    ...(includeSkillDiscovery
      ? [{ path: "/.well-known/agent-skills/index.json", expectedStatus: 200 } satisfies EndpointCheck]
      : []),
  ];
}

const PublishPagesRelease = Alchemy.Action(
  "PublishPagesRelease",
  (input: {
    readonly stage: string;
    readonly environment: "staging" | "production";
    readonly projectName: string;
    readonly workerNames: readonly string[];
    readonly assetHash: string;
    readonly manifestSha256: string;
    readonly bundleDir: string;
    readonly receiptsDir: string;
    readonly execute: boolean;
  }) =>
    Effect.tryPromise(async () => {
      if (!input.execute) {
        return {
          published: false,
          mode: "planned-only" as const,
          projectName: input.projectName,
          workerCount: input.workerNames.length,
          assetHash: input.assetHash,
          manifestSha256: input.manifestSha256,
        };
      }
      if (!input.bundleDir || !input.receiptsDir) {
        throw new Error(
          "SLOP_ALCHEMY_PAGES_PUBLISH=1 requires SLOP_RELEASE_BUNDLE and SLOP_RELEASE_RECEIPTS to preserve source-bound release invariants",
        );
      }
      const opsMain = path.join(input.bundleDir, "apps/operations/dist/programs/main.js");
      const result = spawnSync(
        process.execPath,
        [opsMain, "release", "publish", input.environment, input.bundleDir, input.receiptsDir, rootDir],
        {
          cwd: rootDir,
          encoding: "utf8",
          env: process.env,
          stdio: "pipe",
        },
      );
      if (result.error) throw result.error;
      if ((result.status ?? 1) !== 0) {
        throw new Error(
          `Source-bound Pages release publish exited ${String(result.status ?? 1)}: ${(result.stderr || result.stdout).slice(-500)}`,
        );
      }
      return {
        published: true,
        mode: "source-bound-release" as const,
        projectName: input.projectName,
        workerCount: input.workerNames.length,
        assetHash: input.assetHash,
        manifestSha256: input.manifestSha256,
      };
    }),
);

const VerifySlopDeployment = Alchemy.Action(
  "VerifySlopDeployment",
  (input: {
    readonly url: string | undefined;
    readonly identityUrl: string | undefined;
    readonly identityWorkerName: string;
    readonly publicationRef: string;
    readonly assetHash: string;
    readonly commitSha: string | undefined;
    readonly localMode: boolean;
  }) =>
    Effect.tryPromise(async () => {
      if (!input.url) throw new Error("Deployed site did not return a URL");
      const siteReceipt = await verifyDeploymentEndpoints(
        input.url,
        buildLiveChecks(!input.localMode),
        {
          assetHash: input.assetHash,
          ...(input.commitSha ? { commitSha: input.commitSha } : {}),
        },
      );
      const identityReceipt = input.identityUrl
        ? await verifyDeploymentEndpoints(
            input.identityUrl,
            [{ path: "/v1/oauth/authorize", expectedStatus: [400, 404] }],
            {},
          )
        : undefined;
      return {
        verified: siteReceipt.ok && (identityReceipt === undefined || identityReceipt.ok),
        identityWorkerName: input.identityWorkerName,
        publicationRef: input.publicationRef,
        siteReceipt,
        ...(identityReceipt ? { identityReceipt } : {}),
      };
    }),
);

interface StackContext {
  readonly stageTarget: ReturnType<typeof resolveStage>;
  readonly reviewed: readonly ReviewedConfig[];
  readonly isProduction: boolean;
  readonly isLocal: boolean;
  readonly tier: SlopEnvironment;
  readonly envName: "production" | "staging";
}

function provisionDataResources(ctx: StackContext) {
  return Effect.gen(function* () {
    const pagesConfig = findReviewedConfig(ctx.reviewed, "app", "pages", ctx.tier);
    const backupConfig = findReviewedConfig(ctx.reviewed, "operations", "backup", ctx.tier);

    const dbName = ctx.isLocal
      ? `slop-${ctx.stageTarget.stage}`
      : (pagesConfig.file.d1_databases?.[0]?.database_name ??
        (ctx.isProduction ? "slop-private" : "slop-staging"));
    const slopDb = yield* Cloudflare.D1.Database("SlopDb", {
      name: dbName,
    }).pipe(Alchemy.AdoptPolicy.adopt(true), Alchemy.RemovalPolicy.retain());

    const tracesBucketName = ctx.isLocal
      ? `slop-traces-${ctx.stageTarget.stage}`
      : (pagesConfig.file.r2_buckets?.find((b) => b.binding === "PRIVATE_TRACES")?.bucket_name ??
        (ctx.isProduction ? "slop-private-traces" : "slop-staging-traces"));
    const evidenceBucketName = ctx.isLocal
      ? `slop-evidence-${ctx.stageTarget.stage}`
      : (pagesConfig.file.r2_buckets?.find((b) => b.binding === "VETTING_EVIDENCE")?.bucket_name ??
        (ctx.isProduction ? "slop-vetting-evidence" : "slop-staging-vetting-evidence"));
    const backupsBucketName = ctx.isLocal
      ? `slop-evidence-backups-${ctx.stageTarget.stage}`
      : (backupConfig.file.r2_buckets?.find((b) => b.binding === "EVIDENCE_BACKUPS")?.bucket_name ??
        (ctx.isProduction
          ? "slop-vetting-evidence-backups"
          : "slop-staging-vetting-evidence-backups"));

    const privateTraces = yield* Cloudflare.R2.Bucket("PrivateTraces", {
      name: tracesBucketName,
    }).pipe(Alchemy.AdoptPolicy.adopt(true), Alchemy.RemovalPolicy.retain());
    const vettingEvidence = yield* Cloudflare.R2.Bucket("VettingEvidence", {
      name: evidenceBucketName,
    }).pipe(Alchemy.AdoptPolicy.adopt(true), Alchemy.RemovalPolicy.retain());
    const vettingEvidenceBackups = yield* Cloudflare.R2.Bucket("VettingEvidenceBackups", {
      name: backupsBucketName,
    }).pipe(Alchemy.AdoptPolicy.adopt(true), Alchemy.RemovalPolicy.retain());

    const backupQueueName = ctx.isLocal
      ? `slop-backup-${ctx.stageTarget.stage}`
      : (backupConfig.file.queues?.producers?.[0]?.queue ??
        (ctx.isProduction ? "slop-vetting-backup" : "slop-staging-vetting-backup"));
    const backupDlqName = ctx.isLocal
      ? `slop-backup-dlq-${ctx.stageTarget.stage}`
      : (backupConfig.file.queues?.consumers?.[0]?.dead_letter_queue ??
        (ctx.isProduction ? "slop-vetting-backup-failed" : "slop-staging-vetting-backup-failed"));

    const backupDlq = yield* Cloudflare.Queues.Queue("VettingBackupDlq", {
      name: backupDlqName,
    }).pipe(Alchemy.AdoptPolicy.adopt(true), Alchemy.RemovalPolicy.retain());
    const backupQueue = yield* Cloudflare.Queues.Queue("VettingBackupQueue", {
      name: backupQueueName,
    }).pipe(Alchemy.AdoptPolicy.adopt(true), Alchemy.RemovalPolicy.retain());
    const adminEmail = yield* Cloudflare.Email.SendEmail("ADMIN_EMAIL");

    return {
      slopDb,
      privateTraces,
      vettingEvidence,
      vettingEvidenceBackups,
      backupDlq,
      backupQueue,
      adminEmail,
    };
  });
}

function provisionCoreWorkers(
  ctx: StackContext,
  data: Effect.Success<ReturnType<typeof provisionDataResources>>,
) {
  return Effect.gen(function* () {
    const identityConfig = findReviewedConfig(ctx.reviewed, "backend", "identity", ctx.tier);
    const notifyConfig = findReviewedConfig(ctx.reviewed, "operations", "notify", ctx.tier);
    const backupConfig = findReviewedConfig(ctx.reviewed, "operations", "backup", ctx.tier);
    const slopbotConfig = findReviewedConfig(ctx.reviewed, "slopbot", "slopbot", ctx.tier);

    const backupWorker = yield* Cloudflare.Worker("VettingBackup", {
      name: ctx.isLocal ? `slop-backup-${ctx.stageTarget.stage}` : backupConfig.file.name,
      main: resolveWorkerScript(backupConfig),
      bundle: false,
      workersDev: ctx.isLocal,
      compatibility: workerCompatibility(backupConfig),
      observability: workerObservability(backupConfig),
      ...(!ctx.isLocal && backupConfig.file.triggers?.crons
        ? { crons: [...backupConfig.file.triggers.crons] }
        : {}),
      env: {
        ...workerVars(backupConfig),
        EVIDENCE_DATABASE: data.slopDb,
        EVIDENCE_SOURCE: data.vettingEvidence,
        EVIDENCE_BACKUPS: data.vettingEvidenceBackups,
        EVIDENCE_BACKUP_QUEUE: data.backupQueue,
      },
    }).pipe(Alchemy.AdoptPolicy.adopt(true));

    const slopbotQueue = ctx.isProduction
      ? yield* Cloudflare.Queues.Queue("SlopbotJobsQueue", {
          name: slopbotConfig.file.queues?.producers?.[0]?.queue ?? "slopbot-jobs",
        }).pipe(Alchemy.AdoptPolicy.adopt(true), Alchemy.RemovalPolicy.retain())
      : undefined;

    if (ctx.isProduction) {
      yield* Cloudflare.Queues.Queue("SlopbotJobsDlq", {
        name: slopbotConfig.file.queues?.consumers?.[0]?.dead_letter_queue ?? "slopbot-jobs-dlq",
      }).pipe(Alchemy.AdoptPolicy.adopt(true), Alchemy.RemovalPolicy.retain());
    }

    const slopbotWorker = yield* Cloudflare.Worker("Slopbot", {
      name: ctx.isLocal ? `slop-slopbot-${ctx.stageTarget.stage}` : slopbotConfig.file.name,
      main: resolveWorkerScript(slopbotConfig),
      bundle: false,
      workersDev: ctx.isLocal,
      compatibility: workerCompatibility(slopbotConfig),
      observability: workerObservability(slopbotConfig),
      ...(slopbotConfig.file.limits?.cpu_ms !== undefined
        ? { limits: { cpuMs: slopbotConfig.file.limits.cpu_ms } }
        : {}),
      ...(!ctx.isLocal && slopbotConfig.file.triggers?.crons
        ? { crons: [...slopbotConfig.file.triggers.crons] }
        : {}),
      env: {
        ...workerVars(slopbotConfig),
        SLOPBOT_DB: data.slopDb,
        ...(slopbotQueue ? { SLOPBOT_QUEUE: slopbotQueue } : {}),
      },
    }).pipe(Alchemy.AdoptPolicy.adopt(true));

    const notifyWorker = yield* Cloudflare.Worker("Notify", {
      name: ctx.isLocal ? `slop-notify-${ctx.stageTarget.stage}` : notifyConfig.file.name,
      main: resolveWorkerScript(notifyConfig),
      bundle: false,
      workersDev: ctx.isLocal,
      compatibility: workerCompatibility(notifyConfig),
      observability: workerObservability(notifyConfig),
      ...(!ctx.isLocal && notifyConfig.file.triggers?.crons
        ? { crons: [...notifyConfig.file.triggers.crons] }
        : {}),
      env: {
        ...workerVars(notifyConfig, ctx.isLocal ? { SLOP_ENVIRONMENT: "local" } : {}),
        SLOP_DB: data.slopDb,
        SLOPBOT: slopbotWorker,
        ADMIN_EMAIL: data.adminEmail,
      },
    }).pipe(Alchemy.AdoptPolicy.adopt(true));

    const startLimiter = identityConfig.file.ratelimits?.find(
      (r) => r.name === "IDENTITY_START_LIMITER",
    );
    const pollLimiter = identityConfig.file.ratelimits?.find(
      (r) => r.name === "IDENTITY_POLL_LIMITER",
    );

    const identityWorker = yield* Cloudflare.Worker("Identity", {
      name: ctx.isLocal ? `slop-identity-${ctx.stageTarget.stage}` : identityConfig.file.name,
      main: resolveWorkerScript(identityConfig),
      bundle: false,
      workersDev: ctx.isLocal,
      ...(!ctx.isLocal ? { domain: IDENTITY_DOMAINS[ctx.tier] } : {}),
      compatibility: workerCompatibility(identityConfig),
      observability: workerObservability(identityConfig),
      ...(!ctx.isLocal && identityConfig.file.triggers?.crons
        ? { crons: [...identityConfig.file.triggers.crons] }
        : {}),
      env: {
        ...workerVars(identityConfig, ctx.isLocal ? localIdentityVars : {}),
        IDENTITY_DB: data.slopDb,
        SLOP_NOTIFY: notifyWorker,
        IDENTITY_START_LIMITER: Cloudflare.Workers.RateLimit("IDENTITY_START_LIMITER", {
          namespaceId: Number(startLimiter?.namespace_id ?? "81001"),
          simple: {
            limit: startLimiter?.simple.limit ?? 60,
            period: startLimiter?.simple.period ?? 60,
          },
        }),
        IDENTITY_POLL_LIMITER: Cloudflare.Workers.RateLimit("IDENTITY_POLL_LIMITER", {
          namespaceId: Number(pollLimiter?.namespace_id ?? "81002"),
          simple: {
            limit: pollLimiter?.simple.limit ?? 600,
            period: pollLimiter?.simple.period ?? 60,
          },
        }),
      },
    }).pipe(Alchemy.AdoptPolicy.adopt(true));

    return { backupWorker, slopbotWorker, notifyWorker, identityWorker };
  });
}

function provisionScheduledWorkers(
  ctx: StackContext,
  slopDb: Effect.Success<ReturnType<typeof provisionDataResources>>["slopDb"],
) {
  return Effect.gen(function* () {
    const deployedNames: Array<typeof referralConfig.file.name | Alchemy.Input<string>> = [];
    if (ctx.isLocal) return deployedNames;

    const feeConverterConfig = findReviewedConfig(ctx.reviewed, "fees", "feeConverter", ctx.tier);
    const referralConfig = findReviewedConfig(ctx.reviewed, "settlement", "referralAccrual", ctx.tier);
    const paymentsConfig = findReviewedConfig(ctx.reviewed, "settlement", "payments", ctx.tier);

    if (isServiceReleaseEnabled("FeeConverter", ctx.tier)) {
      const feeConverter = yield* Cloudflare.Worker("FeeConverter", {
        name: feeConverterConfig.file.name,
        main: resolveWorkerScript(feeConverterConfig),
        bundle: false,
        workersDev: false,
        compatibility: workerCompatibility(feeConverterConfig),
        observability: workerObservability(feeConverterConfig),
        ...(feeConverterConfig.file.triggers?.crons
          ? { crons: [...feeConverterConfig.file.triggers.crons] }
          : {}),
        env: { ...workerVars(feeConverterConfig), FEE_DB: slopDb },
      }).pipe(Alchemy.AdoptPolicy.adopt(true));
      deployedNames.push(feeConverter.workerName);
    }

    if (ctx.isProduction) {
      const submissionFeeConfig = findReviewedConfig(
        ctx.reviewed,
        "fees",
        "submissionFee",
        "Production",
      );
      const submissionFee = yield* Cloudflare.Worker("SubmissionFee", {
        name: submissionFeeConfig.file.name,
        main: resolveWorkerScript(submissionFeeConfig),
        bundle: false,
        workersDev: false,
        compatibility: workerCompatibility(submissionFeeConfig),
        observability: workerObservability(submissionFeeConfig),
        ...(submissionFeeConfig.file.triggers?.crons
          ? { crons: [...submissionFeeConfig.file.triggers.crons] }
          : {}),
        env: { ...workerVars(submissionFeeConfig), SUBMISSION_FEE_DB: slopDb },
      }).pipe(Alchemy.AdoptPolicy.adopt(true));
      deployedNames.push(submissionFee.workerName);
    }

    const referralAccrual = yield* Cloudflare.Worker("ReferralAccrual", {
      name: referralConfig.file.name,
      main: resolveWorkerScript(referralConfig),
      bundle: false,
      workersDev: false,
      compatibility: workerCompatibility(referralConfig),
      observability: workerObservability(referralConfig),
      ...(referralConfig.file.triggers?.crons ? { crons: [...referralConfig.file.triggers.crons] } : {}),
      env: { ...workerVars(referralConfig), REFERRAL_DB: slopDb },
    }).pipe(Alchemy.AdoptPolicy.adopt(true));
    deployedNames.push(referralAccrual.workerName);

    const paymentsDispatcher = yield* Cloudflare.Worker("PaymentsDispatcher", {
      name: paymentsConfig.file.name,
      main: resolveWorkerScript(paymentsConfig),
      bundle: false,
      workersDev: false,
      compatibility: workerCompatibility(paymentsConfig),
      observability: workerObservability(paymentsConfig),
      ...(paymentsConfig.file.triggers?.crons ? { crons: [...paymentsConfig.file.triggers.crons] } : {}),
      env: { ...workerVars(paymentsConfig), PAYMENTS_DB: slopDb },
    }).pipe(Alchemy.AdoptPolicy.adopt(true));
    deployedNames.push(paymentsDispatcher.workerName);

    return deployedNames;
  });
}

export default Alchemy.Stack(
  "SlopDotCash",
  {
    providers: Cloudflare.providers(),
    state: resolveSlopStateLayer(rootDir),
  },
  Effect.gen(function* () {
    const stageName = yield* Alchemy.Stage;
    const stageTarget = resolveStage({ stage: stageName, cwd: rootDir });
    const reviewed = loadReviewedConfigs(rootDir);
    const isProduction = stageTarget.kind === "production";
    const isLocal = stageTarget.kind === "dev" || stageTarget.kind === "test";
    const tier: SlopEnvironment = isProduction ? "Production" : "Staging";
    const envName: "production" | "staging" = isProduction ? "production" : "staging";
    const ctx: StackContext = { stageTarget, reviewed, isProduction, isLocal, tier, envName };

    assertSlopStageIsolation(stageTarget, reviewed);
    const migrationLedger = verifyPinnedMigrationLedger(rootDir);

    const data = yield* provisionDataResources(ctx);
    const core = yield* provisionCoreWorkers(ctx, data);
    const scheduledWorkerNames = yield* provisionScheduledWorkers(ctx, data.slopDb);

    const pagesConfig = findReviewedConfig(reviewed, "app", "pages", tier);
    const bundleDir = process.env.SLOP_RELEASE_BUNDLE?.trim() ?? "";
    const receiptsDir = process.env.SLOP_RELEASE_RECEIPTS?.trim() ?? "";
    const siteAssetsDir = bundleDir ? path.join(bundleDir, "site") : appDistDir;
    const assets = fs.existsSync(path.join(siteAssetsDir, "index.html"))
      ? hashAssetDirectory(siteAssetsDir)
      : { directory: siteAssetsDir, path: siteAssetsDir, hash: "unbuilt", fileCount: 0, totalBytes: 0 };

    if (isLocal) {
      const runWorkerFirst = loadPagesRoutes(rootDir);
      const localSite = yield* Cloudflare.Worker("Site", {
        name: `slop-site-${stageTarget.stage}`,
        main: path.join(appDistDir, "_worker.js"),
        bundle: false,
        workersDev: true,
        compatibility: workerCompatibility(pagesConfig),
        assets: {
          directory: assets.directory,
          hash: assets.hash,
          notFoundHandling: "single-page-application",
          runWorkerFirst: [...runWorkerFirst],
        },
        env: {
          ...workerVars(pagesConfig, { SLOP_ENVIRONMENT: "local" }),
          SLOP_DB: data.slopDb,
          PRIVATE_TRACES: data.privateTraces,
          VETTING_EVIDENCE: data.vettingEvidence,
          SLOP_IDENTITY: core.identityWorker,
          SLOPBOT: core.slopbotWorker,
          SLOP_NOTIFY: core.notifyWorker,
        },
      }).pipe(Alchemy.AdoptPolicy.adopt(true));

      const verification = yield* VerifySlopDeployment({
        url: localSite.url,
        identityUrl: core.identityWorker.url,
        identityWorkerName: core.identityWorker.workerName,
        publicationRef: localSite.workerName,
        assetHash: assets.hash,
        commitSha: undefined,
        localMode: true,
      });

      return {
        stage: stageTarget.stage,
        environment: envName,
        url: localSite.url,
        identityUrl: core.identityWorker.url,
        workers: {
          backup: core.backupWorker.workerName,
          slopbot: core.slopbotWorker.workerName,
          notify: core.notifyWorker.workerName,
          identity: core.identityWorker.workerName,
        },
        queues: {
          backup: data.backupQueue.queueName,
          backupDlq: data.backupDlq.queueName,
        },
        migrations: migrationLedger.count,
        assetHash: assets.hash,
        verification,
      };
    }

    const manifest = bundleDir
      ? verifyReleaseManifest(bundleDir, process.env.SLOP_RELEASE_MANIFEST_SHA256)
      : undefined;

    const pagesProject = yield* Cloudflare.Pages.Project("SlopPages", {
      name: pagesConfig.file.name,
      productionBranch: isProduction ? "main" : "develop",
    }).pipe(Alchemy.AdoptPolicy.adopt(true), Alchemy.RemovalPolicy.retain());

    const pagesPublication = yield* PublishPagesRelease({
      stage: stageTarget.stage,
      environment: envName,
      projectName: pagesProject.name,
      workerNames: [
        core.backupWorker.workerName,
        core.slopbotWorker.workerName,
        core.notifyWorker.workerName,
        core.identityWorker.workerName,
        ...scheduledWorkerNames,
      ],
      assetHash: assets.hash,
      manifestSha256: manifest?.sha256 ?? assets.hash,
      bundleDir,
      receiptsDir,
      execute: process.env.SLOP_ALCHEMY_PAGES_PUBLISH === "1",
    });

    const siteUrl = SITE_ORIGINS[tier];
    const verification = yield* VerifySlopDeployment({
      url: siteUrl,
      identityUrl: `https://${IDENTITY_DOMAINS[tier]}`,
      identityWorkerName: core.identityWorker.workerName,
      publicationRef: pagesPublication.mode,
      assetHash: assets.hash,
      commitSha: manifest?.sourceSha,
      localMode: false,
    });

    return {
      stage: stageTarget.stage,
      environment: envName,
      url: siteUrl,
      identityUrl: `https://${IDENTITY_DOMAINS[tier]}`,
      pagesProject: pagesProject.name,
      pagesPublication,
      migrations: migrationLedger.count,
      assetHash: assets.hash,
      verification,
    };
  }),
);
