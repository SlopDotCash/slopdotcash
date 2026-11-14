import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as evm from "../../contracts/evm/adapter";
import { SolanaRpcUnavailable } from "../../contracts/solana/adapter";
import { applicationManifest } from "../../tests/project-application-manifest";
import * as binding from "../../workers/payment-executor/binding-shared";
import * as executor from "../../workers/payment-executor/core";
import * as scanner from "../../workers/payments/scanner";
import * as budget from "./budget";
import { type KeeperFailureStage, runKeeper } from "./keeper";
import { openKeeperStore } from "./store";

const privateValue = "private-data https://rpc.invalid/?token=secret";
const address = (digit: string) => `0x${digit.repeat(40)}`;
const deployment = {
  network: "base-mainnet" as const,
  vault: address("1"),
  asset: address("2"),
  owner: address("3"),
  identityAuthority: address("4"),
  feeRecipient: address("5"),
  factory: address("6"),
  registrar: address("7"),
  factoryCodeSha256: "a".repeat(64),
  sourceCommit: "b".repeat(40),
  deploymentTransaction: `0x${"c".repeat(64)}`,
  codeSha256: "d".repeat(64),
  bindingDelaySeconds: "0",
  rotationDelaySeconds: null,
  programId: null,
  upgradeAuthority: null,
  projectPda: null,
  networkDomain: null,
};
const draft = applicationManifest("keeper-stage", "example/keeper-stage");
const project = {
  ...draft,
  reward: {
    ...(draft.reward as object),
    chain: "base",
    currency: "TEST",
    feeBasisPoints: 200,
    monthlyCapMinor: "2000000",
    monthlyCapDisplay: "2 TEST",
  },
  rewardAsset: {
    network: "base",
    kind: "token",
    address: deployment.asset,
    symbol: "TEST",
    decimals: 6,
    chainId: "8453",
    cluster: null,
    verifiedAt: "2026-11-14T00:00:00.000Z",
  },
  escrow: {
    schemaVersion: "1",
    effectiveCycle: "2026-11",
    chain: "base",
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [deployment],
  },
};
const config = {
  apiOrigin: "https://registry.invalid",
  network: "base-mainnet" as const,
  projectIds: ["keeper-stage"],
  signer: address("8"),
  rpcUrl: "https://rpc.invalid",
  gas: { perTransaction: "1", perDay: "2", additionalFeeReserve: "0" },
  perRun: 1,
};
const restores: (() => void)[] = [];
afterEach(() => {
  for (const restore of restores.reverse()) restore();
  restores.length = 0;
});
function track<T extends { mockRestore(): void }>(mock: T): T {
  restores.push(() => mock.mockRestore());
  return mock;
}
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "keeper-stage-"));
  const store = openKeeperStore(join(directory, "keeper.sqlite"));
  restores.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const fetch = track(spyOn(globalThis, "fetch")).mockResolvedValue(
    Response.json({
      schemaVersion: "1",
      projects: [project],
      restrictions: [],
    }),
  );
  const preflight = track(
    spyOn(binding, "preflightEvmDeployment"),
  ).mockResolvedValue({ ...deployment, rpcUrl: config.rpcUrl } as never);
  const authority = track(
    spyOn(evm, "readEvmAuthorityRotation"),
  ).mockResolvedValue({ identityAuthority: address("4") } as never);
  const gas = track(spyOn(budget, "reconcileGas")).mockResolvedValue();
  const scan = track(spyOn(scanner, "scanEvmPayments")).mockResolvedValue();
  return {
    store,
    fetch,
    preflight,
    authority,
    gas,
    scan,
    run: (now = new Date("2026-11-14T00:00:00Z")) =>
      runKeeper(config, { store, now }),
  };
}
const event: scanner.ScanEvent = {
  projectId: "keeper-stage",
  network: "base-mainnet",
  transactionId: `0x${"e".repeat(64)}`,
  eventIndex: 0,
  kind: "reserved",
  obligationId: `0x${"f".repeat(64)}`,
};

