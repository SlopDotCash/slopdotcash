import { Effect, Schema } from "effect";
import { HttpServerRequest } from "effect/http";
import { Refused } from "@repo/platform/http";
export declare const sessionCookie = "__Host-slop_points";
export declare const sessionSeconds = 3600;
export declare const SessionMember: Schema.Struct<{
    readonly actor_id: Schema.mutableKey<Schema.String>;
    readonly github_id: Schema.mutableKey<Schema.String>;
    readonly login: Schema.mutableKey<Schema.String>;
    readonly token_hash: Schema.mutableKey<Schema.String>;
}>;
export type SessionMember = typeof SessionMember.Type;
/** @throws {never} */
export declare function sessionCookieHeader(token: string, seconds: number): string;
/** @throws {never} */
export declare function presentedToken(cookies: Readonly<Record<string, string | undefined>>): string | undefined;
export declare function presentedTokenHash(): Effect.Effect<string, never, import("vibelang-runtime/experimental/Crypto").Crypto | HttpServerRequest.HttpServerRequest>;
export declare function sessionMember(): Effect.Effect<{
    actor_id: string;
    github_id: string;
    login: string;
    token_hash: string;
} | undefined, import("@repo/platform/d1").RowMismatch | import("@repo/platform/d1").D1Error, import("vibelang-runtime/experimental/Crypto").Crypto | import("@repo/platform/d1").D1 | HttpServerRequest.HttpServerRequest>;
export declare function sessionActor(): Effect.Effect<string, Refused | import("@repo/platform/d1").RowMismatch | import("@repo/platform/d1").D1Error, import("vibelang-runtime/experimental/Crypto").Crypto | import("@repo/platform/d1").D1 | HttpServerRequest.HttpServerRequest>;
