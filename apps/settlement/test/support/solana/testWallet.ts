// spec/contracts/solanaEscrow.md, "The identity authority and the destination both sign a binding for the project's network"
import { ed25519 } from "@noble/curves/ed25519.js";
import { type Address, addressOf } from "@repo/platform/chain/solanaWire";

export function seededTestWallet(seed: Uint8Array): Address {
  return addressOf(ed25519.getPublicKey(seed)) as Address;
}

export function signTestMessage(message: Uint8Array, seed: Uint8Array): Uint8Array {
  return ed25519.sign(message, seed);
}
