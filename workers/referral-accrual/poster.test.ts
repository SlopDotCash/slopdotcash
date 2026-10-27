import type { Database } from "bun:sqlite";
import { describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiItem,
  toFunctionSelector,
} from "viem";
import * as accountFactories from "viem/accounts";
import { privateKeyToAccount } from "viem/accounts";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { PosterConfig } from "./config";
import {
  type ChainState,
  message,
  type PosterClient,
  type PostRow,
  type PostStatus,
  postNextRoot,
} from "./core";
import { createEvmPoster } from "./poster";
import { D1AccrualStore } from "./store";

const ONE = 10n ** 18n;
const DISTRIBUTOR = `0x${"d".repeat(40)}`;
const TOKEN = `0x${"7".repeat(40)}`;
// Public Anvil account 1; never a deployed account or a credential.
const TEST_ACCOUNT = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const SIGNER = TEST_ACCOUNT.address.toLowerCase();
const ROOT_A = `0x${"a".repeat(64)}`;

const POSTER: PosterConfig = {
  network: "robinhood-testnet",
  chainId: 46630,
  distributor: DISTRIBUTOR,
  token: TOKEN,
  rpcUrl: "http://127.0.0.1:1",
  gas: { perTransactionWei: "200000000000000", perDayWei: "2000000000000000" },
};

