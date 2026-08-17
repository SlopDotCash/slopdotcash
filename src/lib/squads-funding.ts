/** Read-only assertions binding a reviewed Squads v4 2-of-2 multisig, its
 * canonical vault PDA, and its Solana mainnet USDC token account. */
import { SOLANA_MAINNET_USDC_MINT, USDC_DECIMALS } from "./settlement-plan";
import { isSolanaAddress } from "./wallets";

export const SQUADS_V4_PROGRAM_ID =
  "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf" as const;
export const SPL_TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as const;
export const COMMITMENT_SQUADS_VERIFIER_VERSION =
  "commitment-squads-v2" as const;
const MULTISIG_DISCRIMINATOR = new Uint8Array([
  224, 116, 121, 186, 68, 161, 79, 236,
]);
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);
const ENCODER = new TextEncoder();
const PDA_MARKER = ENCODER.encode("ProgramDerivedAddress");
const P = (1n << 255n) - 19n;

export interface VerifiedSquadsVaultIdentity {
  funderMember: string;
  memberCount: 2;
  multisig: string;
  stewardMember: string;
  threshold: 2;
  vault: string;
  vaultIndex: number;
}
export interface VerifiedSquadsVaultState extends VerifiedSquadsVaultIdentity {
  balanceMinor: string;
  slot: number;
  tokenAccount: string;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`${field} must be an object`);
  return value as Record<string, unknown>;
}
function checkedSlot(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new TypeError(
      "Solana accounts response slot must be a non-negative safe integer",
    );
  return Number(value);
}
function mod(value: bigint): bigint {
  const reduced = value % P;
  return reduced < 0n ? reduced + P : reduced;
}
function power(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let factor = mod(base);
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) result = mod(result * factor);
    factor = mod(factor * factor);
    remaining >>= 1n;
  }
  return result;
}
function invert(value: bigint): bigint {
  return power(value, P - 2n);
}
const D = mod(-121665n * invert(121666n));
const SQRT_M1 = power(2n, (P - 1n) / 4n);

function decodeBase58(value: string): Uint8Array {
  const bytes: number[] = [0];
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) throw new TypeError("invalid base58 public key");
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const leadingZeroes = value.match(/^1*/u)?.[0].length ?? 0;
  const significant = bytes.length === 1 && bytes[0] === 0 ? [] : bytes;
  const decoded = new Uint8Array(leadingZeroes + significant.length);
  for (let index = 0; index < significant.length; index += 1)
    decoded[decoded.length - 1 - index] = significant[index];
  if (decoded.length !== 32) throw new TypeError("invalid Solana public key");
  return decoded;
}
function encodeBase58(value: Uint8Array): string {
  const digits: number[] = [0];
  for (const byte of value) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === 0)
    leadingZeroes += 1;
  const significant =
    digits.length === 1 && digits[0] === 0 ? [] : digits.reverse();
  return `${"1".repeat(leadingZeroes)}${significant.map((digit) => BASE58_ALPHABET[digit]).join("")}`;
}
function isEd25519Point(encoded: Uint8Array): boolean {
  let y = 0n;
  for (let index = 31; index >= 0; index -= 1)
    y =
      (y << 8n) | BigInt(index === 31 ? encoded[index] & 0x7f : encoded[index]);
  if (y >= P) return false;
  const sign = encoded[31] >> 7;
  const ySquared = mod(y * y);
  const xSquared = mod((ySquared - 1n) * invert(D * ySquared + 1n));
  let x = power(xSquared, (P + 3n) / 8n);
  if (mod(x * x - xSquared) !== 0n) x = mod(x * SQRT_M1);
  return mod(x * x - xSquared) === 0n && !(x === 0n && sign === 1);
}
function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

/** Derives the canonical Squads v4 vault PDA using the official seed layout. */
export async function deriveSquadsVaultAddress(
  multisig: string,
  vaultIndex: number,
): Promise<string> {
  if (!isSolanaAddress(multisig))
    throw new TypeError("multisig is not a Solana public key");
  if (!Number.isInteger(vaultIndex) || vaultIndex < 0 || vaultIndex > 255)
    throw new TypeError("vault index must be an integer from 0 through 255");
  const seeds = [
    ENCODER.encode("multisig"),
    decodeBase58(multisig),
    ENCODER.encode("vault"),
    new Uint8Array([vaultIndex]),
  ];
  const program = decodeBase58(SQUADS_V4_PROGRAM_ID);
  for (let bump = 255; bump >= 0; bump -= 1) {
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        concat([...seeds, new Uint8Array([bump]), program, PDA_MARKER]),
      ),
    );
    if (!isEd25519Point(digest)) return encodeBase58(digest);
  }
  throw new TypeError("Squads vault PDA could not be derived");
}
function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length > 4096)
    throw new TypeError("Squads multisig account data is invalid");
  let binary: string;
  try {
    binary = atob(value);
  } catch (error) {
    throw new TypeError("Squads multisig account data is not base64", {
      cause: error,
    });
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (btoa(String.fromCharCode(...bytes)) !== value)
    throw new TypeError("Squads multisig account data is not canonical base64");
  return bytes;
}

