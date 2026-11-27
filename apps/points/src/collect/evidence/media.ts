//@ backend dafny
// spec/points/scoringPolicy.md, "A scored source records its provenance and keeps the 10-Point minimum"

export interface Span {
  start: number;
  end: number;
  crcAt: number;
}

export interface Media {
  kind: number;
  width: number;
  height: number;
  checks: Span[];
}

export interface IsoBox {
  ok: boolean;
  start: number;
  end: number;
  payloadStart: number;
  availableEnd: number;
  truncated: boolean;
  tag: number;
}

export interface IsoList {
  ok: boolean;
  boxes: IsoBox[];
}

export interface Vint {
  ok: boolean;
  length: number;
  unknown: boolean;
  value: number;
}

export interface Element {
  ok: boolean;
  id: number;
  payloadStart: number;
  end: number;
  availableEnd: number;
  truncated: boolean;
}

export interface Elements {
  ok: boolean;
  elements: Element[];
}

export interface SubBlocks {
  complete: boolean;
  offset: number;
  payload: number;
}

export const noKind = 0;
export const imageKind = 1;
export const videoKind = 2;
export const minimumWidth = 320;
export const minimumHeight = 180;
export const maximumSafe = 9007199254740991;

const ihdr = 1229472850;
const idat = 1229209940;
const iend = 1229278788;
const riff = 1380533830;
const webp = 1464156752;
const vp8x = 1448097880;
const vp8l = 1448097868;
const vp8 = 1448097824;
const ftyp = 1718909296;
const moov = 1836019574;
const mdat = 1835295092;
const trak = 1953653099;
const mdia = 1835297121;
const hdlr = 1751411826;
const minf = 1835626086;
const stbl = 1937007212;
const stsd = 1937011556;
const vide = 1986618469;
const ebmlHeader = 440786851;
const docTypeId = 17026;
const segmentId = 408125543;
const tracksId = 374648427;
const clusterId = 524531317;
const trackEntryId = 174;
const trackTypeId = 131;
const videoId = 224;
const pixelWidthId = 176;
const pixelHeightId = 186;
const simpleBlockId = 163;
const blockGroupId = 160;
const blockId = 161;
const webmDocType = 2003133037;

const videoBrands: number[] = [862401121, 862401122, 862416948, 862416949, 862416950, 1295275552, 1295275592, 1295275600, 1297305174, 1635148593, 1668114019, 1668114038, 1684108136, 1769172786, 1769172787, 1769172788, 1769172789, 1769172790, 1769172845, 1836069937, 1836069938, 1903435808];
const videoCodecs: number[] = [1635135537, 1635148593, 1751479857, 1752589105, 1987063865];

//@ pure
export function useful(width: number, height: number): boolean {
  return width >= minimumWidth && height >= minimumHeight;
}

export function none(): Media {
  //@ ensures \result.kind == 0 && \result.checks.length == 0
  return { kind: noKind, width: 0, height: 0, checks: [] };
}

export function byteAt(bytes: Uint8Array, at: number): number {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures -1 <= \result && \result <= 255
  //@ ensures (0 <= at && at < bytes.length) ==> \result >= 0
  if (at < 0 || at >= bytes.length) return -1;
  return bytes[at];
}

export function be16(bytes: Uint8Array, at: number): number {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures -1 <= \result && \result <= 65535
  //@ ensures (0 <= at && at + 2 <= bytes.length) ==> \result >= 0
  if (at < 0 || at + 2 > bytes.length) return -1;
  return bytes[at] * 256 + bytes[at + 1];
}

export function le16(bytes: Uint8Array, at: number): number {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures -1 <= \result && \result <= 65535
  //@ ensures (0 <= at && at + 2 <= bytes.length) ==> \result >= 0
  if (at < 0 || at + 2 > bytes.length) return -1;
  return bytes[at] + bytes[at + 1] * 256;
}

export function be32(bytes: Uint8Array, at: number): number {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures -1 <= \result && \result <= 4294967295
  //@ ensures (0 <= at && at + 4 <= bytes.length) ==> \result >= 0
  if (at < 0 || at + 4 > bytes.length) return -1;
  return be16(bytes, at) * 65536 + be16(bytes, at + 2);
}

