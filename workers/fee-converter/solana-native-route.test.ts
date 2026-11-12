import { expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { solanaBase58, solanaBase64 } from "../../contracts/solana/adapter";
import { SOLANA_NATIVE_ASSET } from "../../contracts/solana/native";
import { ata } from "../../contracts/solana/transactions";
import type { ConversionRow } from "./core";
import { LOOKUP_TABLE_PROGRAM, resolveSolanaAccounts } from "./solana-accounts";
import { WRAPPED_SOL, wrapNativeRoute } from "./solana-native-route";
import {
  assertSolanaRouteSimulation,
  reviewSolanaRouteAccounts,
} from "./solana-route-accounts";
import {
  finalizedRouteCredit,
  type RouteReceipt,
} from "./solana-route-receipt";
import { JUPITER_PROGRAM, parseTransaction } from "./solana-transaction";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM = "11111111111111111111111111111111";
const ASSOCIATED = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const COMPUTE = "ComputeBudget111111111111111111111111111111";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const RENT = 2039280;
const AMOUNT = 10000000n;
const key = (n: number) => solanaBase58(new Uint8Array(32).fill(n));
const u64 = (n: bigint) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, n, true);
  return [...bytes];
};
const keyBytes = (s: string) => {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(alphabet.indexOf(c));
  const bytes: number[] = [];
  while (n) {
    bytes.unshift(Number(n & 255n));
    n >>= 8n;
  }
  return [...new Uint8Array(32 - bytes.length), ...bytes];
};
const account = (
  owner: string,
  data: Uint8Array,
  executable = false,
  lamports = 10000000,
) => ({ owner, executable, lamports, data: [solanaBase64(data), "base64"] });

