import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

/**
 * Maven reads `.mvn/jvm.config`, `.mvn/maven.config` and
 * `.mvn/extensions.xml` by itself on every `mvn` call, and Gradle applies
 * `org.gradle.jvmargs` from `gradle.properties`. Each can load a jar's code
 * before the build reads any manifest, so none may stay unclassified: a file
 * without a surface is dropped from the review and its absence still counts
 * as complete install coverage.
 */
const CONFIGS: [string, string][] = [
  [".mvn/jvm.config", "-javaagent:tools/agent.jar\n-Dfile.encoding=UTF-8\n"],
  [".mvn/jvm.config", "-agentpath:/opt/evil.so\n"],
  // The same JVMTI load, resolved by library name instead of path.
  [".mvn/jvm.config", "-agentlib:evil\n"],
  // Repository code in the JVM before the build, without an agent.
  [".mvn/jvm.config", "-Xbootclasspath/a:tools/evil.jar\n"],
  [".mvn/jvm.config", "-Djava.system.class.loader=com.evil.Loader\n"],
  [".mvn/maven.config", "-Dmaven.ext.class.path=tools/extension.jar\n"],
  ["gradle.properties", "org.gradle.jvmargs=-javaagent:tools/agent.jar\n"],
  // `.properties` accepts `:` as a separator as well as `=`.
  ["gradle.properties", "org.gradle.jvmargs:-agentlib:evil\n"],
];

test("JVM build configuration is scanned as an install script", () => {
  for (const [file, text] of CONFIGS)
    for (const path of [file, `service/${file}`, file.toUpperCase()]) {
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
          (finding) => `${finding.path}:${finding.category}`,
        ),
      }).toEqual({ path, findings: [`${path}:unsafe-execution`] });
    }
});

test("a Maven core extension list is reviewed even without a rule match", () => {
  const path = ".mvn/extensions.xml";
  const inspection = inspected(
    path,
    `<extensions><extension><groupId>com.example</groupId><artifactId>build-extension</artifactId><version>1.0</version></extension></extensions>\n`,
  );
  expect(surfacesOf(path)).toEqual(["installScripts", "source"]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(inspection.findings).toEqual([]);
});

test("a Gradle wrapper URL is unescaped before it is reported", () => {
  // Gradle writes the colon escaped in `.properties` format.
  const inspection = inspected(
    "gradle/wrapper/gradle-wrapper.properties",
    "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.7-bin.zip\n",
  );
  expect(inspection.downloads).toEqual([
    "https://services.gradle.org/distributions/gradle-8.7-bin.zip",
  ]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://services.gradle.org/distributions/gradle-8.7-bin.zip",
  ]);
  expect(inspection.coverage.downloads.state).toBe("partial");
});

test("a wrapper distribution URL stays a visible download", () => {
  const inspection = inspected(
    ".mvn/wrapper/maven-wrapper.properties",
    "distributionUrl=https://example.test/maven/apache-maven-3.9.9-bin.zip\n",
  );
  expect(inspection.downloads).toEqual([
    "https://example.test/maven/apache-maven-3.9.9-bin.zip",
  ]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://example.test/maven/apache-maven-3.9.9-bin.zip",
  ]);
  expect(inspection.coverage.downloads.state).toBe("partial");
});

test("JVM names outside a build directory keep their surfaces", () => {
  // `.mvn` is only read at a build root, so a bare name elsewhere is content.
  expect(surfacesOf("docs/jvm.config")).toEqual([]);
  expect(surfacesOf("docs/extensions.xml")).toEqual([]);
  // Gradle reads the properties file of the directory it runs in.
  expect(surfacesOf("src/gradle.properties")).toEqual([
    "installScripts",
    "source",
  ]);
  expect(surfacesOf("gradle.properties.bak")).toEqual([]);
});
