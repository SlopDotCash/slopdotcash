// spec/contracts/solanaEscrow.md, "Simulation samples cover admitted and refused assets, windows, allocations and signers"
// The Solana wire format the driver needs: base58 keys, program addresses and legacy transactions. The platform's
// solanaWire.ts has these too, but uses syntax Node cannot strip, which the driver's own Node must run.
import { createHash } from "node:crypto";

export type Address = string & { readonly __brand: "SolanaAddress" };

export const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let text = "";
  while (value > 0n) {
    text = (alphabet[Number(value % 58n)] as string) + text;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}

export function base58Decode(text: string): Uint8Array | undefined {
  let value = 0n;
  for (const char of text) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) return undefined;
    value = value * 58n + BigInt(digit);
  }
  const body: number[] = [];
  while (value > 0n) {
    body.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  let zeros = 0;
  while (text[zeros] === "1") zeros++;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...body]);
}

export const base64Encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
export const base64Decode = (text: string): Uint8Array | undefined => new Uint8Array(Buffer.from(text, "base64"));

const p = 2n ** 255n - 19n;
const d = (-121665n * inverse(121666n)) % p;

function power(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let b = ((base % p) + p) % p;
  for (let e = exponent; e > 0n; e >>= 1n) {
    if (e & 1n) result = (result * b) % p;
    b = (b * b) % p;
  }
  return result;
}
function inverse(value: bigint): bigint {
  return power(value, p - 2n);
}

/** Whether 32 bytes decode to a point of edwards25519, which no program address may be. */
export function onCurve(bytes: Uint8Array): boolean {
  let y = 0n;
  for (let at = 31; at >= 0; at--) y = (y << 8n) | BigInt(at === 31 ? (bytes[at] as number) & 0x7f : (bytes[at] as number));
  if (y >= p) return false;
  const y2 = (y * y) % p;
  const x2 = (((y2 - 1n) * inverse((d * y2 + 1n) % p)) % p + p) % p;
  if (x2 === 0n) return ((bytes[31] as number) & 0x80) === 0;
  return power(x2, (p - 1n) / 2n) === 1n;
}

export function findPda(seeds: ReadonlyArray<Uint8Array>, program: Address): { readonly address: Address; readonly bump: number } | undefined {
  const id = base58Decode(program);
  if (id?.length !== 32 || seeds.length > 15 || seeds.some((seed) => seed.length > 32)) return undefined;
  for (let bump = 255; bump >= 0; bump--) {
    const hash = createHash("sha256");
    for (const seed of seeds) hash.update(seed);
    hash.update(Uint8Array.of(bump)).update(id).update("ProgramDerivedAddress");
    const candidate = new Uint8Array(hash.digest());
    if (!onCurve(candidate)) return { address: base58Encode(candidate) as Address, bump };
  }
  return undefined;
}

export function associatedTokenAddress(owner: Address, mint: Address, tokenProgram: Address): Address | undefined {
  const seeds = [owner, tokenProgram, mint].map(base58Decode);
  if (seeds.some((seed) => seed?.length !== 32)) return undefined;
  return findPda(seeds as Uint8Array[], ASSOCIATED_TOKEN_PROGRAM)?.address;
}

export interface Message {
  readonly header: { readonly requiredSignatures: number; readonly readonlySigned: number; readonly readonlyUnsigned: number };
  readonly accountKeys: ReadonlyArray<Address>;
  readonly recentBlockhash: string;
  readonly instructions: ReadonlyArray<{ readonly programIndex: number; readonly accounts: ReadonlyArray<number>; readonly data: Uint8Array }>;
}

function compact(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  do {
    const low = rest & 0x7f;
    rest >>>= 7;
    out.push(rest === 0 ? low : low | 0x80);
  } while (rest !== 0);
  return out;
}

const key = (address: string): Uint8Array => {
  const bytes = base58Decode(address);
  if (bytes?.length !== 32) throw new Error(`${address} is not 32 bytes`);
  return bytes;
};

export function encodeMessage(message: Message): Uint8Array {
  const parts: number[] = [message.header.requiredSignatures, message.header.readonlySigned, message.header.readonlyUnsigned, ...compact(message.accountKeys.length)];
  for (const account of message.accountKeys) parts.push(...key(account));
  parts.push(...key(message.recentBlockhash), ...compact(message.instructions.length));
  for (const instruction of message.instructions) {
    parts.push(instruction.programIndex, ...compact(instruction.accounts.length), ...instruction.accounts, ...compact(instruction.data.length), ...instruction.data);
  }
  return Uint8Array.from(parts);
}

export function encodeTransaction(signatures: ReadonlyArray<Uint8Array>, message: Uint8Array): Uint8Array {
  return Uint8Array.from([...compact(signatures.length), ...signatures.flatMap((signature) => [...signature]), ...message]);
}
