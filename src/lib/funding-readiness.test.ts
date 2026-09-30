import { describe, expect, it } from "vitest";
import {
  assertFreshCyclePaymentPolicy,
  type FundingReadinessEvidence,
  verifyFundingReadiness,
} from "./funding-readiness";
import { fundingReviewProposalSha256 } from "./funding-review-submission";
import { assertRewardAllocationManifest } from "./rewards";
import { SOLANA_MAINNET_USDC_MINT } from "./settlement-plan";
import {
  deriveSquadsVaultAddress,
  deriveVaultUsdcTokenAccount,
  SPL_TOKEN_PROGRAM_ID,
  SQUADS_V4_PROGRAM_ID,
} from "./squads-funding";

const MULTISIG = "xmWqhNJwNL4z4BcDo1Yh7BbStLU7omVafZNmg91y2Vg";
const VAULT = "FTK6ckiPWbe1jAiRtcPCz9sCrvCV6Y6hAJhAU5b9S3nv";
const FUNDER = "Stake11111111111111111111111111111111111111";
const RECIPIENT = "SysvarRent111111111111111111111111111111111";
const COMMIT = "a".repeat(40);
const NOW = "2026-08-15T00:01:00.000Z";
const instrumentId = `squads-v4-vault:solana:${MULTISIG}:0:${VAULT}`;
const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function publicKeyBytes(value: string): Uint8Array {
  const bytes: number[] = [0];
  for (const character of value) {
    let carry = BASE58.indexOf(character);
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 255;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 255);
      carry >>= 8;
    }
  }
  let zeroes = 0;
  while (value[zeroes] === "1") zeroes += 1;
  return Uint8Array.from([...new Array(zeroes).fill(0), ...bytes.reverse()]);
}

function multisigAccount(overrides: Record<string, unknown> = {}) {
  const bytes = new Uint8Array(198);
  bytes.set([224, 116, 121, 186, 68, 161, 79, 236]);
  new DataView(bytes.buffer).setUint16(72, 2, true);
  new DataView(bytes.buffer).setUint32(128, 2, true);
  bytes.set(publicKeyBytes(FUNDER), 132);
  bytes[164] = 7;
  bytes.set(publicKeyBytes(RECIPIENT), 165);
  bytes[197] = 7;
  return {
    executable: false,
    owner: SQUADS_V4_PROGRAM_ID,
    data: [btoa(String.fromCharCode(...bytes)), "base64"],
    ...overrides,
  };
}

function tokenAccount(balance: string, owner = VAULT) {
  return {
    owner: SPL_TOKEN_PROGRAM_ID,
    data: {
      program: "spl-token",
      parsed: {
        type: "account",
        info: {
          mint: SOLANA_MAINNET_USDC_MINT,
          owner,
          state: "initialized",
          tokenAmount: { amount: balance, decimals: 6 },
        },
      },
    },
  };
}

function accountsResult(
  balance: string,
  slot = 500,
  multisig = multisigAccount(),
) {
  return { context: { slot }, value: [multisig, tokenAccount(balance)] };
}

function approvedAllocation() {
  return assertRewardAllocationManifest({
    schemaVersion: "1",
    kind: "reward-allocation",
    projectId: "eliza",
    cycleId: "2026-07",
    status: "approved",
    generatedAt: "2026-08-01T00:00:00.000Z",
    approvedAt: "2026-08-15T00:00:00.000Z",
    contributionWindow: {
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    },
    review: {
      days: 14,
      lastMaterialChangeAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-08-15T00:00:00.000Z",
    },
    currency: "USDC",
    chain: "solana",
    capMinor: "10000000000",
    feeBasisPoints: 100,
    scoringRuleVersion: "gitarmy-v1",
    sourceSnapshotSha256: "b".repeat(64),
    allocations: [
      {
        intentId: "pay_eliza_2026_07_u1",
        actor: { id: "U_1", login: "contributor" },
        score: 100,
        suggestedMinor: "1000000",
        approvedMinor: "1000000",
        state: "approved",
        wallet: {
          address: RECIPIENT,
          chain: "solana",
          observedAt: "2026-08-01T00:00:00.000Z",
          sourceCommit: COMMIT,
          sourceUrl: `https://github.com/contributor/contributor/blob/${COMMIT}/README.md`,
        },
        evidenceEventIds: ["event_1"],
        adjustmentReason: null,
        relatedParty: false,
        platformApproval: null,
      },
    ],
    totals: {
      suggestedMinor: "1000000",
      approvedMinor: "1000000",
      feeMinor: "10000",
    },
  });
}

