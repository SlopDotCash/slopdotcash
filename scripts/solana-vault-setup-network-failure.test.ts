// An owner who sets up a Solana vault must learn whether the chain was not
// read or a reviewed fact did not match, as on EVM. An RPC that answers HTTP
// 429 or refuses the connection is a retryable network failure; it is never a
// program that "needs review" and never an invalid creation transaction (PRD
// sections 4 and 7, issue #904). A real program mismatch keeps its refusal.
import { afterAll, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  CONFIG_DISCRIMINATOR,
  CONFIG_SIZE,
  solanaBase58,
  solanaConfigAddress,
} from "../contracts/solana/adapter";
import type { ReviewedSolanaProgram } from "../contracts/solana/programs";
import { ESCROW_NETWORKS } from "../src/lib/escrow-policy.mjs";
import { applicationManifest } from "../tests/project-application-manifest";
import { vaultSetupHarness } from "./vault-setup-test-harness";

const NOW = "2026-10-27T00:00:00.000Z";
const OWNER = { githubId: "900000002", githubLogin: "owner" };
const CLAIM = "verified-owner-wallet";
const key = (byte: number) => solanaBase58(new Uint8Array(32).fill(byte));
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const OWNER_WALLET = key(2);
const network = ESCROW_NETWORKS["solana-mainnet"];

// Chain facts that the local RPC serves for the reviewed program below: a
// non-upgradeable program, its singleton Config and the classic USDC mint.
let programCode = new Uint8Array([1, 2, 3, 4]);
const program: ReviewedSolanaProgram = {
  network: "solana-mainnet",
  sourceCommit: "0123456789abcdef0123456789abcdef01234567",
  programId: key(5),
  codeSha256: createHash("sha256").update(programCode).digest("hex"),
  upgradeAuthority: null,
  identityAuthority: key(3),
  feeRecipient: key(4),
  rotationAuthority: key(6),
  networkDomain: "ab".repeat(32),
  bindingDelaySeconds: "0",
  rotationDelaySeconds: "0",
} as ReviewedSolanaProgram;
const config = new Uint8Array(CONFIG_SIZE);
config.set(Buffer.from(CONFIG_DISCRIMINATOR, "hex"));
config.set(new Uint8Array(32).fill(3), 8);
config.set(new Uint8Array(32).fill(4), 40);
config.set(new Uint8Array(32).fill(6), 72);
const mint = new Uint8Array(82);
mint[44] = 6;
mint[45] = 1;
const accounts = (): Record<string, unknown> => ({
  [program.programId]: {
    owner: "BPFLoader2111111111111111111111111111111111",
    executable: true,
    data: [base64(programCode), "base64"],
  },
  [solanaConfigAddress(program.programId)]: {
    owner: program.programId,
    executable: false,
    data: [base64(config), "base64"],
  },
  [network.asset as string]: {
    owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    executable: false,
    data: [base64(mint), "base64"],
  },
});

// "limited": every read answers HTTP 429. "program": the program, Config and
// mint are served, the project account does not exist yet, and every
// transaction read answers HTTP 429.
let mode: "limited" | "program" = "limited";
let reads = 0;
const rpc = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    reads++;
    const { method, params } = (await request.json()) as {
      method: string;
      params: [string];
    };
    const answer = (result: unknown) =>
      Response.json({ jsonrpc: "2.0", id: 1, result });
    if (mode === "program") {
      if (method === "getGenesisHash") return answer(network.genesisHash);
      if (method === "getAccountInfo")
        return answer({
          context: { slot: 1 },
          value: accounts()[params[0]] ?? null,
        });
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
    network: "solana",
    kind: "stablecoin",
    address: network.asset,
    symbol: "USDC",
  },
  reward: {
    ...(applicationManifest("vault-network", "example/vault-network")
      .reward as Record<string, unknown>),
    chain: "solana",
  },
  escrow: {
    schemaVersion: "1",
    effectiveCycle: "2026-11",
    chain: "solana",
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [],
  },
});
const { persistence, vaultSetup: post } = vaultSetupHarness({
  projectId: "vault-network",
  manifest,
  chain: "solana",
  claim: CLAIM,
  owner: OWNER,
  ownerWallet: OWNER_WALLET,
  now: NOW,
  network: "solana-mainnet",
  rpcUrl: () => rpcUrl,
  reviewed: { programs: [program] },
});
function vaultSetup(step: "review" | "register") {
  return post({
    step,
    expectedRevision: 1,
    network: "solana-mainnet",
    claimId: CLAIM,
    automatic: false,
    ...(step === "register"
      ? { transactionId: solanaBase58(new Uint8Array(64).fill(7)) }
      : {}),
  });
}
const retry = {
  error: "vault_network_unavailable",
};

test("an unreadable Solana RPC is a retry, while a program mismatch still refuses", async () => {
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
    // Registration: the program, Config and mint verify, then the creation
    // transaction read answers HTTP 429. The request is valid, so this is
    // not 422.
    mode = "program";
    reads = 0;
    expect(await vaultSetup("register")).toMatchObject({
      status: 503,
      body: retry,
    });
    // Two program checks and their account reads passed before the 429.
    expect(reads).toBeGreaterThan(8);
    // A program whose bytes differ from its review stays unavailable for
    // review and for registration.
    programCode = new Uint8Array([1, 2, 3, 5]);
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
