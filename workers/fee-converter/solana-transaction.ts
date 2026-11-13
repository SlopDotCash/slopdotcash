/** Versioned Solana transaction parsing shared by the converter and its route receipt check. */
import { solanaBase58 } from "../../contracts/solana/adapter";
import { parseSolanaWire } from "./verified-solana-wire";

export const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

export interface ParsedTransaction {
  signatureCount: number;
  messageOffset: number;
  requiredSignatures: number;
  readonlySigned: number;
  readonlyUnsigned: number;
  staticKeys: string[];
  blockhashOffset: number;
  programs: string[];
  legacy: boolean;
  lookups: { address: string; writable: number[]; readonly: number[] }[];
  instructions: { program: string; accounts: number[]; data: Uint8Array }[];
}

/** Parse the entire signed wire message, including every v0 address lookup. */
export function parseTransaction(raw: Uint8Array): ParsedTransaction {
  const result = parseSolanaWire(raw);
  if (result.kind === "failure") {
    const errors = [
      "",
      "truncated transaction",
      "invalid compact length",
      "invalid transaction size",
      "unsupported message version",
      "invalid transaction signer header",
      "program id outside the static keys",
      "invalid transaction account indexes or trailing bytes",
    ];
    throw new Error(errors[result.error]);
  }
  const parsed = result.value;
  const staticKeys = Array.from({ length: parsed.keyCount }, (_, index) =>
    solanaBase58(
      raw.slice(
        parsed.staticStart + index * 32,
        parsed.staticStart + (index + 1) * 32,
      ),
    ),
  );
  const instructions = parsed.instructions.map((instruction) => ({
    program: staticKeys[instruction.program],
    accounts: [
      ...raw.slice(instruction.accounts.start, instruction.accounts.end),
    ],
    data: raw.slice(instruction.data.start, instruction.data.end),
  }));
  const lookups = parsed.lookups.map((lookup) => ({
    address: solanaBase58(raw.slice(lookup.address.start, lookup.address.end)),
    writable: [...raw.slice(lookup.writable.start, lookup.writable.end)],
    readonly: [...raw.slice(lookup.readonly.start, lookup.readonly.end)],
  }));
  return {
    signatureCount: parsed.signatureCount,
    messageOffset: parsed.messageOffset,
    requiredSignatures: parsed.requiredSignatures,
    readonlySigned: parsed.readonlySigned,
    readonlyUnsigned: parsed.readonlyUnsigned,
    staticKeys,
    blockhashOffset: parsed.blockhashOffset,
    programs: instructions.map((instruction) => instruction.program),
    legacy: parsed.legacy,
    lookups,
    instructions,
  };
}
