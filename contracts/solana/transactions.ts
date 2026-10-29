/** Shared unsigned transaction encoding for wallet funding and the payment executor. */
import { sha256 } from "@noble/hashes/sha2.js";
import {
  solanaAssociatedTokenAddress as ata,
  solanaPublicKeyBytes as bytes,
  solanaProgramAddress as pda,
} from "./adapter";
import { CLASSIC_TOKEN_PROGRAM } from "./token";

const TOKEN = CLASSIC_TOKEN_PROGRAM,
  ASSOCIATED = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  SYSTEM = "11111111111111111111111111111111";
const encoder = new TextEncoder();
const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
};
function le(value: bigint) {
  if (value < 0n || value > (1n << 64n) - 1n) throw new Error("u64 overflow");
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, value, true);
  return b;
}
const instructionData = (name: string, ...args: Uint8Array[]) =>
  concat(sha256(encoder.encode(`global:${name}`)).slice(0, 8), ...args);
interface Meta {
  key: string;
  write: boolean;
}
interface Instruction {
  program: string;
  accounts: Meta[];
  data: Uint8Array;
}
function short(value: number) {
  const output: number[] = [];
  do {
    let byte = value & 127;
    value >>>= 7;
    if (value) byte |= 128;
    output.push(byte);
  } while (value);
  return Uint8Array.from(output);
}
/** Legacy message: the payer first, then read-only co-signers, then the other accounts. */
function message(
  payer: string,
  blockhash: string,
  instructions: Instruction[],
  cosigners: string[] = [],
): Uint8Array {
  const accounts = new Map<string, boolean>([[payer, true]]);
  for (const c of cosigners) {
    if (c === payer) throw new Error("Co-signer cannot be the payer");
    accounts.set(c, false);
  }
  for (const i of instructions) {
    for (const a of i.accounts)
      accounts.set(a.key, Boolean(accounts.get(a.key) || a.write));
    if (!accounts.has(i.program)) accounts.set(i.program, false);
  }
  const signers = new Set([payer, ...cosigners]);
  if (cosigners.some((c) => accounts.get(c)))
    throw new Error("Co-signers are read-only");
  const keys = [
    payer,
    ...cosigners,
    ...[...accounts].filter(([k, w]) => !signers.has(k) && w).map(([k]) => k),
    ...[...accounts].filter(([k, w]) => !signers.has(k) && !w).map(([k]) => k),
  ];
  if (keys.length > 32) throw new Error("Executor account limit");
  const readonly = keys.filter(
    (k) => !signers.has(k) && !accounts.get(k),
  ).length;
  const compiled = instructions.map((i) =>
    concat(
      Uint8Array.of(keys.indexOf(i.program)),
      short(i.accounts.length),
      Uint8Array.from(i.accounts.map((a) => keys.indexOf(a.key))),
      short(i.data.length),
      i.data,
    ),
  );
  return concat(
    Uint8Array.of(signers.size, cosigners.length, readonly),
    short(keys.length),
    ...keys.map(bytes),
    bytes(blockhash),
    short(compiled.length),
    ...compiled,
  );
}
function createAta(
  payer: string,
  mint: string,
  owner: string,
  tokenProgram = TOKEN,
): Instruction {
  return {
    program: ASSOCIATED,
    accounts: [
      { key: payer, write: true },
      { key: ata(mint, owner, tokenProgram), write: true },
      { key: owner, write: false },
      { key: mint, write: false },
      { key: SYSTEM, write: false },
      { key: tokenProgram, write: false },
    ],
    data: Uint8Array.of(1),
  };
}

export type { Instruction };
export {
  ata,
  bytes,
  concat,
  createAta,
  encoder,
  instructionData,
  le,
  message,
  pda,
  SYSTEM,
  TOKEN,
};
