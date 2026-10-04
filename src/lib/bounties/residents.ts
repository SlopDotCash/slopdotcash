import { SOLANA_MAINNET_USDC_MINT } from "../settlement-plan";
import { sha256Hex } from "../sha256";
import {
  isSignableSolanaAddress,
  verifyWalletPossession,
} from "../wallet-possession";
import { isSolanaAddress } from "../wallets";
import {
  assertExactBountyKeys,
  bountyDigest,
  bountyId,
  bountyInteger,
  bountyObject,
  bountyUtc,
  canonicalBountyBytes,
} from "./codec";
import type {
  BeneficiaryInput,
  EvidenceContext,
  FrozenBeneficiary,
  ResidentRevision,
} from "./contracts";
import { TransitionError } from "./contracts";

const RESIDENT_KEYS = [
  "schemaVersion",
  "residentId",
  "revision",
  "supersedesRevision",
  "issuer",
  "issuerResidentId",
  "controllerActorId",
  "controllerRevision",
  "verifiedOrganizationId",
  "authorizedStewardActorId",
  "githubAppId",
  "installationIds",
  "repositoryIds",
  "policyDigest",
  "display",
  "state",
  "effectiveAt",
];
const BENEFICIARY_KEYS = [
  "beneficiaryId",
  "authenticatedActorId",
  "residentId",
  "residentRevision",
  "controllerRevision",
  "walletClaimDigest",
  "walletProofDigest",
  "destination",
  "network",
  "mint",
];
const digest = (value: unknown): string =>
  sha256Hex(canonicalBountyBytes(value));
const same = (a: unknown, b: unknown): boolean => digest(a) === digest(b);

function checked<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof TransitionError) throw error;
    throw new TransitionError("invalid");
  }
}

function ids(value: readonly string[]): void {
  if (
    !Array.isArray(value) ||
    !value.length ||
    new Set(value).size !== value.length
  )
    throw new TransitionError("invalid");
  for (const id of value) bountyInteger(id, true);
}

function assertRow(row: ResidentRevision): void {
  assertExactBountyKeys(bountyObject(row), RESIDENT_KEYS);
  if (
    row.schemaVersion !== "1" ||
    !["active", "suspended", "revoked"].includes(row.state)
  )
    throw new TransitionError("invalid");
  for (const field of ["residentId", "issuer", "issuerResidentId"] as const)
    bountyId(row[field]);
  for (const field of [
    "revision",
    "controllerActorId",
    "controllerRevision",
    "authorizedStewardActorId",
    "githubAppId",
  ] as const)
    bountyInteger(row[field], true);
  if (row.supersedesRevision !== null)
    bountyInteger(row.supersedesRevision, true);
  if (row.verifiedOrganizationId !== null)
    bountyInteger(row.verifiedOrganizationId, true);
  ids(row.installationIds);
  ids(row.repositoryIds);
  bountyDigest(row.policyDigest);
  bountyUtc(row.effectiveAt);
  const display = bountyObject(row.display);
  assertExactBountyKeys(display, ["name", "avatarUrl", "controllerLogin"]);
  if (
    typeof display.name !== "string" ||
    typeof display.controllerLogin !== "string" ||
    (display.avatarUrl !== null && typeof display.avatarUrl !== "string")
  )
    throw new TransitionError("invalid");
}

/** context.residents is the independently reviewed exact revision ledger.
 * Proposed rows cannot authorize their own controller or publisher bindings.
 * Validate history at each record's effective time, retaining old attribution. */
export function assertResidentTransition(
  previous: readonly ResidentRevision[],
  next: readonly ResidentRevision[],
  context: EvidenceContext,
): readonly ResidentRevision[] {
  return checked(() => {
    bountyUtc(context.now);
    if (
      next.length < previous.length ||
      previous.some((r, i) => !same(r, next[i]))
    )
      throw new TransitionError("replay-conflict");
    const latest = new Map<string, ResidentRevision>();
    const issuerIds = new Map<string, string>();
    for (const row of next) {
      assertRow(row);
      const old = latest.get(row.residentId);
      if (
        !old
          ? row.revision !== "1" || row.supersedesRevision !== null
          : row.supersedesRevision !== old.revision ||
            BigInt(row.revision) !== BigInt(old.revision) + 1n ||
            row.issuer !== old.issuer ||
            row.issuerResidentId !== old.issuerResidentId ||
            row.effectiveAt < old.effectiveAt
      )
        throw new TransitionError("invalid");
      const issuerId = digest([row.issuer, row.issuerResidentId]);
      if (issuerIds.has(issuerId) && issuerIds.get(issuerId) !== row.residentId)
        throw new TransitionError("unauthorized");
      issuerIds.set(issuerId, row.residentId);
      const reviewed = context.residents.filter(
        (r) => r.residentId === row.residentId && r.revision === row.revision,
      );
      if (
        reviewed.length !== 1 ||
        !same(reviewed[0], row) ||
        row.effectiveAt > context.now
      )
        throw new TransitionError("unauthorized");
      const controllers = context.controllers.filter(
        (r) =>
          r.actorId === row.controllerActorId &&
          r.revision === row.controllerRevision,
      );
      const controller = controllers[0];
      if (
        controllers.length !== 1 ||
        controller.organizationId !== row.verifiedOrganizationId ||
        controller.authorizedStewardActorId !== row.authorizedStewardActorId ||
        !controller.residentIds.includes(row.residentId) ||
        bountyUtc(controller.effectiveAt) > row.effectiveAt
      )
        throw new TransitionError("unauthorized");
      bountyDigest(controller.evidenceDigest);
      const policies = context.reviewedPolicies.filter(
        (p) => p.policyDigest === row.policyDigest && p.issuer === row.issuer,
      );
      const policy = policies[0];
      if (
        policies.length !== 1 ||
        policy.environment !== context.environment ||
        bountyUtc(policy.effectiveAt) > row.effectiveAt ||
        (policy.revokedAt !== null &&
          bountyUtc(policy.revokedAt) <= row.effectiveAt) ||
        !policy.githubAppIds.includes(row.githubAppId) ||
        row.installationIds.some(
          (id) => !policy.installationIds.includes(id),
        ) ||
        row.repositoryIds.some((id) => !policy.repositoryIds.includes(id))
      )
        throw new TransitionError("unauthorized");
      latest.set(row.residentId, row);
    }
    return structuredClone(next);
  });
}

