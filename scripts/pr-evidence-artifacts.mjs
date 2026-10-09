/** Bounded remote artifact retrieval and byte-level verification. */
import { createHash } from "node:crypto";
import {
  artifactCanBeEvidenceFile,
  EVIDENCE_FILE_EXTENSIONS,
  extractEvidenceRows,
  hasTrajectorySemantics,
  IMAGE_EXTENSIONS,
  OCR_EVIDENCE_RE,
  REQUIRED_EVIDENCE_ROWS,
  SURFACE_OCR_EVIDENCE_ROW,
  trustedArtifacts,
  VIDEO_EXTENSIONS,
} from "./pr-evidence-policy.mjs";

const ARTIFACT_READ_LIMIT_BYTES = 64 * 1024;
const DOCUMENT_READ_LIMIT_BYTES = 2 * 1024 * 1024;
const MIN_IMAGE_BYTES = 1024;
const MIN_VIDEO_BYTES = 16 * 1024;
const MIN_SCREENSHOT_WIDTH = 320;
const MIN_SCREENSHOT_HEIGHT = 180;
const DEFAULT_ARTIFACT_CONCURRENCY = 4;
const DEFAULT_ARTIFACT_TIMEOUT_MS = 10_000;
const MAX_ARTIFACT_REDIRECTS = 4;
const MAX_CONTENT_DIGEST_BYTES = 32 * 1024 * 1024;
export const MAX_ARTIFACTS_PER_ROW = 8;
export const MAX_ARTIFACTS_TOTAL = 32;
const TRUSTED_ARTIFACT_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "github-production-user-asset-6210df.s3.amazonaws.com",
  "objects.githubusercontent.com",
  "private-user-images.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "user-images.githubusercontent.com",
]);
const UNRELIABLE_CONTENT_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);
const ISO_BMFF_VIDEO_BRANDS = new Set([
  "3g2a",
  "3g2b",
  "3gp4",
  "3gp5",
  "3gp6",
  "M4V ",
  "M4VH",
  "M4VP",
  "MSNV",
  "avc1",
  "cmfc",
  "cmfv",
  "dash",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "isom",
  "mp41",
  "mp42",
  "qt  ",
]);
const TEXT_DECODER = new TextDecoder();
const NON_REAL_DOCUMENT_RE =
  /^\s*(?:(?:this\s+)?(?:artifact|evidence)\s+(?:is\s+|[:=-]\s*))(?:a\s+)?(?:placeholder|fabricated|invented|dummy|fake|synthetic|mock|fixture)\b/im;

function expectedArtifactKind(rowId, artifact, rowText) {
  if (rowId === "before-screenshots" || rowId === "after-screenshots") {
    return "image";
  }
  if (rowId === "walkthrough-video") return "video";
  if (rowId === SURFACE_OCR_EVIDENCE_ROW.id) return "document";
  if (
    rowId === "backend-logs" ||
    rowId === "frontend-logs" ||
    rowId === "llm-trajectory"
  ) {
    return "document";
  }
  if (
    rowId === "domain-artifacts" &&
    OCR_EVIDENCE_RE.test(rowText) &&
    artifactCanBeEvidenceFile(artifact)
  ) {
    return "document";
  }
  if (IMAGE_EXTENSIONS.has(artifact.extension)) return "image";
  if (VIDEO_EXTENSIONS.has(artifact.extension)) return "video";
  if (EVIDENCE_FILE_EXTENSIONS.has(artifact.extension)) return "document";
  if (artifact.presentation === "image") return "image";
  if (artifact.presentation === "video") return "video";
  return null;
}

function ascii(bytes, start, end) {
  return TEXT_DECODER.decode(bytes.subarray(start, end));
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function usefulImageDimensions(width, height) {
  return width >= MIN_SCREENSHOT_WIDTH && height >= MIN_SCREENSHOT_HEIGHT;
}

function pngMetadata(bytes, complete) {
  if (
    bytes.length < 41 ||
    ![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => bytes[index] === byte,
    )
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const validDepths = new Map([
    [0, new Set([1, 2, 4, 8, 16])],
    [2, new Set([8, 16])],
    [3, new Set([1, 2, 4, 8])],
    [4, new Set([8, 16])],
    [6, new Set([8, 16])],
  ]);
  let offset = 8;
  let width = 0;
  let height = 0;
  let hasIdat = false;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.length) {
      if (
        !complete &&
        type === "IDAT" &&
        width > 0 &&
        bytes.length - dataStart >= 256
      ) {
        return { height, kind: "image", width };
      }
      return null;
    }
    if (
      view.getUint32(dataEnd) !== crc32(bytes.subarray(offset + 4, dataEnd))
    ) {
      return null;
    }
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) return null;
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9];
      if (
        !usefulImageDimensions(width, height) ||
        validDepths.get(colorType)?.has(bitDepth) !== true ||
        bytes[dataStart + 10] !== 0 ||
        bytes[dataStart + 11] !== 0 ||
        ![0, 1].includes(bytes[dataStart + 12])
      ) {
        return null;
      }
    } else if (type === "IHDR") {
      return null;
    } else if (type === "IDAT") {
      if (length === 0) return null;
      hasIdat = true;
    } else if (type === "IEND") {
      if (length !== 0 || !hasIdat || chunkEnd !== bytes.length) return null;
      return { height, kind: "image", width };
    }
    offset = chunkEnd;
  }
  return !complete && hasIdat ? { height, kind: "image", width } : null;
}