function sha(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

/** A filed epoch with the given root (null for an empty tree). */
function addFile(
  sqlite: Database,
  period: string,
  epoch: number,
  root: string | null,
  total: bigint,
) {
  const body = JSON.stringify({ period, epoch });
  sqlite
    .query(
      "INSERT INTO referral_accrual_files (period, epoch, run_id, mode, body, body_sha256, merkle_root, tree_total_base, leaf_count, created_at) VALUES (?, ?, 'rrun_test0001', 'live', ?, ?, ?, ?, ?, ?)",
    )
    .run(
      period,
      epoch,
      body,
      sha(body),
      root,
      total.toString(),
      root === null ? 0 : 1,
      `${period}-28T00:00:00.000Z`,
    );
}

interface FakeChain extends PosterClient {
  state_: ChainState;
  prepared: { epoch: number; root: string; total: bigint }[];
  broadcasts: string[];
  statusFor: (row: PostRow) => PostStatus;
  broadcastError: Error | null;
  signer: string | null;
}

function fakeChain(overrides: Partial<ChainState> = {}): FakeChain {
  let counter = 0;
  const chain: FakeChain = {
    signer: SIGNER,
    state_: {
      chainId: 46630,
      token: TOKEN,
      poster: SIGNER,
      paused: false,
      epochCap: 250_000n * ONE,
      totalClaimed: 0n,
      balance: 2_000_000n * ONE,
      nextEpoch: 0,
      hasPendingRoot: false,
      ...overrides,
    },
    prepared: [],
    broadcasts: [],
    statusFor: () => ({ kind: "pending" }),
    broadcastError: null,
    address: () => chain.signer,
    async state() {
      return chain.state_;
    },
    async prepare(epoch, root, total, authorize) {
      await authorize?.("1000");
      chain.prepared.push({ epoch, root, total });
      counter += 1;
      return {
        txId: `0x${counter.toString(16).padStart(64, "0")}`,
        rawTx: `0x${"f".repeat(20)}${counter.toString(16).padStart(4, "0")}`,
        evmNonce: counter - 1,
        maximumNativeWei: "1000",
      };
    },
    async nativeCost() {
      return { maximumWei: "1000", actualWei: null, settledDay: null };
    },
    async broadcast(raw) {
      if (chain.broadcastError) throw chain.broadcastError;
      chain.broadcasts.push(raw);
    },
    async status(row) {
      return chain.statusFor(row);
    },
  };
  return chain;
}

function harness(chain: FakeChain, at = "2026-12-03T00:00:00.000Z") {
  const { db, sqlite } = sqliteD1();
  const logs: Record<string, unknown>[] = [];
  const deps = {
    config: POSTER,
    store: new D1AccrualStore(db),
    client: chain,
    now: () => new Date(at),
    randomId: (() => {
      let n = 0;
      return () => {
        n += 1;
        return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
      };
    })(),
    log: (event: Record<string, unknown>) => logs.push(event),
  };
  const posts = () =>
    sqlite
      .query(
        "SELECT period, epoch, state, reason, tx_id, merkle_root, total_base, block_number FROM referral_root_posts ORDER BY created_at",
      )
      .all() as {
      period: string;
      epoch: number;
      state: string;
      reason: string | null;
      tx_id: string;
      merkle_root: string;
      total_base: string;
      block_number: string | null;
    }[];
  return { db, sqlite, deps, logs, posts };
}

// Actual viem client and all migrated SQLite tables; the RPC replies are controlled
// local evidence, not provider or chain qualification. Public Anvil fixture key only.
async function receiptHarness() {
  const chain = fakeChain();
  chain.prepare = async (epoch, root, total, authorize) => {
    await authorize?.("21000");
    const rawTx = await TEST_ACCOUNT.signTransaction({
      chainId: 46630,
      type: "eip1559",
      to: DISTRIBUTOR as `0x${string}`,
      nonce: 0,
      value: 0n,
      gas: 21000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      data: encodeFunctionData({
        abi: parseAbi(["function postRoot(uint256,bytes32,uint256)"]),
        functionName: "postRoot",
        args: [BigInt(epoch), root as `0x${string}`, total],
      }),
    });
    return {
      txId: keccak256(rawTx),
      rawTx,
      evmNonce: 0,
      maximumNativeWei: "21000",
    };
  };
  const h = harness(chain);
  addFile(h.sqlite, "2026-11", 0, ROOT_A, ONE);
  await postNextRoot(h.deps);
  const [row] = await h.deps.store.openPosts(POSTER.network);
  const hash = (c: string) => `0x${c.repeat(64)}` as `0x${string}`;
  const posted = parseAbiItem(
    "event RootPosted(uint256 indexed epoch, bytes32 root, uint256 total, uint64 claimableAt)",
  );
  const voided = parseAbiItem(
    "event RootVoided(uint256 indexed epoch, bytes32 root)",
  );
  let fault = "valid";
  const calls: { method: string; params: unknown[] }[] = [];
  const log = (isVoid: boolean) => ({
    address: DISTRIBUTOR,
    blockHash: hash(isVoid ? "b" : "a"),
    blockNumber: isVoid ? "0xf" : "0xa",
    transactionHash: isVoid ? hash("c") : row.txId,
    transactionIndex: "0x0",
    logIndex: "0x0",
    removed: false,
    topics: encodeEventTopics({
      abi: [isVoid ? voided : posted],
      eventName: isVoid ? "RootVoided" : "RootPosted",
      args: { epoch: 0n },
    }),
    data: isVoid
      ? encodeAbiParameters([{ type: "bytes32" }], [ROOT_A as `0x${string}`])
      : encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
          [ROOT_A as `0x${string}`, ONE, 604801n],
        ),
  });
  const fetchRpc = (async (_url, init) => {
    const { id, method, params } = JSON.parse(String(init?.body));
    calls.push({ method, params });
    let result: unknown;
    if (method === "eth_chainId")
      result = fault === "wrong_chain" ? "0x1" : "0xb626";
    else if (method === "eth_getBlockByNumber") {
      const number = params[0] === "finalized" ? "0x14" : params[0];
      result = {
        number,
        hash: hash(number === "0xa" ? "a" : number === "0xf" ? "b" : "d"),
        parentHash: hash("e"),
        timestamp: "0x1",
        gasLimit: "0x1c9c380",
        gasUsed: "0x5208",
        baseFeePerGas: "0x1",
        transactions: [number === "0xf" ? hash("c") : row.txId],
      };
    } else if (method === "eth_getTransactionReceipt") {
      const isVoid = params[0] === hash("c");
      const evidence = log(isVoid);
      result =
        fault === "missing_advanced"
          ? null
          : {
              ...evidence,
              from: isVoid ? `0x${"1".repeat(40)}` : SIGNER,
              to: DISTRIBUTOR,
              transactionHash:
                fault === "wrong_hash" ? hash("f") : evidence.transactionHash,
              blockHash: ["wrong_block", "noncanonical_revert"].includes(fault)
                ? hash("f")
                : evidence.blockHash,
              transactionIndex: fault === "wrong_index" ? "0x5" : "0x0",
              status: fault === "noncanonical_revert" ? "0x0" : "0x1",
              type: "0x2",
              cumulativeGasUsed: "0x5208",
              gasUsed: "0x5208",
              effectiveGasPrice: "0x1",
              contractAddress: null,
              logs:
                fault === "no_event"
                  ? []
                  : [
                      {
                        ...evidence,
                        blockHash:
                          fault === "wrong_event_block"
                            ? hash("f")
                            : evidence.blockHash,
                      },
                    ],
              logsBloom: `0x${"0".repeat(512)}`,
            };
    } else if (method === "eth_getTransactionByHash") result = null;
    else if (method === "eth_getTransactionCount") result = "0x1";
    else if (method === "eth_getLogs")
      result = fault === "final_void" ? [log(true)] : [];
    else if (method === "eth_sendRawTransaction") {
      if (fault === "send_error")
        return new Response("controlled local failure", { status: 503 });
      result = hash("f");
    } else if (method === "eth_call") {
      const selector = params[0].data.slice(0, 10);
      if (selector === toFunctionSelector("epochAt(uint256)"))
        result = encodeAbiParameters(
          [
            {
              type: "tuple",
              components: [
                { name: "root", type: "bytes32" },
                { name: "total", type: "uint256" },
                { name: "postedAt", type: "uint64" },
                { name: "voided", type: "bool" },
              ],
            },
          ],
          [
            {
              root: ROOT_A as `0x${string}`,
              total: fault === "wrong_total" ? 2n * ONE : ONE,
              postedAt: 1n,
              voided: ["nonfinal_void", "final_void"].includes(fault),
            },
          ],
        );
      else if (selector === toFunctionSelector("token()"))
        result = encodeAbiParameters(
          [{ type: "address" }],
          [TOKEN as `0x${string}`],
        );
      else if (
        [
          toFunctionSelector("owner()"),
          toFunctionSelector("poster()"),
        ].includes(selector)
      )
        result = encodeAbiParameters(
          [{ type: "address" }],
          [SIGNER as `0x${string}`],
        );
      else if (
        [
          toFunctionSelector("paused()"),
          toFunctionSelector("hasPendingRoot()"),
        ].includes(selector)
      )
        result = encodeAbiParameters([{ type: "bool" }], [false]);
      else
        result = encodeAbiParameters(
          [{ type: "uint256" }],
          [selector === toFunctionSelector("nextEpoch()") ? 1n : 1000n * ONE],
        );
    } else throw new Error(`Unexpected fixture method ${method}`);
    return Response.json({ jsonrpc: "2.0", id, result });
  }) as typeof fetch;
  const client = createEvmPoster({ config: POSTER, fetch: fetchRpc });
  const deps = { ...h.deps, client };
  return {
    ...h,
    row,
    client,
    deps,
    calls,
    setFault: (next: string) => {
      fault = next;
    },
  };
}

