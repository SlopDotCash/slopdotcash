// The project's report deposit setting (operator decision, 21 November 2026;
// PRD section 8, "Report deposit"): what the project record accepts and what
// an owner may change through self-service.
import { expect, test } from "bun:test";
import { classifyRevisionChanges } from "../src/lib/project-revision-changes";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { findProject } from "../src/lib/projects.mjs";
import { reportDepositOn } from "../src/lib/security-report-deposit.mjs";

function project(security?: unknown) {
  const original = findProject("asi");
  if (!original) throw new Error("Missing registry fixture");
  return assertProjectDefinition({
    ...original,
    ...(security === undefined ? {} : { security }),
  });
}

test("absent means on; the owner can turn it off and on again", () => {
  expect(reportDepositOn(project())).toBe(true);
  expect(reportDepositOn(project({}))).toBe(true);
  expect(reportDepositOn(project({ reportDeposit: true }))).toBe(true);
  expect(reportDepositOn(project({ reportDeposit: false }))).toBe(false);
});

test("the project record refuses anything but the one boolean", () => {
  for (const security of [
    { reportDeposit: "false" },
    { reportDeposit: 0 },
    { reportDeposit: null },
    { reportDeposit: false, amount: "1" },
    { deposit: false },
    [],
    "off",
    null,
    false,
  ])
    expect(() => project(security)).toThrow(TypeError);
});

test("an owner revision may change it, and it is live at once", () => {
  const before = project();
  const off = project({ reportDeposit: false });
  expect(classifyRevisionChanges(before, off)).toEqual({
    presentation: ["security"],
    executable: [],
    financial: [],
    restricted: [],
  });
  expect(
    classifyRevisionChanges(off, project({ reportDeposit: true })),
  ).toEqual({
    presentation: ["security"],
    executable: [],
    financial: [],
    restricted: [],
  });
});
