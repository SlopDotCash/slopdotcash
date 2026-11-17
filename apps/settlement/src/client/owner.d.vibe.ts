import { Schema } from "effect";
import { type AnyRoute } from "@repo/platform/route";
export declare const FundingAction: Schema.Struct<{
    readonly step: Schema.String;
    readonly operation: Schema.String;
    readonly network: Schema.String;
    readonly vault: Schema.String;
    readonly wallet: Schema.String;
    readonly amount: Schema.optional<Schema.String>;
    readonly gross: Schema.optional<Schema.String>;
    readonly blockhash: Schema.optional<Schema.String>;
    readonly transactionId: Schema.optional<Schema.String>;
}>;
export type FundingAction = typeof FundingAction.Type;
export declare const FundingPlan: Schema.Struct<{
    readonly operation: Schema.Literals<readonly ["deposit", "withdraw"]>;
    readonly wallet: Schema.String;
    readonly gross: Schema.String;
    readonly blockhash: Schema.String;
    readonly lastValidBlockHeight: Schema.Number;
    readonly transaction: Schema.String;
    readonly networkFeeLamports: Schema.String;
    readonly tokenProgram: Schema.String;
    readonly fee: Schema.String;
    readonly net: Schema.String;
    readonly decimals: Schema.Number;
    readonly freeBalance: Schema.Union<readonly [Schema.String, Schema.Null]>;
}>;
export type FundingPlan = typeof FundingPlan.Type;
export declare const FundingReviewed: Schema.Struct<{
    readonly plan: Schema.Struct<{
        readonly operation: Schema.Literals<readonly ["deposit", "withdraw"]>;
        readonly wallet: Schema.String;
        readonly gross: Schema.String;
        readonly blockhash: Schema.String;
        readonly lastValidBlockHeight: Schema.Number;
        readonly transaction: Schema.String;
        readonly networkFeeLamports: Schema.String;
        readonly tokenProgram: Schema.String;
        readonly fee: Schema.String;
        readonly net: Schema.String;
        readonly decimals: Schema.Number;
        readonly freeBalance: Schema.Union<readonly [Schema.String, Schema.Null]>;
    }>;
}>;
export type FundingReviewed = typeof FundingReviewed.Type;
export declare const FundingChecked: Schema.Struct<{
    readonly status: Schema.Literals<readonly ["pending", "failed", "finalized"]>;
}>;
export type FundingChecked = typeof FundingChecked.Type;
export declare const FundingAnswer: Schema.Union<readonly [Schema.Struct<{
    readonly plan: Schema.Struct<{
        readonly operation: Schema.Literals<readonly ["deposit", "withdraw"]>;
        readonly wallet: Schema.String;
        readonly gross: Schema.String;
        readonly blockhash: Schema.String;
        readonly lastValidBlockHeight: Schema.Number;
        readonly transaction: Schema.String;
        readonly networkFeeLamports: Schema.String;
        readonly tokenProgram: Schema.String;
        readonly fee: Schema.String;
        readonly net: Schema.String;
        readonly decimals: Schema.Number;
        readonly freeBalance: Schema.Union<readonly [Schema.String, Schema.Null]>;
    }>;
}>, Schema.Struct<{
    readonly status: Schema.Literals<readonly ["pending", "failed", "finalized"]>;
}>]>;
export type FundingAnswer = typeof FundingAnswer.Type;
export declare const paymentsSolanaFunding: import("@repo/platform/route").Route<{
    readonly step: string;
    readonly operation: string;
    readonly network: string;
    readonly vault: string;
    readonly wallet: string;
    readonly amount?: string | undefined;
    readonly gross?: string | undefined;
    readonly blockhash?: string | undefined;
    readonly transactionId?: string | undefined;
}, {
    readonly plan: {
        readonly operation: "deposit" | "withdraw";
        readonly wallet: string;
        readonly gross: string;
        readonly blockhash: string;
        readonly lastValidBlockHeight: number;
        readonly transaction: string;
        readonly networkFeeLamports: string;
        readonly tokenProgram: string;
        readonly fee: string;
        readonly net: string;
        readonly decimals: number;
        readonly freeBalance: string | null;
    };
} | {
    readonly status: "failed" | "finalized" | "pending";
}, "public">;
export declare const ownerApi: ReadonlyArray<AnyRoute>;
