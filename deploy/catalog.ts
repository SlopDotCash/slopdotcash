import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertStageGuard, type StageTarget } from "vibestack/alchemy";

export type SlopEnvironment = "Production" | "Staging";

export type SlopService =
  | "PaymentAttesters"
  | "FeeConverter"
  | "VettingSandbox"
  | "Notify"
  | "Slopbot"
  | "RepositoryAccess"
  | "IdentityWorker"
  | "VettingBackup"
  | "VettingRetention"
  | "Referral"
  | "SubmissionFee";

export const PUBLICATION_ORDER: readonly SlopService[] = [
  "PaymentAttesters",
  "FeeConverter",
  "VettingSandbox",
  "Notify",
  "Slopbot",
  "RepositoryAccess",
  "IdentityWorker",
  "VettingBackup",
  "VettingRetention",
  "Referral",
  "SubmissionFee",
];

export const SITE_ORIGINS: Readonly<Record<SlopEnvironment, string>> = {
  Production: "https://slop.cash",
  Staging: "https://staging.slop.cash",
};

export const IDENTITY_DOMAINS: Readonly<Record<SlopEnvironment, string>> = {
  Production: "identity.slop.cash",
  Staging: "identity-staging.slop.cash",
};

export const PRODUCTION_DOMAINS: readonly string[] = [
  "slop.cash",
  "api.slop.cash",
  "identity.slop.cash",
];

export const PINNED_MIGRATION_COUNT = 164;
export const PINNED_MIGRATION_LEDGER_SHA256 =
  "41bc60076356a4b31cf6bed63514f0d3273940e7a3306a272837adc9f923a87f";

const MAINNET_MARKERS = [
  "base-mainnet",
  "ethereum-mainnet",
  "robinhood-mainnet",
  "solana-mainnet",
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
] as const;

const MAINNET_CHAIN_IDS = new Set(["1", "8453", "4663"]);
const APPENDED_MIGRATION_PATTERN = /^(?:0[2-9][0-9]{2}|[1-9][0-9]{3})_[a-z0-9_]+\.sql$/u;
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_MIGRATION_BYTES = 4 * 1024 * 1024;

export interface ReviewedD1Binding {
  readonly binding: string;
  readonly database_name: string;
  readonly database_id: string;
  readonly migrations_dir?: string;
}

export interface ReviewedBucketBinding {
  readonly binding: string;
  readonly bucket_name: string;
}

export interface ReviewedQueueProducer {
  readonly binding: string;
  readonly queue: string;
}

export interface ReviewedQueueConsumer {
  readonly queue: string;
  readonly max_batch_size?: number;
  readonly max_retries?: number;
  readonly dead_letter_queue?: string;
}

export interface ReviewedServiceBinding {
  readonly binding: string;
  readonly service: string;
  readonly entrypoint?: string;
  readonly environment?: string;
}

export interface ReviewedRateLimit {
  readonly name: string;
  readonly namespace_id: string;
  readonly simple: {
    readonly limit: number;
    readonly period: 10 | 60;
  };
}

export interface ReviewedEmailBinding {
  readonly name: string;
  readonly destination_address?: string;
  readonly allowed_destination_addresses?: readonly string[];
}

export interface ReviewedRoute {
  readonly pattern: string;
  readonly custom_domain?: boolean;
}

export interface ReviewedContainer {
  readonly class_name: string;
  readonly image: string;
  readonly max_instances?: number;
  readonly instance_type?: string;
}

export interface ReviewedWorkerFile {
  readonly name: string;
  readonly main?: string;
  readonly no_bundle?: boolean;
  readonly compatibility_date?: string;
  readonly compatibility_flags?: readonly string[];
  readonly pages_build_output_dir?: string;
  readonly workers_dev?: boolean;
  readonly preview_urls?: boolean;
  readonly limits?: { readonly cpu_ms?: number };
  readonly routes?: readonly ReviewedRoute[];
  readonly triggers?: { readonly crons?: readonly string[] };
  readonly d1_databases?: readonly ReviewedD1Binding[];
  readonly r2_buckets?: readonly ReviewedBucketBinding[];
  readonly queues?: {
    readonly producers?: readonly ReviewedQueueProducer[];
    readonly consumers?: readonly ReviewedQueueConsumer[];
  };
  readonly services?: readonly ReviewedServiceBinding[];
  readonly durable_objects?: {
    readonly bindings?: readonly {
      readonly name: string;
      readonly class_name: string;
      readonly script_name?: string;
    }[];
  };
  readonly containers?: readonly ReviewedContainer[];
  readonly ratelimits?: readonly ReviewedRateLimit[];
  readonly send_email?: readonly ReviewedEmailBinding[];
  readonly vars?: Readonly<Record<string, string>>;
  readonly expectedSecrets?: readonly string[];
  readonly optionalSecrets?: readonly string[];
  readonly observability?: {
    readonly enabled?: boolean;
    readonly logs?: { readonly invocation_logs?: boolean };
  };
}

