/**
 * Strict committed-funding contracts: reviewed third-party instrument
 * references from the project manifest plus append-only public commitment
 * records for deposits into, releases from, and refunds out of an instrument.
 * Slop never holds a key, admin, or fee position in any instrument, and
 * verified and self-reported amounts are never added into one number.
 */

import { isFundingAddress, isSolanaTransactionId } from "./funding-address.mjs";
import type { FundingCommitmentInstrument } from "./funding-instruments.mjs";
import {
  assertFundingCommitments,
  hasActiveFundingCommitment,
} from "./funding-instruments.mjs";

export type {
  FundingCommitmentInstrument,
  SablierLockupV4Instrument,
  SquadsV4VaultInstrument,
} from "./funding-instruments.mjs";
export {
  assertFundingCommitments,
  hasActiveFundingCommitment,
  MAX_FUNDING_COMMITMENTS,
  SABLIER_LOCKUP_V4_CONTRACTS,
} from "./funding-instruments.mjs";

export const COMMITMENT_PROTOCOL_VERSION = "1" as const;
export type CommitmentNetwork = "base" | "ethereum" | "solana";
export type CommitmentEvent = "deposit" | "refund" | "release";
export type CommitmentState =
  | "disputed"
  | "self-reported"
  | "verified-on-chain";

export interface ProjectCommitmentRecord {
  schemaVersion: typeof COMMITMENT_PROTOCOL_VERSION;
  kind: "project-commitment";
  recordId: string;
  projectId: string;
  manifestRevision: string;
  event: CommitmentEvent;
  network: CommitmentNetwork;
  asset: "USDC";
  instrument:
    | {
        funderMember: string;
        multisig: string;
        stewardMember: string;
        vault: string;
        vaultIndex: number;
      }
    | { contract: string; streamId: string };
  transactionId: string;
  amountMinor: string;
  observedAt: string;
  state: CommitmentState;
  finality:
    | { kind: "confirmations"; confirmations: number }
    | { kind: "finalized" }
    | { kind: "unverified" };
  verifier: null | {
    version: string;
    checkedAt: string;
    evidenceUrl: string;
    reason: string | null;
  };
  supersedes: string | null;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const RECORD_ID_PATTERN = /^cmt_[a-z0-9](?:[a-z0-9_-]{6,79})$/u;
const PROJECT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  field: string,
) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(`${field} has unexpected or missing fields`);
  }
}

function timestamp(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function canonicalMinor(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^(?:0|[1-9]\d*)$/u.test(value)
  ) {
    throw new TypeError(`${field} must be canonical integer minor units`);
  }
  if (BigInt(value) === 0n) throw new TypeError(`${field} must be positive`);
  return value;
}

function isCommitmentNetwork(value: unknown): value is CommitmentNetwork {
  return value === "base" || value === "ethereum" || value === "solana";
}

function validTransactionId(network: CommitmentNetwork, value: unknown) {
  if (typeof value !== "string") return false;
  if (network === "solana") return isSolanaTransactionId(value);
  return /^0x[0-9a-f]{64}$/u.test(value);
}

function canonicalEvidenceUrl(
  network: CommitmentNetwork,
  transactionId: string,
): string {
  if (network === "solana") return `https://solscan.io/tx/${transactionId}`;
  if (network === "base") return `https://basescan.org/tx/${transactionId}`;
  return `https://etherscan.io/tx/${transactionId}`;
}

function assertFinality(
  state: CommitmentState,
  network: CommitmentNetwork,
  value: unknown,
) {
  const finality = object(value, "commitment record finality");
  if (finality.kind === "unverified") {
    exactKeys(finality, ["kind"], "commitment record finality");
    if (state !== "self-reported") {
      throw new TypeError("only self-reported commitments may be unverified");
    }
    return;
  }
  if (finality.kind === "finalized") {
    exactKeys(finality, ["kind"], "commitment record finality");
    if (network !== "solana" || state === "self-reported") {
      throw new TypeError("finalized commitment state is inconsistent");
    }
    return;
  }
  exactKeys(finality, ["confirmations", "kind"], "commitment record finality");
  const minimum =
    network === "ethereum"
      ? 64
      : network === "base"
        ? 12
        : Number.POSITIVE_INFINITY;
  if (
    !Number.isSafeInteger(finality.confirmations) ||
    Number(finality.confirmations) < minimum ||
    state === "self-reported"
  ) {
    throw new TypeError(
      "commitment record does not meet the network finality policy",
    );
  }
}

