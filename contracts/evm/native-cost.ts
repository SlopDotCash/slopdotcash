import type { Address, Hex, TransactionReceipt } from "viem";

type ReceiptClient = {
  request(input: {
    method: "eth_getTransactionReceipt";
    params: [Hex];
  }): Promise<unknown>;
  call(input: {
    to: Address;
    data: Hex;
    blockNumber: bigint;
  }): Promise<{ data?: Hex }>;
};

/** Actual native fees, separate from payment principal. Base also charges
 * its witnessed L1 data fee and the historical gas-oracle operator fee. */
export async function evmReceiptNativeCost(
  client: ReceiptClient,
  receipt: TransactionReceipt,
  base: boolean,
): Promise<bigint> {
  let cost = receipt.gasUsed * receipt.effectiveGasPrice;
  if (receipt.type === "eip4844") {
    if (receipt.blobGasUsed === undefined || receipt.blobGasPrice === undefined)
      throw new Error("Finalized blob fee is unavailable");
    cost += receipt.blobGasUsed * receipt.blobGasPrice;
  }
  if (base) {
    const raw = (await client.request({
      method: "eth_getTransactionReceipt",
      params: [receipt.transactionHash],
    })) as {
      transactionHash?: string;
      blockHash?: string;
      l1Fee?: string;
    } | null;
    if (
      !raw ||
      raw.transactionHash?.toLowerCase() !==
        receipt.transactionHash.toLowerCase() ||
      raw.blockHash !== receipt.blockHash ||
      !/^0x[0-9a-fA-F]+$/u.test(raw.l1Fee ?? "")
    )
      throw new Error("Finalized Base data fee is unavailable");
    const operator = await client.call({
      to: "0x420000000000000000000000000000000000000f",
      data: `0x275aedd2${receipt.gasUsed.toString(16).padStart(64, "0")}`,
      blockNumber: receipt.blockNumber,
    });
    if (!operator.data || !/^0x[0-9a-fA-F]{64}$/u.test(operator.data))
      throw new Error("Base operator fee evidence is unavailable");
    cost += BigInt(raw.l1Fee as string) + BigInt(operator.data);
  }
  return cost;
}