export function le32(bytes: Uint8Array, at: number): number {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures -1 <= \result && \result <= 4294967295
  //@ ensures (0 <= at && at + 4 <= bytes.length) ==> \result >= 0
  if (at < 0 || at + 4 > bytes.length) return -1;
  return le16(bytes, at) + le16(bytes, at + 2) * 65536;
}

export function smaller(a: number, b: number): number {
  //@ ensures \result <= a && \result <= b && (\result == a || \result == b)
  return a < b ? a : b;
}

function image(width: number, height: number, checks: Span[]): Media {
  //@ requires useful(width, height)
  //@ ensures \result.kind == 1 && useful(\result.width, \result.height)
  return { kind: imageKind, width, height, checks };
}

function video(width: number, height: number): Media {
  //@ ensures \result.kind == 2
  return { kind: videoKind, width, height, checks: [] };
}

function validPngDepth(colorType: number, bitDepth: number): boolean {
  if (colorType === 0) return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8 || bitDepth === 16;
  if (colorType === 3) return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8;
  if (colorType === 2 || colorType === 4 || colorType === 6) return bitDepth === 8 || bitDepth === 16;
  return false;
}

function pngSignature(bytes: Uint8Array): boolean {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  return be32(bytes, 0) === 2303741511 && be32(bytes, 4) === 218765834;
}

export function pngMedia(bytes: Uint8Array, complete: boolean): Media {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.kind == 0 || (\result.kind == 1 && useful(\result.width, \result.height))
  //@ ensures forall(k, 0 <= k && k < \result.checks.length ==> 0 <= \result.checks[k].start && \result.checks[k].start <= \result.checks[k].end && \result.checks[k].end == \result.checks[k].crcAt && \result.checks[k].crcAt + 4 <= bytes.length)
  if (bytes.length < 41 || !pngSignature(bytes)) return none();
  const checks: Span[] = [];
  let offset = 8;
  let width = 0;
  let height = 0;
  let hasIdat = false;
  while (offset + 8 <= bytes.length) {
    //@ invariant 8 <= offset
    //@ invariant forall(k, 0 <= k && k < checks.length ==> 0 <= checks[k].start && checks[k].start <= checks[k].end && checks[k].end == checks[k].crcAt && checks[k].crcAt + 4 <= bytes.length)
    //@ invariant width == 0 || useful(width, height)
    //@ decreases bytes.length - offset
    const length = be32(bytes, offset);
    const tag = be32(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) {
      if (!complete && tag === idat && width > 0 && bytes.length - dataStart >= 256) return image(width, height, checks);
      return none();
    }
    checks.push({ start: offset + 4, end: dataEnd, crcAt: dataEnd });
    if (offset === 8) {
      if (tag !== ihdr || length !== 13) return none();
      const declaredWidth = be32(bytes, dataStart);
      const declaredHeight = be32(bytes, dataStart + 4);
      const interlace = byteAt(bytes, dataStart + 12);
      if (!useful(declaredWidth, declaredHeight) || !validPngDepth(byteAt(bytes, dataStart + 9), byteAt(bytes, dataStart + 8)) || byteAt(bytes, dataStart + 10) !== 0 || byteAt(bytes, dataStart + 11) !== 0 || (interlace !== 0 && interlace !== 1)) return none();
      width = declaredWidth;
      height = declaredHeight;
    } else if (tag === ihdr) {
      return none();
    } else if (tag === idat) {
      if (length > 0) hasIdat = true;
    } else if (tag === iend) {
      if (length !== 0 || !hasIdat || chunkEnd !== bytes.length || width === 0) return none();
      return image(width, height, checks);
    }
    offset = chunkEnd;
  }
  if (!complete && hasIdat && width > 0) return image(width, height, checks);
  return none();
}

function startOfFrame(marker: number): boolean {
  return (marker >= 192 && marker <= 195) || (marker >= 197 && marker <= 199) || (marker >= 201 && marker <= 203) || (marker >= 205 && marker <= 207);
}

