export interface RouteRole {
  name: string;
  writable: boolean;
  signer: boolean;
  optional: boolean;
}

export interface RouteBinding {
  name: string;
  value: string;
}

/** First role with a missing key or incorrect signer/writable privileges. */
//@ verify
//@ requires roles.length <= indices.length
//@ requires 0 <= signed && 0 <= readonlySigned && readonlySigned <= signed
//@ requires signed <= staticCount && staticCount <= keys.length && 0 <= readonlyUnsigned && readonlyUnsigned <= staticCount - signed
//@ requires 0 <= loadedWritable && staticCount + loadedWritable <= keys.length
//@ ensures -1 <= \result && \result < roles.length
//@ ensures (\result == -1) <==> forall(j, 0 <= j && j < roles.length ==> ValidRole(roles[j], indices[j], keys, signed, readonlySigned, staticCount, readonlyUnsigned, loadedWritable))
//@ ensures \result >= 0 ==> !ValidRole(roles[\result], indices[\result], keys, signed, readonlySigned, staticCount, readonlyUnsigned, loadedWritable) && forall(j, 0 <= j && j < \result ==> ValidRole(roles[j], indices[j], keys, signed, readonlySigned, staticCount, readonlyUnsigned, loadedWritable))
export function invalidRouteRole(
  roles: readonly RouteRole[],
  indices: readonly number[],
  keys: readonly string[],
  signed: number,
  readonlySigned: number,
  staticCount: number,
  readonlyUnsigned: number,
  loadedWritable: number,
): number {
  let i = 0;
  while (i < roles.length) {
    //@ invariant 0 <= i && i <= roles.length
    //@ invariant forall(j, 0 <= j && j < i ==> ValidRole(roles[j], indices[j], keys, signed, readonlySigned, staticCount, readonlyUnsigned, loadedWritable))
    const index = indices[i];
    if (index < 0 || index >= keys.length || keys[index] === "") return i;
    const writable =
      index < signed
        ? index < signed - readonlySigned
        : index < staticCount
          ? index < staticCount - readonlyUnsigned
          : index < staticCount + loadedWritable;
    if (
      (roles[i].writable && !roles[i].optional && !writable) ||
      (roles[i].signer && index !== 0)
    )
      return i;
    i++;
  }
  return -1;
}

/** Last exact-name binding, matching the original Map's overwrite rule. */
//@ verify
//@ ensures \result == LastRouteValue(bindings, name)
export function routeValue(
  bindings: readonly RouteBinding[],
  name: string,
): string {
  let value = "";
  let i = 0;
  while (i < bindings.length) {
    //@ invariant 0 <= i && i <= bindings.length
    //@ invariant value == LastRouteValue(bindings.slice(0, i), name)
    if (bindings[i].name === name) value = bindings[i].value;
    i++;
  }
  return value;
}

export interface RouteExpectedKeys {
  wallet: string;
  source: string;
  destination: string;
  inputMint: string;
  outputMint: string;
  inputProgram: string;
  outputProgram: string;
  program: string;
}

/** Exact first account-binding refusal, or the empty string on success. */
//@ verify
//@ requires forall(i, 0 <= i && i < bindings.length ==> bindings[i].value != "")
//@ ensures \result == RouteBindingError(bindings, expected, shared)
export function routeBindingError(
  bindings: readonly RouteBinding[],
  expected: RouteExpectedKeys,
  shared: boolean,
): string {
  if (routeValue(bindings, "user_transfer_authority") !== expected.wallet)
    return "Jupiter route user_transfer_authority differs from the reviewed swap";
  const userSource = routeValue(bindings, "user_source_token_account");
  if (userSource !== "") {
    if (userSource !== expected.source)
      return "Jupiter route user_source_token_account differs from the reviewed swap";
  } else if (routeValue(bindings, "source_token_account") !== expected.source)
    return "Jupiter route source_token_account differs from the reviewed swap";
  const userDestination = routeValue(
    bindings,
    "user_destination_token_account",
  );
  if (userDestination !== "") {
    if (userDestination !== expected.destination)
      return "Jupiter route user_destination_token_account differs from the reviewed swap";
  } else if (
    routeValue(bindings, "destination_token_account") !== expected.destination
  )
    return "Jupiter route destination_token_account differs from the reviewed swap";
  const sourceMint = routeValue(bindings, "source_mint");
  if (sourceMint !== "" && sourceMint !== expected.inputMint)
    return "Jupiter route source_mint differs from the reviewed swap";
  if (routeValue(bindings, "destination_mint") !== expected.outputMint)
    return "Jupiter route destination_mint differs from the reviewed swap";
  const sourceProgram = routeValue(bindings, "source_token_program");
  if (sourceProgram !== "" && sourceProgram !== expected.inputProgram)
    return "Jupiter route source_token_program differs from the reviewed swap";
  const destinationProgram = routeValue(bindings, "destination_token_program");
  if (
    destinationProgram !== "" &&
    destinationProgram !== expected.outputProgram
  )
    return "Jupiter route destination_token_program differs from the reviewed swap";
  const program = routeValue(bindings, "program");
  if (program !== "" && program !== expected.program)
    return "Jupiter route program differs from the reviewed swap";
  const token = routeValue(bindings, "token_program");
  if (
    token !== "" &&
    token !== (shared ? expected.outputProgram : expected.inputProgram)
  )
    return "Jupiter route token_program differs from the reviewed swap";
  const extraDestination = routeValue(bindings, "destination_token_account");
  if (
    userDestination !== "" &&
    extraDestination !== "" &&
    extraDestination !== expected.program &&
    extraDestination !== expected.destination
  )
    return "Jupiter route redirects output to another account";
  const platformFee = routeValue(bindings, "platform_fee_account");
  if (platformFee !== "" && platformFee !== expected.program)
    return "Jupiter route platform_fee_account differs from the reviewed swap";
  const token2022 = routeValue(bindings, "token_2022_program");
  if (
    token2022 !== "" &&
    token2022 !== expected.program &&
    token2022 !== expected.inputProgram &&
    token2022 !== expected.outputProgram
  )
    return "Jupiter route has a foreign token program";
  return "";
}

/** Complete parsed quote/fee/slippage agreement, after native integer checking. */
//@ verify
//@ ensures \result <==> input == expectedInput && quoted == expectedQuoted && slippage == expectedSlippage && 0 <= expectedSlippage && expectedSlippage <= 10000 && platformFee == 0 && positiveSlippage == 0 && expectedInput > 0 && expectedQuoted > 0 && minimum > 0 && expectedQuoted * (10000 - expectedSlippage) / 10000 >= minimum
export function routeAmountsMatch(
  input: bigint,
  quoted: bigint,
  slippage: number,
  platformFee: number,
  positiveSlippage: number,
  expectedInput: bigint,
  expectedQuoted: bigint,
  expectedSlippage: number,
  minimum: bigint,
): boolean {
  return (
    input === expectedInput &&
    quoted === expectedQuoted &&
    slippage === expectedSlippage &&
    expectedSlippage >= 0 &&
    expectedSlippage <= 10000 &&
    platformFee === 0 &&
    positiveSlippage === 0 &&
    expectedInput > 0n &&
    expectedQuoted > 0n &&
    minimum > 0n &&
    (expectedQuoted * BigInt(10000 - expectedSlippage)) / 10000n >= minimum
  );
}
