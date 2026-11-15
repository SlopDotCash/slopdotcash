/** Private GitHub evidence for copied contributions. A closure comment is a
 * discovery hint, never sufficient evidence for assigning implementation credit.
 */

import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import {
  githubLinkDestinations,
  sameRepositoryCommitHints,
} from "./value-commit-hints";
import type { FileChange, ValueEvidence } from "./value-evidence-types";
import { retainedManifestIdentity } from "./value-manifest-identity";
import { MERGE_GIT_VERSION } from "./value-merge-profile";
import { mergeResolutionMatches } from "./value-merge-resolution";
import {
  hasCompleteValuePatch,
  valueAdditionCount,
  valueDeletionCount,
  valuePatch,
} from "./value-patch";
import {
  acknowledgementTime,
  hasRetainedMergeReference,
  retainedAcknowledgements,
} from "./value-retained-reference";
import type { WorkUnitSource } from "./value-work-unit-types";
import {
  type CandidateHunkFile,
  type HunkCandidate,
  orderedHunkDifference,
  retainedAncestors,
  uniqueHunkBindings,
} from "./verified-retained-binding";

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
        valueAdditionCount(file),
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

/** A same-author consolidation may retain only part of the original branch.
 * Complete source capture and exact changed lines still bind each retained path.
 * Unlinked commits keep the same authenticated PR author on both sides.
 */
