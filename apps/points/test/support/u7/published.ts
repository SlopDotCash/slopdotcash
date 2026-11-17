import { readFile } from "node:fs/promises";
import type { LeaderEntry } from "../../../src/score/facts.vibe";
import type { LedgerEvent } from "../../../src/score/snapshot.vibe";

export interface Published {
  readonly ledger: ReadonlyArray<LedgerEvent>;
  readonly leaders: ReadonlyArray<LeaderEntry>;
}

function isPublished(value: unknown): value is { ledger: unknown[]; leaders: unknown[] } {
  return typeof value === "object" && value !== null && "ledger" in value && "leaders" in value && Array.isArray(value.ledger) && Array.isArray(value.leaders);
}

export async function published(project: string, month: string): Promise<Published> {
  const parsed: unknown = JSON.parse(await readFile(new URL(`../u2/cycles/${project}/${month}/source-snapshot.json`, import.meta.url), "utf8"));
  if (!isPublished(parsed)) throw new TypeError(`${project}/${month} is not a published leaderboard snapshot`);
  return { ledger: parsed.ledger as LedgerEvent[], leaders: parsed.leaders as LeaderEntry[] };
}

/** @throws {never} */
export function plain(value: object): unknown {
  return JSON.parse(JSON.stringify(value));
}
