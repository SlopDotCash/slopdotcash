import { Schema } from "effect";
import { type AnyRoute } from "@repo/platform/route";
export declare const QueuedScan: Schema.Struct<{
    readonly assessmentId: Schema.mutableKey<Schema.String>;
    readonly projectId: Schema.mutableKey<Schema.String>;
    readonly revision: Schema.mutableKey<Schema.Number>;
    readonly manifestSha256: Schema.mutableKey<Schema.String>;
    readonly repository: Schema.mutableKey<Schema.String>;
    readonly commitSha: Schema.mutableKey<Schema.String>;
    readonly templateSha256: Schema.mutableKey<Schema.String>;
    readonly manifestUrl: Schema.mutableKey<Schema.String>;
    readonly templateIndexUrl: Schema.mutableKey<Schema.String>;
    readonly requestedAt: Schema.mutableKey<Schema.String>;
}>;
export type QueuedScan = typeof QueuedScan.Type;
export declare const ScanQueue: Schema.Struct<{
    readonly schemaVersion: Schema.mutableKey<Schema.Literal<"slop-vetting-queue-v1">>;
    readonly assessments: Schema.mutableKey<Schema.$Array<Schema.Struct<{
        readonly assessmentId: Schema.mutableKey<Schema.String>;
        readonly projectId: Schema.mutableKey<Schema.String>;
        readonly revision: Schema.mutableKey<Schema.Number>;
        readonly manifestSha256: Schema.mutableKey<Schema.String>;
        readonly repository: Schema.mutableKey<Schema.String>;
        readonly commitSha: Schema.mutableKey<Schema.String>;
        readonly templateSha256: Schema.mutableKey<Schema.String>;
        readonly manifestUrl: Schema.mutableKey<Schema.String>;
        readonly templateIndexUrl: Schema.mutableKey<Schema.String>;
        readonly requestedAt: Schema.mutableKey<Schema.String>;
    }>>>;
}>;
export type ScanQueue = typeof ScanQueue.Type;
export declare const ModelRun: Schema.Struct<{
    readonly reviewer: Schema.mutableKey<Schema.String>;
    readonly provider: Schema.mutableKey<Schema.String>;
    readonly model: Schema.mutableKey<Schema.String>;
}>;
export type ModelRun = typeof ModelRun.Type;
export declare const AssessmentSummary: Schema.Struct<{
    readonly id: Schema.String;
    readonly revision: Schema.Number;
    readonly state: Schema.Literals<readonly ["pending", "clean", "incomplete", "malicious"]>;
    readonly commitSha: Schema.String;
    readonly templateSha256: Schema.String;
    readonly policyVersion: Schema.NullOr<Schema.String>;
    readonly requestedAt: Schema.String;
    readonly completedAt: Schema.NullOr<Schema.String>;
    readonly modelRuns: Schema.$Array<Schema.Struct<{
        readonly reviewer: Schema.mutableKey<Schema.String>;
        readonly provider: Schema.mutableKey<Schema.String>;
        readonly model: Schema.mutableKey<Schema.String>;
    }>>;
    readonly artifacts: Schema.Number;
    readonly heldArtifacts: Schema.Number;
    readonly findingsLocation: Schema.optionalKey<Schema.Literals<readonly ["repository", "template", "both", "unknown"]>>;
    readonly scan: Schema.optionalKey<Schema.Struct<{
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
    }>>;
}>;
export declare const SetupRetry: Schema.Struct<{
    readonly state: Schema.mutableKey<Schema.Literal<"retry">>;
    readonly message: Schema.mutableKey<Schema.String>;
}>;
export type SetupRetry = typeof SetupRetry.Type;
export declare const RecordedAssessment: Schema.Struct<{
    readonly setup: Schema.NullOr<Schema.Struct<{
        readonly state: Schema.mutableKey<Schema.Literal<"retry">>;
        readonly message: Schema.mutableKey<Schema.String>;
    }>>;
    readonly assessment: Schema.Struct<{
        readonly id: Schema.String;
        readonly revision: Schema.Number;
        readonly state: Schema.Literals<readonly ["pending", "clean", "incomplete", "malicious"]>;
        readonly commitSha: Schema.String;
        readonly templateSha256: Schema.String;
        readonly policyVersion: Schema.NullOr<Schema.String>;
        readonly requestedAt: Schema.String;
        readonly completedAt: Schema.NullOr<Schema.String>;
        readonly modelRuns: Schema.$Array<Schema.Struct<{
            readonly reviewer: Schema.mutableKey<Schema.String>;
            readonly provider: Schema.mutableKey<Schema.String>;
            readonly model: Schema.mutableKey<Schema.String>;
        }>>;
        readonly artifacts: Schema.Number;
        readonly heldArtifacts: Schema.Number;
        readonly findingsLocation: Schema.optionalKey<Schema.Literals<readonly ["repository", "template", "both", "unknown"]>>;
        readonly scan: Schema.optionalKey<Schema.Struct<{
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
        }>>;
        readonly resultSha256: Schema.NullOr<Schema.String>;
    }>;
}>;
export declare const AdminAssessment: Schema.Struct<{
    readonly id: Schema.String;
    readonly revision: Schema.Number;
    readonly state: Schema.Literals<readonly ["pending", "clean", "incomplete", "malicious"]>;
    readonly commitSha: Schema.String;
    readonly templateSha256: Schema.String;
    readonly policyVersion: Schema.NullOr<Schema.String>;
    readonly requestedAt: Schema.String;
    readonly completedAt: Schema.NullOr<Schema.String>;
    readonly modelRuns: Schema.$Array<Schema.Struct<{
        readonly reviewer: Schema.mutableKey<Schema.String>;
        readonly provider: Schema.mutableKey<Schema.String>;
        readonly model: Schema.mutableKey<Schema.String>;
    }>>;
    readonly artifacts: Schema.Number;
    readonly heldArtifacts: Schema.Number;
    readonly findingsLocation: Schema.optionalKey<Schema.Literals<readonly ["repository", "template", "both", "unknown"]>>;
    readonly scan: Schema.optionalKey<Schema.Struct<{
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
    }>>;
    readonly projectId: Schema.String;
    readonly manifestSha256: Schema.String;
    readonly requestedBy: Schema.Struct<{
        readonly githubId: Schema.String;
        readonly githubLogin: Schema.String;
    }>;
    readonly requestReason: Schema.String;
    readonly resultSha256: Schema.NullOr<Schema.String>;
    readonly signingKeySha256: Schema.NullOr<Schema.String>;
    readonly result: Schema.Unknown;
}>;
export declare const QueuedAssessments: Schema.Struct<{
    readonly assessment: Schema.Struct<{
        readonly id: Schema.String;
        readonly revision: Schema.Number;
        readonly state: Schema.Literals<readonly ["pending", "clean", "incomplete", "malicious"]>;
        readonly commitSha: Schema.String;
        readonly templateSha256: Schema.String;
        readonly policyVersion: Schema.NullOr<Schema.String>;
        readonly requestedAt: Schema.String;
        readonly completedAt: Schema.NullOr<Schema.String>;
        readonly modelRuns: Schema.$Array<Schema.Struct<{
            readonly reviewer: Schema.mutableKey<Schema.String>;
            readonly provider: Schema.mutableKey<Schema.String>;
            readonly model: Schema.mutableKey<Schema.String>;
        }>>;
        readonly artifacts: Schema.Number;
        readonly heldArtifacts: Schema.Number;
        readonly findingsLocation: Schema.optionalKey<Schema.Literals<readonly ["repository", "template", "both", "unknown"]>>;
        readonly scan: Schema.optionalKey<Schema.Struct<{
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
        }>>;
        readonly projectId: Schema.String;
        readonly manifestSha256: Schema.String;
        readonly requestedBy: Schema.Struct<{
            readonly githubId: Schema.String;
            readonly githubLogin: Schema.String;
        }>;
        readonly requestReason: Schema.String;
        readonly resultSha256: Schema.NullOr<Schema.String>;
        readonly signingKeySha256: Schema.NullOr<Schema.String>;
        readonly result: Schema.Unknown;
    }>;
    readonly assessments: Schema.optionalKey<Schema.$Array<Schema.Struct<{
        readonly id: Schema.String;
        readonly revision: Schema.Number;
        readonly state: Schema.Literals<readonly ["pending", "clean", "incomplete", "malicious"]>;
        readonly commitSha: Schema.String;
        readonly templateSha256: Schema.String;
        readonly policyVersion: Schema.NullOr<Schema.String>;
        readonly requestedAt: Schema.String;
        readonly completedAt: Schema.NullOr<Schema.String>;
        readonly modelRuns: Schema.$Array<Schema.Struct<{
            readonly reviewer: Schema.mutableKey<Schema.String>;
            readonly provider: Schema.mutableKey<Schema.String>;
            readonly model: Schema.mutableKey<Schema.String>;
        }>>;
        readonly artifacts: Schema.Number;
        readonly heldArtifacts: Schema.Number;
        readonly findingsLocation: Schema.optionalKey<Schema.Literals<readonly ["repository", "template", "both", "unknown"]>>;
        readonly scan: Schema.optionalKey<Schema.Struct<{
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
        }>>;
        readonly projectId: Schema.String;
        readonly manifestSha256: Schema.String;
        readonly requestedBy: Schema.Struct<{
            readonly githubId: Schema.String;
            readonly githubLogin: Schema.String;
        }>;
        readonly requestReason: Schema.String;
        readonly resultSha256: Schema.NullOr<Schema.String>;
        readonly signingKeySha256: Schema.NullOr<Schema.String>;
        readonly result: Schema.Unknown;
    }>>>;
}>;
export declare const ReuseAnswer: Schema.Struct<{
    readonly schemaVersion: Schema.Literal<"slop-vetting-reuse-v1">;
    readonly result: Schema.Unknown;
}>;
export declare const JournalPresence: Schema.Struct<{
    readonly schemaVersion: Schema.mutableKey<Schema.Literal<"slop-vetting-journal-v1">>;
    readonly present: Schema.mutableKey<Schema.Boolean>;
}>;
export type JournalPresence = typeof JournalPresence.Type;
export declare const JournalReserved: Schema.Struct<{
    readonly schemaVersion: Schema.mutableKey<Schema.Literal<"slop-vetting-journal-v1">>;
    readonly reserved: Schema.mutableKey<Schema.Literal<true>>;
}>;
export type JournalReserved = typeof JournalReserved.Type;
export declare const JournalRecorded: Schema.Struct<{
    readonly schemaVersion: Schema.mutableKey<Schema.Literal<"slop-vetting-journal-v1">>;
    readonly recorded: Schema.mutableKey<Schema.Literal<true>>;
}>;
export type JournalRecorded = typeof JournalRecorded.Type;
export declare const JournalAnswer: Schema.Union<readonly [Schema.Struct<{
    readonly schemaVersion: Schema.mutableKey<Schema.Literal<"slop-vetting-journal-v1">>;
    readonly present: Schema.mutableKey<Schema.Boolean>;
}>, Schema.Struct<{
    readonly schemaVersion: Schema.mutableKey<Schema.Literal<"slop-vetting-journal-v1">>;
    readonly reserved: Schema.mutableKey<Schema.Literal<true>>;
}>, Schema.Struct<{
    readonly schemaVersion: Schema.mutableKey<Schema.Literal<"slop-vetting-journal-v1">>;
    readonly recorded: Schema.mutableKey<Schema.Literal<true>>;
}>]>;
export declare const Skipped: Schema.Struct<{
    readonly projectId: Schema.mutableKey<Schema.String>;
    readonly reason: Schema.mutableKey<Schema.String>;
}>;
export type Skipped = typeof Skipped.Type;
export declare const Refreshed: Schema.Struct<{
    readonly queued: Schema.mutableKey<Schema.$Array<Schema.String>>;
    readonly reinstated: Schema.mutableKey<Schema.$Array<Schema.String>>;
    readonly skipped: Schema.mutableKey<Schema.$Array<Schema.Struct<{
        readonly projectId: Schema.mutableKey<Schema.String>;
        readonly reason: Schema.mutableKey<Schema.String>;
    }>>>;
}>;
export type Refreshed = typeof Refreshed.Type;
export declare const scanRequests: import("@repo/platform/route").Route<undefined, {
    schemaVersion: "slop-vetting-queue-v1";
    assessments: readonly {
        assessmentId: string;
        projectId: string;
        revision: number;
        manifestSha256: string;
        repository: string;
        commitSha: string;
        templateSha256: string;
        manifestUrl: string;
        templateIndexUrl: string;
        requestedAt: string;
    }[];
}, "service">;
export declare const scanResults: import("@repo/platform/route").Route<undefined, {
    readonly setup: {
        state: "retry";
        message: string;
    } | null;
    readonly assessment: {
        readonly id: string;
        readonly revision: number;
        readonly state: "clean" | "incomplete" | "malicious" | "pending";
        readonly commitSha: string;
        readonly templateSha256: string;
        readonly policyVersion: string | null;
        readonly requestedAt: string;
        readonly completedAt: string | null;
        readonly modelRuns: readonly {
            reviewer: string;
            provider: string;
            model: string;
        }[];
        readonly artifacts: number;
        readonly heldArtifacts: number;
        readonly findingsLocation?: "both" | "repository" | "template" | "unknown" | undefined;
        readonly scan?: {
            flaggedChecks: readonly string[];
            checksNotRun: readonly string[];
            incompleteSurfaces: readonly {
                surface: string;
                state: "partial" | "unsupported";
            }[];
            visibilityGaps: readonly string[];
            openFindings: readonly {
                category: string;
                count: number;
            }[];
            review: {
                primary: {
                    status: "completed" | "failed" | "not-started" | "unavailable";
                    verdict: "findings" | "malicious-suspected" | "no-findings" | null;
                    risk: "ambiguous" | "high" | "low" | null;
                };
                specialist: {
                    status: "completed" | "failed" | "not-started" | "unavailable";
                    verdict: "findings" | "malicious-suspected" | "no-findings" | null;
                    risk: "ambiguous" | "high" | "low" | null;
                } | null;
                escalated: boolean;
            };
        } | undefined;
        readonly resultSha256: string | null;
    };
}, "service">;
export declare const scanReuse: import("@repo/platform/route").Route<undefined, {
    readonly schemaVersion: "slop-vetting-reuse-v1";
    readonly result: unknown;
}, "service">;
export declare const scanJournal: import("@repo/platform/route").Route<undefined, {
    schemaVersion: "slop-vetting-journal-v1";
    present: boolean;
} | {
    schemaVersion: "slop-vetting-journal-v1";
    reserved: true;
} | {
    schemaVersion: "slop-vetting-journal-v1";
    recorded: true;
}, "service">;
export declare const scanRefresh: import("@repo/platform/route").Route<undefined, {
    queued: readonly string[];
    reinstated: readonly string[];
    skipped: readonly {
        projectId: string;
        reason: string;
    }[];
}, "service">;
export declare const sandboxHealth: import("@repo/platform/route").Route<undefined, unknown, "service">;
export declare const sandboxRun: import("@repo/platform/route").Route<undefined, unknown, "service">;
export declare const OverviewRepository: Schema.Struct<{
    readonly id: Schema.mutableKey<Schema.String>;
    readonly githubId: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
}>;
export type OverviewRepository = typeof OverviewRepository.Type;
export declare const OverviewProject: Schema.Struct<{
    readonly id: Schema.String;
    readonly name: Schema.String;
    readonly status: Schema.Literals<readonly ["active", "paused"]>;
    readonly revision: Schema.Number;
    readonly repositories: Schema.optionalKey<Schema.$Array<Schema.Struct<{
        readonly id: Schema.mutableKey<Schema.String>;
        readonly githubId: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
    }>>>;
    readonly clearance: Schema.NullOr<Schema.Struct<{
        readonly state: Schema.mutableKey<Schema.String>;
        readonly repositories: Schema.mutableKey<Schema.$Array<Schema.Struct<{
            readonly repositoryId: Schema.mutableKey<Schema.String>;
            readonly state: Schema.mutableKey<Schema.String>;
            readonly basis: Schema.mutableKey<Schema.String>;
        }>>>;
    }>>;
}>;
export declare const ServiceAvailable: Schema.Struct<{
    readonly state: Schema.mutableKey<Schema.Literal<"available">>;
    readonly queueRegistrationAvailable: Schema.mutableKey<Schema.Literal<true>>;
}>;
export type ServiceAvailable = typeof ServiceAvailable.Type;
export declare const ServiceUnavailable: Schema.Struct<{
    readonly state: Schema.mutableKey<Schema.Literal<"unavailable">>;
    readonly queueRegistrationAvailable: Schema.mutableKey<Schema.Boolean>;
    readonly reason: Schema.mutableKey<Schema.String>;
}>;
export type ServiceUnavailable = typeof ServiceUnavailable.Type;
export declare const FlagReporter: Schema.Struct<{
    readonly githubId: Schema.mutableKey<Schema.String>;
    readonly githubLogin: Schema.mutableKey<Schema.String>;
}>;
export type FlagReporter = typeof FlagReporter.Type;
export declare const OverviewFlag: Schema.Struct<{
    readonly id: Schema.mutableKey<Schema.String>;
    readonly projectId: Schema.mutableKey<Schema.String>;
    readonly reporter: Schema.mutableKey<Schema.Struct<{
        readonly githubId: Schema.mutableKey<Schema.String>;
        readonly githubLogin: Schema.mutableKey<Schema.String>;
    }>>;
    readonly revision: Schema.mutableKey<Schema.Number>;
    readonly category: Schema.mutableKey<Schema.String>;
    readonly evidence: Schema.mutableKey<Schema.String>;
    readonly evidenceUrl: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
    readonly createdAt: Schema.mutableKey<Schema.String>;
    readonly state: Schema.mutableKey<Schema.Literal<"active">>;
    readonly closedAt: Schema.mutableKey<Schema.Null>;
    readonly closedBy: Schema.mutableKey<Schema.Null>;
    readonly closedReference: Schema.mutableKey<Schema.Null>;
}>;
export type OverviewFlag = typeof OverviewFlag.Type;
export declare const VettingOverview: Schema.Struct<{
    readonly projects: Schema.$Array<Schema.Struct<{
        readonly id: Schema.String;
        readonly name: Schema.String;
        readonly status: Schema.Literals<readonly ["active", "paused"]>;
        readonly revision: Schema.Number;
        readonly repositories: Schema.optionalKey<Schema.$Array<Schema.Struct<{
            readonly id: Schema.mutableKey<Schema.String>;
            readonly githubId: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
        }>>>;
        readonly clearance: Schema.NullOr<Schema.Struct<{
            readonly state: Schema.mutableKey<Schema.String>;
            readonly repositories: Schema.mutableKey<Schema.$Array<Schema.Struct<{
                readonly repositoryId: Schema.mutableKey<Schema.String>;
                readonly state: Schema.mutableKey<Schema.String>;
                readonly basis: Schema.mutableKey<Schema.String>;
            }>>>;
        }>>;
    }>>;
    readonly service: Schema.Union<readonly [Schema.Struct<{
        readonly state: Schema.mutableKey<Schema.Literal<"available">>;
        readonly queueRegistrationAvailable: Schema.mutableKey<Schema.Literal<true>>;
    }>, Schema.Struct<{
        readonly state: Schema.mutableKey<Schema.Literal<"unavailable">>;
        readonly queueRegistrationAvailable: Schema.mutableKey<Schema.Boolean>;
        readonly reason: Schema.mutableKey<Schema.String>;
    }>]>;
    readonly assessments: Schema.$Array<Schema.Struct<{
        readonly id: Schema.String;
        readonly revision: Schema.Number;
        readonly state: Schema.Literals<readonly ["pending", "clean", "incomplete", "malicious"]>;
        readonly commitSha: Schema.String;
        readonly templateSha256: Schema.String;
        readonly policyVersion: Schema.NullOr<Schema.String>;
        readonly requestedAt: Schema.String;
        readonly completedAt: Schema.NullOr<Schema.String>;
        readonly modelRuns: Schema.$Array<Schema.Struct<{
            readonly reviewer: Schema.mutableKey<Schema.String>;
            readonly provider: Schema.mutableKey<Schema.String>;
            readonly model: Schema.mutableKey<Schema.String>;
        }>>;
        readonly artifacts: Schema.Number;
        readonly heldArtifacts: Schema.Number;
        readonly findingsLocation: Schema.optionalKey<Schema.Literals<readonly ["repository", "template", "both", "unknown"]>>;
        readonly scan: Schema.optionalKey<Schema.Struct<{
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
        }>>;
        readonly projectId: Schema.String;
        readonly manifestSha256: Schema.String;
        readonly requestedBy: Schema.Struct<{
            readonly githubId: Schema.String;
            readonly githubLogin: Schema.String;
        }>;
        readonly requestReason: Schema.String;
        readonly resultSha256: Schema.NullOr<Schema.String>;
        readonly signingKeySha256: Schema.NullOr<Schema.String>;
        readonly result: Schema.Unknown;
    }>>;
    readonly exemptions: Schema.$Array<Schema.Struct<{
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
    readonly flags: Schema.$Array<Schema.Struct<{
        readonly id: Schema.mutableKey<Schema.String>;
        readonly projectId: Schema.mutableKey<Schema.String>;
        readonly reporter: Schema.mutableKey<Schema.Struct<{
            readonly githubId: Schema.mutableKey<Schema.String>;
            readonly githubLogin: Schema.mutableKey<Schema.String>;
        }>>;
        readonly revision: Schema.mutableKey<Schema.Number>;
        readonly category: Schema.mutableKey<Schema.String>;
        readonly evidence: Schema.mutableKey<Schema.String>;
        readonly evidenceUrl: Schema.mutableKey<Schema.Union<readonly [Schema.String, Schema.Null]>>;
        readonly createdAt: Schema.mutableKey<Schema.String>;
        readonly state: Schema.mutableKey<Schema.Literal<"active">>;
        readonly closedAt: Schema.mutableKey<Schema.Null>;
        readonly closedBy: Schema.mutableKey<Schema.Null>;
        readonly closedReference: Schema.mutableKey<Schema.Null>;
    }>>;
}>;
export declare const vettingOverview: import("@repo/platform/route").Route<undefined, {
    readonly projects: readonly {
        readonly id: string;
        readonly name: string;
        readonly status: "active" | "paused";
        readonly revision: number;
        readonly repositories?: readonly {
            id: string;
            githubId: string | null;
        }[] | undefined;
        readonly clearance: {
            state: string;
            repositories: readonly {
                repositoryId: string;
                state: string;
                basis: string;
            }[];
        } | null;
    }[];
    readonly service: {
        state: "available";
        queueRegistrationAvailable: true;
    } | {
        state: "unavailable";
        queueRegistrationAvailable: boolean;
        reason: string;
    };
    readonly assessments: readonly {
        readonly id: string;
        readonly revision: number;
        readonly state: "clean" | "incomplete" | "malicious" | "pending";
        readonly commitSha: string;
        readonly templateSha256: string;
        readonly policyVersion: string | null;
        readonly requestedAt: string;
        readonly completedAt: string | null;
        readonly modelRuns: readonly {
            reviewer: string;
            provider: string;
            model: string;
        }[];
        readonly artifacts: number;
        readonly heldArtifacts: number;
        readonly findingsLocation?: "both" | "repository" | "template" | "unknown" | undefined;
        readonly scan?: {
            flaggedChecks: readonly string[];
            checksNotRun: readonly string[];
            incompleteSurfaces: readonly {
                surface: string;
                state: "partial" | "unsupported";
            }[];
            visibilityGaps: readonly string[];
            openFindings: readonly {
                category: string;
                count: number;
            }[];
            review: {
                primary: {
                    status: "completed" | "failed" | "not-started" | "unavailable";
                    verdict: "findings" | "malicious-suspected" | "no-findings" | null;
                    risk: "ambiguous" | "high" | "low" | null;
                };
                specialist: {
                    status: "completed" | "failed" | "not-started" | "unavailable";
                    verdict: "findings" | "malicious-suspected" | "no-findings" | null;
                    risk: "ambiguous" | "high" | "low" | null;
                } | null;
                escalated: boolean;
            };
        } | undefined;
        readonly projectId: string;
        readonly manifestSha256: string;
        readonly requestedBy: {
            readonly githubId: string;
            readonly githubLogin: string;
        };
        readonly requestReason: string;
        readonly resultSha256: string | null;
        readonly signingKeySha256: string | null;
        readonly result: unknown;
    }[];
    readonly exemptions: readonly {
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
    }[];
    readonly flags: readonly {
        id: string;
        projectId: string;
        reporter: {
            githubId: string;
            githubLogin: string;
        };
        revision: number;
        category: string;
        evidence: string;
        evidenceUrl: string | null;
        createdAt: string;
        state: "active";
        closedAt: null;
        closedBy: null;
        closedReference: null;
    }[];
}, "session">;
export declare const queueAssessment: import("@repo/platform/route").Route<undefined, {
    readonly assessment: {
        readonly id: string;
        readonly revision: number;
        readonly state: "clean" | "incomplete" | "malicious" | "pending";
        readonly commitSha: string;
        readonly templateSha256: string;
        readonly policyVersion: string | null;
        readonly requestedAt: string;
        readonly completedAt: string | null;
        readonly modelRuns: readonly {
            reviewer: string;
            provider: string;
            model: string;
        }[];
        readonly artifacts: number;
        readonly heldArtifacts: number;
        readonly findingsLocation?: "both" | "repository" | "template" | "unknown" | undefined;
        readonly scan?: {
            flaggedChecks: readonly string[];
            checksNotRun: readonly string[];
            incompleteSurfaces: readonly {
                surface: string;
                state: "partial" | "unsupported";
            }[];
            visibilityGaps: readonly string[];
            openFindings: readonly {
                category: string;
                count: number;
            }[];
            review: {
                primary: {
                    status: "completed" | "failed" | "not-started" | "unavailable";
                    verdict: "findings" | "malicious-suspected" | "no-findings" | null;
                    risk: "ambiguous" | "high" | "low" | null;
                };
                specialist: {
                    status: "completed" | "failed" | "not-started" | "unavailable";
                    verdict: "findings" | "malicious-suspected" | "no-findings" | null;
                    risk: "ambiguous" | "high" | "low" | null;
                } | null;
                escalated: boolean;
            };
        } | undefined;
        readonly projectId: string;
        readonly manifestSha256: string;
        readonly requestedBy: {
            readonly githubId: string;
            readonly githubLogin: string;
        };
        readonly requestReason: string;
        readonly resultSha256: string | null;
        readonly signingKeySha256: string | null;
        readonly result: unknown;
    };
    readonly assessments?: readonly {
        readonly id: string;
        readonly revision: number;
        readonly state: "clean" | "incomplete" | "malicious" | "pending";
        readonly commitSha: string;
        readonly templateSha256: string;
        readonly policyVersion: string | null;
        readonly requestedAt: string;
        readonly completedAt: string | null;
        readonly modelRuns: readonly {
            reviewer: string;
            provider: string;
            model: string;
        }[];
        readonly artifacts: number;
        readonly heldArtifacts: number;
        readonly findingsLocation?: "both" | "repository" | "template" | "unknown" | undefined;
        readonly scan?: {
            flaggedChecks: readonly string[];
            checksNotRun: readonly string[];
            incompleteSurfaces: readonly {
                surface: string;
                state: "partial" | "unsupported";
            }[];
            visibilityGaps: readonly string[];
            openFindings: readonly {
                category: string;
                count: number;
            }[];
            review: {
                primary: {
                    status: "completed" | "failed" | "not-started" | "unavailable";
                    verdict: "findings" | "malicious-suspected" | "no-findings" | null;
                    risk: "ambiguous" | "high" | "low" | null;
                };
                specialist: {
                    status: "completed" | "failed" | "not-started" | "unavailable";
                    verdict: "findings" | "malicious-suspected" | "no-findings" | null;
                    risk: "ambiguous" | "high" | "low" | null;
                } | null;
                escalated: boolean;
            };
        } | undefined;
        readonly projectId: string;
        readonly manifestSha256: string;
        readonly requestedBy: {
            readonly githubId: string;
            readonly githubLogin: string;
        };
        readonly requestReason: string;
        readonly resultSha256: string | null;
        readonly signingKeySha256: string | null;
        readonly result: unknown;
    }[] | undefined;
}, "sessionWrite">;
export declare const admissionApi: ReadonlyArray<AnyRoute>;
