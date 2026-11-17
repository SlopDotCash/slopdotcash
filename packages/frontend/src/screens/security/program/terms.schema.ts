// spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"; spec/security/program.md, "Receipt terms come only from the open published revision"
import { Result, Schema } from "effect";

const Person = Schema.Struct({ githubLogin: Schema.String });

export const ProgramFunding = Schema.Union([
  Schema.Struct({ state: Schema.Literal("pledged") }),
  Schema.Struct({ state: Schema.Literal("verified-available"), evidence: Schema.String, verifiedAt: Schema.String }),
]);

export const ProgramAmount = Schema.Struct({
  currency: Schema.String,
  decimals: Schema.Number,
  grossMinor: Schema.String,
  network: Schema.NullOr(Schema.String),
  asset: Schema.optional(Schema.Struct({ kind: Schema.optional(Schema.String), symbol: Schema.String })),
});

export const ProgramScope = Schema.Struct({
  sourceRevisions: Schema.Array(Schema.Struct({ repository: Schema.String, commit: Schema.String })),
  deployments: Schema.Array(Schema.Struct({ network: Schema.String, address: Schema.String, codeIdentity: Schema.NullOr(Schema.String) })),
  includedAssets: Schema.Array(Schema.String),
  excludedDependencies: Schema.Array(Schema.String),
  testingPermission: Schema.String,
  severityRubric: Schema.String,
  lossDefinition: Schema.String,
});

export const ProgramTerms = Schema.Struct({
  status: Schema.Literals(["draft", "pending-approval", "open", "paused", "closed"]),
  rewardMode: Schema.Literals(["separate", "bounty-only"]),
  eligibility: Schema.Literals(["critical-loss-of-funds", "in-scope-security"]),
  fundingPolicy: Schema.optional(Schema.Literal("after-approval")),
  split: Schema.Struct({ researcherBasisPoints: Schema.Number, slopBasisPoints: Schema.Number }),
  amount: ProgramAmount,
  funding: ProgramFunding,
  capacity: Schema.Struct({ awards: Schema.NullOr(Schema.Number), closesAt: Schema.NullOr(Schema.String), exhaustionRule: Schema.String }),
  scope: ProgramScope,
  sponsor: Schema.Struct({ name: Schema.String }),
  intake: Schema.Struct({ repository: Schema.String }),
  approvers: Schema.Struct({ technical: Schema.Array(Person), financial: Schema.Array(Person), dispute: Schema.Array(Person) }),
  dispute: Schema.Struct({ process: Schema.String }),
  responseTargets: Schema.Struct({ acknowledgeHours: Schema.Number, triageBusinessDays: Schema.Number, updateIntervalDays: Schema.Number }),
  disclosure: Schema.String,
  safeHarbor: Schema.String,
});

export const ProgramProject = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  links: Schema.optional(Schema.Struct({ repository: Schema.optional(Schema.String) })),
  securityBounty: Schema.optional(ProgramTerms),
});

export type ProgramFunding = typeof ProgramFunding.Type;
export type ProgramAmount = typeof ProgramAmount.Type;
export type ProgramTerms = typeof ProgramTerms.Type;
export type ProgramProject = typeof ProgramProject.Type;

const decodeProject = Schema.decodeUnknownResult(ProgramProject);

/** The registry record as the program page shows it, or undefined when it is not one. @throws {never} */
export function programProjectOf(record: unknown): ProgramProject | undefined {
  const decoded = decodeProject(record);
  return Result.isSuccess(decoded) ? decoded.success : undefined;
}
