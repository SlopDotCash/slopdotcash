//@ backend dafny
// spec/fees/conversion.md, "Native gas is reserved before signing and committed atomically with the signed row"; spec/settlement/signer.md, "Each service key permits only its named operations and none can pay, withdraw or upgrade"

export interface WireShape {
  kind: number;
  width: number;
  child: number;
  first: number;
  count: number;
}

export interface WireLayout {
  discriminator: number[];
  args: number;
  routePlan: number;
}

export interface WireTable {
  shapes: WireShape[];
  members: number[];
  layouts: WireLayout[];
}

export interface WireNode {
  shape: number;
  number: bigint;
  bytes: number[];
}

export interface WireRead {
  error: number;
  at: number; //@ type nat
  nodes: number;
  node: WireNode;
  items: WireNode[];
}

export interface WireItems {
  error: number;
  at: number; //@ type nat
  nodes: number;
  items: WireNode[];
}

export interface WireField {
  start: number;
  end: number;
  value: bigint;
}

export interface WireFields {
  error: number;
  at: number; //@ type nat
  nodes: number;
  plan: bigint;
  fields: WireField[];
}

export type JupiterWire =
  | { kind: "refused"; error: number; at: number }
  | { kind: "route"; layout: number; fields: WireField[] };

export const unsignedShape = 0;
export const boolShape = 1;
export const bytesShape = 2;
export const optionShape = 3;
export const vecShape = 4;
export const arrayShape = 5;
export const structShape = 6;
export const enumShape = 7;

export const discriminatorBytes = 8;
export const maximumInstructionBytes = 1232;
export const maximumCollection = 256;
export const maximumNodes = 4096;
export const maximumDepth = 32;

export const sizeRefused = 1;
export const unknownInstruction = 2;
export const truncated = 3;
export const collectionTooLarge = 4;
export const boundsExceeded = 5;
export const invalidBool = 6;
export const invalidOption = 8;
export const unknownVariant = 10;
export const trailingBytes = 11;
export const emptyRoute = 12;

//@ pure
export function littleEndian(data: readonly number[], at: number, width: number): bigint {
  //@ requires 0 <= at && 0 <= width && at + width <= data.length
  //@ decreases width
  if (width === 0) return 0n;
  return BigInt(data[at]) + 256n * littleEndian(data, at + 1, width - 1);
}

//@ pure
export function byteSpan(width: number): bigint {
  //@ requires 0 <= width
  //@ decreases width
  if (width === 0) return 1n;
  return 256n * byteSpan(width - 1);
}

//@ pure
export function littleEndianBytes(value: bigint, width: number): number[] {
  //@ requires 0 <= value
  //@ decreases width
  if (width <= 0) return [];
  return [Number(value % 256n)].concat(littleEndianBytes(value / 256n, width - 1));
}

//@ pure
export function lengthPrefix(data: readonly number[], at: number): number {
  //@ requires 0 <= at && at + 4 <= data.length
  return data[at] + 256 * data[at + 1] + 65536 * data[at + 2] + 16777216 * data[at + 3];
}

//@ pure
export function prefixEquals(data: readonly number[], expected: readonly number[], count: number): boolean {
  //@ requires 0 <= count && count <= data.length && count <= expected.length
  //@ decreases count
  if (count === 0) return true;
  return data[count - 1] === expected[count - 1] && prefixEquals(data, expected, count - 1);
}

//@ pure
export function shapeWellFormed(shape: WireShape, shapeCount: number, memberCount: number): boolean {
  if (shape.kind === unsignedShape) return 1 <= shape.width && shape.width <= 16;
  if (shape.kind === boolShape || shape.kind === bytesShape) return true;
  if (shape.kind === optionShape || shape.kind === vecShape) return 0 <= shape.child && shape.child < shapeCount;
  if (shape.kind === arrayShape) return 0 <= shape.child && shape.child < shapeCount && 0 <= shape.count && shape.count <= maximumCollection;
  if (shape.kind === structShape) return 0 <= shape.first && 0 <= shape.count && shape.count <= maximumCollection && shape.first + shape.count <= memberCount;
  if (shape.kind === enumShape) return 0 <= shape.first && 1 <= shape.count && shape.count <= maximumCollection && shape.first + shape.count <= memberCount;
  return false;
}

