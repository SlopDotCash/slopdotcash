// spec/slopbot/valueDisputes.md, "Story: An affected participant disputes the retained assessment of a PR"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import { noticePorts } from "@repo/operations/live";
import { Restrictions } from "@repo/ports/backend";
import type { Driver, Options } from "../../gen/slopbot__valueDisputes.conformance.ts";
import type { BanStatus, Binding, Dispute, Event } from "../../gen/slopbot__valueDisputes.ts";
import { dueJobOf } from "../../src/appeals/due.vibe";
import { claimPublication, releasePublication } from "../../src/appeals/publication.vibe";
import { type ValueStep, commitDispute, loadDispute, stageKeyOf, valueKeyOf } from "../../src/disputes/valueStore.vibe";
import { settled } from "../support/settled.ts";

const mf = startWorker({ d1: { SLOPBOT_DB: "value-dispute-conformance" } });
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
type Observed = Omit<Dispute, "ban" | "draftGapped" | "resolvedBy"> & { readonly resolvedRole: Role };

let generation = 0;
let key: string | undefined;
let ban: BanStatus = "BanUnknown";
let comments = 0;

const node = () => `pr-value-g${generation}`;
const digestOf = (text: string) => `${text === "d1" ? "a" : "b"}${generation.toString(16).padStart(63, "0")}`;
const modelDigest = (digest: string) => (digest === digestOf("d1") ? "d1" : digest === digestOf("d2") ? "d2" : digest);
const item = (text: string) => (text === "pr" ? node() : text);
const modelItem = (text: string) => (text === node() ? "pr" : text);
const pending = () => key ?? valueKeyOf("single", digestOf("d1"), 1, 7, 3);

function translated(event: Event): Event {
  switch (event.type) {
    case "open":
      return {
        ...event,
        binding: { ...event.binding, digest: digestOf(event.binding.digest), item: item(event.binding.item) },
        read: { ...event.read, digest: digestOf(event.read.digest), item: item(event.read.item) },
        check: { ...event.check, item: item(event.check.item) },
      };
    case "draft":
      return { ...event, source: { ...event.source, digest: digestOf(event.source.digest), item: item(event.source.item) } };
    case "accept":
    case "reject":
      return { ...event, check: { ...event.check, item: item(event.check.item) } };
    default:
      return event;
  }
}

function confidenceOf(hundredths: number) {
  return hundredths >= 100 ? 1 : (hundredths + 0.5) / 100;
}

function committed(steps: ReadonlyArray<ValueStep>, options: Parameters<typeof commitDispute>[1] = {}) {
  return settled(commitDispute(pending(), options, () => steps), runtime);
}

function banned(): ReadonlyArray<ValueStep> {
  return ban === "BanUnknown" ? [] : [{ event: { type: "observeBan", status: ban }, by: 0, optional: true }];
}

async function opening(event: Extract<Event, { type: "open" }>, by: number) {
  const binding: Binding = event.binding;
  const candidate = valueKeyOf(binding.kind === "JointRecord" ? "joint" : "single", binding.digest, by > 0 ? by : 1, binding.repository > 0 ? binding.repository : 7, binding.number > 0 ? binding.number : 3);
  const job = dueJobOf(candidate, { installationId: 1, repositoryId: binding.repository, owner: "o", repo: "r", itemKind: "pull_request", number: binding.number });
  const outcome = await settled(commitDispute(candidate, { opening: { job } }, () => [{ event, by }]), runtime);
  if (outcome === "accepted") key = candidate;
  return outcome;
}

async function posted() {
  const claim = await runtime.runPromise(claimPublication(stageKeyOf(pending(), "resolution")));
  comments++;
  const outcome = await committed([{ event: { type: "postResolution" }, by: 0, commentId: comments }], { fence: claim.fence });
  await runtime.runPromise(releasePublication(claim.fence));
  return outcome;
}

async function dispatch(raw: Event, by: number): Promise<"accepted" | "refused"> {
  const event = translated(raw);
  switch (event.type) {
    case "open":
      return key === undefined ? opening(event, by) : committed([{ event, by }]);
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
    case "draft":
      return committed([{ event, by, confidence: confidenceOf(event.confidenceHundredths) }]);
    case "escalateDraft":
    case "accept":
      return committed([...banned(), { event, by }]);
    case "postResolution":
      return posted();
    default:
      return committed([{ event, by }]);
  }
}

function roleOf(state: Dispute): Role {
  switch (state.via) {
    case "NotResolved":
      return null;
    case "AcceptedDraft":
      return state.resolvedBy === state.disputer ? "appellant" : "maintainer";
    case "ModeratorDecision":
      return "moderator";
  }
}

function view(state: Dispute): Observed {
  const { ban: _ban, draftGapped: _gapped, resolvedBy: _resolvedBy, ...shown } = state;
  return { ...shown, notices: [...state.notices].sort((left, right) => left - right), resolvedRole: roleOf(state) };
}

async function observe(): Promise<Observed> {
  const loaded = await runtime.runPromise(loadDispute(pending()));
  const recipients = await db.prepare("SELECT recipient_github_id AS recipient FROM notifications WHERE event_key = ? ORDER BY recipient_github_id").bind(`slopbot-${pending()}`).all();
  const shown = view(loaded.dispute);
  return {
    ...shown,
    binding: loaded.dispute.opened ? { ...shown.binding, digest: modelDigest(shown.binding.digest), item: modelItem(shown.binding.item) } : shown.binding,
    notices: recipients.results.map((row) => Number(row.recipient)).sort((left, right) => left - right),
    resolvedRole: loaded.row?.resolved_by ?? null,
  };
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: () => {
    generation++;
    key = undefined;
    ban = "BanUnknown";
    clock.set(0);
  },
  dispatch: (_key, event: Event, by) => dispatch(event, Number(by ?? 0)),
  observe: () => observe(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys: ["dispute"], view, walks: 4, steps: 14 };
