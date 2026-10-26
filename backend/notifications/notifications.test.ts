// Each writer adds its inbox row in the same batch as the source change.
// These tests run the real migrations, project persistence, payment ledger,
// payout dispatch, wallet registration and inbox route, then replay each
// source event to prove that a replay never adds a second notification.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { parseNotificationsResponse } from "../../src/lib/notifications";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1TransactionalDatabase as D1Database } from "../d1";
import { dispatchPayment } from "../payments/dispatch";
import {
  indexPaymentEvent,
  type PaymentChainAdapter,
} from "../payments/ledger";
import { registerPaymentWallet } from "../payments/wallet-registration";
import { CloudflareProjectPersistence } from "../projects/cloudflare-persistence";
import type { ProjectEnforcement } from "../projects/contracts";
import { CloudflareTracePersistence } from "../trace/cloudflare-persistence";
import {
  notifySlopbotAppeal,
  notifySlopbotScamReview,
  scamReviewGitHubUrl,
} from "./events";
import { handleNotificationsApi } from "./handler";

const migrations = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const T = "2026-10-19T10:00:00.000Z";
const R = "2026-10-19T10:30:00.000Z";
const EARLY = "2026-10-19T09:00:00.000Z";
const APPLICANT = "900000002";
const STEWARD = "900000003";
const OTHER = "900000004";
const MODERATOR = "900000005";
const ADDRESS = "0x8f77c37d8650776bfe73c9b12b15209ee15d9b86";
const NEXT_ADDRESS = "0x2222222222222222222222222222222222222222";
const VAULT = "0x1111111111111111111111111111111111111111";
const ASSET = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function open() {
  const { db, sqlite } = sqliteD1(migrations);
  const rows = (recipient: string) =>
    sqlite
      .query(
        "SELECT event_key,kind,subject,detail,action_path,source_at,read_at FROM notifications WHERE recipient_github_id=? ORDER BY source_at,event_key",
      )
      .all(recipient) as Record<string, string | null>[];
  return { db, sqlite, rows };
}

