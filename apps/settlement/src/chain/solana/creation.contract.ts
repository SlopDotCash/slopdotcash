// spec/settlement/vaultSnapshots.md, "Retry recognizes the exact creation transaction before checking a revision"; spec/contracts/solanaEscrow.md, "The owner creates a token or native project with the Config's identity authority and fee recipient"
import { Schema } from "effect";
import { ASSOCIATED_TOKEN_PROGRAM, type Address, TOKEN_PROGRAM } from "@repo/platform/chain/solanaWire";
import { contract } from "vibestack/testing";
import { type Digest, type U64, U64_MAX } from "./bytes.ts";
import { MAX_BINDING_DELAY, MAX_ROTATION_DELAY, type SolanaCreation, initializeVault, matchesReviewedProgram } from "./creation.ts";
import { projectAddress, vaultAddress } from "./pda.ts";

const PROGRAM = ASSOCIATED_TOKEN_PROGRAM;
const OWNER = "SysvarRent111111111111111111111111111111111" as Address;
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;
const DIGEST = "a".repeat(64) as Digest;

const policy = Schema.Struct({
  bounty: Schema.Boolean,
  native: Schema.Boolean,
  cap: Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: U64_MAX })),
  enabled: Schema.Boolean,
  bindingDelay: Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: MAX_BINDING_DELAY * 2n })),
});

export const anInitializationIsPlannedOnlyForAReviewedPolicy = contract({
  input: policy,
  run: (value) => {
    const creation: SolanaCreation = {
      program: PROGRAM, owner: OWNER, asset: value.native ? { kind: "Native" } : { kind: "Token", mint: MINT, tokenProgram: TOKEN_PROGRAM },
      projectDigest: DIGEST, networkDomain: DIGEST, identityAuthority: OWNER, feeRecipient: MINT,
      bindingDelay: value.bindingDelay as U64, rotationDelay: MAX_ROTATION_DELAY as U64, purpose: value.bounty ? "Bounty" : "Ordinary",
      monthly: value.bounty ? undefined : { cap: value.cap as U64, enabled: value.enabled },
    };
    const reviewed = { program: PROGRAM, networkDomain: DIGEST, identityAuthority: OWNER, feeRecipient: MINT, bindingDelay: creation.bindingDelay, rotationDelay: creation.rotationDelay };
    return { planned: initializeVault(creation), matches: matchesReviewedProgram(creation, reviewed), shifted: matchesReviewedProgram(creation, { ...reviewed, feeRecipient: OWNER }) };
  },
  invariant: (value, { planned, matches, shifted }) => {
    const expected = value.bindingDelay > MAX_BINDING_DELAY ? "delayOutOfRange" : !value.bounty && value.enabled && value.cap === 0n ? "zeroMonthlyCap" : undefined;
    if (!matches || shifted) return false;
    if (planned.kind === "refused") return planned.issue === expected;
    const project = projectAddress(PROGRAM, OWNER, DIGEST, value.bounty ? "Bounty" : "Ordinary");
    return expected === undefined && planned.plan.project === project && planned.plan.vault === vaultAddress(PROGRAM, project)
      && planned.plan.instructions.length === (value.bounty ? 1 : 2) && planned.plan.instructions[0]?.accounts.length === (value.native ? 5 : 7);
  },
});
