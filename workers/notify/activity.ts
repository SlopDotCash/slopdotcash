/** NOT-01 optional activity delivery; essential wallet notices do not use the activity preference. */

import {
  enrolledDestination,
  issueEmailUnsubscribeToken,
} from "../../backend/notifications/email-destinations";
import {
  PROJECT_AFFECTED_CONTRIBUTORS,
  PROJECT_OWNERS,
} from "../../backend/notifications/events";
import type { SecurityD1Database } from "../../backend/security/handler";
import { retryableEmailRejection, SENDER_ADDRESS } from "./contracts";
import {
  claimDueDeliveries,
  destinationDigest,
  inboxNoticeMime,
  parseMailPilotConfig,
  recordDelivery,
  retryWithoutProviderCall,
} from "./security";

type VerifiedDestination = {
  email: string;
  verifiedAt: string;
  evidenceReference: string;
};
export type ActivityMailConfig = {
  inboxUrl: string;
  recipients: Record<string, VerifiedDestination>;
};
export type ActivityMailDependencies = {
  db: SecurityD1Database;
  adminGithubIds?: ReadonlySet<string>;
  moderatorGithubIds?: ReadonlySet<string>;
  config: ActivityMailConfig;
  generalEmail?: boolean;
  unsubscribeKey?: string;
  fromAddress: string;
  now(): Date;
  sendEmail(from: string, to: string, mime: string): Promise<void>;
};
export function parseActivityMailConfig(
  raw: string,
): ActivityMailConfig | null {
  return parseMailPilotConfig(raw, false) as ActivityMailConfig | null;
}
export async function activityMailEligibility(
  config: ActivityMailConfig,
  githubId: string,
  now: Date,
) {
  const destination = config.recipients[githubId];
  if (!destination || Date.parse(destination.verifiedAt) > now.getTime())
    return { available: false } as const;
  return {
    available: true,
    email: destination.email,
    destinationVersion: await destinationDigest(destination),
  } as const;
}

/** Owner notices that name the project in `subject` (migration 0029). */
const PROJECT_OWNER_KINDS = new Set([
  "project_ready",
  "project_revision",
  "project_scan_failed",
  "project_installation_lost",
  "project_quarantined",
  "project_banned",
  "reinstatement_requested",
  "project_reinstated",
  "reinstatement_denied",
]);

/**
 * PRD section 9: recheck roles before sending. A payout exception mails only
 * the project's current GitHub steward, and an owner notice only a current
 * owner. A vetting ban also reaches its current affected contributors and
 * staff; the shared event key can retain an owner link for a staff recipient.
 * A contributor-flag pause reaches current staff and owners.
 */
async function stillProjectRecipient(
  db: SecurityD1Database,
  row: Delivery,
  currentStaff: boolean,
): Promise<boolean> {
  const notice = await db
    .prepare(
      `SELECT n.kind,
              n.action_path,
              n.recipient_github_id = (
                SELECT json_extract(manifest, '$.steward.github.actorId')
                  FROM projects WHERE id = n.subject
              ) AS steward,
              n.recipient_github_id IN ${PROJECT_OWNERS("n.subject")} AS owner,
              EXISTS (
                SELECT 1 FROM project_enforcements e
                 WHERE e.id = substr(n.event_key, length('project-enforcement:') + 1)
                   AND n.event_key = 'project-enforcement:' || e.id
                   AND e.project_id = n.subject AND e.action = 'ban'
                   AND e.actor_role = 'vetting-service'
              ) AS vetting_ban,
              n.recipient_github_id IN ${PROJECT_AFFECTED_CONTRIBUTORS("n.subject")} AS affected_contributor
         FROM notifications n
        WHERE n.event_key = ? AND n.recipient_github_id = ?`,
    )
    .bind(row.event_key, row.recipient_github_id)
    .first<{
      kind: string;
      action_path: string;
      steward: number | null;
      owner: number | null;
      vetting_ban: number;
      affected_contributor: number;
    }>();
  if (!notice) return true;
  if (notice.kind === "payout_exception") return notice.steward === 1;
  // The owner writer can win the shared event key before the staff writer.
  // Recheck the actual audience, not the link that happened to be retained.
  if (notice.kind === "project_banned" && notice.vetting_ban === 1)
    return (
      notice.owner === 1 || notice.affected_contributor === 1 || currentStaff
    );
  // A staff copy links to `/admin`, as the contributor-flag pause notice to
  // the configured administrators and moderators does. It mails only current
  // staff, or a recipient who still owns the project.
  if (PROJECT_OWNER_KINDS.has(notice.kind))
    return (
      notice.owner === 1 || (notice.action_path === "/admin" && currentStaff)
    );
  return true;
}

