// spec/frontend/vaultLocks.md, "A vault with month locks refuses a withdrawal into its locked funds before the wallet is asked, and Slop's own guard applies only to a vault without them"; spec/settlement/escrow.md, "Only the owner withdraws unused free funds, to itself, less a 2% fee rounded up"
import { PLEDGED_FUNDS_ERROR, PLEDGED_FUNDS_SELECTOR } from "@repo/settlement/chain/evm/abi";
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
