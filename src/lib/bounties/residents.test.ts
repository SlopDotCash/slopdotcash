import { describe, expect, it } from "vitest";
import { scenario } from "../../../tests/fixtures/bounties/scenario";
import { SOLANA_MAINNET_USDC_MINT } from "../settlement-plan";
import { sha256Hex } from "../sha256";
import { walletPossessionState } from "../wallet-possession";
import { canonicalBountyBytes } from "./codec";
import type { BeneficiaryInput, ResidentRevision } from "./contracts";
import { TransitionError } from "./contracts";
import { assertResidentTransition, freezeBeneficiary } from "./residents";

function input(): BeneficiaryInput {
  const {
    evidenceRevision: _r,
    frozenAt: _t,
    beneficiaryDigest: _d,
    ...value
  } = scenario().award.beneficiary;
  return value;
}
function successor(row: ResidentRevision): ResidentRevision {
  return {
    ...structuredClone(row),
    revision: "2",
    supersedesRevision: "1",
    effectiveAt: "2026-09-30T12:00:00.000Z",
  };
}
function held(action: () => unknown): void {
  expect(action).toThrowError(expect.objectContaining({ code: "held" }));
}

describe("reviewed resident identity", () => {
  it("does not collapse residents into their shared publisher", () => {
    const f = scenario();
    const rows = assertResidentTransition([], f.residents, f.context);
    expect(rows.map((r) => r.residentId)).toEqual(["resident-a", "resident-b"]);
    expect(rows[0].controllerActorId).toBe(f.residents[0].controllerActorId);
  });

  it("preserves attribution when reviewed presentation names change", () => {
    const f = scenario();
    const renamed = successor(f.residents[0]);
    renamed.display = {
      ...renamed.display,
      name: "Renamed pet",
      controllerLogin: "new-login",
    };
    const next = [...f.residents, renamed];
    f.context.residents = structuredClone(next);
    const rows = assertResidentTransition(f.residents, next, f.context);
    expect(rows[2].residentId).toBe(rows[0].residentId);
    expect(rows[2].controllerActorId).toBe(rows[0].controllerActorId);
    expect(rows[0].display.name).toBe("Synthetic resident A");
    renamed.display.name = "mutated after validation";
    expect(rows[2].display.name).toBe("Renamed pet");
  });

  it.each([
    { controllerActorId: "102" },
    { authorizedStewardActorId: "102" },
    { githubAppId: "7002" },
    { installationIds: ["8002"] },
    { repositoryIds: ["9002"] },
    { verifiedOrganizationId: "777" },
  ])(
    "rejects a proposed spoof against independently reviewed records: %j",
    (change) => {
      const f = scenario();
      const forged = { ...f.residents[0], ...change };
      expect(() => assertResidentTransition([], [forged], f.context)).toThrow(
        TransitionError,
      );
    },
  );

  it("requires controller and policy evidence even for a reviewed revision", () => {
    const f = scenario();
    f.context.controllers = f.context.controllers.map((r) => ({
      ...r,
      authorizedStewardActorId: "999",
    }));
    expect(() => assertResidentTransition([], f.residents, f.context)).toThrow(
      TransitionError,
    );
    const g = scenario();
    g.context.reviewedPolicies = g.context.reviewedPolicies.map((p) => ({
      ...p,
      githubAppIds: ["7002"],
    }));
    expect(() => assertResidentTransition([], g.residents, g.context)).toThrow(
      TransitionError,
    );
  });

  it("accepts a verified organization with its exact authorized human steward", () => {
    const f = scenario();
    const row = {
      ...f.residents[0],
      verifiedOrganizationId: "501",
      authorizedStewardActorId: "103",
    };
    f.context.residents = [row, f.residents[1]];
    f.context.controllers = [
      {
        ...f.context.controllers[0],
        organizationId: "501",
        authorizedStewardActorId: "103",
      },
      f.context.controllers[1],
    ];
    const result = assertResidentTransition([], f.context.residents, f.context);
    expect(result[0].verifiedOrganizationId).toBe("501");
    expect(result[0].authorizedStewardActorId).toBe("103");
  });

  it("admits an exact reviewed controller successor and retains the old attribution", () => {
    const f = scenario();
    const transfer = {
      ...successor(f.residents[0]),
      controllerActorId: "103",
      authorizedStewardActorId: "103",
      controllerRevision: "2",
    };
    const next = [...f.residents, transfer];
    expect(() =>
      assertResidentTransition(f.residents, next, f.context),
    ).toThrow(TransitionError);
    f.context.residents = structuredClone(next);
    f.context.controllers = [
      ...f.context.controllers,
      {
        ...f.context.controllers[0],
        actorId: "103",
        revision: "2",
        authorizedStewardActorId: "103",
        effectiveAt: transfer.effectiveAt,
      },
    ];
    const rows = assertResidentTransition(f.residents, next, f.context);
    expect(
      rows
        .filter((r) => r.residentId === "resident-a")
        .map((r) => r.controllerActorId),
    ).toEqual(["101", "103"]);
    expect(f.award.beneficiary.authenticatedActorId).toBe("101");
    expect(freezeBeneficiary(input(), f.context)).toEqual(f.award.beneficiary);
    f.context.beneficiaries = [];
    held(() => freezeBeneficiary(input(), f.context));
  });

  it("rejects rewritten, omitted, skipped, and duplicated history", () => {
    const f = scenario();
    const rewritten = [
      {
        ...f.residents[0],
        display: { ...f.residents[0].display, name: "rewrite" },
      },
      f.residents[1],
    ];
    f.context.residents = structuredClone(rewritten);
    expect(() =>
      assertResidentTransition(f.residents, rewritten, f.context),
    ).toThrow(TransitionError);
    expect(() =>
      assertResidentTransition(f.residents, [f.residents[0]], f.context),
    ).toThrow(TransitionError);
    const g = scenario();
    const skipped = { ...successor(g.residents[0]), revision: "3" };
    g.context.residents = [...g.residents, skipped];
    expect(() =>
      assertResidentTransition(g.residents, g.context.residents, g.context),
    ).toThrow(TransitionError);
    expect(() =>
      assertResidentTransition([], [...g.residents, g.residents[0]], g.context),
    ).toThrow(TransitionError);
  });
});

