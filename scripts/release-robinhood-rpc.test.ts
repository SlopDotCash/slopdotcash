import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
  checkInheritedVersion,
  qualifyRpc,
  requireQuietJournal,
  requireRotationBase,
  requireSameWorker,
  secureRpcUrl,
  unresolvedFeeWork,
} from "./release-robinhood-rpc";

const sha = "1".repeat(40);
const beforeId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const afterId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const deploymentId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const previous = { id: beforeId, number: 1 };
const candidate = {
  id: afterId,
  number: 2,
  annotations: {
    "workers/tag": sha,
    "workers/message": `slop.cash release ${sha}; Robinhood RPC rotation from ${beforeId}`,
  },
};
const active = {
  id: deploymentId,
  versions: [{ version_id: beforeId, percentage: 100 }],
};

test("only the pinned active and latest versions can enter or finish rotation", () => {
  expect(() =>
    requireRotationBase({ active, latest: previous }, beforeId),
  ).not.toThrow();
  expect(() =>
    requireRotationBase({ active, latest: candidate }, beforeId),
  ).toThrow();
  expect(() =>
    requireRotationBase(
      { active, latest: candidate },
      beforeId,
      afterId,
      deploymentId,
    ),
  ).not.toThrow();
  expect(() =>
    requireRotationBase(
      { active: { ...active, id: afterId }, latest: candidate },
      beforeId,
      afterId,
      deploymentId,
    ),
  ).toThrow();
  expect(() =>
    requireRotationBase(
      {
        active: {
          ...active,
          versions: [{ version_id: beforeId, percentage: 50 }],
        },
        latest: previous,
      },
      beforeId,
    ),
  ).toThrow();
});

test("ordinary releases keep a promoted rotation and refuse an unpromoted one", () => {
  expect(checkInheritedVersion({ active, latest: previous }, previous)).toBe(
    "",
  );
  const unrelated = { id: afterId, number: 2 };
  expect(checkInheritedVersion({ active, latest: unrelated }, previous)).toBe(
    "",
  );
  expect(() =>
    checkInheritedVersion({ active, latest: candidate }, previous),
  ).toThrow();
  expect(checkInheritedVersion({ active, latest: candidate }, candidate)).toBe(
    beforeId,
  );
  const descendant = { ...candidate, id: deploymentId, number: 3 };
  expect(checkInheritedVersion({ active, latest: descendant }, candidate)).toBe(
    beforeId,
  );
});

test("candidate code, D1 and nonsecret settings match and secret names are retained", () => {
  const resources = {
    script: { etag: "fixture-code" },
    script_runtime: { compatibility_date: "2026-07-30" },
    bindings: [
      { name: "BUYBACK_MODE", type: "plain_text", text: "live" },
      { name: "FEE_CONVERTER_MODE", type: "plain_text", text: "live" },
      { name: "FEE_DB", type: "d1", id: "fixture-d1" },
      { name: "RPC_URL_ROBINHOOD", type: "secret_text" },
      { name: "FEE_WALLET_KEY_ROBINHOOD", type: "secret_text" },
    ],
  };
  const before = { ...previous, resources };
  const after = { ...candidate, resources: structuredClone(resources) };
  after.resources.bindings.reverse();
  expect(() => requireSameWorker(before, after, sha)).not.toThrow();
  expect(() => requireSameWorker(before, { ...after, number: 3 }, sha)).toThrow(
    "immediate successor",
  );
  expect(() =>
    requireSameWorker(
      { ...before, number: 1.5 },
      { ...after, number: 2.5 },
      sha,
    ),
  ).toThrow("immediate successor");
  expect(() =>
    requireSameWorker(
      before,
      {
        ...after,
        resources: {
          ...resources,
          script: { etag: "other-code" },
        },
      },
      sha,
    ),
  ).toThrow();
  const withoutKey = resources.bindings.filter(
    ({ name }) => name !== "FEE_WALLET_KEY_ROBINHOOD",
  );
  expect(() =>
    requireSameWorker(
      before,
      {
        ...after,
        resources: {
          ...resources,
          bindings: withoutKey,
        },
      },
      sha,
    ),
  ).toThrow();
  const withOtherDb = resources.bindings.map((b) =>
    b.type === "d1" ? { ...b, id: "other-db" } : b,
  );
  expect(() =>
    requireSameWorker(
      before,
      {
        ...after,
        resources: {
          ...resources,
          bindings: withOtherDb,
        },
      },
      sha,
    ),
  ).toThrow();
});

