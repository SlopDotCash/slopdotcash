import type { D1TransactionalDatabase as D1Database } from "../../../backend/d1";
import {
  type FeeConversionsDependencies,
  handleFeeConversionsApi,
} from "../../../backend/fee-conversions/handler";
import {
  handleEmailPreferences,
  verifiedEmailEligibility,
} from "../../../backend/notifications/email";
import {
  handleNotificationsApi,
  type NotificationsDependencies,
} from "../../../backend/notifications/handler";
import {
  handlePaymentsApi,
  type PaymentsDependencies,
} from "../../../backend/payments/handler";
import {
  monthlyOwnerService,
  verifyProjectAuthority,
} from "../../../backend/payments/monthly";
import {
  handlePointsApi,
  sessionGithubActor,
} from "../../../backend/points/handler";
import { telegramConfiguration } from "../../../backend/points/telegram";
import {
  CloudflareProjectPersistence,
  type ProjectD1Database,
} from "../../../backend/projects/cloudflare-persistence";
import type { RepositoryControl } from "../../../backend/projects/contracts";
import { edgeCache } from "../../../backend/projects/edge-cache";
import { publicRestrictionOf } from "../../../backend/projects/enforcement";
import { githubApiOrigin } from "../../../backend/projects/github-lookup";
import {
  handleProjectApi,
  type ProjectApiDependencies,
  refreshProjectSetup,
} from "../../../backend/projects/handler";
import {
  flaggerAuthority,
  parseRepositoryAccess,
  readRepositoryAccess,
  vettingScanRequester,
} from "../../../backend/projects/setup";
import { assetTemplateSource } from "../../../backend/projects/skill-publication";
import { rpcTokenMetadataReader } from "../../../backend/projects/token-metadata";
import { ownerVaultSetupService } from "../../../backend/projects/vault-setup";
import { githubAdvisoryReader } from "../../../backend/security/advisories";
import { surplusSecurityAnalyzer } from "../../../backend/security/analysis";
import {
  githubAdvisoryClient,
  githubAppAdvisoryToken,
  githubInstallationCheck,
} from "../../../backend/security/github-advisories";
import { handleSecurityApi } from "../../../backend/security/handler";
import {
  githubIntakeOAuth,
  type IntakeConfig,
} from "../../../backend/security/intake-grant";
import { securityPaymentDatabase } from "../../../backend/security/payment-database";
import { deterministicAnalyzer } from "../../../backend/security/report-analysis";
import { handleSlopbotApi } from "../../../backend/slopbot/summary";
import {
  type HistoricalValueBinding,
  handleHistoricalValueImport,
} from "../../../backend/slopbot/value-import";
import {
  CloudflareTracePersistence,
  type R2Bucket,
} from "../../../backend/trace/cloudflare-persistence";
import { handleTraceApi } from "../../../backend/trace/handler";
import { VettingEvidence } from "../../../backend/vetting/evidence";
import { githubFlaggerStanding } from "../../../backend/vetting/flagger-standing";
import {
  handleProjectFlagsApi,
  ProjectFlagStore,
} from "../../../backend/vetting/flags";
import {
  handleVettingApi,
  queueAutomaticScan,
  signedVettingRequest,
  vettingServiceAvailable,
} from "../../../backend/vetting/handler";
import {
  readVettingPin,
  vettingBranchCache,
} from "../../../backend/vetting/live-pin";
import { CloudflareVettingPersistence } from "../../../backend/vetting/persistence";
import type { SolanaEscrowConfig } from "../../../contracts/solana/adapter";
import { deploymentTier } from "../../../src/lib/deployment";
import { ESCROW_NETWORKS } from "../../../src/lib/escrow-policy.mjs";
import { parseMonthlySchedule } from "../../../src/lib/payments/monthly-allocation";
import type { ProjectDefinition } from "../../../src/lib/projects.mjs";
import {
  loadRegistryPaymentDeployments,
  parsePaymentNetworks,
} from "../../../workers/payments/deployments";

