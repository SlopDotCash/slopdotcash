/** In-app inbox contract shared by the API and the page (PRD NOT-01). */

/**
 * Every inbox kind (migrations 0063, 0065 and 0079). Writers live in
 * backend/notifications/events.ts. `application_approved` and
 * `application_rejected` came from the removed admin admission path and
 * stay readable as history.
 */
const NOTIFICATION_KINDS = [
  "application_approved",
  "application_rejected",
  "project_ready",
  "project_scan_failed",
  "project_installation_lost",
  "project_revision",
  "award_reserved",
  "payment_paid",
  "payout_held",
  "wallet_changed",
  "project_quarantined",
  "project_banned",
  "reinstatement_requested",
  "project_reinstated",
  "reinstatement_denied",
  "reinstatement_review",
  "payout_exception",
  "security_case",
  "security_report_received",
  "slopbot_appeal_review",
  "slopbot_appeal_resolved",
  "slopbot_scam_review",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * The recipient-visible email outcome of one notice (PRD section 9). `sent`
 * means the provider accepted the message, never that it reached an inbox;
 * only independent receipt evidence makes it `delivered`. `uncertain` is a
 * send whose outcome is unknown until it is reconciled.
 */
export const EMAIL_DELIVERY_STATES = [
  "queued",
  "sent",
  "delivered",
  "failed",
  "uncertain",
] as const;

export type EmailDelivery = (typeof EMAIL_DELIVERY_STATES)[number];

export interface Notification {
  /** Stable source event identity; a replay of the event reuses it. */
  eventKey: string;
  kind: NotificationKind;
  /**
   * The project id, the network for a wallet change, or the private case
   * reference for a security case.
   */
  subject: string;
  detail: string | null;
  /** A same-site path that opens the details. */
  actionPath: string;
  /** When the source change happened. */
  sourceAt: string;
  createdAt: string;
  readAt: string | null;
  /** Security-event acknowledgment is separate from the inbox read state. */
  acknowledgedAt?: string | null;
  /** Present only when an email delivery for this notice exists. */
  emailDelivery?: EmailDelivery;
}

export interface NotificationsResponse {
  /** The authenticated recipient of this response and its private inbox. */
  recipientGithubId: string;
  notifications: Notification[];
  unread: number;
  nextCursor?: string | null;
}

/** The most event keys one read request may mark. */
export const MAX_NOTIFICATION_MARK = 100;

export function isNotificationEventKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 300 &&
    /^[a-z-]+:[\x21-\x7e]+$/u.test(value)
  );
}

const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

function isNotification(value: unknown): value is Notification {
  if (typeof value !== "object" || value === null) return false;
  const n = value as Record<string, unknown>;
  return (
    isNotificationEventKey(n.eventKey) &&
    NOTIFICATION_KINDS.includes(n.kind as NotificationKind) &&
    typeof n.subject === "string" &&
    n.subject.length > 0 &&
    (n.detail === null || typeof n.detail === "string") &&
    typeof n.actionPath === "string" &&
    n.actionPath.startsWith("/") &&
    !n.actionPath.startsWith("//") &&
    isTimestamp(n.sourceAt) &&
    isTimestamp(n.createdAt) &&
    (n.readAt === null || isTimestamp(n.readAt)) &&
    (n.acknowledgedAt === undefined ||
      n.acknowledgedAt === null ||
      isTimestamp(n.acknowledgedAt)) &&
    (n.emailDelivery === undefined ||
      EMAIL_DELIVERY_STATES.includes(n.emailDelivery as EmailDelivery))
  );
}

/** A stable boundary keeps new notifications from shifting older pages. */
export function notificationCursor(value: string): [string, string] {
  if (value.length > 500) throw new Error("Invalid notification cursor");
  const parts: unknown = JSON.parse(value);
  if (
    !Array.isArray(parts) ||
    parts.length !== 2 ||
    !isTimestamp(parts[0]) ||
    !isNotificationEventKey(parts[1])
  )
    throw new Error("Invalid notification cursor");
  return [parts[0], parts[1]];
}

/** Rejects any response that does not match the contract exactly. */
export function parseNotificationsResponse(
  value: unknown,
): NotificationsResponse {
  const body = value as Partial<NotificationsResponse> | null;
  if (
    typeof body !== "object" ||
    body === null ||
    typeof body.recipientGithubId !== "string" ||
    !/^[1-9][0-9]{0,19}$/u.test(body.recipientGithubId) ||
    !Array.isArray(body.notifications) ||
    !body.notifications.every(isNotification) ||
    !Number.isSafeInteger(body.unread) ||
    (body.unread as number) < 0
  )
    throw new Error("The inbox returned an invalid response.");
  if (body.nextCursor !== undefined && body.nextCursor !== null) {
    if (typeof body.nextCursor !== "string")
      throw new Error("Invalid notification cursor");
    notificationCursor(body.nextCursor);
  }
  return body as NotificationsResponse;
}

