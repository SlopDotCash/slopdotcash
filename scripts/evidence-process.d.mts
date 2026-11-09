import type { EventEmitter } from "node:events";

interface EvidenceChild extends EventEmitter {
  pid: number | undefined;
  exitCode: number | null;
  signalCode: string | null;
  kill(signal: string): boolean;
}
interface EvidenceProcessState {
  closed: boolean;
  error: unknown;
  completion: Promise<{ code: number | null; signal: string | null }>;
}
export function observeEvidenceProcess(
  child: EvidenceChild,
): EvidenceProcessState;
export function completeEvidenceCommand(
  command: string,
  state: EvidenceProcessState,
): Promise<void>;
export function stopEvidencePreview(
  child: undefined,
  state: undefined,
  timeoutMs?: number,
): Promise<void>;
export function stopEvidencePreview(
  child: EvidenceChild,
  state: EvidenceProcessState,
  timeoutMs?: number,
): Promise<void>;
