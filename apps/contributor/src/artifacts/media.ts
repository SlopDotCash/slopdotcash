// spec/contributor/artifactTransport.md, "Each request carries a credential only at the GitHub authority"
import { bytesToHex } from "@noble/hashes/utils.js";
import { crc32 } from "../render/archive.ts";
import { documentReadLimitBytes, imageTooSmall, minImageBytes, minVideoBytes, usefulImageDimensions, videoTooSmall } from "./limits.ts";
import { type ExpectedKind, hasTrajectorySemantics } from "./policy.ts";

export type MediaKind = "image" | "video";

export interface Received {
  readonly status: number;
  readonly contentType: string | undefined;
  readonly contentLength: string | undefined;
  readonly contentRange: string | undefined;
  readonly bytes: Uint8Array;
  readonly ended: boolean;
}

export interface Expectation {
  readonly rowId: string;
  readonly expectedKind: ExpectedKind | null;
  readonly extension: string;
  readonly fullContentLimit: number | undefined;
}

export type BodyFailure = "artifact-invalid" | "artifact-empty" | "artifact-html" | "artifact-kind-mismatch";

export type BodyVerdict =
  | { readonly valid: true; readonly complete: boolean; readonly document: boolean }
  | { readonly valid: false; readonly complete: boolean; readonly document: boolean; readonly status: BodyFailure; readonly detail: string };

export interface Framing {
  readonly complete: boolean;
  readonly totalBytes: number | null;
  readonly lengthError: string | null;
}

interface Dimensions {
  readonly kind: MediaKind;
}

const textDecoder = new TextDecoder();
const unreliableContentTypes: ReadonlySet<string> = new Set(["", "application/octet-stream", "binary/octet-stream"]);
const isoBmffVideoBrands: ReadonlySet<string> = new Set([
  "3g2a", "3g2b", "3gp4", "3gp5", "3gp6", "M4V ", "M4VH", "M4VP", "MSNV", "avc1", "cmfc", "cmfv", "dash",
  "iso2", "iso3", "iso4", "iso5", "iso6", "isom", "mp41", "mp42", "qt  ",
]);
const isoVideoCodecs: ReadonlySet<string> = new Set(["av01", "avc1", "avc3", "hev1", "hvc1", "vp09"]);
const jpegFrameMarkers: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const pngDepths: ReadonlyMap<number, ReadonlySet<number>> = new Map([
  [0, new Set([1, 2, 4, 8, 16])],
  [2, new Set([8, 16])],
  [3, new Set([1, 2, 4, 8])],
  [4, new Set([8, 16])],
  [6, new Set([8, 16])],
]);
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const nonRealDocument =
  /^\s*(?:(?:this\s+)?(?:artifact|evidence)\s+(?:is\s+|[:=-]\s*))(?:a\s+)?(?:placeholder|fabricated|invented|dummy|fake|synthetic|mock|fixture)\b/im;
const logWords = /\b(?:entries|events|level|logs?|method|requests?|responses?|status|timestamp|url)\b/i;
const logLines =
  /(?:^\$\s+\S+|^\((?:pass|fail)\)|\bTest Files\b|\bTests\s+\d+\s+(?:passed|failed)\b|\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/|\b(?:INFO|WARN|ERROR|DEBUG|TRACE)\b|HTTP\/[12](?:\.\d)?\s+\d{3}|\bstatus(?:Code)?["'=:\s]+\d{3}\b)/im;

const image: Dimensions = { kind: "image" };
const video: Dimensions = { kind: "video" };

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return textDecoder.decode(bytes.subarray(start, end));
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function pngMetadata(bytes: Uint8Array, complete: boolean): Dimensions | null {
  if (bytes.length < 41 || !pngSignature.every((byte, index) => bytes[index] === byte)) return null;
  const view = viewOf(bytes);
  let offset = 8;
  let width = 0;
  let hasIdat = false;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.length) {
      return !complete && type === "IDAT" && width > 0 && bytes.length - dataStart >= 256 ? image : null;
    }
    if (view.getUint32(dataEnd) !== crc32(bytes.subarray(offset + 4, dataEnd))) return null;
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) return null;
      width = view.getUint32(dataStart);
      const height = view.getUint32(dataStart + 4);
      if (
        !usefulImageDimensions(width, height) ||
        pngDepths.get(bytes[dataStart + 9] ?? -1)?.has(bytes[dataStart + 8] ?? -1) !== true ||
        bytes[dataStart + 10] !== 0 ||
        bytes[dataStart + 11] !== 0 ||
        (bytes[dataStart + 12] !== 0 && bytes[dataStart + 12] !== 1)
      ) {
        return null;
      }
    } else if (type === "IHDR") {
      return null;
    } else if (type === "IDAT") {
      if (length > 0) hasIdat = true;
    } else if (type === "IEND") {
      return length === 0 && hasIdat && chunkEnd === bytes.length ? image : null;
    }
    offset = chunkEnd;
  }
  return !complete && hasIdat ? image : null;
}

