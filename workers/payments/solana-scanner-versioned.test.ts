// A versioned (v0) transaction that mentions the project account must not
// wedge the Solana scan. getTransaction with maxSupportedTransactionVersion 0
// returns null for a versioned transaction, and the scanner used to throw
// before checkpointing that signature, so every later run retried the same
// signature and no later payment was ever indexed.
import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { D1Database } from "../../backend/trace/cloudflare-persistence";
import { type ScanEvent, scanSolanaPayments } from "./scanner";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sql = new Database(":memory:");
sql.exec("PRAGMA foreign_keys=ON");
for (const filename of readdirSync(join(root, "migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  sql.exec(readFileSync(join(root, "migrations", filename), "utf8"));
}

function statement(
  query: string,
  args: unknown[] = [],
): ReturnType<D1Database["prepare"]> {
  return {
    bind(...values: unknown[]) {
      return statement(query, values);
    },
    async first<T>() {
      return (sql.query(query).get(...(args as string[])) ?? null) as T | null;
    },
    async run() {
      const result = sql.query(query).run(...(args as string[]));
      return { success: true, meta: { changes: result.changes } };
    },
  };
}
const db: D1Database = {
  prepare: statement,
  async batch(statements) {
    sql.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const item of statements) results.push(await item.run());
      sql.exec("COMMIT");
      return results;
    } catch (error) {
      sql.exec("ROLLBACK");
      throw error;
    }
  },
};

const PROJECT_ID = "project-1";
const NETWORK = "solana-devnet";
const PROGRAM_ID = "PRG111111111111111111111111111111111111111";
const PROJECT_PDA = "PDA111111111111111111111111111111111111111";
const PAYER = "PAY111111111111111111111111111111111111111";
const VERSIONED_SIG = "V".repeat(87);
const LEGACY_SIG = "L".repeat(87);
const RPC_URL = "https://solana.fixture.invalid";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let result = "";
  while (value > 0n) {
    result = alphabet[Number(value % 58n)] + result;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = `1${result}`;
  }
  return result;
}

const commitData = (awardId: Uint8Array): string => {
  const discriminator = sha256(new TextEncoder().encode("global:commit")).slice(
    0,
    8,
  );
  const data = new Uint8Array(8 + 32);
  data.set(discriminator, 0);
  data.set(awardId, 8);
  return base58(data);
};

/** A finalized jsonParsed transaction carrying one escrow commit. */
const commitTransaction = (signature: string, awardId: Uint8Array) => ({
  slot: 100,
  meta: { err: null, innerInstructions: [] },
  transaction: {
    signatures: [signature],
    message: {
      accountKeys: [
        { pubkey: PAYER, signer: true, writable: true, source: "transaction" },
        {
          pubkey: PROJECT_PDA,
          signer: false,
          writable: true,
          source: "transaction",
        },
      ],
      instructions: [
        {
          programId: PROGRAM_ID,
          accounts: [PAYER, PROJECT_PDA],
          data: commitData(awardId),
        },
      ],
      recentBlockhash: "B".repeat(43),
    },
  },
});

test("a versioned transaction does not wedge the Solana scan", async () => {
  sql
    .query(
      "INSERT INTO payment_solana_scans(project_id,network,generation,until_signature,before_signature,next_page,ready,revision) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(PROJECT_ID, NETWORK, "gen-1", null, null, 1, 1, 0);
  sql
    .query(
      "INSERT INTO payment_solana_scan_pages(project_id,network,generation,page,signatures_json) VALUES(?,?,?,?,?)",
    )
    .run(
      PROJECT_ID,
      NETWORK,
      "gen-1",
      0,
      JSON.stringify([
        { signature: VERSIONED_SIG, err: null },
        { signature: LEGACY_SIG, err: null },
      ]),
    );
  const versionedAward = new Uint8Array(32).fill(0x11);
  const legacyAward = new Uint8Array(32).fill(0x22);
  const requestedVersions: number[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = new Request(input, init);
    const rpc = (await request.json()) as {
      method: string;
      params: unknown[];
    };
    if (rpc.method !== "getTransaction")
      throw new Error(`Unexpected RPC method ${rpc.method}`);
    const [signature, options] = rpc.params as [
      string,
      { maxSupportedTransactionVersion?: number },
    ];
    const version = options.maxSupportedTransactionVersion ?? 0;
    requestedVersions.push(version);
    // The live RPC returns null for a versioned transaction when the caller
    // caps the supported version at 0; it returns the parsed transaction
    // once the caller supports version 1.
    const result =
      signature === VERSIONED_SIG && version === 0
        ? null
        : commitTransaction(
            signature,
            signature === VERSIONED_SIG ? versionedAward : legacyAward,
          );
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  }) as typeof fetch;
  const indexed: ScanEvent[] = [];
  await scanSolanaPayments(
    db,
    {
      projectId: PROJECT_ID,
      network: NETWORK,
      chain: "solana",
      vault: "vault-1",
      projectPda: PROJECT_PDA,
      programId: PROGRAM_ID,
    },
    RPC_URL,
    async (event) => {
      indexed.push(event);
    },
  );
  expect(requestedVersions).toContain(1);
  expect(indexed).toHaveLength(2);
  expect(indexed.map((event) => event.kind)).toEqual(["reserved", "reserved"]);
  expect(indexed.map((event) => event.obligationId)).toEqual([
    bytesToHex(versionedAward),
    bytesToHex(legacyAward),
  ]);
  const cursor = sql
    .query(
      "SELECT position FROM payment_chain_cursors WHERE project_id=? AND network=?",
    )
    .get(PROJECT_ID, NETWORK) as { position: string } | null;
  expect(cursor?.position).toBe(LEGACY_SIG);
  const page = sql
    .query(
      "SELECT page FROM payment_solana_scan_pages WHERE project_id=? AND network=? AND generation=?",
    )
    .get(PROJECT_ID, NETWORK, "gen-1");
  expect(page).toBeNull();
});
