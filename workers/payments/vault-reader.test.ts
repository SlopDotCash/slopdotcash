import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { readDeploymentVaultTotals } from "./index";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const deployment = {
  chain: "base" as const, network: "base-mainnet", vault: `0x${"1".repeat(40)}`,
  asset: `0x${"2".repeat(40)}`, owner: `0x${"3".repeat(40)}`,
  identityAuthority: `0x${"4".repeat(40)}`, feeRecipient: `0x${"5".repeat(40)}`,
  codeSha256: "a".repeat(64), bindingDelaySeconds: "0",
  chainId: "8453", factory: `0x${"6".repeat(40)}`,
  factoryCodeSha256: "b".repeat(64), registrar: `0x${"7".repeat(40)}`,
};
test("missing EVM review fields refuse without provider access", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error("unexpected provider access"); }) as typeof fetch;
  await expect(readDeploymentVaultTotals({ ...deployment, factory: undefined }, "https://rpc.invalid"))
    .rejects.toThrow("Reviewed chain deployment incomplete");
  expect(calls).toBe(0);
});
test("invalid EVM chain id refuses before provider access", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error("unexpected provider access"); }) as typeof fetch;
  await expect(readDeploymentVaultTotals({ ...deployment, chainId: "not-an-integer" }, "https://rpc.invalid"))
    .rejects.toThrow();
  expect(calls).toBe(0);
});
const signature = (name: string) => `0x${Buffer.from(keccak_256(new TextEncoder().encode(name))).toString("hex").slice(0, 8)}`;
const encodedWord = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const addressWord = (value: string) => `0x${"0".repeat(24)}${value.slice(2)}`;
const code = "0x6000";
const codeHash = createHash("sha256").update(Buffer.from(code.slice(2), "hex")).digest("hex");
function observedDeployment(codeMismatch = false) {
  const calls: { method: string; params: unknown[] }[] = [];
  let latestBlock = "0x20";
  const reviewed = { ...deployment, codeSha256: codeHash, factoryCodeSha256: codeHash };
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    let result: unknown;
    if (body.method === "eth_chainId") result = "0x2105";
    else if (body.method === "eth_getBlockByNumber") {
      expect(body.params).toEqual(["finalized", false]);
      result = { number: latestBlock, timestamp: "0x6553f100" };
      latestBlock = "0x21";
    } else if (body.method === "eth_getCode") {
      // The newer finalized head has another implementation. Only the old
      // counter block has the reviewed bytecode.
      const tag = body.params[1] === "finalized" ? latestBlock : body.params[1];
      result = !codeMismatch && tag === "0x20" ? code : "0x6001";
    } else if (body.method === "eth_getStorageAt") result = encodedWord(0n);
    else if (body.method === "eth_call") {
      const request = body.params[0] as { data: string };
      const selector = request.data.slice(0, 10);
      const values = new Map([
        [signature("token()"), addressWord(reviewed.asset)],
        [signature("owner()"), addressWord(reviewed.owner)],
        [signature("feeRecipient()"), addressWord(reviewed.feeRecipient)],
        [signature("factory()"), addressWord(reviewed.factory)],
        [signature("registrar()"), addressWord(reviewed.registrar)],
        [signature("bindingDelay()"), encodedWord(0n)],
        [signature("AUTHORITY_ROTATION_DELAY()"), encodedWord(604800n)],
        [signature("purpose()"), encodedWord(0n)],
        [signature("projectId()"), `0x${"8".repeat(64)}`],
        [signature("vaults(bytes32)"), addressWord(reviewed.vault)],
        [signature("decimals()"), encodedWord(6n)],
        [signature("totals()"), `0x${[5n, 1n, 0n, 1n, 0n, 2n, 1n, 0n, 1n, 4n].map((value) => encodedWord(value).slice(2)).join("")}`],
      ]);
      result = values.get(selector);
      if (result === undefined) throw new Error(`Unexpected getter ${selector}`);
    } else throw new Error(`Unexpected RPC ${body.method}`);
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  }) as typeof fetch;
  return { reviewed, calls };
}
test("EVM review uses the captured counter block after finalized head advances", async () => {
  const { reviewed, calls } = observedDeployment();
  const totals = await readDeploymentVaultTotals(reviewed, "https://rpc.invalid");
  expect(totals.blockNumber).toBe("32");
  expect(totals.freeBalance).toBe("2");
  const pinned = calls.filter((call) => ["eth_getCode", "eth_getStorageAt", "eth_call"].includes(call.method));
  expect(pinned.length).toBeGreaterThan(3);
  expect(pinned.every((call) => call.params[call.method === "eth_getStorageAt" ? 2 : 1] === "0x20")).toBe(true);
  const totalsAt = calls.findIndex((call) => call.method === "eth_call" && (call.params[0] as { data: string }).data === signature("totals()"));
  const reviewAt = calls.findIndex((call) => call.method === "eth_getCode");
  expect(totalsAt).toBeLessThan(reviewAt);
});
test("EVM review failure refuses the already-read counter result", async () => {
  const { reviewed, calls } = observedDeployment(true);
  await expect(readDeploymentVaultTotals(reviewed, "https://rpc.invalid")).rejects.toThrow("factory code");
  expect(calls.some((call) => call.method === "eth_call" && (call.params[0] as { data: string }).data === signature("totals()"))).toBe(true);
});
test("missing Solana project deployment refuses without provider access", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error("unexpected provider access"); }) as typeof fetch;
  await expect(readDeploymentVaultTotals({ ...deployment, chain: "solana", programId: "program" }, "https://rpc.invalid"))
    .rejects.toThrow("Solana project deployment missing");
  expect(calls).toBe(0);
});
