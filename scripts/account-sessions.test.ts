import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { handlePointsApi } from "../backend/points/handler";
import { sha256Hex } from "../src/lib/async-sha256.mjs";
import { sqliteD1 } from "../tests/sqlite-d1";

test("account sessions revoke only the authenticated actor and invalidate the revoked cookie", async () => {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../migrations", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  try {
    const now = new Date("2026-10-21T12:00:00.000Z");
    const tokens = ["a".repeat(48), "b".repeat(48), "c".repeat(48)];
    const hashes = await Promise.all(tokens.map(sha256Hex));
    for (const [actor, github] of [
      ["actor-one", "1"],
      ["actor-two", "2"],
    ])
      sqlite
        .prepare(
          "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,0)",
        )
        .run(actor, github, actor, now.toISOString());
    hashes.forEach((hash, index) => {
      sqlite
        .prepare(
          "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
        )
        .run(
          hash,
          index === 2 ? "actor-two" : "actor-one",
          "2026-10-21T13:00:00.000Z",
        );
    });
    const call = (path: string, token: string, body?: unknown) =>
      handlePointsApi(
        new Request(`https://slop.cash/api/v1/points/${path}`, {
          method: body ? "POST" : "GET",
          headers: {
            cookie: `__Host-slop_points=${token}`,
            ...(body
              ? {
                  origin: "https://slop.cash",
                  "content-type": "application/json",
                }
              : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
        {
          db,
          now: () => now,
          rateLimitSecret: "test-only-rate-secret".repeat(4),
          identity: {
            fetch: async () => {
              throw new Error("No identity exchange expected");
            },
          },
        },
      );
    const list = await call("sessions", tokens[0]);
    expect(list.status).toBe(200);
    const sessions = (await list.json()).sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s: { current: boolean }) => s.current).id).toBe(
      hashes[0].slice(0, 24),
    );
    await call("sessions/revoke", tokens[0], { id: hashes[2].slice(0, 24) });
    expect((await call("sessions", tokens[2])).status).toBe(200);
    await call("sessions/revoke", tokens[0], { id: hashes[1].slice(0, 24) });
    expect((await call("sessions", tokens[1])).status).toBe(401);
    const ended = await call("sessions/revoke", tokens[0], {
      id: hashes[0].slice(0, 24),
    });
    expect(ended.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await call("sessions", tokens[0])).status).toBe(401);
  } finally {
    sqlite.close();
  }
});
