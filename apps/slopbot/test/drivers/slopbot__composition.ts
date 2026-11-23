// spec/slopbot/composition.md, "Story: Close only from a complete current review under the live claim"; spec/slopbot/composition.md, "Story: A confirmed close debits once, and a reopen or upheld appeal reverses it once"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { noticePorts } from "@repo/operations/live";
import { type ProjectView, Registry, Restrictions } from "@repo/ports/backend";
import { Enforcement } from "@repo/ports/security";
import type { CloseAttempt, Recheck } from "../../gen/slopbot__closeAttempt.ts";
import type { Driver, Options } from "../../gen/slopbot__composition.conformance.ts";
import type { Event, Slopbot } from "../../gen/slopbot__composition.ts";
import type { BanStatus, SiblingStatus } from "../../gen/slopbot__appeals.ts";
import type { ReopenSource } from "../../gen/slopbot__webhookDelivery.ts";
import { dueJobOf } from "../../src/appeals/due.vibe";
import { type Step, appealKeyOf, categoryNameOf, commitAppeal, loadAppeal } from "../../src/appeals/store.vibe";
import { penaltiesOf, recordPenaltyStatements, reversePenalty } from "../../src/closeAttempt/penalty.vibe";
import { observeConfirmedReopens, observeDisputes } from "../../src/closeAttempt/reopen.vibe";
import { type AttemptRecord, attemptState, openAttempt, sendAttempt } from "../../src/closeAttempt/store.vibe";
import { confirmSlot, rejectSlot, reserveSlot } from "../../src/closeCapacity/store.vibe";
import { type ReviewClaim, assertReviewClaim, claimReview, finishReview, heldLease, leaseView } from "../../src/lease/store.vibe";
import { settled } from "../support/settled.ts";

const author = 5;
const slopbotWorker = -10;
const githubWebhook = -11;
const projectKey = "composition-project";
const fence = { projectId: projectKey, revision: 3, manifestSha256: "m3", enforcementGeneration: 4 };

const mf = startWorker({ d1: { SLOPBOT_DB: "composition-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOPBOT_DB");
const clock = settableClock(1000);

let generation = 0;

const repository = () => 7_000_000 + generation;
const node = () => `pr-composition-g${generation}`;
const reviewKey = () => `composition-g${generation}`;
const appealKey = () => appealKeyOf(node(), "head");
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const nowSeconds = () => Math.floor(clock.now() / 1000);

function viewOf(key: string): ProjectView | undefined {
  if (key !== projectKey) return undefined;
  return {
    projectId: projectKey,
    revision: fence.revision,
    manifestSha256: fence.manifestSha256,
    rowStatus: "Active",
    manifestStatus: "Active",
    listingTier: "Community",
    retirement: "NotRetired",
    stewardGithubId: "1",
    stewardAccount: "UserSteward",
    listing: { fromApplication: false },
    repositories: [{ id: String(repository()), nodeId: "R_7", fullName: "o/r", integrationBranch: "main", aliases: [] }],
    closureConsent: true,
  };
}

const ports = Layer.mergeAll(
  Layer.succeed(Registry, {
    project: (key) => Effect.succeed(viewOf(key)),
    byRepository: () => Effect.succeed(undefined),
    byPath: () => Effect.succeed(undefined),
    active: () => Effect.succeed([]),
    pausedProjects: () => Effect.succeed([]),
    appendVaultRegistration: () => Effect.die(new Error("this driver registers no vault")),
    fence: () => Effect.succeed(sql`1`),
  }),
  Layer.succeed(Enforcement, {
    project: () => Effect.succeed({ restriction: "Clear" as const, enforcementGeneration: fence.enforcementGeneration, clearanceGeneration: "0" }),
    fence: () => Effect.succeed(sql`1`),
  }),
  Layer.succeed(Restrictions, {
    account: () => Effect.succeed({ banned: false }),
    project: () => Effect.succeed({ restricted: false }),
    fence: () => Effect.succeed(sql`1`),
    unbanned: () => Effect.succeed(sql`1`),
  }),
);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer, ports, noticePorts));
const run: typeof runtime.runPromise = (effect, options) => runtime.runPromise(effect, options);