function jpegMetadata(bytes, complete) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  let width = 0;
  let height = 0;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || offset + 2 > bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (sofMarkers.has(marker)) {
      if (segmentLength < 8) return null;
      height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const components = bytes[offset + 7];
      if (
        ![8, 12].includes(bytes[offset + 2]) ||
        !usefulImageDimensions(width, height) ||
        components < 1 ||
        components > 4 ||
        segmentLength < 8 + components * 3
      ) {
        return null;
      }
    }
    if (marker === 0xda) {
      const scanStart = offset + segmentLength;
      const hasEoi =
        bytes.length >= 2 &&
        bytes[bytes.length - 2] === 0xff &&
        bytes[bytes.length - 1] === 0xd9;
      const scanEnd = complete ? bytes.length - 2 : bytes.length;
      if (width === 0 || scanEnd - scanStart < 256 || (complete && !hasEoi)) {
        return null;
      }
      return { height, kind: "image", width };
    }
    offset += segmentLength;
  }
  return null;
}

function readGifSubBlocks(bytes, start) {
  let offset = start;
  let payloadBytes = 0;
  while (offset < bytes.length) {
    const size = bytes[offset];
    offset += 1;
    if (size === 0) return { complete: true, offset, payloadBytes };
    const available = Math.min(size, bytes.length - offset);
    payloadBytes += available;
    offset += available;
    if (available !== size) {
      return { complete: false, offset, payloadBytes };
    }
  }
  return { complete: false, offset, payloadBytes };
}

function gifMetadata(bytes, complete) {
  if (bytes.length < 14 || !/^GIF8[79]a$/.test(ascii(bytes, 0, 6))) {
    return null;
  }
  const canvasWidth = bytes[6] | (bytes[7] << 8);
  const canvasHeight = bytes[8] | (bytes[9] << 8);
  if (!usefulImageDimensions(canvasWidth, canvasHeight)) return null;
  const globalTableBytes =
    bytes[10] & 0x80 ? 3 * 2 ** ((bytes[10] & 0x07) + 1) : 0;
  let offset = 13 + globalTableBytes;
  let hasImagePayload = false;
  while (offset < bytes.length) {
    const marker = bytes[offset];
    if (marker === 0x3b) {
      return hasImagePayload && offset + 1 === bytes.length
        ? { height: canvasHeight, kind: "image", width: canvasWidth }
        : null;
    }
    if (marker === 0x21) {
      if (offset + 2 > bytes.length) return null;
      const extension = readGifSubBlocks(bytes, offset + 2);
      if (!extension.complete) return null;
      offset = extension.offset;
      continue;
    }
    if (marker !== 0x2c || offset + 10 > bytes.length) return null;
    const left = bytes[offset + 1] | (bytes[offset + 2] << 8);
    const top = bytes[offset + 3] | (bytes[offset + 4] << 8);
    const width = bytes[offset + 5] | (bytes[offset + 6] << 8);
    const height = bytes[offset + 7] | (bytes[offset + 8] << 8);
    if (
      !usefulImageDimensions(width, height) ||
      left + width > canvasWidth ||
      top + height > canvasHeight
    ) {
      return null;
    }
    const localTableBytes =
      bytes[offset + 9] & 0x80 ? 3 * 2 ** ((bytes[offset + 9] & 0x07) + 1) : 0;
    const lzwCodeSizeOffset = offset + 10 + localTableBytes;
    if (lzwCodeSizeOffset >= bytes.length) return null;
    if (bytes[lzwCodeSizeOffset] < 2 || bytes[lzwCodeSizeOffset] > 8) {
      return null;
    }
    const imageData = readGifSubBlocks(bytes, lzwCodeSizeOffset + 1);
    hasImagePayload = imageData.payloadBytes >= 256;
    if (!imageData.complete) {
      return !complete && hasImagePayload
        ? { height: canvasHeight, kind: "image", width: canvasWidth }
        : null;
    }
    offset = imageData.offset;
  }
  return !complete && hasImagePayload
    ? { height: canvasHeight, kind: "image", width: canvasWidth }
    : null;
}

