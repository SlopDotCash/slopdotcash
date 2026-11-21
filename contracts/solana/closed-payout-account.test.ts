import { afterEach, describe, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { decodeBase58Bytes, encodeBase58Bytes } from "../../src/lib/base58";
import { payoutFee } from "../../src/lib/payments/contracts";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { scanSolanaPayments } from "../../workers/payments/scanner";
import {
  BINDING_SIZE,
  CONFIG_DISCRIMINATOR,
  CONFIG_SIZE,
  OBLIGATION_DISCRIMINATOR,
  OBLIGATION_SIZE,
  PROJECT_DISCRIMINATOR,
  PROJECT_SIZE,
  programAddress,
  SOLANA_NATIVE_ASSET,
  solanaAssociatedTokenAddress,
  solanaAwardId,
  solanaConfigAddress,
  solanaPaymentAdapter,
  solanaVaultAddress,
} from "./adapter";

// A payout transaction may carry other instructions beside the escrow payment: a
// recipient creating, emptying and closing its token account, or an unrelated
// lamport transfer. The payment must still verify, and a scan must not stop on it.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const fill = (n: number) => new Uint8Array(32).fill(n);
const key = (n: number) => encodeBase58Bytes(fill(n));
const unhex = (h: string) =>
  Uint8Array.from(h.match(/../g) ?? [], (p) => Number.parseInt(p, 16));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const signature = (n: number) => encodeBase58Bytes(new Uint8Array(64).fill(n));

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM = SOLANA_NATIVE_ASSET;
const BPF_LOADER = "BPFLoader2111111111111111111111111111111111";
const PROGRAM = key(3);
const PROJECT = key(7);
const VAULT = solanaVaultAddress(PROGRAM, PROJECT);
const OBLIGATION = key(16);
const VETO = key(18);
const MINT = key(20);
const OTHER_MINT = key(22);
const RECIPIENT = key(14);
const OTHER = key(21);
const REBOUND = key(23);
const DOMAIN = "ab".repeat(32);
const SOURCE = "cd".repeat(32);
const AWARD = solanaAwardId(PROJECT, SOURCE);
const CODE = new Uint8Array([1, 2, 3, 4]);
const ACTOR = 42n;
const GROSS = 1_000_000_000n;
const FEE = payoutFee(GROSS);
const NET = GROSS - FEE;
const SIG = signature(5);
const LATER = signature(6);
const discriminator = (name: string) =>
  sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8);
const actorSeed = () => {
  const seed = new Uint8Array(8);
  new DataView(seed.buffer).setBigUint64(0, ACTOR, true);
  return seed;
};
const BINDING = programAddress(PROGRAM, [
  new TextEncoder().encode("wallet"),
  fill(7),
  actorSeed(),
]);
const ata = (wallet: string, mint = MINT) =>
  solanaAssociatedTokenAddress(mint, wallet, TOKEN);

