import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertFundingCommitments } from "../src/lib/funding-instruments.mjs";
import { fundingReviewProposalSha256 } from "../src/lib/funding-review-submission";
import {
  draftPaymentReservation,
  paymentRecordBytes,
  reservedPlanBytes,
} from "../src/lib/payment-reservations";
import * as projects from "../src/lib/projects.mjs";
import { assertRewardAllocationManifest } from "../src/lib/rewards";
import * as loader from "./load-payment-reservation";
import * as authority from "./payment-reservation-history";
import { prepareSettlementPlan } from "./prepare-settlement-plan";
import * as readiness from "./settlement-readiness";
import * as signers from "./signer-access-ledger";

const RECIPIENT = "11111111111111111111111111111111";
const COMMIT = "a".repeat(40);
const MULTISIG = "xmWqhNJwNL4z4BcDo1Yh7BbStLU7omVafZNmg91y2Vg";
const VAULT = "FTK6ckiPWbe1jAiRtcPCz9sCrvCV6Y6hAJhAU5b9S3nv";
const FUNDER = "Stake11111111111111111111111111111111111111";
const STEWARD = "SysvarRent111111111111111111111111111111111";
const NOW = "2026-08-15T00:01:00.000Z";
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  const [instrument] = assertFundingCommitments([
    {
      kind: "squads-v4-vault",
      network: "solana",
      asset: "USDC",
      multisig: MULTISIG,
      vault: VAULT,
      vaultIndex: 0,
      funderMember: FUNDER,
      stewardMember: STEWARD,
      funderActorId: "18633264",
      stewardGithub: { actorId: "42", nodeId: "U_42", login: "independent" },
      monthlyCommitment: {
        cycleId: "2026-07",
        amountMinor: "10000000000",
        accessibility: "unknown",
      },
      effectiveAt: "2026-07-01T00:00:00.000Z",
      deadline: "2026-08-01T00:00:00.000Z",
      replacedAt: null,
    },
  ]);
  if (instrument.kind !== "squads-v4-vault") throw new Error("fixture");
  const policy = {
    schemaVersion: "1" as const,
    kind: "fresh-cycle-payment-policy" as const,
    projectId: "eliza",
    cycleId: "2026-07",
    effectiveAt: "2026-07-31T00:00:00.000Z",
    planningExpiresAt: "2026-09-01T00:00:00.000Z",
    instrumentSha256: await fundingReviewProposalSha256(
      new TextEncoder().encode(JSON.stringify(instrument)),
    ),
    feeRecipient: FUNDER,
  };
  const allocation = approvedAllocation();
  allocation.fundingBasis = {
    cycleId: "2026-07",
    fundingState: "committed",
    committedMinor: allocation.capMinor,
    monthlyCapMinor: allocation.capMinor,
    instrumentId: `squads-v4-vault:solana:${MULTISIG}:0:${VAULT}`,
  };
  const allocationBytes = paymentRecordBytes(allocation);
  const reservation = await draftPaymentReservation(
    allocationBytes,
    policy,
    NOW,
  );
  const fixedPlanBytes = await reservedPlanBytes(
    reservation,
    allocationBytes,
    policy,
  );
  const loaded = {
    revision: COMMIT,
    ledger: [reservation],
    reservation,
    allocationBytes,
    policy,
    instrument,
    instrumentBytes: new TextEncoder().encode(JSON.stringify(instrument)),
    signerLedger: { baseSha: COMMIT, headSha: COMMIT, reports: [] },
    fixedPlanBytes,
  };
  const original = projects.findProject("eliza");
  if (!original) throw new Error("fixture project");
  vi.spyOn(projects, "assertProjectPaymentsEnabled").mockReturnValue({
    ...original,
    reward: { ...original.reward, paymentMode: "enabled" },
  });
  vi.spyOn(loader, "loadCanonicalPaymentReservation").mockResolvedValue(loaded);
  vi.spyOn(readiness, "assertCanonicalSettlementReadiness").mockResolvedValue({
    status: "ready",
    reasons: [],
    paymentAuthorized: false,
    publicAccessibility: "unknown",
    principalMinor: "1000000",
    feeMinor: "10000",
    requiredMinor: "1010000",
    reservedMinor: "1010000",
    reservationRevision: COMMIT,
    allocationSha256: reservation.allocationSha256,
    observedAt: NOW,
  });
  vi.spyOn(authority, "verifyPaymentAuthority").mockReturnValue(COMMIT);
  vi.spyOn(signers, "assertSignerCapabilityForSettlement").mockImplementation(
    () => {},
  );
  const root = await mkdtemp(join(tmpdir(), "release-fixture-"));
  roots.push(root);
  const dir = join(root, "cycles/eliza/2026-07");
  await mkdir(dir, { recursive: true });
  const args = {
    projectId: "eliza",
    cycleId: "2026-07",
    allocationPath: join(dir, "allocation.json"),
    outputPath: join(dir, "execution-plan.json"),
    sourceOwner: VAULT,
    feeRecipient: FUNDER,
    createdAt: "2099-01-01T00:00:00.000Z",
  };
  return { loaded, args };
}
describe("configured canonical settlement release", () => {
  it("writes only reserved exact bytes and returns identical retries with fixed timestamp", async () => {
    const f = await fixture();
    await writeFile(
      f.args.allocationPath,
      "malicious local allocation ignored",
    );
    const first = await prepareSettlementPlan(f.args);
    const retry = await prepareSettlementPlan(f.args);
    expect(first).toEqual(retry);
    expect(first.createdAt).toBe(NOW);
    expect(
      (await readFile(f.args.outputPath)).equals(
        Buffer.from(f.loaded.fixedPlanBytes),
      ),
    ).toBe(true);
    expect(readiness.assertCanonicalSettlementReadiness).toHaveBeenCalledTimes(
      2,
    );
    expect(signers.assertSignerCapabilityForSettlement).toHaveBeenCalledTimes(
      2,
    );
  });
  it.each([
    "readiness",
    "protection",
    "loss",
    "movement",
    "corruption",
    "wallet",
    "timestamp",
    "expiry",
  ])("refuses %s without a plan write", async (mode) => {
    const f = await fixture();
    if (mode === "readiness")
      vi.mocked(readiness.assertCanonicalSettlementReadiness).mockRejectedValue(
        new Error("balance/config quorum unavailable"),
      );
    if (mode === "protection")
      vi.mocked(loader.loadCanonicalPaymentReservation).mockRejectedValue(
        new Error("Branch protection unavailable"),
      );
    if (mode === "loss")
      vi.mocked(signers.assertSignerCapabilityForSettlement).mockImplementation(
        () => {
          throw new Error("lost-access");
        },
      );
    if (mode === "movement")
      vi.mocked(authority.verifyPaymentAuthority).mockReturnValue(
        "b".repeat(40),
      );
    if (mode === "corruption") f.loaded.fixedPlanBytes[0] = 0;
    if (mode === "wallet") f.args.feeRecipient = RECIPIENT;
    if (mode === "timestamp")
      Object.assign(f.args, { createdAtExplicit: true });
    if (mode === "expiry") f.loaded.policy.planningExpiresAt = NOW;
    await expect(prepareSettlementPlan(f.args)).rejects.toThrow();
    await expect(readFile(f.args.outputPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("never overwrites differing prior bytes or accepts readiness overrides", async () => {
    const f = await fixture();
    await writeFile(f.args.outputPath, "prior plan");
    await expect(prepareSettlementPlan(f.args)).rejects.toThrow(/differs/);
    expect(await readFile(f.args.outputPath, "utf8")).toBe("prior plan");
    await expect(
      prepareSettlementPlan(f.args, {
        validate: async () => ({ state: "payment-ready" }),
      }),
    ).rejects.toThrow(/overrides/);
  });
});
