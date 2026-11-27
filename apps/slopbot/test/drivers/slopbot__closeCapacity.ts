// spec/slopbot/closeCapacity.md, "Story: Reserve a close slot before any GitHub request"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { type ProjectView, Registry } from "@repo/ports/backend";
import { Enforcement } from "@repo/ports/security";
import type { Driver, Options } from "../../gen/slopbot__closeCapacity.conformance.ts";
import type { Capacity, Event, Key, RegistryRead, ReversalEvidence } from "../../gen/slopbot__closeCapacity.ts";
import { capacityState, confirmSlot, rejectSlot, reserveSlot } from "../../src/closeCapacity/store.vibe";

const week = 604_800;
const path = "ada/capacity";
const mf = startWorker({ d1: { SLOPBOT_DB: "capacity-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOPBOT_DB");
const clock = settableClock(0);

let current: RegistryRead | undefined;

function projectId(project: number) {
  return project === 1 ? "capacity-project" : `capacity-project-${project}`;
}

function viewOf(projectKey: string): ProjectView | undefined {
  if (current === undefined || projectId(current.fence.project) !== projectKey) return undefined;
  return {
    projectId: projectKey,
    revision: current.fence.projectRevision,
    manifestSha256: current.fence.manifestDigest,
    rowStatus: current.projectActive ? "Active" : "Paused",
    manifestStatus: current.projectActive ? "Active" : "Paused",
    listingTier: current.listed ? "Community" : "Retired",
    retirement: current.listed ? "NotRetired" : "OwnerRemoved",
    stewardGithubId: "1",
    stewardAccount: "UserSteward",
    listing: { fromApplication: false },
    repositories: current.repositoriesRegistered ? [{ id: "1", nodeId: "R_1", fullName: path, integrationBranch: "main", aliases: [] }] : [],
    closureConsent: true,
  };
}

const registry = Layer.mergeAll(
  Layer.succeed(Registry, {
    project: (key) => Effect.succeed(viewOf(key)),
    byRepository: () => Effect.succeed(undefined),
    byPath: () => Effect.succeed(undefined),
    active: () => Effect.succeed([]),
    pausedProjects: () => Effect.succeed([]),
    appendVaultRegistration: () => Effect.die(new Error("this test registers no vault")),
    fence: () => Effect.succeed(sql`1`),
  }),
  Layer.succeed(Enforcement, {
    project: () => Effect.succeed({ restriction: "Clear" as const, enforcementGeneration: current?.fence.enforcementPosition ?? 0, clearanceGeneration: "0" }),
    fence: () => Effect.succeed(sql`1`),
  }),
);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer, registry));

type Observed = Pick<Capacity, "now" | "dailyCap"> & {
  readonly closes: ReadonlyArray<{ readonly key: Key; readonly closedAt: number }>;
  readonly pending: ReadonlyArray<Key>;
  readonly rejected: number;
  readonly reversals: ReadonlyArray<ReversalEvidence>;
};

let generation = 0;
let cap = 25;
let last = 0;
let reserveSeq = 0;
let reversalCount = 0;
const attempts = new Map<number, string>();

const repository = () => 8_300_000 + generation;
const nodeOf = (item: string) => item === "" ? "" : `cap-g${generation}-${item}`;
const itemOf = (node: string) => node.replace(`cap-g${generation}-`, "");
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const nowSeconds = () => Math.floor(clock.now() / 1000);

function accepted(value: boolean): "accepted" | "refused" {
  return value ? "accepted" : "refused";
}

async function reserve(event: Extract<Event, { type: "reserve" }>) {
  const { request } = event;
  if (request.attemptId <= last) return "refused" as const;
  current = event.registry;
  const seq = ++reserveSeq;
  const claimToken = `cap-g${generation}-token-${seq}`;
  const reviewKey = `cap-g${generation}-review-${seq}`;
  const holder = request.leaseToken > 0 && event.registry.leaseToken === request.leaseToken ? claimToken : event.registry.leaseToken === 0 ? null : `cap-g${generation}-other-${event.registry.leaseToken}`;
  await db.prepare(`INSERT INTO slopbot_reviews (review_key, installation_id, repository_id, item_kind, item_number, item_node_id, author_id, revision, content_digest, policy_digest, status, created_at, claim_token, lease_expires_at)
    VALUES (?, 1, ?, 'pull_request', 1, ?, 5, ?, 'c', 'p', ?, ?, ?, ?)`)
    .bind(reviewKey, repository(), nodeOf(request.key.item) || "cap-empty", request.key.revision, event.registry.leaseRunning ? "running" : "completed", iso(nowSeconds()), holder,
      event.registry.leaseRunning ? iso(nowSeconds() + event.registry.leaseExpiresAt - event.registry.at) : null)
    .run();
  const reserved = await runtime.runPromise(reserveSlot({
    repositoryId: repository(),
    repositoryPath: path,
    itemNodeId: nodeOf(request.key.item),
    reviewKey,
    claimToken,
    authorId: 5,
    revision: request.key.revision,
    dailyCap: cap,
    penaltyEligible: false,
    recovery: "{}",
    fence: { projectId: projectId(request.fence.project), revision: request.fence.projectRevision, manifestSha256: request.fence.manifestDigest, enforcementGeneration: request.fence.enforcementPosition },
  }));
  if (reserved.kind === "refused") return "refused" as const;
  last = request.attemptId;
  attempts.set(request.attemptId, reserved.attemptKey);
  return "accepted" as const;
}

