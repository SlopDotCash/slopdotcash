// spec/settlement/vaultSnapshots.md, "Retry recognizes the exact creation transaction before checking a revision"
import { Schema } from "effect";
import { contract } from "vibestack/testing";
import { type Bytes32, type EvmAddress, U128_MAX, uintWord } from "./abi.ts";
import { type MinedReceipt, type MinedTransaction, creationOf, creationPlan, evmCreationId, minedCreationIssue, monthlyPolicyIssue } from "./creation.ts";

const FACTORY = "0xe51abf8c6dbb3ca6e9ad09f2dc6ef141d7364aab" as EvmAddress;
const between = (minimum: bigint, maximum: bigint) => Schema.BigInt.check(Schema.isBetweenBigInt({ minimum, maximum }));
const hex = (bits: number) => between(1n, (1n << BigInt(bits)) - 1n);
const text = (value: bigint, bits: number) => value.toString(16).padStart(bits / 4, "0");

const terms = Schema.Struct({
  owner: hex(160),
  asset: hex(160),
  digest: hex(256),
  tx: hex(256),
  block: hex(256),
  cap: between(1n, U128_MAX),
  automatic: Schema.Boolean,
  bounty: Schema.Boolean,
});

export const onlyTheExactMinedCreationIsAccepted = contract({
  input: terms,
  run: (input) => {
    const value = { ...input, owner: text(input.owner, 160), asset: text(input.asset, 160), digest: text(input.digest, 256), tx: text(input.tx, 256), block: text(input.block, 256) };
    const creation = creationOf({ owner: `0x${value.owner}`, projectDigest: value.digest, asset: `0x${value.asset}`, bounty: value.bounty, monthlyCap: value.cap, automatic: value.automatic });
    const plan = creation === undefined ? undefined : creationPlan(FACTORY, creation);
    const transactionId = evmCreationId(`0x${value.tx.toUpperCase()}`) as Bytes32;
    const receipt: MinedReceipt = { transactionHash: `0x${value.tx}`, blockHash: `0x${value.block}`, blockNumber: 7n, status: "success" };
    const transaction: MinedTransaction = plan === undefined
      ? { hash: `0x${value.tx}`, from: "", to: undefined, input: "0x", value: 0n, blockHash: receipt.blockHash }
      : { hash: `0x${value.tx}`, from: plan.from, to: plan.to, input: plan.data, value: 0n, blockHash: receipt.blockHash };
    const block = { hash: receipt.blockHash, number: 7n };
    const check = (changed: { readonly receipt?: MinedReceipt; readonly transaction?: MinedTransaction; readonly block?: { hash: string; number: bigint } }) =>
      plan === undefined ? "noPlan" : minedCreationIssue({ transactionId, receipt: changed.receipt ?? receipt, transaction: changed.transaction ?? transaction, block: changed.block ?? block, plan });
    return {
      exact: check({}),
      otherBlock: check({ block: { ...block, number: 8n } }),
      otherSender: check({ transaction: { ...transaction, from: `0x${"1".repeat(40)}` } }),
      paid: check({ transaction: { ...transaction, value: 1n } }),
      reverted: check({ receipt: { ...receipt, status: "reverted" } }),
      policy: creation === undefined ? "noPlan" : monthlyPolicyIssue(creation, uintWord(value.cap), uintWord(value.automatic ? 1n : 0n)),
      otherPolicy: creation === undefined ? "noPlan" : monthlyPolicyIssue(creation, uintWord(value.cap - 1n), uintWord(value.automatic ? 1n : 0n)),
    };
  },
  invariant: (input, outcome) =>
    outcome.exact === undefined
    && outcome.otherBlock === "receiptMismatch"
    && outcome.otherSender === "transactionMismatch"
    && outcome.paid === "transactionMismatch"
    && outcome.reverted === "creationFailed"
    && outcome.policy === undefined
    && outcome.otherPolicy === (input.bounty ? undefined : "policyDiffers"),
});
