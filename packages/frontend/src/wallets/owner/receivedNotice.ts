// spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request"

/** @throws {never} */
export function receivedNotice(operation: "deposit" | "withdraw", network: string, hash: string): string {
  return `${operation === "deposit" ? "Deposit received" : "Withdrawal sent"} in a ${network} block. It counts once ${network} finalizes that block, usually within 20 minutes; you can leave this page. ${hash}`;
}
