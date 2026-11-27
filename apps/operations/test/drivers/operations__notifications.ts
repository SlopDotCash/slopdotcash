import { Cause, type Effect, Exit, Layer, ManagedRuntime, Schema } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/operations__notifications.conformance.ts";
import type { Enrollment } from "../../gen/backend__email.ts";
import type { Event, Inbox, Kind, NotifyConfig } from "../../gen/operations__notifications.ts";
import type { Projection, Release } from "../../src/notifications/rows.vibe";
import { Change, digestText, observe, recipientScope, send } from "../../src/notifications/store.vibe";

const mf = startWorker({ d1: { SLOP_DB: "notices-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");

const caseId = "sc_notice_conformance";
const seededAt = "2026-11-16T00:00:00.000Z";
const manifest = JSON.stringify({ id: "notice-conformance", status: "paused" });
await db.batch([
  db.prepare("INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at) VALUES ('notice-conformance', 1, ?, ?, 'Listed', ?)")
    .bind(manifest, "a".repeat(64), seededAt),
  db.prepare("INSERT INTO projects (id, status, revision, manifest, manifest_sha256, created_at, updated_at) VALUES ('notice-conformance', 'paused', 1, ?, ?, ?, ?)")
    .bind(manifest, "a".repeat(64), seededAt, seededAt),
  db.prepare(`INSERT INTO security_cases (id, project_id, advisory_repository, advisory_ghsa, reporter_github_id, reporter_github_login, submission_state,
      receipt_state, remediation_state, award_state, payment_state, disclosure_state, recognition, appeal_state, revision, created_at, updated_at)
    VALUES (?, 'notice-conformance', 'example/notices', 'GHSA-aaaa-bbbb-cccc', '7', 'reporter', 'claimed',
      'received', 'not-started', 'not-applicable', 'not-applicable', 'embargoed', 'private', 'none', 1, ?, ?)`)
    .bind(caseId, seededAt, seededAt),
]);

const epoch = Date.UTC(2030, 0, 1);
const span = 1_000_000_000;
const clock = settableClock(epoch + 1);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(db), webCrypto, clock.layer));
const securityKinds: ReadonlySet<Kind> = new Set<Kind>(["SecurityCase", "SecurityReportReceived"]);
const noConfig: NotifyConfig = { routes: [], generalEmail: false };
const accountService = -8;

interface World {
  readonly generation: number;
  config: NotifyConfig;
  readonly keys: Map<string, number>;
}

let world: World = { generation: 0, config: noConfig, keys: new Map() };

const base = () => epoch + world.generation * span;
const iso = (millis: number) => new Date(millis).toISOString();
const time = (millis: number) => millis === 0 ? 0 : millis - base();
const githubId = (actor: number) => actor > 0 ? String(7_000_000_000 + world.generation * 100 + actor) : "";
const actorOf = (id: string) => id === "" ? 0 : Number(id) - 7_000_000_000 - world.generation * 100;
const keyText = (key: number) => {
  const text = `notice-g${world.generation}-k${key}`;
  world.keys.set(text, key);
  return text;
};
const versionPrefix = () => `v${String(world.generation).padStart(8, "0")}-`;
const versionText = (version: number) => version > 0 ? `${versionPrefix()}${String(version).padStart(64 - versionPrefix().length, "0")}` : "";
const versionOf = (text: string) => text === "" ? 0 : Number(text.slice(versionPrefix().length));
const pilotText = (pilot: number) => `pilot-g${world.generation}-p${pilot}`;
const pilotOf = (text: string | undefined) => text === undefined ? 0 : Number(text.slice(`pilot-g${world.generation}-p`.length));
const referenceText = (reference: number) => reference > 0 ? `evidence-g${world.generation}-r${reference}` : "";
const referenceOf = (text: string) => Number(text.slice(`evidence-g${world.generation}-r`.length));
const digestOf = (text: string) => text === "" ? 0 : text.startsWith(`pilot-g${world.generation}-p`) ? 1000 + pilotOf(text) : versionOf(text);
const digestFor = (digest: number) => digest > 1000 ? pilotText(digest - 1000) : versionText(digest);
const scope = () => recipientScope([githubId(1), githubId(2), githubId(3)]);