async function reversal(evidence: ReversalEvidence) {
  if (evidence.item === "" || evidence.at <= 0 || evidence.at > nowSeconds() || evidence.kind === "UpheldValueAppeal") return "refused" as const;
  reversalCount++;
  if (evidence.kind === "MaintainerReopen") {
    await db.prepare("INSERT INTO slopbot_actions (review_key, repository_id, item_node_id, action, detail, created_at) VALUES (?, ?, ?, 'human_reopen', '9', ?)")
      .bind(`reopen:cap-g${generation}-${reversalCount}`, repository(), nodeOf(evidence.item), iso(evidence.at)).run();
  } else {
    await db.prepare(`INSERT INTO slopbot_appeals (appeal_key, repository_id, item_node_id, appellant_github_id, job_json, opened_at, due_at, resolved_at, resolution, resolved_by)
      VALUES (?, ?, ?, '5', '{}', ?, ?, ?, 'upheld', 'maintainer')`)
      .bind(`appeal:cap-g${generation}-${reversalCount}`, repository(), nodeOf(evidence.item), iso(evidence.at - 2), iso(evidence.at - 1), iso(evidence.at)).run();
  }
  return "accepted" as const;
}

async function dispatch(event: Event): Promise<"accepted" | "refused"> {
  switch (event.type) {
    case "observeTime":
      if (event.observedAt < nowSeconds()) return "refused";
      clock.set(event.observedAt * 1000);
      return "accepted";
    case "observeCap":
      if (event.cap < 0 || event.cap > 200) return "refused";
      cap = event.cap;
      return "accepted";
    case "recordReversal":
      return reversal(event.reversal);
    case "reserve":
      return reserve(event);
    case "confirm": {
      const attemptKey = attempts.get(event.closeEvent.attemptId);
      if (attemptKey === undefined || event.closeEvent.actor !== "SlopbotApp") return "refused";
      const scope = { repositoryId: repository(), itemNodeId: nodeOf(event.closeEvent.item), reviewKey: "" };
      return accepted(await runtime.runPromise(confirmSlot({ ...scope, attemptKey, revision: event.closeEvent.revision, closedAt: iso(event.closeEvent.closedAt), also: [] })));
    }
    case "reject": {
      const attemptKey = attempts.get(event.githubRefusal.attemptId);
      if (attemptKey === undefined) return "refused";
      return accepted(await runtime.runPromise(rejectSlot({ repositoryId: repository(), itemNodeId: "", reviewKey: "", attemptKey, status: event.githubRefusal.status })));
    }
  }
}

function byTime<T extends { readonly key: Key; readonly closedAt: number }>(left: T, right: T) {
  return left.closedAt - right.closedAt || left.key.item.localeCompare(right.key.item) || left.key.revision.localeCompare(right.key.revision);
}

function view(state: Capacity): Observed {
  const since = state.now - week;
  const reversals = state.reversals.filter((reversal) => reversal.at > since).sort((left, right) => left.at - right.at || left.item.localeCompare(right.item));
  const reversed = new Set(reversals.map((reversal) => reversal.item));
  return {
    now: state.now,
    dailyCap: state.dailyCap,
    closes: state.closes.filter((close) => close.closedAt > since || reversed.has(close.key.item)).map((close) => ({ key: close.key, closedAt: close.closedAt })).sort(byTime),
    pending: state.pending.map((attempt) => attempt.key),
    rejected: state.rejected.length,
    reversals,
  };
}

async function observed(): Promise<Observed> {
  const state = await runtime.runPromise(capacityState({ repositoryId: repository(), itemNodeId: "", reviewKey: "" }));
  const back = (key: Key): Key => ({ item: itemOf(key.item), revision: key.revision });
  return view({
    ...state.capacity,
    dailyCap: cap,
    closes: state.capacity.closes.map((close) => ({ ...close, key: back(close.key) })),
    pending: state.capacity.pending.map((attempt) => ({ ...attempt, key: back(attempt.key) })),
    reversals: state.capacity.reversals.map((reversal) => ({ ...reversal, item: itemOf(reversal.item) })),
  });
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: () => {
    generation++;
    cap = 25;
    last = 0;
    reversalCount = 0;
    attempts.clear();
    current = undefined;
    clock.set(0);
  },
  dispatch: (_key, event: Event) => dispatch(event),
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys: ["repository"], view, walks: 4, steps: 14 };
