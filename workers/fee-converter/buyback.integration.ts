// SLOP buyback end to end on local Anvil forks of Base, Ethereum and Robinhood
// Chain, with a throwaway key (PRD section 6, "SLOP buyback and burn").
// Usage: bun workers/fee-converter/buyback.integration.ts
//
// It runs the real Worker entry point (runOnce), chain client, migrated
// SQLite journal and native-gas budget against the deployed contracts as
// forked: Circle USDC, deBridge DlnSource and DlnDestination, the KyberSwap
// router, the Uniswap v4 SLOP pools and the SLOP token itself. KyberSwap and
// deBridge answer live, read-only API calls. Every signed transaction goes
// only to a local fork; nothing reaches a public network.
//
// After the main cycle, a second Base order is cancelled instead of filled:
// the fee wallet sends the cancellation through the real DlnDestination, and
// the real DlnSource pays the refund. Only the message transport between the
// two chains is replaced, by a stub at deBridge's CallProxy address
// (contracts/evm/test/BuybackFixture.sol). This part needs `forge` on PATH.
//
// Two things stand in for parties this harness cannot be:
//   - Fee income is seeded as finalized journal rows (its derivation is
//     covered by buyback.test.ts and the conversion fork test). Each seeded
//     row carries a real signed zero-value fork transaction of the fee
//     wallet, so the native-gas journal reconciles it like any recorded send.
//   - The order fill is sent by the impersonated deBridge taker through the
//     real DlnDestination on the Robinhood fork.
// Local results do not qualify a production deployment or a live fill.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  type Address,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  BURN_ADDRESS,
  DLN,
  ROBINHOOD_USDG,
  SLOP_TOKEN,
} from "./buyback-config";
import { NETWORK_DEFINITIONS } from "./config";
import { DLN_DESTINATION_ABI, DLN_SOURCE_ABI } from "./debridge";
import { runOnce } from "./index";

type Evm = "base" | "ethereum" | "robinhood";
const PORT = Number(process.env.SLOP_TEST_BUYBACK_PORT ?? 28651);
const CHAINS: Record<Evm, { fork: string; port: number }> = {
  base: {
    fork: process.env.BASE_FORK_URL ?? "https://mainnet.base.org",
    port: PORT,
  },
  ethereum: {
    fork:
      process.env.ETHEREUM_FORK_URL ?? "https://ethereum-rpc.publicnode.com",
    port: PORT + 1,
  },
  robinhood: {
    fork:
      process.env.ROBINHOOD_FORK_URL ??
      "https://rpc.mainnet.chain.robinhood.com",
    port: PORT + 2,
  },
};
const SOURCES = (process.env.SLOP_TEST_BUYBACK_SOURCES ?? "base,ethereum")
  .split(",")
  .filter(Boolean) as ("base" | "ethereum")[];
/** USDC fee income seeded per source network, and the USDG fee on Robinhood. */
const SOURCE_FEES = 1_000_000_001n;
const ROBINHOOD_FEES = 200_000_000n;
/** The Umia launch contract holds USDG; it funds the fixtures on the fork. */
const USDG_HOLDER = "0x96028de971a9d37404f5030f6284b40640e2d1a2";
const TAKER = DLN.allowedTakers[0] as Address;
/** USDC placed in the wallet: Base also holds the later, cancelled order's fees. */
const funded = (chain: Evm) =>
  chain === "base" ? 2n * SOURCE_FEES : SOURCE_FEES;

const url = (chain: Evm) => `http://127.0.0.1:${CHAINS[chain].port}`;
// Anvil charges no Base data fee and its receipts carry no `l1Fee`. The cost
// reconciliation requires that field, so the fork reports the zero it charged.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await nativeFetch(input, init);
  const target = input instanceof Request ? input.url : String(input);
  if (
    new URL(target).origin !== url("base") ||
    typeof init?.body !== "string" ||
    JSON.parse(init.body).method !== "eth_getTransactionReceipt"
  )
    return response;
  const result = await response.clone().json();
  if (!result.result || result.result.l1Fee !== undefined) return response;
  result.result.l1Fee = "0x0";
  return Response.json(result);
}) as typeof fetch;
async function rpc(chain: Evm, method: string, params: unknown[]) {
  const response = await fetch(url(chain), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: unknown };
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
const client = (chain: Evm) =>
  createPublicClient({ transport: http(url(chain)) });
const balanceOf = (chain: Evm, token: string, owner: string) =>
  client(chain).readContract({
    address: token as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner as Address],
  });