function webpMetadata(bytes, complete) {
  if (
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 12) !== "WEBP"
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredEnd = view.getUint32(4, true) + 8;
  if (
    (complete && declaredEnd !== bytes.length) ||
    declaredEnd < bytes.length
  ) {
    return null;
  }
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
    const availablePayload = Math.max(
      0,
      Math.min(dataEnd, bytes.length) - dataStart,
    );
    if (type === "VP8X" && availablePayload >= 10) {
      width =
        1 +
        bytes[dataStart + 4] +
        (bytes[dataStart + 5] << 8) +
        (bytes[dataStart + 6] << 16);
      height =
        1 +
        bytes[dataStart + 7] +
        (bytes[dataStart + 8] << 8) +
        (bytes[dataStart + 9] << 16);
    } else if (
      type === "VP8L" &&
      availablePayload >= 5 &&
      bytes[dataStart] === 0x2f
    ) {
      const bits = view.getUint32(dataStart + 1, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      hasImagePayload = availablePayload >= 256;
    } else if (
      type === "VP8 " &&
      availablePayload >= 10 &&
      bytes[dataStart + 3] === 0x9d &&
      bytes[dataStart + 4] === 0x01 &&
      bytes[dataStart + 5] === 0x2a
    ) {
      width = (bytes[dataStart + 6] | (bytes[dataStart + 7] << 8)) & 0x3fff;
      height = (bytes[dataStart + 8] | (bytes[dataStart + 9] << 8)) & 0x3fff;
      hasImagePayload = availablePayload >= 256;
    }
    if (paddedEnd > bytes.length) {
      return !complete &&
        hasImagePayload &&
        usefulImageDimensions(width, height)
        ? { height, kind: "image", width }
        : null;
    }
    offset = paddedEnd;
  }
  return offset === bytes.length &&
    hasImagePayload &&
    usefulImageDimensions(width, height)
    ? { height, kind: "image", width }
    : null;
}

function readIsoBox(bytes, offset, limit, completeContainer) {
  if (offset + 8 > limit) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
  return {
    availableEnd: Math.min(end, limit),
    end,
    payloadStart: offset + headerSize,
    start: offset,
    truncated: end > limit,
    type: ascii(bytes, offset + 4, offset + 8),
  };
}

function isoChildBoxes(bytes, start, end) {
  const boxes = [];
  let offset = start;
  while (offset < end) {
    const box = readIsoBox(bytes, offset, end, true);
    if (!box || box.truncated) return null;
    boxes.push(box);
    offset = box.end;
  }
  return offset === end ? boxes : null;
}

function isoChild(boxes, type) {
  return boxes?.find((box) => box.type === type) ?? null;
}

function hasIsoVideoTrack(bytes, moov) {
  const moovChildren = isoChildBoxes(bytes, moov.payloadStart, moov.end);
  for (const trak of moovChildren?.filter((box) => box.type === "trak") ?? []) {
    const trakChildren = isoChildBoxes(bytes, trak.payloadStart, trak.end);
    const mdia = isoChild(trakChildren, "mdia");
    if (!mdia) continue;
    const mdiaChildren = isoChildBoxes(bytes, mdia.payloadStart, mdia.end);
    const handler = isoChild(mdiaChildren, "hdlr");
    const minf = isoChild(mdiaChildren, "minf");
    if (
      !handler ||
      handler.end - handler.payloadStart < 12 ||
      ascii(bytes, handler.payloadStart + 8, handler.payloadStart + 12) !==
        "vide" ||
      !minf
    ) {
      continue;
    }
    const minfChildren = isoChildBoxes(bytes, minf.payloadStart, minf.end);
    const stbl = isoChild(minfChildren, "stbl");
    if (!stbl) continue;
    const stblChildren = isoChildBoxes(bytes, stbl.payloadStart, stbl.end);
    const stsd = isoChild(stblChildren, "stsd");
    if (!stsd || stsd.end - stsd.payloadStart < 16) continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entryCount = view.getUint32(stsd.payloadStart + 4);
    const entrySize = view.getUint32(stsd.payloadStart + 8);
    if (
      entryCount === 0 ||
      entrySize < 86 ||
      stsd.payloadStart + 8 + entrySize > stsd.end
    ) {
      continue;
    }
    const codec = ascii(bytes, stsd.payloadStart + 12, stsd.payloadStart + 16);
    const samplePayloadStart = stsd.payloadStart + 16;
    const width = view.getUint16(samplePayloadStart + 24);
    const height = view.getUint16(samplePayloadStart + 26);
    if (
      new Set(["av01", "avc1", "hev1", "hvc1", "vp09"]).has(codec) &&
      usefulImageDimensions(width, height)
    ) {
      return true;
    }
  }
  return false;
}

