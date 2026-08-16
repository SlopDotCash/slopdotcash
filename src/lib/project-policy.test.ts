import { describe, expect, it } from "vitest";
import eliza from "../../projects/eliza/project.json";
import {
  assertPaymentDoesNotMutateTerms,
  assertProjectPolicyTransition,
} from "./project-policy.mjs";

describe("project policy transitions", () => {
  interface MutableReceiptBinding {
    policyRevision: string;
    licenseSha256: string;
    inboundTermsSha256: string | null;
    prizeRulesSha256: string | null;
    activatedAt: string;
  }

  interface MutableActivePolicyFixture {
    authority: unknown;
    terms: {
      revision: string;
      repositoryLicense: { fileSha256: string | null };
      inbound: { fileSha256: string | null };
      receiptPolicy: {
        state: "active";
        activatedAt: string;
        bindings: MutableReceiptBinding[];
      };
    };
  }

  function activePolicyFixture() {
    const fixture = structuredClone(
      eliza,
    ) as unknown as MutableActivePolicyFixture;
    const licenseSha256 = fixture.terms.repositoryLicense.fileSha256;
    if (!licenseSha256) throw new Error("missing fixture license digest");
    fixture.authority = {
      state: "verified",
      reason: null,
      role: "project-steward",
      repositoryId: eliza.authority.repositoryId,
      repositoryNodeId: eliza.authority.repositoryNodeId,
      proof: {
        url: `https://github.com/elizaOS/eliza/blob/${"a".repeat(40)}/.github/slop-project.json`,
        commitSha: "a".repeat(40),
        fileSha256: "d".repeat(64),
        policyRevision: fixture.terms.revision,
        verifiedAt: "2026-08-17T00:00:00.000Z",
      },
    };
    fixture.terms.receiptPolicy = {
      state: "active",
      activatedAt: "2026-08-17T00:00:00.000Z",
      bindings: [
        {
          policyRevision: "historical-1",
          licenseSha256: "a".repeat(64),
          inboundTermsSha256: null,
          prizeRulesSha256: null,
          activatedAt: "2026-08-17T00:00:00.000Z",
        },
        {
          policyRevision: "historical-2",
          licenseSha256: "b".repeat(64),
          inboundTermsSha256: null,
          prizeRulesSha256: null,
          activatedAt: "2026-08-18T00:00:00.000Z",
        },
        {
          policyRevision: fixture.terms.revision,
          licenseSha256,
          inboundTermsSha256: fixture.terms.inbound.fileSha256,
          prizeRulesSha256: null,
          activatedAt: "2026-08-19T00:00:00.000Z",
        },
      ],
    };
    return fixture;
  }

  it("rejects repository identity, branch, and same-revision terms drift", () => {
    const transfer = structuredClone(eliza);
    transfer.authority.repositoryId = "999";
    expect(() => assertProjectPolicyTransition(eliza, transfer)).toThrow(
      /transfer/u,
    );

    const branch = structuredClone(eliza);
    branch.repositories[0].integrationBranch = "main";
    expect(() => assertProjectPolicyTransition(eliza, branch)).toThrow(
      /drift/u,
    );

    const silent = structuredClone(eliza);
    silent.terms.copyright.notice = "A different copyright claim";
    expect(() => assertProjectPolicyTransition(eliza, silent)).toThrow(
      /new revision/u,
    );
  });

  it("keeps payment transitions from rewriting IP state", () => {
    const payment = structuredClone(eliza);
    payment.reward.monthlyCapMinor = "20000000000";
    payment.reward.monthlyCapDisplay = "$20,000";
    expect(assertPaymentDoesNotMutateTerms(eliza, payment)).toEqual(payment);

    const rewritten = structuredClone(payment);
    rewritten.terms.revision = "2026-08-16.2";
    expect(() => assertPaymentDoesNotMutateTerms(eliza, rewritten)).toThrow(
      /cannot mutate/u,
    );
  });

  it("preserves receipt activation and every historical binding append-only", () => {
    const previous = activePolicyFixture();

    const reverted = structuredClone(previous) as unknown as {
      terms: { receiptPolicy: unknown };
    };
    reverted.terms.receiptPolicy = {
      state: "pending-authority-activation",
      activatedAt: null,
      bindings: [],
    };
    expect(() => assertProjectPolicyTransition(previous, reverted)).toThrow(
      /cannot revert/u,
    );

    const movedCutover = structuredClone(previous);
    movedCutover.terms.receiptPolicy.activatedAt = "2026-08-17T00:00:01.000Z";
    movedCutover.terms.receiptPolicy.bindings[0].activatedAt =
      "2026-08-17T00:00:01.000Z";
    expect(() => assertProjectPolicyTransition(previous, movedCutover)).toThrow(
      /activation is immutable/u,
    );

    const deleted = structuredClone(previous);
    deleted.terms.receiptPolicy.bindings.splice(1, 1);
    expect(() => assertProjectPolicyTransition(previous, deleted)).toThrow(
      /append-only prefix/u,
    );

    const altered = structuredClone(previous);
    altered.terms.receiptPolicy.bindings[0].licenseSha256 = "c".repeat(64);
    expect(() => assertProjectPolicyTransition(previous, altered)).toThrow(
      /append-only prefix/u,
    );

    const reordered = structuredClone(previous);
    const first = structuredClone(reordered.terms.receiptPolicy.bindings[0]);
    const second = structuredClone(reordered.terms.receiptPolicy.bindings[1]);
    reordered.terms.receiptPolicy.bindings[0] = {
      ...second,
      activatedAt: first.activatedAt,
    };
    reordered.terms.receiptPolicy.bindings[1] = {
      ...first,
      activatedAt: second.activatedAt,
    };
    expect(() => assertProjectPolicyTransition(previous, reordered)).toThrow(
      /append-only prefix/u,
    );
  });

  it("rejects fabricated activation history and multi-binding appends", () => {
    const activated = activePolicyFixture();
    const pending = structuredClone(eliza);
    expect(() => assertProjectPolicyTransition(pending, activated)).toThrow(
      /exactly one first binding/u,
    );

    const previous = activePolicyFixture();
    const next = structuredClone(previous);
    next.terms.revision = "2026-08-16.2";
    const licenseSha256 = next.terms.repositoryLicense.fileSha256;
    if (!licenseSha256) throw new Error("missing fixture license digest");
    const lastActivation = "2026-08-20T00:00:00.000Z";
    next.terms.receiptPolicy.bindings.push(
      {
        policyRevision: "fabricated-history",
        licenseSha256: "e".repeat(64),
        inboundTermsSha256: null,
        prizeRulesSha256: null,
        activatedAt: lastActivation,
      },
      {
        policyRevision: next.terms.revision,
        licenseSha256,
        inboundTermsSha256: next.terms.inbound.fileSha256,
        prizeRulesSha256: null,
        activatedAt: "2026-08-21T00:00:00.000Z",
      },
    );
    expect(() => assertProjectPolicyTransition(previous, next)).toThrow(
      /at most one binding/u,
    );
  });
});
