import type { EscrowPolicy } from "./escrow-policy.mjs";
import type { PayoutExclusion } from "./payout-exclusions.mjs";
import type { ContributionField } from "./project-schema.mjs";
/** Types for the public project and reward-policy registry. */

import type { RewardAsset } from "./reward-asset.mjs";
import type { SecurityBountyTerms } from "./security-bounty.mjs";

export type ProjectId = string;
export type ProjectStatus = "active" | "paused";
export type RewardKind = "monthly-pool" | "external-prize-share";

export interface ProjectFundingPolicy {
  readonly mode: "direct-noncustodial";
  readonly disclosure:
    | "Funds go directly to the project wallet. Slop does not hold or recover funds."
    | "Funds are committed in the project vault. Slop holds no payment keys.";
  readonly recordsPath: string;
  readonly addresses: readonly {
    readonly network: "base" | "bitcoin" | "ethereum" | "solana";
    readonly asset: "BTC" | "USDC";
    readonly address: string;
    readonly effectiveAt: string;
    readonly replacedAt: string | null;
  }[];
}

export interface ProjectExternalEvaluationsPolicy {
  readonly enabled: boolean;
}

export interface ProjectReviewBudgetPolicy {
  readonly effectiveAt: string;
  readonly monthlyCapMinor: string;
  readonly monthlyCapDisplay: string;
  readonly committedMinor: string;
  readonly paymentMode: "disabled" | "enabled";
  readonly unusedFunds: "rollover-without-cap-increase";
  readonly fundingState: "committed" | "pledged";
}

export interface ProjectRewardPolicy {
  /** Exact-cycle overrides; unlisted cycles use monthlyCapMinor. */
  readonly cycleCaps?: readonly {
    readonly cycleId: string;
    readonly monthlyCapMinor: string;
  }[];
  readonly kind: RewardKind;
  /** The paid symbol: the network stablecoin, or `rewardAsset.symbol`. */
  readonly currency: string | null;
  readonly chain: "solana" | "base" | "robinhood" | "ethereum" | null;
  readonly rewardStartAt: string;
  readonly cycle: "calendar-month-utc";
  readonly monthlyCapMinor: string;
  readonly monthlyCapDisplay: string;
  readonly committedMinor: string;
  readonly paymentMode: "disabled" | "enabled";
  readonly feeBasisPoints: 100 | 200 | 1000;
  readonly unusedFunds: "not-applicable" | "rollover-without-cap-increase";
  readonly fundingState: "committed" | "external-opportunity" | "pledged";
  readonly reviewBudget?: ProjectReviewBudgetPolicy;
  /** Owners, funded employees and related parties excluded from payout. */
  readonly payoutExclusions?: readonly PayoutExclusion[];
  /**
   * Opt-in for maintainer-awarded contributions that live outside GitHub
   * (posts, support answers, tutorials, videos). Absent means such awards are
   * rejected, which is the default for every project.
   */
  readonly externalEvaluations?: ProjectExternalEvaluationsPolicy;
  readonly externalOpportunity?: {
    readonly name: string;
    readonly advertisedAmountDisplay: string;
    readonly url: string;
  };
}

