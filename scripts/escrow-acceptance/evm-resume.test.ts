import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFunctionData, encodeFunctionResult, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FACTORY, openEvmRun } from "./evm";

// Public synthetic scalars only. The actual opener reads only this closed RPC
// fixture; these tests never run a scenario, sign, or broadcast a transaction.
const fixtureKey = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const dedicatedKey = fixtureKey(108);
const dedicated = privateKeyToAccount(dedicatedKey);
const roles = [
  "REGISTRAR",
  "OWNER",
  "DEPOSITOR",
  "RELAYER",
  "ACTOR_A",
  "ACTOR_B",
  "IDENTITY",
];
const rpcUrl = "http://127.0.0.1:1/closed-keeper-resume-fixture";
const originalFetch = globalThis.fetch;
let originalEnv: Record<string, string | undefined>;
let directory: string;
let source: string;
let methods: string[];
const evidenceBytes = () => readFileSync(join(directory, "evidence.json"));

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
  // Evidence binds a clean source commit. CI syncs the registry snapshot into
  // the checkout before tests, so bind a separate clean fixture repository.
  source = mkdtempSync(join(tmpdir(), "slop-keeper-source-"));
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
  process.env.ESCROW_ACCEPTANCE_FACTORY =
    "0x1000000000000000000000000000000000000001";
  directory = mkdtempSync(join(tmpdir(), "slop-keeper-resume-"));
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
      const { functionName } = decodeFunctionData({
        abi: FACTORY,
        data: call.params[0].data,
      });
      const values: Record<string, string | bigint> = {
        registrar: privateKeyToAccount(fixtureKey(101)).address,
        identityAuthority: privateKeyToAccount(fixtureKey(107)).address,
        feeRecipient: "0x2000000000000000000000000000000000000002",
        bindingDelay: 0n,
      };
      if (!(functionName in values))
        throw new Error(`Unexpected fixture contract read: ${functionName}`);
      result = encodeFunctionResult({
        abi: FACTORY,
        functionName,
        result: values[functionName] as never,
      });
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

test("dedicated keeper is pinned at creation and resumes its waiting evidence", async () => {
  process.env.ESCROW_ACCEPTANCE_KEEPER_KEY = dedicatedKey;
  const first = await openEvmRun("ethereum-sepolia", directory, "extended");
  expect(JSON.parse(evidenceBytes().toString()).roles.keeper).toBe(
    dedicated.address.toLowerCase(),
  );
  first.run.status = "waiting";
  first.run.waiting = { reason: "retained keeper send", until: null };
  await first.persist();
  const before = evidenceBytes();
  const resumed = await openEvmRun("ethereum-sepolia", directory, "extended");
  expect(resumed.run.runId).toBe(first.run.runId);
  expect(resumed.run.roles).toEqual(first.run.roles);
  expect(resumed.run.status).toBe("running");
  expect(evidenceBytes()).toEqual(before);
  expect(new Set(methods)).toEqual(
    new Set(["eth_chainId", "eth_call", "eth_getCode", "eth_blockNumber"]),
  );
});

test("changed or removed dedicated keeper refuses without rewriting the journal", async () => {
  process.env.ESCROW_ACCEPTANCE_KEEPER_KEY = dedicatedKey;
  const first = await openEvmRun("ethereum-sepolia", directory, "extended");
  first.run.status = "waiting";
  first.run.waiting = { reason: "retain pending send", until: null };
  await first.persist();
  const before = evidenceBytes();
  process.env.ESCROW_ACCEPTANCE_KEEPER_KEY = fixtureKey(109);
  await expect(
    openEvmRun("ethereum-sepolia", directory, "extended"),
  ).rejects.toThrow("another network, suite, factory or key set");
  expect(evidenceBytes()).toEqual(before);
  delete process.env.ESCROW_ACCEPTANCE_KEEPER_KEY;
  await expect(
    openEvmRun("ethereum-sepolia", directory, "extended"),
  ).rejects.toThrow("another network, suite, factory or key set");
  expect(evidenceBytes()).toEqual(before);
});

test("omitted keeper preserves and resumes the legacy relayer role shape", async () => {
  const first = await openEvmRun("ethereum-sepolia", directory, "extended");
  expect(Object.hasOwn(first.run.roles, "keeper")).toBe(false);
  const before = evidenceBytes();
  const resumed = await openEvmRun("ethereum-sepolia", directory, "extended");
  expect(resumed.run.roles).toEqual(first.run.roles);
  expect(evidenceBytes()).toEqual(before);
  process.env.ESCROW_ACCEPTANCE_KEEPER_KEY = dedicatedKey;
  await expect(
    openEvmRun("ethereum-sepolia", directory, "extended"),
  ).rejects.toThrow("another network, suite, factory or key set");
  expect(evidenceBytes()).toEqual(before);
});
