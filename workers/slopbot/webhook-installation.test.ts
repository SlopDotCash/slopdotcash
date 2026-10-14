// The delivery claim is recorded before the installation write. If that
// write rejects, the claim must be released: a redelivery is the only
// recovery path, and a retained claim answers it "duplicate delivery" and
// strands the lifecycle event (BOT-01). A successful write keeps the claim.
import { describe, expect, test } from "bun:test";
import worker from "./index";
import type { D1Database } from "./persistence";

const SECRET = "webhook-installation-test-secret";
const INSTALLATION_ID = 4242;

type InstallationRow = {
  login: string;
  removed_at: string | null;
  suspended_at: string | null;
};

class FakeStatement {
  private values: unknown[] = [];
  constructor(
    private db: FakeDb,
    private sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async run() {
    if (this.sql.includes("slopbot_deliveries")) {
      if (this.sql.startsWith("INSERT")) {
        const id = this.values[0] as string;
        if (this.db.deliveries.has(id))
          return { success: true, meta: { changes: 0 } };
        this.db.deliveries.add(id);
        return { success: true, meta: { changes: 1 } };
      }
      if (this.sql.startsWith("DELETE")) {
        this.db.deliveries.delete(this.values[0] as string);
        return { success: true, meta: { changes: 1 } };
      }
    }
    if (this.sql.includes("slopbot_installations")) {
      if (this.db.failInstallation) throw new Error("simulated D1 failure");
      if (this.sql.startsWith("INSERT")) {
        const [id, , login] = this.values as [number, number, string];
        this.db.installations.set(id, {
          login,
          removed_at: null,
          suspended_at: null,
        });
        return { success: true, meta: { changes: 1 } };
      }
      if (this.sql.startsWith("UPDATE")) {
        const [stamp, id] = this.values as [string | null, number];
        const row = this.db.installations.get(id);
        if (row) {
          if (this.sql.includes("removed_at")) row.removed_at = stamp;
          if (this.sql.includes("suspended_at")) row.suspended_at = stamp;
        }
        return { success: true, meta: { changes: 1 } };
      }
    }
    throw new Error(`unexpected SQL: ${this.sql}`);
  }
  async first() {
    return null;
  }
}

class FakeDb implements D1Database {
  deliveries = new Set<string>();
  installations = new Map<number, InstallationRow>();
  failInstallation = false;
  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }
}

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  const hex = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

function harness() {
  const db = new FakeDb();
  const env = {
    SLOPBOT_WEBHOOK_SECRET: SECRET,
    SLOPBOT_DB: db,
    SLOPBOT_QUEUE: { send: async () => {} },
    SLOPBOT_APP_ID: "1",
    SLOPBOT_APP_PRIVATE_KEY: "unused",
    SLOPBOT_APP_USER_ID: "999999",
  };
  const deliver = async (action: string, deliveryId: string) => {
    const body = JSON.stringify({
      action,
      installation: {
        id: INSTALLATION_ID,
        account: { id: 777, login: "acme", type: "Organization" },
      },
      sender: { id: 555, type: "User" },
    });
    return worker.fetch(
      new Request("https://slopbot.example/github/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "installation",
          "x-github-delivery": deliveryId,
          "x-hub-signature-256": await sign(body),
        },
        body,
      }),
      env,
    );
  };
  return { db, deliver };
}

describe("installation webhook intake", () => {
  test("releases the claim when the installation write fails, so a redelivery records the installation", async () => {
    const { db, deliver } = harness();
    db.failInstallation = true;
    await expect(deliver("created", "d-1")).rejects.toThrow(
      "simulated D1 failure",
    );
    expect(db.deliveries.has("d-1")).toBe(false);
    expect(db.installations.has(INSTALLATION_ID)).toBe(false);

    db.failInstallation = false;
    const redelivery = await deliver("created", "d-1");
    expect(redelivery.status).toBe(202);
    expect(await redelivery.text()).toBe("ignored");
    expect(db.installations.get(INSTALLATION_ID)?.login).toBe("acme");
  });

  test("keeps the claim after a successful write, so a further redelivery stays a duplicate", async () => {
    const { db, deliver } = harness();
    const first = await deliver("created", "d-2");
    expect(first.status).toBe(202);
    expect(db.installations.has(INSTALLATION_ID)).toBe(true);

    const again = await deliver("created", "d-2");
    expect(again.status).toBe(202);
    expect(await again.text()).toBe("duplicate delivery");
  });

  test("releases the claim when a suspend write fails, so a redelivery suspends the installation", async () => {
    const { db, deliver } = harness();
    await deliver("created", "d-3");
    expect(db.installations.get(INSTALLATION_ID)?.suspended_at).toBeNull();

    db.failInstallation = true;
    await expect(deliver("suspend", "d-4")).rejects.toThrow(
      "simulated D1 failure",
    );
    expect(db.deliveries.has("d-4")).toBe(false);
    expect(db.installations.get(INSTALLATION_ID)?.suspended_at).toBeNull();

    db.failInstallation = false;
    const redelivery = await deliver("suspend", "d-4");
    expect(redelivery.status).toBe(202);
    expect(db.installations.get(INSTALLATION_ID)?.suspended_at).not.toBeNull();
  });
});
