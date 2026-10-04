import { sha256Hex } from "../sha256";
import type { BountyCommand, ResidentAttestationV1 } from "./contracts";

export const RESIDENT_ATTESTATION_DOMAIN =
  "Slop resident bounty attestation v1\n";
export const MAX_RESIDENT_ATTESTATION_BYTES = 16 * 1024;
const ATTESTATION_KEYS = [
  "schemaVersion",
  "audience",
  "environment",
  "issuer",
  "keyId",
  "residentId",
  "residentRevision",
  "controllerActorId",
  "controllerRevision",
  "runId",
  "attemptId",
  "nonceId",
  "issuedAt",
  "expiresAt",
  "projectId",
  "bountyId",
  "termsDigest",
  "repositoryId",
  "taskDefinitionDigest",
  "artifactDigests",
  "submittedCommit",
  "prNodeId",
  "executionResultDigest",
  "buildEvidenceDigest",
  "toolPolicyRevision",
  "publicationManifestDigest",
  "signature",
] as const;

function jsonString(value: string): string {
  if (
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  ) {
    throw new TypeError("Bounty JSON requires Unicode scalar strings");
  }
  return JSON.stringify(value);
}

/** Strict JSON data only. Keys use recursive UTF-16 lexical order; arrays keep
 * order. No coercion, newline, floats, omitted fields or executable properties. */
export function canonicalBountyBytes(value: unknown): Uint8Array {
  const seen = new Set<object>();
  function serialize(current: unknown): string {
    if (current === null) return "null";
    if (typeof current === "string") return jsonString(current);
    if (typeof current === "boolean") return String(current);
    if (
      typeof current === "number" &&
      Number.isSafeInteger(current) &&
      !Object.is(current, -0)
    )
      return String(current);
    if (typeof current !== "object" || current === null || seen.has(current)) {
      throw new TypeError("Bounty JSON contains unsupported data");
    }
    seen.add(current);
    let result: string;
    if (Array.isArray(current)) {
      if (
        Object.keys(current).length !== current.length ||
        current.some((_, i) => !Object.hasOwn(current, i))
      ) {
        throw new TypeError(
          "Bounty JSON requires dense arrays without extra fields",
        );
      }
      result = `[${Array.from(current, serialize).join(",")}]`;
    } else {
      if (
        Object.getPrototypeOf(current) !== Object.prototype &&
        Object.getPrototypeOf(current) !== null
      ) {
        throw new TypeError("Bounty JSON requires plain records");
      }
      if (Reflect.ownKeys(current).some((key) => typeof key !== "string"))
        throw new TypeError("Bounty JSON has unsupported keys");
      result = `{${Object.keys(current)
        .sort()
        .map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (!descriptor || !Object.hasOwn(descriptor, "value"))
            throw new TypeError("Bounty JSON forbids accessors");
          return `${jsonString(key)}:${serialize(descriptor.value)}`;
        })
        .join(",")}}`;
    }
    seen.delete(current);
    return result;
  }
  return new TextEncoder().encode(serialize(value));
}

/** Re-encoding rejects duplicate keys, alternate escapes, BOMs and every other
 * spelling that could give two signed byte strings the same parsed meaning. */
export function parseCanonicalBountyBytes(bytes: Uint8Array): unknown {
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  const value: unknown = JSON.parse(text);
  const canonical = canonicalBountyBytes(value);
  if (
    canonical.length !== bytes.length ||
    canonical.some((byte, i) => byte !== bytes[i])
  ) {
    throw new TypeError("Noncanonical bounty bytes or duplicate JSON keys");
  }
  return value;
}

export function bountyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Bounty record must be an object");
  return value as Record<string, unknown>;
}
export function assertExactBountyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(","))
    throw new TypeError("Bounty record has missing or unexpected fields");
}
export function bountyId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$/u.test(value)
  )
    throw new TypeError("Bounty identifier is invalid");
  return value;
}
export function bountyInteger(value: unknown, positive = false): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d{0,39})$/u.test(value) ||
    (positive && value === "0")
  )
    throw new TypeError("Bounty integer string is invalid");
  return value;
}
export function bountyDigest(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value))
    throw new TypeError("Bounty digest is invalid");
  return value;
}
export function bountyUtc(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError("Bounty timestamp must be canonical UTC");
  return value;
}

