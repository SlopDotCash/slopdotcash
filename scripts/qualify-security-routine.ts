import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  type SecurityRoutineInput,
  type SecurityRoutineProposal,
  surplusSecurityAnalyzer,
} from "../backend/security/analysis";
import {
  routineClosingExclusions,
  SECURITY_DEFAULT_EXCLUSIONS,
} from "../src/lib/security-bounty.mjs";
import { priceUsage } from "../workers/slopbot/contracts";
import { protectedMainRelease } from "./protected-main-release";
import { qualificationResponse } from "./qualification-response";

/**
 * Release qualification of the routine-decision call (PRD section 8,
 * operator decision of 17 November 2026) with the real provider. Three
 * synthetic reports go through the production analyzer and prompt:
 *
 * - a phishing report must name the published front-end line and no
 *   plausible loss of funds;
 * - a runnable theft report must be read as a plausible loss of funds with
 *   proof present, as a duplicate of the supplied earlier report, and under
 *   no published line;
 * - a claim without steps or code must be read as missing proof.
 *
 * A wrong answer fails the release at once. No private report, storage,
 * notification or production data is involved, and every failure logs only
 * its category.
 */

const ENDPOINT = "https://api.surplusintelligence.ai/anthropic/v1/messages";
/** Each call is bounded before it is sent and by its receipt. */
export const MAXIMUM_MICRO_USD = 1_000_000;
/** Three scenarios and at most two retries of transient failures in total. */
export const MAXIMUM_CALLS = 5;
export const TOTAL_MAXIMUM_MICRO_USD = MAXIMUM_MICRO_USD * MAXIMUM_CALLS;
const OUTPUT_TOKENS = 1024;
const ATTEMPT_TIMEOUT_MS = 55_000;
const BACKOFF_MS = 3_000;

export type RoutineFailureCategory =
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
  | "wrong-answer";

const TRANSIENT: ReadonlySet<RoutineFailureCategory> = new Set([
  "network",
  "timeout",
  "receipt-unreadable",
  "incomplete",
  "schema-invalid",
]);

export class RoutineQualificationError extends Error {
  constructor(
    readonly category: RoutineFailureCategory,
    readonly detail: Record<string, string | number | boolean | null> = {},
  ) {
    super(`Routine-decision qualification failed: ${category}`);
  }
}

class DryRunComplete extends Error {}

function requireThat(
  value: unknown,
  category: RoutineFailureCategory,
  detail?: Record<string, string | number | boolean | null>,
): asserts value {
  if (!value) throw new RoutineQualificationError(category, detail);
}

const PHISHING_LINE = SECURITY_DEFAULT_EXCLUSIONS[3];
const EARLIER_THEFT = "sc_qualification_earlier_theft";

type Scenario = {
  name: string;
  input(source: string): SecurityRoutineInput;
  /** The first field that is wrong, or null when the answer qualifies. */
  wrong(answer: SecurityRoutineProposal): string | null;
};

const scope = {
  includedAssets: ["DemoVault.sol, a synthetic local contract"],
  severityRubric: "Critical means theft or permanent freezing of deposits.",
  lossDefinition: "Theft or permanent freezing of a depositor's funds.",
};

