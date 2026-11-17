// spec/slopbot/workUnits.md, "Story: Append a joint record that consumes every affected predecessor"; spec/slopbot/workUnits.md, "Story: Prepare a group whose every claim is credited once"
import { createHash } from "node:crypto";
import { Effect, Layer, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { d1, sql } from "@repo/platform/d1";
import { database, migrate, startWorker } from "@repo/platform/testing";
import { outcome } from "@repo/platform/testing/area";
import { migrationsDir } from "@repo/platform/testing/paths";
import { ProjectAudience } from "@repo/ports/backend";
import { Notices } from "@repo/ports/operations";
import type { Driver, Options } from "../../gen/slopbot__workUnits.conformance.ts";
import type { Installation } from "../../gen/slopbot__installation.ts";
import type { Event, Evidence, JointRecord, Journal, LegacyRecord, SourceKind } from "../../gen/slopbot__workUnits.ts";
import { type Numbered, deliver, installationState } from "../../src/installation/store.vibe";
import { type WorkUnitRecord, sealRecord, workUnitIdentity, workUnitRecordVersion } from "../../src/value/workUnits/record.vibe";
import { type JournalScope, appendSingleRecord, appendWorkUnitRecord, loadJournal } from "../../src/value/workUnits/store.vibe";
import type { GroupFacts } from "../../src/value/workUnits/types.vibe";

const mf = startWorker({ d1: { SLOPBOT_DB: "work-units-conformance" } });
const failed = (await migrate(mf, "SLOPBOT_DB", migrationsDir)).find((applied) => applied.error !== undefined);
if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);

const quiet = Layer.mergeAll(
  Layer.succeed(ProjectAudience, { listedBy: () => Effect.succeed(sql`SELECT NULL AS recipient WHERE 0`), owners: () => Effect.succeed(sql`SELECT NULL AS recipient WHERE 0`) }),
  Layer.succeed(Notices, { statements: () => Effect.succeed([]), fanout: () => Effect.succeed([]) }),
);
const runtime = ManagedRuntime.make(Layer.mergeAll(d1(await database(mf, "SLOPBOT_DB")), webCrypto, quiet));

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const account = { id: 7, login: "work-unit-owner", type: "User" };
const rubricVersion = "slop-value-2026-10-09";
const producerRevision = "b".repeat(40);
const recordedAt = "2026-11-02T00:00:00.000Z";

type Observed = Omit<Journal, "install"> & { readonly install: Pick<Installation, "known" | "suspended" | "removed" | "sourceTime" | "processed"> };

let generation = 0;
let fence = 1;
let deliveries: number[] = [];
let joint = new Map<number, string>();
let legacy = new Map<number, string>();
let keys = new Map<string, number>();
let heads = new Map<number, string>();
let consumed = new Set<string>();
let legacyAppended = new Set<string>();
let claimsSent = new Set<number>();
let sourcesSent = new Set<number>([1, 2]);

const repositoryNodeId = () => `R_wu_${generation}`;
const pullNodeId = (source: number) => `PR_wu_${generation}_${source}`;
const projectOf = (project: number) => `wu-project-${generation}-${project}`;
const claimHex = (claim: number) => sha256(`claim:${generation}:${claim}`);
const sourceKeyOf = (source: number) => `${repositoryNodeId()}/${pullNodeId(source)}`;
const installationId = () => 910_000 + generation;
const reference = (map: ReadonlyMap<number, string>, digest: number) => map.get(digest) ?? sha256(`unrecorded:${generation}:${digest}`);
const sorted = (values: ReadonlyArray<number>) => [...values].sort((a, b) => a - b);

function numbered(): [Numbered, ...Numbered[]] {
  return [{ deliveryId: `wu-${generation}-none`, number: 0 }, ...deliveries.map((number) => ({ deliveryId: `wu-${generation}-${number}`, number }))];
}

function scope(): JournalScope {
  return {
    sources: [...sourcesSent].map((source) => [repositoryNodeId(), pullNodeId(source)] as const),
    claims: [...claimsSent].map(claimHex),
    digests: [],
    keys: [],
    installationId: installationId(),
    fence: sql`1`,
  };
}

