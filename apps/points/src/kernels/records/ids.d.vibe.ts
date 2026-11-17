import { Effect, Schema } from "effect";
import { type Award, type Journal, type KeyParts, type Revision, type RevisionBody } from "./canonical.ts";
declare const JournalBytesDiffer_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "JournalBytesDiffer";
} & Readonly<A>;
export declare class JournalBytesDiffer extends JournalBytesDiffer_base {
}
declare const RevisionMismatch_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "RevisionMismatch";
} & Readonly<A>;
export declare class RevisionMismatch extends RevisionMismatch_base<{
    readonly id: string;
    readonly check: string;
}> {
}
declare const CoverageUnordered_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "CoverageUnordered";
} & Readonly<A>;
export declare class CoverageUnordered extends CoverageUnordered_base<{
    readonly repository: string;
}> {
}
export declare function pointKey(parts: KeyParts): Effect.Effect<string, never, import("vibelang-runtime/experimental/Crypto").Crypto>;
export declare function pointRevisionId(body: RevisionBody): Effect.Effect<string, never, import("vibelang-runtime/experimental/Crypto").Crypto>;
export declare function batchDigest(journal: Journal): Effect.Effect<string, never, import("vibelang-runtime/experimental/Crypto").Crypto>;
export declare function awardKeyHolds(award: Award): Effect.Effect<boolean, never, import("vibelang-runtime/experimental/Crypto").Crypto>;
export declare function storedRevision(stored: {
    text: string;
    prior: Revision | null;
    asOf: string;
}): Effect.Effect<{
    readonly id: string;
    readonly previous: string | null;
    readonly recordedAt: string;
    readonly sourceDigest: string;
    readonly sourceRule: string;
    readonly award: {
        readonly key: string;
        readonly actor: {
            readonly id: string;
            readonly login: string;
        };
        readonly projectId: string;
        readonly category: "evaluated-contribution" | "evidence" | "material-test-change" | "merged-pull-request" | "payout-received" | "resolved-issue" | "slopbot-penalty" | "substantive-review";
        readonly amount: number;
        readonly occurredAt: string;
        readonly sourceId: string;
        readonly sourceUrl: string;
        readonly workUnitId: string;
        readonly provisional: boolean;
    };
    readonly penalty?: {
        readonly category: string;
        readonly debit: number;
        readonly reversedAt: string | null;
        readonly reversal: "appeal_upheld" | "maintainer_reopen" | null;
    } | undefined;
    readonly decision?: {
        readonly sourceId: string;
        readonly effectiveAt: string;
        readonly reason: string;
        readonly delta: number;
    } | undefined;
}, RevisionMismatch | Schema.SchemaError, import("vibelang-runtime/experimental/Crypto").Crypto>;
export declare function journalFile(text: string): Effect.Effect<{
    readonly schemaVersion: "1";
    readonly ruleVersion: "slop-points-v1";
    readonly generatedAt: string;
    readonly coverage: readonly {
        readonly repository: string;
        readonly from: string;
        readonly to: string;
        readonly digest: string;
    }[];
    readonly revisions: readonly {
        readonly id: string;
        readonly previous: string | null;
        readonly recordedAt: string;
        readonly sourceDigest: string;
        readonly sourceRule: string;
        readonly award: {
            readonly key: string;
            readonly actor: {
                readonly id: string;
                readonly login: string;
            };
            readonly projectId: string;
            readonly category: "evaluated-contribution" | "evidence" | "material-test-change" | "merged-pull-request" | "payout-received" | "resolved-issue" | "slopbot-penalty" | "substantive-review";
            readonly amount: number;
            readonly occurredAt: string;
            readonly sourceId: string;
            readonly sourceUrl: string;
            readonly workUnitId: string;
            readonly provisional: boolean;
        };
        readonly penalty?: {
            readonly category: string;
            readonly debit: number;
            readonly reversedAt: string | null;
            readonly reversal: "appeal_upheld" | "maintainer_reopen" | null;
        } | undefined;
        readonly decision?: {
            readonly sourceId: string;
            readonly effectiveAt: string;
            readonly reason: string;
            readonly delta: number;
        } | undefined;
    }[];
}, CoverageUnordered | JournalBytesDiffer | RevisionMismatch | Schema.SchemaError, import("vibelang-runtime/experimental/Crypto").Crypto>;
export {};
