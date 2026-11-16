import { validRepositoryPath } from "../../src/lib/project-contracts";
import {
  collectTargetRepositories,
  type TargetRepository,
} from "../../src/lib/repositories.mjs";
import { GitHubClient } from "./github";
import { registeredProject } from "./registry";
import type { ReviewEnv } from "./review";
import { publicationCommitPages } from "./value-commit-pages";
import {
  collectValueContext,
  validValueContextSelections,
} from "./value-context";
import { collectValueEvidence, findRepository } from "./value-evidence";
import {
  type ValueFileRecovery,
  type ValueFileRequest,
  valueFileRecoveryCapture,
  verifiedValueFileClient,
} from "./value-file-recovery";
import { mergeInput, mergeRecipe } from "./value-merge-profile";
import {
  isSubscriptionProvenance,
  valueResultProducerIdentity,
} from "./value-producer";
import {
  assertValueInstallation,
  assertValueInstallationRepositories,
  loadValuePolicy,
  publishValueAssessment,
} from "./value-publication";
import type { ValueAssessmentResult } from "./value-review";
import {
  historicalSubscriptionSource,
  historicalSubscriptionWorkUnit,
  subscriptionCutoff,
  type ValueSettingsEnv,
} from "./value-settings";
import { prepareWorkUnitEvidence } from "./value-work-unit";
import { publishWorkUnitAssessment } from "./value-work-unit-publication";
import type { WorkUnitAssessmentResult } from "./value-work-unit-review";
import type { WorkUnitSource } from "./value-work-unit-types";

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const digests = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every(digest) &&
  new Set(value).size === value.length;

/** Only the private service binding calls this function. Publication identity
 * comes from the deployed release, not the uploaded assessment or a local tree.
 * The existing publishers re-read GitHub and enforce journal predecessors.
 */
