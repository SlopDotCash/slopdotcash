/** Trusted artifact references and evidence-row parsing for ingestion. */
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

export const SURFACE_OCR_EVIDENCE_ROW = {
  id: "ocr-review",
  label: "OCR visual text review",
};

export const OCR_EVIDENCE_RE =
  /\bOCR\b|ocr-triage|mvp:visual-verify|audit:app:verify|tesseract|text readout/i;

const MARKER_RE = /<!--\s*evidence-row:([a-z0-9-]+)\s*-->/gi;
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

export function artifactCanBeEvidenceFile({ extension, kind, presentation }) {
  return (
    (kind === "opaque-upload" && presentation === "link") ||
    EVIDENCE_FILE_EXTENSIONS.has(extension)
  );
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

function boundRowBlock(block) {
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
