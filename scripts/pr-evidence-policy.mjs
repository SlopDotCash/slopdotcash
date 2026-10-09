/** Pure PR evidence rules and trusted reference classification. */
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";

export const REQUIRED_EVIDENCE_ROWS = [
  { id: "before-screenshots", label: "Before screenshots" },
  { id: "after-screenshots", label: "After screenshots" },
  { id: "walkthrough-video", label: "Walkthrough video" },
  { id: "backend-logs", label: "Backend logs" },
  { id: "frontend-logs", label: "Frontend console/network logs" },
  { id: "llm-trajectory", label: "Real-LLM trajectory" },
  { id: "domain-artifacts", label: "Domain artifacts" },
];

export const SURFACE_EVIDENCE_LABELS = ["ui", "frontend", "native"];
export const SURFACE_ARTIFACT_ROW_IDS = [
  "before-screenshots",
  "after-screenshots",
  "walkthrough-video",
];
export const SURFACE_OCR_EVIDENCE_ROW = {
  id: "ocr-review",
  label: "OCR visual text review",
};

export function inspectEvidenceHead(body, headSha) {
  const expected = String(headSha ?? "").toLowerCase();
  if (!/^[a-f0-9]{40}$/i.test(expected)) {
    return {
      ok: false,
      status: "head-mismatch",
      detail: "current PR head SHA must be a complete 40-character SHA",
    };
  }
  const matches = [
    ...String(body ?? "").matchAll(
      /<!--\s*evidence-head:([a-f0-9]{40})\s*-->/gi,
    ),
  ];
  if (matches.length !== 1) {
    return {
      ok: false,
      status: "head-mismatch",
      detail:
        "exactly one evidence-head marker must contain the current PR head SHA",
    };
  }

  const observed = matches[0][1].toLowerCase();
  if (observed === expected) return { ok: true, status: "ok", detail: "" };

  let sharedPrefixLength = 0;
  while (
    sharedPrefixLength < expected.length &&
    observed[sharedPrefixLength] === expected[sharedPrefixLength]
  ) {
    sharedPrefixLength += 1;
  }
  if (sharedPrefixLength >= 8) {
    return {
      ok: false,
      status: "likely-short-sha-reconstruction",
      detail:
        "evidence-head marker shares a short prefix with the current head and appears reconstructed; re-capture the full value verbatim with git rev-parse HEAD",
    };
  }

  return {
    ok: false,
    status: "head-mismatch",
    detail: "evidence-head marker must match the current PR head SHA",
  };
}

export function hasMatchingEvidenceHead(body, headSha) {
  return inspectEvidenceHead(body, headSha).ok;
}

/**
 * A changed file forces surface artifacts when it is a rendered-UI source file
 * — labels are advisory and agents routinely omit them, so the gate cannot rely
 * on them alone. Detection is deliberately narrow: a visual EXTENSION (`.tsx`,
 * CSS family, `.svg`, `.html`, `.vue`) under a UI-bearing PACKAGE, excluding
 * test/story/fixture files that render nothing a user sees. This is why editing
 * a real component in `packages/ui` or `packages/app` demands screenshots while
 * editing its `*.test.tsx` or `*.stories.tsx` does not.
 */
const SURFACE_PATH_RE =
  /(^|\/)(packages\/(app|ui|tui|homepage|eliza-computer)|apps\/app|packages\/cloud\/frontend|packages\/os\/landing)\//i;
const SURFACE_VISUAL_EXT_RE = /\.(tsx|jsx|css|scss|sass|less|svg|html|vue)$/i;
const SURFACE_NON_VISUAL_RE =
  /(\.(test|spec|stories|story|bench)\.|\.d\.ts$|(^|\/)(__tests__|__e2e__|__mocks__|__fixtures__|test|tests|e2e|stories)\/)/i;

/**
 * True when any changed file is a rendered-UI source file (see `SURFACE_PATH_RE`
 * rationale). Backslash paths from a Windows runner are normalized so the same
 * diff classifies identically on either OS.
 */
export function requiresSurfaceArtifactsFromFiles(files) {
  return surfaceFiles(files).length > 0;
}

