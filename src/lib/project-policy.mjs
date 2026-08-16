/**
 * Enforces non-retroactive project policy transitions. This is deliberately
 * independent from payment state: money events cannot rewrite IP policy.
 */

import { assertProjectDefinition } from "./project-schema.mjs";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Refuses identity drift and silent material-policy edits. Historical records
 * remain valid because callers receive a new revision rather than mutating an
 * old acknowledgement.
 */
export function assertProjectPolicyTransition(previousValue, nextValue) {
  const previous = assertProjectDefinition(previousValue);
  const next = assertProjectDefinition(nextValue);
  if (previous.id !== next.id) throw new TypeError("project id cannot change");
  if (
    previous.authority.repositoryId !== next.authority.repositoryId ||
    previous.authority.repositoryNodeId !== next.authority.repositoryNodeId ||
    canonical(previous.repositories) !== canonical(next.repositories)
  ) {
    throw new TypeError(
      "repository transfer, rename, or integration-branch drift requires a new project review",
    );
  }
  const previousReceiptPolicy = previous.terms.receiptPolicy;
  const nextReceiptPolicy = next.terms.receiptPolicy;
  if (
    previousReceiptPolicy.state === "pending-authority-activation" &&
    nextReceiptPolicy.state === "active" &&
    (next.authority.state !== "verified" ||
      nextReceiptPolicy.bindings.length !== 1 ||
      nextReceiptPolicy.activatedAt !== next.authority.proof.verifiedAt)
  ) {
    throw new TypeError(
      "receipt policy activation requires exactly one first binding at authority verification",
    );
  }
  if (previousReceiptPolicy.state === "active") {
    if (nextReceiptPolicy.state !== "active") {
      throw new TypeError("active receipt policy cannot revert to pending");
    }
    if (previousReceiptPolicy.activatedAt !== nextReceiptPolicy.activatedAt) {
      throw new TypeError("receipt policy cutover activation is immutable");
    }
    if (
      nextReceiptPolicy.bindings.length <
        previousReceiptPolicy.bindings.length ||
      previousReceiptPolicy.bindings.some(
        (binding, index) =>
          canonical(binding) !== canonical(nextReceiptPolicy.bindings[index]),
      )
    ) {
      throw new TypeError(
        "historical receipt policy bindings must remain an exact append-only prefix",
      );
    }
    const appended =
      nextReceiptPolicy.bindings.length - previousReceiptPolicy.bindings.length;
    if (appended > 1) {
      throw new TypeError(
        "receipt policy transition may append at most one binding",
      );
    }
    const bindingTerms = (project) =>
      canonical({
        policyRevision: project.terms.revision,
        licenseSha256: project.terms.repositoryLicense.fileSha256,
        inboundTermsSha256: project.terms.inbound.fileSha256,
        prizeRulesSha256: project.terms.externalPrize?.rulesSha256 ?? null,
      });
    const bindingChanged = bindingTerms(previous) !== bindingTerms(next);
    if (bindingChanged !== (appended === 1)) {
      throw new TypeError(
        "receipt policy binding append must exactly match a binding-relevant terms change",
      );
    }
  }
  const materialBefore = canonical({
    steward: previous.steward,
    terms: previous.terms,
  });
  const materialAfter = canonical({ steward: next.steward, terms: next.terms });
  if (
    materialBefore !== materialAfter &&
    previous.terms.revision === next.terms.revision
  ) {
    throw new TypeError("material terms drift requires a new revision");
  }
  if (
    next.authority.state === "verified" &&
    next.authority.proof.policyRevision !== next.terms.revision
  ) {
    throw new TypeError(
      "repository proof does not bind the current policy revision",
    );
  }
  return next;
}

/** Proves a payment-only transition did not mutate copyright or legal terms. */
export function assertPaymentDoesNotMutateTerms(previousValue, nextValue) {
  const previous = assertProjectDefinition(previousValue);
  const next = assertProjectDefinition(nextValue);
  if (canonical(previous.terms) !== canonical(next.terms)) {
    throw new TypeError("payment state cannot mutate IP terms");
  }
  return next;
}
