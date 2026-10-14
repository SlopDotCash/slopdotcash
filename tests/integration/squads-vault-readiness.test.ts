/// <reference types="bun-types" />
/**
 * End-to-end readiness regression for a Squads 2-of-2 commitment whose rent
 * collector is unset.
 *
 * The account observation is the finalized mainnet multisig, so the byte layout
 * is chain state and not a shape this test chose. Readiness previously read the
 * member permission masks at fixed offsets that hold only when the rent
 * collector is set. On this account it read 99 and 0, computed a mask of 3, and
 * blocked release with the execution-role reason. The vault holds funds and the
 * reviewed members can propose, vote, and execute, so release must be ready.
 */

import { describe, expect, test } from "bun:test";
import { SOLANA_PLATFORM_FEE_RECIPIENT } from "../../src/lib/fresh-cycle-policy.mjs";
import {
  type FundingReadinessEvidence,
  verifyFundingReadiness,
} from "../../src/lib/funding-readiness";
import { fundingReviewProposalSha256 } from "../../src/lib/funding-review-submission";
import { assertRewardAllocationManifest } from "../../src/lib/rewards";
import { SOLANA_MAINNET_USDC_MINT } from "../../src/lib/settlement-plan";
import {
  deriveSquadsVaultAddress,
  deriveVaultUsdcTokenAccount,
  SPL_TOKEN_PROGRAM_ID,
  SQUADS_V4_PROGRAM_ID,
} from "../../src/lib/squads-funding";

const MULTISIG = "1NDS49JiZgQYm8oAcE2wc3KZWDFZimMHgL2XXdjpr2o";
const FUNDER = "BfafLsFDSp5BFCVo47amqjU6FpBsXEKCk8hkFkG5eg5Z";
const STEWARD = "Du3Nsn2ZPumMddfgiZ4TZbaGjFbsj7yJhiNf2vH8xKJz";
const RECIPIENT = "SysvarRent111111111111111111111111111111111";
const COMMIT = "a".repeat(40);
const NOW = "2026-08-15T00:01:00.000Z";

/** Finalized mainnet multisig with an unset rent collector. Read from Solana RPC. */
const MAINNET_UNSET_COLLECTOR =
  "4HR5ukShT+zCOTolVJgy2ZDC7/w6yx2N+sjZ58Ej9mlDdliYlRYv7gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAQAAAAAAAAAAAAAAAAAAAAD/AgAAAJ53AC6Rf2nQcqTsRWzJNiW+Gi4/zfu3fXJkg04fx0CsB7+hIg/i0tJY7SdQNB/pS00A5Bo5Yd6b2+pIJaic8FZjBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const EXECUTION_ROLE_REASON =
  "Execution requires proposer and executor roles across the voting members and zero timelock";

const VAULT = await deriveSquadsVaultAddress(MULTISIG, 0);
const TOKEN_ACCOUNT = await deriveVaultUsdcTokenAccount(VAULT);
const INSTRUMENT_ID = `squads-v4-vault:solana:${MULTISIG}:0:${VAULT}`;

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

function multisigAccount(
  data = MAINNET_UNSET_COLLECTOR,
  overrides: Record<string, unknown> = {},
) {
  return {
    executable: false,
    owner: SQUADS_V4_PROGRAM_ID,
    data: [data, "base64"],
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

async function readiness(accountData = MAINNET_UNSET_COLLECTOR) {
  const instrument = {
    kind: "squads-v4-vault",
    network: "solana",
    asset: "USDC",
    multisig: MULTISIG,
    vault: VAULT,
    vaultIndex: 0,
    funderActorId: "18633264",
    funderMember: FUNDER,
    stewardMember: STEWARD,
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
    instrumentId: INSTRUMENT_ID,
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
      feeRecipient: SOLANA_PLATFORM_FEE_RECIPIENT,
    },
    reviewedAt: "2026-07-31T21:00:00.000Z",
    reviewedCommit: COMMIT,
    instrumentBytes: encode(instrument),
    allocationSha256: await fundingReviewProposalSha256(allocationBytes),
    observedAt: NOW,
    accounts: {
      context: { slot: 500 },
      value: [multisigAccount(accountData), tokenAccount("1010000")],
    },
    tokenAccount: TOKEN_ACCOUNT,
    cluster: "mainnet-beta",
    commitment: "finalized",
    fundedProposalHistory: [
      {
        projectId: allocation.projectId,
        cycleId: allocation.cycleId,
        instrumentId: INSTRUMENT_ID,
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
          stewardMember: STEWARD,
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
    signerReports: (
      [
        ["funder", FUNDER],
        ["steward", STEWARD],
      ] as const
    ).map(([role, member]) => ({
      projectId: "eliza",
      cycleId: "2026-07",
      instrumentId: INSTRUMENT_ID,
      role,
      member,
      capability: "can-sign" as const,
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
    allocationBytes,
    run: () =>
      verifyFundingReadiness({
        allocationBytes,
        now: NOW,
        loadTrustedEvidence: async () => evidence,
      }),
  };
}

describe("Squads v4 2-of-2 vault readiness", () => {
  test("releases a vault whose rent collector is unset without an execution-role block", async () => {
    const result = await (await readiness()).run();
    expect(result.reasons).not.toContain(EXECUTION_ROLE_REASON);
    expect(result).toMatchObject({
      status: "ready",
      reasons: [],
      paymentAuthorized: false,
      publicAccessibility: "unknown",
      requiredMinor: "1010000",
      reservedMinor: "0",
    });
  });

  test("keeps the execution-role block when the members cannot propose or execute", async () => {
    const bytes = Uint8Array.from(
      Buffer.from(MAINNET_UNSET_COLLECTOR, "base64"),
    );
    // Give both members Vote only. The pair can then neither propose nor
    // execute, so release must stay blocked with the execution-role reason.
    bytes[132] = 2;
    bytes[165] = 2;
    const weakened = Buffer.from(bytes).toString("base64");
    const result = await (await readiness(weakened)).run();
    expect(result.status).toBe("blocked");
    expect(result.reasons).toContain(EXECUTION_ROLE_REASON);
  });
});
