/** Runs from trusted base code. A checkpoint append must prove the old receipt
 * chain before expiry; it cannot retroactively bless an unverified interval. */

import { paymentRecordBytes } from "../src/lib/payment-reservations";
import {
  requirePaymentBootstrapCheckpoint,
  verifyHistoricalPaymentAdmission,
} from "./payment-admission";
import {
  assertCheckpointAppend,
  bootstrapCheckpointDigest,
  buildPaymentCheckpointSnapshot,
  checkpointDigest,
  checkpointSnapshotPath,
  describePaymentCheckpoint,
  readCheckpointChain,
  validatePinnedPaymentCheckpoints,
} from "./payment-checkpoints";
import {
  gitReservationBlob,
  reservationGit,
} from "./payment-reservation-history";

export async function checkPaymentCheckpointTransition(
  root: string,
  base: string,
  head: string,
) {
  reservationGit(root, ["merge-base", "--is-ancestor", base, head]);
  const prior = readCheckpointChain(root, base);
  const next = assertCheckpointAppend(prior, readCheckpointChain(root, head));
  const snapshots = reservationGit(root, [
    "ls-tree",
    "-r",
    "--name-only",
    head,
    "--",
    "protocol/payment-checkpoints",
  ])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  if (
    snapshots.length !== next.length ||
    snapshots.some(
      (path) =>
        !next.some((pin) => checkpointSnapshotPath(pin.revision) === path),
    )
  )
    throw new TypeError(
      "Checkpoint snapshot inventory must exactly match reviewed pins",
    );
  for (const pin of prior) {
    const path = checkpointSnapshotPath(pin.revision);
    const before = gitReservationBlob(root, base, path);
    const after = gitReservationBlob(root, head, path);
    if (
      checkpointDigest(before) !== pin.snapshotSha256 ||
      !Buffer.from(before).equals(Buffer.from(after))
    )
      throw new TypeError("Historical checkpoint snapshots are immutable");
  }
  if (prior.length === next.length) return;
  const bootstrap = requirePaymentBootstrapCheckpoint();
  const pin = next[next.length - 1];
  reservationGit(root, ["merge-base", "--is-ancestor", pin.revision, base]);
  // The verifier uses only the prior chain loaded from trusted base, never head.
  await verifyHistoricalPaymentAdmission(root, pin.revision, bootstrap, prior);
  const previous = prior.length
    ? checkpointDigest(paymentRecordBytes(prior[prior.length - 1]))
    : bootstrapCheckpointDigest(bootstrap);
  const snapshot = buildPaymentCheckpointSnapshot(root, pin.revision);
  const expected = describePaymentCheckpoint(root, snapshot, previous);
  if (
    !Buffer.from(paymentRecordBytes(expected)).equals(
      Buffer.from(paymentRecordBytes(pin)),
    )
  )
    throw new TypeError(
      "Checkpoint descriptor does not bind exact admitted history",
    );
  validatePinnedPaymentCheckpoints(root, head, bootstrap, next);
  const bytes = gitReservationBlob(
    root,
    head,
    checkpointSnapshotPath(pin.revision),
  );
  if (!Buffer.from(bytes).equals(Buffer.from(paymentRecordBytes(snapshot))))
    throw new TypeError(
      "Migration snapshot omits or changes retained obligations",
    );
}
