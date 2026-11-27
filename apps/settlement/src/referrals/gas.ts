//@ backend dafny
// spec/settlement/referrals.md, "Poster gas has transaction and UTC-day ceilings"; spec/settlement/referralPublication.md, "Every signed root reserves gas and journals its exact identity first"

export const PER_TRANSACTION_WEI = 200000000000000n;

/** @throws {never} */
export function gasLimitWithMargin(estimate: bigint): bigint {
  //@ requires estimate >= 0
  //@ ensures \result >= estimate
  //@ ensures \result === (estimate * 13n + 9n) / 10n
  return (estimate * 13n + 9n) / 10n;
}

/** @throws {never} */
export function maxFeePerGasFor(baseFeePerGas: bigint, priorityFeePerGas: bigint): bigint {
  //@ requires baseFeePerGas >= 0 && priorityFeePerGas >= 0
  //@ ensures \result === (baseFeePerGas * 12n) / 10n + priorityFeePerGas
  //@ ensures \result >= priorityFeePerGas
  return (baseFeePerGas * 12n) / 10n + priorityFeePerGas;
}

/** @throws {never} */
export function reservedWei(gasLimit: bigint, maxFeePerGas: bigint): bigint {
  //@ requires gasLimit >= 0 && maxFeePerGas >= 0
  //@ ensures \result === gasLimit * maxFeePerGas
  //@ ensures \result >= 0
  return gasLimit * maxFeePerGas;
}

/** @throws {never} */
export function actualWei(gasUsed: bigint, effectiveGasPrice: bigint, _gasLimit: bigint, _maxFeePerGas: bigint): bigint {
  //@ requires gasUsed >= 0 && effectiveGasPrice >= 0 && _gasLimit >= 0 && _maxFeePerGas >= 0
  //@ ensures gasUsed <= _gasLimit && effectiveGasPrice <= _maxFeePerGas ==> \result <= _gasLimit * _maxFeePerGas
  //@ ensures \result === gasUsed * effectiveGasPrice
  return gasUsed * effectiveGasPrice;
}

/** @throws {never} */
export function withinTransactionCeiling(reserved: bigint): boolean {
  //@ ensures \result <==> (reserved > 0n && reserved <= 200000000000000n)
  return reserved > 0n && reserved <= PER_TRANSACTION_WEI;
}
