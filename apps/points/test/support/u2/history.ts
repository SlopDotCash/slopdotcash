import { readFile } from "node:fs/promises";

export type HistoricalCategory =
  | "merged-pull-request"
  | "resolved-issue"
  | "material-test-change"
  | "evidence"
  | "substantive-review"
  | "evaluated-contribution";

export interface HistoricalEvent {
  readonly actor: string;
  readonly category: HistoricalCategory;
  readonly points: number;
  readonly scoreThirds: number;
  readonly occurredAt: number;
  readonly month: string;
  readonly project: string;
  readonly source: string;
  readonly scoreDecisionSourceId: string;
}

export interface HistoricalCycle {
  readonly name: string;
  readonly events: ReadonlyArray<HistoricalEvent>;
}

const categories: ReadonlyArray<string> = [
  "merged-pull-request",
  "resolved-issue",
  "material-test-change",
  "evidence",
  "substantive-review",
  "evaluated-contribution",
];

const root = new URL("./", import.meta.url);

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${where} is not an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string") throw new TypeError(`${where} is not a string`);
  return value;
}

function count(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${where} is not a number`);
  return value;
}

function isCategory(value: string): value is HistoricalCategory {
  return categories.includes(value);
}

function event(value: unknown, projects: ReadonlyMap<string, string>, at: number): HistoricalEvent {
  const row = record(value, `ledger[${at}]`);
  const category = text(row.category, `ledger[${at}].category`);
  if (!isCategory(category)) throw new TypeError(`ledger[${at}] has category ${category}`);
  const occurredAt = text(row.occurredAt, `ledger[${at}].occurredAt`);
  const millis = Date.parse(occurredAt);
  if (!Number.isFinite(millis)) throw new TypeError(`ledger[${at}].occurredAt is not a time`);
  const repository = text(row.repository, `ledger[${at}].repository`);
  const project = projects.get(repository);
  if (project === undefined) throw new TypeError(`ledger[${at}] names unregistered repository ${repository}`);
  return {
    actor: text(record(row.actor, `ledger[${at}].actor`).id, `ledger[${at}].actor.id`),
    category,
    points: count(row.points, `ledger[${at}].points`),
    scoreThirds: row.scoreThirds === undefined ? -1 : count(row.scoreThirds, `ledger[${at}].scoreThirds`),
    occurredAt: millis,
    month: occurredAt.slice(0, 7),
    project,
    source: text(record(row.source, `ledger[${at}].source`).id, `ledger[${at}].source.id`),
    scoreDecisionSourceId: row.scoreDecisionSourceId === undefined ? "" : text(row.scoreDecisionSourceId, `ledger[${at}].scoreDecisionSourceId`),
  };
}

export async function historicalCycle(project: string, month: string): Promise<HistoricalCycle> {
  const path = new URL(`cycles/${project}/${month}/source-snapshot.json`, root);
  const snapshot = record(JSON.parse(await readFile(path, "utf8")), path.pathname);
  const repositories = snapshot.repositories;
  const ledger = snapshot.ledger;
  if (!Array.isArray(repositories) || !Array.isArray(ledger)) throw new TypeError(`${path.pathname} has no repositories or ledger`);
  const projects = new Map(repositories.map((value, at) => {
    const row = record(value, `repositories[${at}]`);
    return [text(row.id, `repositories[${at}].id`), text(row.projectId, `repositories[${at}].projectId`)] as const;
  }));
  return { name: `${project}/${month}`, events: ledger.map((value, at) => event(value, projects, at)) };
}
