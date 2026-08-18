import { describe, expect, it } from "vitest";
import eliza from "../../projects/eliza/project.json";
import {
  assertPaymentDoesNotMutateTerms,
  assertProjectPolicyTransition,
} from "./project-policy.mjs";

describe("project policy transitions", () => {
  interface MutableFundingRoute {
    network: "solana";
    asset: "USDC";
    address: string;
    effectiveAt: string;
    replacedAt: string | null;
  }

  function fundingFixture(routes: MutableFundingRoute[]) {
    const fixture = structuredClone(eliza) as unknown as {
      funding: { addresses: MutableFundingRoute[] };
    };
    fixture.funding.addresses = routes;
    return fixture;
  }

  const firstRoute = (): MutableFundingRoute => ({
    network: "solana",
    asset: "USDC",
    address: "11111111111111111111111111111111",
    effectiveAt: "2026-08-17T00:00:00.000Z",
    replacedAt: null,
  });

  const successorRoute = (): MutableFundingRoute => ({
    network: "solana",
    asset: "USDC",
    address: "Vote111111111111111111111111111111111111111",
    effectiveAt: "2026-08-18T00:00:00.000Z",
    replacedAt: null,
  });

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
    rewritten.terms.revision = `${eliza.terms.revision}-mutated`;
    expect(() => assertPaymentDoesNotMutateTerms(eliza, rewritten)).toThrow(
      /latest binding|cannot mutate/u,
    );
  });

  it("allows only a bounded append-only funding rotation", () => {
    const previous = fundingFixture([firstRoute()]);
    const rotated = structuredClone(previous);
    rotated.funding.addresses[0].replacedAt = successorRoute().effectiveAt;
    rotated.funding.addresses.push(successorRoute());
    expect(assertProjectPolicyTransition(previous, rotated)).toEqual(rotated);

    const initial = fundingFixture([]);
    const first = fundingFixture([firstRoute()]);
    expect(assertProjectPolicyTransition(initial, first)).toEqual(first);

    const closeOnly = structuredClone(previous);
    closeOnly.funding.addresses[0].replacedAt = successorRoute().effectiveAt;
    expect(() => assertProjectPolicyTransition(previous, closeOnly)).toThrow(
      /only with a successor/u,
    );

    const wrongCutover = structuredClone(rotated);
    wrongCutover.funding.addresses[0].replacedAt = "2026-08-17T23:59:59.000Z";
    expect(() => assertProjectPolicyTransition(previous, wrongCutover)).toThrow(
      /exactly when/u,
    );
  });

  it("rejects funding history alteration, deletion, reorder, and backfill", () => {
    const first = firstRoute();
    first.replacedAt = successorRoute().effectiveAt;
    const previous = fundingFixture([first, successorRoute()]);

    const altered = structuredClone(previous);
    altered.funding.addresses[0].address =
      "Stake11111111111111111111111111111111111111";
    expect(() => assertProjectPolicyTransition(previous, altered)).toThrow(
      /append-only prefix/u,
    );

    const closedOnlyRoute = firstRoute();
    closedOnlyRoute.replacedAt = successorRoute().effectiveAt;
    const closedOnly = fundingFixture([closedOnlyRoute]);
    const reopened = structuredClone(closedOnly);
    reopened.funding.addresses[0].replacedAt = null;
    expect(() => assertProjectPolicyTransition(closedOnly, reopened)).toThrow(
      /closed funding routes are immutable/u,
    );

    const movedClosure = structuredClone(previous);
    movedClosure.funding.addresses[0].replacedAt = "2026-08-17T23:59:59.000Z";
    expect(() => assertProjectPolicyTransition(previous, movedClosure)).toThrow(
      /closed funding routes are immutable/u,
    );

    const deleted = fundingFixture([successorRoute()]);
    expect(() => assertProjectPolicyTransition(previous, deleted)).toThrow(
      /append-only prefix/u,
    );

    const reordered = fundingFixture([successorRoute(), first]);
    expect(() => assertProjectPolicyTransition(previous, reordered)).toThrow(
      /append-only prefix/u,
    );

    const backfilledFirst = firstRoute();
    backfilledFirst.replacedAt = successorRoute().effectiveAt;
    const multiAppend = fundingFixture([
      backfilledFirst,
      {
        ...successorRoute(),
      },
    ]);
    expect(() =>
      assertProjectPolicyTransition(fundingFixture([]), multiAppend),
    ).toThrow(/at most one successor/u);

    const preclosed = fundingFixture([]);
    preclosed.funding.addresses.push({
      ...firstRoute(),
      replacedAt: "2026-08-18T00:00:00.000Z",
    });
    expect(() =>
      assertProjectPolicyTransition(fundingFixture([]), preclosed),
    ).toThrow(/successor must be active/u);
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
      /cannot revert|receipt cutover/u,
    );

    const movedCutover = structuredClone(previous);
    movedCutover.terms.receiptPolicy.activatedAt = "2026-08-17T00:00:01.000Z";
    movedCutover.terms.receiptPolicy.bindings[0].activatedAt =
      "2026-08-17T00:00:01.000Z";
    expect(() => assertProjectPolicyTransition(previous, movedCutover)).toThrow(
      /activation is immutable|receipt cutover/u,
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
    pending.status = "paused";
    (pending.terms as unknown as { receiptPolicy: unknown }).receiptPolicy = {
      state: "pending-authority-activation",
      activatedAt: null,
      bindings: [],
    };
    expect(() => assertProjectPolicyTransition(pending, activated)).toThrow(
      /exactly one first binding/u,
    );

    const previous = activePolicyFixture();
    const next = structuredClone(previous);
    next.terms.revision = `${previous.terms.revision}-appended`;
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

  it("activates a proof-bound receipt policy without rewriting legal terms", () => {
    const activated = structuredClone(eliza);
    const pending = structuredClone(activated);
    pending.status = "paused";
    (pending.terms as unknown as { receiptPolicy: unknown }).receiptPolicy = {
      state: "pending-authority-activation",
      activatedAt: null,
      bindings: [],
    };

    expect(assertProjectPolicyTransition(pending, activated)).toEqual(
      activated,
    );
  });
});
