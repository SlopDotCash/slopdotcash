import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { surplusSecurityAnalyzer } from "../backend/security/analysis";
import { priceUsage } from "../workers/slopbot/contracts";
import { qualificationResponse } from "./qualification-response";

const ENDPOINT = "https://api.surplusintelligence.ai/anthropic/v1/messages";
const MAXIMUM_MICRO_USD = 1_000_000;
const OUTPUT_TOKENS = 1024;
class DryRunComplete extends Error {}
class ScreeningDecisionError extends Error {
  constructor(readonly decision: "needs-information" | "spam") {
    super(`Synthetic screening returned ${decision}`);
  }
}

function requireThat(value: unknown): asserts value {
  if (!value) throw new Error("Private-screening qualification failed");
}

/** One synthetic call through the production screening implementation.
 * No private storage, report delivery, logging or production data is involved. */
export async function qualifySecurityScreening(
  apiKey: string | undefined,
  dryRun = false,
  fetcher: typeof fetch = fetch,
) {
  const source = await readFile(
    new URL(
      "../tests/fixtures/security-screening/DemoVault.sol",
      import.meta.url,
    ),
    "utf8",
  );
  let requests = 0;
  let servedModel: string | null = null;
  const transport = (async (input, init) => {
    const request = new Request(input, init);
    requireThat(request.url === ENDPOINT && request.method === "POST");
    const wire = JSON.parse(await request.text());
    requireThat(wire.model === "claude-opus-5.5");
    wire.max_tokens = OUTPUT_TOKENS;
    const body = JSON.stringify(wire);
    const bytes = new TextEncoder().encode(body).length;
    requireThat(bytes <= 16_384 && requests === 0);
    const bound = priceUsage("surplus/claude-opus-5.5", {
      input: bytes,
      cacheWrite: bytes,
      cacheRead: bytes,
      output: OUTPUT_TOKENS,
    });
    requireThat(bound && bound.costMicroUsd <= MAXIMUM_MICRO_USD);
    if (dryRun) throw new DryRunComplete();
    requests++;
    const response = await fetcher(request.url, {
      method: "POST",
      headers: request.headers,
      body,
      redirect: "error",
      signal: request.signal,
    });
    const receipt = await qualificationResponse(response);
    requireThat(receipt.cost !== null && receipt.cost <= MAXIMUM_MICRO_USD);
    const value = receipt.value as { model?: unknown } | null;
    requireThat(
      value !== null &&
        typeof value.model === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(value.model),
    );
    servedModel = value.model;
    return receipt.response;
  }) as typeof fetch;
  const analyzer = surplusSecurityAnalyzer({
    apiKey: dryRun ? "synthetic-dry-run-no-credential" : apiKey,
    fetch: transport,
  });
  requireThat(analyzer?.screen);
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
      120_000,
    );
    if (result.decision !== "legitimate")
      throw new ScreeningDecisionError(result.decision);
    requireThat(requests === 1);
  } catch (error) {
    if (!(dryRun && error instanceof DryRunComplete)) throw error;
  }
  return {
    path: "private-report-screening",
    provider: "surplus",
    model: servedModel,
    requests,
    outcome: dryRun
      ? "dry-run; no provider calls"
      : "synthetic report classified legitimate",
  };
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
      .catch((error) => {
        // The validated enum is safe to report; provider text remains private.
        const detail =
          error instanceof ScreeningDecisionError
            ? ` returned ${error.decision}`
            : " failed";
        process.stderr.write(
          `Private-screening qualification${detail}; no publication is permitted.\n`,
        );
        process.exitCode = 1;
      });
  }
}
