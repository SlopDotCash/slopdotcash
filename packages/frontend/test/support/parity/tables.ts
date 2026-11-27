// spec/frontend/requests.md, "Story: Read current data without losing the last good result"
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { repoRoot } from "@repo/platform/testing/paths";
import { retired } from "@repo/operations/retired";
import { type AmendedRefusal, type Amendment, amendments } from "./amendments.ts";
import { type OldEntry, type WorkerSuccessor, parityPointsProtectionToken, successors } from "./entries.ts";

const parity = join(repoRoot, "reference/parity");

const Headers = Schema.Record(Schema.String, Schema.String);

const Answer = Schema.Struct({
  key: Schema.optionalKey(Schema.String),
  status: Schema.Number,
  body: Schema.optionalKey(Schema.Unknown),
  headers: Schema.optionalKey(Headers),
  headersFrom: Schema.optionalKey(Schema.Unknown),
  at: Schema.optionalKey(Schema.String),
});

const RouteRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  method: Schema.String,
  path: Schema.String,
  entry: Schema.String,
  success: Schema.Array(Schema.Number),
  refusals: Schema.Array(Answer),
});

const Routes = Schema.Struct({ routes: Schema.Array(RouteRow) });

const AdmissionRow = Schema.Struct({
  category: Schema.String,
  status: Schema.Number,
  body: Schema.optionalKey(Schema.Unknown),
  headers: Schema.optionalKey(Headers),
  headersFrom: Schema.optionalKey(Schema.Unknown),
  at: Schema.optionalKey(Schema.String),
  routes: Schema.Array(Schema.String),
});

const Admission = Schema.Struct({ rows: Schema.Array(AdmissionRow) });

const Conflict = Schema.Struct({ route: Schema.String, reason: Schema.String });

const Conflicts = Schema.Struct({ conflicts: Schema.Array(Conflict) });

const CaseRequest = Schema.Struct({ method: Schema.String, url: Schema.String, headers: Headers, body: Schema.optionalKey(Schema.NullOr(Schema.String)) });

const CaseResponse = Schema.Struct({ status: Schema.Number, headers: Headers, body: Schema.String });

const Case = Schema.Struct({ name: Schema.String, kind: Schema.String, request: CaseRequest, response: CaseResponse });

const CorpusFile = Schema.Struct({ route: Schema.String, source: Schema.Struct({ entry: Schema.String }), cases: Schema.Array(Case) });

export type ReplayCase = typeof Case.Type & { readonly route: string; readonly entry: OldEntry };

export interface Expected {
  readonly key: string;
  readonly status: number;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly dynamicHeaders: ReadonlyArray<string>;
  readonly at: string;
}

export interface Row {
  readonly id: string;
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly entry: OldEntry;
  readonly success: ReadonlyArray<number>;
  readonly refusalOnly?: true;
  readonly answers: ReadonlyArray<Expected>;
}

export interface Seen {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly text: string;
}

