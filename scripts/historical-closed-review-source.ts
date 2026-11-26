import { REGISTERED_REPOSITORIES } from "../src/lib/repositories.mjs";
import type { GitHubClient } from "../workers/slopbot/github";
import { valueSourceDigest } from "../workers/slopbot/value-review";
import { prepareWorkUnitEvidence } from "../workers/slopbot/value-work-unit";
import type { WorkUnitRecord } from "../workers/slopbot/value-work-unit-journal";
import type { WorkUnitSource } from "../workers/slopbot/value-work-unit-types";

export function isStandaloneHistoricalReview(record: WorkUnitRecord): boolean {
  const unit = record.units?.[0];
  return (
    record.sources?.length === 1 &&
    record.sources[0].indirectAcceptance === undefined &&
    record.sources[0].mergeRecipe === undefined &&
    Date.parse(record.sources[0].occurredAt) <= Date.parse(record.assessedAt) &&
    record.claims?.length === 0 &&
    record.units?.length === 1 &&
    unit?.claimIds?.length === 0 &&
    unit.assessment?.status === "assessed" &&
    unit.assessment.tier === null &&
    Array.isArray(unit.assessment.reviews) &&
    unit.assessment.reviews.length > 0
  );
}

type PublicReference = {
  __typename: string;
  id: string;
  number: number;
  url: string;
  createdAt: string;
  repository: {
    id: string;
    databaseId: number;
    isPrivate: boolean;
    nameWithOwner: string;
  };
};

const REFERENCE_CREATION_QUERY =
  "query HistoricalReferenceCreation($id:ID!){node(id:$id){__typename ... on PullRequest{id number url createdAt repository{id databaseId isPrivate nameWithOwner}}}}";

/** The trusted collector admits a single late same-repository relation, and
 * only if subtracting it restores the exact old source and work-unit digests. */
export async function rebindHistoricalStandaloneReview(
  source: WorkUnitSource,
  record: WorkUnitRecord,
  github: Pick<GitHubClient, "graphql">,
): Promise<WorkUnitSource> {
  if (!isStandaloneHistoricalReview(record)) return source;
  const [binding] = record.sources;
  const { evidence, policy } = source;
  const { pull, relatedPullRequests, evidenceUrls } = evidence;
  const [reference] = relatedPullRequests;
  if (
    relatedPullRequests.length !== 1 ||
    evidence.limitations.length !== 0 ||
    evidence.unavailablePublicReferences?.length ||
    evidence.indirectAcceptance !== undefined ||
    evidence.repositoryNodeId !== binding.repositoryNodeId ||
    evidence.repositoryDatabaseId !== binding.repositoryDatabaseId ||
    evidence.repository.toLowerCase() !== binding.repository.toLowerCase() ||
    pull.node_id !== binding.pullRequestNodeId ||
    pull.number !== binding.pullRequestNumber ||
    pull.head.sha !== binding.headSha ||
    pull.merge_commit_sha !== binding.mergeSha ||
    pull.state !== "closed" ||
    pull.merged_at !== null ||
    Date.parse(pull.closed_at ?? "") !== Date.parse(binding.occurredAt) ||
    !(Date.parse(pull.updated_at) <= Date.parse(record.assessedAt)) ||
    reference.id === pull.node_id ||
    reference.number === pull.number ||
    reference.repository.toLowerCase() !== binding.repository.toLowerCase() ||
    evidenceUrls.filter((url) => url === reference.url).length !== 1
  )
    return source;

  const result = await github.graphql<{ node: PublicReference | null }>(
    REFERENCE_CREATION_QUERY,
    { id: reference.id },
  );
  const observed = result?.node;
  if (
    observed?.__typename !== "PullRequest" ||
    observed.id !== reference.id ||
    observed.number !== reference.number ||
    observed.url !== reference.url ||
    observed.repository?.id !== binding.repositoryNodeId ||
    observed.repository.databaseId !== binding.repositoryDatabaseId ||
    observed.repository.isPrivate !== false ||
    observed.repository.nameWithOwner?.toLowerCase() !==
      binding.repository.toLowerCase() ||
    !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(
      observed.createdAt,
    ) ||
    !(Date.parse(observed.createdAt) > Date.parse(record.assessedAt)) ||
    new Date(observed.createdAt).toISOString() !==
      observed.createdAt.replace(/(?<!\.\d{3})Z$/u, ".000Z")
  )
    return source;

  const candidate = {
    ...source,
    evidence: {
      ...evidence,
      relatedPullRequests: [],
      evidenceUrls: evidenceUrls.filter((url) => url !== reference.url),
    },
  };
  if (
    (await valueSourceDigest(candidate.evidence, policy)) !==
    binding.sourceDigest
  )
    return source;
  const prepared = await prepareWorkUnitEvidence(
    [candidate],
    REGISTERED_REPOSITORIES,
  );
  return prepared.limitations.length === 0 &&
    prepared.claims.length === 0 &&
    prepared.sourceDigest === record.sourceDigest
    ? candidate
    : source;
}
