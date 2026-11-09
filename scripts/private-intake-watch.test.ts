/** Authored against the actual workflow decoder; unexecuted in this audit. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const workflow = readFileSync(
  new URL("../.github/workflows/private-intake-watch.yml", import.meta.url),
  "utf8",
);
const decoder = workflow
  .split("node - \"$body\" <<'NODE'\n")[1]
  ?.split("\n          NODE")[0];
if (!decoder) throw new Error("Private intake watch decoder is missing");

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const observation = (verifiedAt = new Date(NOW).toISOString()) => ({
  enabled: true,
  source: "github-public-status",
  verifiedAt,
});

// Only the inline decoder runs here. The workflow's fixed endpoint, curl size
// and time limits, redirect behavior and HTTP gate require separate acceptance.
function decode(
  source: string,
  { now = NOW, readError }: { now?: number; readError?: Error } = {},
) {
  let clockCalls = 0;
  const reads: unknown[][] = [];
  class WatchDate extends Date {
    static now() {
      clockCalls += 1;
      return now;
    }
  }
  runInNewContext(decoder, {
    require: (name: string) => {
      if (name !== "node:fs") throw new Error(`Unexpected module: ${name}`);
      return {
        readFileSync: (...args: unknown[]) => {
          reads.push(args);
          if (readError) throw readError;
          return source;
        },
      };
    },
    process: { argv: ["node", "-", "/scratch/intake.json"] },
    Date: WatchDate,
  });
  return { clockCalls, reads };
}

function validate(value: unknown, now = NOW) {
  return decode(JSON.stringify(value), { now });
}

test("fresh public observation reads the selected file and samples time once", () => {
  expect(validate({ ...observation(), extra: "compatible" })).toEqual({
    clockCalls: 1,
    reads: [["/scratch/intake.json", "utf8"]],
  });
});

test("whole-second UTC observations retain the reader's supported form", () => {
  expect(() => validate(observation("2026-11-09T12:00:00Z"))).not.toThrow();
});

test("the three-hour alarm includes its exact oldest boundary", () => {
  expect(() => validate(observation(new Date(NOW - 10_800_000).toISOString())))
    .not.toThrow();
  expect(() => validate(observation(new Date(NOW - 10_800_001).toISOString())))
    .toThrow("older than three hours");
});

test("future skew matches the reader's inclusive five-minute tolerance", () => {
  expect(() => validate(observation(new Date(NOW + 300_000).toISOString())))
    .not.toThrow();
  expect(() => validate(observation(new Date(NOW + 300_001).toISOString())))
    .toThrow("future verification time");
});

test("far-future timestamps cannot hide missed renewals", () => {
  expect(() => validate(observation("2099-11-09T12:00:00.000Z")))
    .toThrow("future verification time");
});

test("non-record, disabled, truthy and wrong-source payloads cannot pass", () => {
  for (const value of [
    null, [], true, 1, "enabled", {},
    { ...observation(), enabled: false },
    { ...observation(), enabled: 1 },
    { ...observation(), enabled: "true" },
    { ...observation(), source: undefined },
    { ...observation(), source: "operator-asserted" },
    { ...observation(), verifiedAt: null },
  ]) {
    expect(() => validate(value)).toThrow("intake is not enabled");
  }
});

test("noncanonical timezone, precision and whitespace forms are refused", () => {
  for (const stamp of [
    "2026-11-09", "2026-11-09T12:00:00", "2026-11-09T12:00:00+00:00",
    "2026-11-09T12:00:00.0Z", "2026-11-09T12:00:00.0000Z",
    " 2026-11-09T12:00:00.000Z", "2026-11-09T12:00:00.000Z ",
  ]) {
    expect(() => validate(observation(stamp))).toThrow("intake is not enabled");
  }
});

test("normalized impossible calendar dates and end-of-day times are refused", () => {
  for (const stamp of [
    "2026-02-30T12:00:00.000Z", "2026-11-09T24:00:00.000Z",
    "2026-13-09T12:00:00.000Z", "2026-11-09T12:00:60.000Z",
  ]) {
    expect(() => validate(observation(stamp)))
      .toThrow("invalid verification time");
  }
});

test("malformed JSON and failed file reads remain failures", () => {
  expect(() => decode("{")).toThrow();
  expect(() => decode("", { readError: new Error("status file unavailable") }))
    .toThrow("status file unavailable");
});

test("an invalid local clock cannot certify fresh evidence", () => {
  for (const now of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    expect(() => validate(observation(), now)).toThrow("invalid or future");
  }
});
