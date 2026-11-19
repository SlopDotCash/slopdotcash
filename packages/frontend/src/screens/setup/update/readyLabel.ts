// spec/frontend/readyLabelForm.md, "The control starts off with the defaults when nothing is saved, saves only bounded settings while on, and keeps the owner's numbers when turned off"; spec/backend/readyLabelSettings.md, "Ready-label settings are bounded, off when absent or disabled, and only add protected paths"
import { protectedPathOf, protectedPathProblem, type ReadyLabelConfig, readyLabelLimits, readyLabelOn, readyLabelSetting, readyLabelSettingsOf, type ReadyLabelSettings } from "@repo/backend/client";
import { draftSavable, formDefaults, formStart, savedReadyLabel } from "../../../../gen/frontend__readyLabelForm.ts";

export type ReadyField = "readyLabel" | "readyApprovals" | "readyMaxLines" | "readyMaxFiles" | "readyProtectedPaths";

export type ReadyDraft = Readonly<Record<ReadyField, string>>;

export type ReadyErrors = Readonly<Partial<Record<ReadyField, string>>>;

export const readyFields: ReadonlyArray<ReadyField> = ["readyLabel", "readyApprovals", "readyMaxLines", "readyMaxFiles", "readyProtectedPaths"];

const wholeNumber = /^\d{1,6}$/u;

/** A number field as the form reads it: a whole number of at most six digits, any other text 0. @throws {never} */
export function countOf(text: string): number {
  const trimmed = text.trim();
  return wholeNumber.test(trimmed) ? Number(trimmed) : 0;
}

/** The paths field one per line, trimmed, without blanks or repeats. @throws {never} */
export function pathsOf(text: string): ReadonlyArray<string> {
  return [...new Set(text.split("\n").map((line) => line.trim()).filter((line) => line !== ""))];
}

/** The form's fields as the setting they describe. @throws {never} */
export function draftOf(value: ReadyDraft): ReadyLabelConfig {
  return {
    enabled: value.readyLabel === "true",
    approvals: countOf(value.readyApprovals),
    maxChangedLines: countOf(value.readyMaxLines),
    maxChangedFiles: countOf(value.readyMaxFiles),
    protectedPaths: pathsOf(value.readyProtectedPaths).map(protectedPathOf),
  };
}

function configOf(settings: ReadyLabelSettings): ReadyLabelConfig {
  return { ...settings, protectedPaths: settings.protectedPaths.map(protectedPathOf) };
}

function fieldsOf(config: ReadyLabelConfig): ReadyDraft {
  return {
    readyLabel: String(config.enabled),
    readyApprovals: String(config.approvals),
    readyMaxLines: String(config.maxChangedLines),
    readyMaxFiles: String(config.maxChangedFiles),
    readyProtectedPaths: config.protectedPaths.map((path) => path.pattern).join("\n"),
  };
}

/** The saved ready-label setting of a manifest, when it is a valid one. @throws {never} */
export function savedReadySettings(manifest: unknown): ReadyLabelSettings | undefined {
  const setting = readyLabelSetting(manifest);
  return setting.tag === "ReadyLabelPresent" ? readyLabelSettingsOf(setting) : undefined;
}

/** The form as the saved setting fills it, else off with the default bounds. @throws {never} */
export function initialReadyDraft(saved: ReadyLabelSettings | undefined): ReadyDraft {
  return fieldsOf(formStart(saved !== undefined, saved ? configOf(saved) : formDefaults));
}

/** The setting a publish saves; a form that cannot be saved keeps what was saved. @throws {never} */
export function nextReadyLabel(value: ReadyDraft, saved: ReadyLabelSettings | undefined): ReadyLabelSettings | undefined {
  const draft = draftOf(value);
  if (!draftSavable(draft)) return saved;
  const setting = savedReadyLabel(saved !== undefined, saved ? configOf(saved) : formDefaults, draft);
  return setting.tag === "ReadyLabelPresent" ? readyLabelSettingsOf(setting) : undefined;
}

function rangeError(count: number, minimum: number, maximum: number): string | undefined {
  return count >= minimum && count <= maximum ? undefined : `Enter a whole number from ${minimum} to ${maximum}.`;
}

function pathsProblem(paths: ReadonlyArray<string>): string | undefined {
  if (paths.length > readyLabelLimits.maxProtectedPaths) return `List at most ${readyLabelLimits.maxProtectedPaths} paths.`;
  return paths.flatMap((path) => {
    const problem = protectedPathProblem(path);
    return problem === null ? [] : [`${path}: ${problem}`];
  })[0];
}

/** What blocks the save: nothing while the form can be saved, else each field's range or its first bad path. @throws {never} */
export function readyErrors(value: ReadyDraft): ReadyErrors {
  const draft = draftOf(value);
  if (draftSavable(draft)) return {};
  const limits = readyLabelLimits;
  const found: ReadonlyArray<readonly [ReadyField, string | undefined]> = [
    ["readyApprovals", rangeError(draft.approvals, limits.minApprovals, limits.maxApprovals)],
    ["readyMaxLines", rangeError(draft.maxChangedLines, limits.minChangedLines, limits.maxChangedLines)],
    ["readyMaxFiles", rangeError(draft.maxChangedFiles, limits.minChangedFiles, limits.maxChangedFiles)],
    ["readyProtectedPaths", pathsProblem(draft.protectedPaths.map((path) => path.pattern))],
  ];
  return Object.fromEntries(found.filter((entry): entry is readonly [ReadyField, string] => entry[1] !== undefined));
}

/** A manifest's ready label as the review shows it. @throws {never} */
export function readySummary(manifest: unknown): string {
  const settings = readyLabelOn(manifest);
  if (settings === null) return "Off";
  const extra = settings.protectedPaths.length;
  const approvals = `${settings.approvals} approval${settings.approvals === 1 ? "" : "s"}`;
  return `On: ${approvals}, at most ${settings.maxChangedLines} lines in ${settings.maxChangedFiles} files${extra ? `, ${extra} extra protected path${extra === 1 ? "" : "s"}` : ""}`;
}
