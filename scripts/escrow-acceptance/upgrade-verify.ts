/** Read-only qualification of an explicitly reviewed immutable plan from an older runner. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { EvmChain } from "./evm";
import {
  assertEvmTestChain,
  isAcceptanceNetwork,
  jsonRpc,
  requireEnv,
  sourceCommit,
} from "./shared";
import {
  type Qualification,
  UPGRADE_SCHEMA,
  verifyUpgrade,
} from "./upgrade-verification";

const [network, input, expectedSource, expectedDigest, output, ...extra] =
  process.argv.slice(2);
assert(
  network &&
    isAcceptanceNetwork(network) &&
    !network.startsWith("solana-") &&
    input &&
    output &&
    !extra.length &&
    /^[0-9a-f]{40}$/.test(expectedSource ?? "") &&
    /^[0-9a-f]{64}$/.test(expectedDigest ?? ""),
  "Usage: upgrade-verify.ts <test-network> <original-plan> <reviewed-plan-source> <reviewed-plan-sha256> <new-report>",
);
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const verifierSource = sourceCommit();
const rpcUrl = requireEnv("ESCROW_ACCEPTANCE_RPC_URL");
const chainId = assertEvmTestChain(
  network,
  BigInt((await jsonRpc(rpcUrl, "eth_chainId", [])) as string),
);
const bytes = await readFile(input);
assert.equal(
  digest(bytes),
  expectedDigest,
  "Original plan bytes differ from the explicit reviewed input",
);
const run = JSON.parse(bytes.toString()) as Qualification;
assert(
  run.schema === UPGRADE_SCHEMA &&
    run.sourceCommit === expectedSource &&
    run.network === network &&
    run.chainId === chainId &&
    run.factory.toLowerCase() ===
      requireEnv("ESCROW_ACCEPTANCE_FACTORY").toLowerCase(),
  "Original plan identity differs from the reviewed compatibility input",
);
const chain = new EvmChain(rpcUrl, Number(chainId), async () => {
  throw new Error("Read-only verifier must not persist a transaction");
});
const request = chain.rpc.bind(chain);
const reads = new Set([
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getTransactionReceipt",
  "eth_getStorageAt",
  "eth_getCode",
  "eth_getLogs",
  "eth_call",
]);
chain.rpc = (method, params) => {
  assert(reads.has(method), "Read-only verifier refused a mutating RPC method");
  return request(method, params);
};
const verification = await verifyUpgrade(run, chain);
assert.equal(
  digest(await readFile(input)),
  expectedDigest,
  "Original journal changed during read-only verification",
);
assert.equal(
  sourceCommit(),
  verifierSource,
  "Verifier source changed during qualification",
);
await writeFile(
  output,
  `${JSON.stringify(
    {
      schema: "slop-escrow-upgrade-preservation:v1",
      network,
      chainId,
      factory: run.factory,
      planSource: run.sourceCommit,
      planSha256: expectedDigest,
      verifierSource,
      originalPlanUnchanged: true,
      verification,
    },
    null,
    2,
  )}\n`,
  { flag: "wx", mode: 0o600 },
);
console.log(
  JSON.stringify({
    result: "verified",
    planSource: run.sourceCommit,
    verifierSource,
    preservationBlock: verification.preservationBlock,
    finalizedBlock: verification.finalizedBlock,
    laterPayments: verification.laterPayments.length,
    originalPlanUnchanged: true,
  }),
);
