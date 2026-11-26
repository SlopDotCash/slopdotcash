import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { D1, d1, sql } from "@repo/platform/d1";
import { rolesFrom } from "@repo/platform/roles";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { outcome } from "@repo/platform/testing/area";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/backend__access.conformance.ts";
import type { Access, Event } from "../../gen/backend__access.ts";
import { AccessJournal, type AccountRecord } from "@repo/ports/security";
import { admitted, eventOf, loadAccess, send } from "../../src/access/store.vibe";

const mf = startWorker({ d1: { SLOP_DB: "access-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);

const journalColumns = sql`e.rowid AS row, e.id, e.project_id, e.sequence, e.action, e.state_after, e.appeal_after, e.reason, e.evidence_reference, e.repository_github_id, e.repository_keys, e.actor_github_id, e.actor_github_login, e.system_issuer, e.actor_role, e.decision_source, e.before_revision, e.before_manifest_sha256, e.after_revision, e.after_manifest_sha256, e.result, e.created_at, r.assessment_id AS review_assessment_id, r.malicious_assessment_ids AS review_malicious_assessment_ids`;

const repositoryOf = sql`COALESCE((SELECT latest.repository_github_id FROM project_enforcements latest WHERE latest.project_id = p.id ORDER BY latest.sequence DESC LIMIT 1), CAST(json_extract(p.manifest, '$.authority.repositoryId') AS TEXT))`;
const keysOf = sql`COALESCE((SELECT latest.repository_keys FROM project_enforcements latest WHERE latest.project_id = p.id ORDER BY latest.sequence DESC LIMIT 1), json_array(json_extract(p.manifest, '$.repositories[0].id')))`;
const nextSequenceOf = sql`(SELECT COALESCE(MAX(sequence), 0) + 1 FROM project_enforcements WHERE project_id = p.id)`;

interface Written {
  readonly id: string;
  readonly projectId: string;
  readonly action: string;
  readonly stateAfter: string;
  readonly appealAfter: string;
  readonly actor: { readonly githubId: string; readonly login: string } | null;
  readonly role: string;
  readonly source: string;
  readonly issuer: string | null;
  readonly at: string;
}

const written = (record: Written) => sql`INSERT INTO project_enforcements (id, project_id, sequence, action, state_after, appeal_after, reason, evidence_reference, repository_github_id, repository_keys, actor_github_id, actor_github_login, system_issuer, actor_role, decision_source, before_revision, before_manifest_sha256, after_revision, after_manifest_sha256, result, created_at)
  SELECT ${record.id}, p.id, ${nextSequenceOf}, ${record.action}, ${record.stateAfter}, ${record.appealAfter}, 'Driven by the access conformance driver', 'driver', ${repositoryOf}, ${keysOf}, ${record.actor?.githubId ?? null}, ${record.actor?.login ?? null}, ${record.issuer}, ${record.role}, ${record.source}, p.revision, p.manifest_sha256, NULL, NULL, 'no_revision_needed', ${record.at} FROM projects p WHERE p.id = ${record.projectId}`;

const journalOverD1 = Layer.succeed(AccessJournal, {
  rows: () => Effect.succeed(sql`SELECT ${journalColumns} FROM project_enforcements e LEFT JOIN project_vetting_reinstatements r ON r.enforcement_id = e.id ORDER BY e.rowid`),
  version: () => Effect.succeed(sql`(SELECT COALESCE(MAX(rowid), 0) FROM project_enforcements)`),
  recordAt: (projectId: string, sequence: number) => Effect.succeed(sql`SELECT id FROM project_enforcements WHERE project_id = ${projectId} AND sequence = ${sequence}`),
  append: (record: AccountRecord) => Effect.succeed([
    written({ id: record.id, projectId: record.projectId, action: record.action, stateAfter: record.stateAfter, appealAfter: record.appealAfter, actor: record.actor, role: record.role, source: record.role === "banned-account" ? "account-request" : "admin-panel", issuer: null, at: record.at }),
  ]),
});

const moderators = new Set([18633264, 202660855]);
const moderatorIds = [...moderators].join(",");
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(await database(mf, "SLOP_DB")), webCrypto, journalOverD1, Layer.orDie(rolesFrom({ ADMIN_GITHUB_IDS: moderatorIds, PROJECT_MODERATOR_GITHUB_IDS: moderatorIds }))));
let generation = 0;
const projects = new Map<number, { id: string; row: number }>();
const decisions = new Map<number, number>();

const actorOf = (model: number) => (model <= 0 || moderators.has(model) ? model : 900_000_000 + generation * 100 + model);
const modelActorOf = (real: number) => (real <= 0 || moderators.has(real) ? real : real - 900_000_000 - generation * 100);

const exec = (statement: ReturnType<typeof sql>) => runtime.runPromise(Effect.gen(function* () {
  const db = yield* D1;
  return yield* db.all(statement);
}));

async function projectOf(model: number): Promise<number> {
  if (model <= 0) return model;
  const known = projects.get(model);
  if (known !== undefined) return known.row;
  const id = `access-g${generation}-p${model}`;
  const manifest = JSON.stringify({ id, status: "paused", listingTier: "community", authority: { repositoryId: String(4_000_000 + generation * 100 + model) }, repositories: [{ id: `driver/${id}` }] });
  const digest = "0".repeat(63) + String(model % 10);
  const at = new Date(0).toISOString();
  await exec(sql`INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, actor_github_id, actor_github_login, created_at) VALUES (${id}, 1, ${manifest}, ${digest}, 'Created by the access driver', NULL, NULL, ${at})`);
  await exec(sql`INSERT INTO projects (id, status, revision, manifest, manifest_sha256, created_at, updated_at) VALUES (${id}, 'paused', 1, ${manifest}, ${digest}, ${at}, ${at})`);
  const [found] = await exec(sql`SELECT rowid AS row FROM projects WHERE id = ${id}`);
  const row = Number(found?.row);
  projects.set(model, { id, row });
  return row;
}

async function nextDecision(): Promise<number> {
  return (await runtime.runPromise(loadAccess())).nextDecision;
}

async function decisionOf(model: number): Promise<number> {
  if (model <= 0) return model;
  const known = decisions.get(model);
  if (known !== undefined) return known;
  return nextDecision();
}

function modelAppealIds(state: Access): Map<number, number> {
  const rows = new Set([...projects.values()].map((project) => project.row));
  const ours = state.appeals.filter((appeal) => rows.has(appeal.project));
  return new Map(ours.map((appeal, index) => [index + 1, appeal.id]));
}

const decisionTypes = ["recordVettingBan", "decideProjectBan", "reinstateProject", "reinstateAccounts", "denyAppeal"] as const;

async function translated(event: Event): Promise<Event> {
  switch (event.type) {
    case "recordVettingBan":
    case "reinstateProject":
      return { ...event, project: await projectOf(event.project), decision: await decisionOf(event.decision) };
    case "decideProjectBan":
      return { ...event, project: await projectOf(event.project), decision: await decisionOf(event.decision), accounts: event.accounts.map(actorOf) };
    case "reserveAward":
    case "payAward":
      throw new Error(`${event.type} needs settlement's reserved obligations, which no port exposes to the backend`);
    case "appeal":
      return { ...event, project: await projectOf(event.project) };
    case "reinstateAccounts":
      return { ...event, decision: await decisionOf(event.decision), project: await projectOf(event.project), targets: event.targets.map(actorOf) };
    case "denyAppeal":
      return { ...event, project: await projectOf(event.project), decision: await decisionOf(event.decision) };
  }
}

function remember(model: Event, real: Event) {
  if (!("decision" in model) || !("decision" in real) || model.decision <= 0) return;
  if ((decisionTypes as ReadonlyArray<string>).includes(model.type)) decisions.set(model.decision, real.decision);
}

const context = (by: number) => ({
  actor: { githubId: String(by), login: `member-${by}` },
  reason: "Driven by the access conformance driver",
  evidenceReference: "driver",
  moderators: [...moderators].map(String),
});

const vettingIssuer = JSON.stringify({ kind: "vetting-service", keySha256: "c".repeat(64), assessmentId: "driver-assessment", policyVersion: "1", rule: "confirmed-malicious" });

type Recorded = Extract<Event, { type: "recordVettingBan" | "decideProjectBan" | "reinstateProject" }>;

function projectIdOf(row: number): string {
  return [...projects.values()].find((project) => project.row === row)?.id ?? "";
}

function recordOf(event: Recorded, by: number): Written {
  const projectId = projectIdOf(event.project);
  const at = new Date(0).toISOString();
  const id = `enf_driver${event.decision}`;
  if (event.type === "recordVettingBan") return { id, projectId, action: "ban", stateAfter: "banned", appealAfter: "none", actor: null, role: "vetting-service", source: "standing-rule", issuer: vettingIssuer, at };
  const actor = { githubId: String(by), login: `member-${by}` };
  if (event.type === "decideProjectBan") return { id, projectId, action: "ban", stateAfter: "banned", appealAfter: "none", actor, role: "project-moderator", source: "admin-panel", issuer: null, at };
  return { id, projectId, action: "reinstate", stateAfter: "clear", appealAfter: "granted", actor, role: "project-moderator", source: "admin-panel", issuer: null, at };
}

function decided(real: Event, sender: number) {
  if (real.type !== "recordVettingBan" && real.type !== "decideProjectBan" && real.type !== "reinstateProject") return send(real, sender, context(sender));
  return Effect.gen(function* () {
    yield* admitted(real, sender);
    const db = yield* D1;
    const record = recordOf(real, sender);
    const bans = real.type === "decideProjectBan" ? [...new Set(real.accounts)].map((target) => sql`INSERT INTO project_maintainer_bans (enforcement_id, github_id, github_login) VALUES (${record.id}, ${String(target)}, ${`account-${modelActorOf(target)}`})`) : [];
    yield* db.batch([written(record), ...bans]);
  });
}

async function dispatched(event: Event, by: number) {
  const real = await translated(event);
  const sender = actorOf(by);
  const result = await outcome(decided(real, sender), runtime);
  if (result === "accepted") remember(event, real);
  return result;
}

async function observed(): Promise<Access> {
  const { state } = await runtime.runPromise(loadAccess());
  const byRow = new Map([...projects].map(([model, project]) => [project.row, model]));
  const back = new Map([...decisions].map(([model, real]) => [real, model]));
  const ours = (project: number) => byRow.has(project);
  const decision = (real: number) => back.get(real) ?? real;
  const appealIds = new Map([...modelAppealIds(state)].map(([model, real]) => [real, model]));
  const bans = state.bans.filter((ban) => ours(ban.project));
  const releases = state.releases.filter((release) => bans.some((ban) => ban.enforcement === release.enforcement));
  return {
    moderators: state.moderators,
    enforcements: state.enforcements.filter((entry) => ours(entry.project)).map((entry) => ({ ...entry, id: decision(entry.id), project: byRow.get(entry.project) ?? 0, decidedBy: modelActorOf(entry.decidedBy) })),
    bans: bans.map((ban) => ({ enforcement: decision(ban.enforcement), project: byRow.get(ban.project) ?? 0, target: modelActorOf(ban.target), decidedBy: modelActorOf(ban.decidedBy) })),
    releases: releases.map((release) => ({ decision: decision(release.decision), enforcement: decision(release.enforcement), target: modelActorOf(release.target), decidedBy: modelActorOf(release.decidedBy) })),
    appeals: state.appeals.filter((appeal) => appealIds.has(appeal.id)).map((appeal) => ({ ...appeal, id: appealIds.get(appeal.id) ?? 0, project: byRow.get(appeal.project) ?? 0, target: modelActorOf(appeal.target), decidedBy: modelActorOf(appeal.decidedBy) })),
    awards: [],
    decisions: state.decisions.filter((real) => back.has(real) || state.enforcements.some((entry) => entry.id === real && ours(entry.project))).map(decision),
    lastAppeal: appealIds.size,
  };
}

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation++;
    projects.clear();
    decisions.clear();
  },
  dispatch: (_key, event: Event, by) => dispatched(event, Number(by)),
  receive: async (_key, raw, by) => {
    const parsed = await runtime.runPromiseExit(eventOf(raw));
    if (parsed._tag === "Failure") return "refused";
    return dispatched(parsed.value, Number(by));
  },
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["access"], walks: 4, steps: 10 };