function jpegMetadata(bytes: Uint8Array, complete: boolean): Dimensions | null {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let width = 0;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset] ?? 0;
    offset += 1;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || offset + 2 > bytes.length) return null;
    const segmentLength = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (jpegFrameMarkers.has(marker)) {
      if (segmentLength < 8) return null;
      const height = ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0);
      width = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      const components = bytes[offset + 7] ?? 0;
      const precision = bytes[offset + 2];
      if ((precision !== 8 && precision !== 12) || !usefulImageDimensions(width, height) || components < 1 || components > 4 || segmentLength < 8 + components * 3) {
        return null;
      }
    }
    if (marker === 0xda) {
      const scanStart = offset + segmentLength;
      const hasEoi = bytes.length >= 2 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
      const scanEnd = complete ? bytes.length - 2 : bytes.length;
      return width === 0 || scanEnd - scanStart < 256 || (complete && !hasEoi) ? null : image;
    }
    offset += segmentLength;
  }
  return null;
}

interface SubBlocks {
  readonly complete: boolean;
  readonly offset: number;
  readonly payloadBytes: number;
}

function gifSubBlocks(bytes: Uint8Array, start: number): SubBlocks {
  let offset = start;
  let payloadBytes = 0;
  while (offset < bytes.length) {
    const size = bytes[offset] ?? 0;
    offset += 1;
    if (size === 0) return { complete: true, offset, payloadBytes };
    const available = Math.min(size, bytes.length - offset);
    payloadBytes += available;
    offset += available;
    if (available !== size) return { complete: false, offset, payloadBytes };
  }
  return { complete: false, offset, payloadBytes };
}

function colorTableBytes(flags: number): number {
  return flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0;
}