function isoBmffVideoMetadata(bytes, complete) {
  const first = readIsoBox(bytes, 0, bytes.length, complete);
  if (
    first?.type !== "ftyp" ||
    first.truncated ||
    first.end - first.payloadStart < 8 ||
    (first.end - first.payloadStart) % 4 !== 0
  ) {
    return null;
  }
  const brands = [ascii(bytes, first.payloadStart, first.payloadStart + 4)];
  for (
    let offset = first.payloadStart + 8;
    offset + 4 <= first.end;
    offset += 4
  ) {
    brands.push(ascii(bytes, offset, offset + 4));
  }
  if (!brands.some((brand) => ISO_BMFF_VIDEO_BRANDS.has(brand))) return null;
  let offset = first.end;
  let moov = null;
  let hasMediaPayload = false;
  while (offset + 8 <= bytes.length) {
    const box = readIsoBox(bytes, offset, bytes.length, complete);
    if (!box) return null;
    if (box.type === "moov") {
      if (box.truncated) return null;
      moov = box;
    }
    if (box.type === "mdat") {
      const declaredPayload = box.end - box.payloadStart;
      const availablePayload = box.availableEnd - box.payloadStart;
      hasMediaPayload ||= declaredPayload >= 1024 && availablePayload >= 1024;
    }
    if (box.truncated) {
      if (box.type !== "mdat") return null;
      break;
    }
    offset = box.end;
  }
  if (complete && offset !== bytes.length) return null;
  return moov && hasMediaPayload && hasIsoVideoTrack(bytes, moov)
    ? { kind: "video" }
    : null;
}

function readEbmlVint(bytes, offset) {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length += 1;
    mask >>= 1;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  const unknown =
    (first & (mask - 1)) === mask - 1 &&
    bytes.subarray(offset + 1, offset + length).every((byte) => byte === 0xff);
  if (unknown) return { length, unknown: true, value: 0 };
  let value = first & (mask - 1);
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[offset + index];
  }
  if (!Number.isSafeInteger(value)) return null;
  return { length, unknown: false, value };
}

function readEbmlId(bytes, offset) {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 4 && (first & mask) === 0) {
    length += 1;
    mask >>= 1;
  }
  if (length > 4 || offset + length > bytes.length) return null;
  return {
    id: Array.from(bytes.subarray(offset, offset + length), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
    length,
  };
}

function readEbmlElement(bytes, offset, limit) {
  const identifier = readEbmlId(bytes, offset);
  if (!identifier) return null;
  const size = readEbmlVint(bytes, offset + identifier.length);
  if (!size) return null;
  const payloadStart = offset + identifier.length + size.length;
  const end = size.unknown ? limit : payloadStart + size.value;
  if (!Number.isSafeInteger(end)) return null;
  return {
    availableEnd: Math.min(end, limit),
    end,
    id: identifier.id,
    payloadStart,
    truncated: !size.unknown && end > limit,
  };
}

function ebmlChildren(bytes, start, end) {
  const elements = [];
  let offset = start;
  while (offset < end) {
    const element = readEbmlElement(bytes, offset, end);
    if (!element || element.payloadStart > end) return null;
    elements.push(element);
    if (element.truncated || element.end <= offset) break;
    offset = element.end;
  }
  return elements;
}

function ebmlUnsigned(bytes, element) {
  if (!element) return null;
  const length = element.availableEnd - element.payloadStart;
  if (length < 1 || length > 6 || element.truncated) return null;
  let value = 0;
  for (let offset = element.payloadStart; offset < element.end; offset += 1) {
    value = value * 256 + bytes[offset];
  }
  return value;
}

function webmTrackDimensions(bytes, tracks) {
  const trackEntries =
    ebmlChildren(bytes, tracks.payloadStart, tracks.end)?.filter(
      (element) => element.id === "ae" && !element.truncated,
    ) ?? [];
  for (const track of trackEntries) {
    const children = ebmlChildren(bytes, track.payloadStart, track.end);
    const type = children?.find((element) => element.id === "83");
    const video = children?.find((element) => element.id === "e0");
    if (ebmlUnsigned(bytes, type) !== 1 || !video || video.truncated) continue;
    const videoChildren = ebmlChildren(bytes, video.payloadStart, video.end);
    const width = ebmlUnsigned(
      bytes,
      videoChildren?.find((element) => element.id === "b0"),
    );
    const height = ebmlUnsigned(
      bytes,
      videoChildren?.find((element) => element.id === "ba"),
    );
    if (usefulImageDimensions(width, height)) return { height, width };
  }
  return null;
}

function webmClusterHasPayload(bytes, cluster) {
  const children = ebmlChildren(
    bytes,
    cluster.payloadStart,
    cluster.availableEnd,
  );
  for (const child of children ?? []) {
    if (
      child.id === "a3" &&
      child.availableEnd - child.payloadStart >= 256 &&
      readEbmlVint(bytes, child.payloadStart)
    ) {
      return true;
    }
    if (child.id === "a0") {
      const block = ebmlChildren(
        bytes,
        child.payloadStart,
        child.availableEnd,
      )?.find((element) => element.id === "a1");
      if (block && block.availableEnd - block.payloadStart >= 256) return true;
    }
  }
  return false;
}

