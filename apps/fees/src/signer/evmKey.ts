// spec/settlement/signer.md, "Each service key permits only its named operations and none can pay, withdraw or upgrade"; spec/fees/runtime.md, "Signing needs a live mode and owner-verified readiness for the exact wallet"
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Type2 } from "../evm/abi.ts";

export const feeWalletEvmMarker = "slop-signer:fee-wallet:evm:v1";

export interface EvmKey {
  readonly address: Address;
  /** @throws {never} */
  sign(transaction: Type2): Promise<Hex>;
}

/** @throws {never} */
export function evmKey(secret: string): EvmKey | undefined {
  const text = secret.trim();
  if (!/^0x[0-9a-fA-F]{64}$/u.test(text)) return undefined;
  try {
    const account = privateKeyToAccount(text as Hex);
    return {
      address: account.address.toLowerCase() as Address,
      sign: (transaction) => account.signTransaction({ type: "eip1559", ...transaction }),
    };
  } catch {
    return undefined;
  }
}