function assertAttestation(value: unknown): ResidentAttestationV1 {
  const a = bountyObject(value);
  assertExactBountyKeys(a, ATTESTATION_KEYS);
  if (
    a.schemaVersion !== "1" ||
    a.audience !== "slop.cash/resident-bounty" ||
    (a.environment !== "test" && a.environment !== "production")
  )
    throw new TypeError("Unsupported resident attestation identity");
  for (const field of [
    "issuer",
    "keyId",
    "residentId",
    "runId",
    "attemptId",
    "nonceId",
    "projectId",
    "bountyId",
    "prNodeId",
    "toolPolicyRevision",
  ] as const)
    bountyId(a[field]);
  for (const field of [
    "residentRevision",
    "controllerActorId",
    "controllerRevision",
    "repositoryId",
  ] as const)
    bountyInteger(a[field], true);
  for (const field of [
    "termsDigest",
    "taskDefinitionDigest",
    "executionResultDigest",
    "buildEvidenceDigest",
    "publicationManifestDigest",
  ] as const)
    bountyDigest(a[field]);
  if (
    typeof a.submittedCommit !== "string" ||
    !/^[0-9a-f]{40}$/u.test(a.submittedCommit)
  )
    throw new TypeError("Attestation commit must be an exact Git commit");
  if (!Array.isArray(a.artifactDigests) || a.artifactDigests.length === 0)
    throw new TypeError("Attestation requires public artifact digests");
  const ids = new Set<string>();
  for (const entry of a.artifactDigests) {
    const artifact = bountyObject(entry);
    assertExactBountyKeys(artifact, ["artifactId", "digest"]);
    const id = bountyId(artifact.artifactId);
    bountyDigest(artifact.digest);
    if (ids.has(id))
      throw new TypeError("Attestation repeats an artifact identity");
    ids.add(id);
  }
  if (bountyUtc(a.issuedAt) >= bountyUtc(a.expiresAt))
    throw new TypeError("Attestation expiry must follow issuance");
  if (
    typeof a.signature !== "string" ||
    !/^[A-Za-z0-9+/]{86}==$/u.test(a.signature) ||
    btoa(atob(a.signature)) !== a.signature
  )
    throw new TypeError(
      "Attestation requires a canonical 64-byte padded base64 signature",
    );
  return a as unknown as ResidentAttestationV1;
}

/** The complete signed envelope is bounded, parsed and allowlisted before any
 * verifier sees it. This parser does not authenticate the issuer or evidence. */
export function parseResidentAttestationBytes(
  bytes: Uint8Array,
): ResidentAttestationV1 {
  if (bytes.length > MAX_RESIDENT_ATTESTATION_BYTES)
    throw new TypeError(
      "Resident attestation exceeds the 16 KiB protocol boundary",
    );
  return assertAttestation(parseCanonicalBountyBytes(bytes));
}

/** Signature is outside the signed payload; keyId remains inside it. */
export function residentAttestationSigningBytes(
  attestation: ResidentAttestationV1,
): Uint8Array {
  const { signature: _signature, ...payload } = assertAttestation(attestation);
  const domain = new TextEncoder().encode(RESIDENT_ATTESTATION_DOMAIN);
  const canonical = canonicalBountyBytes(payload);
  const message = new Uint8Array(domain.length + canonical.length);
  message.set(domain);
  message.set(canonical, domain.length);
  return message;
}

/** Idempotency covers kind, expected revision and every subject/evidence field. */
export function bountyCommandDigest(command: BountyCommand): string {
  return sha256Hex(canonicalBountyBytes(command));
}

/** Explicit frozen proposal: approval references and evolving states never
 * enter the digest that those approvals themselves name. */
