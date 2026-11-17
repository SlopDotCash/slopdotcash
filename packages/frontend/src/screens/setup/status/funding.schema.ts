// spec/frontend/presentation.md, "Setup readiness shows authority, Slopbot, security and funding separately"
import { Result, Schema } from "effect";

export const NoFunding = Schema.Struct({ mode: Schema.Literal("none") });

export const MonthlyFunding = Schema.Struct({
  mode: Schema.Literal("monthly"),
  network: Schema.String,
  symbol: Schema.String,
  monthlyAmountMinor: Schema.String,
  decimals: Schema.Number,
});

export const BountyFunding = Schema.Struct({
  mode: Schema.Literal("bounty"),
  network: Schema.optional(Schema.NullOr(Schema.String)),
  symbol: Schema.String,
  awardAmountMinor: Schema.String,
  decimals: Schema.Number,
  state: Schema.String,
});

export const SetupFunding = Schema.Union([NoFunding, MonthlyFunding, BountyFunding]);

export type SetupFunding = typeof SetupFunding.Type;

const decodeFunding = Schema.decodeUnknownResult(SetupFunding);

/** The funding a setup status reports, or undefined when it is not one of the three shapes. @throws {never} */
export function setupFundingOf(funding: unknown): SetupFunding | undefined {
  const decoded = decodeFunding(funding);
  return Result.isSuccess(decoded) ? decoded.success : undefined;
}
