import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  solanaBase58,
  solanaBase64,
  solanaBase64Bytes,
  solanaPublicKeyBytes,
  solanaRpc,
} from "../../contracts/solana/adapter";
import { nativeLamportDeltas } from "../../contracts/solana/native";
import {
  readTokenAccount,
  readTokenMint,
} from "../../contracts/solana/token-extensions";
import {
  ata,
  concat,
  createAta,
  type Instruction,
  le,
  message,
  SYSTEM,
} from "../../contracts/solana/transactions";
import { SOLANA_NATIVE_ASSET } from "../../src/lib/escrow-policy.mjs";
import { isExactUtc } from "../../src/lib/record-validation.mjs";

export type SolanaDirectInput = {
  rpcUrl: string;
  genesisHash: string;
  payer: string;
  asset: { address: string; decimals: number };
  transfers: { recipient: string; amountBase: string }[];
  allowedMessages?: string[];
};
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Solana returned an invalid record");
  return value as RecordValue;
};
const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Solana returned an invalid list");
  return value;
};
const integer = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error("Solana returned an inexact integer");
  return Number(value);
};
const U64 = (1n << 64n) - 1n;
function amount(value: string): bigint {
  if (!/^[1-9]\d{0,19}$/u.test(value) || BigInt(value) > U64)
    throw new Error("Direct SOL/SPL amounts must be positive u64 base units");
  return BigInt(value);
}
function key(value: string) {
  if (solanaBase58(solanaPublicKeyBytes(value)) !== value)
    throw new Error("Noncanonical Solana address");
  return value;
}
const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length &&
  left.every((byte, index) => byte === right[index]);

async function account(input: SolanaDirectInput, address: string) {
  return record(
    await solanaRpc(input, "getAccountInfo", [
      address,
      { commitment: "finalized", encoding: "base64" },
    ]),
  ).value;
}

async function instructions(input: SolanaDirectInput) {
  key(input.payer);
  key(input.asset.address);
  if ((await solanaRpc(input, "getGenesisHash", [])) !== input.genesisHash)
    throw new Error("Wrong Solana cluster");
  if (
    !Number.isInteger(input.asset.decimals) ||
    input.asset.decimals < 0 ||
    input.asset.decimals > 36
  )
    throw new Error("Invalid asset decimals");
  if (input.transfers.length < 1 || input.transfers.length > 2)
    throw new Error("A direct award needs one or two transfers");
  const recipients = new Map<string, bigint>();
  let total = 0n;
  for (const transfer of input.transfers) {
    key(transfer.recipient);
    if (transfer.recipient === input.payer)
      throw new Error("A direct award must move funds to another wallet");
    const value = amount(transfer.amountBase);
    total += value;
    recipients.set(
      transfer.recipient,
      (recipients.get(transfer.recipient) ?? 0n) + value,
    );
  }
  if (total > U64)
    throw new Error("Direct award exceeds the Solana amount limit");
  if (input.asset.address === SOLANA_NATIVE_ASSET) {
    if (input.asset.decimals !== 9)
      throw new Error("Native SOL has nine decimals");
    return {
      native: true,
      tokenProgram: null,
      source: input.payer,
      recipients,
      total,
      instructions: input.transfers.map(
        (transfer): Instruction => ({
          program: SYSTEM,
          accounts: [
            { key: input.payer, write: true },
            { key: transfer.recipient, write: true },
          ],
          data: concat(
            Uint8Array.of(2, 0, 0, 0),
            le(amount(transfer.amountBase)),
          ),
        }),
      ),
    };
  }
  const mint = readTokenMint(
    await account(input, input.asset.address),
    solanaPublicKeyBytes(input.asset.address),
  );
  if (mint.decimals !== input.asset.decimals)
    throw new Error("The mint decimals differ from the frozen award");
  const source = ata(input.asset.address, input.payer, mint.program);
  const transfers: Instruction[] = [...recipients.keys()].map((recipient) =>
    createAta(input.payer, input.asset.address, recipient, mint.program),
  );
  for (const transfer of input.transfers)
    transfers.push({
      program: mint.program,
      accounts: [
        { key: source, write: true },
        { key: input.asset.address, write: false },
        {
          key: ata(input.asset.address, transfer.recipient, mint.program),
          write: true,
        },
        { key: input.payer, write: false },
      ],
      data: concat(
        Uint8Array.of(12),
        le(amount(transfer.amountBase)),
        Uint8Array.of(input.asset.decimals),
      ),
    });
  return {
    native: false,
    tokenProgram: mint.program,
    source,
    recipients,
    total,
    instructions: transfers,
  };
}