function webmMetadata(bytes) {
  const header = readEbmlElement(bytes, 0, bytes.length);
  if (header?.id !== "1a45dfa3" || header.truncated) return null;
  const headerChildren = ebmlChildren(bytes, header.payloadStart, header.end);
  const docType = headerChildren?.find((element) => element.id === "4282");
  if (
    !docType ||
    docType.truncated ||
    ascii(bytes, docType.payloadStart, docType.end) !== "webm"
  ) {
    return null;
  }
  const segment = readEbmlElement(bytes, header.end, bytes.length);
  if (segment?.id !== "18538067") return null;
  const children = ebmlChildren(
    bytes,
    segment.payloadStart,
    segment.availableEnd,
  );
  const tracks = children?.find(
    (element) => element.id === "1654ae6b" && !element.truncated,
  );
  const cluster = children?.find((element) => element.id === "1f43b675");
  if (!tracks || !cluster || !webmClusterHasPayload(bytes, cluster))
    return null;
  const dimensions = webmTrackDimensions(bytes, tracks);
  return dimensions ? { ...dimensions, kind: "video" } : null;
}

function mediaMetadataFromBytes(bytes, complete) {
  return (
    pngMetadata(bytes, complete) ??
    jpegMetadata(bytes, complete) ??
    gifMetadata(bytes, complete) ??
    webpMetadata(bytes, complete) ??
    webmMetadata(bytes) ??
    isoBmffVideoMetadata(bytes, complete)
  );
}

function meaningfulJson(value) {
  if (Array.isArray(value)) return value.length > 0;
  return (
    value !== null && typeof value === "object" && Object.keys(value).length > 0
  );
}

function parseJsonLines(text, complete) {
  const lines = text
    .split(/\r?\n/)
    .slice(0, complete ? undefined : -1)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  try {
    const records = lines.map((line) => JSON.parse(line));
    return records.every(meaningfulJson) ? records : null;
  } catch {
    // error-policy:J3 uploaded JSONL is untrusted input; malformed records are
    // an explicit invalid-artifact result at the verification boundary.
    return null;
  }
}

