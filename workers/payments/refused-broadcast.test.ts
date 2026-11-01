// The hosted EVM relayer stores a payment's signed bytes before it broadcasts
// them. When the node refuses the broadcast (here: the gas wallet is empty),
// the dispatcher's next scheduled run must resend the same bytes, not record a
// transaction the chain never saw as submitted. A recorded attempt is never
// dispatched again, and its unfilled nonce stops every later relayer payment.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  type Hex,
  keccak256,
  parseTransaction,
  toFunctionSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import { buildPaymentWalletMessage } from "../../backend/payments/possession";
import {
  type EscrowDeployment,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { JournalStore } from "../payment-executor/core";
import { PaymentSignerJournal } from "../payment-executor/index";
import { recoverUncertainAttempts, runPaymentDispatch } from "./index";

const registered = "2026-10-01T00:00:00.000Z";
const contributor = privateKeyToAccount(`0x${"9".repeat(64)}`);
const relayerKey = `0x${"7".repeat(64)}` as const;
const relayer = privateKeyToAccount(relayerKey);
const address = (byte: string) => `0x${byte.repeat(20)}`;
const vault = address("a1");
const owner = address("b2");
const identityAuthority = address("c3");
const feeRecipient = address("d4");
const factory = address("e5");
const registrar = address("f6");
const asset = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const vaultCode = "0x6001";
const factoryCode = "0x6002";
const codeSha256 = (code: string) =>
  bytesToHex(sha256(Uint8Array.from(Buffer.from(code.slice(2), "hex"))));
const obligationId = `0x${"ab".repeat(32)}`;
const sourceDigest = "cd".repeat(32);
const claimDigest = "ef".repeat(32);
const deployment: EscrowDeployment = {
  network: "base-sepolia",
  vault,
  programId: null,
  upgradeAuthority: null,
  projectPda: null,
  networkDomain: null,
  asset,
  owner,
  identityAuthority,
  feeRecipient,
  deploymentTransaction: `0x${"0d".repeat(32)}`,
  sourceCommit: "a".repeat(40),
  codeSha256: codeSha256(vaultCode),
  bindingDelaySeconds: "0",
  rotationDelaySeconds: null,
  factory,
  factoryCodeSha256: codeSha256(factoryCode),
  registrar,
};

/** A Base Sepolia node with the reviewed vault, one funded award and its current binding. */
const chain = {
  funded: false,
  accepted: new Map<string, Hex>(),
};
const word = (value: bigint | string) =>
  (typeof value === "bigint"
    ? value.toString(16)
    : value.replace(/^0x/, "").toLowerCase()
  ).padStart(64, "0");
const calls: Record<string, string> = {
  [toFunctionSelector("registrar()")]: word(registrar),
  [toFunctionSelector("feeRecipient()")]: word(feeRecipient),
  [toFunctionSelector("bindingDelay()")]: word(0n),
  [toFunctionSelector("AUTHORITY_ROTATION_DELAY()")]: word(604800n),
  [toFunctionSelector("vaults(bytes32)")]: word(vault),
  [toFunctionSelector("token()")]: word(asset),
  [toFunctionSelector("owner()")]: word(owner),
  [toFunctionSelector("factory()")]: word(factory),
  [toFunctionSelector("purpose()")]: word(0n),
  [toFunctionSelector("projectId()")]: "11".repeat(32),
  [toFunctionSelector("identityAuthority()")]: word(identityAuthority),
  // awards(id): actor, gross, fee, source, committedAt, paid.
  "0xe76af61d": [101n, 100000000n, 2000000n, sourceDigest, 1n, 0n]
    .map(word)
    .join(""),
  // bindings(actor): destination, version, claim digest, activatesAt, cancelled.
  "0xa45d1232": [contributor.address, 1n, claimDigest, 1n, 0n]
    .map(word)
    .join(""),
};
function answer(method: string, params: unknown[]) {
  switch (method) {
    case "eth_chainId":
      return "0x14a34";
    case "eth_getCode":
      return params[0] === factory ? factoryCode : vaultCode;
    case "eth_getStorageAt":
      return `0x${"0".repeat(64)}`;
    case "eth_call": {
      const data = (params[0] as { data: string }).data;
      const result = calls[data.slice(0, 10)];
      if (!result) throw new Error(`Unexpected call ${data.slice(0, 10)}`);
      return `0x${result}`;
    }
    case "eth_getBlockByNumber":
      return { number: "0x10", timestamp: "0x68000000", baseFeePerGas: "0x1" };
    case "eth_getTransactionCount":
      return `0x${chain.accepted.size.toString(16)}`;
    case "eth_estimateGas":
      return "0x186a0";
    case "eth_getTransactionReceipt":
      return null;
    case "eth_getTransactionByHash": {
      const raw = chain.accepted.get(String(params[0]).toLowerCase());
      return raw ? { hash: keccak256(raw) } : null;
    }
    case "eth_sendRawTransaction": {
      if (!chain.funded)
        return { error: "insufficient funds for gas * price + value" };
      const raw = params[0] as Hex;
      chain.accepted.set(keccak256(raw), raw);
      return keccak256(raw);
    }
    default:
      throw new Error(`Unexpected RPC ${method}`);
  }
}
let server: ReturnType<typeof Bun.serve>;
let rpcUrl: string;
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { id, method, params } = (await request.json()) as {
        id: number;
        method: string;
        params: unknown[];
      };
      const result = answer(method, params);
      return Response.json(
        result && typeof result === "object" && "error" in result
          ? {
              jsonrpc: "2.0",
              id,
              error: { code: -32000, message: result.error },
            }
          : { jsonrpc: "2.0", id, result },
      );
    },
  });
  rpcUrl = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

