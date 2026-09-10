import { resolveRewardCapMinor } from "./reward-cap.mjs";

/** Stable public identity, never a mutable list index or observed balance. */
function instrumentIdentity(instrument) {
  return instrument.kind === "squads-v4-vault"
    ? `squads-v4-vault:solana:${instrument.multisig}:${instrument.vaultIndex}:${instrument.vault}`
    : `sablier-lockup-v4:${instrument.network}:${instrument.contract}:${instrument.streamId}`;
}

export function assertAllocationFundingBasis(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("invalid allocation funding basis");
  const money = /^(0|[1-9][0-9]{0,19})$/u;
  if (
    Object.keys(value).sort().join(",") !==
      "committedMinor,cycleId,fundingState,instrumentId,monthlyCapMinor" ||
    typeof value.cycleId !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value.cycleId) ||
    !["pledged", "committed"].includes(value.fundingState) ||
    typeof value.committedMinor !== "string" ||
    !money.test(value.committedMinor) ||
    typeof value.monthlyCapMinor !== "string" ||
    !money.test(value.monthlyCapMinor) ||
    (value.instrumentId !== null &&
      (typeof value.instrumentId !== "string" ||
        value.instrumentId.length > 200 ||
        !/^(?:squads-v4-vault:solana:[1-9A-HJ-NP-Za-km-z]{32,44}:(?:0|[1-9][0-9]*):[1-9A-HJ-NP-Za-km-z]{32,44}|sablier-lockup-v4:(?:base|ethereum):0x[0-9a-fA-F]{40}:(?:0|[1-9][0-9]*))$/u.test(
          value.instrumentId,
        ))) ||
    (BigInt(value.committedMinor) > 0n
      ? value.fundingState !== "committed" || value.instrumentId === null
      : value.instrumentId !== null)
  )
    throw new TypeError("invalid allocation funding basis");
  return { ...value };
}

/** Input project has already passed the reviewed project schema. Wrong months
 * have no applicable principal; a later commitment never funds an earlier cycle. */
export function deriveAllocationFundingBasis(project, cycleId) {
  const applicable = (project.funding.commitments ?? []).filter(
    (instrument) =>
      instrument.replacedAt === null &&
      instrument.monthlyCommitment?.cycleId === cycleId,
  );
  if (applicable.length > 1)
    throw new TypeError("ambiguous monthly funding instrument");
  const instrument = applicable[0];
  const committedMinor =
    project.reward.fundingState === "committed" && instrument
      ? project.reward.committedMinor
      : "0";
  if (
    instrument &&
    BigInt(committedMinor) > BigInt(instrument.monthlyCommitment.amountMinor)
  )
    throw new TypeError(
      "monthly instrument does not cover committed principal",
    );
  return assertAllocationFundingBasis({
    cycleId,
    instrumentId:
      BigInt(committedMinor) > 0n ? instrumentIdentity(instrument) : null,
    fundingState: project.reward.fundingState,
    committedMinor,
    monthlyCapMinor: resolveRewardCapMinor(project, cycleId),
  });
}
