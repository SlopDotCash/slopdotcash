/** Protected operational diagnostics. Tail bodies are sanitized only in memory. */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type HistoricalIntakeFailure,
  projectHistoricalIntakeFailure,
} from "../workers/slopbot/value-import-diagnostics";

const workers = ["slop-slopbot", "slop-vetting-sandbox"] as const;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const outcomes = new Set([
  "ok",
  "exception",
  "canceled",
  "exceededCpu",
  "exceededMemory",
  "unknown",
]);
const methods = new Set(["GET", "POST", "PUT", "DELETE", "OPTIONS"]);
const stages = new Set([
  "bundle-write",
  "input-write",
  "setup",
  "supervisor-exec",
  "supervisor-result",
  "output-read",
  "output-shape",
]);
const exceptionNames = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "URIError",
  "EvalError",
  "DOMException",
  "AbortError",
  "TimeoutError",
  "DataError",
  "OperationError",
  "NotSupportedError",
  "InvalidAccessError",
  "DataCloneError",
  "QuotaExceededError",
  "GitHubError",
  "OtherError",
]);
type ExceptionFingerprint = { name: string; messageSha256: string | null };

/** A bounded exact UTF-8 message fingerprint, never its text, stack or cause. */
function exceptionFingerprint(value: unknown): ExceptionFingerprint | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const message = row.message;
  return {
    name:
      typeof row.name === "string" && exceptionNames.has(row.name)
        ? row.name
        : "OtherError",
    messageSha256:
      typeof message === "string" &&
      message.length <= 4096 &&
      Buffer.byteLength(message, "utf8") <= 4096
        ? createHash("sha256").update(message, "utf8").digest("hex")
        : null,
  };
}

/** The injectable tail transport is projected again; retain only this exact shape. */
function isExceptionFingerprint(value: unknown): value is ExceptionFingerprint {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).sort().join() === "messageSha256,name" &&
    typeof row.name === "string" &&
    exceptionNames.has(row.name) &&
    (row.messageSha256 === null ||
      (typeof row.messageSha256 === "string" &&
        /^[a-f0-9]{64}$/u.test(row.messageSha256)))
  );
}

export function intakeError(input: unknown): string {
  if (typeof input !== "string") return "unspecified";
  const value = input.replace(/^Error: /u, "");
  const stage = /^Merge reconstruction unavailable: ([a-z-]+)$/u.exec(
    value,
  )?.[1];
  if (stage && stages.has(stage)) return `merge-${stage}`;
  const supervisor =
    /^Merge reconstruction unavailable: supervisor-(exited|timeout|disk-limit|output-limit|not-executable)-(-?\d{1,3})$/u.exec(
      value,
    );
  if (supervisor && Math.abs(Number(supervisor[2])) <= 255)
    return `merge-supervisor-${supervisor[1]}`;
  if (value === "historical value import failure") return "publication-failed";
  if (value === "historical value import session failure")
    return "session-failed";
  if (/too many subrequests|subrequest limit/iu.test(value))
    return "subrequest-limit";
  const githubStatus =
    /(?:GitHub|GET|POST)[^\n]*\b(401|403|404|429|500|502|503|504)\b/iu.exec(
      value,
    );
  if (githubStatus) return `github-http-${githubStatus[1]}`;
  if (
    /source (?:identity|metadata) changed|recovery source metadata changed/iu.test(
      value,
    )
  )
    return "source-metadata-changed";
  if (/rate.?limit|\b429\b/iu.test(value)) return "rate-limit";
  if (/\b(?:401|403)\b|unauthorized|forbidden/iu.test(value))
    return "authorization";
  if (/cpu|memory limit/iu.test(value)) return "resource-limit";
  if (/timeout|timed out|abort/iu.test(value)) return "timeout";
  if (/GitHub|source|metadata|assessment|predecessor/iu.test(value))
    return "source-or-assessment";
  if (/RPC|disconnected|connection/iu.test(value)) return "rpc-connection";
  return "other";
}

