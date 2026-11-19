// spec/frontend/vaultLocks.md, "A vault with month locks refuses a withdrawal into its locked funds before the wallet is asked, and Slop's own guard applies only to a vault without them"; spec/frontend/monthLock.md, "A failed transaction locks or releases nothing, and an included one waits for the finalized read before the card shows it"; spec/settlement/escrow.md, "Only the owner withdraws unused free funds, to itself, less a 2% fee rounded up"
import { PLEDGE_ERROR_SELECTORS, PLEDGE_ERRORS, PLEDGED_FUNDS_ERROR, PLEDGED_FUNDS_SELECTOR, type PledgeError } from "@repo/settlement/chain/evm/abi";
import { lockedFundsText } from "../../../gen/frontend__vaultLocks.ts";

export interface ContractError {
  readonly name: string;
  readonly selector: string;
}

const nestedKeys = ["data", "message", "cause", "error", "details"] as const;
const deepest = 4;

/** @throws {never} */
export function errorText(caught: unknown): ReadonlyArray<string> {
  const seen = new Set<object>();
  const text: string[] = [];
  const collect = (value: unknown, depth: number): void => {
    if (depth > deepest) return;
    if (typeof value === "string") text.push(value);
    if (typeof value !== "object" || value === null || seen.has(value)) return;
    seen.add(value);
    for (const key of nestedKeys) collect((value as Readonly<Record<string, unknown>>)[key], depth + 1);
  };
  collect(caught, 0);
  return text;
}

/** @throws {never} */
export function contractError(caught: unknown, error: ContractError): boolean {
  const selector = error.selector.toLowerCase();
  return errorText(caught).some((part) => part.toLowerCase().includes(selector) || part.includes(error.name));
}

const pledgedFunds: ContractError = { name: PLEDGED_FUNDS_ERROR, selector: PLEDGED_FUNDS_SELECTOR };

/** @throws {never} */
export function pledgedFundsRefusal(caught: unknown): string | undefined {
  return contractError(caught, pledgedFunds) ? lockedFundsText : undefined;
}

const lockRefusals: Readonly<Record<PledgeError, string>> = {
  PledgeTooLow: "A month in this range is already locked at a higher amount. A lock can be raised, never lowered.",
  InsufficientFreeBalance: "The vault's free funds cannot cover these months. Deposit more first, or lock fewer months.",
  InvalidInput: "The months changed while the lock was sent, for example at the start of a new month. Review the lock again.",
  MonthlyAlreadyCommitted: "A month in this range is already reserved for payout.",
  WrongPurpose: "This vault cannot lock months.",
  PledgeNotLapsed: "This month's lock cannot be released yet: its payout window is still open.",
};

/** @throws {never} */
export function lockRefusal(caught: unknown): string | undefined {
  const found = PLEDGE_ERRORS.find((name) => contractError(caught, { name, selector: PLEDGE_ERROR_SELECTORS[name] }));
  return found === undefined ? undefined : lockRefusals[found];
}
