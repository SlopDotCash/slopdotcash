import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";
import type { PaymentsWorkerEnvironment } from "../../workers/payments/index";
import { LocalSolanaAcceptance, type LocalSolanaRun } from "./solana-local";

const run = (rpcUrl = "http://127.0.0.1:8899"): LocalSolanaRun => ({
  network: "solana-localnet",
  runId: "local-run",
  rpcUrl,
  genesisHash: "local-genesis",
  programId: "program",
  codeSha256: "a".repeat(64),
  upgradeAuthority: null,
  owner: "owner",
  identityAuthority: "identity",
  feeRecipient: "fees",
  rotationAuthority: "rotation",
  rotationDelaySeconds: "1",
  networkDomain: "b".repeat(64),
});
const deployment = (facts: LocalSolanaRun): EscrowDeployment => ({
  ...facts,
  network: "solana-localnet" as EscrowDeployment["network"],
  vault: "vault",
  projectPda: "project",
  asset: "mint",
  bindingDelaySeconds: "0",
  deploymentTransaction: "initialized",
  sourceCommit: "c".repeat(40),
  factory: null,
  factoryCodeSha256: null,
  registrar: null,
});

test("local acceptance cannot admit a public network, public genesis or remote RPC", () => {
  for (const facts of [
    { ...run(), network: "solana-devnet" },
    { ...run(), genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" },
    { ...run(), genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" },
    run("https://rpc.example.com"),
  ]) {
    const db = new Database(":memory:");
    try {
      expect(() => new LocalSolanaAcceptance(db, facts)).toThrow();
      expect(
        db.query("SELECT name FROM sqlite_master WHERE type='table'").all(),
      ).toEqual([]);
    } finally {
      db.close();
    }
  }
});

test("run and deployment declarations remain immutable across resumed local acceptance", () => {
  const db = new Database(":memory:");
  try {
    const facts = run();
    const first = new LocalSolanaAcceptance(db, facts);
    const declarations = [
      { projectId: "run-project", deployment: deployment(facts) },
    ];
    expect(first.record(declarations)).toHaveLength(1);
    expect(new LocalSolanaAcceptance(db, facts).record(declarations)).toEqual(
      first.record(declarations),
    );
    expect(
      () => new LocalSolanaAcceptance(db, { ...facts, runId: "other-run" }),
    ).toThrow("another run");
    expect(() =>
      first.record([
        {
          ...declarations[0],
          deployment: { ...deployment(facts), vault: "another-vault" },
        },
      ]),
    ).toThrow("deployment changed");
    expect(() =>
      first.record([
        {
          ...declarations[0],
          deployment: { ...deployment(facts), owner: "other-owner" },
        },
      ]),
    ).toThrow("verified run: owner");
    expect(() =>
      first.record([
        {
          projectId: "second-project",
          deployment: {
            ...deployment(facts),
            vault: "second-vault",
            projectPda: "second-pda",
          },
        },
        {
          ...declarations[0],
          deployment: { ...deployment(facts), vault: "changed-vault" },
        },
      ]),
    ).toThrow("deployment changed");
    expect(first.record(declarations)).toHaveLength(1);
    expect(() =>
      db.exec("UPDATE acceptance_local_declarations SET facts='{}'"),
    ).toThrow("immutable local declaration");
    expect(() => db.exec("DELETE FROM acceptance_local_run")).toThrow(
      "immutable local run",
    );
    expect(first.record(declarations)).toHaveLength(1);
  } finally {
    db.close();
  }
});

test("local tick reaches recovery for solana-localnet instead of failing the registry gate", async () => {
  const db = new Database(":memory:");
  const rpc = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const { id } = await request.json();
      return Response.json({ jsonrpc: "2.0", id, result: "local-genesis" });
    },
  });
  try {
    const facts = run(`http://127.0.0.1:${rpc.port}`);
    const local = new LocalSolanaAcceptance(db, facts);
    // No recorded deployments: the tick still runs recovery and
    // reconciliation, so a registry gate applied to recovery shows up here
    // as a spurious failure even though admission passed.
    const bound: unknown[][] = [];
    const env = {
      PAYMENTS_DB: {
        prepare(sql: string) {
          return {
            bind(...args: unknown[]) {
              if (sql.includes("payment_attempts")) bound.push(args);
              return { first: async () => ({ items: "[]" }) };
            },
            first: async () => ({ items: "[]" }),
          };
        },
      },
      PAYMENT_NETWORKS: JSON.stringify(["solana-localnet"]),
      PAYMENT_RPC_URLS: JSON.stringify({
        "solana-localnet": facts.rpcUrl,
      }),
      PAYMENT_SOLANA_GENESIS: JSON.stringify({
        "solana-localnet": "local-genesis",
      }),
    } as unknown as PaymentsWorkerEnvironment;
    expect(await local.tick(env)).toEqual([]);
    expect(bound).toEqual([[JSON.stringify(["solana-localnet"])]]);
  } finally {
    await rpc.stop(true);
    db.close();
  }
});

test("changed live genesis refuses the tick before any ledger work or executor call", async () => {
  const db = new Database(":memory:");
  const methods: string[] = [];
  const rpc = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const { id, method } = await request.json();
      methods.push(method);
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: "different-local-genesis",
      });
    },
  });
  try {
    const facts = run(`http://127.0.0.1:${rpc.port}`);
    const local = new LocalSolanaAcceptance(db, facts);
    const rpcUrl = facts.rpcUrl;
    // A caller cannot retarget the instance after its facts were recorded.
    facts.rpcUrl = "https://unrelated.example.com";
    facts.genesisHash = "replacement-genesis";
    let writes = 0;
    const env = {
      PAYMENT_NETWORKS: JSON.stringify(["solana-localnet"]),
      PAYMENT_RPC_URLS: JSON.stringify({ "solana-localnet": rpcUrl }),
      PAYMENT_SOLANA_GENESIS: JSON.stringify({
        "solana-localnet": "local-genesis",
      }),
      PAYMENTS_DB: {
        prepare() {
          writes++;
          throw new Error("unexpected ledger access");
        },
      },
      SOLANA_PAYMENT_EXECUTOR: {
        fetch() {
          writes++;
          throw new Error("unexpected signing request");
        },
      },
    } as unknown as PaymentsWorkerEnvironment;
    await expect(
      local.tick({
        ...env,
        PAYMENT_RPC_URLS: JSON.stringify({ "solana-localnet": facts.rpcUrl }),
      }),
    ).rejects.toThrow("environment differs");
    expect(methods).toEqual([]);
    await expect(
      local.tick({
        ...env,
        PAYMENT_SOLANA_GENESIS: JSON.stringify({
          "solana-localnet": facts.genesisHash,
        }),
      }),
    ).rejects.toThrow("environment differs");
    expect(methods).toEqual([]);
    await expect(local.tick(env)).rejects.toThrow("genesis changed");
    expect(methods).toEqual(["getGenesisHash"]);
    expect(writes).toBe(0);
  } finally {
    await rpc.stop(true);
    db.close();
  }
});
