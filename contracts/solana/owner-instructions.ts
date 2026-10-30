/** Edge-safe vault creation. The caller verifies the reviewed program and Config. */
import type { PayoutPolicy } from "../../src/lib/payments/contracts";
import { SOLANA_NATIVE_ASSET, solanaDigest } from "./adapter";
import { TOKEN_2022_PROGRAM } from "./token";
import {
  bytes,
  encoder,
  type Instruction,
  instructionData,
  le,
  pda,
  SYSTEM,
  TOKEN,
} from "./transactions";

export interface SolanaVaultCreation {
  programId: string;
  owner: string;
  mint: string;
  /** Server-verified mint owner; omitted only for existing classic SPL callers. */
  tokenProgram?: string;
  projectDigest: string;
  networkDomain: string;
  identityAuthority: string;
  feeRecipient: string;
  bindingDelaySeconds: string;
  rotationDelaySeconds: string;
  payoutPolicy?: PayoutPolicy;
  monthlyCap?: string;
  automaticMonthly?: boolean;
}

function delay(value: string, maximum: bigint): Uint8Array {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > maximum)
    throw new Error("The reviewed delay is outside the program's range");
  return le(BigInt(value));
}

/**
 * The owner is the only signer. Ordinary creation and its monthly policy are
 * one atomic transaction; a bounty has a separate PDA and no monthly policy.
 * No RPC, private key, signing or broadcast is available in this builder.
 */
export function buildInitializeVaultInstructions(input: SolanaVaultCreation) {
  const policy = input.payoutPolicy ?? "ordinary";
  if (policy !== "ordinary" && policy !== "security-bounty")
    throw new Error("Unknown vault payout policy");
  const bounty = policy === "security-bounty";
  if (
    bounty &&
    (input.monthlyCap !== undefined || input.automaticMonthly !== undefined)
  )
    throw new Error("Private bounty awards have no automatic monthly policy");
  const automaticMonthly = input.automaticMonthly;
  if (!bounty && typeof automaticMonthly !== "boolean")
    throw new Error("Choose the monthly payment setting explicitly");
  let cap: Uint8Array | null = null;
  if (!bounty) {
    if (
      typeof input.monthlyCap !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(input.monthlyCap) ||
      (automaticMonthly && input.monthlyCap === "0")
    )
      throw new Error("Monthly creation requires a valid cap");
    cap = le(BigInt(input.monthlyCap));
  }
  bytes(input.mint);
  const native = input.mint === SOLANA_NATIVE_ASSET;
  const tokenProgram = input.tokenProgram ?? (native ? SYSTEM : TOKEN);
  if (
    native
      ? tokenProgram !== SYSTEM
      : tokenProgram !== TOKEN && tokenProgram !== TOKEN_2022_PROGRAM
  )
    throw new Error("Unsupported mint token program");
  const projectDigest = solanaDigest(input.projectDigest);
  const projectPda = pda(input.programId, [
    encoder.encode("project"),
    bytes(input.owner),
    projectDigest,
    Uint8Array.of(bounty ? 1 : 0),
  ]);
  const vault = pda(input.programId, [
    encoder.encode("vault"),
    bytes(projectPda),
  ]);
  const config = pda(input.programId, [encoder.encode("config")]);
  const instructions: Instruction[] = [
    {
      program: input.programId,
      accounts: native
        ? [
            { key: input.owner, write: true },
            { key: projectPda, write: true },
            { key: vault, write: true },
            { key: SYSTEM, write: false },
            { key: config, write: false },
          ]
        : [
            { key: input.owner, write: true },
            { key: projectPda, write: true },
            { key: input.mint, write: false },
            { key: vault, write: true },
            { key: tokenProgram, write: false },
            { key: SYSTEM, write: false },
            { key: config, write: false },
          ],
      data: instructionData(
        native ? "initialize_native" : "initialize",
        projectDigest,
        solanaDigest(input.networkDomain),
        bytes(input.identityAuthority),
        bytes(input.feeRecipient),
        delay(input.bindingDelaySeconds, 30n * 86400n),
        delay(input.rotationDelaySeconds, 90n * 86400n),
        Uint8Array.of(bounty ? 1 : 0),
      ),
    },
  ];
  if (cap !== null)
    instructions.push({
      program: input.programId,
      accounts: [
        { key: input.owner, write: false },
        { key: projectPda, write: true },
      ],
      data: instructionData(
        "set_monthly_commitment",
        cap,
        Uint8Array.of(automaticMonthly ? 1 : 0),
      ),
    });
  return {
    programId: input.programId,
    owner: input.owner,
    projectPda,
    vault,
    config,
    instructions,
  };
}
