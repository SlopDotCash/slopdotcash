// spec/security/reportingReadiness.md, "A refresh writes only a newer attempt and keeps the repository identity"
import { ManagedRuntime } from "effect";
import { d1 } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import type { Driver, Options } from "../../gen/security__reportingReadiness.conformance.ts";
import type { Event, Read, Readiness, ReadinessObservation, Target as ModelTarget } from "../../gen/security__reportingReadiness.ts";
import { type Stored, recordObservation, storedObservation } from "../../src/readiness/store.vibe";
import type { Fetched, Target } from "../../src/readiness/targets.vibe";

const mf = startWorker({ d1: { SLOP_DB: "reporting-readiness-conformance" } });
const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
const db = await database(mf, "SLOP_DB");
const runtime = ManagedRuntime.make(d1(db));
const seededAt = "2030-01-01T00:00:00.000Z";

let generation = 0;
const seeded = new Set<string>();

function projectOf(key: string) {
  return `readiness-g${generation}-${key}`;
}

function nodeText(id: number) {
  return id === 0 ? "" : `R_node${id}`;
}

function nodeNumber(text: string) {
  const found = /^R_node([1-9][0-9]*)$/u.exec(text);
  if (found === null) throw new Error(`stored node id ${text} is not one the driver sent`);
  return Number(found[1]);
}

const repositoryPrefix = "slop-test/readiness-";

function targetOf(key: string, target: ModelTarget): Target {
  const name = `readiness-${target.repository}`;
  return {
    projectId: projectOf(key),
    revision: target.revision,
    owner: "slop-test",
    name,
    repository: `slop-test/${name}`,
    repositoryKey: `${repositoryPrefix}${target.repository}`,
    listing: target.listing,
    expectedRepositoryId: target.repositoryId,
    expectedNodeId: nodeText(target.repositoryNodeId),
  };
}

function fetchedOf(read: Read): Fetched {
  return { kind: read.kind, repositoryId: read.repositoryId, nodeId: nodeText(read.repositoryNodeId), enabled: read.enabled };
}

async function seed(key: string) {
  const project = projectOf(key);
  if (seeded.has(project)) return;
  const manifest = JSON.stringify({ id: project, status: "active" });
  await db.batch([
    db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Reporting readiness conformance',?)")
      .bind(project, manifest, "a".repeat(64), seededAt),
    db.prepare("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)")
      .bind(project, manifest, "a".repeat(64), seededAt, seededAt),
  ]);
  seeded.add(project);
}

interface Row {
  readonly project_revision: number;
  readonly repository_key: string;
}

async function storedRows(key: string): Promise<ReadonlyArray<Row>> {
  const found = await db.prepare("SELECT project_revision, repository_key FROM repository_reporting_status WHERE project_id = ? ORDER BY rowid")
    .bind(projectOf(key)).all();
  return found.results.map((row) => {
    const { project_revision: revision, repository_key: repositoryKey } = row;
    if (typeof revision !== "number" || typeof repositoryKey !== "string") throw new Error("repository_reporting_status row has an unexpected shape");
    return { project_revision: revision, repository_key: repositoryKey };
  });
}

async function storedOf(key: string, revision: number, repositoryKey: string): Promise<Stored | undefined> {
  const repository = Number(repositoryKey.slice(repositoryPrefix.length));
  return runtime.runPromise(storedObservation(targetOf(key, { revision, repository, repositoryId: 0, repositoryNodeId: 0, listing: "Active" })));
}

function observationOf(row: Row, stored: Stored): ReadinessObservation {
  return {
    revision: row.project_revision,
    repository: Number(row.repository_key.slice(repositoryPrefix.length)),
    repositoryId: stored.repositoryId,
    repositoryNodeId: stored.nodeId === "" ? 0 : nodeNumber(stored.nodeId),
    enabled: stored.enabled,
    verifiedAt: stored.verifiedAt,
    attemptedAt: stored.attemptedAt,
    failure: stored.failure,
  };
}

async function observed(key: string): Promise<Readiness> {
  const observations: ReadinessObservation[] = [];
  for (const row of await storedRows(key)) {
    const stored = await storedOf(key, row.project_revision, row.repository_key);
    if (stored === undefined) throw new Error(`reporting status ${row.project_revision} ${row.repository_key} vanished`);
    observations.push(observationOf(row, stored));
  }
  return { observations };
}

async function dispatched(key: string, event: Event): Promise<"accepted" | "refused"> {
  await seed(key);
  const target = targetOf(key, event.target);
  const before = JSON.stringify(await runtime.runPromise(storedObservation(target)));
  await runtime.runPromise(recordObservation(target, fetchedOf(event.read), event.attemptedAt));
  const after = JSON.stringify(await runtime.runPromise(storedObservation(target)));
  return before === after ? "refused" : "accepted";
}

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation += 1;
    seeded.clear();
  },
  dispatch: (key, event) => dispatched(key, event),
  observe: (key) => observed(key),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options = { keys: ["first", "second"], walks: 6, steps: 12 };