export const ROUTINE_QUALIFICATION_SCENARIOS: readonly Scenario[] = [
  {
    name: "published-line",
    input: () => ({
      report: {
        summary: "The project website can be copied for a phishing campaign",
        description:
          "Public synthetic qualification only. The marketing website has no " +
          "DMARC reject policy, so an attacker can send email that looks like " +
          "the project and link to a copy of the website. No contract, key or " +
          "deposit is affected and no funds can move through this.",
        severity: null,
        cvss: null,
        cweIds: [],
        packages: [],
      },
      scope,
      doesNotQualify: routineClosingExclusions(null),
      earlierReports: [],
    }),
    wrong: (answer) =>
      answer.doesNotQualifyLine !== PHISHING_LINE
        ? "doesNotQualifyLine"
        : answer.lossOfFundsPlausible
          ? "lossOfFundsPlausible"
          : null,
  },
  {
    name: "plausible-loss-duplicate",
    input: (source) => ({
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
          "Run it with: forge test --match-test testBobWithdrawsAliceDeposit.\n\n" +
          source,
        severity: null,
        cvss: null,
        cweIds: ["CWE-862"],
        packages: [],
      },
      scope,
      doesNotQualify: routineClosingExclusions(null),
      earlierReports: [
        {
          id: "sc_qualification_earlier_fees",
          summary:
            "The report claims deposit() rounds a fee in the vault's favour by one wei.",
        },
        {
          id: EARLIER_THEFT,
          summary:
            "The report shows that DemoVault.withdraw(account, amount) debits the account named by the caller and pays msg.sender without checking that msg.sender is that account, so any caller can take another depositor's balance.",
        },
      ],
    }),
    wrong: (answer) =>
      !answer.lossOfFundsPlausible
        ? "lossOfFundsPlausible"
        : answer.proof !== "present"
          ? "proof"
          : answer.duplicateOfCaseId !== EARLIER_THEFT
            ? "duplicateOfCaseId"
            : answer.doesNotQualifyLine !== null
              ? "doesNotQualifyLine"
              : null,
  },
  {
    name: "missing-proof",
    input: () => ({
      report: {
        summary: "Your contracts are probably insecure",
        description:
          "Public synthetic qualification only. A scanner printed several " +
          "warnings for this repository. I did not look at which function is " +
          "affected and I have no steps, test or transaction to show. Please " +
          "review the code.",
        severity: null,
        cvss: null,
        cweIds: [],
        packages: [],
      },
      scope,
      doesNotQualify: routineClosingExclusions(null),
      earlierReports: [],
    }),
    wrong: (answer) => (answer.proof !== "missing" ? "proof" : null),
  },
];

type Budget = { micro: number; requests: number };

