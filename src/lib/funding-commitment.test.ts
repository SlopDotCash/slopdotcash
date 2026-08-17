/** Proves committed funding stays reviewed, append-only, and non-custodial. */

import { describe, expect, it } from "vitest";
import {
  assertCommittedFundingBound,
  assertFundingCommitments,
  assertProjectCommitmentLedger,
  assertProjectCommitmentRecord,
  commitmentVerifiedNetMinor,
  currentProjectCommitmentRecords,
  hasActiveFundingCommitment,
  projectCommitmentTotals,
  SABLIER_LOCKUP_V4_CONTRACTS,
} from "./funding-commitment";

const MULTISIG = "11111111111111111111111111111111";
const VAULT = "Vote111111111111111111111111111111111111111";
const FUNDER_MEMBER = "Stake11111111111111111111111111111111111111";
const STEWARD_MEMBER = "SysvarRent111111111111111111111111111111111";
const DEPOSIT_SIGNATURE = "3".repeat(88);
const RELEASE_SIGNATURE = "4".repeat(88);

function squadsInstrument(overrides: Record<string, unknown> = {}) {
  return {
    kind: "squads-v4-vault",
    network: "solana",
    asset: "USDC",
    multisig: MULTISIG,
    vault: VAULT,
    vaultIndex: 0,
    funderMember: FUNDER_MEMBER,
    stewardMember: STEWARD_MEMBER,
    funderActorId: "18633264",
    deadline: "2026-12-01T00:00:00.000Z",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    replacedAt: null,
    ...overrides,
  };
}

function sablierInstrument(overrides: Record<string, unknown> = {}) {
  return {
    kind: "sablier-lockup-v4",
    network: "base",
    asset: "USDC",
    contract: SABLIER_LOCKUP_V4_CONTRACTS.base,
    streamId: "421",
    deadline: "2026-12-01T00:00:00.000Z",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    replacedAt: null,
    ...overrides,
  };
}

const instruments = assertFundingCommitments([
  squadsInstrument(),
  sablierInstrument(),
]);

function record(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1",
    kind: "project-commitment",
    recordId: "cmt_fixture_01",
    projectId: "eliza",
    manifestRevision: "b".repeat(40),
    event: "deposit",
    network: "solana",
    asset: "USDC",
    instrument: {
      funderMember: FUNDER_MEMBER,
      multisig: MULTISIG,
      stewardMember: STEWARD_MEMBER,
      vault: VAULT,
      vaultIndex: 0,
    },
    transactionId: DEPOSIT_SIGNATURE,
    amountMinor: "5000000",
    observedAt: "2026-08-02T00:00:00.000Z",
    state: "verified-on-chain",
    finality: { kind: "finalized" },
    verifier: {
      version: "commitment-squads-v2",
      checkedAt: "2026-08-02T01:00:00.000Z",
      evidenceUrl: `https://solscan.io/tx/${DEPOSIT_SIGNATURE}`,
      reason: null,
    },
    supersedes: null,
    ...overrides,
  };
}

