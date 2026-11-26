// spec/points/participation.md, "Membership keeps its join instant and its stored welcome value"; spec/points/participation.md, "An X account is claimed once, forever, by its first actor"; spec/points/participation.md, "Stored awards include rows recorded on the cutoff day, which never count"
import { randomBytes } from "node:crypto";
import { Cause, type Effect, Exit, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/points__participation.conformance.ts";
import type { Event, Participation, XAward } from "../../gen/points__participation.ts";
import type { Facts } from "../../src/accounts/store/codec.vibe";
import { type Intent, type Sender, type Settled, send } from "../../src/accounts/store/store.vibe";

const cutoffSeconds = 1792800000;
const modelCutoff = 2432123;
const modelStart = 2432100;
const unitSeconds = 3600;
const xCallback = -5;
const facts: Facts = { xConfigured: true, mailAvailable: false, pilot: undefined, assertion: undefined };

const mf = startWorker({ d1: { SLOP_DB: "participation-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");
const clock = settableClock(millisOf(modelStart));
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer));
type Services = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;
type Outcome = "accepted" | "refused";

let generation = 0;
let sessions = new Map<number, string>();

function millisOf(model: number) {
  return (cutoffSeconds + (model - modelCutoff) * unitSeconds) * 1000;
}

function modelOf(iso: string) {
  return modelCutoff + (Date.parse(iso) / 1000 - cutoffSeconds) / unitSeconds;
}

const hex = () => randomBytes(32).toString("hex");
const suffix = () => `-g${generation}`;
const actorIdOf = (actor: number) => `n${actor}${suffix()}`;
const githubOf = (actor: number) => String(1_000_000_000 + generation * 1000 + actor);
const loginOf = (actor: number) => `p${actor}${suffix()}`;
const xIdOf = (xId: number) => `${generation}x${xId}`;

function actorFrom(actorId: string) {
  const match = /^n(\d+)-g(\d+)$/u.exec(actorId);
  return match !== null && Number(match[2]) === generation ? Number(match[1]) : undefined;
}

function xFrom(xId: string) {
  const prefix = `${generation}x`;
  return xId.startsWith(prefix) ? Number(xId.slice(prefix.length)) : undefined;
}

async function run<A>(effect: Effect.Effect<A, unknown, Services>): Promise<{ readonly outcome: "accepted"; readonly value: A } | { readonly outcome: "refused" }> {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return { outcome: "accepted", value: exit.value };
  const error = Cause.squash(exit.cause);
  if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "Rejected") return { outcome: "refused" };
  throw error;
}

async function settled(intent: Intent, sender: Sender) {
  const result = await run(send(intent, sender, facts));
  return result.outcome === "accepted" ? result.value : undefined;
}

async function firstOf(query: string, actor: number): Promise<Record<string, unknown> | undefined> {
  return (await db.prepare(query).bind(actorIdOf(actor)).all()).results[0];
}

async function memberRow(actor: number): Promise<{ readonly closed_at: string | null } | undefined> {
  const row = await firstOf("SELECT closed_at FROM points_members WHERE actor_id = ?", actor);
  return row === undefined ? undefined : { closed_at: typeof row.closed_at === "string" ? row.closed_at : null };
}

async function linkOf(actor: number): Promise<{ readonly x_id: string; readonly verified_at: string } | undefined> {
  const row = await firstOf("SELECT x_id, verified_at FROM points_x_links WHERE actor_id = ?", actor);
  return row === undefined ? undefined : { x_id: String(row.x_id), verified_at: String(row.verified_at) };
}

async function signIn(actor: number, reopen: boolean): Promise<Settled | undefined> {
  const hash = hex();
  const done = await settled({ kind: "signIn", assertion: { githubId: githubOf(actor), login: loginOf(actor), nodeId: actorIdOf(actor) }, reopen, sessionHash: hash }, { kind: "session", hash: "" });
  if (done !== undefined && done.event.type !== "refuseClosedSignIn") sessions.set(actor, hash);
  return done;
}

async function liveSession(actor: number): Promise<Sender> {
  const member = await memberRow(actor);
  if (member !== undefined && member.closed_at === null) await signIn(actor, false);
  return { kind: "session", hash: sessions.get(actor) ?? hex() };
}

async function join(actor: number): Promise<Outcome> {
  if (actor <= 0 || await memberRow(actor) !== undefined) return "refused";
  const done = await signIn(actor, false);
  return done?.event.type === "signIn" && await memberRow(actor) !== undefined ? "accepted" : "refused";
}

async function close(actor: number): Promise<Outcome> {
  const before = await memberRow(actor);
  const done = await settled({ kind: "close", confirmation: loginOf(actor) }, await liveSession(actor));
  const after = await memberRow(actor);
  return done !== undefined && before?.closed_at === null && typeof after?.closed_at === "string" ? "accepted" : "refused";
}

async function reopen(actor: number): Promise<Outcome> {
  const before = await memberRow(actor);
  if (before === undefined) return "refused";
  const done = await signIn(actor, true);
  return done?.event.type === "reopen" && (await memberRow(actor))?.closed_at === null ? "accepted" : "refused";
}

