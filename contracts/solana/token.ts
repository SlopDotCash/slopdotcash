/** Owner and fee-flow views of the canonical token-program admission reader. */
import { decodeBase58Bytes } from "../../src/lib/base58";
import {
  readTokenAccount,
  readTokenMint,
  TOKEN_2022_PROGRAM,
} from "./token-extensions";

export {
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM as CLASSIC_TOKEN_PROGRAM,
} from "./token-extensions";

export function inspectMintAccount(value: unknown, mintAddress: string) {
  const reading = readTokenMint(value, decodeBase58Bytes(mintAddress));
  return {
    tokenProgram: reading.program,
    bytes: reading.raw,
    decimals: reading.decimals,
  };
}

export function inspectTokenAccount(value: unknown, expectedProgram: string) {
  const reading = readTokenAccount(value);
  if (reading.program !== expectedProgram)
    throw new Error("Token account program differs from its admitted mint");
  if (reading.program === TOKEN_2022_PROGRAM && reading.raw[108] !== 1)
    throw new Error("Token-2022 account is not initialized");
  return { tokenProgram: reading.program, bytes: reading.raw };
}
