// spec/points/ingestion.md, "A read classifies each response and waits only for a rate limit"
import { crc32, inflateRawSync } from "node:zlib";
import { type ZipRecord, directoryRecords, endRecordAt, entryData } from "./zipLayout.ts";

export type ZipEntry = ZipRecord & { readonly name: string };

const decoder = new TextDecoder("utf-8", { fatal: true });
const entryRefusals: Readonly<Record<number, string>> = {
  1: "archive local header is invalid",
  2: "archive entry is truncated",
  3: "archive entry is encrypted",
};

/** @throws {Error} */
export function zipEntries(bytes: Uint8Array): ReadonlyArray<ZipEntry> {
  const end = endRecordAt(bytes);
  if (end === -1) throw new Error("archive has no end of central directory");
  const directory = directoryRecords(bytes, end);
  if (directory.error !== 0) throw new Error("archive central directory is invalid");
  return directory.records.map((record) => ({ ...record, name: decoder.decode(bytes.subarray(record.nameStart, record.nameEnd)) }));
}

/** @throws {Error} */
export function zipContent(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const span = entryData(bytes, entry);
  if (span.error !== 0) throw new Error(entryRefusals[span.error] ?? "archive entry is invalid");
  const stored = bytes.subarray(span.start, span.end);
  const content = entry.method === 0 ? stored.slice() : entry.method === 8 ? new Uint8Array(inflateRawSync(stored, { maxOutputLength: Math.max(1, entry.size) })) : undefined;
  if (content === undefined) throw new Error("archive entry uses an unsupported compression method");
  if (content.length !== entry.size || crc32(content) !== entry.crc) throw new Error("archive entry does not match its checksum");
  return content;
}
