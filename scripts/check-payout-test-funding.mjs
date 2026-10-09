/** Read-only test gas check: never loads keys, requests funds, or signs. */
import { pathToFileURL } from "node:url";
import { isFundingAddress } from "../src/lib/funding-address.mjs";

const NETWORKS = Object.freeze({
  "base-sepolia": {
    chain: "base",
    rpc: "https://sepolia.base.org",
    identity: "0x14a34",
    unit: "wei",
  },
  "solana-devnet": {
    chain: "solana",
    rpc: "https://api.devnet.solana.com",
    identity: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    unit: "lamports",
  },
  "solana-testnet": {
    chain: "solana",
    rpc: "https://api.testnet.solana.com",
    identity: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
    unit: "lamports",
  },
});

export async function checkTestFunding(network, address, endpoint) {
  const config = NETWORKS[network];
  if (!config)
    throw new Error("Expected base-sepolia, solana-devnet, or solana-testnet");
  if (
    !isFundingAddress(
      config.chain,
      config.chain === "base" && typeof address === "string"
        ? address.toLowerCase()
        : address,
    )
  )
    throw new Error("Invalid public address");
  const url = new URL(endpoint ?? config.rpc);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("RPC must use HTTPS without embedded credentials");
  async function rpc(method, params = []) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    } catch {
      throw new Error(`RPC transport failed for ${method}`);
    }
    if (!response.ok)
      throw new Error(`RPC HTTP ${response.status} for ${method}`);
    const body = await response.json();
    if (
      body.jsonrpc !== "2.0" ||
      body.id !== 1 ||
      body.error ||
      !("result" in body)
    )
      throw new Error(`RPC rejected ${method}`);
    return body.result;
  }
  const identity = await rpc(
    config.chain === "base" ? "eth_chainId" : "getGenesisHash",
  );
  if (identity !== config.identity)
    throw new Error("RPC network identity mismatch");
  let amount;
  let block;
  if (config.chain === "base") {
    const finalized = await rpc("eth_getBlockByNumber", ["finalized", false]);
    if (
      !finalized ||
      !/^0x[0-9a-f]+$/i.test(finalized.number) ||
      !/^0x[0-9a-f]{64}$/i.test(finalized.hash)
    )
      throw new Error("Invalid finalized block");
    const value = await rpc("eth_getBalance", [
      address,
      { blockHash: finalized.hash, requireCanonical: true },
    ]);
    if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value))
      throw new Error("Invalid balance");
    amount = BigInt(value);
    block = {
      number: BigInt(finalized.number).toString(),
      hash: finalized.hash,
    };
  } else {
    const value = await rpc("getBalance", [
      address,
      { commitment: "finalized" },
    ]);
    // JSON RPC numbers above the safe integer range cannot be reported exactly.
    if (
      !Number.isSafeInteger(value?.value) ||
      value.value < 0 ||
      !Number.isSafeInteger(value?.context?.slot)
    )
      throw new Error("Invalid or imprecise balance response");
    amount = BigInt(value.value);
    block = { slot: String(value.context.slot) };
  }
  return {
    network,
    address,
    networkIdentity: identity,
    commitment: "finalized",
    block,
    balance: amount.toString(),
    unit: config.unit,
    nonzero: amount > 0n,
    checkedAt: new Date().toISOString(),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length < 4 || process.argv.length > 5)
      throw new Error(
        "Usage: node scripts/check-payout-test-funding.mjs NETWORK ADDRESS [HTTPS_RPC_URL]",
      );
    console.log(
      JSON.stringify(await checkTestFunding(...process.argv.slice(2)), null, 2),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Funding check failed",
      }),
    );
    process.exitCode = 1;
  }
}