export interface ProjectDefinition {
  readonly escrow?: EscrowPolicy;
  /** The one reward asset, with server-verified decimals. */
  readonly rewardAsset?: RewardAsset;
  readonly schemaVersion: "1";
  readonly id: ProjectId;
  readonly slug: ProjectId;
  readonly name: string;
  readonly eyebrow: string;
  readonly headline: string;
  readonly description: string;
  readonly listingTier: "featured" | "community" | "retired";
  readonly status: ProjectStatus;
  /** Reviewed participation restrictions; these do not activate a project. */
  readonly participation?:
    | { readonly state: "archived"; readonly successorProjectId: ProjectId }
    | { readonly state: "permission-required" };
  readonly steward: {
    readonly displayName: string;
    readonly kind: "individual" | "organization" | "dao" | "collective";
    readonly github: {
      readonly actorId: string;
      readonly nodeId: string;
      readonly login: string;
      readonly type: "User" | "Organization";
      readonly profileUrl: string;
    };
    readonly website: string | null;
  };
  readonly authority:
    | {
        readonly state: "unverified";
        readonly reason: "missing-repository-proof";
        readonly role: "project-steward";
        readonly repositoryId: string;
        readonly repositoryNodeId: string;
        readonly proof: null;
      }
    | {
        readonly state: "verified";
        readonly reason: null;
        readonly role: "project-steward";
        readonly repositoryId: string;
        readonly repositoryNodeId: string;
        readonly proof: {
          readonly url: string;
          readonly commitSha: string;
          readonly fileSha256: string;
          readonly policyRevision: string;
          readonly verifiedAt: string;
        };
      };
  readonly terms: {
    readonly revision: string;
    readonly effectiveAt: string;
    readonly receiptPolicy:
      | {
          readonly state: "pending-authority-activation";
          readonly activatedAt: null;
          readonly bindings: readonly [];
        }
      | {
          readonly state: "active";
          readonly activatedAt: string;
          readonly bindings: readonly {
            readonly policyRevision: string;
            readonly licenseSha256: string;
            readonly inboundTermsSha256: string | null;
            readonly prizeRulesSha256: string | null;
            readonly activatedAt: string;
          }[];
        };
    readonly paymentTransfersIp: false;
    readonly retroactive: false;
    readonly copyright: {
      readonly model:
        | "sponsor-owned"
        | "contributor-retained"
        | "mixed"
        | "unknown";
      readonly claimedLegalHolder: string | null;
      readonly notice: string | null;
      readonly legalCapacity: {
        readonly legalName: string;
        readonly jurisdiction: string;
        readonly entityId: string;
      } | null;
      readonly governanceResolution: {
        readonly url: string;
        readonly version: string;
        readonly fileSha256: string;
      } | null;
    };
    readonly repositoryLicense:
      | {
          readonly state: "verified";
          readonly spdx: string;
          readonly url: string;
          readonly commitSha: string;
          readonly fileSha256: string;
        }
      | {
          readonly state: "unknown";
          readonly spdx: null;
          readonly url: null;
          readonly commitSha: null;
          readonly fileSha256: null;
        };
    readonly inbound: {
      readonly mode:
        | "license"
        | "cla"
        | "assignment"
        | "dco"
        | "mixed"
        | "unknown";
      readonly termsUrl: string | null;
      readonly commitSha: string | null;
      readonly fileSha256: string | null;
      readonly version: string | null;
      readonly acceptance: string | null;
    };
    readonly assignment: {
      readonly assignee: string;
      readonly instrumentUrl: string;
      readonly version: string;
      readonly fileSha256: string;
      readonly signedAt: string;
    } | null;
    readonly externalPrize: {
      readonly organizer: string;
      readonly rulesUrl: string;
      readonly rulesSha256: string | null;
      readonly rulesCapturedAt: string | null;
      readonly version: string;
      readonly eligibility: string;
      readonly allocationAuthority: string;
      readonly defaultContributorAllocation: string;
      readonly ipTerms: string;
    } | null;
  };
  /** Maintainer-authored fields that generate the project skills (SKL-03). */
  readonly contribution?: Readonly<Record<ContributionField, string>>;
  /** Public terms of an opt-in private security bounty (SEC-01, SEC-05). */
  readonly securityBounty?: SecurityBountyTerms;
  readonly repositories: readonly {
    readonly id: string;
    readonly aliases?: readonly string[];
    readonly displayName: string;
    readonly githubUrl: string;
    readonly description: string;
    readonly integrationBranch: string;
  }[];
  readonly skill: {
    readonly id: string;
    readonly publishAtRoot: boolean;
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
export declare const HISTORICAL_PROJECTS: readonly ProjectDefinition[];
/** The committed snapshot build-time ingestion collected from. */
export declare const INGESTED_PROJECTS: readonly ProjectDefinition[];
export declare const INGESTED_HISTORICAL_PROJECTS: readonly ProjectDefinition[];
/** True for a registry project or a removed pre-registry project id. */
export declare function isHistoricalProjectId(projectId: unknown): boolean;
/** Resolves a registry or removed repository id or alias to its owner. */
export declare function findHistoricalRepository(
  repositoryId: unknown,
): { projectId: string; repositoryId: string } | null;
/** True for a registry repository or a removed pre-registry repository. */
export declare function isHistoricalRepositoryId(
  repositoryId: unknown,
): boolean;
export declare function findHistoricalProject(
  projectId: string,
): ProjectDefinition | null;
export declare function findHistoricalProjectByRepositoryId(
  repositoryId: string,
): ProjectDefinition | null;

export declare function findProject(value: string): ProjectDefinition | null;

/** Resolves a ledger repository in the snapshot the ledger was collected from. */
export declare function findIngestedProjectByRepositoryId(
  repositoryId: string,
): ProjectDefinition | null;

export declare function findProjectByRepositoryId(
  repositoryId: string,
): ProjectDefinition | null;
