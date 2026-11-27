// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"; spec/backend/projects.md, "The maintainer share is an owner setting whose history only the server writes"; spec/backend/projects.md, "A current repository administrator moves the integration branch with a committed declaration"
import { Schema } from "effect";

export const ListedRepository = Schema.Struct({
  id: Schema.String,
  aliases: Schema.optional(Schema.Array(Schema.String)),
  githubUrl: Schema.optional(Schema.String),
  integrationBranch: Schema.optional(Schema.String),
  countsFrom: Schema.optional(Schema.String),
});

export const ManagedReward = Schema.Struct({
  kind: Schema.String,
  chain: Schema.optional(Schema.String),
  currency: Schema.optional(Schema.String),
  monthlyCapMinor: Schema.optional(Schema.String),
  committedMinor: Schema.optional(Schema.String),
  fundingState: Schema.optional(Schema.String),
  paymentMode: Schema.optional(Schema.String),
  rewardStartAt: Schema.optional(Schema.String),
  honorSystem: Schema.optional(Schema.Boolean),
  maintainerShare: Schema.optional(Schema.Number),
});

export const ManagedAsset = Schema.Struct({
  network: Schema.String,
  kind: Schema.String,
  address: Schema.String,
  symbol: Schema.String,
  decimals: Schema.Number,
});

export const ManagedManifest = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  status: Schema.optional(Schema.String),
  headline: Schema.String,
  description: Schema.String,
  image: Schema.optional(Schema.String),
  slopbot: Schema.optional(
    Schema.Struct({
      automaticClosure: Schema.optional(Schema.Boolean),
      readyLabel: Schema.optional(Schema.Unknown),
      intakeCap: Schema.optional(Schema.Number),
      catchUpUntil: Schema.optional(Schema.String),
      catchUpHistory: Schema.optional(Schema.Array(Schema.Struct({ startedAt: Schema.String }))),
      submissionFee: Schema.optional(Schema.Unknown),
      wantedIssues: Schema.optional(Schema.Boolean),
    }),
  ),
  security: Schema.optional(Schema.Struct({ reportDeposit: Schema.optional(Schema.Boolean) })),
  authority: Schema.optional(Schema.Struct({ repositoryId: Schema.String, repositoryNodeId: Schema.String })),
  links: Schema.Record(Schema.String, Schema.String),
  contribution: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  repositories: Schema.Array(ListedRepository),
  reward: ManagedReward,
  rewardAsset: Schema.optional(ManagedAsset),
  escrow: Schema.optional(Schema.Struct({ deployments: Schema.Array(Schema.Unknown) })),
  securityBounty: Schema.optional(Schema.Struct({ rewardMode: Schema.optional(Schema.String) })),
});

export const AddedRepository = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  githubUrl: Schema.String,
  description: Schema.String,
  integrationBranch: Schema.String,
  githubId: Schema.String,
  nodeId: Schema.String,
});

export const PendingRepository = Schema.Struct({ entry: AddedRepository, ownDescription: Schema.Boolean });

export type ManagedManifest = typeof ManagedManifest.Type;
export type ManagedAsset = typeof ManagedAsset.Type;
export type AddedRepository = typeof AddedRepository.Type;
export type PendingRepository = typeof PendingRepository.Type;
