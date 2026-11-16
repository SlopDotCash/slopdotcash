//@ backend dafny
// spec/backend/accounts.md, "A session belongs to one immutable account and has its own expiry"

export function tokenLengthAllowed(length: number): boolean {
  //@ ensures \result === (40 <= length && length <= 128)
  return 40 <= length && length <= 128;
}
