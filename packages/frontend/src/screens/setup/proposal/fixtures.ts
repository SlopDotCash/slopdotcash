// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import type { RepositoryLookup } from "@repo/backend/client";
import { emptyProposal, type Proposal } from "../../../flows/projects/proposal.ts";
import { defaultCriteria } from "./form.ts";
import type { OwnedRepository } from "./RepositoryChoice.tsx";

export const repositories: ReadonlyArray<OwnedRepository> = [
  { repository: "octo-org/engine", description: "A fast engine for building open-source things." },
  { repository: "octocat/hello-world", description: null },
];

export const facts: RepositoryLookup = {
  repository: "octo-org/engine",
  description: "A fast engine for building open-source things.",
  numericId: "1296269",
  nodeId: "MDEwOlJlcG9zaXRvcnkxMjk2MjY5",
  defaultBranch: "main",
  branches: ["main", "release"],
  branchCommits: { main: "6dcb09b5b57875f334f61aebed695e2e4193db5e", release: "7638417db6d59f3c431d3e1f261cc637155684cd" },
  fork: false,
  archived: false,
  owner: { login: "octo-org", actorId: "9919", nodeId: "MDEyOk9yZ2FuaXphdGlvbjk5MTk=", kind: "organization" },
  license: { state: "verified", spdx: "MIT", commitSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e", fileSha256: "a".repeat(64) },
};

export const filled: Proposal = {
  ...emptyProposal,
  name: "engine",
  repository: facts.repository,
  repositoryNumericId: facts.numericId,
  repositoryNodeId: facts.nodeId,
  integrationBranch: "main",
  sourceCommit: facts.branchCommits.main ?? "",
  stewardLogin: facts.owner.login,
  stewardActorId: facts.owner.actorId,
  stewardNodeId: facts.owner.nodeId,
  headline: "A fast engine for building open-source things.",
  goal: "A fast engine for building open-source things, kept small and tested.",
  criteria: defaultCriteria,
  licenseSpdx: "MIT",
  licenseCommit: facts.license.state === "verified" ? facts.license.commitSha : "",
  licenseDigest: "a".repeat(64),
};

export const monthly: Proposal = { ...filled, fundingMode: "monthly", monthlyPool: "1500", automaticClosure: "true" };

export const promised: Proposal = { ...monthly, honorSystem: "true" };

export const registry = { revision: 1, manifestSha256: "b".repeat(64) };
