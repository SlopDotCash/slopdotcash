// spec/settlement/bindingAuthority.md, "Only the current authority binds, for the current version and before expiry, with the wallet's own signature"
import { Arbitrary, Schema } from "effect";
import { hashTypedData, domainSeparator as independentSeparator } from "viem";
import { contract } from "vibestack/testing";
import { type Bytes32, type EvmAddress, type Hex, U64_MAX, U256_MAX } from "./abi.ts";
import { adapterVectors } from "../../../test/fixtures/adapterVectors.ts";
import { type BindingInput, ESCROW_DOMAIN_NAME, ESCROW_DOMAIN_VERSION, type EscrowDomain, bindCalldata, bindingDigest, bindingStruct, bindingTypedData, domainSeparator } from "./typedData.ts";

const vault = adapterVectors.vault as EvmAddress;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as Bytes32;
const address = (value: bigint) => `0x${value.toString(16).padStart(40, "0")}` as EvmAddress;
const between = (minimum: bigint, maximum: bigint) => Schema.BigInt.check(Schema.isBetweenBigInt({ minimum, maximum }));

const recordedInput = (input: (typeof adapterVectors.bindings)[number]["input"]): BindingInput => ({
  actor: BigInt(input.actor),
  destination: input.destination as EvmAddress,
  expectedVersion: BigInt(input.expectedVersion),
  claimDigest: input.claimDigest as Bytes32,
  expiresAt: BigInt(input.expiresAt),
});

export const bindingBytesMatchTheDeployedAdapter = contract({
  input: Arbitrary.Constant(adapterVectors.bindings),
  run: (vectors) =>
    vectors.map(({ chainId, input }) => {
      const domain = { chainId: BigInt(chainId), vault };
      return { digest: bindingDigest(domain, recordedInput(input)), typedData: JSON.stringify(bindingTypedData(domain, recordedInput(input))) };
    }),
  invariant: (vectors, outputs) =>
    vectors.every((vector, index) => outputs[index]?.digest === vector.digest && outputs[index]?.typedData === JSON.stringify(vector.typedData))
    && bindCalldata({ ...recordedInput(adapterVectors.bindings[0].input), walletSignature: adapterVectors.signature as Hex }) === adapterVectors.bindCalldata,
});

const bindingCase = Schema.Struct({
  chainId: between(1n, U64_MAX),
  vault: between(1n, (1n << 160n) - 1n),
  actor: between(1n, U64_MAX),
  destination: between(1n, (1n << 160n) - 1n),
  expectedVersion: between(0n, U64_MAX),
  claimDigest: between(1n, U256_MAX),
  expiresAt: between(0n, U64_MAX),
});

const domainOf = (value: typeof bindingCase.Type): EscrowDomain => ({ chainId: value.chainId, vault: address(value.vault) });
const inputOf = (value: typeof bindingCase.Type): BindingInput => ({ actor: value.actor, destination: address(value.destination), expectedVersion: value.expectedVersion, claimDigest: word(value.claimDigest), expiresAt: value.expiresAt });

export const bindingDigestIsTheEip712Hash = contract({
  input: bindingCase,
  run: (value) => bindingDigest(domainOf(value), inputOf(value)),
  invariant: (value, digest) => {
    const domain = domainOf(value);
    const struct = bindingStruct(inputOf(value));
    const independent = hashTypedData({
      domain: { name: ESCROW_DOMAIN_NAME, version: ESCROW_DOMAIN_VERSION, chainId: domain.chainId, verifyingContract: domain.vault },
      types: { DestinationBinding: struct.fields.map((field) => ({ ...field })) },
      primaryType: "DestinationBinding",
      message: struct.values,
    });
    const separator = independentSeparator({ domain: { name: ESCROW_DOMAIN_NAME, version: ESCROW_DOMAIN_VERSION, chainId: domain.chainId, verifyingContract: domain.vault } });
    return digest === independent && domainSeparator(domain) === separator;
  },
});
