import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8: the scan does not retrieve install-time downloads, so
 * each one is collected and stays a visibility gap. The inventory
 * names the fetch call of each language it covers; Julia's is
 * download() from the Downloads standard library, the call a Julia
 * build script uses to fetch a URL into a local path.
 */
function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

test("a Julia download() call in install content is collected", () => {
  for (const [name, body] of [
    [
      "bare download()",
      'download("https://example.com/tool.tar.gz", "/tmp/tool.tar.gz")\n',
    ],
    [
      "module-qualified Downloads.download()",
      'Downloads.download("https://example.com/tool.tar.gz", "/tmp/tool.tar.gz")\n',
    ],
  ] as const) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${body}`);
    expect({ name, downloads: inspection.downloads }).toEqual({
      name,
      downloads: ["https://example.com/tool.tar.gz"],
    });
    // A collected download is a visibility gap, never a finding.
    expect({ name, findings: inspection.findings }).toEqual({
      name,
      findings: [],
    });
    expect({ name, visibilityGaps: inspection.visibilityGaps }).toEqual({
      name,
      visibilityGaps: [
        "Install-time download not retrieved: https://example.com/tool.tar.gz",
      ],
    });
  }
});

test("a download() call without a URL literal collects nothing", () => {
  for (const body of [
    'download("local-file", "/tmp/tool.tar.gz")\n',
    "download(url, dest)\n",
    'download("ftp://example.com/tool.tar.gz", "/tmp/tool.tar.gz")\n',
  ]) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${body}`);
    expect({ body, downloads: inspection.downloads }).toEqual({
      body,
      downloads: [],
    });
  }
});

test("the spelling does not widen collection beyond install content", () => {
  // Collection stays gated on the install surface: the same call in
  // ordinary source is reviewed as source, not recorded as an
  // install-time download.
  const inspection = inspected(
    "src/tool.py",
    'download("https://example.com/tool.tar.gz", "/tmp/tool.tar.gz")\n',
  );
  expect(inspection.downloads).toEqual([]);
});
