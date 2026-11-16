// PRD section 3: run the real OAuth routes and database, with controlled X responses.
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { PointsDependencies } from "./dependencies";
import { handlePointsApi } from "./handler";

test("X connection and reconnect reserve identity without granting points", async () => {
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((p) => p.endsWith(".sql"))
      .sort(),
  );
  const now = "2026-10-24T00:00:00.000Z";
  const token = "s".repeat(48);
  const deps: PointsDependencies = {
    db,
    rateLimitSecret: "fixture-secret".repeat(4),
    identity: { fetch: async () => new Response(null, { status: 500 }) },
    now: () => new Date(now),
    x: { clientId: "fixture-client", clientSecret: "fixture-secret" },
    xFetch: async (url) => {
      if (url.endsWith("/2/oauth2/token"))
        return Response.json({
          access_token: "fixture-access",
          token_type: "bearer",
        });
      if (url.endsWith("/2/users/me"))
        return Response.json({
          data: { id: "123456789", username: "fixture_user" },
        });
      if (url.endsWith("/2/oauth2/revoke"))
        return Response.json({ revoked: true });
      throw new Error(`Unexpected X endpoint: ${url}`);
    },
  };
  try {
    sqlite
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
      )
      .run("U_fixture", "1234", "fixture", now);
    sqlite
      .prepare(
        "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
      )
      .run(await sha256Hex(token), "U_fixture", "2026-10-24T01:00:00.000Z");
    const call = (path: string, body?: unknown, flowCookie = "") =>
      handlePointsApi(
        new Request(`https://slop.cash/api/v1/points/x/${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            cookie: `__Host-slop_points=${token}; ${flowCookie}`,
            origin: "https://slop.cash",
            "content-type": "application/json",
            "cf-connecting-ip": "203.0.113.7",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        deps,
      );
    const connect = async (historical = false, oldPrivateFlow = false) => {
      const start = await call("start", { public: !oldPrivateFlow });
      expect(start.status).toBe(200);
      expect(sqlite.prepare("SELECT public FROM points_x_flows").all()).toEqual(
        [{ public: 1 }],
      );
      // A flow created before the policy change still completes publicly.
      if (oldPrivateFlow) sqlite.exec("UPDATE points_x_flows SET public=0");
      const { authorizationUrl } = (await start.json()) as {
        authorizationUrl: string;
      };
      const state = new URL(authorizationUrl).searchParams.get("state");
      const cookie = start.headers.get("set-cookie")?.split(";")[0] ?? "";
      const result = await call(
        `callback?state=${state}&code=fixture-code`,
        undefined,
        cookie,
      );
      expect(result.headers.get("location")).toBe("/points?x=connected");
      expect(
        sqlite.prepare("SELECT x_id,actor_id FROM points_x_claims").all(),
      ).toEqual([{ x_id: "123456789", actor_id: "U_fixture" }]);
      expect(
        sqlite.prepare("SELECT x_id,username,public FROM points_x_links").all(),
      ).toEqual([{ x_id: "123456789", username: "fixture_user", public: 1 }]);
      expect(
        sqlite.prepare("SELECT points,awarded_at FROM points_x_awards").all(),
      ).toEqual(
        historical
          ? [{ points: 10, awarded_at: "2026-10-01T00:00:00.000Z" }]
          : [],
      );
    };
    await connect(false, true);
    expect((await call("disconnect", {})).status).toBe(200);
    await connect();
    // A historical award is retained through disconnect and reconnect.
    sqlite
      .prepare(
        "INSERT INTO points_x_awards(actor_id,x_id,awarded_at,points) VALUES(?,?,?,10)",
      )
      .run("U_fixture", "123456789", "2026-10-01T00:00:00.000Z");
    expect((await call("disconnect", {})).status).toBe(200);
    await connect(true);
    expect(
      sqlite.prepare("SELECT points,awarded_at FROM points_x_awards").all(),
    ).toEqual([{ points: 10, awarded_at: "2026-10-01T00:00:00.000Z" }]);
    expect(sqlite.prepare("SELECT x_id FROM points_x_claims").all()).toEqual([
      { x_id: "123456789" },
    ]);
  } finally {
    sqlite.close();
  }
});

test("a malformed X request body is a client error, not a server outage", async () => {
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((p) => p.endsWith(".sql"))
      .sort(),
  );
  const token = "m".repeat(48);
  const now = "2026-10-26T12:00:00.000Z";
  sqlite
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
    )
    .run("U_fixture", "1234", "fixture", now);
  sqlite
    .prepare(
      "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
    )
    .run(await sha256Hex(token), "U_fixture", "2026-10-26T13:00:00.000Z");
  const deps: PointsDependencies = {
    db,
    rateLimitSecret: "fixture-secret".repeat(4),
    identity: { fetch: async () => new Response(null, { status: 500 }) },
    now: () => new Date(now),
    x: { clientId: "fixture-client", clientSecret: "fixture-secret" },
    xFetch: async () => Response.json({}),
  };
  const raw = (path: string, body: string) =>
    handlePointsApi(
      new Request(`https://slop.cash/api/v1/points/x/${path}`, {
        method: "POST",
        headers: {
          cookie: `__Host-slop_points=${token}`,
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body,
      }),
      deps,
    );
  try {
    for (const body of ["null", "{", "[]"])
      for (const path of ["start", "visibility"])
        expect({ path, body, status: (await raw(path, body)).status }).toEqual({
          path,
          body,
          status: 400,
        });
  } finally {
    sqlite.close();
  }
});