export async function importSubscriptionAssessment(
  env: ReviewEnv & ValueSettingsEnv & { SLOPBOT_PRODUCER_REVISION?: string },
  input: unknown,
  bundle?: ReadableStream<Uint8Array>,
) {
  const revision = env.SLOPBOT_PRODUCER_REVISION;
  if (!revision || !/^[a-f0-9]{40}$/u.test(revision))
    throw new Error("Historical intake requires a deployed producer revision");
  if (
    !object(input) ||
    !["single", "work-unit"].includes(String(input.mode)) ||
    !Number.isSafeInteger(input.installationId) ||
    Number(input.installationId) <= 0 ||
    !object(input.result) ||
    !Array.isArray(input.sources) ||
    input.sources.length === 0 ||
    !(
      input.revisionReason === null ||
      (typeof input.revisionReason === "string" &&
        input.revisionReason.trim().length > 0)
    )
  )
    throw new Error("Invalid historical assessment envelope");
  const expected =
    input.mode === "single"
      ? "installationId,mode,result,revisionReason,sources,supersedes"
      : "installationId,legacyPredecessors,mode,result,revisionReason,sources,supersedes";
  if (Object.keys(input).sort().join() !== expected)
    throw new Error("Unexpected historical assessment fields");
  if (!isSubscriptionProvenance(input.result.provenance))
    throw new Error("Historical intake accepts subscription assessments only");
  valueResultProducerIdentity(input.result as unknown as ValueAssessmentResult);
  const joint = input.mode === "work-unit";
  if (bundle && (!joint || !env.VALUE_MERGE_VERIFIER))
    throw new Error("Joint merge reconstruction is unavailable");
  if (!joint && input.sources.length !== 1)
    throw new Error("Single publication requires one source");
  const selections = input.sources.map((value: unknown) => {
    if (
      !object(value) ||
      ![
        "contextPaths,pullRequestNumber,repository",
        "contextPaths,emptyMergeResolutions,pullRequestNumber,repository",
      ].includes(Object.keys(value).sort().join()) ||
      ("emptyMergeResolutions" in value &&
        value.emptyMergeResolutions !== true) ||
      typeof value.repository !== "string" ||
      !validRepositoryPath(value.repository) ||
      !Number.isSafeInteger(value.pullRequestNumber) ||
      Number(value.pullRequestNumber) <= 0 ||
      !validValueContextSelections(value.contextPaths)
    )
      throw new Error("Invalid historical source selection");
    return {
      repository: value.repository,
      number: Number(value.pullRequestNumber),
      contextPaths: value.contextPaths,
      emptyMergeResolutions: value.emptyMergeResolutions === true,
    };
  });
  if (
    new Set(selections.map((s) => `${s.repository.toLowerCase()}#${s.number}`))
      .size !== selections.length
  )
    throw new Error("Historical source selection is repeated");
  await assertValueInstallation(env.SLOPBOT_DB, Number(input.installationId));
  const commitPages = publicationCommitPages();
  const github = commitPages(
    await GitHubClient.forInstallation(
      env.SLOPBOT_APP_ID,
      env.SLOPBOT_APP_PRIVATE_KEY,
      Number(input.installationId),
    ),
  );
  const capture = valueFileRecoveryCapture(github);
  let verifiedFiles:
    | {
        requests: ValueFileRequest[];
        recovery: ValueFileRecovery;
        internText?: (text: string) => string;
      }
    | undefined;
  const sources: WorkUnitSource[] = [];
  const repositories: TargetRepository[] = [];
  for (const selection of selections) {
    const identity = await github.get<{
      id: number;
      node_id: string;
      private: boolean;
    }>(`/repos/${selection.repository}`);
    if (identity?.private !== false)
      throw new Error("Historical repository is unavailable");
    const [registryOwner, registryRepo] = selection.repository.split("/");
    const project = await registeredProject(env.SLOPBOT_DB, {
      owner: registryOwner,
      repo: registryRepo,
      repositoryId: identity.id,
    });
    const repository =
      project &&
      findRepository(
        collectTargetRepositories([project]),
        selection.repository,
      );
    if (!repository) throw new Error("Historical source is not registered");
    repositories.push(repository);
    await assertValueInstallationRepositories(github, [
      { repositoryDatabaseId: identity.id, repositoryNodeId: identity.node_id },
    ]);
    const collected = await collectValueEvidence(
      capture.client,
      repository.id,
      selection.number,
      repository,
    );
    if (
      !historicalSubscriptionSource(collected.pull, subscriptionCutoff(env)) &&
      !(
        joint &&
        collected.pull.state === "closed" &&
        collected.pull.merged_at === null
      )
    )
      throw new Error(
        "Subscription intake covers only work accepted before the API start",
      );
    const evidence = await collectValueContext(
      github,
      collected,
      selection.contextPaths,
    );
    if (selection.emptyMergeResolutions) {
      if (evidence.commits.some((commit) => commit.parents.length === 2))
        throw new Error("Empty merge evidence requires no two-parent merges");
      evidence.mergeResolutions = [];
    }
    const [owner, repo] = repository.id.split("/");
    sources.push({
      evidence,
      policy: await loadValuePolicy(
        github,
        owner,
        repo,
        evidence.pull.base.sha,
      ),
    });
  }
  if (bundle) {
    if (
      new Set(sources.map(({ evidence }) => evidence.repositoryNodeId)).size !==
      1
    )
      throw new Error("A Git bundle must bind one public repository");
    const verifier = env.VALUE_MERGE_VERIFIER;
    if (!verifier) throw new Error("Merge reconstruction is unavailable");
    const inputs = sources.map(({ evidence }) => mergeInput(evidence));
    const requests = capture.requests(sources.map(({ evidence }) => evidence));
    let reconstructed: Awaited<
      ReturnType<NonNullable<typeof verifier>["reconstruct"]>
    >;
    if (verifier.recover) {
      const [filesBundle, mergeBundle] = bundle.tee();
      const recovered = await verifier.recover(inputs, requests, filesBundle);
      verifiedFiles = { requests, recovery: recovered };
      const complete = await verifiedValueFileClient(
        github,
        requests,
        recovered,
      );
      verifiedFiles.internText = complete.internText;
      const fresh = valueFileRecoveryCapture(complete);
      for (const [index, selection] of selections.entries()) {
        const recollected = await collectValueEvidence(
          fresh.client,
          repositories[index].id,
          selection.number,
          repositories[index],
        );
        const currentInput = mergeInput(recollected);
        if (
          JSON.stringify({ ...currentInput, commitAttribution: [] }) !==
          JSON.stringify({ ...inputs[index], commitAttribution: [] })
        )
          throw new Error("File recovery source identity changed");
        sources[index].evidence = await collectValueContext(
          complete,
          recollected,
          selection.contextPaths,
        );
      }
      for (const [path, signature] of capture.metadata)
        if (fresh.metadata.get(path) !== signature)
          throw new Error("Recovery source metadata changed");
      reconstructed = await verifier.reconstruct(
        sources.map(({ evidence }) => mergeInput(evidence)),
        mergeBundle,
      );
    } else {
      reconstructed = await verifier.reconstruct(inputs, bundle);
    }
    if (reconstructed.length !== sources.length)
      throw new Error("Incomplete merge reconstruction");
    for (const [index, source] of sources.entries()) {
      const recipe = await mergeRecipe(source.evidence);
      const resolved = reconstructed[index];
      if (
        resolved.inputSha256 !== recipe.inputSha256 ||
        !Array.isArray(resolved.mergeResolutions)
      )
        throw new Error("Merge reconstruction identity mismatch");
      source.evidence = {
        ...source.evidence,
        mergeResolutions: resolved.mergeResolutions,
      };
      source.mergeRecipe = recipe;
    }
  }
  const source = sources[0].evidence;
  const job = {
    installationId: Number(input.installationId),
    repositoryId: source.repositoryDatabaseId,
    owner: repositories[0].owner,
    repo: repositories[0].name,
    number: source.pull.number,
    itemKind: "pull_request" as const,
  };
  let stored: { record_digest: string; sequence: number };
  if (joint) {
    if (!digests(input.supersedes) || !digests(input.legacyPredecessors))
      throw new Error("Invalid joint predecessors");
    const prepared = await prepareWorkUnitEvidence(sources, repositories);
    if (!historicalSubscriptionWorkUnit(prepared, subscriptionCutoff(env)))
      throw new Error(
        "Subscription intake covers only work accepted before the API start",
      );
    stored = await publishWorkUnitAssessment(
      env,
      job,
      input.result as unknown as WorkUnitAssessmentResult,
      prepared,
      revision,
      input.supersedes,
      input.legacyPredecessors,
      input.revisionReason as string | null,
      undefined,
      verifiedFiles,
      commitPages,
    );
  } else {
    if (input.supersedes !== null && !digest(input.supersedes))
      throw new Error("Invalid single predecessor");
    stored = await publishValueAssessment(
      env,
      job,
      input.result as unknown as ValueAssessmentResult,
      source,
      revision,
      input.supersedes,
      input.revisionReason as string | null,
      undefined,
      commitPages,
    );
  }
  return { recordDigest: stored.record_digest, sequence: stored.sequence };
}