function pastFill(bytes: Uint8Array, start: number): number {
  //@ type bytes number[]
  //@ requires 0 <= start
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result >= start
  let offset = start;
  while (offset < bytes.length && bytes[offset] === 255) {
    //@ invariant start <= offset
    //@ decreases bytes.length - offset
    offset = offset + 1;
  }
  return offset;
}

export function jpegMedia(bytes: Uint8Array, complete: boolean): Media {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.kind == 0 || (\result.kind == 1 && useful(\result.width, \result.height))
  if (bytes.length < 12 || byteAt(bytes, 0) !== 255 || byteAt(bytes, 1) !== 216) return none();
  let offset = 2;
  let width = 0;
  let height = 0;
  while (offset + 3 < bytes.length) {
    //@ invariant 2 <= offset
    //@ invariant width == 0 || useful(width, height)
    //@ decreases bytes.length - offset
    if (byteAt(bytes, offset) !== 255) return none();
    const markerAt = pastFill(bytes, offset);
    const marker = byteAt(bytes, markerAt);
    const segmentAt = markerAt + 1;
    if (marker === 216 || (marker >= 208 && marker <= 215)) {
      offset = segmentAt;
    } else {
      if (marker === 217 || segmentAt + 2 > bytes.length) return none();
      const segmentLength = be16(bytes, segmentAt);
      if (segmentLength < 2 || segmentAt + segmentLength > bytes.length) return none();
      if (startOfFrame(marker)) {
        if (segmentLength < 8) return none();
        const precision = byteAt(bytes, segmentAt + 2);
        const frameHeight = be16(bytes, segmentAt + 3);
        const frameWidth = be16(bytes, segmentAt + 5);
        const components = byteAt(bytes, segmentAt + 7);
        if ((precision !== 8 && precision !== 12) || !useful(frameWidth, frameHeight) || components < 1 || components > 4 || segmentLength < 8 + components * 3) return none();
        width = frameWidth;
        height = frameHeight;
      }
      if (marker === 218) {
        const scanStart = segmentAt + segmentLength;
        const hasEoi = byteAt(bytes, bytes.length - 2) === 255 && byteAt(bytes, bytes.length - 1) === 217;
        const scanEnd = complete ? bytes.length - 2 : bytes.length;
        if (width === 0 || scanEnd - scanStart < 256 || (complete && !hasEoi)) return none();
        return image(width, height, []);
      }
      offset = segmentAt + segmentLength;
    }
  }
  return none();
}

export function colorTableBytes(flags: number): number {
  //@ ensures \result >= 0
  if (flags < 128) return 0;
  const size = flags % 8;
  let entries = 2;
  let i = 0;
  while (i < size) {
    //@ invariant 0 <= i && i <= size && entries >= 2
    //@ decreases size - i
    entries = entries * 2;
    i = i + 1;
  }
  return 3 * entries;
}

export function subBlocks(bytes: Uint8Array, start: number): SubBlocks {
  //@ type bytes number[]
  //@ requires 0 <= start
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.offset >= start && \result.payload >= 0
  //@ ensures \result.complete ==> \result.offset > start
  let offset = start;
  let payload = 0;
  while (offset < bytes.length) {
    //@ invariant start <= offset && payload >= 0
    //@ decreases bytes.length - offset
    const size = bytes[offset];
    offset = offset + 1;
    if (size === 0) return { complete: true, offset, payload };
    const available = smaller(size, bytes.length - offset);
    payload = payload + available;
    offset = offset + available;
    if (available !== size) return { complete: false, offset, payload };
  }
  return { complete: false, offset, payload };
}

function gifSignature(bytes: Uint8Array): boolean {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  const version = byteAt(bytes, 4);
  return byteAt(bytes, 0) === 71 && byteAt(bytes, 1) === 73 && byteAt(bytes, 2) === 70 && byteAt(bytes, 3) === 56 && (version === 55 || version === 57) && byteAt(bytes, 5) === 97;
}