type Observable = Pick<Slopbot, "attempt" | "lease" | "penalties" | "appeal" | "confirmedReopen">;

type Observed = Pick<CloseAttempt, "attempt" | "rejected" | "blocked" | "moderatorNotices" | "maintainerReopened" | "authorAppealed" | "appealUpheld" | "slopbotReopened"> & {
  readonly lease: Pick<Slopbot["lease"], "status" | "close">;
  readonly debits: ReadonlyArray<Pick<Slopbot["penalties"]["rows"][number], "revision" | "category" | "debit" | "moderatorReview" | "reversed"> & { readonly reason: string | null }>;
  readonly appealOpened: boolean;
  readonly resolution: Slopbot["appeal"]["resolution"];
  readonly confirmedReopen: boolean;
};

let record: AttemptRecord;
let serverRun: string | undefined;
let recorded = false;
let retained: ReopenSource | undefined;
let ban: BanStatus = "BanUnknown";
let sibling: SiblingStatus = "SiblingUnknown";
const claims = new Map<number, ReviewClaim>();
const attemptKeys = new Map<number, string>();
let latestClaim: number | undefined;

async function freshAttempt() {
  const initial = await run(attemptState(await run(openAttempt())));
  const identity = { ...initial.candidate.identity, itemNode: node() };
  record = await run(openAttempt({ ...initial, candidate: { ...initial.candidate, identity } }));
}

await freshAttempt();

function ours(text: string) {
  return text === "pr" ? node() : text;
}

function committed(steps: ReadonlyArray<Step>) {
  return settled(commitAppeal(appealKey(), {}, () => steps), runtime);
}

function observations(): ReadonlyArray<Step> {
  return [
    ...(ban === "BanUnknown" ? [] : [{ event: { type: "observeBan", status: ban }, by: 0, optional: true } satisfies Step]),
    ...(sibling === "SiblingUnknown" ? [] : [{ event: { type: "observeSibling", siblingStatus: sibling }, by: 0, optional: true } satisfies Step]),
  ];
}

async function attemptStep(send: Parameters<typeof sendAttempt>[1]) {
  return settled(sendAttempt(record, send), runtime);
}

async function rolledBack(work: () => Promise<boolean>) {
  const before = await run(attemptState(record));
  if (await work()) return "accepted" as const;
  record = await run(openAttempt(before));
  return "refused" as const;
}

async function leaseNow() {
  const held = latestClaim === undefined ? undefined : claims.get(latestClaim);
  if (held === undefined) {
    const { lease } = await run(leaseView(reviewKey()));
    return { token: 0, running: lease.status === "Running", expiresAt: lease.expires, observedAt: lease.now };
  }
  const { lease, token } = await run(heldLease(held));
  return { token, running: lease.status === "Running", expiresAt: lease.expires, observedAt: lease.now };
}

async function composedRecheck(recheck: Recheck): Promise<Recheck> {
  const identity = { ...recheck.gate.source.identity, itemNode: ours(recheck.gate.source.identity.itemNode) };
  const proven = serverRun !== undefined && recorded;
  return {
    gate: {
      ...recheck.gate,
      source: { ...recheck.gate.source, identity },
      participation: {
        member: serverRun === undefined ? 0 : author,
        membership: recheck.gate.participation.membership,
        copiedMarker: false,
        events: proven ? [{ actor: author, sessionActor: author, project: 1, repository: identity.repository, prNode: node() }] : [],
      },
    },
    fence: recheck.fence,
    lease: await leaseNow(),
  };
}

