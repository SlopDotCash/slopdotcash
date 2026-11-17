// spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"; spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"; spec/backend/listing.md, "A restricted project is closed on every public route and a paused one stays listed"
import type { RegisteredRepository, RepositoryRegistry } from "@repo/points/client";
import { parseBaseUnits } from "@repo/settlement/kernels/amounts";
import { Result, Schema } from "effect";
import type { ProjectTerms } from "../projections/projectView.ts";
import { historicalProjects, listedProjects, type RegistryBoot, type RegistryProject } from "./registry.vibe";

const Repository = Schema.Struct({
  id: Schema.String,
  aliases: Schema.optional(Schema.Array(Schema.String)),
  displayName: Schema.String,
  githubUrl: Schema.String,
  description: Schema.String,
  integrationBranch: Schema.String,
  nodeId: Schema.optional(Schema.String),
  countsFrom: Schema.optional(Schema.String),
});

const Manifest = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["active", "paused"]),
  authority: Schema.Struct({ repositoryNodeId: Schema.String }),
  repositories: Schema.Array(Repository),
  skill: Schema.Struct({ sourcePath: Schema.String }),
});

const Exclusion = Schema.Struct({
  actorId: Schema.String,
  relationship: Schema.Literals(["owner", "funded-employee", "related-party"]),
  fromCycle: Schema.String,
  untilCycle: Schema.NullOr(Schema.String),
});

const Terms = Schema.Struct({
  id: Schema.String,
  repositories: Schema.Array(Schema.Struct({ id: Schema.String, countsFrom: Schema.optional(Schema.String) })),
  escrow: Schema.optional(Schema.Struct({ effectiveCycle: Schema.String, chain: Schema.String })),
  reward: Schema.Struct({
    kind: Schema.Literals(["monthly-pool", "external-prize-share"]),
    currency: Schema.NullOr(Schema.String),
    chain: Schema.NullOr(Schema.String),
    rewardStartAt: Schema.String,
    monthlyCapMinor: Schema.String,
    feeBasisPoints: Schema.Number,
    fundingState: Schema.Literals(["committed", "external-opportunity", "pledged"]),
    cycleCaps: Schema.optional(Schema.Array(Schema.Struct({ cycleId: Schema.String, monthlyCapMinor: Schema.String }))),
    payoutExclusions: Schema.optional(Schema.Array(Exclusion)),
    externalOpportunity: Schema.optional(Schema.Struct({ name: Schema.String, advertisedAmountDisplay: Schema.String })),
  }),
});

const decodeManifest = Schema.decodeUnknownResult(Manifest);
const decodeTerms = Schema.decodeUnknownResult(Terms);

type Manifest = typeof Manifest.Type;

function pathOf(githubUrl: string): readonly [string, string] | undefined {
  const url = URL.parse(githubUrl);
  const [owner, name] = url === null ? [] : url.pathname.split("/").filter((part) => part !== "");
  return owner === undefined || name === undefined ? undefined : [owner, name];
}

function repositoriesOf(manifest: Manifest): ReadonlyArray<RegisteredRepository> | undefined {
  const rows = manifest.repositories.map((repository, index) => {
    const path = pathOf(repository.githubUrl);
    if (path === undefined) return undefined;
    const [owner, name] = path;
    const nodeId = index === 0 ? manifest.authority.repositoryNodeId : (repository.nodeId ?? repository.id);
    return {
      id: repository.id,
      owner,
      name,
      displayName: repository.displayName,
      githubUrl: repository.githubUrl,
      description: repository.description,
      integrationBranch: repository.integrationBranch,
      projectId: manifest.id,
      nodeId,
      aliases: repository.aliases ?? [],
    } satisfies RegisteredRepository;
  });
  return rows.every((row): row is RegisteredRepository => row !== undefined) ? rows : undefined;
}

function manifestsOf(projects: ReadonlyArray<RegistryProject>): ReadonlyArray<{ readonly manifest: Manifest; readonly repositories: ReadonlyArray<RegisteredRepository> }> {
  return projects.flatMap((project) => {
    const decoded = decodeManifest(project);
    if (!Result.isSuccess(decoded)) return [];
    const repositories = repositoriesOf(decoded.success);
    return repositories === undefined ? [] : [{ manifest: decoded.success, repositories }];
  });
}

/** The repositories a public snapshot is checked against: every registered repository in history, and the active listed ones as collection targets, in registry order. @throws {never} */
export function repositoryRegistryOf(boot: RegistryBoot): RepositoryRegistry {
  const historical = manifestsOf(historicalProjects(boot));
  const targets = manifestsOf(listedProjects(boot)).filter(({ manifest }) => manifest.status === "active");
  return {
    registered: historical.flatMap(({ repositories }) => repositories),
    targets: targets.flatMap(({ repositories }) => repositories),
    projects: historical.map(({ manifest }) => ({ id: manifest.id, skillSourcePath: manifest.skill.sourcePath })),
  };
}

function termsOf(project: RegistryProject): ProjectTerms | undefined {
  const decoded = decodeTerms(project);
  if (!Result.isSuccess(decoded)) return undefined;
  const { id, repositories, escrow, reward } = decoded.success;
  const caps = reward.cycleCaps ?? [];
  const minors = [reward.monthlyCapMinor, ...caps.map((cap) => cap.monthlyCapMinor)].map((minor) => parseBaseUnits(minor));
  const [monthlyCapMinor, ...capMinors] = minors;
  if (monthlyCapMinor === undefined || capMinors.some((minor) => minor === undefined)) return undefined;
  const common = { id, rewardStartAt: reward.rewardStartAt, repositories, payoutExclusions: reward.payoutExclusions ?? [] };
  if (reward.kind === "external-prize-share") {
    return { ...common, reward: { kind: "external-prize-share", feeBasisPoints: reward.feeBasisPoints, opportunityName: reward.externalOpportunity?.name, advertisedAmountDisplay: reward.externalOpportunity?.advertisedAmountDisplay } };
  }
  if (reward.fundingState === "external-opportunity" || reward.currency === null || reward.chain === null) return undefined;
  return {
    ...common,
    reward: {
      kind: "monthly-pool",
      currency: reward.currency,
      chain: reward.chain,
      feeBasisPoints: reward.feeBasisPoints,
      monthlyCapMinor,
      cycleCaps: caps.map((cap, index) => ({ cycleId: cap.cycleId, monthlyCapMinor: capMinors[index] ?? 0n })),
      fundingState: reward.fundingState,
      escrow,
    },
  };
}

/** Every registered project's reward terms, retired ones included so past cycles still resolve; a record that is not a valid manifest is left out. @throws {never} */
export function projectTermsOf(boot: RegistryBoot): ReadonlyArray<ProjectTerms> {
  return historicalProjects(boot).flatMap((project) => {
    const terms = termsOf(project);
    return terms === undefined ? [] : [terms];
  });
}