describe("funding commitment instruments", () => {
  it("accepts only the reviewed instrument kinds with exact fields", () => {
    expect(instruments).toHaveLength(2);
    expect(hasActiveFundingCommitment(instruments)).toBe(true);
    expect(() =>
      assertFundingCommitments([{ ...squadsInstrument(), kind: "custodial" }]),
    ).toThrow(/kind is unsupported/u);
    expect(() =>
      assertFundingCommitments([squadsInstrument({ escrowAgent: "slop" })]),
    ).toThrow(/unexpected or missing/u);
    expect(() =>
      assertFundingCommitments([squadsInstrument({ vault: MULTISIG })]),
    ).toThrow(/must differ/u);
    expect(() =>
      assertFundingCommitments([squadsInstrument({ vaultIndex: -1 })]),
    ).toThrow(/unsigned byte/u);
    expect(() =>
      assertFundingCommitments([squadsInstrument({ vaultIndex: 256 })]),
    ).toThrow(/unsigned byte/u);
    expect(() =>
      assertFundingCommitments([
        squadsInstrument({ stewardMember: FUNDER_MEMBER }),
      ]),
    ).toThrow(/members must be distinct/u);
    expect(() =>
      assertFundingCommitments([
        sablierInstrument({ contract: `0x${"9".repeat(40)}` }),
      ]),
    ).toThrow(/reviewed Sablier Lockup v4 deployment/u);
    expect(() =>
      assertFundingCommitments([sablierInstrument({ streamId: "01" })]),
    ).toThrow(/streamId is invalid/u);
    expect(() =>
      assertFundingCommitments([
        sablierInstrument({
          network: "ethereum",
          contract: SABLIER_LOCKUP_V4_CONTRACTS.base,
        }),
      ]),
    ).toThrow(/reviewed Sablier Lockup v4 deployment/u);
  });

  it("bounds counts and rejects duplicate or overlapping instruments", () => {
    expect(() =>
      assertFundingCommitments(
        Array.from({ length: 17 }, (_, index) =>
          sablierInstrument({ streamId: `${index + 1}` }),
        ),
      ),
    ).toThrow(/at most 16/u);
    expect(() =>
      assertFundingCommitments([sablierInstrument(), sablierInstrument()]),
    ).toThrow(/duplicate instrument/u);
    expect(() =>
      assertFundingCommitments([
        squadsInstrument(),
        squadsInstrument({
          funderMember: STEWARD_MEMBER,
          stewardMember: FUNDER_MEMBER,
        }),
      ]),
    ).toThrow(/duplicate instrument/u);
    expect(() =>
      assertFundingCommitments([
        sablierInstrument(),
        sablierInstrument({
          streamId: "422",
          effectiveAt: "2026-09-01T00:00:00.000Z",
        }),
      ]),
    ).toThrow(/overlapping active instruments/u);
    expect(
      assertFundingCommitments([
        sablierInstrument({ replacedAt: "2026-09-01T00:00:00.000Z" }),
        sablierInstrument({
          streamId: "422",
          effectiveAt: "2026-09-01T00:00:00.000Z",
        }),
      ]),
    ).toHaveLength(2);
  });

  it("requires the deadline and replacement to follow activation", () => {
    expect(() =>
      assertFundingCommitments([
        squadsInstrument({ deadline: "2026-08-01T00:00:00.000Z" }),
      ]),
    ).toThrow(/deadline must follow effectiveAt/u);
    expect(() =>
      assertFundingCommitments([
        squadsInstrument({ replacedAt: "2026-07-01T00:00:00.000Z" }),
      ]),
    ).toThrow(/replacedAt must follow effectiveAt/u);
    expect(() =>
      assertFundingCommitments([
        squadsInstrument({ effectiveAt: "2026-02-30T00:00:00.000Z" }),
      ]),
    ).toThrow(/invalid/u);
  });
});

