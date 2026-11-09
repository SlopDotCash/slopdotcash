// An owner who sets up an EVM vault must learn whether the chain was not read
// or a reviewed fact did not match. An RPC that answers HTTP 429 or refuses
// the connection is a retryable network failure; it is never a factory that
// "needs review" and never an invalid creation transaction (PRD sections 4
// and 7, issue #904). A real factory code mismatch keeps its refusal.
import { afterAll, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { toFunctionSelector } from "viem";
import type { ReviewedEvmFactory } from "../contracts/evm/factories";
import { ESCROW_NETWORKS } from "../src/lib/escrow-policy.mjs";
import { applicationManifest } from "../tests/project-application-manifest";
import { vaultSetupHarness } from "../tests/vault-setup-harness";

const NOW = "2026-10-27T00:00:00.000Z";
const OWNER = { githubId: "900000002", githubLogin: "owner" };
const OWNER_WALLET = "0x2000000000000000000000000000000000000002";
const CLAIM = "verified-owner-wallet";
const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const address = (digit: string) => `0x${digit.repeat(40)}`;
const word = (value: string) =>
  `0x${value.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
const codeSha256 = (code: string) =>
  createHash("sha256")
    .update(Buffer.from(code.slice(2), "hex"))
    .digest("hex");

// Chain facts that the local RPC serves for the reviewed factory below.
const code = {
  [address("5")]: "0x6080604052",
  [address("7")]: "0x60806040527f",
  [address("8")]: "0x608060405260",
};
const factory: ReviewedEvmFactory = {
  network: "base-mainnet",
  sourceCommit: "0123456789abcdef0123456789abcdef01234567",
  codeSha256: "ab".repeat(32),
  bindingDelaySeconds: "0",
  identityAuthority: address("3"),
  feeRecipient: address("4"),
  factory: address("5"),
  factoryCodeSha256: codeSha256(code[address("5")]),
  registrar: address("6"),
  evmUpgrade: {
    authority: address("9"),
    vaultImplementation: address("7"),
    vaultImplementationCodeSha256: codeSha256(code[address("7")]),
    factoryImplementation: address("8"),
    factoryImplementationCodeSha256: codeSha256(code[address("8")]),
  },
};
const getters = Object.fromEntries(
  Object.entries({
    "registrar()": factory.registrar,
    "feeRecipient()": factory.feeRecipient,
    "bindingDelay()": "0",
    "AUTHORITY_ROTATION_DELAY()": "0",
    "upgradeAuthority()": address("9"),
    "vaultImplementation()": address("7"),
    "identityAuthority()": factory.identityAuthority,
    // The owner's vault exists, so registration reaches the creation reads.
    "vaults(bytes32)": address("a"),
  }).map(([signature, value]) => [toFunctionSelector(signature), word(value)]),
);

// "limited": every read answers HTTP 429. "factory": the factory facts are
// served and every transaction, receipt and block read answers HTTP 429.
let mode: "limited" | "factory" = "limited";
let reads = 0;
const rpc = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    reads++;
    const { method, params } = (await request.json()) as {
      method: string;
      params: [Record<string, string> | string, string];
    };
    const answer = (result: unknown) =>
      Response.json({ jsonrpc: "2.0", id: 1, result });
    if (mode === "factory") {
      if (method === "eth_chainId") return answer("0x2105");
      if (method === "eth_getCode")
        return answer(code[String(params[0]).toLowerCase()] ?? "0x");
      if (method === "eth_getStorageAt" && params[1] === IMPLEMENTATION_SLOT)
        return answer(word(address("8")));
      if (method === "eth_call" && typeof params[0] === "object")
        return answer(getters[params[0].data.slice(0, 10)] ?? "0x");
    }
    return new Response("rate limited", { status: 429 });
  },
});
// A server that is stopped refuses the connection.
const closed = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(),
});
const closedUrl = `http://127.0.0.1:${closed.port}`;
closed.stop(true);
let rpcUrl = `http://127.0.0.1:${rpc.port}`;
afterAll(() => rpc.stop(true));

const manifest = applicationManifest("vault-network", "example/vault-network", {
  rewardAsset: {
    network: "base",
    kind: "stablecoin",
    address: ESCROW_NETWORKS["base-mainnet"].asset,
    symbol: "USDC",
  },
  reward: {
    ...(applicationManifest("vault-network", "example/vault-network")
      .reward as Record<string, unknown>),
    chain: "base",
  },
  escrow: {
    schemaVersion: "1",
    effectiveCycle: "2026-11",
    chain: "base",
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [],
  },
});
const { persistence, vaultSetup: post } = vaultSetupHarness({
  projectId: "vault-network",
  manifest,
  chain: "base",
  claim: CLAIM,
  owner: OWNER,
  ownerWallet: OWNER_WALLET,
  now: NOW,
  network: "base-mainnet",
  rpcUrl: () => rpcUrl,
  reviewed: { factories: [factory] },
});
function vaultSetup(step: "review" | "register") {
  return post({
    step,
    expectedRevision: 1,
    network: "base-mainnet",
    claimId: CLAIM,
    automatic: false,
    ...(step === "register" ? { transactionId: `0x${"ab".repeat(32)}` } : {}),
  });
}
const retry = {
  error: "vault_network_unavailable",
};

test("an unreadable RPC is a retry, while a factory mismatch still refuses", async () => {
  const logged: unknown[][] = [];
  const log = spyOn(console, "error").mockImplementation((...args) => {
    logged.push(args);
  });
  try {
    // Owner review: the RPC answers HTTP 429 for every read.
    mode = "limited";
    expect(await vaultSetup("review")).toMatchObject({
      status: 503,
      body: retry,
    });
    // Owner review: the RPC refuses the connection.
    rpcUrl = closedUrl;
    expect(await vaultSetup("review")).toMatchObject({
      status: 503,
      body: retry,
    });
    rpcUrl = `http://127.0.0.1:${rpc.port}`;
    // Registration: the factory verifies, then the transaction reads answer
    // HTTP 429. The creation request is valid, so this is not 422.
    mode = "factory";
    reads = 0;
    expect(await vaultSetup("register")).toMatchObject({
      status: 503,
      body: retry,
    });
    // The 12 factory reads passed, so the 429 came from the creation reads.
    expect(reads).toBeGreaterThan(12);
    // A factory whose code differs from its review stays unavailable for
    // review and for registration.
    code[address("5")] = "0x6080604053";
    for (const step of ["review", "register"] as const)
      expect(await vaultSetup(step)).toMatchObject({
        status: 503,
        body: {
          error: "vault_setup_unavailable",
        },
      });
    // Each server failure logs only the fixed label: no RPC URL or body.
    expect(logged).toEqual(Array(5).fill(["project API failure"]));
  } finally {
    log.mockRestore();
  }
  expect((await persistence.getProject("vault-network"))?.revision).toBe(1);
});