export function gifMedia(bytes: Uint8Array, complete: boolean): Media {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.kind == 0 || (\result.kind == 1 && useful(\result.width, \result.height))
  if (bytes.length < 14 || !gifSignature(bytes)) return none();
  const canvasWidth = le16(bytes, 6);
  const canvasHeight = le16(bytes, 8);
  if (!useful(canvasWidth, canvasHeight)) return none();
  let offset = 13 + colorTableBytes(byteAt(bytes, 10));
  let hasPayload = false;
  while (offset < bytes.length) {
    //@ invariant 0 <= offset
    //@ decreases bytes.length - offset
    const marker = bytes[offset];
    if (marker === 59) {
      if (hasPayload && offset + 1 === bytes.length) return image(canvasWidth, canvasHeight, []);
      return none();
    }
    if (marker === 33) {
      if (offset + 2 > bytes.length) return none();
      const extension = subBlocks(bytes, offset + 2);
      if (!extension.complete) return none();
      offset = extension.offset;
    } else {
      if (marker !== 44 || offset + 10 > bytes.length) return none();
      const left = le16(bytes, offset + 1);
      const top = le16(bytes, offset + 3);
      const frameWidth = le16(bytes, offset + 5);
      const frameHeight = le16(bytes, offset + 7);
      if (frameWidth === 0 || frameHeight === 0 || left + frameWidth > canvasWidth || top + frameHeight > canvasHeight) return none();
      const codeSizeAt = offset + 10 + colorTableBytes(byteAt(bytes, offset + 9));
      if (codeSizeAt >= bytes.length) return none();
      const codeSize = bytes[codeSizeAt];
      if (codeSize < 2 || codeSize > 8) return none();
      const data = subBlocks(bytes, codeSizeAt + 1);
      if (data.payload === 0) return none();
      if (data.payload >= 256) hasPayload = true;
      if (!data.complete) {
        if (!complete && hasPayload) return image(canvasWidth, canvasHeight, []);
        return none();
      }
      offset = data.offset;
    }
  }
  if (!complete && hasPayload) return image(canvasWidth, canvasHeight, []);
  return none();
}