export interface Probe {
  readonly path: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface Surface {
  readonly entry: OldEntry;
  readonly successor: WorkerSuccessor;
  readonly origin: string;
  readonly cases: ReadonlyArray<ReplayCase>;
  readonly rows: ReadonlyArray<Row>;
}

function read(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOldEntry(entry: string): entry is OldEntry {
  return Object.hasOwn(successors, entry);
}

function entryOf(entry: string): OldEntry {
  if (!isOldEntry(entry)) throw new Error(`reference/parity names the entry ${entry}, which has no successor in test/support/parity/entries.ts`);
  return entry;
}

function expectedOf(answer: typeof Answer.Type, key: string): Expected {
  return {
    key,
    status: answer.status,
    body: answer.body ?? null,
    headers: answer.headers ?? {},
    dynamicHeaders: isRecord(answer.headersFrom) ? Object.keys(answer.headersFrom) : [],
    at: answer.at ?? "",
  };
}

function amendedOf(row: Row, refusal: AmendedRefusal): Expected {
  const like = row.answers.find((answer) => answer.key === refusal.like);
  if (like === undefined) throw new Error(`the amendment of ${row.id} copies headers from ${refusal.like}, which the route does not answer`);
  return {
    key: refusal.key,
    status: refusal.status,
    body: refusal.message === undefined ? { error: refusal.error } : { error: refusal.error, message: refusal.message },
    headers: refusal.cacheControl === undefined ? like.headers : { ...like.headers, "cache-control": refusal.cacheControl },
    dynamicHeaders: like.dynamicHeaders,
    at: refusal.at,
  };
}

function pathOf(id: string): { readonly method: string; readonly path: string } {
  const [method = "", path = ""] = id.split(" ");
  return { method, path };
}

function amended(rows: ReadonlyArray<Row>, amendment: Amendment): ReadonlyArray<Row> {
  const { from } = amendment;
  if (from !== undefined) {
    const base = rows.find((row) => row.id === from.route);
    if (base === undefined) throw new Error(`the amendment ${amendment.route} starts from ${from.route}, which reference/parity does not list`);
    const added: Row = {
      ...base,
      ...pathOf(amendment.route),
      id: amendment.route,
      name: from.name,
      success: amendment.success ?? base.success,
      ...amendment.refusalOnly === true ? { refusalOnly: true } : {},
      answers: base.answers.filter((answer) => from.keep.includes(answer.key)),
    };
    return [...rows, { ...added, answers: [...added.answers, ...amendment.refusals.map((refusal) => amendedOf(base, refusal))] }];
  }
  if (!rows.some((row) => row.id === amendment.route)) throw new Error(`the amendment names ${amendment.route}, which reference/parity does not list`);
  return rows.map((row) => row.id !== amendment.route ? row : {
    ...row,
    answers: [...row.answers.filter((answer) => !(amendment.replaces ?? []).includes(answer.key)), ...amendment.refusals.map((refusal) => amendedOf(row, refusal))],
  });
}

function loadRows(): ReadonlyArray<Row> {
  const { routes } = Schema.decodeUnknownSync(Routes)(read(join(parity, "routes.json")));
  const { rows: admission } = Schema.decodeUnknownSync(Admission)(read(join(parity, "admission.json")));
  const base = routes.map((route): Row => ({
    id: route.id,
    name: route.name,
    method: route.method,
    path: route.path,
    entry: entryOf(route.entry),
    success: route.success,
    answers: [
      ...route.refusals.map((answer, index) => expectedOf(answer, answer.key ?? `refusal${index}`)),
      ...admission.flatMap((answer, index) => answer.routes.includes(route.id) ? [expectedOf(answer, `${answer.category}${index}`)] : []),
    ],
  }));
  return amendments.reduce(amended, base);
}

function loadCases(): ReadonlyArray<ReplayCase> {
  const corpus = join(parity, "corpus");
  return readdirSync(corpus).sort().flatMap((area) => readdirSync(join(corpus, area)).sort().flatMap((file) => {
    const recorded = Schema.decodeUnknownSync(CorpusFile)(read(join(corpus, area, file)));
    const entry = entryOf(recorded.source.entry);
    return recorded.cases.map((replay) => ({ ...replay, route: recorded.route, entry }));
  }));
}

export const rows = loadRows();

export const cases = loadCases();

export const conflicts = Schema.decodeUnknownSync(Conflicts)(read(join(parity, "conflicts.json"))).conflicts;

export function excuseOf(row: Row): string | undefined {
  const conflict = conflicts.find((entry) => entry.route === row.id && entry.reason.trim() !== "");
  if (conflict !== undefined) return `reference/parity/conflicts.json: ${conflict.reason}`;
  const decommissioned = retired.find((entry) => entry.kind === "script" && row.entry === `worker:${entry.name}` && entry.reason.trim() !== "");
  return decommissioned === undefined ? undefined : `apps/operations/src/release/retired.ts: ${decommissioned.reason}`;
}

const samples: Readonly<Record<string, string>> = {
  id: "parity-project",
  revision: "1",
  owner: "parity-owner",
  name: "parity-name",
  assessment: "parity-assessment",
  run: "parity-run",
  sha: "0".repeat(40),
  index: "0",
  period: "2026-11",
  path: "parity",
  key: "parity",
  network: "base-mainnet",
  githubId: "42",
  capability: "parity",
  artifact: "skill.md",
  code: "parity",
  repositoryId: "1",
  pullNumber: "1",
  caseId: "sc_paritycase",
};

export function sampledPath(path: string): string {
  return path.replace(/:(\w+)/gu, (_, name: string) => samples[name] ?? "parity").replace(/\*/gu, "parity");
}

function originOfUrl(url: string): string {
  return new URL(url).origin;
}

/** @throws {never} */
export function probeOf(row: Row, origin: string): Probe {
  const method = row.method === "*" ? "GET" : row.method;
  const path = sampledPath(row.path);
  if (method === "GET" || method === "HEAD") return { path, method, headers: {} };
  return { path, method, headers: { origin, "content-type": "application/json" }, body: "{}" };
}

function shapeMatches(expected: unknown, actual: unknown): boolean {
  if (isRecord(expected) && Object.keys(expected).length === 1 && typeof expected.raw === "string") return actual !== undefined && actual !== null;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((value, index) => shapeMatches(value, actual[index]));
  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    const keys = Object.keys(expected).sort();
    return keys.join() === Object.keys(actual).sort().join() && keys.every((key) => shapeMatches(expected[key], actual[key]));
  }
  return Object.is(expected, actual);
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function bodyMatches(expected: unknown, seen: Seen): boolean {
  const type = seen.headers["content-type"] ?? "";
  if (expected === null || expected === undefined) return seen.text === "";
  if (isRecord(expected) && Object.keys(expected).length === 1) {
    if (typeof expected.text === "string") return seen.text === expected.text;
    if ("textFrom" in expected) return !type.includes("json");
    const html = expected.html;
    if (isRecord(html)) return type.includes("html") && Object.values(html).every((part) => typeof part !== "string" || seen.text.includes(part));
  }
  return type.includes("json") && shapeMatches(expected, parsed(seen.text));
}

function headersMatch(expected: Expected, seen: Seen): boolean {
  return Object.entries(expected.headers).every(([name, value]) => expected.dynamicHeaders.includes(name) || seen.headers[name] === value);
}

/** @throws {never} */
export function answered(row: Row, seen: Seen): boolean {
  return row.success.includes(seen.status) || row.answers.some((expected) => expected.status === seen.status && bodyMatches(expected.body, seen) && headersMatch(expected, seen));
}

function withoutNonces(text: string): string {
  return text.replace(/nonce-[A-Za-z0-9+/=_-]+/gu, "nonce-").replace(/nonce="[^"]*"/gu, 'nonce=""');
}

/** @throws {never} */
export function replayDifference(replay: ReplayCase, seen: Seen): ReadonlyArray<string> {
  const expected = replay.response;
  return [
    ...expected.status === seen.status ? [] : [`status ${seen.status}, recorded ${expected.status}`],
    ...Object.entries(expected.headers).flatMap(([name, value]) => seen.headers[name] === value ? [] : [`${name} ${seen.headers[name] ?? "absent"}, recorded ${value}`]),
    ...withoutNonces(expected.body) === withoutNonces(seen.text) ? [] : [`body ${seen.text.slice(0, 300)}, recorded ${expected.body.slice(0, 300)}`],
  ];
}

/** @throws {TypeError} */
export function replayRequest(replay: ReplayCase): Probe {
  const url = new URL(replay.request.url);
  const headers = Object.fromEntries(
    Object.entries(replay.request.headers).map(([name, value]) => [name, value.replaceAll("<POINTS_PROTECTION_TOKEN>", parityPointsProtectionToken)]),
  );
  return { path: `${url.pathname}${url.search}`, method: replay.request.method, headers, ...replay.request.body == null ? {} : { body: replay.request.body } };
}

function rowOrigin(row: Row, successor: WorkerSuccessor): string {
  const replay = cases.find((recorded) => recorded.route === row.id && recorded.entry === row.entry);
  return replay === undefined ? successor.origin : originOfUrl(replay.request.url);
}

export const surfaces: ReadonlyArray<Surface> = (Object.keys(successors) as OldEntry[]).flatMap((entry) => {
  const successor = successors[entry];
  if (successor.kind !== "worker") return [];
  const own = rows.filter((row) => row.entry === entry && excuseOf(row) === undefined);
  const replays = cases.filter((replay) => replay.entry === entry);
  const origins = [...new Set([successor.origin, ...replays.map((replay) => originOfUrl(replay.request.url)), ...own.map((row) => rowOrigin(row, successor))])];
  return origins.map((origin) => ({
    entry,
    successor,
    origin,
    cases: replays.filter((replay) => originOfUrl(replay.request.url) === origin),
    rows: own.filter((row) => rowOrigin(row, successor) === origin),
  })).filter((surface) => surface.cases.length > 0 || surface.rows.length > 0);
});

export interface Declared {
  readonly method: string;
  readonly path: string;
}

function routeKey(method: string, path: string): string {
  return `${method} /${path.split("/").filter((segment) => segment !== "").map((segment) => segment.startsWith(":") || segment === "*" ? ":" : segment).join("/")}`;
}

export function undeclared(declared: ReadonlyArray<Declared>): ReadonlyArray<string> {
  const keys = new Set(declared.map((route) => routeKey(route.method, route.path)));
  return rows
    .filter((row) => row.entry === "pages" && row.method !== "*" && row.path.startsWith("/api/v1/") && row.refusalOnly !== true && excuseOf(row) === undefined && !keys.has(routeKey(row.method, row.path)))
    .map((row) => row.id);
}

export const elsewhere: ReadonlyArray<{ readonly row: string; readonly journey: string }> = rows.flatMap((row) => {
  const successor = successors[row.entry];
  return successor.kind === "elsewhere" ? [{ row: row.id, journey: successor.journey }] : [];
});