const releaseOf = (config: NotifyConfig): Release => ({
  routes: config.routes.map((route) => ({
    recipientGithubId: githubId(route.recipient),
    ...route.backup > 0 ? { backupGithubId: githubId(route.backup) } : {},
    ...route.pilotDigest > 0 ? { pilot: { digest: pilotText(route.pilotDigest), effectiveAt: iso(base() + route.pilotEffectiveAt) } } : {},
  })),
  generalEmail: config.generalEmail,
});

const changeOf = (event: Event): Change | undefined => {
  switch (event.type) {
    case "publishConfig":
      return { type: "publishConfig", release: releaseOf(event.config) };
    case "save":
      if (event.kind === "TraceLicensingAvailable") return undefined;
      return {
        type: "save",
        notice: {
          eventKey: keyText(event.key),
          recipientGithubId: githubId(event.recipient),
          kind: event.kind,
          subject: securityKinds.has(event.kind) ? caseId : "Notice",
          actionPath: "/inbox",
          sourceAt: iso(clock.now()),
        },
      };
    case "observeEnrollment":
    case "closeAccount":
      return undefined;
    case "reconcile":
      return {
        type: "reconcile",
        id: event.id,
        evidence: {
          reference: referenceText(event.providerEvidence.reference),
          attempt: event.providerEvidence.attempt,
          digest: digestFor(event.providerEvidence.digest),
          finding: event.providerEvidence.finding,
        },
      };
    default:
      return event;
  }
};

const isInt = (value: unknown): value is number => Number.isSafeInteger(value);
const isConfig = (value: unknown): value is NotifyConfig => {
  const config = value as { routes?: unknown; generalEmail?: unknown } | null;
  return typeof config === "object" && config !== null && typeof config.generalEmail === "boolean" && Array.isArray(config.routes)
    && config.routes.every((route: { recipient?: unknown; backup?: unknown; pilotDigest?: unknown; pilotEffectiveAt?: unknown } | null) =>
      typeof route === "object" && route !== null && isInt(route.recipient) && isInt(route.backup) && isInt(route.pilotDigest) && isInt(route.pilotEffectiveAt));
};

const rawChangeOf = (raw: Record<string, unknown>): Record<string, unknown> => {
  const { key, recipient, kind, config, providerEvidence, ...rest } = raw;
  switch (raw.type) {
    case "save":
      return {
        ...rest,
        notice: {
          ...isInt(key) ? { eventKey: keyText(key) } : { eventKey: key },
          ...isInt(recipient) ? { recipientGithubId: githubId(recipient) } : { recipientGithubId: recipient },
          kind,
          subject: securityKinds.has(kind as Kind) ? caseId : "Notice",
          actionPath: "/inbox",
          sourceAt: iso(clock.now()),
        },
      };
    case "publishConfig":
      return { ...rest, release: isConfig(config) ? releaseOf(config) : config };
    case "reconcile": {
      const evidence = providerEvidence as { reference?: unknown; attempt?: unknown; digest?: unknown; finding?: unknown } | null;
      return typeof evidence === "object" && evidence !== null && isInt(evidence.reference) && isInt(evidence.digest)
        ? { ...rest, evidence: { reference: referenceText(evidence.reference), attempt: evidence.attempt, digest: digestFor(evidence.digest), finding: evidence.finding } }
        : { ...rest, evidence: providerEvidence };
    }
    default:
      return raw;
  }
};

type Seen = Omit<Inbox, "enrollments" | "configs">;

type Settled = { readonly outcome: "accepted"; readonly value: Projection } | { readonly outcome: "refused" };

