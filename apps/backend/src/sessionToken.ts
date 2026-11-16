//@ backend dafny
// spec/backend/accounts.md, "Members are keyed by an immutable actor and numeric GitHub ID, and sessions by server-issued IDs"

export function tokenLengthAllowed(length: number): boolean {
  //@ ensures \result === (40 <= length && length <= 128)
  return 40 <= length && length <= 128;
}