function memoryJournal(): JournalStore {
  const values = new Map<string, unknown>();
  const journal: JournalStore = {
    async get<T>(key: string) {
      return structuredClone(values.get(key)) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      values.set(key, structuredClone(value));
    },
    async transaction(callback) {
      return callback(journal);
    },
  };
  return journal;
}

async function stack() {
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((file) => file.endsWith(".sql"))
      .sort(),
  );
  const manifest = JSON.stringify({
    id: "project-1",
    status: "active",
    escrow: {
      schemaVersion: "1",
      effectiveCycle: "2026-10",
      chain: "base",
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [deployment],
    },
  });
  const manifestSha256 = bytesToHex(sha256(new TextEncoder().encode(manifest)));
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('project-1',1,?,?,'Fixture',?)",
    )
    .run(manifest, manifestSha256, registered);
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('project-1','active',1,?,?,?,?)",
    )
    .run(manifest, manifestSha256, registered, registered);
  sqlite
    .query(
      "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES('claim-1','101','alice',?,'d1_registry',?,?,?,NULL,?,'base')",
    )
    .run(contributor.address, claimDigest, registered, claimDigest, registered);
  const expiresAt = "2026-10-01T00:15:00.000Z";
  const message = buildPaymentWalletMessage({
    actorId: "101",
    chain: "base",
    address: contributor.address,
    claimId: "claim-1",
    claimDigest,
    nonce: "challenge-1",
    expiresAt,
  });
  sqlite
    .query(
      "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES('challenge-1','claim-1','101',?,?,?)",
    )
    .run(message, expiresAt, registered);
  sqlite
    .query(
      "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES('claim-1','101',?,'challenge-1',?)",
    )
    .run(registered, await contributor.signMessage({ message }));
  sqlite
    .query(
      "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,'project-1','101','base-sepolia','base',?,?,6,'100000000','2000000',?,'reserved',?)",
    )
    .run(obligationId, vault, asset, sourceDigest, registered);
  sqlite
    .query(
      "INSERT INTO payment_outbox(obligation_id,state,updated_at) VALUES(?,'ready',?)",
    )
    .run(obligationId, registered);
  const journal = memoryJournal();
  const signer = new PaymentSignerJournal(
    { storage: journal },
    {
      PAYMENTS_DB: db as D1Database,
      PAYMENT_DEPLOYMENTS: JSON.stringify([
        paymentDeploymentRecord("project-1", deployment),
      ]),
      PAYMENT_RPC_URLS: JSON.stringify({ "base-sepolia": rpcUrl }),
      SIGNER_ROLE: "relayer",
      CHAIN_FAMILY: "evm",
      SIGNER_STACK: "test",
      TEST_SIGNER_PRIVATE_KEY: relayerKey,
      JOURNAL: {
        idFromName() {
          throw new Error("The relayer journal is passed directly");
        },
        get() {
          throw new Error("The relayer journal is passed directly");
        },
      },
    },
  );
  const payRequests: string[] = [];
  const env = {
    PAYMENTS_DB: db as D1Database,
    REGISTRY_DB: db as D1Database,
    PAYMENT_NETWORKS: JSON.stringify(["base-sepolia"]),
    PAYMENT_RPC_URLS: JSON.stringify({ "base-sepolia": rpcUrl }),
    EVM_PAYMENT_EXECUTOR: {
      async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        if (path === "/v1/pay") payRequests.push(path);
        return signer.fetch(request);
      },
    },
  };
  const state = () =>
    sqlite
      .query<
        { attempt: string; transactionId: string | null; outbox: string },
        []
      >(
        "SELECT a.state attempt,a.transaction_id transactionId,b.state outbox FROM payment_attempts a JOIN payment_outbox b ON b.obligation_id=a.obligation_id",
      )
      .all();
  return { env, journal, payRequests, state };
}