describe("notification events", () => {
  test("self-service listing sends no routine notice; later revisions notify once each", async () => {
    const { db, sqlite, rows } = open();
    const persistence = new CloudflareProjectPersistence(db);
    const creator = { githubId: APPLICANT, githubLogin: "e2e-applicant" };
    const manifestOf = (id: string) =>
      ({
        id,
        status: "paused",
        repositories: [{ id: `example/${id}` }],
        steward: { github: { actorId: STEWARD } },
      }) as unknown as ProjectDefinition;
    const alpha = manifestOf("alpha");
    expect(
      await persistence.createProject({
        manifest: alpha,
        manifestText: JSON.stringify(alpha),
        manifestSha256: "a".repeat(64),
        reason: "Created through self-service setup",
        actor: creator,
        at: T,
        referrer: null,
      }),
    ).toBe("created");
    // The same id or repository cannot be listed twice.
    expect(
      await persistence.createProject({
        manifest: alpha,
        manifestText: JSON.stringify(alpha),
        manifestSha256: "a".repeat(64),
        reason: "Created again",
        actor: creator,
        at: T,
        referrer: null,
      }),
    ).toBe("conflict");
    // An application stored before self-service setup is published by its
    // applicant, once, with no approval notice.
    const beta = JSON.stringify(manifestOf("beta"));
    sqlite.exec(
      `INSERT INTO project_applications (id,project_id,repository_key,manifest,manifest_sha256,acceptance_criteria,applicant_github_id,applicant_github_login,submitted_at,status,admin_notification)
         VALUES ('application-beta','beta','example/beta','${beta}','${"b".repeat(64)}','Merged pull requests','${APPLICANT}','e2e-applicant','${EARLY}','pending','pending')`,
    );
    const publish = {
      applicationId: "application-beta",
      actor: creator,
      reason: "Published by its applicant",
      at: T,
    };
    expect(await persistence.publishApplication(publish)).toBe("published");
    expect(await persistence.publishApplication(publish)).toBe("conflict");
    expect(await persistence.projectCreator("alpha")).toEqual(creator);
    expect(await persistence.projectCreator("beta")).toEqual(creator);
    expect(
      (await persistence.listOwnedProjects(APPLICANT)).map((p) => p.id),
    ).toEqual(["alpha", "beta"]);
    const project = await persistence.getProject("alpha");
    const next = { ...project?.manifest, revision: 2 } as ProjectDefinition;
    const revision = (actor: { githubId: string; githubLogin: string }) => ({
      projectId: "alpha",
      expectedRevision: 1,
      manifest: next,
      manifestText: JSON.stringify(next),
      manifestSha256: "2".repeat(64),
      reason: "Owner update: headline",
      actor,
      at: R,
    });
    // The creator's own revision reaches the steward, not the creator.
    expect(await persistence.appendProjectRevision(revision(creator), 0)).toBe(
      "updated",
    );
    // The same revision cannot be appended twice.
    expect(await persistence.appendProjectRevision(revision(creator), 0)).toBe(
      "conflict",
    );
    expect(rows(APPLICANT)).toEqual([]);
    expect(rows(STEWARD)).toEqual([
      {
        event_key: "project-revision:alpha:2",
        kind: "project_revision",
        subject: "alpha",
        detail: "Owner update: headline",
        action_path: "/projects/alpha",
        source_at: R,
        read_at: null,
      },
    ]);
    // Another account's revision reaches the creator.
    const third = { ...next, revision: 3 } as ProjectDefinition;
    expect(
      await persistence.appendProjectRevision(
        {
          ...revision({ githubId: OTHER, githubLogin: "maintainer" }),
          expectedRevision: 2,
          manifest: third,
          manifestText: JSON.stringify(third),
          manifestSha256: "3".repeat(64),
        },
        0,
      ),
    ).toBe("updated");
    expect(rows(APPLICANT).map((row) => row.event_key)).toEqual([
      "project-revision:alpha:3",
    ]);
  });

  test("project enforcement records notify the project and independent reviewers once", async () => {
    const { db, sqlite, rows } = open();
    const persistence = new CloudflareProjectPersistence(db);
    const manifest = {
      id: "alpha",
      status: "paused",
      repositories: [{ id: "example/alpha" }],
      steward: { github: { actorId: STEWARD } },
    };
    const text = JSON.stringify(manifest);
    sqlite.exec(
      `INSERT INTO project_applications (id,project_id,repository_key,manifest,manifest_sha256,acceptance_criteria,applicant_github_id,applicant_github_login,submitted_at,status,admin_notification,admin_notification_at,decided_at,decided_by_github_id,decided_by_github_login)
         VALUES ('application-alpha','alpha','example/alpha','${text}','${"a".repeat(64)}','Merged pull requests','${APPLICANT}','e2e-applicant','${T}','approved','sent','${T}','${T}','1','admin');
       INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,created_at)
         VALUES ('alpha',1,'${text}','${"a".repeat(64)}','Approved','${T}');
       INSERT INTO projects (id,status,revision,manifest,manifest_sha256,created_at,updated_at,source_application_id)
         VALUES ('alpha','paused',1,'${text}','${"a".repeat(64)}','${T}','${T}','application-alpha');`,
    );
    const placedBy = { githubId: OTHER, githubLogin: "moderator-a" };
    const recordedBy = { githubId: "900000006", githubLogin: "moderator-b" };
    const record = (
      sequence: number,
      action: ProjectEnforcement["action"],
      appealAfter: ProjectEnforcement["appealAfter"],
      createdAt: string,
    ): ProjectEnforcement => ({
      id: `enf_testrecord${sequence}`,
      projectId: "alpha",
      sequence,
      action,
      stateAfter: "quarantined",
      appealAfter,
      reason: "Private moderation reason",
      evidenceReference: "private-evidence-1",
      repositoryGithubId: "123",
      repositoryKeys: ["example/alpha"],
      actor: sequence === 1 ? placedBy : recordedBy,
      actorRole: "project-moderator",
      decisionSource: "admin-panel",
      beforeRevision: 1,
      beforeManifestSha256: "a".repeat(64),
      afterRevision: null,
      afterManifestSha256: null,
      result: "no_revision_needed",
      createdAt,
    });
    const quarantine = record(1, "quarantine", "none", T);
    const appeal = record(2, "request_reinstatement", "requested", R);
    expect(await persistence.appendEnforcement(quarantine, null, [])).toBe(
      "recorded",
    );
    // A replayed record breaks the gapless sequence and writes nothing.
    expect(await persistence.appendEnforcement(quarantine, null, [])).toBe(
      "conflict",
    );
    expect(
      await persistence.appendEnforcement(appeal, null, [
        MODERATOR,
        recordedBy.githubId,
        "x1",
      ]),
    ).toBe("recorded");
    const keys = (recipient: string) =>
      rows(recipient).map((row) => [
        row.event_key,
        row.kind,
        row.detail,
        row.action_path,
      ]);
    expect(keys(APPLICANT)).toEqual([
      [
        "project-enforcement:enf_testrecord1",
        "project_quarantined",
        null,
        "/projects/alpha",
      ],
      [
        "project-enforcement:enf_testrecord2",
        "reinstatement_requested",
        null,
        "/projects/alpha",
      ],
    ]);
    expect(keys(STEWARD)).toEqual(keys(APPLICANT));
    // The moderator who recorded the request is not asked to review it.
    expect(keys(recordedBy.githubId)).toEqual([]);
    expect(keys(MODERATOR)).toEqual([
      [
        "reinstatement-review:enf_testrecord2",
        "reinstatement_review",
        null,
        "/admin",
      ],
    ]);
    // The private reason and evidence reference never reach a row.
    expect(
      sqlite
        .query(
          "SELECT count(*) AS n FROM notifications WHERE detail IS NOT NULL OR subject <> 'alpha'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  test("wallet changes and finalized payment events notify the contributor once", async () => {
    const { db, sqlite, rows } = open();
    const d1 = db as unknown as D1Database;
    const member = { github_id: APPLICANT, login: "e2e-applicant" };
    const stewarded = JSON.stringify({
      id: "alpha",
      status: "paused",
      steward: { github: { actorId: STEWARD } },
    });
    sqlite.exec(
      `INSERT INTO project_revisions (project_id,revision,manifest,manifest_sha256,reason,created_at)
         VALUES ('alpha',1,'${stewarded}','${"a".repeat(64)}','Approved','${T}');
       INSERT INTO projects (id,status,revision,manifest,manifest_sha256,created_at,updated_at)
         VALUES ('alpha','paused',1,'${stewarded}','${"a".repeat(64)}','${T}','${T}');`,
    );
    // A wallet claim imported from a GitHub issue notifies like a site
    // registration, once.
    const issueClaim = {
      id: "claim-issue-1",
      githubId: APPLICANT,
      githubLogin: "e2e-applicant",
      walletAddress: "So11111111111111111111111111111111111111112",
      chain: "solana" as const,
      source: "github_issue" as const,
      issueRepository: "example/alpha",
      issueNumber: 7,
      sourceBodySha256: "c".repeat(64),
      observedAt: EARLY,
      recordSha256: "d".repeat(64),
      supersedesClaimId: null,
      createdAt: EARLY,
    };
    const trace = new CloudflareTracePersistence(d1, {} as never);
    for (const n of [1, 2])
      expect(
        (
          await trace.createWalletClaim(issueClaim, {
            id: `audit-${n}`,
            actorGithubId: APPLICANT,
            action: "wallet_claim.created",
            target: "wallet-claim:claim-issue-1",
            requestId: `request-${n}`,
            createdAt: EARLY,
            details: {},
          })
        ).status,
      ).toBe(n === 1 ? "created" : "existing");
    const authorize = (claimId: string, n: number) =>
      sqlite.exec(
        `INSERT INTO payment_wallet_challenges VALUES ('challenge-${n}','${claimId}','${APPLICANT}','message','2026-10-20T00:00:00.000Z','${T}');
         INSERT INTO payment_wallet_authorizations VALUES ('${claimId}','${APPLICANT}','${T}','challenge-${n}','signature');`,
      );
    const first = await registerPaymentWallet(d1, member, "base", ADDRESS, T);
    // Registering the same address again is a replay and adds no claim.
    expect(await registerPaymentWallet(d1, member, "base", ADDRESS, T)).toEqual(
      first,
    );
    authorize(first.claimId, 1);
    sqlite.exec(
      `INSERT INTO vault_snapshots (project_id,network,chain,vault,asset_address,asset_decimals,total_deposited,total_paid,total_payout_fees,total_gross_withdrawn,total_withdrawal_fees,total_service_fees,block_number,block_time,observed_at)
         VALUES ('alpha','base-sepolia','base','${VAULT}','${ASSET}',6,'0','0','0','0','0','0','1','${T}','${T}');`,
    );
    const event = (kind: "reserved" | "paid", transactionId: string) => ({
      kind,
      transactionId,
      eventIndex: 0,
      blockId: "1",
      obligationId: "obligation-1",
      projectId: "alpha",
      network: "base-sepolia",
      chain: "base" as const,
      vault: VAULT,
      githubUserId: APPLICANT,
      grossMicro: "1000000",
      netMicro: "980000",
      feeMicro: "20000",
      sourceDigest: "b".repeat(64),
      ...(kind === "paid" ? { destination: NEXT_ADDRESS } : {}),
    });
    const adapter: PaymentChainAdapter = {
      verifyFinalized: async (input) => event(input.kind, input.transactionId),
    };
    const reserved = {
      transactionId: "0xreserve",
      eventIndex: 0,
      kind: "reserved" as const,
      obligationId: "obligation-1",
    };
    const paid = { ...reserved, transactionId: "0xpay", kind: "paid" as const };
    const reservedAt = "2026-10-19T11:00:00.000Z";
    const changedAt = "2026-10-19T11:10:00.000Z";
    const heldAt = new Date("2026-10-19T11:20:00.000Z");
    const paidAt = "2026-10-19T12:00:00.000Z";
    await indexPaymentEvent(d1, adapter, reserved, reservedAt);
    await indexPaymentEvent(d1, adapter, reserved, "2026-10-19T11:30:00.000Z");
    // A new wallet that is not yet confirmed makes the worker hold the payout.
    const next = await registerPaymentWallet(
      d1,
      member,
      "base",
      NEXT_ADDRESS,
      changedAt,
    );
    const executor = {
      submit: async () => {
        throw new Error("A held payout must not be submitted");
      },
    };
    expect(await dispatchPayment(d1, executor, "obligation-1", heldAt)).toBe(
      "unavailable",
    );
    expect(await dispatchPayment(d1, executor, "obligation-1", heldAt)).toBe(
      "unavailable",
    );
    authorize(next.claimId, 2);
    await indexPaymentEvent(d1, adapter, paid, paidAt);
    await indexPaymentEvent(d1, adapter, paid, "2026-10-19T12:30:00.000Z");
    expect(
      rows(APPLICANT).map((row) => [
        row.event_key,
        row.kind,
        row.subject,
        row.action_path,
        row.source_at,
      ]),
    ).toEqual([
      [
        "wallet-claim:claim-issue-1",
        "wallet_changed",
        "solana",
        "/account#wallets",
        EARLY,
      ],
      [
        `wallet-claim:${first.claimId}`,
        "wallet_changed",
        "base",
        "/account#wallets",
        T,
      ],
      [
        "payment-reserved:obligation-1",
        "award_reserved",
        "alpha",
        "/earnings",
        reservedAt,
      ],
      [
        `wallet-claim:${next.claimId}`,
        "wallet_changed",
        "base",
        "/account#wallets",
        changedAt,
      ],
      [
        `payout-held:obligation-1:${heldAt.toISOString()}`,
        "payout_held",
        "alpha",
        "/earnings",
        heldAt.toISOString(),
      ],
      [
        "payment-paid:obligation-1",
        "payment_paid",
        "alpha",
        "/earnings",
        paidAt,
      ],
    ]);
    expect(rows(OTHER)).toEqual([]);
    // The steward gets one payout exception, with no contributor or wallet.
    expect(rows(STEWARD)).toEqual([
      {
        event_key: `payout-exception:obligation-1:${heldAt.toISOString()}`,
        kind: "payout_exception",
        subject: "alpha",
        detail: null,
        action_path: "/projects/alpha",
        source_at: heldAt.toISOString(),
        read_at: null,
      },
    ]);
  });

  test("a notification changes only from unread to read and is never deleted", () => {
    const { sqlite } = open();
    sqlite.exec(
      `INSERT INTO notifications (event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES ('wallet-claim:x','${APPLICANT}','wallet_changed','base','/account#wallets','${T}','${T}')`,
    );
    expect(() =>
      sqlite.exec("UPDATE notifications SET subject='solana'"),
    ).toThrow(/unread to read/u);
    sqlite.exec(`UPDATE notifications SET read_at='${T}'`);
    expect(() =>
      sqlite.exec(
        "UPDATE notifications SET read_at='2026-10-19T13:00:00.000Z'",
      ),
    ).toThrow(/unread to read/u);
    expect(() => sqlite.exec("DELETE FROM notifications")).toThrow(
      /permanent/u,
    );
  });
});

describe("notifications API", () => {
  const origin = "https://slop.cash";
  function setup(actor: string | null) {
    const { db, sqlite, rows } = open();
    for (const [recipient, key, at] of [
      [APPLICANT, "wallet-claim:a", "2026-10-19T10:00:00.000Z"],
      [APPLICANT, "wallet-claim:b", "2026-10-19T11:00:00.000Z"],
      [OTHER, "wallet-claim:c", "2026-10-19T12:00:00.000Z"],
    ])
      sqlite
        .prepare(
          "INSERT INTO notifications (event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES (?,?,'wallet_changed','base','/account#wallets',?,?)",
        )
        .run(key, recipient, at, at);
    const call = (request: Request) =>
      handleNotificationsApi(request, {
        db: db as never,
        sessionActor: async () => (actor ? { githubId: actor } : null),
        now: () => new Date("2026-10-19T13:00:00.000Z"),
      });
    return { call, rows, sqlite };
  }
  test("older unread notifications remain reachable when new events arrive", async () => {
    const { call, sqlite } = setup(APPLICANT);
    const insert = sqlite.prepare(
      "INSERT INTO notifications (event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES (?,?,'wallet_changed','base','/account#wallets',?,?)",
    );
    for (let i = 0; i < 101; i++)
      insert.run(
        `wallet-claim:history-${String(i).padStart(3, "0")}`,
        APPLICANT,
        T,
        T,
      );
    const first = await (
      await call(new Request(`${origin}/api/v1/notifications`))
    )?.json();
    expect(first.notifications).toHaveLength(100);
    expect(first.unread).toBe(103);
    expect(first.nextCursor).toBeString();
    insert.run(
      "wallet-claim:new-arrival",
      APPLICANT,
      "2026-10-19T12:00:00.000Z",
      T,
    );
    const second = await (
      await call(
        new Request(
          `${origin}/api/v1/notifications?${new URLSearchParams({ cursor: first.nextCursor })}`,
        ),
      )
    )?.json();
    expect(second.notifications).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(second.unread).toBe(104);
    const keys = [...first.notifications, ...second.notifications].map(
      (n: { eventKey: string }) => n.eventKey,
    );
    expect(new Set(keys).size).toBe(103);
    for (const page of [first, second]) {
      const response = await call(
        new Request(`${origin}/api/v1/notifications/read`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({
            eventKeys: page.notifications.map(
              (n: { eventKey: string }) => n.eventKey,
            ),
          }),
        }),
      );
      expect(response?.status).toBe(200);
    }
    const refreshed = await (
      await call(new Request(`${origin}/api/v1/notifications`))
    )?.json();
    expect(refreshed.unread).toBe(1);
    expect(refreshed.notifications[0].eventKey).toBe(
      "wallet-claim:new-arrival",
    );
    expect(
      (await call(new Request(`${origin}/api/v1/notifications?cursor=invalid`)))
        ?.status,
    ).toBe(400);
  });
  const read = (keys: unknown, headers: Record<string, string> = {}) =>
    new Request(`${origin}/api/v1/notifications/read`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", ...headers },
      body: JSON.stringify({ eventKeys: keys }),
    });

  test("lists only the signed-in recipient's rows, newest first", async () => {
    const { call } = setup(APPLICANT);
    const response = (await call(
      new Request(`${origin}/api/v1/notifications`),
    )) as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.unread).toBe(2);
    expect(
      body.notifications.map((n: { eventKey: string }) => n.eventKey),
    ).toEqual(["wallet-claim:b", "wallet-claim:a"]);
  });

  test("marks the recipient's own rows read once and refuses other writes", async () => {
    const { call, rows } = setup(APPLICANT);
    const first = (await call(
      read(["wallet-claim:a", "wallet-claim:c"]),
    )) as Response;
    expect(await first.json()).toEqual({ marked: 1 });
    const again = (await call(read(["wallet-claim:a"]))) as Response;
    expect(await again.json()).toEqual({ marked: 0 });
    expect(rows(APPLICANT)[0].read_at).toBe("2026-10-19T13:00:00.000Z");
    expect(rows(OTHER)[0].read_at).toBeNull();
    expect(
      (
        (await call(
          read(["wallet-claim:a"], { origin: "https://attacker.example" }),
        )) as Response
      ).status,
    ).toBe(403);
    expect(((await call(read([]))) as Response).status).toBe(400);
    expect(((await call(read(["x"]))) as Response).status).toBe(400);
  });

  test("each notice reports its own email outcome without delivery details", async () => {
    const { call, sqlite } = setup(APPLICANT);
    const insert = sqlite.prepare(
      "INSERT INTO notifications (event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES (?,?,'project_revision','alpha','/projects/alpha',?,?)",
    );
    const outbox = sqlite.prepare(
      "INSERT INTO activity_notification_outbox (event_key,recipient_github_id,essential,state,next_attempt_at,destination_digest,provider_reference,created_at,updated_at) VALUES (?,?,0,?,?,?,?,?,?)",
    );
    const states = [
      ["provider-accepted", "sent"],
      ["delivered", "delivered"],
      ["bounced", "failed"],
      ["exhausted", "failed"],
      ["ambiguous", "uncertain"],
      ["retrying", "queued"],
      ["suppressed", undefined],
    ] as const;
    states.forEach(([state], i) => {
      const key = `project-revision:alpha:${i}`;
      insert.run(key, APPLICANT, T, T);
      outbox.run(
        key,
        APPLICANT,
        state,
        T,
        "d".repeat(64),
        "private-provider-reference",
        T,
        T,
      );
    });
    insert.run("project-revision:alpha:no-mail", APPLICANT, T, T);
    const response = (await call(
      new Request(`${origin}/api/v1/notifications`),
    )) as Response;
    const text = await response.text();
    expect(text).not.toContain("d".repeat(64));
    expect(text).not.toContain("private-provider-reference");
    const body = JSON.parse(text) as {
      notifications: { eventKey: string; emailDelivery?: string }[];
    };
    const byKey = new Map(
      body.notifications.map((n) => [n.eventKey, n.emailDelivery]),
    );
    states.forEach(([, expected], i) => {
      expect(byKey.get(`project-revision:alpha:${i}`)).toBe(expected);
    });
    expect(byKey.has("project-revision:alpha:no-mail")).toBe(true);
    expect(byKey.get("project-revision:alpha:no-mail")).toBeUndefined();
    // The wallet notice queued its essential delivery with the source change.
    expect(byKey.get("wallet-claim:a")).toBe("queued");
    expect(parseNotificationsResponse(body).notifications).toHaveLength(
      body.notifications.length,
    );
    expect(() =>
      parseNotificationsResponse({
        ...body,
        notifications: [{ ...body.notifications[0], emailDelivery: "opened" }],
      }),
    ).toThrow();
  });

  test("a signed-out request gets 401 and other paths are not handled", async () => {
    const { call } = setup(null);
    expect(
      ((await call(new Request(`${origin}/api/v1/notifications`))) as Response)
        .status,
    ).toBe(401);
    expect(await call(new Request(`${origin}/api/v1/projects`))).toBeNull();
  });
});

