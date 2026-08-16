import { describe, expect, it } from "vitest";
import eliza from "../../projects/eliza/project.json";
import {
  assertPaymentDoesNotMutateTerms,
  assertProjectPolicyTransition,
} from "./project-policy.mjs";

describe("project policy transitions", () => {
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
});
