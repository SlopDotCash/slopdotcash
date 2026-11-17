// spec/settlement/escrow.md, "A vault starts empty with an immutable network, asset, purpose, owner and fee recipient"
import { Result, Schema } from "effect";

export const BountyDeployment = Schema.Struct({ network: Schema.String, vault: Schema.String });

export const BountyTerms = Schema.Struct({
  amount: Schema.Struct({ network: Schema.NullOr(Schema.String) }),
  intake: Schema.Struct({ repository: Schema.String }),
  settlement: Schema.optional(Schema.Struct({ chain: Schema.optional(Schema.String), deployments: Schema.Array(BountyDeployment) })),
});

export const BountyProject = Schema.Struct({ id: Schema.String, slug: Schema.String, securityBounty: BountyTerms });

export type BountyDeployment = typeof BountyDeployment.Type;
export type BountyProject = typeof BountyProject.Type;

const decodeProject = Schema.decodeUnknownResult(BountyProject);

/** The project's public security bounty terms, or undefined for a project without one. @throws {never} */
export function bountyProjectOf(record: unknown): BountyProject | undefined {
  const decoded = decodeProject(record);
  return Result.isSuccess(decoded) ? decoded.success : undefined;
}

/** @throws {never} */
export function bountyChainOf(project: BountyProject): string | null {
  return project.securityBounty.settlement?.chain ?? project.securityBounty.amount.network;
}
