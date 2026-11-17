/** Checks a background tab may make for one saved creation, at most. */
export const AUTO_REGISTER_HIDDEN_ASKS = 120;

export type AutoRegisterCount = { attempts: number; hiddenAsks: number };

/**
 * One timer turn of the automatic registration check. A shown tab asks and
 * spends an attempt. A background tab asks too, on its own limit, so an owner
 * who switches tabs still gets the vault recorded; past that limit it waits
 * and spends nothing, and showing the tab again resumes the attempts.
 */
export function autoRegisterTurn(
  count: AutoRegisterCount,
  tabHidden: boolean,
): { ask: boolean; next: AutoRegisterCount } {
  if (!tabHidden)
    return { ask: true, next: { ...count, attempts: count.attempts + 1 } };
  if (count.hiddenAsks >= AUTO_REGISTER_HIDDEN_ASKS)
    return { ask: false, next: count };
  return { ask: true, next: { ...count, hiddenAsks: count.hiddenAsks + 1 } };
}

/**
 * Notice for a deposit or withdrawal in a block that is not final yet. A vault
 * that is not recorded yet is registered by this page, so its owner stays.
 */
export function receivedNotice(
  operation: "deposit" | "withdraw",
  network: string,
  hash: string,
  provisional: boolean,
): string {
  const arrived = `${operation === "deposit" ? "Deposit received" : "Withdrawal sent"} in a ${network} block.`;
  return provisional
    ? `${arrived} Keep this page open: the vault is recorded here once ${network} finalizes its creation, usually within 20 minutes, and the deposit counts after that. ${hash}`
    : `${arrived} It counts once ${network} finalizes that block, usually within 20 minutes; you can leave this page. ${hash}`;
}
