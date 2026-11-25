// The off-chain view of the deposit program: instructions and layouts follow
// the IDL, and a deposit's record is addressed by its payer and nonce.
import { expect, test } from "bun:test";
import { bytesToHex } from "../../src/lib/byte-encoding";
import { fakeAddress } from "../../workers/submission-fee/solana-fake";
import { solanaAssociatedTokenAddress, solanaBase58 } from "./adapter";
import {
  decodeSubmissionConfig,
  decodeSubmissionDeposit,
  depositInstruction,
  reclaimInstruction,
  resolveInstruction,
  SUBMISSION_DEPOSITS_IDL,
  submissionConfigAddress,
  submissionDepositAddress,
  submissionLedgerAddress,
  submissionVaultAddress,
} from "./submission-deposits";
import { CLASSIC_TOKEN_PROGRAM } from "./token";

const PROGRAM = fakeAddress(200);
const MINT = fakeAddress(201);
const PAYER = fakeAddress(11);
const KEPT = fakeAddress(202);
const ITEM = `0x${"ab".repeat(32)}`;
const idl = SUBMISSION_DEPOSITS_IDL;
const u64 = (value: bigint) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
};

test("a deposit's record is addressed by its payer and the nonce the payer picked", () => {
  const first = submissionDepositAddress(PROGRAM, PAYER, 1n);
  expect(submissionDepositAddress(PROGRAM, PAYER, 1n)).toBe(first);
  expect(submissionDepositAddress(PROGRAM, PAYER, 2n)).not.toBe(first);
  expect(submissionDepositAddress(PROGRAM, KEPT, 1n)).not.toBe(first);
  expect(() => submissionDepositAddress(PROGRAM, PAYER, 1n << 64n)).toThrow(
    "64-bit",
  );
  expect(() => submissionDepositAddress(PROGRAM, PAYER, -1n)).toThrow("64-bit");
});

test("deposit carries the item, the exact amount, the kept wallet and the nonce, in the IDL's order", () => {
  const nonce = 0x0102030405060708n;
  const built = depositInstruction(
    {
      programId: PROGRAM,
      payer: PAYER,
      mint: MINT,
      source: solanaAssociatedTokenAddress(MINT, PAYER),
      item: ITEM,
      amount: 2_000_000n,
      keptTo: KEPT,
      nonce,
    },
    idl,
  );
  const spec = idl.instructions.find((entry) => entry.name === "deposit");
  expect(built.program).toBe(PROGRAM);
  expect(bytesToHex(built.data.slice(0, 8))).toBe(
    bytesToHex(Uint8Array.from(spec?.discriminator ?? [])),
  );
  expect(bytesToHex(built.data.slice(8, 40))).toBe(ITEM.slice(2));
  expect(bytesToHex(built.data.slice(40, 48))).toBe(
    bytesToHex(u64(2_000_000n)),
  );
  expect(solanaBase58(built.data.slice(48, 80))).toBe(KEPT);
  expect(bytesToHex(built.data.slice(80))).toBe(bytesToHex(u64(nonce)));
  const named = Object.fromEntries(
    (spec?.accounts ?? []).map((meta, index) => [meta.name, built.accounts[index]]),
  );
  expect(named.payer).toEqual({ key: PAYER, write: true });
  expect(named.config.key).toBe(submissionConfigAddress(PROGRAM));
  expect(named.ledger.key).toBe(submissionLedgerAddress(PROGRAM, MINT));
  expect(named.vault.key).toBe(submissionVaultAddress(PROGRAM, MINT));
  expect(named.deposit).toEqual({
    key: submissionDepositAddress(PROGRAM, PAYER, nonce),
    write: true,
  });
  expect(named.token_program).toEqual({
    key: CLASSIC_TOKEN_PROGRAM,
    write: false,
  });
});

test("resolve never takes a destination: a refund goes to the payer's associated account, a kept fee to the kept wallet's", () => {
  const record = { id: 9, payer: PAYER, mint: MINT, keptTo: KEPT };
  const deposit = submissionDepositAddress(PROGRAM, PAYER, 5n);
  const spec = idl.instructions.find((entry) => entry.name === "resolve");
  const at = (name: string) =>
    (spec?.accounts ?? []).findIndex((meta) => meta.name === name);
  for (const refund of [true, false]) {
    const built = resolveInstruction(
      { programId: PROGRAM, resolver: KEPT, deposit, record, refund },
      idl,
    );
    expect(built.data[8]).toBe(refund ? 1 : 0);
    // Where the program takes the expected id, it is the record's own.
    if (spec?.args.some((argument) => argument.name === "expected_id")) {
      expect(built.data.length).toBe(17);
      expect(
        new DataView(built.data.buffer, built.data.byteOffset).getBigUint64(
          9,
          true,
        ),
      ).toBe(9n);
    } else expect(built.data.length).toBe(9);
    expect(built.accounts[at("deposit")].key).toBe(deposit);
    expect(built.accounts[at("destination")].key).toBe(
      solanaAssociatedTokenAddress(MINT, refund ? PAYER : KEPT),
    );
    expect(built.accounts[at("payer")].key).toBe(PAYER);
  }
  const reclaim = reclaimInstruction(
    {
      programId: PROGRAM,
      payer: PAYER,
      deposit,
      mint: MINT,
      destination: solanaAssociatedTokenAddress(MINT, PAYER),
    },
    idl,
  );
  expect(reclaim.data.length).toBe(8);
  expect(reclaim.accounts[0]).toEqual({ key: PAYER, write: true });
});

test("an account of another size or kind is refused", () => {
  const bytes = (name: string, size: number) => {
    const account = idl.accounts.find((entry) => entry.name === name);
    const data = new Uint8Array(size);
    data.set(account?.discriminator ?? [], 0);
    return data;
  };
  const deposit = idl.types.find((entry) => entry.name === "Deposit");
  const size =
    8 +
    (deposit?.type.fields ?? []).reduce(
      (total, field) =>
        total +
        (typeof field.type === "string"
          ? { pubkey: 32, u64: 8, i64: 8, bool: 1, u8: 1 }[field.type] ?? 0
          : field.type.array[1]),
      0,
    );
  // An all-zero record has id 0 and amount 0: not a deposit.
  expect(() => decodeSubmissionDeposit(bytes("Deposit", size), idl)).toThrow(
    "Unexpected deposit record",
  );
  expect(() =>
    decodeSubmissionDeposit(bytes("Deposit", size + 1), idl),
  ).toThrow("layout");
  expect(() => decodeSubmissionDeposit(bytes("Config", size), idl)).toThrow(
    "layout",
  );
  expect(() => decodeSubmissionConfig(bytes("Deposit", 122), idl)).toThrow(
    "layout",
  );
});