const settled = async (sent: Effect.Effect<Projection, unknown, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>): Promise<Settled> => {
  const exit = await runtime.runPromiseExit(sent);
  if (Exit.isSuccess(exit)) return { outcome: "accepted", value: exit.value };
  const error = Cause.squash(exit.cause);
  if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "Rejected") return { outcome: "refused" };
  throw error instanceof Error ? error : new Error(String(error));
};

const followed = (copy: Record<string, unknown>, result: Settled) => {
  if (result.outcome === "refused") return result.outcome;
  if (copy.type === "publishConfig" && isConfig(copy.config)) world.config = copy.config;
  if (copy.type === "advanceClock" && isInt(copy.elapsed)) clock.advance(copy.elapsed);
  return result.outcome;
};

const fieldsOnce = (raw: unknown): Record<string, unknown> | undefined => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const event = raw as Record<string, unknown>;
  return Object.fromEntries(Object.keys(event).map((field) => [field, event[field]]));
};

const modelOf = (projection: Projection): Seen => {
  const { inbox } = projection;
  const recipient = (actor: number) => actorOf(projection.recipients[actor - 1] ?? "");
  const version = (number: number) => versionOf(projection.versions[number - 1] ?? "");
  return {
    clock: time(inbox.clock),
    notices: inbox.notices.map((notice) => ({
      ...notice,
      key: notice.escalationOf > 0 ? 1000 + notice.escalationOf : world.keys.get(projection.keys[notice.key - 1] ?? "") ?? 0,
      recipient: recipient(notice.recipient),
      createdAt: time(notice.createdAt),
      readAt: time(notice.readAt),
      acknowledgedAt: time(notice.acknowledgedAt),
      nextAt: time(notice.nextAt),
      claimedAt: time(notice.claimedAt),
      boundVersion: version(notice.boundVersion),
      digest: digestOf(digestText(projection, notice.digest)),
    })),
    evidence: projection.references.map(referenceOf).sort((left, right) => left - right),
    config: {
      routes: inbox.config.routes.map((route) => ({
        recipient: recipient(route.recipient),
        backup: route.backup === 0 ? 0 : recipient(route.backup),
        pilotDigest: route.pilotDigest === 0 ? 0 : pilotOf(projection.pilots[route.pilotDigest - 1]),
        pilotEffectiveAt: route.pilotDigest === 0 ? 0 : time(route.pilotEffectiveAt),
      })),
      generalEmail: inbox.config.generalEmail,
    },
  };
};

const view = (state: Inbox): Seen => {
  const { enrollments: _enrolled, configs: _released, ...seen } = state;
  return { ...seen, evidence: [...state.evidence].sort((left, right) => left - right) };
};

const SafeInt = Schema.Int.check(Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }));

const EnrollmentSchema = Schema.Struct({
  actor: SafeInt,
  verifications: Schema.Array(Schema.Struct({
    id: SafeInt,
    requestKey: SafeInt,
    address: Schema.String,
    addressKey: Schema.String,
    tokenDigest: SafeInt,
    activity: Schema.Boolean,
    security: Schema.Boolean,
    delivery: Schema.Literals(["Queued", "Sending", "Sent", "DeliveryUnknown"]),
    createdAt: SafeInt,
    expiresAt: SafeInt,
    cancelled: Schema.Boolean,
    consumed: Schema.Boolean,
    version: SafeInt,
  })),
  destination: Schema.Struct({
    address: Schema.String,
    version: SafeInt,
    verifiedAt: SafeInt,
  }),
  preference: Schema.Struct({
    stored: Schema.Boolean,
    activity: Schema.Boolean,
    security: Schema.Boolean,
    version: SafeInt,
    revision: SafeInt,
  }),
  unsubscribeTokens: Schema.Array(Schema.Struct({
    token: SafeInt,
    version: SafeInt,
  })),
  pilotVersion: SafeInt,
});

const decodeEnrollment = Schema.decodeUnknownExit(EnrollmentSchema);