/** One scenario through the production routine-decision implementation. */
async function attempt(
  scenario: Scenario,
  source: string,
  apiKey: string | undefined,
  dryRun: boolean,
  fetcher: typeof fetch,
  spent: Budget,
): Promise<{ servedModel: string | null; dryRun: boolean }> {
  let sent = false;
  let stop: { stopReason: unknown; truncated: boolean } | null = null;
  let servedModel: string | null = null;
  const transport = (async (input, init) => {
    const request = new Request(input, init);
    requireThat(
      request.url === ENDPOINT && request.method === "POST" && !sent,
      "request-bound",
    );
    const wire = JSON.parse(await request.text());
    requireThat(wire.model === "claude-sonnet-5.5", "request-bound");
    wire.max_tokens = OUTPUT_TOKENS;
    const body = JSON.stringify(wire);
    const bytes = new TextEncoder().encode(body).length;
    requireThat(bytes <= 16_384, "request-bound", { bytes });
    const bound = priceUsage("surplus/claude-sonnet-5.5", {
      input: bytes,
      cacheWrite: bytes,
      cacheRead: bytes,
      output: OUTPUT_TOKENS,
    });
    requireThat(
      bound && bound.costMicroUsd <= MAXIMUM_MICRO_USD,
      "price-bound",
    );
    if (dryRun) throw new DryRunComplete();
    // The worst case of this call must still fit the release total.
    requireThat(
      spent.requests < MAXIMUM_CALLS &&
        spent.micro + MAXIMUM_MICRO_USD <= TOTAL_MAXIMUM_MICRO_USD,
      "total-over-budget",
    );
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
      throw new RoutineQualificationError(
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
      throw new RoutineQualificationError(
        response.ok ? "receipt-unreadable" : "http-status",
        { status: response.status },
      );
    }
    const value = receipt.value as {
      model?: unknown;
      stop_reason?: unknown;
      error?: unknown;
      surplus?: { truncated?: unknown } | null;
    } | null;
    if (!response.ok) {
      spent.micro += receipt.cost ?? MAXIMUM_MICRO_USD;
      throw new RoutineQualificationError("http-status", {
        status: response.status,
        retryable:
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
      });
    }
    if (receipt.cost === null) {
      spent.micro += MAXIMUM_MICRO_USD;
      throw new RoutineQualificationError("receipt-missing");
    }
    spent.micro += receipt.cost;
    requireThat(receipt.cost <= MAXIMUM_MICRO_USD, "receipt-over-budget", {
      costMicroUsd: receipt.cost,
    });
    requireThat(spent.micro <= TOTAL_MAXIMUM_MICRO_USD, "total-over-budget");
    // Surplus commits HTTP 200 before a long call ends, so a later failure
    // is an error envelope with a receipt but no served model.
    if (value !== null && Object.hasOwn(value, "error"))
      throw new RoutineQualificationError("incomplete");
    requireThat(
      value !== null &&
        typeof value.model === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(value.model),
      "model-unidentified",
    );
    servedModel = value.model;
    stop = {
      stopReason: value.stop_reason,
      truncated:
        response.headers.get("x-si-truncated") === "1" ||
        value.surplus?.truncated === true,
    };
    return receipt.response;
  }) as typeof fetch;
  const analyzer = surplusSecurityAnalyzer({
    apiKey: dryRun ? "synthetic-dry-run-no-credential" : apiKey,
    fetch: transport,
  });
  requireThat(analyzer?.decideRoutine, "request-bound");
  let answer: SecurityRoutineProposal;
  try {
    answer = await analyzer.decideRoutine(
      scenario.input(source),
      ATTEMPT_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof DryRunComplete) return { servedModel, dryRun: true };
    if (error instanceof RoutineQualificationError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError")
      throw new RoutineQualificationError("timeout");
    const seen = stop as { stopReason: unknown; truncated: boolean } | null;
    if (seen === null) throw new RoutineQualificationError("network");
    if (seen.truncated || seen.stopReason !== "end_turn")
      throw new RoutineQualificationError("incomplete");
    throw new RoutineQualificationError("schema-invalid");
  }
  const wrong = scenario.wrong(answer);
  requireThat(wrong === null, "wrong-answer", {
    scenario: scenario.name,
    field: wrong,
  });
  return { servedModel, dryRun: false };
}

function retryable(error: RoutineQualificationError) {
  if (error.category === "http-status") return error.detail.retryable === true;
  return TRANSIENT.has(error.category);
}

/**
 * Runs the three scenarios in turn. A transient failure is retried while the
 * call and cost bounds allow; a schema-valid wrong answer, a missing or
 * over-budget receipt and a non-transient HTTP rejection fail at once.
 */
export async function qualifySecurityRoutine(
  apiKey: string | undefined,
  dryRun = false,
  fetcher: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const source = await readFile(
    new URL(
      "../tests/fixtures/security-screening/DemoVault.sol",
      import.meta.url,
    ),
    "utf8",
  );
  const spent: Budget = { micro: 0, requests: 0 };
  const failedAttempts: { scenario: string; category: string }[] = [];
  let model: string | null = null;
  for (const scenario of ROUTINE_QUALIFICATION_SCENARIOS) {
    for (;;) {
      try {
        const result = await attempt(
          scenario,
          source,
          apiKey,
          dryRun,
          fetcher,
          spent,
        );
        model = result.servedModel ?? model;
        break;
      } catch (error) {
        const failure =
          error instanceof RoutineQualificationError
            ? error
            : new RoutineQualificationError("network");
        failedAttempts.push({
          scenario: scenario.name,
          category: failure.category,
        });
        if (
          !retryable(failure) ||
          spent.requests >= MAXIMUM_CALLS ||
          spent.micro + MAXIMUM_MICRO_USD > TOTAL_MAXIMUM_MICRO_USD
        )
          throw new RoutineQualificationError(failure.category, {
            ...failure.detail,
            scenario: scenario.name,
            requests: spent.requests,
          });
        await sleep(BACKOFF_MS);
      }
    }
  }
  return {
    path: "private-report-routine-decision",
    provider: "surplus",
    model,
    requests: spent.requests,
    failedAttempts,
    outcome: dryRun
      ? "dry-run; no provider calls"
      : "three synthetic reports read as required",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { dryRun, authorized } = protectedMainRelease();
  if (!dryRun && !authorized) {
    process.stderr.write(
      "Routine-decision qualification requires the protected main release.\n",
    );
    process.exitCode = 1;
  } else {
    await qualifySecurityRoutine(process.env.SURPLUS_API_KEY, dryRun)
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error: unknown) => {
        // Only the category, the scenario name and counts are logged.
        const category =
          error instanceof RoutineQualificationError
            ? error.category
            : "unexpected";
        const detail =
          error instanceof RoutineQualificationError ? error.detail : {};
        process.stderr.write(
          `Routine-decision qualification failed (${category}); no publication is permitted.\n` +
            `${JSON.stringify({ category, detail })}\n`,
        );
        process.exitCode = 1;
      });
  }
}