/**
 * Anvil finalizes a block two epochs behind the head. The forks run with
 * one-slot epochs, so a few blocks finalize a send; mining hundreds per round
 * makes Anvil evict the older states the Worker's receipt checks read.
 */
const finalize = async () => {
  for (const chain of Object.keys(CHAINS) as Evm[])
    if (chain === "robinhood" || SOURCES.includes(chain))
      await rpc(chain, "anvil_mine", ["0x4"]);
};
async function impersonated(
  chain: Evm,
  from: string,
  to: string,
  data: Hex,
): Promise<Hex> {
  await rpc(chain, "anvil_impersonateAccount", [from]);
  await rpc(chain, "anvil_setBalance", [from, "0xde0b6b3a7640000"]);
  const hash = (await rpc(chain, "eth_sendTransaction", [
    { from, to, data },
  ])) as Hex;
  await rpc(chain, "anvil_stopImpersonatingAccount", [from]);
  const receipt = await client(chain).waitForTransactionReceipt({
    hash,
    pollingInterval: 200,
    timeout: 30_000,
  });
  assert.equal(receipt.status, "success", `${chain} fixture transaction`);
  return hash;
}

const processes: ReturnType<typeof Bun.spawn>[] = [];
async function cleanup() {
  for (const child of processes) child.kill();
}
process.on("SIGINT", () => void cleanup().then(() => process.exit(130)));

