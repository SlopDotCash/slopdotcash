//@ backend dafny
// spec/points/scoringPolicy.md, "A scored source records its provenance and keeps the 10-Point minimum"

export type EvidenceCategory = "screenshot" | "video" | "logs" | "trajectory" | "domain-artifact";

export interface TextSource { id: string; kind: string; authorBot: boolean; artifactId: string; updatedAt: string; body: string }

export interface VerifiedArtifact {
  sourceId: string;
  pullRequestId: string;
  sourceUpdatedAt: string;
  sourceBody: string;
  artifactIdentity: string;
  category: EvidenceCategory;
  contentSha256: string;
}

export interface RankedArtifact { artifact: VerifiedArtifact; pullRequestRank: number; identityRank: number }

export interface Claim { identity: string; category: EvidenceCategory; sourceId: string }

export interface EvidenceFinding { category: EvidenceCategory; points: number; sourceIds: string[] }

export interface EvidenceAssessment { points: number; maxPoints: number; categories: EvidenceCategory[]; findings: EvidenceFinding[] }

export const evidencePointCap = 6;
export const evidenceCategories: EvidenceCategory[] = ["screenshot", "video", "logs", "trajectory", "domain-artifact"];
export const findingOrder: EvidenceCategory[] = ["domain-artifact", "logs", "screenshot", "trajectory", "video"];

/** @throws {never} */
export function evidenceWeight(category: EvidenceCategory): number {
  //@ ensures 1 <= \result && \result <= 2
  //@ ensures category === "video" ==> \result === 2
  return category === "video" ? 2 : 1;
}

/** @throws {never} */
export function evidenceCategoryRank(category: EvidenceCategory): number {
  //@ ensures 0 <= \result && \result <= 4
  switch (category) {
    case "screenshot":
      return 0;
    case "video":
      return 1;
    case "logs":
      return 2;
    case "trajectory":
      return 3;
    case "domain-artifact":
      return 4;
  }
}

/** @throws {never} */
export function firstSourceWithId(sources: TextSource[], id: string): number {
  //@ ensures -1 <= \result && \result < sources.length
  let i = 0;
  while (i < sources.length) {
    //@ invariant 0 <= i && i <= sources.length
    if (sources[i].id === id) return i;
    i = i + 1;
  }
  return -1;
}

/** @throws {never} */
export function verifiedClaims(sources: TextSource[], artifacts: VerifiedArtifact[]): Claim[] {
  const claims: Claim[] = [];
  for (const artifact of artifacts) {
    const index = firstSourceWithId(sources, artifact.sourceId);
    if (index >= 0) {
      const source = sources[index];
      const bound = source.kind === "body" && !source.authorBot && source.artifactId === artifact.pullRequestId
        && source.updatedAt === artifact.sourceUpdatedAt && source.body === artifact.sourceBody && artifact.artifactIdentity.length > 0;
      if (bound) claims.push({ identity: artifact.artifactIdentity, category: artifact.category, sourceId: source.id });
    }
  }
  return claims;
}

/** @throws {never} */
export function identityHasOneCategory(claims: Claim[], identity: string, category: EvidenceCategory): boolean {
  for (const claim of claims) {
    if (claim.identity === identity && claim.category !== category) return false;
  }
  return true;
}

/** @throws {never} */
export function compareCodeUnits(left: string, right: string): number {
  let i = 0;
  while (i < left.length && i < right.length) {
    //@ invariant 0 <= i && i <= left.length && i <= right.length
    const a = left.charCodeAt(i);
    const b = right.charCodeAt(i);
    if (a !== b) return a < b ? -1 : 1;
    i = i + 1;
  }
  return left.length === right.length ? 0 : (left.length < right.length ? -1 : 1);
}

/** @throws {never} */
export function insertSorted(ids: string[], id: string): string[] {
  const out: string[] = [];
  let placed = false;
  for (const existing of ids) {
    if (existing === id) return ids;
    if (!placed && compareCodeUnits(id, existing) < 0) {
      out.push(id);
      placed = true;
    }
    out.push(existing);
  }
  if (!placed) out.push(id);
  return out;
}

/** @throws {never} */
export function categorySourceIds(claims: Claim[], category: EvidenceCategory): string[] {
  let ids: string[] = [];
  for (const claim of claims) {
    if (claim.category === category && identityHasOneCategory(claims, claim.identity, category)) {
      ids = insertSorted(ids, claim.sourceId);
    }
  }
  return ids;
}

/** @throws {never} */
export function assessEvidence(sources: TextSource[], artifacts: VerifiedArtifact[]): EvidenceAssessment {
  //@ ensures 0 <= \result.points && \result.points <= evidencePointCap
  //@ ensures \result.maxPoints === evidencePointCap
  const claims = verifiedClaims(sources, artifacts);
  const findings: EvidenceFinding[] = [];
  const categories: EvidenceCategory[] = [];
  let total = 0;
  for (const category of findingOrder) {
    const ids = categorySourceIds(claims, category);
    if (ids.length > 0) {
      findings.push({ category: category, points: evidenceWeight(category), sourceIds: ids });
      categories.push(category);
      total = total + evidenceWeight(category);
    }
  }
  return { points: Math.min(evidencePointCap, total), maxPoints: evidencePointCap, categories: categories, findings: findings };
}

/** @throws {never} */
export function rankedBefore(left: RankedArtifact, right: RankedArtifact): boolean {
  if (left.pullRequestRank !== right.pullRequestRank) return left.pullRequestRank < right.pullRequestRank;
  const leftCategory = evidenceCategoryRank(left.artifact.category);
  const rightCategory = evidenceCategoryRank(right.artifact.category);
  if (leftCategory !== rightCategory) return leftCategory < rightCategory;
  return left.identityRank < right.identityRank;
}

/** @throws {never} */
export function sortRanked(artifacts: RankedArtifact[]): RankedArtifact[] {
  let sorted: RankedArtifact[] = [];
  for (const artifact of artifacts) {
    const next: RankedArtifact[] = [];
    let placed = false;
    for (const existing of sorted) {
      if (!placed && rankedBefore(artifact, existing)) {
        next.push(artifact);
        placed = true;
      }
      next.push(existing);
    }
    if (!placed) next.push(artifact);
    sorted = next;
  }
  return sorted;
}

/** @throws {never} */
export function claimedEarlier(kept: VerifiedArtifact[], artifact: VerifiedArtifact): boolean {
  for (const earlier of kept) {
    if (earlier.artifactIdentity === artifact.artifactIdentity || earlier.contentSha256 === artifact.contentSha256) return true;
  }
  return false;
}

/** @throws {never} */
export function selectUniqueVerifiedEvidence(artifacts: RankedArtifact[]): VerifiedArtifact[] {
  const kept: VerifiedArtifact[] = [];
  for (const ranked of sortRanked(artifacts)) {
    if (!claimedEarlier(kept, ranked.artifact)) kept.push(ranked.artifact);
  }
  return kept;
}