async function reserve(event: Extract<Event, { type: "reserveClose" }>) {
  const held = latestClaim === undefined ? undefined : claims.get(latestClaim);
  if (held === undefined) return "refused" as const;
  return rolledBack(async () => {
    if ((await attemptStep({ type: "reserveClose", grant: { ...event.grant, itemNode: ours(event.grant.itemNode) } })) === "refused") return false;
    const reserved = await run(reserveSlot({
      repositoryId: repository(),
      repositoryPath: "o/r",
      itemNodeId: node(),
      reviewKey: reviewKey(),
      claimToken: held.token,
      authorId: author,
      revision: "head",
      dailyCap: 25,
      penaltyEligible: true,
      recovery: "{}",
      fence,
    }));
    if (reserved.kind === "refused") return false;
    attemptKeys.set(event.grant.attemptId, reserved.attemptKey);
    return true;
  });
}

async function confirm(event: Extract<Event, { type: "confirmClose" }>) {
  const state = await run(attemptState(record));
  const attemptKey = attemptKeys.get(state.attempt.id);
  if (attemptKey === undefined) return "refused" as const;
  return rolledBack(async () => {
    if ((await attemptStep({ type: "confirmClose", closeEvent: { ...event.closeEvent, itemNode: ours(event.closeEvent.itemNode) } })) === "refused") return false;
    const closedAt = iso(event.closeEvent.closedAt);
    const also = await run(recordPenaltyStatements({
      itemNodeId: node(),
      repositoryId: repository(),
      projectId: projectKey,
      authorId: author,
      revision: "head",
      category: categoryNameOf(state.candidate.triage.verdict.category),
      reviewKey: reviewKey(),
      closedAt,
    }));
    return run(confirmSlot({ repositoryId: repository(), itemNodeId: node(), reviewKey: reviewKey(), attemptKey, revision: "head", closedAt, also }));
  });
}

async function reject(event: Extract<Event, { type: "rejectClose" }>) {
  const attemptKey = attemptKeys.get(event.githubRefusal.attemptId);
  if (attemptKey === undefined) return "refused" as const;
  return rolledBack(async () => {
    if ((await attemptStep({ type: "rejectClose", githubRefusal: event.githubRefusal })) === "refused") return false;
    return run(rejectSlot({ repositoryId: repository(), itemNodeId: node(), reviewKey: reviewKey(), attemptKey, status: event.githubRefusal.status }));
  });
}

async function retain(source: ReopenSource) {
  const valid = source.installation > 0 && source.repository > 0 && source.number > 0 && source.sender > 0 && source.revision !== "" && source.occurred > 0;
  if (!valid || retained !== undefined || source.node !== "pr" || source.repository !== 7) return "refused" as const;
  const stored = { installationId: source.installation, repositoryId: repository(), itemKind: source.kind === "IssueItem" ? "issue" : "pull_request", number: source.number, senderId: source.sender, itemNodeId: node(), revision: source.revision, occurredAt: iso(source.occurred) };
  await db.prepare("INSERT INTO slopbot_deliveries (delivery_id, event, received_at, reopen_source) VALUES (?, 'pull_request', ?, ?)")
    .bind(`reopen-${generation}`, iso(nowSeconds()), JSON.stringify(stored)).run();
  retained = source;
  return "accepted" as const;
}

async function confirmReopen(event: Extract<Event, { type: "confirmReopen" }>) {
  const { evidence } = event;
  const source = retained;
  if (source === undefined) return "refused" as const;
  const sameSource = JSON.stringify(source) === JSON.stringify(evidence.source) && source.node === evidence.node && evidence.itemState !== "ClosedByOther" && (!evidence.reversalOnly || evidence.existingDebit);
  if (!sameSource || source.sender === evidence.author || !evidence.maintainer) return "refused" as const;
  const done = await db.prepare("UPDATE slopbot_deliveries SET reopen_confirmed_at = ? WHERE delivery_id = ? AND reopen_confirmed_at IS NULL").bind(iso(nowSeconds()), `reopen-${generation}`).run();
  if (done.meta.changes !== 1) return "refused" as const;
  await run(observeConfirmedReopens(record));
  await run(reversePenalty(node(), "maintainer_reopen", { revision: source.revision, occurredAt: iso(source.occurred) }));
  if ((await run(loadAppeal(appealKey()))).appeal.opened)
    await committed([{ event: { type: "maintainerReopen", decision: { item: node(), revision: source.revision, actor: source.sender, role: "CurrentMaintainer" } }, by: 0, optional: true }]);
  return "accepted" as const;
}

