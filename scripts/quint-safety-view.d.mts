import type {
  TlcConfig,
  verify as verifyTlc,
} from "@informalsystems/quint/dist/src/tlc.js";

export interface SafetyViewExpression {
  name: string;
  expression: string;
}

export interface SafetyViewDefinition {
  id: string;
  model: string;
  module: string;
  operator: string;
  sourceSha256: string;
  translatedSha256: string;
  viewTlaSha256: string;
  hashMode: string;
  memoryCandidateMode: string;
  fields: SafetyViewExpression[];
  clauses: SafetyViewExpression[];
}

export interface SafetyViewManifest {
  schemaVersion: number;
  quintAdapterSha256: string;
  views: SafetyViewDefinition[];
}

export type SafetyViewEvidence = Omit<SafetyViewDefinition, "module">;

export function readSafetyViews(root: string): SafetyViewManifest;
export function bindSafetyView(
  manifest: SafetyViewManifest,
  id: string,
  model: string,
  source: string,
): SafetyViewDefinition;
export function applySafetyView<T extends TlcConfig>(
  view: SafetyViewDefinition,
  config: T,
): T & { slopSafetyView: string; viewEvidence: SafetyViewEvidence };
export function patchTlcConfig(source: string, expectedSha256: string): string;
export function loadSafetyViewTlc(
  adapterPath: string,
  manifest: SafetyViewManifest,
): { verify: typeof verifyTlc; adapterSha256: string; overlaySha256: string };
