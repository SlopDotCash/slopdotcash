import type { ProjectDefinition } from "./projects.mjs";

export type PayoutExclusionRelationship =
  | "owner"
  | "funded-employee"
  | "related-party";

export interface PayoutExclusion {
  readonly actorId: string;
  readonly nodeId: string;
  readonly login: string;
  readonly relationship: PayoutExclusionRelationship;
  readonly fromCycle: string;
  readonly untilCycle: string | null;
}

export function validatePayoutExclusions(
  value: unknown,
  field: string,
): readonly PayoutExclusion[];
export function payoutExclusionFor(
  project: Pick<ProjectDefinition, "reward">,
  cycleId: string,
  actorNodeId: string,
): PayoutExclusionRelationship | null;
export function payoutExcludedGithubUserIds(
  project: Pick<ProjectDefinition, "reward">,
  cycleId: string,
): Set<string>;
export function assertPayoutExclusionTransition(
  previous: Pick<ProjectDefinition, "reward">,
  next: Pick<ProjectDefinition, "reward">,
  now: Date,
): void;