function little16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function gifMetadata(bytes: Uint8Array, complete: boolean): Dimensions | null {
  if (bytes.length < 14 || !/^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return null;
  const canvasWidth = little16(bytes, 6);
  const canvasHeight = little16(bytes, 8);
  if (!usefulImageDimensions(canvasWidth, canvasHeight)) return null;
  let offset = 13 + colorTableBytes(bytes[10] ?? 0);
  let hasImagePayload = false;
  while (offset < bytes.length) {
    const marker = bytes[offset];
    if (marker === 0x3b) return hasImagePayload && offset + 1 === bytes.length ? image : null;
    if (marker === 0x21) {
      if (offset + 2 > bytes.length) return null;
      const extension = gifSubBlocks(bytes, offset + 2);
      if (!extension.complete) return null;
      offset = extension.offset;
      continue;
    }
    if (marker !== 0x2c || offset + 10 > bytes.length) return null;
    const left = little16(bytes, offset + 1);
    const top = little16(bytes, offset + 3);
    const width = little16(bytes, offset + 5);
    const height = little16(bytes, offset + 7);
    if (width === 0 || height === 0 || left + width > canvasWidth || top + height > canvasHeight) return null;
    const codeSizeOffset = offset + 10 + colorTableBytes(bytes[offset + 9] ?? 0);
    if (codeSizeOffset >= bytes.length) return null;
    const codeSize = bytes[codeSizeOffset] ?? 0;
    if (codeSize < 2 || codeSize > 8) return null;
    const imageData = gifSubBlocks(bytes, codeSizeOffset + 1);
    if (imageData.payloadBytes === 0) return null;
    hasImagePayload ||= imageData.payloadBytes >= 256;
    if (!imageData.complete) return !complete && hasImagePayload ? image : null;
    offset = imageData.offset;
  }
  return !complete && hasImagePayload ? image : null;
}

function webpMetadata(bytes: Uint8Array, complete: boolean): Dimensions | null {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP") return null;
  const view = viewOf(bytes);
  const declaredEnd = view.getUint32(4, true) + 8;
  if ((complete && declaredEnd !== bytes.length) || declaredEnd < bytes.length) return null;
  let offset = 12;
  let width = 0;
  let height = 0;
  let hasImagePayload = false;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    const paddedEnd = dataEnd + (size % 2);
    const available = Math.max(0, Math.min(dataEnd, bytes.length) - dataStart);
    const at = (index: number) => bytes[dataStart + index] ?? 0;
    if (type === "VP8X" && available >= 10) {
      width = 1 + at(4) + (at(5) << 8) + (at(6) << 16);
      height = 1 + at(7) + (at(8) << 8) + (at(9) << 16);
    } else if (type === "VP8L" && available >= 5 && at(0) === 0x2f) {
      const bits = view.getUint32(dataStart + 1, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      hasImagePayload = available >= 256;
    } else if (type === "VP8 " && available >= 10 && at(3) === 0x9d && at(4) === 0x01 && at(5) === 0x2a) {
      width = (at(6) | (at(7) << 8)) & 0x3fff;
      height = (at(8) | (at(9) << 8)) & 0x3fff;
      hasImagePayload = available >= 256;
    }
    if (paddedEnd > bytes.length) return !complete && hasImagePayload && usefulImageDimensions(width, height) ? image : null;
    offset = paddedEnd;
  }
  return offset === bytes.length && hasImagePayload && usefulImageDimensions(width, height) ? image : null;
}

interface IsoBox {
  readonly availableEnd: number;
  readonly end: number;
  readonly payloadStart: number;
  readonly truncated: boolean;
  readonly type: string;
}

function isoBox(bytes: Uint8Array, offset: number, limit: number, completeContainer: boolean): IsoBox | null {
  if (offset + 8 > limit) return null;
  const view = viewOf(bytes);
  let size = view.getUint32(offset);
  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > limit) return null;
    const extended = view.getBigUint64(offset + 8);
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(extended);
    headerSize = 16;
  } else if (size === 0) {
    if (!completeContainer) return null;
    size = limit - offset;
  }
  if (size < headerSize || !Number.isSafeInteger(offset + size)) return null;
  const end = offset + size;
  return { availableEnd: Math.min(end, limit), end, payloadStart: offset + headerSize, truncated: end > limit, type: ascii(bytes, offset + 4, offset + 8) };
}

function isoChildren(bytes: Uint8Array, start: number, end: number): ReadonlyArray<IsoBox> | null {
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset < end) {
    const box = isoBox(bytes, offset, end, true);
    if (box === null || box.truncated) return null;
    boxes.push(box);
    offset = box.end;
  }
  return offset === end ? boxes : null;
}

function isoChild(boxes: ReadonlyArray<IsoBox> | null, type: string): IsoBox | null {
  return boxes?.find((box) => box.type === type) ?? null;
}

