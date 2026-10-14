/**
 * The one canonical decoding of a Solana Ed25519 signature, shared by the
 * wallet-possession validator and the payment wallet verifier. `atob`
 * discards the unused low bits of the final base64 character, so the
 * decoded bytes are re-encoded and the exact string is required: a
 * signature has exactly one accepted representation wherever it is stored
 * or reverified. Uses only the global `atob`/`btoa` (browser, Worker, Bun,
 * Node).
 */

/** Ed25519 detached signatures are exactly 64 bytes, padded base64. */
const SOLANA_SIGNATURE_PATTERN = /^[A-Za-z0-9+/]{86}==$/u;

/**
 * Returns the 64 signature bytes, or null when the value is not the one
 * canonical padded base64 form. Callers keep their own null contract.
 */
export function decodeSolanaSignature(signature: unknown): Uint8Array | null {
  if (
    typeof signature !== "string" ||
    !SOLANA_SIGNATURE_PATTERN.test(signature)
  ) {
    return null;
  }
  const binary = atob(signature);
  if (btoa(binary) !== signature) return null;
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
