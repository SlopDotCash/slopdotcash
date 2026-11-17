// spec/settlement/escrow.md, "Events apply once, in canonical block and event order"; spec/contracts/solanaEscrow.md, "The identity authority and the destination both sign a binding for the project's network"
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { type Address, type Blockhash, type Message, addressOf, decodeMessage } from "@repo/platform/chain/solana";
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { sameBytes, u32le } from "./bytes.ts";
import { type Compiled, type Instruction, completesPrepared, compileLegacy, missingSigners, requiredSigners, resolveInstruction, unsignedTransaction, withSignature } from "./transactions.ts";

const seeds: ReadonlyArray<Uint8Array> = Array.from({ length: 7 }, (_, at) => sha256(u32le(at)));
const pool: ReadonlyArray<Address> = seeds.map((seed) => addressOf(ed25519.getPublicKey(seed)) as Address);
const blockhash = addressOf(sha256(Uint8Array.of(255))) as string as Blockhash;
const key = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: pool.length - 1 }));

const instructions = Arbitrary.schema(
  Schema.Array(Schema.Struct({
    program: key,
    accounts: Schema.Array(Schema.Struct({ key, signer: Schema.Boolean, writable: Schema.Boolean })).check(Schema.isMaxLength(6)),
    data: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))).check(Schema.isMaxLength(24)),
  })).check(Schema.isMinLength(1), Schema.isMaxLength(4)),
).pipe(Arbitrary.map((drawn): ReadonlyArray<Instruction> => drawn.map((instruction) => ({
  program: pool[instruction.program] as Address,
  accounts: instruction.accounts.filter((meta) => meta.key !== instruction.program).map((meta) => ({ key: pool[meta.key] as Address, signer: meta.signer, writable: meta.writable })),
  data: Uint8Array.from(instruction.data),
}))));

const payer = pool[0] as Address;

const compile = (drawn: ReadonlyArray<Instruction>) => compileLegacy({ payer, blockhash, instructions: drawn });

function writable(message: Message, at: number): boolean {
  const { requiredSignatures, readonlySigned, readonlyUnsigned } = message.header;
  return at < requiredSignatures ? at < requiredSignatures - readonlySigned : at < message.accountKeys.length - readonlyUnsigned;
}

const roundTrips = (drawn: ReadonlyArray<Instruction>, compiled: Compiled) => {
  if (compiled.kind === "refused") return false;
  const { message, bytes } = compiled;
  const decoded = decodeMessage(bytes);
  if (decoded.kind === "malformed" || message.accountKeys[0] !== payer || message.accountKeys.length !== new Set(message.accountKeys).size) return false;
  return drawn.every((instruction, at) => {
    const resolved = resolveInstruction(decoded.value.instructions[at] as Message["instructions"][number], decoded.value.accountKeys);
    return resolved !== undefined && resolved.program === instruction.program && sameBytes(resolved.data, instruction.data)
      && instruction.accounts.every((meta, index) => {
        const position = message.accountKeys.indexOf(meta.key);
        return resolved.accounts[index] === meta.key
          && (!meta.signer || position < message.header.requiredSignatures)
          && (!meta.writable || writable(message, position));
      });
  });
};

const signsSlotBySlot = (_: ReadonlyArray<Instruction>, compiled: Compiled) => {
  if (compiled.kind === "refused") return false;
  const signers = requiredSigners(compiled.message);
  const empty = unsignedTransaction(compiled.message);
  if (empty === undefined) return false;
  let wire = empty;
  for (const [at, signer] of signers.entries()) {
    const seed = seeds[pool.indexOf(signer)] as Uint8Array;
    const forged = withSignature(wire, signer, ed25519.sign(sha256(compiled.bytes), seed));
    const next = withSignature(wire, signer, ed25519.sign(compiled.bytes, seed));
    if (forged === undefined || completesPrepared(wire, forged, signer)) return false;
    if (next === undefined || !completesPrepared(wire, next, signer) || missingSigners(next)?.length !== signers.length - at - 1) return false;
    wire = next;
  }
  return signers.every((signer) => withSignature(wire, signer, new Uint8Array(63)) === undefined);
};

export const compiledMessagesDecodeToTheSameInstructions = contract({ input: instructions, run: compile, deterministic: true, invariant: roundTrips });

export const signaturesFillOnlyTheirOwnSlots = contract({ input: instructions, run: compile, invariant: signsSlotBySlot });