describe("frozen bounty beneficiary", () => {
  it("freezes authenticated claim and actual proof without awarding or authorizing payment", () => {
    const f = scenario();
    f.context.beneficiaries = [];
    f.context.humanDecisions = [];
    const before = structuredClone(f.initialState);
    const result = freezeBeneficiary(input(), f.context);
    expect(result).toEqual(f.award.beneficiary);
    expect(result.mint).toBe(SOLANA_MAINNET_USDC_MINT);
    expect(f.initialState).toEqual(before);
    expect(f.context.humanDecisions).toEqual([]);
  });

  it("binds an explicitly named authenticated payee separately from the controller", () => {
    const f = scenario();
    const { claim, proof } =
      f.context.funderReturnEvidence[0].destinationControl;
    const result = freezeBeneficiary(
      {
        ...input(),
        beneficiaryId: "beneficiary-synthetic-other",
        authenticatedActorId: claim.authenticatedActorId,
        destination: claim.destination,
        walletClaimDigest: claim.claimDigest,
        walletProofDigest: proof.proofDigest,
      },
      f.context,
    );
    expect(result.authenticatedActorId).toBe("401");
    expect(result.authenticatedActorId).not.toBe(
      f.residents[0].controllerActorId,
    );
    expect(result.destination).toBe(claim.destination);
    expect(f.award.beneficiary.authenticatedActorId).toBe("101");
  });

  it("holds unsupported off-curve destinations without changing monthly unproven rules", () => {
    const f = scenario();
    f.context.beneficiaries = [];
    const destination = "11111111111111111111111111111112";
    f.context.walletClaims = [{ ...f.context.walletClaims[0], destination }];
    held(() => freezeBeneficiary({ ...input(), destination }, f.context));
    expect(walletPossessionState(destination, null)).toBe(
      "not-provable-by-signature",
    );
    expect(walletPossessionState(input().destination, null)).toBe("unproven");
  });

  it("holds absent and unconsumed proofs, including a caller-supplied consumption timestamp", () => {
    const f = scenario();
    f.context.walletProofs = [];
    held(() => freezeBeneficiary(input(), f.context));
    const g = scenario();
    g.context.walletProofs = [
      { ...g.context.walletProofs[0], consumedAt: null },
    ];
    g.context.now = "2026-10-20T12:01:00.000Z";
    held(() => freezeBeneficiary(input(), g.context));
    const spoofed = { ...input(), consumedAt: g.context.now };
    expect(() => freezeBeneficiary(spoofed, g.context)).toThrow(
      TransitionError,
    );
  });

  it("revalidates historical consumed proof at the authenticated in-window consumption time", () => {
    const f = scenario();
    const original = freezeBeneficiary(input(), f.context);
    f.context.now = "2026-10-20T12:01:00.000Z";
    f.context.revision = "7";
    expect(freezeBeneficiary(input(), f.context)).toEqual(original);
    f.context.walletProofs = [
      {
        ...f.context.walletProofs[0],
        consumedAt: f.context.walletProofs[0].challenge.expiresAt,
      },
    ];
    held(() => freezeBeneficiary(input(), f.context));
  });

  it("rejects actor, claim, destination and signed-proof substitution", () => {
    const f = scenario();
    expect(() =>
      freezeBeneficiary({ ...input(), authenticatedActorId: "102" }, f.context),
    ).toThrow(TransitionError);
    f.context.walletClaims = [
      { ...f.context.walletClaims[0], claimId: "different-claim" },
    ];
    held(() => freezeBeneficiary(input(), f.context));
    const g = scenario();
    g.context.beneficiaries = [];
    g.context.walletProofs = [
      {
        ...g.context.walletProofs[0],
        signature: btoa(String.fromCharCode(...new Uint8Array(64))),
      },
    ];
    // Even a digest recomputed for forged bytes cannot make the signature valid.
    const proofDigest = sha256Hex(
      canonicalBountyBytes({
        challenge: g.context.walletProofs[0].challenge,
        signature: g.context.walletProofs[0].signature,
      }),
    );
    g.context.walletProofs = [{ ...g.context.walletProofs[0], proofDigest }];
    held(() =>
      freezeBeneficiary(
        { ...input(), walletProofDigest: proofDigest },
        g.context,
      ),
    );
    expect(() =>
      freezeBeneficiary(
        { ...input(), destination: g.terms.feeRecipient },
        g.context,
      ),
    ).toThrow(TransitionError);
  });

  it("cannot redirect a frozen beneficiary under the same ID", () => {
    const f = scenario();
    const original = structuredClone(f.award.beneficiary);
    expect(() =>
      freezeBeneficiary({ ...input(), residentId: "resident-b" }, f.context),
    ).toThrow(TransitionError);
    f.context.walletClaims = [
      { ...f.context.walletClaims[0], destination: f.terms.feeRecipient },
    ];
    expect(() =>
      freezeBeneficiary(
        { ...input(), destination: f.terms.feeRecipient },
        f.context,
      ),
    ).toThrow(TransitionError);
    expect(f.award.beneficiary).toEqual(original);
  });
});
