// Monthly reservation and leaf commitment are permissionless, so another
// keeper can finish a step after this keeper signed its own transaction for
// it. When this keeper's broadcast was refused (here: its gas wallet is empty),
// those signed bytes still hold their nonce. If the keeper never offers them
// again, every later transaction it signs waits behind that unused nonce.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  encodeFunctionData,
  type Hex,
  keccak256,
  parseAbi,
  parseTransaction,
  toFunctionSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  type EvmMonthlyReservation,
  evmAllocationRoot,
  evmAwardId,
  evmMonthlyDigest,
  evmMonthlyReserveDigest,
  evmMonthlySumTree,
} from "../../contracts/evm/adapter";
import {
  type EscrowDeployment,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import {
  type Attempt,
  type JournalStore,
  type PublicEvmExecutorEnvironment,
  submitEvmMonthly,
} from "./core";
import type { MonthlyAuthorization } from "./monthly";

const keeper = privateKeyToAccount(`0x${"7".repeat(64)}`);
const identity = privateKeyToAccount(`0x${"6".repeat(64)}`);
const address = (byte: string) => `0x${byte.repeat(20)}`;
const vault = address("a1");
const owner = address("b2");
const feeRecipient = address("d4");
const factory = address("e5");
const registrar = address("f6");
const asset = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const vaultCode = "0x6001";
const factoryCode = "0x6002";
const codeSha256 = (code: string) =>
  bytesToHex(sha256(Uint8Array.from(Buffer.from(code.slice(2), "hex"))));
const deployment: EscrowDeployment = {
  network: "base-sepolia",
  vault,
  programId: null,
  upgradeAuthority: null,
  projectPda: null,
  networkDomain: null,
  asset,
  owner,
  identityAuthority: identity.address,
  feeRecipient,
  deploymentTransaction: `0x${"0d".repeat(32)}`,
  sourceCommit: "a".repeat(40),
  codeSha256: codeSha256(vaultCode),
  bindingDelaySeconds: "0",
  rotationDelaySeconds: null,
  factory,
  factoryCodeSha256: codeSha256(factoryCode),
  registrar,
};
const period = "2026-11";
const snapshotSha256 = "5a".repeat(32);
const entries = [
  {
    githubUserId: "101",
    grossMicro: "1000000",
    sourceDigest: `0x${"a1".repeat(32)}`,
  },
  {
    githubUserId: "102",
    grossMicro: "2000000",
    sourceDigest: `0x${"b2".repeat(32)}`,
  },
];
const tree = evmMonthlySumTree(entries);
const reservation: EvmMonthlyReservation = {
  version: 2,
  allocationDigest: `0x${snapshotSha256}`,
  allocationRoot: tree.hash,
  wholeGross: tree.total.toString(),
  remainingGross: tree.total.toString(),
  count: entries.length,
  sourceSequence: "4",
};
const digest = evmMonthlyReserveDigest(84532n, vault, period, reservation);
// A legacy vault commits the whole entry list under one signed root.
const legacyRoot = evmAllocationRoot(entries);
const legacyDigest = evmMonthlyDigest(84532n, vault, period, legacyRoot);

const word = (value: bigint | string) =>
  (typeof value === "bigint"
    ? value.toString(16)
    : value.replace(/^0x/, "").toLowerCase()
  ).padStart(64, "0");
const monthly = parseAbi([
  "function monthlyRoots(uint32) view returns (bytes32)",
  "function monthlyReserves(uint32) view returns (bytes32,uint128,uint128,uint32,uint64)",
]);
const selector = (functionName: "monthlyRoots" | "monthlyReserves") =>
  encodeFunctionData({ abi: monthly, functionName, args: [202611] }).slice(
    0,
    10,
  );

/** A Base Sepolia node with the reviewed vault and this month's reserve state. */
const chain = {
  funded: false,
  root: 0n as bigint | string,
  reserved: false,
  remaining: tree.total,
  awards: new Map<string, string>(),
  sent: new Map<Hex, Hex>(),
  /** Every accepted eth_sendRawTransaction, including repeats of known bytes. */
  broadcasts: [] as Hex[],
  /** When set, only nonces below it are mined; later accepted bytes wait in the mempool. */
  mined: null as number | null,
};
const awardId = (index: number) =>
  evmAwardId(84532n, vault, entries[index].sourceDigest).toLowerCase();
/** The finalized award another keeper committed for one leaf. */
function commitElsewhere(index: number) {
  const gross = BigInt(entries[index].grossMicro);
  chain.awards.set(
    awardId(index),
    [
      BigInt(entries[index].githubUserId),
      gross,
      gross / 50n,
      entries[index].sourceDigest,
      1n,
      0n,
    ]
      .map(word)
      .join(""),
  );
  chain.remaining -= gross;
}
const calls: Record<string, () => string> = {
  [toFunctionSelector("registrar()")]: () => word(registrar),
  [toFunctionSelector("feeRecipient()")]: () => word(feeRecipient),
  [toFunctionSelector("bindingDelay()")]: () => word(0n),
  [toFunctionSelector("AUTHORITY_ROTATION_DELAY()")]: () => word(604800n),
  [toFunctionSelector("vaults(bytes32)")]: () => word(vault),
  [toFunctionSelector("token()")]: () => word(asset),
  [toFunctionSelector("owner()")]: () => word(owner),
  [toFunctionSelector("factory()")]: () => word(factory),
  [toFunctionSelector("purpose()")]: () => word(0n),
  [toFunctionSelector("projectId()")]: () => "11".repeat(32),
  [toFunctionSelector("identityAuthority()")]: () => word(identity.address),
  [selector("monthlyRoots")]: () => word(chain.root),
  [selector("monthlyReserves")]: () =>
    (chain.reserved
      ? [reservation.allocationDigest, tree.total, chain.remaining, 2n, 1n]
      : [0n, 0n, 0n, 0n, 0n]
    )
      .map(word)
      .join(""),
};
const sentNonces = () =>
  [...chain.sent.values()]
    .map((raw) => Number(parseTransaction(raw).nonce))
    .sort((a, b) => a - b);
/** The next nonce the node can execute: signed nonces it never received leave a gap. */
const executableNonce = () => {
  const nonces = new Set(
    [...chain.sent.values()].map((raw) => parseTransaction(raw).nonce),
  );
  let next = 0;
  while (nonces.has(next)) next++;
  return next;
};
function answer(method: string, params: unknown[]) {
  switch (method) {
    case "eth_chainId":
      return "0x14a34";
    case "eth_getCode":
      return params[0] === factory ? factoryCode : vaultCode;
    case "eth_getStorageAt":
      return `0x${"0".repeat(64)}`;
    case "eth_call": {
      const data = (params[0] as { data: string }).data;
      if (data.startsWith("0xe76af61d"))
        return `0x${chain.awards.get(`0x${data.slice(10)}`) ?? word(0n).repeat(6)}`;
      const result = calls[data.slice(0, 10)];
      if (!result) throw new Error(`Unexpected call ${data.slice(0, 10)}`);
      return `0x${result()}`;
    }
    case "eth_getBlockByNumber":
      return { number: "0x10", timestamp: "0x68000000", baseFeePerGas: "0x1" };
    case "eth_getTransactionCount": {
      const next = executableNonce();
      return `0x${(params[1] === "latest" && chain.mined !== null ? Math.min(next, chain.mined) : next).toString(16)}`;
    }
    case "eth_estimateGas":
      return "0x186a0";
    case "eth_getTransactionReceipt":
      return null;
    case "eth_getTransactionByHash": {
      const raw = chain.sent.get(String(params[0]).toLowerCase() as Hex);
      return raw ? { hash: keccak256(raw) } : null;
    }
    case "eth_sendRawTransaction": {
      if (!chain.funded)
        return { error: "insufficient funds for gas * price + value" };
      const raw = params[0] as Hex;
      chain.sent.set(keccak256(raw), raw);
      chain.broadcasts.push(keccak256(raw));
      return keccak256(raw);
    }
    default:
      throw new Error(`Unexpected RPC ${method}`);
  }
}
let server: ReturnType<typeof Bun.serve>;
let rpcUrl: string;
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { id, method, params } = (await request.json()) as {
        id: number;
        method: string;
        params: unknown[];
      };
      const result = answer(method, params);
      return Response.json(
        result && typeof result === "object" && "error" in result
          ? {
              jsonrpc: "2.0",
              id,
              error: { code: -32000, message: result.error },
            }
          : { jsonrpc: "2.0", id, result },
      );
    },
  });
  rpcUrl = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

