// spec/contributor/artifactTransport.md, "Each request carries a credential only at the GitHub authority"

export interface EvidenceRow {
  readonly id: string;
  readonly label: string;
}

export const requiredEvidenceRows: ReadonlyArray<EvidenceRow> = [
  { id: "before-screenshots", label: "Before screenshots" },
  { id: "after-screenshots", label: "After screenshots" },
  { id: "walkthrough-video", label: "Walkthrough video" },
  { id: "backend-logs", label: "Backend logs" },
  { id: "frontend-logs", label: "Frontend console/network logs" },
  { id: "llm-trajectory", label: "Real-LLM trajectory" },
  { id: "domain-artifacts", label: "Domain artifacts" },
];

export const surfaceOcrEvidenceRow: EvidenceRow = { id: "ocr-review", label: "OCR visual text review" };

const ocrEvidencePattern = /\bOCR\b|ocr-triage|mvp:visual-verify|audit:app:verify|tesseract|text readout/i;

const imageExtensions: ReadonlySet<string> = new Set([".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const videoExtensions: ReadonlySet<string> = new Set([".m4v", ".mov", ".mp4", ".webm"]);
const evidenceFileExtensions: ReadonlySet<string> = new Set([".csv", ".html", ".json", ".jsonl", ".log", ".md", ".txt"]);

export const maxArtifactsPerRow = 8;
export const maxArtifactsTotal = 32;

export const trustedDownloadHosts: ReadonlySet<string> = new Set([
  "github.com",
  "github-production-user-asset-6210df.s3.amazonaws.com",
  "objects.githubusercontent.com",
  "private-user-images.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "user-images.githubusercontent.com",
]);

const githubAuthorityHost = "github.com";

export type UploadKind = "opaque-upload" | "release-upload" | "legacy-image";
export type Presentation = "image" | "video" | "link";
export type ExpectedKind = "image" | "video" | "document";

export interface TrustedArtifact {
  readonly url: string;
  readonly identity: string;
  readonly presentation: Presentation;
  readonly extension: string;
  readonly kind: UploadKind;
}

export interface Reference extends TrustedArtifact {
  readonly id: string;
  readonly label: string;
  readonly expectedKind: ExpectedKind | null;
}

export type LimitStatus = "artifact-limit-exceeded" | "artifact-conflict";

export interface LimitFinding {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly status: LimitStatus;
  readonly detail: string;
}

export interface Planned {
  readonly references: ReadonlyArray<Reference>;
  readonly artifacts: ReadonlyArray<Reference>;
  readonly limits: ReadonlyArray<LimitFinding>;
}

export interface Selection {
  readonly body: string;
  readonly rows: ReadonlyArray<EvidenceRow>;
  readonly uploadsOnly: boolean;
  readonly repositories: ReadonlyArray<string>;
}

const markerPattern = /<!--\s*evidence-row:([a-z0-9-]+)\s*-->/gi;
const uuidPath = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const userAttachmentPath = new RegExp(`^/user-attachments/assets/${uuidPath}$`, "i");
const legacyUserImagePath = /^\/[0-9]+\/[^/].+$/;

interface RepositoryPaths {
  readonly asset: RegExp | undefined;
  readonly release: RegExp | undefined;
}

function repositoryPaths(repositories: ReadonlyArray<string>): RepositoryPaths {
  if (repositories.length === 0) return { asset: undefined, release: undefined };
  const names = `(?:${repositories.map((repository) => repository.replaceAll(".", "\\.")).join("|")})`;
  return {
    asset: new RegExp(`^/${names}/assets/[0-9]+/${uuidPath}$`, "i"),
    release: new RegExp(`^/${names}/releases/download/pr-evidence(?:-[1-9][0-9]*)?/([^/]+)$`, "i"),
  };
}

function extensionFromPath(pathname: string): string | null {
  let filename: string;
  try {
    filename = decodeURIComponent(pathname.split("/").at(-1) ?? "");
  } catch {
    return null;
  }
  return filename.toLowerCase().match(/(\.[a-z0-9]+)$/)?.[1] ?? "";
}

interface UrlReference {
  readonly url: string;
  readonly presentation: Presentation;
}

function urlReferences(text: string): ReadonlyArray<UrlReference> {
  const references: UrlReference[] = [];
  const seen = new Set<string>();
  const add = (rawUrl: string, presentation: Presentation) => {
    const normalized = rawUrl.trim().replace(/^<|>$/g, "");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      references.push({ url: normalized, presentation });
    }
  };
  for (const match of text.matchAll(/(!?)\[[^\]]*\]\(\s*<?(https:\/\/[^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/gi)) {
    add(match[2] ?? "", match[1] === "!" ? "image" : "link");
  }
  for (const match of text.matchAll(/<(img|video|source)\b[^>]*\bsrc\s*=\s*["'](https:\/\/[^"']+)["'][^>]*>/gi)) {
    add(match[2] ?? "", (match[1] ?? "").toLowerCase() === "img" ? "image" : "video");
  }
  for (const match of text.matchAll(/https:\/\/[^\s<>"'`)\]]+/gi)) {
    add(match[0].replace(/[.,;:!?]+$/g, ""), "link");
  }
  return references;
}

function trustedArtifact(reference: UrlReference, paths: RepositoryPaths): TrustedArtifact | null {
  const url = URL.parse(reference.url);
  if (url === null || url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
  const hostname = url.hostname.toLowerCase();
  const extension = extensionFromPath(url.pathname);
  if (extension === null || extension === ".zip") return null;
  const normalized = { presentation: reference.presentation, url: url.href, identity: `${url.origin}${url.pathname}`, extension };
  if (hostname === githubAuthorityHost) {
    if (userAttachmentPath.test(url.pathname) || paths.asset?.test(url.pathname) === true) return { ...normalized, kind: "opaque-upload" };
    if (paths.release?.test(url.pathname) === true) return { ...normalized, kind: "release-upload" };
    return null;
  }
  if (hostname === "user-images.githubusercontent.com" && legacyUserImagePath.test(url.pathname) && imageExtensions.has(extension)) {
    return { ...normalized, kind: "legacy-image" };
  }
  return null;
}

/** @throws {never} */
export function trustedArtifacts(text: string, repositories: ReadonlyArray<string>): ReadonlyArray<TrustedArtifact> {
  const paths = repositoryPaths(repositories);
  const artifacts = new Map<string, TrustedArtifact>();
  for (const reference of urlReferences(text)) {
    const artifact = trustedArtifact(reference, paths);
    if (artifact === null) continue;
    const existing = artifacts.get(artifact.identity);
    if (existing === undefined || (existing.presentation === "link" && artifact.presentation !== "link")) {
      artifacts.set(artifact.identity, artifact);
    }
  }
  return [...artifacts.values()];
}

function artifactCanBeEvidenceFile(artifact: Pick<TrustedArtifact, "extension" | "kind" | "presentation">): boolean {
  return (artifact.kind === "opaque-upload" && artifact.presentation === "link") || evidenceFileExtensions.has(artifact.extension);
}

/** @throws {never} */
export function trustedDownloadUrl(rawUrl: string, base?: string): URL | null {
  const url = URL.parse(rawUrl, base);
  if (url === null || url.protocol !== "https:" || url.username || url.password || url.port || !trustedDownloadHosts.has(url.hostname.toLowerCase())) {
    return null;
  }
  return url;
}

/** @throws {never} */
export function carriesGitHubCredential(url: string): boolean {
  return URL.parse(url)?.hostname.toLowerCase() === githubAuthorityHost;
}

function substantiveTrajectoryValue(value: unknown, minimumLength: number): boolean {
  const serialized = typeof value === "string" ? value.trim() : JSON.stringify(value);
  if (!serialized || serialized.length < minimumLength) return false;
  const semantic = serialized.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  return semantic.length >= minimumLength && new Set(semantic).size >= 4;
}

function hasMeaningfulTrajectoryKey(value: unknown, acceptedKeys: ReadonlySet<string>, minimumLength: number): boolean {
  if (Array.isArray(value)) return value.some((entry: unknown) => hasMeaningfulTrajectoryKey(entry, acceptedKeys, minimumLength));
  if (!value || typeof value !== "object") return false;
  for (const [key, entry] of Object.entries(value)) {
    if (acceptedKeys.has(key.toLowerCase().replace(/[-_]/g, "")) && substantiveTrajectoryValue(entry, minimumLength)) return true;
    if (hasMeaningfulTrajectoryKey(entry, acceptedKeys, minimumLength)) return true;
  }
  return false;
}

/** @throws {never} */
export function hasTrajectorySemantics(value: unknown): boolean {
  return (
    hasMeaningfulTrajectoryKey(value, new Set(["provider"]), 4) &&
    hasMeaningfulTrajectoryKey(value, new Set(["model", "modelid"]), 4) &&
    hasMeaningfulTrajectoryKey(value, new Set(["input", "messages", "prompt", "request"]), 8) &&
    hasMeaningfulTrajectoryKey(value, new Set(["completion", "events", "output", "response", "steps"]), 8)
  );
}

function boundRowBlock(block: string): string {
  const lines = block.split(/\r?\n/);
  const out: string[] = [];
  let started = false;
  let detailsDepth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
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
      if (next !== undefined && /^<details\b/i.test(next.trim())) {
        out.push(line);
        continue;
      }
      break;
    }
    if (detailsDepth === 0 && /^#/.test(trimmed)) break;
    if (/<!--\s*evidence-row:/i.test(trimmed)) break;
    if (detailsDepth === 0 && /^[-*]\s/.test(line) && !/^\s/.test(line)) break;
    out.push(line);
    detailsDepth += (line.match(/<details\b/gi) ?? []).length;
    detailsDepth -= (line.match(/<\/details>/gi) ?? []).length;
    detailsDepth = Math.max(0, detailsDepth);
  }
  return out.join("\n").trim();
}

function extractEvidenceRows(body: string): ReadonlyMap<string, string> {
  const rows = new Map<string, string>();
  const markers = [...body.matchAll(markerPattern)].map((match) => ({
    id: (match[1] ?? "").toLowerCase(),
    start: match.index,
    end: match.index + match[0].length,
  }));
  markers.forEach((current, index) => {
    const rowText = boundRowBlock(body.slice(current.end, markers[index + 1]?.start ?? body.length));
    if (!rows.has(current.id) || rowText.length > 0) rows.set(current.id, rowText);
  });
  return rows;
}

function expectedArtifactKind(rowId: string, artifact: TrustedArtifact, rowText: string): ExpectedKind | null {
  if (rowId === "before-screenshots" || rowId === "after-screenshots") return "image";
  if (rowId === "walkthrough-video") return "video";
  if (rowId === surfaceOcrEvidenceRow.id) return "document";
  if (rowId === "backend-logs" || rowId === "frontend-logs" || rowId === "llm-trajectory") return "document";
  if (rowId === "domain-artifacts" && ocrEvidencePattern.test(rowText) && artifactCanBeEvidenceFile(artifact)) return "document";
  if (imageExtensions.has(artifact.extension)) return "image";
  if (videoExtensions.has(artifact.extension)) return "video";
  if (evidenceFileExtensions.has(artifact.extension)) return "document";
  if (artifact.presentation === "image") return "image";
  if (artifact.presentation === "video") return "video";
  return null;
}

function rowArtifacts(selection: Selection, rowText: string): ReadonlyArray<TrustedArtifact> {
  return trustedArtifacts(rowText, selection.repositories).filter((artifact) => !selection.uploadsOnly || artifact.kind === "opaque-upload");
}

/** @throws {never} */
export function planCounts(selection: Selection): { readonly referenceCount: number; readonly uniqueArtifactCount: number } {
  const rows = extractEvidenceRows(selection.body);
  const identities = new Set<string>();
  let referenceCount = 0;
  for (const { id } of selection.rows) {
    const rowText = rows.get(id);
    if (rowText === undefined) continue;
    const artifacts = rowArtifacts(selection, rowText);
    referenceCount += artifacts.length;
    for (const artifact of artifacts) identities.add(artifact.identity);
  }
  return { referenceCount, uniqueArtifactCount: identities.size };
}

/** @throws {never} */
export function planArtifacts(selection: Selection): Planned {
  const rows = extractEvidenceRows(selection.body);
  const references: Reference[] = [];
  const unique = new Map<string, Reference>();
  const limits: LimitFinding[] = [];
  for (const { id, label } of selection.rows) {
    const rowText = rows.get(id);
    if (rowText === undefined) continue;
    const artifacts = rowArtifacts(selection, rowText);
    if (artifacts.length > maxArtifactsPerRow) {
      limits.push({
        id,
        label,
        url: "(artifact count)",
        status: "artifact-limit-exceeded",
        detail: `row references ${artifacts.length} artifacts; maximum is ${maxArtifactsPerRow}`,
      });
    }
    for (const artifact of artifacts) {
      const reference = { ...artifact, expectedKind: expectedArtifactKind(id, artifact, rowText), id, label };
      references.push(reference);
      if (!unique.has(artifact.identity)) unique.set(artifact.identity, reference);
    }
  }
  const byIdentity = Map.groupBy(references, (reference) => reference.identity);
  for (const uses of byIdentity.values()) {
    const rowIds = new Set(uses.map(({ id }) => id));
    if (rowIds.size < 2) continue;
    const kinds = new Set(uses.map(({ expectedKind }) => expectedKind ?? "unspecified"));
    for (const use of uses) {
      limits.push({
        id: use.id,
        label: use.label,
        url: use.url,
        status: "artifact-conflict",
        detail: `artifact is reused by ${[...rowIds].join(", ")} with expected kinds ${[...kinds].join(", ")}`,
      });
    }
  }
  const artifacts = [...unique.values()];
  if (artifacts.length > maxArtifactsTotal) {
    const first = references[0];
    limits.push({
      id: first?.id ?? selection.rows[0]?.id ?? "evidence",
      label: first?.label ?? selection.rows[0]?.label ?? "Referenced evidence artifacts",
      url: "(artifact count)",
      status: "artifact-limit-exceeded",
      detail: `PR references ${artifacts.length} unique artifacts; maximum is ${maxArtifactsTotal}`,
    });
  }
  return { references, artifacts, limits };
}
