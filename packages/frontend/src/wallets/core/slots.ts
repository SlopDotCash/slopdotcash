// spec/frontend/walletAttempt.md, "A wallet prompt starts only after storage creates an empty slot"; spec/frontend/walletAttempt.md, "A late wallet reply changes only the slot that still holds its own attempt"
import type { Attempt } from "../../../gen/frontend__walletAttempt.ts";
import { webStorage } from "../../platform/webStorage.ts";

export interface SlotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface SlotRecord {
  readonly attemptId: string;
  readonly request: string;
  readonly hash?: string;
  readonly candidate?: string;
}

const probeKey = "slop:wallet-attempt:probe";
const empty: Attempt = { identity: "", bytesId: "", hash: "", candidate: "" };

/** @throws {never} */
export function sessionSlots(): SlotStorage | undefined {
  return webStorage("session");
}

/** @throws {never} */
export function slotWritable(storage: SlotStorage | undefined): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

/** @throws {never} */
function recordOf(value: unknown): SlotRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const allowed = ["attemptId", "request", "hash", "candidate"];
  if (!keys.every((key) => allowed.includes(key))) return undefined;
  const { attemptId, request, hash, candidate } = record;
  if (typeof attemptId !== "string" || attemptId === "" || typeof request !== "string" || request === "") return undefined;
  if ((hash !== undefined && (typeof hash !== "string" || hash === "")) || (candidate !== undefined && (typeof candidate !== "string" || candidate === ""))) return undefined;
  return { attemptId, request, ...(hash === undefined ? {} : { hash }), ...(candidate === undefined ? {} : { candidate }) };
}

/** @throws {never} */
export function attemptOfText(text: string | null): Attempt {
  if (text === null) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...empty, bytesId: text };
  }
  const record = recordOf(parsed);
  if (record === undefined) return { ...empty, bytesId: text };
  return { identity: record.attemptId, bytesId: record.request, hash: record.hash ?? "", candidate: record.candidate ?? "" };
}

/** @throws {never} */
export function textOfAttempt(attempt: Attempt): string {
  const record: SlotRecord = {
    attemptId: attempt.identity,
    request: attempt.bytesId,
    ...(attempt.hash === "" ? {} : { hash: attempt.hash }),
    ...(attempt.candidate === "" ? {} : { candidate: attempt.candidate }),
  };
  return JSON.stringify(record);
}

/** @throws {never} */
export function unreadableSlot(attempt: Attempt): boolean {
  return attempt.identity === "" && attempt.bytesId !== "";
}

/** @throws {never} */
export function readSlotText(storage: SlotStorage | undefined, key: string): string | null {
  if (storage === undefined) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** @throws {Error} */
export function writeSlotText(storage: SlotStorage | undefined, key: string, text: string | null): void {
  if (storage === undefined) throw new Error("Browser storage is unavailable.");
  if (text === null) storage.removeItem(key);
  else storage.setItem(key, text);
}

/** @throws {never} */
export function clearUnreadableText(storage: SlotStorage | undefined, key: string, raw: string): boolean {
  if (storage === undefined) return false;
  try {
    if (storage.getItem(key) !== raw) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
