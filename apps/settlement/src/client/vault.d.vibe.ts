import { Schema } from "effect";
export declare const PaymentChain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
export type PaymentChain = typeof PaymentChain.Type;
export declare const VaultSnapshot: Schema.Struct<{
    readonly projectId: Schema.String;
    readonly network: Schema.String;
    readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
    readonly vault: Schema.String;
    readonly assetAddress: Schema.String;
    readonly assetDecimals: Schema.Number;
    readonly totalDeposited: Schema.String;
    readonly totalPaid: Schema.String;
    readonly totalPayoutFees: Schema.String;
    readonly totalGrossWithdrawn: Schema.String;
    readonly totalWithdrawalFees: Schema.String;
    readonly freeBalance: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly reservedPrincipal: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly reservedFees: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly accruedFees: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly reserved: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly blockNumber: Schema.String;
    readonly blockTime: Schema.String;
    readonly observedAt: Schema.String;
}>;
export type VaultSnapshot = typeof VaultSnapshot.Type;
export declare const ProjectVault: Schema.Struct<{
    readonly projectId: Schema.String;
    readonly snapshots: Schema.$Array<Schema.Struct<{
        readonly projectId: Schema.String;
        readonly network: Schema.String;
        readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
        readonly vault: Schema.String;
        readonly assetAddress: Schema.String;
        readonly assetDecimals: Schema.Number;
        readonly totalDeposited: Schema.String;
        readonly totalPaid: Schema.String;
        readonly totalPayoutFees: Schema.String;
        readonly totalGrossWithdrawn: Schema.String;
        readonly totalWithdrawalFees: Schema.String;
        readonly freeBalance: Schema.Union<readonly [Schema.String, Schema.Null]>;
        readonly reservedPrincipal: Schema.Union<readonly [Schema.String, Schema.Null]>;
        readonly reservedFees: Schema.Union<readonly [Schema.String, Schema.Null]>;
        readonly accruedFees: Schema.Union<readonly [Schema.String, Schema.Null]>;
        readonly reserved: Schema.Union<readonly [Schema.String, Schema.Null]>;
        readonly blockNumber: Schema.String;
        readonly blockTime: Schema.String;
        readonly observedAt: Schema.String;
    }>>;
    readonly staleAfterMs: Schema.Number;
    readonly servedAt: Schema.String;
}>;
export type ProjectVault = typeof ProjectVault.Type;
export declare const AssetTotals: Schema.Struct<{
    readonly network: Schema.String;
    readonly assetAddress: Schema.String;
    readonly assetDecimals: Schema.Number;
    readonly totalNetPaidBase: Schema.String;
    readonly payoutFeesPaidBase: Schema.String;
    readonly reservedNetBase: Schema.String;
    readonly reservedFeeBase: Schema.String;
}>;
export type AssetTotals = typeof AssetTotals.Type;
export declare const PaymentCoverage: Schema.Struct<{
    readonly kind: Schema.Literal<"finalized-payment-events">;
    readonly completeThrough: Schema.Union<readonly [Schema.String, Schema.Null]>;
}>;
export type PaymentCoverage = typeof PaymentCoverage.Type;
export declare const ProjectTotals: Schema.Struct<{
    readonly projectId: Schema.String;
    readonly network: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly assets: Schema.$Array<Schema.Struct<{
        readonly network: Schema.String;
        readonly assetAddress: Schema.String;
        readonly assetDecimals: Schema.Number;
        readonly totalNetPaidBase: Schema.String;
        readonly payoutFeesPaidBase: Schema.String;
        readonly reservedNetBase: Schema.String;
        readonly reservedFeeBase: Schema.String;
    }>>;
    readonly coverage: Schema.Struct<{
        readonly kind: Schema.Literal<"finalized-payment-events">;
        readonly completeThrough: Schema.Union<readonly [Schema.String, Schema.Null]>;
    }>;
    readonly syncedAt: Schema.Union<readonly [Schema.String, Schema.Null]>;
}>;
export type ProjectTotals = typeof ProjectTotals.Type;
export declare const staleAfterMs = 1800000;
export declare const vaultEdgeSeconds = 60;
export declare const projectTotals: import("@repo/platform/route").Route<undefined, {
    readonly projectId: string;
    readonly network: string | null;
    readonly assets: readonly {
        readonly network: string;
        readonly assetAddress: string;
        readonly assetDecimals: number;
        readonly totalNetPaidBase: string;
        readonly payoutFeesPaidBase: string;
        readonly reservedNetBase: string;
        readonly reservedFeeBase: string;
    }[];
    readonly coverage: {
        readonly kind: "finalized-payment-events";
        readonly completeThrough: string | null;
    };
    readonly syncedAt: string | null;
}, "public">;
export declare const projectVault: import("@repo/platform/route").Route<undefined, {
    readonly projectId: string;
    readonly snapshots: readonly {
        readonly projectId: string;
        readonly network: string;
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
        readonly vault: string;
        readonly assetAddress: string;
        readonly assetDecimals: number;
        readonly totalDeposited: string;
        readonly totalPaid: string;
        readonly totalPayoutFees: string;
        readonly totalGrossWithdrawn: string;
        readonly totalWithdrawalFees: string;
        readonly freeBalance: string | null;
        readonly reservedPrincipal: string | null;
        readonly reservedFees: string | null;
        readonly accruedFees: string | null;
        readonly reserved: string | null;
        readonly blockNumber: string;
        readonly blockTime: string;
        readonly observedAt: string;
    }[];
    readonly staleAfterMs: number;
    readonly servedAt: string;
}, "public">;
export declare const vaultApi: (import("@repo/platform/route").Route<undefined, {
    readonly projectId: string;
    readonly snapshots: readonly {
        readonly projectId: string;
        readonly network: string;
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
        readonly vault: string;
        readonly assetAddress: string;
        readonly assetDecimals: number;
        readonly totalDeposited: string;
        readonly totalPaid: string;
        readonly totalPayoutFees: string;
        readonly totalGrossWithdrawn: string;
        readonly totalWithdrawalFees: string;
        readonly freeBalance: string | null;
        readonly reservedPrincipal: string | null;
        readonly reservedFees: string | null;
        readonly accruedFees: string | null;
        readonly reserved: string | null;
        readonly blockNumber: string;
        readonly blockTime: string;
        readonly observedAt: string;
    }[];
    readonly staleAfterMs: number;
    readonly servedAt: string;
}, "public"> | import("@repo/platform/route").Route<undefined, {
    readonly projectId: string;
    readonly network: string | null;
    readonly assets: readonly {
        readonly network: string;
        readonly assetAddress: string;
        readonly assetDecimals: number;
        readonly totalNetPaidBase: string;
        readonly payoutFeesPaidBase: string;
        readonly reservedNetBase: string;
        readonly reservedFeeBase: string;
    }[];
    readonly coverage: {
        readonly kind: "finalized-payment-events";
        readonly completeThrough: string | null;
    };
    readonly syncedAt: string | null;
}, "public">)[];
