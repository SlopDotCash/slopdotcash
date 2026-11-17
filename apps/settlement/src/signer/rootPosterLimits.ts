//@ backend dafny
// spec/settlement/signer.md, "Each service key permits only its named operations and none can pay, withdraw or upgrade"; spec/settlement/referrals.md, "Poster gas has transaction and UTC-day ceilings"; spec/settlement/referrals.md, "Program configuration starts off and posting requires independent activation"

export const ROBINHOOD_TESTNET_CHAIN_ID = 46630n;
export const ROBINHOOD_MAINNET_CHAIN_ID = 4663n;
export const ROOT_GROWTH_TOKENS = 2000000n;

/** @throws {never} */
export function growthAllowed(total: bigint, previous: bigint, tokenUnit: bigint): boolean {
  //@ ensures \result <==> (tokenUnit > 0n && previous >= 0n && total >= previous && total - previous <= tokenUnit * 2000000n)
  return tokenUnit > 0n && previous >= 0n && total >= previous && total - previous <= tokenUnit * ROOT_GROWTH_TOKENS;
}

/** @throws {never} */
export function chainAllowed(chainId: bigint, mainnet: boolean): boolean {
  //@ ensures \result <==> (mainnet ? chainId === 4663n : chainId === 46630n)
  return mainnet ? chainId === ROBINHOOD_MAINNET_CHAIN_ID : chainId === ROBINHOOD_TESTNET_CHAIN_ID;
}

/** @throws {never} */
export function envelopeAllowed(gasLimit: bigint, maxFeePerGas: bigint, maxPriorityFeePerGas: bigint, value: bigint): boolean {
  //@ ensures \result <==> (gasLimit > 0n && maxFeePerGas > 0n && maxPriorityFeePerGas >= 0n && maxPriorityFeePerGas <= maxFeePerGas && value === 0n && gasLimit * maxFeePerGas <= 200000000000000n)
  return gasLimit > 0n && maxFeePerGas > 0n && maxPriorityFeePerGas >= 0n && maxPriorityFeePerGas <= maxFeePerGas && value === 0n && gasLimit * maxFeePerGas <= 200000000000000n;
}
