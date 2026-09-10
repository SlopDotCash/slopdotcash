/** Runs only from an immutable trusted PR base. Head is data, never executed. */
import { createHash } from "node:crypto";
import { assertFreshCyclePaymentPolicy } from "../src/lib/fresh-cycle-policy.mjs";
import { assertFundingCommitments } from "../src/lib/funding-instruments.mjs";
import {
  assertPaymentReservationTransition,
  draftPaymentReservation,
  PAYMENT_RESERVATION_PATH,
} from "../src/lib/payment-reservations";
import { verifyUnsafeDestinationHistoryAuthorities } from "./check-unsafe-destination-transitions";
import {
  gitReservationBlob,
  gitReservationLedger,
  reservationGit,
  reservationJson,
} from "./payment-reservation-history";
import { readPaymentSignerHistory } from "./payment-signer-history";

export function reviewedReservationPolicy(project: unknown) {
  const p = project as {
    id: string;
    reward: { kind: string; reviewBudget?: unknown };
    funding: { freshCyclePaymentPolicy?: unknown; commitments?: unknown };
  };
  const policy = assertFreshCyclePaymentPolicy(
    p.funding?.freshCyclePaymentPolicy,
  );
  const instruments = assertFundingCommitments(p.funding.commitments ?? []);
  const matches = instruments.filter(
    (v) =>
      v.kind === "squads-v4-vault" &&
      v.replacedAt === null &&
      v.monthlyCommitment?.cycleId === policy.cycleId,
  );
  if (
    p.id !== policy.projectId ||
    p.reward.kind !== "monthly-pool" ||
    p.reward.reviewBudget ||
    matches.length !== 1
  )
    throw new TypeError(
      "Policy requires one exact Squads cycle without additive review budget",
    );
  const instrument = matches[0];
  if (instrument.kind !== "squads-v4-vault")
    throw new TypeError("Wrong instrument kind");
  // Bind manifest object bytes in a deterministic existing validator order.
  const instrumentBytes = new TextEncoder().encode(JSON.stringify(instrument));
  if (
    createHash("sha256").update(instrumentBytes).digest("hex") !==
    policy.instrumentSha256
  )
    throw new TypeError("Policy differs from exact reviewed instrument");
  return { policy, instrument, instrumentBytes };
}
/** Bind policy, allocation, reservation and derived plan source to one vault. */
export function assertReservationInstrument(
  instrument: ReturnType<typeof reviewedReservationPolicy>["instrument"],
  allocationValue: unknown,
  row: { instrumentId: string; projectId: string; cycleId: string },
  policy: ReturnType<typeof reviewedReservationPolicy>["policy"],
) {
  const allocation = allocationValue as {
    projectId?: string;
    cycleId?: string;
    fundingBasis?: { instrumentId?: string; cycleId?: string };
  };
  const identity = `squads-v4-vault:solana:${instrument.multisig}:${instrument.vaultIndex}:${instrument.vault}`;
  if (
    row.instrumentId !== identity ||
    allocation.fundingBasis?.instrumentId !== identity ||
    row.projectId !== policy.projectId ||
    row.cycleId !== policy.cycleId ||
    allocation.projectId !== policy.projectId ||
    allocation.cycleId !== policy.cycleId ||
    allocation.fundingBasis.cycleId !== policy.cycleId
  )
    throw new TypeError(
      "Policy, allocation and reservation must bind the exact reviewed instrument and cycle",
    );
}
/** No v1 retirement exists: inspect deleted and superseded global monetary records too. */
export function assertNoHistoricalInstrumentUse(
  root: string,
  base: string,
  instrumentId: string,
  allowedCycle?: string,
) {
  const commits = reservationGit(root, [
    "rev-list",
    "--first-parent",
    base,
    "--",
    "cycles",
  ])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  if (commits.length > 24000)
    throw new TypeError("Monetary history exceeds bound");
  const seen = new Set<string>();
  for (const sha of commits) {
    const paths = reservationGit(root, [
      "ls-tree",
      "-r",
      "--name-only",
      sha,
      "--",
      "cycles",
    ])
      .toString()
      .trim()
      .split("\n")
      .filter((p) =>
        /^cycles\/[a-z0-9-]+\/\d{4}-\d{2}\/(proposal|allocation|execution-plan)\.json$/u.test(
          p,
        ),
      );
    for (const path of paths) {
      const bytes = gitReservationBlob(root, sha, path);
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (seen.has(digest)) continue;
      seen.add(digest);
      const r = reservationJson(bytes) as {
        sourceOwner?: string;
        fundingBasis?: { instrumentId?: string };
        capMinor?: string;
        totals?: { approvedMinor?: string };
      };
      const same =
        r.fundingBasis?.instrumentId === instrumentId ||
        r.fundingBasis?.instrumentId?.split(":")[4] ===
          instrumentId.split(":")[4] ||
        r.sourceOwner === instrumentId.split(":")[4];
      const own =
        allowedCycle &&
        path.startsWith(`cycles/${allowedCycle}/`) &&
        !path.endsWith("execution-plan.json");
      if (
        same &&
        !own &&
        (r.sourceOwner ||
          BigInt(r.capMinor ?? r.totals?.approvedMinor ?? "0") > 0n)
      )
        throw new TypeError(
          "Instrument has historical monetary use; no verified retirement is supported",
        );
    }
  }
}
export async function checkPaymentReservationRecords(
  root: string,
  base: string,
  head: string,
  now = new Date().toISOString(),
) {
  if (
    !/^[a-f0-9]{40}$/u.test(base) ||
    !/^[a-f0-9]{40}$/u.test(head) ||
    !Number.isFinite(Date.parse(now)) ||
    new Date(now).toISOString() !== now
  )
    throw new TypeError("Expected exact trusted revisions and time");
  if (
    reservationGit(root, ["rev-parse", "--is-shallow-repository"])
      .toString()
      .trim() !== "false"
  )
    throw new TypeError("Complete non-shallow canonical history is required");
  reservationGit(root, ["merge-base", "--is-ancestor", base, head]);
  const prior = gitReservationLedger(root, base);
  const next = gitReservationLedger(root, head);
  // Missing cannot erase even an empty initialized ledger.
  if (
    gitReservationBlob(root, base, PAYMENT_RESERVATION_PATH, true) &&
    !gitReservationBlob(root, head, PAYMENT_RESERVATION_PATH, true)
  )
    throw new TypeError("Reservation ledger cannot be deleted");
  assertPaymentReservationTransition(prior, next);
  const projectPaths = reservationGit(root, [
    "ls-tree",
    "-r",
    "--name-only",
    head,
    "--",
    "projects",
  ])
    .toString()
    .trim()
    .split("\n")
    .filter((p) => /^projects\/[a-z0-9-]+\/project\.json$/u.test(p));
  for (const path of projectPaths) {
    const previousBytes = gitReservationBlob(root, base, path, true);
    const current = reservationJson(gitReservationBlob(root, head, path)) as {
      id: string;
      funding: { freshCyclePaymentPolicy?: unknown };
    };
    const previous = previousBytes
      ? (reservationJson(previousBytes) as typeof current)
      : null;
    const oldPolicy = previous?.funding.freshCyclePaymentPolicy;
    const newPolicy = current.funding.freshCyclePaymentPolicy;
    const changedPolicy =
      JSON.stringify(oldPolicy) !== JSON.stringify(newPolicy);
    if (oldPolicy && changedPolicy) {
      const old = assertFreshCyclePaymentPolicy(oldPolicy);
      const next = assertFreshCyclePaymentPolicy(newPolicy);
      if (
        old.cycleId === next.cycleId ||
        old.instrumentSha256 === next.instrumentSha256
      )
        throw new TypeError(
          "Accepted cycle policy is immutable; successor requires a distinct fresh month and instrument",
        );
    }
    if (newPolicy && changedPolicy) {
      const { policy, instrument } = reviewedReservationPolicy(current);
      if (policy.effectiveAt > now)
        throw new TypeError(
          "Policy activation timestamp cannot claim future review",
        );
      const instrumentId = `squads-v4-vault:solana:${instrument.multisig}:${instrument.vaultIndex}:${instrument.vault}`;
      if (
        prior.some(
          (r) =>
            r.instrumentId === instrumentId ||
            (r.projectId === policy.projectId && r.cycleId === policy.cycleId),
        )
      )
        throw new TypeError("Policy cannot reactivate an existing reservation");
      assertNoHistoricalInstrumentUse(root, base, instrumentId);
      // Inspect every prior version, not just the latest zeroed/superseded file.
      const cyclePath = `cycles/${policy.projectId}/${policy.cycleId}/proposal.json`;
      const commits = reservationGit(root, ["rev-list", base, "--", cyclePath])
        .toString()
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const sha of commits) {
        const bytes = gitReservationBlob(root, sha, cyclePath, true);
        if (!bytes) continue;
        const proposal = reservationJson(bytes) as {
          capMinor?: string;
          fundingBasis?: { committedMinor?: string };
        };
        if (
          BigInt(proposal.capMinor ?? "0") > 0n ||
          BigInt(proposal.fundingBasis?.committedMinor ?? "0") > 0n
        )
          throw new TypeError(
            "Fresh policy cannot reprice historical monetary proposals",
          );
      }
      if (gitReservationBlob(root, head, cyclePath, true))
        throw new TypeError(
          "Policy must be accepted in an earlier PR than its first funded proposal",
        );
    }
  }
  for (const row of prior) {
    const path = `cycles/${row.projectId}/${row.cycleId}/allocation.json`;
    const bytes = gitReservationBlob(root, head, path);
    if (
      createHash("sha256").update(bytes).digest("hex") !== row.allocationSha256
    )
      throw new TypeError(
        "Reserved allocation bytes are permanently immutable",
      );
  }
  const planPaths = reservationGit(root, [
    "ls-tree",
    "-r",
    "--name-only",
    head,
    "--",
    "cycles",
  ])
    .toString()
    .trim()
    .split("\n")
    .filter((p) =>
      /^cycles\/[a-z0-9-]+\/\d{4}-\d{2}\/execution-plan\.json$/u.test(p),
    );
  const oldPlanPaths = reservationGit(root, [
    "ls-tree",
    "-r",
    "--name-only",
    base,
    "--",
    "cycles",
  ])
    .toString()
    .trim()
    .split("\n")
    .filter((p) =>
      /^cycles\/[a-z0-9-]+\/\d{4}-\d{2}\/execution-plan\.json$/u.test(p),
    );
  if (oldPlanPaths.some((p) => !planPaths.includes(p)))
    throw new TypeError("Issued plans cannot be deleted");
  for (const path of planPaths) {
    const old = gitReservationBlob(root, base, path, true);
    const bytes = gitReservationBlob(root, head, path);
    if (old) {
      if (!Buffer.from(old).equals(Buffer.from(bytes)))
        throw new TypeError("Issued plan bytes are immutable");
      continue;
    }
    const [, projectId, cycleId] = path.split("/");
    const row = prior.find(
      (r) => r.projectId === projectId && r.cycleId === cycleId,
    );
    if (
      !row ||
      createHash("sha256").update(bytes).digest("hex") !== row.planSha256
    )
      throw new TypeError(
        "Release requires a previously merged reservation of these exact plan bytes",
      );
  }
  for (const row of next.slice(prior.length)) {
    if (row.reservedAt > now)
      throw new TypeError("Reservation timestamp is in the future");
    const path = `projects/${row.projectId}/project.json`;
    const projectBytes = gitReservationBlob(root, base, path);
    const { policy, instrument } = reviewedReservationPolicy(
      reservationJson(projectBytes),
    );
    if (
      JSON.stringify(reservationJson(projectBytes)) !==
      JSON.stringify(reservationJson(gitReservationBlob(root, head, path)))
    )
      throw new TypeError(
        "Reserve from already reviewed policy, not a simultaneous manifest change",
      );
    const allocationPath = `cycles/${row.projectId}/${row.cycleId}/allocation.json`;
    const allocation = gitReservationBlob(root, base, allocationPath);
    assertReservationInstrument(
      instrument,
      reservationJson(allocation),
      row,
      policy,
    );
    assertNoHistoricalInstrumentUse(
      root,
      base,
      row.instrumentId,
      `${row.projectId}/${row.cycleId}`,
    );
    const nextAllocation = gitReservationBlob(root, head, allocationPath);
    if (!Buffer.from(allocation).equals(Buffer.from(nextAllocation)))
      throw new TypeError("Allocation must already be frozen on trusted base");
    if (
      gitReservationBlob(
        root,
        base,
        `cycles/${row.projectId}/${row.cycleId}/execution-plan.json`,
        true,
      )
    )
      throw new TypeError("A prior execution plan cannot be reserved again");
    const expected = await draftPaymentReservation(
      allocation,
      policy,
      row.reservedAt,
    );
    if (JSON.stringify(expected) !== JSON.stringify(row))
      throw new TypeError("Reservation differs from exact canonical plan");
  }
  return { prior: prior.length, current: next.length };
}
/** Full trusted admission includes immutable authenticated signer history. */
export async function checkPaymentReservations(
  root: string,
  base: string,
  head: string,
  now = new Date().toISOString(),
) {
  await verifyUnsafeDestinationHistoryAuthorities({
    repositoryRoot: root,
    baseSha: base,
    headSha: head,
  });
  await readPaymentSignerHistory({ root, baseSha: base, headSha: head, now });
  return checkPaymentReservationRecords(root, base, head, now);
}
if (import.meta.main) {
  try {
    if (process.argv.length !== 4)
      throw new TypeError(
        "Usage: check-payment-reservations.ts <trusted-base> <head>",
      );
    const base = process.argv[2];
    if (
      reservationGit(process.cwd(), ["rev-parse", "HEAD"]).toString().trim() !==
      base
    )
      throw new TypeError("Checker must run from immutable trusted base");
    await checkPaymentReservations(process.cwd(), base, process.argv[3]);
    const { checkPaymentCheckpointTransition } = await import(
      "./check-payment-checkpoints"
    );
    await checkPaymentCheckpointTransition(
      process.cwd(),
      base,
      process.argv[3],
    );
    process.stdout.write("[Slop] payment reservation transition verified\n");
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Reservation check failed"}\n`,
    );
    process.exitCode = 1;
  }
}
