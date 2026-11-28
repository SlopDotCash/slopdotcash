// spec/settlement/contributorAllocation.md, "A timely first wallet confirmation survives replacement"; spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
import { Schema } from "effect";
import { contract } from "vibestack/testing";
import { type AllocationWallet, allocationPhase, walletRegisteredInTime } from "./disposition.ts";
import { vectors } from "./vectors.ts";

export const allocationPhasesFollowTheRecordedFacts = contract({
  input: Schema.Struct({ recordedTransfer: Schema.Boolean, closed: Schema.Boolean, registeredWallet: Schema.Boolean, beforeDeadline: Schema.Boolean }),
  run: allocationPhase,
  invariant: ({ recordedTransfer, closed, registeredWallet, beforeDeadline }, phase) =>
    (phase === "Sent") === recordedTransfer
    && (phase === "Unclaimed") === (!recordedTransfer && (closed || (!registeredWallet && !beforeDeadline)))
    && (phase === "Scheduled") === (!recordedTransfer && !closed && registeredWallet)
    && (phase === "AwaitingWallet") === (!recordedTransfer && !closed && !registeredWallet && beforeDeadline),
});

const closesAtMs = Date.parse("2026-12-01T00:00:00Z");
const wallet: AllocationWallet = { chain: "base", authorized: true, firstAuthorizedAtMs: closesAtMs - 1 };

export const onlyAnAuthorizedWalletFirstConfirmedBeforeTheDeadlineCounts = vectors<ReadonlyArray<AllocationWallet>, boolean>([
  [[wallet], true],
  [[{ ...wallet, firstAuthorizedAtMs: closesAtMs }], false],
  [[{ ...wallet, firstAuthorizedAtMs: undefined }], false],
  [[{ ...wallet, firstAuthorizedAtMs: 0 }], false],
  [[{ ...wallet, authorized: false }], false],
  [[{ ...wallet, chain: "solana" }], false],
  [[{ ...wallet, chain: "solana" }, wallet], true],
  [[], false],
], (wallets) => walletRegisteredInTime(wallets, "base", closesAtMs));
