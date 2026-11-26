// spec/operations/notifications.md, "Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment"; spec/operations/notifications.md, "The Inbox shows one delivery word and never the address, digest, provider reference or attempt count"
import type { EmailDelivery, InboxNotice, NotificationKind } from "@repo/operations/client";

export interface NoticePresentation {
  readonly title: string;
  readonly action: string;
}

type Notice = Pick<InboxNotice, "eventKey" | "subject" | "actionPath">;

const disputeKey = "slopbot-points-dispute:";

function present(title: string, action: string): NoticePresentation {
  return { title, action };
}

const restricted = (state: string) => (n: Notice) => present(`${n.subject} ${state}`, n.actionPath === "/admin" ? "Open admin" : "Open project");

function payoutException(n: Notice): NoticePresentation {
  if (n.eventKey.startsWith("monthly-underfunded:")) return present(`${n.subject} awards underfunded`, "Open monthly awards");
  if (n.eventKey.startsWith("monthly-cut:")) return present(`${n.subject} owner cut your monthly amount`, "Open month");
  return present(`${n.subject} payout held`, "Open project");
}

const appeal = (dispute: string, contribution: string) => (n: Notice) =>
  n.eventKey.startsWith(disputeKey) ? present(dispute, "Open Points review") : present(contribution, "Open appeal on GitHub");

function projectRevision(n: Notice): NoticePresentation {
  if (n.eventKey.startsWith("security-queue:")) return present(`${n.subject} reports are waiting`, "Open Inbox");
  if (n.eventKey.startsWith("backlog-rule:")) {
    return present(n.eventKey.includes(":out:") ? `${n.subject} is out of rotation` : `${n.subject}: backlog notice`, "Open settings");
  }
  return present(`${n.subject} settings changed`, "Open project");
}

const presentations: Readonly<Record<NotificationKind, (n: Notice) => NoticePresentation>> = {
  application_approved: (n) => present(`${n.subject} added`, "Open project"),
  application_rejected: (n) => present(`${n.subject} not added`, "Add a project"),
  project_ready: (n) => present(`${n.subject} is open`, "Open project"),
  project_scan_failed: (n) => present(`${n.subject} scan failed`, "Open project"),
  project_installation_lost: (n) => present(`${n.subject}: reinstall Slopbot`, "Open project"),
  project_revision: projectRevision,
  award_reserved: (n) => present(`${n.subject} award reserved`, "Open payouts"),
  payment_paid: (n) => present(`${n.subject} payment paid`, "Open payouts"),
  payout_held: (n) => present(`${n.subject} payout held`, "Open payouts"),
  wallet_changed: (n) => present(`${n.subject} wallet added`, "Review wallets"),
  trace_licensing_available: () => present("Trace licensing is available", "Review trace licensing"),
  project_quarantined: restricted("quarantined"),
  project_banned: restricted("banned"),
  reinstatement_requested: (n) => present(`${n.subject} reinstatement in review`, "Open project"),
  project_reinstated: (n) => present(`${n.subject} reinstated`, "Open project"),
  reinstatement_denied: (n) => present(`${n.subject} reinstatement denied`, "Open project"),
  reinstatement_review: (n) => present(`Review ${n.subject} reinstatement`, "Open admin"),
  payout_exception: payoutException,
  security_case: (n) => present(`Case ${n.subject} updated`, "Open security cases"),
  security_report_received: (n) => present(`Report ${n.subject} received`, "Open security cases"),
  slopbot_appeal_review: appeal("Points dispute to review", "Appeal to decide"),
  slopbot_appeal_resolved: appeal("Points dispute resolved", "Appeal resolved"),
  slopbot_scam_review: (n) => present(`${n.subject} scam closure: review author`, "Open closed item on GitHub"),
};

const deliveryLabels: Readonly<Record<EmailDelivery, string>> = {
  queued: "Email: queued",
  sent: "Email: sent",
  delivered: "Email: delivered",
  failed: "Email: failed",
  uncertain: "Email: uncertain",
};

/** @throws {never} */
export function noticePresentation(notice: Pick<InboxNotice, "kind" | "eventKey" | "subject" | "actionPath">): NoticePresentation {
  return presentations[notice.kind](notice);
}

/** @throws {never} */
export function emailDeliveryLabel(delivery: EmailDelivery): string {
  return deliveryLabels[delivery];
}
