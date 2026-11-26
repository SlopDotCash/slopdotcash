// The deposit record: finalized vault deposits read by their own cursor.
import { expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { EVM_ESCROW_EVENT_TOPICS } from "../../contracts/evm/adapter";
import { encodeBase58Bytes } from "../../src/lib/base58";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  type DepositScanDeployment,
  recordVaultDeposits,
  scanEvmDeposits,
  scanSolanaDeposits,
  solanaDeposits,
} from "./deposits";

const VAULT = `0x${"2".repeat(40)}`;
const FUNDER = `0x${"ab".repeat(20)}`;
const CREATION = `0x${"c".repeat(64)}`;
const evm: DepositScanDeployment = {
  projectId: "acme",
  network: "base-mainnet",
  chain: "base",
  vault: VAULT,
  chainId: "8453",
  scanPageBlocks: "100",
  deploymentTransaction: CREATION,
};
const hex = (value: number) => `0x${value.toString(16)}`;
const depositLog = (block: number, index: number, amount: bigint) => ({
  address: VAULT,
  topics: [
    EVM_ESCROW_EVENT_TOPICS.Deposited,
    `0x${"0".repeat(24)}${FUNDER.slice(2)}`,
  ],
  data: `0x${amount.toString(16).padStart(64, "0")}`,
  blockNumber: hex(block),
  blockHash: `0x${block.toString(16).padStart(64, "0")}`,
  transactionHash: `0x${(block * 16 + index).toString(16).padStart(64, "0")}`,
  logIndex: hex(index),
});

/** A JSON-RPC chain: creation at block 50, finalized head and logs as given. */
function evmChain(options: {
  chainId?: string;
  finalized: number;
  logs: ReturnType<typeof depositLog>[];
  failHeaders?: boolean;
}) {
  const calls: { method: string; params: unknown[] }[] = [];
  const state = { ...options };
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body)) as {
      method: string;
      params: unknown[];
    };
    calls.push({ method, params });
    let result: unknown;
    if (method === "eth_chainId") result = state.chainId ?? "0x2105";
    else if (method === "eth_getTransactionReceipt")
      result = { status: "0x1", blockNumber: hex(50) };
    else if (method === "eth_getBlockByNumber") {
      if (params[0] === "finalized") result = { number: hex(state.finalized) };
      else if (state.failHeaders) result = null;
      else {
        const block = Number(BigInt(params[0] as string));
        result = {
          hash: `0x${block.toString(16).padStart(64, "0")}`,
          // Block n is n minutes after the start of 18 November 2026.
          timestamp: hex(
            Date.parse("2026-11-18T00:00:00Z") / 1000 + block * 60,
          ),
        };
      }
    } else if (method === "eth_getLogs") {
      const filter = params[0] as { fromBlock: string; toBlock: string };
      result = state.logs.filter(
        (log) =>
          BigInt(log.blockNumber) >= BigInt(filter.fromBlock) &&
          BigInt(log.blockNumber) <= BigInt(filter.toBlock),
      );
    }
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  }) as typeof fetch;
  return { calls, state, fetcher };
}
const position = (sqlite: ReturnType<typeof sqliteD1>["sqlite"]) =>
  (
    sqlite.query("SELECT position FROM vault_deposit_cursors").get() as {
      position: string | null;
    } | null
  )?.position ?? null;

