import { EmailMessage } from "cloudflare:email";
import {
  enrolledDestination,
  validUnsubscribeKey,
} from "../../backend/notifications/email-destinations";
import {
  type SlopbotBinding,
  slopbotRepositoryAccess,
} from "../../backend/projects/repository-access";
import type { SecurityD1Database } from "../../backend/security/handler";
import { readBoundedJson } from "../../src/lib/browser-json";
import { deploymentTier } from "../../src/lib/deployment";
import { githubIdSet } from "../../src/lib/github-ids";
import {
  type ActivityMailDependencies,
  activityMailEligibility,
  dispatchActivityMail,
  parseActivityMailConfig,
} from "./activity";
import { SENDER_ADDRESS } from "./contracts";
import { handleEnrollmentMailRequest } from "./enrollment";
import { handleNotifyRequest } from "./handler";
import {
  dispatchSecurityMail,
  parseSecurityMailConfig,
  reconcileSecurityMail,
  type SecurityMailDependencies,
} from "./security";

type SendEmailBinding = {
  send(message: EmailMessage): Promise<void>;
};

type Env = {
  SLOP_ENVIRONMENT?: "production" | "staging";
  ADMIN_EMAIL: SendEmailBinding;
  ADMIN_EMAILS?: string;
  SLOP_DB?: SecurityD1Database;
  SLOPBOT?: SlopbotBinding;
  SECURITY_MAIL_PILOT?: string;
  ACTIVITY_MAIL_PILOT?: string;
  NOTIFY_GENERAL_EMAIL_ENABLED?: string;
  NOTIFY_UNSUBSCRIBE_KEY?: string;
  NOTIFY_FROM_ADDRESS: string;
  NOTIFY_INBOX_URL?: string;
  /** Same configured administrators as the Pages notification writer. */
  ADMIN_GITHUB_IDS?: string;
  /** Slop moderators; without it, moderator case mail is suppressed. */
  PROJECT_MODERATOR_GITHUB_IDS?: string;
};

/**
 * The mail pilot that `raw` configures. A set secret that does not parse, or
 * that names another inbox, is misconfigured and never silently off.
 */
function mailPilot<Config extends { inboxUrl: string }>(
  env: Env,
  raw: string | undefined,
  parse: (raw: string) => Config | null,
) {
  const generalEmail = env.NOTIFY_GENERAL_EMAIL_ENABLED === "true";
  if ((!raw && !generalEmail) || !env.SLOP_DB) return "off" as const;
  if (
    generalEmail &&
    (!validUnsubscribeKey(env.NOTIFY_UNSUBSCRIBE_KEY) ||
      !SENDER_ADDRESS.test(env.NOTIFY_FROM_ADDRESS))
  )
    return "misconfigured" as const;
  const config = parse(
    raw ?? JSON.stringify({ inboxUrl: env.NOTIFY_INBOX_URL, recipients: {} }),
  );
  if (!config || config.inboxUrl !== env.NOTIFY_INBOX_URL)
    return "misconfigured" as const;
  return {
    db: env.SLOP_DB,
    config,
    generalEmail,
    unsubscribeKey: generalEmail ? env.NOTIFY_UNSUBSCRIBE_KEY : undefined,
    adminGithubIds: githubIdSet(env.ADMIN_GITHUB_IDS, "ADMIN_GITHUB_IDS"),
    moderatorGithubIds: githubIdSet(
      env.PROJECT_MODERATOR_GITHUB_IDS,
      "PROJECT_MODERATOR_GITHUB_IDS",
    ),
    fromAddress: env.NOTIFY_FROM_ADDRESS,
    now: () => new Date(),
    sendEmail: (from: string, to: string, mime: string) =>
      env.ADMIN_EMAIL.send(new EmailMessage(from, to, mime)),
  };
}

function securityPilot(
  env: Env,
): SecurityMailDependencies | "off" | "misconfigured" {
  const pilot = mailPilot(
    env,
    env.SECURITY_MAIL_PILOT,
    parseSecurityMailConfig,
  );
  return typeof pilot === "string"
    ? pilot
    : {
        ...pilot,
        repositoryAccess: (repository, actor) =>
          slopbotRepositoryAccess(env.SLOPBOT, repository, actor),
      };
}

function activityPilot(
  env: Env,
): ActivityMailDependencies | "off" | "misconfigured" {
  return mailPilot(env, env.ACTIVITY_MAIL_PILOT, parseActivityMailConfig);
}

/** Fixed fields only: never a message, address or case value. */
function logRouteFailure(route: string, error: unknown) {
  console.error(
    JSON.stringify({
      event: "notify_route_failed",
      route,
      kind: error instanceof Error ? error.name : "unknown",
    }),
  );
}

