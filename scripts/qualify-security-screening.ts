import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { surplusSecurityAnalyzer } from "../backend/security/analysis";
import { priceUsage } from "../workers/slopbot/contracts";
import { qualificationResponse } from "./qualification-response";

const ENDPOINT = "https://api.surplusintelligence.ai/anthropic/v1/messages";
/** Each attempt is individually bounded before it is sent and by its receipt. */
export const MAXIMUM_MICRO_USD = 1_000_000;
/** At most three provider calls, so the release spends at most 3 USD here. */
export const MAXIMUM_ATTEMPTS = 3;
export const TOTAL_MAXIMUM_MICRO_USD = MAXIMUM_MICRO_USD * MAXIMUM_ATTEMPTS;
const OUTPUT_TOKENS = 1024;
/** Three attempts plus backoff stay inside the workflow step's 4 minutes. */
const ATTEMPT_TIMEOUT_MS = 55_000;
const BACKOFF_MS = [2_000, 5_000];

/**
 * Non-sensitive failure categories. A transient category may be retried
 * within the attempt and cost bounds; every other one fails closed at once.
 * None carries the key, the request, or the model's text.
 */
export type ScreeningFailureCategory =
  | "request-bound"
  | "price-bound"
  | "http-status"
  | "network"
  | "timeout"
  | "receipt-unreadable"
  | "receipt-missing"
  | "receipt-over-budget"
  | "total-over-budget"
  | "model-unidentified"
  | "incomplete"
  | "schema-invalid"
  | "wrong-decision";

const TRANSIENT: ReadonlySet<ScreeningFailureCategory> = new Set([
  "network",
  "timeout",
  "receipt-unreadable",
  "incomplete",
  "schema-invalid",
]);

export class ScreeningQualificationError extends Error {
  constructor(
    readonly category: ScreeningFailureCategory,
    readonly detail: Record<string, string | number | boolean | null> = {},
    readonly attempts: { category: string; [key: string]: unknown }[] = [],
  ) {
    super(`Private-screening qualification failed: ${category}`);
  }
}

class DryRunComplete extends Error {}

function requireThat(
  value: unknown,
  category: ScreeningFailureCategory,
  detail?: Record<string, string | number | boolean | null>,
): asserts value {
  if (!value) throw new ScreeningQualificationError(category, detail);
}

/** A short identifier safe to log: provider enum values, never free text. */
function token(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/u.test(value)
    ? value
    : null;
}

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

type Observation = {
  status: number;
  errorType: string | null;
  stopReason: string | null;
  truncated: boolean;
};

