//@ backend dafny
// spec/frontend/composition.md, "A focus identity refresh changes the account only through sign-in or sign-out"

export type SessionStatus = "checking" | "signedOut" | "failed" | "signedIn";

//@ pure
export function keepsShownSession(shown: SessionStatus, next: SessionStatus): boolean {
  //@ ensures (shown !== "checking" && next === "checking") ==> \result
  //@ ensures (shown === "signedIn" && next === "failed") ==> \result
  //@ ensures (shown === "checking" || next === "signedIn" || next === "signedOut") ==> !\result
  //@ ensures (next === "failed" && shown !== "signedIn") ==> !\result
  return shown !== "checking" && (next === "checking" || (next === "failed" && shown === "signedIn"));
}