describe("project commitment records", () => {
  it("binds a record to the exact active manifest instrument", () => {
    expect(assertProjectCommitmentRecord(record(), instruments)).toMatchObject({
      event: "deposit",
      state: "verified-on-chain",
    });
    expect(() =>
      assertProjectCommitmentRecord(
        record({
          instrument: {
            ...record().instrument,
            vault: MULTISIG,
          },
        }),
        instruments,
      ),
    ).toThrow(/not active at the manifest-bound observation time/u);
    expect(() =>
      assertProjectCommitmentRecord(
        record({
          instrument: {
            ...record().instrument,
            vaultIndex: 1,
          },
        }),
        instruments,
      ),
    ).toThrow(/not active at the manifest-bound observation time/u);
    expect(() =>
      assertProjectCommitmentRecord(
        record({
          instrument: {
            ...record().instrument,
            stewardMember: FUNDER_MEMBER,
          },
        }),
        instruments,
      ),
    ).toThrow(/members must be distinct/u);
    const missingIndex = record();
    delete (missingIndex.instrument as Record<string, unknown>).vaultIndex;
    expect(() =>
      assertProjectCommitmentRecord(missingIndex, instruments),
    ).toThrow(/unexpected or missing fields/u);
    expect(() =>
      assertProjectCommitmentRecord(
        record({ observedAt: "2026-07-01T00:00:00.000Z" }),
        instruments,
      ),
    ).toThrow(/not active/u);
    expect(() =>
      assertProjectCommitmentRecord(
        record({ amountMinor: "1.5" }),
        instruments,
      ),
    ).toThrow(/integer minor units/u);
    expect(() =>
      assertProjectCommitmentRecord(record({ event: "sweep" }), instruments),
    ).toThrow(/event is invalid/u);
  });

  it("requires independent finalized evidence before verification", () => {
    expect(() =>
      assertProjectCommitmentRecord(
        record({ state: "self-reported", finality: { kind: "unverified" } }),
        instruments,
      ),
    ).toThrow(/cannot claim independent verification/u);
    expect(() =>
      assertProjectCommitmentRecord(
        record({
          verifier: {
            version: "commitment-squads-v2",
            checkedAt: "2026-08-02T01:00:00.000Z",
            evidenceUrl: `https://attacker.example/tx/${DEPOSIT_SIGNATURE}`,
            reason: null,
          },
        }),
        instruments,
      ),
    ).toThrow(/evidence is invalid/u);
    expect(() =>
      assertProjectCommitmentRecord(
        record({
          verifier: {
            version: "commitment-sablier-v1",
            checkedAt: "2026-08-02T01:00:00.000Z",
            evidenceUrl: `https://solscan.io/tx/${DEPOSIT_SIGNATURE}`,
            reason: null,
          },
        }),
        instruments,
      ),
    ).toThrow(/version does not match its instrument/u);
    expect(() =>
      assertProjectCommitmentRecord(
        record({
          verifier: {
            version: "commitment-squads-v1",
            checkedAt: "2026-08-02T01:00:00.000Z",
            evidenceUrl: `https://solscan.io/tx/${DEPOSIT_SIGNATURE}`,
            reason: null,
          },
        }),
        instruments,
      ),
    ).toThrow(/version does not match its instrument/u);
    expect(
      assertProjectCommitmentRecord(
        record({
          state: "self-reported",
          finality: { kind: "unverified" },
          verifier: null,
        }),
        instruments,
      ).state,
    ).toBe("self-reported");
  });

  it("allows only an ordered superseding correction for the same transaction", () => {
    const original = assertProjectCommitmentRecord(record(), instruments);
    const correction = record({
      recordId: "cmt_fixture_02",
      observedAt: "2026-08-03T00:00:00.000Z",
      state: "disputed",
      verifier: {
        version: "commitment-squads-v2",
        checkedAt: "2026-08-03T00:00:00.000Z",
        evidenceUrl: `https://solscan.io/tx/${DEPOSIT_SIGNATURE}`,
        reason: "Deposit evidence was invalidated.",
      },
      supersedes: original.recordId,
    });
    const ledger = assertProjectCommitmentLedger(
      [original, correction],
      instruments,
    );
    expect(
      currentProjectCommitmentRecords(ledger).map(({ recordId }) => recordId),
    ).toEqual(["cmt_fixture_02"]);
    expect(commitmentVerifiedNetMinor(ledger)).toBe(0n);
    expect(() =>
      assertProjectCommitmentLedger(
        [original, { ...correction, supersedes: null }],
        instruments,
      ),
    ).toThrow(/duplicate or correction chain/u);
    expect(() =>
      assertProjectCommitmentLedger(
        [original, { ...correction, event: "release" }],
        instruments,
      ),
    ).toThrow(/changes transaction identity/u);
    expect(() =>
      assertProjectCommitmentLedger(
        [original, { ...correction, observedAt: original.observedAt }],
        instruments,
      ),
    ).toThrow(/not later/u);
  });

  it("keeps verified and self-reported per-event totals separate", () => {
    const release = record({
      recordId: "cmt_fixture_03",
      event: "release",
      transactionId: RELEASE_SIGNATURE,
      amountMinor: "1000000",
      observedAt: "2026-08-04T00:00:00.000Z",
      verifier: {
        version: "commitment-squads-v2",
        checkedAt: "2026-08-04T00:00:00.000Z",
        evidenceUrl: `https://solscan.io/tx/${RELEASE_SIGNATURE}`,
        reason: null,
      },
    });
    const selfReported = record({
      recordId: "cmt_fixture_04",
      transactionId: "5".repeat(88),
      amountMinor: "7000000",
      state: "self-reported",
      finality: { kind: "unverified" },
      verifier: null,
    });
    const ledger = assertProjectCommitmentLedger(
      [record(), release, selfReported],
      instruments,
    );
    expect(projectCommitmentTotals(ledger)).toEqual({
      asset: "USDC",
      selfReportedDepositMinor: "7000000",
      selfReportedRefundMinor: "0",
      selfReportedReleaseMinor: "0",
      verifiedDepositMinor: "5000000",
      verifiedRefundMinor: "0",
      verifiedReleaseMinor: "1000000",
    });
    expect(commitmentVerifiedNetMinor(ledger)).toBe(4000000n);
  });

  it("fails closed when committed claims exceed the verified ledger", () => {
    const ledger = assertProjectCommitmentLedger([record()], instruments);
    expect(() =>
      assertCommittedFundingBound(
        "eliza",
        { committedMinor: "5000000", fundingState: "committed" },
        [squadsInstrument()],
        ledger,
      ),
    ).not.toThrow();
    expect(() =>
      assertCommittedFundingBound(
        "eliza",
        { committedMinor: "5000001", fundingState: "committed" },
        [squadsInstrument()],
        ledger,
      ),
    ).toThrow(/exceeds the verified commitment balance/u);
    expect(() =>
      assertCommittedFundingBound(
        "eliza",
        { committedMinor: "1", fundingState: "committed" },
        [squadsInstrument({ replacedAt: "2026-09-01T00:00:00.000Z" })],
        ledger,
      ),
    ).toThrow(/without an active instrument/u);
    expect(() =>
      assertCommittedFundingBound(
        "eliza",
        { committedMinor: "0", fundingState: "pledged" },
        [],
        [],
      ),
    ).not.toThrow();
  });
});
