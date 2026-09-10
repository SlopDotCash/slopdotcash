/** Drafts only a reviewable global ledger append. Never releases unsigned plans. */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPaymentReservationTransition,
  draftPaymentReservation,
  paymentRecordBytes,
  reservedPlanBytes,
} from "../src/lib/payment-reservations";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import {
  assertNoHistoricalInstrumentUse,
  assertReservationInstrument,
  reviewedReservationPolicy,
} from "./check-payment-reservations";
import { verifyHistoricalPaymentAdmission } from "./payment-admission";
import {
  gitReservationBlob,
  gitReservationLedger,
  reservationJson,
  verifyPaymentAuthority,
} from "./payment-reservation-history";
import { writeNewFile } from "./write-new-file";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function parsePaymentReservationArguments(
  values: string[],
  now = new Date().toISOString(),
) {
  const args: Record<string, string> = {};
  for (let i = 0; i < values.length; i += 2) {
    const flag = values[i];
    const value = values[i + 1];
    if (
      !["--project", "--cycle", "--reserved-at", "--output"].includes(flag) ||
      args[flag] ||
      !value ||
      value.startsWith("--")
    )
      throw new TypeError(
        "Expected unique --project, --cycle, --output and optional --reserved-at",
      );
    args[flag] = value;
  }
  const reservedAt = args["--reserved-at"] ?? now;
  if (
    !/^[a-z0-9][a-z0-9-]{0,47}$/u.test(args["--project"] ?? "") ||
    !/^\d{4}-(0[1-9]|1[0-2])$/u.test(args["--cycle"] ?? "") ||
    !args["--output"] ||
    !Number.isFinite(Date.parse(reservedAt)) ||
    new Date(reservedAt).toISOString() !== reservedAt ||
    reservedAt > now
  )
    throw new TypeError("Invalid reservation selection, output or timestamp");
  return {
    projectId: args["--project"],
    cycleId: args["--cycle"],
    reservedAt,
    outputPath: resolve(args["--output"]),
  };
}
export async function preparePaymentReservation(
  args: ReturnType<typeof parsePaymentReservationArguments>,
) {
  const revision = verifyPaymentAuthority(ROOT);
  await verifyHistoricalPaymentAdmission(ROOT, revision);
  const project = assertProjectDefinition(
    reservationJson(
      gitReservationBlob(
        ROOT,
        revision,
        `projects/${args.projectId}/project.json`,
      ),
    ),
  );
  if (
    project.reward.kind !== "monthly-pool" ||
    project.reward.paymentMode !== "enabled"
  )
    throw new TypeError("Reviewed fresh-cycle payments are not enabled");
  const { policy, instrument } = reviewedReservationPolicy(project);
  const now = new Date().toISOString();
  if (
    now < policy.effectiveAt ||
    now >= policy.planningExpiresAt ||
    args.reservedAt > now
  )
    throw new TypeError("Reservation policy is not current");
  const allocation = gitReservationBlob(
    ROOT,
    revision,
    `cycles/${args.projectId}/${args.cycleId}/allocation.json`,
  );
  const ledger = gitReservationLedger(ROOT, revision);
  const existing = ledger.find(
    (r) => r.projectId === args.projectId && r.cycleId === args.cycleId,
  );
  const row =
    existing ??
    (await draftPaymentReservation(allocation, policy, args.reservedAt));
  assertReservationInstrument(
    instrument,
    reservationJson(allocation),
    row,
    policy,
  );
  if (existing) {
    // Validate frozen input bytes; never replace an accepted intent or timestamp.
    await reservedPlanBytes(existing, allocation, policy);
  } else {
    assertNoHistoricalInstrumentUse(
      ROOT,
      revision,
      row.instrumentId,
      `${args.projectId}/${args.cycleId}`,
    );
  }
  const candidate = existing ? ledger : [...ledger, row];
  assertPaymentReservationTransition(ledger, candidate);
  if (verifyPaymentAuthority(ROOT) !== revision)
    throw new TypeError(
      "Canonical history moved; regenerate the candidate from the new base",
    );
  await writeNewFile(
    args.outputPath,
    paymentRecordBytes(candidate),
    "Reservation output already exists; choose a new candidate path",
  );
  return {
    revision,
    existing: Boolean(existing),
    reservation: row,
    outputPath: args.outputPath,
  };
}
if (import.meta.main) {
  try {
    const result = await preparePaymentReservation(
      parsePaymentReservationArguments(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Reservation drafting failed"}\n`,
    );
    process.exitCode = 1;
  }
}