function tokenAccount(
  value: unknown,
  mint: string,
  owner: string,
  program: string,
) {
  const token = readTokenAccount(value);
  const bytes = token.raw;
  if (
    token.program !== program ||
    solanaBase58(bytes.slice(0, 32)) !== mint ||
    solanaBase58(bytes.slice(32, 64)) !== owner ||
    bytes[108] !== 1
  )
    throw new Error(
      "The direct-transfer token account has the wrong identity or state",
    );
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getBigUint64(64, true);
}

/** Unsigned wallet transfer only: no escrow, signing or broadcast. */
export async function prepareSolanaDirect(input: SolanaDirectInput): Promise<{
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  afterSlot: string;
  blockhashSlot: number;
  messageId: string;
}> {
  const plan = await instructions(input);
  const afterSlot = String(
    integer(await solanaRpc(input, "getSlot", [{ commitment: "confirmed" }])),
  );
  const latestResponse = record(
    await solanaRpc(input, "getLatestBlockhash", [{ commitment: "finalized" }]),
  );
  const latest = record(latestResponse.value);
  const blockhashSlot = integer(record(latestResponse.context).slot);
  const anchor = record(
    await solanaRpc(input, "getBlock", [
      blockhashSlot,
      {
        commitment: "finalized",
        transactionDetails: "none",
        rewards: false,
        maxSupportedTransactionVersion: 0,
      },
    ]),
  );
  if (anchor.blockhash !== latest.blockhash)
    throw new Error("The payment blockhash has no canonical slot anchor");
  const blockhash = key(String(latest.blockhash));
  const unsignedMessage = message(input.payer, blockhash, plan.instructions);
  const fee = integer(
    record(
      await solanaRpc(input, "getFeeForMessage", [
        solanaBase64(unsignedMessage),
        { commitment: "finalized" },
      ]),
    ).value,
  );
  const rent = integer(
    await solanaRpc(input, "getMinimumBalanceForRentExemption", [
      0,
      { commitment: "finalized" },
    ]),
  );
  const payerAccount = record(await account(input, input.payer));
  if (payerAccount.owner !== SYSTEM)
    throw new Error("The payer is not a native wallet account");
  let required = BigInt(fee + rent) + (plan.native ? plan.total : 0n);
  if (!plan.native && plan.tokenProgram) {
    if (
      tokenAccount(
        await account(input, plan.source),
        input.asset.address,
        input.payer,
        plan.tokenProgram,
      ) < plan.total
    )
      throw new Error("The payer has insufficient tokens for this award");
    for (const recipient of plan.recipients.keys()) {
      const destination = await account(
        input,
        ata(input.asset.address, recipient, plan.tokenProgram),
      );
      if (destination === null) {
        const size =
          plan.tokenProgram === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            ? 165
            : 170;
        required += BigInt(
          integer(
            await solanaRpc(input, "getMinimumBalanceForRentExemption", [
              size,
              { commitment: "finalized" },
            ]),
          ),
        );
      } else
        tokenAccount(
          destination,
          input.asset.address,
          recipient,
          plan.tokenProgram,
        );
    }
  }
  if (BigInt(integer(payerAccount.lamports)) < required)
    throw new Error(
      "The payer needs the award, transaction fee and account rent",
    );
  const transaction = solanaBase64(
    concat(Uint8Array.of(1), new Uint8Array(64), unsignedMessage),
  );
  const simulation = record(
    record(
      await solanaRpc(input, "simulateTransaction", [
        transaction,
        { encoding: "base64", commitment: "finalized", sigVerify: false },
      ]),
    ).value,
  );
  if (simulation.err !== null)
    throw new Error(
      "The direct award simulation failed; check funds and recipient account rent",
    );
  return {
    transaction,
    blockhash,
    lastValidBlockHeight: integer(latest.lastValidBlockHeight),
    afterSlot,
    blockhashSlot,
    messageId: solanaBase58(sha256(unsignedMessage)),
  };
}

