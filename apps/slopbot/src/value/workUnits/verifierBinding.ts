// spec/slopbot/workUnits.md, "A claim is one changed path in one commit and belongs to its first accepted carrier"
import type { FileRequest, MergeInput } from "@repo/platform/git/evidence";

export interface ReconstructionCall {
  readonly inputs: ReadonlyArray<MergeInput>;
  readonly bundle: ReadableStream<Uint8Array>;
}

export interface RecoveryCall extends ReconstructionCall {
  readonly fileRequests: ReadonlyArray<FileRequest>;
}

export interface MergeVerifierBinding {
  reconstruct(request: ReconstructionCall): Promise<unknown>;
  recover(request: RecoveryCall): Promise<unknown>;
}

const unavailable = "Merge reconstruction unavailable";

/** @throws {never} */
export function rejectedStage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "";
  if (message === unavailable) return "request";
  return message.startsWith(`${unavailable}: `) ? message.slice(unavailable.length + 2) : "rpc";
}
