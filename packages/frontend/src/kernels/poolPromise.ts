//@ backend dafny
// spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced in Dafny //@ ensures contract
import { type PoolFacts, type PromiseFacts, poolDisplay, promiseWarning } from "../../gen/frontend__projections.ts";

/** Whether some recorded paying vault has neither a read free balance nor pledge support: every one while the read is not current, none when the project records none. @throws {never} */
export function vaultUnread(current: boolean, recordedRead: boolean[]): boolean {
  //@ ensures !current ==> (\result <==> recordedRead.length > 0)
  //@ ensures recordedRead.length === 0 ==> !\result
  if (!current) return recordedRead.length > 0;
  let i = 0;
  while (i < recordedRead.length) {
    //@ invariant 0 <= i && i <= recordedRead.length
    if (!recordedRead[i]) return true;
    i = i + 1;
  }
  return false;
}

/** The honor-system facts of a pool: the owner's opt-in and whether a recorded paying vault is unread. @throws {never} */
export function promiseFacts(pool: PoolFacts, honorSystem: boolean, recordedRead: boolean[]): PromiseFacts {
  //@ ensures !honorSystem ==> promiseWarning(\result) === "NoPromise"
  //@ ensures promiseWarning(\result) !== "NoPromise" ==> poolDisplay(pool) !== "PoolFunded"
  //@ ensures recordedRead.length === 0 ==> promiseWarning(\result) !== "PromisedUnverified"
  const unread = vaultUnread(pool.read === "PoolCurrent", recordedRead);
  return { pool: pool, honorSystem: honorSystem, vaultUnread: unread };
}