/** A named payee is authenticated by the independently held wallet claim, never
 * inferred from the resident owner or publisher. Consumed proof is possession
 * evidence only; this function neither supplies a decision nor moves money.
 * The adapter must retain atomic single-use consumption with the exact proof. */
export function freezeBeneficiary(
  input: BeneficiaryInput,
  context: EvidenceContext,
): FrozenBeneficiary {
  return checked(() => {
    assertExactBountyKeys(bountyObject(input), BENEFICIARY_KEYS);
    bountyUtc(context.now);
    bountyInteger(context.revision);
    bountyId(input.beneficiaryId);
    bountyId(input.residentId);
    for (const field of [
      "authenticatedActorId",
      "residentRevision",
      "controllerRevision",
    ] as const)
      bountyInteger(input[field], true);
    bountyDigest(input.walletClaimDigest);
    bountyDigest(input.walletProofDigest);
    if (
      input.network !== "solana-mainnet" ||
      input.mint !== SOLANA_MAINNET_USDC_MINT ||
      !isSolanaAddress(input.destination)
    )
      throw new TransitionError("invalid");
    const rows = assertResidentTransition([], context.residents, context);
    const resident = rows.find(
      (r) =>
        r.residentId === input.residentId &&
        r.revision === input.residentRevision,
    );
    if (!resident || resident.controllerRevision !== input.controllerRevision)
      throw new TransitionError("unauthorized");
    const existing = context.beneficiaries.filter(
      (b) => b.beneficiaryId === input.beneficiaryId,
    );
    if (existing.length > 1) throw new TransitionError("replay-conflict");
    const frozen = existing[0];
    let frozenAt = context.now;
    if (frozen) {
      assertExactBountyKeys(bountyObject(frozen), [
        ...BENEFICIARY_KEYS,
        "evidenceRevision",
        "frozenAt",
        "beneficiaryDigest",
      ]);
      const { beneficiaryDigest, ...payload } = frozen;
      const { evidenceRevision, frozenAt: at, ...binding } = payload;
      if (!same(binding, input) || digest(payload) !== beneficiaryDigest)
        throw new TransitionError("replay-conflict");
      if (
        bountyUtc(at) > context.now ||
        BigInt(bountyInteger(evidenceRevision)) > BigInt(context.revision)
      )
        throw new TransitionError("invalid");
      frozenAt = at;
    } else if (
      rows.some(
        (r) =>
          r.residentId === resident.residentId &&
          BigInt(r.revision) > BigInt(resident.revision),
      )
    ) {
      throw new TransitionError("held");
    }
    if (resident.state !== "active" || resident.effectiveAt > frozenAt)
      throw new TransitionError("held");
    if (!isSignableSolanaAddress(input.destination))
      throw new TransitionError("held");
    const claims = context.walletClaims.filter(
      (c) => c.claimDigest === input.walletClaimDigest,
    );
    const claim = claims[0];
    if (
      claims.length !== 1 ||
      claim.authenticatedActorId !== input.authenticatedActorId ||
      claim.destination !== input.destination
    )
      throw new TransitionError("unauthorized");
    const proofs = context.walletProofs.filter(
      (p) => p.proofDigest === input.walletProofDigest,
    );
    const proof = proofs[0];
    if (
      proofs.length !== 1 ||
      proof.consumedAt === null ||
      proof.authenticatedActorId !== claim.authenticatedActorId
    )
      throw new TransitionError("held");
    try {
      if (
        bountyUtc(proof.consumedAt) > frozenAt ||
        bountyUtc(claim.observedAt) > proof.consumedAt ||
        digest({ challenge: proof.challenge, signature: proof.signature }) !==
          proof.proofDigest
      )
        throw new TransitionError("held");
      verifyWalletPossession({
        challenge: proof.challenge,
        signature: proof.signature,
        claimId: claim.claimId,
        githubActorId: claim.authenticatedActorId,
        address: claim.destination,
        now: Date.parse(proof.consumedAt),
      });
    } catch {
      throw new TransitionError("held");
    }
    if (frozen) return structuredClone(frozen);
    const payload = {
      ...structuredClone(input),
      evidenceRevision: context.revision,
      frozenAt,
    };
    return { ...payload, beneficiaryDigest: digest(payload) };
  });
}
