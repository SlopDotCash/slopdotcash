/** Resolve provisional attribution from the same complete retained-copy proof
 * used by joint value assessment. This does not assess or change work's value.
 */
import {
  implementationCreditActors,
  isCreditEligibleCommitAuthor,
} from "../src/lib/commit-credit";
import { retainedCopyBindings } from "../workers/slopbot/value-retained-copy";
import type { WorkUnitSource } from "../workers/slopbot/value-work-unit-types";

export interface RetainedCommitCreditSource {
  actorNodeId: string;
  originalPullRequestId: string;
  originalPullRequestUrl: string;
  originalCommitSha: string;
}

/** A complete GitHub census can still have unresolved implementation proof.
 * Keep these source-specific limitations distinct from transport or identity
 * failures, which must stop collection rather than produce a partial census.
 */
export class RetainedAttributionIncompleteError extends Error {
  readonly limitations: readonly string[];
  constructor(message: string, limitations: readonly string[] = [message]) {
    super(message);
    this.name = "RetainedAttributionIncompleteError";
    this.limitations = [...limitations];
  }
}

export async function retainedCommitCreditSources(
  accepted: WorkUnitSource,
  sources: readonly WorkUnitSource[],
): Promise<Map<string, RetainedCommitCreditSource>> {
  const resolved = new Map<string, RetainedCommitCreditSource>();
  if (sources.some((source) => source.evidence.limitations.length))
    throw new RetainedAttributionIncompleteError(
      "Retained attribution needs complete source evidence",
      sources.flatMap((source) =>
        source.evidence.limitations.map(
          (limitation) => `#${source.evidence.pull.number}: ${limitation}`,
        ),
      ),
    );
  const retained = await retainedCopyBindings(sources, {
    ordinaryCommitsOnly: true,
  });
  if (retained.limitations.length)
    throw new RetainedAttributionIncompleteError(
      `Retained attribution is unresolved: ${retained.limitations.join("; ")}`,
      retained.limitations,
    );
  for (const commit of accepted.evidence.commits) {
    if (
      commit.parents.length > 1 ||
      isCreditEligibleCommitAuthor(
        commit.author
          ? { id: commit.author.node_id, kind: commit.author.type }
          : null,
      )
    )
      continue;
    const bindings = [...retained.bindings.values()].filter(
      (binding) =>
        binding.integration.evidence.pull.node_id ===
          accepted.evidence.pull.node_id &&
        binding.acceptedCommitSha === commit.sha,
    );
    if (!bindings.length) continue;
    const attribution = accepted.evidence.commitAttribution.filter(
      (entry) => entry.sha === commit.sha,
    );
    const first = bindings[0];
    const original = first.original.evidence;
    const originalCommit = original.commits.find(
      (entry) => entry.sha === first.originalCommitSha,
    );
    if (
      accepted.evidence.limitations.length ||
      original.limitations.length ||
      attribution.length !== 1 ||
      attribution[0].limitations.length ||
      !attribution[0].changedPaths?.length ||
      bindings.length !== attribution[0].changedPaths.length ||
      attribution[0].changedPaths.some(
        (path) => !bindings.some((binding) => binding.path === path),
      ) ||
      bindings.some(
        (binding) =>
          binding.original.evidence.pull.node_id !== original.pull.node_id ||
          binding.originalCommitSha !== first.originalCommitSha,
      ) ||
      !originalCommit ||
      (originalCommit.author?.node_id ?? null) !==
        (commit.author?.node_id ?? null)
    )
      throw new RetainedAttributionIncompleteError(
        "Retained attribution needs complete, unambiguous original commit scope",
      );
    const actors = implementationCreditActors(
      { id: original.pull.user.node_id, kind: original.pull.user.type },
      [
        originalCommit.author
          ? {
              id: originalCommit.author.node_id,
              kind: originalCommit.author.type,
            }
          : null,
      ],
    );
    if (actors.length !== 1)
      throw new RetainedAttributionIncompleteError(
        "Retained attribution has no verified human source creator",
      );
    resolved.set(commit.sha, {
      actorNodeId: actors[0].id,
      originalPullRequestId: original.pull.node_id,
      originalPullRequestUrl: original.pull.html_url,
      originalCommitSha: originalCommit.sha,
    });
  }
  return resolved;
}
