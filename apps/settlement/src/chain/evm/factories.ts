// spec/settlement/vaultSnapshots.md, "Only a reviewed registry binding can obtain totals"; spec/settlement/escrow.md, "Events apply once, in canonical block and event order"
import { REVIEWED_FACTORIES, type ImplementationReview, type ReviewedFactory } from "@repo/platform/chain/reviewed";
import { encodeAbiParameters, encodeFunctionData, keccak256 } from "viem";
import type { NetworkKey } from "../../kernels/networks.ts";
import { type Bytes32, type EvmAddress, type Hex, U128_MAX, type VaultPurpose, checked, decodeAddress, evmAddress, factoryAbi, isZero, purposeNumber } from "./abi.ts";

export { REVIEWED_FACTORIES, type ImplementationReview, type ReviewedFactory };

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