/** One plain sentence for each event kind. */
export function notificationTitle(n: Notification): string {
  switch (n.kind) {
    case "application_approved":
      return `${n.subject} was added to Slop.`;
    case "application_rejected":
      return `${n.subject} was not added to Slop.`;
    case "project_ready":
      return `The ${n.subject} project is open to contributors.`;
    case "project_scan_failed":
      return `The security scan of ${n.subject} could not finish. Contributor work stays closed until a scan passes.`;
    case "project_installation_lost":
      return `Slopbot is no longer installed on a ${n.subject} repository. Install it again so reviews continue.`;
    case "project_revision":
      return `The ${n.subject} project settings changed.`;
    case "award_reserved":
      return `An award from ${n.subject} is reserved for you.`;
    case "payment_paid":
      return `A payment from ${n.subject} is finalized.`;
    case "payout_held":
      return `A payout from ${n.subject} is held.`;
    case "wallet_changed":
      return `A ${n.subject} payout wallet was added to your account.`;
    case "project_quarantined":
      return `The ${n.subject} project is quarantined. It is paused and not listed.`;
    case "project_banned":
      return `The ${n.subject} project is banned. It is paused and not listed.`;
    case "reinstatement_requested":
      return `A reinstatement request for ${n.subject} is open for independent review.`;
    case "project_reinstated":
      return `The ${n.subject} project is reinstated.`;
    case "reinstatement_denied":
      return `The reinstatement request for ${n.subject} was denied.`;
    case "reinstatement_review":
      return `A reinstatement request for ${n.subject} needs your independent review.`;
    case "payout_exception":
      return n.eventKey.startsWith("monthly-underfunded:")
        ? `The ${n.subject} monthly awards are underfunded.`
        : `A payout from ${n.subject} is held and needs attention.`;
    case "slopbot_appeal_review":
      return n.eventKey.startsWith("slopbot-points-dispute:")
        ? "A Points dispute is awaiting review."
        : "A contribution appeal needs your decision on GitHub.";
    case "slopbot_appeal_resolved":
      return n.eventKey.startsWith("slopbot-points-dispute:")
        ? "The Points dispute was resolved."
        : "The contribution appeal was resolved.";
    case "slopbot_scam_review":
      return `Slopbot closed a ${n.subject} contribution as a scam. Review the author's account.`;
    case "security_case":
      return `Private security case ${n.subject} changed.`;
    case "security_report_received":
      return `Your private report ${n.subject} was received.`;
  }
}

/** The label of the link that opens the details. */
export function notificationAction(n: Notification): string {
  switch (n.kind) {
    case "project_banned":
    case "project_quarantined":
      // Moderators get the same event with an admin link (contributor flags).
      return n.actionPath === "/admin" ? "Open admin" : "Open project";
    case "application_approved":
    case "project_revision":
    case "reinstatement_requested":
    case "project_reinstated":
    case "reinstatement_denied":
      return "Open project";
    case "payout_exception":
      return n.eventKey.startsWith("monthly-underfunded:")
        ? "Open monthly awards"
        : "Open project";
    case "reinstatement_review":
      return "Open admin";
    case "project_ready":
    case "project_scan_failed":
    case "project_installation_lost":
      return "Open project";
    case "slopbot_appeal_review":
    case "slopbot_appeal_resolved":
      return n.eventKey.startsWith("slopbot-points-dispute:")
        ? "Open Points review"
        : "Open appeal on GitHub";
    case "slopbot_scam_review":
      return "Open closed item on GitHub";
    case "security_case":
    case "security_report_received":
      return "Open security cases";
    case "application_rejected":
      return "Add a project";
    case "award_reserved":
    case "payment_paid":
    case "payout_held":
      return "Open payouts";
    case "wallet_changed":
      return "Review wallets";
  }
}

/** One plain label for the email outcome; read and acknowledged stay separate. */
export function emailDeliveryLabel(state: EmailDelivery): string {
  switch (state) {
    case "queued":
      return "Email: queued";
    case "sent":
      return "Email: sent";
    case "delivered":
      return "Email: delivered";
    case "failed":
      return "Email: failed";
    case "uncertain":
      return "Email: uncertain";
  }
}
