import { expect, test } from "bun:test";
import { parseGenerationArguments, selectEvaluatedContributionsForWindow } from "./generate-leaderboard";

const at = (second: number, milliseconds = 0) =>
  new Date(Date.UTC(2026, 10, 1, 0, 0, second, milliseconds));
const event = (id: string, second: number, milliseconds = 0) => ({
  id, category: "evaluated-contribution" as const,
  occurredAt: at(second, milliseconds).toISOString(),
});

test("evaluation windows include their start and exclude their end without reordering or copying events", () => {
  const first = event("later", 2, 500);
  const second = event("start", 1);
  const end = event("end", 3);
  const input = [first, second, first, end];
  const selected = selectEvaluatedContributionsForWindow(input, at(1), at(3), at(4));
  expect(selected).toEqual([first, second, first]);
  expect(selected[0]).toBe(first);
  expect(selected[1]).toBe(second);
  expect(input).toEqual([first, second, first, end]);
});

test("a malformed out-of-window event still refuses the complete selection", () => {
  const valid = event("valid", 2);
  expect(() => selectEvaluatedContributionsForWindow(
    [valid, { ...event("outside", 0), category: "substantive-review" as const }], at(1), at(3), at(4),
  )).toThrow("must use the evaluated-contribution category");
  expect(() => selectEvaluatedContributionsForWindow(
    [valid, { ...event("outside", 0), occurredAt: "2026-11-01T00:00:00Z" }], at(1), at(3), at(4),
  )).toThrow("must be an exact UTC timestamp");
});

test("future out-of-window events cannot become an ignored partial result", () => {
  expect(() => selectEvaluatedContributionsForWindow(
    [event("valid", 2), event("future", 5)], at(1), at(3), at(4),
  )).toThrow("occurredAt cannot be in the future");
});

test("window Date inputs floor to seconds while event timestamps keep their fractional part", () => {
  expect(selectEvaluatedContributionsForWindow(
    [event("start-second", 1), event("before-end", 2, 999), event("end-second", 3)],
    at(1, 999), at(3, 999), at(4, 999),
  ).map((entry) => entry.id)).toEqual(["start-second", "before-end"]);
  expect(() => selectEvaluatedContributionsForWindow([event("same-second", 4, 500)], at(1), at(3), at(4, 999)))
    .toThrow("occurredAt cannot be in the future");
});

test("invalid, empty, reversed and future windows refuse before selecting events", () => {
  expect(() => selectEvaluatedContributionsForWindow([], new Date(NaN), at(3), at(4))).toThrow("valid date");
  expect(() => selectEvaluatedContributionsForWindow([], at(1), at(1, 999), at(4))).toThrow("positive duration");
  expect(() => selectEvaluatedContributionsForWindow([], at(3), at(1), at(4))).toThrow("positive duration");
  expect(() => selectEvaluatedContributionsForWindow([], at(1), at(5), at(4))).toThrow("cannot end in the future");
  expect(selectEvaluatedContributionsForWindow([], at(1), at(3), at(4))).toEqual([]);
});

test("a corrected selection retry has no prior accepted prefix", () => {
  expect(() => selectEvaluatedContributionsForWindow(
    [event("old", 2), { ...event("bad", 2), occurredAt: "bad" }], at(1), at(3), at(4),
  )).toThrow();
  expect(selectEvaluatedContributionsForWindow([event("new", 2)], at(1), at(3), at(4)).map((entry) => entry.id))
    .toEqual(["new"]);
});

test("cutoff defaults do not require a valid current clock", () => {
  expect(parseGenerationArguments([], new Date(NaN))).toEqual({});
});

test.each([
  ["--unknown", at(1).toISOString()],
  ["--cutoff"],
  ["--cutoff", at(1).toISOString(), "extra"],
  ["--cutoff", "2026-11-01T00:00:01Z"],
  ["--cutoff", "2026-02-30T00:00:00.000Z"],
].map((args) => ({ args })))("invalid cutoff arguments refuse: %j", ({ args }) => {
  expect(() => parseGenerationArguments(args, at(4))).toThrow();
});

test("cutoff parsing uses the floored current clock and preserves a valid older fractional cutoff", () => {
  expect(parseGenerationArguments(["--cutoff", at(3, 500).toISOString()], at(4))).toEqual({ now: at(3, 500) });
  expect(parseGenerationArguments(["--cutoff", at(4).toISOString()], at(4, 999))).toEqual({ now: at(4) });
  expect(() => parseGenerationArguments(["--cutoff", at(4, 500).toISOString()], at(4, 999))).toThrow("cannot be in the future");
  expect(() => parseGenerationArguments(["--cutoff", at(1).toISOString()], new Date(NaN))).toThrow("valid date");
});
