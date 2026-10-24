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
  OwnerAwardReviewError,
  prepareOwnerCommitment,
  reviewOwnerAwards,
} from "../../../backend/payments/owner-review";
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
  parseRepositoryAccess,
  vettingScanRequester,
} from "../../../backend/projects/setup";
import { assetTemplateSource } from "../../../backend/projects/skill-publication";
import { rpcTokenMetadataReader } from "../../../backend/projects/token-metadata";
import {
  githubAdvisoryClient,
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
import {
  handleVettingApi,
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
   * exactly "on" and every intake App secret below is set; any missing
   * value keeps the existing manual flow. The intake App is separate from
   * the identity App and holds only repository security advisories and
   * metadata permissions (pending owner approval).
   */
  SLOP_PRIVATE_INTAKE_MODE?: string;
  GITHUB_INTAKE_APP_CLIENT_ID?: string;
  GITHUB_INTAKE_APP_CLIENT_SECRET?: string;
  GITHUB_INTAKE_APP_ID?: string;
  /** Used only for the App installation check, never to read advisories. */
  GITHUB_INTAKE_APP_PRIVATE_KEY?: string;
  /** 32-byte base64url AES-GCM key for the reporter grant cookie. */
  SLOP_INTAKE_GRANT_KEY?: string;
  /** Local browser tests only: a loopback GitHub OAuth fixture origin. */
  SLOP_GITHUB_OAUTH_ORIGIN?: string;
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
 * Proves control from public GitHub facts only: the applicant owns a user
 * repository, or is a public member of the owning organization. The manifest's
 * repository and steward identities must match GitHub exactly. Every other
 * repository and every alias must be a public GitHub repository, an alias the
 * repository it names, and control is proven only for every owner.
 */
export async function repositoryControl(
  manifest: ProjectDefinition,
  actor: { githubId: string; githubLogin: string },
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
  let control = await ownerControl(api, token, facts, repository.id, actor);
  const missing = (path: string): RepositoryControl => ({
    state: "mismatch",
    reason: `GitHub has no public repository named ${path}`,
  });
  for (const [index, entry] of manifest.repositories.entries()) {
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
    if (index > 0 && control.state === "proven") {
      const owned = await ownerControl(api, token, named, entry.id, actor);
      if (owned.state !== "proven") control = owned;
    }
  }
  return control;
}

async function ownerControl(
  api: string,
  token: string | undefined,
  facts: GithubRepositoryFacts,
  repository: string,
  actor: { githubId: string; githubLogin: string },
): Promise<RepositoryControl> {
  if (facts.owner?.type === "User")
    return String(facts.owner.id) === actor.githubId
      ? {
          state: "proven",
          reason: `@${actor.githubLogin} owns ${repository}`,
        }
      : {
          state: "unproven",
          reason: `@${actor.githubLogin} does not own ${repository}`,
        };
  const membership = await fetch(
    `${api}/orgs/${encodeURIComponent(String(facts.owner?.login))}/public_members/${encodeURIComponent(actor.githubLogin)}`,
    { headers: githubHeaders(token), signal: AbortSignal.timeout(10_000) },
  );
  if (membership.status === 204)
    return {
      state: "proven",
      reason: `@${actor.githubLogin} is a public member of ${String(facts.owner?.login)}`,
    };
  if (membership.status === 404)
    return {
      state: "unproven",
      reason: `@${actor.githubLogin} is not a public member of ${String(facts.owner?.login)}`,
    };
  throw new Error(`GitHub returned ${membership.status}`);
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
      assessment.result !== null && evidence.complete(assessment.result),
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
    repositoryControl: (manifest, actor) =>
      repositoryControl(manifest, actor, context.env),
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
    cache: edgeCache(),
    waitUntil: context.waitUntil?.bind(context),
    intake: privateIntake(context.env),
  });
  if (securityResponse !== null) return securityResponse;
  const evidenceResponse = await evidence.handle(context.request);
  if (evidenceResponse !== null) return evidenceResponse;
  const vettingResponse = await handleVettingApi(context.request, {
    refreshSetup: (projectId) =>
      refreshProjectSetup(context.request, projectDependencies, projectId),
    evidence,
    vetting,
    projects: projectPersistence,
    resultPublicKeys: context.env.VETTING_RESULT_PUBLIC_KEYS,
    operatorGithubIds: [
      ...new Set([
        ...githubIdSet(context.env.ADMIN_GITHUB_IDS),
        ...githubIdSet(context.env.PROJECT_MODERATOR_GITHUB_IDS),
      ]),
    ],
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
      ownerCommitment: async (projectId, cycleId, actor, expected) => {
        const generation = await projectPersistence.enforcementGeneration();
        const project = await projectPersistence.getProject(projectId);
        if (!project)
          throw new OwnerAwardReviewError(404, "Project not found.");
        if (
          publicRestrictionOf(
            project,
            await projectPersistence.listEnforcements(),
          ).state !== "clear"
        )
          throw new OwnerAwardReviewError(
            409,
            "This project is restricted. New award commitments are unavailable.",
          );
        if (
          !parsePaymentNetworks(context.env.PAYMENT_NETWORKS).some(
            (network) => network === expected.network,
          )
        )
          throw new OwnerAwardReviewError(
            409,
            "Award processing is not configured for this network.",
          );
        const result = await prepareOwnerCommitment(
          {
            project,
            cycleId,
            actor,
            token: context.env.SLOP_GITHUB_READ_TOKEN,
            now: new Date(),
          },
          expected,
        );
        const current = await projectPersistence.getProject(projectId);
        if (
          !current ||
          current.revision !== project.revision ||
          current.manifestSha256 !== project.manifestSha256 ||
          (await projectPersistence.enforcementGeneration()) !== generation
        )
          throw new OwnerAwardReviewError(
            409,
            "The project changed during review. Reload its current awards.",
          );
        return result;
      },
      ownerAwardReview: async (projectId, cycleId, actor) => {
        const project = await projectPersistence.getProject(projectId);
        if (!project)
          throw new OwnerAwardReviewError(404, "Project not found.");
        const result = await reviewOwnerAwards({
          project,
          cycleId,
          actor,
          token: context.env.SLOP_GITHUB_READ_TOKEN,
          now: new Date(),
        });
        const current = await projectPersistence.getProject(projectId);
        if (
          !current ||
          current.revision !== project.revision ||
          current.manifestSha256 !== project.manifestSha256
        )
          throw new OwnerAwardReviewError(
            409,
            "The project changed during review. Reload its current awards.",
          );
        return result;
      },
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