async function openAppeal(by: number) {
  const job = dueJobOf(appealKey(), { installationId: 1, repositoryId: repository(), owner: "o", repo: "r", itemKind: "pull_request", number: 3 });
  const outcome = await settled(commitAppeal(appealKey(), { opening: { author, repositoryId: repository(), scope: "ScopeActive", job } }, (loaded) => [{ event: { type: "open", subject: loaded.candidate }, by }]), runtime);
  if (outcome === "accepted") await run(observeDisputes(record));
  return outcome;
}

async function decide(uphold: boolean, by: number) {
  const outcome = await committed([{ event: { type: "moderatorDecide", uphold }, by }]);
  if (outcome === "refused" || !uphold) return outcome;
  const { row } = await run(loadAppeal(appealKey()));
  await run(reversePenalty(node(), "appeal_upheld", { revision: "head", occurredAt: row?.opened_at ?? iso(nowSeconds()) }));
  await run(observeDisputes(record));
  return outcome;
}

function worker(by: number, work: () => Promise<"accepted" | "refused">) {
  return by === slopbotWorker ? work() : Promise.resolve("refused" as const);
}

async function dispatch(event: Event, by: number): Promise<"accepted" | "refused"> {
  switch (event.type) {
    case "registerRun":
      if (by !== author || event.serverRun === "" || (serverRun !== undefined && serverRun !== event.serverRun)) return "refused";
      serverRun = event.serverRun;
      return "accepted";
    case "recordOpened":
      if (serverRun === undefined || by !== author || event.at <= 0) return "refused";
      recorded = true;
      return "accepted";
    case "observeRecheck":
      return worker(by, async () => attemptStep({ type: "observeRecheck", recheck: await composedRecheck(event.recheck) }));
    case "observeTime":
      return worker(by, async () => {
        if (event.time < nowSeconds()) return "refused";
        if ((await run(loadAppeal(appealKey()))).appeal.opened && (await committed([{ event: { type: "observeTime", observedAt: event.time }, by: 0 }])) === "refused") return "refused";
        clock.set(event.time * 1000);
        return "accepted";
      });
    case "claimReview":
      return worker(by, async () => {
        const text = `composition-g${generation}-token-${event.token}`;
        const row = { reviewKey: reviewKey(), installationId: 1, repositoryId: repository(), itemKind: "pull_request" as const, itemNumber: 3, itemNodeId: node(), authorId: author, revision: "head", contentDigest: "review", policyDigest: "policy" };
        const claimed = await runtime.runPromiseExit(claimReview(row, { token: text, route: event.route, expiresAt: event.expires }));
        if (claimed._tag === "Failure" || claimed.value.kind !== "claimed") return "refused";
        claims.set(event.token, claimed.value.claim);
        latestClaim = event.token;
        return "accepted";
      });
    case "finishReview":
      return worker(by, async () => {
        const claim = claims.get(event.token);
        const status = event.claimStatus === "Completed" ? "completed" : event.claimStatus === "Failed" ? "failed" : undefined;
        if (claim === undefined || status === undefined) return "refused";
        return settled(finishReview(claim, status, { action: "close" }), runtime);
      });
    case "reserveClose":
      return worker(by, () => reserve(event));
    case "requestClose":
      return worker(by, async () => {
        const claim = claims.get((await run(attemptState(record))).attempt.leaseToken);
        if (claim === undefined || (await settled(assertReviewClaim(claim), runtime)) === "refused") return "refused";
        return attemptStep({ type: "requestClose" });
      });
    case "rejectClose":
      return by === githubWebhook ? reject(event) : "refused";
    case "confirmClose":
      return by === githubWebhook ? confirm(event) : "refused";
    case "confirmCloseComment":
      return worker(by, () => attemptStep({ type: "confirmCloseComment" }));
    case "retainReopen":
      return by === githubWebhook ? retain(event.source) : "refused";
    case "confirmReopen":
      return worker(by, () => confirmReopen(event));
    case "openAppeal":
      return openAppeal(by);
    case "draftAppeal":
      return worker(by, () => committed([{ event: { type: "draft", uphold: event.uphold, confidenceHundredths: event.confidenceHundredths }, by: 0, confidence: event.confidenceHundredths / 100 }]));
    case "observeBan":
      return worker(by, async () => {
        const outcome = await committed([{ event: { type: "observeBan", status: event.ban }, by: 0 }]);
        if (outcome === "accepted") ban = event.ban;
        return outcome;
      });
    case "observeSibling":
      return worker(by, async () => {
        const outcome = await committed([{ event: { type: "observeSibling", siblingStatus: event.siblingStatus }, by: 0 }]);
        if (outcome === "accepted") sibling = event.siblingStatus;
        return outcome;
      });
    case "escalateAppeal":
      return worker(by, () => committed([...observations(), { event: { type: "escalateByCriteria" }, by: 0 }]));
    case "decideAppeal":
      return decide(event.uphold, by);
    case "observeItem":
      return by === githubWebhook ? attemptStep({ type: "observeItem", itemState: { ...event.itemState, itemNode: ours(event.itemState.itemNode) } }) : "refused";
    case "reopenOwnClose":
      return worker(by, () => attemptStep({ type: "reopenOwnClose" }));
    case "notifyModerator":
      return worker(by, async () => {
        const penalties = await run(penaltiesOf(node()));
        return penalties.rows.some((row) => row.moderatorReview) ? attemptStep({ type: "notifyModerator", recipient: event.recipient }) : "refused";
      });
  }
}

