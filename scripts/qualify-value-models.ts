import { pathToFileURL } from "node:url";
import type { ValueAssessment } from "../src/lib/value-assessment";
import { sqliteD1 } from "../tests/sqlite-d1";
import {
  collect,
  fixture,
  policy,
  repository,
} from "../tests/value-binary-fixture";
import { priceUsage } from "../workers/slopbot/contracts";
import {
  type CallRecord,
  type ModelEnv,
  TRIAGE_ROUTE,
} from "../workers/slopbot/models";
import { valueModelSource } from "../workers/slopbot/value-model-source";
import { assessValue } from "../workers/slopbot/value-review";
import { prepareWorkUnitEvidence } from "../workers/slopbot/value-work-unit";
import { assessWorkUnits } from "../workers/slopbot/value-work-unit-review";
import { qualificationResponse } from "./qualification-response";

const ENDPOINT = "https://api.surplusintelligence.ai/anthropic/v1/messages";
const PATH_BUDGET = 1_000_000;
const OUTPUT_TOKENS = 2048;

function requireThat(value: unknown): asserts value {
  if (!value) throw new Error("Value-model qualification failed");
}

/** Only this process's synthetic qualification traffic passes this boundary.
 * The ordinary model prompt/schema remain intact; output is capped for the
 * two small test cases. A missing cost receipt stops further calls. */
export function qualificationTransport(fetcher: typeof fetch) {
  let requests = 0;
  let spent = 0;
  let uncertain = false;
  return {
    mayCall: async () => !uncertain && requests < 2 && spent < PATH_BUDGET,
    fetch: (async (input, init) => {
      const request = new Request(input, init);
      requireThat(request.url === ENDPOINT && request.method === "POST");
      const payload = await request.clone().text();
      requireThat(new TextEncoder().encode(payload).length <= 32_768);
      requireThat(!payload.includes("contentBase64"));
      requireThat(payload.includes("contentOmittedFromModel"));
      const wire = JSON.parse(payload);
      const step = TRIAGE_ROUTE.find((entry) => entry.model === wire.model);
      requireThat(step && !uncertain && requests < 2);
      wire.max_tokens = OUTPUT_TOKENS;
      const body = JSON.stringify(wire);
      const bound = priceUsage(step.priceKey, {
        // One token per encoded byte, charged in every input category, is
        // deliberately above this synthetic request's local price estimate.
        input: new TextEncoder().encode(body).length,
        cacheWrite: new TextEncoder().encode(body).length,
        cacheRead: new TextEncoder().encode(body).length,
        output: OUTPUT_TOKENS,
      });
      requireThat(bound && spent + bound.costMicroUsd <= PATH_BUDGET);
      requests++;
      uncertain = true;
      const response = await fetcher(request.url, {
        method: "POST",
        headers: request.headers,
        body,
        redirect: "error",
        signal: request.signal,
      });
      const receipt = await qualificationResponse(response);
      requireThat(receipt.cost !== null);
      spent += receipt.cost;
      requireThat(spent <= PATH_BUDGET);
      uncertain = false;
      return receipt.response;
    }) as typeof fetch,
    requestCount: () => requests,
  };
}

export async function qualifyValueModels(env: ModelEnv, dryRun = false) {
  const source = fixture({ binaryOnly: true });
  source.pull.title = "Fix a form clearing entered text";
  source.pull.body =
    "The attached capture.webm is the only before/after evidence for the claimed form fix. The source collector has not viewed it. No implementation diff or independent execution result is supplied.";
  const evidence = await collect(source);
  const joint = await prepareWorkUnitEvidence(
    [{ evidence, policy }],
    [repository],
  );
  requireThat(
    evidence.limitations.length === 0 && joint.limitations.length === 0,
  );
  requireThat(joint.claims.length === 1);
  for (const item of [evidence, joint]) {
    const projected = valueModelSource(item);
    requireThat(!projected.item.includes('"contentBase64":'));
    requireThat(projected.item.includes('"contentOmittedFromModel":true'));
  }
  const { db, sqlite } = sqliteD1();
  const budget = (index: number) => ({
    db,
    installationId: 1,
    attemptId: `value:14740000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    maximumMicroUsd: PATH_BUDGET,
    approvedMonthlyMicroUsd: 2 * PATH_BUDGET,
  });
  const original = globalThis.fetch;
  const summaries: {
    path: string;
    provider: string | null;
    model: string | null;
    requests: number;
    outcome: string;
  }[] = [];
  const record = (
    path: string,
    result: {
      blocked: boolean;
      calls: CallRecord[];
      servedBy: CallRecord | null;
    },
    assessments: ValueAssessment[],
    transport: ReturnType<typeof qualificationTransport>,
  ) => {
    if (dryRun) requireThat(result.blocked && result.calls.length === 0);
    else {
      requireThat(
        !result.blocked && result.servedBy && result.calls.length > 0,
      );
      requireThat(result.calls.length === transport.requestCount());
      requireThat(
        assessments.length > 0 &&
          assessments.every(
            (value) =>
              value.status === "unresolved" &&
              value.tier === null &&
              value.limitations.length > 0,
          ),
      );
    }
    summaries.push({
      path,
      provider: result.servedBy?.provider ?? null,
      model: result.servedBy?.servedModel ?? null,
      requests: transport.requestCount(),
      outcome: dryRun
        ? "dry-run; no provider calls"
        : "unviewed media unresolved",
    });
  };
  try {
    let transport = qualificationTransport(original);
    globalThis.fetch = transport.fetch;
    const single = await assessValue(
      env,
      evidence,
      policy,
      dryRun ? async () => false : transport.mayCall,
      budget(1),
    );
    record("single", single, single.verdict ? [single.verdict] : [], transport);
    transport = qualificationTransport(original);
    globalThis.fetch = transport.fetch;
    const group = await assessWorkUnits(
      env,
      joint,
      dryRun ? async () => false : transport.mayCall,
      budget(2),
    );
    record(
      "joint",
      group,
      group.verdict?.units.map((unit) => unit.assessment) ?? [],
      transport,
    );
    return summaries;
  } finally {
    globalThis.fetch = original;
    sqlite.close();
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
      "Value-model qualification requires the protected main release.\n",
    );
    process.exitCode = 1;
  } else {
    await qualifyValueModels(
      { SURPLUS_API_KEY: process.env.SURPLUS_API_KEY },
      dryRun,
    )
      .then((results) => {
        for (const result of results)
          process.stdout.write(`${JSON.stringify(result)}\n`);
      })
      .catch(() => {
        // Provider errors can contain request material. Never serialize them.
        process.stderr.write(
          "Value-model qualification failed; no publication is permitted.\n",
        );
        process.exitCode = 1;
      });
  }
}
