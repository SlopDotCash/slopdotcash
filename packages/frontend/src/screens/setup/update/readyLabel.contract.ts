// spec/frontend/readyLabelForm.md, "The control starts off with the defaults when nothing is saved, saves only bounded settings while on, and keeps the owner's numbers when turned off"
import { vectors } from "../../../kernels/vectors.ts";
import { countOf, draftOf, initialReadyDraft, nextReadyLabel, pathsOf, type ReadyDraft, readyErrors } from "./readyLabel.ts";

const off = initialReadyDraft(undefined);
const on: ReadyDraft = { ...off, readyLabel: "true" };
const saved = { enabled: true, approvals: 2, maxChangedLines: 300, maxChangedFiles: 12, protectedPaths: ["docs/legal/"] };

export const aNumberFieldReadsAsAWholeNumberOfAtMostSixDigitsElseZero = vectors<string, number>(
  [
    ["7", 7],
    [" 12 ", 12],
    ["999999", 999_999],
    ["1000000", 0],
    ["1.5", 0],
    ["-3", 0],
    ["1e3", 0],
    ["", 0],
    ["ten", 0],
  ],
  countOf,
);

export const thePathsFieldIsTrimmedWithoutBlanksOrRepeats = vectors<string, ReadonlyArray<string>>(
  [
    ["", []],
    [" *.sql \n\n*.sql\ndocs/legal/\n  ", ["*.sql", "docs/legal/"]],
    ["a/\r\nb/", ["a/", "b/"]],
  ],
  pathsOf,
);

export const theFormStartsOffWithOneApproval400LinesAnd20Files = vectors<ReadyDraft, unknown>(
  [
    [off, { enabled: false, approvals: 1, maxChangedLines: 400, maxChangedFiles: 20, protectedPaths: [] }],
    [{ ...on, readyApprovals: "x", readyProtectedPaths: "/etc" }, { enabled: true, approvals: 0, maxChangedLines: 400, maxChangedFiles: 20, protectedPaths: [{ pattern: "/etc", length: 4, wellFormed: false }] }],
  ],
  draftOf,
);

export const aCheckedFieldOutOfBoundsSaysItsRangeOrItsFirstBadPath = vectors<Partial<ReadyDraft>, unknown>(
  [
    [{}, {}],
    [{ readyApprovals: "11" }, { readyApprovals: "Enter a whole number from 1 to 10." }],
    [{ readyMaxLines: "0", readyMaxFiles: "301" }, { readyMaxLines: "Enter a whole number from 1 to 5000.", readyMaxFiles: "Enter a whole number from 1 to 300." }],
    [{ readyProtectedPaths: "docs/\n../secret\n/etc" }, { readyProtectedPaths: "../secret: Do not use '.' or '..' segments." }],
    [{ readyProtectedPaths: Array.from({ length: 51 }, (_, index) => `p${index}/`).join("\n") }, { readyProtectedPaths: "List at most 50 paths." }],
    [{ readyLabel: "false", readyApprovals: "11", readyProtectedPaths: "/etc" }, {}],
  ],
  (fields) => readyErrors({ ...on, ...fields }),
);

export const turningTheLabelOffKeepsTheLastSavedNumbersAndANeverSavedProjectKeepsNone = vectors<readonly [Partial<ReadyDraft>, typeof saved | undefined], unknown>(
  [
    [[{ readyLabel: "false", readyApprovals: "5" }, saved], { ...saved, enabled: false }],
    [[{ readyLabel: "false", readyApprovals: "5" }, undefined], null],
    [[{ readyApprovals: "3" }, undefined], { enabled: true, approvals: 3, maxChangedLines: 400, maxChangedFiles: 20, protectedPaths: [] }],
    [[{ readyApprovals: "11" }, saved], saved],
  ],
  ([fields, prior]) => nextReadyLabel({ ...on, ...fields }, prior) ?? null,
);