//@ pure
export function fieldShape(table: WireTable, layout: number, field: number): WireShape {
  //@ requires forall(i, 0 <= i && i < table.members.length ==> 0 <= table.members[i] && table.members[i] < table.shapes.length)
  //@ requires 0 <= layout && layout < table.layouts.length && 0 <= table.layouts[layout].args && table.layouts[layout].args < table.shapes.length
  //@ requires 0 <= table.shapes[table.layouts[layout].args].first + field && table.shapes[table.layouts[layout].args].first + field < table.members.length
  return table.shapes[table.members[table.shapes[table.layouts[layout].args].first + field]];
}

export function wellFormedTable(table: WireTable): boolean {
  //@ ensures \result ==> forall(i, 0 <= i && i < table.members.length ==> 0 <= table.members[i] && table.members[i] < table.shapes.length)
  //@ ensures \result ==> forall(i, 0 <= i && i < table.shapes.length ==> shapeWellFormed(table.shapes[i], table.shapes.length, table.members.length))
  //@ ensures \result ==> forall(i, 0 <= i && i < table.shapes.length && table.shapes[i].kind == enumShape ==> forall(k, table.shapes[i].first <= k && k < table.shapes[i].first + table.shapes[i].count ==> table.shapes[table.members[k]].kind == structShape))
  //@ ensures \result ==> forall(l, 0 <= l && l < table.layouts.length ==> table.layouts[l].discriminator.length == discriminatorBytes && 0 <= table.layouts[l].args && table.layouts[l].args < table.shapes.length && table.shapes[table.layouts[l].args].kind == structShape && 0 <= table.layouts[l].routePlan && table.layouts[l].routePlan < table.shapes[table.layouts[l].args].count && table.shapes[table.members[table.shapes[table.layouts[l].args].first + table.layouts[l].routePlan]].kind == vecShape)
  let m = 0;
  while (m < table.members.length) {
    //@ invariant 0 <= m && m <= table.members.length
    //@ invariant forall(i, 0 <= i && i < m ==> 0 <= table.members[i] && table.members[i] < table.shapes.length)
    if (table.members[m] < 0 || table.members[m] >= table.shapes.length) return false;
    m += 1;
  }
  let s = 0;
  while (s < table.shapes.length) {
    //@ invariant 0 <= s && s <= table.shapes.length
    //@ invariant forall(i, 0 <= i && i < s ==> shapeWellFormed(table.shapes[i], table.shapes.length, table.members.length))
    if (!shapeWellFormed(table.shapes[s], table.shapes.length, table.members.length)) return false;
    s += 1;
  }
  let e = 0;
  while (e < table.shapes.length) {
    //@ invariant 0 <= e && e <= table.shapes.length
    //@ invariant forall(i, 0 <= i && i < e && table.shapes[i].kind == enumShape ==> forall(k, table.shapes[i].first <= k && k < table.shapes[i].first + table.shapes[i].count ==> table.shapes[table.members[k]].kind == structShape))
    if (table.shapes[e].kind === enumShape) {
      let k = table.shapes[e].first;
      while (k < table.shapes[e].first + table.shapes[e].count) {
        //@ invariant table.shapes[e].first <= k && k <= table.shapes[e].first + table.shapes[e].count
        //@ invariant forall(j, table.shapes[e].first <= j && j < k ==> table.shapes[table.members[j]].kind == structShape)
        if (table.shapes[table.members[k]].kind !== structShape) return false;
        k += 1;
      }
    }
    e += 1;
  }
  let l = 0;
  while (l < table.layouts.length) {
    //@ invariant 0 <= l && l <= table.layouts.length
    //@ invariant forall(j, 0 <= j && j < l ==> table.layouts[j].discriminator.length == discriminatorBytes && 0 <= table.layouts[j].args && table.layouts[j].args < table.shapes.length && table.shapes[table.layouts[j].args].kind == structShape && 0 <= table.layouts[j].routePlan && table.layouts[j].routePlan < table.shapes[table.layouts[j].args].count && table.shapes[table.members[table.shapes[table.layouts[j].args].first + table.layouts[j].routePlan]].kind == vecShape)
    const layout = table.layouts[l];
    if (layout.discriminator.length !== discriminatorBytes || layout.args < 0 || layout.args >= table.shapes.length) return false;
    const args = table.shapes[layout.args];
    if (args.kind !== structShape || layout.routePlan < 0 || layout.routePlan >= args.count) return false;
    if (table.shapes[table.members[args.first + layout.routePlan]].kind !== vecShape) return false;
    l += 1;
  }
  return true;
}