/** The rendered-UI source files within a changed-file list. */
export function surfaceFiles(files) {
  return parseChangedFiles(files)
    .map((raw) => raw.replaceAll("\\", "/"))
    .filter(
      (file) =>
        SURFACE_PATH_RE.test(file) &&
        SURFACE_VISUAL_EXT_RE.test(file) &&
        !SURFACE_NON_VISUAL_RE.test(file),
    );
}

/**
 * A "before" screenshot is impossible when the ENTIRE touched UI surface is new
 * — every rendered-UI file in the diff was ADDED, none modified. In that case
 * the before-screenshots row may be an honest `N/A - <reason>` instead of
 * media. Determined mechanically from the added-files list (`git diff
 * --diff-filter=A`), never from the reason text, so it cannot be gamed by
 * prose.
 */
export function beforeScreenshotImpossible(changedFiles, addedFiles) {
  const surface = surfaceFiles(changedFiles);
  if (surface.length === 0) return false;
  const added = new Set(surfaceFiles(addedFiles));
  return surface.every((file) => added.has(file));
}
export const OCR_EVIDENCE_RE =
  /\bOCR\b|ocr-triage|mvp:visual-verify|audit:app:verify|tesseract|text readout/i;

const MARKER_RE = /<!--\s*evidence-row:([a-z0-9-]+)\s*-->/gi;
const RETIRED_REPO_EVIDENCE_PATH = [
  ".github",
  ["issue", "evidence"].join("-"),
].join("/");

export function parseLabels(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((label) => parseLabels(label))
      .filter((label, index, labels) => labels.indexOf(label) === index);
  }
  return String(value ?? "")
    .split(/[\n,]/)
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean);
}

export function requiresSurfaceArtifacts(labels) {
  const labelSet = new Set(parseLabels(labels));
  return SURFACE_EVIDENCE_LABELS.some((label) => labelSet.has(label));
}

export function hasOcrEvidenceReference(rows) {
  for (const rowText of rows.values()) {
    // OCR proof must name the review method and point at an accepted uploaded
    // report. A screenshot whose alt text merely says "OCR" is not a readout.
    if (OCR_EVIDENCE_RE.test(rowText) && hasEvidenceFileReference(rowText)) {
      return true;
    }
  }
  return false;
}

export function hasNaWithReason(text) {
  const match = text.match(/\bN\/?A\b\s*[-:\u2013\u2014]\s*(\S[\s\S]*?)$/im);
  if (!match) return false;
  const reason = match[1]
    .replace(/[`*_]+/g, "")
    .replace(/[.)\]}]+$/g, "")
    .trim();
  if (reason.length < 12 || /^<[^>]*>[.\s]*$/.test(reason)) return false;
  if (/<(?:reason|explanation|details)>/i.test(reason)) return false;
  if (/https?:\/\//i.test(reason)) return false;
  return (reason.match(/[a-z0-9][a-z0-9'.-]*/gi) ?? []).length >= 3;
}

export const IMAGE_EXTENSIONS = new Set([
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);
export const VIDEO_EXTENSIONS = new Set([".m4v", ".mov", ".mp4", ".webm"]);
export const EVIDENCE_FILE_EXTENSIONS = new Set([
  ".csv",
  ".html",
  ".json",
  ".jsonl",
  ".log",
  ".md",
  ".txt",
]);
const UUID_PATH =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const USER_ATTACHMENT_PATH_RE = new RegExp(
  `^/user-attachments/assets/${UUID_PATH}$`,
  "i",
);
const REGISTRY_REPO_PATH_PATTERN = `(?:${TARGET_REPOSITORIES.map((repository) =>
  repository.id.replaceAll(".", "\\."),
).join("|")})`;
const LEGACY_REPO_ASSET_PATH_RE = new RegExp(
  `^/${REGISTRY_REPO_PATH_PATTERN}/assets/[0-9]+/${UUID_PATH}$`,
  "i",
);
const PR_EVIDENCE_RELEASE_PATH_RE = new RegExp(
  `^/${REGISTRY_REPO_PATH_PATTERN}/releases/download/pr-evidence(?:-[1-9][0-9]*)?/([^/]+)$`,
  "i",
);
const LEGACY_USER_IMAGE_PATH_RE = /^\/[0-9]+\/[^/].+$/;

function extensionFromPath(pathname) {
  let filename;
  try {
    filename = decodeURIComponent(pathname.split("/").at(-1) ?? "");
  } catch {
    return null;
  }
  const match = filename.toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function urlReferences(text) {
  const source = String(text ?? "");
  const references = [];
  const seen = new Set();
  const add = (rawUrl, presentation) => {
    const normalized = rawUrl.trim().replace(/^<|>$/g, "");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      references.push({ url: normalized, presentation });
    }
  };

  for (const match of source.matchAll(
    /(!?)\[[^\]]*\]\(\s*<?(https:\/\/[^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/gi,
  )) {
    add(match[2], match[1] === "!" ? "image" : "link");
  }
  for (const match of source.matchAll(
    /<(img|video|source)\b[^>]*\bsrc\s*=\s*["'](https:\/\/[^"']+)["'][^>]*>/gi,
  )) {
    add(match[2], match[1].toLowerCase() === "img" ? "image" : "video");
  }
  for (const match of source.matchAll(/https:\/\/[^\s<>"'`)\]]+/gi)) {
    add(match[0].replace(/[.,;:!?]+$/g, ""), "link");
  }
  return references;
}