describe("canonical poster journal through actual client", () => {
  test.each([
    "wrong_hash",
    "wrong_block",
    "wrong_index",
    "no_event",
    "wrong_event_block",
    "wrong_total",
    "noncanonical_revert",
    "wrong_chain",
  ])("%s cannot close a migrated journal", async (fault) => {
    const h = await receiptHarness();
    try {
      h.setFault(fault);
      await expect(postNextRoot(h.deps)).rejects.toThrow();
      expect(h.posts()[0].state).toBe("submitted");
      expect((await h.deps.store.openPosts(POSTER.network))[0]).toEqual(h.row);
      expect(
        h.calls.filter((c) => c.method === "eth_sendRawTransaction"),
      ).toHaveLength(0);
    } finally {
      h.sqlite.close();
    }
  });
  test("missing receipt and advanced nonce stay held without a new send", async () => {
    const h = await receiptHarness();
    try {
      h.setFault("missing_advanced");
      expect(await postNextRoot(h.deps)).toMatchObject({
        status: "in_flight",
        reconciled: 0,
      });
      expect((await h.deps.store.openPosts(POSTER.network))[0]).toEqual(h.row);
      expect(
        h.calls.filter((c) => c.method === "eth_sendRawTransaction"),
      ).toHaveLength(0);
    } finally {
      h.sqlite.close();
    }
  });
  test("nonfinal void holds, disappears safely, and only canonical final void is permanent", async () => {
    const h = await receiptHarness();
    try {
      await postNextRoot(h.deps);
      expect(h.posts()[0].state).toBe("finalized");
      h.setFault("nonfinal_void");
      expect(
        await postNextRoot({ ...h.deps, store: new D1AccrualStore(h.db) }),
      ).toMatchObject({ status: "in_flight" });
      expect(h.posts()[0].state).toBe("finalized");
      h.setFault("valid");
      await postNextRoot(h.deps);
      expect(h.posts()[0].state).toBe("finalized");
      h.setFault("final_void");
      expect(await postNextRoot(h.deps)).toMatchObject({
        status: "halted_after_void",
      });
      expect(h.posts()[0].state).toBe("voided");
    } finally {
      h.sqlite.close();
    }
  });
  test("configuration change refuses before RPC or stored broadcast", async () => {
    const h = await receiptHarness();
    try {
      expect(
        await postNextRoot({
          ...h.deps,
          config: { ...POSTER, distributor: `0x${"9".repeat(40)}` },
        }),
      ).toMatchObject({ status: "chain_mismatch" });
      expect(h.calls).toHaveLength(0);
      expect((await h.deps.store.openPosts(POSTER.network))[0]).toEqual(h.row);
    } finally {
      h.sqlite.close();
    }
  });
  test("actual transport error cannot put signed bytes into a diagnostic; wrong returned hash refuses", async () => {
    const h = await receiptHarness();
    try {
      h.setFault("send_error");
      let error: unknown;
      try {
        await h.client.broadcast(`0x${"ba".repeat(100)}`);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeDefined();
      expect(String(error)).toContain("bababa");
      expect(message(error)).toBe("referral_operation_failed");
      h.setFault("valid");
      await expect(h.client.broadcast(h.row.rawTx)).rejects.toThrow(
        "hash differs",
      );
    } finally {
      h.sqlite.close();
    }
  });
});

describe("durable referral native fee budgets", () => {
  const limits = { perTransactionWei: "1000", perDayWei: "1500" };
  test("actual quote over the cap never invokes the account signer or broadcast", async () => {
    let signed = 0,
      sent = 0;
    const originalFactory = accountFactories.privateKeyToAccount;
    const observer = spyOn(
      accountFactories,
      "privateKeyToAccount",
    ).mockImplementation((...args) => {
      const account = originalFactory(...args);
      const sign = account.signTransaction;
      return Object.assign(account, {
        signTransaction: async (...parameters: unknown[]) => {
          signed++;
          return Reflect.apply(sign, account, parameters);
        },
      });
    });
    const fetchRpc = (async (_url, init) => {
      const { id, method } = JSON.parse(String(init?.body));
      const result =
        method === "eth_call"
          ? "0x"
          : method === "eth_estimateGas"
            ? "0x5208"
            : method === "eth_getTransactionCount"
              ? "0x0"
              : method === "eth_maxPriorityFeePerGas"
                ? "0x1"
                : method === "eth_getBlockByNumber"
                  ? {
                      number: "0x1",
                      hash: `0x${"a".repeat(64)}`,
                      parentHash: `0x${"b".repeat(64)}`,
                      timestamp: "0x1",
                      baseFeePerGas: "0x1",
                      gasUsed: "0x0",
                      gasLimit: "0x100000",
                      transactions: [],
                    }
                  : undefined;
      if (method === "eth_sendRawTransaction") sent++;
      if (result === undefined)
        throw new Error(`Unexpected quote request ${method}`);
      return Response.json({ jsonrpc: "2.0", id, result });
    }) as typeof fetch;
    try {
      const client = createEvmPoster({
        config: { ...POSTER, gas: { perTransactionWei: "1", perDayWei: "2" } },
        privateKey:
          "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
        fetch: fetchRpc,
      });
      await expect(client.prepare(0, ROOT_A, ONE)).rejects.toThrow(
        /native fee limit/u,
      );
      expect(signed).toBe(0);
      expect(sent).toBe(0);
      const allowed = createEvmPoster({
        config: POSTER,
        fetch: fetchRpc,
        privateKey:
          "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
      });
      await allowed.prepare(0, ROOT_A, ONE);
      expect(signed).toBe(1); // The observer reaches the real account signer on an allowed quote.
      expect(sent).toBe(0);
    } finally {
      observer.mockRestore();
    }
  });
  test("unknown sends retain one reservation across midnight and unchanged rebroadcast", async () => {
    const chain = fakeChain();
    const h = harness(chain);
    h.deps.config = { ...POSTER, gas: limits };
    addFile(h.sqlite, "2026-11", 0, ROOT_A, ONE);
    chain.broadcastError = new Error("send outcome unknown");
    expect((await postNextRoot(h.deps)).status).toBe("in_flight");
    h.deps.now = () => new Date("2026-12-04T00:00:00.000Z");
    await expect(
      h.deps.store.assertGasBudget(POSTER.network, "600", limits, h.deps.now()),
    ).rejects.toThrow(/budget reached/u);
    chain.broadcastError = null;
    chain.statusFor = () => ({ kind: "rebroadcast" });
    expect((await postNextRoot(h.deps)).status).toBe("in_flight");
    expect(chain.prepared).toHaveLength(1);
    expect(chain.broadcasts).toHaveLength(1);
    expect(
      h.sqlite
        .query(
          "SELECT maximum_wei,actual_wei,settled_day FROM referral_post_gas",
        )
        .all(),
    ).toEqual([{ maximum_wei: 1000, actual_wei: null, settled_day: null }]);
    h.sqlite.close();
  });
  test("reverted costs consume the receipt UTC day's budget and release only later-day capacity", async () => {
    const chain = fakeChain();
    const h = harness(chain);
    h.deps.config = { ...POSTER, gas: limits };
    addFile(h.sqlite, "2026-11", 0, ROOT_A, ONE);
    await postNextRoot(h.deps);
    chain.statusFor = () => ({ kind: "failed", reason: "canonical revert" });
    chain.nativeCost = async () => ({
      maximumWei: "1000",
      actualWei: "900",
      settledDay: "2026-12-04",
    });
    h.deps.now = () => new Date("2026-12-04T00:00:00.000Z");
    expect((await postNextRoot(h.deps)).status).toBe("gas_budget");
    expect(chain.prepared).toHaveLength(1);
    expect(chain.broadcasts).toHaveLength(1);
    expect(
      h.sqlite
        .query(
          "SELECT maximum_wei,actual_wei,settled_day FROM referral_post_gas",
        )
        .all(),
    ).toEqual([
      { maximum_wei: 1000, actual_wei: 900, settled_day: "2026-12-04" },
    ]);
    h.deps.now = () => new Date("2026-12-05T00:00:00.000Z");
    expect((await postNextRoot(h.deps)).status).toBe("posted");
    expect(chain.broadcasts).toHaveLength(2);
    h.sqlite.close();
  });
  test("overlapping quotes cannot commit or broadcast two native liabilities", async () => {
    const chain = fakeChain();
    const h = harness(chain);
    h.deps.config = { ...POSTER, gas: limits };
    addFile(h.sqlite, "2026-11", 0, ROOT_A, ONE);
    const original = chain.prepare;
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    chain.prepare = async (...args) => {
      const prepared = await original(...args);
      if (++arrived === 2) release();
      await barrier;
      return prepared;
    };
    const results = await Promise.allSettled([
      postNextRoot(h.deps),
      postNextRoot(h.deps),
    ]);
    expect(
      results.filter(
        (r) => r.status === "fulfilled" && r.value.status === "posted",
      ),
    ).toHaveLength(1);
    expect(chain.broadcasts).toHaveLength(1);
    expect(h.posts()).toHaveLength(1);
    expect(
      h.sqlite
        .query("SELECT sum(maximum_wei) total FROM referral_post_gas")
        .get(),
    ).toEqual({ total: 1000 });
    h.sqlite.close();
  });
  test("lower transaction cap refuses before signing or any journal reservation", async () => {
    const chain = fakeChain();
    const h = harness(chain);
    h.deps.config = {
      ...POSTER,
      gas: { perTransactionWei: "999", perDayWei: "1500" },
    };
    addFile(h.sqlite, "2026-11", 0, ROOT_A, ONE);
    expect((await postNextRoot(h.deps)).status).toBe("gas_budget");
    expect(chain.prepared).toHaveLength(0);
    expect(chain.broadcasts).toHaveLength(0);
    expect(h.posts()).toHaveLength(0);
    h.sqlite.close();
  });
  test("actual client prices only canonical receipt evidence and derives legacy signed liability", async () => {
    const h = await receiptHarness();
    try {
      h.setFault("missing_advanced");
      expect(await h.client.nativeCost(h.row)).toEqual({
        maximumWei: "21000",
        actualWei: null,
        settledDay: null,
      });
      h.setFault("wrong_index");
      await expect(h.client.nativeCost(h.row)).rejects.toThrow(
        /identity differs/u,
      );
      h.setFault("valid");
      expect(await h.client.nativeCost(h.row)).toEqual({
        maximumWei: "21000",
        actualWei: "21000",
        settledDay: "1970-01-01",
      });
    } finally {
      h.sqlite.close();
    }
  });
});