//@ pure
export function refusal(error: number, at: number, nodes: number, shape: number): WireRead {
  //@ type at nat
  return { error, at, nodes, node: { shape, number: 0n, bytes: [] }, items: [] };
}

//@ pure
export function withNode(node: WireNode, read: WireItems): WireRead {
  return { error: read.error, at: read.at, nodes: read.nodes, node, items: read.items };
}

//@ pure
export function readShape(data: readonly number[], table: WireTable, shape: number, at: number, nodes: number, depth: number): WireRead {
  //@ type at nat
  //@ requires forall(i, 0 <= i && i < data.length ==> 0 <= data[i] && data[i] <= 255)
  //@ requires forall(i, 0 <= i && i < table.members.length ==> 0 <= table.members[i] && table.members[i] < table.shapes.length)
  //@ requires forall(i, 0 <= i && i < table.shapes.length ==> shapeWellFormed(table.shapes[i], table.shapes.length, table.members.length))
  //@ requires forall(i, 0 <= i && i < table.shapes.length && table.shapes[i].kind == enumShape ==> forall(k, table.shapes[i].first <= k && k < table.shapes[i].first + table.shapes[i].count ==> table.shapes[table.members[k]].kind == structShape))
  //@ requires 0 <= shape && shape < table.shapes.length
  //@ requires 0 <= depth && depth <= maximumDepth + 1
  //@ ensures at <= \result.at && (at <= data.length ==> \result.at <= data.length)
  //@ ensures nodes < \result.nodes && (nodes <= maximumNodes ==> \result.nodes <= maximumNodes + 1)
  //@ ensures \result.error == 0 ==> \result.nodes <= maximumNodes
  //@ ensures \result.error == 0 || \result.error == truncated || \result.error == collectionTooLarge || \result.error == boundsExceeded || \result.error == invalidBool || \result.error == invalidOption || \result.error == unknownVariant
  //@ ensures table.shapes[shape].kind == unsignedShape && \result.error == 0 ==> \result.at == at + table.shapes[shape].width && \result.at <= data.length && \result.node.number == littleEndian(data, at, table.shapes[shape].width)
  //@ ensures table.shapes[shape].kind == vecShape && \result.error == 0 ==> at + 4 <= \result.at && at + 4 <= data.length && \result.node.number == lengthPrefix(data, at)
  //@ ensures nodes < maximumNodes && depth <= maximumDepth && table.shapes[shape].kind == unsignedShape && table.shapes[shape].width > data.length - at ==> \result.error == truncated && \result.at == at
  //@ ensures nodes < maximumNodes && depth <= maximumDepth && table.shapes[shape].kind == vecShape && at + 4 <= data.length && lengthPrefix(data, at) > maximumCollection ==> \result.error == collectionTooLarge && \result.at == at + 4
  //@ ensures nodes < maximumNodes && depth <= maximumDepth && table.shapes[shape].kind == bytesShape && at + 4 <= data.length && lengthPrefix(data, at) > maximumCollection ==> \result.error == collectionTooLarge && \result.at == at + 4
  //@ ensures nodes < maximumNodes && depth <= maximumDepth && table.shapes[shape].kind == boolShape && at < data.length && data[at] > 1 ==> \result.error == invalidBool && \result.at == at + 1
  //@ ensures nodes < maximumNodes && depth <= maximumDepth && table.shapes[shape].kind == optionShape && at < data.length && data[at] > 1 ==> \result.error == invalidOption && \result.at == at + 1
  //@ ensures nodes < maximumNodes && depth <= maximumDepth && table.shapes[shape].kind == enumShape && at < data.length && data[at] >= table.shapes[shape].count ==> \result.error == unknownVariant && \result.at == at + 1
  //@ decreases (maximumDepth + 1 - depth) * 258
  const n = nodes + 1;
  if (n > maximumNodes || depth > maximumDepth) return refusal(boundsExceeded, at, n, shape);
  const s = table.shapes[shape];
  if (s.kind === unsignedShape) {
    if (s.width > data.length - at) return refusal(truncated, at, n, shape);
    return { error: 0, at: at + s.width, nodes: n, node: { shape, number: littleEndian(data, at, s.width), bytes: [] }, items: [] };
  }
  if (s.kind === bytesShape || s.kind === vecShape) {
    if (4 > data.length - at) return refusal(truncated, at, n, shape);
    const count = lengthPrefix(data, at);
    if (count > maximumCollection) return refusal(collectionTooLarge, at + 4, n, shape);
    if (s.kind === vecShape) return withNode({ shape, number: BigInt(count), bytes: [] }, readItems(data, table, true, s.child, 0, count, 0, at + 4, n, depth + 1));
    if (count > data.length - at - 4) return refusal(truncated, at + 4, n, shape);
    return { error: 0, at: at + 4 + count, nodes: n, node: { shape, number: BigInt(count), bytes: data.slice(at + 4, at + 4 + count) }, items: [] };
  }
  if (s.kind === arrayShape) return withNode({ shape, number: 0n, bytes: [] }, readItems(data, table, true, s.child, 0, s.count, 0, at, n, depth + 1));
  if (s.kind === structShape) return withNode({ shape, number: 0n, bytes: [] }, readItems(data, table, false, 0, s.first, s.count, 0, at, n, depth + 1));
  if (at >= data.length) return refusal(truncated, at, n, shape);
  if (s.kind === boolShape) {
    if (data[at] > 1) return refusal(invalidBool, at + 1, n, shape);
    return { error: 0, at: at + 1, nodes: n, node: { shape, number: BigInt(data[at]), bytes: [] }, items: [] };
  }
  if (s.kind === optionShape) {
    if (data[at] > 1) return refusal(invalidOption, at + 1, n, shape);
    if (data[at] === 0) return { error: 0, at: at + 1, nodes: n, node: { shape, number: 0n, bytes: [] }, items: [] };
    return withNode({ shape, number: 1n, bytes: [] }, readItems(data, table, true, s.child, 0, 1, 0, at + 1, n, depth + 1));
  }
  if (data[at] >= s.count) return refusal(unknownVariant, at + 1, n, shape);
  const variant = table.shapes[table.members[s.first + data[at]]];
  return withNode({ shape, number: BigInt(data[at]), bytes: [] }, readItems(data, table, false, 0, variant.first, variant.count, 0, at + 1, n, depth + 1));
}