export interface ReviewedConfig {
  readonly path: string;
  readonly app: string;
  readonly worker: string;
  readonly template: boolean;
  readonly environment: SlopEnvironment | undefined;
  readonly file: ReviewedWorkerFile;
}

export interface MigrationLedgerResult {
  readonly count: number;
  readonly pinnedCount: number;
  readonly appended: readonly string[];
  readonly pinnedSha256: string;
}

export interface ReleaseManifestVerification {
  readonly manifestPath: string;
  readonly sha256: string;
  readonly environment?: string;
  readonly sourceSha?: string;
}

function byteOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function stripJsonComments(text: string): string {
  let out = "";
  let index = 0;
  let quoted = false;
  while (index < text.length) {
    const ch = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (quoted) {
      out += ch === "\\" ? ch + next : ch;
      if (ch === "\"") quoted = false;
      index += ch === "\\" ? 2 : 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    if (ch === "\"") quoted = true;
    out += ch;
    index += 1;
  }
  return out;
}

function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTier(value: string | undefined): SlopEnvironment | undefined {
  if (value === "production") return "Production";
  if (value === "staging") return "Staging";
  return undefined;
}

export function isPagesConfig(entry: ReviewedConfig): boolean {
  return entry.file.pages_build_output_dir !== undefined;
}

export function loadReviewedConfigs(rootDir: string): readonly ReviewedConfig[] {
  const appsDir = path.join(rootDir, "apps");
  const appNames = fs.readdirSync(appsDir).sort(byteOrder);
  const configs: ReviewedConfig[] = [];

  for (const app of appNames) {
    const wranglerDir = path.join(appsDir, app, "wrangler");
    if (!fs.existsSync(wranglerDir) || !fs.statSync(wranglerDir).isDirectory()) continue;
    for (const fileName of fs.readdirSync(wranglerDir).sort(byteOrder)) {
      if (!fileName.endsWith(".jsonc")) continue;
      const relPath = `apps/${app}/wrangler/${fileName}`;
      const absPath = path.join(rootDir, relPath);
      const bytes = fs.readFileSync(absPath);
      if (bytes.byteLength > MAX_CONFIG_BYTES) {
        throw new Error(`${relPath} exceeds maximum config size (${String(MAX_CONFIG_BYTES)} bytes)`);
      }
      const parsed: unknown = JSON.parse(stripJsonComments(bytes.toString("utf8")));
      if (!isRecord(parsed) || typeof parsed.name !== "string" || parsed.name.length === 0) {
        throw new Error(`${relPath} is missing a valid worker name`);
      }
      const file = parsed as unknown as ReviewedWorkerFile;
      const parts = fileName.slice(0, -".jsonc".length).split(".");
      const worker = parts[0] ?? "";
      const suffix = parts.length > 1 ? (parts.at(-1) ?? "") : "";
      const named = parseTier(suffix);
      const declared = file.vars?.SLOP_ENVIRONMENT;
      const stated = parseTier(declared);
      if (declared !== undefined && stated === undefined) {
        throw new Error(`${relPath} declares unknown SLOP_ENVIRONMENT "${declared}"`);
      }
      if (named !== undefined && stated !== undefined && named !== stated) {
        throw new Error(`${relPath} is named for ${suffix} but declares SLOP_ENVIRONMENT "${declared ?? ""}"`);
      }
      configs.push({
        path: relPath,
        app,
        worker,
        template: suffix === "template",
        environment: named ?? stated,
        file,
      });
    }
  }

  if (configs.length === 0) {
    throw new Error("No reviewed Worker configurations found under apps/*/wrangler");
  }
  return configs;
}

function resourceKeys(file: ReviewedWorkerFile): readonly string[] {
  return [
    `worker:${file.name}`,
    ...(file.d1_databases ?? []).flatMap((db) => [`d1:${db.database_id}`, `d1:${db.database_name}`]),
    ...(file.r2_buckets ?? []).map((bucket) => `r2:${bucket.bucket_name}`),
    ...(file.queues?.producers ?? []).map((producer) => `queue:${producer.queue}`),
    ...(file.queues?.consumers ?? []).flatMap((consumer) => [
      `queue:${consumer.queue}`,
      ...(consumer.dead_letter_queue ? [`queue:${consumer.dead_letter_queue}`] : []),
    ]),
    ...(file.services ?? []).map((service) => `worker:${service.service}`),
    ...(file.durable_objects?.bindings ?? []).flatMap((binding) =>
      binding.script_name ? [`worker:${binding.script_name}`] : [],
    ),
    ...(file.routes ?? []).map((route) => `route:${route.pattern}`),
  ];
}

function stagingViolation(entry: ReviewedConfig): string | undefined {
  const vars = entry.file.vars ?? {};
  const isConverter = entry.app === "fees" || vars.FEE_CONVERTER_MODE !== undefined;
  if (isConverter && vars.FEE_CONVERTER_MODE !== "dry_run") {
    return `${entry.path} runs staging fee converter outside dry_run`;
  }
  if ((isConverter || vars.BUYBACK_MODE !== undefined) && vars.BUYBACK_MODE !== "off") {
    return `${entry.path} enables buyback in staging`;
  }
  const texts = [entry.file.name, ...Object.keys(vars), ...Object.values(vars)];
  const mainnetMarker = MAINNET_MARKERS.find((marker) => texts.some((text) => text.includes(marker)));
  if (mainnetMarker) return `${entry.path} references mainnet marker "${mainnetMarker}"`;
  const mainnetChain = Object.entries(vars).find(
    ([key, value]) => key.endsWith("_CHAIN_ID") && MAINNET_CHAIN_IDS.has(value.trim()),
  );
  return mainnetChain ? `${entry.path} references mainnet chain ${mainnetChain[1]}` : undefined;
}

export function findConfigIsolationIssue(reviewed: readonly ReviewedConfig[]): string | undefined {
  const deployable = reviewed.filter((entry) => !entry.template);
  const homeless = deployable.find((entry) => entry.environment === undefined);
  if (homeless) return `${homeless.path} declares no environment`;

  const productionOwners = new Map<string, ReviewedConfig>();
  for (const entry of deployable.filter((item) => item.environment === "Production")) {
    for (const key of resourceKeys(entry.file)) productionOwners.set(key, entry);
  }
  for (const entry of deployable.filter((item) => item.environment === "Staging")) {
    for (const key of resourceKeys(entry.file)) {
      const owner = productionOwners.get(key);
      if (owner) {
        return `${entry.path} and ${owner.path} share ${key}: staging and production must never share a resource`;
      }
    }
    const issue = stagingViolation(entry);
    if (issue) return issue;
  }

  for (const environment of ["Production", "Staging"] as const) {
    const dbIds = new Set(
      deployable
        .filter((entry) => entry.environment === environment)
        .flatMap((entry) => (entry.file.d1_databases ?? []).map((db) => db.database_id)),
    );
    if (dbIds.size > 1) return `${environment} configs bind more than one D1 database`;
  }

  const exposed = deployable.find(
    (entry) => !isPagesConfig(entry) && (entry.file.workers_dev !== false || entry.file.preview_urls !== false),
  );
  return exposed ? `${exposed.path} must disable workers_dev and preview_urls` : undefined;
}

export function selectTierConfigs(
  reviewed: readonly ReviewedConfig[],
  tier: SlopEnvironment,
): readonly ReviewedConfig[] {
  return reviewed.filter((entry) => !entry.template && entry.environment === tier);
}

export function findReviewedConfig(
  reviewed: readonly ReviewedConfig[],
  app: string,
  worker: string,
  tier: SlopEnvironment,
): ReviewedConfig {
  const matches = reviewed.filter(
    (entry) => !entry.template && entry.app === app && entry.worker === worker && entry.environment === tier,
  );
  const [match] = matches;
  if (!match || matches.length !== 1) {
    throw new Error(`Expected exactly one reviewed ${tier} config for apps/${app}/wrangler/${worker}.*.jsonc`);
  }
  return match;
}

export function assertSlopStageIsolation(
  stageTarget: StageTarget,
  reviewed: readonly ReviewedConfig[],
  options: {
    readonly allowProduction?: boolean;
    readonly resourceIds?: Readonly<Record<string, string | undefined>>;
    readonly domains?: readonly string[];
  } = {},
): void {
  const isolationIssue = findConfigIsolationIssue(reviewed);
  if (isolationIssue) {
    throw new Error(`Reviewed config isolation check failed: ${isolationIssue}`);
  }

  const prodConfigs = selectTierConfigs(reviewed, "Production");
  const productionIds = [
    ...new Set(
      prodConfigs.flatMap((entry) => [
        ...(entry.file.d1_databases ?? []).flatMap((db) => [db.database_id, db.database_name]),
        ...(entry.file.r2_buckets ?? []).map((bucket) => bucket.bucket_name),
        ...(entry.file.queues?.producers ?? []).map((q) => q.queue),
        ...(entry.file.queues?.consumers ?? []).flatMap((q) => [
          q.queue,
          ...(q.dead_letter_queue ? [q.dead_letter_queue] : []),
        ]),
      ]),
    ),
  ];

  const productionDomains = [
    ...new Set([
      ...PRODUCTION_DOMAINS,
      ...prodConfigs.flatMap((entry) => (entry.file.routes ?? []).map((route) => route.pattern)),
    ]),
  ];

  const targetTier: SlopEnvironment = stageTarget.kind === "production" ? "Production" : "Staging";
  const targetConfigs = selectTierConfigs(reviewed, targetTier);

  const defaultResourceIds: Record<string, string | undefined> =
    stageTarget.kind === "dev" || stageTarget.kind === "test"
      ? {}
      : Object.fromEntries(
          targetConfigs.flatMap((entry) => [
            ...(entry.file.d1_databases ?? []).map((db) => [`${entry.file.name}.${db.binding}`, db.database_id]),
            ...(entry.file.r2_buckets ?? []).map((bucket) => [`${entry.file.name}.${bucket.binding}`, bucket.bucket_name]),
          ]),
        );

  const defaultDomains =
    stageTarget.kind === "dev" || stageTarget.kind === "test"
      ? []
      : [
          SITE_ORIGINS[targetTier],
          ...targetConfigs.flatMap((entry) => (entry.file.routes ?? []).map((route) => route.pattern)),
        ];

  assertStageGuard(stageTarget, {
    resourceIds: options.resourceIds ?? defaultResourceIds,
    domains: options.domains ?? defaultDomains,
    productionIds,
    productionDomains,
    allowProduction: options.allowProduction,
  });
}

export function verifyPinnedMigrationLedger(rootDir: string): MigrationLedgerResult {
  const migrationsDir = path.join(rootDir, "migrations");
  const names = fs.readdirSync(migrationsDir).sort(byteOrder);
  if (names.length < PINNED_MIGRATION_COUNT) {
    throw new Error(
      `Migration ledger has ${String(names.length)} files; expected at least ${String(PINNED_MIGRATION_COUNT)}`,
    );
  }
  const lines: string[] = [];
  const appended: string[] = [];
  for (const [index, name] of names.entries()) {
    const filePath = path.join(migrationsDir, name);
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_MIGRATION_BYTES) {
      throw new Error(`migrations/${name} is not a bounded regular file`);
    }
    if (index >= PINNED_MIGRATION_COUNT) {
      if (!APPENDED_MIGRATION_PATTERN.test(name)) {
        throw new Error(`migrations/${name} is not a valid 0200_* appended migration`);
      }
      appended.push(name);
      continue;
    }
    const digest = sha256Hex(fs.readFileSync(filePath));
    lines.push(`${name}\t${digest}`);
  }
  const pinnedSha256 = sha256Hex(`${lines.join("\n")}\n`);
  if (pinnedSha256 !== PINNED_MIGRATION_LEDGER_SHA256) {
    throw new Error(
      `Pinned migration ledger SHA-256 mismatch: expected ${PINNED_MIGRATION_LEDGER_SHA256}, got ${pinnedSha256}`,
    );
  }
  return {
    count: names.length,
    pinnedCount: PINNED_MIGRATION_COUNT,
    appended,
    pinnedSha256,
  };
}

