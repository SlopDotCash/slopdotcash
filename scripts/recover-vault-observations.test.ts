import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  storeVaultSnapshot,
  type VaultTotals,
} from "../backend/payments/vault-snapshots";
import { solanaBase58 } from "../contracts/solana/adapter";
import {
  ESCROW_NETWORKS,
  paymentDeploymentRecord,
} from "../src/lib/escrow-policy.mjs";
import { fixtureProject } from "../tests/fixture-overlay.mjs";
import { sqliteD1 } from "../tests/sqlite-d1";
import {
  observationDatabase,
  recoverMissingVaultObservations,
  requireTrustedObservationRecovery,
} from "./recover-vault-observations";

const observed = new Date("2026-11-11T20:00:00.000Z");
function fixture() {
  const { db, sqlite } = sqliteD1();
  const key = (byte: number) => solanaBase58(new Uint8Array(32).fill(byte));
  const pin = {
    network: "solana-mainnet" as const,
    deploymentTransaction: solanaBase58(new Uint8Array(64).fill(8)),
    sourceCommit: "a".repeat(40),
    codeSha256: "b".repeat(64),
    programId: key(1),
    projectPda: key(2),
    vault: key(3),
    owner: key(4),
    identityAuthority: key(5),
    feeRecipient: key(6),
    rotationAuthority: key(7),
    upgradeAuthority: null,
    networkDomain: "c".repeat(64),
    bindingDelaySeconds: "0",
    rotationDelaySeconds: "0",
    asset: ESCROW_NETWORKS["solana-mainnet"].asset as string,
    factory: null,
    factoryCodeSha256: null,
    registrar: null,
  };
  const project = {
    ...fixtureProject("eliza"),
    escrow: {
      schemaVersion: "1" as const,
      effectiveCycle: "2026-11",
      chain: "solana" as const,
      feeBasisPoints: 200 as const,
      withdrawalFeeBasisPoints: 200 as const,
      feeMode: "deduct-from-gross" as const,
      deployments: [pin],
    },
  };
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Fixture',?)",
    )
    .run(
      project.id,
      JSON.stringify(project),
      "a".repeat(64),
      observed.toISOString(),
    );
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
    )
    .run(
      project.id,
      JSON.stringify(project),
      "a".repeat(64),
      observed.toISOString(),
      observed.toISOString(),
    );
  const deployment = paymentDeploymentRecord(
    project.id,
    project.escrow.deployments[0],
  );
  const totals: VaultTotals = {
    network: deployment.network,
    vault: deployment.projectPda as string,
    asset: deployment.asset,
    decimals: 6,
    blockNumber: "10",
    blockTime: observed.toISOString(),
    totalDeposited: "100",
    totalPaid: "0",
    totalPayoutFees: "0",
    totalGrossWithdrawn: "0",
    totalWithdrawalFees: "0",
    freeBalance: "100",
    reservedPrincipal: null,
    reservedFees: null,
    accruedFees: "0",
    reserved: "0",
  };
  return { db, sqlite, deployment, totals };
}

test("the protected D1 transport seeds the missing current-registry vault and retains existing observations without another RPC", async () => {
  const f = fixture();
  try {
    const remote = observationDatabase({
      account: "a".repeat(32),
      token: "fixture-only-token",
      databaseId: "fixture-only-id",
      fetcher: async (url, init) => {
        expect(String(url)).toContain("/d1/database/fixture-only-id/query");
        expect(init?.redirect).toBe("error");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer fixture-only-token",
        );
        const { sql, params } = JSON.parse(init?.body as string);
        const statement = f.sqlite.prepare(sql);
        const result = sql.startsWith("SELECT")
          ? { success: true, results: statement.all(...params) }
          : {
              success: true,
              meta: { changes: statement.run(...params).changes },
            };
        return Response.json({ success: true, result: [result] });
      },
    });
    expect(
      await recoverMissingVaultObservations({
        db: remote,
        rpcUrl: "private-fixture",
        now: observed,
        read: async (deployment) => {
          expect(deployment.vault).toBe(f.deployment.vault);
          return f.totals;
        },
      }),
    ).toEqual({ stored: 1, retained: 0 });
    const row = f.sqlite.query("SELECT * FROM vault_snapshots").get();
    expect(
      await recoverMissingVaultObservations({
        db: remote,
        rpcUrl: "private-fixture",
        read: async () => {
          throw new Error("An existing observation must not read any RPC");
        },
      }),
    ).toEqual({ stored: 0, retained: 1 });
    expect(f.sqlite.query("SELECT * FROM vault_snapshots").get()).toEqual(row);
    expect(
      f.sqlite.query("SELECT COUNT(*) n FROM payment_obligations").get(),
    ).toEqual({ n: 0 });
  } finally {
    f.sqlite.close();
  }
});

