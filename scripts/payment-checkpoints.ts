/** Checkpoints attest admission already reviewed; they never retire obligations.
 * The chain is bundled with the deployed verifier, not selected by an operator
 * argument or read from the candidate checkout during release. */
import { createHash } from "node:crypto";
import {
  assertPaymentReservationTransition,
  type PaymentReservation,
  paymentRecordBytes,
} from "../src/lib/payment-reservations";
import deployedPins from "./payment-checkpoints.json";
import {
  gitReservationBlob,
  gitReservationLedger,
  reservationGit,
  reservationJson,
} from "./payment-reservation-history";
import {
  type PaymentSignerHistoryEntry,
  paymentSignerHistoryDigest,
} from "./payment-signer-history";

export const PAYMENT_CHECKPOINT_CHAIN_PATH = "scripts/payment-checkpoints.json";
export const PAYMENT_WORKFLOW_PATH =
  ".github/workflows/payment-reservations.yml";
export interface PaymentCheckpoint {
  schemaVersion: "1";
  revision: string;
  previousCheckpointSha256: string;
  snapshotSha256: string;
  reservationLedgerSha256: string;
  policyHistorySha256: string;
  obligationsHistorySha256: string;
  workflowSha256: string;
  signerHistorySha256: string;
}
interface HistoricalVersion {
  revision: string;
  path: string;
  sha256: string;
}
export interface PaymentCheckpointSnapshot {
  schemaVersion: "1";
  revision: string;
  reservations: PaymentReservation[];
  policyHistory: HistoricalVersion[];
  obligationsHistory: HistoricalVersion[];
  signerHistory: PaymentSignerHistoryEntry[];
}
export const checkpointDigest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const hashValue = (v: unknown) => checkpointDigest(paymentRecordBytes(v));
export const checkpointSnapshotPath = (revision: string) =>
  `protocol/payment-checkpoints/${revision}.json`;
export const bootstrapCheckpointDigest = (revision: string) =>
  hashValue({ bootstrapRevision: revision });
export function assertCheckpointChain(value: unknown): PaymentCheckpoint[] {
  if (!Array.isArray(value) || value.length > 24000)
    throw new TypeError("Invalid checkpoint chain");
  const keys =
    "obligationsHistorySha256,policyHistorySha256,previousCheckpointSha256,reservationLedgerSha256,revision,schemaVersion,signerHistorySha256,snapshotSha256,workflowSha256";
  const seen = new Set<string>();
  return value.map((v) => {
    if (
      !v ||
      Object.keys(v).sort().join() !== keys ||
      v.schemaVersion !== "1" ||
      !/^[a-f0-9]{40}$/u.test(v.revision) ||
      Object.entries(v).some(
        ([k, val]) =>
          k.endsWith("Sha256") &&
          (typeof val !== "string" || !/^[a-f0-9]{64}$/u.test(val)),
      ) ||
      seen.has(v.revision)
    )
      throw new TypeError("Invalid checkpoint descriptor");
    seen.add(v.revision);
    return { ...v } as PaymentCheckpoint;
  });
}
export const DEPLOYED_PAYMENT_CHECKPOINTS = assertCheckpointChain(deployedPins);
export function assertCheckpointAppend(base: unknown, head: unknown) {
  const prior = assertCheckpointChain(base);
  const next = assertCheckpointChain(head);
  if (
    next.length < prior.length ||
    next.length > prior.length + 1 ||
    prior.some((v, i) => hashValue(v) !== hashValue(next[i]))
  )
    throw new TypeError(
      "Checkpoint chain requires immutable prefix and at most one append",
    );
  return next;
}
function completeHistory(root: string) {
  if (
    reservationGit(root, ["rev-parse", "--is-shallow-repository"])
      .toString()
      .trim() !== "false"
  )
    throw new TypeError("Complete non-shallow checkpoint history is required");
}
/** Retains every distinct historical blob, including deleted/replaced versions.
 * Exact hashes bind original policy terms, money, intents and issued sources. */
