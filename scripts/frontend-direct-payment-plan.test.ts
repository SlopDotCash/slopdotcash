/**
 * Direct-payment plan validation and unreadable-record recovery.
 *
 * F1: before the fix, the payment components signed whatever transaction
 * the server plan contained, checking only the payer, chain, nonce and gas
 * estimate (EVM) or only decoding the transaction (Solana). The approved
 * transfers were displayed for a human to compare, but nothing in code
 * compared them. These tests build the valid plans with the same builders
 * the server uses (`backend/security/direct-evm.ts` `evmDirectTransactions`
 * and `contracts/solana/transactions.ts` `message`), then tamper one field
 * at a time: every tampered plan must fail the check, so the component
 * refuses to sign it.
 * F7: a saved request the component cannot parse has no attempt identity
 * to compare, so clearing it must compare the raw bytes it was read as.
 * PRD section 6: "Mark an obligation paid only after finalized evidence
 * reconciles its exact vault or direct-payment source, recipient,
 * principal, fee, and asset. Reject replay, wrong owner, wrong asset,
 * partial completion, failed transfers, duplicates, and overpayment."
 * Model: formal/models/ui/ui_bounty_payment_parent.qnt (payment assembly;
 * the new check is a pre-sign guard on the same plan).
 */

import { expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { evmDirectTransactions } from "../backend/security/direct-evm";
import { solanaAssociatedTokenAddress } from "../contracts/solana/adapter";
import {
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "../contracts/solana/token-extensions";
import {
  concat,
  createAta,
  le,
  message,
  SYSTEM,
} from "../contracts/solana/transactions";
import { encodeBase58Bytes } from "../src/lib/base58";
import { encodeBase64 } from "../src/lib/byte-encoding";
import {
  matchesApprovedEvmPlan,
  matchesApprovedSolanaPlan,
} from "../src/lib/direct-payment-plan";
import { clearUnreadableRecord } from "../src/lib/pending-attempt";

const payer = `0x${"11".repeat(20)}`;
const researcher = `0x${"22".repeat(20)}`;
const fee = `0x${"33".repeat(20)}`;
const attacker = `0x${"44".repeat(20)}`;
const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const otherToken = `0x${"55".repeat(20)}`;
const nativeAsset = "0x0000000000000000000000000000000000000000";
const transfers = [
  { recipient: researcher, amountBase: "7500" },
  { recipient: fee, amountBase: "2500" },
];

const solanaAddress = (fill: number) =>
  encodeBase58Bytes(new Uint8Array(32).fill(fill));
const solPayer = solanaAddress(1);
const solResearcher = solanaAddress(2);
const solFee = solanaAddress(3);
const solAttacker = solanaAddress(4);
const solMint = solanaAddress(5);
const solOtherMint = solanaAddress(6);
const solBlockhash = solanaAddress(7);
const solTransfers = [
  { recipient: solResearcher, amountBase: "7500" },
  { recipient: solFee, amountBase: "2500" },
];
const solAsset = { address: solMint, decimals: 6 };

function solanaPlan(
  instructions: Parameters<typeof message>[2],
  payerOverride = solPayer,
) {
  const wireMessage = message(payerOverride, solBlockhash, instructions);
  const wire = concat(Uint8Array.of(1), new Uint8Array(64), wireMessage);
  return {
    transaction: encodeBase64(wire),
    messageId: encodeBase58Bytes(sha256(wireMessage)),
  };
}

function systemTransfer(recipient: string, amount: bigint) {
  return {
    program: SYSTEM,
    accounts: [
      { key: solPayer, write: true },
      { key: recipient, write: true },
    ],
    data: concat(Uint8Array.of(2, 0, 0, 0), le(amount)),
  };
}

function splTransfers() {
  const instructions = [];
  for (const transfer of solTransfers)
    instructions.push(createAta(solPayer, solMint, transfer.recipient));
  for (const transfer of solTransfers) {
    const source = solanaAssociatedTokenAddress(solMint, solPayer);
    const destination = solanaAssociatedTokenAddress(
      solMint,
      transfer.recipient,
    );
    instructions.push({
      program: TOKEN_PROGRAM,
      accounts: [
        { key: source, write: true },
        { key: solMint, write: false },
        { key: destination, write: true },
        { key: solPayer, write: false },
      ],
      data: concat(
        Uint8Array.of(12),
        le(BigInt(transfer.amountBase)),
        Uint8Array.of(6),
      ),
    });
  }
  return instructions;
}

test("F1: a server-built ERC-20 plan matches the approved transfers", () => {
  const transactions = evmDirectTransactions({
    rpcUrl: "https://example.invalid",
    chainId: "0x1",
    payer,
    asset: { address: usdc, decimals: 6 },
    transfers,
    nonces: ["0", "1"],
  });
  expect(matchesApprovedEvmPlan(transactions, transfers, usdc)).toBe(true);
});

test("F1: a server-built native plan matches the approved transfers", () => {
  const transactions = evmDirectTransactions({
    rpcUrl: "https://example.invalid",
    chainId: "0x1",
    payer,
    asset: { address: nativeAsset, decimals: 18 },
    transfers,
    nonces: ["0", "1"],
  });
  expect(matchesApprovedEvmPlan(transactions, transfers, nativeAsset)).toBe(
    true,
  );
});

test("F1: a tampered EVM recipient, amount, asset or value fails the check", () => {
  const transactions = evmDirectTransactions({
    rpcUrl: "https://example.invalid",
    chainId: "0x1",
    payer,
    asset: { address: usdc, decimals: 6 },
    transfers,
    nonces: ["0", "1"],
  });
  const wrongRecipient = evmDirectTransactions({
    rpcUrl: "https://example.invalid",
    chainId: "0x1",
    payer,
    asset: { address: usdc, decimals: 6 },
    transfers: [{ recipient: attacker, amountBase: "7500" }, transfers[1]],
    nonces: ["0", "1"],
  });
  expect(matchesApprovedEvmPlan(wrongRecipient, transfers, usdc)).toBe(false);
  const wrongAmount = evmDirectTransactions({
    rpcUrl: "https://example.invalid",
    chainId: "0x1",
    payer,
    asset: { address: usdc, decimals: 6 },
    transfers: [{ recipient: researcher, amountBase: "7501" }, transfers[1]],
    nonces: ["0", "1"],
  });
  expect(matchesApprovedEvmPlan(wrongAmount, transfers, usdc)).toBe(false);
  expect(matchesApprovedEvmPlan(transactions, transfers, otherToken)).toBe(
    false,
  );
  expect(
    matchesApprovedEvmPlan(transactions.slice(0, 1), transfers, usdc),
  ).toBe(false);
  expect(
    matchesApprovedEvmPlan([...transactions, transactions[0]], transfers, usdc),
  ).toBe(false);
  const native = evmDirectTransactions({
    rpcUrl: "https://example.invalid",
    chainId: "0x1",
    payer,
    asset: { address: nativeAsset, decimals: 18 },
    transfers,
    nonces: ["0", "1"],
  });
  expect(
    matchesApprovedEvmPlan(
      [{ ...native[0], value: "0x1d4c" }],
      transfers,
      nativeAsset,
    ),
  ).toBe(false);
  expect(
    matchesApprovedEvmPlan(
      [{ ...native[0], to: attacker }],
      transfers,
      nativeAsset,
    ),
  ).toBe(false);
});

test("F1: a server-built native Solana plan matches the approved transfers", () => {
  const plan = solanaPlan(
    solTransfers.map((transfer) =>
      systemTransfer(transfer.recipient, BigInt(transfer.amountBase)),
    ),
  );
  expect(
    matchesApprovedSolanaPlan(
      plan,
      solTransfers,
      { address: "11111111111111111111111111111111", decimals: 9 },
      solPayer,
    ),
  ).toBe(true);
});

test("F1: a server-built SPL Solana plan matches the approved transfers", () => {
  const plan = solanaPlan(splTransfers());
  expect(
    matchesApprovedSolanaPlan(plan, solTransfers, solAsset, solPayer),
  ).toBe(true);
});

test("F1: a tampered Solana plan fails the check", () => {
  const native = solanaPlan(
    solTransfers.map((transfer) =>
      systemTransfer(transfer.recipient, BigInt(transfer.amountBase)),
    ),
  );
  const nativeAsset = {
    address: "11111111111111111111111111111111",
    decimals: 9,
  };
  expect(
    matchesApprovedSolanaPlan(native, solTransfers, nativeAsset, solPayer),
  ).toBe(true);
  const wrongRecipient = solanaPlan([
    systemTransfer(solAttacker, 7500n),
    systemTransfer(solFee, 2500n),
  ]);
  expect(
    matchesApprovedSolanaPlan(
      wrongRecipient,
      solTransfers,
      nativeAsset,
      solPayer,
    ),
  ).toBe(false);
  const wrongAmount = solanaPlan([
    systemTransfer(solResearcher, 7501n),
    systemTransfer(solFee, 2500n),
  ]);
  expect(
    matchesApprovedSolanaPlan(wrongAmount, solTransfers, nativeAsset, solPayer),
  ).toBe(false);
  const extraInstruction = solanaPlan([
    systemTransfer(solResearcher, 7500n),
    systemTransfer(solFee, 2500n),
    systemTransfer(solAttacker, 1n),
  ]);
  expect(
    matchesApprovedSolanaPlan(
      extraInstruction,
      solTransfers,
      nativeAsset,
      solPayer,
    ),
  ).toBe(false);
  const wrongPayer = solanaPlan(
    solTransfers.map((transfer) =>
      systemTransfer(transfer.recipient, BigInt(transfer.amountBase)),
    ),
    solAttacker,
  );
  expect(
    matchesApprovedSolanaPlan(wrongPayer, solTransfers, nativeAsset, solPayer),
  ).toBe(false);
  expect(
    matchesApprovedSolanaPlan(
      { ...native, messageId: solBlockhash },
      solTransfers,
      nativeAsset,
      solPayer,
    ),
  ).toBe(false);
  const spl = solanaPlan(splTransfers());
  expect(matchesApprovedSolanaPlan(spl, solTransfers, solAsset, solPayer)).toBe(
    true,
  );
  const wrongMint = solanaPlan([
    createAta(solPayer, solMint, solResearcher),
    createAta(solPayer, solMint, solFee),
    {
      program: TOKEN_PROGRAM,
      accounts: [
        {
          key: solanaAssociatedTokenAddress(solMint, solPayer),
          write: true,
        },
        { key: solOtherMint, write: false },
        {
          key: solanaAssociatedTokenAddress(solMint, solResearcher),
          write: true,
        },
        { key: solPayer, write: false },
      ],
      data: concat(Uint8Array.of(12), le(7500n), Uint8Array.of(6)),
    },
    {
      program: TOKEN_PROGRAM,
      accounts: [
        {
          key: solanaAssociatedTokenAddress(solMint, solPayer),
          write: true,
        },
        { key: solMint, write: false },
        {
          key: solanaAssociatedTokenAddress(solMint, solFee),
          write: true,
        },
        { key: solPayer, write: false },
      ],
      data: concat(Uint8Array.of(12), le(2500n), Uint8Array.of(6)),
    },
  ]);
  expect(
    matchesApprovedSolanaPlan(wrongMint, solTransfers, solAsset, solPayer),
  ).toBe(false);
  const memo = solanaPlan([
    systemTransfer(solResearcher, 7500n),
    systemTransfer(solFee, 2500n),
    {
      program: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
      accounts: [],
      data: new Uint8Array(0),
    },
  ]);
  expect(
    matchesApprovedSolanaPlan(memo, solTransfers, nativeAsset, solPayer),
  ).toBe(false);
  expect(
    matchesApprovedSolanaPlan(spl, solTransfers, solAsset, solAttacker),
  ).toBe(false);
});

test("F1: the Token-2022 program is accepted for SPL transfers", () => {
  const instructions = [];
  for (const transfer of solTransfers)
    instructions.push(
      createAta(solPayer, solMint, transfer.recipient, TOKEN_2022_PROGRAM),
    );
  for (const transfer of solTransfers) {
    instructions.push({
      program: TOKEN_2022_PROGRAM,
      accounts: [
        {
          key: solanaAssociatedTokenAddress(
            solMint,
            solPayer,
            TOKEN_2022_PROGRAM,
          ),
          write: true,
        },
        { key: solMint, write: false },
        {
          key: solanaAssociatedTokenAddress(
            solMint,
            transfer.recipient,
            TOKEN_2022_PROGRAM,
          ),
          write: true,
        },
        { key: solPayer, write: false },
      ],
      data: concat(
        Uint8Array.of(12),
        le(BigInt(transfer.amountBase)),
        Uint8Array.of(6),
      ),
    });
  }
  const plan = solanaPlan(instructions);
  expect(
    matchesApprovedSolanaPlan(plan, solTransfers, solAsset, solPayer),
  ).toBe(true);
});

const journalKey = "slop:frontend-payments:v1:example";
const journalStore = new Map<string, string>();
const journalStorage = {
  getItem: (key: string) => journalStore.get(key) ?? null,
  setItem: (key: string, value: string) => void journalStore.set(key, value),
  removeItem: (key: string) => void journalStore.delete(key),
} as Storage;

test("F7: an unreadable record clears only when the tab did not change it", () => {
  journalStore.set(journalKey, "{not json");
  expect(clearUnreadableRecord(journalKey, "{not json", journalStorage)).toBe(
    true,
  );
  expect(journalStore.has(journalKey)).toBe(false);
  journalStore.set(journalKey, "{not json");
  expect(
    clearUnreadableRecord(journalKey, '{"nonce":"0"}', journalStorage),
  ).toBe(false);
  expect(journalStore.has(journalKey)).toBe(true);
});
