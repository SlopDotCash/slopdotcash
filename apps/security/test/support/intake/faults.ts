// spec/security/intake.md, "Upload and receipt creation have separate durable states"
import type { R2Bucket, R2PutOptions } from "@repo/platform/bindings";

export interface Faults {
  lostPuts: number;
  failedPuts: number;
}

/** @throws {never} */
export function faults(): Faults {
  return { lostPuts: 0, failedPuts: 0 };
}

/** @throws {never} */
export function faultyBucket(binding: R2Bucket, plan: Faults): R2Bucket {
  return {
    get: (key) => binding.get(key),
    head: (key) => binding.head(key),
    put: async (key: string, value: Uint8Array, options?: R2PutOptions) => {
      if (plan.failedPuts > 0) {
        plan.failedPuts -= 1;
        throw new Error("R2 put failed before storing");
      }
      const stored = await binding.put(key, value, options);
      if (plan.lostPuts > 0) {
        plan.lostPuts -= 1;
        throw new Error("R2 put response was lost");
      }
      return stored;
    },
  };
}
