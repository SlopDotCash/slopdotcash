/** Private GitHub evidence for copied contributions. A closure comment is a
 * discovery hint, never sufficient evidence for assigning implementation credit.
 */
import type { FileChange, ValueEvidence } from "./value-evidence";
import { retainedManifestIdentity } from "./value-manifest-identity";
import {
  hasCompleteValuePatch,
  valueDeletionCount,
  valuePatch,
} from "./value-patch";
import { hasRetainedMergeReference } from "./value-retained-reference";
import type { WorkUnitSource } from "./value-work-unit";

/** An exact same-author reopen already retains authenticated attribution.
 * A rebase can change every commit SHA without changing the delivered work.
 * Partial copies and changed authors still require the acknowledgement below.
 */
function sameAuthorReopen(original: ValueEvidence, accepted: ValueEvidence) {
  if (
    original.pull.state !== "closed" ||
    !original.pull.closed_at ||
    !accepted.pull.merged_at ||
    !(
      Date.parse(original.pull.closed_at) <= Date.parse(accepted.pull.merged_at)
    ) ||
    original.pull.user.type !== "User" ||
    accepted.pull.user.type !== "User" ||
    original.pull.user.node_id !== accepted.pull.user.node_id ||
    original.limitations.length ||
    accepted.limitations.length ||
    !(
      original.relatedPullRequests.some(
        (ref) => ref.id === accepted.pull.node_id,
      ) ||
      accepted.relatedPullRequests.some(
        (ref) => ref.id === original.pull.node_id,
      )
    )
  )
    return false;

  const net = (evidence: ValueEvidence) =>
    evidence.files
      .map((file) => [
        file.filename,
        file.previous_filename ?? null,
        file.status,
        file.additions,
        valueDeletionCount(file),
        valuePatch(file),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (
    !original.files.length ||
    !original.files.every(hasCompleteValuePatch) ||
    !accepted.files.every(hasCompleteValuePatch) ||
    JSON.stringify(net(original)) !== JSON.stringify(net(accepted))
  )
    return false;

  // Bind each complete ordinary commit to its position, not just a set of
  // matching files. Unknown authors, merges and extra edits are not a reopen.
  const history = (evidence: ValueEvidence) => {
    if (
      !evidence.commits.length ||
      evidence.commits.at(-1)?.sha !== evidence.pull.head.sha ||
      evidence.commitAttribution.length !== evidence.commits.length
    )
      return null;
    const result = [];
    for (const [index, commit] of evidence.commits.entries()) {
      const attribution = evidence.commitAttribution.find(
        (item) => item.sha === commit.sha,
      );
      if (
        commit.parents.length !== 1 ||
        commit.parents[0].sha !==
          (index === 0
            ? evidence.pull.base.sha
            : evidence.commits[index - 1].sha) ||
        commit.author?.type !== "User" ||
        !attribution?.files?.length ||
        attribution.limitations.length ||
        !attribution.actorNodeIds.includes(commit.author.node_id) ||
        attribution.changedPaths?.length !== attribution.files.length ||
        new Set(attribution.changedPaths).size !== attribution.files.length ||
        new Set(attribution.files.map((file) => file.filename)).size !==
          attribution.files.length ||
        !attribution.files.every((file) =>
          attribution.changedPaths?.includes(file.filename),
        )
      )
        return null;
      const edits = attribution.files.map(retainedEditIdentity);
      if (edits.includes(null)) return null;
      result.push([
        commit.author.node_id,
        commit.commit.author.date,
        commit.commit.message,
        [...attribution.actorNodeIds].sort(),
        [...attribution.changedPaths].sort(),
        edits.sort(),
      ]);
    }
    return JSON.stringify(result);
  };
  const before = history(original);
  return before !== null && before === history(accepted);
}

export async function retainedCopySources(
  original: WorkUnitSource,
  sources: readonly WorkUnitSource[],
): Promise<WorkUnitSource[]> {
  const evidence = original.evidence;
  if (evidence.pull.merged_at !== null || evidence.indirectAcceptance)
    return [];
  const retained: WorkUnitSource[] = [];
  for (const source of sources) {
    const integration = source.evidence;
    const accepted = integration.pull;
    if (
      integration.repositoryNodeId !== evidence.repositoryNodeId ||
      accepted.node_id === evidence.pull.node_id ||
      !accepted.merged_at ||
      !accepted.merge_commit_sha ||
      !accepted.merged_by ||
      accepted.merged_by.type === "Bot" ||
      !evidence.files.some((file) =>
        integration.files.some(
          (retained) => retained.filename === file.filename,
        ),
      )
    )
      continue;
    let acknowledged = sameAuthorReopen(evidence, integration);
    for (const comment of evidence.comments) {
      if (
        comment.user?.node_id === accepted.merged_by?.node_id &&
        Date.parse(comment.created_at) >=
          Date.parse(accepted.merged_at as string) &&
        /\b(?:merged?|integrat(?:ed|ion))\b/iu.test(comment.body) &&
        ([...comment.body.matchAll(/\b[a-f0-9]{40}\b/gu)].some(
          ([sha]) => sha === accepted.merge_commit_sha,
        ) ||
          (await hasRetainedMergeReference(evidence, comment, integration)))
      )
        acknowledged = true;
    }
    if (acknowledged) retained.push(source);
  }
  return retained;
}

/** Keep the complete ordered changed lines, including whitespace. Context and
 * hunk offsets may change when other accepted fixes precede a copied commit.
 * This identifies exact retained edits for review, not their semantic value.
 */
export function retainedEditIdentity(file: FileChange): string | null {
  if (
    !hasCompleteValuePatch(file) ||
    file.previous_filename !== undefined ||
    !["added", "modified", "removed"].includes(file.status) ||
    file.additions + valueDeletionCount(file) === 0
  )
    return null;
  return JSON.stringify([
    file.filename,
    file.status,
    valuePatch(file)
      ?.split("\n")
      .filter((line) => /^[+-]/u.test(line)),
  ]);
}

function changedHunks(file: FileChange): string[] | null {
  if (retainedEditIdentity(file) === null) return null;
  const hunks = (valuePatch(file) ?? "")
    .split(/^@@.*@@.*$/mu)
    .map((hunk) => hunk.split("\n").filter((line) => /^[+-]/u.test(line)))
    .filter((lines) => lines.length > 0)
    .map((lines) => JSON.stringify(lines));
  return new Set(hunks).size === hunks.length ? hunks : null;
}

function isAncestor(
  source: WorkUnitSource,
  before: string,
  after: string,
): boolean {
  const commits = new Map(
    source.evidence.commits.map((commit) => [commit.sha, commit]),
  );
  const pending = [after];
  const seen = new Set<string>();
  while (pending.length) {
    const sha = pending.pop();
    if (!sha || seen.has(sha)) continue;
    if (sha === before) return true;
    seen.add(sha);
    for (const parent of commits.get(sha)?.parents ?? [])
      pending.push(parent.sha);
  }
  return false;
}

/** A rebase may omit a hunk already introduced by another accepted fix.
 * Require that exact hunk in an independently captured ancestor commit. This
 * does not match arbitrary subsets, whitespace rewrites or model assertions.
 */
function preexistingHunks(
  original: FileChange,
  copied: FileChange,
  integration: WorkUnitSource,
  acceptedSha: string,
): string[] | null {
  if (
    original.filename !== copied.filename ||
    original.status !== copied.status
  )
    return null;
  const before = changedHunks(original);
  const after = changedHunks(copied);
  if (
    !before ||
    !after?.length ||
    after.length >= before.length ||
    after.some((hunk) => !before.includes(hunk))
  )
    return null;
  const retainedOrder = before.filter((hunk) => after.includes(hunk));
  if (JSON.stringify(retainedOrder) !== JSON.stringify(after)) return null;
  const prior = new Set<string>();
  for (const missing of before.filter((hunk) => !after.includes(hunk))) {
    const matches = integration.evidence.commitAttribution.filter(
      (candidate) =>
        candidate.sha !== acceptedSha &&
        candidate.limitations.length === 0 &&
        isAncestor(integration, candidate.sha, acceptedSha) &&
        candidate.files?.some(
          (file) =>
            file.filename === original.filename &&
            changedHunks(file)?.includes(missing),
        ),
    );
    if (matches.length !== 1) return null;
    prior.add(matches[0].sha);
  }
  return [...prior].sort();
}

export async function retainedCopyBindings(sources: readonly WorkUnitSource[]) {
  const bindings = new Map<
    string,
    {
      original: WorkUnitSource;
      originalCommitSha: string;
      integration: WorkUnitSource;
      acceptedCommitSha: string;
      path: string;
      preexistingCommitShas: string[];
    }
  >();
  const limitations = new Set<string>();
  for (const original of sources) {
    const integrations = await retainedCopySources(original, sources);
    const evidence = original.evidence;
    // An exact edit match plus a GitHub PR relationship is an ownership
    // ambiguity even if the acknowledgement is missing, removed, or forged.
    // It must not fall back to an integration-only award.
    if (evidence.pull.merged_at === null && !evidence.indirectAcceptance) {
      const edits = new Set(
        evidence.commitAttribution.flatMap((commit) =>
          (commit.files ?? [])
            .map(retainedEditIdentity)
            .filter((edit) => edit !== null),
        ),
      );
      const manifestEdits = new Set(
        evidence.commitAttribution.flatMap((attribution) => {
          const commit = evidence.commits.find(
            (c) => c.sha === attribution.sha,
          );
          return commit
            ? (attribution.files ?? [])
                .map((file) => retainedManifestIdentity(file, commit))
                .filter((id) => id !== null)
            : [];
        }),
      );
      for (const candidate of sources) {
        const other = candidate.evidence;
        if (
          integrations.includes(candidate) ||
          !other.pull.merged_at ||
          other.repositoryNodeId !== evidence.repositoryNodeId ||
          !(
            other.relatedPullRequests.some(
              (ref) => ref.id === evidence.pull.node_id,
            ) ||
            evidence.relatedPullRequests.some(
              (ref) => ref.id === other.pull.node_id,
            )
          )
        )
          continue;
        if (
          other.commitAttribution.some((commit) =>
            (commit.files ?? []).some((file) => {
              const edit = retainedEditIdentity(file);
              const known = other.commits.find((c) => c.sha === commit.sha);
              const manifest = known
                ? retainedManifestIdentity(file, known)
                : null;
              if (
                (edit === null || !edits.has(edit)) &&
                (manifest === null || !manifestEdits.has(manifest))
              )
                return false;
              // The same accepted commit can be carried by an intermediate
              // PR and the acknowledged final integration. It is one copy,
              // not another original requiring a separate acknowledgement.
              return !integrations.some(({ evidence: accepted }) =>
                accepted.commitAttribution.some(
                  (retained) =>
                    retained.sha === commit.sha &&
                    retained.limitations.length === 0 &&
                    retained.files?.some((retainedFile) => {
                      const retainedCommit = accepted.commits.find(
                        (c) => c.sha === retained.sha,
                      );
                      return (
                        (edit !== null &&
                          retainedEditIdentity(retainedFile) === edit) ||
                        (manifest !== null &&
                          retainedCommit !== undefined &&
                          retainedManifestIdentity(
                            retainedFile,
                            retainedCommit,
                          ) === manifest)
                      );
                    }),
                ),
              );
            }),
          )
        )
          limitations.add(
            `${evidence.pull.node_id}: matching copied edits require authenticated retention acknowledgement`,
          );
      }
    }
    if (!integrations.length) continue;
    for (const commit of evidence.commits) {
      const attribution = evidence.commitAttribution.find(
        (a) => a.sha === commit.sha,
      );
      if (
        commit.parents.length > 1 ||
        !attribution?.files ||
        attribution.limitations.length ||
        attribution.changedPaths === null ||
        attribution.files.length !== attribution.changedPaths.length ||
        !attribution.files.every((file) =>
          attribution.changedPaths?.includes(file.filename),
        )
      ) {
        limitations.add(
          `${evidence.pull.node_id}: retained commit ${commit.sha} lacks complete file evidence`,
        );
        continue;
      }
      for (const file of attribution.files) {
        const identity = retainedEditIdentity(file);
        const matches = integrations.flatMap((integration) =>
          integration.evidence.commitAttribution.flatMap((accepted) => {
            const known = integration.evidence.commits.find(
              (c) => c.sha === accepted.sha,
            );
            if (
              !known ||
              known.parents.length > 1 ||
              accepted.limitations.length
            )
              return [];
            return (accepted.files ?? []).flatMap((candidate) => {
              if (identity === null) return [];
              const prior =
                retainedEditIdentity(candidate) === identity ||
                (retainedManifestIdentity(file, commit) !== null &&
                  retainedManifestIdentity(file, commit) ===
                    retainedManifestIdentity(candidate, known))
                  ? []
                  : preexistingHunks(
                      file,
                      candidate,
                      integration,
                      accepted.sha,
                    );
              return prior === null
                ? []
                : [
                    {
                      original,
                      originalCommitSha: commit.sha,
                      integration,
                      acceptedCommitSha: accepted.sha,
                      path: file.filename,
                      preexistingCommitShas: prior,
                    },
                  ];
            });
          }),
        );
        if (matches.length !== 1) {
          limitations.add(
            `${evidence.pull.node_id}: retained ${commit.sha}:${file.filename} has ${matches.length} exact copy bindings`,
          );
          continue;
        }
        const match = matches[0];
        if (!match) continue;
        const key = JSON.stringify([
          evidence.repositoryNodeId,
          match.acceptedCommitSha,
          file.filename,
        ]);
        if (bindings.has(key)) {
          limitations.add(
            `${evidence.pull.node_id}: retained copy has competing original sources`,
          );
          continue;
        }
        bindings.set(key, match);
      }
    }
  }
  return { bindings, limitations: [...limitations].sort() };
}
