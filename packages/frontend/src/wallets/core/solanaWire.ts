//@ backend dafny
// spec/frontend/solanaBountyPrompt.md, "The wallet sends only a saved, unexpired plan"; spec/frontend/walletConsent.md, "The prepared and signed bytes must equal the server's message before posting"

//@ pure
export function zeroBetween(bytes: Uint8Array, from: number, to: number): boolean {
  //@ type bytes number[]
  //@ requires 0 <= from && from <= to && to <= bytes.length
  //@ decreases to - from
  if (from === to) return true;
  return bytes[from] === 0 && zeroBetween(bytes, from + 1, to);
}

//@ pure
export function matchesAt(wire: Uint8Array, offset: number, part: Uint8Array, from: number): boolean {
  //@ type wire number[]
  //@ type part number[]
  //@ requires 0 <= offset && 0 <= from && from <= part.length && offset + part.length <= wire.length
  //@ decreases part.length - from
  if (from === part.length) return true;
  return wire[offset + from] === part[from] && matchesAt(wire, offset, part, from + 1);
}

//@ pure
export function sameBetween(left: Uint8Array, right: Uint8Array, from: number, to: number): boolean {
  //@ type left number[]
  //@ type right number[]
  //@ requires 0 <= from && from <= to && to <= left.length && to <= right.length
  //@ decreases to - from
  if (from === to) return true;
  return left[from] === right[from] && sameBetween(left, right, from + 1, to);
}

export function unsignedWireOf(wire: Uint8Array, message: Uint8Array): boolean {
  //@ type wire number[]
  //@ type message number[]
  //@ ensures \result <==> (wire.length == 65 + message.length && wire[0] == 1 && zeroBetween(wire, 1, 65) && matchesAt(wire, 65, message, 0))
  if (wire.length !== 65 + message.length || wire[0] !== 1) return false;
  return zeroBetween(wire, 1, 65) && matchesAt(wire, 65, message, 0);
}
