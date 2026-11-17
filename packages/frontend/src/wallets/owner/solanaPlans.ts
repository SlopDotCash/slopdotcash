// spec/settlement/ownerTransactions.md, "A request is reviewed against current authority and becomes a fixed plan"; spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"
import { type Address, address, base64Decode, isBlockhash } from "@repo/platform/chain/solana";
import { digest, u64 } from "@repo/settlement/chain/solana/bytes";
import { commitAward } from "@repo/settlement/chain/solana/instructions";
import { isTokenProgram } from "@repo/settlement/chain/solana/pda";
import { compileLegacy, type Instruction } from "@repo/settlement/chain/solana/transactions";
import { SOLANA_NATIVE_ASSET } from "@repo/settlement/kernels/networks";
import { type FundingAsset, type FundingOperation, fundingInstructions } from "@repo/settlement/owner/ownerInstructions";
import { unsignedWireOf } from "../core/solanaWire.ts";

export interface SolanaVaultTerms {
  readonly program: string;
  readonly project: string;
  readonly owner: string;
  readonly mint: string | null;
  readonly tokenProgram: string | null;
}

export interface ReviewedWire {
  readonly wire: Uint8Array;
  readonly message: Uint8Array;
}

export type FundingWire = ReviewedWire | "unsupportedProgram" | undefined;

const solanaChains: Readonly<Record<string, string>> = { "solana-mainnet": "solana:mainnet", "solana-devnet": "solana:devnet", "solana-testnet": "solana:testnet" };

/** @throws {never} */
export function solanaChainOf(network: string): string | undefined {
  return Object.hasOwn(solanaChains, network) ? solanaChains[network] : undefined;
}

export interface PreparedWire {
  readonly payer: string;
  readonly blockhash: string;
  readonly transaction: string;
}

/** @throws {never} */
function addresses(terms: SolanaVaultTerms, wallet: string): { program: Address; project: Address; owner: Address; wallet: Address } | undefined {
  const program = address(terms.program);
  const project = address(terms.project);
  const owner = address(terms.owner);
  const payer = address(wallet);
  return program === undefined || project === undefined || owner === undefined || payer === undefined ? undefined : { program, project, owner, wallet: payer };
}

/** @throws {never} */
function assetOf(terms: SolanaVaultTerms, reviewedProgram: string): FundingAsset | "unsupportedProgram" | undefined {
  if (terms.mint === null) return reviewedProgram === SOLANA_NATIVE_ASSET ? { kind: "Native" } : "unsupportedProgram";
  const mint = address(terms.mint);
  const program = address(reviewedProgram);
  if (program === undefined || !isTokenProgram(program) || (terms.tokenProgram !== null && terms.tokenProgram !== program)) return "unsupportedProgram";
  return mint === undefined ? undefined : { kind: "Token", mint, tokenProgram: program };
}

/** @throws {never} */
export function wireMatches(prepared: PreparedWire, instructions: ReadonlyArray<Instruction>): ReviewedWire | undefined {
  const payer = address(prepared.payer);
  const wire = base64Decode(prepared.transaction);
  if (payer === undefined || wire === undefined || !isBlockhash(prepared.blockhash)) return undefined;
  const compiled = compileLegacy({ payer, blockhash: prepared.blockhash, instructions });
  return compiled.kind === "compiled" && unsignedWireOf(wire, compiled.bytes) ? { wire, message: compiled.bytes } : undefined;
}

/** @throws {never} */
export function fundingWire(terms: SolanaVaultTerms, operation: FundingOperation, gross: bigint, reviewedProgram: string, prepared: PreparedWire): FundingWire {
  const keys = addresses(terms, prepared.payer);
  const asset = assetOf(terms, reviewedProgram);
  const amount = u64(gross);
  if (asset === "unsupportedProgram") return asset;
  if (keys === undefined || asset === undefined || amount === undefined || amount === 0n) return undefined;
  return wireMatches(prepared, fundingInstructions({ ...keys, asset, operation, gross: amount }));
}

/** @throws {never} */
export function commitmentWire(terms: SolanaVaultTerms, award: { readonly sourceDigest: string; readonly githubUserId: string; readonly gross: string }, prepared: PreparedWire): ReviewedWire | undefined {
  const keys = addresses(terms, prepared.payer);
  const source = digest(award.sourceDigest);
  const actor = /^[1-9][0-9]{0,19}$/u.test(award.githubUserId) ? u64(BigInt(award.githubUserId)) : undefined;
  const gross = /^[1-9][0-9]{0,19}$/u.test(award.gross) ? u64(BigInt(award.gross)) : undefined;
  if (keys === undefined || keys.wallet !== keys.owner || source === undefined || actor === undefined || gross === undefined) return undefined;
  return wireMatches(prepared, [commitAward({ program: keys.program, project: keys.project, owner: keys.owner, purpose: "Ordinary", source, actor, gross })]);
}