type Env = {
  SLOP_ENVIRONMENT?: "production" | "staging";
  SLOP_DB: D1Database &
    ProjectD1Database &
    FeeConversionsDependencies["db"] &
    NotificationsDependencies["db"];
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
  /** Private RPC endpoints for explicit wallet funding review/check requests. Never returned to the browser. */
  PAYMENT_RPC_URLS?: string;
  PRIVATE_TRACES: R2Bucket;
  TRACE_AUTH_SECRET: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  /** Telegram connection bot (PRD SOC-02); all three or none. */
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  OPERATOR_GITHUB_IDS?: string;
  /** GitHub numeric actor IDs allowed to review project applications. */
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
   * Automatic private security intake (PRD section 8, SEC-07). Off unless
   * exactly "on" and every App secret below is set; any missing value keeps
   * the existing manual flow. Owner decision D10: these hold the existing
   * slopdotcash GitHub App (5257625) with "Repository security advisories:
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
  VETTING_EVIDENCE_POLICY?: string;
  /** Optional RPC overrides for reward token decimals verification. */
  REWARD_RPC_BASE?: string;
  REWARD_RPC_ETHEREUM?: string;
  REWARD_RPC_ROBINHOOD?: string;
  REWARD_RPC_SOLANA?: string;
};

/** The intake configuration, or undefined (off) unless fully configured. */
function privateIntake(env: Env): IntakeConfig | undefined {
  const clientId = env.GITHUB_INTAKE_APP_CLIENT_ID;
  const clientSecret = env.GITHUB_INTAKE_APP_CLIENT_SECRET;
  const appId = env.GITHUB_INTAKE_APP_ID;
  const privateKey = env.GITHUB_INTAKE_APP_PRIVATE_KEY;
  const grantKey = env.SLOP_INTAKE_GRANT_KEY;
  if (
    env.SLOP_PRIVATE_INTAKE_MODE !== "on" ||
    !clientId ||
    !clientSecret ||
    !appId ||
    !privateKey ||
    !grantKey ||
    !/^[A-Za-z0-9_-]{43}$/u.test(grantKey)
  )
    return undefined;
  const apiOrigin = githubApiOrigin(env.SLOP_GITHUB_API_ORIGIN);
  const oauthOrigin =
    env.SLOP_GITHUB_OAUTH_ORIGIN &&
    /^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/u.test(
      env.SLOP_GITHUB_OAUTH_ORIGIN,
    )
      ? env.SLOP_GITHUB_OAUTH_ORIGIN
      : "https://github.com";
  const send = (url: string, init: RequestInit) => fetch(url, init);
  const installation = githubInstallationCheck({
    fetch: send,
    apiOrigin,
    appId,
    privateKey,
    now: () => new Date(),
  });
  return {
    mode: "on",
    grantKey,
    clientId,
    authorizeOrigin: oauthOrigin,
    oauth: githubIntakeOAuth({
      fetch: send,
      oauthOrigin,
      clientId,
      clientSecret,
    }),
    advisories: githubAdvisoryClient({ fetch: send, apiOrigin, installation }),
    installation,
    analyzer: deterministicAnalyzer,
  };
}

type PagesContext = {
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
};