/** The payments Worker's scheduled order: recover uncertain attempts, then dispatch. */
async function scheduledRun(env: Awaited<ReturnType<typeof stack>>["env"]) {
  const failures: unknown[] = [];
  for (const step of [
    () => recoverUncertainAttempts(env),
    () => runPaymentDispatch(env),
  ])
    await step().catch((error: unknown) => failures.push(error));
  return failures;
}

test.each(["processing", "submitted"] as const)(
  "an expired dispatcher cannot create a second payment while its replacement is %s",
  async (phase) => {
    chain.funded = true;
    chain.accepted.clear();
    const { env, payRequests, state } = await stack();
    let reached!: () => void;
    let resume!: () => void;
    const readReached = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const releaseRead = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const delayedDb: D1Database = {
      ...env.PAYMENTS_DB,
      prepare(sql) {
        const statement = env.PAYMENTS_DB.prepare(sql);
        if (!sql.startsWith("SELECT id,claim_id FROM payment_attempts"))
          return statement;
        return {
          ...statement,
          bind(...values) {
            const bound = statement.bind(...values);
            return {
              ...bound,
              async first<T>() {
                const value = await bound.first<T>();
                reached();
                await releaseRead;
                return value;
              },
            };
          },
        };
      },
    };
    const started = new Date("2026-10-01T00:01:00.000Z");
    const oldRun = runPaymentDispatch(
      { ...env, PAYMENTS_DB: delayedDb },
      () => started,
    );
    await readReached;
    let replacementReached!: () => void;
    let resumeReplacement!: () => void;
    const atExecutor = new Promise<void>((resolve) => {
      replacementReached = resolve;
    });
    const releaseExecutor = new Promise<void>((resolve) => {
      resumeReplacement = resolve;
    });
    const replacementRun = runPaymentDispatch(
      {
        ...env,
        EVM_PAYMENT_EXECUTOR: {
          async fetch(request: Request) {
            if (
              phase === "processing" &&
              new URL(request.url).pathname === "/v1/pay"
            ) {
              replacementReached();
              await releaseExecutor;
            }
            return env.EVM_PAYMENT_EXECUTOR.fetch(request);
          },
        },
      },
      () => new Date(started.getTime() + 61_000),
    );
    if (phase === "processing") await atExecutor;
    else await replacementRun;
    const before = await env.PAYMENTS_DB.prepare(
      "SELECT state,lease_token,lease_until FROM payment_outbox",
    ).first<{
      state: string;
      lease_token: string | null;
      lease_until: string | null;
    }>();
    resume();
    try {
      await oldRun;
      expect(
        await env.PAYMENTS_DB.prepare(
          "SELECT state,lease_token,lease_until FROM payment_outbox",
        ).first<{
          state: string;
          lease_token: string | null;
          lease_until: string | null;
        }>(),
      ).toEqual(before);
      if (phase === "processing") {
        expect(payRequests).toHaveLength(0);
        expect(state()).toEqual([
          { attempt: "prepared", transactionId: null, outbox: "processing" },
        ]);
      }
    } finally {
      resumeReplacement();
      await replacementRun;
    }
    expect({
      requests: payRequests.length,
      signedTransactions: chain.accepted.size,
      attempts: state().length,
    }).toEqual({ requests: 1, signedTransactions: 1, attempts: 1 });
    expect(parseTransaction([...chain.accepted.values()][0]).nonce).toBe(0);
    expect(state()[0].attempt).toBe("submitted");
    expect(state()[0].outbox).toBe("submitted");
  },
);