// Owner decision D4 (PRD section 11): the scam account-review notice.
describe("slopbot scam review notices", () => {
  const AUTHOR = "900000006";
  const target = {
    owner: "example",
    repo: "alpha",
    itemKind: "pull_request" as const,
    number: 7,
  };
  function scam(category = "scam", moderatorReview = 1) {
    const { db, sqlite, rows } = open();
    sqlite
      .prepare(
        `INSERT INTO slopbot_penalties (item_node_id,repository_id,project_id,author_github_id,category,
          table_version,debit_thirds,period,moderator_review,review_key,recorded_at)
         VALUES ('PR_alpha',1,'alpha',?,?,'slopbot-penalties-v1',24,'2026-10',?,'review-1',?)`,
      )
      .run(AUTHOR, category, moderatorReview, T);
    const notify = (recipient: string) =>
      (db as unknown as D1Database).batch([
        notifySlopbotScamReview(db as unknown as D1Database, {
          ...target,
          itemNodeId: "PR_alpha",
          authorLogin: "scam-author",
          recipient,
          at: R,
        }),
      ]);
    const call = (
      actor: string,
      moderators: string[],
      path: string,
      init?: RequestInit,
    ) =>
      handleNotificationsApi(new Request(`https://slop.cash${path}`, init), {
        db: db as never,
        sessionActor: async () => ({ githubId: actor }),
        now: () => new Date(R),
        moderatorGithubIds: new Set(moderators),
      }) as Promise<Response>;
    return { db, sqlite, notify, call, rows };
  }

  test("one notice per moderator from the committed penalty, never to the author", async () => {
    const { notify, rows } = scam();
    await notify(MODERATOR);
    await notify(MODERATOR);
    await notify(AUTHOR);
    expect(rows(MODERATOR)).toEqual([
      {
        event_key: "slopbot-scam-review:PR_alpha",
        kind: "slopbot_scam_review",
        subject: "alpha",
        detail:
          "Review the account of @scam-author after a scam closure on example/alpha#7.",
        action_path: "/api/v1/notifications/scam-reviews/example/alpha/pull/7",
        source_at: T,
        read_at: null,
      },
    ]);
    expect(rows(AUTHOR)).toEqual([]);
  });

  test("a penalty without moderator review writes no notice", async () => {
    for (const [category, review] of [
      ["spam", 0],
      ["scam", 0],
    ] as const) {
      const { notify, rows } = scam(category, review);
      await notify(MODERATOR);
      expect(rows(MODERATOR)).toEqual([]);
    }
  });

  test("an invalid target or author is refused before any write", () => {
    const { db } = open();
    const input = {
      ...target,
      itemNodeId: "PR_alpha",
      authorLogin: "scam-author",
      recipient: MODERATOR,
      at: R,
    };
    for (const bad of [
      { owner: "../evil" },
      { owner: "." },
      { owner: ".." },
      { repo: "alpha/../../x" },
      { repo: "." },
      { repo: ".." },
      { number: 0 },
      { authorLogin: "a b" },
    ])
      expect(() =>
        notifySlopbotScamReview(db as unknown as D1Database, {
          ...input,
          ...bad,
        }),
      ).toThrow();
  });

  test("moderator access is rechecked on every list, open and read mark", async () => {
    const { db, sqlite, notify, call, rows } = scam();
    await notify(MODERATOR);
    sqlite
      .prepare(
        `INSERT INTO slopbot_appeals (appeal_key,repository_id,item_node_id,appellant_github_id,job_json,opened_at,due_at,escalated_at,escalation)
         VALUES ('appeal:PR_alpha:rev1',1,'PR_alpha',?,?,?,?,'2026-10-19T10:15:00.000Z','scam')`,
      )
      .run(AUTHOR, JSON.stringify(target), EARLY, T);
    await (db as unknown as D1Database).batch([
      notifySlopbotAppeal(
        db as unknown as D1Database,
        "appeal:PR_alpha:rev1",
        MODERATOR,
        R,
      ),
    ]);
    const path = "/api/v1/notifications/scam-reviews/example/alpha/pull/7";
    const appealPath = `/api/v1/notifications/appeals/${encodeURIComponent("appeal:PR_alpha:rev1")}`;
    const list = async (moderators: string[]) =>
      parseNotificationsResponse(
        await (
          await call(MODERATOR, moderators, "/api/v1/notifications")
        ).json(),
      );
    const markRead = (moderators: string[], eventKeys: string[]) =>
      call(MODERATOR, moderators, "/api/v1/notifications/read", {
        method: "POST",
        headers: {
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body: JSON.stringify({ eventKeys }),
      });
    expect((await list([MODERATOR])).notifications).toHaveLength(2);
    expect(await list([])).toMatchObject({ notifications: [], unread: 0 });
    // A former moderator cannot mark or probe moderator-only notices after role revocation.
    const revokedRead = await markRead(
      [],
      ["slopbot-scam-review:PR_alpha", "slopbot-appeal:PR_alpha:rev1"],
    );
    expect(await revokedRead.json()).toEqual({ marked: 0 });
    expect(rows(MODERATOR).map((row) => row.read_at)).toEqual([null, null]);
    const activeRead = await markRead(
      [MODERATOR],
      ["slopbot-scam-review:PR_alpha", "slopbot-appeal:PR_alpha:rev1"],
    );
    expect(await activeRead.json()).toEqual({ marked: 2 });
    expect(rows(MODERATOR).map((row) => row.read_at)).toEqual([R, R]);
    const opened = await call(MODERATOR, [MODERATOR], path);
    expect(opened.status).toBe(302);
    expect(opened.headers.get("location")).toBe(
      "https://github.com/example/alpha/pull/7",
    );
    expect((await call(MODERATOR, [], path)).status).toBe(403);
    expect((await call(MODERATOR, [], appealPath)).status).toBe(403);
    // Another moderator has no notice that stores this target.
    expect((await call(OTHER, [MODERATOR, OTHER], path)).status).toBe(404);
    for (const forged of [
      "/api/v1/notifications/scam-reviews/example/alpha/pull/8",
      "/api/v1/notifications/scam-reviews/example/alpha/tree/7",
      "/api/v1/notifications/scam-reviews/example/alpha/pull/7/extra",
    ])
      expect((await call(MODERATOR, [MODERATOR], forged)).status).toBe(404);
    for (const dotPath of [
      "/api/v1/notifications/scam-reviews/./alpha/pull/7",
      "/api/v1/notifications/scam-reviews/../alpha/pull/7",
      "/api/v1/notifications/scam-reviews/example/./pull/7",
      "/api/v1/notifications/scam-reviews/example/../pull/7",
    ])
      expect(scamReviewGitHubUrl(dotPath)).toBeNull();
  });

  test("self-authored or non-scam moderator notices cannot be listed, marked read or opened", async () => {
    const { sqlite, call, rows } = scam();
    const selfScamPath =
      "/api/v1/notifications/scam-reviews/example/alpha/pull/9";
    const nonScamPath =
      "/api/v1/notifications/scam-reviews/example/alpha/pull/10";
    const selfAppealKey = "appeal:PR_self:rev1";
    const badAppealKey = "appeal:PR_bad:rev1";
    sqlite
      .prepare(
        `INSERT INTO slopbot_penalties (item_node_id,repository_id,project_id,author_github_id,category,
          table_version,debit_thirds,period,moderator_review,review_key,recorded_at)
         VALUES ('PR_self',1,'alpha',?,'scam','slopbot-penalties-v1',24,'2026-10',1,'review-self',?),
                ('PR_spam',1,'alpha',?,'spam','slopbot-penalties-v1',12,'2026-10',0,'review-spam',?)`,
      )
      .run(MODERATOR, T, AUTHOR, T);
    sqlite
      .prepare(
        `INSERT INTO slopbot_appeals (appeal_key,repository_id,item_node_id,appellant_github_id,job_json,opened_at,due_at,escalated_at,escalation)
         VALUES (?,1,'PR_self',?,?,?,?,'2026-10-19T10:15:00.000Z','scam'),
                (?,1,'PR_alpha',?,?,?,?,'2026-10-19T10:15:00.000Z','scam')`,
      )
      .run(
        selfAppealKey,
        MODERATOR,
        JSON.stringify({ ...target, number: 9 }),
        EARLY,
        T,
        badAppealKey,
        AUTHOR,
        JSON.stringify({ ...target, repo: ".." }),
        EARLY,
        T,
      );
    const insertNotice = sqlite.prepare(
      "INSERT INTO notifications (event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES (?,?,?,?,?,?,?)",
    );
    insertNotice.run(
      "slopbot-scam-review:PR_self",
      MODERATOR,
      "slopbot_scam_review",
      "alpha",
      selfScamPath,
      T,
      R,
    );
    insertNotice.run(
      "slopbot-scam-review:PR_spam",
      MODERATOR,
      "slopbot_scam_review",
      "alpha",
      nonScamPath,
      T,
      R,
    );
    insertNotice.run(
      `slopbot-${selfAppealKey}`,
      MODERATOR,
      "slopbot_appeal_review",
      "PR_self",
      `/api/v1/notifications/appeals/${encodeURIComponent(selfAppealKey)}`,
      T,
      R,
    );
    insertNotice.run(
      `slopbot-${badAppealKey}`,
      MODERATOR,
      "slopbot_appeal_review",
      "PR_alpha",
      `/api/v1/notifications/appeals/${encodeURIComponent(badAppealKey)}`,
      T,
      R,
    );

    const listed = parseNotificationsResponse(
      await (
        await call(MODERATOR, [MODERATOR], "/api/v1/notifications")
      ).json(),
    );
    expect(listed.notifications.map((n) => n.eventKey)).toEqual([
      `slopbot-${badAppealKey}`,
    ]);
    expect(listed.unread).toBe(1);

    const marked = await call(
      MODERATOR,
      [MODERATOR],
      "/api/v1/notifications/read",
      {
        method: "POST",
        headers: {
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          eventKeys: [
            "slopbot-scam-review:PR_self",
            "slopbot-scam-review:PR_spam",
            `slopbot-${selfAppealKey}`,
          ],
        }),
      },
    );
    expect(await marked.json()).toEqual({ marked: 0 });
    expect(rows(MODERATOR).every((row) => row.read_at === null)).toBe(true);

    expect((await call(MODERATOR, [MODERATOR], selfScamPath)).status).toBe(404);
    expect((await call(MODERATOR, [MODERATOR], nonScamPath)).status).toBe(404);
    expect(
      (
        await call(
          MODERATOR,
          [MODERATOR],
          `/api/v1/notifications/appeals/${encodeURIComponent(selfAppealKey)}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          MODERATOR,
          [MODERATOR],
          `/api/v1/notifications/appeals/${encodeURIComponent(badAppealKey)}`,
        )
      ).status,
    ).toBe(500);
  });
});
