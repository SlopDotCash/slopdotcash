// Live cycle against a local Anvil fork of Base mainnet with a throwaway key.
// The last step deploys the reviewed EscrowFactory and ProjectEscrow on the
// fork, accrues a real 2% fee in the vault and proves the converter claims it
// into the fee wallet and sells it (issue #905).
// Nothing reaches a real chain: Anvil holds the fork, the key is generated
// here, and the test token arrives by impersonating a holder on the fork.
// KyberSwap's public API is only read for a route.
//   bun workers/fee-converter/fork.integration.ts [fork-rpc-url] [--fee-claim-only]
// --local instead uses harmless local token/router fixtures and fixed quote replies.
// Every RPC then goes to the owned Anvil; no public provider is called.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  keccak256,
  parseAbi,
  parseTransaction,
  recoverTransactionAddress,
  type TransactionSerializedEIP1559,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { handleFeeConversionsApi } from "../../backend/fee-conversions/handler";
import { evmAwardId } from "../../contracts/evm/adapter";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { NETWORK_DEFINITIONS, parseConfig } from "./config";
import { directFeeScenario } from "./direct-fees-fixture";
import { KYBER_ROUTER_ABI } from "./evm";
import { chainClient, runOnce } from "./index";
import { D1ConversionStore, projectVaults } from "./store";

const FORK_URL =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
  "https://mainnet.base.org";
const PORT = Number(process.env.SLOP_TEST_FEE_PORT ?? 28545);
const local = process.argv.includes("--local");
const claimOnly = process.argv.includes("--fee-claim-only");
const directOnly = process.argv.includes("--direct-receipts");
if (directOnly && !local)
  throw new Error("Direct fee fixture requires --local");
const supportedFaults = [
  "before",
  "after",
  "receipt",
  "hashes",
  "race",
  "finalized-role",
  "receipt-role",
  "lease",
  // Same-nonce fee replacement cases. Each needs its own fresh fork for the
  // same historical-bytecode reason as the other claim cases.
  "bump-replaced",
  "bump-original",
  "bump-cap",
  "bump-restart",
  "bump-nonce",
];
const faults =
  process.env.SLOP_TEST_CLAIM_FAULTS?.split(",") ??
  (local ? ["before", "lease"] : supportedFaults);
if (
  local &&
  faults.some((fault) => !["before", "lease", "finalized-role"].includes(fault))
)
  throw new Error(
    "This local fixture supports approval, claim recovery, lease and finalized-role cases only",
  );
if (faults.some((fault) => !supportedFaults.includes(fault)))
  throw new Error("Unknown fee-claim fault case");
if (faults.length > 1 && !directOnly) {
  // Repeated snapshot restores can lose historical bytecode in Anvil. Each
  // fault needs a fresh chain so receipt-block code checks remain available.
  // The first process also runs the six existing conversion cases.
  for (const [index, fault] of faults.entries()) {
    console.log(
      `Fresh ${local ? "local fixture" : "fork"} for claim fault: ${fault}`,
    );
    const child = Bun.spawn(
      [
        process.execPath,
        import.meta.path,
        ...process.argv.slice(2),
        ...(index > 0 && !claimOnly ? ["--fee-claim-only"] : []),
      ],
      {
        env: { ...process.env, SLOP_TEST_CLAIM_FAULTS: fault },
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    const code = await child.exited;
    if (code !== 0) process.exit(code);
  }
  process.exit(0);
}
const RPC = `http://127.0.0.1:${PORT}`;
const AERO = "0x940181a94a35a4569e4529a3cdfb74e38fd98631";
const HOLDER = "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const NATIVE_ASSET = "0x0000000000000000000000000000000000000000";
// A fork-only copy of the AERO contract: an ERC-20 no aggregator knows.
const UNROUTED = "0x00000000000000000000000000000000000f0e10";

// Read the existing static chain definition without enabling the Worker.
const ROUTER = NETWORK_DEFINITIONS.base.router as Hex;
const nativeFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (local && new URL(url).hostname === "aggregator-api.kyberswap.com") {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/routes")) {
      const tokenIn = parsed.searchParams.get("tokenIn");
      const amountIn = parsed.searchParams.get("amountIn") as string;
      if (tokenIn === UNROUTED)
        return Response.json(
          { code: 4008, message: "No route found" },
          { status: 400 },
        );
      const amountOut =
        tokenIn === NATIVE
          ? BigInt(amountIn) / 1_000_000_000n
          : tokenIn === AERO
            ? BigInt(amountIn) / 2_000_000_000_000n
            : 1n;
      const usd = (Number(amountOut) / 1_000_000).toString();
      return Response.json({
        code: 0,
        data: {
          routerAddress: ROUTER,
          routeSummary: {
            tokenIn,
            tokenOut: USDC,
            amountIn,
            amountOut: amountOut.toString(),
            amountInUsd: usd,
            amountOutUsd: usd,
            gasUsd: "0",
            l1FeeUsd: "0",
            route: [],
          },
        },
      });
    }
    if (parsed.pathname.endsWith("/route/build")) {
      const request = JSON.parse(String(init?.body));
      const route = request.routeSummary;
      const amountOut =
        BigInt(route.amountIn) /
        (route.tokenIn === NATIVE ? 1_000_000_000n : 2_000_000_000_000n);
      return Response.json({
        code: 0,
        data: {
          routerAddress: ROUTER,
          transactionValue: route.tokenIn === NATIVE ? route.amountIn : "0",
          amountIn: route.amountIn,
          amountOut: amountOut.toString(),
          data: encodeFunctionData({
            abi: KYBER_ROUTER_ABI,
            functionName: "swapSimpleMode",
            args: [
              request.sender,
              {
                srcToken: route.tokenIn,
                dstToken: USDC,
                srcReceivers: [],
                srcAmounts: [],
                feeReceivers: [],
                feeAmounts: [],
                dstReceiver: request.recipient,
                amount: BigInt(route.amountIn),
                minReturnAmount:
                  (amountOut * BigInt(10_000 - request.slippageTolerance)) /
                  10_000n,
                flags: 0n,
                permit: "0x",
              },
              "0x",
              "0x",
            ],
          }),
        },
      });
    }
    throw new Error("Unexpected local quote path");
  }
  if (local && new URL(url).origin !== RPC)
    throw new Error("Local proof refused external request");
  const response = await nativeFetch(input, init);
  if (new URL(url).origin === RPC && typeof init?.body === "string") {
    const result = await response.clone().json();
    // Local Anvil has no Base data fee. The local oracle is also exactly zero.
    if (
      local &&
      JSON.parse(init.body).method === "eth_getTransactionReceipt" &&
      result.result
    ) {
      result.result.l1Fee = "0x0";
      return Response.json(result);
    }
    if (result.error) {
      const request = JSON.parse(init.body);
      console.log(
        JSON.stringify({
          rpcMethod: request.method,
          block:
            request.method === "eth_call" || request.method === "eth_getCode"
              ? request.params[1]
              : request.method === "eth_getStorageAt"
                ? request.params[2]
                : undefined,
          rpcError: result.error.code,
          message: JSON.stringify(result.error).replace(
            /0x[0-9a-f]{80,}/giu,
            "<hex>",
          ),
        }),
      );
    }
  }
  return response;
}) as typeof fetch;

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: unknown };
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const word = (address: string) => address.slice(2).padStart(64, "0");
async function balanceOf(token: string, owner: string) {
  return BigInt(
    (await rpc("eth_call", [
      { to: token, data: `0x70a08231${word(owner)}` },
      "latest",
    ])) as string,
  );
}