test("a payment the node refused is resent with the same bytes after the gas wallet is funded", async () => {
  chain.funded = false;
  chain.accepted.clear();
  const { env, journal, payRequests, state } = await stack();
  expect(await scheduledRun(env)).toHaveLength(1);
  expect(chain.accepted.size).toBe(0);
  expect(state()).toEqual([
    { attempt: "unknown", transactionId: null, outbox: "ready" },
  ]);
  const attempt = await env.PAYMENTS_DB.prepare(
    "SELECT id FROM payment_attempts",
  ).first<{ id: string }>();
  const signed = await journal.get<{ rawTransaction: Hex; transactionId: Hex }>(
    `pay:${attempt?.id}`,
  );
  expect(signed).toBeDefined();
  expect(parseTransaction(signed?.rawTransaction as Hex).nonce).toBe(0);

  // The operator funds the relayer's gas wallet; the next scheduled run follows.
  chain.funded = true;
  expect(await scheduledRun(env)).toEqual([]);
  // The same signed transaction was resent. Nothing new was signed.
  expect({
    onChain: [...chain.accepted.keys()],
    payRequests: payRequests.length,
    ledger: state(),
  }).toEqual({
    onChain: [signed?.transactionId as Hex],
    payRequests: 2,
    ledger: [
      {
        attempt: "submitted",
        transactionId: signed?.transactionId ?? null,
        outbox: "submitted",
      },
    ],
  });
  expect(
    await journal.get<number>(`nonce:84532:${relayer.address.toLowerCase()}`),
  ).toBe(1);
});

test("a broadcast the node accepted is recorded after the dispatcher lost the response", async () => {
  chain.funded = true;
  chain.accepted.clear();
  const { env, payRequests, state } = await stack();
  const deliver = env.EVM_PAYMENT_EXECUTOR.fetch;
  let lose = true;
  env.EVM_PAYMENT_EXECUTOR.fetch = async (request: Request) => {
    const response = await deliver(request);
    if (lose && new URL(request.url).pathname === "/v1/pay") {
      lose = false;
      return new Response("lost response", { status: 503 });
    }
    return response;
  };
  expect(await scheduledRun(env)).toHaveLength(1);
  expect(chain.accepted.size).toBe(1);
  expect(await scheduledRun(env)).toEqual([]);
  expect(state()).toEqual([
    {
      attempt: "submitted",
      transactionId: [...chain.accepted.keys()][0],
      outbox: "submitted",
    },
  ]);
  expect(payRequests).toHaveLength(1);
});
