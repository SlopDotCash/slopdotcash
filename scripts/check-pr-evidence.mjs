#!/usr/bin/env node
/** PR evidence CLI and compatibility exports. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { verifyReferencedArtifacts } from "./pr-evidence-artifacts.mjs";
import {
  artifactVerificationRows,
  evaluatePrEvidence,
  findRetiredRepoEvidenceFiles,
  inspectEvidenceHead,
  parseChangedFiles,
  REQUIRED_EVIDENCE_ROWS,
  SURFACE_ARTIFACT_ROW_IDS,
  SURFACE_OCR_EVIDENCE_ROW,
} from "./pr-evidence-policy.mjs";

export {
  MAX_ARTIFACTS_PER_ROW,
  MAX_ARTIFACTS_TOTAL,
  verifyReferencedArtifacts,
} from "./pr-evidence-artifacts.mjs";
export {
  artifactVerificationRows,
  beforeScreenshotImpossible,
  boundRowBlock,
  evaluatePrEvidence,
  extractEvidenceRows,
  findRetiredRepoEvidenceFiles,
  hasArtifactReference,
  hasEvidenceFileReference,
  hasInlineTranscriptEvidence,
  hasMatchingEvidenceHead,
  hasNaWithReason,
  hasOcrEvidenceReference,
  hasSubstantiveInlineTrajectory,
  hasVisualArtifactReference,
  inspectEvidenceHead,
  isChecked,
  isRowSatisfied,
  isRowSatisfiedForContext,
  parseChangedFiles,
  parseLabels,
  planReferencedArtifacts,
  REQUIRED_EVIDENCE_ROWS,
  requiresSurfaceArtifacts,
  requiresSurfaceArtifactsFromFiles,
  SURFACE_ARTIFACT_ROW_IDS,
  SURFACE_EVIDENCE_LABELS,
  SURFACE_OCR_EVIDENCE_ROW,
  surfaceFiles,
} from "./pr-evidence-policy.mjs";

function combineVerificationFindings(evaluationFindings, remoteFindings) {
  const failuresByRow = new Map();
  for (const finding of remoteFindings) {
    if (finding.status === "ok") continue;
    const failures = failuresByRow.get(finding.id) ?? [];
    failures.push(finding);
    failuresByRow.set(finding.id, failures);
  }

  return evaluationFindings.map((finding) => {
    const failures = failuresByRow.get(finding.id);
    if (!failures) return finding;
    const verificationDetail = failures
      .map(({ detail, status, url }) => `${status}: ${url} (${detail})`)
      .join("; ");
    if (finding.status !== "ok") {
      return {
        ...finding,
        detail: [finding.detail, verificationDetail].filter(Boolean).join("; "),
        verificationFailures: failures,
      };
    }
    const statuses = new Set(failures.map(({ status }) => status));
    return {
      ...finding,
      status:
        statuses.size === 1
          ? failures[0].status
          : "artifact-verification-failed",
      detail: verificationDetail,
      verificationFailures: failures,
    };
  });
}

function readBody(args) {
  const idx = args.indexOf("--body-file");
  if (idx !== -1) {
    const file = args[idx + 1];
    if (!file) {
      console.error("--body-file requires a path argument");
      process.exit(2);
    }
    return readFileSync(file, "utf8");
  }

  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function readFileListArg(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return [];

  const file = args[idx + 1];
  if (!file) {
    console.error(`${flag} requires a path argument`);
    process.exit(2);
  }
  return parseChangedFiles(readFileSync(file, "utf8"));
}

function usage() {
  console.log(`Usage: node scripts/check-pr-evidence.mjs [options]

Options:
  --body-file <path>  Read the PR body from a file (default: stdin).
  --labels <labels>   Comma-separated PR labels; ui/frontend/native require
                      concrete screenshot/video artifacts and linked OCR proof.
  --changed-files-file <path>
                      Reject committed files under retired repo evidence paths,
                      AND require concrete screenshot/video/OCR artifacts when a
                      rendered-UI source file is in the diff (labels optional).
  --added-files-file <path>
                      Newline list of ADDED files (git diff --diff-filter=A).
                      When every rendered-UI file in the diff is newly added,
                      the before-screenshots row may be 'N/A - <reason>' (a
                      brand-new surface has no before state).
  --json              Print machine-readable findings JSON.
  --head-sha <sha>    Require the evidence-head marker to match this PR head.
  --help, -h          Show this help.

Environment:
  GITHUB_TOKEN or GH_TOKEN
                      Optional token sent while resolving trusted artifacts.
`);
}

// The diagnostic for a PR body carrying NONE of the template's evidence-row
// markers (the #16925/#16913 failure shape). The --row flags are generated
// from REQUIRED_EVIDENCE_ROWS so the hint can never drift from the rows the
// gate actually enforces.
export function markerFreeBodyHint() {
  const rowFlags = REQUIRED_EVIDENCE_ROWS.map(
    ({ id }) => `    --row ${id}=<file|url|"N/A - <reason>">`,
  ).join(" \\\n");
  return `NO evidence-row markers found in the PR body. The gate locates each row
by its HTML marker (\`<!-- evidence-row:<id> -->\`) from the PR template —
prose like "Evidence rows: N/A - backend only" cannot be matched without them.
This usually means the PR template section was deleted or the body was written
from scratch.

Fix in one command (uploads/patches rows AND re-adds the missing markers; each
row takes a local file, an existing URL, or an "N/A - <reason>" string):
  node scripts/pr-evidence.mjs rows <pr> \\
${rowFlags}
Or copy the \`<!-- evidence-row:* -->\` block from .github/pull_request_template.md
into the PR description and fill each row.`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    process.exit(0);
  }

  const body = readBody(args);
  const labelsIdx = args.indexOf("--labels");
  const labels = labelsIdx === -1 ? "" : (args[labelsIdx + 1] ?? "");
  const changedFiles = readFileListArg(args, "--changed-files-file");
  const addedFiles = readFileListArg(args, "--added-files-file");
  const headIndex = args.indexOf("--head-sha");
  const headSha = headIndex === -1 ? null : (args[headIndex + 1] ?? "");
  const retiredEvidenceFiles = findRetiredRepoEvidenceFiles(changedFiles);
  const evaluation = evaluatePrEvidence(body, REQUIRED_EVIDENCE_ROWS, {
    labels,
    changedFiles,
    addedFiles,
  });
  const verification = await verifyReferencedArtifacts(
    body,
    artifactVerificationRows(body),
  );
  const findings = combineVerificationFindings(
    evaluation.findings,
    verification.findings,
  );
  const headInspection =
    headSha === null
      ? { ok: true, status: "ok", detail: "" }
      : inspectEvidenceHead(body, headSha);
  const headOk = headInspection.ok;
  if (!headOk) {
    findings.push({
      id: "evidence-head",
      label: "Evidence head SHA",
      status: headInspection.status,
      detail: headInspection.detail,
    });
  }
  const allOk =
    evaluation.ok &&
    verification.ok &&
    headOk &&
    retiredEvidenceFiles.length === 0;

  if (args.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          ok: allOk,
          findings,
          artifactFindings: verification.findings,
          retiredEvidenceFiles,
        },
        null,
        2,
      ),
    );
  } else {
    for (const finding of findings) {
      const symbol = finding.status === "ok" ? "ok  " : "FAIL";
      const detail = finding.detail ? ` — ${finding.detail}` : "";
      console.log(
        `  [${symbol}] ${finding.label} (${finding.id}): ${finding.status}${detail}`,
      );
    }
    if (retiredEvidenceFiles.length > 0) {
      console.log("  [FAIL] Retired repo evidence files:");
      for (const file of retiredEvidenceFiles) console.log(`    - ${file}`);
    }
  }

  if (!allOk) {
    const bad = findings.filter((finding) => finding.status !== "ok");
    const requiredIds = new Set(REQUIRED_EVIDENCE_ROWS.map(({ id }) => id));
    const allRequiredMissing = findings
      .filter((finding) => requiredIds.has(finding.id))
      .every((finding) => finding.status === "missing");
    if (allRequiredMissing) {
      console.error(`\n${markerFreeBodyHint()}`);
    }
    console.error(
      `\nEvidence gate FAILED: ${bad.length} row(s) need attention, ${retiredEvidenceFiles.length} retired repo evidence file(s) changed.

How to fix (fastest path):
  1. bun run evidence:doctor            # install any missing capture tool
  2. capture: bun run --cwd packages/app audit:app  (screenshots + OCR)
     and/or the fixtures under packages/ui/src/components/shell/__e2e__/
  3. attach + patch rows in ONE command:
     node scripts/pr-evidence.mjs rows <pr> \\
       --row after-screenshots=shot.jpg --row walkthrough-video=walk.mp4 \\
       --row ocr-review=ocr.txt --row frontend-logs=e2e.log ...
     (uploads to the pr-evidence release and verifies this gate locally)

Rules: visual rows on UI-touching PRs need REAL media (an uploaded image/video,
not a link to the PR or /checks page); every other row needs an artifact link
or 'N/A - <reason>'. A wholly-new surface may N/A the before-screenshots row.
Worked example: https://github.com/elizaOS/eliza/pull/15171
Full standard: CONTRIBUTING.md § Evidence.`,
    );
    process.exit(1);
  }
  console.log("\nEvidence gate passed: all required rows satisfied.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
