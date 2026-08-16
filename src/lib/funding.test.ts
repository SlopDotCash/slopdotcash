/** Proves direct funding stays manifest-bound, append-only, and non-custodial. */

import { describe, expect, it } from "vitest";
import {
  assertProjectFundingAddresses,
  assertProjectFundingLedger,
  assertProjectFundingRecord,
  currentProjectFundingRecords,
  projectFundingTotals,
  publicFundingRecordsForDonor,
} from "./funding";

const ADDRESS = `0x${"1".repeat(40)}`;
const TRANSACTION = `0x${"a".repeat(64)}`;
const routes = assertProjectFundingAddresses([
  {
    network: "ethereum",
    asset: "USDC",
    address: ADDRESS,
    effectiveAt: "2026-08-01T00:00:00.000Z",
    replacedAt: null,
  },
]);

function record(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1",
    kind: "project-funding",
    recordId: "fund_fixture_01",
    projectId: "eliza",
    manifestRevision: "b".repeat(40),
    network: "ethereum",
    asset: "USDC",
    transactionId: TRANSACTION,
    recipient: ADDRESS,
    amountMinor: "1000000",
    observedAt: "2026-08-02T00:00:00.000Z",
    state: "self-reported",
    donor: {
      attribution: "github",
      actorId: "18633264",
      actorNodeId: "MDQ6VXNlcjE4NjMzMjY0",
      login: "lalalune",
    },
    finality: { kind: "unverified" },
    verifier: null,
    supersedes: null,
    ...overrides,
  };
}