export function buildPaymentCheckpointSnapshot(
  root: string,
  revision: string,
): PaymentCheckpointSnapshot {
  if (!/^[a-f0-9]{40}$/u.test(revision))
    throw new TypeError("Invalid checkpoint revision");
  completeHistory(root);
  const commits = reservationGit(root, [
    "rev-list",
    "--first-parent",
    "--reverse",
    revision,
    "--",
    "projects",
    "cycles",
    "funding",
  ])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  if (commits.length > 24000)
    throw new TypeError("Checkpoint history exceeds bound");
  const policyHistory: HistoricalVersion[] = [];
  const obligationsHistory: HistoricalVersion[] = [];
  const seen = new Set<string>();
  let priorLedger: PaymentReservation[] = [];
  for (const sha of commits) {
    const ledger = gitReservationLedger(root, sha);
    assertPaymentReservationTransition(priorLedger, ledger);
    priorLedger = ledger;
    const paths = reservationGit(root, [
      "ls-tree",
      "-r",
      "--name-only",
      sha,
      "--",
      "projects",
      "cycles",
      "funding",
    ])
      .toString()
      .trim()
      .split("\n")
      .filter(
        (p) =>
          /^projects\/[a-z0-9-]+\/project\.json$/u.test(p) ||
          /^(cycles|funding)\/.+\.json$/u.test(p),
      );
    for (const path of paths.sort()) {
      const digest = checkpointDigest(gitReservationBlob(root, sha, path));
      const key = `${path}:${digest}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size > 100000)
        throw new TypeError("Checkpoint version inventory exceeds bound");
      (path.startsWith("projects/") ? policyHistory : obligationsHistory).push({
        revision: sha,
        path,
        sha256: digest,
      });
    }
  }
  const snapshot: PaymentCheckpointSnapshot = {
    schemaVersion: "1",
    revision,
    reservations: gitReservationLedger(root, revision),
    policyHistory,
    obligationsHistory,
    signerHistory: obligationsHistory
      .filter((v) =>
        /^funding\/[a-z0-9-]+\/signer-access\/[a-f0-9]{64}\.json$/u.test(
          v.path,
        ),
      )
      .map((v) => ({
        path: v.path,
        sha256: v.sha256,
        firstAcceptedRevision: v.revision,
      }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
  if (paymentRecordBytes(snapshot).length > 16 * 1024 * 1024)
    throw new TypeError("Checkpoint snapshot exceeds bound");
  return snapshot;
}
export function describePaymentCheckpoint(
  root: string,
  snapshot: PaymentCheckpointSnapshot,
  previousCheckpointSha256: string,
): PaymentCheckpoint {
  return {
    schemaVersion: "1",
    revision: snapshot.revision,
    previousCheckpointSha256,
    snapshotSha256: hashValue(snapshot),
    reservationLedgerSha256: hashValue(snapshot.reservations),
    policyHistorySha256: hashValue(snapshot.policyHistory),
    obligationsHistorySha256: hashValue(snapshot.obligationsHistory),
    signerHistorySha256: paymentSignerHistoryDigest(snapshot.signerHistory),
    workflowSha256: checkpointDigest(
      gitReservationBlob(root, snapshot.revision, PAYMENT_WORKFLOW_PATH),
    ),
  };
}
/** No receipt lookup before the pinned checkpoint. Instead verify its complete
 * retained history and exact permanent ledger against the deployed trust root. */
export function validatePinnedPaymentCheckpoints(
  root: string,
  revision: string,
  bootstrap: string,
  chainValue: unknown = DEPLOYED_PAYMENT_CHECKPOINTS,
): string {
  completeHistory(root);
  const chain = assertCheckpointChain(chainValue);
  const canonicalParents = new Set(
    reservationGit(root, ["rev-list", "--first-parent", revision])
      .toString()
      .trim()
      .split("\n"),
  );
  if (
    !canonicalParents.has(bootstrap) ||
    chain.some((pin) => !canonicalParents.has(pin.revision))
  )
    throw new TypeError("Checkpoint must be on canonical first-parent history");
  let previous = bootstrap;
  let previousDigest = bootstrapCheckpointDigest(bootstrap);
  const workflowDigest = checkpointDigest(
    gitReservationBlob(root, bootstrap, PAYMENT_WORKFLOW_PATH),
  );
  for (const pin of chain) {
    const segment = reservationGit(root, [
      "rev-list",
      "--first-parent",
      `${previous}..${pin.revision}`,
    ])
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
    reservationGit(root, [
      "merge-base",
      "--is-ancestor",
      previous,
      pin.revision,
    ]);
    if (
      pin.revision === previous ||
      !segment.length ||
      reservationGit(root, ["rev-parse", `${segment[segment.length - 1]}^1`])
        .toString()
        .trim() !== previous
    )
      throw new TypeError(
        "Checkpoint must advance canonical first-parent history",
      );
    reservationGit(root, [
      "merge-base",
      "--is-ancestor",
      pin.revision,
      revision,
    ]);
    const snapshot = buildPaymentCheckpointSnapshot(root, pin.revision);
    const expected = describePaymentCheckpoint(root, snapshot, previousDigest);
    if (
      hashValue(pin) !== hashValue(expected) ||
      pin.workflowSha256 !== workflowDigest
    )
      throw new TypeError(
        "Checkpoint hashes differ from complete retained history",
      );
    const retained = gitReservationBlob(
      root,
      revision,
      checkpointSnapshotPath(pin.revision),
    );
    if (
      checkpointDigest(retained) !== pin.snapshotSha256 ||
      !Buffer.from(retained).equals(Buffer.from(paymentRecordBytes(snapshot)))
    )
      throw new TypeError("Pinned checkpoint snapshot missing or rewritten");
    previous = pin.revision;
    previousDigest = hashValue(pin);
  }
  return previous;
}
export function readCheckpointChain(root: string, revision: string) {
  const bytes = gitReservationBlob(
    root,
    revision,
    PAYMENT_CHECKPOINT_CHAIN_PATH,
    true,
  );
  const chain = assertCheckpointChain(bytes ? reservationJson(bytes) : []);
  if (
    bytes &&
    !Buffer.from(bytes).equals(Buffer.from(paymentRecordBytes(chain)))
  )
    throw new TypeError("Noncanonical checkpoint chain bytes");
  return chain;
}
