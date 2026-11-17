import { expect, test } from "bun:test";
import { routineClosingExclusions } from "../src/lib/security-bounty.mjs";
import {
  MAXIMUM_CALLS,
  qualifySecurityRoutine,
  ROUTINE_QUALIFICATION_SCENARIOS,
  RoutineQualificationError,
} from "./qualify-security-routine";

// Deterministic transport fixtures for the release wrapper. They prove the
// request bounds, receipt handling, retries and refusals of the
// qualification, not that any real model answers these reports correctly.
const noSleep = async () => {};
const lines = routineClosingExclusions(null);
const RIGHT: Record<string, Record<string, unknown>> = {
  "published-line": {
    lossOfFundsPlausible: false,
    duplicateOfCaseId: null,
    doesNotQualifyIndex: lines.indexOf(
      "Front end, website, DNS, email, phishing and social engineering",
    ),
    proof: "missing",
    missing: ["runnable-proof"],
    severity: "informational",
  },
  "plausible-loss-duplicate": {
    lossOfFundsPlausible: true,
    duplicateOfCaseId: "sc_qualification_earlier_theft",
    doesNotQualifyIndex: null,
    proof: "present",
    missing: [],
    severity: "critical",
  },
  "missing-proof": {
    lossOfFundsPlausible: false,
    duplicateOfCaseId: null,
    doesNotQualifyIndex: null,
    proof: "missing",
    missing: ["reproduction-steps", "runnable-proof", "affected-code"],
    severity: "unresolved",
  },
};

/** Which synthetic report a request carries, from its own summary. */
function scenarioOf(init: RequestInit | undefined): string {
  const wire = JSON.parse(String(init?.body)) as {
    max_tokens: number;
    messages: { content: string }[];
  };
  expect(wire.max_tokens).toBe(1024);
  const summary = (
    JSON.parse(wire.messages[0].content) as { report: { summary: string } }
  ).report.summary;
  const found = ROUTINE_QUALIFICATION_SCENARIOS.find(
    (scenario) => scenario.input("").report.summary === summary,
  );
  if (!found) throw new Error("Unknown synthetic report");
  return found.name;
}

function transport(
  answers: (scenario: string, call: number) => Record<string, unknown> | null,
) {
  let calls = 0;
  return {
    calls: () => calls,
    fetch: (async (_url: string, init?: RequestInit) => {
      calls++;
      const answer = answers(scenarioOf(init), calls);
      return new Response(
        JSON.stringify({
          model: "claude-sonnet-5.5",
          stop_reason: answer === null ? "max_tokens" : "end_turn",
          content: [{ type: "text", text: JSON.stringify(answer ?? {}) }],
          usage: { buyer_cost_micro: 75 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch,
  };
}

test("a dry run checks the request bounds of every synthetic report and makes no provider call", async () => {
  const source = transport(() => {
    throw new Error("A dry run must not call the provider");
  });
  const result = await qualifySecurityRoutine(
    undefined,
    true,
    source.fetch,
    noSleep,
  );
  expect(result).toMatchObject({
    requests: 0,
    outcome: "dry-run; no provider calls",
  });
  expect(source.calls()).toBe(0);
});

test("the three synthetic reports qualify with one call each when every answer is as required", async () => {
  const source = transport((scenario) => RIGHT[scenario]);
  const result = await qualifySecurityRoutine(
    "synthetic-only",
    false,
    source.fetch,
    noSleep,
  );
  expect(result).toMatchObject({
    requests: 3,
    failedAttempts: [],
    model: "claude-sonnet-5.5",
  });
});

test("a schema-valid wrong answer fails at once and names only the scenario and the field", async () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["published-line", { doesNotQualifyIndex: null }, "doesNotQualifyLine"],
    ["published-line", { lossOfFundsPlausible: true }, "lossOfFundsPlausible"],
    [
      "plausible-loss-duplicate",
      { lossOfFundsPlausible: false },
      "lossOfFundsPlausible",
    ],
    [
      "plausible-loss-duplicate",
      { duplicateOfCaseId: "sc_qualification_earlier_fees" },
      "duplicateOfCaseId",
    ],
    [
      "plausible-loss-duplicate",
      { doesNotQualifyIndex: 0 },
      "doesNotQualifyLine",
    ],
    ["missing-proof", { proof: "present" }, "proof"],
  ];
  for (const [name, change, field] of cases) {
    const source = transport((scenario) =>
      scenario === name ? { ...RIGHT[scenario], ...change } : RIGHT[scenario],
    );
    const failure = await qualifySecurityRoutine(
      "PRIVATE-KEY-SENTINEL",
      false,
      source.fetch,
      noSleep,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RoutineQualificationError);
    const error = failure as RoutineQualificationError;
    expect(error.category).toBe("wrong-answer");
    expect(error.detail).toMatchObject({ scenario: name, field });
    expect(JSON.stringify([error.message, error.detail])).not.toContain(
      "SENTINEL",
    );
    // No retry of a wrong answer.
    const index = ROUTINE_QUALIFICATION_SCENARIOS.findIndex(
      (scenario) => scenario.name === name,
    );
    expect(source.calls()).toBe(index + 1);
  }
});

test("a cut-off answer is retried inside the call bound, and the bound stops further calls", async () => {
  const once = transport((scenario, call) =>
    call === 1 ? null : RIGHT[scenario],
  );
  expect(
    await qualifySecurityRoutine("synthetic-only", false, once.fetch, noSleep),
  ).toMatchObject({
    requests: 4,
    failedAttempts: [{ scenario: "published-line", category: "incomplete" }],
  });
  const never = transport(() => null);
  const failure = await qualifySecurityRoutine(
    "synthetic-only",
    false,
    never.fetch,
    noSleep,
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(RoutineQualificationError);
  expect((failure as RoutineQualificationError).category).toBe("incomplete");
  expect(never.calls()).toBe(MAXIMUM_CALLS);
});

test("a later report is refused before it is sent once the call bound is spent", async () => {
  // First report right, the second cut off three times and then right: five
  // calls are spent and the third report is never sent.
  const source = transport((scenario, call) =>
    call >= 2 && call <= 4 ? null : RIGHT[scenario],
  );
  const failure = await qualifySecurityRoutine(
    "synthetic-only",
    false,
    source.fetch,
    noSleep,
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(RoutineQualificationError);
  expect((failure as RoutineQualificationError).category).toBe(
    "total-over-budget",
  );
  expect((failure as RoutineQualificationError).detail).toMatchObject({
    scenario: "missing-proof",
  });
  expect(source.calls()).toBe(MAXIMUM_CALLS);
});

test("a missing cost receipt stops the qualification without a retry", async () => {
  let calls = 0;
  const failure = await qualifySecurityRoutine(
    "synthetic-only",
    false,
    (async () => {
      calls++;
      return new Response(
        JSON.stringify({
          model: "claude-sonnet-5.5",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: JSON.stringify(RIGHT["published-line"]) },
          ],
        }),
      );
    }) as unknown as typeof fetch,
    noSleep,
  ).catch((error: unknown) => error);
  expect((failure as RoutineQualificationError).category).toBe(
    "receipt-missing",
  );
  expect(calls).toBe(1);
});