/** One attempt through the production screening implementation. */
async function attemptScreening(
  apiKey: string | undefined,
  dryRun: boolean,
  fetcher: typeof fetch,
  spent: { micro: number; requests: number },
) {
  const source = await readFile(
    new URL(
      "../tests/fixtures/security-screening/DemoVault.sol",
      import.meta.url,
    ),
    "utf8",
  );
  let sent = false;
  let observed: Observation | null = null;
  let servedModel: string | null = null;
  const transport = (async (input, init) => {
    const request = new Request(input, init);
    requireThat(
      request.url === ENDPOINT && request.method === "POST" && !sent,
      "request-bound",
    );
    const wire = JSON.parse(await request.text());
    requireThat(wire.model === "claude-opus-5.5", "request-bound");
    wire.max_tokens = OUTPUT_TOKENS;
    const body = JSON.stringify(wire);
    const bytes = new TextEncoder().encode(body).length;
    requireThat(bytes <= 16_384, "request-bound", { bytes });
    const bound = priceUsage("surplus/claude-opus-5.5", {
      input: bytes,
      cacheWrite: bytes,
      cacheRead: bytes,
      output: OUTPUT_TOKENS,
    });
    requireThat(
      bound && bound.costMicroUsd <= MAXIMUM_MICRO_USD,
      "price-bound",
    );
    // The worst case of the next call must still fit the release total.
    requireThat(
      spent.micro + MAXIMUM_MICRO_USD <= TOTAL_MAXIMUM_MICRO_USD,
      "total-over-budget",
    );
    if (dryRun) throw new DryRunComplete();
    sent = true;
    spent.requests++;
    let response: Response;
    try {
      response = await fetcher(request.url, {
        method: "POST",
        headers: request.headers,
        body,
        redirect: "error",
        signal: request.signal,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      // An unknown outcome is billed at its worst case.
      spent.micro += MAXIMUM_MICRO_USD;
      throw new ScreeningQualificationError(
        name === "TimeoutError" || name === "AbortError"
          ? "timeout"
          : "network",
      );
    }
    let receipt: Awaited<ReturnType<typeof qualificationResponse>>;
    try {
      receipt = await qualificationResponse(response);
    } catch {
      spent.micro += MAXIMUM_MICRO_USD;
      throw new ScreeningQualificationError(
        response.ok ? "receipt-unreadable" : "http-status",
        {
          status: response.status,
          ...(response.ok
            ? {}
            : { errorType: null, retryable: retryableStatus(response.status) }),
        },
      );
    }
    const value = receipt.value as {
      model?: unknown;
      stop_reason?: unknown;
      error?: { type?: unknown } | null;
      surplus?: { truncated?: unknown } | null;
    } | null;
    observed = {
      status: response.status,
      errorType: token(value?.error?.type),
      stopReason: token(value?.stop_reason),
      truncated:
        response.headers.get("x-si-truncated") === "1" ||
        value?.surplus?.truncated === true,
    };
    if (!response.ok) {
      // Without a receipt, retain the full possible cost of a rejected call.
      spent.micro += receipt.cost ?? MAXIMUM_MICRO_USD;
      requireThat(
        receipt.cost === null || receipt.cost <= MAXIMUM_MICRO_USD,
        "receipt-over-budget",
      );
      requireThat(spent.micro <= TOTAL_MAXIMUM_MICRO_USD, "total-over-budget");
      throw new ScreeningQualificationError("http-status", {
        status: response.status,
        errorType: observed.errorType,
        retryable: retryableStatus(response.status),
      });
    }
    if (receipt.cost === null) {
      spent.micro += MAXIMUM_MICRO_USD;
      throw new ScreeningQualificationError("receipt-missing");
    }
    spent.micro += receipt.cost;
    requireThat(receipt.cost <= MAXIMUM_MICRO_USD, "receipt-over-budget", {
      costMicroUsd: receipt.cost,
    });
    requireThat(spent.micro <= TOTAL_MAXIMUM_MICRO_USD, "total-over-budget");
    // Surplus commits HTTP 200 before a long call ends, so a later failure is
    // an error envelope with a receipt but no served model. It is an
    // incomplete answer, not an unidentified model.
    if (value !== null && Object.hasOwn(value, "error"))
      throw new ScreeningQualificationError("incomplete", {
        errorType: observed.errorType,
        stopReason: observed.stopReason,
        truncated: observed.truncated,
      });
    requireThat(
      value !== null &&
        typeof value.model === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(value.model),
      "model-unidentified",
      { servedModel: token(value?.model) },
    );
    servedModel = value.model;
    return receipt.response;
  }) as typeof fetch;
  const analyzer = surplusSecurityAnalyzer({
    apiKey: dryRun ? "synthetic-dry-run-no-credential" : apiKey,
    fetch: transport,
  });
  requireThat(analyzer?.screen, "request-bound");
  let decision: string;
  try {
    const result = await analyzer.screen(
      {
        report: {
          summary: "Included DemoVault.sol lets Bob withdraw Alice's deposit",
          description:
            "Public synthetic qualification only; no deployed target or real funds. " +
            "The complete affected Solidity component is included below. " +
            "The local EVM test deploys DemoVault, gives Alice 100 wei and Bob 0, " +
            "then Alice calls deposit with value 100. Bob calls withdraw(Alice, 100). " +
            "The call succeeds: balances[Alice] is 0, Bob's balance is 100, and " +
            "the vault balance is 0. The test asserts all three outcomes. " +
            "withdraw selects the debited account from caller input but transfers " +
            "its funds to msg.sender without checking that caller owns that account. " +
            "A second local EVM test adds require(msg.sender == account) before " +
            "the same body. Bob's call then reverts, Alice's deposit remains 100, " +
            "and Bob receives nothing. Both tests pass with Solidity 0.8.28.\n\n" +
            source,
          severity: null,
          cvss: null,
          cweIds: ["CWE-862"],
          packages: [],
        },
        scope: null,
        priorCases: [],
      },
      ATTEMPT_TIMEOUT_MS,
    );
    decision = result.decision;
  } catch (error) {
    if (error instanceof DryRunComplete) return { dryRun: true, servedModel };
    if (error instanceof ScreeningQualificationError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError")
      throw new ScreeningQualificationError("timeout");
    const seen = observed as Observation | null;
    if (seen === null) throw new ScreeningQualificationError("network");
    // The analyzer accepted the receipt, so the body was readable JSON.
    if (seen.truncated || seen.stopReason !== "end_turn")
      throw new ScreeningQualificationError("incomplete", {
        stopReason: seen.stopReason,
        truncated: seen.truncated,
      });
    throw new ScreeningQualificationError("schema-invalid");
  }
  requireThat(decision === "legitimate", "wrong-decision", {
    decision: token(decision),
  });
  return { dryRun: false, servedModel };
}

function retryable(error: ScreeningQualificationError) {
  if (error.category === "http-status") return error.detail.retryable === true;
  return TRANSIENT.has(error.category);
}

/** Synthetic calls through the production screening implementation. No
 * private storage, report delivery, logging or production data is involved.
 * Transient failures are retried up to MAXIMUM_ATTEMPTS calls in total; each
 * call is bounded by MAXIMUM_MICRO_USD and all of them together by
 * TOTAL_MAXIMUM_MICRO_USD. A schema-valid non-legitimate decision, a missing
 * or over-budget receipt, and a non-transient HTTP rejection fail at once. */
export async function qualifySecurityScreening(
  apiKey: string | undefined,
  dryRun = false,
  fetcher: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const spent = { micro: 0, requests: 0 };
  const attempts: { category: string; [key: string]: unknown }[] = [];
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await attemptScreening(apiKey, dryRun, fetcher, spent);
      return {
        path: "private-report-screening",
        provider: "surplus",
        model: result.servedModel,
        requests: spent.requests,
        failedAttempts: attempts,
        outcome: result.dryRun
          ? "dry-run; no provider calls"
          : "synthetic report classified legitimate",
      };
    } catch (error) {
      const failure =
        error instanceof ScreeningQualificationError
          ? error
          : new ScreeningQualificationError("network");
      attempts.push({ attempt, category: failure.category, ...failure.detail });
      if (
        attempt >= MAXIMUM_ATTEMPTS ||
        !retryable(failure) ||
        spent.micro + MAXIMUM_MICRO_USD > TOTAL_MAXIMUM_MICRO_USD
      )
        throw new ScreeningQualificationError(
          failure.category,
          failure.detail,
          attempts,
        );
      await sleep(BACKOFF_MS[attempt - 1] ?? 5_000);
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const dryRun = process.argv.slice(2).join() === "--dry-run";
  const authorized =
    process.argv.length === 2 &&
    process.env.GITHUB_ACTIONS === "true" &&
    process.env.GITHUB_REF === "refs/heads/main" &&
    ["push", "workflow_dispatch"].includes(
      process.env.GITHUB_EVENT_NAME ?? "",
    ) &&
    !!process.env.SURPLUS_API_KEY;
  if (!dryRun && !authorized) {
    process.stderr.write(
      "Private-screening qualification requires the protected main release.\n",
    );
    process.exitCode = 1;
  } else {
    await qualifySecurityScreening(process.env.SURPLUS_API_KEY, dryRun)
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error: unknown) => {
        // Only the category, enum-like provider fields and counts are logged.
        const attempts =
          error instanceof ScreeningQualificationError ? error.attempts : [];
        const category =
          error instanceof ScreeningQualificationError
            ? error.category
            : "unexpected";
        process.stderr.write(
          `Private-screening qualification failed (${category}); no publication is permitted.\n` +
            `${JSON.stringify({ category, attempts })}\n`,
        );
        process.exitCode = 1;
      });
  }
}