export function webpMedia(bytes: Uint8Array, complete: boolean): Media {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.kind == 0 || (\result.kind == 1 && useful(\result.width, \result.height))
  if (bytes.length < 30 || be32(bytes, 0) !== riff || be32(bytes, 8) !== webp) return none();
  const declaredEnd = le32(bytes, 4) + 8;
  if ((complete && declaredEnd !== bytes.length) || declaredEnd < bytes.length) return none();
  let offset = 12;
  let width = 0;
  let height = 0;
  let hasPayload = false;
  while (offset + 8 <= bytes.length) {
    //@ invariant 12 <= offset
    //@ decreases bytes.length - offset
    const tag = be32(bytes, offset);
    const size = le32(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    const paddedEnd = dataEnd + size % 2;
    const reachable = smaller(dataEnd, bytes.length) - dataStart;
    const available = reachable < 0 ? 0 : reachable;
    if (tag === vp8x && available >= 10) {
      width = 1 + byteAt(bytes, dataStart + 4) + byteAt(bytes, dataStart + 5) * 256 + byteAt(bytes, dataStart + 6) * 65536;
      height = 1 + byteAt(bytes, dataStart + 7) + byteAt(bytes, dataStart + 8) * 256 + byteAt(bytes, dataStart + 9) * 65536;
    } else if (tag === vp8l && available >= 5 && byteAt(bytes, dataStart) === 47) {
      const bits = le32(bytes, dataStart + 1);
      width = bits % 16384 + 1;
      height = Math.floor(bits / 16384) % 16384 + 1;
      hasPayload = available >= 256;
    } else if (tag === vp8 && available >= 10 && byteAt(bytes, dataStart + 3) === 157 && byteAt(bytes, dataStart + 4) === 1 && byteAt(bytes, dataStart + 5) === 42) {
      width = le16(bytes, dataStart + 6) % 16384;
      height = le16(bytes, dataStart + 8) % 16384;
      hasPayload = available >= 256;
    }
    if (paddedEnd > bytes.length) {
      if (!complete && hasPayload && useful(width, height)) return image(width, height, []);
      return none();
    }
    offset = paddedEnd;
  }
  if (offset === bytes.length && hasPayload && useful(width, height)) return image(width, height, []);
  return none();
}

function missingBox(start: number): IsoBox {
  //@ requires start >= 0
  //@ ensures !\result.ok && \result.payloadStart == start
  return { ok: false, start, end: start, payloadStart: start, availableEnd: start, truncated: false, tag: 0 };
}

export function isoBox(bytes: Uint8Array, offset: number, limit: number, completeContainer: boolean): IsoBox {
  //@ type bytes number[]
  //@ requires 0 <= offset
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.ok ==> \result.start == offset && \result.end >= offset + 8 && \result.payloadStart >= offset + 8 && \result.payloadStart <= \result.end && \result.availableEnd <= \result.end && \result.availableEnd <= limit
  //@ ensures \result.ok && !\result.truncated ==> \result.end <= limit
  if (offset + 8 > limit) return missingBox(offset);
  let size = be32(bytes, offset);
  let header = 8;
  if (size === 1) {
    if (offset + 16 > limit) return missingBox(offset);
    const high = be32(bytes, offset + 8);
    const low = be32(bytes, offset + 12);
    if (high < 0 || low < 0 || high > 2097151) return missingBox(offset);
    size = high * 4294967296 + low;
    header = 16;
  } else if (size === 0) {
    if (!completeContainer) return missingBox(offset);
    size = limit - offset;
  }
  if (size < header || offset + size > maximumSafe) return missingBox(offset);
  const end = offset + size;
  return { ok: true, start: offset, end, payloadStart: offset + header, availableEnd: smaller(end, limit), truncated: end > limit, tag: be32(bytes, offset + 4) };
}

export function isoChildren(bytes: Uint8Array, start: number, end: number): IsoList {
  //@ type bytes number[]
  //@ requires 0 <= start
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures forall(k, 0 <= k && k < \result.boxes.length ==> \result.boxes[k].payloadStart >= 0)
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset < end) {
    //@ invariant start <= offset
    //@ invariant forall(k, 0 <= k && k < boxes.length ==> boxes[k].payloadStart >= 0)
    //@ decreases end - offset
    const box = isoBox(bytes, offset, end, true);
    if (!box.ok || box.truncated) return { ok: false, boxes };
    boxes.push(box);
    offset = box.end;
  }
  return { ok: offset === end, boxes };
}

export function isoChild(list: IsoList, tag: number): IsoBox {
  //@ requires forall(k, 0 <= k && k < list.boxes.length ==> list.boxes[k].payloadStart >= 0)
  //@ ensures \result.ok ==> \result.tag == tag
  //@ ensures \result.payloadStart >= 0
  if (!list.ok) return missingBox(0);
  let i = 0;
  while (i < list.boxes.length) {
    //@ invariant 0 <= i && i <= list.boxes.length
    //@ decreases list.boxes.length - i
    const box = list.boxes[i];
    if (box.ok && box.tag === tag) return box;
    i = i + 1;
  }
  return missingBox(0);
}

function oneOf(values: number[], value: number): boolean {
  let i = 0;
  while (i < values.length) {
    //@ invariant 0 <= i && i <= values.length
    //@ decreases values.length - i
    if (values[i] === value) return true;
    i = i + 1;
  }
  return false;
}

export function videoTrack(bytes: Uint8Array, trackBox: IsoBox): boolean {
  //@ type bytes number[]
  //@ requires 0 <= trackBox.payloadStart
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  const media = isoChild(isoChildren(bytes, trackBox.payloadStart, trackBox.end), mdia);
  if (!media.ok) return false;
  const mediaChildren = isoChildren(bytes, media.payloadStart, media.end);
  const handler = isoChild(mediaChildren, hdlr);
  const information = isoChild(mediaChildren, minf);
  if (!handler.ok || handler.end - handler.payloadStart < 12 || be32(bytes, handler.payloadStart + 8) !== vide || !information.ok) return false;
  const table = isoChild(isoChildren(bytes, information.payloadStart, information.end), stbl);
  if (!table.ok) return false;
  const description = isoChild(isoChildren(bytes, table.payloadStart, table.end), stsd);
  if (!description.ok || description.end - description.payloadStart < 16) return false;
  const entryCount = be32(bytes, description.payloadStart + 4);
  const entrySize = be32(bytes, description.payloadStart + 8);
  if (entryCount === 0 || entrySize < 86 || description.payloadStart + 8 + entrySize > description.end) return false;
  const sample = description.payloadStart + 16;
  return oneOf(videoCodecs, be32(bytes, description.payloadStart + 12)) && useful(be16(bytes, sample + 24), be16(bytes, sample + 26));
}