export function bountyAwardDigest(
  a: import("./contracts").AwardRecord,
): string {
  return sha256Hex(
    canonicalBountyBytes({
      awardId: a.awardId,
      bountyId: a.bountyId,
      submissionId: a.submissionId,
      workUnitId: a.workUnitId,
      acceptedLineageDigest: a.acceptedLineageDigest,
      acceptedPublicationManifestDigest: a.acceptedPublicationManifestDigest,
      supersedesAwardId: a.supersedesAwardId,
      terms: a.terms,
      beneficiary: a.beneficiary,
      principalMinor: a.principalMinor,
      feeMinor: a.feeMinor,
      sourceInstrumentId: a.sourceInstrumentId,
      capacityReservationId: a.capacityReservationId,
      intentId: a.intentId,
      intentDigest: a.intentDigest,
      proposedAt: a.proposedAt,
      reviewEndsAt: a.reviewEndsAt,
      disputeEndsAt: a.disputeEndsAt,
    }),
  );
}
export function bountyRefundProposalDigest(
  r: import("./contracts").RefundDecision,
): string {
  return sha256Hex(
    canonicalBountyBytes({
      decisionId: r.decisionId,
      bountyId: r.bountyId,
      termsDigest: r.termsDigest,
      legs: r.legs.map((l) => ({
        funderActorId: l.funderActorId,
        sourceInstrumentId: l.sourceInstrumentId,
        returnDestination: l.returnDestination,
        amountMinor: l.amountMinor,
        refundProofDigest: l.refundProofDigest,
      })),
      feeTreatment: r.feeTreatment,
    }),
  );
}
function previewValue(
  t: import("./contracts").BountyTerms,
  c: import("./contracts").CapacityReservation,
  o: import("./contracts").FundingObservation,
  intentId: string,
  awardId: string | null,
  refundDecisionId: string | null,
  legs: import("./contracts").BountySettlementPreview["legs"],
  identity: Record<string, unknown>,
): import("./contracts").BountySettlementPreview {
  const source = {
    intentId,
    bountyId: t.bountyId,
    termsDigest: t.termsDigest,
    capacityReservationId: c.capacityReservationId,
    fundingObservationDigest: c.fundingObservationDigest,
    sourceInstrumentId: c.sourceInstrumentId,
    sourceOwner: o.sourceOwner,
    network: t.network,
    mint: t.mint,
    decimals: t.decimals,
    legs: structuredClone(legs),
    networkCostPolicy: {
      payerActorId: t.networkCostPolicy.payerActorId,
      costSourceId: t.networkCostPolicy.costSourceId,
      maxLamports: t.networkCostPolicy.maxLamports,
      tokenAccountRentLamports: t.networkCostPolicy.tokenAccountRentLamports,
    },
  };
  const intentDigest = sha256Hex(
    canonicalBountyBytes({ schemaVersion: "1", ...identity, ...source }),
  );
  const payload = {
    schemaVersion: "1" as const,
    kind: "bounty-settlement-preview" as const,
    status: "non-executable" as const,
    bountyId: t.bountyId,
    awardId,
    refundDecisionId,
    intentId,
    intentDigest,
    sourceInstrumentId: source.sourceInstrumentId,
    sourceOwner: source.sourceOwner,
    capacityReservationId: source.capacityReservationId,
    fundingObservationDigest: source.fundingObservationDigest,
    network: source.network,
    mint: source.mint,
    decimals: source.decimals,
    legs: source.legs,
    networkCostPolicy: source.networkCostPolicy,
  };
  return {
    ...payload,
    previewDigest: sha256Hex(canonicalBountyBytes(payload)),
  };
}
/** Pure allowlisted projection, not authorization or a public payment plan. */
export function bountyPaymentPreview(
  a: import("./contracts").AwardRecord,
  c: import("./contracts").CapacityReservation,
  o: import("./contracts").FundingObservation,
): import("./contracts").BountySettlementPreview {
  return previewValue(
    a.terms,
    c,
    o,
    a.intentId,
    a.awardId,
    null,
    [
      {
        obligationId: `${a.intentId}:principal`,
        kind: "principal",
        destination: a.beneficiary.destination,
        amountMinor: a.principalMinor,
      },
      {
        obligationId: `${a.intentId}:fee`,
        kind: "fee",
        destination: a.terms.feeRecipient,
        amountMinor: a.feeMinor,
      },
    ],
    {
      kind: "bounty-payment-intent",
      awardId: a.awardId,
      submissionId: a.submissionId,
      workUnitId: a.workUnitId,
      beneficiaryDigest: a.beneficiary.beneficiaryDigest,
    },
  );
}
export function bountyRefundPreview(
  r: import("./contracts").RefundDecision,
  t: import("./contracts").BountyTerms,
  c: import("./contracts").CapacityReservation,
  o: import("./contracts").FundingObservation,
): import("./contracts").BountySettlementPreview {
  const intentId = `refund_${r.refundProposalDigest}`;
  return previewValue(
    t,
    c,
    o,
    intentId,
    null,
    r.decisionId,
    r.legs.map((l, i) => ({
      obligationId: `${intentId}:refund:${i}`,
      kind: "refund",
      destination: l.returnDestination,
      amountMinor: l.amountMinor,
    })),
    {
      kind: "bounty-refund-intent",
      refundDecisionId: r.decisionId,
      refundProposalDigest: r.refundProposalDigest,
    },
  );
}

/** Immutable raised-dispute projection; resolution points to a separate human
 * decision that names these exact bytes, without a circular digest. */
export function bountyDisputeDigest(d: import("./contracts").DisputeEvidence): string {
  return sha256Hex(canonicalBountyBytes({bountyId:d.bountyId,submissionId:d.submissionId,authenticatedActorId:d.authenticatedActorId,reasonDigest:d.reasonDigest,raisedAt:d.raisedAt,provenance:d.provenance}));
}
