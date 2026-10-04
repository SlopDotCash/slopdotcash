import { SOLANA_MAINNET_USDC_MINT, USDC_DECIMALS } from "../settlement-plan";
import { sha256Hex } from "../sha256";
import { isSolanaAddress } from "../wallets";
import {
  assertExactBountyKeys,
  bountyDigest,
  bountyId,
  bountyInteger,
  bountyObject,
  bountyUtc,
  canonicalBountyBytes,
  parseCanonicalBountyBytes,
} from "./codec";
import type { BountyTerms, FeeRule } from "./contracts";

const TERM_KEYS = [
  "schemaVersion",
  "status",
  "bountyId",
  "projectId",
  "repositoryId",
  "publicBriefUrl",
  "deliverableDigest",
  "acceptanceDigest",
  "licenseDigest",
  "inboundTermsDigest",
  "eligibleSubjectKinds",
  "principalMinor",
  "feeRule",
  "feeRecipient",
  "networkCostPolicy",
  "network",
  "mint",
  "decimals",
  "sourceInstrumentId",
  "funders",
  "authority",
  "candidateSelection",
  "submissionDeadline",
  "reviewDurationMs",
  "disputeDurationMs",
  "targetSettlementAt",
  "cancellationPolicyDigest",
  "termsDigest",
];

/** The sole self-digest exclusion for terms. All other fields remain bound. */
export function bountyTermsDigest(value: unknown): string {
  const { termsDigest: _digest, ...payload } = bountyObject(value);
  return sha256Hex(canonicalBountyBytes(payload));
}

function actorIds(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0)
    throw new TypeError("Bounty terms require named human authorities");
  for (const id of value) bountyInteger(id, true);
  if (new Set(value).size !== value.length)
    throw new TypeError("Bounty terms repeat an authority");
}
function address(value: unknown): void {
  if (!isSolanaAddress(value))
    throw new TypeError("Bounty terms require an exact Solana destination");
}
function feeRule(value: unknown): FeeRule {
  const fee = bountyObject(value);
  if (fee.kind === "fixed") {
    assertExactBountyKeys(fee, ["kind", "amountMinor", "payer"]);
    bountyInteger(fee.amountMinor);
  } else if (fee.kind === "basis-points") {
    assertExactBountyKeys(fee, ["kind", "basisPoints", "rounding", "payer"]);
    if (fee.rounding !== "floor" && fee.rounding !== "ceil")
      throw new TypeError("Bounty fee requires explicit rounding");
    bountyInteger(fee.basisPoints);
  } else throw new TypeError("Bounty fee rule is unsupported");
  if (fee.payer !== "funder" && fee.payer !== "beneficiary")
    throw new TypeError("Bounty fee payer must be explicit");
  return fee as unknown as FeeRule;
}

/** Complete commercial and authority fields are required; no monthly defaults,
 * live funding assertion, source authority or money movement is inferred. */
