// spec/settlement/bindingAuthority.md, "Only the current authority binds, for the current version and before expiry, with the wallet's own signature"
import { Schema } from "effect";
import { keccak256, parseTransaction } from "viem";
import { contract } from "vibestack/testing";
import { type Bytes32, type EvmAddress, U64_MAX, U128_MAX, U256_MAX } from "./abi.ts";
import { type Type2Request, contractSignature, lowS, readSignedType2, signedType2, signingHash, unsignedType2 } from "./transactions.ts";

const between = (minimum: bigint, maximum: bigint) => Schema.BigInt.check(Schema.isBetweenBigInt({ minimum, maximum }));
const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as Bytes32;

const request = Schema.Struct({
  chainId: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2 ** 31 })),
  nonce: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 ** 40 })),
  gas: between(21_000n, U64_MAX),
  maxFeePerGas: between(1n, U128_MAX),
  priority: between(0n, U128_MAX),
  to: between(1n, (1n << 160n) - 1n),
  value: between(0n, U128_MAX),
  data: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))).check(Schema.isMaxLength(200)),
  r: between(1n, ORDER - 1n),
  s: between(1n, ORDER - 1n),
  yParity: Schema.Literals([0, 1]),
});

const requestOf = (value: typeof request.Type): Type2Request => ({
  chainId: value.chainId,
  nonce: value.nonce,
  gas: value.gas,
  maxFeePerGas: value.maxFeePerGas,
  maxPriorityFeePerGas: value.priority % (value.maxFeePerGas + 1n),
  to: `0x${value.to.toString(16).padStart(40, "0")}` as EvmAddress,
  value: value.value,
  data: `0x${value.data.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`,
});

export const type2BytesAreCanonicalAndCarryNoForeignSignature = contract({
  input: request,
  run: (value) => {
    const unsigned = unsignedType2(requestOf(value));
    const raw = signedType2(requestOf(value), { r: word(value.r), s: word(value.s), yParity: value.yParity });
    return { unsigned, raw, parsed: parseTransaction(unsigned), read: readSignedType2(raw) };
  },
  invariant: (value, { unsigned, raw, parsed, read }) => {
    const sent = requestOf(value);
    return unsigned.startsWith("0x02")
      && signingHash(sent) === keccak256(unsigned)
      && parsed.chainId === sent.chainId && parsed.nonce === sent.nonce && parsed.gas === sent.gas && parsed.to === sent.to
      && (read === undefined || (lowS(value.s) && read.request.data === sent.data.toLowerCase() && read.id === keccak256(raw) && read.signature.s === word(value.s)));
  },
});

const signature = Schema.Struct({ r: between(0n, U256_MAX), s: between(0n, U256_MAX), v: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })) });

export const onlyTheEncodingTheVaultAcceptsPasses = contract({
  input: signature,
  run: ({ r, s, v }) => contractSignature(`${word(r)}${word(s).slice(2)}${v.toString(16).padStart(2, "0")}`),
  invariant: ({ s, v }, accepted) => (accepted !== undefined) === ((v === 27 || v === 28) && lowS(s)),
});
