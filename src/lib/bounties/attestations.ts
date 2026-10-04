import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256Hex } from "../sha256";
import {
  assertExactBountyKeys,
  bountyDigest,
  bountyId,
  bountyInteger,
  bountyObject,
  bountyUtc,
  canonicalBountyBytes,
  parseResidentAttestationBytes,
  residentAttestationSigningBytes,
} from "./codec";
import type {
  AcceptedWorkLineage,
  AdmissionNonce,
  EvidenceContext,
  EvidenceProvenance,
  ResidentAttestationV1,
  TrustedBuildEvidence,
  VerifiedResidentSubmission,
} from "./contracts";
import { TransitionError } from "./contracts";
import { assertResidentTransition } from "./residents";
import { assertBountyTerms } from "./terms";

export type { VerifiedResidentSubmission } from "./contracts";

const digest = (value: unknown): string =>
  sha256Hex(canonicalBountyBytes(value));
const same = (a: unknown, b: unknown): boolean => digest(a) === digest(b);

/** V1 permits one reviewed deliverable per PR. New commits, controllers or
 * bounties cannot produce a fresh economic identity for that PR. Cross-PR work
 * equivalence requires a separate reviewed mapping; it is never inferred here. */
export function residentWorkUnitId(
  repositoryId: string,
  prNodeId: string,
): string {
  bountyInteger(repositoryId, true);
  bountyId(prNodeId);
  return digest({
    domain: "slop.cash/resident-bounty/work-unit/v1",
    repositoryId,
    prNodeId,
  });
}

function one<T>(values: readonly T[]): T {
  if (values.length !== 1) throw new TransitionError("unauthorized");
  return values[0];
}
function commit(value: string): void {
  if (!/^[0-9a-f]{40}$/u.test(value)) throw new TransitionError("invalid");
}
function provenance(value: EvidenceProvenance): void {
  if (value.kind === "local-synthetic") {
    assertExactBountyKeys(bountyObject(value), ["kind", "fixtureId"]);
    bountyId(value.fixtureId);
  } else if (value.kind === "authenticated-adapter") {
    assertExactBountyKeys(bountyObject(value), [
      "kind",
      "adapterId",
      "adapterRevision",
      "sourceDigest",
      "observedAt",
    ]);
    bountyId(value.adapterId);
    bountyId(value.adapterRevision);
    bountyDigest(value.sourceDigest);
    bountyUtc(value.observedAt);
  } else throw new TransitionError("invalid");
}
function record(
  value: object,
  selfField: string,
  keys: readonly string[],
): void {
  const row = bountyObject(value);
  assertExactBountyKeys(row, keys);
  bountyDigest(row[selfField]);
  const payload = { ...row };
  delete payload[selfField];
  if (digest(payload) !== row[selfField]) throw new TransitionError("invalid");
  provenance(row.provenance as EvidenceProvenance);
}
function artifacts(value: ResidentAttestationV1["artifactDigests"]): void {
  if (!Array.isArray(value) || !value.length)
    throw new TransitionError("invalid");
  const seen = new Set<string>();
  for (const a of value) {
    assertExactBountyKeys(bountyObject(a), ["artifactId", "digest"]);
    bountyId(a.artifactId);
    bountyDigest(a.digest);
    if (seen.has(a.artifactId)) throw new TransitionError("invalid");
    seen.add(a.artifactId);
  }
}
function checkedBuild(
  build: TrustedBuildEvidence,
  context: EvidenceContext,
): void {
  record(build, "evidenceDigest", [
    "acceptanceTermsDigest",
    "evidenceDigest",
    "repositoryId",
    "commit",
    "tree",
    "artifactDigests",
    "toolPolicyRevision",
    "executionResultDigest",
    "result",
    "observedAt",
    "provenance",
  ]);
  if (build.acceptanceTermsDigest !== null)
    bountyDigest(build.acceptanceTermsDigest);
  bountyInteger(build.repositoryId, true);
  commit(build.commit);
  commit(build.tree);
  artifacts(build.artifactDigests);
  bountyId(build.toolPolicyRevision);
  bountyDigest(build.executionResultDigest);
  if (build.result !== "passed" || bountyUtc(build.observedAt) > context.now)
    throw new TransitionError("held");
}

