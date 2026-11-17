// spec/backend/readyLabelSettings.md, "Ready-label settings are bounded, off when absent or disabled, and only add protected paths"
import {
  defaultApprovals,
  defaultMaxChangedFiles,
  defaultMaxChangedLines,
  maxApprovals,
  maxChangedFilesLimit,
  maxChangedLinesLimit,
  maxProtectedPathLength,
  maxProtectedPaths,
  minApprovals,
  minChangedFiles,
  minChangedLines,
  type ProtectedPath,
  presentSetting,
  type ReadyLabelConfig,
  type ReadyLabelSetting,
  readyLabelOn as settingOn,
  readyLabelValid,
} from "../../../gen/backend__readyLabelSettings.ts";

export { type ProtectedPath, presentSetting, type ReadyLabelConfig, type ReadyLabelSetting, readyLabelValid } from "../../../gen/backend__readyLabelSettings.ts";

export interface ReadyLabelSettings {
  readonly enabled: boolean;
  readonly approvals: number;
  readonly maxChangedLines: number;
  readonly maxChangedFiles: number;
  readonly protectedPaths: ReadonlyArray<string>;
}

export const readyLabelLimits = Object.freeze({
  minApprovals,
  maxApprovals,
  minChangedLines,
  maxChangedLines: maxChangedLinesLimit,
  minChangedFiles,
  maxChangedFiles: maxChangedFilesLimit,
  maxProtectedPaths,
  maxProtectedPathLength,
});

export const readyLabelDefaults = Object.freeze({
  approvals: defaultApprovals,
  maxChangedLines: defaultMaxChangedLines,
  maxChangedFiles: defaultMaxChangedFiles,
});

const settingKeys = "approvals,enabled,maxChangedFiles,maxChangedLines,protectedPaths";
const patternCharacters = /^[A-Za-z0-9._\-/*@+]+$/u;

type Counted = "approvals" | "maxChangedLines" | "maxChangedFiles";

const countBounds: ReadonlyArray<readonly [Counted, number, number]> = [
  ["approvals", minApprovals, maxApprovals],
  ["maxChangedLines", minChangedLines, maxChangedLinesLimit],
  ["maxChangedFiles", minChangedFiles, maxChangedFilesLimit],
];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @throws {never} */
export function protectedPathProblem(pattern: unknown): string | null {
  if (typeof pattern !== "string" || pattern.length === 0) return "Enter a path.";
  if (pattern.length > maxProtectedPathLength) return `Use at most ${maxProtectedPathLength} characters.`;
  if (!patternCharacters.test(pattern)) return "Use letters, digits, '.', '_', '-', '/', '*', '@' or '+' only.";
  if (pattern.startsWith("/") || pattern.includes("//")) return "Write the path relative to the repository root.";
  if (pattern.split("/").some((segment) => segment === ".." || segment === ".")) return "Do not use '.' or '..' segments.";
  if (/\*{3,}/u.test(pattern)) return "Use '*' or '**' only.";
  return null;
}

/** @throws {never} */
export function protectedPathOf(pattern: string): ProtectedPath {
  return { pattern, length: pattern.length, wellFormed: protectedPathProblem(pattern) === null };
}

function configOf(value: unknown): ReadyLabelConfig | undefined {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== settingKeys) return undefined;
  const { enabled, approvals, maxChangedLines, maxChangedFiles, protectedPaths } = value;
  if (typeof enabled !== "boolean" || !Array.isArray(protectedPaths)) return undefined;
  if (![approvals, maxChangedLines, maxChangedFiles].every(Number.isSafeInteger)) return undefined;
  if (!protectedPaths.every((pattern): pattern is string => typeof pattern === "string")) return undefined;
  return { enabled, approvals: Number(approvals), maxChangedLines: Number(maxChangedLines), maxChangedFiles: Number(maxChangedFiles), protectedPaths: protectedPaths.map(protectedPathOf) };
}

function firstProblem(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) return `${field} must be an object`;
  if (Object.keys(value).sort().join(",") !== settingKeys) return `${field} has unexpected or missing fields`;
  if (typeof value.enabled !== "boolean") return `${field}.enabled must be a boolean`;
  for (const [name, min, max] of countBounds) {
    const count = value[name];
    if (!Number.isSafeInteger(count) || Number(count) < min || Number(count) > max) return `${field}.${name} must be a whole number from ${min} to ${max}`;
  }
  const paths = value.protectedPaths;
  if (!Array.isArray(paths) || paths.length > maxProtectedPaths) return `${field}.protectedPaths must list at most ${maxProtectedPaths} paths`;
  const seen = new Set<unknown>();
  for (const pattern of paths) {
    const problem = protectedPathProblem(pattern);
    if (problem !== null) return `${field}.protectedPaths entry is invalid: ${problem}`;
    if (seen.has(pattern)) return `${field}.protectedPaths repeats ${String(pattern)}`;
    seen.add(pattern);
  }
  return undefined;
}

/** @throws {never} */
export function readyLabelProblem(value: unknown, field: string): string | undefined {
  const config = configOf(value);
  if (config !== undefined && readyLabelValid(presentSetting(config))) return undefined;
  return firstProblem(value, field) ?? `${field} is invalid`;
}

function savedValue(manifest: unknown): unknown {
  const slopbot = isRecord(manifest) ? manifest.slopbot : undefined;
  return isRecord(slopbot) ? slopbot.readyLabel : undefined;
}

/** @throws {never} */
export function readyLabelSetting(manifest: unknown): ReadyLabelSetting {
  const config = configOf(savedValue(manifest));
  const setting = config === undefined ? undefined : presentSetting(config);
  return setting !== undefined && readyLabelValid(setting) ? setting : { tag: "ReadyLabelAbsent" };
}

/** @throws {never} */
export function readyLabelOn(manifest: unknown): ReadyLabelConfig | null {
  const setting = readyLabelSetting(manifest);
  return setting.tag === "ReadyLabelPresent" && settingOn(setting) ? { enabled: setting.enabled, approvals: setting.approvals, maxChangedLines: setting.maxChangedLines, maxChangedFiles: setting.maxChangedFiles, protectedPaths: setting.protectedPaths } : null;
}

/** @throws {never} */
export function readyLabelSettingsOf(config: ReadyLabelConfig): ReadyLabelSettings {
  return { enabled: config.enabled, approvals: config.approvals, maxChangedLines: config.maxChangedLines, maxChangedFiles: config.maxChangedFiles, protectedPaths: config.protectedPaths.map((path) => path.pattern) };
}