//@ pure
export function readItems(data: readonly number[], table: WireTable, repeated: boolean, child: number, first: number, count: number, i: number, at: number, nodes: number, depth: number): WireItems {
  //@ type at nat
  //@ requires forall(i, 0 <= i && i < data.length ==> 0 <= data[i] && data[i] <= 255)
  //@ requires forall(i, 0 <= i && i < table.members.length ==> 0 <= table.members[i] && table.members[i] < table.shapes.length)
  //@ requires forall(i, 0 <= i && i < table.shapes.length ==> shapeWellFormed(table.shapes[i], table.shapes.length, table.members.length))
  //@ requires forall(i, 0 <= i && i < table.shapes.length && table.shapes[i].kind == enumShape ==> forall(k, table.shapes[i].first <= k && k < table.shapes[i].first + table.shapes[i].count ==> table.shapes[table.members[k]].kind == structShape))
  //@ requires repeated ==> 0 <= child && child < table.shapes.length
  //@ requires !repeated ==> 0 <= first && first + count <= table.members.length
  //@ requires 0 <= i && i <= count && count <= maximumCollection
  //@ requires 0 <= depth && depth <= maximumDepth + 1
  //@ decreases (maximumDepth + 1 - depth) * 258 + count - i + 1
  if (i >= count) return { error: 0, at, nodes, items: [] };
  const item = readShape(data, table, repeated ? child : table.members[first + i], at, nodes, depth);
  if (item.error !== 0) return { error: item.error, at: item.at, nodes: item.nodes, items: [] };
  const rest = readItems(data, table, repeated, child, first, count, i + 1, item.at, item.nodes, depth);
  return { error: rest.error, at: rest.at, nodes: rest.nodes, items: [item.node].concat(item.items).concat(rest.items) };
}