async function connectX(actor: number, xId: number): Promise<Outcome> {
  const session = await liveSession(actor);
  const flow = { stateHash: hex(), browserHash: hex() };
  const started = await settled({ kind: "startX", ...flow, verifier: "sealed", iv: "iv" }, session);
  if (started === undefined) return "refused";
  const claimed = await settled({ kind: "claimXCallback", ...flow }, { kind: "session", hash: "" });
  if (claimed === undefined) return "refused";
  const committed = await settled({ kind: "commitX", stateHash: flow.stateHash, xId: xIdOf(xId), username: `x${xId}`, wellFormed: xId > 0 }, { kind: "service", id: xCallback });
  const link = await linkOf(actor);
  return committed !== undefined && link?.x_id === xIdOf(xId) ? "accepted" : "refused";
}

async function disconnectX(actor: number): Promise<Outcome> {
  const before = await linkOf(actor);
  const done = await settled({ kind: "disconnectX" }, await liveSession(actor));
  return done !== undefined && before !== undefined && await linkOf(actor) === undefined ? "accepted" : "refused";
}

function advance(at: number): Outcome {
  if (millisOf(at) <= clock.now()) return "refused";
  clock.set(millisOf(at));
  return "accepted";
}

async function retainStoredAward(award: XAward): Promise<Outcome> {
  const actorId = actorIdOf(award.actor);
  const xId = xIdOf(award.xId);
  const awardedAt = new Date(millisOf(award.awardedAt)).toISOString();
  const eligible = `EXISTS (SELECT 1 FROM points_members WHERE actor_id = ?1) AND ?3 <= ?4 AND ?3 <= ?5
    AND NOT EXISTS (SELECT 1 FROM points_x_awards WHERE actor_id = ?1 OR x_id = ?2)
    AND NOT EXISTS (SELECT 1 FROM points_x_claims WHERE x_id = ?2 AND actor_id <> ?1)`;
  if (award.actor <= 0 || award.xId <= 0 || award.awardedAt < 0) return "refused";
  const bounds = [actorId, xId, awardedAt, new Date(millisOf(modelCutoff)).toISOString(), new Date(clock.now()).toISOString()];
  try {
    const [, inserted] = await db.batch([
      db.prepare(`INSERT INTO points_x_claims (x_id, actor_id, claimed_at) SELECT ?2, ?1, ?3 WHERE ${eligible} AND NOT EXISTS (SELECT 1 FROM points_x_claims WHERE x_id = ?2)`).bind(...bounds),
      db.prepare(`INSERT INTO points_x_awards (actor_id, x_id, awarded_at, points) SELECT ?1, ?2, ?3, ?6 WHERE ${eligible}`).bind(...bounds, award.points),
    ]);
    return inserted?.meta.changes === 1 ? "accepted" : "refused";
  } catch {
    return "refused";
  }
}

async function dispatch(event: Event): Promise<Outcome> {
  switch (event.type) {
    case "join": return join(event.actor);
    case "close": return close(event.actor);
    case "reopen": return reopen(event.actor);
    case "connectX": return connectX(event.actor, event.xId);
    case "disconnectX": return disconnectX(event.actor);
    case "advance": return advance(event.at);
    case "retainStoredAward": return retainStoredAward(event.a);
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

function canonical(state: Participation): Participation {
  const byActor = <T extends { readonly actor: number }>(rows: ReadonlyArray<T>) => [...rows].sort((a, b) => a.actor - b.actor);
  return {
    now: state.now,
    members: byActor(state.members),
    closed: [...state.closed].sort((a, b) => a - b),
    awards: byActor(state.awards),
    claims: [...state.claims].sort((a, b) => a.xId - b.xId),
    links: byActor(state.links),
  };
}

async function rows(query: string) {
  return (await db.prepare(query).all()).results;
}

async function observe(): Promise<Participation> {
  const members = (await rows("SELECT actor_id, joined_at, welcome, closed_at FROM points_members")).flatMap((row) => {
    const actor = actorFrom(String(row.actor_id));
    return actor === undefined ? [] : [{ actor, joinedAt: modelOf(String(row.joined_at)), welcome: Number(row.welcome), closed: row.closed_at !== null }];
  });
  const mine = <T>(row: Record<string, unknown>, made: (actor: number, xId: number) => T) => {
    const actor = actorFrom(String(row.actor_id));
    const xId = xFrom(String(row.x_id));
    return actor === undefined || xId === undefined ? [] : [made(actor, xId)];
  };
  const awards = (await rows("SELECT actor_id, x_id, awarded_at, points FROM points_x_awards")).flatMap((row) => mine(row, (actor, xId) => ({ actor, xId, awardedAt: modelOf(String(row.awarded_at)), points: Number(row.points) })));
  const claims = (await rows("SELECT actor_id, x_id FROM points_x_claims")).flatMap((row) => mine(row, (actor, xId) => ({ xId, actor })));
  const links = (await rows("SELECT actor_id, x_id, verified_at FROM points_x_links")).flatMap((row) => mine(row, (actor, xId) => ({ actor, xId, linkedAt: modelOf(String(row.verified_at)) })));
  return canonical({
    now: modelOf(new Date(clock.now()).toISOString()),
    members: members.map(({ actor, joinedAt, welcome }) => ({ actor, joinedAt, welcome })),
    closed: members.filter((member) => member.closed).map((member) => member.actor),
    awards,
    claims,
    links,
  });
}

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation += 1;
    sessions = new Map();
    clock.set(millisOf(modelStart));
  },
  dispatch: (_key, event) => dispatch(event),
  observe: () => observe(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["participation"], walks: 4, steps: 12, view: canonical };