async function fixture() {
  const instrument = {
    kind: "squads-v4-vault",
    network: "solana",
    asset: "USDC",
    multisig: MULTISIG,
    vault: VAULT,
    vaultIndex: 0,
    funderActorId: "18633264",
    funderMember: FUNDER,
    stewardMember: RECIPIENT,
    stewardGithub: { actorId: "42", nodeId: "U_42", login: "independent" },
    monthlyCommitment: {
      cycleId: "2026-07",
      amountMinor: "10000000000",
      accessibility: "unknown",
    },
    effectiveAt: "2026-07-01T00:00:00.000Z",
    deadline: "2026-08-01T00:00:00.000Z",
    replacedAt: null,
  };
  const allocation = approvedAllocation();
  allocation.fundingBasis = {
    cycleId: allocation.cycleId,
    instrumentId,
    fundingState: "committed",
    committedMinor: allocation.capMinor,
    monthlyCapMinor: allocation.capMinor,
  };
  const allocationBytes = encode(allocation);
  const evidence: FundingReadinessEvidence = {
    policy: {
      schemaVersion: "1",
      kind: "fresh-cycle-payment-policy",
      projectId: "eliza",
      cycleId: "2026-07",
      effectiveAt: "2026-07-31T22:00:00.000Z",
      planningExpiresAt: "2026-09-01T00:00:00.000Z",
      instrumentSha256: await fundingReviewProposalSha256(encode(instrument)),
      feeRecipient: FUNDER,
    },
    reviewedAt: "2026-07-31T21:00:00.000Z",
    reviewedCommit: COMMIT,
    instrumentBytes: encode(instrument),
    allocationSha256: await fundingReviewProposalSha256(allocationBytes),
    observedAt: NOW,
    accounts: accountsResult("1010000"),
    tokenAccount: await deriveVaultUsdcTokenAccount(VAULT),
    cluster: "mainnet-beta",
    commitment: "finalized",
    fundedProposalHistory: [
      {
        projectId: allocation.projectId,
        cycleId: allocation.cycleId,
        instrumentId,
        firstPublishedAt: allocation.generatedAt,
        generatedAt: allocation.generatedAt,
        sourceSnapshotSha256: allocation.sourceSnapshotSha256,
      },
    ],
    fundingRecords: [
      {
        schemaVersion: "1",
        kind: "project-commitment",
        recordId: "cmt_fixture_01",
        projectId: "eliza",
        manifestRevision: COMMIT,
        event: "deposit",
        network: "solana",
        asset: "USDC",
        instrument: {
          multisig: MULTISIG,
          vault: VAULT,
          vaultIndex: 0,
          funderMember: FUNDER,
          stewardMember: RECIPIENT,
        },
        transactionId: "3".repeat(88),
        amountMinor: "1010000",
        observedAt: NOW,
        state: "verified-on-chain",
        finality: { kind: "finalized" },
        verifier: {
          version: "commitment-squads-v2",
          checkedAt: NOW,
          evidenceUrl: `https://solscan.io/tx/${"3".repeat(88)}`,
          reason: null,
        },
        supersedes: null,
      },
    ],
    signerReports: (["funder", "steward"] as const).map((role) => ({
      projectId: "eliza",
      cycleId: "2026-07",
      instrumentId,
      role,
      member: role === "funder" ? FUNDER : RECIPIENT,
      capability: "can-sign",
      reportedAt: NOW,
      expiresAt: "2026-08-16T00:00:00.000Z",
      reason: "Authenticated current signer",
      sourceRepository: "SlopDotCash/slopdotcash",
      sourceCommit: COMMIT,
    })),
    reservations: [],
    reservationRevision: "c".repeat(64),
  };
  return {
    evidence,
    allocation,
    allocationBytes,
    run: () =>
      verifyFundingReadiness({
        allocationBytes,
        now: NOW,
        loadTrustedEvidence: async () => evidence,
      }),
  };
}

