/** Real RPC transport exercises the release readiness proof boundary. */
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { paymentDeploymentRecord } from "../src/lib/escrow-policy.mjs";
import { assertProjectRegistry } from "../src/lib/project-schema.mjs";
import { findProject } from "../src/lib/projects.mjs";
import { payoutReadiness, probeRpc, type ReadinessInput } from "./check-payout-readiness";
import { childEnvironment } from "./child-environment.mjs";

/** Executes the real CLI entrypoint; only the registry fixture is preloaded. */
async function readinessCli(args: string[], environment: Record<string, string> = {}) {
  const repository = resolve(import.meta.dir, "..");
  const child = Bun.spawn([
    process.execPath,
    "--no-env-file",
    "--preload",
    join(repository, "tests", "registry-preload.ts"),
    join(repository, "scripts", "check-payout-readiness.ts"),
    ...args,
  ], {
    cwd: repository,
    env: childEnvironment(process.env, environment),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill(), 10_000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

function readinessFixture(): ReadinessInput {
  const base = findProject("asi");
  if (!base) throw new Error("Fixture project missing");
  const deployment = {
    network: "base-sepolia",
    vault: `0x${"1".repeat(40)}`,
    asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    owner: `0x${"2".repeat(40)}`,
    identityAuthority: `0x${"3".repeat(40)}`,
    feeRecipient: `0x${"4".repeat(40)}`,
    factory: `0x${"5".repeat(40)}`,
    registrar: `0x${"6".repeat(40)}`,
    factoryCodeSha256: "a".repeat(64),
    codeSha256: "b".repeat(64),
    sourceCommit: "c".repeat(40),
    deploymentTransaction: `0x${"d".repeat(64)}`,
    bindingDelaySeconds: "0",
    rotationDelaySeconds: null,
    programId: null,
    projectPda: null,
    networkDomain: null,
    upgradeAuthority: null,
  };
  const registry = assertProjectRegistry([{
    ...base,
    reward: { ...base.reward, chain: "base", feeBasisPoints: 200 },
    escrow: {
      schemaVersion: "1", effectiveCycle: "2026-11", chain: "base",
      feeBasisPoints: 200, withdrawalFeeBasisPoints: 200, feeMode: "deduct-from-gross",
      deployments: [deployment],
    },
  }]);
  const pin = paymentDeploymentRecord(registry[0].id, registry[0].escrow!.deployments[0]);
  return {
    registry,
    registryDatabaseId: "registry-db",
    configs: [
      { vars: { SIGNER_ROLE: "attester", PAYMENT_DEPLOYMENTS: JSON.stringify([pin]) } },
      { vars: { SIGNER_ROLE: "relayer", PAYMENT_DEPLOYMENTS: JSON.stringify([pin]) } },
      {
        vars: { PAYMENT_NETWORKS: '["base-sepolia"]' },
        services: [{ binding: "EVM_PAYMENT_EXECUTOR", service: "fixture-relayer" }],
        d1_databases: [{ binding: "REGISTRY_DB", database_id: "registry-db" }],
      },
    ],
    rpcUrls: { "base-sepolia": "https://rpc.invalid" },
    executionEnabled: () => false,
  };
}

test("configuration readiness remains separate from a finalized probe", () => {
  const input = readinessFixture();
  const configured = payoutReadiness(input).find((row) => row.network === "base-sepolia");
  expect(configured).toMatchObject({ ready: true, rpc: "configured", executor: "enabled" });
  const refused = payoutReadiness({ ...input, probes: { "base-sepolia": "wrong-chain" } })
    .find((row) => row.network === "base-sepolia");
  expect(refused).toMatchObject({ ready: false, rpc: "wrong-chain" });
  expect(payoutReadiness({ ...input, probes: { "base-sepolia": "finalized" } })
    .find((row) => row.network === "base-sepolia")).toMatchObject({ ready: true, rpc: "finalized" });
});

test.each(["attester", "relayer"] as const)("duplicate %s pins are not an exact deployment inventory", (role) => {
  const input = readinessFixture();
  const config = input.configs.find((entry) => entry.vars?.SIGNER_ROLE === role)!;
  const pins = JSON.parse(String(config.vars!.PAYMENT_DEPLOYMENTS));
  config.vars!.PAYMENT_DEPLOYMENTS = JSON.stringify([...pins, ...pins]);
  expect(payoutReadiness(input).find((row) => row.network === "base-sepolia")?.ready).toBe(false);
});

test("every serving dispatcher must have exactly one correct registry binding", () => {
  const input = readinessFixture();
  const good = input.configs[2];
  const bad = { ...good, d1_databases: [
    { binding: "REGISTRY_DB", database_id: "registry-db" },
    { binding: "REGISTRY_DB", database_id: "registry-db" },
  ] };
  expect(payoutReadiness({ ...input, configs: [...input.configs, bad] })
    .find((row) => row.network === "base-sepolia")).toMatchObject({ ready: false, executor: "missing" });
});

test("a finalized result cannot make an invalid endpoint configuration ready", () => {
  const input = readinessFixture();
  expect(payoutReadiness({ ...input, rpcUrls: { "base-sepolia": "http://rpc.invalid" },
    probes: { "base-sepolia": "finalized" } }).find((row) => row.network === "base-sepolia"))
    .toMatchObject({ ready: false, rpc: "missing" });
});

test("malformed signer configuration refuses the complete report", () => {
  const input = readinessFixture();
  input.configs[0].vars!.PAYMENT_DEPLOYMENTS = "{";
  expect(() => payoutReadiness(input)).toThrow();
});

test.each(["identityAuthority", "factory"])("invalid registry %s refuses before reporting missing configuration", (field) => {
  const input = readinessFixture();
  const registry = input.registry as { escrow: { deployments: Record<string, unknown>[] } }[];
  registry[0].escrow.deployments[0][field] = null;
  expect(() => payoutReadiness(input)).toThrow();
});

test("release readiness requires an actual finalized EVM block and exact Solana slot", async () => {
  let evmHead: unknown = {};
  let slot = 1.5;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { method, params } = await request.json();
      if (method === "eth_getBlockByNumber")
        expect(params).toEqual(["finalized", false]);
      if (method === "getSlot")
        expect(params).toEqual([{ commitment: "finalized" }]);
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result:
          method === "eth_chainId"
            ? "0x2105"
            : method === "eth_getBlockByNumber"
              ? evmHead
              : method === "getGenesisHash"
                ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
                : slot,
      });
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  try {
    expect(await probeRpc("base-mainnet", url)).toBe("no-finalized-head");
    evmHead = { number: "0x1", hash: null };
    expect(await probeRpc("base-mainnet", url)).toBe("no-finalized-head");
    evmHead = { number: "0x1", hash: `0x${"1".repeat(64)}` };
    expect(await probeRpc("base-mainnet", url)).toBe("finalized");
    expect(await probeRpc("solana-mainnet", url)).toBe("no-finalized-head");
    slot = Number.MAX_SAFE_INTEGER + 1;
    expect(await probeRpc("solana-mainnet", url)).toBe("no-finalized-head");
    slot = 42;
    expect(await probeRpc("solana-mainnet", url)).toBe("finalized");
  } finally {
    server.stop(true);
  }
});

for (const scenario of [
  { name: "unequal EVM chain", network: "base-mainnet", identity: "0x1", head: null, expected: "wrong-chain", calls: 1 },
  { name: "unparseable EVM chain", network: "base-mainnet", identity: {}, head: null, expected: "unreachable", calls: 1 },
  { name: "RPC error with a result", network: "base-mainnet", identity: "0x2105", head: null, expected: "unreachable", calls: 1, error: true },
  { name: "missing RPC result", network: "base-mainnet", identity: null, head: null, expected: "unreachable", calls: 1, missing: true },
  { name: "noncanonical EVM block quantity", network: "base-mainnet", identity: "0x2105", head: { number: "0x01", hash: `0x${"1".repeat(64)}` }, expected: "no-finalized-head", calls: 2 },
  { name: "zero EVM block quantity", network: "base-mainnet", identity: "0x2105", head: { number: "0x0", hash: `0x${"1".repeat(64)}` }, expected: "finalized", calls: 2 },
  { name: "wrong Solana genesis", network: "solana-mainnet", identity: "another-chain", head: 42, expected: "wrong-chain", calls: 1 },
  { name: "string Solana slot", network: "solana-mainnet", identity: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", head: "42", expected: "no-finalized-head", calls: 2 },
  { name: "zero Solana slot", network: "solana-mainnet", identity: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", head: 0, expected: "no-finalized-head", calls: 2 },
] as const) {
  test(`probe classifies ${scenario.name} through RPC transport`, async () => {
    const methods: string[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const { method } = await request.json();
        methods.push(method);
        if ("missing" in scenario) return Response.json({ jsonrpc: "2.0", id: 1 });
        return Response.json({
          jsonrpc: "2.0", id: 1,
          result: methods.length === 1 ? scenario.identity : scenario.head,
          ...("error" in scenario ? { error: { code: -32000, message: "Unavailable" } } : {}),
        });
      },
    });
    try {
      expect(await probeRpc(scenario.network, `http://127.0.0.1:${server.port}`)).toBe(scenario.expected);
      expect(methods).toHaveLength(scenario.calls);
    } finally {
      server.stop(true);
    }
  });
}

for (const scenario of [
  { args: ["--unknown"], error: "Usage:" },
  { args: ["--config"], error: "Usage:" },
  { args: ["--config", "--probe"], error: "Usage:" },
  { args: ["--require", "base-sepolia"], error: "--require needs --probe" },
  { args: ["--probe", "--require", "unregistered-network"], error: "Unknown registry network" },
  { args: ["--registry-origin", "https://first.invalid", "--registry-origin", "https://second.invalid"], error: "Give --registry-origin once" },
]) {
  test(`CLI refuses ${scenario.args.join(" ")} before producing a report`, async () => {
    const result = await readinessCli(scenario.args);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(scenario.error);
  }, 15_000);
}

test("CLI prints a complete not-ready report without requiring a network", async () => {
  const result = await readinessCli([]);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  const lines = result.stdout.trim().split("\n");
  const report = JSON.parse(lines.at(-1)!);
  expect(report.schemaVersion).toBe("1");
  expect(report.networks.length).toBeGreaterThan(0);
  expect(lines.slice(0, -1)).toHaveLength(report.networks.length);
  expect(report.networks.every((row: { ready: boolean }) => !row.ready)).toBe(true);
}, 15_000);

test("CLI requirement failure follows the complete machine-readable report", async () => {
  const result = await readinessCli(["--probe", "--require", "base-sepolia"]);
  expect(result.code).toBe(1);
  const report = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
  expect(report.networks.find((row: { network: string }) => row.network === "base-sepolia"))
    .toMatchObject({ ready: false, rpc: "missing" });
  expect(result.stderr).toContain("payout readiness refused: base-sepolia not ready");
}, 15_000);

test("CLI rejects malformed config JSON before parsing the RPC map", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slop-readiness-cli-"));
  try {
    const good = join(directory, "good.json");
    const bad = join(directory, "bad.json");
    await writeFile(good, "{}");
    await writeFile(bad, "{");
    const result = await readinessCli(["--config", good, "--config", bad], {
      PAYMENT_RPC_URLS: "[]",
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("payout readiness check failed");
    expect(result.stderr).not.toContain("PAYMENT_RPC_URLS must be a JSON object");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

test("CLI rejects a non-object RPC map without producing a report", async () => {
  const result = await readinessCli(["--probe"], { PAYMENT_RPC_URLS: "[]" });
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("PAYMENT_RPC_URLS must be a JSON object");
}, 15_000);

test("CLI probes eligible RPC entries sequentially and skips unknown or non-string entries", async () => {
  const calls: string[] = [];
  let releaseFirst!: () => void;
  let enteredFirst!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const entered = new Promise<void>((resolve) => { enteredFirst = resolve; });
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const { method } = await request.json();
      calls.push(`${path}:${method}`);
      if (path === "/first" && method === "eth_chainId") {
        enteredFirst();
        await gate;
      }
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: method === "eth_chainId"
          ? path === "/first" ? "0x2105" : "0x14a34"
          : { number: "0x1", hash: `0x${"1".repeat(64)}` },
      });
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const operation = readinessCli(["--probe"], {
    PAYMENT_RPC_URLS: JSON.stringify({
      unknown: `${origin}/ignored`,
      "base-mainnet": `${origin}/first`,
      "ethereum-mainnet": 7,
      "base-sepolia": `${origin}/second`,
    }),
  });
  try {
    await Promise.race([
      entered,
      operation.then(() => { throw new Error("CLI ended before its first RPC"); }),
    ]);
    expect(calls).toEqual(["/first:eth_chainId"]);
    releaseFirst();
    const result = await operation;
    expect(result.code).toBe(0);
    expect(calls).toEqual([
      "/first:eth_chainId",
      "/first:eth_getBlockByNumber",
      "/second:eth_chainId",
      "/second:eth_getBlockByNumber",
    ]);
    JSON.parse(result.stdout.trim().split("\n").at(-1)!);
  } finally {
    releaseFirst();
    try {
      await operation;
    } finally {
      server.stop(true);
    }
  }
}, 15_000);

test("CLI parses the Solana genesis map after optional probes and before output", async () => {
  const methods: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { method } = await request.json();
      methods.push(method);
      return Response.json({
        jsonrpc: "2.0", id: 1,
        result: method === "eth_chainId" ? "0x2105"
          : { number: "0x1", hash: `0x${"1".repeat(64)}` },
      });
    },
  });
  try {
    const result = await readinessCli(["--probe"], {
      PAYMENT_RPC_URLS: JSON.stringify({ "base-mainnet": `http://127.0.0.1:${server.port}` }),
      PAYMENT_SOLANA_GENESIS: "[]",
    });
    expect(methods).toEqual(["eth_chainId", "eth_getBlockByNumber"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("PAYMENT_SOLANA_GENESIS must be a JSON object");
  } finally {
    server.stop(true);
  }
}, 15_000);