async function xLifecycleFixture() {
  const { db, sqlite } = sqliteD1(
    readdirSync("migrations")
      .filter((path) => path.endsWith(".sql"))
      .sort(),
  );
  const token = "l".repeat(48);
  let clock = new Date("2026-11-08T00:00:00.000Z");
  const providerPaths: string[] = [];
  let providerReply:
    | ((path: string) => Promise<Response | undefined>)
    | undefined;
  sqlite
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
    )
    .run("U_lifecycle", "9876", "lifecycle", clock.toISOString());
  sqlite
    .prepare(
      "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
    )
    .run(await sha256Hex(token), "U_lifecycle", "2026-11-08T01:00:00.000Z");
  const deps: PointsDependencies = {
    db,
    rateLimitSecret: "fixture-lifecycle-secret".repeat(3),
    identity: { fetch: async () => new Response(null, { status: 500 }) },
    now: () => clock,
    x: { clientId: "fixture-client", clientSecret: "fixture-secret" },
    xFetch: async (url) => {
      const path = new URL(url).pathname;
      providerPaths.push(path);
      const response = await providerReply?.(path);
      if (response) return response;
      if (path === "/2/oauth2/token")
        return Response.json({
          access_token: "fixture-lifecycle-access",
          token_type: "bearer",
        });
      if (path === "/2/users/me")
        return Response.json({
          data: { id: "987654321", username: "lifecycle_user" },
        });
      if (path === "/2/oauth2/revoke") return Response.json({ revoked: true });
      throw new Error(`Unexpected fixture provider path: ${path}`);
    },
  };
  const call = (path: string, body?: unknown, flowCookie = "") =>
    handlePointsApi(
      new Request(`https://slop.cash/api/v1/points/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          cookie: `__Host-slop_points=${token}; ${flowCookie}`,
          origin: "https://slop.cash",
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.23",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      deps,
    );
  const start = async () => {
    const response = await call("x/start", { public: true });
    expect(response.status).toBe(200);
    const value = (await response.json()) as { authorizationUrl: string };
    const state = new URL(value.authorizationUrl).searchParams.get("state");
    if (!state) throw new Error("Fixture flow state was not returned");
    return {
      state,
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  };
  return {
    db,
    sqlite,
    call,
    start,
    providerPaths,
    setTime(value: string) {
      clock = new Date(value);
    },
    setProviderReply(value: typeof providerReply) {
      providerReply = value;
    },
  };
}

for (const failure of ["cancelled", "token", "identity"] as const) {
  test(`X ${failure} outcome removes its flow without creating a link`, async () => {
    const fixture = await xLifecycleFixture();
    try {
      fixture.setProviderReply(async (path) => {
        if (failure === "token" && path === "/2/oauth2/token")
          return new Response(null, { status: 503 });
        if (failure === "identity" && path === "/2/users/me")
          return Response.json({
            data: { id: "invalid", username: "fixture" },
          });
        return undefined;
      });
      const flow = await fixture.start();
      const query =
        failure === "cancelled" ? "error=access_denied" : "code=fixture";
      const response = await fixture.call(
        `x/callback?state=${flow.state}&${query}`,
        undefined,
        flow.cookie,
      );
      expect(response.headers.get("location")).toBe(
        failure === "cancelled" ? "/points?x=cancelled" : "/points?x=failed",
      );
      expect(
        fixture.sqlite.prepare("SELECT * FROM points_x_flows").all(),
      ).toEqual([]);
      expect(
        fixture.sqlite.prepare("SELECT * FROM points_x_links").all(),
      ).toEqual([]);
      expect(
        fixture.sqlite.prepare("SELECT * FROM points_x_claims").all(),
      ).toEqual([]);
      expect(fixture.providerPaths.includes("/2/oauth2/revoke")).toBe(
        failure === "identity",
      );
    } finally {
      fixture.sqlite.close();
    }
  });
}

for (const revoke of ["signout", "x/disconnect"] as const) {
  test(`X callback cannot link after ${revoke} during provider lookup`, async () => {
    const fixture = await xLifecycleFixture();
    try {
      const flow = await fixture.start();
      fixture.setProviderReply(async (path) => {
        if (path === "/2/users/me")
          expect((await fixture.call(revoke, {})).status).toBe(200);
        return undefined;
      });
      const response = await fixture.call(
        `x/callback?state=${flow.state}&code=fixture`,
        undefined,
        flow.cookie,
      );
      expect(response.headers.get("location")).toBe("/points?x=failed");
      expect(
        fixture.sqlite.prepare("SELECT * FROM points_x_links").all(),
      ).toEqual([]);
      expect(
        fixture.sqlite.prepare("SELECT * FROM points_x_claims").all(),
      ).toEqual([]);
      expect(fixture.providerPaths).toContain("/2/oauth2/revoke");
    } finally {
      fixture.sqlite.close();
    }
  });
}

test("X callback expiry is checked before claiming a pending flow", async () => {
  const fixture = await xLifecycleFixture();
  try {
    const flow = await fixture.start();
    fixture.setTime("2026-11-08T00:10:00.000Z");
    const response = await fixture.call(
      `x/callback?state=${flow.state}&code=fixture`,
      undefined,
      flow.cookie,
    );
    expect(response.headers.get("location")).toBe("/points?x=failed");
    expect(fixture.providerPaths).toEqual([]);
    expect(
      fixture.sqlite.prepare("SELECT status FROM points_x_flows").all(),
    ).toEqual([{ status: "pending" }]);
  } finally {
    fixture.sqlite.close();
  }
});

for (const [at, expected] of [
  ["2026-11-08T00:11:00.000Z", "connected"],
  ["2026-11-08T01:00:00.000Z", "failed"],
] as const) {
  test(`X persistence at ${at} preserves the observed flow/session expiry boundary`, async () => {
    const fixture = await xLifecycleFixture();
    try {
      const flow = await fixture.start();
      fixture.setProviderReply(async (path) => {
        if (path === "/2/users/me") fixture.setTime(at);
        return undefined;
      });
      const response = await fixture.call(
        `x/callback?state=${flow.state}&code=fixture`,
        undefined,
        flow.cookie,
      );
      expect(response.headers.get("location")).toBe(`/points?x=${expected}`);
      expect(
        fixture.sqlite.prepare("SELECT x_id FROM points_x_links").all(),
      ).toEqual(expected === "connected" ? [{ x_id: "987654321" }] : []);
      expect(fixture.providerPaths).toContain("/2/oauth2/revoke");
    } finally {
      fixture.sqlite.close();
    }
  });
}

test("a superseded X callback leaves the newer flow available", async () => {
  const fixture = await xLifecycleFixture();
  try {
    const first = await fixture.start();
    let second: Awaited<ReturnType<typeof fixture.start>> | undefined;
    fixture.setProviderReply(async (path) => {
      if (path === "/2/users/me" && !second) second = await fixture.start();
      return undefined;
    });
    const old = await fixture.call(
      `x/callback?state=${first.state}&code=fixture`,
      undefined,
      first.cookie,
    );
    expect(old.headers.get("location")).toBe("/points?x=failed");
    expect(old.headers.get("set-cookie")).toStartWith(
      `${first.cookie.split("=")[0]}=;`,
    );
    expect(
      fixture.sqlite.prepare("SELECT status FROM points_x_flows").all(),
    ).toEqual([{ status: "pending" }]);
    expect(
      fixture.sqlite.prepare("SELECT * FROM points_x_links").all(),
    ).toEqual([]);
    if (!second) throw new Error("Fixture successor flow was not started");
    fixture.setProviderReply(undefined);
    const current = await fixture.call(
      `x/callback?state=${second.state}&code=fixture`,
      undefined,
      second.cookie,
    );
    expect(current.headers.get("location")).toBe("/points?x=connected");
    expect(
      fixture.sqlite.prepare("SELECT * FROM points_x_flows").all(),
    ).toEqual([]);
  } finally {
    fixture.sqlite.close();
  }
});

test("X provider revoke failure preserves a verified public link", async () => {
  const fixture = await xLifecycleFixture();
  try {
    const flow = await fixture.start();
    fixture.setProviderReply(async (path) => {
      if (path === "/2/oauth2/revoke")
        throw new Error("Fixture provider outage");
      return undefined;
    });
    const response = await fixture.call(
      `x/callback?state=${flow.state}&code=fixture`,
      undefined,
      flow.cookie,
    );
    expect(response.headers.get("location")).toBe("/points?x=connected");
    expect(
      fixture.sqlite.prepare("SELECT x_id,public FROM points_x_links").all(),
    ).toEqual([{ x_id: "987654321", public: 1 }]);
    expect(
      fixture.sqlite.prepare("SELECT * FROM points_x_awards").all(),
    ).toEqual([]);
  } finally {
    fixture.sqlite.close();
  }
});

test("an X identity reserved to another actor is not reassigned", async () => {
  const fixture = await xLifecycleFixture();
  try {
    fixture.sqlite
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
      )
      .run("U_foreign", "5432", "foreign", "2026-11-08T00:00:00.000Z");
    fixture.sqlite
      .prepare(
        "INSERT INTO points_x_claims(x_id,actor_id,claimed_at) VALUES(?,?,?)",
      )
      .run("987654321", "U_foreign", "2026-11-08T00:00:00.000Z");
    const flow = await fixture.start();
    const response = await fixture.call(
      `x/callback?state=${flow.state}&code=fixture`,
      undefined,
      flow.cookie,
    );
    expect(response.headers.get("location")).toBe("/points?x=failed");
    expect(
      fixture.sqlite.prepare("SELECT actor_id FROM points_x_claims").all(),
    ).toEqual([{ actor_id: "U_foreign" }]);
    expect(
      fixture.sqlite.prepare("SELECT * FROM points_x_links").all(),
    ).toEqual([]);
    expect(fixture.providerPaths).toContain("/2/oauth2/revoke");
  } finally {
    fixture.sqlite.close();
  }
});

test("X callback replay cannot claim a processing flow", async () => {
  const fixture = await xLifecycleFixture();
  let release = () => {};
  let reached = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tokenRequested = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let first: Promise<Response> | undefined;
  try {
    const flow = await fixture.start();
    fixture.setProviderReply(async (path) => {
      if (path === "/2/oauth2/token") {
        reached();
        await gate;
      }
      return undefined;
    });
    const path = `x/callback?state=${flow.state}&code=fixture`;
    first = fixture.call(path, undefined, flow.cookie);
    await Promise.race([
      tokenRequested,
      first.then(() => {
        throw new Error("Callback finished before provider hold");
      }),
    ]);
    const second = await fixture.call(path, undefined, flow.cookie);
    expect(second.headers.get("location")).toBe("/points?x=failed");
    expect(
      fixture.sqlite.prepare("SELECT status FROM points_x_flows").all(),
    ).toEqual([{ status: "processing" }]);
    release();
    expect((await first).headers.get("location")).toBe("/points?x=connected");
    expect(
      fixture.providerPaths.filter((value) => value === "/2/oauth2/token"),
    ).toHaveLength(1);
  } finally {
    release();
    await first?.catch(() => {});
    fixture.sqlite.close();
  }
});

test("X link batch failure rolls back its new identity claim", async () => {
  const fixture = await xLifecycleFixture();
  try {
    const flow = await fixture.start();
    fixture.sqlite.exec(
      "CREATE TRIGGER fixture_x_link_failure BEFORE INSERT ON points_x_links BEGIN SELECT RAISE(ABORT,'fixture link failure'); END;",
    );
    const response = await fixture.call(
      `x/callback?state=${flow.state}&code=fixture`,
      undefined,
      flow.cookie,
    );
    expect(response.headers.get("location")).toBe("/points?x=failed");
    expect(
      fixture.sqlite.prepare("SELECT * FROM points_x_claims").all(),
    ).toEqual([]);
    expect(
      fixture.sqlite.prepare("SELECT * FROM points_x_links").all(),
    ).toEqual([]);
    expect(
      fixture.sqlite.prepare("SELECT * FROM points_x_flows").all(),
    ).toEqual([]);
    expect(fixture.providerPaths).toContain("/2/oauth2/revoke");
  } finally {
    fixture.sqlite.close();
  }
});

for (const revokeFails of [false, true]) {
  test(`X cleanup failure preserves its error when token revocation ${revokeFails ? "fails" : "succeeds"}`, async () => {
    const fixture = await xLifecycleFixture();
    try {
      const flow = await fixture.start();
      if (revokeFails) {
        fixture.setProviderReply(async (path) => {
          if (path === "/2/oauth2/revoke")
            throw new Error("Fixture provider revocation failure");
          return undefined;
        });
      }
      fixture.sqlite.exec(
        "CREATE TRIGGER fixture_x_cleanup_failure BEFORE DELETE ON points_x_flows BEGIN SELECT RAISE(ABORT,'fixture cleanup failure'); END;",
      );
      const response = await fixture.call(
        `x/callback?state=${flow.state}&code=fixture`,
        undefined,
        flow.cookie,
      );
      expect(response.status).toBe(503);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(
        fixture.sqlite.prepare("SELECT x_id,public FROM points_x_links").all(),
      ).toEqual([{ x_id: "987654321", public: 1 }]);
      expect(
        fixture.sqlite.prepare("SELECT status FROM points_x_flows").all(),
      ).toEqual([{ status: "processing" }]);
      expect(fixture.providerPaths).toContain("/2/oauth2/revoke");
    } finally {
      fixture.sqlite.close();
    }
  });
}

test("invalid X callback leaves a newer browser cookie usable", async () => {
  const fixture = await xLifecycleFixture();
  try {
    const flow = await fixture.start();
    const refused = await fixture.call(
      "x/callback?state=invalid&code=fixture",
      undefined,
      flow.cookie,
    );
    expect(refused.headers.get("location")).toBe("/points?x=failed");
    expect(refused.headers.has("set-cookie")).toBe(false);
    const current = await fixture.call(
      `x/callback?state=${flow.state}&code=fixture`,
      undefined,
      flow.cookie,
    );
    expect(current.headers.get("location")).toBe("/points?x=connected");
  } finally {
    fixture.sqlite.close();
  }
});

test("a used X browser cookie cannot replay its consumed flow", async () => {
  const fixture = await xLifecycleFixture();
  try {
    const flow = await fixture.start();
    const path = `x/callback?state=${flow.state}&code=fixture`;
    const connected = await fixture.call(path, undefined, flow.cookie);
    expect(connected.headers.get("location")).toBe("/points?x=connected");
    expect(connected.headers.get("set-cookie")).toStartWith(
      `${flow.cookie.split("=")[0]}=;`,
    );
    const replay = await fixture.call(path, undefined, flow.cookie);
    expect(replay.headers.get("location")).toBe("/points?x=failed");
    expect(replay.headers.get("set-cookie")).toStartWith(
      `${flow.cookie.split("=")[0]}=;`,
    );
    expect(
      fixture.providerPaths.filter((value) => value === "/2/oauth2/token"),
    ).toHaveLength(1);
    expect(
      fixture.sqlite.prepare("SELECT x_id FROM points_x_links").all(),
    ).toEqual([{ x_id: "987654321" }]);
  } finally {
    fixture.sqlite.close();
  }
});

test("out-of-order X start responses keep distinct browser cookies", async () => {
  const fixture = await xLifecycleFixture();
  let release = () => {};
  let reached = () => {};
  const firstCommitted = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const firstRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first: ReturnType<typeof fixture.start> | undefined;
  try {
    const batch = fixture.db.batch.bind(fixture.db);
    let holdFirst = true;
    fixture.db.batch = async (statements) => {
      const result = await batch(statements);
      if (holdFirst) {
        holdFirst = false;
        reached();
        await firstRelease;
      }
      return result;
    };
    first = fixture.start();
    await Promise.race([
      firstCommitted,
      first.then(() => {
        throw new Error("First start returned before its hold");
      }),
    ]);
    const second = await fixture.start();
    release();
    const earlier = await first;
    expect(earlier.cookie.split("=")[0]).not.toBe(second.cookie.split("=")[0]);
    // Apply B then A as response order. Distinct names coexist in the browser.
    const cookies = `${second.cookie}; ${earlier.cookie}`;
    const old = await fixture.call(
      `x/callback?state=${earlier.state}&code=fixture`,
      undefined,
      cookies,
    );
    expect(old.headers.get("location")).toBe("/points?x=failed");
    expect(old.headers.get("set-cookie")).toStartWith(
      `${earlier.cookie.split("=")[0]}=;`,
    );
    const current = await fixture.call(
      `x/callback?state=${second.state}&code=fixture`,
      undefined,
      second.cookie,
    );
    expect(current.headers.get("location")).toBe("/points?x=connected");
  } finally {
    release();
    await first?.catch(() => {});
    fixture.sqlite.close();
  }
});

test("an already-started legacy X flow can complete without clearing its shared cookie", async () => {
  const fixture = await xLifecycleFixture();
  try {
    const flow = await fixture.start();
    const cap = flow.cookie.slice(flow.cookie.indexOf("=") + 1);
    const response = await fixture.call(
      `x/callback?state=${flow.state}&code=fixture`,
      undefined,
      `__Host-slop_x_flow=${cap}`,
    );
    expect(response.headers.get("location")).toBe("/points?x=connected");
    expect(response.headers.get("set-cookie")).toStartWith(
      `__Host-slop_x_flow_${flow.state}=;`,
    );
  } finally {
    fixture.sqlite.close();
  }
});