export default {
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const security = securityPilot(env);
    const activity = activityPilot(env);
    const results = await Promise.allSettled([
      typeof security === "string"
        ? Promise.resolve()
        : dispatchSecurityMail(security),
      typeof activity === "string"
        ? Promise.resolve()
        : dispatchActivityMail(activity),
    ]);
    if (security === "misconfigured" || activity === "misconfigured")
      throw new Error("Mail pilot misconfigured");
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Notification queue dispatch failed");
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.origin === "https://notify.internal" &&
      !url.search &&
      [
        "/v1/email/capabilities",
        "/v1/email/verification",
        "/v1/email/unsubscribe",
      ].includes(url.pathname)
    ) {
      const configured = activityPilot(env);
      const deps =
        typeof configured !== "string" &&
        configured.generalEmail &&
        configured.unsubscribeKey
          ? {
              ...configured,
              inboxUrl: configured.config.inboxUrl,
              unsubscribeKey: configured.unsubscribeKey,
            }
          : null;
      const response = await handleEnrollmentMailRequest(
        request,
        deps,
        env.SLOP_DB ? { db: env.SLOP_DB, now: () => new Date() } : null,
      );
      if (response) return response;
    }

    if (
      url.origin === "https://notify.internal" &&
      [
        "/v1/security-notifications/dispatch",
        "/v1/security-notifications/reconcile",
      ].includes(url.pathname) &&
      !url.search
    ) {
      const respond = (status: number) =>
        new Response(null, {
          status,
          headers: { "cache-control": "private, no-store" },
        });
      if (request.method !== "POST") return respond(405);
      try {
        const deps = securityPilot(env);
        if (typeof deps === "string") return respond(503);
        const body = await readBoundedJson(request, 8192, "private notice");
        if (typeof body !== "object" || body === null || Array.isArray(body))
          return respond(400);
        if (url.pathname.endsWith("/reconcile"))
          return respond(
            (await reconcileSecurityMail(deps, body as Record<string, unknown>))
              ? 204
              : 409,
          );
        if (Object.keys(body).length !== 0) return respond(400);
        await dispatchSecurityMail(deps);
        return respond(204);
      } catch (error) {
        logRouteFailure(url.pathname, error);
        return respond(500);
      }
    }
    if (
      url.origin === "https://notify.internal" &&
      [
        "/v1/activity-notifications/eligibility",
        "/v1/activity-notifications/dispatch",
        "/v1/activity-notifications/reconcile",
      ].includes(url.pathname) &&
      !url.search
    ) {
      const respond = (status: number, body?: unknown) =>
        new Response(body === undefined ? null : JSON.stringify(body), {
          status,
          headers: {
            "cache-control": "private, no-store",
            "content-type": "application/json",
          },
        });
      if (request.method !== "POST") return respond(405);
      try {
        const deps = activityPilot(env);
        if (typeof deps === "string") return respond(503);
        const body = await readBoundedJson(request, 8192, "activity notice");
        if (!body || typeof body !== "object" || Array.isArray(body))
          return respond(400);
        const value = body as Record<string, unknown>;
        if (url.pathname.endsWith("/eligibility")) {
          if (
            Object.keys(value).join() !== "githubId" ||
            typeof value.githubId !== "string" ||
            !/^[1-9]\d{0,19}$/u.test(value.githubId)
          )
            return respond(400);
          const registered = deps.generalEmail
            ? await enrolledDestination(deps.db, value.githubId)
            : null;
          return respond(
            200,
            registered
              ? {
                  available: true,
                  email: registered.email,
                  destinationVersion: registered.destinationVersion,
                }
              : await activityMailEligibility(
                  deps.config,
                  value.githubId,
                  deps.now(),
                ),
          );
        }
        if (url.pathname.endsWith("/reconcile"))
          return respond(
            (await reconcileSecurityMail(deps, value, "activity")) ? 204 : 409,
          );
        if (Object.keys(value).length) return respond(400);
        await dispatchActivityMail(deps);
        return respond(204);
      } catch (error) {
        logRouteFailure(url.pathname, error);
        return respond(500);
      }
    }
    return handleNotifyRequest(request, {
      tier: deploymentTier(env.SLOP_ENVIRONMENT),
      adminEmails: env.ADMIN_EMAILS,
      fromAddress: env.NOTIFY_FROM_ADDRESS,
      now: () => new Date(),
      randomId: () => crypto.randomUUID(),
      sendEmail: (from, to, rawMime) =>
        env.ADMIN_EMAIL.send(new EmailMessage(from, to, rawMime)),
    });
  },
};