describe("standalone fresh-cycle readiness candidate", () => {
  it("requires all evidence and never grants payment or public accessibility", async () => {
    const f = await fixture();
    const before = structuredClone(f.evidence);
    expect(await f.run()).toMatchObject({
      status: "ready",
      reasons: [],
      paymentAuthorized: false,
      publicAccessibility: "unknown",
      requiredMinor: "1010000",
      reservedMinor: "0",
    });
    expect(f.evidence).toEqual(before);
  });
  it.each([
    [
      "missing policy",
      (e: FundingReadinessEvidence) => {
        e.policy = null;
      },
    ],
    [
      "retroactive review",
      (e: FundingReadinessEvidence) => {
        e.reviewedAt = NOW;
      },
    ],
    [
      "wrong allocation",
      (e: FundingReadinessEvidence) => {
        e.allocationSha256 = "d".repeat(64);
      },
    ],
    [
      "wrong instrument bytes",
      (e: FundingReadinessEvidence) => {
        e.instrumentBytes = encode({});
      },
    ],
    [
      "stale evidence",
      (e: FundingReadinessEvidence) => {
        e.observedAt = "2026-08-14T23:55:59.999Z";
      },
    ],
    [
      "future evidence",
      (e: FundingReadinessEvidence) => {
        e.observedAt = "2026-08-16T00:00:00.000Z";
      },
    ],
    [
      "balance missing fee",
      (e: FundingReadinessEvidence) => {
        e.accounts = accountsResult("1000000");
      },
    ],
    [
      "balance alone",
      (e: FundingReadinessEvidence) => {
        e.fundingRecords = [];
        e.signerReports = [];
      },
    ],
    [
      "wrong funding project",
      (e: FundingReadinessEvidence) => {
        (e.fundingRecords[0] as { projectId: string }).projectId = "asi";
      },
    ],
    [
      "one signer",
      (e: FundingReadinessEvidence) => {
        e.signerReports.pop();
      },
    ],
    [
      "expired signer",
      (e: FundingReadinessEvidence) => {
        e.signerReports[0].reportedAt = "2026-08-14T23:00:00.000Z";
        e.signerReports[0].expiresAt = NOW;
      },
    ],
    [
      "historical loss",
      (e: FundingReadinessEvidence) => {
        e.signerReports.push({
          ...e.signerReports[0],
          capability: "lost-access",
          expiresAt: null,
          reportedAt: "2026-08-14T00:00:00.000Z",
        });
      },
    ],
    [
      "wrong signer identity",
      (e: FundingReadinessEvidence) => {
        e.signerReports[0].cycleId = "2026-08";
      },
    ],
    [
      "wrong configuration",
      (e: FundingReadinessEvidence) => {
        e.accounts = accountsResult(
          "1010000",
          500,
          multisigAccount({ owner: SPL_TOKEN_PROGRAM_ID }),
        );
      },
    ],
    [
      "wrong ATA",
      (e: FundingReadinessEvidence) => {
        e.tokenAccount = FUNDER;
      },
    ],
    [
      "missing reservation revision",
      (e: FundingReadinessEvidence) => {
        e.reservationRevision = "";
      },
    ],
  ] as const)("blocks %s", async (_name, mutate) => {
    const f = await fixture();
    mutate(f.evidence);
    const result = await f.run();
    expect(result.status).toBe("blocked");
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.publicAccessibility).toBe("unknown");
  });
  it("allows August work funded in September before its first proposal freezes", async () => {
    const f = await fixture();
    const shift = <T>(value: T): T =>
      JSON.parse(
        JSON.stringify(value)
          .replaceAll("2026-09", "2026-10")
          .replaceAll("2026-08", "2026-09")
          .replaceAll("2026-07", "2026-08"),
      );
    const allocation = shift(f.allocation);
    allocation.contributionWindow.from = "2026-08-01T00:00:00.000Z";
    allocation.generatedAt = "2026-09-02T00:00:00.000Z";
    allocation.review.lastMaterialChangeAt = allocation.generatedAt;
    allocation.review.endsAt = "2026-09-16T00:00:00.000Z";
    allocation.approvedAt = allocation.review.endsAt;
    const allocationBytes = encode(allocation);
    const evidence = shift(f.evidence);
    evidence.instrumentBytes = encode(
      shift(JSON.parse(new TextDecoder().decode(f.evidence.instrumentBytes))),
    );
    evidence.fundedProposalHistory[0].generatedAt = allocation.generatedAt;
    evidence.fundedProposalHistory[0].firstPublishedAt = allocation.generatedAt;
    evidence.allocationSha256 =
      await fundingReviewProposalSha256(allocationBytes);
    evidence.policy = {
      ...(evidence.policy as object),
      effectiveAt: "2026-09-01T12:00:00.000Z",
      instrumentSha256: await fundingReviewProposalSha256(
        evidence.instrumentBytes,
      ),
    };
    evidence.reviewedAt = "2026-09-01T11:00:00.000Z";
    const now = "2026-09-16T00:01:00.000Z";
    evidence.observedAt = now;
    evidence.signerReports = evidence.signerReports.map((r) => ({
      ...r,
      reportedAt: now,
      expiresAt: "2026-09-17T00:00:00.000Z",
    }));
    expect(
      await verifyFundingReadiness({
        allocationBytes,
        now,
        loadTrustedEvidence: async () => evidence,
      }),
    ).toMatchObject({ status: "ready", paymentAuthorized: false, reasons: [] });
    evidence.reviewedAt = allocation.generatedAt;
    expect(
      (
        await verifyFundingReadiness({
          allocationBytes,
          now,
          loadTrustedEvidence: async () => evidence,
        })
      ).status,
    ).toBe("blocked");
  });
  it("permits only the exact already-reserved plan without releasing its reserved amount", async () => {
    const f = await fixture();
    f.evidence.reservations = [
      {
        planSha256: "e".repeat(64),
        instrumentId,
        intentIds: [f.allocation.allocations[0].intentId],
        principalMinor: "1000000",
        feeMinor: "10000",
        state: "issued",
        retirementEvidenceSha256: null,
      },
    ];
    f.evidence.releasePlanSha256 = "e".repeat(64);
    expect(await f.run()).toMatchObject({
      status: "ready",
      reservedMinor: "1010000",
      paymentAuthorized: false,
    });
    f.evidence.reservations[0].feeMinor = "9999";
    expect((await f.run()).status).toBe("blocked");
  });
  it("expiry blocks new plans without releasing existing reservations", async () => {
    const f = await fixture();
    f.evidence.policy = {
      ...(f.evidence.policy as object),
      planningExpiresAt: NOW,
    };
    f.evidence.reservations = [
      {
        planSha256: "e".repeat(64),
        instrumentId,
        intentIds: ["issued_intent"],
        principalMinor: "1000000",
        feeMinor: "10000",
        state: "issued",
        retirementEvidenceSha256: null,
      },
    ];
    const result = await f.run();
    expect(result).toMatchObject({
      status: "blocked",
      reservedMinor: "1010000",
    });
    expect(result.reasons.some((r) => r.includes("expired"))).toBe(true);
  });
  it("rejects imported carry despite an approved source", async () => {
    const f = await fixture();
    f.allocation.carriedMinor = "1";
    f.allocation.minimumTransferMinor = "2000000";
    const bytes = encode(f.allocation);
    f.evidence.allocationSha256 = await fundingReviewProposalSha256(bytes);
    expect(
      (
        await verifyFundingReadiness({
          allocationBytes: bytes,
          now: NOW,
          loadTrustedEvidence: async () => f.evidence,
        })
      ).status,
    ).toBe("blocked");
  });
  it("keeps issued principal and fee reserved after signer loss", async () => {
    const f = await fixture();
    f.evidence.reservations = [
      {
        planSha256: "e".repeat(64),
        instrumentId,
        intentIds: ["older_cycle_intent"],
        principalMinor: "3000000",
        feeMinor: "30000",
        state: "issued",
        retirementEvidenceSha256: null,
      },
    ];
    f.evidence.signerReports[0] = {
      ...f.evidence.signerReports[0],
      capability: "lost-access",
      expiresAt: null,
    };
    expect(await f.run()).toMatchObject({
      status: "blocked",
      reservedMinor: "3030000",
    });
    f.evidence.signerReports = (await fixture()).evidence.signerReports;
    expect((await f.run()).status).toBe("blocked");
    f.evidence.reservations[0].state = "retired";
    expect((await f.run()).status).toBe("blocked");
    f.evidence.reservations[0].retirementEvidenceSha256 = "f".repeat(64);
    expect((await f.run()).status).toBe("ready");
    f.evidence.reservations[0].intentIds = [
      f.allocation.allocations[0].intentId,
    ];
    expect((await f.run()).status).toBe("blocked");
  });
  it("fails closed when the authenticated loader fails", async () => {
    const f = await fixture();
    const result = await verifyFundingReadiness({
      allocationBytes: f.allocationBytes,
      now: NOW,
      loadTrustedEvidence: async () => {
        throw new Error("Incomplete ledger");
      },
    });
    expect(result).toMatchObject({
      status: "blocked",
      reservedMinor: null,
      reasons: ["Incomplete ledger"],
    });
  });
  it.each([
    [3, 6, "ready"],
    [7, 2, "ready"],
    [2, 2, "blocked"],
    [3, 2, "blocked"],
    [6, 2, "blocked"],
  ])(
    "requires collective proposer/executor permissions %s/%s",
    async (first, second, expected) => {
      const f = await fixture();
      const account = multisigAccount();
      const bytes = Uint8Array.from(atob(account.data[0]), (c) =>
        c.charCodeAt(0),
      );
      bytes[164] = Number(first);
      bytes[197] = Number(second);
      account.data[0] = btoa(String.fromCharCode(...bytes));
      f.evidence.accounts = accountsResult("1010000", 500, account);
      expect((await f.run()).status).toBe(expected);
    },
  );
  it("rejects policy fields that could silently relax scope", async () => {
    const f = await fixture();
    expect(() =>
      assertFreshCyclePaymentPolicy({
        ...(f.evidence.policy as object),
        allowCarry: true,
      }),
    ).toThrow();
  });
});

