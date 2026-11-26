// spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"; spec/frontend/solanaBountyPrompt.md, "The wallet sends only a saved, unexpired plan"; spec/frontend/walletAttempt.md, "Recovery and settlement use the saved record of the signed-in account only"
import { isSignature } from "@repo/platform/chain/solana";
import { Schema } from "effect";

const pattern = (expression: RegExp) => Schema.String.check(Schema.isPattern(expression));

const quantity = /^(0[xX][0-9a-fA-F]+|0|[1-9][0-9]*)$/u;

export const Quantity = pattern(quantity);

export const Nonce = Quantity.check(Schema.makeFilter((text: string) => quantity.test(text) && BigInt(text) <= BigInt(Number.MAX_SAFE_INTEGER), { expected: "a nonce no larger than a safe integer" }));

export const EvmHash = pattern(/^0[xX][a-fA-F0-9]{64}$/u);

export const RequestId = pattern(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u);

export const AttemptId = pattern(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/u);

export const SolanaSignature = pattern(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/u).check(Schema.makeFilter((text: string) => isSignature(text), { expected: "a base58 64-byte signature" }));

export const DirectTransaction = Schema.Struct({ from: Schema.String, to: Schema.String, value: Schema.String, data: Schema.String, chainId: Quantity, nonce: Nonce });

export const JournalEntry = Schema.Struct({ transaction: DirectTransaction, hash: Schema.NullOr(EvmHash), candidate: Schema.optionalKey(EvmHash), requestId: Schema.optionalKey(RequestId) });

export const Journal = Schema.Record(Schema.String, JournalEntry);

export const SolanaRecord = Schema.Struct({ attemptId: Schema.optionalKey(AttemptId), transaction: Schema.String, signature: Schema.NullOr(SolanaSignature), candidate: Schema.optionalKey(SolanaSignature) });

export const HistorySignature = Schema.Struct({ message: Schema.String, signature: Schema.String });

export type DirectTransaction = typeof DirectTransaction.Type;
export type JournalEntry = typeof JournalEntry.Type;
export type Journal = typeof Journal.Type;
export type SolanaRecord = typeof SolanaRecord.Type;
export type HistorySignature = typeof HistorySignature.Type;
