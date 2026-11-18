// spec/security/program.md, "A program revision needs current owner authority and exact split rules"; spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"
import { withOwnerExclusions as terms } from "../program/fixtures.ts";
import { type EditorProject, editorProjectOf } from "./editor.ts";

const manifest = {
  id: "acme-vault",
  slug: "acme-vault",
  name: "Acme Vault",
  repositories: [{ id: "acme/vault" }],
  securityBounty: {
    ...terms,
    version: "1",
    sponsor: { name: "Acme", githubId: "1" },
    intake: { kind: "github-private-vulnerability-reporting", repository: "acme/vault" },
    approvers: { technical: [{ githubId: "1", githubLogin: "octocat" }], financial: [{ githubId: "1", githubLogin: "octocat" }], dispute: [{ githubId: "2", githubLogin: "monalisa" }] },
    dispute: { authority: "advisory", process: terms.dispute.process },
  },
};

function decoded(value: unknown): EditorProject {
  const project = editorProjectOf(value);
  if (project === undefined) throw new TypeError("The fixture manifest is not an editor project.");
  return project;
}

export const actor = { githubId: "1", githubLogin: "octocat" };

export const published = decoded(manifest);

export const unpublished = decoded({ id: "acme-docs", slug: "acme-docs", name: "Acme Docs", repositories: [{ id: "acme/docs" }] });
