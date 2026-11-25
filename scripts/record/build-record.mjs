// spec/frontend/recordPages.md, "The record stage never fails a release"
//
// Rebuilds /data/record.json for a release. The previous record is read first:
// this site's own /data/record.json, then the retired site's snapshot. The build
// is skipped without SLOP_RECORD_BUILD=1, writes a new record on success, writes
// the previous record unchanged on any failure or once its deadline passes, and
// writes nothing when it has no previous record. Receipts are counted, not
// modelled one by one: a receipts read that fails keeps the previous receipts,
// and a successful read can only add to them, because a published receipt is
// carried forward even when its payments are no longer in the public record.
// The stage's own exit is always success, so the release continues.
//
// The fresh record comes from the injected `buildFresh` function
// ({ fetchJson, fetchBytes, rpcCall, previous, leaderboard, now }) => record,
// which the live source aggregation supplies (scripts/record/agg.mjs, a
// follow-up). Until it is wired, the stage republishes the previous record
// unchanged, which is the same outcome the retired site produced when its
// fresh build failed. The receipts in a fresh record are counted by
// scripts/record/receipts.mjs (loadReceipts) and merged with the previous
// receipts, so a published receipt never disappears.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadReceipts, RECEIPTS_PAGE } from "./receipts.mjs";

export const RECORD_FILE = "public/data/record.json";
export const LEADERBOARD_FILE = "public/data/leaderboard.json";
export const PREVIOUS_RECORDS = [
  "https://slop.cash/data/record.json",
  "https://record.slop.cash/data/snapshot.json",
];
const USER_AGENT = "slop-record-build";
const FETCH_TIMEOUT_MS = 30_000;
const BYTES_TIMEOUT_MS = 120_000;
export const RUN_DEADLINE_MS = 8 * 60_000;

// A record this build can carry forward: the fields the pages and agents read.
export function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.builtAt === "string" &&
    value.sources !== null &&
    typeof value.sources === "object" &&
    Array.isArray(value.sources.disclosures) &&
    Array.isArray(value.sources.cycles) &&
    value.money !== null &&
    typeof value.money === "object" &&
    Array.isArray(value.months) &&
    Array.isArray(value.projects)
  );
}

// A receipt published once stays published, even when its payments are no
// longer in the public record, and every receipt's link points at this
// site's receipts page.
export function keepPublished(previousItems, items, page = RECEIPTS_PAGE) {
  const anchors = new Set(items.map((item) => item.anchor));
  const kept = (Array.isArray(previousItems) ? previousItems : []).filter(
    (item) => item && typeof item === "object" && typeof item.anchor === "string" && !anchors.has(item.anchor),
  );
  return [...items, ...kept.map((item) => ({ ...item, url: `${page}#${item.anchor}` }))];
}

// The previous record, read from the first source that answers with one.
export async function readPrevious(fetchJson, sources = PREVIOUS_RECORDS) {
  for (const source of sources) {
    try {
      const value = await fetchJson(source);
      if (isRecord(value)) return value;
    } catch {
      // A source that cannot be read is skipped.
    }
  }
  return null;
}

async function localLeaderboard(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(value?.ledger) && value.ledger.length ? value : null;
  } catch {
    return null;
  }
}

export async function buildRecord({
  fetchJson,
  fetchBytes,
  rpcCall,
  previous,
  leaderboard = null,
  now = new Date(),
  buildFresh = null,
}) {
  if (typeof buildFresh !== "function") {
    throw new Error("fresh record build is not wired yet");
  }
  const record = await buildFresh({ fetchJson, fetchBytes, rpcCall, previous, leaderboard, now });
  if (!record || !Array.isArray(record.months) || record.months.some((month) => !month.counts)) {
    throw new Error("cycle snapshot counts missing");
  }
  let receipts;
  try {
    receipts = await loadReceipts(fetchJson, rpcCall, { previous: previous?.receipts, now });
  } catch (error) {
    console.error(`record: receipts not rebuilt: ${error.message}`);
    receipts = previous?.receipts || { builtAt: null, items: [], confirmed: [] };
  }
  record.receipts = { ...receipts, items: keepPublished(previous?.receipts?.items, receipts.items ?? []) };
  return record;
}

async function writeRecord(path, record) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function fetchers(fetchImpl, token) {
  const isGitHubApi = (url) => {
    try {
      return new URL(url).hostname === "api.github.com";
    } catch {
      return false;
    }
  };
  const fetchJson = async (url, timeoutMs = FETCH_TIMEOUT_MS) => {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT,
        ...(isGitHubApi(url) && token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json();
  };
  const fetchBytes = async (url, timeoutMs = BYTES_TIMEOUT_MS) => {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/octet-stream",
        "user-agent": USER_AGENT,
        ...(isGitHubApi(url) && token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const rpcCall = async (url, method, params) => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    const body = await response.json();
    if (body?.error) throw new Error(`${body.error.message ?? body.error}`);
    return body?.result;
  };
  return { fetchJson, fetchBytes, rpcCall };
}

export async function runRecordBuild({
  root = process.cwd(),
  out,
  env = process.env,
  fetchImpl = globalThis.fetch,
  deadlineMs = RUN_DEADLINE_MS,
  now = new Date(),
  buildFresh = null,
} = {}) {
  const output = out ? resolve(out) : resolve(root, RECORD_FILE);
  if (env.SLOP_RECORD_BUILD !== "1") {
    return { outcome: "skipped", reason: "SLOP_RECORD_BUILD is not 1" };
  }
  const token = env.SLOP_RECORD_GITHUB_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN || "";
  const io = fetchers(fetchImpl, token);
  const previous = await readPrevious(io.fetchJson).catch(() => null);
  let timer;
  try {
    const leaderboard = await localLeaderboard(resolve(root, LEADERBOARD_FILE));
    const record = await Promise.race([
      buildRecord({ ...io, previous, leaderboard, now, buildFresh }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`deadline of ${deadlineMs} ms passed`)), deadlineMs);
      }),
    ]);
    await writeRecord(output, record);
    return {
      outcome: "built",
      builtAt: record.builtAt,
      receipts: record.receipts.items.length,
      leaderboard: leaderboard ? "local" : "live",
    };
  } catch (error) {
    if (!previous) return { outcome: "none", reason: String(error?.message ?? error) };
    try {
      await writeRecord(output, previous);
    } catch (writeError) {
      return { outcome: "none", reason: String(writeError?.message ?? writeError) };
    }
    return { outcome: "previous", builtAt: previous.builtAt, reason: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

export function describe(result) {
  switch (result.outcome) {
    case "built":
      return `record: built ${result.builtAt}, ${result.receipts} receipts, ${result.leaderboard} leaderboard`;
    case "skipped":
      return `record: skipped (${result.reason})`;
    case "previous":
      return `record: not rebuilt (${result.reason}); kept the previous record of ${result.builtAt}`;
    case "none":
      return `record: not rebuilt (${result.reason}); no previous record, nothing written`;
    default:
      return `record: ${result.outcome} (${result.reason ?? "unknown"})`;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
  try {
    const line = describe(await runRecordBuild({ out }));
    console.log(line);
  } catch (error) {
    console.log(`record: not rebuilt (${error?.message ?? error})`);
  }
  process.exit(0);
}
