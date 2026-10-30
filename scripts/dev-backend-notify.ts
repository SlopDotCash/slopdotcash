/**
 * Local private notify service. Optional persistence/capture uses the real
 * enrollment and delivery handlers; without it, preserve the old consent-only
 * preview with an invalid-domain address. Neither mode sends external mail.
 */
import { createHash } from "node:crypto";
import { enrolledDestination } from "../backend/notifications/email-destinations";
import type { RepositoryAccessReader } from "../backend/projects/setup";
import type { SecurityD1Database } from "../backend/security/handler";
import { dispatchActivityMail } from "../workers/notify/activity";
import { handleEnrollmentMailRequest } from "../workers/notify/enrollment";
import { dispatchSecurityMail } from "../workers/notify/security";

type Lookup = (githubId: string) => string | undefined;
export type LocalCapturedEmail = {
  githubId: string;
  from: string;
  to: string;
  mime: string;
};
export type LocalNotifyOptions = {
  db: SecurityD1Database;
  now: () => Date;
  inboxUrl: string;
  unsubscribeKey: string;
  capture: (message: LocalCapturedEmail) => void | Promise<void>;
  repositoryAccess?: RepositoryAccessReader;
  adminGithubIds?: ReadonlySet<string>;
  moderatorGithubIds?: ReadonlySet<string>;
};

export function localNotify(login: Lookup, options?: LocalNotifyOptions) {
  const enrollment = options
    ? {
        db: options.db,
        now: options.now,
        inboxUrl: options.inboxUrl,
        unsubscribeKey: options.unsubscribeKey,
        fromAddress: "notifications@slop.cash",
        sendEmail: async (from: string, to: string, mime: string) => {
          const id =
            /^Message-ID: <slop-notice-(.+)-[0-9]+@slop\.cash>\r?$/mu.exec(
              mime,
            )?.[1];
          if (!id)
            throw new Error("Local capture message has no delivery identity");
          const recipients = (
            await options.db
              .prepare(`SELECT github_id FROM notification_email_verifications WHERE id=?
            UNION SELECT recipient_github_id AS github_id FROM security_notification_outbox WHERE id=?
            UNION SELECT recipient_github_id AS github_id FROM activity_notification_outbox WHERE id=?`)
              .bind(id, id, id)
              .all<{ github_id: string }>()
          ).results;
          if (recipients.length !== 1)
            throw new Error("Local capture message has ambiguous ownership");
          await options.capture({
            githubId: recipients[0].github_id,
            from,
            to,
            mime,
          });
        },
      }
    : null;
  return {
    async dispatch(): Promise<void> {
      if (!options || !enrollment) return;
      const deps = {
        ...enrollment,
        config: { inboxUrl: options.inboxUrl, recipients: {} },
        generalEmail: true,
        repositoryAccess: options.repositoryAccess,
        adminGithubIds: options.adminGithubIds,
        moderatorGithubIds: options.moderatorGithubIds,
      };
      await Promise.all([
        dispatchActivityMail(deps),
        dispatchSecurityMail(deps),
      ]);
    },
    async fetch(request: Request): Promise<Response> {
      const response = await handleEnrollmentMailRequest(request, enrollment);
      if (response) return response;
      const url = new URL(request.url);
      if (
        url.origin !== "https://notify.internal" ||
        request.method !== "POST" ||
        url.pathname !== "/v1/activity-notifications/eligibility"
      )
        return new Response("Not found", { status: 404 });
      const body = (await request.json()) as { githubId?: unknown };
      if (typeof body.githubId !== "string" || !/^\d+$/u.test(body.githubId))
        return Response.json({ error: "invalid_request" }, { status: 400 });
      if (options) {
        const destination = await enrolledDestination(
          options.db,
          body.githubId,
        );
        return Response.json(
          destination
            ? {
                available: true,
                email: destination.email,
                destinationVersion: destination.destinationVersion,
              }
            : { available: false },
        );
      }
      const account = login(body.githubId);
      if (!account) return Response.json({ available: false });
      const email = `${account}@example.invalid`;
      return Response.json({
        available: true,
        email,
        // Changes with the address, so a renamed account must opt in again.
        destinationVersion: createHash("sha256")
          .update(`${body.githubId}:${email}`)
          .digest("hex"),
      });
    },
  };
}
