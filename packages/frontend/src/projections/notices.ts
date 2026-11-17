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

const restricted = (state: string) => (n: Notice) => present(`The ${n.subject} project is ${state}. It is paused and not listed.`, n.actionPath === "/admin" ? "Open admin" : "Open project");

function payoutException(n: Notice): NoticePresentation {
  if (n.eventKey.startsWith("monthly-underfunded:")) return present(`The ${n.subject} monthly awards are underfunded.`, "Open monthly awards");
  if (n.eventKey.startsWith("monthly-cut:")) return present(`The ${n.subject} owner set your monthly amount below the proposed amount.`, "Open month");
  return present(`A payout from ${n.subject} is held and needs attention.`, "Open project");
}

const appeal = (dispute: string, contribution: string) => (n: Notice) =>
  n.eventKey.startsWith(disputeKey) ? present(dispute, "Open Points review") : present(contribution, "Open appeal on GitHub");

const presentations: Readonly<Record<NotificationKind, (n: Notice) => NoticePresentation>> = {
  application_approved: (n) => present(`${n.subject} was added to Slop.`, "Open project"),
  application_rejected: (n) => present(`${n.subject} was not added to Slop.`, "Add a project"),
  project_ready: (n) => present(`The ${n.subject} project is open to contributors.`, "Open project"),
  project_scan_failed: (n) => present(`The security scan of ${n.subject} did not clear. Contributor work stays closed until a scan passes.`, "Open project"),
  project_installation_lost: (n) => present(`Slopbot is no longer installed on a ${n.subject} repository. Install it again so reviews continue.`, "Open project"),
  project_revision: (n) => present(`The ${n.subject} project settings changed.`, "Open project"),
  award_reserved: (n) => present(`An award from ${n.subject} is reserved for you.`, "Open payouts"),
  payment_paid: (n) => present(`A payment from ${n.subject} is finalized.`, "Open payouts"),
  payout_held: (n) => present(`A payout from ${n.subject} is held.`, "Open payouts"),
  wallet_changed: (n) => present(`A ${n.subject} payout wallet was added to your account.`, "Review wallets"),
  project_quarantined: restricted("quarantined"),
  project_banned: restricted("banned"),
  reinstatement_requested: (n) => present(`A reinstatement request for ${n.subject} is open for independent review.`, "Open project"),
  project_reinstated: (n) => present(`The ${n.subject} project is reinstated.`, "Open project"),
  reinstatement_denied: (n) => present(`The reinstatement request for ${n.subject} was denied.`, "Open project"),
  reinstatement_review: (n) => present(`A reinstatement request for ${n.subject} needs your independent review.`, "Open admin"),
  payout_exception: payoutException,
  security_case: (n) => present(`Private security case ${n.subject} changed.`, "Open security cases"),
  security_report_received: (n) => present(`Your private report ${n.subject} was received.`, "Open security cases"),
  slopbot_appeal_review: appeal("A Points dispute is awaiting review.", "A contribution appeal needs your decision on GitHub."),
  slopbot_appeal_resolved: appeal("The Points dispute was resolved.", "The contribution appeal was resolved."),
  slopbot_scam_review: (n) => present(`Slopbot closed a ${n.subject} contribution as a scam. Review the author's account.`, "Open closed item on GitHub"),
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