function relistedOf(r: JointRecord) {
  const named = new Set(r.legacyParents.map((parent) => reference(legacy, parent)));
  return [...consumed].filter((digest) => !named.has(digest) && r.sources.some((source) => heads.get(source) === digest));
}

function jointRecordJson(r: JointRecord): WorkUnitRecord {
  for (const source of r.sources) sourcesSent.add(source);
  for (const claim of r.claims) claimsSent.add(claim);
  const relisted = relistedOf(r);
  const units = r.units.map((unit) => ({ claimIds: sorted(unit).map(claimHex).sort(), assessment: { reviews: [] } }));
  return {
    schemaVersion: workUnitRecordVersion,
    projectId: projectOf(r.project),
    sourceDigest: sha256(`source:${generation}:${r.assessmentKey}`),
    sources: sorted(r.sources).map((source) => ({
      repository: "slop/work-units",
      repositoryNodeId: repositoryNodeId(),
      repositoryDatabaseId: 1,
      pullRequestNodeId: pullNodeId(source),
      pullRequestNumber: source,
      headSha: "a".repeat(40),
      mergeSha: null,
      occurredAt: recordedAt,
      policySha: "c".repeat(40),
      sourceDigest: sha256(`member:${generation}:${source}`),
    })),
    claims: sorted(r.claims).map((claim) => ({
      id: claimHex(claim),
      repositoryNodeId: repositoryNodeId(),
      commitSha: "d".repeat(40),
      path: `claim-${claim}.ts`,
      carrierPullRequestIds: [],
      creditPullRequestId: "",
      implementationActorNodeIds: [],
    })),
    units: units.map((unit) => ({ ...unit, workUnitId: workUnitIdentity(unit) })),
    rubricVersion,
    producerRevision,
    assessedAt: recordedAt,
    supersedes: r.parents.map((parent) => reference(joint, parent)).sort(),
    legacyPredecessors: [...new Set([...r.legacyParents.map((parent) => reference(legacy, parent)), ...relisted])].sort(),
    revisionReason: r.revisionReason === "" ? null : r.revisionReason,
    model: {},
  };
}

function factsOf(e: Evidence): GroupFacts {
  for (const source of e.accepted) sourcesSent.add(source);
  return {
    projectId: projectOf(e.project),
    accepted: e.accepted.map(sourceKeyOf),
    claims: e.claims.map((claim) => ({ id: claimHex(claim.id), carriers: claim.carriers.map(sourceKeyOf), credit: sourceKeyOf(claim.credit) })),
    limited: e.limitations,
  };
}

async function appendJoint(r: JointRecord, e: Evidence, captured: number) {
  const record = jointRecordJson(r);
  const prepared = await runtime.runPromise(sealRecord(record));
  const binding = { installationId: installationId(), projectId: record.projectId, registryFence: sql`${fence} = ${captured}` };
  const replay = keys.has(prepared.assessmentKey);
  const result = await outcome(appendWorkUnitRecord(prepared, factsOf(e), binding), runtime);
  if (replay) return "refused";
  if (result === "accepted") {
    joint.set(r.digest, prepared.recordDigest);
    keys.set(prepared.assessmentKey, r.assessmentKey);
    for (const parent of r.legacyParents) consumed.add(reference(legacy, parent));
  }
  return result;
}

async function appendLegacy(l: LegacyRecord, kind: SourceKind) {
  sourcesSent.add(l.source);
  const head = heads.get(l.source) ?? null;
  const recordJson = JSON.stringify({
    schemaVersion: "slop-value-record:v1",
    projectId: projectOf(1),
    repository: "slop/work-units",
    repositoryNodeId: repositoryNodeId(),
    repositoryDatabaseId: 1,
    pullRequestNodeId: pullNodeId(l.source),
    pullRequestNumber: l.source,
    headSha: "e".repeat(40),
    sourceDigest: sha256(`legacy:${generation}:${l.digest}`),
    supersedes: head,
    revisionReason: head === null ? null : "revision",
    rubricVersion,
    producerRevision,
  });
  const appended = `${l.source}:${l.digest}`;
  const replay = legacyAppended.has(appended);
  const result = await outcome(appendSingleRecord(recordJson, null, kind), runtime);
  if (replay) return "refused";
  if (result === "accepted") {
    legacyAppended.add(appended);
    const digest = sha256(recordJson);
    legacy.set(l.digest, digest);
    heads.set(l.source, digest);
  }
  return result;
}

