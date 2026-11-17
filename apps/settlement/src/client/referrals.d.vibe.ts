import { Schema } from "effect";
import { type AnyRoute } from "@repo/platform/route";
export declare const AccrualIndexEntry: Schema.Struct<{
    readonly period: Schema.String;
    readonly epoch: Schema.Number;
    readonly mode: Schema.Literals<readonly ["dry_run", "live"]>;
    readonly bodySha256: Schema.String;
    readonly merkleRoot: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly treeTotalBase: Schema.String;
    readonly leafCount: Schema.Number;
    readonly createdAt: Schema.String;
    readonly url: Schema.String;
}>;
export type AccrualIndexEntry = typeof AccrualIndexEntry.Type;
export declare const AccrualIndex: Schema.Struct<{
    readonly schema: Schema.Literal<"slop-referral-accrual-index-v1">;
    readonly files: Schema.$Array<Schema.Struct<{
        readonly period: Schema.String;
        readonly epoch: Schema.Number;
        readonly mode: Schema.Literals<readonly ["dry_run", "live"]>;
        readonly bodySha256: Schema.String;
        readonly merkleRoot: Schema.Union<readonly [Schema.String, Schema.Null]>;
        readonly treeTotalBase: Schema.String;
        readonly leafCount: Schema.Number;
        readonly createdAt: Schema.String;
        readonly url: Schema.String;
    }>>;
}>;
export type AccrualIndex = typeof AccrualIndex.Type;
export declare const EvmAddress: Schema.String;
export declare const Digest32: Schema.String;
export declare const BaseUnits: Schema.String;
export declare const Instant: Schema.String;
export declare const ReferralProgram: Schema.Struct<{
    readonly network: Schema.Literals<readonly ["robinhood-mainnet", "robinhood-testnet"]>;
    readonly chainId: Schema.Number;
    readonly distributor: Schema.String;
    readonly token: Schema.String;
    readonly decimals: Schema.Int;
    readonly codeHash: Schema.String;
}>;
export type ReferralProgram = typeof ReferralProgram.Type;
export declare const ReferralClaim: Schema.Struct<{
    readonly period: Schema.String;
    readonly epoch: Schema.Int;
    readonly root: Schema.String;
    readonly cumulativeBase: Schema.String;
    readonly proof: Schema.$Array<Schema.String>;
}>;
export type ReferralClaim = typeof ReferralClaim.Type;
export declare const ReferralAccount: Schema.Struct<{
    readonly enabled: Schema.Literal<true>;
    readonly status: Schema.Literals<readonly ["ready", "stale", "unknown"]>;
    readonly program: Schema.NullOr<Schema.Struct<{
        readonly network: Schema.Literals<readonly ["robinhood-mainnet", "robinhood-testnet"]>;
        readonly chainId: Schema.Number;
        readonly distributor: Schema.String;
        readonly token: Schema.String;
        readonly decimals: Schema.Int;
        readonly codeHash: Schema.String;
    }>>;
    readonly observedAt: Schema.NullOr<Schema.String>;
    readonly finalizedAt: Schema.NullOr<Schema.String>;
    readonly wallet: Schema.NullOr<Schema.String>;
    readonly accruedBase: Schema.String;
    readonly claimedBase: Schema.NullOr<Schema.String>;
    readonly claimableBase: Schema.NullOr<Schema.String>;
    readonly pendingBase: Schema.NullOr<Schema.String>;
    readonly paused: Schema.Boolean;
    readonly ended: Schema.Boolean;
    readonly latestVoided: Schema.Boolean;
    readonly pendingUntil: Schema.NullOr<Schema.String>;
    readonly claim: Schema.NullOr<Schema.Struct<{
        readonly period: Schema.String;
        readonly epoch: Schema.Int;
        readonly root: Schema.String;
        readonly cumulativeBase: Schema.String;
        readonly proof: Schema.$Array<Schema.String>;
    }>>;
}>;
export type ReferralAccount = typeof ReferralAccount.Type;
export declare const ProgramHidden: Schema.Struct<{
    readonly enabled: Schema.Literal<false>;
}>;
export type ProgramHidden = typeof ProgramHidden.Type;
export declare const ReferralAnswer: Schema.Union<readonly [Schema.Struct<{
    readonly enabled: Schema.Literal<false>;
}>, Schema.Struct<{
    readonly enabled: Schema.Literal<true>;
    readonly status: Schema.Literals<readonly ["ready", "stale", "unknown"]>;
    readonly program: Schema.NullOr<Schema.Struct<{
        readonly network: Schema.Literals<readonly ["robinhood-mainnet", "robinhood-testnet"]>;
        readonly chainId: Schema.Number;
        readonly distributor: Schema.String;
        readonly token: Schema.String;
        readonly decimals: Schema.Int;
        readonly codeHash: Schema.String;
    }>>;
    readonly observedAt: Schema.NullOr<Schema.String>;
    readonly finalizedAt: Schema.NullOr<Schema.String>;
    readonly wallet: Schema.NullOr<Schema.String>;
    readonly accruedBase: Schema.String;
    readonly claimedBase: Schema.NullOr<Schema.String>;
    readonly claimableBase: Schema.NullOr<Schema.String>;
    readonly pendingBase: Schema.NullOr<Schema.String>;
    readonly paused: Schema.Boolean;
    readonly ended: Schema.Boolean;
    readonly latestVoided: Schema.Boolean;
    readonly pendingUntil: Schema.NullOr<Schema.String>;
    readonly claim: Schema.NullOr<Schema.Struct<{
        readonly period: Schema.String;
        readonly epoch: Schema.Int;
        readonly root: Schema.String;
        readonly cumulativeBase: Schema.String;
        readonly proof: Schema.$Array<Schema.String>;
    }>>;
}>]>;
export type ReferralAnswer = typeof ReferralAnswer.Type;
export declare const referralAccruals: import("@repo/platform/route").Route<undefined, {
    readonly schema: "slop-referral-accrual-index-v1";
    readonly files: readonly {
        readonly period: string;
        readonly epoch: number;
        readonly mode: "dry_run" | "live";
        readonly bodySha256: string;
        readonly merkleRoot: string | null;
        readonly treeTotalBase: string;
        readonly leafCount: number;
        readonly createdAt: string;
        readonly url: string;
    }[];
}, "public">;
export declare const referralAccrualFile: import("@repo/platform/route").Route<undefined, unknown, "public">;
export declare const referralAccount: import("@repo/platform/route").Route<undefined, {
    readonly enabled: true;
    readonly status: "ready" | "stale" | "unknown";
    readonly program: {
        readonly network: "robinhood-mainnet" | "robinhood-testnet";
        readonly chainId: number;
        readonly distributor: string;
        readonly token: string;
        readonly decimals: number;
        readonly codeHash: string;
    } | null;
    readonly observedAt: string | null;
    readonly finalizedAt: string | null;
    readonly wallet: string | null;
    readonly accruedBase: string;
    readonly claimedBase: string | null;
    readonly claimableBase: string | null;
    readonly pendingBase: string | null;
    readonly paused: boolean;
    readonly ended: boolean;
    readonly latestVoided: boolean;
    readonly pendingUntil: string | null;
    readonly claim: {
        readonly period: string;
        readonly epoch: number;
        readonly root: string;
        readonly cumulativeBase: string;
        readonly proof: readonly string[];
    } | null;
} | {
    readonly enabled: false;
}, "session">;
export declare const referralApi: ReadonlyArray<AnyRoute>;
