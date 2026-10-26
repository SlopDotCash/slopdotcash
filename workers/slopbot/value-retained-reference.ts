import { sha256Hex } from "./github";
import { sameRepositoryCommitHints } from "./value-commit-hints";
import type { EvidenceClient, ValueEvidence } from "./value-evidence";

type Source = Pick<
  ValueEvidence,
  | "repository"
  | "repositoryNodeId"
  | "repositoryDatabaseId"
  | "pull"
  | "comments"
>;
type Comment = ValueEvidence["comments"][number];

export interface RetainedMergeReference {
  commentNodeId: string;
  acknowledgementSha256: string;
  abbreviation: string;
  commitSha: string;
}

/** Bind the provider resolution to the original authenticated comment, not
 * just its text or a mutable repository name. Collection time is not evidence.
 */
function acknowledgementDigest(source: Source, comment: Comment) {
  return sha256Hex(
    JSON.stringify([
      source.repository,
      source.repositoryNodeId,
      source.repositoryDatabaseId,
      source.pull.node_id,
      comment,
    ]),
  );
}

function abbreviations(source: Source, comment: Comment): string[] {
  if (
    !comment.user ||
    comment.user.type === "Bot" ||
    !/\b(?:merged?|integrat(?:ed|ion))\b/iu.test(comment.body)
  )
    return [];
  return sameRepositoryCommitHints(source.repository, comment.body).filter(
    (reference) => reference.length < 40,
  );
}

/** Resolve short references through the same repository's authenticated
 * GitHub client. A failed/ambiguous lookup supplies no retention authority.
 * The trusted import/publication collectors repeat this lookup; they never
 * reuse resolution supplied by an assessment.
 */
export async function collectRetainedMergeReferences(
  client: EvidenceClient,
  source: Source,
): Promise<RetainedMergeReference[]> {
  if (source.pull.merged_at !== null || source.pull.state !== "closed")
    return [];
  const hints = source.comments.flatMap((comment) =>
    abbreviations(source, comment).map((abbreviation) => ({
      comment,
      abbreviation,
    })),
  );
  // Match the existing indirect-acceptance discovery bound. Never truncate
  // an over-bound source into apparently complete resolution evidence.
  if (hints.length > 16) return [];
  const references: RetainedMergeReference[] = [];
  for (const { comment, abbreviation } of hints) {
    const resolved = await client
      .get<{ sha: string; html_url: string }>(
        `/repos/${source.repository}/commits/${abbreviation}`,
      )
      .catch(() => null);
    if (
      !resolved ||
      !/^[a-f0-9]{40}$/u.test(resolved.sha) ||
      !resolved.sha.startsWith(abbreviation) ||
      resolved.html_url !==
        `https://github.com/${source.repository}/commit/${resolved.sha}`
    )
      continue;
    references.push({
      commentNodeId: comment.node_id,
      acknowledgementSha256: await acknowledgementDigest(source, comment),
      abbreviation,
      commitSha: resolved.sha,
    });
  }
  return references;
}

export async function hasRetainedMergeReference(
  source: ValueEvidence,
  comment: Comment,
  accepted: ValueEvidence,
): Promise<boolean> {
  const sha = accepted.pull.merge_commit_sha;
  if (!sha || accepted.mergeCommitEvidence?.sha !== sha) return false;
  const digest = await acknowledgementDigest(source, comment);
  return abbreviations(source, comment).some((abbreviation) => {
    const references = (source.retainedMergeReferences ?? []).filter(
      (reference) =>
        reference.commentNodeId === comment.node_id &&
        reference.abbreviation === abbreviation,
    );
    return (
      references.length === 1 &&
      references[0].acknowledgementSha256 === digest &&
      references[0].commitSha === sha &&
      sha.startsWith(abbreviation)
    );
  });
}
