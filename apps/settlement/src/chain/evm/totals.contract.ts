// spec/settlement/vaultSnapshots.md, "Only a reviewed registry binding can obtain totals"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { type EvmAddress, U128_MAX, uintWord } from "./abi.ts";
import { adapterVectors } from "../../../test/fixtures/adapterVectors.ts";
import { type TotalsOutcome, type VaultCounters, conservedTotals, decodeCounters, needsPendingMonthly, readTotals, totalsRefusalMessage } from "./totals.ts";

const answer = (values: ReadonlyArray<bigint>) => `0x${values.map((value) => uintWord(value).slice(2)).join("")}`;

const oldShape = (outcome: TotalsOutcome) => {
  if (outcome.kind === "Refused") return totalsRefusalMessage(outcome.refusal);
  const { counters, asset, decimals, reserved } = outcome.totals;
  return {
    asset,
    decimals,
    totalDeposited: counters.deposited.toString(),
    totalPaid: counters.paid.toString(),
    totalPayoutFees: counters.payoutFees.toString(),
    totalGrossWithdrawn: counters.grossWithdrawn.toString(),
    totalWithdrawalFees: counters.withdrawalFees.toString(),
    freeBalance: counters.free.toString(),
    reservedPrincipal: counters.reservedPrincipal.toString(),
    reservedFees: counters.reservedFees.toString(),
    accruedFees: counters.accruedFees.toString(),
    reserved: reserved === undefined ? null : reserved.toString(),
  };
};

const recordedShape = (outcome: (typeof adapterVectors.totals)[number]["outcome"]) => {
  if (typeof outcome === "string") return outcome;
  const { network: _network, vault: _vault, blockNumber: _block, blockTime: _time, ...rest } = outcome;
  return rest;
};

export const totalsMatchTheDeployedAdapter = contract({
  input: Arbitrary.Constant(adapterVectors.totals),
  run: (cases) =>
    cases.map((recorded) => {
      const read = readTotals({ totals: answer(recorded.words.map(BigInt)), token: uintWord(BigInt(recorded.token)), decimals: uintWord(BigInt(recorded.decimals)) });
      if (typeof read === "string") return totalsRefusalMessage(read);
      return oldShape(conservedTotals(read, { pendingMonthly: recorded.pending === null ? undefined : uintWord(BigInt(recorded.pending)), nativeBalance: recorded.balance === null ? undefined : BigInt(recorded.balance) }));
    }),
  invariant: (cases, outcomes) => JSON.stringify(outcomes) === JSON.stringify(cases.map((recorded) => recordedShape(recorded.outcome))),
});

const amount = Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 0n, maximum: U128_MAX >> 4n }));

const counters = Schema.Struct({
  paid: amount, payoutFees: amount, grossWithdrawn: amount, withdrawalFees: amount, free: amount,
  reservedPrincipal: amount, reservedFees: amount, accruedFees: amount, pending: amount, surplus: amount,
});

export const conservingCountersAreAcceptedAndOthersRefused = contract({
  input: counters,
  run: (value) => {
    const deposited = value.free + value.reservedPrincipal + value.reservedFees + value.pending + value.paid + value.payoutFees + value.grossWithdrawn;
    const balance = value.free + value.reservedPrincipal + value.reservedFees + value.pending + value.accruedFees + value.surplus;
    const decoded: VaultCounters | undefined = decodeCounters(answer([deposited, value.paid, value.payoutFees, value.grossWithdrawn, value.withdrawalFees, value.free, value.reservedPrincipal, value.reservedFees, value.accruedFees, balance]));
    const read = { asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as EvmAddress, decimals: 6, native: false };
    const kept = decoded === undefined ? undefined : conservedTotals({ ...read, counters: decoded }, { pendingMonthly: uintWord(value.pending), nativeBalance: undefined });
    const short = decoded === undefined ? undefined : conservedTotals({ ...read, counters: decoded }, { pendingMonthly: uintWord(value.pending + 1n), nativeBalance: undefined });
    return { decoded, kept, short, asked: decoded !== undefined && needsPendingMonthly(decoded) };
  },
  invariant: (value, { decoded, kept, short, asked }) =>
    decoded !== undefined
    && asked === value.pending > 0n
    && kept?.kind === "Totals"
    && kept.totals.pendingMonthly === value.pending
    && (value.pending === 0n ? short?.kind === "Totals" : short?.kind === "Refused"),
});