function config(mint: string) {
  return {
    rpcUrl: "http://rpc.invalid",
    genesisHash: "G",
    programId: PROGRAM,
    projectPda: PROJECT,
    projectId: "p1",
    network: "solana-devnet",
    networkDomain: DOMAIN,
    vault: VAULT,
    mint,
    owner: key(10),
    identityAuthority: key(12),
    feeRecipient: key(11),
    rotationAuthority: key(13),
    codeSha256: hex(sha256(CODE)),
    upgradeAuthority: null,
    bindingDelaySeconds: "60",
    rotationDelaySeconds: "60",
  };
}
const encoded = (data: Uint8Array, owner = PROGRAM, executable = false) => ({
  owner,
  executable,
  lamports: 1,
  data: [b64(data), "base64"],
});
function configAccount() {
  const d = new Uint8Array(CONFIG_SIZE);
  d.set(unhex(CONFIG_DISCRIMINATOR));
  d.set(fill(12), 8);
  d.set(fill(11), 40);
  d.set(fill(13), 72);
  return encoded(d);
}
function projectAccount(mint: string) {
  const d = new Uint8Array(PROJECT_SIZE);
  const v = new DataView(d.buffer);
  d.set(unhex(PROJECT_DISCRIMINATOR));
  d.set(fill(10), 8);
  d.set(unhex(DOMAIN), 72);
  d.set(fill(11), 136);
  d.set(mint === SYSTEM ? new Uint8Array(32) : fill(20), 168);
  v.setBigInt64(249, 60n, true);
  v.setBigInt64(298, 60n, true);
  return encoded(d);
}
function obligationAccount() {
  const d = new Uint8Array(OBLIGATION_SIZE);
  const v = new DataView(d.buffer);
  d.set(unhex(OBLIGATION_DISCRIMINATOR));
  v.setBigUint64(8, GROSS, true);
  d.set(unhex(SOURCE), 16);
  d.set(fill(7), 48);
  d.set(unhex(AWARD), 80);
  v.setBigUint64(112, ACTOR, true);
  v.setBigUint64(120, NET, true);
  v.setBigUint64(128, FEE, true);
  d[136] = 1;
  return encoded(d);
}
/** The finalized binding: by default the wallet and version that paid. */
function bindingAccount(wallet = RECIPIENT, version = 1n, actor = ACTOR) {
  const d = new Uint8Array(BINDING_SIZE);
  const v = new DataView(d.buffer);
  d.set(sha256(new TextEncoder().encode("account:WalletBinding")).slice(0, 8));
  v.setBigUint64(72, actor, true);
  d.set(decodeBase58Bytes(wallet), 112);
  v.setBigUint64(144, version, true);
  v.setBigUint64(160, version, true);
  return encoded(d);
}
function mintAccount() {
  const d = new Uint8Array(82);
  d[44] = 6;
  d[45] = 1;
  return encoded(d, TOKEN);
}
const balance = (accountIndex: number, owner: string, amount: string) => ({
  accountIndex,
  mint: MINT,
  owner,
  programId: TOKEN,
  uiTokenAmount: { amount, decimals: 6 },
});
const payData = (name: string, version = 1n) => {
  const data = new Uint8Array(16);
  data.set(discriminator(name));
  new DataView(data.buffer).setBigUint64(8, version, true);
  return encodeBase58Bytes(data);
};

interface SplShape {
  /** Create the destination account in the transaction, then empty and close it. */
  createAndClose?: boolean;
  /** The destination existed before, changed owner for this payment and closed after. */
  closePreExisting?: boolean;
  /** Leave the recipient's wallet out of the transaction's accounts. */
  walletAbsent?: boolean;
  destination?: string;
  amount?: bigint;
  mint?: string;
  version?: bigint;
}
function splPayment(shape: SplShape = {}) {
  const destination = shape.destination ?? ata(RECIPIENT);
  const owner = shape.walletAbsent ? key(24) : RECIPIENT;
  const keys = [
    owner,
    destination,
    VAULT,
    PROJECT,
    OBLIGATION,
    BINDING,
    MINT,
    TOKEN,
    VETO,
    PROGRAM,
    OTHER,
  ];
  const create = {
    program: "spl-associated-token-account",
    programId: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    parsed: {
      type: "createIdempotent",
      info: { source: owner, account: destination, wallet: owner, mint: MINT },
    },
    stackHeight: null,
  };
  const pay = {
    programId: PROGRAM,
    accounts: [
      PROJECT,
      OBLIGATION,
      BINDING,
      MINT,
      VAULT,
      destination,
      TOKEN,
      VETO,
    ],
    data: payData("pay", shape.version),
    stackHeight: null,
  };
  const payout = {
    program: "spl-token",
    programId: TOKEN,
    parsed: {
      type: "transferChecked",
      info: {
        source: VAULT,
        mint: shape.mint ?? MINT,
        authority: PROJECT,
        destination,
        tokenAmount: { amount: (shape.amount ?? NET).toString(), decimals: 6 },
      },
    },
    stackHeight: 2,
  };
  const onward = {
    program: "spl-token",
    programId: TOKEN,
    parsed: {
      type: "transferChecked",
      info: {
        source: destination,
        mint: MINT,
        authority: owner,
        destination: OTHER,
        tokenAmount: { amount: NET.toString(), decimals: 6 },
      },
    },
    stackHeight: null,
  };
  const close = {
    program: "spl-token",
    programId: TOKEN,
    parsed: {
      type: "closeAccount",
      info: { account: destination, destination: owner, owner },
    },
    stackHeight: null,
  };
  const closes = shape.createAndClose || shape.closePreExisting;
  const vaultBefore = (GROSS * 2n).toString();
  const vaultAfter = (GROSS * 2n - NET).toString();
  const pre = [
    balance(2, PROJECT, vaultBefore),
    balance(10, OTHER, "0"),
    ...(shape.createAndClose
      ? []
      : shape.closePreExisting
        ? [balance(1, key(25), "0")]
        : [balance(1, RECIPIENT, "0")]),
  ];
  const post = [
    balance(2, PROJECT, vaultAfter),
    balance(10, OTHER, closes ? NET.toString() : "0"),
    ...(closes ? [] : [balance(1, RECIPIENT, NET.toString())]),
  ];
  return {
    slot: 100,
    meta: {
      err: null,
      fee: 5000,
      preBalances: keys.map(() => 1),
      postBalances: keys.map(() => 1),
      innerInstructions: [{ index: 1, instructions: [payout] }],
      preTokenBalances: shape.walletAbsent ? [] : pre,
      postTokenBalances: shape.walletAbsent ? [] : post,
    },
    transaction: {
      signatures: [SIG],
      message: {
        accountKeys: keys.map((pubkey, i) => ({
          pubkey,
          signer: i === 0,
          writable: true,
        })),
        instructions: closes ? [create, pay, onward, close] : [create, pay],
      },
    },
  };
}