/** A native Jupiter v0 route wrapped by the Worker, with its fee wallet's accounts. */
async function nativeRoute() {
  const seed = new Uint8Array(32).fill(31),
    publicKey = ed25519.getPublicKey(seed),
    wallet = solanaBase58(publicKey);
  const event = key(12),
    tableKey = key(10),
    blockhash = key(11);
  const source = ata(WRAPPED_SOL, wallet, TOKEN),
    destination = ata(USDC, wallet, TOKEN);
  const statics = [
    wallet,
    source,
    destination,
    COMPUTE,
    ASSOCIATED,
    JUPITER_PROGRAM,
    USDC,
    event,
  ];
  const route = [
    187,
    100,
    250,
    204,
    49,
    196,
    175,
    20,
    ...u64(AMOUNT),
    ...u64(2000001n),
    50,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    3,
    16,
    39,
    0,
    1,
  ];
  const ix = (program: number, accounts: number[], data: number[]) => [
    program,
    accounts.length,
    ...accounts,
    data.length,
    ...data,
  ];
  // Jupiter returns the route with Token, System and the WSOL mint in a table.
  const quoted = Uint8Array.from([
    1,
    ...new Uint8Array(64),
    128,
    1,
    0,
    5,
    statics.length,
    ...statics.flatMap(keyBytes),
    ...keyBytes(blockhash),
    4,
    ...ix(3, [], [2, 0xc0, 0x5c, 0x15, 0x00]),
    ...ix(3, [], [3, ...u64(1000n)]),
    ...ix(4, [0, 2, 0, 6, 9, 8], [1]),
    ...ix(5, [0, 1, 2, 10, 6, 8, 8, 5, 7, 5], route),
    1,
    ...keyBytes(tableKey),
    0,
    3,
    0,
    1,
    2,
  ]);
  const table = new Uint8Array(56 + 3 * 32);
  const view = new DataView(table.buffer);
  view.setUint32(0, 1, true);
  view.setBigUint64(4, (1n << 64n) - 1n, true);
  view.setBigUint64(12, 90n, true);
  table.set(keyBytes(TOKEN), 56);
  table.set(keyBytes(SYSTEM), 88);
  table.set(keyBytes(WRAPPED_SOL), 120);
  const tableRpc = (async (method: string, params: unknown[]) => {
    if (method !== "getAccountInfo" || params[0] !== tableKey)
      throw new Error(`Unexpected RPC ${method}`);
    return {
      context: { slot: 100 },
      value: account(LOOKUP_TABLE_PROGRAM, table),
    };
  }) as <T>(method: string, params: unknown[]) => Promise<T>;
  const quotedParsed = parseTransaction(quoted);
  const raw = wrapNativeRoute(
    quoted,
    quotedParsed,
    await resolveSolanaAccounts(quoted, quotedParsed, tableRpc),
    wallet,
    AMOUNT,
  );
  const parsed = parseTransaction(raw);
  const proof = await resolveSolanaAccounts(raw, parsed, tableRpc);
  const mint = new Uint8Array(82);
  mint[44] = 6;
  mint[45] = 1;
  const tokenAccount = (
    tokenMint: string,
    amount: bigint,
    lamports = RENT + Number(amount),
  ) => {
    const data = new Uint8Array(165);
    data.set(keyBytes(tokenMint));
    data.set(publicKey, 32);
    data.set(u64(amount), 64);
    data[108] = 1;
    if (tokenMint === WRAPPED_SOL) {
      data[109] = 1;
      data.set(u64(BigInt(RENT)), 113);
    }
    return account(TOKEN, data, false, lamports);
  };
  const expected = {
    program: JUPITER_PROGRAM,
    wallet,
    inputMint: WRAPPED_SOL,
    inputProgram: TOKEN,
    outputMint: USDC,
    outputProgram: TOKEN,
    amountIn: AMOUNT,
    quotedOut: 2000001n,
    minimumOut: 1990000n,
    slippageBps: 50,
    nativeInput: true as const,
  };
  /** Review the route while the WSOL account holds `amount` plus unsynced lamports. */
  const review = (amount: bigint, unsynced: number) => {
    const executable = account(LOADER, new Uint8Array(), true);
    const states = new Map<string, unknown>([
      [wallet, account(SYSTEM, new Uint8Array(), false, 1000000000)],
      [
        source,
        tokenAccount(WRAPPED_SOL, amount, RENT + Number(amount) + unsynced),
      ],
      [destination, tokenAccount(USDC, 0n)],
      [WRAPPED_SOL, account(TOKEN, mint)],
      [USDC, account(TOKEN, mint)],
      [event, null],
      ...[COMPUTE, ASSOCIATED, JUPITER_PROGRAM, SYSTEM, TOKEN].map(
        (program): [string, unknown] => [program, executable],
      ),
    ]);
    const rpc = (async (method: string, params: unknown[]) => {
      if (method !== "getMultipleAccounts") return tableRpc(method, params);
      return {
        context: { slot: 100 },
        value: (params[0] as string[]).map((address) => {
          if (!states.has(address))
            throw new Error(`Missing account fixture ${address}`);
          return states.get(address);
        }),
      };
    }) as <T>(method: string, params: unknown[]) => Promise<T>;
    return reviewSolanaRouteAccounts(rpc, raw, parsed, proof, expected);
  };
  const signature = ed25519.sign(raw.slice(parsed.messageOffset), seed);
  const signed = raw.slice();
  signed.set(signature, parsed.messageOffset - 64);
  return {
    wallet,
    source,
    destination,
    raw: signed,
    parsed,
    proof,
    expected,
    tokenAccount,
    review,
    txId: solanaBase58(signature),
  };
}