test.each<KeeperFailureStage>([
  "preflight",
  "authority-read",
  "signer-role",
  "gas-reconcile",
  "payment-scan",
  "payment-evidence",
  "payment-index",
  "monthly-state",
  "award-state",
])(
  "outer failure retains the %s stage and its original result",
  async (stage) => {
    const f = setup();
    const failure = new Error(privateValue);
    const query = f.store.db.query.bind(f.store.db);
    if (stage === "preflight") f.preflight.mockRejectedValue(failure);
    if (stage === "authority-read") f.authority.mockRejectedValue(failure);
    if (stage === "signer-role")
      f.authority.mockResolvedValue({
        identityAuthority: config.signer,
      } as never);
    if (stage === "gas-reconcile") f.gas.mockRejectedValue(failure);
    if (stage === "payment-scan") f.scan.mockRejectedValue(failure);
    if (stage === "payment-evidence" || stage === "payment-index") {
      f.scan.mockImplementation(async (_db, _deployment, _rpc, index) =>
        index(event),
      );
      track(spyOn(evm, "verifyReserve")).mockImplementation(async () => {
        if (stage === "payment-evidence") throw failure;
        return { githubUserId: "1" } as never;
      });
    }
    if (stage === "payment-index" || stage === "award-state")
      track(spyOn(f.store.db, "query")).mockImplementation((sql) => {
        if (
          sql.startsWith(
            stage === "payment-index"
              ? "INSERT INTO awards"
              : "SELECT id,actor",
          )
        )
          throw failure;
        return query(sql);
      });
    if (stage === "monthly-state") {
      const get = f.store.journal.get.bind(f.store.journal);
      track(spyOn(f.store.journal, "get")).mockImplementation(async (key) => {
        if (key.startsWith("authorization:")) throw failure;
        return get(key);
      });
    }
    const rows = await f.run(
      stage === "monthly-state" ? new Date("2026-12-01T00:00:00Z") : undefined,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operation: "deployment",
      state: "unavailable",
      failureStage: stage,
      failureCause: "other",
      error:
        stage === "signer-role"
          ? "Error: Keeper signer must have no vault role"
          : String(failure),
    });
  },
);

test("a completed receipt callback restores scan attribution for a later cursor failure", async () => {
  const f = setup();
  track(spyOn(evm, "verifyReserve")).mockResolvedValue({
    githubUserId: "1",
  } as never);
  f.scan.mockImplementation(async (_db, _deployment, _rpc, index) => {
    await index(event);
    throw new Error(privateValue);
  });
  expect((await f.run())[0]?.failureStage).toBe("payment-scan");
  expect(f.store.db.query("SELECT count(*) AS n FROM awards").get()).toEqual({
    n: 1,
  });
});

test.each([
  [new evm.EvmRpcUnavailable(privateValue), "rpc-unavailable"],
  [new SolanaRpcUnavailable(privateValue), "rpc-unavailable"],
  [new evm.EvmRpcError(false, privateValue), "rpc-error"],
  [
    Object.assign(new Error(privateValue), {
      name: "EvmRpcUnavailable",
      code: "RPC",
      cause: privateValue,
    }),
    "other",
  ],
] as const)(
  "only typed RPC errors set a fixed cause (%#)",
  async (failure, cause) => {
    const f = setup();
    f.preflight.mockRejectedValue(failure);
    expect((await f.run())[0]).toMatchObject({
      failureStage: "preflight",
      failureCause: cause,
      error: String(failure),
    });
  },
);

test("inner award failures keep their existing operation and state", async () => {
  const f = setup();
  f.store.db
    .query("INSERT INTO awards(scope,id,actor,reserve) VALUES(?,?,?,?)")
    .run(`keeper-stage:${deployment.vault}`, event.obligationId, "1", "{}");
  track(spyOn(executor, "preparePermissionlessEvmPayment")).mockRejectedValue(
    new Error(privateValue),
  );
  expect(await f.run()).toEqual([
    {
      projectId: "keeper-stage",
      vault: deployment.vault,
      operation: `award:${event.obligationId}`,
      state: "waiting",
      error: `Error: ${privateValue}`,
    },
  ]);
});

test("an award checked-state write failure keeps its outer stage", async () => {
  const f = setup();
  f.store.db
    .query("INSERT INTO awards(scope,id,actor,reserve) VALUES(?,?,?,?)")
    .run(`keeper-stage:${deployment.vault}`, event.obligationId, "1", "{}");
  const query = f.store.db.query.bind(f.store.db);
  track(spyOn(f.store.db, "query")).mockImplementation((sql) => {
    if (sql.startsWith("UPDATE awards SET checked"))
      throw new Error(privateValue);
    return query(sql);
  });
  expect((await f.run())[0]).toMatchObject({
    operation: "deployment",
    state: "unavailable",
    failureStage: "award-state",
  });
});

test("inner publication failures keep their existing monthly result", async () => {
  const f = setup();
  f.fetch.mockImplementation((async (url) => {
    if (String(url).endsWith("/api/v1/projects"))
      return Response.json({
        schemaVersion: "1",
        projects: [project],
        restrictions: [],
      });
    throw new Error(privateValue);
  }) as typeof globalThis.fetch);
  expect(await f.run(new Date("2026-12-01T00:00:00Z"))).toEqual([
    {
      projectId: "keeper-stage",
      vault: deployment.vault,
      operation: "monthly:2026-11",
      state: "publication-unavailable",
      error: `Error: ${privateValue}`,
    },
  ]);
});

test("registry failures remain top-level failures", async () => {
  const f = setup();
  const error = new Error(privateValue);
  f.fetch.mockRejectedValue(error);
  await expect(f.run()).rejects.toBe(error);
  expect(f.preflight).not.toHaveBeenCalled();
});