function matchesInstrument(
  candidate: FundingCommitmentInstrument,
  network: CommitmentNetwork,
  identity: Record<string, unknown>,
): boolean {
  if (candidate.network !== network || candidate.asset !== "USDC") {
    return false;
  }
  if (candidate.kind === "squads-v4-vault") {
    return (
      identity.multisig === candidate.multisig &&
      identity.vault === candidate.vault &&
      identity.vaultIndex === candidate.vaultIndex &&
      identity.funderMember === candidate.funderMember &&
      identity.stewardMember === candidate.stewardMember
    );
  }
  return (
    identity.contract === candidate.contract &&
    identity.streamId === candidate.streamId
  );
}

export function assertProjectCommitmentRecord(
  value: unknown,
  instruments: readonly FundingCommitmentInstrument[],
): ProjectCommitmentRecord {
  const record = object(value, "commitment record");
  exactKeys(
    record,
    [
      "amountMinor",
      "asset",
      "event",
      "finality",
      "instrument",
      "kind",
      "manifestRevision",
      "network",
      "observedAt",
      "projectId",
      "recordId",
      "schemaVersion",
      "state",
      "supersedes",
      "transactionId",
      "verifier",
    ],
    "commitment record",
  );
  if (
    record.schemaVersion !== COMMITMENT_PROTOCOL_VERSION ||
    record.kind !== "project-commitment"
  ) {
    throw new TypeError("commitment record protocol is unsupported");
  }
  if (
    typeof record.recordId !== "string" ||
    !RECORD_ID_PATTERN.test(record.recordId)
  ) {
    throw new TypeError("commitment record id is invalid");
  }
  if (
    typeof record.projectId !== "string" ||
    !PROJECT_ID_PATTERN.test(record.projectId)
  ) {
    throw new TypeError("commitment record project is invalid");
  }
  if (
    typeof record.manifestRevision !== "string" ||
    !SHA_PATTERN.test(record.manifestRevision)
  ) {
    throw new TypeError("commitment record manifest revision is invalid");
  }
  if (
    record.event !== "deposit" &&
    record.event !== "release" &&
    record.event !== "refund"
  ) {
    throw new TypeError("commitment record event is invalid");
  }
  if (!isCommitmentNetwork(record.network)) {
    throw new TypeError("commitment record network is unsupported");
  }
  const network = record.network;
  if (record.asset !== "USDC") {
    throw new TypeError("commitment record asset is unsupported");
  }
  if (!validTransactionId(network, record.transactionId)) {
    throw new TypeError("commitment record transaction id is invalid");
  }
  const identity = object(record.instrument, "commitment record instrument");
  exactKeys(
    identity,
    network === "solana"
      ? ["funderMember", "multisig", "stewardMember", "vault", "vaultIndex"]
      : ["contract", "streamId"],
    "commitment record instrument",
  );
  if (
    network === "solana" &&
    (!Number.isSafeInteger(identity.vaultIndex) ||
      Number(identity.vaultIndex) < 0 ||
      Number(identity.vaultIndex) > 255)
  ) {
    throw new TypeError(
      "commitment record vaultIndex must be an unsigned byte",
    );
  }
  if (
    network === "solana" &&
    (!isFundingAddress("solana", identity.funderMember) ||
      !isFundingAddress("solana", identity.stewardMember) ||
      identity.funderMember === identity.stewardMember)
  ) {
    throw new TypeError(
      "commitment record members must be distinct Solana public keys",
    );
  }
  if (
    record.supersedes !== null &&
    (typeof record.supersedes !== "string" ||
      !RECORD_ID_PATTERN.test(record.supersedes))
  ) {
    throw new TypeError("commitment record supersedes id is invalid");
  }
  const observedAt = timestamp(
    record.observedAt,
    "commitment record observedAt",
  );
  const instrument = instruments.find(
    (candidate) =>
      matchesInstrument(candidate, network, identity) &&
      (record.supersedes !== null ||
        (Date.parse(candidate.effectiveAt) <= Date.parse(observedAt) &&
          (candidate.replacedAt === null ||
            Date.parse(observedAt) < Date.parse(candidate.replacedAt)))),
  );
  if (!instrument) {
    throw new TypeError(
      record.supersedes === null
        ? "commitment record instrument was not active at the manifest-bound observation time"
        : "commitment correction instrument is absent from the manifest-bound instrument history",
    );
  }
  canonicalMinor(record.amountMinor, "commitment record amountMinor");
  if (
    record.state !== "self-reported" &&
    record.state !== "verified-on-chain" &&
    record.state !== "disputed"
  ) {
    throw new TypeError("commitment record state is invalid");
  }
  assertFinality(record.state, network, record.finality);
  if (record.state === "self-reported") {
    if (record.verifier !== null) {
      throw new TypeError(
        "self-reported commitments cannot claim independent verification",
      );
    }
  } else {
    const verifier = object(record.verifier, "commitment record verifier");
    exactKeys(
      verifier,
      ["checkedAt", "evidenceUrl", "reason", "version"],
      "commitment record verifier",
    );
    const checkedAt = timestamp(
      verifier.checkedAt,
      "commitment record verifier.checkedAt",
    );
    if (Date.parse(checkedAt) < Date.parse(observedAt)) {
      throw new TypeError(
        "commitment record verification predates observation",
      );
    }
    const expectedVerifierVersion =
      instrument.kind === "squads-v4-vault"
        ? "commitment-squads-v2"
        : "commitment-sablier-v2";
    if (verifier.version !== expectedVerifierVersion) {
      throw new TypeError(
        "commitment record verifier version does not match its instrument",
      );
    }
    if (
      verifier.evidenceUrl !==
      canonicalEvidenceUrl(network, record.transactionId as string)
    ) {
      throw new TypeError("commitment record verifier evidence is invalid");
    }
    if (
      record.state === "disputed"
        ? typeof verifier.reason !== "string" ||
          verifier.reason.trim().length < 8 ||
          verifier.reason.length > 1_000
        : verifier.reason !== null
    ) {
      throw new TypeError("commitment record dispute reason is inconsistent");
    }
  }
  return value as ProjectCommitmentRecord;
}

