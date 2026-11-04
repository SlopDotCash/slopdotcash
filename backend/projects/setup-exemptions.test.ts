import { describe, expect, test } from "bun:test";
import type { ProjectRecord } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { scanClearanceReasons } from "../../src/lib/scan-clearance";
import type { VettingClearance } from "../../src/lib/vetting-contracts";
import { applicationManifest } from "../../tests/project-application-manifest";
import type { VettingAssessment } from "../vetting/persistence";
import { summarize } from "../vetting/persistence";
import {
  parseVettingScanResult,
  type ScanReview,
  scanProblems,
  type VettingScanResult,
} from "../vetting/scan-result";
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

  test("scan that completed but has no findingsLocation (e.g. check/review did not complete) reports scan could not finish", () => {
    const result = status({
      state: "quarantined",
      assessment: {
        ...baseAssessment,
        completedAt: at,
        findingsLocation: undefined,
      },
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
      "Findings in the project repository block clearance.",
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
      "Findings in Slop's skill template block clearance.",
    );
    expect(result.nextAction.message).toContain(
      "Check for an updated skill template before requesting a new scan.",
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
      "Findings in both the repository and skill template block clearance.",
    );
    expect(result.nextAction.message).toContain(
      "Fix the cause if you know it, then request a new scan.",
    );
  });
});