function trustedArtifact(reference) {
  let url;
  try {
    url = new URL(reference.url);
  } catch {
    // error-policy:J3 URL parsing is an untrusted PR-body boundary; malformed
    // values are explicitly invalid evidence.
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const extension = extensionFromPath(url.pathname);
  if (extension === null || extension === ".zip") return null;
  const normalizedReference = {
    ...reference,
    url: url.href,
    identity: `${url.origin}${url.pathname}`,
  };
  if (hostname === "github.com") {
    if (USER_ATTACHMENT_PATH_RE.test(url.pathname)) {
      return {
        extension,
        kind: "opaque-upload",
        ...normalizedReference,
      };
    }
    if (LEGACY_REPO_ASSET_PATH_RE.test(url.pathname)) {
      return {
        extension,
        kind: "opaque-upload",
        ...normalizedReference,
      };
    }
    if (PR_EVIDENCE_RELEASE_PATH_RE.test(url.pathname)) {
      return {
        extension,
        kind: "release-upload",
        ...normalizedReference,
      };
    }
    return null;
  }
  if (
    hostname === "user-images.githubusercontent.com" &&
    LEGACY_USER_IMAGE_PATH_RE.test(url.pathname) &&
    IMAGE_EXTENSIONS.has(extension)
  ) {
    return {
      extension,
      kind: "legacy-image",
      ...normalizedReference,
    };
  }
  return null;
}

export function trustedArtifacts(text) {
  const artifacts = new Map();
  for (const reference of urlReferences(text)) {
    const artifact = trustedArtifact(reference);
    if (!artifact) continue;
    const existing = artifacts.get(artifact.identity);
    if (
      !existing ||
      (existing.presentation === "link" && artifact.presentation !== "link")
    ) {
      artifacts.set(artifact.identity, artifact);
    }
  }
  return [...artifacts.values()];
}

export function hasArtifactReference(text) {
  return trustedArtifacts(text).length > 0;
}

export function artifactCanBeEvidenceFile({ extension, kind, presentation }) {
  return (
    (kind === "opaque-upload" && presentation === "link") ||
    EVIDENCE_FILE_EXTENSIONS.has(extension)
  );
}

export function hasEvidenceFileReference(text) {
  return trustedArtifacts(text).some(artifactCanBeEvidenceFile);
}

const NON_REAL_EVIDENCE_RE =
  /\b(?:placeholder|example output|logs? here|todo|tbd|fabricated|invented|fake|mocks?|fixtures?|synthetic|dummy)\b/i;

function hasSubstantiveInlineLog(text) {
  const source = String(text ?? "");
  for (const details of source.matchAll(
    /<details\b[^>]*>([\s\S]*?)<\/details>/gi,
  )) {
    const block = details[1];
    const summary =
      block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? "";
    if (
      !/\b(logs?|console|network|request|response|output|trace)\b/i.test(
        summary,
      )
    ) {
      continue;
    }
    for (const fence of block.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
      const content = fence[1].trim();
      const lines = content.split(/\r?\n/).filter((line) => line.trim());
      if (
        content.length >= 80 &&
        lines.length >= 3 &&
        !NON_REAL_EVIDENCE_RE.test(content) &&
        /(?:\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/|\b(?:INFO|WARN|ERROR|DEBUG)\b|HTTP\/[12](?:\.\d)?\s+\d{3}|\bstatus(?:Code)?["'=:\s]+\d{3}\b|^\s*[{[])/im.test(
          content,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Minimum substance for a pasted transcript to count as evidence. */
const INLINE_TRANSCRIPT_MIN_LINES = 3;
const INLINE_TRANSCRIPT_MIN_CHARS = 120;

/**
 * True when the row carries a pasted log/transcript body rather than a link to
 * one. CONTRIBUTING.md § Evidence and the root AGENTS.md both prescribe "long
 * logs in a `<details>` block", so a row that follows the documented standard
 * must satisfy the gate — requiring a URL for every non-visual row contradicts
 * the standard the gate cites and reports a real pasted transcript as `blank`.
 *
 * Only the container's own text counts: tags are stripped and the remainder must
 * clear a line and character floor, so `<details></details>` or a one-line
 * "logs attached" still fails. This never relaxes the visual rows — a surface PR
 * reaches `hasVisualArtifactReference` first and returns `artifact-required`
 * before this is consulted, so screenshots and video still demand real media.
 */
export function hasInlineTranscriptEvidence(text) {
  const source = String(text ?? "");
  const blocks = [
    ...source.matchAll(/<details[\s\S]*?<\/details>/gi),
    ...source.matchAll(/<pre[\s\S]*?<\/pre>/gi),
    ...source.matchAll(/```[\s\S]*?```/g),
  ].map((match) => match[0]);
  return blocks.some((block) => {
    const content = block
      // A <summary> is a caption, not evidence — it must not carry the block.
      .replace(/<summary[\s\S]*?<\/summary>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/```/g, " ");
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return (
      lines.length >= INLINE_TRANSCRIPT_MIN_LINES &&
      lines.join("").length >= INLINE_TRANSCRIPT_MIN_CHARS &&
      !NON_REAL_EVIDENCE_RE.test(content)
    );
  });
}

function substantiveTrajectoryValue(value, minimumLength) {
  const serialized =
    typeof value === "string" ? value.trim() : JSON.stringify(value);
  if (!serialized || serialized.length < minimumLength) return false;
  const semantic = serialized.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  return semantic.length >= minimumLength && new Set(semantic).size >= 4;
}

function hasMeaningfulTrajectoryKey(value, acceptedKeys, minimumLength) {
  if (Array.isArray(value)) {
    return value.some((entry) =>
      hasMeaningfulTrajectoryKey(entry, acceptedKeys, minimumLength),
    );
  }
  if (!value || typeof value !== "object") return false;
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
    if (acceptedKeys.has(normalizedKey)) {
      if (substantiveTrajectoryValue(entry, minimumLength)) return true;
    }
    if (hasMeaningfulTrajectoryKey(entry, acceptedKeys, minimumLength)) {
      return true;
    }
  }
  return false;
}

export function hasTrajectorySemantics(value) {
  return (
    hasMeaningfulTrajectoryKey(value, new Set(["provider"]), 4) &&
    hasMeaningfulTrajectoryKey(value, new Set(["model", "modelid"]), 4) &&
    hasMeaningfulTrajectoryKey(
      value,
      new Set(["input", "messages", "prompt", "request"]),
      8,
    ) &&
    hasMeaningfulTrajectoryKey(
      value,
      new Set(["completion", "events", "output", "response", "steps"]),
      8,
    )
  );
}

function parseStructuredTrajectory(text) {
  const content = text.trim();
  if (content.length < INLINE_TRANSCRIPT_MIN_CHARS) return null;
  try {
    const parsed = JSON.parse(content);
    return meaningfulJson(parsed) ? parsed : null;
  } catch {
    // error-policy:J3 pasted trajectory JSON is untrusted input. JSONL is the
    // native alternative, and every non-empty line must be a complete record;
    // mixed prose and JSON is not machine-verifiable.
  }
  const records = parseJsonLines(content, true);
  return records && records.length >= 2 ? records : null;
}

/** True only for pasted JSON/JSONL carrying model, input, and output records. */
export function hasSubstantiveInlineTrajectory(text) {
  const source = String(text ?? "");
  const blocks = [
    ...source.matchAll(/<details[\s\S]*?<\/details>/gi),
    ...source.matchAll(/<pre[\s\S]*?<\/pre>/gi),
    ...source.matchAll(/```[\s\S]*?```/g),
  ].map((match) => match[0]);
  return blocks.some((block) => {
    const content = block
      .replace(/<summary[\s\S]*?<\/summary>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/```[^\n]*\n/g, "")
      .replace(/```/g, "")
      .trim();
    if (NON_REAL_EVIDENCE_RE.test(content)) return false;
    const parsed = parseStructuredTrajectory(content);
    return parsed !== null && hasTrajectorySemantics(parsed);
  });
}

/**
 * Accepts only media uploaded to GitHub's attachment hosts or the repository's
 * canonical evidence release. Opaque GitHub upload URLs must use image markup
 * for screenshot rows; video rows accept the bare URL form GitHub emits.
 */
export function hasVisualArtifactReference(text, expected = "media") {
  return trustedArtifacts(text).some((artifact) => {
    const image =
      IMAGE_EXTENSIONS.has(artifact.extension) ||
      (artifact.kind === "opaque-upload" && artifact.presentation === "image");
    const video =
      VIDEO_EXTENSIONS.has(artifact.extension) ||
      (artifact.kind === "opaque-upload" && artifact.presentation !== "image");
    if (expected === "image") return image;
    if (expected === "video") return video;
    return image || video;
  });
}

export function parseChangedFiles(value) {
  if (Array.isArray(value))
    return value.flatMap((entry) => parseChangedFiles(entry));
  return String(value ?? "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function findRetiredRepoEvidenceFiles(files) {
  return parseChangedFiles(files).filter((file) =>
    file.replaceAll("\\", "/").startsWith(`${RETIRED_REPO_EVIDENCE_PATH}/`),
  );
}

export function isChecked(rowText) {
  return /^\s*[-*]\s*\[\s*[xX]\s*\]/m.test(rowText);
}

export function isRowSatisfied(rowText) {
  return (
    hasNaWithReason(rowText) ||
    hasArtifactReference(rowText) ||
    hasInlineTranscriptEvidence(rowText)
  );
}

export function isRowSatisfiedForContext(
  rowText,
  { artifactRequired = false } = {},
) {
  if (artifactRequired) return hasArtifactReference(rowText);
  return isRowSatisfied(rowText);
}

function isEvidenceRowSatisfied(id, rowText) {
  if (hasNaWithReason(rowText)) return true;
  if (id === "before-screenshots" || id === "after-screenshots") {
    return hasVisualArtifactReference(rowText, "image");
  }
  if (id === "walkthrough-video") {
    return hasVisualArtifactReference(rowText, "video");
  }
  if (id === "backend-logs" || id === "frontend-logs") {
    return (
      hasEvidenceFileReference(rowText) ||
      hasSubstantiveInlineLog(rowText) ||
      hasInlineTranscriptEvidence(rowText)
    );
  }
  if (id === "llm-trajectory") {
    return (
      hasEvidenceFileReference(rowText) ||
      hasSubstantiveInlineTrajectory(rowText)
    );
  }
  return hasArtifactReference(rowText) || hasInlineTranscriptEvidence(rowText);
}

export function boundRowBlock(block) {
  const lines = block.split(/\r?\n/);
  const out = [];
  let started = false;
  let detailsDepth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!started) {
      if (line.trim() === "") continue;
      started = true;
      out.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === "") {
      if (detailsDepth > 0) {
        out.push(line);
        continue;
      }
      const next = lines.slice(index + 1).find((candidate) => candidate.trim());
      if (next && /^<details\b/i.test(next.trim())) {
        out.push(line);
        continue;
      }
      break;
    }
    if (detailsDepth === 0 && /^#/.test(trimmed)) break;
    if (/<!--\s*evidence-row:/i.test(trimmed)) break;
    if (detailsDepth === 0 && /^[-*]\s/.test(line) && !/^\s/.test(line)) {
      break;
    }
    out.push(line);
    detailsDepth += (line.match(/<details\b/gi) ?? []).length;
    detailsDepth -= (line.match(/<\/details>/gi) ?? []).length;
    detailsDepth = Math.max(0, detailsDepth);
  }
  return out.join("\n").trim();
}

export function extractEvidenceRows(body) {
  const source = body ?? "";
  const rows = new Map();
  const matches = [];
  for (const match of source.matchAll(MARKER_RE)) {
    const start = match.index;
    matches.push({
      id: match[1].toLowerCase(),
      start,
      end: start + match[0].length,
    });
  }

  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    const sliceEnd = next ? next.start : source.length;
    const rowText = boundRowBlock(source.slice(current.end, sliceEnd));
    if (!rows.has(current.id) || rowText.length > 0) {
      rows.set(current.id, rowText);
    }
  }
  return rows;
}

function duplicateArtifactsByRow(rows, requiredRows) {
  const owners = new Map();
  for (const { id } of requiredRows) {
    const rowText = rows.get(id);
    if (rowText === undefined) continue;
    for (const artifact of trustedArtifacts(rowText)) {
      const record = owners.get(artifact.identity) ?? {
        rows: new Set(),
        url: artifact.url,
      };
      record.rows.add(id);
      owners.set(artifact.identity, record);
    }
  }

  const duplicates = new Map();
  for (const { rows: rowIds, url } of owners.values()) {
    if (rowIds.size < 2) continue;
    for (const id of rowIds) {
      const rowDuplicates = duplicates.get(id) ?? [];
      rowDuplicates.push({ rowIds: [...rowIds], url });
      duplicates.set(id, rowDuplicates);
    }
  }
  return duplicates;
}

export function evaluatePrEvidence(
  body,
  requiredRows = REQUIRED_EVIDENCE_ROWS,
  options = {},
) {
  const source = String(body ?? "");
  const rows = extractEvidenceRows(source);
  const markerCounts = new Map();
  for (const match of source.matchAll(MARKER_RE)) {
    const id = match[1].toLowerCase();
    markerCounts.set(id, (markerCounts.get(id) ?? 0) + 1);
  }
  // When a changed-file list is available, path detection is the sole surface
  // trigger: the auto-labeler applies `ui` to ANY packages/ui path, so the
  // label alone forces screenshots onto non-visual .ts changes. The label
  // trigger survives only for label-only invocations (no file list), where it
  // is the best signal available.
  const surfaceArtifactsRequired =
    parseChangedFiles(options.changedFiles).length > 0
      ? requiresSurfaceArtifactsFromFiles(options.changedFiles)
      : requiresSurfaceArtifacts(options.labels);
  // A wholly-new surface (every touched UI file was ADDED) has no "before"
  // state to photograph; that one row may be N/A-with-reason.
  const beforeNaAllowed = beforeScreenshotImpossible(
    options.changedFiles,
    options.addedFiles,
  );
  const rowsCheckedForDuplicates = [
    ...requiredRows,
    ...(surfaceArtifactsRequired || rows.has(SURFACE_OCR_EVIDENCE_ROW.id)
      ? [SURFACE_OCR_EVIDENCE_ROW]
      : []),
  ].filter(
    (row, index, allRows) =>
      allRows.findIndex((candidate) => candidate.id === row.id) === index,
  );
  const duplicateArtifacts = duplicateArtifactsByRow(
    rows,
    rowsCheckedForDuplicates,
  );
  const findings = requiredRows.map(({ id, label }) => {
    const rowDuplicates = duplicateArtifacts.get(id);
    if (rowDuplicates) {
      const details = rowDuplicates.map(({ rowIds, url }) => {
        const otherRows = rowIds.filter((rowId) => rowId !== id).join(", ");
        return `${url} is also used by ${otherRows}`;
      });
      return {
        id,
        label,
        status: "duplicate-artifact",
        detail: details.join("; "),
      };
    }
    if (!rows.has(id)) return { id, label, status: "missing" };
    if (markerCounts.get(id) !== 1) {
      return { id, label, status: "duplicate" };
    }
    const rowText = rows.get(id);
    if (rowText.length === 0) return { id, label, status: "blank" };
    const artifactRequired =
      surfaceArtifactsRequired &&
      SURFACE_ARTIFACT_ROW_IDS.includes(id) &&
      !(
        id === "before-screenshots" &&
        beforeNaAllowed &&
        hasNaWithReason(rowText)
      );
    // Visual rows on a surface PR demand REAL media (attachment/embed/media
    // URL) — a link to the PR page or a /checks tab is not a screenshot.
    const expectedMedia = id === "walkthrough-video" ? "video" : "image";
    if (
      artifactRequired &&
      !hasVisualArtifactReference(rowText, expectedMedia)
    ) {
      return { id, label, status: "artifact-required" };
    }
    return {
      id,
      label,
      status:
        artifactRequired || isEvidenceRowSatisfied(id, rowText)
          ? "ok"
          : "blank",
    };
  });
  if (surfaceArtifactsRequired) {
    const { id, label } = SURFACE_OCR_EVIDENCE_ROW;
    const rowText = rows.get(id);
    const rowDuplicates = duplicateArtifacts.get(id);
    if (rowDuplicates) {
      findings.push({
        id,
        label,
        status: "duplicate-artifact",
        detail: rowDuplicates
          .map(
            ({ rowIds, url }) =>
              `${url} is also used by ${rowIds.filter((rowId) => rowId !== id).join(", ")}`,
          )
          .join("; "),
      });
    } else if (rowText === undefined) {
      findings.push({ ...SURFACE_OCR_EVIDENCE_ROW, status: "ocr-required" });
    } else if (markerCounts.get(id) !== 1) {
      findings.push({ ...SURFACE_OCR_EVIDENCE_ROW, status: "ocr-required" });
    } else if (
      rowText.length === 0 ||
      !OCR_EVIDENCE_RE.test(rowText) ||
      !hasEvidenceFileReference(rowText)
    ) {
      findings.push({ ...SURFACE_OCR_EVIDENCE_ROW, status: "ocr-required" });
    } else {
      findings.push({ ...SURFACE_OCR_EVIDENCE_ROW, status: "ok" });
    }
  }

  return {
    ok: findings.every((finding) => finding.status === "ok"),
    findings,
  };
}

export function artifactVerificationRows(
  body,
  requiredRows = REQUIRED_EVIDENCE_ROWS,
) {
  const rows = extractEvidenceRows(String(body ?? ""));
  if (
    !rows.has(SURFACE_OCR_EVIDENCE_ROW.id) ||
    requiredRows.some((row) => row.id === SURFACE_OCR_EVIDENCE_ROW.id)
  ) {
    return requiredRows;
  }
  return [...requiredRows, SURFACE_OCR_EVIDENCE_ROW];
}

/** Counts only artifact references accepted by this verifier's trust policy. */
export function planReferencedArtifacts(
  body,
  requiredRows = REQUIRED_EVIDENCE_ROWS,
  options = {},
) {
  const rows = extractEvidenceRows(String(body ?? ""));
  const allowedArtifactKinds = options.allowedArtifactKinds
    ? new Set(options.allowedArtifactKinds)
    : null;
  const identities = new Set();
  let referenceCount = 0;
  for (const { id } of requiredRows) {
    const rowText = rows.get(id);
    if (rowText === undefined) continue;
    const artifacts = trustedArtifacts(rowText).filter(
      (artifact) =>
        allowedArtifactKinds === null ||
        allowedArtifactKinds.has(artifact.kind),
    );
    referenceCount += artifacts.length;
    for (const artifact of artifacts) identities.add(artifact.identity);
  }
  return {
    referenceCount,
    uniqueArtifactCount: identities.size,
  };
}
