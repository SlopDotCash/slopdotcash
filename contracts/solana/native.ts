/** Native SOL uses the System Program ID as its asset identity, never the WSOL mint. */
export { SOLANA_NATIVE_ASSET } from "../../src/lib/escrow-policy.mjs";
export const SOLANA_NATIVE_DECIMALS = 9;

/** Normalize only the transaction fee. Program account rent is never a deposit or payout. */
export function nativeLamportDeltas(
  meta: Record<string, unknown>,
  keys: readonly string[],
): Map<string, bigint> {
  const before = meta.preBalances;
  const after = meta.postBalances;
  if (
    !Array.isArray(before) ||
    !Array.isArray(after) ||
    before.length !== keys.length ||
    after.length !== keys.length ||
    !Number.isSafeInteger(meta.fee) ||
    Number(meta.fee) < 0
  )
    throw new Error("Finalized SOL balances are unavailable.");
  return new Map(
    keys.map((key, index) => {
      if (
        !Number.isSafeInteger(before[index]) ||
        before[index] < 0 ||
        !Number.isSafeInteger(after[index]) ||
        after[index] < 0
      )
        throw new Error("Finalized SOL balances are outside the exact range.");
      return [
        key,
        BigInt(after[index]) -
          BigInt(before[index]) +
          (index === 0 ? BigInt(Number(meta.fee)) : 0n),
      ];
    }),
  );
}