function isoTrackIsVideo(bytes: Uint8Array, trak: IsoBox): boolean {
  const mdia = isoChild(isoChildren(bytes, trak.payloadStart, trak.end), "mdia");
  if (mdia === null) return false;
  const mdiaChildren = isoChildren(bytes, mdia.payloadStart, mdia.end);
  const handler = isoChild(mdiaChildren, "hdlr");
  const minf = isoChild(mdiaChildren, "minf");
  if (handler === null || handler.end - handler.payloadStart < 12 || ascii(bytes, handler.payloadStart + 8, handler.payloadStart + 12) !== "vide" || minf === null) {
    return false;
  }
  const stbl = isoChild(isoChildren(bytes, minf.payloadStart, minf.end), "stbl");
  if (stbl === null) return false;
  const stsd = isoChild(isoChildren(bytes, stbl.payloadStart, stbl.end), "stsd");
  if (stsd === null || stsd.end - stsd.payloadStart < 16) return false;
  const view = viewOf(bytes);
  const entryCount = view.getUint32(stsd.payloadStart + 4);
  const entrySize = view.getUint32(stsd.payloadStart + 8);
  if (entryCount === 0 || entrySize < 86 || stsd.payloadStart + 8 + entrySize > stsd.end) return false;
  const codec = ascii(bytes, stsd.payloadStart + 12, stsd.payloadStart + 16);
  const sample = stsd.payloadStart + 16;
  return isoVideoCodecs.has(codec) && usefulImageDimensions(view.getUint16(sample + 24), view.getUint16(sample + 26));
}

function isoBmffVideoMetadata(bytes: Uint8Array, complete: boolean): Dimensions | null {
  const first = isoBox(bytes, 0, bytes.length, complete);
  if (first?.type !== "ftyp" || first.truncated || first.end - first.payloadStart < 8 || (first.end - first.payloadStart) % 4 !== 0) return null;
  const brands = [ascii(bytes, first.payloadStart, first.payloadStart + 4)];
  for (let offset = first.payloadStart + 8; offset + 4 <= first.end; offset += 4) brands.push(ascii(bytes, offset, offset + 4));
  if (!brands.some((brand) => isoBmffVideoBrands.has(brand))) return null;
  let offset = first.end;
  let moov: IsoBox | null = null;
  let hasMediaPayload = false;
  while (offset + 8 <= bytes.length) {
    const box = isoBox(bytes, offset, bytes.length, complete);
    if (box === null) return null;
    if (box.type === "moov") {
      if (box.truncated) return null;
      moov = box;
    }
    if (box.type === "mdat") hasMediaPayload ||= box.end - box.payloadStart >= 1024 && box.availableEnd - box.payloadStart >= 1024;
    if (box.truncated) {
      if (box.type !== "mdat") return null;
      break;
    }
    offset = box.end;
  }
  if (complete && offset !== bytes.length) return null;
  if (moov === null || !hasMediaPayload) return null;
  const tracks = isoChildren(bytes, moov.payloadStart, moov.end)?.filter((box) => box.type === "trak") ?? [];
  return tracks.some((trak) => isoTrackIsVideo(bytes, trak)) ? video : null;
}

interface Vint {
  readonly length: number;
  readonly unknown: boolean;
  readonly value: number;
}

function ebmlVint(bytes: Uint8Array, offset: number): Vint | null {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length += 1;
    mask >>= 1;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  if ((first & (mask - 1)) === mask - 1 && bytes.subarray(offset + 1, offset + length).every((byte) => byte === 0xff)) {
    return { length, unknown: true, value: 0 };
  }
  let value = first & (mask - 1);
  for (let index = 1; index < length; index += 1) value = value * 256 + (bytes[offset + index] ?? 0);
  return Number.isSafeInteger(value) ? { length, unknown: false, value } : null;
}

function ebmlId(bytes: Uint8Array, offset: number): { readonly id: string; readonly length: number } | null {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 4 && (first & mask) === 0) {
    length += 1;
    mask >>= 1;
  }
  if (length > 4 || offset + length > bytes.length) return null;
  return { id: bytesToHex(bytes.subarray(offset, offset + length)), length };
}

interface EbmlElement {
  readonly availableEnd: number;
  readonly end: number;
  readonly id: string;
  readonly payloadStart: number;
  readonly truncated: boolean;
}

