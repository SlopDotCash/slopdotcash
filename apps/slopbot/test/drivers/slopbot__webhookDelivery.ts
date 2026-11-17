// spec/slopbot/webhookDelivery.md, "Story: Record the delivery and make independent routing decisions"
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { outcome } from "@repo/platform/testing/area";
import { migrationsDir } from "@repo/platform/testing/paths";
import { ProjectAudience } from "@repo/ports/backend";
import { Notices } from "@repo/ports/operations";
import type { Driver, Options } from "../../gen/slopbot__webhookDelivery.conformance.ts";
import type { Installation } from "../../gen/slopbot__installation.ts";
import type { Body, Event, GithubEvent, ReopenSource, Request, Webhook } from "../../gen/slopbot__webhookDelivery.ts";
import { type Context, advance, delivery } from "../../src/ingress/store.vibe";

const mf = startWorker({ d1: { SLOPBOT_DB: "webhook-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);

const noNotices = Layer.mergeAll(
  Layer.succeed(ProjectAudience, { listedBy: () => Effect.succeed(sql`SELECT NULL AS recipient WHERE 0`), owners: () => Effect.succeed(sql`SELECT NULL AS recipient WHERE 0`) }),
  Layer.succeed(Notices, { statements: () => Effect.succeed([]), fanout: () => Effect.succeed([]) }),
);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(await database(mf, "SLOPBOT_DB")), webCrypto, noNotices));

type Observed = Pick<Webhook, "receipt" | "exists" | "installationProcessed" | "firstEvent" | "value" | "reopen" | "confirmed"> & {
  readonly install: Pick<Installation, "known" | "suspended" | "removed" | "sourceTime" | "processed">;
};

const eventNames: Readonly<Record<GithubEvent, string>> = {
  Installation: "installation",
  PullRequest: "pull_request",
  Issue: "issues",
  PullReview: "pull_request_review",
  ReviewComment: "pull_request_review_comment",
  IssueComment: "issue_comment",
  Other: "ping",
};

const keys = ["a", "b"];
const account = { id: 1, login: "installation-owner", type: "User" };
let generation = 0;
const inFlight = new Map<string, Request[]>();

function deliveryOf(key: string) {
  return `webhook-${generation}-${key}`;
}

function requestOf(key: string, requestId: number) {
  return (inFlight.get(key) ?? []).find((request) => request.id === requestId);
}

function serialized(source: ReopenSource) {
  return JSON.stringify({
    installationId: source.installation,
    repositoryId: source.repository,
    itemKind: source.kind === "IssueItem" ? "issue" : "pull_request",
    number: source.number,
    senderId: source.sender,
    itemNodeId: source.node,
    revision: source.revision,
    occurredAt: new Date(source.occurred).toISOString(),
  });
}

function mapped(key: string, body: Body): Body {
  return { ...body, deliveryId: body.deliveryId === "" ? "" : deliveryOf(key) };
}

function translated(key: string, event: Event): Event {
  return event.type === "decode" ? { ...event, body: mapped(key, event.body) } : event;
}

function contextOf(key: string, event: Event): Context {
  const request = "requestId" in event ? requestOf(key, event.requestId) : undefined;
  const body = request?.body;
  return {
    deliveryId: deliveryOf(key),
    eventName: eventNames[body?.event ?? "Other"],
    reopen: body === undefined || body.reopen.node === "" ? undefined : serialized(body.reopen),
    installation: {
      installationId: 800_000 + generation * 10 + keys.indexOf(key),
      account: body?.change.hasAccount === true ? account : undefined,
      deliveryId: deliveryOf(key),
      event: body?.change ?? { delivery: 1, kind: "OtherInstallAction", sourceTime: 0, hasAccount: false, validTime: false },
      servedProjects: [],
    },
  };
}

function view(state: Webhook): Observed {
  const { install } = state;
  return {
    receipt: state.receipt,
    exists: state.exists,
    installationProcessed: state.installationProcessed,
    firstEvent: state.firstEvent,
    value: state.value,
    reopen: state.reopen,
    confirmed: state.confirmed,
    install: { known: install.known, suspended: install.suspended, removed: install.removed, sourceTime: install.sourceTime, processed: install.processed },
  };
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: () => {
    generation++;
    inFlight.clear();
  },
  dispatch: async (key, event: Event) => {
    const sent = translated(key, event);
    const advanced = advance(contextOf(key, sent), inFlight.get(key) ?? [], sent).pipe(Effect.tap((next) => Effect.sync(() => inFlight.set(key, next.requests))));
    return outcome(advanced, runtime);
  },
  observe: async (key) => view(await runtime.runPromise(delivery(contextOf(key, { type: "releaseOrdinary" })))),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys, view, walks: 3, steps: 14 };
