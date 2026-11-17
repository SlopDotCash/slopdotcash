//@ backend dafny
// spec/fees/conversion.md, "Each evaluation records one outcome from the pinned order of checks"

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

//@ pure
export function validRole(role: RouteRole, index: number, keys: readonly string[], signed: number, readonlySigned: number, staticCount: number, readonlyUnsigned: number, loadedWritable: number): boolean {
  if (index < 0 || index >= keys.length || keys[index] === "") return false;
  const writable = index < signed ? index < signed - readonlySigned : index < staticCount ? index < staticCount - readonlyUnsigned : index < staticCount + loadedWritable;
  return !((role.writable && !role.optional && !writable) || (role.signer && index !== 0));
}

export function invalidRouteRole(roles: readonly RouteRole[], indices: readonly number[], keys: readonly string[], signed: number, readonlySigned: number, staticCount: number, readonlyUnsigned: number, loadedWritable: number): number {
  //@ requires roles.length <= indices.length
  //@ ensures -1 <= \result && \result < roles.length
  //@ ensures (\result == -1) <==> forall(j, 0 <= j && j < roles.length ==> validRole(roles[j], indices[j], keys, signed, readonlySigned, staticCount, readonlyUnsigned, loadedWritable))
  //@ ensures \result >= 0 ==> !validRole(roles[\result], indices[\result], keys, signed, readonlySigned, staticCount, readonlyUnsigned, loadedWritable) && forall(j, 0 <= j && j < \result ==> validRole(roles[j], indices[j], keys, signed, readonlySigned, staticCount, readonlyUnsigned, loadedWritable))
  let i = 0;
  while (i < roles.length) {
    //@ invariant 0 <= i && i <= roles.length
    //@ invariant forall(j, 0 <= j && j < i ==> validRole(roles[j], indices[j], keys, signed, readonlySigned, staticCount, readonlyUnsigned, loadedWritable))
    if (!validRole(roles[i], indices[i], keys, signed, readonlySigned, staticCount, readonlyUnsigned, loadedWritable)) return i;
    i++;
  }
  return -1;
}

//@ pure
export function lastRouteValue(bindings: readonly RouteBinding[], name: string, count: number): string {
  //@ requires 0 <= count && count <= bindings.length
  //@ decreases count
  if (count === 0) return "";
  if (bindings[count - 1].name === name) return bindings[count - 1].value;
  return lastRouteValue(bindings, name, count - 1);
}

export function routeValue(bindings: readonly RouteBinding[], name: string): string {
  //@ ensures \result == lastRouteValue(bindings, name, bindings.length)
  let value = "";
  let i = 0;
  while (i < bindings.length) {
    //@ invariant 0 <= i && i <= bindings.length
    //@ invariant value == lastRouteValue(bindings, name, i)
    if (bindings[i].name === name) value = bindings[i].value;
    i++;
  }
  return value;
}

