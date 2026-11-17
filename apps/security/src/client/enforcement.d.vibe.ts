import { Schema } from "effect";
import { type AnyRoute } from "@repo/platform/route";
export declare const PublicRestriction: Schema.Literals<readonly ["clear", "quarantined", "banned"]>;
export type PublicRestriction = typeof PublicRestriction.Type;
export declare const ReporterFlag: Schema.Struct<{
    readonly id: Schema.mutableKey<Schema.String>;
    readonly category: Schema.mutableKey<Schema.String>;
    readonly evidence: Schema.mutableKey<Schema.String>;
    readonly evidenceUrl: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
    readonly revision: Schema.mutableKey<Schema.Number>;
    readonly createdAt: Schema.mutableKey<Schema.String>;
    readonly expiresAt: Schema.mutableKey<Schema.String>;
    readonly state: Schema.mutableKey<Schema.Literals<readonly ["active", "withdrawn", "resolved", "expired"]>>;
}>;
export type ReporterFlag = typeof ReporterFlag.Type;
export declare const FlagStatus: Schema.Struct<{
    readonly projectId: Schema.mutableKey<Schema.String>;
    readonly flag: Schema.mutableKey<Schema.Union<readonly [Schema.Struct<{
        readonly id: Schema.mutableKey<Schema.String>;
        readonly category: Schema.mutableKey<Schema.String>;
        readonly evidence: Schema.mutableKey<Schema.String>;
        readonly evidenceUrl: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
        readonly revision: Schema.mutableKey<Schema.Number>;
        readonly createdAt: Schema.mutableKey<Schema.String>;
        readonly expiresAt: Schema.mutableKey<Schema.String>;
        readonly state: Schema.mutableKey<Schema.Literals<readonly ["active", "withdrawn", "resolved", "expired"]>>;
    }>, Schema.Null]>>;
    readonly restriction: Schema.mutableKey<Schema.Literals<readonly ["clear", "quarantined", "banned"]>>;
    readonly pausedByFlags: Schema.mutableKey<Schema.Boolean>;
}>;
export type FlagStatus = typeof FlagStatus.Type;
export declare const FiledFlag: Schema.Struct<{
    readonly projectId: Schema.mutableKey<Schema.String>;
    readonly flag: Schema.mutableKey<Schema.Union<readonly [Schema.Struct<{
        readonly id: Schema.mutableKey<Schema.String>;
        readonly category: Schema.mutableKey<Schema.String>;
        readonly evidence: Schema.mutableKey<Schema.String>;
        readonly evidenceUrl: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
        readonly revision: Schema.mutableKey<Schema.Number>;
        readonly createdAt: Schema.mutableKey<Schema.String>;
        readonly expiresAt: Schema.mutableKey<Schema.String>;
        readonly state: Schema.mutableKey<Schema.Literals<readonly ["active", "withdrawn", "resolved", "expired"]>>;
    }>, Schema.Null]>>;
    readonly paused: Schema.mutableKey<Schema.Boolean>;
    readonly freshScan: Schema.mutableKey<Schema.Union<readonly [Schema.Literal<"queued">, Schema.Literal<"already_queued">, Schema.Literal<"unavailable">, Schema.Null]>>;
    readonly restriction: Schema.mutableKey<Schema.Literals<readonly ["clear", "quarantined", "banned"]>>;
    readonly pausedByFlags: Schema.mutableKey<Schema.Boolean>;
}>;
export type FiledFlag = typeof FiledFlag.Type;
export declare const ExemptionActor: Schema.Struct<{
    readonly githubId: Schema.mutableKey<Schema.String>;
    readonly githubLogin: Schema.mutableKey<Schema.String>;
}>;
export type ExemptionActor = typeof ExemptionActor.Type;
export declare const AdmissionExemption: Schema.Struct<{
    readonly id: Schema.mutableKey<Schema.String>;
    readonly kind: Schema.mutableKey<Schema.Literal<"owner-approved-admission">>;
    readonly projectId: Schema.mutableKey<Schema.String>;
    readonly revision: Schema.mutableKey<Schema.Number>;
    readonly manifestSha256: Schema.mutableKey<Schema.String>;
    readonly repositoryId: Schema.mutableKey<Schema.String>;
    readonly repositoryNodeId: Schema.mutableKey<Schema.String>;
    readonly stewardId: Schema.mutableKey<Schema.String>;
    readonly stewardNodeId: Schema.mutableKey<Schema.String>;
    readonly grantedBy: Schema.mutableKey<Schema.Struct<{
        readonly githubId: Schema.mutableKey<Schema.String>;
        readonly githubLogin: Schema.mutableKey<Schema.String>;
    }>>;
    readonly grantedAt: Schema.mutableKey<Schema.String>;
    readonly reason: Schema.mutableKey<Schema.String>;
    readonly decisionReference: Schema.mutableKey<Schema.String>;
    readonly revokedAt: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
    readonly revokedBy: Schema.mutableKey<Schema.Union<readonly [Schema.Struct<{
        readonly githubId: Schema.mutableKey<Schema.String>;
        readonly githubLogin: Schema.mutableKey<Schema.String>;
    }>, Schema.Null]>>;
    readonly revocationReason: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
    readonly revocationDecisionReference: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
}>;
export type AdmissionExemption = typeof AdmissionExemption.Type;
export declare const RepositoryClearance: Schema.Struct<{
    readonly repositoryId: Schema.mutableKey<Schema.String>;
    readonly state: Schema.mutableKey<Schema.String>;
    readonly basis: Schema.mutableKey<Schema.String>;
}>;
export type RepositoryClearance = typeof RepositoryClearance.Type;
export declare const ProjectClearance: Schema.Struct<{
    readonly state: Schema.mutableKey<Schema.String>;
    readonly repositories: Schema.mutableKey<Schema.$Array<Schema.Struct<{
        readonly repositoryId: Schema.mutableKey<Schema.String>;
        readonly state: Schema.mutableKey<Schema.String>;
        readonly basis: Schema.mutableKey<Schema.String>;
    }>>>;
}>;
export type ProjectClearance = typeof ProjectClearance.Type;
export declare const ExemptionGranted: Schema.Struct<{
    readonly exemption: Schema.mutableKey<Schema.Struct<{
        readonly id: Schema.mutableKey<Schema.String>;
        readonly kind: Schema.mutableKey<Schema.Literal<"owner-approved-admission">>;
        readonly projectId: Schema.mutableKey<Schema.String>;
        readonly revision: Schema.mutableKey<Schema.Number>;
        readonly manifestSha256: Schema.mutableKey<Schema.String>;
        readonly repositoryId: Schema.mutableKey<Schema.String>;
        readonly repositoryNodeId: Schema.mutableKey<Schema.String>;
        readonly stewardId: Schema.mutableKey<Schema.String>;
        readonly stewardNodeId: Schema.mutableKey<Schema.String>;
        readonly grantedBy: Schema.mutableKey<Schema.Struct<{
            readonly githubId: Schema.mutableKey<Schema.String>;
            readonly githubLogin: Schema.mutableKey<Schema.String>;
        }>>;
        readonly grantedAt: Schema.mutableKey<Schema.String>;
        readonly reason: Schema.mutableKey<Schema.String>;
        readonly decisionReference: Schema.mutableKey<Schema.String>;
        readonly revokedAt: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
        readonly revokedBy: Schema.mutableKey<Schema.Union<readonly [Schema.Struct<{
            readonly githubId: Schema.mutableKey<Schema.String>;
            readonly githubLogin: Schema.mutableKey<Schema.String>;
        }>, Schema.Null]>>;
        readonly revocationReason: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
        readonly revocationDecisionReference: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
    }>>;
    readonly replayed: Schema.mutableKey<Schema.optional<Schema.Boolean>>;
    readonly setup: Schema.mutableKey<Schema.Null>;
    readonly clearance: Schema.mutableKey<Schema.Struct<{
        readonly state: Schema.mutableKey<Schema.String>;
        readonly repositories: Schema.mutableKey<Schema.$Array<Schema.Struct<{
            readonly repositoryId: Schema.mutableKey<Schema.String>;
            readonly state: Schema.mutableKey<Schema.String>;
            readonly basis: Schema.mutableKey<Schema.String>;
        }>>>;
    }>>;
}>;
export type ExemptionGranted = typeof ExemptionGranted.Type;
export declare const ExemptionRevoked: Schema.Struct<{
    readonly exemption: Schema.mutableKey<Schema.Struct<{
        readonly id: Schema.mutableKey<Schema.String>;
        readonly kind: Schema.mutableKey<Schema.Literal<"owner-approved-admission">>;
        readonly projectId: Schema.mutableKey<Schema.String>;
        readonly revision: Schema.mutableKey<Schema.Number>;
        readonly manifestSha256: Schema.mutableKey<Schema.String>;
        readonly repositoryId: Schema.mutableKey<Schema.String>;
        readonly repositoryNodeId: Schema.mutableKey<Schema.String>;
        readonly stewardId: Schema.mutableKey<Schema.String>;
        readonly stewardNodeId: Schema.mutableKey<Schema.String>;
        readonly grantedBy: Schema.mutableKey<Schema.Struct<{
            readonly githubId: Schema.mutableKey<Schema.String>;
            readonly githubLogin: Schema.mutableKey<Schema.String>;
        }>>;
        readonly grantedAt: Schema.mutableKey<Schema.String>;
        readonly reason: Schema.mutableKey<Schema.String>;
        readonly decisionReference: Schema.mutableKey<Schema.String>;
        readonly revokedAt: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
        readonly revokedBy: Schema.mutableKey<Schema.Union<readonly [Schema.Struct<{
            readonly githubId: Schema.mutableKey<Schema.String>;
            readonly githubLogin: Schema.mutableKey<Schema.String>;
        }>, Schema.Null]>>;
        readonly revocationReason: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
        readonly revocationDecisionReference: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
    }>>;
    readonly replayed: Schema.mutableKey<Schema.optional<Schema.Boolean>>;
    readonly setup: Schema.mutableKey<Schema.optional<Schema.Null>>;
}>;
export type ExemptionRevoked = typeof ExemptionRevoked.Type;
export declare const projectFlag: import("@repo/platform/route").Route<undefined, {
    projectId: string;
    flag: {
        id: string;
        category: string;
        evidence: string;
        evidenceUrl: string | null;
        revision: number;
        createdAt: string;
        expiresAt: string;
        state: "active" | "expired" | "resolved" | "withdrawn";
    } | null;
    restriction: "banned" | "clear" | "quarantined";
    pausedByFlags: boolean;
}, "session">;
export declare const fileFlag: import("@repo/platform/route").Route<undefined, {
    projectId: string;
    flag: {
        id: string;
        category: string;
        evidence: string;
        evidenceUrl: string | null;
        revision: number;
        createdAt: string;
        expiresAt: string;
        state: "active" | "expired" | "resolved" | "withdrawn";
    } | null;
    paused: boolean;
    freshScan: "already_queued" | "queued" | "unavailable" | null;
    restriction: "banned" | "clear" | "quarantined";
    pausedByFlags: boolean;
}, "sessionWrite">;
export declare const withdrawFlag: import("@repo/platform/route").Route<undefined, {
    projectId: string;
    flag: {
        id: string;
        category: string;
        evidence: string;
        evidenceUrl: string | null;
        revision: number;
        createdAt: string;
        expiresAt: string;
        state: "active" | "expired" | "resolved" | "withdrawn";
    } | null;
    restriction: "banned" | "clear" | "quarantined";
    pausedByFlags: boolean;
}, "sessionWrite">;
export declare const grantExemption: import("@repo/platform/route").Route<undefined, {
    exemption: {
        id: string;
        kind: "owner-approved-admission";
        projectId: string;
        revision: number;
        manifestSha256: string;
        repositoryId: string;
        repositoryNodeId: string;
        stewardId: string;
        stewardNodeId: string;
        grantedBy: {
            githubId: string;
            githubLogin: string;
        };
        grantedAt: string;
        reason: string;
        decisionReference: string;
        revokedAt: string | null;
        revokedBy: {
            githubId: string;
            githubLogin: string;
        } | null;
        revocationReason: string | null;
        revocationDecisionReference: string | null;
    };
    replayed?: boolean | undefined;
    setup: null;
    clearance: {
        state: string;
        repositories: readonly {
            repositoryId: string;
            state: string;
            basis: string;
        }[];
    };
}, "sessionWrite">;
export declare const revokeExemption: import("@repo/platform/route").Route<undefined, {
    exemption: {
        id: string;
        kind: "owner-approved-admission";
        projectId: string;
        revision: number;
        manifestSha256: string;
        repositoryId: string;
        repositoryNodeId: string;
        stewardId: string;
        stewardNodeId: string;
        grantedBy: {
            githubId: string;
            githubLogin: string;
        };
        grantedAt: string;
        reason: string;
        decisionReference: string;
        revokedAt: string | null;
        revokedBy: {
            githubId: string;
            githubLogin: string;
        } | null;
        revocationReason: string | null;
        revocationDecisionReference: string | null;
    };
    replayed?: boolean | undefined;
    setup?: null | undefined;
}, "sessionWrite">;
export declare const enforcementApi: ReadonlyArray<AnyRoute>;
export declare const ScanReviewOutcome: Schema.Struct<{
    readonly status: Schema.mutableKey<Schema.Literals<readonly ["completed", "unavailable", "failed", "not-started"]>>;
    readonly verdict: Schema.mutableKey<Schema.Union<readonly [Schema.Literal<"no-findings">, Schema.Literal<"findings">, Schema.Literal<"malicious-suspected">, Schema.Null]>>;
    readonly risk: Schema.mutableKey<Schema.Union<readonly [Schema.Literal<"low">, Schema.Literal<"ambiguous">, Schema.Literal<"high">, Schema.Null]>>;
}>;
export type ScanReviewOutcome = typeof ScanReviewOutcome.Type;
export declare const IncompleteSurface: Schema.Struct<{
    readonly surface: Schema.mutableKey<Schema.String>;
    readonly state: Schema.mutableKey<Schema.Literals<readonly ["partial", "unsupported"]>>;
}>;
export type IncompleteSurface = typeof IncompleteSurface.Type;
export declare const OpenFindingCount: Schema.Struct<{
    readonly category: Schema.mutableKey<Schema.String>;
    readonly count: Schema.mutableKey<Schema.Number>;
}>;
export type OpenFindingCount = typeof OpenFindingCount.Type;
export declare const ScanReviews: Schema.Struct<{
    readonly primary: Schema.mutableKey<Schema.Struct<{
        readonly status: Schema.mutableKey<Schema.Literals<readonly ["completed", "unavailable", "failed", "not-started"]>>;
        readonly verdict: Schema.mutableKey<Schema.Union<readonly [Schema.Literal<"no-findings">, Schema.Literal<"findings">, Schema.Literal<"malicious-suspected">, Schema.Null]>>;
        readonly risk: Schema.mutableKey<Schema.Union<readonly [Schema.Literal<"low">, Schema.Literal<"ambiguous">, Schema.Literal<"high">, Schema.Null]>>;
    }>>;
    readonly specialist: Schema.mutableKey<Schema.Union<readonly [Schema.Struct<{
        readonly status: Schema.mutableKey<Schema.Literals<readonly ["completed", "unavailable", "failed", "not-started"]>>;
        readonly verdict: Schema.mutableKey<Schema.Union<readonly [Schema.Literal<"no-findings">, Schema.Literal<"findings">, Schema.Literal<"malicious-suspected">, Schema.Null]>>;
        readonly risk: Schema.mutableKey<Schema.Union<readonly [Schema.Literal<"low">, Schema.Literal<"ambiguous">, Schema.Literal<"high">, Schema.Null]>>;
    }>, Schema.Null]>>;
    readonly escalated: Schema.mutableKey<Schema.Boolean>;
}>;
export type ScanReviews = typeof ScanReviews.Type;
export declare const ScanClearanceFacts: Schema.Struct<{
    readonly flaggedChecks: Schema.mutableKey<Schema.$Array<Schema.String>>;
    readonly checksNotRun: Schema.mutableKey<Schema.$Array<Schema.String>>;
    readonly incompleteSurfaces: Schema.mutableKey<Schema.$Array<Schema.Struct<{
        readonly surface: Schema.mutableKey<Schema.String>;
        readonly state: Schema.mutableKey<Schema.Literals<readonly ["partial", "unsupported"]>>;
    }>>>;
    readonly visibilityGaps: Schema.mutableKey<Schema.$Array<Schema.String>>;
    readonly openFindings: Schema.mutableKey<Schema.$Array<Schema.Struct<{
        readonly category: Schema.mutableKey<Schema.String>;
        readonly count: Schema.mutableKey<Schema.Number>;
    }>>>;
    readonly review: Schema.mutableKey<Schema.Struct<{
        readonly primary: Schema.mutableKey<Schema.Struct<{
            readonly status: Schema.mutableKey<Schema.Literals<readonly ["completed", "unavailable", "failed", "not-started"]>>;
            readonly verdict: Schema.mutableKey<Schema.Union<readonly [Schema.Literal<"no-findings">, Schema.Literal<"findings">, Schema.Literal<"malicious-suspected">, Schema.Null]>>;
            readonly risk: Schema.mutableKey<Schema.Union<readonly [Schema.Literal<"low">, Schema.Literal<"ambiguous">, Schema.Literal<"high">, Schema.Null]>>;
        }>>;
        readonly specialist: Schema.mutableKey<Schema.Union<readonly [Schema.Struct<{
            readonly status: Schema.mutableKey<Schema.Literals<readonly ["completed", "unavailable", "failed", "not-started"]>>;
            readonly verdict: Schema.mutableKey<Schema.Union<readonly [Schema.Literal<"no-findings">, Schema.Literal<"findings">, Schema.Literal<"malicious-suspected">, Schema.Null]>>;
            readonly risk: Schema.mutableKey<Schema.Union<readonly [Schema.Literal<"low">, Schema.Literal<"ambiguous">, Schema.Literal<"high">, Schema.Null]>>;
        }>, Schema.Null]>>;
        readonly escalated: Schema.mutableKey<Schema.Boolean>;
    }>>;
}>;
export type ScanClearanceFacts = typeof ScanClearanceFacts.Type;
export declare const FindingsLocation: Schema.Literals<readonly ["repository", "template", "both", "unknown"]>;
export type FindingsLocation = typeof FindingsLocation.Type;
export interface ScanClearanceInput {
    readonly state: string;
    readonly scan?: ScanClearanceFacts;
    readonly heldArtifacts: number;
    readonly findingsLocation?: FindingsLocation;
}
export type ScanClearanceTone = "success" | "warning" | "danger" | "info" | "neutral";
export type ScanClearanceIcon = "pass" | "fail" | "skip" | "partial" | "held" | "note" | "review";
export interface ScanClearanceBadge {
    readonly tone: ScanClearanceTone;
    readonly icon: ScanClearanceIcon;
    readonly label: string;
}
export interface ScanClearanceView {
    readonly checks: ReadonlyArray<ScanClearanceBadge>;
    readonly coverage: ReadonlyArray<ScanClearanceBadge>;
    readonly review: ReadonlyArray<ScanClearanceBadge>;
}
/** @throws {never} */
export declare function scanClearanceView(assessment: ScanClearanceInput): ScanClearanceView | null;