export function sanitizeIntakeTail(value: any) {
  if (!value || typeof value !== "object") return null;
  const row: Record<string, unknown> = {};
  if (outcomes.has(value.outcome)) row.outcome = value.outcome;
  const event = value.event;
  const method = event?.request?.method ?? value.method;
  if (methods.has(method)) row.method = method;
  const status = event?.response?.status ?? value.httpStatus;
  if (Number.isInteger(status) && status >= 100 && status <= 599)
    row.httpStatus = status;
  const labels: string[] = [];
  const intakeFailures: HistoricalIntakeFailure[] = (
    Array.isArray(value.historicalIntakeFailures)
      ? value.historicalIntakeFailures.slice(0, 20)
      : []
  )
    .map(projectHistoricalIntakeFailure)
    .filter(
      (v: HistoricalIntakeFailure | null): v is HistoricalIntakeFailure =>
        v !== null,
    );
  const fingerprints: ExceptionFingerprint[] = (
    Array.isArray(value.exceptionFingerprints)
      ? value.exceptionFingerprints.slice(0, 20)
      : []
  )
    .filter(isExceptionFingerprint)
    .map((entry: ExceptionFingerprint) => ({ ...entry }));
  const safeCategories =
    /^(?:unspecified|merge-(?:bundle-write|input-write|setup|supervisor-exec|supervisor-result|output-read|output-shape)|merge-supervisor-(?:exited|timeout|disk-limit|output-limit|not-executable)|publication-failed|session-failed|subrequest-limit|github-http-(?:401|403|404|429|500|502|503|504)|source-metadata-changed|rate-limit|authorization|resource-limit|timeout|source-or-assessment|rpc-connection|other)$/u;
  for (const category of Array.isArray(value.categories)
    ? value.categories.slice(0, 20)
    : []) {
    if (typeof category === "string" && safeCategories.test(category))
      labels.push(category);
  }
  for (const entry of Array.isArray(value.exceptions)
    ? value.exceptions.slice(0, 20)
    : []) {
    labels.push(intakeError(entry?.message));
    const fingerprint = exceptionFingerprint(entry);
    if (fingerprint && fingerprints.length < 20) fingerprints.push(fingerprint);
  }
  for (const entry of Array.isArray(value.logs)
    ? value.logs.slice(0, 50)
    : []) {
    for (const message of Array.isArray(entry?.message)
      ? entry.message.slice(0, 10)
      : []) {
      let structured: unknown = message;
      if (typeof message === "string" && message.length <= 8192) {
        try {
          structured = JSON.parse(message);
        } catch {
          /* Raw text never retained. */
        }
      }
      const failure = projectHistoricalIntakeFailure(structured);
      if (failure) {
        if (intakeFailures.length < 20) intakeFailures.push(failure);
        continue;
      }
      if (typeof message === "string") labels.push(intakeError(message));
    }
  }
  if (labels.length) row.categories = [...new Set(labels)];
  if (fingerprints.length) row.exceptionFingerprints = fingerprints;
  if (intakeFailures.length) row.historicalIntakeFailures = intakeFailures;
  return Object.keys(row).length ? row : null;
}

class DiagnosticFailure extends Error {
  constructor(
    readonly stage: string,
    readonly httpStatus?: number,
    readonly providerCode?: number,
  ) {
    super("Intake diagnostic unavailable");
  }
}

async function boundedJson(response: Response) {
  if (!response.body) throw Error("Missing response");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 1024 * 1024) throw Error("Response limit");
      parts.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function readIntakeTail(url: string, seconds = 180): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const records: unknown[] = [];
    const socket = new WebSocket(url, "trace-v1");
    socket.binaryType = "arraybuffer";
    let complete = false;
    let opened = false;
    const finish = (failed: boolean) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      socket.close();
      if (failed || !opened) reject(Error("Tail transport unavailable"));
      else resolve(records);
    };
    const timer = setTimeout(() => finish(false), seconds * 1000);
    socket.addEventListener("open", () => {
      opened = true;
      try {
        socket.send(JSON.stringify({ debug: false }));
      } catch {
        finish(true);
      }
    });
    socket.addEventListener("message", (message) => {
      try {
        const raw =
          typeof message.data === "string"
            ? message.data
            : new TextDecoder().decode(message.data as ArrayBuffer);
        if (raw.length > 1024 * 1024) return;
        const record = sanitizeIntakeTail(JSON.parse(raw));
        if (record && records.length < 200) records.push(record);
      } catch {
        /* No untrusted tail bytes are retained. */
      }
    });
    socket.addEventListener("error", () => finish(true));
    socket.addEventListener("close", () => finish(true));
  });
}

