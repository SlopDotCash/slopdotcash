import { Schema } from "effect";
import { type AnyRoute } from "@repo/platform/route";
export declare const MonthlyAwardState: Schema.Literals<readonly ["excluded", "underfunded", "awaiting-reservation", "reserved", "paid", "conflict"]>;
export type MonthlyAwardState = typeof MonthlyAwardState.Type;
export declare const MonthlyAllocation: Schema.Struct<{
    readonly githubUserId: Schema.String;
    readonly login: Schema.String;
    readonly grossBase: Schema.String;
    readonly sourceDigest: Schema.String;
    readonly proposedGrossBase: Schema.String;
}>;
export type MonthlyAllocation = typeof MonthlyAllocation.Type;
export declare const MonthlyAwardView: Schema.Struct<{
    readonly githubUserId: Schema.String;
    readonly login: Schema.String;
    readonly grossBase: Schema.String;
    readonly feeBase: Schema.String;
    readonly netBase: Schema.String;
    readonly state: Schema.Literals<readonly ["excluded", "underfunded", "awaiting-reservation", "reserved", "paid", "conflict"]>;
}>;
export type MonthlyAwardView = typeof MonthlyAwardView.Type;
export declare const MonthlyAsset: Schema.Struct<{
    readonly network: Schema.String;
    readonly assetAddress: Schema.String;
    readonly assetDecimals: Schema.Number;
    readonly symbol: Schema.Union<readonly [Schema.String, Schema.Null]>;
}>;
export type MonthlyAsset = typeof MonthlyAsset.Type;
export declare const MonthlyProposal: Schema.Struct<{
    readonly capBase: Schema.String;
    readonly allocationSequence: Schema.Number;
    readonly allocations: Schema.$Array<Schema.Struct<{
        readonly githubUserId: Schema.String;
        readonly login: Schema.String;
        readonly grossBase: Schema.String;
        readonly sourceDigest: Schema.String;
        readonly proposedGrossBase: Schema.String;
    }>>;
    readonly latestCutAt: Schema.Union<readonly [Schema.String, Schema.Null]>;
}>;
export type MonthlyProposal = typeof MonthlyProposal.Type;
export declare const MonthlyRun: Schema.Struct<{
    readonly trigger: Schema.Literals<readonly ["owner", "automatic"]>;
    readonly frozenAt: Schema.String;
    readonly snapshotSha256: Schema.String;
    readonly totalGrossBase: Schema.String;
    readonly network: Schema.String;
    readonly vault: Schema.String;
    readonly funded: Schema.Boolean;
    readonly awards: Schema.$Array<Schema.Struct<{
        readonly githubUserId: Schema.String;
        readonly login: Schema.String;
        readonly grossBase: Schema.String;
        readonly feeBase: Schema.String;
        readonly netBase: Schema.String;
        readonly state: Schema.Literals<readonly ["excluded", "underfunded", "awaiting-reservation", "reserved", "paid", "conflict"]>;
    }>>;
}>;
export type MonthlyRun = typeof MonthlyRun.Type;
export declare const MonthlyOwnerView: Schema.Struct<{
    readonly projectId: Schema.String;
    readonly period: Schema.String;
    readonly manifestSha256: Schema.String;
    readonly automatic: Schema.Boolean;
    readonly canManage: Schema.Boolean;
    readonly cutoffAt: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly deployment: Schema.Unknown;
    readonly asset: Schema.Union<readonly [Schema.Struct<{
        readonly network: Schema.String;
        readonly assetAddress: Schema.String;
        readonly assetDecimals: Schema.Number;
        readonly symbol: Schema.Union<readonly [Schema.String, Schema.Null]>;
    }>, Schema.Null]>;
    readonly proposal: Schema.Union<readonly [Schema.Struct<{
        readonly capBase: Schema.String;
        readonly allocationSequence: Schema.Number;
        readonly allocations: Schema.$Array<Schema.Struct<{
            readonly githubUserId: Schema.String;
            readonly login: Schema.String;
            readonly grossBase: Schema.String;
            readonly sourceDigest: Schema.String;
            readonly proposedGrossBase: Schema.String;
        }>>;
        readonly latestCutAt: Schema.Union<readonly [Schema.String, Schema.Null]>;
    }>, Schema.Null]>;
    readonly run: Schema.Union<readonly [Schema.Struct<{
        readonly trigger: Schema.Literals<readonly ["owner", "automatic"]>;
        readonly frozenAt: Schema.String;
        readonly snapshotSha256: Schema.String;
        readonly totalGrossBase: Schema.String;
        readonly network: Schema.String;
        readonly vault: Schema.String;
        readonly funded: Schema.Boolean;
        readonly awards: Schema.$Array<Schema.Struct<{
            readonly githubUserId: Schema.String;
            readonly login: Schema.String;
            readonly grossBase: Schema.String;
            readonly feeBase: Schema.String;
            readonly netBase: Schema.String;
            readonly state: Schema.Literals<readonly ["excluded", "underfunded", "awaiting-reservation", "reserved", "paid", "conflict"]>;
        }>>;
    }>, Schema.Null]>;
}>;
export type MonthlyOwnerView = typeof MonthlyOwnerView.Type;
export declare const AllocationChange: Schema.Struct<{
    readonly githubUserId: Schema.String;
    readonly grossBase: Schema.String;
    readonly expectedSequence: Schema.Number;
    readonly reason: Schema.optional<Schema.String>;
}>;
export type AllocationChange = typeof AllocationChange.Type;
export declare const Finalization: Schema.Struct<{
    readonly expectedSequence: Schema.Number;
}>;
export type Finalization = typeof Finalization.Type;
export declare const MonthlySetting: Schema.Struct<{
    readonly automatic: Schema.Boolean;
}>;
export type MonthlySetting = typeof MonthlySetting.Type;
export declare const MonthlySettingAnswer: Schema.Struct<{
    readonly automatic: Schema.Boolean;
}>;
export type MonthlySettingAnswer = typeof MonthlySettingAnswer.Type;
export declare const CommitmentReview: Schema.Struct<{
    readonly network: Schema.String;
    readonly githubUserId: Schema.String;
    readonly manifestSha256: Schema.String;
    readonly snapshotSha256: Schema.String;
}>;
export type CommitmentReview = typeof CommitmentReview.Type;
export declare const CommitmentAward: Schema.Struct<{
    readonly githubUserId: Schema.String;
    readonly login: Schema.String;
    readonly sourceDigest: Schema.String;
    readonly gross: Schema.String;
    readonly fee: Schema.String;
    readonly net: Schema.String;
}>;
export type CommitmentAward = typeof CommitmentAward.Type;
export declare const CommitmentPlan: Schema.Struct<{
    readonly schemaVersion: Schema.Literal<"2">;
    readonly projectId: Schema.String;
    readonly cycleId: Schema.String;
    readonly manifestSha256: Schema.String;
    readonly snapshotSha256: Schema.String;
    readonly deployment: Schema.Unknown;
    readonly award: Schema.Struct<{
        readonly githubUserId: Schema.String;
        readonly login: Schema.String;
        readonly sourceDigest: Schema.String;
        readonly gross: Schema.String;
        readonly fee: Schema.String;
        readonly net: Schema.String;
    }>;
}>;
export type CommitmentPlan = typeof CommitmentPlan.Type;
export declare const SolanaCommitmentAction: Schema.Struct<{
    readonly step: Schema.String;
    readonly network: Schema.String;
    readonly vault: Schema.String;
    readonly wallet: Schema.String;
    readonly githubUserId: Schema.optional<Schema.String>;
    readonly manifestSha256: Schema.optional<Schema.String>;
    readonly snapshotSha256: Schema.optional<Schema.String>;
    readonly sourceDigest: Schema.optional<Schema.String>;
    readonly gross: Schema.optional<Schema.String>;
    readonly blockhash: Schema.optional<Schema.String>;
    readonly transactionId: Schema.optional<Schema.String>;
}>;
export type SolanaCommitmentAction = typeof SolanaCommitmentAction.Type;
export declare const SolanaCommitmentTransaction: Schema.Struct<{
    readonly wallet: Schema.String;
    readonly sourceDigest: Schema.String;
    readonly githubUserId: Schema.String;
    readonly gross: Schema.String;
    readonly blockhash: Schema.String;
    readonly lastValidBlockHeight: Schema.Number;
    readonly transaction: Schema.String;
    readonly networkFeeLamports: Schema.String;
    readonly fee: Schema.String;
    readonly net: Schema.String;
    readonly decimals: Schema.Number;
    readonly freeBalance: Schema.String;
}>;
export type SolanaCommitmentTransaction = typeof SolanaCommitmentTransaction.Type;
export declare const SolanaCommitmentReviewed: Schema.Struct<{
    readonly plan: Schema.Struct<{
        readonly schemaVersion: Schema.Literal<"2">;
        readonly projectId: Schema.String;
        readonly cycleId: Schema.String;
        readonly manifestSha256: Schema.String;
        readonly snapshotSha256: Schema.String;
        readonly deployment: Schema.Unknown;
        readonly award: Schema.Struct<{
            readonly githubUserId: Schema.String;
            readonly login: Schema.String;
            readonly sourceDigest: Schema.String;
            readonly gross: Schema.String;
            readonly fee: Schema.String;
            readonly net: Schema.String;
        }>;
    }>;
    readonly transaction: Schema.Struct<{
        readonly wallet: Schema.String;
        readonly sourceDigest: Schema.String;
        readonly githubUserId: Schema.String;
        readonly gross: Schema.String;
        readonly blockhash: Schema.String;
        readonly lastValidBlockHeight: Schema.Number;
        readonly transaction: Schema.String;
        readonly networkFeeLamports: Schema.String;
        readonly fee: Schema.String;
        readonly net: Schema.String;
        readonly decimals: Schema.Number;
        readonly freeBalance: Schema.String;
    }>;
}>;
export type SolanaCommitmentReviewed = typeof SolanaCommitmentReviewed.Type;
export declare const SolanaCommitmentChecked: Schema.Struct<{
    readonly status: Schema.Literals<readonly ["pending", "failed", "finalized"]>;
}>;
export type SolanaCommitmentChecked = typeof SolanaCommitmentChecked.Type;
export declare const SolanaCommitmentAnswer: Schema.Union<readonly [Schema.Struct<{
    readonly plan: Schema.Struct<{
        readonly schemaVersion: Schema.Literal<"2">;
        readonly projectId: Schema.String;
        readonly cycleId: Schema.String;
        readonly manifestSha256: Schema.String;
        readonly snapshotSha256: Schema.String;
        readonly deployment: Schema.Unknown;
        readonly award: Schema.Struct<{
            readonly githubUserId: Schema.String;
            readonly login: Schema.String;
            readonly sourceDigest: Schema.String;
            readonly gross: Schema.String;
            readonly fee: Schema.String;
            readonly net: Schema.String;
        }>;
    }>;
    readonly transaction: Schema.Struct<{
        readonly wallet: Schema.String;
        readonly sourceDigest: Schema.String;
        readonly githubUserId: Schema.String;
        readonly gross: Schema.String;
        readonly blockhash: Schema.String;
        readonly lastValidBlockHeight: Schema.Number;
        readonly transaction: Schema.String;
        readonly networkFeeLamports: Schema.String;
        readonly fee: Schema.String;
        readonly net: Schema.String;
        readonly decimals: Schema.Number;
        readonly freeBalance: Schema.String;
    }>;
}>, Schema.Struct<{
    readonly status: Schema.Literals<readonly ["pending", "failed", "finalized"]>;
}>]>;
export type SolanaCommitmentAnswer = typeof SolanaCommitmentAnswer.Type;
export declare const MonthlyCut: Schema.Struct<{
    readonly githubUserId: Schema.String;
    readonly login: Schema.String;
    readonly proposedGrossBase: Schema.String;
    readonly grossBase: Schema.String;
    readonly reason: Schema.String;
    readonly cutAt: Schema.String;
}>;
export type MonthlyCut = typeof MonthlyCut.Type;
export declare const MonthlyCuts: Schema.Struct<{
    readonly projectId: Schema.String;
    readonly period: Schema.String;
    readonly cuts: Schema.$Array<Schema.Struct<{
        readonly githubUserId: Schema.String;
        readonly login: Schema.String;
        readonly proposedGrossBase: Schema.String;
        readonly grossBase: Schema.String;
        readonly reason: Schema.String;
        readonly cutAt: Schema.String;
    }>>;
}>;
export type MonthlyCuts = typeof MonthlyCuts.Type;
export declare const monthlyView: import("@repo/platform/route").Route<undefined, {
    readonly projectId: string;
    readonly period: string;
    readonly manifestSha256: string;
    readonly automatic: boolean;
    readonly canManage: boolean;
    readonly cutoffAt: string | null;
    readonly deployment: unknown;
    readonly asset: {
        readonly network: string;
        readonly assetAddress: string;
        readonly assetDecimals: number;
        readonly symbol: string | null;
    } | null;
    readonly proposal: {
        readonly capBase: string;
        readonly allocationSequence: number;
        readonly allocations: readonly {
            readonly githubUserId: string;
            readonly login: string;
            readonly grossBase: string;
            readonly sourceDigest: string;
            readonly proposedGrossBase: string;
        }[];
        readonly latestCutAt: string | null;
    } | null;
    readonly run: {
        readonly trigger: "automatic" | "owner";
        readonly frozenAt: string;
        readonly snapshotSha256: string;
        readonly totalGrossBase: string;
        readonly network: string;
        readonly vault: string;
        readonly funded: boolean;
        readonly awards: readonly {
            readonly githubUserId: string;
            readonly login: string;
            readonly grossBase: string;
            readonly feeBase: string;
            readonly netBase: string;
            readonly state: "awaiting-reservation" | "conflict" | "excluded" | "paid" | "reserved" | "underfunded";
        }[];
    } | null;
}, "session">;
export declare const monthlyAllocations: import("@repo/platform/route").Route<{
    readonly githubUserId: string;
    readonly grossBase: string;
    readonly expectedSequence: number;
    readonly reason?: string | undefined;
}, {
    readonly projectId: string;
    readonly period: string;
    readonly manifestSha256: string;
    readonly automatic: boolean;
    readonly canManage: boolean;
    readonly cutoffAt: string | null;
    readonly deployment: unknown;
    readonly asset: {
        readonly network: string;
        readonly assetAddress: string;
        readonly assetDecimals: number;
        readonly symbol: string | null;
    } | null;
    readonly proposal: {
        readonly capBase: string;
        readonly allocationSequence: number;
        readonly allocations: readonly {
            readonly githubUserId: string;
            readonly login: string;
            readonly grossBase: string;
            readonly sourceDigest: string;
            readonly proposedGrossBase: string;
        }[];
        readonly latestCutAt: string | null;
    } | null;
    readonly run: {
        readonly trigger: "automatic" | "owner";
        readonly frozenAt: string;
        readonly snapshotSha256: string;
        readonly totalGrossBase: string;
        readonly network: string;
        readonly vault: string;
        readonly funded: boolean;
        readonly awards: readonly {
            readonly githubUserId: string;
            readonly login: string;
            readonly grossBase: string;
            readonly feeBase: string;
            readonly netBase: string;
            readonly state: "awaiting-reservation" | "conflict" | "excluded" | "paid" | "reserved" | "underfunded";
        }[];
    } | null;
}, "sessionWrite">;
export declare const monthlyFinalize: import("@repo/platform/route").Route<{
    readonly expectedSequence: number;
}, {
    readonly projectId: string;
    readonly period: string;
    readonly manifestSha256: string;
    readonly automatic: boolean;
    readonly canManage: boolean;
    readonly cutoffAt: string | null;
    readonly deployment: unknown;
    readonly asset: {
        readonly network: string;
        readonly assetAddress: string;
        readonly assetDecimals: number;
        readonly symbol: string | null;
    } | null;
    readonly proposal: {
        readonly capBase: string;
        readonly allocationSequence: number;
        readonly allocations: readonly {
            readonly githubUserId: string;
            readonly login: string;
            readonly grossBase: string;
            readonly sourceDigest: string;
            readonly proposedGrossBase: string;
        }[];
        readonly latestCutAt: string | null;
    } | null;
    readonly run: {
        readonly trigger: "automatic" | "owner";
        readonly frozenAt: string;
        readonly snapshotSha256: string;
        readonly totalGrossBase: string;
        readonly network: string;
        readonly vault: string;
        readonly funded: boolean;
        readonly awards: readonly {
            readonly githubUserId: string;
            readonly login: string;
            readonly grossBase: string;
            readonly feeBase: string;
            readonly netBase: string;
            readonly state: "awaiting-reservation" | "conflict" | "excluded" | "paid" | "reserved" | "underfunded";
        }[];
    } | null;
}, "sessionWrite">;
export declare const monthlySettings: import("@repo/platform/route").Route<{
    readonly automatic: boolean;
}, {
    readonly automatic: boolean;
}, "sessionWrite">;
export declare const monthlyCommitment: import("@repo/platform/route").Route<{
    readonly network: string;
    readonly githubUserId: string;
    readonly manifestSha256: string;
    readonly snapshotSha256: string;
}, {
    readonly schemaVersion: "2";
    readonly projectId: string;
    readonly cycleId: string;
    readonly manifestSha256: string;
    readonly snapshotSha256: string;
    readonly deployment: unknown;
    readonly award: {
        readonly githubUserId: string;
        readonly login: string;
        readonly sourceDigest: string;
        readonly gross: string;
        readonly fee: string;
        readonly net: string;
    };
}, "sessionWrite">;
export declare const monthlySolanaCommitment: import("@repo/platform/route").Route<{
    readonly step: string;
    readonly network: string;
    readonly vault: string;
    readonly wallet: string;
    readonly githubUserId?: string | undefined;
    readonly manifestSha256?: string | undefined;
    readonly snapshotSha256?: string | undefined;
    readonly sourceDigest?: string | undefined;
    readonly gross?: string | undefined;
    readonly blockhash?: string | undefined;
    readonly transactionId?: string | undefined;
}, {
    readonly plan: {
        readonly schemaVersion: "2";
        readonly projectId: string;
        readonly cycleId: string;
        readonly manifestSha256: string;
        readonly snapshotSha256: string;
        readonly deployment: unknown;
        readonly award: {
            readonly githubUserId: string;
            readonly login: string;
            readonly sourceDigest: string;
            readonly gross: string;
            readonly fee: string;
            readonly net: string;
        };
    };
    readonly transaction: {
        readonly wallet: string;
        readonly sourceDigest: string;
        readonly githubUserId: string;
        readonly gross: string;
        readonly blockhash: string;
        readonly lastValidBlockHeight: number;
        readonly transaction: string;
        readonly networkFeeLamports: string;
        readonly fee: string;
        readonly net: string;
        readonly decimals: number;
        readonly freeBalance: string;
    };
} | {
    readonly status: "failed" | "finalized" | "pending";
}, "sessionWrite">;
export declare const monthlyCuts: import("@repo/platform/route").Route<undefined, {
    readonly projectId: string;
    readonly period: string;
    readonly cuts: readonly {
        readonly githubUserId: string;
        readonly login: string;
        readonly proposedGrossBase: string;
        readonly grossBase: string;
        readonly reason: string;
        readonly cutAt: string;
    }[];
}, "public">;
export declare const monthlyApi: ReadonlyArray<AnyRoute>;
