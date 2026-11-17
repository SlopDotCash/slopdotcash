import { Schema } from "effect";
import { type AnyRoute } from "@repo/platform/route";
export declare const RecoveryScope: Schema.Literals<readonly ["ordinary", "security-bounty"]>;
export type RecoveryScope = typeof RecoveryScope.Type;
export declare const RecoveryRequest: Schema.Struct<{
    readonly scope: Schema.Literals<readonly ["ordinary", "security-bounty"]>;
    readonly network: Schema.String;
    readonly vault: Schema.String;
    readonly originalTransactionId: Schema.String;
    readonly winnerTransactionId: Schema.String;
    readonly reason: Schema.String;
    readonly auditRequestId: Schema.String;
}>;
export type RecoveryRequest = typeof RecoveryRequest.Type;
export declare const RecoveryAnswer: Schema.Struct<{
    readonly state: Schema.String;
    readonly originalTransactionId: Schema.String;
    readonly winnerTransactionId: Schema.String;
    readonly blockHash: Schema.String;
    readonly blockNumber: Schema.String;
}>;
export type RecoveryAnswer = typeof RecoveryAnswer.Type;
export declare const reconcileBindingRoute: import("@repo/platform/route").Route<{
    readonly [x: string]: unknown;
}, {
    readonly state: string;
    readonly originalTransactionId: string;
    readonly winnerTransactionId: string;
    readonly blockHash: string;
    readonly blockNumber: string;
}, "sessionWrite">;
export declare const operatorApi: ReadonlyArray<AnyRoute>;