function acceptance(
  a: ResidentAttestationV1,
  submittedTree: string,
  context: EvidenceContext,
): AcceptedWorkLineage | null {
  const rows = context.acceptedLineages.filter(
    (l) =>
      l.repositoryId === a.repositoryId &&
      l.prNodeId === a.prNodeId &&
      l.submittedCommit === a.submittedCommit,
  );
  if (!rows.length) return null;
  const lineage = one(rows);
  record(lineage, "lineageDigest", [
    "lineageDigest",
    "repositoryId",
    "prNodeId",
    "submittedCommit",
    "submittedTree",
    "acceptedCommit",
    "acceptedTree",
    "relationship",
    "acceptanceActorId",
    "acceptedAt",
    "acceptedBuildEvidenceDigest",
    "workBoundaryDigest",
    "provenance",
  ]);
  commit(lineage.acceptedCommit);
  commit(lineage.acceptedTree);
  bountyDigest(lineage.workBoundaryDigest);
  bountyInteger(lineage.acceptanceActorId, true);
  const terms = one(
    context.terms.filter(
      (t) => t.bountyId === a.bountyId && t.termsDigest === a.termsDigest,
    ),
  );
  if (
    lineage.repositoryId !== a.repositoryId ||
    lineage.submittedCommit !== a.submittedCommit ||
    lineage.submittedTree !== submittedTree ||
    !["unchanged", "rebase", "squash", "maintainer-edits"].includes(
      lineage.relationship,
    ) ||
    !terms.authority.acceptanceActorIds.includes(lineage.acceptanceActorId) ||
    bountyUtc(lineage.acceptedAt) < a.issuedAt
  )
    throw new TransitionError("unauthorized");
  // A later fixture/adapter phase may already hold future observations. They
  // cannot count as acceptance at this context's clock.
  if (lineage.acceptedAt > context.now) return null;
  const changed = lineage.acceptedTree !== submittedTree;
  if (changed && lineage.relationship === "unchanged")
    throw new TransitionError("invalid");
  if (changed || lineage.acceptedBuildEvidenceDigest !== null) {
    if (lineage.acceptedBuildEvidenceDigest === null)
      throw new TransitionError("held");
    bountyDigest(lineage.acceptedBuildEvidenceDigest);
    const build = one(
      context.buildEvidence.filter(
        (b) => b.evidenceDigest === lineage.acceptedBuildEvidenceDigest,
      ),
    );
    checkedBuild(build, context);
    if (
      build.repositoryId !== a.repositoryId ||
      build.tree !== lineage.acceptedTree ||
      build.toolPolicyRevision !== a.toolPolicyRevision ||
      (changed &&
        (build.commit !== lineage.acceptedCommit ||
          build.evidenceDigest === a.buildEvidenceDigest ||
          build.observedAt < a.issuedAt)) ||
      (!changed &&
        (!same(build.artifactDigests, a.artifactDigests) ||
          build.executionResultDigest !== a.executionResultDigest))
    )
      throw new TransitionError("held");
  }
  return structuredClone(lineage);
}

/** Pure validation only: never consumes a nonce, reserves work or approves an
 * award. nonce and context must come from trusted durable state/read adapters,
 * not request bodies. A previously consumed exact digest permits later lineage
 * refresh after expiry; command idempotency and atomic consumption belong to the
 * transition reducer. Current key/policy/resident revocation still holds use. */
