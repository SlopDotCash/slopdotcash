import { Schema } from "effect";
export declare const PublishedAuthorization: Schema.Struct<{
    readonly authorization: Schema.Unknown;
    readonly publishedAt: Schema.String;
}>;
export type PublishedAuthorization = typeof PublishedAuthorization.Type;
export declare const monthlyAuthorization: import("@repo/platform/route").Route<undefined, {
    readonly authorization: unknown;
    readonly publishedAt: string;
}, "public">;
export declare const monthlyCommitmentApi: import("@repo/platform/route").Route<undefined, {
    readonly authorization: unknown;
    readonly publishedAt: string;
}, "public">[];
