import { expect, test } from "bun:test";
import {
  assertIntakeCap,
  INTAKE_CAP_LIMITS,
  INTAKE_COUNT_MAX_AGE_MS,
  intakeCap,
  intakePaused,
} from "./intake-cap.mjs";
import { classifyRevisionChanges } from "./project-revision-changes";
import { assertProjectDefinition } from "./project-schema.mjs";
import { findProject } from "./projects.mjs";

const NOW = new Date("2026-11-17T12:00:00Z");
const OBSERVED = "2026-11-17T11:17:00.000Z";

function project(
  intake?: number,
  status: "active" | "paused" = "active",
): ReturnType<typeof assertProjectDefinition> {
  const original = findProject("asi");
  if (!original) throw new Error("Missing registry fixture");
  return assertProjectDefinition({
    ...original,
    status,
    ...(intake === undefined
      ? {}
      : { slopbot: { automaticClosure: false, intakeCap: intake } }),
  });
}

test("a project without the setting is never paused", () => {
  expect(intakeCap(project())).toBeNull();
  expect(
    intakePaused(
      project(),
      [{ openOutside: 9_999, observedAt: OBSERVED }],
      NOW,
    ),
  ).toBe(false);
});

test("a project pauses at the number and comes back below it", () => {
  const capped = project(20);
  expect(intakeCap(capped)).toBe(20);
  const at = (openOutside: number) =>
    intakePaused(capped, [{ openOutside, observedAt: OBSERVED }], NOW);
  expect(at(19)).toBe(false);
  expect(at(20)).toBe(true);
  expect(at(21)).toBe(true);
  expect(at(0)).toBe(false);
});

test("any one repository at the number pauses the project; counts are not added", () => {
  const capped = project(20);
  expect(
    intakePaused(
      capped,
      [
        { openOutside: 12, observedAt: OBSERVED },
        { openOutside: 12, observedAt: OBSERVED },
      ],
      NOW,
    ),
  ).toBe(false);
  expect(
    intakePaused(
      capped,
      [
        { openOutside: 3, observedAt: OBSERVED },
        { openOutside: 20, observedAt: OBSERVED },
      ],
      NOW,
    ),
  ).toBe(true);
});

test("a count that could not be read pauses nothing", () => {
  const capped = project(1);
  // Not loaded, failed, or the project has no stored row.
  expect(intakePaused(capped, undefined, NOW)).toBe(false);
  expect(intakePaused(capped, null, NOW)).toBe(false);
  expect(intakePaused(capped, [], NOW)).toBe(false);
  // A row read before the count existed.
  expect(
    intakePaused(capped, [{ openOutside: null, observedAt: OBSERVED }], NOW),
  ).toBe(false);
  expect(intakePaused(capped, [{ observedAt: OBSERVED }], NOW)).toBe(false);
  // A count older than the limit, such as after Slopbot was uninstalled.
  const stale = new Date(
    NOW.getTime() - INTAKE_COUNT_MAX_AGE_MS - 1,
  ).toISOString();
  expect(
    intakePaused(capped, [{ openOutside: 50, observedAt: stale }], NOW),
  ).toBe(false);
  const recent = new Date(
    NOW.getTime() - INTAKE_COUNT_MAX_AGE_MS,
  ).toISOString();
  expect(
    intakePaused(capped, [{ openOutside: 50, observedAt: recent }], NOW),
  ).toBe(true);
});

test("a paused project keeps its existing listing", () => {
  expect(
    intakePaused(
      project(1, "paused"),
      [{ openOutside: 50, observedAt: OBSERVED }],
      NOW,
    ),
  ).toBe(false);
});

test("the registry accepts a whole number in range only", () => {
  for (const value of [INTAKE_CAP_LIMITS.min, 20, INTAKE_CAP_LIMITS.max])
    expect(() => assertIntakeCap(value, "cap")).not.toThrow();
  for (const value of [0, -1, 1.5, INTAKE_CAP_LIMITS.max + 1, "20", null])
    expect(() => assertIntakeCap(value, "cap")).toThrow(
      "cap must be a whole number from 1 to 500",
    );
  expect(() => project(0)).toThrow("project.slopbot.intakeCap");
  expect(() => project(501)).toThrow("project.slopbot.intakeCap");
});

test("changing the number is an owner presentation revision, not a material term", () => {
  const changes = classifyRevisionChanges(project(), project(20));
  expect(changes).toEqual({
    presentation: ["slopbot"],
    executable: [],
    financial: [],
    restricted: [],
  });
  expect(
    classifyRevisionChanges(project(20), project(30)).presentation,
  ).toEqual(["slopbot"]);
});