describe("project funding records", () => {
  it("retains non-overlapping receiving history and rejects ambiguous time", () => {
    expect(
      assertProjectFundingAddresses([
        {
          network: "ethereum",
          asset: "USDC",
          address: ADDRESS,
          effectiveAt: "2026-08-01T00:00:00.000Z",
          replacedAt: "2026-08-02T00:00:00.000Z",
        },
        {
          network: "ethereum",
          asset: "USDC",
          address: `0x${"2".repeat(40)}`,
          effectiveAt: "2026-08-02T00:00:00.000Z",
          replacedAt: null,
        },
      ]),
    ).toHaveLength(2);
    expect(() =>
      assertProjectFundingAddresses([
        ...routes.map((route) => ({
          ...route,
          replacedAt: "2026-08-03T00:00:00.000Z",
        })),
        {
          network: "ethereum",
          asset: "USDC",
          address: `0x${"2".repeat(40)}`,
          effectiveAt: "2026-08-02T00:00:00.000Z",
          replacedAt: null,
        },
      ]),
    ).toThrow(/overlapping active routes/u);
    expect(() =>
      assertProjectFundingAddresses([
        { ...routes[0], effectiveAt: "2026-02-30T00:00:00.000Z" },
      ]),
    ).toThrow(/invalid/u);
  });

  it("binds a self-report to the exact active manifest address", () => {
    expect(assertProjectFundingRecord(record(), routes)).toMatchObject({
      state: "self-reported",
      recipient: ADDRESS,
    });
    expect(() =>
      assertProjectFundingRecord(
        record({ recipient: `0x${"2".repeat(40)}` }),
        routes,
      ),
    ).toThrow(/not active/u);
    expect(() =>
      assertProjectFundingRecord(record({ amountMinor: "1.0" }), routes),
    ).toThrow(/integer minor units/u);
    expect(() =>
      assertProjectFundingRecord(
        record({ amountMinor: "1".repeat(41) }),
        routes,
      ),
    ).toThrow(/integer minor units/u);
    expect(() =>
      assertProjectFundingRecord(
        record({ observedAt: "2026-02-30T00:00:00.000Z" }),
        routes,
      ),
    ).toThrow(/invalid/u);
    expect(() =>
      assertProjectFundingRecord(
        record({
          donor: {
            attribution: "github",
            actorId: "1".repeat(21),
            login: "lalalune",
          },
        }),
        routes,
      ),
    ).toThrow(/donor identity/u);
    expect(() =>
      assertProjectFundingRecord(
        record({
          state: "verified-on-chain",
          finality: { kind: "confirmations", confirmations: 64 },
          verifier: {
            version: "funding-ethereum-v1",
            checkedAt: "2026-08-01T23:59:59.000Z",
            evidenceUrl: `https://etherscan.io/tx/${TRANSACTION}`,
            reason: null,
          },
        }),
        routes,
      ),
    ).toThrow(/predates/u);
  });

  it("requires network finality and independent evidence before verification", () => {
    const verified = record({
      state: "verified-on-chain",
      finality: { kind: "confirmations", confirmations: 64 },
      verifier: {
        version: "funding-ethereum-v1",
        checkedAt: "2026-08-02T01:00:00.000Z",
        evidenceUrl: `https://etherscan.io/tx/${TRANSACTION}`,
        reason: null,
      },
    });
    expect(assertProjectFundingRecord(verified, routes).state).toBe(
      "verified-on-chain",
    );
    expect(() =>
      assertProjectFundingRecord(
        {
          ...verified,
          finality: { kind: "confirmations", confirmations: 63 },
        },
        routes,
      ),
    ).toThrow(/finality/u);
    expect(() =>
      assertProjectFundingRecord(
        {
          ...verified,
          verifier: {
            version: "funding-ethereum-v1",
            checkedAt: "2026-08-02T01:00:00.000Z",
            evidenceUrl: `https://attacker.example/tx/${TRANSACTION}`,
            reason: null,
          },
        },
        routes,
      ),
    ).toThrow(/evidence/u);
    expect(() =>
      assertProjectFundingRecord(
        record({ state: "verified-on-chain" }),
        routes,
      ),
    ).toThrow(/finality|verification|unverified/u);
  });

  it("allows only an ordered superseding correction for the same transaction", () => {
    const original = assertProjectFundingRecord(record(), routes);
    const correction = record({
      recordId: "fund_fixture_02",
      observedAt: "2026-08-03T00:00:00.000Z",
      state: "disputed",
      finality: { kind: "confirmations", confirmations: 64 },
      verifier: {
        version: "funding-ethereum-v1",
        checkedAt: "2026-08-03T00:00:00.000Z",
        evidenceUrl: `https://etherscan.io/tx/${TRANSACTION}`,
        reason: "Recipient evidence was invalidated.",
      },
      supersedes: original.recordId,
    });
    const ledger = assertProjectFundingLedger([original, correction], routes);
    expect(
      currentProjectFundingRecords(ledger).map(({ recordId }) => recordId),
    ).toEqual(["fund_fixture_02"]);
    expect(projectFundingTotals(ledger)).toEqual([
      { asset: "USDC", selfReportedMinor: "0", verifiedMinor: "0" },
    ]);
    expect(() =>
      assertProjectFundingLedger(
        [original, { ...correction, supersedes: null }],
        routes,
      ),
    ).toThrow(/duplicate or correction chain/u);
    expect(() =>
      assertProjectFundingLedger(
        [original, { ...correction, observedAt: original.observedAt }],
        routes,
      ),
    ).toThrow(/not later/u);
  });

  it("never combines self-reported and verified totals", () => {
    const secondTransaction = `0x${"c".repeat(64)}`;
    const verified = record({
      recordId: "fund_fixture_03",
      transactionId: secondTransaction,
      amountMinor: "2500000",
      state: "verified-on-chain",
      finality: { kind: "confirmations", confirmations: 64 },
      verifier: {
        version: "funding-ethereum-v1",
        checkedAt: "2026-08-03T00:00:00.000Z",
        evidenceUrl: `https://etherscan.io/tx/${secondTransaction}`,
        reason: null,
      },
    });
    const ledger = assertProjectFundingLedger([record(), verified], routes);
    expect(projectFundingTotals(ledger)).toEqual([
      {
        asset: "USDC",
        selfReportedMinor: "1000000",
        verifiedMinor: "2500000",
      },
    ]);
  });

  it("projects only current, explicitly attributed records onto donor profiles", () => {
    const anonymousTransaction = `0x${"d".repeat(64)}`;
    const anonymous = record({
      recordId: "fund_anonymous_01",
      transactionId: anonymousTransaction,
      donor: { attribution: "anonymous" },
    });
    const otherDonor = record({
      recordId: "fund_otherdonor_01",
      transactionId: `0x${"e".repeat(64)}`,
      donor: {
        attribution: "github",
        actorId: "2",
        actorNodeId: "MDQ6VXNlcjI=",
        login: "other",
      },
    });
    const ledger = assertProjectFundingLedger(
      [record(), anonymous, otherDonor],
      routes,
    );
    expect(
      publicFundingRecordsForDonor(ledger, "MDQ6VXNlcjE4NjMzMjY0").map(
        ({ recordId }) => recordId,
      ),
    ).toEqual(["fund_fixture_01"]);
    expect(
      publicFundingRecordsForDonor(ledger, "MDQ6VXNlcjE4NjMzMjY0").map(
        ({ recordId }) => recordId,
      ),
    ).toEqual(["fund_fixture_01"]);
    expect(publicFundingRecordsForDonor(ledger, "MDQ6VXNlcjI=")).toEqual([
      expect.objectContaining({ recordId: "fund_otherdonor_01" }),
    ]);
    expect(
      publicFundingRecordsForDonor(ledger, "MDQ6VXNlcjE4NjMzMjY1"),
    ).toEqual([]);
  });
});