test("candidate requires a separate TLS endpoint and errors omit its value", () => {
  expect(secureRpcUrl("https://candidate.invalid/credential")).toBe(
    "https://candidate.invalid/credential",
  );
  for (const invalid of [
    undefined,
    "http://candidate.invalid/credential",
    "https://u:credential@candidate.invalid",
    "https://rpc.mainnet.chain.robinhood.com/",
  ]) {
    expect(() => secureRpcUrl(invalid)).toThrow();
    try {
      secureRpcUrl(invalid);
    } catch (error) {
      expect(String(error)).not.toContain("credential");
    }
  }
});

const { vars } = Bun.TOML.parse(
  await Bun.file("workers/fee-converter/wrangler.toml").text(),
) as { vars: Parameters<typeof qualifyRpc>[1] };
const goodHash = `0x${"1".repeat(64)}`;
const otherHash = `0x${"2".repeat(64)}`;

for (const scenario of [
  "matching",
  "wrong chain",
  "wrong hash",
  "unfinalized",
  "failed contract read",
] as const) {
  test(`Robinhood TLS preflight handles ${scenario} with read-only RPC`, async () => {
    const calls: string[] = [];
    const url = "https://candidate.invalid/credential";
    const mockFetch: typeof fetch = Object.assign(
      async (input: Request | string | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        const request = JSON.parse(String(init?.body));
        const isCandidate = String(input) === url;
        calls.push(request.method);
        let result: unknown;
        switch (request.method) {
          case "eth_chainId":
            result =
              scenario === "wrong chain" && isCandidate ? "0x1" : "0x1237";
            break;
          case "eth_getBlockByNumber":
            result = {
              number:
                scenario === "unfinalized" &&
                !isCandidate &&
                request.params[0] === "finalized"
                  ? "0x5"
                  : "0x6",
              hash:
                !isCandidate && scenario === "wrong hash"
                  ? otherHash
                  : goodHash,
            };
            break;
          case "eth_call":
            expect(isCandidate).toBe(true);
            expect(request.params[0].data).toBe(`0x5b2f30e9${"0".repeat(64)}`);
            expect(request.params[1]).toBe("0x6");
            result =
              scenario === "failed contract read"
                ? "0x"
                : `0x${"0".repeat(256)}`;
            break;
          default:
            throw new Error("Unexpected RPC method");
        }
        return Response.json({ jsonrpc: "2.0", id: request.id, result });
      },
      { preconnect: fetch.preconnect },
    );
    const qualified = qualifyRpc(
      url,
      vars as Parameters<typeof qualifyRpc>[1],
      mockFetch,
    );
    if (scenario === "matching") {
      await expect(qualified).resolves.toEqual({
        status: "verified",
        chainId: 4663,
        blockNumber: "6",
        blockHash: goodHash,
      });
      expect(calls).toHaveLength(7);
    } else {
      await expect(qualified).rejects.toThrow(/candidate|independent/u);
    }
    expect(calls).not.toContain("eth_sendRawTransaction");
  });
}

test("rotation counts only aggregate unresolved live journal work", () => {
  using db = new Database(":memory:");
  db.exec(`
    CREATE TABLE fee_conversions(id TEXT, kind TEXT, mode TEXT, state TEXT, approval_tx_id TEXT, raw_tx TEXT, tx_id TEXT);
    CREATE TABLE fee_bridge_outcomes(bridge_id TEXT);
    CREATE TABLE fee_native_gas(network TEXT, state TEXT, actual_wei TEXT);
    INSERT INTO fee_conversions VALUES
      ('quote','bridge','dry_run','quoted',NULL,NULL,NULL),
      ('resolved','bridge','live','finalized',NULL,'retained','exact'),
      ('expired','approval','live','failed','known','retained','exact');
    INSERT INTO fee_bridge_outcomes VALUES ('resolved');
    INSERT INTO fee_native_gas VALUES ('robinhood','signed','0'),('base','signed',NULL);
  `);
  const read = () => ({
    success: true,
    result: [
      {
        success: true,
        results: [db.query(unresolvedFeeWork).get() as Record<string, unknown>],
      },
    ],
  });
  expect(() => requireQuietJournal(read())).not.toThrow();
  db.exec(`
    INSERT INTO fee_conversions VALUES
      ('unknown','buyback','live','unknown',NULL,'retained','exact'),
      ('legacy','approval','live','failed','hash-only',NULL,NULL),
      ('unfilled','bridge','live','finalized',NULL,'retained','exact');
    INSERT INTO fee_native_gas VALUES ('robinhood','signed',NULL);
  `);
  expect(read().result[0].results).toEqual([
    { openSends: 2, openBridgeOrders: 1, openRobinhoodGas: 1 },
  ]);
  expect(() => requireQuietJournal(read())).toThrow("unresolved");
  expect(() => requireQuietJournal({ success: true, result: [] })).toThrow(
    "verify",
  );
});