interface NativeShape {
  /** An extra lamport transfer to the destination beside the payout. */
  extraTransfer?: bigint;
  /** The recipient moves part of the payout on in the same transaction. */
  spendOnward?: bigint;
  vault?: string;
  destination?: string;
}
function nativePayment(shape: NativeShape = {}) {
  const destination = shape.destination ?? RECIPIENT;
  const payer = key(26);
  const keys = [
    payer,
    destination,
    VAULT,
    PROJECT,
    OBLIGATION,
    BINDING,
    VETO,
    PROGRAM,
    SYSTEM,
    OTHER,
  ];
  const pay = {
    programId: PROGRAM,
    accounts: [
      PROJECT,
      OBLIGATION,
      BINDING,
      shape.vault ?? VAULT,
      destination,
      VETO,
    ],
    data: payData("pay_native"),
    stackHeight: null,
  };
  const transfer = (source: string, to: string, lamports: bigint) => ({
    program: "system",
    programId: SYSTEM,
    parsed: {
      type: "transfer",
      info: { source, destination: to, lamports: Number(lamports) },
    },
    stackHeight: null,
  });
  const extra = shape.extraTransfer ?? 0n;
  const onward = shape.spendOnward ?? 0n;
  const pre = new Map<string, bigint>(keys.map((k) => [k, 10_000_000n]));
  pre.set(VAULT, GROSS * 3n);
  const post = new Map(pre);
  post.set(payer, (pre.get(payer) ?? 0n) - 5000n - extra);
  post.set(VAULT, (pre.get(VAULT) ?? 0n) - NET);
  post.set(destination, (pre.get(destination) ?? 0n) + NET + extra - onward);
  post.set(OTHER, (pre.get(OTHER) ?? 0n) + onward);
  const instructions = [
    pay,
    ...(extra ? [transfer(payer, destination, extra)] : []),
    ...(onward ? [transfer(destination, OTHER, onward)] : []),
  ];
  return {
    slot: 100,
    meta: {
      err: null,
      fee: 5000,
      preBalances: keys.map((k) => Number(pre.get(k))),
      postBalances: keys.map((k) => Number(post.get(k))),
      innerInstructions: [],
      preTokenBalances: [],
      postTokenBalances: [],
    },
    transaction: {
      signatures: [SIG],
      message: {
        accountKeys: keys.map((pubkey, i) => ({
          pubkey,
          signer: i === 0 || pubkey === destination,
          writable: true,
        })),
        instructions,
      },
    },
  };
}

