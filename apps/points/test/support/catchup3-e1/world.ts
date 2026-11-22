// spec/points/window.md, "Publication needs a verified complete census; a failure keeps the previous window"
import type { Fetcher } from "@repo/platform/bindings";
import type { Collection } from "../../../src/collect/run/pipeline.vibe";
import { type Seeded, fetcherOf as githubFetcher, repository } from "../u5/github.ts";
import { banFeed, penaltyPage, scripted } from "../u6/feeds.ts";

export const registryOrigin = "https://slop.cash";
export const acceptedReviewHistoryJson = `${JSON.stringify({ schemaVersion: "2", events: [], attributions: [] })}\n`;

const [owner, name] = repository.split("/");
const listing = {
  id: repository,
  displayName: "Widgets",
  githubUrl: `https://github.com/${repository}`,
  description: "The widgets source repository.",
  integrationBranch: "main",
};

/** @throws {never} */
export function registryAnswer(world: Seeded) {
  return {
    schemaVersion: "1",
    projects: [{
      id: "widgets",
      name: "widgets",
      status: "active",
      listingTier: "community",
      authority: { repositoryId: repository, repositoryNodeId: world.repositoryNodeId, role: "admin", state: "verified", proof: "github-admin", reason: "fixture" },
      reward: { committedMinor: "500000000", monthlyCapMinor: "100000000", fundingState: "committed" },
      skill: { publishAtRoot: false },
      repositories: [{ ...listing, aliases: [] }],
    }],
  };
}

/** @throws {never} */
export function repositoryRegistry(world: Seeded) {
  const registered = { ...listing, owner, name, projectId: "widgets", nodeId: world.repositoryNodeId, aliases: [] };
  return { registered: [registered], targets: [registered], projects: [{ id: "widgets", skillSourcePath: "skills/widgets/SKILL.md" }] };
}

export interface Served {
  readonly fetcher: Fetcher;
  readonly seen: ReadonlyArray<{ readonly url: string }>;
}

/** The registry, ban and penalty feeds answer from fixtures; GitHub answers from the seeded world. @throws {never} */
export function served(world: Seeded): Served {
  const feeds = scripted();
  feeds.reply(`${registryOrigin}/api/v1/projects`, { json: registryAnswer(world), headers: { "x-slop-project-api-contract": "1" } });
  feeds.reply(`${registryOrigin}/api/v1/project-account-bans`, { json: banFeed([]) });
  feeds.reply(/^https:\/\/slopbot\.slop\.cash\/v1\/penalties\?/u, { json: penaltyPage("widgets", [], null) });
  const github = githubFetcher(world);
  return {
    seen: feeds.seen,
    fetcher: { fetch: (request) => (new URL(request.url).hostname === "api.github.com" ? github.fetch(request) : feeds.fetcher.fetch(request)) },
  };
}

/** A snapshot of a window whose collection credited nothing and listed no open work. @throws {never} */
export function creditlessSnapshot(collection: Collection, methodology: unknown): unknown {
  return {
    schemaVersion: "6",
    repository: collection.registry.targets[0]?.id ?? null,
    repositories: collection.registry.targets.map((target, index) => ({
      id: target.id,
      owner: target.owner,
      name: target.name,
      displayName: target.displayName,
      githubUrl: target.githubUrl,
      description: target.description,
      integrationBranch: target.integrationBranch,
      projectId: target.projectId,
      role: index === 0 ? "primary" : "member",
    })),
    ruleVersion: "slop-score-v2",
    generatedAt: collection.generatedAt,
    sourceUpdatedAt: collection.latestPreflightUpdate,
    stale: false,
    window: { days: collection.bounds.days, from: collection.bounds.from, to: collection.bounds.to },
    methodology,
    source: { ...collection.source, evidenceVerification: { status: "complete", sourceCount: 0, artifactCount: 0, maxSources: 0, maxArtifacts: 0 } },
    leaders: [],
    ledger: [],
    opportunities: [],
    attributions: [],
    invalidAttributionMarkers: [],
    attributionCoverage: { status: "missing", eligibleSourceCount: 0, validSourceCount: 0, missingSourceCount: 0, invalidSourceCount: 0, humanOnlySourceCount: 0 },
    workQueue: { issues: [], pullRequests: [] },
  };
}
