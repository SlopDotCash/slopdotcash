import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFunctionData, encodeFunctionResult, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ERC20, FACTORY, openEvmRun, runEvm } from "./evm";
import { amountsText, type Evidence, scenarioAmounts } from "./shared";

// Public synthetic scalars and a closed RPC fixture. The runner never signs or
// broadcasts here; any transaction RPC fails the fixture.
const fixtureKey = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const roles = [
  "REGISTRAR",
  "OWNER",
  "DEPOSITOR",
  "RELAYER",
  "ACTOR_A",
  "ACTOR_B",
  "IDENTITY",
];
const rpcUrl = "http://127.0.0.1:1/closed-section-21-resume-fixture";
const factory = "0x1000000000000000000000000000000000000001";
const sixDecimals = "0x3000000000000000000000000000000000000003";
const eighteenDecimals = "0x4000000000000000000000000000000000000004";
const originalFetch = globalThis.fetch;
let originalEnv: Record<string, string | undefined>;
let directory: string;
let source: string;
let methods: string[];

beforeEach(() => {
  originalEnv = {
    GIT_DIR: process.env.GIT_DIR,
    GIT_WORK_TREE: process.env.GIT_WORK_TREE,
  };
  for (const name of Object.keys(process.env)) {
    if (!name.startsWith("ESCROW_ACCEPTANCE_")) continue;
    originalEnv[name] = process.env[name];
    delete process.env[name];
  }
  // Evidence binds a clean source commit; bind a clean fixture repository.
  source = mkdtempSync(join(tmpdir(), "slop-section-21-source-"));
  execFileSync("git", ["init", "-q", source]);
  execFileSync("git", [
    "-C",
    source,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  process.env.GIT_DIR = join(source, ".git");
  process.env.GIT_WORK_TREE = source;
  for (const [index, name] of roles.entries())
    process.env[`ESCROW_ACCEPTANCE_${name}_KEY`] = fixtureKey(index + 101);
  process.env.ESCROW_ACCEPTANCE_RPC_URL = rpcUrl;
  process.env.ESCROW_ACCEPTANCE_FACTORY = factory;
  directory = mkdtempSync(join(tmpdir(), "slop-section-21-resume-"));
  methods = [];
  globalThis.fetch = (async (input, init) => {
    if (input !== rpcUrl || typeof init?.body !== "string")
      throw new Error("Unexpected fixture destination or request");
    const call = JSON.parse(init.body);
    methods.push(call.method);
    let result: unknown;
    if (call.method === "eth_chainId") result = "0xaa36a7";
    else if (call.method === "eth_blockNumber") result = "0x1";
    else if (call.method === "eth_getCode") result = "0x60006000";
    else if (call.method === "eth_call") {
      const { to, data } = call.params[0];
      if (to === sixDecimals || to === eighteenDecimals) {
        decodeFunctionData({ abi: ERC20, data });
        result = encodeFunctionResult({
          abi: ERC20,
          functionName: "decimals",
          result: to === sixDecimals ? 6 : 18,
        });
      } else {
        const { functionName } = decodeFunctionData({ abi: FACTORY, data });
        const values: Record<string, string | bigint> = {
          registrar: privateKeyToAccount(fixtureKey(101)).address,
          identityAuthority: privateKeyToAccount(fixtureKey(107)).address,
          feeRecipient: "0x2000000000000000000000000000000000000002",
          bindingDelay: 0n,
        };
        if (to !== factory || !(functionName in values))
          throw new Error(`Unexpected fixture contract read: ${functionName}`);
        result = encodeFunctionResult({
          abi: FACTORY,
          functionName,
          result: values[functionName] as never,
        });
      }
    } else throw new Error(`Unexpected fixture RPC: ${call.method}`);
    return Response.json({ jsonrpc: "2.0", id: call.id, result });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of Object.keys(process.env))
    if (name.startsWith("ESCROW_ACCEPTANCE_")) delete process.env[name];
  for (const name of ["GIT_DIR", "GIT_WORK_TREE"])
    if (originalEnv[name] === undefined) delete process.env[name];
  Object.assign(
    process.env,
    Object.fromEntries(
      Object.entries(originalEnv).filter(([, value]) => value !== undefined),
    ),
  );
  rmSync(directory, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
});

function asset(
  address: string,
  index: number,
  decimals: number,
  status: "passed" | "pending",
) {
  return {
    address,
    decimals,
    referenceStablecoin: false,
    amounts: amountsText(scenarioAmounts(decimals, 1n)),
    projectId: `acceptance-fixture-${index}`,
    onchainProjectId: `0x${String(index).repeat(64)}`,
    vault: null,
    deployment: {},
    steps: {},
    checks: {},
    status,
  };
}

test("a resumed run with a shorter asset list does not pass an unfinished asset", async () => {
  // The first run finished the six-decimal asset; the 18-decimal asset waits.
  const first = await openEvmRun("ethereum-sepolia", directory, "section-21");
  first.run.assets.push(
    asset(sixDecimals, 0, 6, "passed"),
    asset(eighteenDecimals, 1, 18, "pending"),
  );
  first.run.status = "waiting";
  first.run.waiting = { reason: "binding delay", until: null };
  await first.persist();

  const before = readFileSync(join(directory, "evidence.json"));

  // The rerun omits the waiting asset. It must not report passed.
  process.env.ESCROW_ACCEPTANCE_ASSETS = sixDecimals;
  const outcome = await runEvm("ethereum-sepolia", directory).then(
    (run) => run.status,
    (error: Error) => error.message,
  );
  expect(outcome).toBe("Asset list changed since the run started");
  const saved = JSON.parse(
    readFileSync(join(directory, "evidence.json"), "utf8"),
  ) as Evidence;
  expect(saved.status).toBe("waiting");
  expect(saved.assets.map((entry) => entry.status)).toEqual([
    "passed",
    "pending",
  ]);
  expect(readFileSync(join(directory, "evidence.json"))).toEqual(before);
  expect(methods).not.toContain("eth_sendRawTransaction");
});