interface Chain {
  mint: string;
  transactions: Map<string, unknown>;
  binding?: ReturnType<typeof bindingAccount> | null;
  history?: string[];
  reads?: string[];
}
function mockChain(chain: Chain) {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body));
    chain.reads?.push(method === "getAccountInfo" ? params[0] : method);
    let result: unknown;
    if (method === "getGenesisHash") result = "G";
    else if (method === "getAccountInfo") {
      const address = params[0];
      if (address === PROGRAM)
        result = { value: encoded(CODE, BPF_LOADER, true) };
      else if (address === solanaConfigAddress(PROGRAM))
        result = { value: configAccount() };
      else if (address === PROJECT)
        result = { value: projectAccount(chain.mint) };
      else if (address === MINT) result = { value: mintAccount() };
      else if (address === OBLIGATION) result = { value: obligationAccount() };
      else if (address === BINDING)
        result = {
          value: chain.binding === undefined ? bindingAccount() : chain.binding,
        };
      else throw new Error(`unexpected account ${address}`);
    } else if (method === "getSignatureStatuses")
      result = {
        value: [{ err: null, confirmationStatus: "finalized", slot: 100 }],
      };
    else if (method === "getTransaction") {
      result = chain.transactions.get(params[0]);
      if (!result) throw new Error(`unexpected transaction ${params[0]}`);
    } else if (method === "getProgramAccounts")
      result = [{ pubkey: OBLIGATION, account: obligationAccount() }];
    else if (method === "getBlock") result = { blockhash: "H" };
    else if (method === "getSignaturesForAddress")
      result = (chain.history ?? []).map((s) => ({ signature: s, err: null }));
    else throw new Error(`unexpected ${method}`);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
}
const paidEvent = (transactionId = SIG, eventIndex = 1) => ({
  transactionId,
  eventIndex,
  kind: "paid" as const,
  obligationId: AWARD,
});
async function verify(mint: string, tx: unknown, chain: Partial<Chain> = {}) {
  mockChain({ mint, transactions: new Map([[SIG, tx]]), ...chain });
  return solanaPaymentAdapter(config(mint))
    .verifyFinalized(paidEvent(SIG, mint === SYSTEM ? 0 : 1))
    .then(
      (event) => event.destination,
      (error: Error) => `refused: ${error.message}`,
    );
}

describe("SPL payout verification", () => {
  test("a payout to an account that stays open names the bound wallet", async () => {
    const reads: string[] = [];
    expect(await verify(MINT, splPayment(), { reads })).toBe(RECIPIENT);
    expect(reads).toContain(BINDING);
  });

  test("an account created, paid, emptied and closed in one transaction verifies", async () => {
    const tx = splPayment({ createAndClose: true });
    const balances = [
      ...tx.meta.preTokenBalances,
      ...tx.meta.postTokenBalances,
    ].map((item) => item.accountIndex);
    expect(balances).not.toContain(1);
    expect(await verify(MINT, tx)).toBe(RECIPIENT);
  });

  test("an account whose owner changed before the payout and closed after verifies", async () => {
    expect(await verify(MINT, splPayment({ closePreExisting: true }))).toBe(
      RECIPIENT,
    );
  });

  test("after a later rebind, the paid wallet comes from the transaction's accounts", async () => {
    const binding = bindingAccount(REBOUND, 2n);
    expect(
      await verify(MINT, splPayment({ createAndClose: true }), { binding }),
    ).toBe(RECIPIENT);
    expect(
      await verify(
        MINT,
        splPayment({ createAndClose: true, walletAbsent: true }),
        {
          binding,
        },
      ),
    ).toBe("refused: Payout destination is not the bound wallet's account");
  });

  test("a destination that is not the bound wallet's account is refused", async () => {
    const destination = ata(OTHER);
    expect(
      await verify(MINT, splPayment({ destination, createAndClose: true })),
    ).toBe("refused: Payout destination is not the bound wallet's account");
    expect(
      await verify(
        MINT,
        splPayment({ destination: ata(RECIPIENT, OTHER_MINT) }),
      ),
    ).toBe("refused: Payout destination is not the bound wallet's account");
  });

  test("a binding that differs from the payment is refused", async () => {
    for (const [binding, refusal] of [
      [bindingAccount(RECIPIENT, 0n), "Wallet binding differs from payment"],
      [
        bindingAccount(RECIPIENT, 1n, ACTOR + 1n),
        "Wallet binding differs from payment",
      ],
      [null, "Wallet binding missing"],
    ] as const)
      expect(
        await verify(MINT, splPayment({ createAndClose: true }), { binding }),
      ).toBe(`refused: ${refusal}`);
    expect(await verify(MINT, splPayment({ version: 2n }))).toBe(
      "refused: Wallet binding differs from payment",
    );
  });

  test("a wrong amount or mint in the payout transfer is refused", async () => {
    expect(
      await verify(
        MINT,
        splPayment({ createAndClose: true, amount: NET - 1n }),
      ),
    ).toBe("refused: Payout transfer differs from award");
    expect(
      await verify(
        MINT,
        splPayment({ createAndClose: true, amount: NET + 1n }),
      ),
    ).toBe("refused: Payout transfer differs from award");
    expect(
      await verify(
        MINT,
        splPayment({ createAndClose: true, mint: OTHER_MINT }),
      ),
    ).toBe("refused: Payout transfer differs from award");
  });
});

