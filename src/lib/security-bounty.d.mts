import type { EscrowChain, SecurityEscrowPolicy } from "./escrow-policy.mjs";
import type { RewardAsset } from "./reward-asset.mjs";
/** Types for the public terms of a private security bounty program. */

export type SecurityProgramStatus =
  | "draft"
  | "pending-approval"
  | "open"
  | "paused"
  | "closed";

export interface SecurityApprover {
  readonly githubId: string;
  readonly githubLogin: string;
}

export interface SecurityBountyAmount {
  /** Exact asset identity for new offers; omitted on historical USD/USDC offers. */
  readonly asset?: RewardAsset;
  readonly currency: string;
  readonly decimals: number;
  readonly network: EscrowChain | null;
  readonly grossMinor: string;
}

export interface SecurityBountyTerms {
  readonly settlement?: SecurityEscrowPolicy;
  /** Omitted on historical programs that require funding before opening. */
  readonly fundingPolicy?: "after-approval";
  readonly version: "1";
  readonly status: SecurityProgramStatus;
  readonly rewardMode: "bounty-only" | "separate";
  readonly eligibility: "critical-loss-of-funds" | "in-scope-security";
  readonly amount: SecurityBountyAmount;
  readonly split: SecurityBountySplitPolicy;
  readonly sponsor: { readonly name: string; readonly githubId: string | null };
  readonly funding:
    | { readonly state: "pledged" }
    | {
        readonly state: "verified-available";
        readonly evidence: string;
        readonly verifiedAt: string;
      };
  readonly capacity: {
    /** Null means each first qualifying finding is considered separately. */
    readonly awards: number | null;
    readonly closesAt: string | null;
    readonly exhaustionRule: string;
  };
  readonly scope: {
    readonly sourceRevisions: readonly {
      readonly repository: string;
      readonly commit: string;
    }[];
    readonly deployments: readonly {
      readonly network: string;
      readonly address: string;
      readonly codeIdentity: string | null;
    }[];
    readonly includedAssets: readonly string[];
    readonly excludedDependencies: readonly string[];
    readonly testingPermission: string;
    readonly severityRubric: string;
    readonly lossDefinition: string;
  };
  readonly intake: {
    readonly kind: "github-private-vulnerability-reporting";
    readonly repository: string;
  };
  readonly responseTargets: {
    readonly acknowledgeHours: number;
    readonly triageBusinessDays: number;
    readonly updateIntervalDays: number;
  };
  readonly approvers: {
    readonly technical: readonly SecurityApprover[];
    readonly financial: readonly SecurityApprover[];
    readonly dispute: readonly SecurityApprover[];
  };
  readonly dispute: {
    readonly authority: "advisory" | "binding";
    readonly process: string;
  };
  readonly disclosure: string;
  readonly safeHarbor: string;
}

export declare const SECURITY_SPLIT: Readonly<{
  researcherBasisPoints: 7500;
  slopBasisPoints: 2500;
}>;
/** Standard 75/25 or an admin-approved full award to the researcher. */
export type SecurityBountySplitPolicy =
  | { readonly researcherBasisPoints: 7500; readonly slopBasisPoints: 2500 }
  | { readonly researcherBasisPoints: 10000; readonly slopBasisPoints: 0 };
export declare const SECURITY_FULL_AWARD_SPLIT: Readonly<{
  researcherBasisPoints: 10000;
  slopBasisPoints: 0;
}>;
export declare function isFullAwardSplit(
  split: { researcherBasisPoints: number; slopBasisPoints: number } | undefined,
): boolean;
export declare function securityBountySplit(
  grossMinor: string,
  split?: SecurityBountySplitPolicy,
): {
  grossMinor: string;
  researcherMinor: string;
  slopMinor: string;
};
export declare function formatSecurityAmount(
  minorUnits: string,
  amount: {
    currency: string;
    decimals: number;
    asset?: Pick<RewardAsset, "symbol">;
  },
): string;
export declare function assertSecurityBountyTerms(
  value: unknown,
  context: {
    projectId: string;
    repositories: readonly { id: string }[];
    reward: Record<string, unknown>;
  },
): SecurityBountyTerms;
export declare function assertSecurityBountyTransition(
  previous: SecurityBountyTerms | undefined,
  next: SecurityBountyTerms | undefined,
): void;
