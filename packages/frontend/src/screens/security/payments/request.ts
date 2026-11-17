// spec/settlement/directBounty.md, "A standard award freezes its network, asset and two split amounts"
import { OwnerRequest, type RemainingTransfer } from "@repo/settlement/client";
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { Result, Schema } from "effect";
import { knownAssetSymbol, tickerOf, tickerText } from "../../../kernels/assetText.ts";
import { OwnerRequestView } from "../../../wallets/bounty/paymentCase.vibe";

const decodeRequest = Schema.decodeUnknownResult(OwnerRequest);

const decodeView = Schema.decodeUnknownResult(OwnerRequestView);

/** The prepared direct request as the case carries it, or undefined when it is not one. @throws {never} */
export function ownerRequestOf(value: unknown): OwnerRequest | undefined {
  const decoded = decodeRequest(value);
  return Result.isSuccess(decoded) ? decoded.success : undefined;
}

/** Whether the request carries the Solana plan the wallet prompt signs: its transaction with its message and expiry. @throws {never} */
export function hasSolanaPlan(value: unknown): boolean {
  const decoded = decodeView(value);
  return Result.isSuccess(decoded) && decoded.success.solana !== undefined;
}

/** The asset's symbol: the network's reference symbol for a known asset, else the token's ticker. @throws {never} */
export function requestSymbol(request: OwnerRequest): string {
  const known = knownAssetSymbol({ network: request.network, assetAddress: request.asset.address, assetDecimals: request.asset.decimals });
  return known ?? tickerText(tickerOf({ kind: "token", symbol: request.asset.symbol })) ?? request.asset.symbol;
}

/** One transfer's exact amount in the asset's decimals. @throws {never} */
export function transferAmount(request: OwnerRequest, transfer: RemainingTransfer): string {
  return formatBaseUnits({ value: BigInt(transfer.amountBase), decimals: request.asset.decimals });
}

/** The whole request as the payer copies or downloads it. @throws {never} */
export function requestText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** A download link's address for the whole request. @throws {never} */
export function requestDownload(value: unknown): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(`${requestText(value)}\n`)}`;
}
