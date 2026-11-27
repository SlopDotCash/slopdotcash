import { Effect, Layer, ManagedRuntime } from "effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { afterEach, describe, expect, it } from "vitest";
import { boundedBytes, boundedJson } from "../../src/platform/bounded.vibe";
import { Deployment, deployment } from "../../src/platform/config.vibe";
import { Locks, locks, locksOver } from "../../src/platform/locks.vibe";
import { LocalStore, SessionStore, localStore, localValues, sessionStore, sessionValues, storageKeys, storeOver } from "../../src/platform/storage.vibe";

type Outcome<A> = { readonly ok: A } | { readonly failed: string };

const outcome = <A, E extends { readonly _tag: string }>(program: Effect.Effect<A, E>): Promise<Outcome<A>> =>
  Effect.runPromise(Effect.match(program, { onSuccess: (ok): Outcome<A> => ({ ok }), onFailure: (error): Outcome<A> => ({ failed: error._tag }) }));

function served(chunks: ReadonlyArray<string>, headers: Record<string, string> = {}) {
  const cancelled: string[] = [];
  const encoder = new TextEncoder();
  let next = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[next++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(encoder.encode(chunk));
    },
    cancel(reason) {
      cancelled.push(String(reason ?? "cancelled"));
    },
  });
  const response = HttpClientResponse.fromWeb(HttpClientRequest.get("/data/leaderboard.json"), new Response(body, { headers }));
  return { response, cancelled };
}

const keys = [storageKeys.emailAction.key, `${storageKeys.projectDraft.key}fixture:slot:1`, storageKeys.projectReferrer.key];
afterEach(() => {
  for (const key of keys) {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  }
});

describe('Read current data without losing the last good result', () => {
  // spec/frontend/requests.md, "Story: Read current data without losing the last good result"; spec/frontend/requests.md, "Loading, empty, stale, denied, invalid and unavailable remain distinct"
  it("a public read keeps an oversized, unreadable or malformed body apart from data within its limit", async () => {
    const declaredOver = served(["{}"], { "content-length": "11" });
    const invalidLength = served(["{}"], { "content-length": "1e3" });
    const streamedOver = served(["1234", "5678", "9012", "3456"]);
    const notJson = served(["{not json"]);
    const within = served(['{"rows":', "[1,2]}"], { "content-length": "14" });
    const results = {
      declaredOver: await outcome(boundedBytes(declaredOver.response, 10, "snapshot")),
      invalidLength: await outcome(boundedBytes(invalidLength.response, 10, "snapshot")),
      streamedOver: await outcome(boundedBytes(streamedOver.response, 10, "snapshot")),
      streamCancelled: streamedOver.cancelled.length > 0,
      notJson: await outcome(boundedJson(notJson.response, 64, "points")),
      within: await outcome(boundedJson(within.response, 14, "points")),
    };
    expect(results).toStrictEqual({
      declaredOver: { failed: "BodyTooLarge" },
      invalidLength: { failed: "BodyUnreadable" },
      streamedOver: { failed: "BodyTooLarge" },
      streamCancelled: true,
      notJson: { failed: "BodyUnreadable" },
      within: { ok: { rows: [1, 2] } },
    });
  });
});

describe('Resume an authorized destination after signing in', () => {
  // spec/frontend/navigation.md, "Story: Resume an authorized destination after signing in"; spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
  it("a page outside the product origins sends sign-in to the production site and keeps the requested page", async () => {
    const runtime = ManagedRuntime.make(deployment);
    const seen = await runtime.runPromise(Effect.gen(function* () {
      const site = yield* Deployment;
      return {
        tier: site.tier,
        pageOrigin: site.pageOrigin === location.origin,
        localBackendOrigin: site.localBackendOrigin,
        home: yield* site.loginHref("/"),
        settings: yield* site.loginHref("/settings?tab=email"),
      };
    }));
    await runtime.dispose();
    expect(seen).toStrictEqual({
      tier: "production",
      pageOrigin: true,
      localBackendOrigin: undefined,
      home: "https://slop.cash/login",
      settings: "https://slop.cash/login?next=%2Fsettings%3Ftab%3Demail",
    });
  });
});

describe('Keep a project setup draft per browser document', () => {
  // spec/frontend/projectDrafts.md, "Story: Keep a project setup draft per browser document"; spec/frontend/projectDrafts.md, "A project setup draft belongs to one live document slot that a duplicated tab cannot take"; spec/frontend/projectDrafts.md, "The legacy setup draft is imported once and the store falls back to memory when storage or locks are unavailable"
  it("a slot lock stays with the document that claimed it, writes take turns, and a page without Web Locks is told so", async () => {
    const slot = `${storageKeys.projectDraft.key}fixture:slot:1`;
    const runtime = ManagedRuntime.make(locks);
    const order: string[] = [];
    const seen = await runtime.runPromise(Effect.gen(function* () {
      const held = yield* Locks;
      const first = yield* held.claim(slot);
      const second = yield* held.claim(slot);
      const other = yield* held.claim(`${slot}:other`);
      const turn = (name: string) => held.exclusive(`${storageKeys.projectDraft.key}fixture:write`, Effect.gen(function* () {
        order.push(`${name} start`);
        yield* Effect.sleep("20 millis");
        order.push(`${name} end`);
      }));
      yield* Effect.all([turn("a"), turn("b")], { concurrency: "unbounded" });
      return { first, second, other };
    }));
    const stillHeld = await runtime.runPromise(Effect.gen(function* () {
      return yield* (yield* Locks).claim(slot);
    }));
    await runtime.dispose();
    const absent = await outcome(Effect.scoped(Effect.gen(function* () {
      const none = yield* locksOver(undefined);
      return yield* none.claim(slot);
    })));
    expect({ seen, order, stillHeld, absent }).toStrictEqual({
      seen: { first: true, second: false, other: true },
      order: ["a start", "a end", "b start", "b end"],
      stillHeld: false,
      absent: { failed: "LocksUnavailable" },
    });
  });

  it("drafts and pending records keep their existing storage keys, and a page without storage keeps them in memory only", async () => {
    const runtime = ManagedRuntime.make(Layer.mergeAll(sessionStore, localStore));
    const seen = await runtime.runPromise(Effect.gen(function* () {
      const session = yield* SessionStore;
      const local = yield* LocalStore;
      const write = (key: string, value: string) => Effect.gen(function* () {
        yield* (yield* KeyValueStore.KeyValueStore).set(key, value);
      });
      yield* Effect.provide(write(storageKeys.emailAction.key, '{"kind":"verify"}'), sessionValues);
      yield* Effect.provide(write(storageKeys.projectReferrer.key, "octocat"), localValues);
      const memory = yield* storeOver("local", undefined);
      yield* memory.values.set(`${storageKeys.projectDraft.key}fixture:slot:1`, '{"revision":"1","value":"{}"}');
      return {
        durable: [session.durable, local.durable, memory.durable],
        memoryKept: yield* memory.values.get(`${storageKeys.projectDraft.key}fixture:slot:1`),
      };
    }));
    await runtime.dispose();
    expect({
      ...seen,
      session: sessionStorage.getItem(storageKeys.emailAction.key),
      local: localStorage.getItem(storageKeys.projectReferrer.key),
      wroteThroughMemory: localStorage.getItem(`${storageKeys.projectDraft.key}fixture:slot:1`),
    }).toStrictEqual({
      durable: [true, true, false],
      memoryKept: '{"revision":"1","value":"{}"}',
      session: '{"kind":"verify"}',
      local: "octocat",
      wroteThroughMemory: null,
    });
  });
});
