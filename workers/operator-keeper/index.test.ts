import { afterEach, expect, spyOn, test } from "bun:test";
import type { KeeperResult } from "../../scripts/payment-keeper/keeper";
import worker, { type OperatorEnvironment } from "./index";

const failures =
  "Operator keeper has unavailable work; durable attempts are retained";
const privateValue = "private-project-https://rpc.invalid/?token=private-token";

function environment(
  results: readonly KeeperResult[],
  status = 200,
): OperatorEnvironment {
  return {
    KEEPER_MODE: "dry_run",
    KEEPER_CONFIG: JSON.stringify({
      network: "base-mainnet",
      signer: `0x${"12".repeat(20)}`,
      rpcUrl: privateValue,
      projectIds: [privateValue],
      gas: { perTransaction: "1", perDay: "2", additionalFeeReserve: "0" },
    }),
    KEEPER: {
      idFromName: () => "existing-object",
      get: () => ({
        fetch: async () =>
          Response.json({ mode: "dry_run", results }, { status }),
      }),
    },
  };
}

function result(
  operation: string,
  state: string,
  error?: string,
): KeeperResult {
  return {
    projectId: privateValue,
    vault: `0x${"34".repeat(20)}`,
    transactionId: privateValue,
    operation,
    state,
    ...(error === undefined ? {} : { error }),
  };
}

afterEach(() => {
  // Each test installs its own private console sink.
  (console.error as unknown as { mockRestore?: () => void }).mockRestore?.();
});

test("unavailable work retains its failure and logs aggregate causes without private values", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  const rows = [
    result(
      "registry",
      "unavailable",
      "Project unavailable in current registry",
    ),
    result(
      "registry",
      "unavailable",
      "Project unavailable in current registry",
    ),
    result(
      "registry",
      "unavailable",
      "No reviewed deployment for this network",
    ),
    result("deployment", "unavailable", privateValue),
    result("monthly:2026-11", "publication-unavailable", privateValue),
    result(`award:${privateValue}`, "waiting", privateValue),
    result("deployment", "checked"),
  ];
  await expect(worker.scheduled(null, environment(rows))).rejects.toThrow(
    failures,
  );
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0]).toEqual([
    {
      event: "operator_keeper_unavailable",
      schemaVersion: 1,
      failedResults: 6,
      groups: [
        { operation: "award", state: "waiting", cause: "other", count: 1 },
        {
          operation: "deployment",
          state: "unavailable",
          cause: "other",
          count: 1,
        },
        {
          operation: "monthly",
          state: "publication-unavailable",
          cause: "other",
          count: 1,
        },
        {
          operation: "registry",
          state: "unavailable",
          cause: "deployment-unavailable",
          count: 1,
        },
        {
          operation: "registry",
          state: "unavailable",
          cause: "project-unavailable",
          count: 2,
        },
      ],
    },
  ]);
  const emitted = JSON.stringify(log.mock.calls);
  for (const secret of [
    privateValue,
    "private-token",
    `0x${"34".repeat(20)}`,
    `0x${"12".repeat(20)}`,
  ])
    expect(emitted).not.toContain(secret);
});

test("unknown operation, state and error values collapse into one fixed counter", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  const rows = Array.from({ length: 40 }, (_, n) =>
    result(
      `${privateValue}-${n}`,
      `unknown-${privateValue}-${n}`,
      `${privateValue}-${n}`,
    ),
  );
  rows.push({
    ...result("other", "other", privateValue),
    operation: null as unknown as string,
  });
  await expect(worker.scheduled(null, environment(rows))).rejects.toThrow(
    failures,
  );
  expect(log.mock.calls).toEqual([
    [
      {
        event: "operator_keeper_unavailable",
        schemaVersion: 1,
        failedResults: 41,
        groups: [
          { operation: "other", state: "other", cause: "other", count: 41 },
        ],
      },
    ],
  ]);
});

test("identical error text outside a registry result does not claim a trusted registry cause", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  await expect(
    worker.scheduled(
      null,
      environment([
        result(
          "deployment",
          "unavailable",
          "Project unavailable in current registry",
        ),
        result(
          "monthly:2026-11",
          "publication-unavailable",
          "No reviewed deployment for this network",
        ),
      ]),
    ),
  ).rejects.toThrow(failures);
  expect(log.mock.calls).toEqual([
    [
      {
        event: "operator_keeper_unavailable",
        schemaVersion: 1,
        failedResults: 2,
        groups: [
          {
            operation: "deployment",
            state: "unavailable",
            cause: "other",
            count: 1,
          },
          {
            operation: "monthly",
            state: "publication-unavailable",
            cause: "other",
            count: 1,
          },
        ],
      },
    ],
  ]);
});

test.each([{ rows: [] }, { rows: [result("deployment", "checked")] }])(
  "successful results stay silent",
  async ({ rows }) => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    await expect(
      worker.scheduled(null, environment(rows)),
    ).resolves.toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  },
);

test("a failed internal response keeps its separate existing error and logs no body", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  await expect(
    worker.scheduled(
      null,
      environment([result(privateValue, privateValue, privateValue)], 503),
    ),
  ).rejects.toThrow(
    "Operator keeper run failed; durable attempts are retained",
  );
  expect(log).not.toHaveBeenCalled();
});