function ebmlElement(bytes: Uint8Array, offset: number, limit: number): EbmlElement | null {
  const identifier = ebmlId(bytes, offset);
  if (identifier === null) return null;
  const size = ebmlVint(bytes, offset + identifier.length);
  if (size === null) return null;
  const payloadStart = offset + identifier.length + size.length;
  const end = size.unknown ? limit : payloadStart + size.value;
  if (!Number.isSafeInteger(end)) return null;
  return { availableEnd: Math.min(end, limit), end, id: identifier.id, payloadStart, truncated: !size.unknown && end > limit };
}

function ebmlChildren(bytes: Uint8Array, start: number, end: number): ReadonlyArray<EbmlElement> | null {
  const elements: EbmlElement[] = [];
  let offset = start;
  while (offset < end) {
    const element = ebmlElement(bytes, offset, end);
    if (element === null || element.payloadStart > end) return null;
    elements.push(element);
    if (element.truncated || element.end <= offset) break;
    offset = element.end;
  }
  return elements;
}

function ebmlUnsigned(bytes: Uint8Array, element: EbmlElement | undefined): number | null {
  if (element === undefined) return null;
  const length = element.availableEnd - element.payloadStart;
  if (length < 1 || length > 6 || element.truncated) return null;
  let value = 0;
  for (let offset = element.payloadStart; offset < element.end; offset += 1) value = value * 256 + (bytes[offset] ?? 0);
  return value;
}

function webmHasVideoTrack(bytes: Uint8Array, tracks: EbmlElement): boolean {
  const entries = ebmlChildren(bytes, tracks.payloadStart, tracks.end)?.filter((element) => element.id === "ae" && !element.truncated) ?? [];
  return entries.some((track) => {
    const children = ebmlChildren(bytes, track.payloadStart, track.end);
    const kind = children?.find((element) => element.id === "83");
    const settings = children?.find((element) => element.id === "e0");
    if (ebmlUnsigned(bytes, kind) !== 1 || settings === undefined || settings.truncated) return false;
    const videoChildren = ebmlChildren(bytes, settings.payloadStart, settings.end);
    const width = ebmlUnsigned(bytes, videoChildren?.find((element) => element.id === "b0"));
    const height = ebmlUnsigned(bytes, videoChildren?.find((element) => element.id === "ba"));
    return width !== null && height !== null && usefulImageDimensions(width, height);
  });
}

function webmClusterHasPayload(bytes: Uint8Array, cluster: EbmlElement): boolean {
  return (ebmlChildren(bytes, cluster.payloadStart, cluster.availableEnd) ?? []).some((child) => {
    if (child.id === "a3") return child.availableEnd - child.payloadStart >= 256 && ebmlVint(bytes, child.payloadStart) !== null;
    if (child.id !== "a0") return false;
    const block = ebmlChildren(bytes, child.payloadStart, child.availableEnd)?.find((element) => element.id === "a1");
    return block !== undefined && block.availableEnd - block.payloadStart >= 256;
  });
}

function webmMetadata(bytes: Uint8Array): Dimensions | null {
  const header = ebmlElement(bytes, 0, bytes.length);
  if (header?.id !== "1a45dfa3" || header.truncated) return null;
  const docType = ebmlChildren(bytes, header.payloadStart, header.end)?.find((element) => element.id === "4282");
  if (docType === undefined || docType.truncated || ascii(bytes, docType.payloadStart, docType.end) !== "webm") return null;
  const segment = ebmlElement(bytes, header.end, bytes.length);
  if (segment?.id !== "18538067") return null;
  const children = ebmlChildren(bytes, segment.payloadStart, segment.availableEnd);
  const tracks = children?.find((element) => element.id === "1654ae6b" && !element.truncated);
  const cluster = children?.find((element) => element.id === "1f43b675");
  if (tracks === undefined || cluster === undefined || !webmClusterHasPayload(bytes, cluster)) return null;
  return webmHasVideoTrack(bytes, tracks) ? video : null;
}

