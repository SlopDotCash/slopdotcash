/** Bounded build artifact containing only reviewed public execution context. */
import {
  assertSquadsBindingLedger,
  MAX_EXECUTION_JSON_BYTES,
  type SquadsExecutionBinding,
} from "./squads-execution";
export interface CompiledExecutionContext {
  projectId: string;
  cycleId: string;
  allocationBase64: string;
  planBase64: string;
  allocationSha256: string;
  planSha256: string;
}
export interface SquadsExecutionRegistry {
  schemaVersion: 1;
  ledger: SquadsExecutionBinding[];
  contexts: CompiledExecutionContext[];
}
export function parseExecutionRegistry(
  serialized: string,
): SquadsExecutionRegistry {
  if (new TextEncoder().encode(serialized).length > MAX_EXECUTION_JSON_BYTES)
    throw new RangeError("Execution registry exceeds bounds");
  const value = JSON.parse(serialized) as SquadsExecutionRegistry;
  if (value?.schemaVersion !== 1 || !Array.isArray(value.contexts))
    throw new TypeError("Invalid execution registry");
  const ledger = assertSquadsBindingLedger(value.ledger);
  if (ledger.length !== value.contexts.length)
    throw new TypeError("Incomplete execution registry");
  const seen = new Set<string>();
  for (const row of value.contexts) {
    if (
      !row ||
      typeof row.projectId !== "string" ||
      typeof row.cycleId !== "string" ||
      typeof row.allocationSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(row.allocationSha256) ||
      typeof row.planSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(row.planSha256) ||
      ![row.allocationBase64, row.planBase64].every(
        (bytes) =>
          typeof bytes === "string" &&
          bytes.length > 0 &&
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
            bytes,
          ),
      )
    )
      throw new TypeError("Invalid compiled execution context");
    const key = `${row.projectId}:${row.cycleId}`;
    if (
      seen.has(key) ||
      !ledger.some(
        (binding) =>
          binding.projectId === row.projectId &&
          binding.cycleId === row.cycleId &&
          binding.planSha256 === row.planSha256,
      )
    )
      throw new TypeError("Foreign or duplicate execution context");
    seen.add(key);
  }
  return { schemaVersion: 1, ledger, contexts: value.contexts };
}
export function decodeExecutionBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  if (!binary.length || binary.length > MAX_EXECUTION_JSON_BYTES)
    throw new RangeError("Execution bytes exceed bounds");
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
