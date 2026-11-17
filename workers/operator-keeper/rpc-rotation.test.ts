import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as keeper from "../../scripts/payment-keeper/keeper";
import { openKeeperStore } from "../../scripts/payment-keeper/store";
import { applicationManifest } from "../../tests/project-application-manifest";
import worker, { type OperatorEnvironment, OperatorKeeper } from "./index";
import * as storage from "./storage";

const oldRpc = "https://old-rpc.invalid/private-key";
const newRpc = "https://new-rpc.invalid/?token=private-key";
const config: keeper.KeeperConfiguration = {
  apiOrigin: "https://registry.invalid",
  network: "base-mainnet",
  signer: `0x${"Ab".repeat(20)}`,
  rpcUrl: oldRpc,
  projectIds: ["rpc-rotation"],
  perRun: 1,
  gas: { perTransaction: "1", perDay: "2", additionalFeeReserve: "0" },
};
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const restore of cleanup.reverse()) restore();
  cleanup.length = 0;
});
function track<T extends { mockRestore(): void }>(value: T): T {
  cleanup.push(() => value.mockRestore());
  return value;
}
function setup(realCore = false) {
  const directory = mkdtempSync(join(tmpdir(), "keeper-rpc-"));
  const store = openKeeperStore(join(directory, "keeper.sqlite"));
  cleanup.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  track(spyOn(storage, "openOperatorKeeperStore")).mockReturnValue(store);
  const observed: keeper.KeeperConfiguration[] = [];
  if (!realCore)
    track(spyOn(keeper, "runKeeper")).mockImplementation(async (selected) => {
      observed.push(selected);
      return [];
    });
  const identities: string[] = [];
  const env: OperatorEnvironment = {
    KEEPER_MODE: "dry_run",
    KEEPER_CONFIG: JSON.stringify(config),
    KEEPER: {
      idFromName(name) {
        identities.push(name);
        return name;
      },
      get: () => object,
    },
  };
  const object = new OperatorKeeper(
    { storage: {} as storage.OperatorStorage },
    env,
  );
  return { env, object, store, observed, identities };
}

test("RPC rotation replaces only the endpoint and retains the same object and journal", async () => {
  const current = setup();
  await current.store.journal.put("retained-attempt", { nonce: 7 });
  await worker.scheduled(null, current.env);
  current.env.KEEPER_RPC_URL = newRpc;
  await worker.scheduled(null, current.env);
  expect(current.observed).toEqual([
    { ...config, signer: config.signer.toLowerCase() },
    { ...config, signer: config.signer.toLowerCase(), rpcUrl: newRpc },
  ]);
  expect(current.identities).toEqual([
    JSON.stringify([config.network, config.signer.toLowerCase()]),
    JSON.stringify([config.network, config.signer.toLowerCase()]),
  ]);
  expect(
    await current.store.journal.get<{ nonce: number }>("retained-attempt"),
  ).toEqual({
    nonce: 7,
  });
  expect(current.env.KEEPER_CONFIG).toBe(JSON.stringify(config));
  delete current.env.KEEPER_RPC_URL;
  await worker.scheduled(null, current.env);
  expect(current.observed[2]?.rpcUrl).toBe(oldRpc);
});

test.each([
  "",
  " ",
  "not-a-url",
  "http://rpc.invalid",
  "file:///rpc",
  "https://",
])(
  "an invalid configured override refuses before selecting the object (%#)",
  async (override) => {
    const current = setup();
    current.env.KEEPER_RPC_URL = override;
    const log = track(spyOn(console, "error")).mockImplementation(() => {});
    await expect(worker.scheduled(null, current.env)).rejects.toThrow(
      "Operator RPC override must be a valid HTTPS URL",
    );
    expect(current.identities).toEqual([]);
    expect(current.observed).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    const response = await current.object.fetch(
      new Request("https://keeper.internal/tick", { method: "POST" }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "keeper_run_failed" });
  },
);

test("off mode does not use the override or select an object", async () => {
  const current = setup();
  current.env.KEEPER_MODE = "off";
  current.env.KEEPER_RPC_URL = "http://invalid";
  await worker.scheduled(null, current.env);
  expect(current.identities).toEqual([]);
  expect(current.observed).toEqual([]);
});

test("a replacement endpoint on the wrong chain still fails deployment preflight", async () => {
  const current = setup(true);
  current.env.KEEPER_RPC_URL = newRpc;
  const draft = applicationManifest("rpc-rotation", "example/rpc-rotation");
  const address = (digit: string) => `0x${digit.repeat(40)}`;
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
      address: address("2"),
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
      deployments: [
        {
          network: "base-mainnet",
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
        },
      ],
    },
  };
  const rpcMethods: string[] = [];
  const fetchMock = (async (input, init) => {
    if (String(input) === `${config.apiOrigin}/api/v1/projects`)
      return Response.json({
        schemaVersion: "1",
        projects: [project],
        restrictions: [],
      });
    expect(String(input)).toBe(newRpc);
    const body = JSON.parse(String(init?.body));
    rpcMethods.push(body.method);
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x1" });
  }) as typeof fetch;
  track(spyOn(globalThis, "fetch")).mockImplementation(fetchMock);
  const response = await current.object.fetch(
    new Request("https://keeper.internal/tick", { method: "POST" }),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.results).toEqual([
    expect.objectContaining({
      operation: "deployment",
      state: "unavailable",
      failureStage: "preflight",
      error: "Error: Wrong RPC chain",
    }),
  ]);
  expect(rpcMethods).toEqual(["eth_chainId"]);
  expect(await current.store.journal.get<string>("keeper-identity")).toBe(
    JSON.stringify([
      config.apiOrigin,
      config.network,
      config.signer.toLowerCase(),
    ]),
  );
});
