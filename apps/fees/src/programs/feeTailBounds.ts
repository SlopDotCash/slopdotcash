//@ backend dafny
// spec/fees/feeReport.md, "Only an administrator reads the fee report, and it never contains a signed transaction or secret"

//@ pure
export function keptCount(available: number, limit: number): number {
  //@ requires 0 <= available && 0 <= limit
  //@ ensures 0 <= \result && \result <= limit && \result <= available
  //@ ensures available <= limit ==> \result == available
  return available < limit ? available : limit;
}

//@ pure
export function candidateAccepted(https: boolean, heliusHost: boolean, userEmpty: boolean, passwordEmpty: boolean, hashEmpty: boolean, defaultPort: boolean): boolean {
  //@ ensures \result <==> (https && heliusHost && userEmpty && passwordEmpty && hashEmpty && defaultPort)
  return https && heliusHost && userEmpty && passwordEmpty && hashEmpty && defaultPort;
}
