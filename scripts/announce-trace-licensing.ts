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

function execute(sql: string): string {
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      DATABASE,
      "--remote",
      "--json",
      "--command",
      sql,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`wrangler failed with status ${result.status}`);
  }
  return result.stdout;
}

function main(args: string[]): void {
  const send = args.includes("--send");
  const unknown = args.filter((arg) => arg !== "--send");
  if (unknown.length > 0) throw new Error(`unknown argument: ${unknown[0]}`);
  if (!process.env.CLOUDFLARE_ACCOUNT_ID)
    throw new Error("set CLOUDFLARE_ACCOUNT_ID");

  const parsed = JSON.parse(execute(TRACE_LICENSING_RECIPIENTS_SQL)) as {
    results?: { recipients?: number }[];
  }[];
  const recipients = parsed[0]?.results?.[0]?.recipients;
  if (typeof recipients !== "number")
    throw new Error("could not read the recipient count");
  console.log(`${TRACE_LICENSING_EVENT_KEY}: ${recipients} recipients`);
  if (!send) {
    console.log("Dry run. Pass --send to add the notices.");
    return;
  }
  execute(withNoticeTime(TRACE_LICENSING_AVAILABLE_SQL, new Date()));
  console.log("Sent. A second run adds nothing.");
}

if (import.meta.main) main(process.argv.slice(2));
