import { describe, expect, test } from "bun:test";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { renderProjectSkill } from "../../src/lib/project-skill.mjs";
import { fixtureProject } from "../../tests/fixture-overlay.mjs";

const decoder = new TextDecoder();

function renamedProject() {
  const base = fixtureProject("thenetwork");
  return assertProjectDefinition({
    ...base,
    skill: {
      id: "contribute-to-thenetwork",
      publishAtRoot: false,
      sourcePath: "skills/project-contributor-template",
      publicPath: "/projects/thenetwork/skill.md",
    },
    reviewSkill: {
      id: "review-thenetwork-contributions",
      sourcePath: "skills/project-reviewer-template",
    },
    contribution: {
      approvedScope: "Approved work.",
      contributionGuide: "Follow the guide.",
      supportedTasks: "Bug fixes.",
      requiredTests: "Run tests.",
      reviewExpectations: "Review carefully.",
      securityContact: "security@example.org",
      closurePolicy: "",
      maintainerNotes: "",
    },
    repositories: base.repositories.map((repository, index) =>
      index === 0
        ? {
            ...repository,
            id: "original-owner/original-name",
            displayName: "current-owner/current-name",
            githubUrl: "https://github.com/current-owner/current-name",
            aliases: [
              "intermediate-owner/intermediate-name",
              "current-owner/current-name",
            ],
          }
        : repository,
    ),
  });
}

describe("generated project skill repository targeting", () => {
  for (const role of ["contributor", "reviewer"] as const) {
    test(`${role} skill targets the latest repository alias`, () => {
      const manifest = renamedProject();
      const rendered = renderProjectSkill({
        role,
        templateFiles: {
          "SKILL.md": "Work in {{SLOP_REPOSITORY}}.",
        },
        manifest,
        registry: { revision: 7, manifestSha256: "a".repeat(64) },
      });

      expect(decoder.decode(rendered["SKILL.md"])).toBe(
        "Work in current-owner/current-name.",
      );
      expect(
        JSON.parse(decoder.decode(rendered["project.json"])),
      ).toHaveProperty("repositoryId", "current-owner/current-name");
      expect(manifest.repositories[0]?.id).toBe("original-owner/original-name");
    });
  }
});
