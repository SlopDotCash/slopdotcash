//@ backend dafny
// spec/frontend/walletConsent.md, "The prepared and signed bytes must equal the server's message before posting"; spec/backend/bindingConsent.md, "A Solana binding is one half-signed transaction per generation that only the wallet slot completes"
import { matchesAt, sameBetween, zeroBetween } from "./solanaWire.ts";

export const signaturesEnd = 129;
export const destinationAt = 165;
export const payloadLength = 96;

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
