/**
 * One-time Inbox notice that trace licensing is available (2026-11).
 *
 * Dry run (default): prints how many accounts would get the notice, reading
 * production D1 through wrangler. `--send` runs the one idempotent INSERT; a
 * second run adds nothing. Both use `--command`, never `--file`: a remote file
 * run is an import and takes the database offline.
 *
 *   CLOUDFLARE_ACCOUNT_ID=<account> bun run scripts/announce-trace-licensing.ts [--send]
 *
 * The database is `slop-private` (`SLOP_DB` in wrangler.toml).
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  TRACE_LICENSING_AVAILABLE_SQL,
  TRACE_LICENSING_EVENT_KEY,
  TRACE_LICENSING_RECIPIENTS_SQL,
} from "../backend/notifications/events";

const DATABASE = "slop-private";

/** Replaces the one bound parameter with a timestamp literal we generated. */
export function withNoticeTime(sql: string, at: Date): string {
  const literal = `'${at.toISOString()}'`;
  return sql.replaceAll("?1", literal);
}

type WranglerResult = {
  results?: Record<string, unknown>[];
  meta?: { changes?: unknown };
}[];

/** The recipient count from wrangler's JSON answer to the count query. */
export function recipientCount(stdout: string): number {
  const recipients = (JSON.parse(stdout) as WranglerResult)[0]?.results?.[0]
    ?.recipients;
  if (!Number.isSafeInteger(recipients) || (recipients as number) < 0)
    throw new Error("could not read the recipient count");
  return recipients as number;
}

/** The rows the INSERT wrote, from wrangler's JSON answer. */
export function rowsWritten(stdout: string): number {
  const changes = (JSON.parse(stdout) as WranglerResult)[0]?.meta?.changes;
  if (!Number.isSafeInteger(changes) || (changes as number) < 0)
    throw new Error("could not read the rows written");
  return changes as number;
}

function execute(sql: string): string {
  const result = spawnSync(
    resolve("node_modules/.bin/wrangler"),
    ["d1", "execute", DATABASE, "--remote", "--json", "--command", sql],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || result.error?.message || "";
    throw new Error(
      `wrangler failed with status ${result.status}${stderr ? `:\n${stderr}` : ""}`,
    );
  }
  return result.stdout;
}

function main(args: string[]): void {
  const send = args.includes("--send");
  const unknown = args.filter((arg) => arg !== "--send");
  if (unknown.length > 0) throw new Error(`unknown argument: ${unknown[0]}`);
  if (!process.env.CLOUDFLARE_ACCOUNT_ID)
    throw new Error("set CLOUDFLARE_ACCOUNT_ID");

  const recipients = recipientCount(execute(TRACE_LICENSING_RECIPIENTS_SQL));
  console.log(`${TRACE_LICENSING_EVENT_KEY}: ${recipients} recipients`);
  if (!send) {
    console.log("Dry run. Pass --send to add the notices.");
    return;
  }
  const written = rowsWritten(
    execute(withNoticeTime(TRACE_LICENSING_AVAILABLE_SQL, new Date())),
  );
  console.log(`Sent. ${written} notices written.`);
  const left = recipientCount(execute(TRACE_LICENSING_RECIPIENTS_SQL));
  console.log(`Recipients still without the notice: ${left} (expected 0).`);
  if (left !== 0) process.exitCode = 1;
}

if (import.meta.main) main(process.argv.slice(2));