describe("summarize findings location classification", () => {
  const dummyAssessment: VettingAssessment = {
    id: "vet_12345678901234567890123456789012",
    projectId: "test-project",
    revision: 1,
    manifestSha256: "m".repeat(64),
    contentSha256: "c".repeat(64),
    state: "incomplete",
    commitSha: "c".repeat(40),
    templateSha256: "t".repeat(64),
    policyVersion: "1",
    requestedBy: { githubId: "1", githubLogin: "owner" },
    requestReason: "admission",
    resultSha256: "r".repeat(64),
    signingKeySha256: "s".repeat(64),
    requestedAt: at,
    completedAt: at,
    result: null,
  };

  test.each([
    ["slop-skill-template/skills/SKILL.md:10", "template"],
    ["The reviewer found an unsafe command in the skill template.", "unknown"],
  ] as const)(
    "uses only path evidence for the finding location: %s",
    (evidence, location) => {
      const summary = summarize({
        ...dummyAssessment,
        result: {
          schemaVersion: "slop-vetting-result-v2",
          assessmentId: dummyAssessment.id,
          projectId: dummyAssessment.projectId,
          revision: 1,
          manifestSha256: dummyAssessment.manifestSha256,
          disposition: "incomplete",
          policyVersion: "1",
          assessed: {
            repository: "owner/repo",
            commitSha: dummyAssessment.commitSha,
            templateSha256: dummyAssessment.templateSha256,
            inputManifestSha256: "i".repeat(64),
            dependencyLocks: [],
          },
          scan: {
            runId: "r1",
            startedAt: at,
            completedAt: at,
            reportSha256: "r".repeat(64),
          },
          coverage: {} as unknown as VettingScanResult["coverage"],
          checks: {} as unknown as VettingScanResult["checks"],
          visibilityGaps: [],
          execution: null,
          reusedAssessmentId: null,
          primaryReview: {
            provider: "p",
            model: "m",
            promptPolicyRevision: "1",
            inputManifestSha256: "i".repeat(64),
            runId: "r",
            status: "completed",
            verdict: "findings",
            risk: "high",
            findingCount: 1,
          },
          specialistReview: null,
          artifacts: [],
          findings: [
            {
              severity: "high",
              category: "unsafe-execution",
              summary: "Command injection in skill template bootstrap",
              evidence,
            },
          ],
          confirmation: null,
        },
      });
      expect(summary.findingsLocation).toBe(location);
      const result = status({ state: "quarantined", assessment: summary });
      if (location === "unknown") {
        expect(result.checks.scan.message).toBe("Findings block clearance.");
        expect(result.nextAction.message).toBe(
          "Findings block clearance. Review the scan result before requesting a new scan.",
        );
      }
    },
  );

  test("classifies repository location for repository findings", () => {
    const summary = summarize({
      ...dummyAssessment,
      result: {
        schemaVersion: "slop-vetting-result-v2",
        assessmentId: dummyAssessment.id,
        projectId: dummyAssessment.projectId,
        revision: 1,
        manifestSha256: dummyAssessment.manifestSha256,
        disposition: "incomplete",
        policyVersion: "1",
        assessed: {
          repository: "owner/repo",
          commitSha: dummyAssessment.commitSha,
          templateSha256: dummyAssessment.templateSha256,
          inputManifestSha256: "i".repeat(64),
          dependencyLocks: [],
        },
        scan: {
          runId: "r1",
          startedAt: at,
          completedAt: at,
          reportSha256: "r".repeat(64),
        },
        coverage: {} as unknown as VettingScanResult["coverage"],
        checks: {} as unknown as VettingScanResult["checks"],
        visibilityGaps: [],
        execution: null,
        reusedAssessmentId: null,
        primaryReview: {
          provider: "p",
          model: "m",
          promptPolicyRevision: "1",
          inputManifestSha256: "i".repeat(64),
          runId: "r",
          status: "completed",
          verdict: "findings",
          risk: "high",
          findingCount: 1,
        },
        specialistReview: null,
        artifacts: [],
        findings: [
          {
            severity: "high",
            category: "credential-theft",
            summary: "Hardcoded secret in src/config.ts",
            evidence: "src/config.ts:42",
          },
        ],
        confirmation: null,
      },
    });
    expect(summary.findingsLocation).toBe("repository");
  });

  test("does not misclassify repository findings as template when summary mentions skill template", () => {
    const summary = summarize({
      ...dummyAssessment,
      result: {
        schemaVersion: "slop-vetting-result-v2",
        assessmentId: dummyAssessment.id,
        projectId: dummyAssessment.projectId,
        revision: 1,
        manifestSha256: dummyAssessment.manifestSha256,
        disposition: "incomplete",
        policyVersion: "1",
        assessed: {
          repository: "owner/repo",
          commitSha: dummyAssessment.commitSha,
          templateSha256: dummyAssessment.templateSha256,
          inputManifestSha256: "i".repeat(64),
          dependencyLocks: [],
        },
        scan: {
          runId: "r1",
          startedAt: at,
          completedAt: at,
          reportSha256: "r".repeat(64),
        },
        coverage: {} as unknown as VettingScanResult["coverage"],
        checks: {} as unknown as VettingScanResult["checks"],
        visibilityGaps: [],
        execution: null,
        reusedAssessmentId: null,
        primaryReview: {
          provider: "p",
          model: "m",
          promptPolicyRevision: "1",
          inputManifestSha256: "i".repeat(64),
          runId: "r",
          status: "completed",
          verdict: "findings",
          risk: "high",
          findingCount: 1,
        },
        specialistReview: null,
        artifacts: [],
        findings: [
          {
            severity: "high",
            category: "credential-theft",
            summary: "Secret near skill template install path",
            evidence: "src/config.ts:42",
          },
        ],
        confirmation: null,
      },
    });
    expect(summary.findingsLocation).toBe("repository");
  });

  test("does not misclassify repository paths with skills substring as template", () => {
    const summary = summarize({
      ...dummyAssessment,
      result: {
        schemaVersion: "slop-vetting-result-v2",
        assessmentId: dummyAssessment.id,
        projectId: dummyAssessment.projectId,
        revision: 1,
        manifestSha256: dummyAssessment.manifestSha256,
        disposition: "incomplete",
        policyVersion: "1",
        assessed: {
          repository: "owner/repo",
          commitSha: dummyAssessment.commitSha,
          templateSha256: dummyAssessment.templateSha256,
          inputManifestSha256: "i".repeat(64),
          dependencyLocks: [],
        },
        scan: {
          runId: "r1",
          startedAt: at,
          completedAt: at,
          reportSha256: "r".repeat(64),
        },
        coverage: {} as unknown as VettingScanResult["coverage"],
        checks: {} as unknown as VettingScanResult["checks"],
        visibilityGaps: [],
        execution: null,
        reusedAssessmentId: null,
        primaryReview: {
          provider: "p",
          model: "m",
          promptPolicyRevision: "1",
          inputManifestSha256: "i".repeat(64),
          runId: "r",
          status: "completed",
          verdict: "findings",
          risk: "high",
          findingCount: 1,
        },
        specialistReview: null,
        artifacts: [],
        findings: [
          {
            severity: "high",
            category: "unsafe-execution",
            summary: "Unsafe exec",
            evidence: "packages/skills/runner.ts:1",
          },
        ],
        confirmation: null,
      },
    });
    expect(summary.findingsLocation).toBe("repository");
  });

  test("classifies both when both locations have findings", () => {
    const summary = summarize({
      ...dummyAssessment,
      result: {
        schemaVersion: "slop-vetting-result-v2",
        assessmentId: dummyAssessment.id,
        projectId: dummyAssessment.projectId,
        revision: 1,
        manifestSha256: dummyAssessment.manifestSha256,
        disposition: "incomplete",
        policyVersion: "1",
        assessed: {
          repository: "owner/repo",
          commitSha: dummyAssessment.commitSha,
          templateSha256: dummyAssessment.templateSha256,
          inputManifestSha256: "i".repeat(64),
          dependencyLocks: [],
        },
        scan: {
          runId: "r1",
          startedAt: at,
          completedAt: at,
          reportSha256: "r".repeat(64),
        },
        coverage: {} as unknown as VettingScanResult["coverage"],
        checks: {} as unknown as VettingScanResult["checks"],
        visibilityGaps: [],
        execution: null,
        reusedAssessmentId: null,
        primaryReview: {
          provider: "p",
          model: "m",
          promptPolicyRevision: "1",
          inputManifestSha256: "i".repeat(64),
          runId: "r",
          status: "completed",
          verdict: "findings",
          risk: "high",
          findingCount: 2,
        },
        specialistReview: null,
        artifacts: [],
        findings: [
          {
            severity: "high",
            category: "unsafe-execution",
            summary: "Command injection in skill template",
            evidence: "slop-skill-template/skills/SKILL.md:10",
          },
          {
            severity: "high",
            category: "credential-theft",
            summary: "Exfiltration in lib/drain.ts",
            evidence: "lib/drain.ts:5",
          },
        ],
        confirmation: null,
      },
    });
    expect(summary.findingsLocation).toBe("both");
  });

  test("classifies project's own skills directory at repository root as repository finding", () => {
    const summary = summarize({
      ...dummyAssessment,
      result: {
        schemaVersion: "slop-vetting-result-v2",
        assessmentId: dummyAssessment.id,
        projectId: dummyAssessment.projectId,
        revision: 1,
        manifestSha256: dummyAssessment.manifestSha256,
        disposition: "incomplete",
        policyVersion: "1",
        assessed: {
          repository: "owner/repo",
          commitSha: dummyAssessment.commitSha,
          templateSha256: dummyAssessment.templateSha256,
          inputManifestSha256: "i".repeat(64),
          dependencyLocks: [],
        },
        scan: {
          runId: "r1",
          startedAt: at,
          completedAt: at,
          reportSha256: "r".repeat(64),
        },
        coverage: {} as unknown as VettingScanResult["coverage"],
        checks: {} as unknown as VettingScanResult["checks"],
        visibilityGaps: [],
        execution: null,
        reusedAssessmentId: null,
        primaryReview: {
          provider: "p",
          model: "m",
          promptPolicyRevision: "1",
          inputManifestSha256: "i".repeat(64),
          runId: "r",
          status: "completed",
          verdict: "findings",
          risk: "high",
          findingCount: 1,
        },
        specialistReview: null,
        artifacts: [],
        findings: [
          {
            severity: "high",
            category: "unsafe-execution",
            summary: "Command execution in project skill",
            evidence: "skills/my-agent-skill/SKILL.md:15",
          },
        ],
        confirmation: null,
      },
    });
    expect(summary.findingsLocation).toBe("repository");
  });

  test("remains undefined when scan result has no findings or held artifacts", () => {
    const summary = summarize({
      ...dummyAssessment,
      result: null,
    });
    expect(summary.findingsLocation).toBeUndefined();
  });
});

