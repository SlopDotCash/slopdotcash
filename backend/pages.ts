/**
 * The Cloudflare Pages bindings of the site and API entry points, and the
 * vetting objects both build for one request.
 */
import type { DeploymentTier } from "../src/lib/deployment";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import type { ProjectD1Database } from "./projects/cloudflare-persistence";
import { githubApiOrigin } from "./projects/github-lookup";
import { slopbotGithubFetch } from "./projects/repository-access";
import { assetTemplateSource } from "./projects/skill-publication";
import type { HistoricalValueBinding } from "./slopbot/value-import";
import type { R2Bucket } from "./trace/cloudflare-persistence";
import { type EvidenceDependencies, VettingEvidence } from "./vetting/evidence";
import { readVettingPin, vettingBranchCache } from "./vetting/live-pin";
import { CloudflareVettingPersistence } from "./vetting/persistence";

export type PagesEnv = {
  SLOP_ENVIRONMENT?: DeploymentTier;
  SLOP_DB: ProjectD1Database;
  PAYMENTS_ALLOWED_ORIGIN?: string;
  /**
   * JSON array of the registry networks whose escrow vaults accept wallet
   * bindings here, as the payments Worker reads it. Unset or invalid keeps
   * every binding closed.
   */
  PAYMENT_NETWORKS?: string;
  /** Owner-decided automatic monthly cutoff; unset keeps the automatic process off. */
  MONTHLY_PAYMENT_SCHEDULE?: string;
  SOLANA_IDENTITY_ATTESTER?: { fetch(request: Request): Promise<Response> };
  SECURITY_SOLANA_IDENTITY_ATTESTER?: {
    fetch(request: Request): Promise<Response>;
  };
  /** Named recovery-only entrypoint; it cannot submit a binding or payment. */
  BINDING_RECOVERY?: { fetch(request: Request): Promise<Response> };
  BINDING_RECOVERY_ETHEREUM?: { fetch(request: Request): Promise<Response> };
  BINDING_RECOVERY_ROBINHOOD?: { fetch(request: Request): Promise<Response> };
  MONTHLY_RELEASE_BASE?: { fetch(request: Request): Promise<Response> };
  MONTHLY_RELEASE_ETHEREUM?: { fetch(request: Request): Promise<Response> };
  MONTHLY_RELEASE_ROBINHOOD?: { fetch(request: Request): Promise<Response> };
  MONTHLY_RELEASE_SOLANA?: { fetch(request: Request): Promise<Response> };
  /** Private RPC endpoints for explicit wallet funding review/check requests. Never returned to the browser. */
  PAYMENT_RPC_URLS?: string;
  SOLANA_RECOVERY_RPC_URL?: string;
  /** Disposable local validators only; refused on non-loopback requests/RPCs. */
  SLOP_LOCAL_SOLANA_GENESIS?: string;
  PRIVATE_TRACES: R2Bucket;
  TRACE_AUTH_SECRET: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  OPERATOR_GITHUB_IDS?: string;
  /** GitHub numeric actor IDs allowed to handle project exceptions. */
  ADMIN_GITHUB_IDS?: string;
  /**
   * GitHub numeric actor IDs with the project moderation role: Quarantine,
   * Ban and reinstatement (PRD ADM-06). Unset keeps those actions closed.
   */
  PROJECT_MODERATOR_GITHUB_IDS?: string;
  SLOP_IDENTITY: { fetch(request: Request): Promise<Response> };
  /** Local browser tests only: a loopback GitHub API fixture origin. */
  SLOP_GITHUB_API_ORIGIN?: string;
  /** Optional read-only GitHub token for repository ownership checks. */
  SLOP_GITHUB_READ_TOKEN?: string;
  /**
   * Durable private security intake (PRD section 8). Off unless exactly "on".
   * The existing private bucket accepts Slop reports without GitHub OAuth.
   * Optional GitHub forwarding additionally needs every App secret below;
   * missing configuration never enables a public fallback. Owner decision D10:
   * these hold the existing slopdotcash GitHub App (5257625) with "Repository security advisories:
   * read"; there is no separate intake App.
   */
  SLOP_PRIVATE_INTAKE_MODE?: string;
  GITHUB_INTAKE_APP_CLIENT_ID?: string;
  GITHUB_INTAKE_APP_CLIENT_SECRET?: string;
  GITHUB_INTAKE_APP_ID?: string;
  /**
   * The App's private key. It signs the installation check and mints
   * repository-scoped advisory-read installation tokens that verify private
   * report receipts; it never files an advisory. Without the App ID and key,
   * receipt checks stay unavailable; nothing is verified by hand.
   */
  GITHUB_INTAKE_APP_PRIVATE_KEY?: string;
  /** 32-byte base64url AES-GCM key for the reporter grant cookie. */
  SLOP_INTAKE_GRANT_KEY?: string;
  /** Local browser tests only: a loopback GitHub OAuth fixture origin. */
  SLOP_GITHUB_OAUTH_ORIGIN?: string;
  /**
   * Owner decision: use the Surplus account key for private security
   * case analysis. No zero-data-retention agreement is required. Unset records
   * every analysis as unavailable; there is no other provider.
   */
  SURPLUS_API_KEY?: string;
  /** Local browser tests only: a loopback analysis provider fixture origin. */
  SLOP_ANALYSIS_API_ORIGIN?: string;
  /** Notification Worker; absent where no notifier is deployed. */
  SLOP_NOTIFY?: { fetch(request: Request): Promise<Response> };
  /**
   * Slopbot Worker service binding. Self-service setup reads the Slopbot
   * installation and the owner's exact repository permission through it;
   * absent, setup reports the installation check as a retry.
   */
  SLOPBOT?: { fetch(request: Request): Promise<Response> };
  SLOPBOT_VALUE_IMPORT?: HistoricalValueBinding;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /** Secure-VM vetting service Ed25519 public keys (base64, comma separated). */
  VETTING_RESULT_PUBLIC_KEYS?: string;
  VETTING_SANDBOX?: { fetch(request: Request): Promise<Response> };
  VETTING_EVIDENCE?: R2Bucket;
  /** Optional RPC overrides for reward token decimals verification. */
  REWARD_RPC_BASE?: string;
  REWARD_RPC_ETHEREUM?: string;
  REWARD_RPC_ROBINHOOD?: string;
  REWARD_RPC_SOLANA?: string;
};