test("EVM deposits are read from the vault's creation through the finalized block", async () => {
  const { db, sqlite } = sqliteD1();
  const originalFetch = globalThis.fetch;
  const chain = evmChain({
    finalized: 420,
    logs: [depositLog(60, 4, 253_000_000n), depositLog(330, 0, 1_000_000n)],
  });
  globalThis.fetch = chain.fetcher;
  try {
    expect(await scanEvmDeposits(db, evm, "https://rpc.invalid")).toBe(2);
    // Four pages of 100 blocks from the creation block, never past finality.
    expect(
      chain.calls
        .filter((call) => call.method === "eth_getLogs")
        .map((call) => call.params[0]),
    ).toMatchObject([
      {
        fromBlock: hex(50),
        toBlock: hex(149),
        topics: [EVM_ESCROW_EVENT_TOPICS.Deposited],
      },
      { fromBlock: hex(150), toBlock: hex(249) },
      { fromBlock: hex(250), toBlock: hex(349) },
      { fromBlock: hex(350), toBlock: hex(420) },
    ]);
    expect(position(sqlite)).toBe("420");
    expect(
      sqlite
        .query(
          "SELECT project_id,network,chain,vault,event_index,depositor,amount,block_number,block_time FROM vault_deposits ORDER BY block_time",
        )
        .all(),
    ).toEqual([
      {
        project_id: "acme",
        network: "base-mainnet",
        chain: "base",
        vault: VAULT,
        event_index: 4,
        depositor: FUNDER,
        amount: "253000000",
        block_number: "60",
        block_time: "2026-11-18T01:00:00.000Z",
      },
      {
        project_id: "acme",
        network: "base-mainnet",
        chain: "base",
        vault: VAULT,
        event_index: 0,
        depositor: FUNDER,
        amount: "1000000",
        block_number: "330",
        block_time: "2026-11-18T05:30:00.000Z",
      },
    ]);
    // Nothing new is finalized: no log page is read and nothing is added.
    chain.calls.length = 0;
    expect(await scanEvmDeposits(db, evm, "https://rpc.invalid")).toBe(0);
    expect(chain.calls.map((call) => call.method)).toEqual([
      "eth_chainId",
      "eth_getBlockByNumber",
    ]);
    // A later deposit is read from the cursor on, not from the creation.
    chain.state.finalized = 500;
    chain.state.logs.push(depositLog(470, 2, 5n));
    expect(await scanEvmDeposits(db, evm, "https://rpc.invalid")).toBe(1);
    expect(
      chain.calls.find((call) => call.method === "eth_getLogs")?.params[0],
    ).toMatchObject({ fromBlock: hex(421), toBlock: hex(500) });
    expect(sqlite.query("SELECT COUNT(*) n FROM vault_deposits").get()).toEqual(
      { n: 3 },
    );
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("a long history is read ten pages a run and resumes where it stopped", async () => {
  const { db, sqlite } = sqliteD1();
  const originalFetch = globalThis.fetch;
  const chain = evmChain({
    finalized: 5000,
    logs: [depositLog(1200, 1, 7n)],
  });
  globalThis.fetch = chain.fetcher;
  try {
    expect(await scanEvmDeposits(db, evm, "https://rpc.invalid")).toBe(0);
    expect(position(sqlite)).toBe("1049");
    expect(await scanEvmDeposits(db, evm, "https://rpc.invalid")).toBe(1);
    expect(position(sqlite)).toBe("2049");
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("a wrong chain or an unreadable block records nothing and keeps the cursor", async () => {
  const { db, sqlite } = sqliteD1();
  const originalFetch = globalThis.fetch;
  const chain = evmChain({
    chainId: "0x1",
    finalized: 120,
    logs: [depositLog(60, 4, 9n)],
  });
  globalThis.fetch = chain.fetcher;
  try {
    await expect(
      scanEvmDeposits(db, evm, "https://rpc.invalid"),
    ).rejects.toThrow("chain mismatch");
    expect(chain.calls.map((call) => call.method)).toEqual(["eth_chainId"]);
    chain.state.chainId = "0x2105";
    chain.state.failHeaders = true;
    await expect(
      scanEvmDeposits(db, evm, "https://rpc.invalid"),
    ).rejects.toThrow("Deposit block unavailable");
    expect(position(sqlite)).toBeNull();
    expect(sqlite.query("SELECT COUNT(*) n FROM vault_deposits").get()).toEqual(
      { n: 0 },
    );
    chain.state.failHeaders = false;
    expect(await scanEvmDeposits(db, evm, "https://rpc.invalid")).toBe(1);
    expect(position(sqlite)).toBe("120");
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("an older overlapping run cannot move the cursor back", async () => {
  const { db, sqlite } = sqliteD1();
  const originalFetch = globalThis.fetch;
  const chain = evmChain({ finalized: 120, logs: [] });
  globalThis.fetch = chain.fetcher;
  try {
    await db
      .prepare(
        "INSERT INTO vault_deposit_cursors(project_id,network,vault,position,synced_at) VALUES('acme','base-mainnet',?,'100','2026-11-18T00:00:00.000Z')",
      )
      .bind(VAULT)
      .run();
    // While this run reads blocks 101 to 120, a newer run stores block 900.
    const original = chain.fetcher;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const response = await original(url as string, init);
      if (JSON.parse(String(init?.body)).method === "eth_getLogs")
        sqlite.exec("UPDATE vault_deposit_cursors SET position='900'");
      return response;
    }) as typeof fetch;
    await scanEvmDeposits(db, evm, "https://rpc.invalid");
    expect(position(sqlite)).toBe("900");
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

const PROGRAM = "SLoPescrow1111111111111111111111111111111111";
const PROJECT = "Proj111111111111111111111111111111111111111";
const DEPOSITOR = "Fund111111111111111111111111111111111111111";
const tag = (name: string) =>
  sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8);
/** `extra` bytes after the amount, or fewer bytes than the amount needs. */
const depositData = (name: string, amount: bigint, extra = 0) => {
  const bytes = new Uint8Array(16 + Math.max(extra, 0));
  bytes.set(tag(name));
  new DataView(bytes.buffer).setBigUint64(8, amount, true);
  return encodeBase58Bytes(bytes.slice(0, 16 + extra));
};
const instruction = (
  name: string,
  amount: bigint,
  project = PROJECT,
  extra = 0,
) => ({
  programId: PROGRAM,
  accounts: [DEPOSITOR, project, "Mint", "Source", "Vault", "Token"],
  data: depositData(name, amount, extra),
});
const transaction = (
  instructions: unknown[],
  innerInstructions: unknown[] = [],
) => ({
  slot: 4242,
  blockTime: Date.parse("2026-11-16T08:00:00Z") / 1000,
  meta: { err: null, innerInstructions },
  transaction: { message: { instructions } },
});

test("Solana deposits are read from the vault program's own instructions", () => {
  const other = { programId: "Other", accounts: [], data: "1" };
  const found = solanaDeposits(
    transaction(
      [
        other,
        instruction("deposit", 107_560_000n),
        // Another project's deposit in the same transaction is not ours.
        instruction("deposit", 5n, "Elsewhere"),
        other,
      ],
      [
        // A deposit made through another program runs under instruction 3.
        {
          index: 3,
          instructions: [
            {
              ...instruction("deposit_native", 2_000_000_000n),
              stackHeight: 2,
            },
          ],
        },
      ],
    ),
    PROGRAM,
    PROJECT,
  );
  expect(found).toEqual([
    { index: 1, depositor: DEPOSITOR, amount: "107560000" },
    { index: 4, depositor: DEPOSITOR, amount: "2000000000" },
  ]);
  // A payment or any other instruction of the program is not a deposit.
  expect(
    solanaDeposits(
      transaction([{ ...instruction("pay", 9n) }]),
      PROGRAM,
      PROJECT,
    ),
  ).toEqual([]);
  // Data too short to hold the amount is not a deposit the program accepts.
  expect(() =>
    solanaDeposits(
      transaction([instruction("deposit", 9n, PROJECT, -1)]),
      PROGRAM,
      PROJECT,
    ),
  ).toThrow("Unexpected deposit instruction");
});

const solana: DepositScanDeployment & { genesisHash: string } = {
  projectId: "feed",
  network: "solana-mainnet",
  chain: "solana",
  vault: "Vau1t11111111111111111111111111111111111111",
  programId: PROGRAM,
  projectPda: PROJECT,
  genesisHash: "genesis",
};
const signature = (n: number) =>
  encodeBase58Bytes(Uint8Array.from({ length: 64 }, () => n));

/** Signature history newest first; every third transaction carries a deposit. */
function solanaChain(count: number) {
  const history = Array.from({ length: count }, (_, i) => count - i);
  const calls: string[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body)) as {
      method: string;
      params: [string, Record<string, unknown>];
    };
    calls.push(method);
    let result: unknown;
    if (method === "getGenesisHash") result = "genesis";
    else if (method === "getSignaturesForAddress") {
      const { before, until, limit } = params[1] as {
        before?: string;
        until?: string;
        limit: number;
      };
      let rows = history.map((n) => ({ signature: signature(n), err: null }));
      if (before)
        rows = rows.slice(rows.findIndex((r) => r.signature === before) + 1);
      if (until) {
        const end = rows.findIndex((r) => r.signature === until);
        if (end >= 0) rows = rows.slice(0, end);
      }
      result = rows.slice(0, limit);
    } else if (method === "getTransaction") {
      const n = history.find((value) => signature(value) === params[0]);
      result = transaction(
        n !== undefined && n % 3 === 0
          ? [instruction("deposit", BigInt(n))]
          : [{ programId: "Other", accounts: [], data: "1" }],
      );
    }
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  }) as typeof fetch;
  return { history, calls, fetcher };
}
const cursor = (sqlite: ReturnType<typeof sqliteD1>["sqlite"]) =>
  sqlite
    .query(
      "SELECT position,pending_top,resume_before FROM vault_deposit_cursors",
    )
    .get() as {
    position: string | null;
    pending_top: string | null;
    resume_before: string | null;
  };

test("Solana history is read newest first across runs until the covered position", async () => {
  const { db, sqlite } = sqliteD1();
  const originalFetch = globalThis.fetch;
  const chain = solanaChain(60);
  globalThis.fetch = chain.fetcher;
  try {
    const scan = () => scanSolanaDeposits(db, solana, "https://rpc.invalid");
    // Run 1 reads transactions 60 to 36 and keeps its place.
    expect(await scan()).toBe(9);
    expect(cursor(sqlite)).toEqual({
      position: null,
      pending_top: signature(60),
      resume_before: signature(36),
    });
    // Runs 2 and 3 finish the interval; the newest signature is now covered.
    expect(await scan()).toBe(8);
    expect(await scan()).toBe(3);
    expect(cursor(sqlite)).toEqual({
      position: signature(60),
      pending_top: null,
      resume_before: null,
    });
    expect(sqlite.query("SELECT COUNT(*) n FROM vault_deposits").get()).toEqual(
      { n: 20 },
    );
    expect(
      sqlite
        .query(
          "SELECT depositor,amount,block_number,block_time,event_index FROM vault_deposits WHERE transaction_id=?",
        )
        .get(signature(60)),
    ).toEqual({
      depositor: DEPOSITOR,
      amount: "60",
      block_number: "4242",
      block_time: "2026-11-16T08:00:00.000Z",
      event_index: 0,
    });
    // Nothing new: one signature read, no transaction read, nothing added.
    chain.calls.length = 0;
    expect(await scan()).toBe(0);
    expect(chain.calls).toEqual(["getGenesisHash", "getSignaturesForAddress"]);
    // Two new transactions are read down to the covered position only.
    chain.history.unshift(62, 61);
    chain.calls.length = 0;
    expect(await scan()).toBe(0);
    expect(
      chain.calls.filter((call) => call === "getTransaction"),
    ).toHaveLength(2);
    expect(cursor(sqlite).position).toBe(signature(62));
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("a deposit with bytes after its amount is recorded and the read moves on", async () => {
  const { db, sqlite } = sqliteD1();
  const originalFetch = globalThis.fetch;
  const chain = solanaChain(6);
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    // The program matches the 8-byte tag, reads the u64 after it and ignores
    // the rest, so this deposit of 5 succeeded on chain.
    if (body.method === "getTransaction" && body.params[0] === signature(5))
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: transaction([instruction("deposit_native", 5n, PROJECT, 1)]),
      });
    return chain.fetcher(url as string, init);
  }) as typeof fetch;
  try {
    expect(await scanSolanaDeposits(db, solana, "https://rpc.invalid")).toBe(3);
    expect(cursor(sqlite).position).toBe(signature(6));
    expect(
      sqlite.query("SELECT amount FROM vault_deposits ORDER BY amount").all(),
    ).toEqual([{ amount: "3" }, { amount: "5" }, { amount: "6" }]);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("a run that another run has overtaken stops without moving the cursor", async () => {
  const { db, sqlite } = sqliteD1();
  const originalFetch = globalThis.fetch;
  const chain = solanaChain(6);
  let transactions = 0;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const response = await chain.fetcher(url as string, init);
    // After this run's second transaction, another run finishes the interval.
    if (
      JSON.parse(String(init?.body)).method === "getTransaction" &&
      ++transactions === 2
    )
      sqlite
        .prepare(
          "UPDATE vault_deposit_cursors SET position=?,pending_top=NULL,resume_before=NULL",
        )
        .run(signature(6));
    return response;
  }) as typeof fetch;
  try {
    await scanSolanaDeposits(db, solana, "https://rpc.invalid");
    expect(transactions).toBe(2);
    expect(cursor(sqlite)).toEqual({
      position: signature(6),
      pending_top: null,
      resume_before: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("an unavailable finalized transaction keeps its place for the next run", async () => {
  const { db, sqlite } = sqliteD1();
  const originalFetch = globalThis.fetch;
  const chain = solanaChain(6);
  let down = true;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (
      down &&
      body.method === "getTransaction" &&
      body.params[0] === signature(4)
    )
      return Response.json({ jsonrpc: "2.0", id: 1, result: null });
    return chain.fetcher(url as string, init);
  }) as typeof fetch;
  try {
    await expect(
      scanSolanaDeposits(db, solana, "https://rpc.invalid"),
    ).rejects.toThrow("Finalized transaction unavailable");
    expect(cursor(sqlite)).toEqual({
      position: null,
      pending_top: signature(6),
      resume_before: signature(5),
    });
    down = false;
    await scanSolanaDeposits(db, solana, "https://rpc.invalid");
    expect(cursor(sqlite).position).toBe(signature(6));
    expect(
      sqlite.query("SELECT amount FROM vault_deposits ORDER BY amount").all(),
    ).toEqual([{ amount: "3" }, { amount: "6" }]);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("the deposit record never throws, skips private bounty vaults and retries a failed vault later", async () => {
  const { db, sqlite } = sqliteD1();
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...values: unknown[]) => {
    logged.push(values);
  };
  const chain = evmChain({
    finalized: 120,
    logs: [depositLog(60, 4, 253_000_000n)],
  });
  globalThis.fetch = chain.fetcher;
  try {
    const bounty: DepositScanDeployment = {
      ...evm,
      projectId: "private",
      vault: `0x${"9".repeat(40)}`,
      payoutPolicy: "security-bounty",
    };
    const broken: DepositScanDeployment = {
      ...evm,
      projectId: "broken",
      vault: `0x${"8".repeat(40)}`,
      scanPageBlocks: undefined,
    };
    const run = () =>
      recordVaultDeposits(
        db,
        [bounty, broken, evm],
        { "base-mainnet": "https://rpc.invalid" },
        () => undefined,
      );
    expect(await run()).toEqual({
      scanned: 2,
      recorded: 1,
      failures: [
        { projectId: "broken", network: "base-mainnet", error: "Error" },
      ],
    });
    expect(logged).toHaveLength(1);
    expect(
      sqlite
        .query(
          "SELECT project_id FROM vault_deposit_cursors ORDER BY project_id",
        )
        .all(),
    ).toEqual([{ project_id: "acme" }, { project_id: "broken" }]);
    expect(
      sqlite.query("SELECT DISTINCT project_id FROM vault_deposits").all(),
    ).toEqual([{ project_id: "acme" }]);
    // A network with no RPC configured is reported, not thrown.
    expect(
      (await recordVaultDeposits(db, [evm], {}, () => undefined)).failures,
    ).toEqual([{ projectId: "acme", network: "base-mainnet", error: "Error" }]);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    sqlite.close();
  }
});