type Delivery = {
  id: string;
  event_key: string;
  recipient_github_id: string;
  essential: number;
  destination_version: string | null;
  attempts: number;
};
export async function dispatchActivityMail(
  deps: ActivityMailDependencies,
): Promise<void> {
  if (!SENDER_ADDRESS.test(deps.fromAddress))
    throw new Error("Invalid mail sender");
  const now = deps.now();
  for await (const row of claimDueDeliveries<Delivery>(
    deps.db,
    "activity",
    deps.now,
  )) {
    if (row.event_key.startsWith("slopbot-appeal:")) {
      const appeal = await deps.db
        .prepare(
          "SELECT appellant_github_id, resolved_at FROM slopbot_appeals WHERE appeal_key = ? AND escalated_at IS NOT NULL",
        )
        .bind(row.event_key.slice("slopbot-".length))
        .first<{ appellant_github_id: string; resolved_at: string | null }>();
      if (
        !deps.moderatorGithubIds?.has(row.recipient_github_id) ||
        !appeal ||
        appeal.resolved_at !== null ||
        appeal.appellant_github_id === row.recipient_github_id
      ) {
        await recordDelivery(deps, row, "suppressed", null, "activity");
        continue;
      }
    }
    // A scam-closure account review (owner decision D4) mails only a current
    // moderator, never the author, and only while its penalty stands.
    if (row.event_key.startsWith("slopbot-scam-review:")) {
      const penalty = await deps.db
        .prepare(
          "SELECT author_github_id, reversed_at FROM slopbot_penalties WHERE item_node_id = ? AND category = 'scam' AND moderator_review = 1",
        )
        .bind(row.event_key.slice("slopbot-scam-review:".length))
        .first<{ author_github_id: string; reversed_at: string | null }>();
      if (
        !deps.moderatorGithubIds?.has(row.recipient_github_id) ||
        !penalty ||
        penalty.reversed_at !== null ||
        penalty.author_github_id === row.recipient_github_id
      ) {
        await recordDelivery(deps, row, "suppressed", null, "activity");
        continue;
      }
    }
    // A reinstatement review (ELG-02) asks the moderators who may decide the
    // request. A removed moderator no longer belongs to that audience.
    if (
      row.event_key.startsWith("reinstatement-review:") &&
      !deps.moderatorGithubIds?.has(row.recipient_github_id)
    ) {
      await recordDelivery(deps, row, "suppressed", null, "activity");
      continue;
    }
    if (
      !(await stillProjectRecipient(
        deps.db,
        row,
        deps.adminGithubIds?.has(row.recipient_github_id) === true ||
          deps.moderatorGithubIds?.has(row.recipient_github_id) === true,
      ))
    ) {
      await recordDelivery(deps, row, "suppressed", null, "activity");
      continue;
    }
    const registered = deps.generalEmail
      ? await enrolledDestination(deps.db, row.recipient_github_id)
      : null;
    const destination = registered
      ? { available: true, ...registered }
      : await activityMailEligibility(
          deps.config,
          row.recipient_github_id,
          now,
        );
    const preference = await deps.db
      .prepare(
        "SELECT enabled,security_enabled,destination_version FROM notification_email_preferences WHERE github_id=?",
      )
      .bind(row.recipient_github_id)
      .first<{
        enabled: number;
        security_enabled: number | null;
        destination_version: string | null;
      }>();
    // An essential notice whose operator-verified record is not yet in effect
    // made no provider call: retry it on the bounded schedule. Optional mail
    // never retries here, because its consent names one effective destination.
    if (
      !destination.available &&
      row.essential &&
      deps.config.recipients[row.recipient_github_id]
    ) {
      await retryWithoutProviderCall(deps, row, "activity");
      continue;
    }
    if (
      !destination.available ||
      (row.essential && preference?.security_enabled === 0) ||
      (registered &&
        (row.destination_version !== registered.destinationVersion ||
          (row.essential && preference?.security_enabled !== 1))) ||
      (!row.essential &&
        (preference?.enabled !== 1 ||
          preference.destination_version !== destination.destinationVersion ||
          row.destination_version !== destination.destinationVersion))
    ) {
      await recordDelivery(deps, row, "suppressed", null, "activity");
      continue;
    }
    // Recipient and consent are resolved on the server immediately before this one-recipient send.
    await deps.db
      .prepare(
        "UPDATE activity_notification_outbox SET destination_digest=? WHERE id=?",
      )
      .bind(destination.destinationVersion, row.id)
      .run();
    const text = row.essential
      ? "Your Slop account has a security notice."
      : "Your Slop inbox has an activity update.";
    const unsubscribeToken =
      registered && deps.unsubscribeKey
        ? await issueEmailUnsubscribeToken(
            deps.db,
            deps.unsubscribeKey,
            registered.destinationVersion,
            deps.now(),
          )
        : null;
    const mime = inboxNoticeMime({
      from: deps.fromAddress,
      to: destination.email,
      subject: "Slop inbox notice",
      date: now,
      deliveryId: row.id,
      attempt: row.attempts + 1,
      ...(unsubscribeToken
        ? {
            unsubscribeUrl: `${new URL(deps.config.inboxUrl).origin}/api/v1/notifications/email/unsubscribe?token=${unsubscribeToken}`,
          }
        : {}),
      text: `${text}\n\nSign in: ${deps.config.inboxUrl}\n\nDo not reply with approvals, evidence or payment details.\n${unsubscribeToken ? `\nStop email notifications: ${deps.config.inboxUrl}#unsubscribe-email=${unsubscribeToken}\n` : ""}`,
    });
    try {
      await deps.sendEmail(deps.fromAddress, destination.email, mime);
    } catch (error) {
      if (retryableEmailRejection(error)) {
        await retryWithoutProviderCall(deps, row, "activity");
        continue;
      }
      // The binding gives no definite non-acceptance receipt. The outcome stays
      // uncertain until independent evidence reconciles it; only `not-accepted`
      // evidence permits the next bounded attempt.
      await recordDelivery(deps, row, "ambiguous", null, "activity");
      continue;
    }
    await recordDelivery(deps, row, "provider-accepted", null, "activity");
  }
}
