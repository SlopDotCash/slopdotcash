// spec/slopbot/budgetBlocks.md, "Story: Block a review on a Surplus spending denial and resume it once"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { outcome } from "@repo/platform/testing/area";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { ProjectAudience } from "@repo/ports/backend";
import { Notices } from "@repo/ports/operations";
import type { Driver, Options } from "../../gen/slopbot__budgetBlocks.conformance.ts";
import type { BudgetState, Event, RowStatus } from "../../gen/slopbot__budgetBlocks.ts";
import { budgetBlockedUntil, budgetState, recordBudgetBlock, recordBudgetDispatch, sendBudgetResume } from "../../src/budget/store.vibe";
import { type Numbered, activeInstallation, deliver, installationState } from "../../src/installation/store.vibe";
import { type Job, JobQueue } from "../../src/jobs/job.vibe";
import { type ReviewClaim, claimReview, finishReview } from "../../src/lease/store.vibe";
import type { Finished, ReviewRow } from "../../src/lease/writes.vibe";
import { verdictOf } from "../support/settled.ts";

const base = Date.parse("2026-11-01T00:00:00.000Z");
const clock = settableClock(base + 1000);
const mf = startWorker({ d1: { SLOPBOT_DB: "budget-blocks-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOPBOT_DB");

const keys = ["a", "b"];
const account = { id: 1, login: "budget-owner", type: "User" };
let generation = 0;
const nows = new Map<string, number>();
const tokens = new Map<string, number>();
const claims = new Map<string, ReviewClaim>();
const sends = new Map<string, number>();
const installs = new Map<string, number[]>();

function reviewKeyOf(key: string) {
  return `budget-${generation}-${key}`;
}

function installationOf(key: string) {
  return 700_000 + generation * 10 + keys.indexOf(key);
}

function jobOf(key: string) {
  return { kind: "review" as const, deliveryId: `delivery-${reviewKeyOf(key)}`, installationId: installationOf(key), repositoryId: 7001, owner: "ada", repo: "widgets", itemKind: "pull_request" as const, number: 5 };
}

function sentKey(job: Job) {
  return keys.find((key) => job.deliveryId === `delivery-${reviewKeyOf(key)}`);
}

const queue = Layer.succeed(JobQueue, {
  send: (job: Job) => Effect.sync(() => {
    const key = sentKey(job);
    if (key !== undefined) sends.set(key, (sends.get(key) ?? 0) + 1);
  }),
});
const noNotices = Layer.mergeAll(
  Layer.succeed(ProjectAudience, { listedBy: () => Effect.succeed(sql`SELECT NULL AS recipient WHERE 0`), owners: () => Effect.succeed(sql`SELECT NULL AS recipient WHERE 0`) }),
  Layer.succeed(Notices, { statements: () => Effect.succeed([]), fanout: () => Effect.succeed([]), payoutRecipient: (project) => Effect.succeed(project.stewardGithubId) }),
);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, queue, noNotices, clock.layer));

const millis = (seconds: number) => base + seconds * 1000;
const seconds = (at: number) => (at === 0 ? 0 : (at - base) / 1000);
const tokenText = (key: string, token: number) => `claim-${reviewKeyOf(key)}-${token}`;
const stored: Record<Exclude<RowStatus, "NoRow" | "Running">, Finished> = { Completed: "completed", Failed: "failed", Skipped: "skipped" };

function at(key: string) {
  const now = nows.get(key) ?? 1;
  clock.set(millis(now));
  return now;
}

function deliveriesOf(key: string): [Numbered, ...Numbered[]] {
  const numbers = installs.get(key) ?? [];
  return [{ deliveryId: `budget-${generation}-${key}-none`, number: 0 }, ...numbers.map((number) => ({ deliveryId: `budget-${generation}-${key}-${number}`, number }))];
}

function rowOf(key: string): ReviewRow {
  return { reviewKey: reviewKeyOf(key), installationId: installationOf(key), repositoryId: 7001, itemKind: "pull_request", itemNumber: 5, itemNodeId: "PR_5", authorId: 77_000 + generation, revision: "head", contentDigest: "content", policyDigest: "policy" };
}