describe("project vault fresh-cycle readiness (RFC #500)", () => {
  const CREATOR_MULTISIG = "Config1111111111111111111111111111111111111";
  const SLOP = "Vote111111111111111111111111111111111111111";
  const INDEPENDENT = "SysvarC1ock11111111111111111111111111111111";
  const CREATOR_KEY = "BPFLoaderUpgradeab1e11111111111111111111111";
  const OTHER_CREATOR_KEY = "ComputeBudget111111111111111111111111111111";
  const TIME_LOCK = 72 * 60 * 60;
  const projectVaultId = `squads-project-vault:solana:${MULTISIG}:0:${VAULT}`;

  function squadsAccount(
    members: readonly (readonly [string, number])[],
    threshold: number,
    timeLock: number,
  ) {
    // No config authority and no rent collector: members start at byte 100.
    const bytes = new Uint8Array(132 + 33 * members.length);
    bytes.set([224, 116, 121, 186, 68, 161, 79, 236]);
    const view = new DataView(bytes.buffer);
    view.setUint16(72, threshold, true);
    view.setUint32(74, timeLock, true);
    view.setUint32(96, members.length, true);
    members.forEach(([key, permissions], index) => {
      const offset = 100 + 33 * index;
      bytes.set(publicKeyBytes(key), offset);
      bytes[offset + 32] = permissions;
    });
    return {
      executable: false,
      owner: SQUADS_V4_PROGRAM_ID,
      data: [btoa(String.fromCharCode(...bytes)), "base64"],
    };
  }

  async function projectVaultFixture() {
    const creatorMember = await deriveSquadsVaultAddress(CREATOR_MULTISIG, 0);
    const instrument = {
      kind: "squads-project-vault",
      network: "solana",
      asset: "USDC",
      multisig: MULTISIG,
      vault: VAULT,
      vaultIndex: 0,
      creatorActorId: "18633264",
      creatorMember,
      creatorMultisig: CREATOR_MULTISIG,
      creatorVaultIndex: 0,
      slopMember: SLOP,
      independentMember: INDEPENDENT,
      independentGithub: {
        actorId: "42",
        nodeId: "U_42",
        login: "independent",
      },
      timeLockSeconds: TIME_LOCK,
      fallbackWaitSeconds: 14 * 24 * 60 * 60,
      monthlyCommitment: {
        cycleId: "2026-07",
        amountMinor: "10000000000",
        accessibility: "unknown",
      },
      effectiveAt: "2026-07-01T00:00:00.000Z",
      deadline: "2026-08-01T00:00:00.000Z",
      replacedAt: null,
    };
    const vaultAccount = (
      members: readonly (readonly [string, number])[] = [
        [creatorMember, 7],
        [SLOP, 2],
        [INDEPENDENT, 6],
      ],
    ) => squadsAccount(members, 2, TIME_LOCK);
    const creatorAccount = (
      members: readonly (readonly [string, number])[] = [
        [CREATOR_KEY, 7],
        [OTHER_CREATOR_KEY, 7],
      ],
    ) => squadsAccount(members, 1, 0);
    const allocation = approvedAllocation();
    allocation.fundingBasis = {
      cycleId: allocation.cycleId,
      instrumentId: projectVaultId,
      fundingState: "committed",
      committedMinor: allocation.capMinor,
      monthlyCapMinor: allocation.capMinor,
    };
    const allocationBytes = encode(allocation);
    const evidence: FundingReadinessEvidence = {
      policy: {
        schemaVersion: "1",
        kind: "fresh-cycle-payment-policy",
        projectId: "eliza",
        cycleId: "2026-07",
        effectiveAt: "2026-07-31T22:00:00.000Z",
        planningExpiresAt: "2026-09-01T00:00:00.000Z",
        instrumentSha256: await fundingReviewProposalSha256(encode(instrument)),
        feeRecipient: FUNDER,
      },
      reviewedAt: "2026-07-31T21:00:00.000Z",
      reviewedCommit: COMMIT,
      instrumentBytes: encode(instrument),
      allocationSha256: await fundingReviewProposalSha256(allocationBytes),
      observedAt: NOW,
      // Contributor principal only: the fee is the creator's separate transfer.
      accounts: {
        context: { slot: 500 },
        value: [vaultAccount(), tokenAccount("1000000"), creatorAccount()],
      },
      tokenAccount: await deriveVaultUsdcTokenAccount(VAULT),
      cluster: "mainnet-beta",
      commitment: "finalized",
      fundedProposalHistory: [
        {
          projectId: allocation.projectId,
          cycleId: allocation.cycleId,
          instrumentId: projectVaultId,
          firstPublishedAt: allocation.generatedAt,
          generatedAt: allocation.generatedAt,
          sourceSnapshotSha256: allocation.sourceSnapshotSha256,
        },
      ],
      fundingRecords: [
        {
          schemaVersion: "1",
          kind: "project-commitment",
          recordId: "cmt_fixture_pv",
          projectId: "eliza",
          manifestRevision: COMMIT,
          event: "deposit",
          network: "solana",
          asset: "USDC",
          instrument: {
            creatorMember,
            independentMember: INDEPENDENT,
            multisig: MULTISIG,
            slopMember: SLOP,
            vault: VAULT,
            vaultIndex: 0,
          },
          transactionId: "4".repeat(88),
          amountMinor: "1000000",
          observedAt: NOW,
          state: "verified-on-chain",
          finality: { kind: "finalized" },
          verifier: {
            version: "project-vault-squads-v1",
            checkedAt: NOW,
            evidenceUrl: `https://solscan.io/tx/${"4".repeat(88)}`,
            reason: null,
          },
          supersedes: null,
        },
      ],
      signerReports: [
        {
          projectId: "eliza",
          cycleId: "2026-07",
          instrumentId: projectVaultId,
          role: "creator",
          member: CREATOR_KEY,
          capability: "can-sign",
          reportedAt: NOW,
          expiresAt: "2026-08-16T00:00:00.000Z",
          reason: "Creator multisig member can propose",
          sourceRepository: "SlopDotCash/slopdotcash",
          sourceCommit: COMMIT,
        },
        {
          projectId: "eliza",
          cycleId: "2026-07",
          instrumentId: projectVaultId,
          role: "independent",
          member: INDEPENDENT,
          capability: "can-sign",
          reportedAt: NOW,
          expiresAt: "2026-08-16T00:00:00.000Z",
          reason: "Independent signer can vote and execute",
          sourceRepository: "SlopDotCash/slopdotcash",
          sourceCommit: "b".repeat(40),
        },
      ],
      reservations: [],
      reservationRevision: "c".repeat(64),
    };
    return {
      evidence,
      allocation,
      creatorMember,
      vaultAccount,
      creatorAccount,
      run: () =>
        verifyFundingReadiness({
          allocationBytes,
          now: NOW,
          loadTrustedEvidence: async () => evidence,
        }),
    };
  }

  it("is ready when the vault covers contributor principal only and both required signers are current", async () => {
    const f = await projectVaultFixture();
    expect(await f.run()).toMatchObject({
      status: "ready",
      reasons: [],
      paymentAuthorized: false,
      principalMinor: "1000000",
      feeMinor: "10000",
      requiredMinor: "1000000",
      reservedMinor: "0",
    });
  });
  it("proves the reviewed shape, time lock, and creator seat from one observation", async () => {
    const f = await projectVaultFixture();
    const accounts = f.evidence.accounts as { value: unknown[] };
    accounts.value[0] = squadsAccount(
      [
        [f.creatorMember, 7],
        [SLOP, 2],
        [INDEPENDENT, 6],
      ],
      2,
      0,
    );
    expect((await f.run()).reasons).toContain(
      "On-chain time lock differs from the reviewed manifest",
    );
    accounts.value[0] = f.vaultAccount([
      [f.creatorMember, 7],
      [SLOP, 7],
      [INDEPENDENT, 6],
    ]);
    expect((await f.run()).reasons.join()).toMatch(/creator 7, Slop 2/u);
    accounts.value[0] = f.vaultAccount();
    accounts.value.length = 2;
    expect((await f.run()).reasons.join()).toMatch(
      /multisig, its USDC account, and the creator multisig/u,
    );
  });
  it("never releases a plan that pays a Slop address", async () => {
    const f = await projectVaultFixture();
    const wallet = f.allocation.allocations[0].wallet;
    if (!wallet) throw new Error("fixture wallet");
    const paying = (address: string) =>
      verifyFundingReadiness({
        allocationBytes: encode({
          ...f.allocation,
          allocations: [
            { ...f.allocation.allocations[0], wallet: { ...wallet, address } },
          ],
        }),
        now: NOW,
        loadTrustedEvidence: async (digest) => ({
          ...f.evidence,
          allocationSha256: digest,
        }),
      });
    for (const address of [SLOP, FUNDER]) {
      expect((await paying(address)).reasons).toContain(
        "Invalid payable destinations",
      );
    }
  });
  it("binds the creator report to an initiating key inside the creator multisig", async () => {
    const f = await projectVaultFixture();
    f.evidence.signerReports[0].member = f.creatorMember;
    expect((await f.run()).reasons).toContain(
      "Signer report member differs from the reviewed instrument",
    );
    f.evidence.signerReports[0].member = CREATOR_KEY;
    (f.evidence.accounts as { value: unknown[] }).value[2] = f.creatorAccount([
      [CREATOR_KEY, 6],
      [OTHER_CREATOR_KEY, 7],
    ]);
    expect((await f.run()).reasons).toContain(
      "Signer report member differs from the reviewed instrument",
    );
    (f.evidence.accounts as { value: unknown[] }).value[2] = f.creatorAccount([
      [OTHER_CREATOR_KEY, 7],
    ]);
    expect((await f.run()).reasons).toContain(
      "Signer report member differs from the reviewed instrument",
    );
  });
  it("requires the creator and the independent signer, and gives Slop's key no role", async () => {
    const f = await projectVaultFixture();
    f.evidence.signerReports = [f.evidence.signerReports[0]];
    expect((await f.run()).reasons).toContain(
      "The creator and the independent signer must be current; loss or expiry blocks new plans",
    );
    f.evidence.signerReports = (
      await projectVaultFixture()
    ).evidence.signerReports;
    f.evidence.signerReports[1] = {
      ...f.evidence.signerReports[1],
      role: "steward",
      member: INDEPENDENT,
    };
    expect((await f.run()).reasons).toContain("Invalid public signer report");
    f.evidence.signerReports[1] = {
      ...f.evidence.signerReports[1],
      role: "independent",
      capability: "lost-access",
      expiresAt: null,
    };
    expect((await f.run()).reasons).toContain(
      "The creator and the independent signer must be current; loss or expiry blocks new plans",
    );
  });
});