const applyEnrollment = async (enrollment: Enrollment, by: number, closing: boolean): Promise<"accepted" | "refused"> => {
  if (by !== accountService || enrollment.actor <= 0) return "refused";
  if (closing && (enrollment.preference.activity || enrollment.preference.security)) return "refused";
  const recipient = githubId(enrollment.actor);
  if (!closing) {
    const priorPref = (await db.prepare("SELECT revision FROM notification_email_preferences WHERE github_id = ?").bind(recipient).all()).results[0];
    const priorDest = (await db.prepare("SELECT destination_version FROM notification_email_destinations WHERE github_id = ?").bind(recipient).all()).results[0];
    const priorRevision = typeof priorPref?.revision === "number" ? priorPref.revision : 0;
    const priorVersion = typeof priorDest?.destination_version === "string" ? versionOf(priorDest.destination_version) : 0;
    if (enrollment.preference.revision < priorRevision || enrollment.destination.version < priorVersion) return "refused";
  }
  const at = iso(clock.now());
  const destVersion = versionText(enrollment.destination.version);
  const prefVersion = versionText(enrollment.preference.version);
  const statements = [];
  if (enrollment.destination.version > 0) {
    statements.push(
      db.prepare(`INSERT INTO notification_email_destinations (github_id, email, destination_version, verified_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (github_id) DO UPDATE SET email = excluded.email, destination_version = excluded.destination_version, verified_at = excluded.verified_at`)
        .bind(recipient, enrollment.destination.address || "member@slop.test", destVersion, iso(base() + enrollment.destination.verifiedAt)),
    );
  } else {
    statements.push(db.prepare("DELETE FROM notification_email_destinations WHERE github_id = ?").bind(recipient));
  }
  if (closing || enrollment.preference.stored) {
    const enabled = !closing && enrollment.preference.activity ? 1 : 0;
    const securityEnabled = !closing && enrollment.preference.security ? 1 : 0;
    const storedVersion = closing ? (prefVersion === "" ? "" : prefVersion) : (prefVersion === "" ? null : prefVersion);
    statements.push(
      db.prepare(`INSERT INTO notification_email_preferences (github_id, enabled, security_enabled, destination_version, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (github_id) DO UPDATE SET enabled = excluded.enabled, security_enabled = excluded.security_enabled, destination_version = excluded.destination_version, updated_at = excluded.updated_at`)
        .bind(recipient, enabled, securityEnabled, storedVersion, at, enrollment.preference.revision),
      db.prepare("UPDATE notification_email_preferences SET revision = ? WHERE github_id = ?")
        .bind(enrollment.preference.revision, recipient),
    );
  } else {
    statements.push(db.prepare("DELETE FROM notification_email_preferences WHERE github_id = ?").bind(recipient));
  }
  if (closing) {
    statements.push(
      db.prepare("UPDATE security_notification_outbox SET state = 'suppressed', updated_at = ? WHERE recipient_github_id = ? AND state IN ('queued', 'retrying')").bind(at, recipient),
      db.prepare("UPDATE activity_notification_outbox SET state = 'suppressed', updated_at = ? WHERE recipient_github_id = ? AND state IN ('queued', 'retrying')").bind(at, recipient),
    );
  } else {
    const secConsented = enrollment.preference.version > 0 && enrollment.preference.version === enrollment.destination.version && enrollment.preference.security;
    const actConsented = enrollment.preference.version > 0 && enrollment.preference.version === enrollment.destination.version && enrollment.preference.activity;
    if (enrollment.preference.stored && !enrollment.preference.security) {
      statements.push(
        db.prepare("UPDATE security_notification_outbox SET state = 'suppressed', updated_at = ? WHERE recipient_github_id = ? AND state IN ('queued', 'retrying')").bind(at, recipient),
        db.prepare("UPDATE activity_notification_outbox SET state = 'suppressed', updated_at = ? WHERE recipient_github_id = ? AND essential = 1 AND state IN ('queued', 'retrying')").bind(at, recipient),
      );
    } else if (!secConsented) {
      statements.push(
        db.prepare("UPDATE security_notification_outbox SET state = 'suppressed', updated_at = ? WHERE recipient_github_id = ? AND state IN ('queued', 'retrying') AND destination_version IS NOT NULL AND destination_version <> ''").bind(at, recipient),
        db.prepare("UPDATE activity_notification_outbox SET state = 'suppressed', updated_at = ? WHERE recipient_github_id = ? AND essential = 1 AND state IN ('queued', 'retrying') AND destination_version IS NOT NULL AND destination_version <> ''").bind(at, recipient),
      );
    } else {
      statements.push(
        db.prepare("UPDATE security_notification_outbox SET state = 'suppressed', updated_at = ? WHERE recipient_github_id = ? AND state IN ('queued', 'retrying') AND destination_version IS NOT NULL AND destination_version <> '' AND destination_version <> ?").bind(at, recipient, destVersion),
        db.prepare("UPDATE activity_notification_outbox SET state = 'suppressed', updated_at = ? WHERE recipient_github_id = ? AND essential = 1 AND state IN ('queued', 'retrying') AND destination_version IS NOT NULL AND destination_version <> '' AND destination_version <> ?").bind(at, recipient, destVersion),
      );
    }
    if (enrollment.preference.stored && !enrollment.preference.activity) {
      statements.push(
        db.prepare("UPDATE activity_notification_outbox SET state = 'suppressed', updated_at = ? WHERE recipient_github_id = ? AND essential = 0 AND state IN ('queued', 'retrying')").bind(at, recipient),
      );
    } else if (!actConsented) {
      statements.push(
        db.prepare("UPDATE activity_notification_outbox SET state = 'suppressed', updated_at = ? WHERE recipient_github_id = ? AND essential = 0 AND state IN ('queued', 'retrying') AND destination_version IS NOT NULL AND destination_version <> ''").bind(at, recipient),
      );
    } else {
      statements.push(
        db.prepare("UPDATE activity_notification_outbox SET state = 'suppressed', updated_at = ? WHERE recipient_github_id = ? AND essential = 0 AND state IN ('queued', 'retrying') AND destination_version IS NOT NULL AND destination_version <> '' AND destination_version <> ?").bind(at, recipient, destVersion),
      );
    }
  }
  await db.batch(statements);
  return "accepted";
};

