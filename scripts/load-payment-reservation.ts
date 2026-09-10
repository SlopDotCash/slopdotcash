import { readPaymentSignerHistory } from "./payment-signer-history";
/** Phase-two authenticated input loader. Only protected origin/develop is authoritative.
 * This returns fixed reserved inputs, NOT payment readiness or releasable output:
 * prepare-settlement-plan runs live configuration/balance and the
 * complete authenticated signer ledger before releasing these exact bytes.
 * No callback accepts a caller-asserted positive capability or local reservation. */

import { fundingReviewProposalSha256 } from "../src/lib/funding-review-submission";
import {
  assertPaymentReservationTransition,
  PAYMENT_RESERVATION_PATH,
  reservedPlanBytes,
} from "../src/lib/payment-reservations";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import {
  assertReservationInstrument,
  reviewedReservationPolicy,
} from "./check-payment-reservations";
import { verifyHistoricalPaymentAdmission } from "./payment-admission";
import {
  gitReservationBlob,
  gitReservationLedger,
  reservationGit,
  reservationJson,
  verifyPaymentAuthority,
} from "./payment-reservation-history";
import { assertSignerCapabilityForSettlement } from "./signer-access-ledger";

export async function loadCanonicalPaymentReservation(
  root: string,
  projectId: string,
  cycleId: string,
) {
  if (
    !/^[a-z0-9][a-z0-9-]{0,47}$/u.test(projectId) ||
    !/^\d{4}-(0[1-9]|1[0-2])$/u.test(cycleId)
  )
    throw new TypeError("Invalid reservation selection");
  const revision = verifyPaymentAuthority(root);
  await verifyHistoricalPaymentAdmission(root, revision);
  const commits = reservationGit(root, [
    "rev-list",
    "--first-parent",
    "--reverse",
    revision,
    "--",
    PAYMENT_RESERVATION_PATH,
  ])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  if (commits.length > 24000)
    throw new TypeError("Reservation history exceeds bound");
  let previous: ReturnType<typeof gitReservationLedger> = [];
  if (!commits.length)
    throw new TypeError("No accepted global reservation history");
  for (const sha of commits) {
    const next = gitReservationLedger(root, sha);
    assertPaymentReservationTransition(previous, next);
    previous = next;
  }
  const ledger = gitReservationLedger(root, revision);
  assertPaymentReservationTransition(previous, ledger);
  const reservation = ledger.find(
    (r) => r.projectId === projectId && r.cycleId === cycleId,
  );
  if (!reservation)
    throw new TypeError(
      "No reservation merged on protected canonical develop; branch/local plans are not releasable",
    );
  const project = assertProjectDefinition(
    reservationJson(
      gitReservationBlob(root, revision, `projects/${projectId}/project.json`),
    ),
  );
  if (
    (project as { reward?: { paymentMode?: string } }).reward?.paymentMode !==
    "enabled"
  )
    throw new TypeError(
      "Payments remain disabled; a reservation does not activate the project",
    );
  const { policy, instrument, instrumentBytes } =
    reviewedReservationPolicy(project);
  const allocationBytes = gitReservationBlob(
    root,
    revision,
    `cycles/${projectId}/${cycleId}/allocation.json`,
  );
  const allocation = reservationJson(allocationBytes) as {
    projectId: string;
    cycleId: string;
    fundingBasis?: { instrumentId: string | null };
  };
  assertReservationInstrument(instrument, allocation, reservation, policy);
  // Authenticates EVERY accepted report including historical loss. Filtering
  // before authentication would permit omitted loss or forged current reports.
  const now = new Date().toISOString();
  if (now < policy.effectiveAt || now >= policy.planningExpiresAt)
    throw new TypeError(
      "Payment policy is not current; accepted reservations remain held",
    );
  const { ledger: signerLedger } = await readPaymentSignerHistory({
    root,
    baseSha: revision,
    headSha: revision,
    now,
  });
  for (const report of signerLedger.reports) {
    if (
      report.projectId !== projectId ||
      report.cycleId !== cycleId ||
      report.instrumentId !== reservation.instrumentId
    )
      continue;
    if (
      report.member !==
        (report.role === "funder"
          ? instrument.funderMember
          : instrument.stewardMember) ||
      report.actorId !==
        (report.role === "funder"
          ? instrument.funderActorId
          : instrument.stewardGithub?.actorId)
    )
      throw new TypeError(
        "Signer evidence differs from current exact reviewed members",
      );
  }
  assertSignerCapabilityForSettlement(signerLedger, allocation, now);
  const fixedPlanBytes = await reservedPlanBytes(
    reservation,
    allocationBytes,
    policy,
  );
  const existing = gitReservationBlob(
    root,
    revision,
    `cycles/${projectId}/${cycleId}/execution-plan.json`,
    true,
  );
  if (
    existing &&
    (await fundingReviewProposalSha256(existing)) !== reservation.planSha256
  )
    throw new TypeError("Published plan conflicts with permanent reservation");
  // A newly accepted loss, policy disable, or ref movement invalidates this load.
  if (verifyPaymentAuthority(root) !== revision)
    throw new TypeError(
      "Canonical history moved during verification; retry without changing the reservation",
    );
  return {
    revision,
    ledger,
    reservation,
    allocationBytes,
    policy,
    instrument,
    instrumentBytes,
    signerLedger,
    fixedPlanBytes,
  };
}
