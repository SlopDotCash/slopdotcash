/** Real migrated D1 statements and delivery functions; no mail provider is called. */
import { expect, test } from "bun:test";
import type { SecurityD1Database } from "../../backend/security/case-store";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  claimDueDeliveries,
  reconcileSecurityMail,
  recordDelivery,
  recordDeliveryDestination,
  retryWithoutProviderCall,
} from "../../workers/notify/security";

function fixture() {
  const { db, sqlite } = sqliteD1();
  let now = new Date("2026-11-08T00:00:00.000Z");
  const id = "1".repeat(32);
  sqlite
    .query(`INSERT INTO activity_notification_outbox
    (id,event_key,recipient_github_id,essential,next_attempt_at,created_at,updated_at)
    VALUES (?,'model-flow','101',0,?,?,?)`)
    .run(id, now.toISOString(), now.toISOString(), now.toISOString());
  const deps = { db: db as unknown as SecurityD1Database, now: () => now };
  const row = () =>
    sqlite
      .query(
        "SELECT state,attempts,destination_digest,next_attempt_at FROM activity_notification_outbox WHERE id=?",
      )
      .get(id);
  async function claim() {
    const rows = [];
    for await (const entry of claimDueDeliveries<{
      id: string;
      attempts: number;
    }>(deps.db, "activity", deps.now))
      rows.push(entry);
    return rows;
  }
  return {
    id,
    sqlite,
    deps,
    row,
    claim,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

test("delivery model: accepted rejection, later ambiguity, stale evidence and duplicate receipt use real D1 fences", async () => {
  const h = fixture();
  try {
    const first = (await h.claim())[0];
    expect(first.attempts).toBe(0);
    h.sqlite
      .query(
        "UPDATE activity_notification_outbox SET destination_digest=? WHERE id=?",
      )
      .run("a".repeat(64), h.id);
    await recordDelivery(h.deps, first, "provider-accepted", null, "activity");
    const firstProof = {
      deliveryId: h.id,
      attempt: 1,
      destinationDigest: "a".repeat(64),
      evidenceReference: "native-proof-one",
      outcome: "not-accepted",
    };
    expect(await reconcileSecurityMail(h.deps, firstProof, "activity")).toBe(
      true,
    );
    expect(h.row()).toMatchObject({ state: "retrying", attempts: 1 });
    expect(await h.claim()).toHaveLength(0);
    h.advance(60_001);
    const second = (await h.claim())[0];
    h.sqlite
      .query(
        "UPDATE activity_notification_outbox SET destination_digest=? WHERE id=?",
      )
      .run("b".repeat(64), h.id);
    await recordDelivery(h.deps, second, "ambiguous", null, "activity");
    expect(
      await reconcileSecurityMail(
        h.deps,
        { ...firstProof, evidenceReference: "stale-attempt-proof" },
        "activity",
      ),
    ).toBe(false);
    expect(
      await reconcileSecurityMail(
        h.deps,
        {
          ...firstProof,
          attempt: 2,
          evidenceReference: "stale-destination-proof",
        },
        "activity",
      ),
    ).toBe(false);
    const finalProof = {
      deliveryId: h.id,
      attempt: 2,
      destinationDigest: "b".repeat(64),
      evidenceReference: "native-proof-two",
      outcome: "delivered",
    };
    expect(
      (
        await Promise.all([
          reconcileSecurityMail(h.deps, finalProof, "activity"),
          reconcileSecurityMail(h.deps, finalProof, "activity"),
        ])
      ).sort(),
    ).toEqual([false, true]);
    expect(h.row()).toMatchObject({ state: "delivered", attempts: 2 });
    expect(
      h.sqlite
        .query(
          "SELECT COUNT(*) AS n FROM activity_notification_delivery_events WHERE evidence_reference=?",
        )
        .get(finalProof.evidenceReference),
    ).toEqual({ n: 1 });
  } finally {
    h.sqlite.close();
  }
});

test("delivery model: retired workers cannot change successor metadata or duplicate a completion receipt", async () => {
  const h = fixture();
  try {
    const first = (await h.claim())[0];
    expect(
      await recordDeliveryDestination(
        h.deps.db,
        first,
        "a".repeat(64),
        "activity",
      ),
    ).toBe(true);
    h.advance(300_001);
    expect(await h.claim()).toEqual([]);
    expect(
      await reconcileSecurityMail(
        h.deps,
        {
          deliveryId: h.id,
          attempt: 1,
          destinationDigest: "a".repeat(64),
          evidenceReference: "retired-attempt-not-accepted",
          outcome: "not-accepted",
        },
        "activity",
      ),
    ).toBe(true);
    h.advance(60_001);
    const second = (await h.claim())[0];
    expect(
      await recordDeliveryDestination(
        h.deps.db,
        second,
        "b".repeat(64),
        "activity",
      ),
    ).toBe(true);
    expect(
      await recordDelivery(
        h.deps,
        second,
        "provider-accepted",
        null,
        "activity",
      ),
    ).toBe(true);
    // Even a repeated completion in the same millisecond appends no event.
    expect(
      await recordDelivery(
        h.deps,
        second,
        "provider-accepted",
        null,
        "activity",
      ),
    ).toBe(false);
    const retained = h.row();
    h.advance(10_000);
    expect(
      await recordDeliveryDestination(
        h.deps.db,
        first,
        "a".repeat(64),
        "activity",
      ),
    ).toBe(false);
    expect(await retryWithoutProviderCall(h.deps, first, "activity")).toBe(
      "superseded",
    );
    expect(h.row()).toEqual(retained);
    expect(
      h.sqlite
        .query(
          "SELECT COUNT(*) AS n FROM activity_notification_delivery_events WHERE state='provider-accepted'",
        )
        .get(),
    ).toEqual({ n: 1 });
  } finally {
    h.sqlite.close();
  }
});

test("delivery model: a stale worker cannot overwrite ambiguity and a failed evidence append rolls back its state transition", async () => {
  const h = fixture();
  try {
    const first = (await h.claim())[0];
    h.sqlite
      .query(
        "UPDATE activity_notification_outbox SET destination_digest=? WHERE id=?",
      )
      .run("a".repeat(64), h.id);
    h.advance(300_001);
    expect(await h.claim()).toHaveLength(0);
    expect(h.row()).toMatchObject({ state: "ambiguous" });
    await recordDelivery(h.deps, first, "provider-accepted", null, "activity");
    expect(h.row()).toMatchObject({ state: "ambiguous" });
    h.sqlite.exec(
      "CREATE TEMP TRIGGER fail_delivery_append BEFORE INSERT ON activity_notification_delivery_events BEGIN SELECT RAISE(ABORT,'injected storage outage'); END;",
    );
    const proof = {
      deliveryId: h.id,
      attempt: 1,
      destinationDigest: "a".repeat(64),
      evidenceReference: "rollback-proof",
      outcome: "delivered",
    };
    await expect(
      reconcileSecurityMail(h.deps, proof, "activity"),
    ).rejects.toThrow("injected storage outage");
    expect(h.row()).toMatchObject({ state: "ambiguous" });
    expect(
      h.sqlite
        .query(
          "SELECT COUNT(*) AS n FROM activity_notification_delivery_events",
        )
        .get(),
    ).toEqual({ n: 0 });
    h.sqlite.exec("DROP TRIGGER fail_delivery_append");
    expect(await reconcileSecurityMail(h.deps, proof, "activity")).toBe(true);
    expect(h.row()).toMatchObject({ state: "delivered" });
  } finally {
    h.sqlite.close();
  }
});