export async function verifyResidentAttestation(
  bytes: Uint8Array,
  nonce: AdmissionNonce,
  context: EvidenceContext,
): Promise<VerifiedResidentSubmission> {
  try {
    const a = parseResidentAttestationBytes(bytes);
    const attestationDigest = sha256Hex(bytes);
    bountyUtc(context.now);
    bountyInteger(context.revision);
    assertExactBountyKeys(bountyObject(nonce), [
      "nonceId",
      "residentId",
      "residentRevision",
      "controllerActorId",
      "controllerRevision",
      "bountyId",
      "termsDigest",
      "repositoryId",
      "runId",
      "attemptId",
      "issuedAt",
      "expiresAt",
      "acceptedAttestationDigest",
    ]);
    for (const field of [
      "nonceId",
      "residentId",
      "residentRevision",
      "controllerActorId",
      "controllerRevision",
      "bountyId",
      "termsDigest",
      "repositoryId",
      "runId",
      "attemptId",
      "issuedAt",
      "expiresAt",
    ] as const) {
      if (nonce[field] !== a[field]) throw new TransitionError("unauthorized");
    }
    const historical = nonce.acceptedAttestationDigest !== null;
    if (historical && nonce.acceptedAttestationDigest !== attestationDigest)
      throw new TransitionError("replay-conflict");
    if (a.issuedAt > context.now || (!historical && context.now >= a.expiresAt))
      throw new TransitionError("held");
    const terms = assertBountyTerms(
      one(
        context.terms.filter(
          (t) => t.bountyId === a.bountyId && t.termsDigest === a.termsDigest,
        ),
      ),
    );
    if (
      terms.projectId !== a.projectId ||
      terms.repositoryId !== a.repositoryId ||
      terms.deliverableDigest !== a.taskDefinitionDigest ||
      !terms.eligibleSubjectKinds.includes("resident") ||
      a.expiresAt > terms.submissionDeadline ||
      (!historical && context.now >= terms.submissionDeadline)
    )
      throw new TransitionError("unauthorized");
    const rows = assertResidentTransition([], context.residents, context);
    const resident = one(
      rows.filter(
        (r) =>
          r.residentId === a.residentId && r.revision === a.residentRevision,
      ),
    );
    const latest = rows.filter((r) => r.residentId === a.residentId).at(-1);
    if (
      resident.state !== "active" ||
      latest?.state !== "active" ||
      (!historical && latest?.revision !== resident.revision) ||
      resident.effectiveAt > a.issuedAt ||
      resident.issuer !== a.issuer ||
      resident.controllerActorId !== a.controllerActorId ||
      resident.controllerRevision !== a.controllerRevision ||
      !resident.repositoryIds.includes(a.repositoryId)
    )
      throw new TransitionError("unauthorized");
    const policy = one(
      context.reviewedPolicies.filter(
        (p) =>
          p.policyDigest === resident.policyDigest && p.issuer === a.issuer,
      ),
    );
    record(policy, "policyDigest", [
      "policyDigest",
      "issuer",
      "environment",
      "projectIds",
      "repositoryIds",
      "githubAppIds",
      "installationIds",
      "toolPolicyRevision",
      "maxAdmissionLifetimeMs",
      "effectiveAt",
      "revokedAt",
      "provenance",
    ]);
    if (
      a.environment !== context.environment ||
      policy.environment !== a.environment ||
      !policy.projectIds.includes(a.projectId) ||
      !policy.repositoryIds.includes(a.repositoryId) ||
      !policy.githubAppIds.includes(resident.githubAppId) ||
      policy.toolPolicyRevision !== a.toolPolicyRevision ||
      bountyUtc(policy.effectiveAt) > a.issuedAt ||
      (policy.revokedAt !== null &&
        bountyUtc(policy.revokedAt) <= context.now) ||
      BigInt(Date.parse(a.expiresAt) - Date.parse(a.issuedAt)) >
        BigInt(bountyInteger(policy.maxAdmissionLifetimeMs, true))
    )
      throw new TransitionError("unauthorized");
    const key = one(
      context.reviewedKeys.filter(
        (k) => k.issuer === a.issuer && k.keyId === a.keyId,
      ),
    );
    assertExactBountyKeys(bountyObject(key), [
      "issuer",
      "keyId",
      "publicKey",
      "policyDigest",
      "effectiveAt",
      "revokedAt",
      "provenance",
    ]);
    if (
      key.policyDigest !== resident.policyDigest ||
      bountyUtc(key.effectiveAt) > a.issuedAt ||
      (key.revokedAt !== null && bountyUtc(key.revokedAt) <= context.now) ||
      key.publicKey.length !== 32
    )
      throw new TransitionError("unauthorized");
    provenance(key.provenance);
    const signature = Uint8Array.from(atob(a.signature), (c) =>
      c.charCodeAt(0),
    );
    if (
      !ed25519.verify(
        signature,
        residentAttestationSigningBytes(a),
        key.publicKey,
        { zip215: false },
      )
    )
      throw new TransitionError("unauthorized");
    const github = one(
      context.githubSubmissions.filter(
        (g) =>
          g.repositoryId === a.repositoryId &&
          g.prNodeId === a.prNodeId &&
          g.submittedCommit === a.submittedCommit,
      ),
    );
    record(github, "evidenceDigest", [
      "evidenceDigest",
      "repositoryId",
      "prNodeId",
      "authorActorId",
      "githubAppId",
      "installationId",
      "submittedCommit",
      "submittedTree",
      "artifactDigests",
      "observedAt",
      "provenance",
    ]);
    bountyInteger(github.authorActorId, true);
    commit(github.submittedTree);
    if (
      github.githubAppId !== resident.githubAppId ||
      !resident.installationIds.includes(github.installationId) ||
      !policy.installationIds.includes(github.installationId) ||
      github.submittedCommit !== a.submittedCommit ||
      !same(github.artifactDigests, a.artifactDigests) ||
      bountyUtc(github.observedAt) < a.issuedAt ||
      github.observedAt > context.now
    )
      throw new TransitionError("unauthorized");
    const build = one(
      context.buildEvidence.filter(
        (b) => b.evidenceDigest === a.buildEvidenceDigest,
      ),
    );
    checkedBuild(build, context);
    if (
      build.repositoryId !== a.repositoryId ||
      build.commit !== a.submittedCommit ||
      build.tree !== github.submittedTree ||
      !same(build.artifactDigests, a.artifactDigests) ||
      build.toolPolicyRevision !== a.toolPolicyRevision ||
      build.executionResultDigest !== a.executionResultDigest ||
      build.observedAt < a.issuedAt
    )
      throw new TransitionError("held");
    const manifest = one(
      context.publicationManifests.filter(
        (m) => m.manifestDigest === a.publicationManifestDigest,
      ),
    );
    record(manifest, "manifestDigest", [
      "manifestDigest",
      "repositoryId",
      "submittedCommit",
      "artifactDigests",
      "licenseDigest",
      "inboundTermsDigest",
      "publicMetadataReviewDigest",
      "provenance",
    ]);
    bountyDigest(manifest.publicMetadataReviewDigest);
    if (
      manifest.repositoryId !== a.repositoryId ||
      manifest.submittedCommit !== a.submittedCommit ||
      !same(manifest.artifactDigests, a.artifactDigests) ||
      manifest.licenseDigest !== terms.licenseDigest ||
      manifest.inboundTermsDigest !== terms.inboundTermsDigest
    )
      throw new TransitionError("held");
    return {
      attestationDigest,
      attestationBytes: bytes.slice(),
      residentId: a.residentId,
      residentRevision: a.residentRevision,
      controllerActorId: a.controllerActorId,
      controllerRevision: a.controllerRevision,
      bountyId: a.bountyId,
      termsDigest: a.termsDigest,
      repositoryId: a.repositoryId,
      prNodeId: a.prNodeId,
      submittedCommit: a.submittedCommit,
      submittedTree: github.submittedTree,
      artifactDigests: structuredClone(a.artifactDigests),
      nonceId: nonce.nonceId,
      githubEvidenceDigest: github.evidenceDigest,
      buildEvidenceDigest: a.buildEvidenceDigest,
      publicationManifestDigest: a.publicationManifestDigest,
      acceptance: acceptance(a, github.submittedTree, context),
      workUnitId: residentWorkUnitId(a.repositoryId, a.prNodeId),
      verifiedAt: context.now,
      evidenceRevision: context.revision,
    };
  } catch (error) {
    if (error instanceof TransitionError) throw error;
    // JSON/UTF-8/signature libraries may echo bad input; boundary errors never do.
    throw new TransitionError("invalid");
  }
}