function inverse(map: ReadonlyMap<number, string>) {
  return new Map([...map].map(([model, hex]) => [hex, model]));
}

function view(state: Journal): Observed {
  const record = (r: JointRecord): JointRecord => ({
    ...r,
    sources: sorted(r.sources),
    claims: sorted(r.claims),
    units: r.units.map(sorted).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    parents: sorted(r.parents),
    legacyParents: sorted(r.legacyParents),
  });
  return {
    records: state.records.map(record),
    retired: sorted(state.retired),
    legacy: state.legacy,
    legacyRetired: sorted(state.legacyRetired),
    lastSequence: state.lastSequence,
    fence: state.fence,
    install: { known: state.install.known, suspended: state.install.suspended, removed: state.install.removed, sourceTime: state.install.sourceTime, processed: state.install.processed },
  };
}

async function observed(): Promise<Observed> {
  const loaded = await runtime.runPromise(loadJournal(scope()));
  const installation = await runtime.runPromise(installationState(installationId(), numbered()));
  const back = new Map<number, number>();
  const digests = new Map([...inverse(joint), ...inverse(legacy)]);
  const claims = new Map([...claimsSent].map((claim) => [claimHex(claim), claim]));
  const sources = new Map([...sourcesSent].map((source) => [sourceKeyOf(source), source]));
  const projects = new Map([1, 2].map((project) => [projectOf(project), project]));
  for (const [name, id] of loaded.names) {
    const split = name.indexOf(":");
    const kind = name.slice(0, split);
    const value = name.slice(split + 1);
    const model = kind === "digest" ? digests.get(value)
      : kind === "claim" ? claims.get(value)
      : kind === "source" ? sources.get(value)
      : kind === "project" ? projects.get(value)
      : keys.get(value);
    if (model !== undefined) back.set(id, model);
  }
  const as = (id: number) => back.get(id) ?? -id;
  const ranks = new Map(loaded.journal.records.map((r, index) => [r.sequence, index + 1]));
  return view({
    records: loaded.journal.records.map((r) => ({
      digest: as(r.digest),
      assessmentKey: as(r.assessmentKey),
      project: as(r.project),
      sources: r.sources.map(as),
      claims: r.claims.map(as),
      units: r.units.map((unit) => unit.map(as)),
      parents: r.parents.map(as),
      legacyParents: r.legacyParents.map(as),
      revisionReason: r.revisionReason,
      sequence: ranks.get(r.sequence) ?? 0,
    })),
    retired: loaded.journal.retired.map(as),
    legacy: loaded.journal.legacy.map((l) => ({ digest: as(l.digest), source: as(l.source) })),
    legacyRetired: loaded.journal.legacyRetired.map(as),
    lastSequence: loaded.journal.records.length,
    fence,
    install: installation,
  });
}

export const driver: Driver<Observed> & AsyncDisposable = {
  reset: () => {
    generation++;
    fence = 1;
    deliveries = [];
    joint = new Map();
    legacy = new Map();
    keys = new Map();
    heads = new Map();
    consumed = new Set();
    legacyAppended = new Set();
    claimsSent = new Set();
    sourcesSent = new Set([1, 2]);
  },
  dispatch: async (_key, event: Event) => {
    switch (event.type) {
      case "observeRegistryChange":
        fence += 1;
        return "accepted";
      case "applyInstallation":
        if (!deliveries.includes(event.change.delivery)) deliveries.push(event.change.delivery);
        return outcome(deliver({
          installationId: installationId(),
          account: event.change.hasAccount ? account : undefined,
          deliveryId: `wu-${generation}-${event.change.delivery}`,
          event: event.change,
          servedProjects: [],
        }, numbered()), runtime);
      case "appendJoint":
        return appendJoint(event.r, event.e, event.captured);
      case "appendLegacy":
        return appendLegacy(event.l, event.kind);
    }
  },
  observe: () => observed(),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    await mf.dispose();
  },
};

export const options: Options<Observed> = { keys: ["journal"], view, walks: 3, steps: 10 };
