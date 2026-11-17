import { Schema } from "effect";
export declare const MERGE_GIT_VERSION = "git version 2.56.0";
export declare const LEGACY_MERGE_PROFILE = "git-2.56.0-v1";
export declare const MERGE_PROFILE = "git-2.56.0-v2";
export declare const VALUE_FILE_EXPANSION_LIMIT: number;
declare const MergeRefused_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "MergeRefused";
} & Readonly<A>;
export declare class MergeRefused extends MergeRefused_base<{
    readonly reason: string;
}> {
}
export declare const MergeProfile: Schema.Literals<readonly ["git-2.56.0-v1", "git-2.56.0-v2"]>;
export type MergeProfile = typeof MergeProfile.Type;
export declare const MergeHead: Schema.Struct<{
    readonly sha: Schema.String;
}>;
export type MergeHead = typeof MergeHead.Type;
export declare const MergePull: Schema.Struct<{
    readonly head: Schema.Struct<{
        readonly sha: Schema.String;
    }>;
}>;
export type MergePull = typeof MergePull.Type;
export declare const MergeFile: Schema.Struct<{
    readonly filename: Schema.String;
}>;
export type MergeFile = typeof MergeFile.Type;
export declare const MergeCommit: Schema.Struct<{
    readonly sha: Schema.String;
    readonly parents: Schema.$Array<Schema.Struct<{
        readonly sha: Schema.String;
    }>>;
}>;
export type MergeCommit = typeof MergeCommit.Type;
export declare const MergeCommitAttribution: Schema.Struct<{
    readonly sha: Schema.String;
    readonly changedPaths: Schema.Union<readonly [Schema.$Array<Schema.String>, Schema.Null]>;
    readonly limitations: Schema.$Array<Schema.String>;
}>;
export type MergeCommitAttribution = typeof MergeCommitAttribution.Type;
export declare const MergeInput: Schema.Struct<{
    readonly repository: Schema.String;
    readonly repositoryNodeId: Schema.String;
    readonly repositoryDatabaseId: Schema.Number;
    readonly pull: Schema.Struct<{
        readonly head: Schema.Struct<{
            readonly sha: Schema.String;
        }>;
    }>;
    readonly files: Schema.$Array<Schema.Struct<{
        readonly filename: Schema.String;
    }>>;
    readonly commits: Schema.$Array<Schema.Struct<{
        readonly sha: Schema.String;
        readonly parents: Schema.$Array<Schema.Struct<{
            readonly sha: Schema.String;
        }>>;
    }>>;
    readonly commitAttribution: Schema.$Array<Schema.Struct<{
        readonly sha: Schema.String;
        readonly changedPaths: Schema.Union<readonly [Schema.$Array<Schema.String>, Schema.Null]>;
        readonly limitations: Schema.$Array<Schema.String>;
    }>>;
}>;
export type MergeInput = typeof MergeInput.Type;
export declare const MergeRelocation: Schema.Struct<{
    readonly sourceParent: Schema.String;
    readonly sourcePath: Schema.String;
    readonly path: Schema.String;
    readonly blobSha: Schema.String;
    readonly headSha: Schema.String;
    readonly sourceCommitShas: Schema.$Array<Schema.String>;
}>;
export type MergeRelocation = typeof MergeRelocation.Type;
export declare const AutomaticMergeResolution: Schema.Struct<{
    readonly kind: Schema.optional<Schema.Literal<"automatic">>;
    readonly commitSha: Schema.String;
    readonly parents: Schema.$Array<Schema.String>;
    readonly gitVersion: Schema.String;
    readonly automaticTree: Schema.String;
    readonly resolvedTree: Schema.String;
    readonly hadConflicts: Schema.Boolean;
    readonly patch: Schema.String;
    readonly patchSha256: Schema.String;
    readonly paths: Schema.$Array<Schema.String>;
    readonly automaticRelocations: Schema.optional<Schema.$Array<Schema.Struct<{
        readonly sourceParent: Schema.String;
        readonly sourcePath: Schema.String;
        readonly path: Schema.String;
        readonly blobSha: Schema.String;
        readonly headSha: Schema.String;
        readonly sourceCommitShas: Schema.$Array<Schema.String>;
    }>>>;
}>;
export type AutomaticMergeResolution = typeof AutomaticMergeResolution.Type;
export declare const SnapshotEntry: Schema.Struct<{
    readonly mode: Schema.String;
    readonly blobSha: Schema.String;
}>;
export type SnapshotEntry = typeof SnapshotEntry.Type;
export declare const CombinedParentFile: Schema.Struct<{
    readonly path: Schema.String;
    readonly parents: Schema.$Array<Schema.Struct<{
        readonly mode: Schema.String;
        readonly blobSha: Schema.String;
    }>>;
    readonly result: Schema.Struct<{
        readonly mode: Schema.String;
        readonly blobSha: Schema.String;
    }>;
}>;
export type CombinedParentFile = typeof CombinedParentFile.Type;
export declare const CombinedParentMergeResolution: Schema.Struct<{
    readonly kind: Schema.Literal<"combined-parent-delta">;
    readonly commitSha: Schema.String;
    readonly parents: Schema.$Array<Schema.String>;
    readonly parentTrees: Schema.$Array<Schema.String>;
    readonly gitVersion: Schema.String;
    readonly resolvedTree: Schema.String;
    readonly patch: Schema.String;
    readonly patchSha256: Schema.String;
    readonly paths: Schema.$Array<Schema.String>;
    readonly files: Schema.$Array<Schema.Struct<{
        readonly path: Schema.String;
        readonly parents: Schema.$Array<Schema.Struct<{
            readonly mode: Schema.String;
            readonly blobSha: Schema.String;
        }>>;
        readonly result: Schema.Struct<{
            readonly mode: Schema.String;
            readonly blobSha: Schema.String;
        }>;
    }>>;
}>;
export type CombinedParentMergeResolution = typeof CombinedParentMergeResolution.Type;
export declare const MergeResolution: Schema.Union<readonly [Schema.Struct<{
    readonly kind: Schema.optional<Schema.Literal<"automatic">>;
    readonly commitSha: Schema.String;
    readonly parents: Schema.$Array<Schema.String>;
    readonly gitVersion: Schema.String;
    readonly automaticTree: Schema.String;
    readonly resolvedTree: Schema.String;
    readonly hadConflicts: Schema.Boolean;
    readonly patch: Schema.String;
    readonly patchSha256: Schema.String;
    readonly paths: Schema.$Array<Schema.String>;
    readonly automaticRelocations: Schema.optional<Schema.$Array<Schema.Struct<{
        readonly sourceParent: Schema.String;
        readonly sourcePath: Schema.String;
        readonly path: Schema.String;
        readonly blobSha: Schema.String;
        readonly headSha: Schema.String;
        readonly sourceCommitShas: Schema.$Array<Schema.String>;
    }>>>;
}>, Schema.Struct<{
    readonly kind: Schema.Literal<"combined-parent-delta">;
    readonly commitSha: Schema.String;
    readonly parents: Schema.$Array<Schema.String>;
    readonly parentTrees: Schema.$Array<Schema.String>;
    readonly gitVersion: Schema.String;
    readonly resolvedTree: Schema.String;
    readonly patch: Schema.String;
    readonly patchSha256: Schema.String;
    readonly paths: Schema.$Array<Schema.String>;
    readonly files: Schema.$Array<Schema.Struct<{
        readonly path: Schema.String;
        readonly parents: Schema.$Array<Schema.Struct<{
            readonly mode: Schema.String;
            readonly blobSha: Schema.String;
        }>>;
        readonly result: Schema.Struct<{
            readonly mode: Schema.String;
            readonly blobSha: Schema.String;
        }>;
    }>>;
}>]>;
export type MergeResolution = typeof MergeResolution.Type;
export declare const MergeRecipe: Schema.Struct<{
    readonly profile: Schema.Literals<readonly ["git-2.56.0-v1", "git-2.56.0-v2"]>;
    readonly inputSha256: Schema.String;
}>;
export type MergeRecipe = typeof MergeRecipe.Type;
export declare const FileRequest: Schema.Struct<{
    readonly repository: Schema.String;
    readonly repositoryNodeId: Schema.String;
    readonly ref: Schema.String;
    readonly path: Schema.String;
}>;
export type FileRequest = typeof FileRequest.Type;
export declare const FileMode: Schema.Literals<readonly ["100644", "100755"]>;
export type FileMode = typeof FileMode.Type;
export declare const RecoveredEntry: Schema.Struct<{
    readonly repository: Schema.String;
    readonly repositoryNodeId: Schema.String;
    readonly ref: Schema.String;
    readonly path: Schema.String;
    readonly treeSha: Schema.String;
    readonly mode: Schema.Union<readonly [Schema.Literals<readonly ["100644", "100755"]>, Schema.Null]>;
    readonly blobSha: Schema.Union<readonly [Schema.String, Schema.Null]>;
}>;
export type RecoveredEntry = typeof RecoveredEntry.Type;
export declare const RecoveredBlob: Schema.Struct<{
    readonly sha: Schema.String;
    readonly sha256: Schema.String;
    readonly size: Schema.Number;
    readonly gzipBase64: Schema.String;
}>;
export type RecoveredBlob = typeof RecoveredBlob.Type;
export declare const FileRecovery: Schema.Struct<{
    readonly inputSha256: Schema.String;
    readonly entries: Schema.$Array<Schema.Struct<{
        readonly repository: Schema.String;
        readonly repositoryNodeId: Schema.String;
        readonly ref: Schema.String;
        readonly path: Schema.String;
        readonly treeSha: Schema.String;
        readonly mode: Schema.Union<readonly [Schema.Literals<readonly ["100644", "100755"]>, Schema.Null]>;
        readonly blobSha: Schema.Union<readonly [Schema.String, Schema.Null]>;
    }>>;
    readonly blobs: Schema.$Array<Schema.Struct<{
        readonly sha: Schema.String;
        readonly sha256: Schema.String;
        readonly size: Schema.Number;
        readonly gzipBase64: Schema.String;
    }>>;
}>;
export type FileRecovery = typeof FileRecovery.Type;
export interface ObjectClosure {
    readonly commits: ReadonlyArray<string>;
    readonly trees: ReadonlyArray<string>;
    readonly blobs: ReadonlyArray<string>;
    readonly snapshots: ReadonlyArray<string>;
    readonly expandedBytes: number;
}
export declare const objectId: RegExp;
export declare function refused(reason: string): MergeRefused;
/** @throws {never} */
export declare function ordered(values: Iterable<string>): ReadonlyArray<string>;
/** @throws {never} */
export declare function canonicalMergeInput(input: MergeInput): MergeInput;
/** @throws {never} */
export declare function mergeInputSha256(input: MergeInput): string;
/** @throws {never} */
export declare function fileRequestsSha256(requests: ReadonlyArray<FileRequest>): string;
/** @throws {never} */
export declare function mergeRecipe(input: MergeInput): MergeRecipe;
/** @throws {never} */
export declare function validMergeRecipe(value: unknown): value is MergeRecipe;
/** @throws {never} */
export declare function sameMergeRecipeInput(recipe: unknown, ...inputs: ReadonlyArray<MergeInput>): boolean;
/** @throws {never} */
export declare function validFileRequest(value: FileRequest): boolean;
export {};
