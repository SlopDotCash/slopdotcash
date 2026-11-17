// spec/settlement/ownerTransactions.md, "A request is reviewed against current authority and becomes a fixed plan"
import { sha256 } from "@noble/hashes/sha2.js";
import { type Address, SYSTEM_PROGRAM } from "@repo/platform/chain/solana";
import { type Digest, type U64, digestOf, u64le, utf8 } from "../chain/solana/bytes.ts";
import { anchorData, createTokenAccount, meta } from "../chain/solana/instructions.ts";
import { type TokenProgram, tokenAccountAddress, vaultAddress } from "../chain/solana/pda.ts";
import type { Instruction } from "../chain/solana/transactions.ts";

export type FundingOperation = "deposit" | "withdraw";

export type FundingAsset = { readonly kind: "Native" } | { readonly kind: "Token"; readonly mint: Address; readonly tokenProgram: TokenProgram };

export interface FundingTerms {
  readonly program: Address;
  readonly project: Address;
  readonly owner: Address;
  readonly asset: FundingAsset;
  readonly operation: FundingOperation;
  readonly wallet: Address;
  readonly gross: U64;
}

/** @throws {never} */
export function registryProjectDigest(projectId: string): Digest {
  return digestOf(sha256(utf8(`slop-project:${projectId}`))) as Digest;
}

/** @throws {never} */
export function fundingInstructions(terms: FundingTerms): ReadonlyArray<Instruction> {
  const { program, project, asset, wallet } = terms;
  const vault = vaultAddress(program, project);
  const amount = u64le(terms.gross);
  if (asset.kind === "Native")
    return [{
      program,
      accounts: [meta(wallet, true, true), meta(project, true), meta(vault, true), terms.operation === "deposit" ? meta(SYSTEM_PROGRAM, false) : meta(terms.owner, true)],
      data: anchorData(`${terms.operation}_native`, amount),
    }];
  const walletTokens = tokenAccountAddress(wallet, asset.mint, asset.tokenProgram);
  const [from, to] = terms.operation === "deposit" ? [walletTokens, vault] : [vault, walletTokens];
  const action: Instruction = {
    program,
    accounts: [meta(wallet, true, true), meta(project, true), meta(asset.mint, false), meta(from, true), meta(to, true), meta(asset.tokenProgram, false)],
    data: anchorData(terms.operation, amount),
  };
  return terms.operation === "deposit" ? [action] : [createTokenAccount({ payer: wallet, owner: terms.owner, mint: asset.mint, tokenProgram: asset.tokenProgram }), action];
}
