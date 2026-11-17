// spec/operations/backup.md, "One cycle copies an ordered verified prefix and completes one manifest"
import { sha256 } from "@noble/hashes/sha2.js";

export interface RunningDigest {
  /** @throws {never} */
  update(bytes: Uint8Array): void;
  /** @throws {never} */
  finish(): Uint8Array;
}

/** @throws {never} */
export function runningSha256(): RunningDigest {
  const hash = sha256.create();
  return {
    update: (bytes) => {
      hash.update(bytes);
    },
    finish: () => hash.digest(),
  };
}