function instrumentIdentityKey(record: ProjectCommitmentRecord): string {
  const identity = record.instrument as Record<string, unknown>;
  return record.network === "solana"
    ? `${identity.multisig}:${identity.vaultIndex}:${identity.vault}:${identity.funderMember}:${identity.stewardMember}`
    : `${identity.contract}:${identity.streamId}`;
}

export function assertProjectCommitmentLedger(
  values: readonly unknown[],
  instruments: readonly FundingCommitmentInstrument[],
): readonly ProjectCommitmentRecord[] {
  const records = values.map((value) =>
    assertProjectCommitmentRecord(value, instruments),
  );
  const byId = new Map<string, ProjectCommitmentRecord>();
  const latestByTransaction = new Map<string, ProjectCommitmentRecord>();
  for (const record of records) {
    if (byId.has(record.recordId)) {
      throw new TypeError("commitment ledger contains a duplicate record id");
    }
    const transactionKey = `${record.network}:${record.transactionId}`;
    const prior = latestByTransaction.get(transactionKey);
    if ((prior?.recordId ?? null) !== record.supersedes) {
      throw new TypeError(
        "commitment ledger duplicate or correction chain is invalid",
      );
    }
    if (record.supersedes !== null && !byId.has(record.supersedes)) {
      throw new TypeError(
        "commitment ledger supersedes a missing or later record",
      );
    }
    if (
      prior &&
      (prior.event !== record.event ||
        prior.asset !== record.asset ||
        instrumentIdentityKey(prior) !== instrumentIdentityKey(record) ||
        Date.parse(record.observedAt) <= Date.parse(prior.observedAt))
    ) {
      throw new TypeError(
        "commitment ledger correction changes transaction identity or is not later",
      );
    }
    byId.set(record.recordId, record);
    latestByTransaction.set(transactionKey, record);
  }
  return records;
}