function messageKeys(bytes: Uint8Array) {
  if (bytes[0] !== 1 || bytes[1] !== 0)
    throw new Error("Direct award has unexpected signers or version");
  let offset = 3;
  let count = 0;
  for (let shift = 0; ; shift += 7) {
    const byte = bytes[offset++];
    if (byte === undefined || shift > 14)
      throw new Error("Invalid message account count");
    count |= (byte & 127) << shift;
    if (!(byte & 128)) break;
  }
  if (count < 2 || count > 32 || offset + 32 * (count + 1) > bytes.length)
    throw new Error("Invalid direct award account list");
  const keys = Array.from({ length: count }, (_, index) =>
    solanaBase58(bytes.slice(offset + index * 32, offset + (index + 1) * 32)),
  );
  return {
    keys,
    blockhash: solanaBase58(
      bytes.slice(offset + count * 32, offset + (count + 1) * 32),
    ),
  };
}

/** Finalized proof must reconcile the exact immutable direct-payment intent. */
export async function verifySolanaDirect(
  input: SolanaDirectInput & {
    transactionId: string;
    notBefore: string;
    afterSlot: string;
  },
): Promise<{
  transactionId: string;
  blockHash: string;
  blockNumber: string;
  blockTime: number;
}> {
  if (!isExactUtc(input.notBefore))
    throw new Error("Missing direct-payment intent time");
  if (!/^(0|[1-9]\d{0,19})$/u.test(input.afterSlot))
    throw new Error("Missing direct-payment intent slot");
  const plan = await instructions(input);
  const status = record(
    list(
      record(
        await solanaRpc(input, "getSignatureStatuses", [
          [input.transactionId],
          { searchTransactionHistory: true },
        ]),
      ).value,
    )[0],
  );
  if (status.err !== null || status.confirmationStatus !== "finalized")
    throw new Error("The direct award is not finalized successfully");
  const receipt = record(
    await solanaRpc(input, "getTransaction", [
      input.transactionId,
      {
        commitment: "finalized",
        encoding: "base64",
        maxSupportedTransactionVersion: 0,
      },
    ]),
  );
  const meta = record(receipt.meta);
  if (meta.err !== null || integer(receipt.slot) !== integer(status.slot))
    throw new Error("The finalized receipt failed or its slot differs");
  if (BigInt(integer(receipt.slot)) <= BigInt(input.afterSlot))
    throw new Error("The direct payment predates its intent slot");
  // The captured chain slot establishes ordering. Chain time can lag the
  // host's intent timestamp, which is retained only as audit metadata.
  const encoded = list(receipt.transaction);
  if (typeof encoded[0] !== "string" || encoded[1] !== "base64")
    throw new Error("Missing raw direct transaction");
  const wire = solanaBase64Bytes(encoded[0]);
  if (wire[0] !== 1 || wire.length > 1232)
    throw new Error("Unexpected direct transaction signatures");
  const signature = wire.slice(1, 65);
  const actualMessage = wire.slice(65);
  if (
    input.allowedMessages &&
    !input.allowedMessages.some((value) =>
      sameBytes(actualMessage, solanaBase64Bytes(value).slice(65)),
    )
  )
    throw new Error("The transaction is not a retained issued payment request");
  const { keys, blockhash } = messageKeys(actualMessage);
  if (
    solanaBase58(signature) !== input.transactionId ||
    !sameBytes(
      actualMessage,
      message(input.payer, blockhash, plan.instructions),
    ) ||
    !ed25519.verify(signature, actualMessage, solanaPublicKeyBytes(input.payer))
  )
    throw new Error("The signed direct transfer differs from the award");
  const deltas = nativeLamportDeltas(meta, keys);
  const expectedLamports = new Map<string, bigint>([
    [input.payer, plan.native ? -plan.total : 0n],
  ]);
  if (plan.native) {
    for (const [recipient, value] of plan.recipients)
      expectedLamports.set(recipient, value);
    if (
      list(meta.preTokenBalances ?? []).length ||
      list(meta.postTokenBalances ?? []).length
    )
      throw new Error("Native award unexpectedly changed token accounts");
  } else if (plan.tokenProgram) {
    const expectedTokens = new Map<string, { owner: string; delta: bigint }>([
      [plan.source, { owner: input.payer, delta: -plan.total }],
    ]);
    for (const [recipient, value] of plan.recipients)
      expectedTokens.set(
        ata(input.asset.address, recipient, plan.tokenProgram),
        { owner: recipient, delta: value },
      );
    const balances = (value: unknown) => {
      const result = new Map<string, bigint>();
      for (const item of list(value)) {
        const row = record(item),
          address = keys[integer(row.accountIndex)],
          expected = expectedTokens.get(address);
        const token = record(row.uiTokenAmount);
        if (
          !expected ||
          row.owner !== expected.owner ||
          row.mint !== input.asset.address ||
          token.decimals !== input.asset.decimals ||
          (row.programId !== undefined &&
            row.programId !== plan.tokenProgram) ||
          typeof token.amount !== "string" ||
          !/^(0|[1-9]\d{0,19})$/u.test(token.amount)
        )
          throw new Error("The token receipt has the wrong asset or owner");
        if (result.has(address)) throw new Error("Duplicate token balance");
        result.set(address, BigInt(token.amount));
      }
      return result;
    };
    const before = balances(meta.preTokenBalances),
      after = balances(meta.postTokenBalances);
    const preLamports = list(meta.preBalances),
      postLamports = list(meta.postBalances);
    for (const [address, expected] of expectedTokens) {
      if (
        !after.has(address) ||
        (after.get(address) ?? 0n) - (before.get(address) ?? 0n) !==
          expected.delta ||
        (address === plan.source && !before.has(address))
      )
        throw new Error("The token transfer balances differ from the award");
      const index = keys.indexOf(address),
        prior = integer(preLamports[index]),
        next = integer(postLamports[index]);
      if (prior === 0 && address !== plan.source) {
        if (before.has(address) || next === 0)
          throw new Error("Invalid new token account rent");
        expectedLamports.set(address, BigInt(next));
        expectedLamports.set(
          input.payer,
          (expectedLamports.get(input.payer) ?? 0n) - BigInt(next),
        );
      } else if (prior !== next)
        throw new Error("Existing token account rent changed");
    }
  }
  for (const [address, delta] of deltas)
    if (delta !== (expectedLamports.get(address) ?? 0n))
      throw new Error("Unexpected native balance change in direct award");
  const reserve = integer(
    await solanaRpc(input, "getMinimumBalanceForRentExemption", [
      0,
      { commitment: "finalized" },
    ]),
  );
  if (integer(list(meta.postBalances)[0]) < reserve)
    throw new Error("Direct payment spent the payer's rent reserve");
  const block = record(
    await solanaRpc(input, "getBlock", [
      integer(receipt.slot),
      {
        commitment: "finalized",
        transactionDetails: "signatures",
        rewards: false,
        maxSupportedTransactionVersion: 0,
      },
    ]),
  );
  if (!list(block.signatures).includes(input.transactionId))
    throw new Error("Direct transaction is absent from its finalized block");
  return {
    transactionId: input.transactionId,
    blockHash: key(String(block.blockhash)),
    blockNumber: String(receipt.slot),
    blockTime: integer(receipt.blockTime),
  };
}