export const driver: Driver<Seen> & AsyncDisposable = {
  reset: () => {
    world = { generation: world.generation + 1, config: noConfig, keys: new Map() };
    clock.set(base() + 1);
  },
  dispatch: async (_key, event: Event, by) => {
    if (event.type === "observeEnrollment") return applyEnrollment(event.enrollment, Number(by), false);
    if (event.type === "closeAccount") return applyEnrollment(event.enrollment, Number(by), true);
    const change = changeOf(event);
    if (change === undefined) return "refused";
    const result = await settled(send(scope(), change, githubId(Number(by)), releaseOf(world.config)));
    return followed({ ...event }, result);
  },
  receive: async (_key, raw, by) => {
    const copy = fieldsOnce(raw);
    if (copy?.type === "observeEnrollment" || copy?.type === "closeAccount") {
      const decoded = decodeEnrollment(copy.enrollment);
      if (Exit.isFailure(decoded)) return "refused";
      return applyEnrollment(decoded.value as Enrollment, Number(by), copy.type === "closeAccount");
    }
    const decoded = Schema.decodeUnknownExit(Change)(copy === undefined ? raw : rawChangeOf(copy));
    if (Exit.isFailure(decoded)) return "refused";
    const result = await settled(send(scope(), decoded.value, githubId(Number(by)), releaseOf(world.config)));
    return copy === undefined ? result.outcome : followed(copy, result);
  },
  observe: async () => modelOf(await runtime.runPromise(observe(scope(), releaseOf(world.config)))),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Seen> = { keys: ["inbox"], view, walks: 4, steps: 16 };
