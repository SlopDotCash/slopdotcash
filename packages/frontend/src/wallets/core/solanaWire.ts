//@ backend dafny
// spec/frontend/solanaBountyPrompt.md, "The wallet sends only a saved, unexpired plan"; spec/frontend/walletConsent.md, "The prepared and signed bytes must equal the server's message before posting"; spec/backend/bindingConsent.md, "A Solana binding is one half-signed transaction per generation that only the wallet slot completes"

export const signaturesEnd = 129;
export const destinationAt = 165;
export const payloadLength = 96;

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

export function preparedBindingShape(prepared: Uint8Array): boolean {
  //@ type prepared number[]
  //@ ensures \result <==> (prepared.length >= 133 && prepared[0] == 2 && prepared[129] == 2 && prepared[130] == 1 && 2 <= prepared[132] && prepared[132] <= 32 && prepared.length >= 165 + 32 * prepared[132] + 96 && zeroBetween(prepared, 65, 129))
  if (prepared.length < 133 || prepared[0] !== 2 || prepared[129] !== 2 || prepared[130] !== 1) return false;
  const count = prepared[132];
  if (count < 2 || count > 32 || prepared.length < 165 + 32 * count + 96) return false;
  return zeroBetween(prepared, 65, 129);
}

export function signedCompletesPrepared(prepared: Uint8Array, signed: Uint8Array, destination: Uint8Array): boolean {
  //@ type prepared number[]
  //@ type signed number[]
  //@ type destination number[]
  //@ ensures \result <==> (prepared.length >= 197 && prepared[0] == 2 && signed.length == prepared.length && signed[0] == 2 && zeroBetween(prepared, 65, 129) && sameBetween(prepared, signed, 1, 65) && sameBetween(prepared, signed, 129, prepared.length) && prepared[129] == 2 && 2 <= prepared[132] && prepared[132] <= 127 && destination.length == 32 && matchesAt(prepared, 165, destination, 0))
  if (prepared.length < 197 || prepared[0] !== 2 || signed.length !== prepared.length || signed[0] !== 2) return false;
  if (!zeroBetween(prepared, 65, 129) || !sameBetween(prepared, signed, 1, 65) || !sameBetween(prepared, signed, 129, prepared.length)) return false;
  if (prepared[129] !== 2 || prepared[132] < 2 || prepared[132] > 127 || destination.length !== 32) return false;
  return matchesAt(prepared, 165, destination, 0);
}