try {
  for (const chain of ["robinhood", ...SOURCES] as Evm[]) {
    processes.push(
      Bun.spawn(
        [
          "anvil",
          "--fork-url",
          CHAINS[chain].fork,
          "--port",
          String(CHAINS[chain].port),
          "--slots-in-an-epoch",
          "1",
          "--silent",
        ],
        { stdout: "ignore", stderr: "inherit" },
      ),
    );
    for (let i = 0; ; i++) {
      try {
        const id = Number(await rpc(chain, "eth_chainId", []));
        assert.equal(id, NETWORK_DEFINITIONS[chain].chainId, `${chain} id`);
        break;
      } catch (error) {
        if (i > 120) throw new Error(`anvil ${chain} did not start: ${error}`);
        await Bun.sleep(500);
      }
    }
  }

  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const wallet = account.address.toLowerCase();
  console.log(`throwaway fee wallet ${wallet}`);
  const { db, sqlite } = sqliteD1();
  let seeded = 0;
  /** A finalized live journal row: fee income that already happened. */
  const earn = async (
    network: Evm,
    kind: "conversion" | "claim",
    token: string,
    target: string,
    amount: bigint,
  ) => {
    seeded += 1;
    const chain = client(network);
    const nonce = await chain.getTransactionCount({
      address: wallet as Address,
    });
    const fees = await chain.estimateFeesPerGas();
    const raw = await account.signTransaction({
      chainId: NETWORK_DEFINITIONS[network].chainId as number,
      type: "eip1559",
      to: wallet as Address,
      value: 0n,
      nonce,
      gas: 21_000n,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    const hash = await chain.sendRawTransaction({ serializedTransaction: raw });
    await chain.waitForTransactionReceipt({
      hash,
      pollingInterval: 200,
      timeout: 30_000,
    });
    const at = new Date(Date.now() - 60_000).toISOString();
    sqlite
      .query(
        `INSERT INTO fee_conversions (kind, id, run_id, network, mode, fee_wallet, token,
           target_token, amount_in, min_amount_out, tx_id, raw_tx, evm_nonce, expires_at,
           amount_out, state, created_at, updated_at, submitted_at, finalized_at)
         VALUES (?, ?, 'seed-run-1', ?, 'live', ?, ?, ?, ?, '1', ?, ?, ?, 1, ?,
           'finalized', ?, ?, ?, ?)`,
      )
      .run(
        kind,
        `seed-${String(seeded).padStart(6, "0")}`,
        network,
        wallet,
        token,
        target,
        amount.toString(),
        hash,
        raw,
        nonce,
        amount.toString(),
        at,
        at,
        at,
        at,
      );
  };

  for (const chain of SOURCES) {
    const usdc = NETWORK_DEFINITIONS[chain].usdc as string;
    await rpc(chain, "anvil_setBalance", [wallet, "0xde0b6b3a7640000"]);
    // Circle FiatToken keeps balances in mapping slot 9.
    const slot = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [wallet as Address, 9n],
      ),
    );
    // Base is funded once for both its fee receipts: a later storage write
    // would cost the fork its historical reads of this token.
    await rpc(chain, "anvil_setStorageAt", [
      usdc,
      slot,
      `0x${funded(chain).toString(16).padStart(64, "0")}`,
    ]);
    assert.equal(await balanceOf(chain, usdc, wallet), funded(chain));
    // The USDC this network's fees became; an odd unit proves the floor.
    await earn(
      chain,
      "conversion",
      "0x1111111111111111111111111111111111111111",
      usdc,
      SOURCE_FEES,
    );
  }
  await rpc("robinhood", "anvil_setBalance", [wallet, "0xde0b6b3a7640000"]);
  await impersonated(
    "robinhood",
    USDG_HOLDER,
    ROBINHOOD_USDG,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [wallet as Address, ROBINHOOD_FEES],
    }),
  );
  await earn(
    "robinhood",
    "claim",
    ROBINHOOD_USDG,
    ROBINHOOD_USDG,
    ROBINHOOD_FEES,
  );
  await finalize();
  const deadBefore = await balanceOf("robinhood", SLOP_TOKEN, BURN_ADDRESS);
  const supplyBefore = await client("robinhood").readContract({
    address: SLOP_TOKEN as Address,
    abi: erc20Abi,
    functionName: "totalSupply",
  });

  const env = {
    FEE_DB: db,
    FEE_CONVERTER_MODE: "live",
    FEE_CONVERTER_NETWORKS: [...SOURCES, "robinhood"].join(","),
    FEE_WALLET_BASE: wallet,
    FEE_WALLET_ETHEREUM: wallet,
    FEE_WALLET_ROBINHOOD: wallet,
    FEE_WALLET_KEY_BASE: key,
    FEE_WALLET_KEY_ETHEREUM: key,
    FEE_WALLET_KEY_ROBINHOOD: key,
    RPC_URL_BASE: url("base"),
    RPC_URL_ETHEREUM: url("ethereum"),
    RPC_URL_ROBINHOOD: url("robinhood"),
    // The conversion limits of the reviewed wrangler.toml.
    FEE_CONVERTER_MIN_VALUE_MICRO: "5000000",
    FEE_CONVERTER_GAS_MULTIPLE: "10",
    FEE_CONVERTER_MAX_SLIPPAGE_BPS: "100",
    FEE_CONVERTER_MAX_PRICE_IMPACT_BPS: "200",
    FEE_CONVERTER_RUN_CAP_MICRO: "1000000000",
    FEE_CONVERTER_DAILY_CAP_MICRO: "5000000000",
    // Harness limits for local forks only, as in fork.integration.ts: Anvil
    // suggests a 1 gwei priority fee, far above these networks' real fees.
    // Production limits come from the reviewed wrangler.toml.
    FEE_CONVERTER_NATIVE_BUDGETS: JSON.stringify(
      Object.fromEntries(
        [...SOURCES, "robinhood"].map((chain) => [
          chain,
          {
            perTransaction: "10000000000000000",
            perDay: "100000000000000000",
            additionalFeeReserve: chain === "base" ? "1000000000000" : "0",
          },
        ]),
      ),
    ),
    BUYBACK_MODE: "live",
    BUYBACK_START_AT: new Date(Date.now() - 3_600_000).toISOString(),
    BUYBACK_SHARE_BPS: "5000",
    BUYBACK_BURN_BPS: "5000",
    BUYBACK_MIN_BRIDGE_MICRO: "250000000",
    BUYBACK_MAX_BRIDGE_COST_BPS: "200",
    BUYBACK_MAX_BRIDGE_NATIVE_FEE: JSON.stringify({
      base: "1000000000000000",
      ethereum: "1000000000000000",
    }),
    BUYBACK_MIN_BUY_MICRO: "25000000",
    BUYBACK_MIN_BURN_MICRO: "1000000",
    // Fork only: KyberSwap quotes the live pools while each fork holds the
    // state of the block it started at, and SLOP moves several percent in
    // minutes. A wide tolerance keeps that drift from failing the harness;
    // the signed minimum is still enforced by the forked router.
    BUYBACK_MAX_SLIPPAGE_BPS:
      process.env.SLOP_TEST_BUYBACK_SLIPPAGE_BPS ?? "3000",
    BUYBACK_MAX_PRICE_IMPACT_BPS: "1000",
    BUYBACK_RUN_CAP_MICRO: "2000000000",
    BUYBACK_DAILY_CAP_MICRO: "5000000000",
    BUYBACK_UNFILLED_ALERT_SECONDS: "3600",
  };
  const rows = (where: string) =>
    sqlite
      .query(`SELECT * FROM fee_conversions WHERE ${where} ORDER BY rowid`)
      .all() as Record<string, string | number | null>[];
  const round = async (label: string) => {
    const results = await runOnce(
      env as never,
      undefined,
      undefined,
      "recovery",
    );
    await finalize();
    console.log(
      `${label}: ${JSON.stringify(results.map((r) => [r.network, r.reconciled, r.buyback?.records, r.buyback?.arrived]))}`,
    );
    // A refused preparation signed nothing and is retried on a later scan
    // (a live provider can refuse one request). A signed send must not fail.
    const failed = rows(
      "state = 'failed' AND tx_id IS NOT NULL AND id NOT LIKE 'seed-%'",
    );
    assert.deepEqual(
      failed.map((row) => `${row.network} ${row.kind}: ${row.reason}`),
      [],
      "no signed send may fail in the ordinary flow",
    );
    // Keep the live, keyless provider APIs under their request limits.
    await Bun.sleep(3_000);
    return results;
  };

  /**
   * Runs scans until `done` holds. A live quote can be refused for one scan
   * (a provider answer or a moved price); the Worker records that and tries
   * again, so the harness waits for the outcome instead of counting scans.
   */
  const until = async (label: string, done: () => boolean, limit = 12) => {
    for (let scan = 1; scan <= limit; scan++) {
      await round(`${label} ${scan}`);
      if (done()) return;
    }
    throw new Error(`${label}: not reached in ${limit} scans`);
  };
  /** Sends of one kind that were signed, in journal order. */
  const signed = (where: string) => rows(`${where} AND tx_id IS NOT NULL`);
  const settled = (where: string) =>
    signed(where).length > 0 &&
    signed(where).every((row) => row.state === "finalized");

  // 1. Exact approvals: USDC to the pinned bridge, the USDG fee share to the
  // pinned router. Nothing else is signed.
  await round("1 approvals");
  for (const chain of SOURCES) {
    const [approval] = rows(`network = '${chain}' AND kind = 'approval'`);
    assert.equal(approval.route, "debridge");
    assert.equal(approval.amount_in, (SOURCE_FEES / 2n).toString());
    assert.equal(
      await client(chain).readContract({
        address: NETWORK_DEFINITIONS[chain].usdc as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet as Address, DLN.source as Address],
      }),
      SOURCE_FEES / 2n,
      "the bridge allowance is exactly the order amount",
    );
  }
  assert.equal(
    rows("network = 'robinhood' AND kind = 'approval'")[0].amount_in,
    (ROBINHOOD_FEES / 2n).toString(),
  );
  console.log("PASS: exact approvals to the pinned bridge and router only");

  // 2-3. Orders on the real DlnSource finalize; so does the fee-share
  // purchase on Robinhood.
  await until(
    "2 orders and first purchase",
    () =>
      SOURCES.every((chain) =>
        settled(`network = '${chain}' AND kind = 'bridge'`),
      ) && settled("kind = 'buyback'"),
  );
  const orders: { chain: "base" | "ethereum"; orderId: Hex; take: bigint }[] =
    [];
  for (const chain of SOURCES) {
    const [deposit] = rows(`network = '${chain}' AND kind = 'bridge'`);
    assert.equal(deposit.state, "finalized", `${chain} deposit`);
    assert.equal(deposit.amount_in, (SOURCE_FEES / 2n).toString());
    assert.equal(deposit.amount_out, deposit.amount_in);
    const terms = JSON.parse(deposit.quote as string);
    assert.equal(terms.receiver, wallet);
    assert.equal(terms.takeToken, ROBINHOOD_USDG);
    const usdc = NETWORK_DEFINITIONS[chain].usdc as string;
    assert.equal(
      await balanceOf(chain, usdc, wallet),
      funded(chain) - SOURCE_FEES / 2n,
      `${chain}: exactly the buyback half left the wallet`,
    );
    const [status, , , , , giveAmount] = await client(chain).readContract({
      address: DLN.source as Address,
      abi: DLN_SOURCE_ABI,
      functionName: "giveOrders",
      args: [terms.orderId],
    });
    assert.equal(status, 1, `${chain}: DlnSource holds the created order`);
    assert.ok(giveAmount > 0n && giveAmount <= SOURCE_FEES / 2n);
    orders.push({
      chain,
      orderId: terms.orderId,
      take: BigInt(terms.takeAmount),
    });
    console.log(
      `PASS: ${chain} bridged ${deposit.amount_in} USDC for ${terms.takeAmount} USDG, order ${terms.orderId}`,
    );
  }
  const [firstBuy] = signed("kind = 'buyback'");
  assert.equal(firstBuy.state, "finalized");
  assert.equal(firstBuy.amount_in, (ROBINHOOD_FEES / 2n).toString());
  const firstSlop = BigInt(firstBuy.amount_out as string);
  assert.ok(firstSlop >= BigInt(firstBuy.min_amount_out as string));
  assert.equal(
    await balanceOf("robinhood", ROBINHOOD_USDG, wallet),
    ROBINHOOD_FEES - ROBINHOOD_FEES / 2n,
    "the other half of the Robinhood fee stays unconverted",
  );
  console.log(
    `PASS: Robinhood fee share bought ${firstSlop} SLOP for ${firstBuy.amount_in} USDG; the rest is retained`,
  );

  // An unfilled order is never credited.
  assert.equal(
    (
      sqlite.query("SELECT COUNT(*) AS n FROM fee_bridge_outcomes").get() as {
        n: number;
      }
    ).n,
    0,
  );

  // 4. The deBridge taker fills each order through the real DlnDestination.
  for (const order of orders) {
    const [deposit] = rows(`network = '${order.chain}' AND kind = 'bridge'`);
    const receipt = await client(order.chain).getTransactionReceipt({
      hash: deposit.landed_tx_id as Hex,
    });
    const [created] = parseEventLogs({
      abi: DLN_SOURCE_ABI,
      eventName: "CreatedOrder",
      logs: receipt.logs,
    });
    assert.equal(created.args.orderId, order.orderId);
    await impersonated(
      "robinhood",
      USDG_HOLDER,
      ROBINHOOD_USDG,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [TAKER, order.take],
      }),
    );
    await impersonated(
      "robinhood",
      TAKER,
      ROBINHOOD_USDG,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [DLN.destination as Address, order.take],
      }),
    );
    await impersonated(
      "robinhood",
      TAKER,
      DLN.destination,
      encodeFunctionData({
        abi: parseAbi([
          "struct Order { uint64 makerOrderNonce; bytes makerSrc; uint256 giveChainId; bytes giveTokenAddress; uint256 giveAmount; uint256 takeChainId; bytes takeTokenAddress; uint256 takeAmount; bytes receiverDst; bytes givePatchAuthoritySrc; bytes orderAuthorityAddressDst; bytes allowedTakerDst; bytes allowedCancelBeneficiarySrc; bytes externalCall; }",
          "function fulfillOrder(Order _order, uint256 _fulFillAmount, bytes32 _orderId, bytes _permitEnvelope, address _unlockAuthority) payable",
        ]),
        functionName: "fulfillOrder",
        args: [created.args.order, order.take, order.orderId, "0x", TAKER],
      }),
    );
    const [status] = await client("robinhood").readContract({
      address: DLN.destination as Address,
      abi: DLN_DESTINATION_ABI,
      functionName: "takeOrders",
      args: [order.orderId],
    });
    assert.equal(status, 1, "DlnDestination marks the order fulfilled");
  }
  const arrivals = orders.reduce((sum, order) => sum + order.take, 0n);
  assert.equal(
    await balanceOf("robinhood", ROBINHOOD_USDG, wallet),
    ROBINHOOD_FEES - ROBINHOOD_FEES / 2n + arrivals,
    "each fill delivered exactly its take amount to the fee wallet",
  );
  await finalize();

  // 5-8. Arrivals are credited once, spent in full, and half of all SLOP burns.
  const acquiredNow = () =>
    signed("kind = 'buyback'").reduce(
      (sum, row) => sum + BigInt((row.amount_out as string | null) ?? "0"),
      0n,
    );
  const burnedNow = () =>
    signed("kind = 'burn' AND state = 'finalized'").reduce(
      (sum, row) => sum + BigInt(row.amount_in as string),
      0n,
    );
  await until(
    "4 arrivals, purchase and burn",
    () =>
      signed("kind = 'buyback'").length >= 2 &&
      settled("kind = 'buyback'") &&
      settled("kind = 'burn'") &&
      burnedNow() === acquiredNow() / 2n,
    16,
  );
  const outcomes = sqlite
    .query("SELECT outcome, amount FROM fee_bridge_outcomes ORDER BY rowid")
    .all() as { outcome: string; amount: string }[];
  assert.deepEqual(
    outcomes,
    orders.map((order) => ({
      outcome: "arrived",
      amount: order.take.toString(),
    })),
  );
  const buys = signed("kind = 'buyback'");
  assert.ok(buys.every((row) => row.state === "finalized"));
  assert.equal(
    buys.reduce((sum, row) => sum + BigInt(row.amount_in as string), 0n),
    ROBINHOOD_FEES / 2n + arrivals,
    "purchases spent exactly the fee share plus every arrival",
  );
  const acquired = buys.reduce(
    (sum, row) => sum + BigInt(row.amount_out as string),
    0n,
  );
  const burns = signed("kind = 'burn'");
  assert.ok(burns.every((row) => row.state === "finalized"));
  const burned = burns.reduce(
    (sum, row) => sum + BigInt(row.amount_in as string),
    0n,
  );
  assert.equal(burned, acquired / 2n, "exactly half of all acquired SLOP");
  assert.equal(
    (await balanceOf("robinhood", SLOP_TOKEN, BURN_ADDRESS)) - deadBefore,
    burned,
    "the burn address received exactly the burned amount",
  );
  assert.equal(
    await balanceOf("robinhood", SLOP_TOKEN, wallet),
    acquired - burned,
    "the retained SLOP stays in the fee wallet",
  );
  assert.equal(
    await balanceOf("robinhood", ROBINHOOD_USDG, wallet),
    ROBINHOOD_FEES - ROBINHOOD_FEES / 2n,
    "only the unconverted half of the Robinhood fee remains in USDG",
  );
  assert.equal(
    await client("robinhood").readContract({
      address: SLOP_TOKEN as Address,
      abi: erc20Abi,
      functionName: "totalSupply",
    }),
    supplyBefore,
    "a dead-address burn does not change totalSupply",
  );
  console.log(
    `PASS: bought ${acquired} SLOP, burned ${burned}, retained ${acquired - burned}`,
  );

  // A further scan with nothing new signs nothing.
  const before = rows("id NOT LIKE 'seed-%'").length;
  await round("10 idempotent");
  assert.equal(rows("id NOT LIKE 'seed-%'").length, before);
  // 11. An order nobody fills: the owner cancels it and the deposit is
  // refunded. The Worker never cancels; it only proves the refund and then
  // bridges that share again.
  if (SOURCES.includes("base")) {
    const base = NETWORK_DEFINITIONS.base.usdc as string;
    await earn(
      "base",
      "conversion",
      "0x1111111111111111111111111111111111111111",
      base,
      SOURCE_FEES,
    );
    await finalize();
    await until(
      "11 second order",
      () =>
        signed("network = 'base' AND kind = 'bridge'").length === 2 &&
        settled("network = 'base' AND kind = 'bridge'"),
    );
    const second = signed("network = 'base' AND kind = 'bridge'").at(-1);
    if (!second) throw new Error("second deposit is missing");
    // floor(2 x 1,000.000001 / 2) less the first 500 already bridged.
    assert.equal(second.amount_in, (SOURCE_FEES - SOURCE_FEES / 2n).toString());
    const terms = JSON.parse(second.quote as string);
    const receipt = await client("base").getTransactionReceipt({
      hash: second.landed_tx_id as Hex,
    });
    const [created] = parseEventLogs({
      abi: DLN_SOURCE_ABI,
      eventName: "CreatedOrder",
      logs: receipt.logs,
    });
    const cancelAbi = parseAbi([
      "struct Order { uint64 makerOrderNonce; bytes makerSrc; uint256 giveChainId; bytes giveTokenAddress; uint256 giveAmount; uint256 takeChainId; bytes takeTokenAddress; uint256 takeAmount; bytes receiverDst; bytes givePatchAuthoritySrc; bytes orderAuthorityAddressDst; bytes allowedTakerDst; bytes allowedCancelBeneficiarySrc; bytes externalCall; }",
      "function sendEvmOrderCancel(Order _order, address _cancelBeneficiary, uint256 _executionFee) payable",
      "function claimCancel(bytes32 _orderId, address _beneficiary)",
      "function deBridgeGate() view returns (address)",
      "function callProxy() view returns (address)",
      "function globalFixedNativeFee() view returns (uint256)",
    ]);
    // The order pins its refund to the source fee wallet: another
    // beneficiary is refused by the real contract.
    const cancel = (beneficiary: string) =>
      encodeFunctionData({
        abi: cancelAbi,
        functionName: "sendEvmOrderCancel",
        args: [created.args.order, beneficiary as Address, 0n],
      });
    const robinhood = client("robinhood");
    const gate = await robinhood.readContract({
      address: DLN.destination as Address,
      abi: cancelAbi,
      functionName: "deBridgeGate",
    });
    const messageFee = await robinhood.readContract({
      address: gate,
      abi: cancelAbi,
      functionName: "globalFixedNativeFee",
    });
    await assert.rejects(
      robinhood.call({
        account: wallet as Address,
        to: DLN.destination as Address,
        data: cancel(TAKER),
        value: messageFee,
      }),
      "a refund to another address is refused",
    );
    // The fee wallet is the order authority, so it alone can cancel.
    const fees = await robinhood.estimateFeesPerGas();
    const cancelGas = await robinhood.estimateGas({
      account: wallet as Address,
      to: DLN.destination as Address,
      data: cancel(wallet),
      value: messageFee,
    });
    const cancelHash = await robinhood.sendRawTransaction({
      serializedTransaction: await account.signTransaction({
        chainId: NETWORK_DEFINITIONS.robinhood.chainId as number,
        type: "eip1559",
        to: DLN.destination as Address,
        data: cancel(wallet),
        value: messageFee,
        nonce: await robinhood.getTransactionCount({
          address: wallet as Address,
        }),
        gas: (cancelGas * 13n) / 10n,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      }),
    });
    const cancelled = await robinhood.waitForTransactionReceipt({
      hash: cancelHash,
      pollingInterval: 200,
      timeout: 30_000,
    });
    assert.equal(cancelled.status, "success", "owner cancellation");
    await finalize();
    const before = (
      sqlite.query("SELECT COUNT(*) AS n FROM fee_bridge_outcomes").get() as {
        n: number;
      }
    ).n;
    // A cancellation in flight is neither an arrival nor yet a refund.
    await round("14 cancelling");
    assert.equal(
      (
        sqlite.query("SELECT COUNT(*) AS n FROM fee_bridge_outcomes").get() as {
          n: number;
        }
      ).n,
      before,
      "nothing is credited or released while the cancellation is in flight",
    );
    assert.equal(signed("network = 'base' AND kind = 'bridge'").length, 2);

    // Deliver the cancellation message: the real DlnSource refund path, with
    // only deBridge's cross-chain transport replaced by the stub.
    const root = fileURLToPath(new URL("../../contracts/evm", import.meta.url));
    execFileSync(
      "forge",
      ["build", "--root", root, `${root}/test/BuybackFixture.sol`],
      { stdio: "pipe" },
    );
    const stub = execFileSync(
      "forge",
      ["inspect", "--root", root, "BuybackCallProxyStub", "deployedBytecode"],
      { encoding: "utf8", cwd: root },
    ).trim();
    assert.match(stub, /^0x[0-9a-f]+$/u);
    const sourceGate = await client("base").readContract({
      address: DLN.source as Address,
      abi: cancelAbi,
      functionName: "deBridgeGate",
    });
    const proxy = await client("base").readContract({
      address: sourceGate,
      abi: cancelAbi,
      functionName: "callProxy",
    });
    await rpc("base", "anvil_setCode", [proxy, stub]);
    const usdcBefore = await balanceOf("base", base, wallet);
    await impersonated(
      "base",
      proxy,
      DLN.source,
      encodeFunctionData({
        abi: cancelAbi,
        functionName: "claimCancel",
        args: [terms.orderId, wallet as Address],
      }),
    );
    assert.equal(
      (await balanceOf("base", base, wallet)) - usdcBefore,
      BigInt(second.amount_in as string),
      "the whole deposit returned to the source fee wallet",
    );
    await finalize();
    const [refunded] = await round("15 refund recorded");
    assert.equal(refunded.buyback?.refunded, 1);
    assert.deepEqual(
      sqlite
        .query(
          "SELECT outcome, amount, evidence_network FROM fee_bridge_outcomes WHERE bridge_id = ?",
        )
        .get(second.id as string),
      {
        outcome: "refunded",
        amount: second.amount_in,
        evidence_network: "base",
      },
    );
    // The released share is bridged again, as a new order.
    await until(
      "16 retry order",
      () =>
        signed("network = 'base' AND kind = 'bridge'").length === 3 &&
        settled("network = 'base' AND kind = 'bridge'"),
    );
    const third = signed("network = 'base' AND kind = 'bridge'").at(-1);
    assert.equal(third?.amount_in, second.amount_in);
    assert.notEqual(third?.id, second.id);
    console.log(
      `PASS: cancelled order ${terms.orderId} refunded ${second.amount_in} USDC, released once and bridged again`,
    );
  }

  const gas = sqlite
    .query(
      "SELECT network, COUNT(*) AS sends, SUM(CAST(actual_wei AS REAL)) AS wei FROM fee_native_gas WHERE state = 'signed' GROUP BY network",
    )
    .all();
  console.log(
    JSON.stringify({
      check: "buyback fork cycle",
      sources: SOURCES,
      journal: rows("id NOT LIKE 'seed-%'").map((row) => [
        row.network,
        row.kind,
        row.state,
        row.amount_in,
        row.amount_out,
      ]),
      nativeGas: gas,
    }),
  );
  console.log("PASS: SLOP buyback fork cycle");
} finally {
  await cleanup();
}
