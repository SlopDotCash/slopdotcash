/** Synthetic fixtures only: no production identity, key, or wallet claim. */
import { describe, expect, it } from "vitest";
import eliza from "../../projects/eliza/project.json";
import {
  assertAllocationFundingBasis,
  deriveAllocationFundingBasis,
} from "./allocation-funding-basis.mjs";
import { assertProjectCommitmentRecord } from "./funding-commitment";
import {
  assertFundingCommitments,
  assertMonthlyCommitmentPolicy,
  PROJECT_VAULT_DEFAULT_FALLBACK_WAIT_SECONDS,
  PROJECT_VAULT_DEFAULT_TIME_LOCK_SECONDS,
  PROJECT_VAULT_MAX_TIME_LOCK_SECONDS,
} from "./funding-instruments.mjs";
import { assertProjectDefinition } from "./project-schema.mjs";

const MULTISIG = "SysvarC1ock11111111111111111111111111111111";
const VAULT = "Vote111111111111111111111111111111111111111";
const CREATOR_MEMBER = "Stake11111111111111111111111111111111111111";
const CREATOR_MULTISIG = "Config1111111111111111111111111111111111111";
const SLOP_MEMBER = "SysvarRent111111111111111111111111111111111";
const INDEPENDENT_MEMBER = "SysvarRecentB1ockHashes11111111111111111111";
const SIGNATURE = "5".repeat(88);

function projectVault(overrides: Record<string, unknown> = {}) {
  return {
    kind: "squads-project-vault",
    network: "solana",
    asset: "USDC",
    multisig: MULTISIG,
    vault: VAULT,
    vaultIndex: 0,
    creatorActorId: "18633264",
    creatorMember: CREATOR_MEMBER,
    creatorMultisig: CREATOR_MULTISIG,
    creatorVaultIndex: 0,
    slopMember: SLOP_MEMBER,
    independentMember: INDEPENDENT_MEMBER,
    independentGithub: {
      actorId: "42",
      nodeId: "U_fixture_42",
      login: "independent-fixture",
    },
    timeLockSeconds: PROJECT_VAULT_DEFAULT_TIME_LOCK_SECONDS,
    fallbackWaitSeconds: PROJECT_VAULT_DEFAULT_FALLBACK_WAIT_SECONDS,
    monthlyCommitment: {
      cycleId: "2026-08",
      amountMinor: "5000000",
      accessibility: "unknown",
    },
    effectiveAt: "2026-08-01T00:00:00.000Z",
    deadline: "2026-09-01T00:00:00.000Z",
    replacedAt: null,
    ...overrides,
  };
}

function without(instrument: Record<string, unknown>, key: string) {
  const { [key]: _removed, ...rest } = instrument;
  return rest;
}

function project(
  commitments: Record<string, unknown>[] = [projectVault()],
  reward: Record<string, unknown> = {},
) {
  return {
    ...structuredClone(eliza),
    reward: {
      ...eliza.reward,
      paymentMode: "disabled",
      fundingState: "committed",
      committedMinor: "5000000",
      ...reward,
    },
    funding: { ...structuredClone(eliza.funding), commitments },
  };
}