export function routeBindingError(bindings: readonly RouteBinding[], expected: RouteExpectedKeys, shared: boolean): string {
  //@ requires forall(i, 0 <= i && i < bindings.length ==> bindings[i].value != "")
  //@ requires expected.wallet != "" && expected.source != "" && expected.destination != "" && expected.inputMint != "" && expected.outputMint != "" && expected.inputProgram != "" && expected.outputProgram != "" && expected.program != ""
  //@ ensures \result == "" ==> lastRouteValue(bindings, "user_transfer_authority", bindings.length) == expected.wallet
  //@ ensures \result == "" ==> lastRouteValue(bindings, "user_source_token_account", bindings.length) == expected.source || (lastRouteValue(bindings, "user_source_token_account", bindings.length) == "" && lastRouteValue(bindings, "source_token_account", bindings.length) == expected.source)
  //@ ensures \result == "" ==> lastRouteValue(bindings, "user_destination_token_account", bindings.length) == expected.destination || (lastRouteValue(bindings, "user_destination_token_account", bindings.length) == "" && lastRouteValue(bindings, "destination_token_account", bindings.length) == expected.destination)
  //@ ensures \result == "" ==> lastRouteValue(bindings, "source_mint", bindings.length) == "" || lastRouteValue(bindings, "source_mint", bindings.length) == expected.inputMint
  //@ ensures \result == "" ==> lastRouteValue(bindings, "destination_mint", bindings.length) == expected.outputMint
  //@ ensures \result == "" ==> lastRouteValue(bindings, "source_token_program", bindings.length) == "" || lastRouteValue(bindings, "source_token_program", bindings.length) == expected.inputProgram
  //@ ensures \result == "" ==> lastRouteValue(bindings, "destination_token_program", bindings.length) == "" || lastRouteValue(bindings, "destination_token_program", bindings.length) == expected.outputProgram
  //@ ensures \result == "" ==> lastRouteValue(bindings, "program", bindings.length) == "" || lastRouteValue(bindings, "program", bindings.length) == expected.program
  //@ ensures \result == "" ==> lastRouteValue(bindings, "token_program", bindings.length) == "" || (shared && lastRouteValue(bindings, "token_program", bindings.length) == expected.outputProgram) || (!shared && lastRouteValue(bindings, "token_program", bindings.length) == expected.inputProgram)
  //@ ensures \result == "" ==> lastRouteValue(bindings, "destination_token_account", bindings.length) == "" || lastRouteValue(bindings, "destination_token_account", bindings.length) == expected.destination || lastRouteValue(bindings, "destination_token_account", bindings.length) == expected.program
  //@ ensures \result == "" ==> lastRouteValue(bindings, "platform_fee_account", bindings.length) == "" || lastRouteValue(bindings, "platform_fee_account", bindings.length) == expected.program
  //@ ensures \result == "" ==> lastRouteValue(bindings, "token_2022_program", bindings.length) == "" || lastRouteValue(bindings, "token_2022_program", bindings.length) == expected.program || lastRouteValue(bindings, "token_2022_program", bindings.length) == expected.inputProgram || lastRouteValue(bindings, "token_2022_program", bindings.length) == expected.outputProgram
  if (routeValue(bindings, "user_transfer_authority") !== expected.wallet) return "Jupiter route user_transfer_authority differs from the reviewed swap";
  const userSource = routeValue(bindings, "user_source_token_account");
  if (userSource !== "") {
    if (userSource !== expected.source) return "Jupiter route user_source_token_account differs from the reviewed swap";
  } else if (routeValue(bindings, "source_token_account") !== expected.source) return "Jupiter route source_token_account differs from the reviewed swap";
  const userDestination = routeValue(bindings, "user_destination_token_account");
  const destination = routeValue(bindings, "destination_token_account");
  if (userDestination !== "") {
    if (userDestination !== expected.destination) return "Jupiter route user_destination_token_account differs from the reviewed swap";
  } else if (destination !== expected.destination) return "Jupiter route destination_token_account differs from the reviewed swap";
  const sourceMint = routeValue(bindings, "source_mint");
  if (sourceMint !== "" && sourceMint !== expected.inputMint) return "Jupiter route source_mint differs from the reviewed swap";
  if (routeValue(bindings, "destination_mint") !== expected.outputMint) return "Jupiter route destination_mint differs from the reviewed swap";
  const sourceProgram = routeValue(bindings, "source_token_program");
  if (sourceProgram !== "" && sourceProgram !== expected.inputProgram) return "Jupiter route source_token_program differs from the reviewed swap";
  const destinationProgram = routeValue(bindings, "destination_token_program");
  if (destinationProgram !== "" && destinationProgram !== expected.outputProgram) return "Jupiter route destination_token_program differs from the reviewed swap";
  const program = routeValue(bindings, "program");
  if (program !== "" && program !== expected.program) return "Jupiter route program differs from the reviewed swap";
  const token = routeValue(bindings, "token_program");
  if (token !== "" && token !== (shared ? expected.outputProgram : expected.inputProgram)) return "Jupiter route token_program differs from the reviewed swap";
  if (userDestination !== "" && destination !== "" && destination !== expected.program && destination !== expected.destination) return "Jupiter route redirects output to another account";
  const platformFee = routeValue(bindings, "platform_fee_account");
  if (platformFee !== "" && platformFee !== expected.program) return "Jupiter route platform_fee_account differs from the reviewed swap";
  const token2022 = routeValue(bindings, "token_2022_program");
  if (token2022 !== "" && token2022 !== expected.program && token2022 !== expected.inputProgram && token2022 !== expected.outputProgram) return "Jupiter route has a foreign token program";
  return "";
}

//@ pure
export function routeAmountsMatch(input: bigint, quoted: bigint, slippage: number, platformFee: number, positiveSlippage: number, expectedInput: bigint, expectedQuoted: bigint, expectedSlippage: number, minimum: bigint): boolean {
  //@ ensures \result <==> input == expectedInput && quoted == expectedQuoted && slippage == expectedSlippage && 0 <= expectedSlippage && expectedSlippage <= 10000 && platformFee == 0 && positiveSlippage == 0 && expectedInput > 0 && expectedQuoted > 0 && minimum > 0 && expectedQuoted * (10000 - expectedSlippage) / 10000 >= minimum
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
