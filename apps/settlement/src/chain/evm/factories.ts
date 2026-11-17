// spec/settlement/vaultSnapshots.md, "Only a reviewed registry binding can obtain totals"; spec/settlement/escrow.md, "Events apply once, in canonical block and event order"
import { encodeAbiParameters, encodeFunctionData, keccak256 } from "viem";
import type { NetworkKey } from "../../kernels/networks.ts";
import { type Bytes32, type EvmAddress, type Hex, U128_MAX, type VaultPurpose, checked, decodeAddress, evmAddress, factoryAbi, isZero, purposeNumber } from "./abi.ts";

export interface ImplementationReview {
  readonly authority: EvmAddress;
  readonly vaultImplementation: EvmAddress;
  readonly vaultImplementationCodeSha256: string;
  readonly factoryImplementation: EvmAddress;
  readonly factoryImplementationCodeSha256: string;
}

export interface ReviewedFactory {
  readonly network: NetworkKey;
  readonly sourceCommit: string;
  readonly codeSha256: string;
  readonly bindingDelaySeconds: bigint;
  readonly identityAuthority: EvmAddress;
  readonly feeRecipient: EvmAddress;
  readonly factory: EvmAddress;
  readonly factoryCodeSha256: string;
  readonly registrar: EvmAddress;
  readonly upgrade: ImplementationReview;
}

const SOURCE_COMMIT = "7fdedd3507c3f79217ccc896ace0e0b7472ca092";
const PROXY_CODE_SHA256 = "afb62459ccdd87d344b8bfa367c8dc49586323316bb8a51f1dfbe753336c0509";

const address = (text: string) => text as EvmAddress;

const MONTHLY_RESERVE_V2: ImplementationReview = {
  authority: address("0x2ad20afa352ec70e43a6d0e7794cf305c9cbe35d"),
  vaultImplementation: address("0x90c46e3e5be35b1048cd69403d1402feed1240d8"),
  vaultImplementationCodeSha256: "155c7ea2fdeeaeccfd6daac64b6105e968c1927092f8761f34090a8b42e15bfc",
  factoryImplementation: address("0x9f27aec70559d8f4ca1a62398e673a25b1ce3e2f"),
  factoryImplementationCodeSha256: "976208154ce5e58f59d826e58273d917adc226109bf95ab4894b9cf144e4a1dd",
};

const reviewed = (network: NetworkKey): ReviewedFactory => ({
  network,
  sourceCommit: SOURCE_COMMIT,
  codeSha256: PROXY_CODE_SHA256,
  bindingDelaySeconds: 0n,
  identityAuthority: address("0x31b87d13f9091bc3b8a5cb6f45c8b3cb99ed6d70"),
  feeRecipient: address("0x8f77c37d8650776bfe73c9b12b15209ee15d9b86"),
  factory: address("0xe51abf8c6dbb3ca6e9ad09f2dc6ef141d7364aab"),
  factoryCodeSha256: PROXY_CODE_SHA256,
  registrar: address("0xd64f35ac87d9a1fb8ebd44e745c24436b606cf60"),
  upgrade: MONTHLY_RESERVE_V2,
});

export const REVIEWED_FACTORIES: ReadonlyArray<ReviewedFactory> = [reviewed("base-mainnet"), reviewed("ethereum"), reviewed("robinhood-mainnet")];

/** @throws {never} */
export function reviewedFactory(network: NetworkKey): ReviewedFactory | undefined {
  return REVIEWED_FACTORIES.find((entry) => entry.network === network);
}

export interface VaultIdentity {
  readonly owner: EvmAddress;
  readonly projectId: Bytes32;
  readonly asset: EvmAddress;
  readonly purpose: VaultPurpose;
}

/** @throws {never} */
export function vaultKey(identity: VaultIdentity): Bytes32 {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint8" }], [identity.owner, identity.projectId, identity.asset, purposeNumber(identity.purpose)])) as Bytes32;
}

/** @throws {never} */
export function vaultsCall(key: Bytes32): Hex {
  return encodeFunctionData({ abi: factoryAbi, functionName: "vaults", args: [key] });
}

/** @throws {never} */
export function decodeVault(data: string): EvmAddress | null | undefined {
  const vault = decodeAddress(data);
  return vault === undefined ? undefined : isZero(vault) ? null : vault;
}

export type VaultCreation =
  | { readonly owner: EvmAddress; readonly projectId: Bytes32; readonly asset: EvmAddress; readonly purpose: "OrdinaryPurpose"; readonly monthlyCap: bigint; readonly monthlyEnabled: boolean }
  | { readonly owner: EvmAddress; readonly projectId: Bytes32; readonly asset: EvmAddress; readonly purpose: "BountyPurpose" };

/** @throws {RangeError} */
export function monthlyCommitmentChecked(cap: bigint, enabled: boolean): bigint {
  checked(cap, U128_MAX, "The monthly cap must be 0 to uint128 max base units");
  if (enabled && cap === 0n) throw new RangeError("Turning on monthly commitments needs a positive cap");
  return cap;
}

/** @throws {RangeError} */
export function createVaultCalldata(creation: VaultCreation): Hex {
  if (isZero(creation.projectId)) throw new RangeError("Invalid vault input");
  if (creation.purpose === "BountyPurpose") return encodeFunctionData({ abi: factoryAbi, functionName: "create", args: [creation.projectId, creation.asset, purposeNumber(creation.purpose)] });
  return encodeFunctionData({
    abi: factoryAbi,
    functionName: "createWithMonthlyCommitment",
    args: [creation.projectId, creation.asset, monthlyCommitmentChecked(creation.monthlyCap, creation.monthlyEnabled), creation.monthlyEnabled],
  });
}

export interface UnsignedCall {
  readonly from: EvmAddress;
  readonly to: EvmAddress;
  readonly data: Hex;
  readonly value: 0n;
}

/** @throws {RangeError} */
export function vaultCreationPlan(factory: EvmAddress, creation: VaultCreation): UnsignedCall {
  return { from: creation.owner, to: factory, data: createVaultCalldata(creation), value: 0n };
}

export interface MinedCall {
  readonly from: string;
  readonly to: string | undefined;
  readonly input: Hex;
  readonly value: bigint;
}

/** @throws {never} */
export function isCreationOf(mined: MinedCall, plan: UnsignedCall): boolean {
  return evmAddress(mined.from) === plan.from && mined.to !== undefined && evmAddress(mined.to) === plan.to && mined.input.toLowerCase() === plan.data.toLowerCase() && mined.value === 0n;
}