describe("squads-project-vault instrument (RFC #500)", () => {
  it("accepts a reviewed project vault with payments disabled and freezes its identity", () => {
    const validated = assertProjectDefinition(project());
    const [instrument] = validated.funding.commitments ?? [];
    expect(instrument).toMatchObject({
      kind: "squads-project-vault",
      slopMember: SLOP_MEMBER,
      timeLockSeconds: 72 * 60 * 60,
      fallbackWaitSeconds: 14 * 24 * 60 * 60,
    });
    const basis = deriveAllocationFundingBasis(validated, "2026-08");
    expect(basis.instrumentId).toBe(
      `squads-project-vault:solana:${MULTISIG}:0:${VAULT}`,
    );
    expect(basis.committedMinor).toBe("5000000");
    expect(() => assertAllocationFundingBasis(basis)).not.toThrow();
    expect(
      deriveAllocationFundingBasis(validated, "2026-09").instrumentId,
    ).toBe(null);
  });

  it("requires the independent signer identity and a monthly binding", () => {
    expect(() =>
      assertFundingCommitments([without(projectVault(), "independentGithub")]),
    ).toThrow(/unexpected or missing fields/u);
    expect(() =>
      assertFundingCommitments([without(projectVault(), "monthlyCommitment")]),
    ).toThrow(/unexpected or missing fields/u);
    expect(() =>
      assertFundingCommitments([
        projectVault({ independentGithub: { actorId: "42", login: "x" } }),
      ]),
    ).toThrow(/independentGithub has unexpected or missing fields/u);
  });

  it("keeps both waits inside the Squads cap with the fallback wait at least the time lock", () => {
    expect(() =>
      assertFundingCommitments([
        projectVault({
          fallbackWaitSeconds: PROJECT_VAULT_DEFAULT_TIME_LOCK_SECONDS - 1,
        }),
      ]),
    ).toThrow(/fallbackWaitSeconds must be at least the time lock/u);
    expect(() =>
      assertFundingCommitments([
        projectVault({
          timeLockSeconds: PROJECT_VAULT_MAX_TIME_LOCK_SECONDS + 1,
          fallbackWaitSeconds: PROJECT_VAULT_MAX_TIME_LOCK_SECONDS + 1,
        }),
      ]),
    ).toThrow(/timeLockSeconds must be between 1 and 7776000/u);
    expect(() =>
      assertFundingCommitments([projectVault({ timeLockSeconds: 0 })]),
    ).toThrow(/timeLockSeconds/u);
    expect(() =>
      assertFundingCommitments([projectVault({ fallbackWaitSeconds: "14d" })]),
    ).toThrow(/fallbackWaitSeconds/u);
  });

  it("requires six distinct Solana addresses and unsigned-byte indexes", () => {
    expect(() =>
      assertFundingCommitments([projectVault({ slopMember: CREATOR_MEMBER })]),
    ).toThrow(/must be distinct/u);
    expect(() =>
      assertFundingCommitments([projectVault({ creatorMultisig: VAULT })]),
    ).toThrow(/must be distinct/u);
    expect(() =>
      assertFundingCommitments([projectVault({ independentMember: "0xabc" })]),
    ).toThrow(/independentMember is invalid/u);
    expect(() =>
      assertFundingCommitments([projectVault({ creatorVaultIndex: 256 })]),
    ).toThrow(/creatorVaultIndex must be an unsigned byte/u);
    expect(() =>
      assertFundingCommitments([projectVault({ creatorActorId: "0" })]),
    ).toThrow(/creatorActorId is invalid/u);
  });

  it("rejects an independent signer who is the creator or the project steward", () => {
    expect(() =>
      assertProjectDefinition(
        project([
          projectVault({
            independentGithub: {
              actorId: "18633264",
              nodeId: "U_fixture_42",
              login: "independent-fixture",
            },
          }),
        ]),
      ),
    ).toThrow(/independent signer identity must differ/u);
    expect(() =>
      assertProjectDefinition(
        project([
          projectVault({
            independentGithub: {
              actorId: "42",
              nodeId: "U_fixture_42",
              login: eliza.steward.github.login.toUpperCase(),
            },
          }),
        ]),
      ),
    ).toThrow(/independent signer identity must differ/u);
  });

  it("rejects a Slop or independent member that is already a project or creator address", () => {
    const retiredTwoOfTwo = {
      kind: "squads-v4-vault",
      network: "solana",
      asset: "USDC",
      multisig: "11111111111111111111111111111111",
      vault: "BPFLoaderUpgradeab1e11111111111111111111111",
      vaultIndex: 0,
      funderActorId: "18633264",
      funderMember: SLOP_MEMBER,
      stewardMember: "SysvarS1otHashes111111111111111111111111111",
      monthlyCommitment: {
        cycleId: "2026-07",
        amountMinor: "5000000",
        accessibility: "unknown",
      },
      effectiveAt: "2026-07-01T00:00:00.000Z",
      deadline: "2026-08-01T00:00:00.000Z",
      replacedAt: "2026-08-01T00:00:00.000Z",
    };
    expect(() =>
      assertProjectDefinition(project([retiredTwoOfTwo, projectVault()])),
    ).toThrow(/Slop and independent members must differ/u);
  });

  it("refuses payment activation on a project vault until the three-member protocol is reviewed", () => {
    expect(() =>
      assertMonthlyCommitmentPolicy(
        project([projectVault()], {
          paymentMode: "enabled",
        }) as unknown as Parameters<typeof assertMonthlyCommitmentPolicy>[0],
      ),
    ).toThrow(/project vault payment activation requires/u);
    expect(() =>
      assertProjectDefinition(
        project([projectVault()], { paymentMode: "enabled" }),
      ),
    ).toThrow();
  });

  it("binds commitment records to the three reviewed members and the project vault verifier", () => {
    const instruments = assertFundingCommitments([projectVault()]);
    const record = (overrides: Record<string, unknown> = {}) => ({
      schemaVersion: "1",
      kind: "project-commitment",
      recordId: "cmt_fixture_pv",
      projectId: "eliza",
      manifestRevision: "b".repeat(40),
      event: "deposit",
      network: "solana",
      asset: "USDC",
      instrument: {
        creatorMember: CREATOR_MEMBER,
        independentMember: INDEPENDENT_MEMBER,
        multisig: MULTISIG,
        slopMember: SLOP_MEMBER,
        vault: VAULT,
        vaultIndex: 0,
      },
      transactionId: SIGNATURE,
      amountMinor: "5000000",
      observedAt: "2026-08-02T00:00:00.000Z",
      state: "verified-on-chain",
      finality: { kind: "finalized" },
      verifier: {
        version: "project-vault-squads-v1",
        checkedAt: "2026-08-02T01:00:00.000Z",
        evidenceUrl: `https://solscan.io/tx/${SIGNATURE}`,
        reason: null,
      },
      supersedes: null,
      ...overrides,
    });
    expect(assertProjectCommitmentRecord(record(), instruments)).toMatchObject({
      event: "deposit",
      state: "verified-on-chain",
    });
    expect(() =>
      assertProjectCommitmentRecord(
        record({
          verifier: { ...record().verifier, version: "commitment-squads-v2" },
        }),
        instruments,
      ),
    ).toThrow(/verifier version does not match its instrument/u);
    expect(() =>
      assertProjectCommitmentRecord(
        record({
          instrument: { ...record().instrument, slopMember: CREATOR_MEMBER },
        }),
        instruments,
      ),
    ).toThrow(/members must be distinct Solana public keys/u);
    expect(() =>
      assertProjectCommitmentRecord(
        record({
          instrument: {
            funderMember: CREATOR_MEMBER,
            multisig: MULTISIG,
            stewardMember: INDEPENDENT_MEMBER,
            vault: VAULT,
            vaultIndex: 0,
          },
        }),
        instruments,
      ),
    ).toThrow(/not active at the manifest-bound observation time/u);
  });
});