function memoryJournal(): JournalStore {
  const values = new Map<string, unknown>();
  const journal: JournalStore = {
    async get<T>(key: string) {
      return structuredClone(values.get(key)) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      values.set(key, structuredClone(value));
    },
    async transaction(callback) {
      return callback(journal);
    },
  };
  return journal;
}

/** The keeper's executor environment: its own gas key and bounded fee replacement. */
function keeperEnvironment(): PublicEvmExecutorEnvironment {
  return {
    PAYMENT_DEPLOYMENTS: JSON.stringify([
      paymentDeploymentRecord("project-1", deployment),
    ]),
    PAYMENT_RPC_URLS: JSON.stringify({ "base-sepolia": rpcUrl }),
    SIGNER: {
      address: keeper.address,
      signTransaction: (transaction) => keeper.signTransaction(transaction),
    },
    JOURNAL: memoryJournal(),
    FEE_BUMP: { now: () => new Date("2026-12-04T00:00:00.000Z") },
  };
}

async function authorization(legacy = false): Promise<MonthlyAuthorization> {
  const signed = legacy ? legacyDigest : digest;
  return {
    plan: {
      family: "evm",
      request: {
        projectId: "project-1",
        period,
        network: "base-sepolia",
        snapshotSha256,
      },
      deployment,
      allocationRoot: legacy ? legacyRoot : tree.hash,
      messageHex: signed.slice(2),
      totalGrossBase: tree.total.toString(),
      ...(legacy ? {} : { evmReservation: reservation }),
      entries,
    },
    signatureHex: (await identity.sign({ hash: signed as Hex })).slice(2),
  };
}

