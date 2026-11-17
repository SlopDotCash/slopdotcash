/** PRD 9/11: inspect retained fixed-schema failures, never raw log bodies. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBoundedJson } from "../src/lib/browser-json";
import { projectHistoricalIntakeFailure } from "../workers/slopbot/value-import-diagnostics";

const worker = "slop-slopbot";
const maximumEvents = 200;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function intakeHistoryWindow(
  from: string,
  to: string,
  now = Date.now(),
) {
  const parse = (value: string) => {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(value))
      throw new Error("Invalid intake history window");
    const date = new Date(value);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString() !==
        (value.includes(".") ? value : value.replace(/Z$/u, ".000Z"))
    )
      throw new Error("Invalid intake history window");
    return date.getTime();
  };
  const start = parse(from),
    end = parse(to);
  if (
    !Number.isSafeInteger(now) ||
    start >= end ||
    end > now ||
    end - start > 15 * 60_000 ||
    start < now - 24 * 60 * 60_000
  )
    throw new Error("Invalid intake history window");
  return { from: start, to: end };
}

/** The caller cannot choose a dataset, Worker, predicate, cursor or query body. */
export function intakeHistoryQuery(timeframe: { from: number; to: number }) {
  return {
    queryId: "slop-fixed-intake-failures-v1",
    timeframe,
    dry: true,
    view: "events",
    limit: maximumEvents,
    parameters: {
      datasets: ["cloudflare-workers"],
      filterCombination: "and",
      filters: [
        {
          key: "$metadata.service",
          operation: "eq",
          type: "string",
          value: worker,
        },
      ],
      needle: {
        value: "historical-intake-failure",
        isRegex: false,
        matchCase: true,
      },
    },
  };
}

/** Accept one unambiguous existing seven-field event; discard all other text. */
export function storedIntakeFailure(
  value: unknown,
  timeframe: { from: number; to: number },
) {
  const row = object(value);
  const metadata = object(row?.$metadata);
  if (
    !row ||
    metadata?.service !== worker ||
    typeof row.timestamp !== "number" ||
    !Number.isSafeInteger(row.timestamp) ||
    row.timestamp < timeframe.from ||
    row.timestamp > timeframe.to
  )
    return null;
  const source = row.source;
  const candidates = [source, object(source)?.message, metadata?.message];
  const unique = new Map<
    string,
    NonNullable<ReturnType<typeof projectHistoricalIntakeFailure>>
  >();
  for (const candidate of candidates) {
    let decoded: unknown = candidate;
    if (typeof candidate === "string") {
      if (candidate.length > 8192) continue;
      try {
        decoded = JSON.parse(candidate);
      } catch {
        continue;
      }
    }
    const safe = projectHistoricalIntakeFailure(decoded);
    if (safe) unique.set(JSON.stringify(safe), safe);
  }
  if (unique.size !== 1) return null;
  return { timestamp: row.timestamp, failure: [...unique.values()][0] };
}

class HistoryReadFailure extends Error {
  constructor(
    readonly stage: string,
    readonly httpStatus?: number,
    readonly providerCode?: number,
  ) {
    super("Intake history inspection unavailable");
  }
}

export async function inspectValueIntakeHistory(input: {
  account: string;
  token: string;
  from: string;
  to: string;
  now?: number;
  request?: typeof fetch;
}) {
  const timeframe = intakeHistoryWindow(input.from, input.to, input.now);
  if (!/^[a-f0-9]{32}$/u.test(input.account) || !input.token.trim())
    throw new Error("Intake history authority unavailable");
  const request = input.request ?? fetch;
  const api = async (path: string, stage: string, body?: unknown) => {
    let response: Response;
    try {
      response = await request(
        `https://api.cloudflare.com/client/v4/accounts/${input.account}${path}`,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            authorization: `Bearer ${input.token}`,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        },
      );
    } catch {
      throw new HistoryReadFailure(stage);
    }
    let value: Record<string, unknown> | null;
    try {
      value = object(
        await readBoundedJson(response, 1_048_576, "intake history"),
      );
    } catch {
      throw new HistoryReadFailure(stage, response.status);
    }
    if (!response.ok || value?.success !== true) {
      const errors = value?.errors;
      const code = Array.isArray(errors) ? object(errors[0])?.code : undefined;
      throw new HistoryReadFailure(
        stage,
        response.status,
        typeof code === "number" && Number.isSafeInteger(code) && code >= 0
          ? code
          : undefined,
      );
    }
    return value?.result;
  };
  const active = async (stage: string) => {
    const result = object(
      await api(`/workers/scripts/${worker}/deployments`, stage),
    );
    const deployments = result?.deployments;
    const current = Array.isArray(deployments) ? object(deployments[0]) : null;
    const versions = current?.versions;
    const selected =
      Array.isArray(versions) && versions.length === 1
        ? object(versions[0])
        : null;
    if (
      typeof current?.id !== "string" ||
      !uuid.test(current.id) ||
      selected?.percentage !== 100 ||
      typeof selected.version_id !== "string" ||
      !uuid.test(selected.version_id)
    )
      throw new HistoryReadFailure(stage);
    return {
      deploymentId: current.id,
      versionId: selected.version_id,
    };
  };
  const base = {
    checkedAt: new Date().toISOString(),
    worker,
    timeframe,
    rawLogsRetained: false,
    queryDry: true,
    maximumEvents,
    attribution:
      "Bounded retained observations only; no private request or source identity is inferred.",
  };
  try {
    const before = await active("deployment-read");
    const result = object(
      await api(
        "/workers/observability/telemetry/query",
        "history-query",
        intakeHistoryQuery(timeframe),
      ),
    );
    const run = object(result?.run);
    const events = object(result?.events);
    const rows = events?.events;
    const count = events?.count;
    if (
      run?.status !== "COMPLETED" ||
      run.dry !== true ||
      !Array.isArray(rows) ||
      rows.length > maximumEvents ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < rows.length ||
      count > 1_000_000
    )
      throw new HistoryReadFailure("history-shape");
    const observations = rows
      .map((row) => storedIntakeFailure(row, timeframe))
      .filter((row) => row !== null);
    const after = await active("deployment-recheck");
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new HistoryReadFailure("deployment-recheck");
    return {
      ...base,
      ...before,
      complete:
        count === rows.length &&
        rows.length < maximumEvents &&
        observations.length === rows.length,
      matchedEvents: count,
      returnedEvents: rows.length,
      rejectedEvents: rows.length - observations.length,
      observations,
    };
  } catch (error) {
    const failure =
      error instanceof HistoryReadFailure
        ? error
        : new HistoryReadFailure("history-read");
    return {
      ...base,
      complete: false,
      observations: [],
      failure: {
        stage: failure.stage,
        ...(failure.httpStatus === undefined
          ? {}
          : { httpStatus: failure.httpStatus }),
        ...(failure.providerCode === undefined
          ? {}
          : { providerCode: failure.providerCode }),
      },
    };
  }
}

if (import.meta.main) {
  if (process.env.GITHUB_REF !== "refs/heads/main" || !process.env.RUNNER_TEMP)
    throw new Error("Main runner required");
  const result = await inspectValueIntakeHistory({
    account: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    token: process.env.CLOUDFLARE_API_TOKEN ?? "",
    from: process.env.SLOP_INTAKE_HISTORY_FROM ?? "",
    to: process.env.SLOP_INTAKE_HISTORY_TO ?? "",
  });
  writeFileSync(
    join(process.env.RUNNER_TEMP, "value-intake-history.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
  if (!result.complete) process.exitCode = 1;
}
