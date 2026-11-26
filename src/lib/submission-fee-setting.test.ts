// The owner's submission fee setting (operator decision, 18 November 2026;
// PRD section 5): what the project record accepts, what an owner may change
// through self-service, and what the settings page reads from a typed amount.

import { expect, test } from "bun:test";
import { classifyRevisionChanges } from "./project-revision-changes";
import { assertProjectDefinition } from "./project-schema.mjs";
import { findProject } from "./projects.mjs";
import { standingDepositsAccepted } from "./standing-deposit.mjs";
import {
  SUBMISSION_FEE_DEFAULT_MINOR,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_MAX_MINOR,
  SUBMISSION_FEE_MIN_MINOR,
  submissionFeeItem,
} from "./submission-fee.mjs";
import {
  assertSubmissionFeeSetting,
  SUBMISSION_FEE_HINT,
  SUBMISSION_FEE_SETTING_LIMITS,
  submissionFeeAmountDraft,
  submissionFeeAmountText,
  submissionFeeSetting,
} from "./submission-fee-setting.mjs";

function project(submissionFee?: unknown) {
  const original = findProject("asi");
  if (!original) throw new Error("Missing registry fixture");
  return assertProjectDefinition({
    ...original,
    ...(submissionFee === undefined
      ? {}
      : { slopbot: { automaticClosure: false, submissionFee } }),
  });
}

test("the setting's limits are the shared constants, and the schema needs no package", async () => {
  expect(SUBMISSION_FEE_SETTING_LIMITS).toEqual({
    defaultMinor: SUBMISSION_FEE_DEFAULT_MINOR,
    minMinor: SUBMISSION_FEE_MIN_MINOR,
    maxMinor: SUBMISSION_FEE_MAX_MINOR,
  });
  // Release tooling loads the project schema without installed packages.
  const source = await Bun.file(
    new URL("./submission-fee-setting.mjs", import.meta.url),
  ).text();
  expect(source).not.toMatch(/^\s*import\s/mu);
});

test("absent or off asks nothing; on asks the stored amount or the default", () => {
  expect(submissionFeeSetting(project())).toBeNull();
  expect(submissionFeeSetting(project({ enabled: false }))).toBeNull();
  expect(
    submissionFeeSetting(project({ enabled: false, amountMinor: "3000000" })),
  ).toBeNull();
  expect(submissionFeeSetting(project({ enabled: true }))).toEqual({
    amountMinor: SUBMISSION_FEE_DEFAULT_MINOR,
  });
  expect(
    submissionFeeSetting(project({ enabled: true, amountMinor: "3500000" })),
  ).toEqual({ amountMinor: "3500000" });
  expect(submissionFeeSetting(null)).toBeNull();
});

test("the project record refuses an amount outside the range and unknown fields", () => {
  for (const amountMinor of [
    SUBMISSION_FEE_MIN_MINOR,
    SUBMISSION_FEE_MAX_MINOR,
  ])
    expect(() => project({ enabled: true, amountMinor })).not.toThrow();
  for (const setting of [
    { enabled: true, amountMinor: "999999" },
    { enabled: true, amountMinor: "10000001" },
    { enabled: true, amountMinor: "0" },
    { enabled: true, amountMinor: "02000000" },
    { enabled: true, amountMinor: "2e6" },
    { enabled: true, amountMinor: 2_000_000 },
    { enabled: true, amountMinor: "-2000000" },
    { enabled: "true" },
    { amountMinor: "2000000" },
    { enabled: true, token: "slop" },
    [],
    null,
    true,
  ])
    expect(() => project(setting)).toThrow(/project\.slopbot\.submissionFee/u);
  expect(() =>
    assertSubmissionFeeSetting({ enabled: true }, "setting"),
  ).not.toThrow();
});

test("an owner changes the setting through self-service; nothing else moves", () => {
  const off = project();
  const on = project({ enabled: true });
  const priced = project({ enabled: true, amountMinor: "5000000" });
  for (const [before, after] of [
    [off, on],
    [on, priced],
    [priced, project({ enabled: false, amountMinor: "5000000" })],
  ] as const) {
    const changes = classifyRevisionChanges(before, after);
    expect(changes.presentation).toEqual(["slopbot"]);
    expect(changes.restricted).toEqual([]);
    expect(changes.executable).toEqual([]);
    expect(changes.financial).toEqual([]);
  }
  // A stored setting outside the current range reads as off, not as another amount.
  expect(
    submissionFeeSetting({
      slopbot: { submissionFee: { enabled: true, amountMinor: "50000000" } },
    }),
  ).toBeNull();
});