/** Another keeper's reservation of this month is finalized. */
function admitElsewhere() {
  chain.root = tree.hash;
  chain.reserved = true;
}

function reset(admitted: boolean) {
  chain.funded = false;
  chain.root = 0n;
  chain.reserved = false;
  if (admitted) admitElsewhere();
  chain.remaining = tree.total;
  chain.awards.clear();
  chain.sent.clear();
  chain.broadcasts = [];
  chain.mined = null;
}

test("a leaf another keeper committed still sends this keeper's signed leaf bytes", async () => {
  reset(true);
  const env = keeperEnvironment();
  const signed = await authorization();
  // The keeper signs leaf 0, but the node refuses it: the gas wallet is empty.
  await expect(submitEvmMonthly(env, signed, true, 16)).rejects.toThrow();
  const leafKey = `monthly:v2:base-sepolia:${vault}:${period}:${tree.hash}:leaf:0`;
  const leaf = await env.JOURNAL.get<Attempt>(leafKey);
  expect(leaf && parseTransaction(leaf.rawTransaction).nonce).toBe(0);
  expect(chain.sent.size).toBe(0);

  // Another keeper commits leaf 0. The operator then funds this keeper's wallet.
  commitElsewhere(0);
  chain.funded = true;
  await submitEvmMonthly(env, signed, true, 16);
  // Leaf 0's journaled bytes fill nonce 0, so leaf 1 at nonce 1 can execute.
  expect({
    leaf0Sent: chain.sent.has(leaf?.transactionId as Hex),
    sentNonces: sentNonces(),
    executableNonce: executableNonce(),
  }).toEqual({ leaf0Sent: true, sentNonces: [0, 1], executableNonce: 2 });

  // Once nonce 0 is mined, a later run does not send leaf 0 again.
  const before = chain.broadcasts.length;
  await submitEvmMonthly(env, signed, true, 16);
  expect(chain.broadcasts.slice(before)).not.toContain(leaf?.transactionId);
});

test("a month another keeper finished still sends this keeper's signed leaf bytes", async () => {
  reset(true);
  const env = keeperEnvironment();
  const signed = await authorization();
  // The keeper signs leaf 0, but the node refuses it: the gas wallet is empty.
  await expect(submitEvmMonthly(env, signed, true, 16)).rejects.toThrow();
  const leafKey = `monthly:v2:base-sepolia:${vault}:${period}:${tree.hash}:leaf:0`;
  const leaf = await env.JOURNAL.get<Attempt>(leafKey);
  expect(leaf && parseTransaction(leaf.rawTransaction).nonce).toBe(0);

  // Another keeper commits every leaf, so no reserve remains. The wallet is then funded.
  commitElsewhere(0);
  commitElsewhere(1);
  chain.funded = true;
  // The run that sends the bytes cannot yet know they are mined.
  expect(await submitEvmMonthly(env, signed, true, 16)).toEqual({
    transactionId: null,
    alreadyCommitted: true,
    complete: false,
  });
  // Leaf 0's journaled bytes fill nonce 0; the keeper's next transaction can execute.
  expect({
    leaf0Sent: chain.sent.has(leaf?.transactionId as Hex),
    executableNonce: executableNonce(),
  }).toEqual({ leaf0Sent: true, executableNonce: 1 });

  // Once nonce 0 is mined, a later run does not send leaf 0 again and the month is complete.
  const before = chain.broadcasts.length;
  expect(await submitEvmMonthly(env, signed, true, 16)).toEqual({
    transactionId: null,
    alreadyCommitted: true,
    complete: true,
  });
  expect(chain.broadcasts.slice(before)).not.toContain(leaf?.transactionId);
});

