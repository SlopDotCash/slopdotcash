import { describe, expect, test } from "bun:test";
import type { ProjectRecord } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import type { VettingClearance } from "../../src/lib/vetting-contracts";
import { applicationManifest } from "../../tests/project-application-manifest";
import { projectRestriction } from "./enforcement";
import { projectSetupStatus } from "./setup";

const at = "2026-10-27T12:00:00.000Z";
const project: ProjectRecord = {
  id: "exemption-test",
  status: "active",
  revision: 2,
  manifest: applicationManifest("exemption-test", "example/exemption-test", {
    status: "active",
  }) as unknown as ProjectDefinition,
  manifestSha256: "a".repeat(64),
  createdAt: at,
  updatedAt: at,
  sourceApplicationId: null,
  referrer: null,
};
const ownerExemption: VettingClearance = {
  state: "cleared",
  assessment: null,
  exemption: {
    id: "ve_fixture",
    kind: "owner-approved-admission",
    grantedAt: at,
    grantedBy: { githubId: "123", githubLogin: "owner" },
    repositoryId: "123456789",
    repositoryNodeId: "R_example",
  },
};
function status(
  clearance: VettingClearance,
  authority: "verified" | "denied" = "verified",
  installation: "installed" | "missing" = "installed",
) {
  return projectSetupStatus({
    project,
    restriction: projectRestriction(project.id, []),
    authority: { state: authority, message: "Fixture authority check." },
    access: {
      state: "read",
      access:
        installation === "installed"
          ? {
              installation: "installed",
              installationId: 123,
              permission: "admin",
              roleName: "admin",
            }
          : { installation: "missing" },
    },
    clearance,
    scanRequest: null,
    activatedRevision: null,
    checkedAt: at,
  });
}

describe("owner-approved admission exemption presentation", () => {
  test("shows the owner decision without claiming a scan or grandfathered status", () => {
    const result = status(ownerExemption);
    expect(result.state).toBe("ready");
    expect(result.checks.scan).toMatchObject({
      state: "cleared",
      exempt: true,
      exemptionKind: "owner-approved-admission",
    });
  });

  test("keeps the historical exemption distinct", () => {
    const result = status({
      state: "cleared",
      assessment: null,
      grandfathered: true,
    });
    expect(result.checks.scan.exemptionKind).toBe("existing-project");
  });

  test("an exemption does not replace current GitHub authority", () => {
    const result = status(ownerExemption, "denied");
    expect(result.state).toBe("action_required");
    expect(result.nextAction.kind).toBe("ask_maintainer");
  });

  test("an exemption does not replace the required App installation", () => {
    const result = status(ownerExemption, "verified", "missing");
    expect(result.state).toBe("action_required");
    expect(result.nextAction.kind).toBe("install_slopbot");
  });
});

describe("quarantined scan status presentation", () => {
  const baseAssessment = {
    id: "vet_fixture_quarantine",
    revision: 1,
    state: "incomplete" as const,
    commitSha: "c".repeat(40),
    templateSha256: "t".repeat(64),
    policyVersion: "1",
    requestedAt: at,
    completedAt: at,
    modelRuns: [],
    artifacts: 0,
    heldArtifacts: 0,
  };

  test("scan that could not finish explains that it did not clear the project", () => {
    const result = status({
      state: "quarantined",
      assessment: { ...baseAssessment, completedAt: null },
    });
    expect(result.state).toBe("action_required");
    expect(result.checks.scan.message).toBe(
      "The last scan could not finish, so it did not clear the project.",
    );
    expect(result.nextAction.message).toContain(
      "The last scan could not finish, so it did not clear the project. Fix the cause if you know it, then request a new scan.",
    );
  });

  test("scan that finished with repository findings mentions the repository", () => {
    const result = status({
      state: "quarantined",
      assessment: {
        ...baseAssessment,
        findingsLocation: "repository",
      },
    });
    expect(result.state).toBe("action_required");
    expect(result.checks.scan.message).toBe(
      "The last scan finished, but findings in the project repository block clearance.",
    );
    expect(result.nextAction.message).toContain(
      "Fix the cause if you know it, then request a new scan.",
    );
  });

  test("scan that finished with skill template findings clarifies that Slop template blocks clearance", () => {
    const result = status({
      state: "quarantined",
      assessment: {
        ...baseAssessment,
        findingsLocation: "template",
      },
    });
    expect(result.state).toBe("action_required");
    expect(result.checks.scan.message).toBe(
      "The last scan finished, but findings in Slop's skill template block clearance.",
    );
    expect(result.nextAction.message).toContain(
      "This is being addressed in Slop's skill template; you may request a new scan once updated.",
    );
  });

  test("scan that finished with findings in both clarifies both locations", () => {
    const result = status({
      state: "quarantined",
      assessment: {
        ...baseAssessment,
        findingsLocation: "both",
      },
    });
    expect(result.state).toBe("action_required");
    expect(result.checks.scan.message).toBe(
      "The last scan finished, but findings in both the repository and skill template block clearance.",
    );
    expect(result.nextAction.message).toContain(
      "Fix the cause if you know it, then request a new scan.",
    );
  });
});
