// spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request"; spec/frontend/provisionalVault.md, "Included deposits are received pending finality only when there is an exact deposit event"

/** @throws {never} */
export function receivedNotice(operation: "deposit" | "withdraw", network: string, hash: string, provisional: boolean): string {
  const arrived = `${operation === "deposit" ? "Deposit received" : "Withdrawal sent"} in a ${network} block.`;
  return provisional
    ? `${arrived} The vault is recorded once ${network} finalizes its creation, usually within 20 minutes, and the deposit counts after that; you can leave this page. ${hash}`
    : `${arrived} It counts once ${network} finalizes that block, usually within 20 minutes; you can leave this page. ${hash}`;
}