test("a finished month stays incomplete while this keeper's re-sent leaf nonce is unmined", async () => {
  reset(true);
  const env = keeperEnvironment();
  const signed = await authorization();
  // The keeper signs leaf 0, but the node refuses it: the gas wallet is empty.
  await expect(submitEvmMonthly(env, signed, true, 16)).rejects.toThrow();
  const leafKey = `monthly:v2:base-sepolia:${vault}:${period}:${tree.hash}:leaf:0`;
  const leaf = await env.JOURNAL.get<Attempt>(leafKey);

  // Other keepers commit every leaf. The funded node accepts the bytes but mines nothing yet.
  commitElsewhere(0);
  commitElsewhere(1);
  chain.funded = true;
  chain.mined = 0;
  const incomplete = {
    transactionId: null,
    alreadyCommitted: true,
    complete: false,
  };
  for (let run = 0; run < 2; ++run) {
    const before = chain.broadcasts.length;
    expect(await submitEvmMonthly(env, signed, true, 16)).toEqual(incomplete);
    // Each run offers the unmined bytes again.
    expect(chain.broadcasts.slice(before)).toContain(
      leaf?.transactionId as Hex,
    );
  }

  // Nonce 0 is mined: the month is complete and the bytes are not sent again.
  chain.mined = null;
  const before = chain.broadcasts.length;
  expect(await submitEvmMonthly(env, signed, true, 16)).toEqual({
    ...incomplete,
    complete: true,
  });
  expect(chain.broadcasts.slice(before)).not.toContain(leaf?.transactionId);
});

test("a month another keeper admitted still sends this keeper's signed reserve bytes", async () => {
  reset(false);
  const env = keeperEnvironment();
  const signed = await authorization();
  // The keeper signs the reservation, but the node refuses it.
  await expect(submitEvmMonthly(env, signed, true, 16)).rejects.toThrow();
  const reserve = await env.JOURNAL.get<Attempt>(
    `monthly:v2:base-sepolia:${vault}:${period}`,
  );
  expect(reserve && parseTransaction(reserve.rawTransaction).nonce).toBe(0);
  expect(chain.sent.size).toBe(0);

  // Another keeper admits the same reservation. The wallet is then funded.
  admitElsewhere();
  chain.funded = true;
  await submitEvmMonthly(env, signed, true, 16);
  // The reserve bytes fill nonce 0, so both leaves at nonces 1 and 2 can execute.
  expect({
    reserveSent: chain.sent.has(reserve?.transactionId as Hex),
    sentNonces: sentNonces(),
    executableNonce: executableNonce(),
  }).toEqual({ reserveSent: true, sentNonces: [0, 1, 2], executableNonce: 3 });
});

test("a legacy month another keeper committed still sends this keeper's signed commit bytes", async () => {
  reset(false);
  const env = keeperEnvironment();
  const signed = await authorization(true);
  // The keeper signs the whole legacy commitment, but the node refuses it.
  await expect(submitEvmMonthly(env, signed, true, 16)).rejects.toThrow();
  const commit = await env.JOURNAL.get<Attempt>(
    `monthly:base-sepolia:${vault}:${period}`,
  );
  expect(commit && parseTransaction(commit.rawTransaction).nonce).toBe(0);
  expect(chain.sent.size).toBe(0);

  // Another keeper commits the same root. The wallet is then funded.
  chain.root = legacyRoot;
  chain.funded = true;
  // The run that sends the bytes reports the month incomplete.
  expect(await submitEvmMonthly(env, signed, true, 16)).toEqual({
    transactionId: null,
    alreadyCommitted: true,
    complete: false,
  });
  // The commit bytes fill nonce 0; the keeper's next transaction can execute.
  expect({
    commitSent: chain.sent.has(commit?.transactionId as Hex),
    executableNonce: executableNonce(),
  }).toEqual({ commitSent: true, executableNonce: 1 });

  // Once nonce 0 is mined, the month reports the committed result unchanged.
  expect(await submitEvmMonthly(env, signed, true, 16)).toEqual({
    transactionId: null,
    alreadyCommitted: true,
  });
});
