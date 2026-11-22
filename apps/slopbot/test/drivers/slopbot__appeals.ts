// spec/slopbot/appeals.md, "Story: The author appeals and Slopbot triages first"; spec/slopbot/appeals.md, "Story: The draft is accepted or rejected, and escalated appeals go to a moderator"; spec/slopbot/appeals.md, "Story: Unresolved appeals reach a moderator after seven days and stages are posted once"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { noticePorts } from "@repo/operations/live";
import { Restrictions } from "@repo/ports/backend";
import type { Driver, Options } from "../../gen/slopbot__appeals.conformance.ts";
import type { Appeal, AppealSubject, BanStatus, Event, SiblingStatus } from "../../gen/slopbot__appeals.ts";
import { dueJobOf } from "../../src/appeals/due.vibe";
import { claimPublication, releasePublication } from "../../src/appeals/publication.vibe";
import { type Step, appealKeyOf, categoryNameOf, commitAppeal, loadAppeal, postEventOf } from "../../src/appeals/store.vibe";
import { settled } from "../support/settled.ts";

const mf = startWorker({ d1: { SLOPBOT_DB: "appeal-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOPBOT_DB");
const clock = settableClock(0);
const restrictions = Layer.succeed(Restrictions, {
  account: () => Effect.succeed({ banned: false }),
  project: () => Effect.succeed({ restricted: false }),
  fence: () => Effect.succeed(sql`1`),
  unbanned: () => Effect.succeed(sql`1`),
});
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer, restrictions, noticePorts));

type Role = "appellant" | "maintainer" | "moderator" | null;
type Observed = Pick<Appeal, "opened" | "subject" | "appellant" | "openedAt" | "now" | "queuedAt" | "draft" | "draftConfidence" | "escalation" | "notices" | "resolution" | "postedDraft" | "postedEscalation" | "postedResolution"> & { readonly resolvedRole: Role };

let generation = 0;
let attempt = 0;
let opened = false;
let ban: BanStatus = "BanUnknown";
let sibling: SiblingStatus = "SiblingUnknown";
let comments = 0;

function node() {
  return `pr-appeal-g${generation}-o${attempt}`;
}

function revision(text: string) {
  return `${text}-g${generation}`;
}

function key() {
  return appealKeyOf(node(), revision("head"));
}

function iso(millis: number) {
  return new Date(millis).toISOString();
}

function translated(event: Event): Event {
  switch (event.type) {
    case "open":
      return { ...event, subject: { ...event.subject, item: event.subject.item === "pr" ? node() : event.subject.item, revision: revision(event.subject.revision) } };
    case "accept":
    case "reject":
    case "escalateBanAtAnswer":
    case "escalateSiblingAtAnswer":
      return { ...event, authority: { ...event.authority, item: event.authority.item === "pr" ? node() : event.authority.item } };
    case "maintainerReopen":
      return { ...event, decision: { ...event.decision, item: event.decision.item === "pr" ? node() : event.decision.item, revision: revision(event.decision.revision) } };
    default:
      return event;
  }
}