try {
  await rpc("eth_chainId", []);
  throw new Error(`port ${PORT} is already serving a node; stop it first`);
} catch (error) {
  if (String(error).includes("already serving")) throw error;
}
const journalDirectory = mkdtempSync(join(tmpdir(), "slop-fee-approval-"));
const journalPath = join(journalDirectory, "journal.sqlite");
let closeJournal = () => {};
const anvil = Bun.spawn(
  [
    "anvil",
    ...(local ? ["--chain-id", "8453"] : ["--fork-url", FORK_URL]),
    "--port",
    String(PORT),
    "--silent",
  ],
  { stdout: "ignore", stderr: "inherit" },
);
try {
  for (let i = 0; ; i++) {
    try {
      await rpc("eth_chainId", []);
      break;
    } catch {
      if (i > 60) throw new Error("anvil did not start");
      await Bun.sleep(500);
    }
  }
  if (local) {
    const root = fileURLToPath(new URL("../../contracts/evm", import.meta.url));
    execFileSync(
      "forge",
      ["build", "--root", root, `${root}/test/FeeConverterFixture.sol`],
      { stdio: "pipe" },
    );
    for (const [name, addresses] of [
      ["FeeConverterToken", [AERO]],
      ["FeeConverterUSDC", [USDC]],
      ["FeeConverterRouter", [ROUTER]],
      ["FeeConverterL1Oracle", ["0x420000000000000000000000000000000000000f"]],
    ] as const) {
      const code = execFileSync(
        "forge",
        ["inspect", "--root", root, name, "deployedBytecode"],
        { encoding: "utf8", cwd: root },
      ).trim();
      assert.match(code, /^0x[0-9a-f]+$/u);
      for (const address of addresses)
        await rpc("anvil_setCode", [address, code]);
    }
    const [sender] = (await rpc("eth_accounts", [])) as string[];
    for (const [token, receiver, amount] of [
      [AERO, HOLDER, 10n ** 30n],
      [USDC, ROUTER, 10n ** 18n],
    ] as const) {
      await rpc("eth_sendTransaction", [
        {
          from: sender,
          to: token,
          data: encodeFunctionData({
            abi: parseAbi(["function mint(address,uint256)"]),
            functionName: "mint",
            args: [receiver, amount],
          }),
        },
      ]);
    }
  }
  const key = generatePrivateKey();
  const wallet = privateKeyToAccount(key).address.toLowerCase();
  console.log(
    `throwaway fee wallet ${wallet} on ${local ? "local fixture" : "fork"} chain ${await rpc("eth_chainId", [])}`,
  );
  await rpc("anvil_setBalance", [wallet, "0xde0b6b3a7640000"]);
  await rpc("anvil_setBalance", [HOLDER, "0xde0b6b3a7640000"]);
  await rpc("anvil_setCode", [
    UNROUTED,
    await rpc("eth_getCode", [AERO, "latest"]),
  ]);
  const seed = async (amount = 50n * 10n ** 18n) => {
    await rpc("anvil_impersonateAccount", [HOLDER]);
    await rpc("eth_sendTransaction", [
      {
        from: HOLDER,
        to: AERO,
        data: `0xa9059cbb${word(wallet)}${amount.toString(16).padStart(64, "0")}`,
      },
    ]);
    await rpc("anvil_mine", ["0x1"]);
    await rpc("anvil_stopImpersonatingAccount", [HOLDER]);
    console.log(`seeded ${await balanceOf(AERO, wallet)} AERO base units`);
  };

  let { db, sqlite } = sqliteD1(undefined, journalPath);
  closeJournal = () => sqlite.close();
  const env = {
    FEE_DB: db,
    FEE_CONVERTER_MODE: "live",
    FEE_CONVERTER_NETWORKS: "base",
    FEE_WALLET_BASE: wallet,
    FEE_WALLET_KEY_BASE: key,
    RPC_URL_BASE: RPC,
    // Harness limits for a local chain only; production limits come from
    // the reviewed wrangler.toml.
    FEE_CONVERTER_MIN_VALUE_MICRO: "1000000",
    FEE_CONVERTER_GAS_MULTIPLE: "10",
    FEE_CONVERTER_MAX_SLIPPAGE_BPS: "100",
    FEE_CONVERTER_MAX_PRICE_IMPACT_BPS: "200",
    FEE_CONVERTER_RUN_CAP_MICRO: "1000000000",
    FEE_CONVERTER_DAILY_CAP_MICRO: "5000000000",
    FEE_CONVERTER_NATIVE_BUDGETS: JSON.stringify({
      base: {
        perTransaction: "10000000000000000",
        perDay: "100000000000000000",
        additionalFeeReserve: "1000000000000",
      },
    }),
    FEE_CONVERTER_ALLOWLIST: JSON.stringify({ base: [AERO, UNROUTED] }),
  };
  if (directOnly) {
    await directFeeScenario({
      db,
      sqlite,
      env,
      rpc,
      rpcUrl: RPC,
      wallet,
      token: AERO,
      target: USDC,
    });
    await cleanup();
    process.exit(0);
  }
  // Loses a swap send after the separate approval has finalized,
  // either before it reaches the node or after the node accepted it.
  const faulty = (when: "before" | "after"): typeof fetch => {
    let sends = 0;
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : "";
      const isSend = body.includes('"eth_sendRawTransaction"');
      // Every later send of the run fails too, so the transport retry
      // cannot mask the fault; "after" delivers the first copy only.
      if (isSend && ++sends >= 1) {
        if (when === "after" && sends === 1) await fetch(input, init);
        throw new Error("simulated network fault");
      }
      const response = await fetch(input, init);
      if (when === "before" && String(input).endsWith("/api/v1/route/build")) {
        // ABI trailing bytes do not change the swap. Keep the real route and
        // router execution, but guarantee this recovery case exceeds 8 KiB
        // even when Kyber returns a short route on the day of the test.
        const result = await response.json();
        if (typeof result.data?.data === "string")
          result.data.data = result.data.data.padEnd(20_482, "0");
        return new Response(JSON.stringify(result), {
          status: response.status,
        });
      }
      return response;
    }) as typeof fetch;
  };
  // The approval is a durable intent. A later invocation can prepare the swap
  // only after the approval is canonical and finalized.
  const finishApproval = async (fetchOverride?: typeof fetch) => {
    const open = sqlite
      .prepare(
        "SELECT state FROM fee_conversions WHERE kind='approval' AND token=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(AERO) as { state: string } | null;
    if (open?.state === "submitted" || open?.state === "unknown") {
      await rpc("anvil_mine", ["0x80"]);
      await runOnce(
        env,
        undefined,
        fetchOverride ? { fetch: fetchOverride } : undefined,
      );
    }
  };
  const state = (token = AERO) =>
    sqlite
      .query(
        "SELECT state, reason FROM fee_conversions WHERE token = ? AND kind = 'conversion' ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(token) as { state: string; reason: string | null };
  // Reports a better first quote than the market, as if the price fell
  // between quote and signing; the fresh route at signing must refuse it.
  const inflatedFirstQuote = (): typeof fetch => {
    let inflated = false;
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(input, init);
      if (inflated || !String(input).includes("/api/v1/routes?"))
        return response;
      inflated = true;
      const body = await response.json();
      const out = BigInt(body.data.routeSummary.amountOut);
      body.data.routeSummary.amountOut = ((out * 105n) / 100n).toString();
      return new Response(JSON.stringify(body), { status: response.status });
    }) as typeof fetch;
  };
  const expect = (
    actual: { state: string; reason: string | null },
    wanted: string,
    step: string,
  ) => {
    console.log(
      `${step}: ${actual.state}${actual.reason ? ` (${actual.reason})` : ""}`,
    );
    if (actual.state !== wanted)
      throw new Error(`${step}: expected ${wanted}, got ${actual.state}`);
  };
  const usdcBefore = await balanceOf(USDC, wallet);

  if (!claimOnly) {
    // 1. Ordinary send, finalized on the next run.
    await seed();
    // Lose the approval before delivery, then reopen the actual migrated DB.
    if (local) await rpc("evm_setAutomine", [false]);
    await runOnce(env, undefined, { fetch: faulty("before") });
    const approval = sqlite
      .prepare("SELECT * FROM fee_conversions WHERE kind='approval'")
      .get() as { tx_id: Hex; raw_tx: Hex; state: string; amount_in: string };
    console.log(
      JSON.stringify({
        check: "approval durable before delivery",
        present: !!approval,
        rows: sqlite
          .prepare(
            "SELECT kind,state,raw_tx IS NOT NULL AS retainedBytes,approval_tx_id IS NOT NULL AS approvalHash FROM fee_conversions ORDER BY rowid",
          )
          .all(),
      }),
    );
    assert(
      approval,
      "approval bytes must exist in the journal before delivery",
    );
    assert.equal(approval.state, "unknown");
    assert.equal(keccak256(approval.raw_tx), approval.tx_id);
    assert.equal(
      (
        await recoverTransactionAddress({
          serializedTransaction:
            approval.raw_tx as TransactionSerializedEIP1559,
        })
      ).toLowerCase(),
      wallet,
    );
    const decoded = decodeFunctionData({
      abi: erc20Abi,
      data: parseTransaction(approval.raw_tx).data as Hex,
    });
    assert.equal(decoded.functionName, "approve");
    assert.equal(decoded.args[0].toLowerCase(), ROUTER);
    assert.equal(decoded.args[1], BigInt(approval.amount_in));
    sqlite.close();
    ({ db, sqlite } = sqliteD1([], journalPath));
    env.FEE_DB = db;
    await runOnce(env);
    assert.equal(
      (
        sqlite
          .prepare("SELECT raw_tx FROM fee_conversions WHERE kind='approval'")
          .get() as { raw_tx: string }
      ).raw_tx,
      approval.raw_tx,
    );
    if (local) {
      const original = parseTransaction(approval.raw_tx);
      assert(
        original.maxFeePerGas !== undefined &&
          original.maxPriorityFeePerGas !== undefined,
      );
      const clippedBase =
        original.maxFeePerGas - original.maxPriorityFeePerGas / 2n;
      await rpc("anvil_dropTransaction", [approval.tx_id]);
      await rpc("anvil_setNextBlockBaseFeePerGas", [
        `0x${clippedBase.toString(16)}`,
      ]);
      await rpc("anvil_mine", ["0x1"]);
      const later = () => new Date(Date.now() + 4 * 60_000);
      // First deliver the persisted bytes, then observe the pending send.
      await runOnce(env, later);
      await runOnce(env, later);
      assert.equal(
        (
          sqlite
            .prepare("SELECT COUNT(*) AS n FROM fee_send_replacements")
            .get() as { n: number }
        ).n,
        0,
      );
      await rpc("anvil_setNextBlockBaseFeePerGas", [
        `0x${clippedBase.toString(16)}`,
      ]);
      await rpc("anvil_mine", ["0x1"]);
      const receipt = (await rpc("eth_getTransactionReceipt", [
        approval.tx_id,
      ])) as { status: string; effectiveGasPrice: string };
      assert.equal(receipt.status, "0x1");
      assert.equal(BigInt(receipt.effectiveGasPrice), original.maxFeePerGas);
      console.log(
        JSON.stringify({
          check: "mineable clipped-tip approval",
          replacements: 0,
          originalMined: true,
          effectiveGasPriceEqualsMaximum: true,
        }),
      );
      await rpc("evm_setAutomine", [true]);
    }
    // Receipt existence alone is insufficient; no swap before finality.
    await runOnce(env);
    assert.equal(
      (
        sqlite
          .prepare(
            "SELECT COUNT(*) AS n FROM fee_conversions WHERE kind='conversion'",
          )
          .get() as { n: number }
      ).n,
      0,
    );
    await finishApproval();
    expect(state(), "submitted", "1 after approval finality and swap send");
    await rpc("anvil_mine", ["0x80"]); // Anvil finalizes only after later blocks.
    await runOnce(env);
    expect(state(), "finalized", "1 after reconcile");

    // 2. Swap lost before delivery: recorded unknown, rebroadcast unchanged, finalized.
    await seed();
    await runOnce(env);
    await finishApproval(faulty("before"));
    expect(state(), "unknown", "2 after lost send");
    const largeSend = sqlite
      .query(
        "SELECT tx_id, length(raw_tx) AS length FROM fee_conversions WHERE state = 'unknown'",
      )
      .get() as { tx_id: string; length: number };
    if (largeSend.length <= 16384)
      throw new Error(
        "large-route recovery did not exceed the old storage limit",
      );
    console.log(
      `2 persisted signed transaction: ${largeSend.length} characters`,
    );
    await runOnce(env);
    expect(state(), "submitted", "2 after rebroadcast");
    await rpc("anvil_mine", ["0x80"]);
    await runOnce(env);
    expect(state(), "finalized", "2 after reconcile");
    const recoveredSend = sqlite
      .query("SELECT state FROM fee_conversions WHERE tx_id = ?")
      .get(largeSend.tx_id) as { state: string };
    if (recoveredSend.state !== "finalized")
      throw new Error(
        "large-route recovery did not finalize the original transaction",
      );

    // 3. Swap delivered but the response lost: reconciled from the receipt, no resend.
    await seed();
    await runOnce(env);
    await finishApproval(faulty("after"));
    expect(state(), "unknown", "3 after lost response");
    await rpc("anvil_mine", ["0x80"]);
    await runOnce(env);
    expect(state(), "finalized", "3 after reconcile");

    // 4. Below the minimum value: pending, nothing signed.
    await seed(10n ** 18n); // 1 AERO, under the 1 USDC minimum
    await runOnce(env);
    expect(state(), "pending", "4 below minimum");

    // 5. Price moved between quote and signing: refused before signing.
    await seed(49n * 10n ** 18n);
    await runOnce(env);
    await finishApproval(inflatedFirstQuote());
    expect(state(), "failed", "5 slippage refusal");

    // 6. A token no aggregator can route: no_route. The AERO balance converts.
    await rpc("anvil_setStorageAt", [
      UNROUTED,
      keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }],
          [wallet as `0x${string}`, 0n],
        ),
      ),
      `0x${(1000n * 10n ** 18n).toString(16).padStart(64, "0")}`,
    ]);
    await runOnce(env);
    await finishApproval();
    expect(state(UNROUTED), "no_route", "6 unsupported route");
    expect(state(), "submitted", "6 AERO send");
    await rpc("anvil_mine", ["0x80"]);
    await runOnce(env);
    expect(state(), "finalized", "6 after reconcile");

    const usdcAfter = await balanceOf(USDC, wallet);
    const aeroAfter = await balanceOf(AERO, wallet);
    const rows = sqlite
      .query(
        `SELECT state, amount_in, quote_amount_out, min_amount_out, amount_out,
            approval_tx_id, tx_id, evm_nonce, token_balance_before, target_balance_before,
            target_balance_after, reason FROM fee_conversions WHERE kind = 'conversion' ORDER BY rowid`,
      )
      .all() as { state: string; amount_out: string | null }[];
    console.log(JSON.stringify(rows, null, 2));
    const recorded = rows.reduce(
      (sum, row) => sum + BigInt(row.amount_out ?? "0"),
      0n,
    );
    console.log(
      `USDC delta ${usdcAfter - usdcBefore}; recorded ${recorded}; AERO left ${aeroAfter}`,
    );
    if (
      JSON.stringify(rows.map((row) => row.state)) !==
        JSON.stringify([
          "finalized",
          "finalized",
          "finalized",
          "pending",
          "failed",
          "finalized",
          "no_route",
        ]) ||
      recorded !== usdcAfter - usdcBefore ||
      aeroAfter !== 0n
    )
      throw new Error(
        "fork live cycles did not finalize with matching proceeds",
      );
    const api = await handleFeeConversionsApi(
      new Request("http://localhost/api/v1/admin/fee-conversions"),
      {
        db,
        adminGithubIds: new Set(["1"]),
        sessionActor: async () => ({ githubId: "1" }),
      },
    );
    const report = (await api?.json()) as {
      recent: { txId: string | null }[];
      totals: { amountOut: string }[];
    };
    const approvalIds = new Set(
      (
        sqlite
          .prepare("SELECT tx_id FROM fee_conversions WHERE kind='approval'")
          .all() as { tx_id: string }[]
      ).map((row) => row.tx_id),
    );
    assert.equal(api?.status, 200);
    assert(report.recent.every((row) => !approvalIds.has(row.txId ?? "")));
    assert.equal(
      report.totals.reduce((sum, row) => sum + BigInt(row.amountOut), 0n),
      recorded,
    );
    // A repeat run finds nothing left to sell and records nothing new.
    await runOnce(env);
    const count = sqlite
      .query(
        "SELECT COUNT(*) AS n FROM fee_conversions WHERE kind = 'conversion'",
      )
      .get() as { n: number };
    if (count.n !== 7) throw new Error("a repeat run added a record");
  }

  // 7. EVM fees accrue inside the vault until claimFees() moves them to the
  // fee recipient. Deploy the reviewed contracts with this fee wallet as fee
  // recipient, accrue a real 2% withdrawal fee, and run the Worker.
  const [registrar, authority] = (await rpc("eth_accounts", [])) as string[];
  const vaultAbi = parseAbi([
    "function create(bytes32,address,uint8) returns (address)",
    "function vaultKey(address,bytes32,address,uint8) pure returns (bytes32)",
    "function vaults(bytes32) view returns (address)",
    "function approve(address,uint256) returns (bool)",
    "function deposit(uint128) payable",
    "function withdrawUnused(uint128)",
    "function accruedFees() view returns (uint128)",
    "function freeBalance() view returns (uint128)",
    "function reservedPrincipal() view returns (uint128)",
    "function reservedFees() view returns (uint128)",
    "function commitBountyAward(bytes32,uint64,uint128,bytes32)",
    "function upgradeToAndCall(address,bytes)",
    "function proposeIdentityAuthority(address)",
    "function executeIdentityAuthorityRotation()",
    "function claimFees()",
  ]);
  const call = async (from: string, to: string, data: Hex, value = 0n) => {
    const hash = await rpc("eth_sendTransaction", [
      { from, to, data, value: `0x${value.toString(16)}`, gas: "0x7a1200" },
    ]);
    await rpc("anvil_mine", ["0x1"]);
    const receipt = (await rpc("eth_getTransactionReceipt", [hash])) as {
      status: string;
    };
    if (receipt.status !== "0x1")
      throw new Error(
        `7 ${decodeFunctionData({ abi: vaultAbi, data }).functionName} transaction reverted`,
      );
  };
  const view = async (
    to: string,
    functionName:
      | "vaultKey"
      | "vaults"
      | "accruedFees"
      | "freeBalance"
      | "reservedPrincipal"
      | "reservedFees",
    args: readonly unknown[] = [],
  ) =>
    decodeFunctionResult({
      abi: vaultAbi,
      functionName,
      data: (await rpc("eth_call", [
        {
          to,
          data: encodeFunctionData({
            abi: vaultAbi,
            functionName,
            args: args as never,
          }),
        },
        "latest",
      ])) as Hex,
    });
  // Reuse the contract suite's atomic proxy deployment. The production
  // implementations disable direct initialization in their constructors.
  const fixture = (
    JSON.parse(
      execFileSync(
        "forge",
        [
          "create",
          "--root",
          fileURLToPath(new URL("../../contracts/evm", import.meta.url)),
          "test/DeployFactory.sol:FactoryFixture",
          "--rpc-url",
          RPC,
          "--unlocked",
          "--from",
          registrar,
          "--broadcast",
          "--json",
          "--constructor-args",
          registrar,
          wallet,
          authority,
          "3600",
        ],
        { encoding: "utf8" },
      ),
    ) as { deployedTo: string }
  ).deployedTo.toLowerCase();
  const factory = decodeFunctionResult({
    abi: parseAbi(["function factory() view returns (address)"]),
    functionName: "factory",
    data: (await rpc("eth_call", [
      {
        to: fixture,
        data: encodeFunctionData({
          abi: parseAbi(["function factory() view returns (address)"]),
          functionName: "factory",
        }),
      },
      "latest",
    ])) as Hex,
  }).toLowerCase();
  const projectKey = keccak256(new TextEncoder().encode("fee-claim-fork"));
  await call(
    registrar,
    factory,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "create",
      args: [projectKey, AERO, 1],
    }),
  );
  const vaultKey = await view(factory, "vaultKey", [
    registrar,
    projectKey,
    AERO,
    1,
  ]);
  const vault = (
    (await view(factory, "vaults", [vaultKey])) as unknown as string
  ).toLowerCase();
  const gross = 500n * 10n ** 18n;
  const deposit = gross + 300n * 10n ** 18n;
  const reserved = 100n * 10n ** 18n;
  await rpc("anvil_impersonateAccount", [HOLDER]);
  await rpc("eth_sendTransaction", [
    {
      from: HOLDER,
      to: AERO,
      data: `0xa9059cbb${word(registrar)}${deposit.toString(16).padStart(64, "0")}`,
    },
  ]);
  await rpc("anvil_stopImpersonatingAccount", [HOLDER]);
  await call(
    registrar,
    AERO,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "approve",
      args: [vault as Hex, deposit],
    }),
  );
  await call(
    registrar,
    vault,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "deposit",
      args: [deposit],
    }),
  );
  const sourceDigest = keccak256(
    new TextEncoder().encode("fee-claim-reserved-award"),
  );
  await call(
    registrar,
    vault,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "commitBountyAward",
      args: [
        evmAwardId(
          BigInt((await rpc("eth_chainId", [])) as string),
          vault,
          sourceDigest,
        ) as Hex,
        101n,
        reserved,
        sourceDigest,
      ],
    }),
  );
  await call(
    registrar,
    vault,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "withdrawUnused",
      args: [gross],
    }),
  );
  const fee = (gross + 49n) / 50n;
  if ((await view(vault, "accruedFees")) !== fee)
    throw new Error("7 the withdrawal did not accrue the 2% fee");
  const runtimeDigest = async (address: string) =>
    createHash("sha256")
      .update(
        Buffer.from(
          ((await rpc("eth_getCode", [address, "latest"])) as string).slice(2),
          "hex",
        ),
      )
      .digest("hex");
  const implementation = async (address: string) =>
    `0x${((await rpc("eth_getStorageAt", [address, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", "latest"])) as string).slice(-40)}`;
  const vaultImplementation = await implementation(vault);
  const factoryImplementation = await implementation(factory);
  const deployment = {
    network: "base-mainnet",
    vault,
    asset: AERO,
    owner: registrar,
    identityAuthority: authority,
    feeRecipient: wallet,
    factory,
    registrar,
    bindingDelaySeconds: "3600",
    codeSha256: await runtimeDigest(vault),
    factoryCodeSha256: await runtimeDigest(factory),
    evmUpgrade: {
      authority: "0x00000000000000000000000000000000000abcde",
      vaultImplementation,
      vaultImplementationCodeSha256: await runtimeDigest(vaultImplementation),
      factoryImplementation,
      factoryImplementationCodeSha256: await runtimeDigest(
        factoryImplementation,
      ),
    },
  };
  let revision = 0;
  const save = (record: Record<string, unknown>, bounty = true) => {
    const manifest = JSON.stringify({
      id: "fee-claim-fork",
      status: "active",
      ...(bounty
        ? { securityBounty: { settlement: { deployments: [record] } } }
        : { escrow: { deployments: [record] } }),
    });
    revision++;
    sqlite
      .prepare(
        "INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        "fee-claim-fork",
        revision,
        manifest,
        "a".repeat(64),
        "local claim proof",
        "now",
      );
    if (revision === 1)
      sqlite
        .prepare(
          "INSERT INTO projects (id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          "fee-claim-fork",
          "active",
          revision,
          manifest,
          "a".repeat(64),
          "now",
          "now",
        );
    else
      sqlite
        .prepare(
          "UPDATE projects SET manifest=?,revision=? WHERE id='fee-claim-fork'",
        )
        .run(manifest, revision);
  };
  const parsed = parseConfig(env);
  const feeClient = chainClient(
    { ...env, FEE_CONVERTER_MODE: "dry_run" },
    { ...parsed, mode: "dry_run" },
    parsed.networks[0],
  ).vaultFees;
  if (!feeClient) throw new Error("EVM client lacks fee claims");
  const refusal = async (
    label: string,
    record: Record<string, unknown>,
    bounty = true,
  ) => {
    save(record, bounty);
    const entries = await projectVaults(db, ["base-mainnet"]);
    const nonce = await rpc("eth_getTransactionCount", [wallet, "latest"]);
    let error = "";
    try {
      await feeClient.claim(entries[0], async () => {});
    } catch (caught) {
      error = String(caught);
    }
    const afterNonce = await rpc("eth_getTransactionCount", [wallet, "latest"]);
    const unchanged =
      nonce === afterNonce && (await view(vault, "accruedFees")) === fee;
    console.log(
      JSON.stringify({ check: label, rejected: !!error, unchanged, error }),
    );
    if (!error || !unchanged)
      throw new Error(`${label}: unreviewed claim was signed or accepted`);
  };
  await rpc("anvil_mine", ["0x80"]);
  await refusal("missing deployment pins", {
    network: "base-mainnet",
    vault,
    asset: AERO,
  });
  await refusal("changed runtime pin", {
    ...deployment,
    codeSha256: "0".repeat(64),
  });
  await refusal("changed asset", { ...deployment, asset: USDC });
  await refusal("changed owner", { ...deployment, owner: authority });
  await refusal("changed fee recipient", {
    ...deployment,
    feeRecipient: authority,
  });
  await refusal("changed upgrade authority", {
    ...deployment,
    evmUpgrade: { ...deployment.evmUpgrade, authority: registrar },
  });
  await refusal("wrong payout purpose", deployment, false);
  const roleErrors: string[] = [];
  for (const state of ["pending", "current"] as const) {
    const snapshot = await rpc("evm_snapshot", []);
    try {
      await call(
        registrar,
        factory,
        encodeFunctionData({
          abi: vaultAbi,
          functionName: "proposeIdentityAuthority",
          args: [wallet as Hex],
        }),
      );
      if (state === "current")
        await call(
          registrar,
          factory,
          encodeFunctionData({
            abi: vaultAbi,
            functionName: "executeIdentityAuthorityRotation",
          }),
        );
      await refusal(`fee wallet is ${state} identity authority`, deployment);
    } catch (error) {
      roleErrors.push(String(error));
    }
    if (!(await rpc("evm_revert", [snapshot])))
      throw new Error("local role snapshot restore failed");
  }
  if (roleErrors.length) throw new Error(roleErrors.join("; "));
  // A separate attester may rotate without a new deployment record.
  const nextIdentity = ((await rpc("eth_accounts", [])) as Hex[])[2];
  await call(
    registrar,
    factory,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "proposeIdentityAuthority",
      args: [nextIdentity],
    }),
  );
  await call(
    registrar,
    factory,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "executeIdentityAuthorityRotation",
    }),
  );
  save(deployment);
  const freeBeforeClaim = await view(vault, "freeBalance");
  if (
    ((await view(vault, "reservedPrincipal")) as bigint) +
      ((await view(vault, "reservedFees")) as bigint) !==
      reserved ||
    freeBeforeClaim !== 200n * 10n ** 18n
  )
    throw new Error("reserved/free fixture is wrong");
  // A legitimate implementation upgrade needs a new reviewed pin before claims resume.
  const nextImplementation = JSON.parse(
    execFileSync(
      "forge",
      [
        "create",
        "--root",
        fileURLToPath(new URL("../../contracts/evm", import.meta.url)),
        "src/ProjectEscrow.sol:ProjectEscrow",
        "--rpc-url",
        RPC,
        "--unlocked",
        "--from",
        registrar,
        "--broadcast",
        "--json",
      ],
      { encoding: "utf8" },
    ),
  ).deployedTo.toLowerCase();
  await rpc("anvil_setBalance", [
    deployment.evmUpgrade.authority,
    "0xde0b6b3a7640000",
  ]);
  await rpc("anvil_impersonateAccount", [deployment.evmUpgrade.authority]);
  await call(
    deployment.evmUpgrade.authority,
    vault,
    encodeFunctionData({
      abi: vaultAbi,
      functionName: "upgradeToAndCall",
      args: [nextImplementation, "0x"],
    }),
  );
  await rpc("anvil_stopImpersonatingAccount", [
    deployment.evmUpgrade.authority,
  ]);
  await rpc("anvil_mine", ["0x80"]);
  await refusal("unreviewed implementation upgrade", deployment);
  deployment.evmUpgrade.vaultImplementation = nextImplementation;
  deployment.evmUpgrade.vaultImplementationCodeSha256 =
    await runtimeDigest(nextImplementation);
  save(deployment);
  const aeroBeforeClaim = await balanceOf(AERO, wallet);

  // A receipt run never claims; a dry run reports the claim and signs nothing.
  await runOnce(env, undefined, undefined, "receipts");
  await runOnce({ ...env, FEE_CONVERTER_MODE: "dry_run" });
  if (
    (await view(vault, "accruedFees")) !== fee ||
    (await balanceOf(AERO, wallet)) !== aeroBeforeClaim
  )
    throw new Error("7 a receipt or dry run moved vault fees");

  if (faults[0] === "lease") {
    let clock = new Date();
    let takeover = false;
    const initialNonce = await rpc("eth_getTransactionCount", [
      wallet,
      "latest",
    ]);
    const claimData = encodeFunctionData({
      abi: vaultAbi,
      functionName: "claimFees",
    });
    const delayed = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (
        !takeover &&
        body?.method === "eth_estimateGas" &&
        body.params[0]?.data === claimData
      ) {
        clock = new Date(clock.getTime() + 15 * 60_000);
        takeover = await new D1ConversionStore(db).acquireLock(
          "base",
          "successor-lease",
          clock,
        );
        assert(takeover);
      }
      return fetch(input, init);
    }) as typeof fetch;
    const [result] = await runOnce(env, () => clock, { fetch: delayed });
    const claims = sqlite
      .prepare("SELECT COUNT(*) AS n FROM fee_conversions WHERE kind='claim'")
      .get() as { n: number };
    const unchangedNonce =
      initialNonce ===
      (await rpc("eth_getTransactionCount", [wallet, "latest"]));
    const retained = (await view(vault, "accruedFees")) === fee;
    console.log(
      JSON.stringify({
        check: "claim lease takeover",
        takeover,
        claimed: result.claimed,
        journalClaims: claims.n,
        unchangedNonce,
        accruedFeesRetained: retained,
      }),
    );
    assert(takeover);
    assert.equal(result.claimed, 0);
    assert.equal(claims.n, 0);
    assert(unchangedNonce && retained);
    assert.equal(
      (
        sqlite
          .prepare(
            "SELECT run_id FROM fee_converter_locks WHERE network='base'",
          )
          .get() as { run_id: string }
      ).run_id,
      "successor-lease",
    );
  }

  // Each retry uses a fresh Worker invocation and the durable SQLite journal.
  console.log(`Claim fault cases: ${faults.join(", ")}`);
  for (const fault of faults.filter(
    (fault) =>
      fault !== "finalized-role" &&
      fault !== "receipt-role" &&
      fault !== "lease" &&
      !fault.startsWith("bump-"),
  )) {
    const conversionsBefore = (
      sqlite
        .query(
          "SELECT COUNT(*) AS n FROM fee_conversions WHERE kind = 'conversion' AND token = ?",
        )
        .get(AERO) as { n: number }
    ).n;
    let delivered = false;
    let claimHash: string | null = null;
    const interrupted: typeof fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (
        (fault === "before" || fault === "after") &&
        body.includes('"eth_sendRawTransaction"')
      ) {
        if (fault === "after" && !delivered) {
          delivered = true;
          await fetch(input, init);
        }
        throw new Error("local claim send interrupted");
      }
      if (
        fault === "race" &&
        !delivered &&
        body.includes('"eth_sendRawTransaction"')
      ) {
        delivered = true;
        await call(
          registrar,
          vault,
          encodeFunctionData({ abi: vaultAbi, functionName: "claimFees" }),
        );
        await call(
          registrar,
          vault,
          encodeFunctionData({
            abi: vaultAbi,
            functionName: "withdrawUnused",
            args: [100n * 10n ** 18n],
          }),
        );
      }
      if (
        fault === "hashes" &&
        claimHash &&
        body.includes(claimHash) &&
        /eth_getTransaction(?:Receipt|ByHash)/u.test(body)
      )
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: JSON.parse(body).id,
            result: null,
          }),
          { headers: { "content-type": "application/json" } },
        );
      const response = await fetch(input, init);
      if (fault !== "receipt" || !body.includes('"eth_getTransactionReceipt"'))
        return response;
      const result = await response.json();
      if (result.result?.logs)
        result.result.logs = result.result.logs.filter(
          (log: { address: string }) => log.address.toLowerCase() !== AERO,
        );
      return new Response(JSON.stringify(result), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    await runOnce(env, undefined, { fetch: interrupted });
    const claim = sqlite
      .query(
        "SELECT tx_id, raw_tx, state FROM fee_conversions WHERE kind = 'claim' ORDER BY rowid DESC LIMIT 1",
      )
      .get() as { tx_id: string; raw_tx: string; state: string };
    claimHash = claim?.tx_id ?? null;
    const conversionCount = () =>
      (
        sqlite
          .query(
            "SELECT COUNT(*) AS n FROM fee_conversions WHERE kind = 'conversion' AND token = ?",
          )
          .get(AERO) as { n: number }
      ).n;
    if (
      claim?.state !==
        (fault === "hashes" || fault === "race" ? "submitted" : "unknown") ||
      conversionCount() !== conversionsBefore
    )
      throw new Error(
        `${fault}: claim state ${claim?.state}; conversions ${conversionCount()}, expected ${conversionsBefore}`,
      );
    await rpc("anvil_mine", ["0x80"]);
    if (fault === "receipt" || fault === "hashes") {
      await runOnce(env, undefined, { fetch: interrupted }, "receipts");
      if (conversionCount() !== conversionsBefore)
        throw new Error(
          `${fault}: unavailable claim proof allowed a later receipt-run conversion`,
        );
    }
    // A lost send is rebroadcast unchanged; a lost response needs no new send.
    await runOnce(env, undefined, undefined, "receipts");
    if (fault === "before") {
      if (conversionCount() !== conversionsBefore)
        throw new Error("rebroadcast claim converted before finality");
      await rpc("anvil_mine", ["0x80"]);
      await runOnce(env, undefined, undefined, "receipts");
    }
    await finishApproval();
    const recovered = sqlite
      .query(
        "SELECT tx_id, raw_tx, state FROM fee_conversions WHERE kind = 'claim'",
      )
      .all() as { tx_id: string; raw_tx: string; state: string }[];
    if (
      recovered.length !== 1 ||
      recovered[0].tx_id !== claim.tx_id ||
      recovered[0].raw_tx !== claim.raw_tx ||
      recovered[0].state !== "finalized" ||
      conversionCount() !== conversionsBefore + 1
    )
      throw new Error(
        `${fault}: claim did not recover once with the same signed bytes`,
      );
    await rpc("anvil_mine", ["0x80"]);
    await runOnce(env, undefined, undefined, "receipts");
    expect(state(), "finalized", `7 ${fault} claim recovery`);
    if (
      (await view(vault, "freeBalance")) !==
        freeBeforeClaim - (fault === "race" ? 100n * 10n ** 18n : 0n) ||
      ((await view(vault, "reservedPrincipal")) as bigint) +
        ((await view(vault, "reservedFees")) as bigint) !==
        reserved ||
      (await balanceOf(AERO, vault)) !==
        (fault === "race" ? 200n : 300n) * 10n ** 18n
    )
      throw new Error(
        `${fault}: claim recovery changed principal or reserved awards`,
      );
    console.log(
      `7 ${fault}: unverified claim blocked conversion; same send recovered once`,
    );
  }

  if (faults[0].startsWith("bump-")) {
    // Same-nonce fee replacement (owner decision of 25 October 2026). Anvil
    // stops automatic mining and raises the base fee above the signed fee,
    // so the claim stays unmined as it would while gas stays high.
    const accrue = async (gross: bigint) => {
      await rpc("anvil_impersonateAccount", [HOLDER]);
      await call(
        HOLDER,
        AERO,
        `0xa9059cbb${word(registrar)}${gross.toString(16).padStart(64, "0")}`,
      );
      await rpc("anvil_stopImpersonatingAccount", [HOLDER]);
      for (const [to, data] of [
        [
          AERO,
          encodeFunctionData({
            abi: vaultAbi,
            functionName: "approve",
            args: [vault as Hex, gross],
          }),
        ],
        [
          vault,
          encodeFunctionData({
            abi: vaultAbi,
            functionName: "deposit",
            args: [gross],
          }),
        ],
        [
          vault,
          encodeFunctionData({
            abi: vaultAbi,
            functionName: "withdrawUnused",
            args: [gross],
          }),
        ],
      ] as const)
        await call(registrar, to, data);
      await rpc("anvil_mine", ["0x80"]);
    };
    const hex = (value: bigint) => `0x${value.toString(16)}`;
    const mineAtBaseFee = async (fee: bigint) => {
      await rpc("anvil_setNextBlockBaseFeePerGas", [hex(fee)]);
      await rpc("anvil_mine", ["0x1"]);
    };
    const receiptOf = (hash: string) =>
      rpc("eth_getTransactionReceipt", [hash]) as Promise<{
        status: string;
      } | null>;
    const inPool = async (hash: string) =>
      (await rpc("eth_getTransactionByHash", [hash])) !== null;
    let clock = Date.now();
    const at = (ms: number) => {
      clock += ms;
      const fixed = new Date(clock);
      return () => fixed;
    };
    const events: string[] = [];
    const log = console.log;
    const capture = async <T>(work: () => Promise<T>) => {
      console.log = (line: unknown) => {
        events.push(String(line));
        log(line);
      };
      try {
        return await work();
      } finally {
        console.log = log;
      }
    };
    const latestClaim = () =>
      sqlite
        .query(
          "SELECT id, tx_id, raw_tx, state, reason, landed_tx_id, amount_out FROM fee_conversions WHERE kind = 'claim' ORDER BY rowid DESC LIMIT 1",
        )
        .get() as {
        id: string;
        tx_id: string;
        raw_tx: string;
        state: string;
        reason: string | null;
        landed_tx_id: string | null;
        amount_out: string | null;
      };
    const replacementsOf = (id: string) =>
      sqlite
        .query(
          "SELECT attempt, tx_id, raw_tx, max_fee_per_gas, max_priority_fee_per_gas FROM fee_send_replacements WHERE conversion_id = ? ORDER BY attempt",
        )
        .all(id) as {
        attempt: number;
        tx_id: string;
        raw_tx: string;
        max_fee_per_gas: string;
        max_priority_fee_per_gas: string;
      }[];
    const signedFee = (raw: string) => {
      const parsed = parseTransaction(raw as Hex);
      return {
        max: parsed.maxFeePerGas as bigint,
        tip: parsed.maxPriorityFeePerGas as bigint,
        nonce: parsed.nonce,
      };
    };
    const ceil = (value: bigint, percent: bigint) =>
      (value * percent + 99n) / 100n;
    // Starts one stalled claim: a fresh 2% fee, then a live recovery run
    // whose claim is broadcast but not mined.
    const stall = async (label: string) => {
      await accrue(5_000n * 10n ** 18n);
      const accrued = (await view(vault, "accruedFees")) as bigint;
      await rpc("evm_setAutomine", [false]);
      await runOnce(env, at(60 * 60 * 1000));
      const claim = latestClaim();
      if (claim.state !== "unknown" || !(await inPool(claim.tx_id)))
        throw new Error(`${label}: the claim did not stall unmined`);
      const original = signedFee(claim.raw_tx);
      console.log(
        `${label}: claim ${claim.tx_id} stalled; nonce ${original.nonce}, maxFeePerGas ${original.max}`,
      );
      return { claim, original, accrued };
    };
    // Mines with automatic mining back on, reconciles the claim, and sells
    // the claimed fee so the next case starts with no open send.
    const settle = async (label: string, accrued: bigint) => {
      await rpc("evm_setAutomine", [true]);
      await rpc("anvil_mine", ["0x80"]);
      await runOnce(env, at(5 * 60 * 1000), undefined, "receipts");
      const claim = latestClaim();
      if (claim.state !== "finalized" || claim.amount_out !== String(accrued))
        throw new Error(
          `${label}: claim ${claim.state} with ${claim.amount_out}, expected ${accrued}`,
        );
      await rpc("anvil_mine", ["0x80"]);
      await runOnce(env, at(5 * 60 * 1000), undefined, "receipts");
      // The sale uses live KyberSwap routes against an older fork block and
      // can fail simulation late in a long case. It is not under test here;
      // only the claim is. Any outcome must be final, not an open send.
      const sale = state();
      console.log(
        `${label} sale of the claimed fee: ${sale.state}${sale.reason ? ` (${sale.reason.slice(0, 80)})` : ""}`,
      );
      if (sale.state === "submitted" || sale.state === "unknown")
        throw new Error(`${label}: the sale of the claimed fee is still open`);
      if ((await view(vault, "accruedFees")) !== 0n)
        throw new Error(`${label}: fees remain in the vault`);
      return claim;
    };
    const claimsBefore = (
      sqlite
        .query("SELECT COUNT(*) AS n FROM fee_conversions WHERE kind = 'claim'")
        .get() as { n: number }
    ).n;

    // 8a. A stalled claim is replaced at a higher fee, and the replacement lands.
    if (faults[0] === "bump-replaced") {
      const label = "8a stalled claim replaced";
      const { claim, original, accrued } = await stall(label);
      await mineAtBaseFee(original.max + 1n);
      if (await receiptOf(claim.tx_id))
        throw new Error(`${label}: the claim was mined below the base fee`);
      // Too early: no replacement before the bounded wait.
      await runOnce(env, at(60 * 1000), undefined, "receipts");
      // Dry run reconciles, but never signs a replacement.
      await runOnce(
        { ...env, FEE_CONVERTER_MODE: "dry_run" },
        at(4 * 60 * 1000),
        undefined,
        "receipts",
      );
      if (replacementsOf(claim.id).length !== 0)
        throw new Error(`${label}: replaced early or in dry run`);
      await runOnce(env, at(0), undefined, "receipts");
      const [first, ...rest] = replacementsOf(claim.id);
      if (!first) throw new Error(`${label}: no replacement was journaled`);
      const bumped = signedFee(first.raw_tx);
      if (
        rest.length !== 0 ||
        first.attempt !== 1 ||
        bumped.nonce !== original.nonce ||
        bumped.max !== ceil(original.max, 125n) ||
        bumped.tip !== ceil(original.tip, 125n) ||
        first.max_fee_per_gas !== String(bumped.max) ||
        !(await inPool(first.tx_id)) ||
        (await inPool(claim.tx_id))
      )
        throw new Error(`${label}: expected one +25% same-nonce replacement`);
      await mineAtBaseFee(original.max - original.tip);
      if (!(await receiptOf(first.tx_id)) || (await receiptOf(claim.tx_id)))
        throw new Error(`${label}: the replacement did not land alone`);
      const settled = await settle(label, accrued);
      if (settled.landed_tx_id !== first.tx_id || settled.tx_id !== claim.tx_id)
        throw new Error(`${label}: the landed replacement was not recorded`);
      console.log(
        `${label}: replacement ${first.tx_id} landed at maxFeePerGas ${bumped.max}; one claim of ${accrued}`,
      );
    }

    // 8b. The original lands after its replacement was broadcast.
    if (faults[0] === "bump-original") {
      const label = "8b original lands after replacement";
      const { claim, original, accrued } = await stall(label);
      await mineAtBaseFee(original.max + 1n);
      await runOnce(env, at(4 * 60 * 1000), undefined, "receipts");
      const [first] = replacementsOf(claim.id);
      if (!first || !(await inPool(first.tx_id)))
        throw new Error(`${label}: no replacement was broadcast`);
      // Another node still holds the original: it is mined first.
      await rpc("anvil_dropTransaction", [first.tx_id]);
      await rpc("eth_sendRawTransaction", [claim.raw_tx]);
      await mineAtBaseFee(original.max - original.tip);
      if (!(await receiptOf(claim.tx_id)) || (await receiptOf(first.tx_id)))
        throw new Error(`${label}: the original did not land alone`);
      const settled = await settle(label, accrued);
      if (
        settled.landed_tx_id !== claim.tx_id ||
        replacementsOf(claim.id).length !== 1
      )
        throw new Error(`${label}: the landed original was not recorded`);
      console.log(
        `${label}: original ${claim.tx_id} landed after replacement ${first.tx_id}; one claim of ${accrued}`,
      );
    }

    // 8c. Gas stays high: replacements stop at three times the original fee.
    if (faults[0] === "bump-cap") {
      const label = "8c replacement cap";
      const { claim, original, accrued } = await stall(label);
      let steps = 0;
      for (; steps < 8; steps++) {
        await mineAtBaseFee(original.max * 10n);
        await capture(() =>
          runOnce(env, at(4 * 60 * 1000), undefined, "receipts"),
        );
      }
      const attempts = replacementsOf(claim.id);
      const fees = attempts.map((attempt) => signedFee(attempt.raw_tx));
      const last = fees.at(-1);
      const capped = events.some(
        (line) =>
          line.includes('"event":"fee_send_waiting"') &&
          line.includes("fee replacement cap reached"),
      );
      if (
        attempts.length !== 5 ||
        !last ||
        last.max !== original.max * 3n ||
        last.tip !== original.tip * 3n ||
        fees.some(
          (fee, index) =>
            fee.nonce !== original.nonce ||
            fee.max < ceil(index ? fees[index - 1].max : original.max, 110n),
        ) ||
        !capped
      )
        throw new Error(
          `${label}: expected 5 replacements ending at 3x, got ${attempts.length}`,
        );
      // A restarted run does not pass the cap either.
      await mineAtBaseFee(original.max * 10n);
      await runOnce(env, at(4 * 60 * 1000), undefined, "receipts");
      if (replacementsOf(claim.id).length !== 5)
        throw new Error(`${label}: a later run exceeded the cap`);
      // Anvil refuses a send whose maximum fee is below the base fee, so the
      // node holds no attempt now; every attempt is in the journal. When the
      // base fee falls, the next run sends the capped bytes again and signs
      // nothing new.
      await mineAtBaseFee(original.max - original.tip);
      await runOnce(env, at(30 * 1000), undefined, "receipts");
      if (
        replacementsOf(claim.id).length !== 5 ||
        !(await inPool(attempts[4].tx_id))
      )
        throw new Error(`${label}: the capped bytes were not sent again`);
      await mineAtBaseFee(original.max - original.tip);
      if (!(await receiptOf(attempts[4].tx_id)))
        throw new Error(`${label}: the capped replacement did not land`);
      const settled = await settle(label, accrued);
      if (settled.landed_tx_id !== attempts[4].tx_id)
        throw new Error(`${label}: the landed replacement was not recorded`);
      console.log(
        `${label}: ${attempts.length} replacements up to maxFeePerGas ${last.max} (3x ${original.max}); then waiting; one claim of ${accrued}`,
      );
    }

    // 8d. A run stops after it journals a replacement and before the
    // replacement reaches the node. The next run sends the same bytes.
    if (faults[0] === "bump-restart") {
      const label = "8d restart mid-replacement";
      const { claim, original, accrued } = await stall(label);
      await mineAtBaseFee(original.max + 1n);
      const lostSend = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const body = typeof init?.body === "string" ? init.body : "";
        if (body.includes('"eth_sendRawTransaction"'))
          throw new Error("local replacement send interrupted");
        return fetch(input, init);
      }) as typeof fetch;
      await runOnce(env, at(4 * 60 * 1000), { fetch: lostSend }, "receipts");
      const [first] = replacementsOf(claim.id);
      const interrupted = latestClaim();
      if (
        !first ||
        (await inPool(first.tx_id)) ||
        interrupted.state !== "unknown" ||
        !interrupted.reason?.startsWith("replacement broadcast")
      )
        throw new Error(`${label}: the journaled replacement was not lost`);
      await runOnce(env, at(30 * 1000), undefined, "receipts");
      const after = replacementsOf(claim.id);
      if (
        after.length !== 1 ||
        after[0].raw_tx !== first.raw_tx ||
        !(await inPool(first.tx_id)) ||
        latestClaim().state !== "submitted"
      )
        throw new Error(
          `${label}: the restart did not resend the journaled bytes`,
        );
      await mineAtBaseFee(original.max - original.tip);
      const settled = await settle(label, accrued);
      if (settled.landed_tx_id !== first.tx_id)
        throw new Error(`${label}: the landed replacement was not recorded`);
      console.log(
        `${label}: journaled replacement ${first.tx_id} resent unchanged and landed; one claim of ${accrued}`,
      );
    }

    // 8e. A load-balanced RPC lost a stuck claim, so the node reports its
    // nonce as free. A send for another token must not take that nonce: the
    // two would outbid each other through their replacements.
    if (faults[0] === "bump-nonce") {
      const label = "8e nonce held by an open send";
      const WETH = "0x4200000000000000000000000000000000000006";
      const { claim, original, accrued } = await stall(label);
      await rpc("anvil_dropTransaction", [claim.tx_id]);
      await rpc("evm_setAutomine", [true]);
      const nonceAt = async (tag: string) =>
        Number(await rpc("eth_getTransactionCount", [wallet, tag]));
      if ((await nonceAt("pending")) !== original.nonce)
        throw new Error(`${label}: the node still holds the claim`);
      // WETH9 keeps balanceOf in slot 3. Funding by storage uses no nonce.
      await rpc("anvil_setStorageAt", [
        WETH,
        keccak256(
          encodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }],
            [wallet as Hex, 3n],
          ),
        ),
        `0x${(10n ** 16n).toString(16).padStart(64, "0")}`,
      ]);
      if ((await balanceOf(WETH, wallet)) !== 10n ** 16n)
        throw new Error(`${label}: WETH was not funded`);
      // The same RPC also refuses the claim's rebroadcast in this run.
      const lostClaim = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const body = typeof init?.body === "string" ? init.body : "";
        if (
          body.includes('"eth_sendRawTransaction"') &&
          body.includes(claim.raw_tx)
        )
          throw new Error("local claim rebroadcast lost");
        return fetch(input, init);
      }) as typeof fetch;
      const wethEnv = {
        ...env,
        FEE_CONVERTER_ALLOWLIST: JSON.stringify({
          base: [AERO, UNROUTED, WETH],
        }),
      };
      await runOnce(wethEnv, at(30 * 1000), { fetch: lostClaim }, "receipts");
      const weth = state(WETH);
      if (
        weth.state !== "failed" ||
        !weth.reason?.includes(
          `nonce ${original.nonce} is held by an open journaled send`,
        ) ||
        (await nonceAt("latest")) !== original.nonce ||
        (await nonceAt("pending")) !== original.nonce ||
        latestClaim().state !== "unknown"
      )
        throw new Error(
          `${label}: a new send took nonce ${original.nonce}: ${JSON.stringify(weth)}`,
        );
      console.log(
        `${label}: WETH conversion refused before signing (${weth.reason})`,
      );
      // The next run sends the claim's journaled bytes; it lands on its nonce.
      await runOnce(wethEnv, at(30 * 1000), undefined, "receipts");
      if (!(await receiptOf(claim.tx_id)))
        throw new Error(`${label}: the claim did not land on its nonce`);
      const settled = await settle(label, accrued);
      if (settled.landed_tx_id !== claim.tx_id)
        throw new Error(`${label}: the landed claim was not recorded`);
      console.log(
        `${label}: claim ${claim.tx_id} kept nonce ${original.nonce} and landed; one claim of ${accrued}`,
      );
    }

    const claims = sqlite
      .query(
        "SELECT state FROM fee_conversions WHERE kind = 'claim' ORDER BY rowid",
      )
      .all() as { state: string }[];
    if (
      claims.length !== claimsBefore + 1 ||
      claims.slice(claimsBefore).some((claim) => claim.state !== "finalized")
    )
      throw new Error("the replacement case did not record one claim");
    if (
      (await view(vault, "freeBalance")) !== freeBeforeClaim ||
      ((await view(vault, "reservedPrincipal")) as bigint) +
        ((await view(vault, "reservedFees")) as bigint) !==
        reserved
    )
      throw new Error("replacement cases changed principal or reserved awards");
    console.log(`PASS: Base fork same-nonce fee replacement: ${faults[0]}`);
  }

  if (faults[0] === "receipt-role") {
    let changed = false;
    const changeBeforeSend: typeof fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (!changed && body.includes('"eth_sendRawTransaction"')) {
        changed = true;
        await call(
          registrar,
          factory,
          encodeFunctionData({
            abi: vaultAbi,
            functionName: "proposeIdentityAuthority",
            args: [wallet as Hex],
          }),
        );
        await call(
          registrar,
          factory,
          encodeFunctionData({
            abi: vaultAbi,
            functionName: "executeIdentityAuthorityRotation",
          }),
        );
      }
      return fetch(input, init);
    }) as typeof fetch;
    await runOnce(env, undefined, { fetch: changeBeforeSend });
    if (!changed)
      throw new Error("Fixture did not exercise the pre-broadcast change");
    await rpc("anvil_mine", ["0x80"]);
    await runOnce(env, undefined, undefined, "receipts");
    const rows = sqlite
      .query<{ kind: string; state: string; amount_out: string | null }, []>(
        "SELECT kind,state,amount_out FROM fee_conversions ORDER BY rowid",
      )
      .all();
    const claims = rows.filter((row) => row.kind === "claim");
    const conversions = rows.filter((row) => row.kind === "conversion");
    console.log(
      JSON.stringify({
        check: "receipt-time role verification",
        changed,
        rows,
      }),
    );
    if (
      claims.length !== 1 ||
      claims[0].state === "finalized" ||
      conversions.length !== 0
    )
      throw new Error(
        "Receipt-time role change was accepted and allowed conversion",
      );
    console.log(
      "PASS: receipt-time role change remains unresolved without conversion",
    );
  }

  if (faults[0] === "finalized-role") {
    // A live recovery run claims the fee into the fee wallet and sells it.
    const usdcBeforeClaim = await balanceOf(USDC, wallet);
    const [claimRun] = await runOnce(env);
    console.log("7 run:", JSON.stringify(claimRun));
    if (claimRun.claimed !== 1 || (await view(vault, "accruedFees")) !== 0n)
      throw new Error("7 the live run did not claim the accrued fee");
    // A later role change stops new claims, but cannot invalidate an earlier
    // receipt whose deployment and roles were valid at its own block.
    await call(
      registrar,
      factory,
      encodeFunctionData({
        abi: vaultAbi,
        functionName: "proposeIdentityAuthority",
        args: [wallet as Hex],
      }),
    );
    await call(
      registrar,
      factory,
      encodeFunctionData({
        abi: vaultAbi,
        functionName: "executeIdentityAuthorityRotation",
      }),
    );
    let newClaimRefused = false;
    try {
      await feeClient.accrued((await projectVaults(db, ["base-mainnet"]))[0]);
    } catch (error) {
      newClaimRefused = String(error).includes("vault role");
    }
    if (!newClaimRefused)
      throw new Error("new claims ignored a later fee-wallet role");
    await rpc("anvil_mine", ["0x80"]);
    await runOnce(env, undefined, undefined, "receipts");
    await finishApproval();
    expect(state(), "submitted", "7 claimed fee send");
    const claimedRow = sqlite
      .query(
        "SELECT amount_in, token_balance_before FROM fee_conversions WHERE token = ? AND kind = 'conversion' ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(AERO) as { amount_in: string; token_balance_before: string };
    if (claimedRow.token_balance_before !== (aeroBeforeClaim + fee).toString())
      throw new Error("7 the conversion did not see the claimed fee");
    await rpc("anvil_mine", ["0x80"]);
    await runOnce(env);
    expect(state(), "finalized", "7 after reconcile");
    const settledClaim = sqlite
      .query(
        "SELECT amount_out FROM fee_conversions WHERE token = ? AND kind = 'conversion' ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(AERO) as { amount_out: string };
    const usdcReceived = (await balanceOf(USDC, wallet)) - usdcBeforeClaim;
    if (usdcReceived <= 0n || BigInt(settledClaim.amount_out) !== usdcReceived)
      throw new Error("7 the conversion receipt differs from received USDC");
    console.log(`7 received and recorded ${usdcReceived} USDC minor units`);
    if ((await balanceOf(AERO, wallet)) !== 0n)
      throw new Error("7 the claimed fee was not sold");
    if (
      (await view(vault, "freeBalance")) !== freeBeforeClaim ||
      ((await view(vault, "reservedPrincipal")) as bigint) +
        ((await view(vault, "reservedFees")) as bigint) !==
        reserved ||
      (await balanceOf(AERO, vault)) !== 300n * 10n ** 18n
    )
      throw new Error("claim changed principal or reserved awards");
    // Nothing is left to claim, so a further run sends no claim.
    const [after] = await runOnce(env);
    if (after.claimed !== 0) throw new Error("7 a repeat run claimed again");
    const response = await handleFeeConversionsApi(
      new Request("http://localhost/api/v1/admin/fee-conversions"),
      {
        db,
        adminGithubIds: new Set(["1"]),
        sessionActor: async () => ({ githubId: "1" }),
      },
    );
    const report = (await response?.json()) as {
      recent: { txId: string | null }[];
      totals: { token: string; amountOut: string }[];
    };
    const claimIds = (
      sqlite
        .query("SELECT tx_id FROM fee_conversions WHERE kind = 'claim'")
        .all() as { tx_id: string }[]
    ).map((row) => row.tx_id);
    const recordedProceeds = (
      sqlite
        .query(
          "SELECT amount_out FROM fee_conversions WHERE kind = 'conversion' AND state = 'finalized'",
        )
        .all() as { amount_out: string }[]
    ).reduce((sum, row) => sum + BigInt(row.amount_out), 0n);
    if (
      response?.status !== 200 ||
      report.recent.some(
        (row) => row.txId !== null && claimIds.includes(row.txId),
      ) ||
      report.totals.find((total) => total.token === AERO)?.amountOut !==
        recordedProceeds.toString()
    )
      throw new Error(
        "admin conversion report included a claim or incorrect proceeds",
      );

    console.log(
      claimOnly
        ? "PASS: Base fork fee claim, deployment refusals, reviewed upgrade, principal preservation and conversion"
        : "PASS: Base fork live cycles (ordinary, lost send, lost response, below minimum, slippage refusal, unsupported route, verified vault fee claim)",
    );
  } else if (!faults[0].startsWith("bump-")) {
    console.log(
      `PASS: ${local ? "Local EVM fixture" : "Base fork"} ${faults[0]} claim recovery and principal preservation`,
    );
  }
  if (local && faults[0] === "before") {
    // A native reward uses zero only as the recorded asset identity. The
    // claim moves ETH and the router receives exact msg.value, with no ERC-20
    // balance, allowance or transfer call to the sentinel.
    const nativeProject = keccak256(
      new TextEncoder().encode("native-fee-local"),
    );
    await call(
      registrar,
      factory,
      encodeFunctionData({
        abi: vaultAbi,
        functionName: "create",
        args: [nativeProject, NATIVE_ASSET, 0],
      }),
    );
    const nativeKey = await view(factory, "vaultKey", [
      registrar,
      nativeProject,
      NATIVE_ASSET,
      0,
    ]);
    const nativeVault = (
      (await view(factory, "vaults", [nativeKey])) as unknown as string
    ).toLowerCase();
    const nativeImplementation = await implementation(nativeVault);
    save(
      {
        ...deployment,
        vault: nativeVault,
        asset: NATIVE_ASSET,
        codeSha256: await runtimeDigest(nativeVault),
        evmUpgrade: {
          ...deployment.evmUpgrade,
          vaultImplementation: nativeImplementation,
          vaultImplementationCodeSha256:
            await runtimeDigest(nativeImplementation),
        },
      },
      false,
    );
    await rpc("anvil_mine", ["0x80"]);
    const nativeEnv = {
      ...env,
      FEE_CONVERTER_ALLOWLIST: JSON.stringify({ base: [NATIVE_ASSET] }),
    };
    const nativeConversions = () =>
      sqlite
        .query(
          "SELECT * FROM fee_conversions WHERE token=? AND kind='conversion' ORDER BY rowid",
        )
        .all(NATIVE_ASSET) as {
        state: string;
        amount_in: string;
        amount_out: string | null;
        approval_tx_id: string | null;
        raw_tx: string;
      }[];
    await runOnce(nativeEnv);
    assert.equal(
      nativeConversions().length,
      0,
      "a gas top-up is not native fee revenue",
    );

    const nativeDeposit = 2n * 10n ** 18n;
    const nativeWithdrawal = 10n ** 18n;
    await call(
      registrar,
      nativeVault,
      encodeFunctionData({
        abi: vaultAbi,
        functionName: "deposit",
        args: [nativeDeposit],
      }),
      nativeDeposit,
    );
    await call(
      registrar,
      nativeVault,
      encodeFunctionData({
        abi: vaultAbi,
        functionName: "withdrawUnused",
        args: [nativeWithdrawal],
      }),
    );
    const nativeFee = nativeWithdrawal / 50n;
    assert.equal(await view(nativeVault, "accruedFees"), nativeFee);
    const nativePrincipal = await view(nativeVault, "freeBalance");
    const beforeNativeUsdc = await balanceOf(USDC, wallet);
    const [nativeClaimRun] = await runOnce(nativeEnv);
    assert.equal(nativeClaimRun.claimed, 1);
    assert.equal(
      nativeConversions().length,
      0,
      "native claim must finalize before conversion",
    );
    await rpc("anvil_mine", ["0x80"]);
    await runOnce(nativeEnv);
    const [sentNative] = nativeConversions();
    assert.equal(sentNative?.state, "submitted");
    assert.equal(
      sentNative.approval_tx_id,
      null,
      "native conversion needs no token approval",
    );
    const nativeInput = BigInt(sentNative.amount_in);
    assert(
      nativeInput > 0n && nativeInput < nativeFee - 10n ** 16n,
      "earned fees retain the next gas reserve",
    );
    const nativeWire = parseTransaction(sentNative.raw_tx as Hex);
    assert.equal(nativeWire.value, nativeInput);
    assert.equal(nativeWire.to?.toLowerCase(), ROUTER.toLowerCase());
    await rpc("anvil_mine", ["0x80"]);
    await runOnce(nativeEnv);
    const [settledNative] = nativeConversions();
    assert.equal(settledNative.state, "finalized");
    assert.equal(
      BigInt(settledNative.amount_out as string),
      nativeInput / 1_000_000_000n,
    );
    assert.equal(
      (await balanceOf(USDC, wallet)) - beforeNativeUsdc,
      BigInt(settledNative.amount_out as string),
    );
    const nativeClaim = sqlite
      .query(
        "SELECT state,amount_out FROM fee_conversions WHERE token=? AND kind='claim'",
      )
      .get(NATIVE_ASSET) as { state: string; amount_out: string };
    assert.equal(nativeClaim.state, "finalized");
    assert.equal(BigInt(nativeClaim.amount_out), nativeFee);
    assert.equal(await view(nativeVault, "accruedFees"), 0n);
    assert.equal(await view(nativeVault, "freeBalance"), nativePrincipal);
    const remainingNativeFees = await new D1ConversionStore(
      db,
    ).nativeFeeBalance("base", NATIVE_ASSET, wallet);
    assert(remainingNativeFees >= 0n && remainingNativeFees < 10n ** 16n);
    await runOnce(nativeEnv);
    assert.equal(
      nativeConversions().length,
      1,
      "repeat run cannot sweep wallet gas or replay native fees",
    );
    console.log(
      JSON.stringify({
        check:
          "native ETH claim and exact-value conversion preserves principal and gas topups",
        earnedWei: nativeFee.toString(),
        soldWei: nativeInput.toString(),
        retainedWei: remainingNativeFees.toString(),
        usdcMicro: settledNative.amount_out,
      }),
    );
  }
  const nativeRows = sqlite
    .query<
      {
        tx_id: string;
        maximum_wei: string;
        actual_wei: string | null;
        state: string;
      },
      []
    >(
      "SELECT tx_id,maximum_wei,actual_wei,state FROM fee_native_gas WHERE state='signed'",
    )
    .all();
  // A claim-only lease takeover proves refusal before signing. It must not
  // manufacture a canonical receipt merely to satisfy the gas-cost oracle.
  const refusedBeforeSigning = claimOnly && faults[0] === "lease";
  if (refusedBeforeSigning) assert.equal(nativeRows.length, 0);
  else
    assert(nativeRows.length > 0, "actual sends must have native gas records");
  let verifiedCosts = 0;
  for (const cost of nativeRows) {
    if (cost.actual_wei === null || cost.actual_wei === "0") continue;
    const receipt = (await rpc("eth_getTransactionReceipt", [cost.tx_id])) as {
      gasUsed: string;
      effectiveGasPrice: string;
      l1Fee?: string;
    } | null;
    assert(receipt, "settled gas needs its actual receipt");
    if (local)
      assert.equal(
        BigInt(cost.actual_wei),
        BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice),
      );
    assert(BigInt(cost.actual_wei) <= BigInt(cost.maximum_wei));
    verifiedCosts++;
  }
  if (refusedBeforeSigning) assert.equal(verifiedCosts, 0);
  else
    assert(
      verifiedCosts > 0,
      "at least one canonical finalized native cost must reconcile",
    );
  console.log(
    JSON.stringify({
      check: "native fee journal reconciles actual local receipts",
      signed: nativeRows.length,
      verifiedCosts,
      localBaseAdditionalFees: local
        ? "zero by explicit local oracle and receipt overlay"
        : "real provider",
    }),
  );
} finally {
  await cleanup();
}
async function cleanup() {
  anvil.kill();
  await anvil.exited;
  globalThis.fetch = nativeFetch;
  closeJournal();
  rmSync(journalDirectory, { recursive: true, force: true });
}
