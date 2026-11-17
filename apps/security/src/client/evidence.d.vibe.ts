import { Schema } from "effect";
import { type AnyRoute } from "@repo/platform/route";
export declare const evidencePolicy: {
    readonly version: "slop-scanner-evidence-2026-10-28";
    readonly policyAuthorityGithubId: string;
    readonly operatorGithubIds: string[];
    readonly postClosureRetentionSeconds: number;
    readonly admissionEvidenceRetention: "permanent";
    readonly readGrantDurationSeconds: 900;
    readonly objectStorage: "content-addressed";
    readonly maxPartBytes: number;
    readonly maxObjects: 1024;
    readonly accessPolicyReference: "https://github.com/SlopDotCash/slopdotcash/issues/909#issuecomment-6379712530";
    readonly retentionPolicyReference: "https://github.com/SlopDotCash/slopdotcash/issues/1467#issuecomment-6438784205";
    readonly recoveryPolicyReference: "https://github.com/SlopDotCash/slopdotcash/issues/909#issuecomment-6380038965";
};
export declare const retentionBoundary = "Access expiry is enforced here. Backups, raw-evidence deletion and legal holds are separate from this console; it does not verify or execute them.";
export declare const EvidencePolicy: Schema.Struct<{
    readonly version: Schema.mutableKey<Schema.String>;
    readonly policyAuthorityGithubId: Schema.mutableKey<Schema.String>;
    readonly operatorGithubIds: Schema.mutableKey<Schema.$Array<Schema.String>>;
    readonly postClosureRetentionSeconds: Schema.mutableKey<Schema.Number>;
    readonly admissionEvidenceRetention: Schema.mutableKey<Schema.String>;
    readonly readGrantDurationSeconds: Schema.mutableKey<Schema.Number>;
    readonly objectStorage: Schema.mutableKey<Schema.String>;
    readonly maxPartBytes: Schema.mutableKey<Schema.Number>;
    readonly maxObjects: Schema.mutableKey<Schema.Number>;
    readonly accessPolicyReference: Schema.mutableKey<Schema.String>;
    readonly retentionPolicyReference: Schema.mutableKey<Schema.String>;
    readonly recoveryPolicyReference: Schema.mutableKey<Schema.String>;
}>;
export type EvidencePolicy = typeof EvidencePolicy.Type;
export declare const Registered: Schema.Struct<{
    readonly manifestSha256: Schema.mutableKey<Schema.String>;
    readonly replayed: Schema.mutableKey<Schema.optional<Schema.Boolean>>;
    readonly stored: Schema.mutableKey<Schema.$Array<Schema.String>>;
}>;
export type Registered = typeof Registered.Type;
export declare const Uploaded: Schema.Struct<{
    readonly sha256: Schema.mutableKey<Schema.String>;
    readonly sizeBytes: Schema.mutableKey<Schema.Number>;
}>;
export type Uploaded = typeof Uploaded.Type;
export declare const ChunkUploaded: Schema.Struct<{
    readonly sha256: Schema.mutableKey<Schema.String>;
    readonly index: Schema.mutableKey<Schema.Number>;
    readonly sizeBytes: Schema.mutableKey<Schema.Number>;
}>;
export type ChunkUploaded = typeof ChunkUploaded.Type;
export declare const Finalized: Schema.Struct<{
    readonly sha256: Schema.mutableKey<Schema.String>;
    readonly sizeBytes: Schema.mutableKey<Schema.Number>;
    readonly replayed: Schema.mutableKey<Schema.Boolean>;
}>;
export type Finalized = typeof Finalized.Type;
export declare const Reason: Schema.Struct<{
    readonly reason: Schema.mutableKey<Schema.String>;
}>;
export type Reason = typeof Reason.Type;
export declare const Closed: Schema.Struct<{
    readonly assessmentId: Schema.mutableKey<Schema.String>;
    readonly closedAt: Schema.mutableKey<Schema.String>;
    readonly expiresAt: Schema.mutableKey<Schema.String>;
}>;
export type Closed = typeof Closed.Type;
export declare const Granted: Schema.Struct<{
    readonly grant: Schema.mutableKey<Schema.String>;
    readonly expiresInSeconds: Schema.mutableKey<Schema.Number>;
}>;
export type Granted = typeof Granted.Type;
export declare const DownloadGranted: Schema.Struct<{
    readonly expiresInSeconds: Schema.mutableKey<Schema.Number>;
}>;
export type DownloadGranted = typeof DownloadGranted.Type;
export declare const AssemblyView: Schema.Struct<{
    readonly retained: Schema.mutableKey<Schema.Boolean>;
    readonly state: Schema.mutableKey<Schema.String>;
    readonly scanReady: Schema.mutableKey<Schema.Boolean>;
    readonly reason: Schema.mutableKey<Schema.String>;
}>;
export type AssemblyView = typeof AssemblyView.Type;
export declare const ObjectView: Schema.Struct<{
    readonly sha256: Schema.mutableKey<Schema.String>;
    readonly sizeBytes: Schema.mutableKey<Schema.Number>;
    readonly kind: Schema.mutableKey<Schema.String>;
    readonly label: Schema.mutableKey<Schema.String>;
    readonly contentType: Schema.mutableKey<Schema.String>;
    readonly streamed: Schema.mutableKey<Schema.Boolean>;
    readonly state: Schema.mutableKey<Schema.String>;
}>;
export type ObjectView = typeof ObjectView.Type;
export declare const RunView: Schema.Struct<{
    readonly assembly: Schema.Struct<{
        readonly retained: Schema.mutableKey<Schema.Boolean>;
        readonly state: Schema.mutableKey<Schema.String>;
        readonly scanReady: Schema.mutableKey<Schema.Boolean>;
        readonly reason: Schema.mutableKey<Schema.String>;
    }>;
    readonly assessmentId: Schema.String;
    readonly runId: Schema.String;
    readonly traceSha256: Schema.String;
    readonly manifestSha256: Schema.String;
    readonly createdAt: Schema.String;
    readonly expiresAt: Schema.NullOr<Schema.String>;
    readonly permanentAdmissionEvidence: Schema.Boolean;
    readonly policy: Schema.Unknown;
    readonly objects: Schema.$Array<Schema.Struct<{
        readonly sha256: Schema.mutableKey<Schema.String>;
        readonly sizeBytes: Schema.mutableKey<Schema.Number>;
        readonly kind: Schema.mutableKey<Schema.String>;
        readonly label: Schema.mutableKey<Schema.String>;
        readonly contentType: Schema.mutableKey<Schema.String>;
        readonly streamed: Schema.mutableKey<Schema.Boolean>;
        readonly state: Schema.mutableKey<Schema.String>;
    }>>;
}>;
export declare const Overview: Schema.Struct<{
    readonly runs: Schema.$Array<Schema.Struct<{
        readonly assembly: Schema.Struct<{
            readonly retained: Schema.mutableKey<Schema.Boolean>;
            readonly state: Schema.mutableKey<Schema.String>;
            readonly scanReady: Schema.mutableKey<Schema.Boolean>;
            readonly reason: Schema.mutableKey<Schema.String>;
        }>;
        readonly assessmentId: Schema.String;
        readonly runId: Schema.String;
        readonly traceSha256: Schema.String;
        readonly manifestSha256: Schema.String;
        readonly createdAt: Schema.String;
        readonly expiresAt: Schema.NullOr<Schema.String>;
        readonly permanentAdmissionEvidence: Schema.Boolean;
        readonly policy: Schema.Unknown;
        readonly objects: Schema.$Array<Schema.Struct<{
            readonly sha256: Schema.mutableKey<Schema.String>;
            readonly sizeBytes: Schema.mutableKey<Schema.Number>;
            readonly kind: Schema.mutableKey<Schema.String>;
            readonly label: Schema.mutableKey<Schema.String>;
            readonly contentType: Schema.mutableKey<Schema.String>;
            readonly streamed: Schema.mutableKey<Schema.Boolean>;
            readonly state: Schema.mutableKey<Schema.String>;
        }>>;
    }>>;
    readonly policy: Schema.Struct<{
        readonly version: Schema.mutableKey<Schema.String>;
        readonly policyAuthorityGithubId: Schema.mutableKey<Schema.String>;
        readonly operatorGithubIds: Schema.mutableKey<Schema.$Array<Schema.String>>;
        readonly postClosureRetentionSeconds: Schema.mutableKey<Schema.Number>;
        readonly admissionEvidenceRetention: Schema.mutableKey<Schema.String>;
        readonly readGrantDurationSeconds: Schema.mutableKey<Schema.Number>;
        readonly objectStorage: Schema.mutableKey<Schema.String>;
        readonly maxPartBytes: Schema.mutableKey<Schema.Number>;
        readonly maxObjects: Schema.mutableKey<Schema.Number>;
        readonly accessPolicyReference: Schema.mutableKey<Schema.String>;
        readonly retentionPolicyReference: Schema.mutableKey<Schema.String>;
        readonly recoveryPolicyReference: Schema.mutableKey<Schema.String>;
    }>;
    readonly retentionBoundary: Schema.String;
}>;
export declare const registerEvidence: import("@repo/platform/route").Route<undefined, {
    manifestSha256: string;
    replayed?: boolean | undefined;
    stored: readonly string[];
}, "service">;
export declare const uploadEvidence: import("@repo/platform/route").Route<undefined, {
    sha256: string;
    sizeBytes: number;
}, "service">;
export declare const uploadEvidenceChunk: import("@repo/platform/route").Route<undefined, {
    sha256: string;
    index: number;
    sizeBytes: number;
}, "service">;
export declare const finalizeEvidence: import("@repo/platform/route").Route<undefined, {
    sha256: string;
    sizeBytes: number;
    replayed: boolean;
}, "service">;
export declare const evidenceOverview: import("@repo/platform/route").Route<undefined, {
    readonly runs: readonly {
        readonly assembly: {
            retained: boolean;
            state: string;
            scanReady: boolean;
            reason: string;
        };
        readonly assessmentId: string;
        readonly runId: string;
        readonly traceSha256: string;
        readonly manifestSha256: string;
        readonly createdAt: string;
        readonly expiresAt: string | null;
        readonly permanentAdmissionEvidence: boolean;
        readonly policy: unknown;
        readonly objects: readonly {
            sha256: string;
            sizeBytes: number;
            kind: string;
            label: string;
            contentType: string;
            streamed: boolean;
            state: string;
        }[];
    }[];
    readonly policy: {
        version: string;
        policyAuthorityGithubId: string;
        operatorGithubIds: readonly string[];
        postClosureRetentionSeconds: number;
        admissionEvidenceRetention: string;
        readGrantDurationSeconds: number;
        objectStorage: string;
        maxPartBytes: number;
        maxObjects: number;
        accessPolicyReference: string;
        retentionPolicyReference: string;
        recoveryPolicyReference: string;
    };
    readonly retentionBoundary: string;
}, "session">;
export declare const closeEvidenceCase: import("@repo/platform/route").Route<{
    reason: string;
}, {
    assessmentId: string;
    closedAt: string;
    expiresAt: string;
}, "sessionWrite">;
export declare const grantEvidenceRead: import("@repo/platform/route").Route<{
    reason: string;
}, {
    grant: string;
    expiresInSeconds: number;
}, "sessionWrite">;
export declare const grantEvidenceDownload: import("@repo/platform/route").Route<{
    reason: string;
}, {
    expiresInSeconds: number;
}, "sessionWrite">;
export declare const readEvidenceBody: import("@repo/platform/route").Route<undefined, unknown, "session">;
export declare const downloadEvidence: import("@repo/platform/route").Route<undefined, unknown, "public">;
export declare const downloadOtherMethods: import("@repo/platform/route").Route<undefined, unknown, "public">[];
export declare const evidenceApi: ReadonlyArray<AnyRoute>;
