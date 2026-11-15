import { expect, test } from "bun:test";
import { inspectFeeWorkerBindings } from "./inspect-fee-worker-bindings";

const deploymentId = "11111111-1111-1111-1111-111111111111";
const versionId = "22222222-2222-2222-2222-222222222222";
const sourceCommit = "a".repeat(40);
const deployment = {
  id: deploymentId,
  versions: [{ version_id: versionId, percentage: 100 }],
};
function transport(
  options: {
    changed?: boolean;
    split?: boolean;
    missingTag?: boolean;
    secrets?: boolean;
    plaintextRpc?: boolean;
  } = {},
) {
  const calls: { url: string; method: string | undefined }[] = [];
  let reads = 0;
  const request = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method });
      if (String(input).endsWith("/deployments")) {
        reads++;
        return Response.json({
          success: true,
          result: {
            deployments: [
              {
                ...deployment,
                ...(options.changed && reads > 1
                  ? { id: "33333333-3333-3333-3333-333333333333" }
                  : {}),
                ...(options.split
                  ? { versions: [{ version_id: versionId, percentage: 50 }] }
                  : {}),
              },
            ],
          },
        });
      }
      return Response.json({
        success: true,
        result: {
          id: versionId,
          annotations: options.missingTag
            ? {}
            : { "workers/tag": sourceCommit },
          resources: {
            bindings: [
              { name: "FEE_CONVERTER_MODE", type: "plain_text", text: "live" },
              {
                name: "FEE_CONVERTER_NETWORKS",
                type: "plain_text",
                text: "base,ethereum,robinhood",
              },
              {
                name: "FEE_WALLET_KEY_SOLANA",
                type: "secret_text",
                text: "PRIVATE_KEY_MUST_NOT_RETURN",
              },
              {
                name: "UNKNOWN",
                type: "plain_text",
                text: "PRIVATE_URL_MUST_NOT_RETURN",
              },
              ...(options.plaintextRpc
                ? [
                    {
                      name: "RPC_URL_SOLANA",
                      type: "plain_text",
                      text: "PRIVATE_RPC_MUST_NOT_RETURN",
                    },
                  ]
                : []),
              ...(options.secrets
                ? [
                    {
                      name: "RPC_URL_SOLANA",
                      type: "secret_text",
                      text: "PRIVATE_RPC_MUST_NOT_RETURN",
                    },
                    {
                      name: "SOLANA_RECOVERY_RPC_URL",
                      type: "secret_text",
                      text: "PRIVATE_RECOVERY_MUST_NOT_RETURN",
                    },
                  ]
                : []),
            ],
          },
        },
      });
    },
    { preconnect: fetch.preconnect },
  );
  return { request, calls };
}

test("only fixed metadata GET routes are called and secret values never leave the report", async () => {
  const fixture = transport({ secrets: true });
  const report = await inspectFeeWorkerBindings(
    "a".repeat(32),
    "private-token",
    { FEE_CONVERTER_MODE: "live" },
    sourceCommit,
    fixture.request,
  );
  expect(fixture.calls.map((call) => call.method)).toEqual([
    "GET",
    "GET",
    "GET",
  ]);
  expect(
    fixture.calls.map((call) =>
      new URL(call.url).pathname.split("/").slice(-2).join("/"),
    ),
  ).toEqual([
    "slop-fee-converter/deployments",
    `versions/${versionId}`,
    "slop-fee-converter/deployments",
  ]);
  expect(report.solanaPrimary).toBe("opaque-secret-binding");
  expect(report.solanaRecovery).toBe("opaque-secret-binding");
  expect(report.solanaKeyPresent).toBe(true);
  expect(report.settings).toEqual([
    {
      name: "FEE_CONVERTER_MODE",
      expected: "live",
      present: true,
      matchesReviewedConfiguration: true,
    },
  ]);
  expect(JSON.stringify(report)).not.toContain("PRIVATE_");
  expect(JSON.stringify(report)).not.toContain("private-token");
});

test("absent RPC bindings prove only the reviewed source defaults", async () => {
  const fixture = transport();
  const report = await inspectFeeWorkerBindings(
    "a".repeat(32),
    "private-token",
    { FEE_CONVERTER_MODE: "off" },
    sourceCommit,
    fixture.request,
  );
  expect(report.solanaPrimary).toBe("solana-public-default");
  expect(report.solanaRecovery).toBe("allnodes-publicnode-default");
  expect(report.settings[0].matchesReviewedConfiguration).toBe(false);
});

for (const fault of ["changed", "split", "missingTag"] as const)
  test(`refuses ${fault} deployment metadata`, async () => {
    const fixture = transport({ [fault]: true });
    await expect(
      inspectFeeWorkerBindings(
        "a".repeat(32),
        "private-token",
        {},
        sourceCommit,
        fixture.request,
      ),
    ).rejects.toThrow();
  });

test("absent bindings on a different deployed source do not establish current defaults", async () => {
  const fixture = transport();
  const report = await inspectFeeWorkerBindings(
    "a".repeat(32),
    "private-token",
    {},
    "b".repeat(40),
    fixture.request,
  );
  expect(report.sourceMatchesCheckout).toBe(false);
  expect(report.solanaPrimary).toBe("binding-absent-source-not-matched");
  expect(report.solanaRecovery).toBe("binding-absent-source-not-matched");
});

test("an RPC binding of any type prevents a default-provider claim", async () => {
  const fixture = transport({ plaintextRpc: true });
  const report = await inspectFeeWorkerBindings(
    "a".repeat(32),
    "private-token",
    {},
    sourceCommit,
    fixture.request,
  );
  expect(report.solanaPrimary).toBe("opaque-secret-binding");
  expect(JSON.stringify(report)).not.toContain("PRIVATE_RPC");
});
