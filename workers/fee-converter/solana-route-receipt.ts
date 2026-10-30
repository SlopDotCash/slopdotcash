import { ed25519 } from "@noble/curves/ed25519.js";
import {
  solanaBase58,
  solanaBase64Bytes,
} from "../../contracts/solana/adapter";
import {
  nativeLamportDeltas,
  SOLANA_NATIVE_ASSET,
} from "../../contracts/solana/native";
import { ata } from "../../contracts/solana/transactions";
import { decodeBase58Bytes } from "../../src/lib/base58";
import type { ConversionRow } from "./core";
import { assertJupiterRoute } from "./jupiter-route";
import { parseTransaction } from "./solana";
import {
  associatedAccountCreations,
  retainedRouteExpectation,
  type SolanaAccountProof,
} from "./solana-accounts";

interface Balance {
  accountIndex: number;
  owner: string;
  mint: string;
  programId: string;
  uiTokenAmount: { amount: string };
}
export interface RouteReceipt {
  slot: number;
  transaction: [string, string];
  meta: {
    err: unknown;
    fee?: number;
    preBalances?: number[];
    postBalances?: number[];
    loadedAddresses?: { writable: string[]; readonly: string[] };
    preTokenBalances: Balance[];
    postTokenBalances: Balance[];
  };
}

/** Reconcile the retained signed route, including its loaded accounts and both assets. */
export function finalizedRouteCredit(
  row: ConversionRow,
  proof: SolanaAccountProof,
  receipt: RouteReceipt,
): bigint {
  if (
    !row.rawTx ||
    !row.txId ||
    !proof.route ||
    !Number.isSafeInteger(receipt.slot) ||
    receipt.slot < 0 ||
    receipt.meta?.err !== null ||
    receipt.transaction?.[1] !== "base64" ||
    receipt.transaction[0] !== row.rawTx
  )
    throw new Error(
      "Finalized swap does not match its retained signed transaction",
    );
  if (
    receipt.slot <
    Math.max(...proof.route.accounts.map((account) => account.slot))
  )
    throw new Error("Finalized swap predates its signing account evidence");
  const raw = solanaBase64Bytes(row.rawTx),
    parsed = parseTransaction(raw),
    expected = retainedRouteExpectation(proof.route);
  if (
    expected.wallet !== row.feeWallet ||
    (expected.nativeInput
      ? row.token !== SOLANA_NATIVE_ASSET
      : expected.inputMint !== row.token) ||
    expected.outputMint !== row.targetToken ||
    expected.amountIn.toString() !== row.amountIn ||
    expected.minimumOut.toString() !== row.minAmountOut
  )
    throw new Error("Finalized swap differs from its retained allocation");
  assertJupiterRoute(raw, parsed, proof, expected);
  const signature = raw.slice(parsed.messageOffset - 64, parsed.messageOffset);
  if (
    solanaBase58(signature) !== row.txId ||
    !ed25519.verify(
      signature,
      raw.slice(parsed.messageOffset),
      decodeBase58Bytes(row.feeWallet),
    )
  )
    throw new Error("Finalized swap signature differs from the fee wallet");
  if (
    JSON.stringify(receipt.meta.loadedAddresses?.writable ?? []) !==
      JSON.stringify(proof.loadedWritable) ||
    JSON.stringify(receipt.meta.loadedAddresses?.readonly ?? []) !==
      JSON.stringify(proof.loadedReadonly)
  )
    throw new Error(
      "Finalized swap loaded accounts differ from signing evidence",
    );
  const balances = (values: Balance[]) => {
    if (!Array.isArray(values))
      throw new Error("Finalized swap token balances are missing");
    const result = new Map<number, Balance>();
    for (const value of values) {
      if (
        !Number.isInteger(value.accountIndex) ||
        !proof.keys[value.accountIndex] ||
        result.has(value.accountIndex) ||
        typeof value.uiTokenAmount?.amount !== "string" ||
        !/^(0|[1-9][0-9]*)$/u.test(value.uiTokenAmount.amount)
      )
        throw new Error("Finalized swap token balance evidence is malformed");
      result.set(value.accountIndex, value);
    }
    return result;
  };
  const before = balances(receipt.meta.preTokenBalances),
    after = balances(receipt.meta.postTokenBalances);
  const sourceIndex = proof.keys.indexOf(
    ata(expected.inputMint, expected.wallet, expected.inputProgram),
  );
  const destinationIndex = proof.keys.indexOf(
    ata(expected.outputMint, expected.wallet, expected.outputProgram),
  );
  const change = (
    index: number,
    mint: string,
    program: string,
    allowMissingBefore: boolean,
  ) => {
    const pre = before.get(index),
      post = after.get(index);
    for (const balance of [pre, post]) {
      if (
        balance &&
        (balance.owner !== expected.wallet ||
          balance.mint !== mint ||
          balance.programId !== program)
      )
        throw new Error(
          "Finalized swap token identity differs from its reviewed account",
        );
    }
    if (!post || (!pre && !allowMissingBefore))
      throw new Error("Finalized swap token account evidence is incomplete");
    return (
      BigInt(post.uiTokenAmount.amount) -
      BigInt(pre?.uiTokenAmount.amount ?? "0")
    );
  };
  const debit = -change(
    sourceIndex,
    expected.inputMint,
    expected.inputProgram,
    Boolean(expected.nativeInput),
  );
  const credit = change(
    destinationIndex,
    expected.outputMint,
    expected.outputProgram,
    true,
  );
  if (
    debit !== (expected.nativeInput ? 0n : expected.amountIn) ||
    credit < expected.minimumOut
  )
    throw new Error(
      "Finalized swap did not debit its exact input and credit its minimum output",
    );
  if (expected.nativeInput) {
    const changes = nativeLamportDeltas({ ...receipt.meta }, proof.keys);
    const rent = associatedAccountCreations(
      parsed,
      proof.keys,
      expected.wallet,
    ).reduce((sum, account) => {
      const change = changes.get(proof.keys[account.index]) ?? 0n;
      return sum + (change > 0n ? change : 0n);
    }, 0n);
    if ((changes.get(expected.wallet) ?? 0n) + rent !== -expected.amountIn)
      throw new Error(
        "Finalized native swap did not spend exactly its earned fee input",
      );
  }
  for (const [index, pre] of before) {
    if (
      pre.owner !== expected.wallet ||
      index === sourceIndex ||
      index === destinationIndex
    )
      continue;
    const post = after.get(index);
    if (
      !post ||
      post.owner !== pre.owner ||
      post.mint !== pre.mint ||
      post.programId !== pre.programId ||
      BigInt(post.uiTokenAmount.amount) < BigInt(pre.uiTokenAmount.amount)
    )
      throw new Error("Finalized swap debited an unrelated fee-wallet holding");
  }
  return credit;
}