/** Validates the Squads-owned multisig account and the declared vault PDA. */
export async function assertSquadsVaultIdentity(
  accountValue: unknown,
  multisig: string,
  vault: string,
  vaultIndex: number,
  funderMember: string,
  stewardMember: string,
): Promise<VerifiedSquadsVaultIdentity> {
  if (
    !isSolanaAddress(multisig) ||
    !isSolanaAddress(vault) ||
    !isSolanaAddress(funderMember) ||
    !isSolanaAddress(stewardMember)
  )
    throw new TypeError(
      "multisig, vault, or reviewed member is not a Solana public key",
    );
  if (multisig === vault || funderMember === stewardMember)
    throw new TypeError(
      "multisig, vault, and reviewed members must be distinct",
    );
  if (vault !== (await deriveSquadsVaultAddress(multisig, vaultIndex)))
    throw new TypeError(
      "vault is not the canonical Squads PDA for this multisig and index",
    );
  if (accountValue === null || accountValue === undefined)
    throw new TypeError(
      "Squads multisig account is absent at finalized commitment",
    );
  const account = record(accountValue, "Squads multisig account");
  if (account.owner !== SQUADS_V4_PROGRAM_ID || account.executable !== false)
    throw new TypeError(
      "multisig account is not owned by the Squads v4 program",
    );
  if (
    !Array.isArray(account.data) ||
    account.data.length !== 2 ||
    account.data[1] !== "base64"
  )
    throw new TypeError("Squads multisig account data is not raw base64");
  const bytes = decodeBase64(account.data[0]);
  if (
    bytes.length < 132 ||
    !MULTISIG_DISCRIMINATOR.every((byte, index) => bytes[index] === byte)
  )
    throw new TypeError("account is not a Squads v4 multisig");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!bytes.slice(40, 72).every((byte) => byte === 0))
    throw new TypeError(
      "committed Squads multisig must have no config authority",
    );
  const threshold = view.getUint16(72, true);
  const memberCount = view.getUint32(128, true);
  if (
    threshold !== 2 ||
    memberCount !== 2 ||
    bytes.length !== 132 + 33 * memberCount
  )
    throw new TypeError(
      "committed Squads vault must use an exact 2-of-2 multisig",
    );
  const firstMember = bytes.slice(132, 164);
  const secondMember = bytes.slice(165, 197);
  const expectedFunder = decodeBase58(funderMember);
  const expectedSteward = decodeBase58(stewardMember);
  const firstPermissions = bytes[164];
  const secondPermissions = bytes[197];
  if (
    firstMember.every((byte) => byte === 0) ||
    secondMember.every((byte) => byte === 0) ||
    firstMember.every((byte, index) => byte === secondMember[index]) ||
    !(
      (firstMember.every((byte, index) => byte === expectedFunder[index]) &&
        secondMember.every((byte, index) => byte === expectedSteward[index])) ||
      (firstMember.every((byte, index) => byte === expectedSteward[index]) &&
        secondMember.every((byte, index) => byte === expectedFunder[index]))
    ) ||
    firstPermissions < 1 ||
    firstPermissions > 7 ||
    secondPermissions < 1 ||
    secondPermissions > 7 ||
    (firstPermissions & 2) === 0 ||
    (secondPermissions & 2) === 0
  )
    throw new TypeError(
      "committed Squads multisig requires the exact two reviewed voting members",
    );
  return {
    funderMember,
    memberCount: 2,
    multisig,
    stewardMember,
    threshold: 2,
    vault,
    vaultIndex,
  };
}

/** Validates one finalized getMultipleAccounts multisig/token observation. */
export async function assertSquadsVaultUsdcState(
  resultValue: unknown,
  multisig: string,
  vault: string,
  vaultIndex: number,
  tokenAccount: string,
  funderMember: string,
  stewardMember: string,
): Promise<VerifiedSquadsVaultState> {
  if (!isSolanaAddress(tokenAccount) || tokenAccount === vault)
    throw new TypeError("vault token account is invalid");
  const result = record(resultValue, "Solana accounts response");
  const context = record(result.context, "Solana accounts response.context");
  const observedSlot = checkedSlot(context.slot);
  if (!Array.isArray(result.value) || result.value.length !== 2)
    throw new TypeError(
      "Solana accounts response must contain multisig and token accounts",
    );
  const identity = await assertSquadsVaultIdentity(
    result.value[0],
    multisig,
    vault,
    vaultIndex,
    funderMember,
    stewardMember,
  );
  if (result.value[1] === null || result.value[1] === undefined)
    throw new TypeError(
      "vault USDC token account is absent at finalized commitment",
    );
  const account = record(result.value[1], "Solana token account");
  if (account.owner !== SPL_TOKEN_PROGRAM_ID)
    throw new TypeError(
      "vault token account is not owned by the SPL token program",
    );
  const data = record(account.data, "Solana token account data");
  if (data.program !== "spl-token")
    throw new TypeError("vault token account data is not parsed SPL token");
  const parsed = record(data.parsed, "Solana token account parsed data");
  if (parsed.type !== "account")
    throw new TypeError("vault token account is not a token account");
  const info = record(parsed.info, "Solana token account info");
  if (info.mint !== SOLANA_MAINNET_USDC_MINT)
    throw new TypeError("vault token account mint is not mainnet USDC");
  if (info.owner !== vault)
    throw new TypeError(
      "vault token account owner is not the declared vault address",
    );
  const amount = record(info.tokenAmount, "Solana token account amount");
  if (
    amount.decimals !== USDC_DECIMALS ||
    typeof amount.amount !== "string" ||
    amount.amount.length > 40 ||
    !/^(?:0|[1-9]\d*)$/u.test(amount.amount)
  )
    throw new TypeError("vault token account balance is not canonical");
  return {
    ...identity,
    balanceMinor: amount.amount,
    slot: observedSlot,
    tokenAccount,
  };
}