async function claim(key: string, token: number, leaseUntil: number): Promise<"accepted" | "refused"> {
  at(key);
  if (token <= (tokens.get(key) ?? 0)) return "refused";
  if (!(await runtime.runPromise(activeInstallation(installationOf(key))))) return "refused";
  if ((await runtime.runPromise(budgetBlockedUntil(reviewKeyOf(key)))) !== undefined) return "refused";
  const exit = await runtime.runPromiseExit(claimReview(rowOf(key), { token: tokenText(key, token), route: "AdvisoryReview", expiresAt: millis(leaseUntil) / 1000 }));
  return verdictOf(exit, (outcome) => {
    if (outcome.kind !== "claimed") return false;
    tokens.set(key, token);
    claims.set(key, outcome.claim);
    return true;
  });
}

async function finish(key: string, token: number, status: RowStatus): Promise<"accepted" | "refused"> {
  at(key);
  if (status === "NoRow" || status === "Running") return "refused";
  const held = claims.get(key);
  const claim: ReviewClaim = { reviewKey: reviewKeyOf(key), token: tokenText(key, token), start: held?.token === tokenText(key, token) ? held.start : "First" };
  return verdictOf(await runtime.runPromiseExit(finishReview(claim, stored[status], {})));
}

function dispatched(key: string, event: Event) {
  switch (event.type) {
    case "elapse":
      if (event.seconds <= 0) return "refused" as const;
      nows.set(key, at(key) + event.seconds);
      return "accepted" as const;
    case "applyInstallation": {
      at(key);
      const numbers = installs.get(key) ?? [];
      if (!numbers.includes(event.e.delivery)) installs.set(key, [...numbers, event.e.delivery]);
      return outcome(deliver({
        installationId: installationOf(key),
        account: event.e.hasAccount ? account : undefined,
        deliveryId: `budget-${generation}-${key}-${event.e.delivery}`,
        event: event.e,
        servedProjects: [],
      }, deliveriesOf(key)), runtime);
    }
    case "claim":
      return claim(key, event.token, event.leaseUntil);
    case "finish":
      return finish(key, event.token, event.status);
    case "recordBlock":
      at(key);
      return outcome(recordBudgetBlock({ reviewKey: reviewKeyOf(key), token: tokenText(key, event.token) }, jobOf(key), { ...event.d, resetAt: millis(event.d.resetAt) }), runtime);
    case "sendResume":
      at(key);
      return outcome(sendBudgetResume(reviewKeyOf(key)), runtime);
    case "recordDispatch":
      at(key);
      return outcome(recordBudgetDispatch(reviewKeyOf(key)), runtime);
  }
}

type Observed = Omit<BudgetState, "token" | "current" | "install"> & {
  readonly current: Omit<BudgetState["current"], "token">;
  readonly install: Omit<BudgetState["install"], "lostNotices" | "failures">;
};

function view(state: BudgetState): Observed {
  return {
    now: state.now,
    status: state.status,
    leaseUntil: state.leaseUntil,
    current: { id: state.current.id, retryAt: state.current.retryAt, dispatched: state.current.dispatched },
    blockCount: state.blockCount,
    sends: state.sends,
    install: { known: state.install.known, suspended: state.install.suspended, removed: state.install.removed, sourceTime: state.install.sourceTime, processed: state.install.processed },
  };
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: () => {
    generation++;
    nows.clear();
    tokens.clear();
    claims.clear();
    sends.clear();
    installs.clear();
  },
  dispatch: (key, event: Event) => dispatched(key, event),
  observe: async (key) => {
    at(key);
    const state = await runtime.runPromise(budgetState(reviewKeyOf(key)));
    const install = await runtime.runPromise(installationState(installationOf(key), deliveriesOf(key)));
    return view({
      ...state,
      now: seconds(state.now),
      leaseUntil: seconds(state.leaseUntil),
      current: { ...state.current, retryAt: seconds(state.current.retryAt) },
      sends: sends.get(key) ?? 0,
      install,
    });
  },
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys, view, walks: 4, steps: 14 };
