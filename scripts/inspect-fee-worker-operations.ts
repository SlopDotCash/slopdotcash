/** Fixed read-only fee diagnostics. Raw tail messages never leave memory. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeProviderFailure } from "../workers/fee-converter/core";
import { inspectFeeWorkerBindings } from "./inspect-fee-worker-bindings";

const worker = "slop-fee-converter";
const networks = new Set(["base", "ethereum", "robinhood", "solana"]);
const events = new Set([
  "fee_converter_run",
  "fee_converter_network_error",
  "fee_buyback_error",
  "fee_bridge_arrived",
  "fee_bridge_refunded",
  "fee_conversion_error",
  "fee_conversion_reconcile_error",
  "fee_conversion_lock_lost",
  "fee_conversion_not_converted",
  "fee_balance_unavailable",
  "fee_send_waiting",
  "fee_send_replaced",
  "fee_claim_skipped",
  "fee_claim_quoted",
  "fee_claim_included",
  "fee_claim_error",
  "fee_claim_finalized",
]);
const outcomes = new Set([
  "ok",
  "canceled",
  "exceededCpu",
  "exceededMemory",
  "exception",
  "unknown",
]);
const buybackLegs = new Set(["bridge", "arrival", "refund", "burn"]);
const states = new Set([
  "ran",
  "locked",
  "not_converted",
  "quoted",
  "pending",
  "skipped",
  "no_route",
  "submitted",
  "finalized",
  "failed",
  "unknown",
]);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const queries = {
  locks:
    "SELECT network,expires_at,gas_revision FROM fee_converter_locks ORDER BY network LIMIT 4",
  gas: "SELECT network,state,maximum_wei,actual_wei,created_at,settled_day FROM fee_native_gas WHERE created_at >= ? OR (state IN ('reserved','signed') AND actual_wei IS NULL) ORDER BY created_at DESC LIMIT 500",
  attempts:
    "SELECT network,kind,state,created_at,reason FROM fee_conversions WHERE created_at >= ? OR state IN ('submitted','unknown') ORDER BY created_at DESC LIMIT 100",
};

export function feeErrorCategory(value: unknown): string {
  if (typeof value !== "string") return "unspecified";
  const message = value.toLowerCase();
  if (
    /^unexpected (?:token|end)|json (?:parse|parsing)|is not valid json|unparseable response/.test(
      message,
    )
  )
    return "response-json";
  if (
    /^invalid rpc (?:object|string|list)|^cannot read properties of (?:undefined|null)|^undefined is not an object/.test(
      message,
    )
  )
    return "rpc-shape";
  if (
    /not a supported token program account|truncated (?:mint|token)|classic (?:mint|token).*mismatch|unsupported token-2022|duplicate token-2022|^token account (?:data is unavailable|is malformed)|^duplicate fee token account|^fee token holding differs/.test(
      message,
    )
  )
    return "unsupported-token-account";
  if (/\bblocked\b|access denied|not allowed|not permitted/.test(message))
    return "rpc-blocked";
  if (/401|403|unauthorized|forbidden|authentication/.test(message))
    return "authentication";
  if (/below the minimum/.test(message)) return "below-minimum";
  if (/gas-cost multiple/.test(message)) return "below-gas-multiple";
  if (/429|rate.?limit/.test(message)) return "rpc-rate-limit";
  if (/timeout|timed out|abort/.test(message)) return "timeout";
  if (/^jupiter /.test(message)) return "quote-provider";
  if (
    /^bridge (?:row lacks|quote differs)|^signed bridge order differs|^dln (?:order|proposal|response)|^robinhood chain order status is unavailable/.test(
      message,
    )
  )
    return "bridge-verification";
  if (/recovery|full.history|independent/.test(message))
    return "recovery-proof";
  if (/key|signer|seed/.test(message)) return "signer-configuration";
  if (/reviewed.*project|project.*reviewed/.test(message))
    return "project-readiness";
  if (/deploy|authority|program|code hash|mint|vault/.test(message))
    return "deployment-verification";
  if (/native|lamport|insufficient|budget|ceiling/.test(message))
    return "native-budget";
  if (/\b(?:locked|lease)\b/.test(message)) return "lease";
  if (/^solana |rpc|fetch|connect|http|network/.test(message))
    return "rpc-unavailable";
  return "other";
}

/** Preserve only a known method from the fee client's fixed error prefix. */
export function feeRpcMethod(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const match =
    /^Solana (getAccountInfo|getMultipleAccounts|getBalance|getTokenAccountsByOwner|getGenesisHash|getLatestBlockhash|getBlockHeight|getFeeForMessage|simulateTransaction|getSignatureStatuses|getSignaturesForAddress|getTransaction|getBlock|sendTransaction):/.exec(
      value,
    );
  return match?.[1];
}

