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
type Pull = ValueEvidence["pull"];

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

/** GitHub's merge record, not comment text, names who accepted a commit and
 * when. Only one merged PR may own the commit as its merge commit.
 */
async function acceptingPull(
  client: EvidenceClient,
  repository: string,
  sha: string,
) {
  const listed = await client
    .get<Pick<Pull, "number" | "merged_at" | "merge_commit_sha">[]>(
      `/repos/${repository}/commits/${sha}/pulls?per_page=100`,
    )
    .catch(() => null);
  const merged = (Array.isArray(listed) ? listed : []).filter(
    (pull) => pull.merged_at !== null && pull.merge_commit_sha === sha,
  );
  if (merged.length !== 1) return null;
  const pull = await client
    .get<Pick<Pull, "merged_at" | "merge_commit_sha" | "merged_by">>(
      `/repos/${repository}/pulls/${merged[0].number}`,
    )
    .catch(() => null);
  return pull?.merged_at && pull.merge_commit_sha === sha ? pull : null;
}

/** Resolve short references through the same repository's authenticated
 * GitHub client. A failed/ambiguous lookup supplies no retention authority.
 * Keep a reference only when its author merged that commit, after the merge,
 * and this PR was opened before the merge: a later duplicate is no original.
 * The trusted import/publication collectors repeat this lookup; they never
 * reuse resolution supplied by an assessment.
 */
export async function collectRetainedMergeReferences(
  client: EvidenceClient,
  source: Source & { createdAt: string },
): Promise<{ references: RetainedMergeReference[]; limitations: string[] }> {
  const references: RetainedMergeReference[] = [];
  if (source.pull.merged_at !== null || source.pull.state !== "closed")
    return { references, limitations: [] };
  const hints = source.comments.flatMap((comment) =>
    abbreviations(source, comment).map((abbreviation) => ({
      comment,
      abbreviation,
    })),
  );
  // Match the existing indirect-acceptance discovery bound. Never truncate
  // an over-bound source into apparently complete resolution evidence.
  if (hints.length > 16)
    return {
      references,
      limitations: [
        "Retained merge reference: discovery bounds reached; complete reconciliation required",
      ],
    };
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
    const accepted = await acceptingPull(
      client,
      source.repository,
      resolved.sha,
    );
    if (
      !accepted?.merged_at ||
      accepted.merged_by?.node_id !== comment.user?.node_id ||
      Date.parse(comment.created_at) < Date.parse(accepted.merged_at) ||
      !(Date.parse(source.createdAt) < Date.parse(accepted.merged_at))
    )
      continue;
    references.push({
      commentNodeId: comment.node_id,
      acknowledgementSha256: await acknowledgementDigest(source, comment),
      abbreviation,
      commitSha: resolved.sha,
    });
  }
  return { references, limitations: [] };
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
