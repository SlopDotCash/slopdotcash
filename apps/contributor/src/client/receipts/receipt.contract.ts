// spec/contributor/evidence.md, "A signed receipt binds the exact disclosure and either no trace or the stored trace"; spec/contributor/evidence.md, "A receipt verifies only under its exact published schema version, signing payload and Ed25519 device key"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { type Join, type UsageFigures, policyJoin, sameDisclosure, usageVerdict } from "./policy.ts";
import { markerOf, receiptOf, signingPayload } from "./receipt.ts";
import { ProjectRunReceipt } from "./receipt.schema.ts";

const receipts = Arbitrary.schema(ProjectRunReceipt);

const PAYLOAD_KEYS = "provider,model,client,skill_revision,run";

export const aMarkerCarriesTheWholeReceipt = contract({ input: receipts, run: markerOf, inverse: receiptOf, deterministic: true });

export const theSigningPayloadLeavesOutOnlyTheSignature = contract({
  input: receipts,
  run: signingPayload,
  deterministic: true,
  invariant: (receipt, payload) => {
    const signed = JSON.parse(payload) as { readonly run: Record<string, unknown> };
    const marker = markerOf(receipt);
    return Object.keys(signed).join(",") === PAYLOAD_KEYS
      && Object.keys(signed.run).join(",") === Object.keys(marker.run).filter((key) => key !== "device_signature").join(",");
  },
});

const Digest = Schema.Literals(["", "a", "b"]);
const Disclosure = Schema.Struct({ policyRevision: Schema.Literals(["r1", "r2"]), licenseSha256: Digest, inboundTermsSha256: Digest, prizeRulesSha256: Digest });
const Instant = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 }));
const Joins = Schema.Struct({
  sameProject: Schema.Boolean,
  v1Schema: Schema.Boolean,
  acknowledged: Schema.Boolean,
  acknowledgement: Disclosure,
  startedAt: Instant,
  completedAt: Instant,
  active: Schema.Boolean,
  activatedAt: Instant,
  disclosed: Disclosure,
  bindings: Schema.Array(Schema.Struct({ disclosure: Disclosure, activatedAt: Instant })),
});

export const aJoinedReceiptMeetsItsPolicy = contract({
  input: Arbitrary.schema(Joins).pipe(Arbitrary.map((join): Join => ({ ...join, acknowledgement: { ...join.acknowledgement }, disclosed: { ...join.disclosed }, bindings: join.bindings.map((binding) => ({ disclosure: { ...binding.disclosure }, activatedAt: binding.activatedAt })) }))),
  run: policyJoin,
  deterministic: true,
  invariant: (join, verdict) => verdict !== "Joined" || (join.sameProject && (join.v1Schema
    ? !join.active || join.completedAt < join.activatedAt
    : join.acknowledged && (join.active
      ? join.activatedAt <= join.startedAt
        && join.bindings.some((binding) => binding.disclosure.policyRevision === join.acknowledgement.policyRevision && binding.activatedAt <= join.startedAt)
      : sameDisclosure(join.acknowledgement, join.disclosed)))),
});

const Figure = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 }));
const Usages = Schema.Struct({
  measured: Schema.Boolean,
  available: Schema.Boolean,
  inputTokens: Figure,
  outputTokens: Figure,
  cacheCreationTokens: Figure,
  cacheReadTokens: Figure,
  totalTokens: Figure,
  costIsZero: Schema.Boolean,
  sessionCount: Figure,
});

export const consistentUsageIsEitherMeasuredOrEmpty = contract({
  input: Arbitrary.schema(Usages).pipe(Arbitrary.map((usage): UsageFigures => ({ ...usage }))),
  run: usageVerdict,
  deterministic: true,
  invariant: (usage, verdict) => verdict !== "Consistent" || (usage.available
    ? usage.measured && usage.totalTokens > 0 && usage.sessionCount > 0
    : usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens + usage.cacheReadTokens + usage.totalTokens + usage.sessionCount === 0 && usage.costIsZero),
});