/** Only enumerated labels and numeric counts from this Worker's events survive. */
export function sanitizeFeeTail(value: any) {
  if (value?.scriptName !== worker) return null;
  const records: Record<string, unknown>[] = [];
  for (const log of Array.isArray(value.logs) ? value.logs : []) {
    for (const message of Array.isArray(log.message) ? log.message : []) {
      let event: any = message;
      if (typeof message === "string") {
        try {
          event = JSON.parse(message);
        } catch {
          continue;
        }
      }
      if (!events.has(event?.event)) continue;
      const row: Record<string, unknown> = { event: event.event };
      if (networks.has(event.network)) row.network = event.network;
      if (event.event === "fee_buyback_error" && buybackLegs.has(event.leg))
        row.leg = event.leg;
      if (
        event.event === "fee_buyback_error" &&
        typeof event.leg === "string" &&
        /^buyback 0x[a-fA-F0-9]{40}$/u.test(event.leg)
      )
        row.leg = "buyback";
      const publicAddress = (value: unknown) =>
        networks.has(event.network) &&
        typeof value === "string" &&
        (event.network === "solana"
          ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(value)
          : /^0x[a-fA-F0-9]{40}$/u.test(value));
      if (publicAddress(event.token)) row.token = event.token;
      if (publicAddress(event.vault)) row.vault = event.vault;
      if (event.reason !== undefined || event.error !== undefined) {
        const reason = event.reason ?? event.error;
        row.errorCategory = feeErrorCategory(reason);
        const method = feeRpcMethod(reason);
        if (method) row.rpcMethod = method;
      }
      if (
        event.event === "fee_claim_error" ||
        event.event === "fee_conversion_error" ||
        (event.event === "fee_buyback_error" &&
          event.network === "solana" &&
          event.leg === "bridge")
      ) {
        const failure = sanitizeProviderFailure(event.providerFailure);
        if (failure) row.providerFailure = failure;
      }
      if (event.event === "fee_converter_run") {
        row.trigger =
          event.trigger === "recovery"
            ? "recovery"
            : event.trigger === "receipts"
              ? "receipts"
              : "unknown";
        row.results = (Array.isArray(event.results) ? event.results : [])
          .slice(0, 4)
          .flatMap((result: any) => {
            if (!networks.has(result?.network)) return [];
            return [
              {
                network: result.network,
                status: states.has(result.status) ? result.status : "unknown",
                claimed:
                  Number.isSafeInteger(result.claimed) && result.claimed >= 0
                    ? result.claimed
                    : null,
                reconciled:
                  Number.isSafeInteger(result.reconciled) &&
                  result.reconciled >= 0
                    ? result.reconciled
                    : null,
              },
            ];
          });
      }
      records.push(row);
    }
  }
  return {
    outcome: outcomes.has(value.outcome) ? value.outcome : "unknown",
    exceptionCategories: (Array.isArray(value.exceptions)
      ? value.exceptions
      : []
    )
      .slice(0, 10)
      .map((entry: any) => feeErrorCategory(entry?.message)),
    records: records.slice(0, 100),
  };
}

export function summarizeFeeDatabase(
  rows: { locks: any[]; gas: any[]; attempts: any[] },
  now: string,
) {
  const uint = (value: unknown) =>
    typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
  const gas = new Map<
    string,
    {
      network: string;
      state: string;
      count: number;
      maximum: bigint;
      settled: bigint;
    }
  >();
  for (const row of rows.gas) {
    if (
      !networks.has(row.network) ||
      !["reserved", "signed", "abandoned"].includes(row.state) ||
      !uint(row.maximum_wei) ||
      (row.actual_wei !== null && !uint(row.actual_wei))
    )
      throw Error("Unexpected fee native-gas row");
    const key = `${row.network}/${row.state}`;
    const total = gas.get(key) ?? {
      network: row.network,
      state: row.state,
      count: 0,
      maximum: 0n,
      settled: 0n,
    };
    total.count++;
    total.maximum += BigInt(row.maximum_wei);
    total.settled += BigInt(row.actual_wei ?? "0");
    gas.set(key, total);
  }
  return {
    locks: rows.locks.map((row) => {
      if (
        !networks.has(row.network) ||
        !timestamp(row.expires_at) ||
        !Number.isSafeInteger(row.gas_revision)
      )
        throw Error("Unexpected fee lock row");
      return {
        network: row.network,
        expiresAt: row.expires_at,
        active: row.expires_at >= now,
        gasRevision: row.gas_revision,
      };
    }),
    gas: [...gas.values()].map((row) => ({
      network: row.network,
      state: row.state,
      count: row.count,
      maximumBase: row.maximum.toString(),
      settledBase: row.settled.toString(),
    })),
    gasRowsLimited: rows.gas.length === 500,
    attempts: rows.attempts.map((row) => {
      if (
        !networks.has(row.network) ||
        ![
          "conversion",
          "claim",
          "approval",
          "bridge",
          "buyback",
          "burn",
        ].includes(row.kind) ||
        !states.has(row.state) ||
        !timestamp(row.created_at)
      )
        throw Error("Unexpected fee attempt row");
      return {
        network: row.network,
        kind: row.kind,
        state: row.state,
        createdAt: row.created_at,
        errorCategory: feeErrorCategory(row.reason),
      };
    }),
    attemptRowsLimited: rows.attempts.length === 100,
  };
}