//@ pure
export function nodeBytes(table: WireTable, node: WireNode): number[] {
  //@ requires 0 <= node.shape && node.shape < table.shapes.length && 0 <= node.number
  const s = table.shapes[node.shape];
  if (s.kind === unsignedShape) return littleEndianBytes(node.number, s.width);
  if (s.kind === bytesShape) return littleEndianBytes(node.number, 4).concat(node.bytes);
  if (s.kind === vecShape) return littleEndianBytes(node.number, 4);
  if (s.kind === arrayShape || s.kind === structShape) return [];
  return [Number(node.number)];
}

//@ pure
export function encodeNodes(table: WireTable, nodes: readonly WireNode[]): number[] {
  //@ requires forall(k, 0 <= k && k < nodes.length ==> 0 <= nodes[k].shape && nodes[k].shape < table.shapes.length && 0 <= nodes[k].number)
  //@ decreases nodes.length
  if (nodes.length === 0) return [];
  return nodeBytes(table, nodes[0]).concat(encodeNodes(table, nodes.slice(1)));
}

//@ pure
export function readFields(data: readonly number[], table: WireTable, first: number, count: number, plan: number, i: number, at: number, nodes: number): WireFields {
  //@ type at nat
  //@ requires forall(i, 0 <= i && i < data.length ==> 0 <= data[i] && data[i] <= 255)
  //@ requires forall(i, 0 <= i && i < table.members.length ==> 0 <= table.members[i] && table.members[i] < table.shapes.length)
  //@ requires forall(i, 0 <= i && i < table.shapes.length ==> shapeWellFormed(table.shapes[i], table.shapes.length, table.members.length))
  //@ requires forall(i, 0 <= i && i < table.shapes.length && table.shapes[i].kind == enumShape ==> forall(k, table.shapes[i].first <= k && k < table.shapes[i].first + table.shapes[i].count ==> table.shapes[table.members[k]].kind == structShape))
  //@ requires 0 <= first && first + count <= table.members.length && 0 <= i && i <= count
  //@ decreases count - i
  if (i >= count) return { error: 0, at, nodes, plan: 0n, fields: [] };
  const field = readShape(data, table, table.members[first + i], at, nodes, 0);
  if (field.error !== 0) return { error: field.error, at: field.at, nodes: field.nodes, plan: 0n, fields: [] };
  const rest = readFields(data, table, first, count, plan, i + 1, field.at, field.nodes);
  return { error: rest.error, at: rest.at, nodes: rest.nodes, plan: i === plan ? field.node.number : rest.plan, fields: [{ start: at, end: field.at, value: field.node.number }].concat(rest.fields) };
}

//@ pure
export function decodeLayout(data: readonly number[], table: WireTable, layout: number): JupiterWire {
  //@ requires forall(i, 0 <= i && i < data.length ==> 0 <= data[i] && data[i] <= 255)
  //@ requires forall(i, 0 <= i && i < table.members.length ==> 0 <= table.members[i] && table.members[i] < table.shapes.length)
  //@ requires forall(i, 0 <= i && i < table.shapes.length ==> shapeWellFormed(table.shapes[i], table.shapes.length, table.members.length))
  //@ requires forall(i, 0 <= i && i < table.shapes.length && table.shapes[i].kind == enumShape ==> forall(k, table.shapes[i].first <= k && k < table.shapes[i].first + table.shapes[i].count ==> table.shapes[table.members[k]].kind == structShape))
  //@ requires forall(l, 0 <= l && l < table.layouts.length ==> table.layouts[l].discriminator.length == discriminatorBytes && 0 <= table.layouts[l].args && table.layouts[l].args < table.shapes.length && table.shapes[table.layouts[l].args].kind == structShape && 0 <= table.layouts[l].routePlan && table.layouts[l].routePlan < table.shapes[table.layouts[l].args].count && table.shapes[table.members[table.shapes[table.layouts[l].args].first + table.layouts[l].routePlan]].kind == vecShape)
  //@ requires discriminatorBytes <= data.length && 0 <= layout
  //@ decreases table.layouts.length - layout
  if (layout >= table.layouts.length) return { kind: "refused", error: unknownInstruction, at: 0 };
  if (!prefixEquals(data, table.layouts[layout].discriminator, discriminatorBytes)) return decodeLayout(data, table, layout + 1);
  const args = table.shapes[table.layouts[layout].args];
  const read = readFields(data, table, args.first, args.count, table.layouts[layout].routePlan, 0, discriminatorBytes, 0);
  if (read.error !== 0) return { kind: "refused", error: read.error, at: read.at };
  if (read.at !== data.length) return { kind: "refused", error: trailingBytes, at: read.at };
  if (read.plan === 0n) return { kind: "refused", error: emptyRoute, at: read.at };
  return { kind: "route", layout, fields: read.fields };
}

