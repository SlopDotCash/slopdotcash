//@ backend dafny
// spec/operations/notifications.md, "A replay of the same source change and recipient adds nothing"
import type { Kind } from "../../gen/operations__notifications.ts";

//@ pure
export function isStoredKind(stored: string): boolean {
  return stored === "application_approved" || stored === "application_rejected" || stored === "project_revision"
    || stored === "award_reserved" || stored === "payment_paid" || stored === "payout_held" || stored === "wallet_changed"
    || stored === "project_quarantined" || stored === "project_banned" || stored === "reinstatement_requested"
    || stored === "project_reinstated" || stored === "reinstatement_denied" || stored === "reinstatement_review"
    || stored === "payout_exception" || stored === "security_case" || stored === "project_ready"
    || stored === "project_scan_failed" || stored === "project_installation_lost" || stored === "security_report_received"
    || stored === "slopbot_appeal_review" || stored === "slopbot_scam_review" || stored === "trace_licensing_available";
}

//@ pure
export function storedKind(kind: Kind): string {
  //@ ensures isStoredKind(\result)
  if (kind === "ApplicationApproved") return "application_approved";
  if (kind === "ApplicationRejected") return "application_rejected";
  if (kind === "ProjectRevision") return "project_revision";
  if (kind === "AwardReserved") return "award_reserved";
  if (kind === "PaymentPaid") return "payment_paid";
  if (kind === "PayoutHeld") return "payout_held";
  if (kind === "WalletChanged") return "wallet_changed";
  if (kind === "ProjectQuarantined") return "project_quarantined";
  if (kind === "ProjectBanned") return "project_banned";
  if (kind === "ReinstatementRequested") return "reinstatement_requested";
  if (kind === "ProjectReinstated") return "project_reinstated";
  if (kind === "ReinstatementDenied") return "reinstatement_denied";
  if (kind === "ReinstatementReview") return "reinstatement_review";
  if (kind === "PayoutException") return "payout_exception";
  if (kind === "SecurityCase") return "security_case";
  if (kind === "ProjectReady") return "project_ready";
  if (kind === "ProjectScanFailed") return "project_scan_failed";
  if (kind === "ProjectInstallationLost") return "project_installation_lost";
  if (kind === "SecurityReportReceived") return "security_report_received";
  if (kind === "SlopbotAppealReview") return "slopbot_appeal_review";
  if (kind === "SlopbotScamReview") return "slopbot_scam_review";
  return "trace_licensing_available";
}

//@ pure
export function kindOfStored(stored: string): Kind {
  //@ requires isStoredKind(stored)
  //@ ensures storedKind(\result) === stored
  if (stored === "application_approved") return "ApplicationApproved";
  if (stored === "application_rejected") return "ApplicationRejected";
  if (stored === "project_revision") return "ProjectRevision";
  if (stored === "award_reserved") return "AwardReserved";
  if (stored === "payment_paid") return "PaymentPaid";
  if (stored === "payout_held") return "PayoutHeld";
  if (stored === "wallet_changed") return "WalletChanged";
  if (stored === "project_quarantined") return "ProjectQuarantined";
  if (stored === "project_banned") return "ProjectBanned";
  if (stored === "reinstatement_requested") return "ReinstatementRequested";
  if (stored === "project_reinstated") return "ProjectReinstated";
  if (stored === "reinstatement_denied") return "ReinstatementDenied";
  if (stored === "reinstatement_review") return "ReinstatementReview";
  if (stored === "payout_exception") return "PayoutException";
  if (stored === "security_case") return "SecurityCase";
  if (stored === "project_ready") return "ProjectReady";
  if (stored === "project_scan_failed") return "ProjectScanFailed";
  if (stored === "project_installation_lost") return "ProjectInstallationLost";
  if (stored === "security_report_received") return "SecurityReportReceived";
  if (stored === "slopbot_appeal_review") return "SlopbotAppealReview";
  if (stored === "slopbot_scam_review") return "SlopbotScamReview";
  return "TraceLicensingAvailable";
}
