// spec/settlement/escrow.md, "A vault starts empty with an immutable network, asset, purpose, owner and fee recipient"; spec/settlement/vault.md, "Only the fixed refund destination receives free funds"; spec/frontend/monthLock.md, "Story: Lock months from the owner's wallet"
import { type Period, formatPeriod } from "@repo/settlement/kernels/calendar";
import { Result, Schema } from "effect";

export const FundingDeployment = Schema.Struct({
  network: Schema.String,
  vault: Schema.String,
  asset: Schema.String,
  owner: Schema.String,
  codeSha256: Schema.optional(Schema.String),
  factory: Schema.optional(Schema.String),
  feeRecipient: Schema.optional(Schema.String),
  bindingDelaySeconds: Schema.optional(Schema.String),
  evmUpgrade: Schema.optional(
    Schema.Struct({
      vaultImplementation: Schema.String,
      vaultImplementationCodeSha256: Schema.String,
    }),
  ),
  programId: Schema.optional(Schema.NullOr(Schema.String)),
  projectPda: Schema.optional(Schema.NullOr(Schema.String)),
});

export const FundingAsset = Schema.Struct({ network: Schema.String, address: Schema.String, decimals: Schema.Number });

export const FundingReward = Schema.Struct({
  kind: Schema.String,
  chain: Schema.optional(Schema.String),
  monthlyCapMinor: Schema.optional(Schema.String),
  monthlyCapDisplay: Schema.optional(Schema.String),
  cycleCaps: Schema.optional(Schema.Array(Schema.Struct({ cycleId: Schema.String, monthlyCapMinor: Schema.String }))),
  asset: Schema.optional(Schema.NullOr(FundingAsset)),
});

export const FundingProject = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  reward: FundingReward,
  escrow: Schema.optional(Schema.Struct({ chain: Schema.optional(Schema.String), deployments: Schema.Array(FundingDeployment) })),
});

export type FundingDeployment = typeof FundingDeployment.Type;
export type FundingReward = typeof FundingReward.Type;
export type FundingProject = typeof FundingProject.Type;

const decodeProject = Schema.decodeUnknownResult(FundingProject);

/** @throws {never} */
export function fundingProjectOf(record: unknown): FundingProject | undefined {
  const decoded = decodeProject(record);
  return Result.isSuccess(decoded) ? decoded.success : undefined;
}

/** @throws {never} */
export function deploymentsOf(project: FundingProject): ReadonlyArray<FundingDeployment> {
  return project.escrow?.deployments ?? [];
}

const minorPattern = /^(0|[1-9][0-9]*)$/u;

/** The reward cap of a UTC month in base units: its cycle's cap where one is set, else the monthly cap. @throws {never} */
export function monthlyCapAt(project: FundingProject, period: Period): bigint {
  const month = formatPeriod(period);
  const text = project.reward.cycleCaps?.find((cap) => cap.cycleId === month)?.monthlyCapMinor ?? project.reward.monthlyCapMinor ?? "0";
  return minorPattern.test(text) ? BigInt(text) : 0n;
}
