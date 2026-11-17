// spec/slopbot/valueHistory.md, "Story: Recover complete history at a fixed sequence boundary"; spec/slopbot/valueHistory.md, "Story: Reuse the exact current assessment before spending again"
import { createHash } from "node:crypto";
import { Effect, ManagedRuntime } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/slopbot__valueHistory.conformance.ts";
import type { Event, History, Observation, Row } from "../../gen/slopbot__valueHistory.ts";
import type { JournalRow } from "../../src/value/history/read.vibe";
import { type CurrentEvidence, type HistorySession, observationOf, openHistory, pageEvent, readRow, rowEvent } from "../../src/value/history/store.vibe";

type Binding = Readonly<Record<string, unknown>>;

interface Written {
  readonly digest: number;
  readonly members: number;
  readonly claimsDigest: number;
  readonly sources: ReadonlyArray<Binding>;
  readonly claims: ReadonlyArray<Binding>;
}

const runtime = ManagedRuntime.make(webCrypto);
const recordedAt = "2026-10-01T00:00:00.000Z";

const hex = (kind: string, id: number) => createHash("sha256").update(`${kind}:${id}`).digest("hex");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const sourceName = (source: number) => `R${source}/P${source}`;

let session: HistorySession = await runtime.runPromise(openHistory("project-1", "R1", "P1"));
let written = new Map<string, Written>();
let named = new Map<string, number>();

function remember(kind: "legacy" | "sourceDigest", id: number) {
  const value = hex(kind, id);
  named.set(`${kind}:${value}`, id);
  return value;
}

function digestOf(id: number) {
  return [...written].find(([, row]) => row.digest === id)?.[0];
}

function journalRow(record: Row) {
  const sources = record.sources.map((source) => ({ repositoryNodeId: `R${source}`, pullRequestNodeId: `P${source}`, members: record.membersDigest }));
  const claims = record.claims.map((claim) => ({ id: `claim-${claim}`, claimsDigest: record.claimsDigest }));
  const recordJson = JSON.stringify({
    schemaVersion: "slop-work-unit-record:v1",
    projectId: `project-${record.project}`,
    sourceDigest: record.sourceDigest > 0 ? remember("sourceDigest", record.sourceDigest) : "",
    sources,
    claims,
    units: [],
    rubricVersion: record.rubric > 0 ? `rubric-${record.rubric}` : "",
    producerRevision: `model-${record.digest}`,
    supersedes: record.parents.map((parent) => digestOf(parent) ?? hex("absent", parent)),
    legacyPredecessors: record.legacy.map((legacy) => remember("legacy", legacy)),
    revisionReason: record.revisionReason ? "Source group changed; automatic provisional reassessment" : null,
  });
  const exact = record.exactRecord && record.digest > 0 && record.membersDigest > 0 && record.claimsDigest > 0;
  const recordDigest = digestOf(record.digest) ?? (exact ? sha256(recordJson) : hex("corrupt", record.digest));
  const row: JournalRow = { sequence: record.sequence, record_digest: recordDigest, record_json: recordJson, recorded_at: recordedAt };
  return { row, written: { digest: record.digest, members: record.membersDigest, claimsDigest: record.claimsDigest, sources, claims } satisfies Written };
}

function chosen<A>(decide: Effect.Effect<Event, unknown, A>, wanted: Event["type"], send: (event: Event) => Effect.Effect<unknown, unknown, A>) {
  return decide.pipe(Effect.flatMap((event) => (event.type === wanted ? send(event) : Effect.fail({ _tag: "Rejected" as const }))));
}

function dispatchRow(event: Extract<Event, { type: "acceptRow" | "rejectRow" }>) {
  const { row, written: fields } = journalRow(event.record);
  return outcome(chosen(rowEvent(session, row), event.type, () => readRow(session, row).pipe(Effect.tap(() => Effect.sync(() => {
    if (event.type === "acceptRow") written.set(row.record_digest, fields);
  })))), runtime);
}

function selectedRow(state: History) {
  const name = nameOf(state.selected);
  return name?.startsWith("record:") ? written.get(name.slice("record:".length)) : undefined;
}