/** @throws {never} */
export function mediaKind(bytes: Uint8Array, complete: boolean): MediaKind | null {
  return (
    pngMetadata(bytes, complete) ??
    jpegMetadata(bytes, complete) ??
    gifMetadata(bytes, complete) ??
    webpMetadata(bytes, complete) ??
    webmMetadata(bytes) ??
    isoBmffVideoMetadata(bytes, complete)
  )?.kind ?? null;
}

function meaningfulJson(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && typeof value === "object" && Object.keys(value).length > 0;
}

function parsedJson(text: string): { readonly value: unknown } | null {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null;
  }
}

function jsonLines(text: string): ReadonlyArray<unknown> | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const records: unknown[] = [];
  for (const line of lines) {
    const record = parsedJson(line);
    if (record === null || !meaningfulJson(record.value)) return null;
    records.push(record.value);
  }
  return records;
}

function utf8Text(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "").trim();
  } catch {
    return null;
  }
}

function documentProblem(bytes: Uint8Array, expectation: Pick<Expectation, "rowId" | "extension">, contentType: string): string | null {
  if (bytes.length < 64) return "document is too small to be substantive evidence";
  const text = utf8Text(bytes);
  if (text === null) return "document is not valid UTF-8 text";
  if (text.length < 64 || nonRealDocument.test(text)) return "document is too small or identifies itself as non-real evidence";
  const tokens = text.match(/[a-z0-9][a-z0-9._:/-]*/gi) ?? [];
  if (tokens.join("").length < 40 || new Set(tokens.map((token) => token.toLowerCase())).size < 3) {
    return "document is structurally trivial and lacks substantive records";
  }
  let json: { readonly value: unknown } | null = null;
  let lines: ReadonlyArray<unknown> | null = null;
  if (expectation.extension === ".json" || contentType === "application/json" || contentType.endsWith("+json")) {
    json = parsedJson(text);
    if (json === null) return "JSON evidence is malformed";
    if (!meaningfulJson(json.value)) return "JSON evidence has no records";
  }
  if (expectation.extension === ".jsonl" || contentType === "application/jsonl" || contentType === "application/x-ndjson") {
    lines = jsonLines(text);
    if (lines === null) return "JSONL evidence has no valid complete records";
  }
  if (json === null && lines === null && /^[{[]/.test(text)) {
    const sniffed = parsedJson(text);
    if (sniffed === null) lines = jsonLines(text);
    else if (meaningfulJson(sniffed.value)) json = sniffed;
  }
  const structured = json?.value ?? lines;
  if (expectation.rowId === "backend-logs" || expectation.rowId === "frontend-logs") {
    const nonBlank = text.split(/\r?\n/).filter((line) => line.trim());
    const value = json?.value;
    const structuredRecords =
      (Array.isArray(value) && value.length >= 2) ||
      (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length >= 2) ||
      (lines?.length ?? 0) >= 2;
    if ((!structuredRecords || !logWords.test(JSON.stringify(structured ?? null))) && (nonBlank.length < 3 || !logLines.test(text))) {
      return "log evidence needs at least three recognizable log lines or structured records";
    }
  }
  if (expectation.rowId === "llm-trajectory") {
    if (structured === undefined || structured === null || JSON.stringify(structured).length < 120 || !hasTrajectorySemantics(structured)) {
      return "trajectory evidence lacks substantive model/input/output records";
    }
  }
  return null;
}

function isHtmlResponse(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === "text/html" || contentType === "application/xhtml+xml") return true;
  const prefix = textDecoder.decode(bytes.subarray(0, 512)).replace(/^﻿/, "").trimStart().toLowerCase();
  return prefix.startsWith("<!doctype html") || prefix.startsWith("<html") || prefix.startsWith("<head");
}

function byteCount(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

interface ByteRange {
  readonly start: number;
  readonly end: number;
  readonly total: number;
}

function byteRange(value: string): ByteRange | null {
  const match = value.trim().match(/^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/i);
  if (match === null) return null;
  const [start, end, total] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return [start, end, total].every(Number.isSafeInteger) && start === 0 && end >= start && total > end ? { start, end, total } : null;
}

/** @throws {never} */
export function framing(received: Omit<Received, "contentType">): Framing {
  const length = received.bytes.length;
  const contentLength = received.contentLength === undefined ? null : byteCount(received.contentLength);
  if (received.contentLength !== undefined && contentLength === null) {
    return { complete: false, totalBytes: null, lengthError: "Content-Length is not a valid non-negative byte count" };
  }
  const range = received.contentRange === undefined ? null : byteRange(received.contentRange);
  if (received.contentRange !== undefined && range === null) {
    return { complete: false, totalBytes: null, lengthError: "Content-Range is malformed or does not begin at byte 0" };
  }
  if (received.status === 206 && range === null) {
    return { complete: false, totalBytes: null, lengthError: "HTTP 206 response omitted a valid Content-Range header" };
  }
  const expected = range === null ? contentLength : range.end - range.start + 1;
  if (expected !== null && ((received.ended && expected !== length) || expected < length)) {
    return { complete: false, totalBytes: range?.total ?? contentLength, lengthError: "declared response length does not match the received bytes" };
  }
  return {
    complete: range === null ? received.ended || (contentLength !== null && contentLength === length) : range.end + 1 === range.total,
    totalBytes: range?.total ?? contentLength,
    lengthError: null,
  };
}

function mediaType(contentType: string | undefined): string {
  return (contentType ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function refused(status: BodyFailure, detail: string, complete: boolean, document: boolean): BodyVerdict {
  return { valid: false, complete, document, status, detail };
}

/** @throws {never} */
export function judgeBody(received: Received, expectation: Expectation): BodyVerdict {
  const { bytes } = received;
  const { complete, totalBytes, lengthError } = framing(received);
  const expected = expectation.expectedKind;
  const expectsDocument = expected === "document";
  if (lengthError !== null) return refused("artifact-invalid", lengthError, complete, expectsDocument);
  if (bytes.length === 0) return refused("artifact-empty", "response body is empty", complete, expectsDocument);
  if (expectation.fullContentLimit !== undefined && !complete) {
    return refused("artifact-invalid", `artifact exceeds the ${expectation.fullContentLimit}-byte content verification limit`, complete, expectsDocument);
  }
  const contentType = mediaType(received.contentType);
  if (isHtmlResponse(contentType, bytes)) return refused("artifact-html", "response is HTML, not an uploaded artifact", complete, expectsDocument);
  const actual = mediaKind(bytes, complete);
  const document = expectsDocument || (actual === null && expected === null);
  if (expected !== null && (((expected === "image" || expected === "video") && actual !== expected) || (actual !== null && expected !== actual))) {
    return refused("artifact-kind-mismatch", `expected ${expected}, received ${actual ?? "unrecognized bytes"}`, complete, document);
  }
  if ((contentType.startsWith("image/") || contentType.startsWith("video/")) && actual === null) {
    return refused("artifact-kind-mismatch", "media response is truncated or structurally invalid", complete, document);
  }
  const size = totalBytes ?? (complete ? bytes.length : null);
  if (actual === "image" && size !== null && imageTooSmall(size)) {
    return refused("artifact-invalid", `image evidence is smaller than ${minImageBytes} bytes`, complete, document);
  }
  if (actual === "video" && size !== null && videoTooSmall(size)) {
    return refused("artifact-invalid", `video evidence is smaller than ${minVideoBytes} bytes`, complete, document);
  }
  if (document) {
    if (!complete) return { valid: true, complete, document };
    const problem = documentProblem(bytes, expectation, contentType);
    if (problem !== null) return refused("artifact-invalid", problem, complete, document);
  }
  if (expected === null && actual === null && unreliableContentTypes.has(contentType) && (bytes.length < 64 || new Set(bytes).size < 4)) {
    return refused("artifact-invalid", "opaque artifact is too small or structurally trivial", complete, document);
  }
  return { valid: true, complete, document };
}

export const incompleteDocumentDetail = `document exceeds the ${documentReadLimitBytes}-byte verification limit`;