function validateDocument(bytes, complete, artifact, contentType) {
  if (!complete) {
    return `document exceeds the ${DOCUMENT_READ_LIMIT_BYTES}-byte verification limit`;
  }
  if (bytes.length < 64)
    return "document is too small to be substantive evidence";

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "")
      .trim();
  } catch {
    // error-policy:J3 evidence bytes are untrusted input; invalid UTF-8 is an
    // explicit invalid document rather than fabricated readable content.
    return "document is not valid UTF-8 text";
  }
  if (text.length < 64 || NON_REAL_DOCUMENT_RE.test(text)) {
    return "document is too small or identifies itself as non-real evidence";
  }
  const semanticTokens = text.match(/[a-z0-9][a-z0-9._:/-]*/gi) ?? [];
  const uniqueTokens = new Set(
    semanticTokens.map((token) => token.toLowerCase()),
  );
  if (semanticTokens.join("").length < 40 || uniqueTokens.size < 3) {
    return "document is structurally trivial and lacks substantive records";
  }

  const extension = artifact.extension;
  let parsedJson = null;
  let parsedJsonLines = null;
  const jsonContentType =
    contentType === "application/json" || contentType.endsWith("+json");
  const jsonLinesContentType =
    contentType === "application/jsonl" ||
    contentType === "application/x-ndjson";
  if (extension === ".json" || jsonContentType) {
    try {
      parsedJson = JSON.parse(text);
    } catch {
      // error-policy:J3 uploaded JSON is untrusted input; malformed JSON is an
      // explicit invalid-artifact verdict.
      return "JSON evidence is malformed";
    }
    if (!meaningfulJson(parsedJson)) return "JSON evidence has no records";
  }
  if (extension === ".jsonl" || jsonLinesContentType) {
    parsedJsonLines = parseJsonLines(text, complete);
    if (!parsedJsonLines) return "JSONL evidence has no valid complete records";
  }
  if (parsedJson === null && parsedJsonLines === null && /^[{[]/.test(text)) {
    try {
      const sniffedJson = JSON.parse(text);
      if (meaningfulJson(sniffedJson)) parsedJson = sniffedJson;
    } catch {
      parsedJsonLines = parseJsonLines(text, complete);
    }
  }
  if (artifact.id === "backend-logs" || artifact.id === "frontend-logs") {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const structuredRecords =
      (Array.isArray(parsedJson) && parsedJson.length >= 2) ||
      (parsedJson &&
        !Array.isArray(parsedJson) &&
        Object.keys(parsedJson).length >= 2) ||
      (parsedJsonLines?.length ?? 0) >= 2;
    const structuredLogText = JSON.stringify(parsedJson ?? parsedJsonLines);
    if (
      (!structuredRecords ||
        !/\b(?:entries|events|level|logs?|method|requests?|responses?|status|timestamp|url)\b/i.test(
          structuredLogText,
        )) &&
      (lines.length < 3 ||
        !/(?:^\$\s+\S+|^\((?:pass|fail)\)|\bTest Files\b|\bTests\s+\d+\s+(?:passed|failed)\b|\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/|\b(?:INFO|WARN|ERROR|DEBUG|TRACE)\b|HTTP\/[12](?:\.\d)?\s+\d{3}|\bstatus(?:Code)?["'=:\s]+\d{3}\b)/im.test(
          text,
        ))
    ) {
      return "log evidence needs at least three recognizable log lines or structured records";
    }
  }

  if (artifact.id === "llm-trajectory") {
    const trajectory = parsedJson ?? parsedJsonLines;
    if (
      trajectory === null ||
      JSON.stringify(trajectory).length < 120 ||
      !hasTrajectorySemantics(trajectory)
    ) {
      return "trajectory evidence lacks substantive model/input/output records";
    }
  }
  return null;
}

function isHtmlResponse(contentType, bytes) {
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    return true;
  }
  const prefix = TEXT_DECODER.decode(bytes.subarray(0, 512))
    .replace(/^\uFEFF/, "")
    .trimStart()
    .toLowerCase();
  return (
    prefix.startsWith("<!doctype html") ||
    prefix.startsWith("<html") ||
    prefix.startsWith("<head")
  );
}

function withAbort(promise, signal) {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function readResponsePrefix(response, signal, readLimit) {
  if (!response.body) {
    return {
      bytes: new Uint8Array(),
      complete: true,
      lengthError: null,
      totalBytes: 0,
    };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  let complete = false;
  try {
    while (length < readLimit) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) {
        complete = true;
        break;
      }
      if (!value || value.length === 0) continue;
      const remaining = readLimit - length;
      const chunk = value.subarray(0, remaining);
      chunks.push(chunk);
      length += chunk.length;
    }
  } finally {
    try {
      if (!complete) {
        // Promise.race installs rejection handling on cancellation without
        // letting a hostile response stream extend the request deadline.
        await Promise.race([reader.cancel(), Promise.resolve()]);
      }
    } finally {
      reader.releaseLock();
    }
  }

  const prefix = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    prefix.set(chunk, offset);
    offset += chunk.length;
  }
  const parseByteCount = (value) => {
    if (value === null || !/^\d+$/.test(value)) {
      return null;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };
  const rawContentLength = response.headers.get("content-length");
  const contentLength = parseByteCount(rawContentLength);
  if (rawContentLength !== null && contentLength === null) {
    return {
      bytes: prefix,
      complete: false,
      lengthError: "Content-Length is not a valid non-negative byte count",
      totalBytes: null,
    };
  }

  const rawContentRange = response.headers.get("content-range");
  let range = null;
  if (rawContentRange !== null) {
    const match = rawContentRange
      .trim()
      .match(/^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/i);
    if (match) {
      const [start, end, total] = match.slice(1).map(Number);
      if (
        [start, end, total].every(Number.isSafeInteger) &&
        start === 0 &&
        end >= start &&
        total > end
      ) {
        range = { end, start, total };
      }
    }
    if (!range) {
      return {
        bytes: prefix,
        complete: false,
        lengthError: "Content-Range is malformed or does not begin at byte 0",
        totalBytes: null,
      };
    }
  }
  if (response.status === 206 && !range) {
    return {
      bytes: prefix,
      complete: false,
      lengthError: "HTTP 206 response omitted a valid Content-Range header",
      totalBytes: null,
    };
  }

  const expectedResponseBytes = range
    ? range.end - range.start + 1
    : contentLength;
  if (
    expectedResponseBytes !== null &&
    ((complete && expectedResponseBytes !== prefix.length) ||
      expectedResponseBytes < prefix.length)
  ) {
    return {
      bytes: prefix,
      complete: false,
      lengthError: "declared response length does not match the received bytes",
      totalBytes: range?.total ?? contentLength,
    };
  }

  const totalBytes = range?.total ?? contentLength;
  const artifactComplete = range
    ? range.end + 1 === range.total
    : complete || (contentLength !== null && contentLength === prefix.length);
  return {
    bytes: prefix,
    complete: artifactComplete,
    lengthError: null,
    totalBytes,
  };
}

function trustedDownloadUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    // error-policy:J3 redirect locations are untrusted transport input.
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !TRUSTED_ARTIFACT_DOWNLOAD_HOSTS.has(url.hostname.toLowerCase())
  ) {
    return null;
  }
  return url;
}

async function fetchArtifactResponse(
  artifact,
  fetchImpl,
  token,
  controller,
  readLimit,
) {
  let currentUrl = trustedDownloadUrl(artifact.url);
  if (!currentUrl) {
    return {
      failure: {
        status: "artifact-untrusted-redirect",
        detail: "initial artifact host is not trusted",
      },
    };
  }

  for (let redirects = 0; redirects <= MAX_ARTIFACT_REDIRECTS; redirects += 1) {
    const headers = new Headers({
      Accept: "*/*",
      Range: `bytes=0-${readLimit - 1}`,
    });
    // GitHub bearer credentials are scoped to github.com. Signed CDN URLs need
    // no credential and must never receive the token after a redirect.
    if (token && currentUrl.hostname.toLowerCase() === "github.com") {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const response = await withAbort(
      fetchImpl(currentUrl.href, {
        headers,
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      }),
      controller.signal,
    );
    const responseUrl = response.url
      ? trustedDownloadUrl(response.url)
      : currentUrl;
    if (!responseUrl) {
      return {
        failure: {
          status: "artifact-untrusted-redirect",
          detail: "response resolved to an untrusted host",
        },
      };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return {
          failure: {
            status: "artifact-redirect-error",
            detail: `HTTP ${response.status} omitted the Location header`,
          },
        };
      }
      const nextUrl = trustedDownloadUrl(new URL(location, currentUrl).href);
      if (!nextUrl) {
        return {
          failure: {
            status: "artifact-untrusted-redirect",
            detail: "redirect target is not an approved GitHub artifact host",
          },
        };
      }
      if (redirects === MAX_ARTIFACT_REDIRECTS) {
        return {
          failure: {
            status: "artifact-redirect-error",
            detail: `redirect limit of ${MAX_ARTIFACT_REDIRECTS} exceeded`,
          },
        };
      }
      currentUrl = nextUrl;
      continue;
    }
    return { response };
  }
  throw new Error("unreachable artifact redirect state");
}