export function hasVideoTrack(bytes: Uint8Array, movie: IsoBox): boolean {
  //@ type bytes number[]
  //@ requires 0 <= movie.payloadStart
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  const children = isoChildren(bytes, movie.payloadStart, movie.end);
  if (!children.ok) return false;
  let i = 0;
  while (i < children.boxes.length) {
    //@ invariant 0 <= i && i <= children.boxes.length
    //@ decreases children.boxes.length - i
    const box = children.boxes[i];
    if (box.ok && box.tag === trak && box.payloadStart >= 0 && videoTrack(bytes, box)) return true;
    i = i + 1;
  }
  return false;
}

function videoBrand(bytes: Uint8Array, first: IsoBox): boolean {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  if (oneOf(videoBrands, be32(bytes, first.payloadStart))) return true;
  let at = first.payloadStart + 8;
  while (at + 4 <= first.end) {
    //@ decreases first.end - at
    if (oneOf(videoBrands, be32(bytes, at))) return true;
    at = at + 4;
  }
  return false;
}

export function isoVideoMedia(bytes: Uint8Array, complete: boolean): Media {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.kind == 0 || \result.kind == 2
  const first = isoBox(bytes, 0, bytes.length, complete);
  if (!first.ok || first.tag !== ftyp || first.truncated || first.end - first.payloadStart < 8 || (first.end - first.payloadStart) % 4 !== 0 || !videoBrand(bytes, first)) return none();
  let offset = first.end;
  let movie = missingBox(0);
  let hasMedia = false;
  while (offset + 8 <= bytes.length) {
    //@ invariant 0 <= offset
    //@ invariant movie.payloadStart >= 0
    //@ decreases bytes.length - offset
    const box = isoBox(bytes, offset, bytes.length, complete);
    if (!box.ok) return none();
    if (box.tag === moov) {
      if (box.truncated) return none();
      movie = box;
    }
    if (box.tag === mdat && box.end - box.payloadStart >= 1024 && box.availableEnd - box.payloadStart >= 1024) hasMedia = true;
    if (box.truncated) {
      if (box.tag !== mdat || complete) return none();
      if (movie.ok && hasMedia && hasVideoTrack(bytes, movie)) return video(0, 0);
      return none();
    }
    offset = box.end;
  }
  if (complete && offset !== bytes.length) return none();
  if (movie.ok && hasMedia && hasVideoTrack(bytes, movie)) return video(0, 0);
  return none();
}

function missingVint(): Vint {
  //@ ensures !\result.ok
  return { ok: false, length: 0, unknown: false, value: 0 };
}

export function ebmlVint(bytes: Uint8Array, offset: number): Vint {
  //@ type bytes number[]
  //@ requires 0 <= offset
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.ok ==> 1 <= \result.length && \result.length <= 8 && offset + \result.length <= bytes.length && \result.value >= 0
  const first = byteAt(bytes, offset);
  if (first <= 0) return missingVint();
  let length = 1;
  let mask = 128;
  while (length <= 8 && Math.floor(first / mask) % 2 === 0) {
    //@ invariant 1 <= length && length <= 9 && mask >= 1
    //@ decreases 9 - length
    length = length + 1;
    mask = mask > 1 ? Math.floor(mask / 2) : 1;
  }
  if (length > 8 || offset + length > bytes.length) return missingVint();
  const low = first % mask;
  let unknown = low === mask - 1;
  let value = low;
  let i = 1;
  while (i < length) {
    //@ invariant 1 <= i && i <= length && value >= 0
    //@ decreases length - i
    const next = bytes[offset + i];
    if (next !== 255) unknown = false;
    value = value * 256 + next;
    i = i + 1;
  }
  if (unknown) return { ok: true, length, unknown: true, value: 0 };
  if (value > maximumSafe) return missingVint();
  return { ok: true, length, unknown: false, value };
}

