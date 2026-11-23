// spec/security/privacy.md, "A scanner evidence grant is redeemed once, and a download needs exactly one grant cookie, a same-origin GET and no range"
import type { D1Database, R2Bucket } from "@repo/platform/bindings";

export interface HeldPart {
  readonly githubId: string;
  readonly part: number;
}

export interface Faults {
  held: HeldPart | undefined;
}

const pollMillis = 25;
const holdMillis = 60_000;

/** @throws {never} */
export function faults(): Faults {
  return { held: undefined };
}

async function partOf(db: D1Database, key: string): Promise<number | undefined> {
  const chunk = /\/chunks\/(\d+)\//u.exec(key)?.[1];
  if (chunk !== undefined) return Number(chunk);
  const [target] = (await db.prepare("SELECT part_index FROM vetting_evidence_targets WHERE target_key=?").bind(key).all()).results;
  return typeof target?.part_index === "number" ? target.part_index : undefined;
}

async function sessionEnded(db: D1Database, githubId: string): Promise<boolean> {
  const live = await db.prepare("SELECT 1 FROM points_sessions s JOIN points_members m ON m.actor_id = s.actor_id WHERE m.github_id=? AND s.expires_at > ?").bind(githubId, new Date().toISOString()).all();
  return live.results.length === 0;
}

async function untilSessionEnds(db: D1Database, githubId: string): Promise<void> {
  const deadline = Date.now() + holdMillis;
  while (!(await sessionEnded(db, githubId)) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, pollMillis));
}

/** @throws {never} */
export function faultyBucket(binding: R2Bucket, db: D1Database, plan: Faults): R2Bucket {
  return {
    get: async (key) => {
      const held = plan.held;
      if (held !== undefined && (await partOf(db, key)) === held.part) {
        plan.held = undefined;
        await untilSessionEnds(db, held.githubId);
      }
      return binding.get(key);
    },
    head: (key) => binding.head(key),
    put: (key, value, options) => binding.put(key, value, options),
  };
}