test("standing deposits: absent accepts, only false refuses, and the record keeps it", () => {
  // Operator decision, 23 November 2026 (PRD section 5, "Standing deposit").
  expect(standingDepositsAccepted(project({ enabled: true }))).toBe(true);
  expect(standingDepositsAccepted(project())).toBe(true);
  for (const setting of [
    { enabled: true, standingDeposits: false },
    { enabled: false, standingDeposits: false },
    { enabled: true, amountMinor: "3000000", standingDeposits: false },
  ] as const) {
    const refused = project(setting);
    expect(refused.slopbot?.submissionFee).toEqual(setting);
    expect(standingDepositsAccepted(refused)).toBe(false);
  }
  // The fee itself reads the same with or without the refusal.
  expect(
    submissionFeeSetting(
      project({
        enabled: true,
        amountMinor: "3000000",
        standingDeposits: false,
      }),
    ),
  ).toEqual({ amountMinor: "3000000" });
  for (const setting of [
    { enabled: true, standingDeposits: true },
    { enabled: true, standingDeposits: "false" },
    { enabled: true, standingDeposits: null },
    { standingDeposits: false },
  ])
    expect(() => project(setting)).toThrow(/project\.slopbot\.submissionFee/u);
  // The owner changes it through self-service, like the amount.
  const changes = classifyRevisionChanges(
    project({ enabled: true }),
    project({ enabled: true, standingDeposits: false }),
  );
  expect(changes.presentation).toEqual(["slopbot"]);
  expect(changes.financial).toEqual([]);
  expect(changes.restricted).toEqual([]);
});

test("a typed amount becomes base units; anything else is refused with the range", () => {
  expect(submissionFeeAmountDraft("2")).toEqual({
    amountMinor: "2000000",
    error: undefined,
  });
  expect(submissionFeeAmountDraft(" $2.5 ").amountMinor).toBe("2500000");
  expect(submissionFeeAmountDraft("10.00").amountMinor).toBe("10000000");
  expect(submissionFeeAmountDraft("1").amountMinor).toBe("1000000");
  // Empty means the platform default.
  expect(submissionFeeAmountDraft("").amountMinor).toBe(
    SUBMISSION_FEE_DEFAULT_MINOR,
  );
  for (const text of [
    "0",
    "0.99",
    "10.01",
    "11",
    "2.505",
    "two",
    "-2",
    "1e1",
  ]) {
    const draft = submissionFeeAmountDraft(text);
    expect(draft.amountMinor).toBeUndefined();
    expect(draft.error).toBe(
      "Enter an amount from 1 to 10, with at most two decimal places.",
    );
  }
  expect(submissionFeeAmountText("2000000")).toBe("2");
  expect(submissionFeeAmountText("2500000")).toBe("2.5");
  expect(submissionFeeAmountText("1234567")).toBe("1.234567");
  // Every amount the page accepts is one the project record accepts.
  for (const text of ["1", "2", "2.5", "9.99", "10"]) {
    const { amountMinor } = submissionFeeAmountDraft(text);
    expect(() => project({ enabled: true, amountMinor })).not.toThrow();
  }
});

test("the owner's sentence states the refund, the kept fee and the SLOP option", () => {
  for (const part of [
    "refundable",
    "A merge sends the fee back",
    "14 days",
    "closed without a merge keeps it",
    "SLOP at half the price",
  ])
    expect(SUBMISSION_FEE_HINT).toContain(part);
  expect(SUBMISSION_FEE_HINT).not.toContain("—");
});

test("the item of a pull request is the contract's hash", () => {
  // keccak256(abi.encodePacked("slop-fee-v1", uint64(1271472696), uint64(49))),
  // computed independently with viem's encodePacked.
  expect(submissionFeeItem(1271472696, 49)).toBe(
    "0x66299a23196a6ec9279b0e10e6358de03bac57573ca1b408468502ab97e0ac90",
  );
  expect(submissionFeeItem("1271472696", 49n)).toBe(
    submissionFeeItem(1271472696, 49),
  );
  expect(submissionFeeItem(1271472696, 50)).not.toBe(
    submissionFeeItem(1271472696, 49),
  );
  for (const bad of [0, -1, 1.5, "x", 2n ** 64n])
    expect(() => submissionFeeItem(bad as never, 1)).toThrow(TypeError);
  expect(new Set(Object.values(SUBMISSION_FEE_KEPT_TO))).toEqual(
    new Set(["0x8f77C37D8650776bFe73c9b12B15209eE15D9b86"]),
  );
});
