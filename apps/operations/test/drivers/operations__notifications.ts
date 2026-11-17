import { Cause, Effect, Exit, Layer, ManagedRuntime, Schema } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { settableClock } from "@repo/platform/testing/clock";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/operations__notifications.conformance.ts";
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
const versionText = (version: number) => version > 0 ? `version-g${world.generation}-v${version}` : "";
const versionOf = (text: string) => text === "" ? 0 : Number(text.slice(`version-g${world.generation}-v`.length));
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
  const error = Cause.squash(exit.cause) as { readonly _tag?: unknown };
  if (error._tag === "Rejected") return { outcome: "refused" };
  throw error;
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

export const driver: Driver<Seen> & AsyncDisposable = {
  reset: () => {
    world = { generation: world.generation + 1, config: noConfig, keys: new Map() };
    clock.set(base() + 1);
  },
  dispatch: async (_key, event: Event, by) => {
    const change = changeOf(event);
    if (change === undefined) return "refused";
    const result = await settled(send(scope(), change, githubId(Number(by)), releaseOf(world.config)));
    return followed(event as unknown as Record<string, unknown>, result);
  },
  receive: async (_key, raw, by) => {
    const copy = fieldsOnce(raw);
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
