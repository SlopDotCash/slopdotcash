import { handlePaymentsApi } from "../../../backend/payments/handler";
import {
  handlePointsApi,
  sessionGithubActor,
} from "../../../backend/points/handler";
import {
  CloudflareProjectPersistence,
  type ProjectD1Database,
} from "../../../backend/projects/cloudflare-persistence";
import type { RepositoryControl } from "../../../backend/projects/contracts";
import {
  type AdminApplicationNotice,
  handleProjectApi,
} from "../../../backend/projects/handler";
import { handleSlopbotApi } from "../../../backend/slopbot/summary";
import {
  CloudflareTracePersistence,
  type D1Database,
  type R2Bucket,
} from "../../../backend/trace/cloudflare-persistence";
import { handleTraceApi } from "../../../backend/trace/handler";
import { deploymentTier } from "../../../src/lib/deployment";
import type { ProjectDefinition } from "../../../src/lib/projects.mjs";

type Env = {
  SLOP_ENVIRONMENT?: "production" | "staging";
  SLOP_DB: D1Database & ProjectD1Database;
  PAYMENTS_ALLOWED_ORIGIN?: string;
  PRIVATE_TRACES: R2Bucket;
  TRACE_AUTH_SECRET: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  OPERATOR_GITHUB_IDS?: string;
  /** GitHub numeric actor IDs allowed to review project applications. */
  ADMIN_GITHUB_IDS?: string;
  SLOP_IDENTITY: { fetch(request: Request): Promise<Response> };
  /** Local browser tests only: a loopback GitHub API fixture origin. */
  SLOP_GITHUB_API_ORIGIN?: string;
  /** Optional read-only GitHub token for repository ownership checks. */
  SLOP_GITHUB_READ_TOKEN?: string;
  /** Admin email Worker; absent where no notifier is deployed. */
  SLOP_NOTIFY?: { fetch(request: Request): Promise<Response> };
  ASSETS?: { fetch(request: Request): Promise<Response> };
};

type PagesContext = {
  request: Request;
  env: Env;
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

/** Reviewed skill code lives only on this repository's development branch. */
const SKILL_SOURCE_REPOSITORY = "SlopDotCash/slopdotcash";

function githubIdSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => /^[1-9]\d*$/u.test(entry)),
  );
}

async function notifyAdmins(
  notify: Env["SLOP_NOTIFY"],
  notice: AdminApplicationNotice,
): Promise<boolean> {
  if (notify === undefined) return false;
  const response = await notify.fetch(
    new Request("https://notify.internal/v1/project-applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(notice),
    }),
  );
  return response.status === 202;
}

async function skillPublished(sourcePath: string): Promise<boolean> {
  if (!/^skills\/[a-z0-9-]{1,80}$/u.test(sourcePath)) return false;
  const response = await fetch(
    `https://api.github.com/repos/${SKILL_SOURCE_REPOSITORY}/contents/${sourcePath}/SKILL.md?ref=development`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "slop.cash-project-registry",
      },
    },
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new Error("GitHub skill lookup failed");
  return true;
}

function githubHeaders(token: string | undefined): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "slop.cash-project-registry",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Proves control from public GitHub facts only: the applicant owns a user
 * repository, or is a public member of the owning organization. The manifest's
 * repository and steward identities must match GitHub exactly.
 */
function githubApiOrigin(env: Env): string {
  const origin = env.SLOP_GITHUB_API_ORIGIN;
  return origin && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/u.test(origin)
    ? origin
    : "https://api.github.com";
}

async function repositoryControl(
  manifest: ProjectDefinition,
  actor: { githubId: string; githubLogin: string },
  env: Env,
): Promise<RepositoryControl> {
  const api = githubApiOrigin(env);
  const token = env.SLOP_GITHUB_READ_TOKEN;
  const repository = manifest.repositories[0];
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository.id))
    return { state: "mismatch", reason: "Repository must be owner/name" };
  const response = await fetch(`${api}/repos/${repository.id}`, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404)
    return {
      state: "mismatch",
      reason: "GitHub has no public repository with that name",
    };
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const facts = (await readBoundedJson(response, 512 * 1024)) as {
    id?: unknown;
    node_id?: unknown;
    full_name?: unknown;
    private?: unknown;
    owner?: { id?: unknown; login?: unknown; type?: unknown };
  };
  if (
    String(facts.id) !== manifest.authority.repositoryId ||
    facts.node_id !== manifest.authority.repositoryNodeId ||
    String(facts.full_name).toLowerCase() !== repository.id.toLowerCase() ||
    facts.private !== false ||
    String(facts.owner?.id) !== manifest.steward.github.actorId
  )
    return {
      state: "mismatch",
      reason: "Repository or steward facts do not match GitHub",
    };
  if (facts.owner?.type === "User")
    return String(facts.owner.id) === actor.githubId
      ? {
          state: "proven",
          reason: `@${actor.githubLogin} owns ${repository.id}`,
        }
      : {
          state: "unproven",
          reason: `@${actor.githubLogin} does not own ${repository.id}`,
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

export async function onRequest(context: PagesContext): Promise<Response> {
  const projectResponse = await handleProjectApi(context.request, {
    persistence: new CloudflareProjectPersistence(context.env.SLOP_DB),
    adminGithubIds: githubIdSet(context.env.ADMIN_GITHUB_IDS),
    now: () => new Date(),
    randomId: () => crypto.randomUUID(),
    sessionActor: (request) =>
      sessionGithubActor(
        request,
        context.env.SLOP_DB,
        new Date().toISOString(),
      ),
    notifyAdmins: (notice) => notifyAdmins(context.env.SLOP_NOTIFY, notice),
    skillPublished,
    repositoryControl: (manifest, actor) =>
      repositoryControl(manifest, actor, context.env),
  });
  if (projectResponse !== null) return projectResponse;
  if (new URL(context.request.url).pathname.startsWith("/api/v1/payments/"))
    return handlePaymentsApi(context.request, {
      db: context.env.SLOP_DB,
      operatorIds: (context.env.OPERATOR_GITHUB_IDS ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => /^[1-9][0-9]*$/.test(id)),
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
