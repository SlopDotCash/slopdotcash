/** Disposable local D1 setup for the appeal browser check; never a hosted write. */
import { execFileSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { notifySlopbotAppeal } from "../backend/notifications/events";

const quote = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;

/** Each statement is replay-safe, even if an earlier statement committed. */
export function appealSeedSql(key: string, at: string): string {
  const job = JSON.stringify({
    owner: "example",
    repo: "project",
    itemKind: "pull_request",
    number: 5,
  });
  const notice = notifySlopbotAppeal(
    {
      prepare: (query) => ({
        bind: (...values) =>
          query.replace(/\?(\d+)/gu, (_, n) => quote(values[Number(n) - 1])),
      }),
    },
    key,
    "900000004",
    at,
  );
  return `INSERT INTO slopbot_appeals(appeal_key,repository_id,item_node_id,appellant_github_id,job_json,opened_at,due_at,escalated_at,escalation)
    VALUES (${quote(key)},1,${quote(key)},'900000002',${quote(job)},${quote(at)},'2099-01-01T00:00:00.000Z',${quote(at)},'A moderator decision is required')
    ON CONFLICT (appeal_key) DO NOTHING; ${notice};`;
}

type SeedDependencies = {
  execute?: (args: string[]) => unknown;
  wait?: (milliseconds: number) => Promise<void>;
};

function isLocalSqliteBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const processError = error as Error & { status?: number; stderr?: unknown };
  if (processError.status !== 1) return false;
  const stderr = processError.stderr;
  if (typeof stderr !== "string" && !Buffer.isBuffer(stderr)) return false;
  return stripVTControlCharacters(stderr.toString())
    .split(/\r?\n/u)
    .some(
      (line) =>
        /^(?:✘\s*)?(?:\[ERROR\]\s*)?(?:D1_ERROR:\s*)?database is locked:\s*SQLITE_BUSY$/u.test(
          line.trim(),
        ) ||
        /^e = workerd\/util\/sqlite\.c\+\+:\d+: failed: SENTRY_DO SQLite failed; NOSENTRY database is locked: SQLITE_BUSY$/u.test(
          line.trim(),
        ),
    );
}

/** Four local attempts, with only 100/200/400ms backoff for SQLite contention. */
export async function runAppealFixtureSql(
  persistTo: string,
  command: string,
  {
    execute = (args) => execFileSync("node", args, { stdio: "pipe" }),
    wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }: SeedDependencies = {},
): Promise<void> {
  const args = [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    "slop-private",
    "--local",
    "--persist-to",
    persistTo,
    "--command",
    command,
  ];
  for (let attempt = 0; ; attempt++) {
    try {
      execute(args);
      return;
    } catch (error) {
      if (!isLocalSqliteBusy(error)) throw error;
      if (attempt === 3)
        throw new Error(
          "Local appeal fixture database stayed locked after four attempts.",
        );
      await wait(100 * 2 ** attempt);
    }
  }
}
