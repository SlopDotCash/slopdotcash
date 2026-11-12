import { describe, expect, test } from "bun:test";
import type { ProjectRecord } from "../../src/lib/project-contracts";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { scanClearanceView } from "../../src/lib/scan-clearance";
import type { VettingClearance } from "../../src/lib/vetting-contracts";
import { applicationManifest } from "../../tests/project-application-manifest";
import type { VettingAssessment } from "../vetting/persistence";
import { summarize } from "../vetting/persistence";
import {
  parseRecordedVettingResult,
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
    repositoryId: "example/test-project",
    policyVersion: "1",
    requestedBy: { githubId: "1", githubLogin: "owner" },
    requestReason: "admission",
    resultSha256: "r".repeat(64),
    signingKeySha256: "s".repeat(64),
    requestedAt: at,
    completedAt: at,
    result: null,
  };
  const scanResult = (
    findings: VettingScanResult["findings"],
  ): VettingScanResult => ({
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
      findingCount: findings.length,
    },
    specialistReview: null,
    artifacts: [],
    findings,
    confirmation: null,
  });

  test.each([
    ["slop-skill-template/skills/SKILL.md:10", "template"],
    ["The reviewer found an unsafe command in the skill template.", "unknown"],
  ] as const)(
    "uses only path evidence for the finding location: %s",
    (evidence, location) => {
      const summary = summarize({
        ...dummyAssessment,
        result: scanResult([
          {
            severity: "high",
            category: "unsafe-execution",
            summary: "Command injection in skill template bootstrap",
            evidence,
          },
        ]),
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
      result: scanResult([
        {
          severity: "high",
          category: "credential-theft",
          summary: "Hardcoded secret in src/config.ts",
          evidence: "src/config.ts:42",
        },
      ]),
    });
    expect(summary.findingsLocation).toBe("repository");
  });

  test("does not misclassify repository findings as template when summary mentions skill template", () => {
    const summary = summarize({
      ...dummyAssessment,
      result: scanResult([
        {
          severity: "high",
          category: "credential-theft",
          summary: "Secret near skill template install path",
          evidence: "src/config.ts:42",
        },
      ]),
    });
    expect(summary.findingsLocation).toBe("repository");
  });

  test("does not misclassify repository paths with skills substring as template", () => {
    const summary = summarize({
      ...dummyAssessment,
      result: scanResult([
        {
          severity: "high",
          category: "unsafe-execution",
          summary: "Unsafe exec",
          evidence: "packages/skills/runner.ts:1",
        },
      ]),
    });
    expect(summary.findingsLocation).toBe("repository");
  });

  test("classifies both when both locations have findings", () => {
    const summary = summarize({
      ...dummyAssessment,
      result: scanResult([
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
      ]),
    });
    expect(summary.findingsLocation).toBe("both");
  });

  test("classifies project's own skills directory at repository root as repository finding", () => {
    const summary = summarize({
      ...dummyAssessment,
      result: scanResult([
        {
          severity: "high",
          category: "unsafe-execution",
          summary: "Command execution in project skill",
          evidence: "skills/my-agent-skill/SKILL.md:15",
        },
      ]),
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

describe("paused project with a cleared scan", () => {
  const cleared: VettingClearance = {
    state: "cleared",
    assessment: null,
    grandfathered: true,
  };
  function paused(withSkillFields: boolean) {
    const manifest = applicationManifest("paused-test", "example/paused-test", {
      status: "paused",
    }) as unknown as ProjectDefinition & { contribution?: unknown };
    if (!withSkillFields) delete manifest.contribution;
    const record: ProjectRecord = {
      ...project,
      id: "paused-test",
      status: "paused",
      manifest,
    };
    return projectSetupStatus({
      project: record,
      restriction: projectRestriction(record.id, []),
      authority: { state: "verified", message: "Fixture authority check." },
      access: {
        state: "read",
        access: {
          installation: "installed",
          installationId: 123,
          permission: "admin",
          roleName: "admin",
        },
      },
      clearance: cleared,
      scanRequest: null,
      activatedRevision: null,
      checkedAt: at,
    });
  }

  test("an owner revision that kept the pause asks for a setup check, not a scan", () => {
    const result = paused(true);
    expect(result.state).toBe("action_required");
    expect(result.nextAction.kind).toBe("activate_project");
    expect(result.nextAction.message).toContain("Check again to activate it.");
    expect(result.nextAction.message).not.toContain("queue");
  });

  test("a manifest without generated skill fields asks the owner to complete them", () => {
    const result = paused(false);
    expect(result.state).toBe("action_required");
    expect(result.nextAction.kind).toBe("complete_skill_fields");
    expect(result.nextAction.message).toContain(
      "contributor guide and skill fields are complete",
    );
  });
});

describe("incomplete scan badges for the owner (issue #1991)", () => {
  const labels = (setup: ReturnType<typeof projectSetupStatus>) => {
    const view = setup.checks.scan.clearance;
    if (!view) throw new Error("Missing clearance view");
    return {
      checks: view.checks.map((badge) => `${badge.tone}:${badge.label}`),
      coverage: view.coverage.map((badge) => `${badge.tone}:${badge.label}`),
      review: view.review.map((badge) => `${badge.tone}:${badge.label}`),
    };
  };
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
    repositoryId: "example/exemption-test",
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
    parseRecordedVettingResult({
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
    }) as VettingScanResult;
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
    expect(labels(setup)).toEqual({
      checks: ["success:No check flagged"],
      coverage: ["warning:Specialist: agent instructions partial"],
      review: [
        "warning:Primary: ambiguous",
        "warning:Specialist: ambiguous",
        "info:Slop-side block",
      ],
    });
    // Nothing the models wrote reaches the owner, and nothing reads "passed".
    const shown = JSON.stringify(setup.checks.scan);
    expect(shown).not.toContain("receipt script");
    expect(shown).not.toContain("run-receipt");
    expect(shown).not.toMatch(/\bpassed\b/u);
    expect(setup.checks.scan.state).toBe("quarantined");
    // The admin view derives the same badges from the same summary.
    expect(scanClearanceView(summary)).toEqual(
      setup.checks.scan.clearance ?? null,
    );
  });

  test("a finding below high at a repository path never says the repository cannot clear it", () => {
    const medium = (evidence: string) => ({
      severity: "medium" as const,
      category: "unsafe-execution" as const,
      summary: "A postinstall script runs a package",
      evidence,
    });
    const slopSide = /Slop-side/u;
    const cases = [
      {
        findings: [medium("scripts/postinstall.js:12")],
        message: "Findings in the project repository block clearance.",
        location: "warning:Findings: repository",
      },
      {
        findings: [
          medium("scripts/postinstall.js:12"),
          medium("slop-skill-template/scripts/run-receipt.mjs:12"),
        ],
        message:
          "Findings in both the repository and skill template block clearance.",
        location: "warning:Findings: repository + template",
      },
    ];
    for (const { findings, message, location } of cases) {
      const { summary, setup } = quarantined(
        incompleteScan({
          primaryReview: review("primary-run-2", "findings", "ambiguous"),
          findings,
        }),
      );
      expect(setup.checks.scan.message).toBe(message);
      expect(labels(setup)).toEqual({
        checks: ["success:No check flagged", location],
        coverage: [],
        review: ["warning:Primary: ambiguous", "danger:Specialist not run"],
      });
      expect(JSON.stringify(setup.checks.scan)).not.toMatch(slopSide);
      expect(JSON.stringify(setup.checks.scan)).not.toContain("postinstall");
      expect(scanClearanceView(summary)).toEqual(
        setup.checks.scan.clearance ?? null,
      );
    }
    // Evidence with no path cannot be attributed, so no location badge.
    const { setup } = quarantined(
      incompleteScan({
        primaryReview: review("primary-run-2", "findings", "ambiguous"),
        findings: [medium("no path here")],
      }),
    );
    expect(setup.checks.scan.message).toBe("Findings block clearance.");
    expect(labels(setup)).toEqual({
      checks: [],
      coverage: [],
      review: ["warning:Primary: ambiguous", "danger:Specialist not run"],
    });
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
    expect(labels(setup)).toEqual({
      checks: ["danger:credential theft flagged · 1 high"],
      coverage: [
        "warning:downloads partial",
        "neutral:A postinstall download was not retrievable: https://example.org/addon.tgz",
      ],
      review: ["danger:Primary: high risk", "danger:Specialist not run"],
    });
    expect(JSON.stringify(setup.checks.scan)).not.toContain("wallet store");
  });

  test("a coverage gap the scanner recorded twice is listed once", () => {
    const { summary, setup } = quarantined(
      incompleteScan({
        primaryReview: review("primary-run-2", "findings", "ambiguous"),
        specialistReview: review("specialist-run-2", "findings", "ambiguous"),
        visibilityGaps: [
          "specialist:agentInstructions:partial",
          "specialist:agentInstructions:partial",
          "A download was not retrievable",
          "A download was not retrievable",
        ],
      }),
    );
    expect(labels(setup).coverage).toEqual([
      "warning:Specialist: agent instructions partial",
      "neutral:A download was not retrievable",
    ]);
    expect(scanClearanceView(summary)).toEqual(
      setup.checks.scan.clearance ?? null,
    );
  });

  test("a scan that did not finish, and a historical result, show no badges", () => {
    const unfinished = status({
      state: "quarantined",
      assessment: { ...summarize(assessment), completedAt: null },
    });
    expect(unfinished.checks.scan.clearance).toBeUndefined();
    expect(unfinished.checks.scan.message).toBe(
      "The last scan could not finish, so it did not clear the project.",
    );
  });
});
