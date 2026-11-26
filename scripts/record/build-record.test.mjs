import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isRecord,
  keepPublished,
  PREVIOUS_RECORDS,
  RECORD_FILE,
  runRecordBuild,
} from "./build-record.mjs";

const previous = {
  builtAt: "2026-11-23T08:12:00.000Z",
  sources: { projects: ["feed"], disclosures: [], cycles: [] },
  money: { pools: [], settlements: [] },
  months: [],
  projects: [],
  receipts: {
    builtAt: "2026-11-23T08:12:00.000Z",
    items: [
      { anchor: "feed-2026-10", url: "https://old.example/#feed-2026-10" },
    ],
    confirmed: [],
  },
};

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Answers the previous-record sources from `answers`; every other read fails. */
function fetchFrom(
  answers,
  other = () => Promise.reject(new Error("offline")),
) {
  const seen = [];
  const impl = (url) => {
    seen.push(String(url));
    const answer = answers.get(String(url));
    return answer ? Promise.resolve(answer()) : other(url);
  };
  return { impl, seen };
}

function withRoot(run) {
  const root = mkdtempSync(join(tmpdir(), "slop-record-"));
  return run(root).finally(() =>
    rmSync(root, { recursive: true, force: true }),
  );
}

test("without the switch the build writes nothing and reads nothing", () =>
  withRoot(async (root) => {
    const { impl, seen } = fetchFrom(new Map());
    const result = await runRecordBuild({ root, env: {}, fetchImpl: impl });
    expect(result.outcome).toBe("skipped");
    expect(seen).toEqual([]);
    expect(existsSync(join(root, RECORD_FILE))).toBe(false);
  }));

test("a failed build writes the previous record unchanged", () =>
  withRoot(async (root) => {
    const { impl } = fetchFrom(
      new Map([[PREVIOUS_RECORDS[0], () => json(previous)]]),
    );
    const result = await runRecordBuild({
      root,
      env: { SLOP_RECORD_BUILD: "1" },
      fetchImpl: impl,
    });
    expect(result.outcome).toBe("previous");
    expect(JSON.parse(readFileSync(join(root, RECORD_FILE), "utf8"))).toEqual(
      previous,
    );
  }));

test("the retired site's snapshot is the previous record when this site has none", () =>
  withRoot(async (root) => {
    const { impl } = fetchFrom(
      new Map([
        [PREVIOUS_RECORDS[0], () => json({ error: "not found" }, 404)],
        [PREVIOUS_RECORDS[1], () => json(previous)],
      ]),
    );
    const result = await runRecordBuild({
      root,
      env: { SLOP_RECORD_BUILD: "1" },
      fetchImpl: impl,
    });
    expect(result.outcome).toBe("previous");
    expect(JSON.parse(readFileSync(join(root, RECORD_FILE), "utf8"))).toEqual(
      previous,
    );
  }));

test("with no previous record a failed build writes nothing", () =>
  withRoot(async (root) => {
    const { impl } = fetchFrom(new Map());
    const result = await runRecordBuild({
      root,
      env: { SLOP_RECORD_BUILD: "1" },
      fetchImpl: impl,
    });
    expect(result.outcome).toBe("none");
    expect(existsSync(join(root, RECORD_FILE))).toBe(false);
  }));

test("a build past its deadline writes the previous record", () =>
  withRoot(async (root) => {
    const { impl } = fetchFrom(
      new Map([[PREVIOUS_RECORDS[0], () => json(previous)]]),
      () => new Promise(() => {}),
    );
    const result = await runRecordBuild({
      root,
      env: { SLOP_RECORD_BUILD: "1" },
      fetchImpl: impl,
      deadlineMs: 50,
    });
    expect(result.outcome).toBe("previous");
    expect(result.reason).toContain("deadline");
    expect(JSON.parse(readFileSync(join(root, RECORD_FILE), "utf8"))).toEqual(
      previous,
    );
  }));

test("a published receipt stays, and every receipt links to this site", () => {
  const items = keepPublished(
    [
      { anchor: "feed-2026-10", url: "https://old.example/#feed-2026-10" },
      { anchor: "gone-2026-10", url: "https://old.example/#gone-2026-10" },
    ],
    [{ anchor: "feed-2026-10", total: "107.56", url: "x" }],
    "https://slop.cash/receipts",
  );
  expect(items).toEqual([
    {
      anchor: "feed-2026-10",
      total: "107.56",
      url: "https://slop.cash/receipts#feed-2026-10",
    },
    { anchor: "gone-2026-10", url: "https://slop.cash/receipts#gone-2026-10" },
  ]);
});

test("only a record with the fields the pages read is carried forward", () => {
  expect(isRecord(previous)).toBe(true);
  expect(isRecord({ builtAt: "x" })).toBe(false);
  expect(isRecord(null)).toBe(false);
  expect(isRecord([])).toBe(false);
});