describe("incomplete scan reasons for the owner (issue #1991)", () => {
  const hex = (char: string) => char.repeat(64);
  const assessment: VettingAssessment = {
    id: "vet_0123456789abcdef0123456789abcdef",
    projectId: "exemption-test",
    revision: 2,
    manifestSha256: hex("a"),
    contentSha256: hex("b"),
    state: "incomplete",
    commitSha: "c".repeat(40),
    templateSha256: hex("d"),
    policyVersion: "slop-bounded-2026-10-24",
    requestedBy: { githubId: "1", githubLogin: "owner" },
    requestReason: "First scan after self-service setup",
    resultSha256: hex("e"),
    signingKeySha256: hex("f"),
    requestedAt: at,
    completedAt: at,
    result: null,
  };
  const review = (
    runId: string,
    verdict: ScanReview["verdict"],
    risk: ScanReview["risk"],
  ): ScanReview => ({
    provider: "anthropic",
    model: "claude-opus-5-5",
    promptPolicyRevision: "slop-scan-review-2",
    inputManifestSha256: hex("1"),
    runId,
    status: "completed",
    verdict,
    risk,
    findingCount: verdict === "no-findings" ? 0 : 1,
  });
  const complete = { state: "complete" as const, items: 1 };
  /** A recorded incomplete result that passes the real schema parser. */
  const incompleteScan = (
    overrides: Partial<VettingScanResult>,
  ): VettingScanResult =>
    parseVettingScanResult({
      schemaVersion: "slop-vetting-result-v2",
      assessmentId: assessment.id,
      projectId: assessment.projectId,
      revision: assessment.revision,
      manifestSha256: assessment.manifestSha256,
      disposition: "incomplete",
      policyVersion: assessment.policyVersion,
      assessed: {
        repository: "example/exemption-test",
        commitSha: assessment.commitSha,
        templateSha256: assessment.templateSha256,
        inputManifestSha256: hex("1"),
        dependencyLocks: [],
      },
      scan: {
        runId: "scan-run-2",
        startedAt: at,
        completedAt: at,
        reportSha256: hex("2"),
      },
      coverage: {
        source: complete,
        manifests: complete,
        dependencies: complete,
        installScripts: complete,
        downloads: complete,
        agentInstructions: complete,
      },
      checks: {
        "wallet-drainer": "passed",
        "credential-theft": "passed",
        "secret-exfiltration": "passed",
        "unsafe-execution": "passed",
        "prompt-injection": "passed",
      },
      visibilityGaps: [],
      execution: null,
      reusedAssessmentId: null,
      primaryReview: review("primary-run-2", "no-findings", "low"),
      specialistReview: null,
      artifacts: [],
      findings: [],
      confirmation: null,
      ...overrides,
    });
  const quarantined = (result: VettingScanResult) => {
    // The disposition is consistent with its own evidence.
    expect(scanProblems(result)).toEqual([]);
    const summary = summarize({ ...assessment, result });
    return {
      summary,
      setup: status({ state: "quarantined", assessment: summary }),
    };
  };

  test("every check passed and every surface complete: the block is on Slop's side", () => {
    const result = incompleteScan({
      primaryReview: review("primary-run-2", "findings", "ambiguous"),
      specialistReview: review("specialist-run-2", "findings", "ambiguous"),
      visibilityGaps: ["specialist:agentInstructions:partial"],
      findings: [
        {
          severity: "medium",
          category: "unsafe-execution",
          summary: "The receipt script runs a package with bun x",
          evidence: "slop-skill-template/scripts/run-receipt.mjs:12",
        },
      ],
    });
    const { summary, setup } = quarantined(result);
    expect(setup.state).toBe("action_required");
    expect(setup.checks.scan.message).toBe(
      "Findings in Slop's skill template block clearance.",
    );
    expect(setup.checks.scan.reasons).toEqual([
      "Every deterministic check passed and every surface was read completely, so nothing in the repository was flagged by the checks. The block is a review-coverage decision on Slop's side; changing the repository will not clear it.",
      "The specialist review covered the agent instructions area partially.",
      "The primary review reported findings and rated the result ambiguous, and the specialist review did not clear it: it reported findings and rated the result ambiguous.",
    ]);
    // Nothing the models wrote reaches the owner, and nothing reads "passed".
    const shown = JSON.stringify(setup.checks.scan);
    expect(shown).not.toContain("receipt script");
    expect(shown).not.toContain("run-receipt");
    expect(shown).not.toMatch(/\bpassed\b(?! and every surface)/u);
    expect(setup.checks.scan.state).toBe("quarantined");
    // The admin view derives the same list from the same summary.
    expect(scanClearanceReasons(summary)).toEqual(
      setup.checks.scan.reasons ?? [],
    );
  });

  test("a flagged check, a high finding and a partial surface each name the repository", () => {
    const result = incompleteScan({
      coverage: {
        source: complete,
        manifests: complete,
        dependencies: complete,
        installScripts: complete,
        downloads: { state: "partial", items: 1 },
        agentInstructions: complete,
      },
      checks: {
        "wallet-drainer": "passed",
        "credential-theft": "flagged",
        "secret-exfiltration": "passed",
        "unsafe-execution": "passed",
        "prompt-injection": "passed",
      },
      visibilityGaps: [
        "A postinstall download was not retrievable: https://example.org/addon.tgz",
      ],
      primaryReview: review("primary-run-2", "findings", "high"),
      findings: [
        {
          severity: "high",
          category: "credential-theft",
          summary: "A postinstall script reads the browser wallet store",
          evidence: "scripts/postinstall.js:12",
        },
      ],
    });
    const { setup } = quarantined(result);
    expect(setup.checks.scan.message).toBe(
      "Findings in the project repository block clearance.",
    );
    expect(setup.checks.scan.reasons).toEqual([
      "The credential theft check flagged content (1 open finding rated high or critical).",
      "The downloads surface was read partially.",
      "Coverage note from the scanner: A postinstall download was not retrievable: https://example.org/addon.tgz",
      "The primary review reported findings and rated the result high risk, and the specialist review that this result requires did not run.",
    ]);
    expect(JSON.stringify(setup.checks.scan)).not.toContain("wallet store");
  });

  test("a scan that did not finish, and a historical result, list no reasons", () => {
    const unfinished = status({
      state: "quarantined",
      assessment: { ...summarize(assessment), completedAt: null },
    });
    expect(unfinished.checks.scan.reasons).toBeUndefined();
    expect(unfinished.checks.scan.message).toBe(
      "The last scan could not finish, so it did not clear the project.",
    );
  });
});