async function verifyArtifact(
  artifact,
  fetchImpl,
  token,
  timeoutMs,
  contentDigestLimitBytes,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const readLimit =
    contentDigestLimitBytes ??
    (artifact.expectedKind === "document"
      ? DOCUMENT_READ_LIMIT_BYTES
      : ARTIFACT_READ_LIMIT_BYTES);

  try {
    const fetched = await fetchArtifactResponse(
      artifact,
      fetchImpl,
      token,
      controller,
      readLimit,
    );
    if (fetched.failure) return fetched.failure;
    const { response } = fetched;
    if (!response.ok) {
      return {
        status: "artifact-http-error",
        detail: `HTTP ${response.status}`,
      };
    }

    const { bytes, complete, lengthError, totalBytes } =
      await readResponsePrefix(response, controller.signal, readLimit);
    if (lengthError) {
      return { status: "artifact-invalid", detail: lengthError };
    }
    if (bytes.length === 0) {
      return {
        status: "artifact-empty",
        detail: "response body is empty",
      };
    }
    if (contentDigestLimitBytes !== null && !complete) {
      return {
        status: "artifact-invalid",
        detail: `artifact exceeds the ${contentDigestLimitBytes}-byte content verification limit`,
      };
    }

    const contentType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (isHtmlResponse(contentType, bytes)) {
      return {
        status: "artifact-html",
        detail: "response is HTML, not an uploaded artifact",
      };
    }

    const mediaMetadata = mediaMetadataFromBytes(bytes, complete);
    const actualKind = mediaMetadata?.kind ?? null;
    const requiresRecognizedMedia =
      artifact.expectedKind === "image" || artifact.expectedKind === "video";
    if (
      artifact.expectedKind &&
      ((requiresRecognizedMedia && actualKind !== artifact.expectedKind) ||
        (actualKind && artifact.expectedKind !== actualKind))
    ) {
      return {
        status: "artifact-kind-mismatch",
        detail: `expected ${artifact.expectedKind}, received ${actualKind ?? "unrecognized bytes"}`,
      };
    }
    if (
      (contentType.startsWith("image/") || contentType.startsWith("video/")) &&
      !actualKind
    ) {
      return {
        status: "artifact-kind-mismatch",
        detail: "media response is truncated or structurally invalid",
      };
    }
    const effectiveSize = totalBytes ?? (complete ? bytes.length : null);
    if (
      actualKind === "image" &&
      effectiveSize !== null &&
      effectiveSize < MIN_IMAGE_BYTES
    ) {
      return {
        status: "artifact-invalid",
        detail: `image evidence is smaller than ${MIN_IMAGE_BYTES} bytes`,
      };
    }
    if (
      actualKind === "video" &&
      effectiveSize !== null &&
      effectiveSize < MIN_VIDEO_BYTES
    ) {
      return {
        status: "artifact-invalid",
        detail: `video evidence is smaller than ${MIN_VIDEO_BYTES} bytes`,
      };
    }
    if (
      artifact.expectedKind === "document" ||
      (!actualKind && artifact.expectedKind === null)
    ) {
      const invalidDocument = validateDocument(
        bytes,
        complete,
        artifact,
        contentType,
      );
      if (invalidDocument) {
        return { status: "artifact-invalid", detail: invalidDocument };
      }
    }
    if (
      !artifact.expectedKind &&
      !actualKind &&
      UNRELIABLE_CONTENT_TYPES.has(contentType)
    ) {
      const distinctBytes = new Set(bytes).size;
      if (bytes.length < 64 || distinctBytes < 4) {
        return {
          status: "artifact-invalid",
          detail: "opaque artifact is too small or structurally trivial",
        };
      }
    }
    return {
      status: "ok",
      contentSha256: complete
        ? createHash("sha256").update(bytes).digest("hex")
        : null,
    };
  } catch (error) {
    // error-policy:J1 the CLI boundary translates transport failures into a
    // row-level verification failure instead of accepting unreachable proof.
    const timedOut = controller.signal.aborted;
    return {
      status: timedOut ? "artifact-timeout" : "artifact-fetch-error",
      detail: timedOut
        ? `request exceeded ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : "artifact request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Resolves every trusted artifact referenced by an evidence row. Fetch is
 * injected for deterministic tests; the CLI uses the runtime implementation.
 */
export async function verifyReferencedArtifacts(
  body,
  requiredRows = REQUIRED_EVIDENCE_ROWS,
  options = {},
) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError(
      "Artifact verification requires a fetch implementation",
    );
  }
  const concurrency = Math.max(
    1,
    Math.min(
      16,
      Math.trunc(options.concurrency ?? DEFAULT_ARTIFACT_CONCURRENCY),
    ),
  );
  const timeoutMs = Math.max(
    1,
    Math.min(
      60_000,
      Math.trunc(options.timeoutMs ?? DEFAULT_ARTIFACT_TIMEOUT_MS),
    ),
  );
  const contentDigestLimitBytes =
    options.contentDigestLimitBytes === undefined
      ? null
      : Math.max(
          ARTIFACT_READ_LIMIT_BYTES,
          Math.min(
            MAX_CONTENT_DIGEST_BYTES,
            Math.trunc(options.contentDigestLimitBytes),
          ),
        );
  // This standalone script runs outside Turbo task caching; credentials affect
  // transport access, never the deterministic evidence verdict.
  const githubToken = process.env.GITHUB_TOKEN;
  const ghToken = process.env.GH_TOKEN;
  const token = options.token ?? githubToken ?? ghToken ?? "";
  const allowedArtifactKinds = options.allowedArtifactKinds
    ? new Set(options.allowedArtifactKinds)
    : null;
  const rows = extractEvidenceRows(String(body ?? ""));
  const references = [];
  const uniqueArtifacts = new Map();
  const limitFindings = [];

  for (const { id, label } of requiredRows) {
    const rowText = rows.get(id);
    if (rowText === undefined) continue;
    const rowArtifacts = trustedArtifacts(rowText).filter(
      (artifact) =>
        allowedArtifactKinds === null ||
        allowedArtifactKinds.has(artifact.kind),
    );
    if (rowArtifacts.length > MAX_ARTIFACTS_PER_ROW) {
      limitFindings.push({
        id,
        label,
        url: "(artifact count)",
        status: "artifact-limit-exceeded",
        detail: `row references ${rowArtifacts.length} artifacts; maximum is ${MAX_ARTIFACTS_PER_ROW}`,
      });
    }
    for (const artifact of rowArtifacts) {
      const reference = {
        ...artifact,
        expectedKind: expectedArtifactKind(id, artifact, rowText),
        id,
        label,
      };
      references.push(reference);
      if (!uniqueArtifacts.has(artifact.identity)) {
        uniqueArtifacts.set(artifact.identity, reference);
      }
    }
  }

  const referencesByIdentity = new Map();
  for (const reference of references) {
    const uses = referencesByIdentity.get(reference.identity) ?? [];
    uses.push(reference);
    referencesByIdentity.set(reference.identity, uses);
  }
  for (const uses of referencesByIdentity.values()) {
    const rowIds = new Set(uses.map(({ id }) => id));
    if (rowIds.size < 2) continue;
    const kinds = new Set(
      uses.map(({ expectedKind }) => expectedKind ?? "unspecified"),
    );
    for (const use of uses) {
      limitFindings.push({
        id: use.id,
        label: use.label,
        url: use.url,
        status: "artifact-conflict",
        detail: `artifact is reused by ${[...rowIds].join(", ")} with expected kinds ${[...kinds].join(", ")}`,
      });
    }
  }

  const artifacts = [...uniqueArtifacts.values()];
  if (artifacts.length > MAX_ARTIFACTS_TOTAL) {
    const firstReference = references[0];
    limitFindings.push({
      id: firstReference?.id ?? requiredRows[0]?.id ?? "evidence",
      label:
        firstReference?.label ??
        requiredRows[0]?.label ??
        "Referenced evidence artifacts",
      url: "(artifact count)",
      status: "artifact-limit-exceeded",
      detail: `PR references ${artifacts.length} unique artifacts; maximum is ${MAX_ARTIFACTS_TOTAL}`,
    });
  }
  if (limitFindings.length > 0) {
    return {
      ok: false,
      findings: limitFindings,
    };
  }
  const results = await mapWithConcurrency(artifacts, concurrency, (artifact) =>
    verifyArtifact(
      artifact,
      fetchImpl,
      token,
      timeoutMs,
      contentDigestLimitBytes,
    ),
  );
  const resultsByIdentity = new Map(
    artifacts.map((artifact, index) => [artifact.identity, results[index]]),
  );
  const findings = references.map(({ id, identity, kind, label, url }) => {
    const result = resultsByIdentity.get(identity);
    return {
      id,
      label,
      url,
      artifactKind: kind,
      ...result,
    };
  });
  return {
    ok: findings.every((finding) => finding.status === "ok"),
    findings,
  };
}