export async function inspectFeeOperations(input: {
  account: string;
  token: string;
  database: string;
  versionId: string;
  request?: typeof fetch;
  tail?: (url: string) => Promise<unknown[]>;
}) {
  if (
    !/^[a-f0-9]{32}$/.test(input.account) ||
    !input.token ||
    !/^[a-f0-9-]{36}$/.test(input.database) ||
    !/^[a-f0-9-]{36}$/.test(input.versionId)
  )
    throw Error("Invalid diagnostic binding");
  const request = input.request ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/accounts/${input.account}`;
  let stage = "database-binding";
  let completedReads: Record<string, unknown> = {};
  async function api(path: string, body?: unknown) {
    const response = await request(base + path, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const result = (await response.json()) as any;
    if (result.success !== true) throw Error("Fee diagnostic API refused");
    return result.result;
  }
  try {
    const version = await api(
      `/workers/scripts/${worker}/versions/${input.versionId}`,
    );
    const databaseBinding = version?.resources?.bindings?.filter(
      (binding: any) => binding.name === "FEE_DB",
    );
    if (
      version?.id !== input.versionId ||
      databaseBinding?.length !== 1 ||
      databaseBinding[0].type !== "d1" ||
      databaseBinding[0].id !== input.database
    )
      throw Error("Fee database binding mismatch");
    stage = "schedule-read";
    const now = new Date().toISOString();
    const since = new Date(Date.parse(now) - 86400000).toISOString();
    const schedules = await api(`/workers/scripts/${worker}/schedules`);
    const crons = schedules?.schedules?.map((row: any) => row.cron);
    if (
      !Array.isArray(crons) ||
      crons.length > 100 ||
      crons.some(
        (cron: unknown) =>
          typeof cron !== "string" || !/^[0-9*,/ -]{1,100}$/.test(cron),
      )
    )
      throw Error("Fee schedule unavailable");
    const rows: any = {};
    for (const [name, sql] of Object.entries(queries)) {
      stage = `${name}-query`;
      const result = await api(`/d1/database/${input.database}/query`, {
        sql,
        params: name === "locks" ? [] : [since],
      });
      if (
        !Array.isArray(result) ||
        result.length !== 1 ||
        result[0].success !== true ||
        !Array.isArray(result[0].results)
      )
        throw Error("Fee diagnostic query refused");
      rows[name] = result[0].results;
    }
    completedReads = {
      checkedAt: now,
      worker,
      versionId: input.versionId,
      schedules: crons,
      expectedEveryMinute: crons.length === 1 && crons[0] === "* * * * *",
      database: summarizeFeeDatabase(rows, now),
    };
    stage = "tail-create";
    const tail = await api(`/workers/scripts/${worker}/tails`, {
      filters: [{ scriptVersion: input.versionId }],
    });
    if (!/^[a-zA-Z0-9-]+$/.test(tail?.id ?? "") || typeof tail.url !== "string")
      throw Error("Fee tail unavailable");
    stage = "tail-transport";
    let observed: unknown[];
    let cleanupFailed = false;
    let tailFailed = false;
    try {
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
        throw Error("Unexpected fee tail transport");
      observed = input.tail
        ? await input.tail(tail.url)
        : await new Promise<unknown[]>((resolve, reject) => {
            const safe: unknown[] = [];
            const socket = new WebSocket(tail.url, "trace-v1");
            socket.binaryType = "arraybuffer";
            const timer = setTimeout(() => {
              socket.close();
              resolve(safe);
            }, 90000);
            socket.addEventListener("open", () =>
              socket.send(JSON.stringify({ debug: false })),
            );
            socket.addEventListener("message", (message) => {
              try {
                const raw =
                  typeof message.data === "string"
                    ? message.data
                    : new TextDecoder().decode(message.data as ArrayBuffer);
                if (raw.length > 1024 * 1024) return;
                const item = sanitizeFeeTail(JSON.parse(raw));
                if (item && safe.length < 100) safe.push(item);
              } catch {
                /* Raw transport content is discarded. */
              }
            });
            socket.addEventListener("error", () => {
              clearTimeout(timer);
              socket.close();
              reject(Error("Fee tail transport failed"));
            });
          });
    } catch (error) {
      tailFailed = true;
      throw error;
    } finally {
      if (!tailFailed) stage = "tail-delete";
      const response = await request(
        `${base}/workers/scripts/${worker}/tails/${tail.id}`,
        {
          method: "DELETE",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: { authorization: `Bearer ${input.token}` },
        },
      );
      const deleted = (await response.json().catch(() => null)) as {
        success?: boolean;
      } | null;
      cleanupFailed = !response.ok || deleted?.success !== true;
    }
    if (cleanupFailed) throw Error("Fee tail cleanup failed");
    stage = "database-summary";
    return {
      checkedAt: now,
      worker,
      versionId: input.versionId,
      schedules: crons,
      expectedEveryMinute: crons.length === 1 && crons[0] === "* * * * *",
      database: summarizeFeeDatabase(rows, now),
      tailSeconds: 90,
      observations: observed,
      rawLogsRetained: false,
    };
  } catch (error) {
    throw new FeeDiagnosticFailure(
      stage,
      feeErrorCategory(error instanceof Error ? error.message : undefined),
      completedReads,
    );
  }
}

export class FeeDiagnosticFailure extends Error {
  constructor(
    readonly stage: string,
    readonly category: string,
    readonly completedReads: Record<string, unknown> = {},
  ) {
    super("Fee operational inspection failed");
  }
}

if (import.meta.main) {
  let stage = "active-version-before";
  let pinnedVersion: Record<string, unknown> = {};
  try {
    if (
      process.env.GITHUB_REF !== "refs/heads/main" ||
      !process.env.RUNNER_TEMP
    )
      throw Error("Main runner required");
    const config = Bun.TOML.parse(
      readFileSync("workers/fee-converter/wrangler.toml", "utf8"),
    ) as {
      vars: Record<string, string>;
      d1_databases: { binding: string; database_id: string }[];
    };
    const expected = Object.fromEntries(
      Object.entries(config.vars).filter(([name]) =>
        /^(FEE_CONVERTER_|FEE_WALLET_|BUYBACK_)/.test(name),
      ),
    ) as Record<string, string>;
    const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      token = process.env.CLOUDFLARE_API_TOKEN ?? "",
      head = process.env.GITHUB_SHA ?? "";
    const before = await inspectFeeWorkerBindings(
      account,
      token,
      expected,
      head,
    );
    pinnedVersion = {
      deploymentId: before.deploymentId,
      versionId: before.versionId,
      sourceCommit: before.sourceCommit,
      checkedSource: head,
      sourceMatchesCheckout: before.sourceMatchesCheckout,
    };
    const database = config.d1_databases.find(
      (entry) => entry.binding === "FEE_DB",
    )?.database_id;
    if (!database) throw Error("Fee database configuration missing");
    stage = "operational-inspection";
    const report = await inspectFeeOperations({
      account,
      token,
      database,
      versionId: before.versionId,
    });
    stage = "active-version-after";
    const after = await inspectFeeWorkerBindings(
      account,
      token,
      expected,
      head,
    );
    if (
      after.versionId !== before.versionId ||
      after.deploymentId !== before.deploymentId ||
      after.sourceCommit !== before.sourceCommit
    )
      throw Error("Fee Worker changed during diagnostics");
    const output = {
      ...report,
      deploymentId: before.deploymentId,
      sourceCommit: before.sourceCommit,
      checkedSource: head,
      sourceMatchesCheckout: before.sourceMatchesCheckout,
    };
    writeFileSync(
      join(process.env.RUNNER_TEMP, "fee-worker-operations.json"),
      `${JSON.stringify(output, null, 2)}\n`,
      { mode: 0o600 },
    );
    console.log(JSON.stringify(output));
  } catch (error) {
    const failure = {
      ...pinnedVersion,
      activeVersionRechecked: false,
      ...(error instanceof FeeDiagnosticFailure ? error.completedReads : {}),
      status: "unavailable",
      stage: error instanceof FeeDiagnosticFailure ? error.stage : stage,
      category:
        error instanceof FeeDiagnosticFailure
          ? error.category
          : "metadata-unavailable",
      rawLogsRetained: false,
    };
    if (process.env.RUNNER_TEMP)
      writeFileSync(
        join(process.env.RUNNER_TEMP, "fee-worker-operations.json"),
        `${JSON.stringify(failure)}\n`,
        { mode: 0o600 },
      );
    console.error(JSON.stringify(failure));
    process.exitCode = 1;
  }
}