async function seed(subject: AppealSubject) {
  const name = categoryNameOf(subject.category);
  const at = iso(clock.now());
  const reviewKey = `appeal-review-${subject.item}`;
  if (subject.category !== "NoFinding")
    await db.prepare(`INSERT INTO slopbot_reviews (review_key, installation_id, repository_id, item_kind, item_number, item_node_id, author_id, revision, content_digest, policy_digest, status, verdict, action, created_at, completed_at)
      VALUES (?, 1, 1, 'pull_request', 1, ?, ?, ?, 'content', 'policy', 'completed', ?, 'label', ?, ?)`).bind(reviewKey, subject.item, subject.author, subject.revision, JSON.stringify({ category: name }), at, at).run();
  if (subject.debit > 0)
    await db.prepare(`INSERT INTO slopbot_penalties (item_node_id, repository_id, project_id, author_github_id, category, table_version, debit_thirds, period, moderator_review, review_key, recorded_at)
      VALUES (?, 1, 'appeal-project', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(subject.item, String(subject.author), name, `slopbot-penalties-v${subject.tableVersion}`,
      Math.round(subject.debit / 10), at.slice(0, 7), subject.category === "Scam" ? 1 : 0, reviewKey, at).run();
}

function committed(steps: ReadonlyArray<Step>, options: Parameters<typeof commitAppeal>[1] = {}) {
  return settled(commitAppeal(key(), options, () => steps), runtime);
}

function observations(): ReadonlyArray<Step> {
  return [
    ...(ban === "BanUnknown" ? [] : [{ event: { type: "observeBan", status: ban }, by: 0, optional: true } satisfies Step]),
    ...(sibling === "SiblingUnknown" ? [] : [{ event: { type: "observeSibling", siblingStatus: sibling }, by: 0, optional: true } satisfies Step]),
  ];
}

async function posted(event: Event) {
  const stage = event.type === "postDraft" ? "draft" : event.type === "postEscalation" ? "escalation" : "resolution";
  const claim = await runtime.runPromise(claimPublication(`${key()}:${stage}`));
  comments++;
  const outcome = await committed([{ event: postEventOf(stage), by: 0, commentId: comments }], { fence: claim.fence });
  await runtime.runPromise(releasePublication(claim.fence));
  return outcome;
}

async function opening(event: Extract<Event, { type: "open" }>, by: number) {
  await seed(event.subject);
  const job = dueJobOf(key(), { installationId: 1, repositoryId: 1, owner: "o", repo: "r", itemKind: "pull_request", number: 1 });
  const outcome = await committed([{ event, by }], { opening: { author: event.subject.author, repositoryId: 1, scope: event.subject.scope, job } });
  if (outcome === "accepted") opened = true;
  else attempt++;
  return outcome;
}

async function dispatch(raw: Event, by: number): Promise<"accepted" | "refused"> {
  const event = translated(raw);
  switch (event.type) {
    case "open":
      return opened ? committed([{ event, by }]) : opening(event, by);
    case "observeTime": {
      const outcome = await committed([{ event, by }]);
      if (outcome === "accepted") clock.set(event.observedAt * 1000);
      return outcome;
    }
    case "observeBan": {
      const outcome = await committed([{ event, by }]);
      if (outcome === "accepted") ban = event.status;
      return outcome;
    }
    case "observeSibling": {
      const outcome = await committed([{ event, by }]);
      if (outcome === "accepted") sibling = event.siblingStatus;
      return outcome;
    }
    case "draft":
      return committed([{ event, by, confidence: event.confidenceHundredths / 100 }]);
    case "escalateByCriteria":
    case "escalateBanAtAnswer":
    case "escalateSiblingAtAnswer":
    case "accept":
    case "reject":
      return committed([...observations(), { event, by }]);
    case "postDraft":
    case "postEscalation":
    case "postResolution":
      return posted(event);
    default:
      return committed([{ event, by }]);
  }
}

function roleOf(state: Appeal): Role {
  switch (state.via) {
    case "NotResolved":
      return null;
    case "AcceptedDraft":
      return state.resolvedBy === state.appellant ? "appellant" : "maintainer";
    case "MaintainerReopen":
      return "maintainer";
    case "ModeratorDecision":
      return "moderator";
  }
}

function view(state: Appeal): Observed {
  return {
    opened: state.opened,
    subject: state.subject,
    appellant: state.appellant,
    openedAt: state.openedAt,
    now: state.now,
    queuedAt: state.queuedAt,
    draft: state.draft,
    draftConfidence: state.draftConfidence,
    escalation: state.escalation,
    notices: [...state.notices].sort((left, right) => left - right),
    resolution: state.resolution,
    postedDraft: state.postedDraft,
    postedEscalation: state.postedEscalation,
    postedResolution: state.postedResolution,
    resolvedRole: roleOf(state),
  };
}

function untranslated(subject: AppealSubject): AppealSubject {
  return { ...subject, item: subject.item === node() ? "pr" : subject.item, revision: subject.revision === revision("head") ? "head" : subject.revision };
}

async function observe(): Promise<Observed> {
  const loaded = await runtime.runPromise(loadAppeal(key()));
  const recipients = await db.prepare("SELECT recipient_github_id AS recipient FROM notifications WHERE event_key = ? ORDER BY recipient_github_id").bind(`slopbot-${key()}`).all();
  const shown = view(loaded.appeal);
  return {
    ...shown,
    subject: loaded.appeal.opened ? untranslated(shown.subject) : shown.subject,
    notices: recipients.results.map((row) => Number(row.recipient)).sort((left, right) => left - right),
    resolvedRole: loaded.row?.resolved_by ?? null,
  };
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: () => {
    generation++;
    attempt = 0;
    opened = false;
    ban = "BanUnknown";
    sibling = "SiblingUnknown";
    clock.set(0);
  },
  dispatch: (_key, event: Event, by) => dispatch(event, Number(by ?? 0)),
  observe: () => observe(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys: ["appeal"], view, walks: 4, steps: 14 };
