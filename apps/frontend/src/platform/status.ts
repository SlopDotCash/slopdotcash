//@ backend dafny
// spec/frontend/requests.md, "Loading, empty, stale, denied, invalid and unavailable remain distinct"

export function transientHttpStatus(status: number): boolean {
  //@ ensures \result === (status === 0 || status >= 500)
  //@ ensures status >= 400 && status < 500 ==> !\result
  return status === 0 || status >= 500;
}
