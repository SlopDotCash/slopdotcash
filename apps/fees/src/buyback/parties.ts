// spec/fees/buyback.md, "An EVM order first approves exactly its amount to the pinned bridge"
import { type Hex, decodeFunctionData } from "viem";
import { dlnSourceAbi } from "../evm/abi.ts";

export interface OrderParties {
  readonly receiver: string;
  readonly authority: string;
  readonly beneficiary: string;
  readonly externalCall: boolean;
  readonly affiliateFeeBytes: number;
  readonly reservedTaker: string;
}

export interface FeeWallets {
  readonly source: string;
  readonly receiver: string;
}

function named(address: string, wallet: string): string {
  return address.toLowerCase() === wallet.toLowerCase() ? "fees" : address.toLowerCase();
}

/** @throws {never} */
export function orderParties(data: Hex, wallets: FeeWallets): OrderParties | undefined {
  try {
    const decoded = decodeFunctionData({ abi: dlnSourceAbi, data });
    if (decoded.functionName !== "createSaltedOrder") return undefined;
    const [order, , affiliateFee] = decoded.args;
    return {
      receiver: named(order.receiverDst, wallets.receiver),
      authority: named(order.orderAuthorityAddressDst, wallets.receiver),
      beneficiary: named(order.allowedCancelBeneficiarySrc, wallets.source),
      externalCall: order.externalCall !== "0x",
      affiliateFeeBytes: (affiliateFee.length - 2) / 2,
      reservedTaker: order.allowedTakerDst === "0x" ? "" : order.allowedTakerDst.toLowerCase(),
    };
  } catch {
    return undefined;
  }
}