export const MAX_IDENTITY_RESPONSE_BYTES = 16 * 1024;
type PrivateIntakeStatus =
  | { status: "verified"; enabled: boolean; verifiedAt: string }
  | { status: "rate_limited"; resetAt: string }
  | { status: "unavailable" };

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)
  ) {
    throw new Error("Response exceeds the allowed size");
  }
  if (response.body === null) throw new Error("Response is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("response too large");
        throw new Error("Response exceeds the allowed size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function privateIntakeStatus(
  db: D1Database,
  now = new Date(),
): Promise<PrivateIntakeStatus> {
  try {
    const row = await db
      .prepare(
        "SELECT enabled, verified_at FROM private_intake_status WHERE singleton = 1",
      )
      .first<{ enabled: number; verified_at: string }>();
    if (
      !row ||
      ![0, 1].includes(row.enabled) ||
      typeof row.verified_at !== "string"
    )
      return { status: "unavailable" };
    const age = now.getTime() - Date.parse(row.verified_at);
    if (!Number.isFinite(age) || age < -300000 || age > 24 * 60 * 60 * 1000)
      return { status: "unavailable" };
    return {
      status: "verified",
      enabled: row.enabled === 1,
      verifiedAt: row.verified_at,
    };
  } catch {
    return { status: "unavailable" };
  }
}

async function verifyIdentityAssertion(
  identityService: Env["SLOP_IDENTITY"],
  assertion: string,
): Promise<{ githubId: string; githubLogin: string } | null> {
  const response = await identityService.fetch(
    new Request("https://identity.internal/v1/assertions/consume", {
      method: "POST",
      headers: {
        authorization: `Bearer ${assertion}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ audience: "private-trace-api" }),
    }),
  );
  if (!response.ok) return null;
  const body = await readBoundedJson(response, MAX_IDENTITY_RESPONSE_BYTES);
  if (typeof body !== "object" || body === null) return null;
  const id = (body as { githubActorId?: unknown }).githubActorId;
  const login = (body as { githubLogin?: unknown }).githubLogin;
  if (
    typeof id !== "string" ||
    !/^\d+$/u.test(id) ||
    typeof login !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(login)
  ) {
    return null;
  }
  return { githubId: id, githubLogin: login };
}

function githubIdSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => /^[1-9]\d*$/u.test(entry)),
  );
}

/** Reads one repository's Slopbot installation and account permission. */
async function slopbotRepositoryAccess(
  slopbot: Env["SLOPBOT"],
  repository: { path: string; githubId: string },
  actor: { githubId: string; githubLogin: string },
) {
  if (slopbot === undefined) throw new Error("Slopbot is not connected");
  const url = new URL("https://slopbot.internal/v1/repository-access");
  url.searchParams.set("repository", repository.path);
  url.searchParams.set("repositoryId", repository.githubId);
  url.searchParams.set("login", actor.githubLogin);
  url.searchParams.set("githubId", actor.githubId);
  const response = await slopbot.fetch(
    new Request(url, { headers: { accept: "application/json" } }),
  );
  if (!response.ok) throw new Error(`Slopbot returned ${response.status}`);
  return parseRepositoryAccess(await readBoundedJson(response, 4 * 1024));
}

function githubHeaders(token: string | undefined): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "slop.cash-project-registry",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

type GithubRepositoryFacts = {
  id?: unknown;
  node_id?: unknown;
  full_name?: unknown;
  private?: unknown;
  owner?: { id?: unknown; login?: unknown; type?: unknown };
};

/** Reads a repository from GitHub; null when GitHub has no such repository. */
async function githubRepository(
  api: string,
  token: string | undefined,
  path: string,
): Promise<GithubRepositoryFacts | null> {
  const response = await fetch(`${api}/repos/${path}`, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return (await readBoundedJson(response, 512 * 1024)) as GithubRepositoryFacts;
}

/**
 * Repositories and aliases one application may name, so a submission makes a
 * bounded number of GitHub reads. Listed projects name one repository and at
 * most one alias, and `/projects/new` sends one repository.
 */
const MAX_APPLICATION_GITHUB_NAMES = 5;

/**
 * Checks the manifest against public GitHub facts: the repository and steward
 * identities must match GitHub exactly, and every other repository and alias
 * must be a public GitHub repository, each alias a name of the repository it
 * follows. These facts never grant authority; the Slopbot installation read
 * does (owner decision D11).
 */
export async function repositoryControl(
  manifest: ProjectDefinition,
  env: Env,
): Promise<RepositoryControl> {
  const api = githubApiOrigin(env.SLOP_GITHUB_API_ORIGIN);
  const token = env.SLOP_GITHUB_READ_TOKEN;
  const repository = manifest.repositories[0];
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository.id))
    return { state: "mismatch", reason: "Repository must be owner/name" };
  const names = manifest.repositories.flatMap((entry) => [
    entry.id,
    ...(entry.aliases ?? []),
  ]);
  if (names.length > MAX_APPLICATION_GITHUB_NAMES)
    return {
      state: "mismatch",
      reason: `An application may name at most ${MAX_APPLICATION_GITHUB_NAMES} repositories and aliases`,
    };
  const facts = await githubRepository(api, token, repository.id);
  if (!facts)
    return {
      state: "mismatch",
      reason: "GitHub has no public repository with that name",
    };
  if (
    String(facts.id) !== manifest.authority.repositoryId ||
    facts.node_id !== manifest.authority.repositoryNodeId ||
    String(facts.full_name).toLowerCase() !== repository.id.toLowerCase() ||
    facts.private !== false ||
    !stewardIsOwner(facts.owner, manifest.steward.github)
  )
    return {
      state: "mismatch",
      reason: "Repository or steward facts do not match GitHub",
    };
  // The other names are independent reads, so they run together.
  const read = new Map(
    await Promise.all(
      names
        .slice(1)
        .map(
          async (path) =>
            [path, await githubRepository(api, token, path)] as const,
        ),
    ),
  );
  read.set(repository.id, facts);
  const missing = (path: string): RepositoryControl => ({
    state: "mismatch",
    reason: `GitHub has no public repository named ${path}`,
  });
  for (const entry of manifest.repositories) {
    const named = read.get(entry.id);
    if (named?.private !== false) return missing(entry.id);
    if (String(named.full_name).toLowerCase() !== entry.id.toLowerCase())
      return {
        state: "mismatch",
        reason: `GitHub names ${entry.id} ${String(named.full_name)}`,
      };
    for (const alias of entry.aliases ?? []) {
      const aliased = read.get(alias);
      if (aliased?.private !== false) return missing(alias);
      if (String(aliased.id) !== String(named.id))
        return {
          state: "mismatch",
          reason: `Alias ${alias} is not a name of ${entry.id} on GitHub`,
        };
    }
  }
  return { state: "matched" };
}

/**
 * The steward is the account GitHub reports as the repository owner: the same
 * numeric id, node id, account type and login (case-insensitive). Pages
 * show the steward by login and attribute the project to its node id.
 */
function stewardIsOwner(
  owner:
    | { id?: unknown; node_id?: unknown; login?: unknown; type?: unknown }
    | undefined,
  steward: ProjectDefinition["steward"]["github"],
): boolean {
  return (
    String(owner?.id) === steward.actorId &&
    owner?.node_id === steward.nodeId &&
    owner?.type === steward.type &&
    String(owner?.login).toLowerCase() === steward.login.toLowerCase()
  );
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const projectPersistence = new CloudflareProjectPersistence(
    context.env.SLOP_DB,
  );
  const evidence = new VettingEvidence({
    db: context.env.SLOP_DB,
    bucket: context.env.VETTING_EVIDENCE,
    policy: context.env.VETTING_EVIDENCE_POLICY,
    session: async (request) => {
      const actor = await sessionGithubActor(
        request,
        context.env.SLOP_DB,
        new Date().toISOString(),
      );
      return actor ? { ...actor, admin: false } : null;
    },
    now: () => new Date(),
    randomId: () => crypto.randomUUID(),
    signed: (request, maximum) =>
      signedVettingRequest(
        request,
        {
          resultPublicKeys: context.env.VETTING_RESULT_PUBLIC_KEYS,
          now: () => new Date(),
        },
        maximum,
      ),
  });
  const vetting = new CloudflareVettingPersistence(
    context.env.SLOP_DB,
    async (assessment) =>
      assessment.result !== null && evidence.retained(assessment.result),
  );
  const github = {
    fetch: (url: string, init: RequestInit) => fetch(url, init),
    token: context.env.SLOP_GITHUB_READ_TOKEN,
    apiOrigin: githubApiOrigin(context.env.SLOP_GITHUB_API_ORIGIN),
    cache: vettingBranchCache(context.request),
  };
  const loadTemplate = assetTemplateSource(
    context.env.ASSETS,
    new URL(context.request.url).origin,
  );
  // A clearance counts only for the live branch head and template (VET-07).
  const livePin = async (manifest: ProjectDefinition) =>
    readVettingPin(
      github,
      manifest,
      (await loadTemplate()).index.templateSha256,
    );
  const projectDependencies: ProjectApiDependencies = {
    persistence: projectPersistence,
    vaultSetup: ownerVaultSetupService({
      db: context.env.SLOP_DB,
      projects: () => projectPersistence.listProjects(),
      networks: () => parsePaymentNetworks(context.env.PAYMENT_NETWORKS),
      rpcUrl: (network) => {
        const value = JSON.parse(context.env.PAYMENT_RPC_URLS ?? "{}")[network];
        if (typeof value !== "string" || new URL(value).protocol !== "https:")
          throw new Error("Vault setup RPC unavailable");
        return value;
      },
    }),
    vettingClearance: (
      projectId,
      manifest,
      throughRevision,
      forReinstatement,
    ) =>
      vetting.manifestClearance(
        projectId,
        manifest,
        throughRevision,
        () => livePin(manifest),
        forReinstatement,
      ),
    adminGithubIds: githubIdSet(context.env.ADMIN_GITHUB_IDS),
    moderatorGithubIds: githubIdSet(context.env.PROJECT_MODERATOR_GITHUB_IDS),
    now: () => new Date(),
    randomId: () => crypto.randomUUID(),
    sessionActor: (request) =>
      sessionGithubActor(
        request,
        context.env.SLOP_DB,
        new Date().toISOString(),
      ),
    repositoryControl: (manifest) => repositoryControl(manifest, context.env),
    repositoryAccess: (repository, actor) =>
      slopbotRepositoryAccess(context.env.SLOPBOT, repository, actor),
    requestScan: vettingScanRequester({
      vetting,
      serviceAvailable: () =>
        vettingServiceAvailable(context.env.VETTING_RESULT_PUBLIC_KEYS),
      livePin,
      now: () => new Date(),
      randomId: () => crypto.randomUUID(),
    }),
    readTokenMetadata: rpcTokenMetadataReader(fetch, {
      base: context.env.REWARD_RPC_BASE,
      ethereum: context.env.REWARD_RPC_ETHEREUM,
      robinhood: context.env.REWARD_RPC_ROBINHOOD,
      solana: context.env.REWARD_RPC_SOLANA,
    }),
    github,
    cache: edgeCache(),
    waitUntil: context.waitUntil?.bind(context),
  };
  const projectResponse = await handleProjectApi(
    context.request,
    projectDependencies,
  );
  if (projectResponse !== null) return projectResponse;
  const securityResponse = await handleSecurityApi(context.request, {
    db: context.env.SLOP_DB,
    now: () => new Date(),
    randomId: () => crypto.randomUUID(),
    sessionActor: (request) =>
      sessionGithubActor(
        request,
        context.env.SLOP_DB,
        new Date().toISOString(),
      ),
    github: {
      fetch: (url, init) => fetch(url, init),
      token: context.env.SLOP_GITHUB_READ_TOKEN,
      apiOrigin: githubApiOrigin(context.env.SLOP_GITHUB_API_ORIGIN),
    },
    advisories:
      context.env.GITHUB_INTAKE_APP_ID &&
      context.env.GITHUB_INTAKE_APP_PRIVATE_KEY
        ? githubAdvisoryReader({
            fetch: (url, init) => fetch(url, init),
            apiOrigin: githubApiOrigin(context.env.SLOP_GITHUB_API_ORIGIN),
            token: githubAppAdvisoryToken({
              fetch: (url, init) => fetch(url, init),
              apiOrigin: githubApiOrigin(context.env.SLOP_GITHUB_API_ORIGIN),
              appId: context.env.GITHUB_INTAKE_APP_ID,
              privateKey: context.env.GITHUB_INTAKE_APP_PRIVATE_KEY,
              now: () => new Date(),
            }),
          })
        : null,
    analyzer: surplusSecurityAnalyzer({
      apiKey: context.env.SURPLUS_API_KEY,
      fetch: (url, init) => fetch(url, init),
      loopbackOrigin: context.env.SLOP_ANALYSIS_API_ORIGIN,
    }),
    moderatorGithubIds: githubIdSet(context.env.PROJECT_MODERATOR_GITHUB_IDS),
    cache: edgeCache(),
    waitUntil: context.waitUntil?.bind(context),
    intake: privateIntake(context.env),
  });
  if (securityResponse !== null) return securityResponse;
  const evidenceResponse = await evidence.handle(context.request);
  if (evidenceResponse !== null) return evidenceResponse;
  const flags = new ProjectFlagStore(context.env.SLOP_DB);
  const operatorGithubIds = [
    ...new Set([
      ...githubIdSet(context.env.ADMIN_GITHUB_IDS),
      ...githubIdSet(context.env.PROJECT_MODERATOR_GITHUB_IDS),
    ]),
  ];
  const flagsResponse = await handleProjectFlagsApi(context.request, {
    flags,
    projects: projectPersistence,
    flaggerStanding: githubFlaggerStanding({
      fetch: github.fetch,
      token: github.token,
      apiOrigin: github.apiOrigin,
      registryRepositories: async () =>
        (await projectPersistence.listProjects()).flatMap((project) =>
          project.manifest.repositories.map((entry) => entry.id),
        ),
    }),
    repositoryAuthority: async (manifest, actor) => {
      // Only current repository permission determines maintainer exclusion.
      return flaggerAuthority(
        await readRepositoryAccess(
          (repository, member) =>
            slopbotRepositoryAccess(context.env.SLOPBOT, repository, member),
          manifest,
          actor,
        ),
        actor,
        manifest.repositories[0].id,
      );
    },
    sessionActor: (request) =>
      sessionGithubActor(
        request,
        context.env.SLOP_DB,
        new Date().toISOString(),
      ),
    moderatorGithubIds: operatorGithubIds,
    queueFreshScan: (project) =>
      queueAutomaticScan(
        {
          vetting,
          livePin,
          resultPublicKeys: context.env.VETTING_RESULT_PUBLIC_KEYS,
          now: () => new Date(),
          randomId: () => crypto.randomUUID(),
        },
        project,
        "Automatic fresh scan after two contributor flags paused the project",
      ),
    now: () => new Date(),
    randomId: () => crypto.randomUUID(),
    cache: edgeCache(),
  });
  if (flagsResponse !== null) return flagsResponse;
  const vettingResponse = await handleVettingApi(context.request, {
    sandbox: context.env.VETTING_SANDBOX,
    refreshSetup: (projectId) =>
      refreshProjectSetup(context.request, projectDependencies, projectId),
    evidence,
    vetting,
    flags,
    projects: projectPersistence,
    resultPublicKeys: context.env.VETTING_RESULT_PUBLIC_KEYS,
    operatorGithubIds,
    livePin,
    session: async (request) => {
      const actor = await sessionGithubActor(
        request,
        context.env.SLOP_DB,
        new Date().toISOString(),
      );
      return actor === null
        ? null
        : {
            ...actor,
            admin: githubIdSet(context.env.ADMIN_GITHUB_IDS).has(
              actor.githubId,
            ),
          };
    },
    now: () => new Date(),
    randomId: () => crypto.randomUUID(),
    cache: edgeCache(),
  });
  if (vettingResponse !== null) return vettingResponse;
  const feeConversionsResponse = await handleFeeConversionsApi(
    context.request,
    {
      db: context.env.SLOP_DB,
      adminGithubIds: githubIdSet(context.env.ADMIN_GITHUB_IDS),
      sessionActor: (request) =>
        sessionGithubActor(
          request,
          context.env.SLOP_DB,
          new Date().toISOString(),
        ),
    },
  );
  if (feeConversionsResponse !== null) return feeConversionsResponse;
  const emailPreferencesResponse = await handleEmailPreferences(
    context.request,
    {
      db: context.env.SLOP_DB,
      sessionActor: (request) =>
        sessionGithubActor(
          request,
          context.env.SLOP_DB,
          new Date().toISOString(),
        ),
      now: () => new Date(),
      eligibility: (githubId) =>
        verifiedEmailEligibility(context.env.SLOP_NOTIFY, githubId),
    },
  );
  if (emailPreferencesResponse !== null) return emailPreferencesResponse;
  const notificationsResponse = await handleNotificationsApi(context.request, {
    moderatorGithubIds: githubIdSet(context.env.PROJECT_MODERATOR_GITHUB_IDS),
    db: context.env.SLOP_DB,
    sessionActor: (request) =>
      sessionGithubActor(
        request,
        context.env.SLOP_DB,
        new Date().toISOString(),
      ),
    now: () => new Date(),
  });
  if (notificationsResponse !== null) return notificationsResponse;
  if (new URL(context.request.url).pathname.startsWith("/api/v1/payments/"))
    return handlePaymentsApi(context.request, {
      db: context.env.SLOP_DB,
      solanaAttester: context.env.SOLANA_IDENTITY_ATTESTER,
      securityPayments: {
        db: securityPaymentDatabase(context.env.SLOP_DB),
        solanaAttester: context.env.SECURITY_SOLANA_IDENTITY_ATTESTER,
      },
      monthly: monthlyOwnerService({
        db: context.env.SLOP_DB,
        getProject: (id) => projectPersistence.getProject(id),
        restricted: async (project) =>
          publicRestrictionOf(
            project,
            await projectPersistence.listEnforcements(),
          ).state !== "clear",
        // Unset or invalid networks serve no vault, so nothing is finalized
        // or reserved here.
        networks: () => {
          try {
            return parsePaymentNetworks(context.env.PAYMENT_NETWORKS);
          } catch {
            return [];
          }
        },
        verifyAuthority: (project, actor) =>
          verifyProjectAuthority(
            project.manifest,
            actor,
            context.env.SLOP_GITHUB_READ_TOKEN,
          ),
        // The cutoff display and the owner's cutoff lock. A malformed value
        // turns both off; the payments Worker then fails loudly and freezes
        // nothing automatically, so the allocations stay owner-controlled.
        schedule: () => {
          try {
            return parseMonthlySchedule(context.env.MONTHLY_PAYMENT_SCHEDULE);
          } catch {
            return null;
          }
        },
        now: () => new Date(),
      }),
      solanaFundingConfig: async (projectId, network, vault) => {
        const networks = parsePaymentNetworks(context.env.PAYMENT_NETWORKS);
        const selected = networks.find((name) => name === network);
        if (!selected || ESCROW_NETWORKS[selected].family !== "solana")
          throw new Error("Funding network unavailable");
        const registry = await loadRegistryPaymentDeployments(
          context.env.SLOP_DB,
          [selected],
        );
        const matches = registry.deployments.filter(
          (row) =>
            row.projectId === projectId &&
            row.network === network &&
            row.vault === vault,
        );
        if (matches.length !== 1) throw new Error("Funding vault unavailable");
        const rpcUrl = (
          JSON.parse(context.env.PAYMENT_RPC_URLS ?? "{}") as Record<
            string,
            unknown
          >
        )[network];
        if (typeof rpcUrl !== "string" || new URL(rpcUrl).protocol !== "https:")
          throw new Error("Funding RPC unavailable");
        return {
          ...matches[0],
          mint: matches[0].asset,
          rpcUrl,
          genesisHash: ESCROW_NETWORKS[selected].genesisHash,
        } as SolanaEscrowConfig;
      },
      // Cloudflare's per-colo edge cache; absent outside the Workers runtime.
      edgeCache: (
        globalThis as {
          caches?: {
            default?: NonNullable<PaymentsDependencies["edgeCache"]>;
          };
        }
      ).caches?.default,
      operatorIds: (context.env.OPERATOR_GITHUB_IDS ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => /^[1-9][0-9]*$/.test(id)),
      // Binding consent names a vault recorded in the D1 project registry for
      // a served network; a vault of any other network is unknown.
      paymentDeployments: async () => {
        const networks = parsePaymentNetworks(context.env.PAYMENT_NETWORKS);
        const [ordinary, security] = await Promise.all([
          loadRegistryPaymentDeployments(context.env.SLOP_DB, networks),
          loadRegistryPaymentDeployments(
            context.env.SLOP_DB,
            networks,
            "security-bounty",
          ),
        ]);
        return [...ordinary.deployments, ...security.deployments];
      },
      ...([
        "https://staging.slop.cash",
        "https://slop-staging.pages.dev",
      ].includes(context.env.PAYMENTS_ALLOWED_ORIGIN ?? "")
        ? { allowedOrigins: [context.env.PAYMENTS_ALLOWED_ORIGIN as string] }
        : {}),
    });
  if (new URL(context.request.url).pathname.startsWith("/api/v1/points/"))
    return handlePointsApi(context.request, {
      tier: deploymentTier(context.env.SLOP_ENVIRONMENT),
      db: context.env.SLOP_DB,
      ...([
        "https://staging.slop.cash",
        "https://slop-staging.pages.dev",
      ].includes(context.env.PAYMENTS_ALLOWED_ORIGIN ?? "")
        ? { allowedOrigins: [context.env.PAYMENTS_ALLOWED_ORIGIN as string] }
        : {}),
      rateLimitSecret: context.env.TRACE_AUTH_SECRET,
      identity: context.env.SLOP_IDENTITY,
      x:
        context.env.X_CLIENT_ID && context.env.X_CLIENT_SECRET
          ? {
              clientId: context.env.X_CLIENT_ID,
              clientSecret: context.env.X_CLIENT_SECRET,
            }
          : undefined,
      telegram: telegramConfiguration(context.env),
    });
  if (new URL(context.request.url).pathname === "/api/v1/slopbot/value-import")
    return handleHistoricalValueImport(context.request, {
      adminGithubIds: githubIdSet(context.env.ADMIN_GITHUB_IDS),
      sessionActor: (request) =>
        sessionGithubActor(
          request,
          context.env.SLOP_DB,
          new Date().toISOString(),
        ),
      publisher: context.env.SLOPBOT_VALUE_IMPORT,
    });
  if (new URL(context.request.url).pathname.startsWith("/api/v1/slopbot/"))
    return handleSlopbotApi(context.request, context.env.SLOP_DB);
  return handleTraceApi(context.request, {
    tier: deploymentTier(context.env.SLOP_ENVIRONMENT),
    persistence: new CloudflareTracePersistence(
      context.env.SLOP_DB,
      context.env.PRIVATE_TRACES,
    ),
    authSecret: context.env.TRACE_AUTH_SECRET,
    operatorGithubIds: new Set(
      (context.env.OPERATOR_GITHUB_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => /^\d+$/u.test(value)),
    ),
    now: () => new Date(),
    randomId: () => crypto.randomUUID(),
    verifyIdentityAssertion: (assertion) =>
      verifyIdentityAssertion(context.env.SLOP_IDENTITY, assertion),
    privateIntakeStatus: () => privateIntakeStatus(context.env.SLOP_DB),
  });
}
