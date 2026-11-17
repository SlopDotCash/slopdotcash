// spec/points/scoringPolicy.md, "A scored source records its provenance and keeps the 10-Point minimum"
import { crc32 } from "node:zlib";

/** @throws {never} */
export function chunkCrc(bytes: Uint8Array, start: number, end: number): number {
  return crc32(bytes.subarray(start, end));
}
