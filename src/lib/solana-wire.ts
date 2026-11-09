import { decodeBase64 } from "./byte-encoding";

/**
 * Require the prepared wire transaction to be the exact reviewed message with
 * one empty signature slot, so the wallet signs nothing else.
 */
export function assertUnsignedSolanaWire(
  base64: string,
  msg: Uint8Array,
  what: string,
): void {
  const wire = decodeBase64(base64);
  if (
    wire.length !== 65 + msg.length ||
    wire[0] !== 1 ||
    wire.slice(1, 65).some((byte) => byte !== 0) ||
    msg.some((byte, index) => byte !== wire[index + 65])
  )
    throw new Error(what);
}
