import type { EvidenceClient, ValueEvidence } from "./value-evidence";
import { readValueTreeRootProof } from "./value-tree";

export const NO_CHANGE_PROMOTION_CONTEXT =
  "Unchanged branch promotion requires complete original accepted sources";

export interface NoChangePromotionProof {
  schemaVersion: "slop-no-change-promotion:v1";
  baseSha: string;
  headSha: string;
  mergeSha: string;
  treeSha: string;
}

type PromotionSource = Pick<ValueEvidence, "pull" | "mergeCommitEvidence">;

function promotionParents(source: PromotionSource): boolean {
  const { pull, mergeCommitEvidence: merge } = source;
  return (
    pull.merged_at !== null &&
    merge !== null &&
    merge.sha === pull.merge_commit_sha &&
    pull.base.sha !== pull.head.sha &&
    merge.parents.length === 2 &&
    merge.parents.some(({ sha }) => sha === pull.base.sha) &&
    merge.parents.some(({ sha }) => sha === pull.head.sha) &&
    merge.files.length === 0 &&
    merge.stats.additions === 0 &&
    merge.stats.deletions === 0 &&
    merge.stats.total === 0
  );
}

/** This only defers branch attribution to joint original-source verification.
 * It never supplies an actor, claim, value tier or permission for new work. */
export async function collectNoChangePromotion(
  client: EvidenceClient,
  repository: string,
  source: PromotionSource,
): Promise<NoChangePromotionProof | null> {
  const mergeSha = source.mergeCommitEvidence?.sha;
  if (!promotionParents(source) || !mergeSha) return null;
  const { pull } = source;
  const refs = [pull.base.sha, pull.head.sha, mergeSha];
  const cache = new Map<string, Promise<unknown>>();
  const bounded: EvidenceClient = {
    async get<T>(path: string): Promise<T | null> {
      if (!cache.has(path)) cache.set(path, client.get(path));
      return (await cache.get(path)) as T | null;
    },
  };
  const proofs = await Promise.all(
    refs.map((ref) => readValueTreeRootProof(bounded, repository, ref)),
  );
  const treeSha = proofs[0]?.treeSha;
  if (!treeSha || proofs.some((proof) => proof?.treeSha !== treeSha))
    return null;
  return {
    schemaVersion: "slop-no-change-promotion:v1",
    baseSha: refs[0],
    headSha: refs[1],
    mergeSha: refs[2],
    treeSha,
  };
}

/** True when a source's only limitations are the promotion deferral and its
 * proof matches. Joint preparation is the layer that drops that deferral
 * (value-work-unit.ts); the scheduled consumer's gates may pass such a source
 * through to it instead of refusing the source before joint dispatch. Any
 * other limitation, or a proof that does not match, is not a deferral. */
export function noChangePromotionDeferralOnly(
  source: PromotionSource & {
    noChangePromotion?: NoChangePromotionProof;
    limitations: readonly string[];
  },
): boolean {
  return (
    noChangePromotionMatches(source) &&
    source.limitations.every(
      (limitation) => limitation === NO_CHANGE_PROMOTION_CONTEXT,
    )
  );
}

export function noChangePromotionMatches(
  source: PromotionSource & { noChangePromotion?: NoChangePromotionProof },
): boolean {
  const proof = source.noChangePromotion;
  return (
    proof !== undefined &&
    proof !== null &&
    typeof proof === "object" &&
    !Array.isArray(proof) &&
    Object.keys(proof).sort().join() ===
      "baseSha,headSha,mergeSha,schemaVersion,treeSha" &&
    proof.schemaVersion === "slop-no-change-promotion:v1" &&
    [proof.baseSha, proof.headSha, proof.mergeSha, proof.treeSha].every((sha) =>
      /^[a-f0-9]{40}$/u.test(sha),
    ) &&
    promotionParents(source) &&
    proof.baseSha === source.pull.base.sha &&
    proof.headSha === source.pull.head.sha &&
    proof.mergeSha === source.pull.merge_commit_sha
  );
}
