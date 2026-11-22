// spec/settlement/vaultDeposits.md, "A record row is a positive amount of one finalized deposit event"; spec/settlement/solanaVaultDeposits.md, "A run reads newest first below the interval it resumes and above the covered position"
import { Schema } from "effect";
import { contract } from "vibestack/testing";
import type { Address } from "@repo/platform/chain/solanaWire";
import { type Bytes32, type EvmAddress, type Hex, U128_MAX } from "../chain/evm/abi.ts";
import { EVENT_TOPICS } from "../chain/evm/events.ts";
import { type U64, U64_MAX, concat, u64le } from "../chain/solana/bytes.ts";
import { anchorDiscriminator } from "../chain/solana/instructions.ts";
import { depositInstruction, evmDeposits } from "./decode.ts";

const PROGRAM = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS" as Address;
const PROJECT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" as Address;
const OTHER_PROJECT = "So11111111111111111111111111111111111111112" as Address;
const DEPOSITOR = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T" as Address;
const VAULT = "0x2222222222222222222222222222222222222222" as EvmAddress;

const between = (minimum: bigint, maximum: bigint) => Schema.BigInt.check(Schema.isBetweenBigInt({ minimum, maximum }));
const byte = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }));
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as Bytes32;

const solanaCall = Schema.Struct({
  native: Schema.Boolean,
  amount: between(1n, U64_MAX),
  trailing: Schema.Array(byte).check(Schema.isMaxLength(32)),
  project: Schema.Literals(["own", "other"]),
});

const tagOf = (native: boolean) => anchorDiscriminator(native ? "deposit_native" : "deposit");

export const aDepositInstructionIsExactlyTheU64AfterItsTag = contract({
  input: solanaCall,
  run: (call) =>
    depositInstruction(
      { program: PROGRAM, accounts: [DEPOSITOR, call.project === "own" ? PROJECT : OTHER_PROJECT], data: concat(tagOf(call.native), u64le(call.amount as U64), Uint8Array.from(call.trailing)) },
      PROGRAM,
      PROJECT,
    ),
  invariant: (call, read) =>
    read.kind === "decoded" &&
    (call.project === "other" ? read.value === undefined : read.value !== undefined && read.value.amount === call.amount && read.value.depositor === DEPOSITOR),
});

export const aDepositInstructionShorterThanSixteenBytesIsRefused = contract({
  input: Schema.Struct({ native: Schema.Boolean, rest: Schema.Array(byte).check(Schema.isMaxLength(7)) }),
  run: (call) => depositInstruction({ program: PROGRAM, accounts: [DEPOSITOR, PROJECT], data: concat(tagOf(call.native), Uint8Array.from(call.rest)) }, PROGRAM, PROJECT),
  invariant: (_call, read) => read.kind === "malformed" && read.issue === "Unexpected deposit instruction",
});

const deposited = Schema.Struct({
  block: between(1n, 1n << 40n),
  index: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 500 })),
  depositor: between(1n, (1n << 160n) - 1n),
  amount: between(1n, U128_MAX),
  from: between(1n, 1n << 40n),
});

export const aFinalizedDepositedLogInsideItsPageDecodesOnce = contract({
  input: deposited,
  run: (value) =>
    evmDeposits(
      VAULT,
      [{
        address: VAULT,
        topics: [EVENT_TOPICS.Deposited, word(value.depositor)] as ReadonlyArray<Hex>,
        data: word(value.amount),
        blockNumber: value.block,
        blockHash: word(value.block + 7n),
        transactionHash: word(value.block * 1000n + BigInt(value.index)),
        logIndex: value.index,
        removed: false,
      }],
      { from: value.from, to: value.from + 1000n },
    ),
  invariant: (value, read) => {
    const inside = value.block >= value.from && value.block <= value.from + 1000n;
    if (!inside) return read.kind === "malformed";
    const [only] = read.kind === "decoded" ? read.value : [];
    return read.kind === "decoded" && read.value.length === 1 && only !== undefined && only.amount === value.amount && only.index === value.index &&
      only.depositor === `0x${value.depositor.toString(16).padStart(40, "0")}` && only.block === value.block;
  },
});