test("a native route still simulates as exact after someone sends lamports to the fee wallet's WSOL account", async () => {
  const f = await nativeRoute();
  const output = f.tokenAccount(USDC, 2000000n);
  // Without unsynced lamports the wrap leaves the WSOL amount unchanged.
  const clean = await f.review(5n, 0);
  expect(() =>
    assertSolanaRouteSimulation(clean, 101, [
      f.tokenAccount(WRAPPED_SOL, 5n),
      output,
    ]),
  ).not.toThrow();
  // One lamport sent to the open WSOL account: SyncNative folds it into the
  // amount, and the route still spends exactly the wrapped input.
  const donated = await f.review(5n, 1);
  expect(() =>
    assertSolanaRouteSimulation(donated, 101, [
      f.tokenAccount(WRAPPED_SOL, 6n),
      output,
    ]),
  ).not.toThrow();
  // A route that also spends the donated lamport still fails the exact input.
  expect(() =>
    assertSolanaRouteSimulation(donated, 101, [
      f.tokenAccount(WRAPPED_SOL, 5n),
      output,
    ]),
  ).toThrow(
    "Route simulation does not match the exact input and minimum output",
  );
});

test("a finalized native swap reconciles after someone sends lamports to the fee wallet's WSOL account", async () => {
  const f = await nativeRoute();
  const review = await f.review(5n, 1);
  const proof = {
    ...f.proof,
    route: {
      expectation: {
        ...f.expected,
        amountIn: f.expected.amountIn.toString(),
        quotedOut: f.expected.quotedOut.toString(),
        minimumOut: f.expected.minimumOut.toString(),
      },
      accounts: review.observations,
    },
  };
  const row = {
    feeWallet: f.wallet,
    token: SOLANA_NATIVE_ASSET,
    targetToken: USDC,
    amountIn: AMOUNT.toString(),
    minAmountOut: f.expected.minimumOut.toString(),
    rawTx: solanaBase64(f.raw),
    txId: f.txId,
  } as ConversionRow;
  const sourceIndex = f.proof.keys.indexOf(f.source),
    destinationIndex = f.proof.keys.indexOf(f.destination);
  const balance = (index: number, mint: string, amount: bigint) => ({
    accountIndex: index,
    owner: f.wallet,
    mint,
    programId: TOKEN,
    uiTokenAmount: { amount: amount.toString() },
  });
  /**
   * The WSOL account held 5 plus `unsynced` lamports; the route leaves `after`.
   * The System transfer adds AMOUNT lamports to it, and the route's Token
   * transfer of a native account moves lamports with its amount, so the account
   * ends at its rent plus `after`. The pool vault that receives AMOUNT is not
   * part of this fixture.
   */
  const receipt = (after: bigint, unsynced = 1): RouteReceipt => {
    const preBalances = f.proof.keys.map(() => 10000000);
    const postBalances = preBalances.slice();
    preBalances[0] = 1000000000;
    postBalances[0] = 1000000000 - 5000 - Number(AMOUNT);
    preBalances[sourceIndex] = RENT + 5 + unsynced;
    postBalances[sourceIndex] = RENT + Number(after);
    preBalances[destinationIndex] = RENT;
    postBalances[destinationIndex] = RENT;
    return {
      slot: 102,
      transaction: [row.rawTx as string, "base64"],
      meta: {
        err: null,
        fee: 5000,
        preBalances,
        postBalances,
        loadedAddresses: {
          writable: f.proof.loadedWritable,
          readonly: f.proof.loadedReadonly,
        },
        preTokenBalances: [
          balance(sourceIndex, WRAPPED_SOL, 5n),
          balance(destinationIndex, USDC, 0n),
        ],
        postTokenBalances: [
          balance(sourceIndex, WRAPPED_SOL, after),
          balance(destinationIndex, USDC, 2000000n),
        ],
      },
    };
  };
  expect(finalizedRouteCredit(row, proof, receipt(6n))).toBe(2000000n);
  // Without a donation, a later conversion through the existing account still
  // reconciles.
  expect(finalizedRouteCredit(row, proof, receipt(5n, 0))).toBe(2000000n);
  // Spending the donated lamport as well is not the exact native input.
  expect(() => finalizedRouteCredit(row, proof, receipt(5n))).toThrow(
    "Finalized swap did not debit its exact input and credit its minimum output",
  );
});
