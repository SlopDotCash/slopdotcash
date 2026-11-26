/**
 * Builds public/data/record.json, the data behind /record and /receipts, during
 * every site build that sets SLOP_RECORD_BUILD=1 (the release builds in
 * .github/workflows/deploy.yml, fresh and published-data alike). The file keeps
 * the shape of the retired record site's data/snapshot.json, so the agents that
 * read it only change the URL.
 *
 * It never fails a build. The previous record is read first (this site's own
 * /data/record.json, then the retired site's snapshot). If building the new
 * record fails or runs past its deadline, the previous record is written back
 * unchanged and one line is logged. With no previous record either, nothing is
 * written and the pages say the record is not available.
 *
 * Receipts: a failed receipts read keeps the previous receipts, and a receipt
 * that has been published never disappears from a later record.
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readLeaderboardFile } from "../leaderboard-files.mjs";
import { discover, loadAll, SOURCES } from "./agg.mjs";
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

/** A record this build can carry forward: the fields the pages and agents read. */
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

/**
 * Every receipt published before stays: one that this build did not produce
 * again (its payments left the public record, say) is kept as it was. Every
 * receipt's link points at this site's receipts page.
 */
export function keepPublished(previousItems, items, page = RECEIPTS_PAGE) {
  const anchors = new Set(items.map((item) => item.anchor));
  const kept = (Array.isArray(previousItems) ? previousItems : []).filter(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof item.anchor === "string" &&
      !anchors.has(item.anchor),
  );
  return [...items, ...kept].map((item) => ({
    ...item,
    url: `${page}#${item.anchor}`,
  }));
}

/** The previous record, from the first source that answers with one. */
export async function readPrevious(fetchJson, sources = PREVIOUS_RECORDS) {
  for (const url of sources) {
    try {
      const value = await fetchJson(url);
      if (isRecord(value)) return value;
    } catch {
      // The next source is tried.
    }
  }
  return null;
}

/**
 * The archive listing (pinned commit) never changes, so when GitHub cannot be
 * read the last record's listing is reused with today's project registry.
 */
async function discoverOrReuse(fetchGitHub, fetchJson, previous) {
  try {
    return await discover(fetchGitHub);
  } catch (error) {
    if (!previous?.sources) throw error;
    const registry = await fetchJson(SOURCES.registry);
    const ids = Array.isArray(registry?.projects)
      ? registry.projects
          .map((project) => project?.id)
          .filter((id) => typeof id === "string")
          .sort()
      : [];
    return ids.length
      ? { ...previous.sources, projects: ids, projectSource: "registry" }
      : previous.sources;
  }
}

/** The leaderboard this build publishes, when it is on disk and not empty. */
export async function localLeaderboard(path) {
  try {
    const bytes = await readLeaderboardFile(path);
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    return Array.isArray(value?.ledger) && value.ledger.length ? value : null;
  } catch {
    return null;
  }
}

/** Builds a new record. Throws when the main part cannot be built. */
export async function buildRecord({
  fetchJson,
  fetchGitHub = fetchJson,
  fetchBytes,
  rpcCall,
  previous,
  leaderboard = null,
  now = new Date(),
}) {
  const sources = await discoverOrReuse(fetchGitHub, fetchJson, previous);
  const record = await loadAll(fetchJson, sources, {
    cycleSnapshots: previous?.cycleSnapshots || {},
    fetchCycleSnapshots: true,
    fetchBytes,
    leaderboard,
  });
  if (record.months.some((month) => !month.counts))
    throw new Error("cycle snapshot counts missing");
  // One receipt per project month that paid an outside contributor. A failed
  // read keeps the last good receipts and never stops the rest of the record.
  let receipts;
  try {
    receipts = await loadReceipts(fetchJson, rpcCall, {
      previous: previous?.receipts,
      now,
    });
  } catch (error) {
    console.error(`record: receipts not rebuilt: ${error.message}`);
    receipts = previous?.receipts || {
      builtAt: null,
      items: [],
      confirmed: [],
    };
  }
  record.receipts = {
    ...receipts,
    items: keepPublished(previous?.receipts?.items, receipts.items ?? []),
  };
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
  const read = (url, timeoutMs) =>
    fetchImpl(url, {
      headers: {
        "user-agent": USER_AGENT,
        // The token goes only to the GitHub API, where it lifts the rate limit.
        ...(token && url.startsWith("https://api.github.com/")
          ? { authorization: `Bearer ${token}` }
          : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    }).then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return response;
    });
  return {
    fetchJson: (url) => read(url, FETCH_TIMEOUT_MS).then((r) => r.json()),
    fetchBytes: (url) =>
      read(url, BYTES_TIMEOUT_MS).then(
        async (r) => new Uint8Array(await r.arrayBuffer()),
      ),
    rpcCall: (url, method, params) =>
      fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": USER_AGENT,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
        .then((response) => {
          if (!response.ok) throw new Error(`${response.status} ${url}`);
          return response.json();
        })
        .then((body) => body.result),
  };
}

/**
 * Writes the new record, or the previous one unchanged, or nothing. Never
 * throws. Returns what happened, for the log line and tests.
 */
export async function runRecordBuild({
  root = process.cwd(),
  env = process.env,
  fetchImpl = globalThis.fetch,
  deadlineMs = RUN_DEADLINE_MS,
  now = new Date(),
} = {}) {
  const output = resolve(root, RECORD_FILE);
  if (env.SLOP_RECORD_BUILD !== "1")
    return { outcome: "skipped", reason: "SLOP_RECORD_BUILD is not 1" };
  const token =
    env.SLOP_RECORD_GITHUB_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN || "";
  const io = fetchers(fetchImpl, token);
  const previous = await readPrevious(io.fetchJson).catch(() => null);
  let timer;
  try {
    const leaderboard = await localLeaderboard(resolve(root, LEADERBOARD_FILE));
    const record = await Promise.race([
      buildRecord({
        ...io,
        fetchGitHub: io.fetchJson,
        previous,
        leaderboard,
        now,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`deadline of ${deadlineMs} ms passed`)),
          deadlineMs,
        );
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
    if (!previous)
      return { outcome: "none", reason: String(error?.message ?? error) };
    try {
      await writeRecord(output, previous);
    } catch (writeError) {
      return {
        outcome: "none",
        reason: String(writeError?.message ?? writeError),
      };
    }
    return {
      outcome: "previous",
      builtAt: previous.builtAt,
      reason: String(error?.message ?? error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function describe(result) {
  if (result.outcome === "built")
    return `record: built ${result.builtAt}, ${result.receipts} receipts, ${result.leaderboard} leaderboard`;
  if (result.outcome === "previous")
    return `record: not rebuilt (${result.reason}); kept the previous record of ${result.builtAt}`;
  if (result.outcome === "none")
    return `record: not rebuilt (${result.reason}); no previous record, nothing written`;
  return `record: skipped (${result.reason})`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let line;
  try {
    line = describe(await runRecordBuild());
  } catch (error) {
    line = `record: not rebuilt (${error?.message ?? error})`;
  }
  console.log(line);
  // Open sockets from abandoned reads must not hold the build.
  process.exit(0);
}