export function currentProjectCommitmentRecords(
  records: readonly ProjectCommitmentRecord[],
): readonly ProjectCommitmentRecord[] {
  const latest = new Map<string, ProjectCommitmentRecord>();
  for (const record of records) {
    latest.set(`${record.network}:${record.transactionId}`, record);
  }
  return [...latest.values()].sort(
    (left, right) =>
      Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
      left.recordId.localeCompare(right.recordId),
  );
}

/**
 * Deterministic per-event USDC totals. Self-reported and verified figures
 * remain separate columns and are never summed into one number.
 */
export function projectCommitmentTotals(
  records: readonly ProjectCommitmentRecord[],
) {
  const totals = {
    selfReported: { deposit: 0n, refund: 0n, release: 0n },
    verified: { deposit: 0n, refund: 0n, release: 0n },
  };
  for (const record of currentProjectCommitmentRecords(records)) {
    if (record.state === "self-reported") {
      totals.selfReported[record.event] += BigInt(record.amountMinor);
    }
    if (record.state === "verified-on-chain") {
      totals.verified[record.event] += BigInt(record.amountMinor);
    }
  }
  return {
    asset: "USDC" as const,
    selfReportedDepositMinor: totals.selfReported.deposit.toString(),
    selfReportedRefundMinor: totals.selfReported.refund.toString(),
    selfReportedReleaseMinor: totals.selfReported.release.toString(),
    verifiedDepositMinor: totals.verified.deposit.toString(),
    verifiedRefundMinor: totals.verified.refund.toString(),
    verifiedReleaseMinor: totals.verified.release.toString(),
  };
}

/** Verified deposits minus verified releases and refunds, in minor units. */
export function commitmentVerifiedNetMinor(
  records: readonly ProjectCommitmentRecord[],
): bigint {
  const totals = projectCommitmentTotals(records);
  return (
    BigInt(totals.verifiedDepositMinor) -
    BigInt(totals.verifiedReleaseMinor) -
    BigInt(totals.verifiedRefundMinor)
  );
}

/**
 * Fails closed when a manifest claims committed funding beyond the balance the
 * verified commitment ledger supports. Pure ledger arithmetic; no network.
 */
export function assertCommittedFundingBound(
  projectId: string,
  reward: { committedMinor: string; fundingState: string },
  commitments: unknown,
  records: readonly ProjectCommitmentRecord[],
): void {
  if (reward.fundingState !== "committed") return;
  const instruments = assertFundingCommitments(
    commitments,
    `project ${projectId} funding commitments`,
  );
  if (!hasActiveFundingCommitment(instruments)) {
    throw new TypeError(
      `project ${projectId} claims committed funding without an active instrument`,
    );
  }
  const committed = BigInt(reward.committedMinor);
  // A monthly claim cannot borrow deposits from an old or unrelated vault.
  // Legacy immutable manifests remain readable under their original contract.
  const monthly = instruments.filter(
    (instrument) =>
      instrument.replacedAt === null && instrument.monthlyCommitment,
  );
  const backingRecords =
    monthly.length > 0
      ? records.filter((record) =>
          monthly.some((instrument) =>
            matchesInstrument(instrument, record.network, record.instrument),
          ),
        )
      : records;
  const verifiedNet = commitmentVerifiedNetMinor(backingRecords);
  if (committed > verifiedNet) {
    throw new TypeError(
      `project ${projectId} committedMinor ${committed} exceeds the verified commitment balance ${verifiedNet}`,
    );
  }
}
