/** Types for the public project and reward-policy registry. */

export type ProjectId = string;
export type ProjectStatus = "active" | "paused";
export type RewardKind = "monthly-pool" | "external-prize-share";

export interface ProjectFundingPolicy {
  readonly mode: "direct-noncustodial";
  readonly disclosure: "Funds go directly to the project wallet. Slop does not hold or recover funds.";
  readonly recordsPath: string;
  readonly addresses: readonly {
    readonly network: "base" | "bitcoin" | "ethereum" | "solana";
    readonly asset: "BTC" | "USDC";
    readonly address: string;
    readonly effectiveAt: string;
    readonly replacedAt: string | null;
  }[];
}

export interface ProjectRewardPolicy {
  readonly kind: RewardKind;
  readonly currency: "USDC" | null;
  readonly chain: "solana" | null;
  readonly rewardStartAt: string;
  readonly cycle: "calendar-month-utc";
  readonly monthlyCapMinor: string;
  readonly monthlyCapDisplay: string;
  readonly committedMinor: string;
  readonly paymentMode: "disabled" | "enabled";
  readonly feeBasisPoints: 100;
  readonly unusedFunds: "not-applicable" | "rollover-without-cap-increase";
  readonly fundingState: "committed" | "external-opportunity" | "pledged";
  readonly externalOpportunity?: {
    readonly name: string;
    readonly advertisedAmountDisplay: string;
    readonly url: string;
  };
}

export interface ProjectDefinition {
  readonly schemaVersion: "1";
  readonly id: ProjectId;
  readonly slug: ProjectId;
  readonly name: string;
  readonly eyebrow: string;
  readonly headline: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly repositories: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly githubUrl: string;
    readonly description: string;
    readonly integrationBranch: string;
  }[];
  readonly skill: {
    readonly id: string;
    readonly sourcePath: string;
    readonly publicPath: string;
  };
  readonly reviewSkill: {
    readonly id: string;
    readonly sourcePath: string;
  };
  readonly reward: ProjectRewardPolicy;
  readonly funding: ProjectFundingPolicy;
  readonly modelPolicy: {
    readonly mode: "open-declared";
    readonly disclosureRequired: true;
  };
  readonly links: Readonly<Record<string, string>>;
}

export declare const PROJECTS: readonly ProjectDefinition[];

export declare function findProject(value: string): ProjectDefinition | null;

export declare function findProjectByRepositoryId(
  repositoryId: string,
): ProjectDefinition | null;

export declare function assertProjectPaymentsEnabled(
  projectId: ProjectId,
): ProjectDefinition;