//@ pure
export function decodeJupiter(data: readonly number[], table: WireTable): JupiterWire {
  //@ requires forall(i, 0 <= i && i < data.length ==> 0 <= data[i] && data[i] <= 255)
  //@ requires forall(i, 0 <= i && i < table.members.length ==> 0 <= table.members[i] && table.members[i] < table.shapes.length)
  //@ requires forall(i, 0 <= i && i < table.shapes.length ==> shapeWellFormed(table.shapes[i], table.shapes.length, table.members.length))
  //@ requires forall(i, 0 <= i && i < table.shapes.length && table.shapes[i].kind == enumShape ==> forall(k, table.shapes[i].first <= k && k < table.shapes[i].first + table.shapes[i].count ==> table.shapes[table.members[k]].kind == structShape))
  //@ requires forall(l, 0 <= l && l < table.layouts.length ==> table.layouts[l].discriminator.length == discriminatorBytes && 0 <= table.layouts[l].args && table.layouts[l].args < table.shapes.length && table.shapes[table.layouts[l].args].kind == structShape && 0 <= table.layouts[l].routePlan && table.layouts[l].routePlan < table.shapes[table.layouts[l].args].count && table.shapes[table.members[table.shapes[table.layouts[l].args].first + table.layouts[l].routePlan]].kind == vecShape)
  //@ ensures \result.kind == "refused" ==> \result.error == sizeRefused || \result.error == unknownInstruction || \result.error == truncated || \result.error == collectionTooLarge || \result.error == boundsExceeded || \result.error == invalidBool || \result.error == invalidOption || \result.error == unknownVariant || \result.error == trailingBytes || \result.error == emptyRoute
  //@ ensures data.length < discriminatorBytes || data.length > maximumInstructionBytes ==> \result.kind == "refused" && \result.error == sizeRefused
  //@ ensures discriminatorBytes <= data.length && data.length <= maximumInstructionBytes && forall(l, 0 <= l && l < table.layouts.length ==> !prefixEquals(data, table.layouts[l].discriminator, discriminatorBytes)) ==> \result.kind == "refused" && \result.error == unknownInstruction
  //@ ensures \result.kind == "route" ==> discriminatorBytes <= data.length && data.length <= maximumInstructionBytes && 0 <= \result.layout && \result.layout < table.layouts.length && prefixEquals(data, table.layouts[\result.layout].discriminator, discriminatorBytes)
  //@ ensures \result.kind == "route" ==> \result.fields.length == table.shapes[table.layouts[\result.layout].args].count
  //@ ensures \result.kind == "route" ==> \result.fields[0].start == discriminatorBytes && \result.fields[\result.fields.length - 1].end == data.length
  //@ ensures \result.kind == "route" ==> forall(k, 0 <= k && k < \result.fields.length ==> discriminatorBytes <= \result.fields[k].start && \result.fields[k].start <= \result.fields[k].end && \result.fields[k].end <= data.length && (k + 1 < \result.fields.length ==> \result.fields[k].end == \result.fields[k + 1].start))
  //@ ensures \result.kind == "route" ==> forall(k, 0 <= k && k < \result.fields.length && fieldShape(table, \result.layout, k).kind == unsignedShape ==> \result.fields[k].end == \result.fields[k].start + fieldShape(table, \result.layout, k).width && \result.fields[k].value == littleEndian(data, \result.fields[k].start, fieldShape(table, \result.layout, k).width))
  //@ ensures \result.kind == "route" ==> forall(k, 0 <= k && k < \result.fields.length && fieldShape(table, \result.layout, k).kind == vecShape ==> \result.fields[k].start + 4 <= \result.fields[k].end && \result.fields[k].value == lengthPrefix(data, \result.fields[k].start))
  //@ ensures \result.kind == "route" ==> \result.fields[table.layouts[\result.layout].routePlan].value != 0
  if (data.length < discriminatorBytes || data.length > maximumInstructionBytes) return { kind: "refused", error: sizeRefused, at: 0 };
  return decodeLayout(data, table, 0);
}
