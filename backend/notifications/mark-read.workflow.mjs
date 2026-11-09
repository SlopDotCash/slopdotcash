import assert from "node:assert/strict";
import { resolve } from "node:path";
import { startHandlerWorker } from "../../tests/miniflare-d1.mjs";

// Native D1 enforces the 100-bind limit that bun:sqlite does not enforce.
// Use the real inbox handler and migrations, with a synthetic session actor.
const actor = "900000002";
const other = "900000004";
const at = "2026-10-29T00:00:00.000Z";
let worker;
try {
  worker = await startHandlerWorker({
    d1: "inbox-read",
    entrySource: `import { handleNotificationsApi } from ${JSON.stringify(resolve("backend/notifications/handler.ts"))};
export default { fetch(request, env) {
  return handleNotificationsApi(request, {
    db: env.DB, sessionActor: async () => ({githubId: ${JSON.stringify(actor)}}),
    now: () => new Date(${JSON.stringify(at)})
  });
}};`,
  });
  const { runtime, db } = worker;
  const insert = (key, recipient = actor, kind = "wallet_changed") =>
    db
      .prepare(
        "INSERT INTO notifications (event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES (?,?,?,'base','/account#wallets',?,?)",
      )
      .bind(key, recipient, kind, at, at);
  const keys = Array.from(
    { length: 100 },
    (_, n) => `wallet-claim:native-${n}`,
  );
  await db.batch(keys.map((key) => insert(key)));
  await db.batch([
    insert("wallet-claim:other", other),
    insert("slopbot-scam-review:native", actor, "slopbot_scam_review"),
  ]);
  const mark = (keys) =>
    runtime.dispatchFetch("https://slop.cash/api/v1/notifications/read", {
      method: "POST",
      headers: {
        origin: "https://slop.cash",
        "content-type": "application/json",
      },
      body: JSON.stringify({ eventKeys: keys }),
    });
  const first = await mark(keys);
  assert.equal(first.status, 200, await first.clone().text());
  assert.deepEqual(await first.json(), { marked: 100 });
  const replay = await mark(keys);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { marked: 0 });
  const restricted = await mark([
    "wallet-claim:other",
    "slopbot-scam-review:native",
  ]);
  assert.equal(restricted.status, 200);
  assert.deepEqual(await restricted.json(), { marked: 0 });
  assert.equal((await mark([...keys, "wallet-claim:other"])).status, 400);
  assert.equal((await mark([keys[0], keys[0]])).status, 400);
  const counts = await db
    .prepare("SELECT COUNT(*) total, COUNT(read_at) marked FROM notifications")
    .first();
  assert.deepEqual(counts, { total: 102, marked: 100 });
  console.log(
    JSON.stringify({
      nativeD1: true,
      pageSize: 100,
      marked: 100,
      replayMarked: 0,
      restrictedMarked: 0,
      outboundRequests: 0,
    }),
  );
} finally {
  await worker?.dispose();
}