export type PagesContext<E = PagesEnv> = {
  request: Request;
  env: E;
  waitUntil?: (promise: Promise<unknown>) => void;
};

/** Middleware also reaches the static asset or the next function. */
export type PagesMiddlewareContext<E> = PagesContext<E> & {
  next(): Promise<Response>;
};

/**
 * Private evidence, scan persistence and live-pin reads for one request.
 * Repository reads go through the Slopbot installation when it is bound.
 */
export function vettingContext(
  env: Pick<
    PagesEnv,
    | "SLOP_DB"
    | "VETTING_EVIDENCE"
    | "ASSETS"
    | "SLOPBOT"
    | "SLOP_GITHUB_API_ORIGIN"
    | "SLOP_GITHUB_READ_TOKEN"
  >,
  request: Request,
  evidenceAccess: Pick<EvidenceDependencies, "session" | "signed"> = {},
) {
  const evidence = new VettingEvidence({
    db: env.SLOP_DB,
    bucket: env.VETTING_EVIDENCE,
    now: () => new Date(),
    randomId: () => crypto.randomUUID(),
    ...evidenceAccess,
  });
  const vetting = new CloudflareVettingPersistence(
    env.SLOP_DB,
    async (assessment) =>
      assessment.result !== null && evidence.retained(assessment.result),
  );
  const apiOrigin = githubApiOrigin(env.SLOP_GITHUB_API_ORIGIN);
  const github = {
    fetch: slopbotGithubFetch(env.SLOPBOT, apiOrigin, (url, init) =>
      fetch(url, init),
    ),
    token: env.SLOP_GITHUB_READ_TOKEN,
    apiOrigin,
    cache: vettingBranchCache(request),
  };
  const loadTemplate = assetTemplateSource(
    env.ASSETS,
    new URL(request.url).origin,
  );
  return {
    evidence,
    vetting,
    github,
    loadTemplate,
    /** A clearance counts only for the live branch head and template (VET-07). */
    livePin: async (manifest: ProjectDefinition, templateSha256?: string) =>
      readVettingPin(
        github,
        manifest,
        templateSha256 ?? (await loadTemplate()).index.templateSha256,
      ),
  };
}