export async function inspectValueIntake(input: {
  account: string;
  token: string;
  request?: typeof fetch;
  tail?: (url: string) => Promise<unknown[]>;
}) {
  if (!/^[a-f0-9]{32}$/u.test(input.account) || !input.token)
    throw Error("Diagnostic credentials unavailable");
  const request = input.request ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/accounts/${input.account}`;
  async function api(
    path: string,
    stage: string,
    method = "GET",
    body?: unknown,
  ) {
    let response: Response;
    try {
      response = await request(base + path, {
        method,
        headers: {
          authorization: `Bearer ${input.token}`,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new DiagnosticFailure(stage);
    }
    let result: any;
    try {
      result = await boundedJson(response);
    } catch {
      throw new DiagnosticFailure(stage, response.status);
    }
    if (!response.ok || result?.success !== true) {
      const code = result?.errors?.[0]?.code;
      throw new DiagnosticFailure(
        stage,
        response.status,
        Number.isSafeInteger(code) && code >= 0 ? code : undefined,
      );
    }
    return result.result;
  }
  async function inspect(target: (typeof workers)[number] | "pages") {
    let stage = "deployment-read";
    const observations: unknown[] = [];
    let binding: { deploymentId: string; versionId?: string } | undefined;
    try {
      const path =
        target === "pages"
          ? "/pages/projects/eliza-computer"
          : `/workers/scripts/${target}/deployments`;
      const metadata = await api(path, stage);
      if (target === "pages") {
        const deployment = metadata?.canonical_deployment;
        if (
          !uuid.test(deployment?.id ?? "") ||
          deployment.environment !== "production"
        )
          throw new DiagnosticFailure(stage);
        binding = { deploymentId: deployment.id };
      } else {
        const deployment = metadata?.deployments?.[0];
        if (
          !uuid.test(deployment?.id ?? "") ||
          deployment.versions?.length !== 1 ||
          !uuid.test(deployment.versions[0].version_id ?? "") ||
          deployment.versions[0].percentage !== 100
        )
          throw new DiagnosticFailure(stage);
        binding = {
          deploymentId: deployment.id,
          versionId: deployment.versions[0].version_id,
        };
      }
      const tailPath =
        target === "pages"
          ? `/pages/projects/eliza-computer/deployments/${binding.deploymentId}/tails`
          : `/workers/scripts/${target}/tails`;
      stage = "tail-create";
      const tail = await api(
        tailPath,
        stage,
        "POST",
        target === "pages"
          ? {}
          : { filters: [{ scriptVersion: binding.versionId }] },
      );
      if (!/^[a-zA-Z0-9-]{1,128}$/u.test(tail?.id ?? ""))
        throw new DiagnosticFailure(stage);
      try {
        stage = "tail-transport";
        const url = new URL(tail.url);
        if (
          url.protocol !== "wss:" ||
          !(
            url.hostname.endsWith(".cloudflare.com") ||
            url.hostname.endsWith(".workers.dev")
          ) ||
          url.username ||
          url.password
        )
          throw new DiagnosticFailure(stage);
        const records = await (input.tail ?? readIntakeTail)(url.href);
        // Injectable transport output goes through the same fixed projection.
        for (const record of records.slice(0, 200)) {
          const safe = sanitizeIntakeTail(record);
          if (safe) observations.push(safe);
        }
      } finally {
        await api(`${tailPath}/${tail.id}`, "tail-delete", "DELETE");
      }
      stage = "deployment-recheck";
      const after = await api(path, stage);
      const active =
        target === "pages"
          ? after?.canonical_deployment?.id
          : after?.deployments?.[0]?.id;
      if (active !== binding.deploymentId) throw new DiagnosticFailure(stage);
      return {
        target,
        ...binding,
        observations,
        complete: true,
        failure: undefined,
      };
    } catch (error) {
      const failure =
        error instanceof DiagnosticFailure
          ? error
          : new DiagnosticFailure(stage);
      return {
        target,
        ...binding,
        observations,
        complete: false,
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
  return {
    checkedAt: new Date().toISOString(),
    tailSeconds: 180,
    rawLogsRetained: false,
    targets: await Promise.all([...workers, "pages" as const].map(inspect)),
  };
}

if (import.meta.main) {
  if (process.env.GITHUB_REF !== "refs/heads/main" || !process.env.RUNNER_TEMP)
    throw Error("Main runner required");
  const result = await inspectValueIntake({
    account: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    token: process.env.CLOUDFLARE_API_TOKEN ?? "",
  });
  writeFileSync(
    join(process.env.RUNNER_TEMP, "value-intake-diagnostic.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
  if (result.targets.some((target) => !target.complete)) process.exitCode = 1;
}