function view(state: Observable): Observed {
  const { attempt } = state;
  return {
    attempt: attempt.attempt,
    rejected: attempt.rejected,
    blocked: attempt.blocked,
    moderatorNotices: [...attempt.moderatorNotices].sort((left, right) => left - right),
    maintainerReopened: attempt.maintainerReopened,
    authorAppealed: attempt.authorAppealed,
    appealUpheld: attempt.appealUpheld,
    slopbotReopened: attempt.slopbotReopened,
    lease: { status: state.lease.status, close: state.lease.close },
    debits: state.penalties.rows.map((row) => ({ revision: row.revision, category: row.category, debit: row.debit, moderatorReview: row.moderatorReview, reversed: row.reversed, reason: row.reversed ? row.reason : null })),
    appealOpened: state.appeal.opened,
    resolution: state.appeal.resolution,
    confirmedReopen: state.confirmedReopen,
  };
}

async function observe(): Promise<Observed> {
  const attempt = await run(attemptState(record));
  const { lease } = await run(leaseView(reviewKey()));
  const penalties = await run(penaltiesOf(node()));
  const { appeal } = await run(loadAppeal(appealKey()));
  const reopen = await db.prepare("SELECT reopen_confirmed_at AS at FROM slopbot_deliveries WHERE delivery_id = ?").bind(`reopen-${generation}`).first<{ at: string | null }>();
  return view({ attempt, lease, penalties, appeal, confirmedReopen: reopen?.at != null });
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: async () => {
    generation++;
    serverRun = undefined;
    recorded = false;
    retained = undefined;
    ban = "BanUnknown";
    sibling = "SiblingUnknown";
    claims.clear();
    attemptKeys.clear();
    latestClaim = undefined;
    clock.set(1000);
    await freshAttempt();
  },
  dispatch: (_key, event: Event, by) => dispatch(event, Number(by ?? 0)),
  observe: () => observe(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys: ["candidate"], view, walks: 4, steps: 16 };
