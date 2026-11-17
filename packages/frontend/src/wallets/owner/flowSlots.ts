// spec/frontend/ownerVault.md, "A flow sends only after storage saves its attempt"; spec/frontend/ownerMonthly.md, "Commitment, automatic-payment setting and reserve release each keep one recoverable attempt"; spec/frontend/walletAttempt.md, "A late wallet reply changes only the slot that still holds its own attempt"
import type { Attempt } from "../../../gen/frontend__walletAttempt.ts";
import type { SlotStorage } from "../core/slots.ts";

export interface OwnedSlot {
  readonly account: number;
  readonly attempt: Attempt;
  readonly plan: string;
}

export type SlotRead = { readonly kind: "empty" } | { readonly kind: "owned"; readonly slot: OwnedSlot } | { readonly kind: "unreadable"; readonly text: string };

const allowed = ["account", "attemptId", "request", "plan", "hash", "candidate"];
const maxPlanLength = 65_536;

/** @throws {never} */
function optionalText(value: unknown): string | undefined {
  return value === undefined ? "" : typeof value === "string" && value !== "" ? value : undefined;
}

/** @throws {never} */
export function slotOfText(text: string | null): SlotRead {
  if (text === null) return { kind: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "unreadable", text };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { kind: "unreadable", text };
  const record = parsed as Record<string, unknown>;
  if (!Object.keys(record).every((key) => allowed.includes(key))) return { kind: "unreadable", text };
  const { account, attemptId, request, plan, hash, candidate } = record;
  const hashText = optionalText(hash);
  const candidateText = optionalText(candidate);
  if (
    typeof account !== "number" || !Number.isSafeInteger(account) || account <= 0
    || typeof attemptId !== "string" || attemptId === "" || typeof request !== "string" || request === ""
    || typeof plan !== "string" || plan.length > maxPlanLength || hashText === undefined || candidateText === undefined
  ) return { kind: "unreadable", text };
  return { kind: "owned", slot: { account, plan, attempt: { identity: attemptId, bytesId: request, hash: hashText, candidate: candidateText } } };
}

/** @throws {never} */
export function textOfSlot(slot: OwnedSlot): string | null {
  if (slot.attempt.identity === "" && slot.attempt.bytesId === "") return null;
  return JSON.stringify({
    account: slot.account,
    attemptId: slot.attempt.identity,
    request: slot.attempt.bytesId,
    plan: slot.plan,
    ...(slot.attempt.hash === "" ? {} : { hash: slot.attempt.hash }),
    ...(slot.attempt.candidate === "" ? {} : { candidate: slot.attempt.candidate }),
  });
}

/** @throws {never} */
export function readText(storage: SlotStorage | undefined, key: string): string | null {
  if (storage === undefined) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** @throws {never} */
export function compareAndWrite(storage: SlotStorage | undefined, key: string, expected: string | null, next: string | null): boolean {
  if (storage === undefined) return false;
  try {
    if (storage.getItem(key) !== expected) return false;
    if (next === null) storage.removeItem(key);
    else storage.setItem(key, next);
    return true;
  } catch {
    return false;
  }
}
