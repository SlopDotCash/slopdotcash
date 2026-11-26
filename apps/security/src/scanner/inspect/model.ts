// spec/security/admission.md, "Every reviewed batch covers the next unreviewed inventory entries"
import type { ImageFormat } from "./images.ts";

export const SCAN_SURFACES = ["source", "manifests", "dependencies", "installScripts", "downloads", "agentInstructions"] as const;
export type ScanSurface = (typeof SCAN_SURFACES)[number];

export const SCAN_THREATS = ["wallet-drainer", "credential-theft", "secret-exfiltration", "unsafe-execution", "prompt-injection"] as const;
export type ScanThreat = (typeof SCAN_THREATS)[number];

export type ArtifactType = "binary" | "archive" | "obfuscated-script" | "native-module" | "wasm" | "bytecode" | "second-stage" | "other";
export type ArtifactState = "quarantined" | "released" | "blocked";
export type ArtifactAnalysis = "pending" | "static-clean" | "detonation-clean" | "suspicious" | "malicious";

export interface VettingArtifact {
  readonly sha256: string;
  readonly parentSha256: string | null;
  readonly origin: "repository" | "archive";
  readonly path: string;
  readonly type: ArtifactType;
  readonly state: ArtifactState;
  readonly analysis: ArtifactAnalysis;
  readonly requestedExecution: boolean;
}

export interface SymlinkProvenance {
  readonly gitSha: string;
  readonly sha256: string;
  readonly target: string;
  readonly resolvedPath: string;
  readonly targetSha256: string;
}

export interface ScanInputFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly logicalPath?: string;
  readonly parentArtifactSha256?: string;
  readonly symlink?: SymlinkProvenance;
  readonly templateInput?: true;
}

export interface ScanFinding {
  readonly severity: "medium" | "high";
  readonly category: ScanThreat;
  readonly summary: string;
  readonly evidence: string;
  readonly path: string;
}

export type SurfaceState = "complete" | "partial" | "unsupported";
export type CheckState = "passed" | "flagged" | "not-run";
export type Coverage = Readonly<Record<ScanSurface, { readonly state: SurfaceState; readonly items: number }>>;
export type Checks = Readonly<Record<ScanThreat, CheckState>>;

export type BulkClass = "lockfile" | "data" | "generated" | "vendored";

export interface MediaRecord {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly format: ImageFormat;
}

export interface DeterministicRecord {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly class: BulkClass | "template";
  readonly signals?: true;
}

export interface InventoryItem {
  readonly id: string;
  readonly text: string;
  readonly sha256: string;
}

export interface Classification {
  readonly path: string;
  readonly surfaces: ReadonlyArray<ScanSurface>;
}

export interface RepositoryInspection {
  readonly inventory: Uint8Array;
  readonly inventorySha256: string;
  readonly classifications: ReadonlyArray<Classification>;
  readonly items: ReadonlyArray<InventoryItem>;
  readonly coverage: Coverage;
  readonly checks: Checks;
  readonly findings: ReadonlyArray<ScanFinding>;
  readonly artifacts: ReadonlyArray<VettingArtifact>;
  readonly derivedFiles: ReadonlyArray<ScanInputFile>;
  readonly dependencyLocks: ReadonlyArray<{ readonly path: string; readonly sha256: string }>;
  readonly visibilityGaps: ReadonlyArray<string>;
  readonly downloads: ReadonlyArray<string>;
  readonly deterministic: ReadonlyArray<DeterministicRecord>;
  readonly media: ReadonlyArray<MediaRecord>;
  readonly riskSignals: ReadonlyArray<string>;
}
