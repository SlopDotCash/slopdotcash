// spec/points/rewardWeights.md, "A month's net weight is its accepted-work credit less its applied debits"; spec/points/evaluations.md, "A manifest is admitted only with a review, a bounded award and evidence in time order"
import type { RepositoryRegistry } from "../../../src/client/snapshot/schema.vibe";

/** @throws {never} */
export function userNodeId(githubId: number): string {
  const pack = Buffer.from([0x92, 0x00, 0xce, (githubId >>> 24) & 0xff, (githubId >>> 16) & 0xff, (githubId >>> 8) & 0xff, githubId & 0xff]);
  return `U_${pack.toString("base64url")}`;
}

const slopdotcash = {
  id: "SlopDotCash/slopdotcash",
  owner: "SlopDotCash",
  name: "slopdotcash",
  displayName: "slopdotcash",
  githubUrl: "https://github.com/SlopDotCash/slopdotcash",
  description: "slopdotcash",
  integrationBranch: "main",
  projectId: "slopdotcash",
  nodeId: "R_kgDOSlopRg",
  aliases: [],
};

export const registry: RepositoryRegistry = {
  registered: [slopdotcash],
  targets: [slopdotcash],
  projects: [{ id: "slopdotcash", skillSourcePath: "SKILL.md" }],
};
