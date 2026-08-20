/** Types for the public project and reward-policy registry. */

import type { FundingCommitmentInstrument } from "./funding-instruments.mjs";

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
  readonly commitments?: readonly FundingCommitmentInstrument[];
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

export declare function findProject(value: string): ProjectDefinition | null;

export declare function findProjectByRepositoryId(
  repositoryId: string,
): ProjectDefinition | null;

export declare function assertProjectPaymentsEnabled(
  projectId: ProjectId,
): ProjectDefinition;
