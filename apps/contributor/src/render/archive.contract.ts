// spec/contributor/rendering.md, "The same template files, approved manifest, revision and digest render the same sorted bytes"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { crc32, fixedDosDate, regularFileMode, storedZip, utf8Flag } from "./archive.ts";
import { type SkillFile, comparePaths } from "./render.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const entries = Arbitrary.schema(Schema.Array(Schema.Struct({ path: Schema.String, text: Schema.String }))).pipe(
  Arbitrary.map((generated): ReadonlyArray<SkillFile> => {
    const byPath = new Map(generated.map(({ path, text }) => [`skill/${path.toWellFormed()}`, encoder.encode(text)]));
    return [...byPath]
      .sort(([left], [right]) => comparePaths(left, right))
      .map(([path, bytes]) => ({ path, bytes }));
  }),
);

const storedEntries = (archive: Uint8Array): ReadonlyArray<SkillFile> => {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const end = archive.length - 22;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) return [];
  const count = view.getUint16(end + 10, true);
  const files: SkillFile[] = [];
  let central = view.getUint32(end + 16, true);
  for (let entry = 0; entry < count; entry += 1) {
    const nameLength = view.getUint16(central + 28, true);
    const size = view.getUint32(central + 20, true);
    const local = view.getUint32(central + 42, true);
    const bytes = archive.subarray(local + 30 + nameLength, local + 30 + nameLength + size);
    if (
      view.getUint32(central, true) !== 0x02014b50 ||
      view.getUint16(central + 8, true) !== utf8Flag ||
      view.getUint16(central + 10, true) !== 0 ||
      view.getUint16(central + 14, true) !== fixedDosDate ||
      view.getUint16(central + 30, true) !== 0 ||
      view.getUint32(central + 38, true) >>> 16 !== regularFileMode ||
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 28, true) !== 0 ||
      view.getUint32(central + 16, true) !== crc32(bytes)
    )
      return [];
    files.push({ path: decoder.decode(archive.subarray(central + 46, central + 46 + nameLength)), bytes });
    central += 46 + nameLength;
  }
  return files;
};

export const archiveKeepsEveryEntry = contract({ input: entries, run: storedZip, deterministic: true, inverse: storedEntries });