export function loadPagesRoutes(rootDir: string): readonly string[] {
  const routesPath = path.join(rootDir, "apps/app/public/_routes.json");
  const parsed: unknown = JSON.parse(fs.readFileSync(routesPath, "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.include)) {
    throw new Error("apps/app/public/_routes.json must define an include array");
  }
  const include = parsed.include.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  if (include.length === 0) {
    throw new Error("apps/app/public/_routes.json include array is empty");
  }
  return include;
}

export function verifyReleaseManifest(
  bundleDir: string,
  expectedSha256?: string,
): ReleaseManifestVerification {
  const manifestPath = path.join(path.resolve(bundleDir), "release-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Release manifest not found at ${manifestPath}`);
  }
  const raw = fs.readFileSync(manifestPath);
  const sha256 = sha256Hex(raw);
  if (expectedSha256 && expectedSha256.trim().toLowerCase() !== sha256) {
    throw new Error(`Release manifest SHA-256 mismatch: expected ${expectedSha256}, got ${sha256}`);
  }
  const parsed: unknown = JSON.parse(raw.toString("utf8"));
  const environment = isRecord(parsed) && typeof parsed.environment === "string" ? parsed.environment : undefined;
  const sourceSha = isRecord(parsed) && typeof parsed.sourceSha === "string" ? parsed.sourceSha : undefined;
  return {
    manifestPath,
    sha256,
    ...(environment ? { environment } : {}),
    ...(sourceSha ? { sourceSha } : {}),
  };
}

export function isServiceReleaseEnabled(
  service: SlopService,
  tier: SlopEnvironment,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  switch (service) {
    case "Slopbot":
      return tier === "Production" && env.SLOPBOT_RELEASE === "enabled";
    case "RepositoryAccess":
      return tier === "Staging";
    case "Notify":
      return tier === "Production"
        ? env.SLOP_NOTIFY_RELEASE === "enabled"
        : env.SLOP_NOTIFY_STAGING_RELEASE === "enabled" || env.SLOP_NOTIFY_RELEASE === "enabled";
    case "FeeConverter":
      return tier === "Production" ? env.SLOP_FEE_CONVERTER_RELEASE === "enabled" : true;
    case "VettingBackup":
      return tier === "Production"
        ? env.SLOP_VETTING_BACKUP_RELEASE === "enabled"
        : env.SLOP_VETTING_BACKUP_STAGING_RELEASE === "enabled" || env.SLOP_VETTING_BACKUP_RELEASE === "enabled";
    case "VettingRetention":
      return tier === "Production"
        ? env.SLOP_VETTING_RETENTION_RELEASE === "enabled"
        : env.SLOP_VETTING_RETENTION_STAGING_RELEASE === "enabled" || env.SLOP_VETTING_RETENTION_RELEASE === "enabled";
    case "SubmissionFee":
    case "Referral":
      return tier === "Production";
    case "PaymentAttesters":
    case "VettingSandbox":
    case "IdentityWorker":
      return true;
    default: {
      const _exhaustive: never = service;
      throw new Error(`Unsupported service: ${String(_exhaustive)}`);
    }
  }
}

export function resolveSlopStatePrefix(
  stageTarget: StageTarget,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const explicitPrefix = env.R2_STATE_PREFIX?.trim();
  if (explicitPrefix) {
    return explicitPrefix.endsWith("/") ? explicitPrefix : `${explicitPrefix}/`;
  }
  const ghEnv = env.SLOP_GITHUB_ENVIRONMENT?.trim();
  if (ghEnv && /^[a-z0-9-]+$/u.test(ghEnv)) {
    return `alchemy/${ghEnv}/`;
  }
  switch (stageTarget.kind) {
    case "production":
      return "alchemy/slop-production/";
    case "staging":
      return "alchemy/slop-staging/";
    case "preview":
    case "dev":
    case "test":
      return `alchemy/${stageTarget.stage}/`;
    default: {
      const _exhaustive: never = stageTarget;
      throw new Error(`Unsupported stage target: ${String(_exhaustive)}`);
    }
  }
}