function sameAuthorRetainedSubset(
  original: ValueEvidence,
  accepted: ValueEvidence,
): boolean {
  if (
    original.pull.user.type !== "User" ||
    accepted.pull.user.type !== "User" ||
    original.pull.user.node_id !== accepted.pull.user.node_id ||
    original.pull.number >= accepted.pull.number ||
    original.pull.state !== "closed" ||
    original.pull.merged_at !== null ||
    !original.pull.closed_at ||
    !accepted.pull.merged_at ||
    !(
      Date.parse(original.pull.closed_at) <= Date.parse(accepted.pull.merged_at)
    ) ||
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
  for (const evidence of [original, accepted]) {
    if (
      evidence.commits.length === 0 ||
      evidence.commits.length !== evidence.pull.commits ||
      evidence.commits.at(-1)?.sha !== evidence.pull.head.sha ||
      evidence.commitAttribution.length !== evidence.commits.length ||
      new Set(evidence.commits.map((commit) => commit.sha)).size !==
        evidence.commits.length ||
      !evidence.files.every(hasCompleteValuePatch)
    )
      return false;
    for (const commit of evidence.commits) {
      const entries = evidence.commitAttribution.filter(
        (entry) => entry.sha === commit.sha,
      );
      const entry = entries[0];
      if (
        commit.parents.length !== 1 ||
        entries.length !== 1 ||
        entry.limitations.length ||
        !entry.files ||
        entry.changedPaths === null ||
        entry.files.length !== entry.changedPaths.length ||
        new Set(entry.changedPaths).size !== entry.files.length ||
        !entry.files.every(
          (file) =>
            entry.changedPaths?.includes(file.filename) &&
            hasCompleteValuePatch(file),
        )
      )
        return false;
    }
  }
  return original.commitAttribution.some((entry) => {
    const commit = original.commits.find((item) => item.sha === entry.sha);
    if (!commit) return false;
    return entry.files?.some((file) => {
      const identity = retainedEditIdentity(file);
      if (identity === null) return false;
      return accepted.commitAttribution.some((copy) => {
        const retained = accepted.commits.find((item) => item.sha === copy.sha);
        return (
          (commit.author === null || commit.author.type === "User") &&
          retained !== undefined &&
          (retained.author?.node_id ?? null) ===
            (commit.author?.node_id ?? null) &&
          (retained.author?.type ?? null) === (commit.author?.type ?? null) &&
          copy.files?.some(
            (candidate) => retainedEditIdentity(candidate) === identity,
          )
        );
      });
    });
  });
}

/** A direct PR reference is an acknowledgement only after GitHub resolved the
 * same immutable accepted PR and the merger explicitly says work was retained.
 * Link labels cannot turn a foreign destination into a local PR reference.
 */
function hasRetainedPullReference(
  original: ValueEvidence,
  body: string,
  accepted: ValueEvidence,
  rebase = false,
): boolean {
  const pull = accepted.pull;
  if (
    !original.relatedPullRequests.some(
      (reference) =>
        reference.id === pull.node_id &&
        reference.number === pull.number &&
        reference.url === pull.html_url &&
        reference.repository.toLowerCase() ===
          original.repository.toLowerCase(),
    )
  )
    return false;
  const local = (repository: string, number: number) =>
    repository.toLowerCase() === original.repository.toLowerCase() &&
    number === pull.number;
  // Resolve complete link destinations before splitting sentences: punctuation
  // inside a foreign link label must not expose a local-looking #number.
  const text = githubLinkDestinations(body).replace(
    /\[[^[\]\n]*\](?:\[[^[\]\n]*\])?/gu,
    " ",
  );
  // Sentence punctuation followed by whitespace preserves dots inside URLs.
  return text.split(/(?<=[.!?])(?:\s+|$)|[\r\n]+/u).some((sentence) => {
    const includedFix =
      /\b(?:fix|fixes|correction|corrections)\b[^.!?\r\n]*\b(?:is|are|was|were)\s+included\s+in\b/iu.test(
        sentence,
      ) &&
      !/\b(?:will|would|could|should|may|might|must|if|unless)\b/iu.test(
        sentence,
      ) &&
      !/\bbut\b/iu.test(sentence);
    if (
      (!/\b(?:commits?|changes?|work)\b/iu.test(sentence) && !includedFix) ||
      !(rebase
        ? /\brebased\b/iu.test(sentence) && /\bauthorship\b/iu.test(sentence)
        : includedFix ||
          /\b(?:retained|cherry[ -]picked|carried[ -]over)\b/iu.test(
            sentence,
          )) ||
      /\b(?:not|never|no|neither|without|cannot)\b|\b\p{L}+n['’]t\b/iu.test(
        sentence,
      )
    )
      return false;
    let references = sentence;
    // Any URI owns its whole scope, including its query and fragment. A local
    // #number nested inside a foreign or non-HTTPS URI is never a second hint.
    const urlPattern = /[a-z][a-z0-9+.-]*:\/\/[^\s<>"')\]]+/giu;
    for (const [text] of references.matchAll(urlPattern)) {
      let url: URL;
      try {
        url = new URL(text.replace(/[.,;!?]+$/u, ""));
      } catch {
        continue;
      }
      const path =
        /^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(?:pull|issues)\/([1-9][0-9]*)(?:\/|$)/u.exec(
          url.pathname,
        );
      if (
        url.protocol === "https:" &&
        url.hostname === "github.com" &&
        !url.port &&
        !url.username &&
        !url.password &&
        path &&
        local(path[1], Number(path[2]))
      )
        return true;
    }
    references = references.replace(urlPattern, " ");
    for (const match of references.matchAll(
      /(?<![\w/])(?:(?<![.-])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)[ \t]*)?#([1-9][0-9]*)\b/gu,
    ))
      if (local(match[1] ?? original.repository, Number(match[2]))) return true;
    return false;
  });
}

async function retainedCopySources(
  original: WorkUnitSource,
  sources: readonly WorkUnitSource[],
  octoberOriginalCredit: boolean,
  acceptedSubset = false,
) {
  const evidence = original.evidence;
  const retained: { source: WorkUnitSource; linkedOnly: boolean }[] = [];
  if (evidence.pull.merged_at !== null || evidence.indirectAcceptance)
    return retained;
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
    const octoberReplacement =
      octoberOriginalCredit &&
      accepted.merged_at.startsWith("2026-10-") &&
      evidence.pull.state === "closed" &&
      evidence.pull.number < accepted.number &&
      evidence.pull.user.type === "User" &&
      accepted.merged_by.type === "User" &&
      evidence.pull.user.node_id !== accepted.user.node_id;
    let acknowledged =
      sameAuthorReopen(evidence, integration) ||
      (acceptedSubset && sameAuthorRetainedSubset(evidence, integration));
    for (const comment of retainedAcknowledgements(evidence)) {
      if (
        comment.user?.type !== "Bot" &&
        comment.user?.node_id === accepted.merged_by?.node_id &&
        Date.parse(acknowledgementTime(comment)) >=
          Date.parse(accepted.merged_at as string) &&
        // GitHub numbers PRs in creation order. A lower number proves this
        // PR existed before the accepted PR was opened. A duplicate opened
        // later, even while the accepted PR was under review, is no original.
        evidence.pull.number < accepted.number &&
        ((/\b(?:merged?|integrat(?:ed|ion))\b/iu.test(comment.body) &&
          (sameRepositoryCommitHints(evidence.repository, comment.body).some(
            (sha) => sha.length === 40 && sha === accepted.merge_commit_sha,
          ) ||
            (await hasRetainedMergeReference(
              evidence,
              comment,
              integration,
            )))) ||
          hasRetainedPullReference(evidence, comment.body, integration))
      )
        acknowledged = true;
    }
    if (
      !acknowledged &&
      octoberReplacement &&
      evidence.comments.some(
        (comment) =>
          comment.user?.type !== "Bot" &&
          comment.user?.node_id === accepted.merged_by?.node_id &&
          comment.updated_at === comment.created_at &&
          Date.parse(comment.created_at) <=
            Date.parse(evidence.pull.closed_at ?? "") &&
          Date.parse(comment.created_at) <
            Date.parse(accepted.merged_at ?? "") &&
          hasRetainedPullReference(evidence, comment.body, integration, true),
      )
    )
      acknowledged = true;
    // An outgoing reference only discovers the source. Without an authenticated
    // acknowledgement, both commits must independently name that contributor.
    const linkedOnly =
      !acknowledged &&
      evidence.pull.state === "closed" &&
      evidence.pull.number < accepted.number &&
      evidence.pull.user.type === "User" &&
      evidence.pull.closed_at !== null &&
      Date.parse(evidence.pull.closed_at) <= Date.parse(accepted.merged_at) &&
      evidence.limitations.length === 0 &&
      integration.limitations.length === 0 &&
      integration.relatedPullRequests.some(
        (reference) =>
          reference.id === evidence.pull.node_id &&
          reference.number === evidence.pull.number &&
          reference.url === evidence.pull.html_url &&
          reference.repository.toLowerCase() ===
            evidence.repository.toLowerCase(),
      ) &&
      evidence.commits.some(
        (commit) =>
          commit.parents.length === 1 &&
          commit.author?.type === "User" &&
          commit.author.node_id === evidence.pull.user.node_id &&
          integration.commits.some(
            (copy) =>
              copy.parents.length === 1 &&
              copy.author?.type === "User" &&
              copy.author.node_id === commit.author?.node_id,
          ),
      );
    if (acknowledged || linkedOnly) retained.push({ source, linkedOnly });
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
    valueAdditionCount(file) + valueDeletionCount(file) === 0
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

/** A later source carrying the identical native commit cannot replace its
 * linked author's earlier source PR. Both sources remain in the evidence.
 */
function hasEarlierNativeOriginal(
  source: WorkUnitSource,
  commit: ValueEvidence["commits"][number],
  file: FileChange,
  sources: readonly WorkUnitSource[],
): boolean {
  const evidence = source.evidence;
  if (
    commit.author?.type !== "User" ||
    commit.author.node_id === evidence.pull.user.node_id ||
    commit.parents.length !== 1 ||
    evidence.limitations.length ||
    retainedEditIdentity(file) === null
  )
    return false;
  return sources.some(({ evidence: original }) => {
    const copies = original.commits.filter((item) => item.sha === commit.sha);
    const attribution = original.commitAttribution.filter(
      (item) => item.sha === commit.sha,
    );
    return (
      original.repositoryNodeId === evidence.repositoryNodeId &&
      original.pull.number < evidence.pull.number &&
      original.pull.state === "closed" &&
      original.pull.merged_at === null &&
      original.pull.user.type === "User" &&
      original.pull.user.node_id === commit.author?.node_id &&
      original.limitations.length === 0 &&
      copies.length === 1 &&
      JSON.stringify(copies[0].author) === JSON.stringify(commit.author) &&
      JSON.stringify(copies[0].parents) === JSON.stringify(commit.parents) &&
      attribution.length === 1 &&
      attribution[0].limitations.length === 0 &&
      attribution[0].files?.some(
        (candidate) =>
          retainedEditIdentity(candidate) === retainedEditIdentity(file),
      ) === true &&
      evidence.relatedPullRequests.some(
        (reference) =>
          reference.id === original.pull.node_id &&
          reference.number === original.pull.number &&
          reference.url === original.pull.html_url &&
          reference.repository.toLowerCase() ===
            original.repository.toLowerCase(),
      )
    );
  });
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

/** Preserve captured Map identity (including last-duplicate SHA precedence). */
function capturedParentGraph(integration: WorkUnitSource, acceptedSha: string) {
  const commits = new Map(
    integration.evidence.commits.map((commit) => [commit.sha, commit]),
  );
  const indices = new Map<string, number>();
  const include = (sha: string) => {
    // The original traversal skips an empty pending SHA before comparing it.
    if (sha && !indices.has(sha)) indices.set(sha, indices.size);
  };
  include(acceptedSha);
  for (const [sha, commit] of commits) {
    include(sha);
    for (const parent of commit.parents) include(parent.sha);
  }
  for (const candidate of integration.evidence.commitAttribution)
    include(candidate.sha);
  const graph: number[][] = Array.from({ length: indices.size }, () => []);
  for (const [sha, commit] of commits) {
    const index = indices.get(sha);
    if (index === undefined) continue;
    for (const parent of commit.parents) {
      const next = indices.get(parent.sha);
      if (next !== undefined) graph[index].push(next);
    }
  }
  return { graph, indices, start: indices.get(acceptedSha) ?? -1 };
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
  if (before === null || after === null) return null;
  const difference = orderedHunkDifference(before, after);
  if (difference.kind === "invalid") return null;
  const { graph, indices, start } = capturedParentGraph(
    integration,
    acceptedSha,
  );
  const ancestors = retainedAncestors(graph, start);
  const candidates: HunkCandidate[] =
    integration.evidence.commitAttribution.map((candidate) => {
      const vertex = indices.get(candidate.sha) ?? -1;
      const files: CandidateHunkFile[] = [];
      if (
        candidate.sha !== acceptedSha &&
        candidate.limitations.length === 0 &&
        vertex >= 0 &&
        ancestors[vertex]
      ) {
        for (const file of candidate.files ?? []) {
          if (file.filename !== original.filename) continue;
          const hunks = changedHunks(file);
          files.push({
            path: file.filename,
            hunks:
              hunks === null
                ? { kind: "unavailable" }
                : { kind: "parsed", values: hunks },
          });
        }
      }
      return {
        sha: candidate.sha,
        vertex,
        limitations: candidate.limitations.length,
        files,
      };
    });
  const bindings = uniqueHunkBindings(
    graph,
    start,
    acceptedSha,
    original.filename,
    before,
    difference.missing,
    candidates,
  );
  if (bindings.kind === "ambiguous") return null;
  return [
    ...new Set(bindings.candidates.map((index) => candidates[index].sha)),
  ].sort();
}

/** A closed promotion can contain only squash commits already accepted from
 * this same author. Their original PRs remain the credit authority; carrying
 * those immutable commits is not a new claim to copied implementation work.
 */
function alreadyAcceptedPromotion(
  original: WorkUnitSource,
  sources: readonly WorkUnitSource[],
): boolean {
  const evidence = original.evidence;
  const closedAt = Date.parse(evidence.pull.closed_at ?? "");
  if (
    evidence.pull.merged_at !== null ||
    evidence.indirectAcceptance ||
    evidence.pull.user.type !== "User" ||
    evidence.limitations.length ||
    !Number.isFinite(closedAt) ||
    !evidence.commits.length ||
    new Set(evidence.commits.map((commit) => commit.sha)).size !==
      evidence.commits.length ||
    evidence.commits.length !== evidence.pull.commits ||
    evidence.commitAttribution.length !== evidence.commits.length ||
    evidence.commits.at(-1)?.sha !== evidence.pull.head.sha
  )
    return false;

  const edits = (files: readonly FileChange[]) => {
    if (
      !files.length ||
      new Set(files.map((file) => file.filename)).size !== files.length
    )
      return null;
    const identities = files.map(retainedEditIdentity);
    return identities.includes(null) ? null : JSON.stringify(identities.sort());
  };
  return evidence.commits.every((commit) => {
    const attribution = evidence.commitAttribution.filter(
      (entry) => entry.sha === commit.sha,
    );
    if (
      commit.parents.length !== 1 ||
      attribution.length !== 1 ||
      attribution[0].limitations.length ||
      !attribution[0].files ||
      !attribution[0].changedPaths ||
      attribution[0].changedPaths.length !== attribution[0].files.length ||
      !attribution[0].files.every((file) =>
        attribution[0].changedPaths?.includes(file.filename),
      )
    )
      return false;
    const identity = edits(attribution[0].files);
    if (identity === null) return false;
    const accepted = sources.filter(({ evidence: prior }) => {
      const mergedAt = Date.parse(prior.pull.merged_at ?? "");
      const merge = prior.mergeCommitEvidence;
      return (
        prior.pull.node_id !== evidence.pull.node_id &&
        prior.repositoryNodeId === evidence.repositoryNodeId &&
        prior.pull.user.type === "User" &&
        prior.pull.user.node_id === evidence.pull.user.node_id &&
        prior.limitations.length === 0 &&
        Number.isFinite(mergedAt) &&
        mergedAt < closedAt &&
        prior.pull.merge_commit_sha === commit.sha &&
        merge?.sha === commit.sha &&
        merge.parents.length === 1 &&
        edits(merge.files) === identity &&
        edits(prior.files) === identity
      );
    });
    return accepted.length === 1;
  });
}

/** A closed branch whose complete implementation is already present by SHA
 * keeps ordinary Git attribution. It needs no inferred copied-edit identity.
 */
function alreadyAcceptedNative(
  original: WorkUnitSource,
  sources: readonly WorkUnitSource[],
): boolean {
  const evidence = original.evidence;
  if (
    evidence.pull.state !== "closed" ||
    evidence.pull.merged_at !== null ||
    evidence.indirectAcceptance ||
    evidence.limitations.length ||
    evidence.commits.length === 0 ||
    new Set(evidence.commits.map((commit) => commit.sha)).size !==
      evidence.commits.length ||
    evidence.commits.length !== evidence.pull.commits ||
    evidence.commitAttribution.length !== evidence.commits.length ||
    evidence.commits.at(-1)?.sha !== evidence.pull.head.sha ||
    evidence.commits.some((commit) => commit.parents.length !== 1)
  )
    return false;
  return sources.some(({ evidence: accepted }) => {
    if (
      accepted.repositoryNodeId !== evidence.repositoryNodeId ||
      accepted.pull.number <= evidence.pull.number ||
      !accepted.pull.merged_at ||
      accepted.limitations.length ||
      !Number.isFinite(Date.parse(accepted.pull.merged_at))
    )
      return false;
    return evidence.commits.every((commit) => {
      const originalPaths = evidence.commitAttribution.filter(
        (entry) => entry.sha === commit.sha,
      );
      const copies = accepted.commits.filter(
        (entry) => entry.sha === commit.sha,
      );
      const acceptedPaths = accepted.commitAttribution.filter(
        (entry) => entry.sha === commit.sha,
      );
      return (
        copies.length === 1 &&
        JSON.stringify(copies[0].parents) === JSON.stringify(commit.parents) &&
        JSON.stringify(copies[0].author) === JSON.stringify(commit.author) &&
        commit.author?.type === "User" &&
        originalPaths.length === 1 &&
        acceptedPaths.length === 1 &&
        originalPaths[0].limitations.length === 0 &&
        acceptedPaths[0].limitations.length === 0 &&
        originalPaths[0].changedPaths !== null &&
        originalPaths[0].files?.length ===
          originalPaths[0].changedPaths.length &&
        originalPaths[0].files.every((file) =>
          originalPaths[0].changedPaths?.includes(file.filename),
        ) &&
        JSON.stringify(originalPaths[0]) === JSON.stringify(acceptedPaths[0])
      );
    });
  });
}

/** A rejected later duplicate remains contextual evidence. Every changed line
 * must already be a native original commit in the named accepted carrier.
 * This creates no copy binding and never changes an implementation recipient.
 */
function rejectedDuplicateContext(
  duplicate: WorkUnitSource,
  sources: readonly WorkUnitSource[],
): boolean {
  const evidence = duplicate.evidence;
  const closedAt = Date.parse(evidence.pull.closed_at ?? "");
  if (
    evidence.pull.state !== "closed" ||
    evidence.pull.merged_at !== null ||
    evidence.indirectAcceptance ||
    evidence.limitations.length ||
    !Number.isFinite(closedAt) ||
    evidence.pull.user.type !== "User" ||
    !evidence.commits.length ||
    evidence.commits.length !== evidence.pull.commits ||
    evidence.commitAttribution.length !== evidence.commits.length ||
    new Set(evidence.commits.map((commit) => commit.sha)).size !==
      evidence.commits.length ||
    evidence.commits.at(-1)?.sha !== evidence.pull.head.sha ||
    !evidence.files.length
  )
    return false;
  const edits = evidence.files.map(retainedEditIdentity);
  if (edits.includes(null) || new Set(edits).size !== edits.length)
    return false;
  const complete = evidence.commits.every((commit, index) => {
    const entries = evidence.commitAttribution.filter(
      (entry) => entry.sha === commit.sha,
    );
    const entry = entries[0];
    return (
      commit.parents.length === 1 &&
      (index === 0 ||
        commit.parents[0].sha === evidence.commits[index - 1].sha) &&
      entries.length === 1 &&
      entry.limitations.length === 0 &&
      !!entry.files?.length &&
      entry.files.length === entry.changedPaths?.length &&
      entry.files.every(
        (file) =>
          entry.changedPaths?.includes(file.filename) &&
          edits.includes(retainedEditIdentity(file)),
      )
    );
  });
  const commitEdits = evidence.commitAttribution.flatMap((entry) =>
    (entry.files ?? []).map(retainedEditIdentity),
  );
  const firstChangedAt = Math.min(
    ...evidence.commits.map((commit) => Date.parse(commit.commit.author.date)),
  );
  if (
    !complete ||
    !Number.isFinite(firstChangedAt) ||
    firstChangedAt > closedAt ||
    !edits.every(
      (edit) => commitEdits.filter((value) => value === edit).length === 1,
    )
  )
    return false;
  const related = (number: number) =>
    sources.filter(
      ({ evidence: candidate }) =>
        candidate.repositoryNodeId === evidence.repositoryNodeId &&
        candidate.pull.number === number &&
        candidate.limitations.length === 0 &&
        evidence.relatedPullRequests.some(
          (ref) =>
            ref.number === number &&
            ref.id === candidate.pull.node_id &&
            ref.url === candidate.pull.html_url &&
            ref.repository.toLowerCase() === evidence.repository.toLowerCase(),
        ),
    );
  for (const comment of evidence.comments) {
    const time = Date.parse(comment.created_at);
    // Match the affirmative closure statement itself, never a quoted link,
    // hypothetical action, edited text or an unrelated commenter's assertion.
    const statement =
      /^closing as a duplicate of #([1-9][0-9]*), incorporated in #([1-9][0-9]*)\.(?:\s|$)/iu.exec(
        comment.body,
      );
    if (
      !statement ||
      comment.user?.type !== "User" ||
      comment.updated_at !== comment.created_at ||
      !Number.isFinite(time) ||
      time > closedAt
    )
      continue;
    const originals = related(Number(statement[1]));
    const carriers = related(Number(statement[2]));
    if (originals.length !== 1 || carriers.length !== 1) continue;
    const original = originals[0].evidence;
    const carrier = carriers[0].evidence;
    const merge = carrier.mergeCommitEvidence;
    if (
      original.pull.number >= evidence.pull.number ||
      original.pull.user.type !== "User" ||
      original.pull.user.node_id === evidence.pull.user.node_id ||
      original.commits.length !== original.pull.commits ||
      original.commits.at(-1)?.sha !== original.pull.head.sha ||
      new Set(original.commits.map((commit) => commit.sha)).size !==
        original.commits.length ||
      original.commitAttribution.length !== original.commits.length ||
      !edits.every((edit) =>
        original.files.some((file) => retainedEditIdentity(file) === edit),
      ) ||
      !edits.every((edit) =>
        carrier.files.some((file) => retainedEditIdentity(file) === edit),
      ) ||
      carrier.pull.number >= evidence.pull.number ||
      carrier.pull.state !== "closed" ||
      carrier.acceptedRange !== undefined ||
      carrier.indirectAcceptance !== undefined ||
      carrier.pull.merged_by?.node_id !== comment.user.node_id ||
      carrier.pull.merged_by.type !== "User" ||
      !Number.isFinite(Date.parse(carrier.pull.merged_at ?? "")) ||
      !merge ||
      merge.sha !== carrier.pull.merge_commit_sha ||
      !merge.parents.some((parent) => parent.sha === carrier.pull.head.sha) ||
      carrier.commits.length !== carrier.pull.commits ||
      carrier.commits.at(-1)?.sha !== carrier.pull.head.sha
    )
      continue;
    const commits = new Map(
      carrier.commits.map((commit) => [commit.sha, commit]),
    );
    const order = new Map(
      carrier.commits.map((commit, index) => [commit.sha, index]),
    );
    if (
      commits.size !== carrier.commits.length ||
      carrier.commits.some((commit, index) =>
        commit.parents.some((parent) => (order.get(parent.sha) ?? -1) >= index),
      )
    )
      continue;
    const ancestors = new Set<string>();
    const pending = [carrier.pull.head.sha];
    while (pending.length) {
      const sha = pending.pop();
      if (sha === undefined || ancestors.has(sha)) continue;
      ancestors.add(sha);
      for (const parent of commits.get(sha)?.parents ?? [])
        pending.push(parent.sha);
    }
    const originalEdits = original.commitAttribution.flatMap((entry) => {
      const commit = original.commits.find((item) => item.sha === entry.sha);
      const copies = carrier.commits.filter((item) => item.sha === entry.sha);
      const accepted = carrier.commitAttribution.filter(
        (item) => item.sha === entry.sha,
      );
      if (
        commit?.parents.length !== 1 ||
        commit.author?.type !== "User" ||
        commit.author.node_id !== original.pull.user.node_id ||
        !(Date.parse(commit.commit.author.date) < firstChangedAt) ||
        !ancestors.has(commit.sha) ||
        copies.length !== 1 ||
        JSON.stringify(copies[0]) !== JSON.stringify(commit) ||
        accepted.length !== 1 ||
        JSON.stringify(accepted[0]) !== JSON.stringify(entry) ||
        entry.limitations.length ||
        !entry.files?.length ||
        entry.changedPaths?.length !== entry.files.length ||
        !entry.files.every((file) =>
          entry.changedPaths?.includes(file.filename),
        )
      )
        return [];
      return entry.files.map(retainedEditIdentity);
    });
    if (
      edits.every(
        (edit) => originalEdits.filter((value) => value === edit).length === 1,
      )
    )
      return true;
  }
  return false;
}

/** A narrow conflict-copy proof. Full-index canonical patches identify each
 * resolved blob. A shared first parent preserves the original implementation
 * antecedent while the second parent may be a newer integration branch.
 */
async function retainedResolutionSignature(
  source: WorkUnitSource,
  resolution: NonNullable<ValueEvidence["mergeResolutions"]>[number],
): Promise<string | null> {
  const commit = source.evidence.commits.find(
    (entry) => entry.sha === resolution.commitSha,
  );
  if (
    !commit ||
    !mergeResolutionMatches(resolution, commit) ||
    resolution.gitVersion !== MERGE_GIT_VERSION ||
    !resolution.hadConflicts ||
    !source.evidence.commits.some(
      (entry) => entry.sha === commit.parents[0].sha,
    ) ||
    resolution.paths.length === 0 ||
    (await sha256Hex(resolution.patch)) !== resolution.patchSha256
  )
    return null;
  const files = resolution.patch.split(/^diff --git /mu).slice(1);
  if (files.length !== resolution.paths.length) return null;
  const identities: string[] = [];
  const paths = new Set<string>();
  for (const file of files) {
    const match =
      /^a\/(.+) b\/\1\nindex [a-f0-9]{40}\.\.([a-f0-9]{40}) (100644|100755)\n--- a\/\1\n\+\+\+ b\/\1\n/u.exec(
        file,
      );
    if (!match || !resolution.paths.includes(match[1]) || paths.has(match[1]))
      return null;
    paths.add(match[1]);
    identities.push(JSON.stringify([match[1], match[2], match[3]]));
  }
  if (new Set(identities).size !== resolution.paths.length) return null;
  return JSON.stringify([commit.parents[0].sha, identities.sort()]);
}

export async function retainedCopyBindings(
  sources: readonly WorkUnitSource[],
  options: {
    ordinaryCommitsOnly?: boolean;
    octoberOriginalCredit?: boolean;
    acceptedSubset?: boolean;
  } = {},
) {
  const bindings = new Map<
    string,
    {
      original: WorkUnitSource;
      originalCommitSha: string;
      integration: WorkUnitSource;
      acceptedCommitSha: string;
      path: string;
      preexistingCommitShas: string[];
      mergeResolution?: true;
    }
  >();
  const limitations = new Set<string>();
  for (const original of sources) {
    if (
      options.acceptedSubset &&
      (alreadyAcceptedNative(original, sources) ||
        rejectedDuplicateContext(original, sources))
    )
      continue;
    const integrations = await retainedCopySources(
      original,
      sources,
      options.octoberOriginalCredit === true,
      options.acceptedSubset === true,
    );
    if (!integrations.length && alreadyAcceptedPromotion(original, sources))
      continue;
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
          integrations.some(({ source }) => source === candidate) ||
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
              return !integrations.some(({ source: { evidence: accepted } }) =>
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
    let exactPaths = 0;
    const unmatched: string[] = [];
    for (const commit of evidence.commits) {
      // Provisional recipient lookup asks only about copied ordinary commits.
      // A source's branch-sync merge is not one of those implementation claims.
      // Full joint preparation retains its existing merge-resolution gate.
      if (options.ordinaryCommitsOnly && commit.parents.length > 1) continue;
      if (commit.parents.length > 1) {
        const resolutions = (evidence.mergeResolutions ?? []).filter(
          (resolution) => resolution.commitSha === commit.sha,
        );
        const resolution = resolutions[0];
        if (
          resolutions.length !== 1 ||
          !mergeResolutionMatches(resolution, commit) ||
          resolution.gitVersion !== MERGE_GIT_VERSION ||
          (await sha256Hex(resolution.patch)) !== resolution.patchSha256
        ) {
          limitations.add(
            `${evidence.pull.node_id}: retained merge ${commit.sha} needs complete canonical resolution evidence`,
          );
        } else if (resolution.hadConflicts || resolution.paths.length > 0) {
          const signature = await retainedResolutionSignature(
            original,
            resolution,
          );
          const matches = [];
          for (const { source: integration } of integrations) {
            for (const candidate of integration.evidence.mergeResolutions ??
              []) {
              const acceptedCommit = integration.evidence.commits.find(
                (entry) => entry.sha === candidate.commitSha,
              );
              if (
                signature !== null &&
                acceptedCommit !== undefined &&
                Date.parse(commit.commit.author.date) <=
                  Date.parse(acceptedCommit.commit.author.date) &&
                Date.parse(acceptedCommit.commit.author.date) <=
                  Date.parse(integration.evidence.pull.merged_at ?? "") &&
                signature ===
                  (await retainedResolutionSignature(integration, candidate))
              )
                matches.push({ integration, candidate });
            }
          }
          if (matches.length !== 1) {
            limitations.add(
              `${evidence.pull.node_id}: retained merge ${commit.sha} has ${matches.length} exact resolution bindings`,
            );
          } else {
            const { integration, candidate } = matches[0];
            for (const path of resolution.paths) {
              const key = JSON.stringify([
                evidence.repositoryNodeId,
                candidate.commitSha,
                path,
              ]);
              if (bindings.has(key)) {
                limitations.add(
                  `${evidence.pull.node_id}: retained copy has competing original sources`,
                );
              } else
                bindings.set(key, {
                  original,
                  originalCommitSha: commit.sha,
                  integration,
                  acceptedCommitSha: candidate.commitSha,
                  path,
                  preexistingCommitShas: [],
                  mergeResolution: true,
                });
            }
          }
        }
        // Empty resolutions prove synchronization alone. Nonempty resolutions
        // require the unique retained-copy binding above. Incoming parent
        // changes never become original implementation claims.
        continue;
      }
      const attribution = evidence.commitAttribution.find(
        (a) => a.sha === commit.sha,
      );
      if (
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
        const matches = integrations.flatMap(
          ({ source: integration, linkedOnly }) =>
            integration.evidence.commitAttribution.flatMap((accepted) => {
              const known = integration.evidence.commits.find(
                (c) => c.sha === accepted.sha,
              );
              if (
                !known ||
                known.parents.length > 1 ||
                accepted.limitations.length ||
                (linkedOnly &&
                  (commit.author?.type !== "User" ||
                    known.author?.type !== "User" ||
                    commit.author.node_id !== evidence.pull.user.node_id ||
                    known.author.node_id !== evidence.pull.user.node_id))
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
        // October requires a full accepted anchor commit, while rebasing can
        // legitimately alter other original paths. Ambiguity still fails closed.
        if (!matches.length && options.octoberOriginalCredit) continue;
        // Keep unmatched paths in the complete source evidence. Joint claims
        // include only exact accepted copies once this original has an anchor.
        if (!matches.length && options.acceptedSubset) {
          unmatched.push(
            `${evidence.pull.node_id}: retained ${commit.sha}:${file.filename} has 0 exact copy bindings`,
          );
          continue;
        }
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
        const previous = bindings.get(key);
        if (previous) {
          // Resolve only two independently verified bindings of the identical
          // native original. An earlier source which failed its own binding
          // must not suppress an otherwise valid later source.
          if (
            previous.originalCommitSha === match.originalCommitSha &&
            JSON.stringify(previous.preexistingCommitShas) ===
              JSON.stringify(match.preexistingCommitShas)
          ) {
            if (
              hasEarlierNativeOriginal(original, commit, file, [
                previous.original,
              ])
            )
              continue;
            const previousCommit = previous.original.evidence.commits.find(
              (item) => item.sha === previous.originalCommitSha,
            );
            const previousFile = previous.original.evidence.commitAttribution
              .find((item) => item.sha === previous.originalCommitSha)
              ?.files?.find((item) => item.filename === previous.path);
            if (
              previousCommit &&
              previousFile &&
              hasEarlierNativeOriginal(
                previous.original,
                previousCommit,
                previousFile,
                [original],
              )
            ) {
              bindings.set(key, match);
              exactPaths++;
              continue;
            }
          }
          limitations.add(
            `${evidence.pull.node_id}: retained copy has competing original sources`,
          );
          continue;
        }
        bindings.set(key, match);
        exactPaths++;
      }
    }
    if (options.acceptedSubset && exactPaths === 0)
      for (const limitation of unmatched) limitations.add(limitation);
  }
  return { bindings, limitations: [...limitations].sort() };
}
