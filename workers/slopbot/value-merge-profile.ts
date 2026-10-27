/** A server-created collection recipe, not uploaded resolution evidence. */
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import type { ValueEvidence } from "./value-evidence";
import type { ValueMergeResolution } from "./value-merge-resolution";

export const MERGE_GIT_VERSION = "git version 2.56.0" as const;
export const MERGE_PROFILE = "git-2.56.0-v1" as const;
export interface ValueMergeRecipe {
  profile: typeof MERGE_PROFILE;
  inputSha256: string;
}

/** Exactly the authoritative inputs read by the canonical Git collector. */
export function mergeInput(evidence: ValueEvidence) {
  return {
    repository: evidence.repository,
    repositoryNodeId: evidence.repositoryNodeId,
    repositoryDatabaseId: evidence.repositoryDatabaseId,
    pull: { head: { sha: evidence.pull.head.sha } },
    files: evidence.files.map(({ filename }) => ({ filename })),
    commits: evidence.commits.map(({ sha, parents }) => ({
      sha,
      parents: parents.map(({ sha }) => ({ sha })),
    })),
    commitAttribution: evidence.commitAttribution.map(
      ({ sha, changedPaths, limitations }) => ({
        sha,
        changedPaths,
        limitations,
      }),
    ),
  };
}
export type ValueMergeInput = ReturnType<typeof mergeInput>;
export interface ValueMergeVerifier {
  reconstruct(
    inputs: ValueMergeInput[],
    bundle: ReadableStream<Uint8Array>,
  ): Promise<
    {
      inputSha256: string;
      mergeResolutions: ValueMergeResolution[];
    }[]
  >;
}
export function validMergeRecipe(value: unknown): value is ValueMergeRecipe {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const recipe = value as Record<string, unknown>;
  return (
    Object.keys(recipe).sort().join() === "inputSha256,profile" &&
    recipe.profile === MERGE_PROFILE &&
    typeof recipe.inputSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(recipe.inputSha256)
  );
}
export async function mergeRecipe(
  evidence: ValueEvidence,
): Promise<ValueMergeRecipe> {
  return {
    profile: MERGE_PROFILE,
    inputSha256: await sha256Hex(JSON.stringify(mergeInput(evidence))),
  };
}

/** Final recollection still checks all mutable source/policy bytes. This only
 * reuses an invocation's verified Git result when every Git input is unchanged.
 */
export async function reuseMergeResolution(
  current: ValueEvidence,
  original: ValueEvidence,
  recipe: ValueMergeRecipe,
): Promise<ValueEvidence> {
  if (
    !validMergeRecipe(recipe) ||
    (await mergeRecipe(current)).inputSha256 !== recipe.inputSha256 ||
    (await mergeRecipe(original)).inputSha256 !== recipe.inputSha256 ||
    !Array.isArray(original.mergeResolutions)
  )
    throw new Error("Merge reconstruction inputs changed after assessment");
  return { ...current, mergeResolutions: original.mergeResolutions };
}
