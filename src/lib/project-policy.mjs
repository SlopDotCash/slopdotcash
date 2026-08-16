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