describe("native payout verification", () => {
  test("a plain payout names the bound destination", async () => {
    expect(await verify(SYSTEM, nativePayment())).toBe(RECIPIENT);
  });

  test("an extra lamport transfer beside the payout verifies", async () => {
    expect(await verify(SYSTEM, nativePayment({ extraTransfer: 1n }))).toBe(
      RECIPIENT,
    );
  });

  test("a recipient spending part of the payout in the same transaction verifies", async () => {
    expect(await verify(SYSTEM, nativePayment({ spendOnward: 1_000n }))).toBe(
      RECIPIENT,
    );
  });

  test("a payout from another vault or to the vault is refused", async () => {
    expect(await verify(SYSTEM, nativePayment({ vault: OTHER }))).toBe(
      "refused: Payment differs from award",
    );
    expect(await verify(SYSTEM, nativePayment({ destination: VAULT }))).toBe(
      "refused: Native payout destination differs from award",
    );
  });
});

describe("Solana payment scan", () => {
  for (const [name, mint, unusual, plain] of [
    [
      "SPL",
      MINT,
      () => splPayment({ createAndClose: true }),
      () => splPayment(),
    ],
    [
      "native",
      SYSTEM,
      () => nativePayment({ extraTransfer: 1n }),
      () => nativePayment(),
    ],
  ] as const)
    test(`indexes an unusual ${name} payout and the later one`, async () => {
      const { db } = sqliteD1();
      const later = plain();
      later.transaction.signatures = [LATER];
      mockChain({
        mint,
        transactions: new Map<string, unknown>([
          [SIG, unusual()],
          [LATER, later],
        ]),
        // Newest first, as the RPC answers.
        history: [LATER, SIG],
      });
      const indexed: string[] = [];
      const adapter = solanaPaymentAdapter(config(mint));
      const index = async (event: {
        transactionId: string;
        eventIndex: number;
        kind: "paid" | "reserved";
        obligationId: string;
      }) => {
        await adapter.verifyFinalized(event);
        indexed.push(event.transactionId);
      };
      const deployment = {
        projectId: "p1",
        network: "solana-devnet",
        vault: VAULT,
        projectPda: PROJECT,
        programId: PROGRAM,
        genesisHash: "G",
      } as Parameters<typeof scanSolanaPayments>[1];
      // The first run discovers the signature page, the second processes it.
      for (let run = 0; run < 2; run++)
        await scanSolanaPayments(db, deployment, "http://rpc.invalid", index);
      expect(indexed).toEqual([SIG, LATER]);
      const cursor = await db
        .prepare("SELECT position FROM payment_chain_cursors")
        .first<{ position: string }>();
      expect(cursor?.position).toBe(LATER);
    });
});
