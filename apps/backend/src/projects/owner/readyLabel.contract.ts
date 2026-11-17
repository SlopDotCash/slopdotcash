// spec/backend/readyLabelSettings.md, "Ready-label settings are bounded, off when absent or disabled, and only add protected paths"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { presentSetting, protectedPathOf, protectedPathProblem, readyLabelOn, readyLabelProblem, readyLabelSetting, readyLabelValid, type ReadyLabelSettings } from "./readyLabel.ts";

const field = "project.slopbot.readyLabel";
const base: ReadyLabelSettings = { enabled: true, approvals: 1, maxChangedLines: 400, maxChangedFiles: 20, protectedPaths: ["deploy/**"] };
const paths = (count: number) => Array.from({ length: count }, (_, index) => `generated/${index}/**`);
const long = (length: number) => "a".repeat(length);

function exactly<I, O>(cases: ReadonlyArray<readonly [I, O]>, run: (input: I) => O) {
  return contract({
    input: Arbitrary.Constant(cases),
    run: (all) => all.map(([input]) => run(input)),
    invariant: (all, outcomes) => all.every(([, expected], index) => outcomes[index] === expected),
  });
}

export const protectedPathsKeepTheOldReasons = exactly<unknown, string | null>([
  ["deploy/**", null],
  ["src/@scope/+file.ts", null],
  [long(200), null],
  ["", "Enter a path."],
  [7, "Enter a path."],
  [long(201), "Use at most 200 characters."],
  ["src/ file", "Use letters, digits, '.', '_', '-', '/', '*', '@' or '+' only."],
  ["/x", "Write the path relative to the repository root."],
  ["//x", "Write the path relative to the repository root."],
  ["a//b", "Write the path relative to the repository root."],
  [".", "Do not use '.' or '..' segments."],
  ["..", "Do not use '.' or '..' segments."],
  ["src/../secrets", "Do not use '.' or '..' segments."],
  ["a***", "Use '*' or '**' only."],
], protectedPathProblem);

export const settingsAreRefusedWithTheFirstOldMessage = exactly<unknown, string | undefined>([
  [base, undefined],
  [{ ...base, enabled: false }, undefined],
  [{ ...base, approvals: 10, maxChangedLines: 5000, maxChangedFiles: 300, protectedPaths: paths(50) }, undefined],
  [{ ...base, approvals: 1, maxChangedLines: 1, maxChangedFiles: 1, protectedPaths: [] }, undefined],
  [{ ...base, protectedPaths: [long(200)] }, undefined],
  [null, `${field} must be an object`],
  [[], `${field} must be an object`],
  [{ ...base, extra: true }, `${field} has unexpected or missing fields`],
  [{ enabled: true, approvals: 1, maxChangedLines: 400, maxChangedFiles: 20 }, `${field} has unexpected or missing fields`],
  [{ ...base, enabled: "yes" }, `${field}.enabled must be a boolean`],
  [{ ...base, approvals: 0 }, `${field}.approvals must be a whole number from 1 to 10`],
  [{ ...base, approvals: 11 }, `${field}.approvals must be a whole number from 1 to 10`],
  [{ ...base, approvals: 1.5 }, `${field}.approvals must be a whole number from 1 to 10`],
  [{ ...base, approvals: 11, protectedPaths: "deploy" }, `${field}.approvals must be a whole number from 1 to 10`],
  [{ ...base, maxChangedLines: 0 }, `${field}.maxChangedLines must be a whole number from 1 to 5000`],
  [{ ...base, maxChangedLines: 5001 }, `${field}.maxChangedLines must be a whole number from 1 to 5000`],
  [{ ...base, maxChangedFiles: 0 }, `${field}.maxChangedFiles must be a whole number from 1 to 300`],
  [{ ...base, maxChangedFiles: 301 }, `${field}.maxChangedFiles must be a whole number from 1 to 300`],
  [{ ...base, protectedPaths: "deploy/**" }, `${field}.protectedPaths must list at most 50 paths`],
  [{ ...base, protectedPaths: paths(51) }, `${field}.protectedPaths must list at most 50 paths`],
  [{ ...base, protectedPaths: [long(201)] }, `${field}.protectedPaths entry is invalid: Use at most 200 characters.`],
  [{ ...base, protectedPaths: ["."] }, `${field}.protectedPaths entry is invalid: Do not use '.' or '..' segments.`],
  [{ ...base, protectedPaths: [".."] }, `${field}.protectedPaths entry is invalid: Do not use '.' or '..' segments.`],
  [{ ...base, protectedPaths: ["//x"] }, `${field}.protectedPaths entry is invalid: Write the path relative to the repository root.`],
  [{ ...base, protectedPaths: ["/x"] }, `${field}.protectedPaths entry is invalid: Write the path relative to the repository root.`],
  [{ ...base, protectedPaths: ["a***"] }, `${field}.protectedPaths entry is invalid: Use '*' or '**' only.`],
  [{ ...base, protectedPaths: [3] }, `${field}.protectedPaths entry is invalid: Enter a path.`],
  [{ ...base, protectedPaths: ["deploy/**", "deploy/**"] }, `${field}.protectedPaths repeats deploy/**`],
], (value) => readyLabelProblem(value, field));

export const theLabelIsOnOnlyForAValidEnabledSetting = exactly<unknown, boolean>([
  [{}, false],
  [{ slopbot: { automaticClosure: true } }, false],
  [{ slopbot: { automaticClosure: false, readyLabel: base } }, true],
  [{ slopbot: { automaticClosure: false, readyLabel: { ...base, enabled: false } } }, false],
  [{ slopbot: { automaticClosure: false, readyLabel: { ...base, approvals: 11 } } }, false],
], (manifest) => readyLabelOn(manifest) !== null);

const candidates = Arbitrary.schema(
  Schema.Struct({
    enabled: Schema.Boolean,
    approvals: Schema.Literals([0, 1, 10, 11]),
    maxChangedLines: Schema.Literals([0, 1, 5000, 5001]),
    maxChangedFiles: Schema.Literals([0, 1, 300, 301]),
    protectedPaths: Schema.Array(Schema.Literals(["deploy/**", "src/@scope/*", "", ".", "/x", "a***", long(200), long(201)])),
  }),
);

export const theMessageAgreesWithTheSpecVerdict = contract({
  input: candidates,
  run: (settings: ReadyLabelSettings) => readyLabelProblem(settings, field),
  deterministic: true,
  invariant: (settings, problem) =>
    (problem === undefined) === readyLabelValid(presentSetting({ ...settings, protectedPaths: settings.protectedPaths.map(protectedPathOf) })),
});

export const aSavedSettingReadsBackAsItWasWritten = contract({
  input: candidates,
  run: (settings: ReadyLabelSettings) => readyLabelSetting({ slopbot: { automaticClosure: false, readyLabel: settings } }),
  invariant: (settings, setting) =>
    readyLabelProblem(settings, field) === undefined
      ? setting.tag === "ReadyLabelPresent" && setting.approvals === settings.approvals && setting.protectedPaths.map((path) => path.pattern).join("\n") === settings.protectedPaths.join("\n")
      : setting.tag === "ReadyLabelAbsent",
});