test("invalid observations stay missing and a concurrent newer observation cannot be overwritten", async () => {
  const f = fixture();
  try {
    await expect(
      recoverMissingVaultObservations({
        db: f.db,
        rpcUrl: "private-fixture",
        read: async () => ({ ...f.totals, asset: "wrong-mint" }),
      }),
    ).rejects.toThrow("reviewed deployment");
    expect(
      f.sqlite.query("SELECT COUNT(*) n FROM vault_snapshots").get(),
    ).toEqual({ n: 0 });
    expect(
      await recoverMissingVaultObservations({
        db: f.db,
        rpcUrl: "private-fixture",
        now: observed,
        read: async () => {
          await storeVaultSnapshot(
            f.db,
            f.deployment,
            {
              ...f.totals,
              blockNumber: "20",
              totalDeposited: "200",
              freeBalance: "200",
            },
            observed.toISOString(),
          );
          return f.totals;
        },
      }),
    ).toEqual({ stored: 0, retained: 1 });
    expect(
      f.sqlite
        .query("SELECT block_number,total_deposited FROM vault_snapshots")
        .get(),
    ).toEqual({ block_number: "20", total_deposited: "200" });
  } finally {
    f.sqlite.close();
  }
});

test("only the exact checked main publication workflow may run the recovery CLI", () => {
  const sha = "a".repeat(40);
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "SlopDotCash/slopdotcash",
    GITHUB_REF: "refs/heads/main",
    GITHUB_WORKFLOW_REF:
      "SlopDotCash/slopdotcash/.github/workflows/deploy.yml@refs/heads/main",
    GITHUB_EVENT_NAME: "push",
    GITHUB_SHA: sha,
  };
  expect(() => requireTrustedObservationRecovery(env, sha)).not.toThrow();
  for (const changed of [
    { GITHUB_REF: "refs/heads/development" },
    { GITHUB_EVENT_NAME: "pull_request_target" },
    {
      GITHUB_WORKFLOW_REF:
        "SlopDotCash/slopdotcash/.github/workflows/deploy.yml@refs/heads/feature",
    },
    { GITHUB_SHA: "b".repeat(40) },
  ])
    expect(() =>
      requireTrustedObservationRecovery({ ...env, ...changed }, sha),
    ).toThrow("exact trusted main");
});

test("the actual recovery CLI never logs a provider error or access-bearing endpoint", () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-observation-error-"));
  try {
    const preload = join(directory, "failed-provider.js");
    writeFileSync(
      preload,
      'globalThis.fetch = async () => { throw new Error("private-endpoint-access-sentinel"); };',
    );
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const result = spawnSync(
      process.execPath,
      [
        "--no-env-file",
        "--preload",
        preload,
        resolve("scripts/recover-vault-observations.ts"),
      ],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          GITHUB_ACTIONS: "true",
          GITHUB_REPOSITORY: "SlopDotCash/slopdotcash",
          GITHUB_REF: "refs/heads/main",
          GITHUB_WORKFLOW_REF:
            "SlopDotCash/slopdotcash/.github/workflows/deploy.yml@refs/heads/main",
          GITHUB_EVENT_NAME: "push",
          GITHUB_SHA: sha,
          CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
          CLOUDFLARE_API_TOKEN: "private-fixture-token",
          PAYMENT_RPC_URLS: JSON.stringify({
            "solana-mainnet":
              "https://private.invalid/private-endpoint-access-sentinel",
          }),
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Vault observation recovery failed");
    expect(result.stdout + result.stderr).not.toContain(
      "private-endpoint-access-sentinel",
    );
    expect(result.stdout + result.stderr).not.toContain(
      "private-fixture-token",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