function evidenceOf(state: History, observation: Observation): CurrentEvidence {
  const selected = selectedRow(state);
  return {
    sourceDigest: observation.sourceDigest > 0 ? hex("sourceDigest", observation.sourceDigest) : "",
    rubricVersion: observation.rubric > 0 ? `rubric-${observation.rubric}` : "",
    sources: selected !== undefined && selected.members === observation.membersDigest ? selected.sources : [{ members: observation.membersDigest, unseen: true }],
    claims: selected !== undefined && selected.claimsDigest === observation.claimsDigest ? selected.claims : [{ claimsDigest: observation.claimsDigest, unseen: true }],
    observedSources: observation.observedSources.map(sourceName),
    verifiedLegacySources: observation.verifiedLegacySources.map(sourceName),
    legacy: observation.legacy.map((legacy) => hex("legacy", legacy)),
    completeEvidence: observation.completeEvidence,
    exactProducer: observation.exactProducer,
    validAssessment: observation.validAssessment,
    everyUnitAssessed: observation.everyUnitAssessed,
  };
}

const consume = (observation: Observation) => Effect.gen(function* () {
  const history = yield* session.machine.get();
  const mapped = observationOf({ history, names: session.names, rows: session.rows }, evidenceOf(history, observation));
  return yield* session.machine.send({ type: "consume", observation: mapped });
});

function nameOf(id: number) {
  return [...session.names].find(([, value]) => value === id)?.[0];
}

function modelId(id: number) {
  if (id === 0) return 0;
  const name = nameOf(id);
  if (name === undefined) throw new Error(`no name for interned id ${id}`);
  const kind = name.slice(0, name.indexOf(":"));
  const value = name.slice(name.indexOf(":") + 1);
  const numbered = /^(?:project-|R|claim-|rubric-)([0-9]+)/u.exec(value)?.[1];
  if (kind === "record") {
    const row = written.get(value);
    if (row === undefined) throw new Error(`record ${value} was never accepted`);
    return row.digest;
  }
  if (kind === "legacy" || kind === "sourceDigest") return named.get(name) ?? -1;
  if (numbered === undefined) throw new Error(`unexpected interned name ${name}`);
  return Number(numbered);
}

const ids = (values: ReadonlyArray<number>) => [...new Set(values)].sort((left, right) => left - right);

function normalRow(row: Row): Row {
  return { ...row, sources: ids(row.sources), claims: ids(row.claims), parents: ids(row.parents), legacy: ids(row.legacy) };
}

function view(state: History): History {
  return { ...state, rows: state.rows.map(normalRow), retired: ids(state.retired) };
}

function restored(state: History): History {
  const map = (values: ReadonlyArray<number>) => values.map(modelId);
  return view({
    ...state,
    project: modelId(state.project),
    target: modelId(state.target),
    selected: modelId(state.selected),
    retired: map(state.retired),
    rows: state.rows.map((row) => {
      const fields = written.get(nameOf(row.digest)?.slice("record:".length) ?? "");
      return {
        ...row,
        digest: modelId(row.digest),
        project: modelId(row.project),
        sources: map(row.sources),
        claims: map(row.claims),
        parents: map(row.parents),
        legacy: map(row.legacy),
        sourceDigest: modelId(row.sourceDigest),
        rubric: modelId(row.rubric),
        membersDigest: fields?.members ?? 0,
        claimsDigest: fields?.claimsDigest ?? 0,
      };
    }),
  });
}

export const driver: Driver = {
  reset: async () => {
    session = await runtime.runPromise(openHistory("project-1", "R1", "P1"));
    written = new Map();
    named = new Map();
  },
  dispatch: async (_key, event: Event) => {
    switch (event.type) {
      case "acceptPage":
      case "rejectPage":
        return outcome(chosen(session.machine.get().pipe(Effect.map((state) => pageEvent(state, event.page))), event.type, (page) => session.machine.send(page)), runtime);
      case "acceptRow":
      case "rejectRow":
        return dispatchRow(event);
      case "closePage":
        return outcome(session.machine.send(event), runtime);
      case "consume":
        return outcome(consume(event.observation), runtime);
    }
  },
  observe: async () => restored(await runtime.runPromise(session.machine.get())),
};

export const options: Options = { keys: ["history"], view };
