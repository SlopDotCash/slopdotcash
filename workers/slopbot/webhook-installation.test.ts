import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import worker from "./index";

const SECRET = "webhook-installation-test-secret";
const INSTALLATION_ID = 4242;

type RunResult = { success: boolean; meta: { changes: number } };

class TestStatement {
  private values: (string | number | bigint | boolean | null)[] = [];

  constructor(
    private readonly db: TestDatabase,
    readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values as typeof this.values;
    return this;
  }

  execute(): RunResult {
    const result = this.db.sqlite.query(this.sql).run(...this.values);
    return { success: true, meta: { changes: result.changes } };
  }

  async run(): Promise<RunResult> {
    const failure = this.db.takeFailure(this.sql);
    if (failure === "before") {
      throw new Error("simulated D1 failure before commit");
    }
    if (failure === "after") {
      this.execute();
      throw new Error("simulated lost D1 response after commit");
    }
    return this.execute();
  }

  async first<T>(): Promise<T | null> {
    return (this.db.sqlite.query(this.sql).get(...this.values) as T) ?? null;
  }
}

class TestDatabase {
  readonly sqlite = new Database(":memory:");
  readonly migrationSecond: number | null;
  installationFailure: "before" | "after" | null = null;

  constructor(seedBeforeDeliveryMigration?: (sqlite: Database) => void) {
    this.sqlite.exec(
      readFileSync(
        new URL("../../migrations/0013_slopbot.sql", import.meta.url),
        "utf8",
      ),
    );
    seedBeforeDeliveryMigration?.(this.sqlite);
    const before = this.unixSecond();
    this.sqlite.exec(
      readFileSync(
        new URL(
          "../../migrations/0018_slopbot_delivery_processing.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const after = this.unixSecond();
    this.migrationSecond = before === after ? before : null;
    for (const migration of readdirSync(
      new URL("../../migrations/", import.meta.url),
    )
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      if (
        migration === "0013_slopbot.sql" ||
        migration === "0018_slopbot_delivery_processing.sql"
      )
        continue;
      this.sqlite.exec(
        readFileSync(
          new URL(`../../migrations/${migration}`, import.meta.url),
          "utf8",
        ),
      );
    }
  }

  prepare(sql: string) {
    return new TestStatement(this, sql);
  }

  async batch(statements: TestStatement[]) {
    const failure = statements
      .map((statement) => this.takeFailure(statement.sql))
      .find((value) => value !== null);
    if (failure === "before") {
      throw new Error("simulated D1 failure before commit");
    }
    const execute = this.sqlite.transaction(() =>
      statements.map((statement) => statement.execute()),
    );
    const results = execute();
    if (failure === "after")
      throw new Error("simulated lost D1 response after commit");
    return results;
  }

  takeFailure(sql: string) {
    if (
      this.installationFailure === null ||
      !/^UPDATE slopbot_installations|^INSERT INTO slopbot_installations/u.test(
        sql.trim(),
      )
    )
      return null;
    const failure = this.installationFailure;
    this.installationFailure = null;
    return failure;
  }

  private unixSecond() {
    return (
      this.sqlite
        .query("SELECT CAST(strftime('%s', 'now') AS INTEGER) AS value")
        .get() as { value: number }
    ).value;
  }

  suspendedAt() {
    return this.sqlite
      .query(
        "SELECT suspended_at FROM slopbot_installations WHERE installation_id = ?",
      )
      .get(INSTALLATION_ID) as { suspended_at: string | null } | null;
  }

  close() {
    this.sqlite.close();
  }
}

const databases: TestDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

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
  return `sha256=${[...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function harness(seedBeforeDeliveryMigration?: (sqlite: Database) => void) {
  const db = new TestDatabase(seedBeforeDeliveryMigration);
  databases.push(db);
  const env = {
    SLOPBOT_WEBHOOK_SECRET: SECRET,
    SLOPBOT_DB: db,
    SLOPBOT_QUEUE: { send: async () => {} },
    SLOPBOT_APP_ID: "1",
    SLOPBOT_APP_PRIVATE_KEY: "unused",
    SLOPBOT_APP_USER_ID: "999999",
  };
  const deliver = async (
    action: "created" | "suspend" | "unsuspend" | "deleted",
    deliveryId: string,
    updatedAt: string | number,
    login = "acme",
  ) => {
    const body = JSON.stringify({
      action,
      installation: {
        id: INSTALLATION_ID,
        app_id: 1,
        app_slug: "slopbot",
        target_id: 777,
        target_type: "Organization",
        repository_selection: "all",
        permissions: { issues: "write", pull_requests: "write" },
        events: ["issues", "pull_request"],
        created_at: "2026-10-14T10:00:00Z",
        updated_at: updatedAt,
        suspended_at: action === "suspend" ? updatedAt : null,
        account: { id: 777, login, type: "Organization" },
      },
      sender: { id: 555, login: "owner", type: "User" },
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

function seedActiveInstallation(sqlite: Database) {
  sqlite
    .query(
      `INSERT INTO slopbot_installations
         (installation_id, account_id, account_login, account_type, created_at, suspended_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      INSTALLATION_ID,
      777,
      "acme",
      "Organization",
      "2020-01-01T00:00:00.500Z",
    );
}

describe("installation webhook delivery", () => {
  test("does not replay an older suspend after its committed response was lost", async () => {
    const { db, deliver } = harness();
    await deliver("created", "created-1", "2026-10-14T10:00:00Z");

    db.installationFailure = "after";
    await expect(
      deliver("suspend", "suspend-1", "2026-10-14T10:01:00Z"),
    ).rejects.toThrow("simulated lost D1 response after commit");
    expect(db.suspendedAt()?.suspended_at).not.toBeNull();

    await deliver("unsuspend", "unsuspend-1", "2026-10-14T10:02:00Z");
    expect(db.suspendedAt()?.suspended_at).toBeNull();

    await deliver("suspend", "suspend-1", "2026-10-14T10:01:00Z");
    expect(db.suspendedAt()?.suspended_at).toBeNull();
  });

  test("does not let a delayed older suspend replace a newer unsuspend", async () => {
    const { db, deliver } = harness();
    await deliver("created", "created-2", "2026-10-14T10:00:00Z");

    db.installationFailure = "before";
    await expect(
      deliver("suspend", "suspend-2", "2026-10-14T10:01:00Z"),
    ).rejects.toThrow("simulated D1 failure before commit");
    expect(db.suspendedAt()?.suspended_at).toBeNull();

    await deliver("unsuspend", "unsuspend-2", "2026-10-14T10:02:00Z");
    expect(db.suspendedAt()?.suspended_at).toBeNull();

    await deliver("suspend", "suspend-2", "2026-10-14T10:01:00Z");
    expect(db.suspendedAt()?.suspended_at).toBeNull();
  });

  test("records a suspend even when the created delivery was missed", async () => {
    const { db, deliver } = harness();

    await deliver("suspend", "suspend-3", "2026-10-14T10:02:00Z");
    expect(db.suspendedAt()).toEqual({ suspended_at: expect.any(String) });

    await deliver("created", "created-3", "2026-10-14T10:00:00Z");
    expect(db.suspendedAt()).toEqual({ suspended_at: expect.any(String) });
  });

  test("accepts GitHub's numeric installation timestamps", async () => {
    const { db, deliver } = harness();

    await deliver("created", "created-4", 1791972000);
    await deliver("suspend", "suspend-4", 1791972060);

    expect(db.suspendedAt()).toEqual({ suspended_at: expect.any(String) });
  });

  test("orders equivalent ISO timestamp spellings by instant", async () => {
    const { db, deliver } = harness();
    await deliver("created", "created-5", "2026-10-14T10:00:00Z");
    await deliver("suspend", "suspend-5", "2026-10-14T10:01:00Z");

    await deliver("unsuspend", "unsuspend-5", "2026-10-14T06:02:00-04:00");

    expect(db.suspendedAt()?.suspended_at).toBeNull();
  });

  test("fails closed when lifecycle events share a source timestamp", async () => {
    const { db, deliver } = harness();
    const updatedAt = "2026-10-14T10:00:00Z";
    await deliver("created", "created-6", updatedAt);

    await deliver("suspend", "suspend-6", updatedAt);

    expect(db.suspendedAt()).toEqual({ suspended_at: expect.any(String) });
  });

  test("does not replay a pre-migration ambiguous delivery", async () => {
    const { db, deliver } = harness((sqlite) => {
      seedActiveInstallation(sqlite);
      sqlite
        .query(
          "INSERT INTO slopbot_deliveries (delivery_id, event, received_at) VALUES (?, 'installation', ?)",
        )
        .run("unsuspend-before-migration", "2020-01-01T00:02:01Z");
    });

    await deliver(
      "suspend",
      "lost-suspend-before-migration",
      "2020-01-01T00:01:00Z",
    );

    expect(db.suspendedAt()?.suspended_at).toBeNull();
  });

  test("applies a lifecycle event generated during the migration second", async () => {
    let context = harness(seedActiveInstallation);
    while (context.db.migrationSecond === null) {
      context = harness(seedActiveInstallation);
    }

    await context.deliver(
      "suspend",
      "suspend-during-migration",
      context.db.migrationSecond,
    );

    expect(context.db.suspendedAt()).toEqual({
      suspended_at: expect.any(String),
    });
  });
});

for (const action of ["suspend", "deleted"] as const) {
  test(`installation ${action} records one owner notice in the webhook transaction`, async () => {
    const { db, deliver } = harness();
    const manifest = JSON.stringify({
      id: "notice-project",
      status: "active",
      steward: { github: { actorId: "910000002" } },
    });
    db.sqlite
      .query(
        "INSERT INTO project_revisions(project_id, revision, manifest, manifest_sha256, reason, created_at) VALUES(?,1,?,?,?,?)",
      )
      .run(
        "notice-project",
        manifest,
        "a".repeat(64),
        "fixture",
        "2026-10-23T10:00:00.000Z",
      );
    db.sqlite
      .query(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
      )
      .run(
        "notice-project",
        manifest,
        "a".repeat(64),
        "2026-10-23T10:00:00.000Z",
        "2026-10-23T10:00:00.000Z",
      );
    db.sqlite
      .query(
        "INSERT INTO project_repositories(repository_key,project_id) VALUES('acme/repo','notice-project')",
      )
      .run();
    expect(
      (await deliver("created", "notice-created", "2026-10-23T10:00:00Z"))
        .status,
    ).toBe(202);
    db.installationFailure = "before";
    await expect(
      deliver(action, "notice-change", "2026-10-23T11:00:00Z"),
    ).rejects.toThrow("simulated D1 failure before commit");
    expect(
      db.sqlite.query("SELECT COUNT(*) AS n FROM notifications").get(),
    ).toEqual({ n: 0 });
    db.installationFailure = "after";
    await expect(
      deliver(action, "notice-change", "2026-10-23T11:00:00Z"),
    ).rejects.toThrow("simulated lost D1 response after commit");
    expect(
      (await deliver(action, "notice-change", "2026-10-23T11:00:00Z")).status,
    ).toBe(202);
    expect(
      (await deliver(action, "notice-older", "2026-10-23T09:00:00Z")).status,
    ).toBe(202);
    expect(
      db.sqlite
        .query("SELECT recipient_github_id, kind, subject FROM notifications")
        .all(),
    ).toEqual([
      {
        recipient_github_id: "910000002",
        kind: "project_installation_lost",
        subject: "notice-project",
      },
    ]);
  });

  test(`installation ${action} notifies the projects of the account's current login`, async () => {
    const { db, deliver } = harness();
    await deliver("created", "renamed-created", "2026-10-23T10:00:00Z");
    // The organization renames itself on GitHub after it installs the App.
    // Its project lists the new name; another account now owns the old name.
    registerProject(db, "renamed-project", "acme-labs/repo", "910000003");
    registerProject(db, "former-name-project", "acme/other", "910000004");
    const changed = await deliver(
      action,
      "renamed-change",
      "2026-10-23T11:00:00Z",
      "acme-labs",
    );
    expect(changed.status).toBe(202);
    expect(
      db.sqlite
        .query("SELECT recipient_github_id, subject FROM notifications")
        .all(),
    ).toEqual([
      { recipient_github_id: "910000003", subject: "renamed-project" },
    ]);
  });
}

function registerProject(
  db: TestDatabase,
  id: string,
  repositoryKey: string,
  steward: string,
) {
  const manifest = JSON.stringify({
    id,
    status: "active",
    steward: { github: { actorId: steward } },
  });
  const at = "2026-10-23T10:00:00.000Z";
  db.sqlite
    .query(
      "INSERT INTO project_revisions(project_id, revision, manifest, manifest_sha256, reason, created_at) VALUES(?,1,?,?,?,?)",
    )
    .run(id, manifest, "a".repeat(64), "fixture", at);
  db.sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
    )
    .run(id, manifest, "a".repeat(64), at, at);
  db.sqlite
    .query(
      "INSERT INTO project_repositories(repository_key,project_id) VALUES(?,?)",
    )
    .run(repositoryKey, id);
}
