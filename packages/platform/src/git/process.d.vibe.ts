import { Config, Context, Effect, Layer } from "effect";
import { ChildProcessSpawner } from "effect/process";
type Git_shape = {
    readonly binary: string;
    readonly searchPath: string;
};
declare const Git_base: Context.ServiceClass<Git, "@repo/platform/src/git/process#Git", Git_shape>;
export declare class Git extends Git_base {
}
export declare namespace Git {
    type Shape = Git_shape;
}
export declare function gitAt(binary: string): Layer.Layer<Git, Config.ConfigError, never>;
export declare const systemGit: Layer.Layer<Git, Config.ConfigError, never>;
export type Environment = Readonly<Record<string, string>>;
export interface Command {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly env: Environment;
    readonly input?: string | Uint8Array;
    readonly limit: number;
    readonly seconds: number;
}
export interface GitCall {
    readonly args: ReadonlyArray<string>;
    readonly env?: Environment;
    readonly input?: string | Uint8Array;
    readonly limit: number;
    readonly seconds: number;
}
export interface Output {
    readonly status: number;
    readonly stdout: Uint8Array;
}
export declare function runCommand(call: Command, refusal: string): Effect.Effect<{
    status: number;
    stdout: Uint8Array<ArrayBufferLike>;
}, import("./model.vibe").MergeRefused, ChildProcessSpawner.ChildProcessSpawner>;
export declare function runInherited(command: string, args: ReadonlyArray<string>, env: Environment, seconds: number, refusal: string): Effect.Effect<undefined, import("./model.vibe").MergeRefused, ChildProcessSpawner.ChildProcessSpawner>;
/** @throws {never} */
export declare function isolated(searchPath: string, extra?: Environment): Environment;
export declare function runGit(call: GitCall, refusal: string): Effect.Effect<{
    status: number;
    stdout: Uint8Array<ArrayBufferLike>;
}, import("./model.vibe").MergeRefused, ChildProcessSpawner.ChildProcessSpawner | Git>;
export declare function gitBytes(call: GitCall, refusal: string): Effect.Effect<Uint8Array<ArrayBufferLike>, import("./model.vibe").MergeRefused, ChildProcessSpawner.ChildProcessSpawner | Git>;
export declare function gitText(call: GitCall, refusal: string): Effect.Effect<string, import("./model.vibe").MergeRefused, ChildProcessSpawner.ChildProcessSpawner | Git>;
export {};
