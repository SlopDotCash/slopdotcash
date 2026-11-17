//@ backend dafny
// spec/security/admission.md, "Every reviewed batch covers the next unreviewed inventory entries"

/** @throws {never} */
//@ type bytes number[]
export function selectTextPartEnd(bytes: Uint8Array, start: number, width: number): number {
  //@ requires 0 <= start && start < bytes.length && width > 0
  //@ ensures start < \result && \result <= bytes.length && \result - start <= width
  let end = Math.min(start + width, bytes.length);
  if (end < bytes.length) {
    let newline = end - 1;
    while (newline > start && bytes[newline] !== 10) {
      //@ invariant start <= newline && newline < end
      //@ decreases newline - start
      newline -= 1;
    }
    if (newline > start) end = newline + 1;
    //@ ghost let before = end
    while (end > start + 1 && bytes[end] >= 128 && bytes[end] < 192) {
      //@ invariant start < end && end <= before && before < bytes.length
      //@ decreases end - start
      end -= 1;
    }
  }
  return end;
}

/** @throws {never} */
//@ type bytes number[]
export function textPartEnds(bytes: Uint8Array, width: number): number[] {
  //@ requires width > 0
  //@ ensures (\result.length === 0) <==> (bytes.length === 0)
  //@ ensures \result.length > 0 ==> \result[\result.length - 1] === bytes.length
  //@ ensures \result.length > 0 ==> 0 < \result[0] && \result[0] <= width
  //@ ensures forall(i, 0 <= i && i < \result.length ==> 0 < \result[i] && \result[i] <= bytes.length)
  //@ ensures forall(i, 0 < i && i < \result.length ==> \result[i - 1] < \result[i] && \result[i] - \result[i - 1] <= width)
  const ends: number[] = [];
  let start = 0;
  while (start < bytes.length) {
    //@ invariant 0 <= start && start <= bytes.length
    //@ invariant (ends.length === 0) <==> (start === 0)
    //@ invariant ends.length > 0 ==> ends[ends.length - 1] === start
    //@ invariant ends.length > 0 ==> 0 < ends[0] && ends[0] <= width
    //@ invariant forall(i, 0 <= i && i < ends.length ==> 0 < ends[i] && ends[i] <= start)
    //@ invariant forall(i, 0 < i && i < ends.length ==> ends[i - 1] < ends[i] && ends[i] - ends[i - 1] <= width)
    //@ decreases bytes.length - start
    const end = selectTextPartEnd(bytes, start, width);
    ends.push(end);
    start = end;
  }
  return ends;
}
