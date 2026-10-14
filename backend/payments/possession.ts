import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  type BindingInput,
  evmBindingDigest,
} from "../../contracts/evm/adapter";
import { chainFamily, isEscrowChain } from "../../src/lib/escrow-policy.mjs";
import { decodeSolanaSignature } from "../../src/lib/solana-signature";
import { solanaAddressBytes } from "../../src/lib/wallets";

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function personalMessageHash(message: string): Uint8Array {
  const bytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(
    `\x19Ethereum Signed Message:\n${bytes.length}`,
  );
  const data = new Uint8Array(prefix.length + bytes.length);
  data.set(prefix);
  data.set(bytes, prefix.length);
  return keccak_256(data);
}
/** Recovers the externally owned account that produced a 65-byte secp256k1 signature over a digest. */
function recoverEvmSigner(digest: Uint8Array, signature: string): string {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new Error("Invalid signature");
  const bytes = Uint8Array.from(signature.slice(2).match(/../g) ?? [], (b) =>
    Number.parseInt(b, 16),
  );
  const recovery = bytes[64] >= 27 ? bytes[64] - 27 : bytes[64];
  if (recovery !== 0 && recovery !== 1) throw new Error("Invalid recovery id");
  const recovered = new Uint8Array(65);
  recovered[0] = recovery;
  recovered.set(bytes.slice(0, 64), 1);
  const publicKey = secp256k1.Point.fromBytes(
    secp256k1.recoverPublicKey(recovered, digest, { prehash: false }),
  ).toBytes(false);
  return `0x${hex(keccak_256(publicKey.slice(1)).slice(-20))}`;
}
/** Half the secp256k1 group order: ProjectEscrow rejects a signature with a larger s (EIP-2). */
const MAX_S = BigInt(
  "0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0",
);
/**
 * The exact encoding ProjectEscrow.bindDestination accepts: 65 bytes, low s, and a recovery
 * byte of 27 or 28. Wallets that return a recovery byte of 0 or 1 sign the same digest, so
 * that byte is rewritten; a high-s signature is rejected because the vault rejects it.
 */
export function canonicalEvmSignature(signature: string): string | null {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
  const body = signature.slice(2).toLowerCase();
  const v = Number.parseInt(body.slice(128), 16);
  const recovery = v === 0 || v === 1 ? v + 27 : v;
  if (
    (recovery !== 27 && recovery !== 28) ||
    BigInt(`0x${body.slice(64, 128)}`) > MAX_S
  )
    return null;
  return `0x${body.slice(0, 128)}${recovery.toString(16)}`;
}
/**
 * The destination wallet's EIP-712 acceptance of one exact EVM binding (ProjectEscrow.bindingDigest),
 * in the encoding the vault accepts (see canonicalEvmSignature). EOA only.
 */
export function verifyEvmBindingSignature(
  chainId: bigint,
  vault: string,
  input: BindingInput,
  signature: string,
): boolean {
  if (canonicalEvmSignature(signature) !== signature.toLowerCase())
    return false;
  try {
    const digest = Uint8Array.from(
      evmBindingDigest(chainId, vault, input).slice(2).match(/../g) ?? [],
      (b) => Number.parseInt(b, 16),
    );
    return (
      recoverEvmSigner(digest, signature) === input.destination.toLowerCase()
    );
  } catch {
    return false;
  }
}
/** Only EOA personal_sign and Solana Ed25519 wallets. Contract wallets need reviewed recovery. */
export function verifyPaymentWalletSignature(
  chain: string,
  address: string,
  message: string,
  signature: string,
): boolean {
  try {
    if (chain === "solana") {
      // The shared decoder binds the exact canonical string before the
      // signature is stored as a payment authorization; this caller's
      // contract stays false on every non-canonical form.
      const bytes = decodeSolanaSignature(signature);
      if (bytes === null) return false;
      return ed25519.verify(
        bytes,
        new TextEncoder().encode(message),
        solanaAddressBytes(address),
        { zip215: false },
      );
    }
    if (!isEscrowChain(chain) || chainFamily(chain) !== "evm") return false;
    return (
      recoverEvmSigner(personalMessageHash(message), signature) ===
      address.toLowerCase()
    );
  } catch {
    return false;
  }
}

export function buildPaymentWalletMessage(input: {
  actorId: string;
  chain: string;
  address: string;
  claimId: string;
  claimDigest: string;
  nonce: string;
  expiresAt: string;
}): string {
  return `Authorize Slop automatic contributor payouts\nAudience: slop.cash\nGitHub actor: ${input.actorId}\nChain: ${input.chain}\nWallet: ${input.address}\nClaim: ${input.claimId}\nDigest: ${input.claimDigest}\nNonce: ${input.nonce}\nExpires: ${input.expiresAt}`;
}