function missingElement(): Element {
  //@ ensures !\result.ok
  return { ok: false, id: 0, payloadStart: 0, end: 0, availableEnd: 0, truncated: false };
}

export function ebmlElement(bytes: Uint8Array, offset: number, limit: number): Element {
  //@ type bytes number[]
  //@ requires 0 <= offset
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.ok ==> \result.payloadStart > offset && \result.availableEnd <= limit
  const first = byteAt(bytes, offset);
  if (first <= 0) return missingElement();
  let idLength = 1;
  let mask = 128;
  while (idLength <= 4 && Math.floor(first / mask) % 2 === 0) {
    //@ invariant 1 <= idLength && idLength <= 5 && mask >= 1
    //@ decreases 5 - idLength
    idLength = idLength + 1;
    mask = mask > 1 ? Math.floor(mask / 2) : 1;
  }
  if (idLength > 4 || offset + idLength > bytes.length) return missingElement();
  let id = 0;
  let i = 0;
  while (i < idLength) {
    //@ invariant 0 <= i && i <= idLength && id >= 0
    //@ decreases idLength - i
    id = id * 256 + bytes[offset + i];
    i = i + 1;
  }
  const size = ebmlVint(bytes, offset + idLength);
  if (!size.ok) return missingElement();
  const payloadStart = offset + idLength + size.length;
  const end = size.unknown ? limit : payloadStart + size.value;
  if (end > maximumSafe) return missingElement();
  return { ok: true, id, payloadStart, end, availableEnd: smaller(end, limit), truncated: !size.unknown && end > limit };
}

export function ebmlChildren(bytes: Uint8Array, start: number, end: number): Elements {
  //@ type bytes number[]
  //@ requires 0 <= start
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures forall(k, 0 <= k && k < \result.elements.length ==> \result.elements[k].ok && \result.elements[k].payloadStart >= 0)
  const elements: Element[] = [];
  let offset = start;
  while (offset < end) {
    //@ invariant start <= offset
    //@ invariant forall(k, 0 <= k && k < elements.length ==> elements[k].ok && elements[k].payloadStart >= 0)
    //@ decreases end - offset
    const element = ebmlElement(bytes, offset, end);
    if (!element.ok || element.payloadStart > end) return { ok: false, elements: [] };
    elements.push(element);
    if (element.truncated || element.end <= offset) return { ok: true, elements };
    offset = element.end;
  }
  return { ok: true, elements };
}

export function firstElement(list: Elements, id: number): Element {
  //@ requires forall(k, 0 <= k && k < list.elements.length ==> list.elements[k].ok && list.elements[k].payloadStart >= 0)
  //@ ensures \result.ok ==> \result.id == id && \result.payloadStart >= 0
  let i = 0;
  while (i < list.elements.length) {
    //@ invariant 0 <= i && i <= list.elements.length
    //@ decreases list.elements.length - i
    const element = list.elements[i];
    if (element.id === id) return element;
    i = i + 1;
  }
  return missingElement();
}

export function ebmlUnsigned(bytes: Uint8Array, element: Element): number {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result >= -1
  const length = element.availableEnd - element.payloadStart;
  if (!element.ok || element.truncated || length < 1 || length > 6 || element.payloadStart < 0) return -1;
  let value = 0;
  let at = element.payloadStart;
  while (at < element.end) {
    //@ invariant value >= 0
    //@ decreases element.end - at
    const next = byteAt(bytes, at);
    if (next < 0) return -1;
    value = value * 256 + next;
    at = at + 1;
  }
  return value;
}

