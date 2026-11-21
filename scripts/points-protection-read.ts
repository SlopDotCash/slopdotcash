/**
 * The points generator's private read of the protected project months
 * (operator decision, 21 November 2026; PRD section 7).
 *
 * `data/points/protected-months.json` used to be the only list of months the
 * generator holds, and had to be edited by hand whenever a project month got
 * its first payment record. A trusted production release now also asks the
 * site's private route, which answers from the same tables and clauses as the
 * Points import's own guard, and holds the union of both lists.
 *
 * The read is an addition, never a requirement. Without both environment
 * values the generator uses the committed list alone, as before. A refused,
 * failed or invalid read is one warning and the committed list alone; the
 * import guard still refuses a batch that changes a protected award. The
 * token is sent only in the request's Authorization header and is never part
 * of any message. Protected months are private, so nothing here prints them
 * or counts them.
 */
import {
  PROTECTED_POINT_MONTHS_PATH,
  PROTECTED_POINT_MONTHS_SCHEMA,
} from "../backend/payments/protected-point-months";
import { readBoundedJson } from "../src/lib/browser-json";

export interface ProtectedPointMonth {
  projectId: string;
  period: string;
}

/** What the generator holds: project months, and whole projects. */
export interface PointProtection {
  months: ProtectedPointMonth[];
  /** Projects protected in every month. */
  projects: string[];
}

export interface PointProtectionEnvironment {
  POINTS_PROTECTION_URL?: string;
  POINTS_PROTECTION_TOKEN?: string;
}

const MAX_ANSWER_BYTES = 1024 * 1024;
const MAX_ENTRIES = 20_000;
const MAX_PROJECT_ID_LENGTH = 200;
const PERIOD = /^\d{4}-(?:0[1-9]|1[0-2])$/u;

/** A refusal whose reason is safe to print: a fixed phrase or a status. */
class ProtectionReadRefusal extends Error {}

function record(value: unknown, keys: readonly string[]) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ProtectionReadRefusal("invalid answer");
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...keys].sort()))
    throw new ProtectionReadRefusal("invalid answer");
  return value as Record<string, unknown>;
}

function projectId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_PROJECT_ID_LENGTH ||
    value.includes("\0")
  )
    throw new ProtectionReadRefusal("invalid answer");
  return value;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES)
    throw new ProtectionReadRefusal("invalid answer");
  return value;
}

/** Accepts exactly the route's answer shape; anything else is refused. */
export function parseProtectedPointMonths(value: unknown): PointProtection {
  const answer = record(value, [
    "schema",
    "generatedAt",
    "months",
    "everyMonthProjects",
  ]);
  if (
    answer.schema !== PROTECTED_POINT_MONTHS_SCHEMA ||
    typeof answer.generatedAt !== "string" ||
    Number.isNaN(Date.parse(answer.generatedAt))
  )
    throw new ProtectionReadRefusal("invalid answer");
  return {
    months: list(answer.months).map((entry) => {
      const month = record(entry, ["projectId", "period"]);
      if (typeof month.period !== "string" || !PERIOD.test(month.period))
        throw new ProtectionReadRefusal("invalid answer");
      return { projectId: projectId(month.projectId), period: month.period };
    }),
    projects: list(answer.everyMonthProjects).map(projectId),
  };
}

/**
 * One bounded request to the private route. Null when the read is not
 * configured. `origin` is the site this build publishes to: the address must
 * be that site's own route, so the token is never sent anywhere else.
 */
export async function readPrivatePointProtection(
  environment: PointProtectionEnvironment,
  origin: string,
  request: typeof fetch = fetch,
): Promise<PointProtection | null> {
  const address = environment.POINTS_PROTECTION_URL;
  const token = environment.POINTS_PROTECTION_TOKEN;
  if (!address || !token) return null;
  if (address !== `${origin}${PROTECTED_POINT_MONTHS_PATH}`)
    throw new ProtectionReadRefusal(
      "the address is not this site's protected-point-months route",
    );
  const response = await request(address, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
    cache: "no-store",
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new ProtectionReadRefusal(`HTTP ${response.status}`);
  }
  let value: unknown;
  try {
    value = await readBoundedJson(
      response,
      MAX_ANSWER_BYTES,
      "protected point months",
    );
  } catch (error) {
    if (error instanceof RangeError)
      throw new ProtectionReadRefusal("answer too large");
    // A timeout while reading the body keeps its own name below.
    if (error instanceof Error && error.name !== "Error") throw error;
    throw new ProtectionReadRefusal("invalid answer");
  }
  return parseProtectedPointMonths(value);
}

/** A printable reason: a refusal's fixed phrase, or only an error's class. */
function reason(error: unknown): string {
  if (error instanceof ProtectionReadRefusal) return error.message;
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z]{1,40}$/u.test(name) ? name : "Error";
}

/**
 * The months and projects to hold: the committed list, plus the private
 * route's answer when the read is configured and succeeds.
 */
export async function resolvePointProtection(
  committed: readonly ProtectedPointMonth[],
  environment: PointProtectionEnvironment,
  origin: string,
  options: {
    request?: typeof fetch;
    warn?: (line: string) => void;
    log?: (line: string) => void;
  } = {},
): Promise<PointProtection> {
  const fileOnly = { months: [...committed], projects: [] };
  let read: PointProtection | null;
  try {
    read = await readPrivatePointProtection(
      environment,
      origin,
      options.request,
    );
  } catch (error) {
    (options.warn ?? console.warn)(
      `[points] private protected-months read failed (${reason(error)}); holding by data/points/protected-months.json only`,
    );
    return fileOnly;
  }
  if (read === null) {
    // A trusted production build always has the address. Saying that its
    // token is unset makes the release log show which list was used.
    if (environment.POINTS_PROTECTION_URL)
      (options.log ?? console.log)(
        "[points] private protected-months read is not configured (no token); holding by data/points/protected-months.json only",
      );
    return fileOnly;
  }
  (options.log ?? console.log)(
    "[points] holding by data/points/protected-months.json and the private protected-months record",
  );
  const months = new Map<string, ProtectedPointMonth>();
  for (const month of [...committed, ...read.months])
    months.set(`${month.projectId}\0${month.period}`, month);
  return {
    months: [...months.values()],
    projects: [...new Set(read.projects)],
  };
}
