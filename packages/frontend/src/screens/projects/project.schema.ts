// spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"; spec/backend/listing.md, "A restricted project is closed on every public route and a paused one stays listed"
import { parseBaseUnits } from "@repo/settlement/kernels/amounts";
import { Result, Schema } from "effect";
import type { PoolCommitment } from "../../kernels/assetText.ts";
import type { CardProject, RewardAsset, SecurityBounty } from "../../kernels/rewardSummary.ts";

const Repository = Schema.Struct({ id: Schema.String, aliases: Schema.optional(Schema.Array(Schema.String)) });

const Asset = Schema.Struct({
  kind: Schema.Literals(["native", "stablecoin", "token"]),
  network: Schema.Literals(["base", "ethereum", "robinhood", "solana"]),
  address: Schema.String,
  symbol: Schema.String,
  decimals: Schema.Number,
});

const Budget = Schema.Struct({ committedMinor: Schema.String, fundingState: Schema.Literals(["pledged", "committed"]), monthlyCapDisplay: Schema.String });

const Reward = Schema.Struct({
  kind: Schema.Literals(["monthly-pool", "external-prize-share"]),
  monthlyCapMinor: Schema.String,
  monthlyCapDisplay: Schema.String,
  cycleCaps: Schema.optional(Schema.Array(Schema.Struct({ cycleId: Schema.String, monthlyCapMinor: Schema.String }))),
  reviewBudget: Schema.optional(Budget),
  externalOpportunity: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String), advertisedAmountDisplay: Schema.optional(Schema.String) })),
  honorSystem: Schema.optional(Schema.Boolean),
});

const Bounty = Schema.Struct({
  rewardMode: Schema.Literals(["separate", "bounty-only"]),
  status: Schema.Literals(["draft", "pending-approval", "open", "paused", "closed"]),
  eligibility: Schema.Literals(["critical-loss-of-funds", "in-scope-security"]),
  amount: Schema.Struct({
    decimals: Schema.Number,
    grossMinor: Schema.String,
    asset: Schema.optional(Schema.Struct({ kind: Schema.Literals(["native", "stablecoin", "token"]), symbol: Schema.String })),
  }),
  funding: Schema.Struct({ state: Schema.String }),
});

const Participation = Schema.Union([
  Schema.Struct({ state: Schema.Literal("archived"), successorProjectId: Schema.String }),
  Schema.Struct({ state: Schema.Literal("permission-required") }),
]);

export const ProjectRecord = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  description: Schema.String,
  image: Schema.optional(Schema.String),
  status: Schema.Literals(["active", "paused"]),
  listingTier: Schema.optional(Schema.Literals(["featured", "community", "retired"])),
  participation: Schema.optional(Participation),
  steward: Schema.Struct({ displayName: Schema.String, github: Schema.Struct({ profileUrl: Schema.String }) }),
  links: Schema.Struct({ repository: Schema.String }),
  repositories: Schema.Array(Repository),
  reward: Reward,
  rewardAsset: Schema.optional(Asset),
  securityBounty: Schema.optional(Bounty),
  escrow: Schema.optional(Schema.Struct({ deployments: Schema.Array(Schema.Struct({ network: Schema.String, vault: Schema.String })) })),
});

export type ProjectRecord = typeof ProjectRecord.Type;

export type Participation = typeof Participation.Type;

export interface CycleCap {
  readonly cycleId: string;
  readonly monthlyCapMinor: bigint;
}

export interface ShownProject extends CardProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly image?: string;
  readonly participation?: Participation;
  readonly steward: ProjectRecord["steward"];
  readonly repositoryUrl: string;
  readonly repositories: ProjectRecord["repositories"];
  readonly reward: CardProject["reward"] & {
    readonly monthlyCapDisplay: string;
    readonly cycleCaps: ReadonlyArray<CycleCap>;
    readonly reviewBudget?: PoolCommitment;
    // The owner's honor-system promise on a positive monthly pool (presentation only).
    readonly honorSystem?: boolean;
  };
  readonly rewardAsset?: RewardAsset;
  readonly securityBounty?: SecurityBounty & { readonly funding: { readonly state: string } };
  readonly deployments: ReadonlyArray<{ readonly network: string; readonly vault: string }>;
  readonly record: unknown;
}

const decodeProject = Schema.decodeUnknownResult(ProjectRecord);

type Minor = string | undefined;

function minors(values: ReadonlyArray<Minor>): ReadonlyArray<bigint> | undefined {
  const parsed = values.map((value) => (value === undefined ? undefined : parseBaseUnits(value)));
  return parsed.every((value): value is bigint => value !== undefined) ? parsed : undefined;
}

/** The registry record as the project page shows it, with every amount as exact base units, or undefined when it is not one. @throws {never} */
export function projectOf(record: unknown): ShownProject | undefined {
  const decoded = decodeProject(record);
  if (!Result.isSuccess(decoded)) return undefined;
  const project = decoded.success;
  const { reward, securityBounty: bounty } = project;
  const caps = reward.cycleCaps ?? [];
  const amounts = minors([reward.monthlyCapMinor, reward.reviewBudget?.committedMinor ?? "0", bounty?.amount.grossMinor ?? "0", ...caps.map((cap) => cap.monthlyCapMinor)]);
  if (amounts === undefined) return undefined;
  const [monthlyCapMinor = 0n, committedMinor = 0n, grossMinor = 0n, ...capMinors] = amounts;
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: project.description,
    image: project.image,
    status: project.status,
    listingTier: project.listingTier ?? "retired",
    participation: project.participation,
    steward: project.steward,
    repositoryUrl: project.links.repository,
    repositories: project.repositories,
    reward: {
      kind: reward.kind,
      monthlyCapMinor,
      monthlyCapDisplay: reward.monthlyCapDisplay,
      cycleCaps: caps.map((cap, index) => ({ cycleId: cap.cycleId, monthlyCapMinor: capMinors[index] ?? 0n })),
      reviewBudget: reward.reviewBudget && { committedMinor, fundingState: reward.reviewBudget.fundingState, monthlyCapDisplay: reward.reviewBudget.monthlyCapDisplay },
      externalOpportunity: reward.externalOpportunity,
      honorSystem: reward.honorSystem,
    },
    rewardAsset: project.rewardAsset,
    securityBounty: bounty && { ...bounty, amount: { ...bounty.amount, grossMinor } },
    deployments: project.escrow?.deployments ?? [],
    record,
  };
}