export function assertBountyTerms(value: unknown): BountyTerms {
  const t = bountyObject(value);
  assertExactBountyKeys(t, TERM_KEYS);
  if (
    t.schemaVersion !== "1" ||
    t.status !== "published" ||
    t.network !== "solana-mainnet" ||
    t.mint !== SOLANA_MAINNET_USDC_MINT ||
    t.decimals !== USDC_DECIMALS
  )
    throw new TypeError("Bounty terms require published mainnet USDC identity");
  for (const key of ["bountyId", "projectId", "sourceInstrumentId"] as const)
    bountyId(t[key]);
  bountyInteger(t.repositoryId, true);
  if (typeof t.publicBriefUrl !== "string")
    throw new TypeError("Bounty terms require a public brief URL");
  const url = new URL(t.publicBriefUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new TypeError("Bounty brief must be a public HTTPS URL");
  for (const key of [
    "deliverableDigest",
    "acceptanceDigest",
    "licenseDigest",
    "inboundTermsDigest",
    "cancellationPolicyDigest",
    "termsDigest",
  ] as const)
    bountyDigest(t[key]);
  if (
    !Array.isArray(t.eligibleSubjectKinds) ||
    t.eligibleSubjectKinds.length === 0 ||
    t.eligibleSubjectKinds.some(
      (kind) => kind !== "resident" && kind !== "github-user",
    ) ||
    new Set(t.eligibleSubjectKinds).size !== t.eligibleSubjectKinds.length
  )
    throw new TypeError("Bounty subject eligibility must be explicit");
  bountyInteger(t.principalMinor, true);
  feeRule(t.feeRule);
  address(t.feeRecipient);
  const costs = bountyObject(t.networkCostPolicy);
  assertExactBountyKeys(costs, [
    "payerActorId",
    "costSourceId",
    "maxLamports",
    "tokenAccountRentLamports",
  ]);
  bountyInteger(costs.payerActorId, true);
  bountyId(costs.costSourceId);
  bountyInteger(costs.maxLamports);
  bountyInteger(costs.tokenAccountRentLamports);
  if (!Array.isArray(t.funders) || t.funders.length === 0)
    throw new TypeError("Bounty terms require funder and refund attribution");
  const funders = new Set<string>();
  for (const entry of t.funders) {
    const funder = bountyObject(entry);
    assertExactBountyKeys(funder, [
      "funderActorId",
      "sourceInstrumentId",
      "refundDestination",
      "refundProofDigest",
    ]);
    const id = bountyInteger(funder.funderActorId, true);
    if (funders.has(id) || funder.sourceInstrumentId !== t.sourceInstrumentId)
      throw new TypeError("Bounty refund source or funder binding is invalid");
    funders.add(id);
    address(funder.refundDestination);
    bountyDigest(funder.refundProofDigest);
  }
  const authority = bountyObject(t.authority);
  assertExactBountyKeys(authority, [
    "acceptanceActorIds",
    "creatorActorId",
    "reviewerActorIds",
    "disputeActorIds",
    "retirementActorIds",
  ]);
  bountyInteger(authority.creatorActorId, true);
  for (const key of [
    "acceptanceActorIds",
    "reviewerActorIds",
    "disputeActorIds",
    "retirementActorIds",
  ] as const)
    actorIds(authority[key]);
  const selection = bountyObject(t.candidateSelection);
  assertExactBountyKeys(selection, [
    "kind",
    "criteriaDigest",
    "decisionDeadline",
    "requiresMerge",
  ]);
  if (
    selection.kind !== "human-ranked" ||
    typeof selection.requiresMerge !== "boolean"
  )
    throw new TypeError("Bounty candidate comparison must be explicit");
  bountyDigest(selection.criteriaDigest);
  const submission = bountyUtc(t.submissionDeadline);
  const decision = bountyUtc(selection.decisionDeadline);
  const target = bountyUtc(t.targetSettlementAt);
  bountyInteger(t.reviewDurationMs, true);
  bountyInteger(t.disputeDurationMs, true);
  if (decision < submission || target < decision)
    throw new TypeError(
      "Bounty candidate decision and settlement target cannot precede submission",
    );
  if (t.termsDigest !== bountyTermsDigest(t))
    throw new TypeError(
      "Bounty terms digest does not bind exact commercial fields",
    );
  // Independent data copy; published inputs cannot later mutate frozen terms.
  return parseCanonicalBountyBytes(canonicalBountyBytes(t)) as BountyTerms;
}

/** Integer micro-USDC only. Payer identifies the agreed cost bearer; no payer
 * choice is permission to deduct a fee from the advertised principal. */
export function bountyObligation(terms: BountyTerms): {
  principalMinor: string;
  feeMinor: string;
  totalUsdcMinor: string;
} {
  const t = assertBountyTerms(terms);
  const principal = BigInt(t.principalMinor);
  let fee: bigint;
  if (t.feeRule.kind === "fixed") fee = BigInt(t.feeRule.amountMinor);
  else {
    const numerator = principal * BigInt(t.feeRule.basisPoints);
    fee =
      t.feeRule.rounding === "floor"
        ? numerator / 10000n
        : (numerator + 9999n) / 10000n;
  }
  return {
    principalMinor: principal.toString(),
    feeMinor: fee.toString(),
    totalUsdcMinor: (principal + fee).toString(),
  };
}
