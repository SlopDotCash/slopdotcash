import { pathToFileURL } from "node:url";
import { surplusSecurityAnalyzer } from "../backend/security/analysis";
import { priceUsage } from "../workers/slopbot/contracts";

const ENDPOINT = "https://api.surplusintelligence.ai/anthropic/v1/messages";
const MAXIMUM_MICRO_USD = 1_000_000;
const OUTPUT_TOKENS = 1024;
class DryRunComplete extends Error {}

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
    const receipt = response.headers.get("x-si-buyer-cost-micro");
    requireThat(receipt !== null && /^(0|[1-9][0-9]*)$/u.test(receipt));
    const cost = Number(receipt);
    requireThat(Number.isSafeInteger(cost) && cost <= MAXIMUM_MICRO_USD);
    const value = await response.clone().json();
    requireThat(
      typeof value.model === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(value.model),
    );
    servedModel = value.model;
    return response;
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
          summary: "Synthetic local vault lacks withdrawal authorization",
          description:
            "Public synthetic qualification only; no live target or funds. " +
            "In a local demonstrator vault, withdraw(account, amount) checks " +
            "balances[account] and transfers to msg.sender but never checks " +
            "that msg.sender equals account. Deposit 100 test units as Alice, " +
            "then call withdraw(Alice, 100) as Bob: Alice's balance becomes " +
            "zero and Bob receives the units. A control that requires " +
            "msg.sender == account rejects Bob. This is a concrete " +
            "authorization bypass reproduced using synthetic balances only.",
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
    requireThat(result.decision === "legitimate" && requests === 1);
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
      .catch(() => {
        process.stderr.write(
          "Private-screening qualification failed; no publication is permitted.\n",
        );
        process.exitCode = 1;
      });
  }
}
