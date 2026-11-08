/** Native UTF-8 byte boundaries used by the complete inventory text splitter. */

//@ verify
//@ type bytes number[]
//@ requires 0 <= start && start < bytes.length && width > 0
//@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
//@ ensures start < \result && \result <= bytes.length && \result - start <= width
//@ ensures \result == TextEnd(bytes, start, width)
export function selectTextPartEnd(
  bytes: Uint8Array,
  start: number,
  width: number,
): number {
  let end = Math.min(start + width, bytes.length);
  if (end < bytes.length) {
    let newline = end - 1;
    while (newline > start && bytes[newline] !== 10) {
      //@ invariant start <= newline && newline < end
      //@ invariant LastNewline(bytes, start, end - 1) == LastNewline(bytes, start, newline)
      newline -= 1;
    }
    if (newline > start) end = newline + 1;
    //@ ghost let before = end
    while (end > start + 1 && bytes[end] >= 128 && bytes[end] < 192) {
      //@ invariant start < end && end <= before && before < bytes.length
      //@ invariant DropContinuation(bytes, start, before) == DropContinuation(bytes, start, end)
      end -= 1;
    }
  }
  return end;
}

/** Complete, strictly increasing ends; every byte belongs to one part. */
//@ verify
//@ type bytes number[]
//@ requires width > 0
//@ requires forall(i, 0 <= i && i < bytes.length ==> 0 <= bytes[i] && bytes[i] <= 255)
//@ ensures (\result.length == 0) <==> bytes.length == 0
//@ ensures \result.length > 0 ==> \result[\result.length - 1] == bytes.length
//@ ensures forall(i, 0 <= i && i < \result.length ==> 0 < \result[i] && \result[i] <= bytes.length)
//@ ensures forall(i, 0 <= i && i < \result.length ==> PartMatches(bytes, \result, i, width))
export function textPartEnds(bytes: Uint8Array, width: number): number[] {
  const ends: number[] = [];
  let start = 0;
  while (start < bytes.length) {
    //@ invariant 0 <= start && start <= bytes.length
    //@ invariant (ends.length == 0) <==> start == 0
    //@ invariant ends.length > 0 ==> ends[ends.length - 1] == start
    //@ invariant forall(i, 0 <= i && i < ends.length ==> 0 < ends[i] && ends[i] <= start)
    //@ invariant forall(i, 0 <= i && i < ends.length ==> PartMatches(bytes, ends, i, width))
    const end = selectTextPartEnd(bytes, start, width);
    ends.push(end);
    start = end;
  }
  return ends;
}