export function webmTrack(bytes: Uint8Array, tracks: Element): Media {
  //@ type bytes number[]
  //@ requires tracks.payloadStart >= 0
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.kind == 0 || \result.kind == 2
  const entries = ebmlChildren(bytes, tracks.payloadStart, tracks.end);
  let i = 0;
  while (i < entries.elements.length) {
    //@ invariant 0 <= i && i <= entries.elements.length
    //@ decreases entries.elements.length - i
    const entry = entries.elements[i];
    if (entry.id === trackEntryId && !entry.truncated) {
      const children = ebmlChildren(bytes, entry.payloadStart, entry.end);
      const kind = firstElement(children, trackTypeId);
      const picture = firstElement(children, videoId);
      if (ebmlUnsigned(bytes, kind) === 1 && picture.ok && !picture.truncated) {
        const pictureChildren = ebmlChildren(bytes, picture.payloadStart, picture.end);
        const width = ebmlUnsigned(bytes, firstElement(pictureChildren, pixelWidthId));
        const height = ebmlUnsigned(bytes, firstElement(pictureChildren, pixelHeightId));
        if (useful(width, height)) return video(width, height);
      }
    }
    i = i + 1;
  }
  return none();
}

export function clusterHasPayload(bytes: Uint8Array, cluster: Element): boolean {
  //@ type bytes number[]
  //@ requires cluster.payloadStart >= 0
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  const children = ebmlChildren(bytes, cluster.payloadStart, cluster.availableEnd);
  let i = 0;
  while (i < children.elements.length) {
    //@ invariant 0 <= i && i <= children.elements.length
    //@ decreases children.elements.length - i
    const child = children.elements[i];
    if (child.id === simpleBlockId && child.availableEnd - child.payloadStart >= 256) {
      const vint = ebmlVint(bytes, child.payloadStart);
      if (vint.ok) return true;
    }
    if (child.id === blockGroupId) {
      const block = firstElement(ebmlChildren(bytes, child.payloadStart, child.availableEnd), blockId);
      if (block.ok && block.availableEnd - block.payloadStart >= 256) return true;
    }
    i = i + 1;
  }
  return false;
}

export function webmMedia(bytes: Uint8Array): Media {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.kind == 0 || \result.kind == 2
  const header = ebmlElement(bytes, 0, bytes.length);
  if (!header.ok || header.id !== ebmlHeader || header.truncated) return none();
  const docType = firstElement(ebmlChildren(bytes, header.payloadStart, header.end), docTypeId);
  if (!docType.ok || docType.truncated || docType.end - docType.payloadStart !== 4 || be32(bytes, docType.payloadStart) !== webmDocType) return none();
  if (header.end < 0) return none();
  const segment = ebmlElement(bytes, header.end, bytes.length);
  if (!segment.ok || segment.id !== segmentId) return none();
  const children = ebmlChildren(bytes, segment.payloadStart, segment.availableEnd);
  let tracks = missingElement();
  let i = 0;
  while (i < children.elements.length && !tracks.ok) {
    //@ invariant 0 <= i && i <= children.elements.length
    //@ invariant tracks.ok ==> tracks.payloadStart >= 0
    //@ decreases children.elements.length - i
    const element = children.elements[i];
    if (element.id === tracksId && !element.truncated) tracks = element;
    i = i + 1;
  }
  const cluster = firstElement(children, clusterId);
  if (!tracks.ok || !cluster.ok || !clusterHasPayload(bytes, cluster)) return none();
  return webmTrack(bytes, tracks);
}

export function mediaOf(bytes: Uint8Array, complete: boolean): Media {
  //@ type bytes number[]
  //@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
  //@ ensures \result.kind == 0 || (\result.kind == 1 && useful(\result.width, \result.height)) || \result.kind == 2
  const png = pngMedia(bytes, complete);
  if (png.kind !== noKind) return png;
  const jpeg = jpegMedia(bytes, complete);
  if (jpeg.kind !== noKind) return jpeg;
  const gif = gifMedia(bytes, complete);
  if (gif.kind !== noKind) return gif;
  const still = webpMedia(bytes, complete);
  if (still.kind !== noKind) return still;
  const moving = webmMedia(bytes);
  if (moving.kind !== noKind) return moving;
  return isoVideoMedia(bytes, complete);
}
