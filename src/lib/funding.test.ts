/** Proves direct funding stays manifest-bound, append-only, and non-custodial. */

import { describe, expect, it } from "vitest";
import {
  assertProjectFundingAddresses,
  assertProjectFundingIndex,
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
            actorNodeId: "MDQ6VXNlcjE4NjMzMjY0",
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
        {
          ...verified,
          verifier: {
            ...(verified.verifier ?? {}),
            version: "funding-bitcoin-v1",
          },
        },
        routes,
      ),
    ).toThrow(/version does not match its network/u);
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

  it("allows a later correction after rotation without permitting recipient mutation", () => {
    const rotatedRoutes = assertProjectFundingAddresses([
      {
        network: "ethereum",
        asset: "USDC",
        address: ADDRESS,
        effectiveAt: "2026-08-01T00:00:00.000Z",
        replacedAt: "2026-08-03T00:00:00.000Z",
      },
      {
        network: "ethereum",
        asset: "USDC",
        address: `0x${"2".repeat(40)}`,
        effectiveAt: "2026-08-03T00:00:00.000Z",
        replacedAt: null,
      },
    ]);
    const original = record();
    const correction = record({
      recordId: "fund_rotated_correction",
      observedAt: "2026-08-04T00:00:00.000Z",
      state: "disputed",
      finality: { kind: "confirmations", confirmations: 64 },
      verifier: {
        version: "funding-ethereum-v1",
        checkedAt: "2026-08-04T00:00:00.000Z",
        evidenceUrl: `https://etherscan.io/tx/${TRANSACTION}`,
        reason: "A later reorg invalidated the original evidence.",
      },
      supersedes: original.recordId,
    });
    expect(
      assertProjectFundingLedger([original, correction], rotatedRoutes).map(
        ({ recordId }) => recordId,
      ),
    ).toEqual(["fund_fixture_01", "fund_rotated_correction"]);

    expect(() =>
      assertProjectFundingLedger(
        [
          original,
          {
            ...correction,
            recipient: `0x${"2".repeat(40)}`,
          },
        ],
        rotatedRoutes,
      ),
    ).toThrow(/changes transaction identity/u);

    expect(() =>
      assertProjectFundingRecord(correction, [rotatedRoutes[1]]),
    ).toThrow(/absent from.*route history/u);
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
    expect(publicFundingRecordsForDonor(ledger, "MDQ6VXNlcjI=")).toEqual([
      expect.objectContaining({ recordId: "fund_otherdonor_01" }),
    ]);
    expect(
      publicFundingRecordsForDonor(ledger, "MDQ6VXNlcjE4NjMzMjY1"),
    ).toEqual([]);
  });

  it("rejects one transaction recorded as both direct and committed funding", () => {
    const vault = "Vote111111111111111111111111111111111111111";
    const multisig = "11111111111111111111111111111111";
    const funderMember = "Stake11111111111111111111111111111111111111";
    const stewardMember = "SysvarRent111111111111111111111111111111111";
    const transactionId = "3".repeat(88);
    const solanaRoutes = assertProjectFundingAddresses([
      {
        network: "solana",
        asset: "USDC",
        address: vault,
        effectiveAt: "2026-08-01T00:00:00.000Z",
        replacedAt: null,
      },
    ]);
    const direct = record({
      network: "solana",
      transactionId,
      recipient: vault,
      amountMinor: "5000000",
      state: "verified-on-chain",
      finality: { kind: "finalized" },
      verifier: {
        version: "funding-solana-v1",
        checkedAt: "2026-08-02T01:00:00.000Z",
        evidenceUrl: `https://solscan.io/tx/${transactionId}`,
        reason: null,
      },
    });
    const instrument = {
      kind: "squads-v4-vault",
      network: "solana",
      asset: "USDC",
      multisig,
      vault,
      vaultIndex: 0,
      funderMember,
      stewardMember,
      funderActorId: "18633264",
      deadline: "2026-12-01T00:00:00.000Z",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      replacedAt: null,
    } as const;
    const commitment = {
      schemaVersion: "1",
      kind: "project-commitment",
      recordId: "cmt_duplicate_transaction_01",
      projectId: "eliza",
      manifestRevision: "b".repeat(40),
      event: "deposit",
      network: "solana",
      asset: "USDC",
      instrument: {
        funderMember,
        multisig,
        stewardMember,
        vault,
        vaultIndex: 0,
      },
      transactionId,
      amountMinor: "5000000",
      observedAt: "2026-08-02T00:00:00.000Z",
      state: "verified-on-chain",
      finality: { kind: "finalized" },
      verifier: {
        version: "commitment-squads-v2",
        checkedAt: "2026-08-02T01:00:00.000Z",
        evidenceUrl: `https://solscan.io/tx/${transactionId}`,
        reason: null,
      },
      supersedes: null,
    };

    expect(() =>
      assertProjectFundingIndex(
        {
          schemaVersion: "1",
          generatedAt: "2026-08-03T00:00:00.000Z",
          records: [direct],
          commitments: [commitment],
        },
        new Map([["eliza", solanaRoutes]]),
        new Map([["eliza", [instrument]]]),
      ),
    ).toThrow(/transaction.*multiple funding ledgers/u);
  });
});
