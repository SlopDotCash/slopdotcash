/**
 * Adapts a deployed schema-6 ledger to the fail-closed schema-5 contract used
 * by this pull request. This runs only for untrusted PR browser checks. Trusted
 * develop builds always regenerate the ledger from GitHub.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  assertPublishableLeaderboardSnapshot,
  LEADERBOARD_SCHEMA_VERSION,
  type LeaderboardEntry,
  leaderboardMethodology,
  mergedPullRequestPoints,
  SCORE_CAPS,
  SCORE_RULE_VERSION,
  type ScoreEvent,
} from "../src/lib/leaderboard";

type JsonRecord = Record<string, unknown>;

function record(value: unknown, field: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as JsonRecord;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function eventGroup(event: ScoreEvent): string {
  return `${event.actor.id}\0${event.repository}\0${event.occurredAt.slice(0, 7)}`;
}

function newest(left: ScoreEvent, right: ScoreEvent): number {
  return (
    right.occurredAt.localeCompare(left.occurredAt) ||
    right.source.number - left.source.number ||
    left.id.localeCompare(right.id)
  );
}

function codeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function adaptLedger(values: unknown[]): ScoreEvent[] {
  const merged = new Map<string, ScoreEvent[]>();
  const evaluated = new Map<string, ScoreEvent[]>();
  for (const [index, value] of values.entries()) {
    const event = record(value, `ledger[${index}]`) as unknown as ScoreEvent;
    text(event.id, `ledger[${index}].id`);
    text(event.occurredAt, `ledger[${index}].occurredAt`);
    const destination =
      event.category === "merged-pull-request"
        ? merged
        : event.category === "evaluated-contribution"
          ? evaluated
          : null;
    if (destination === null) continue;
    const group = destination.get(eventGroup(event)) ?? [];
    group.push(event);
    destination.set(eventGroup(event), group);
  }

  const output: ScoreEvent[] = [];
  for (const events of merged.values()) {
    events.sort(newest).forEach((event, index) => {
      output.push({
        ...event,
        points: mergedPullRequestPoints(index + 1),
        reason:
          "Pull request merged during the rolling window; uncapped diminishing credit applies within its project and UTC month.",
      });
    });
  }

  const evaluatedSources = new Set<string>();
  for (const events of evaluated.values()) {
    for (const event of events.sort(newest)) {
      if (
        events.indexOf(event) >= SCORE_CAPS.evaluatedContributions ||
        event.source.kind !== "comment"
      ) {
        continue;
      }
      const sourceKey = `${event.repository}\0${event.source.id}`;
      if (evaluatedSources.has(sourceKey)) continue;
      evaluatedSources.add(sourceKey);
      output.push({
        ...event,
        points: Math.max(1, Math.min(8, Math.round(event.points))),
      });
    }
  }
  return output;
}

function causalAttributions(
  values: unknown[],
  ledger: ScoreEvent[],
): JsonRecord[] {
  const artifactKeys = new Set(
    ledger
      .filter((event) => event.source.kind === "pull-request")
      .map((event) => `${event.actor.id}\0${event.source.id}`),
  );
  const sourceKeys = new Set(
    ledger
      .filter(
        (event) =>
          event.category === "evaluated-contribution" &&
          event.source.kind === "comment",
      )
      .map((event) => `${event.actor.id}\0${event.source.id}`),
  );
  return values
    .map((value, index) => record(value, `attributions[${index}]`))
    .filter((attribution) => {
      const actor = record(attribution.actor, "attribution.actor");
      const actorId = text(actor.id, "attribution.actor.id");
      return (
        artifactKeys.has(`${actorId}\0${String(attribution.artifactId)}`) ||
        sourceKeys.has(`${actorId}\0${String(attribution.sourceId)}`)
      );
    });
}

function rebuildLeaders(
  legacyValues: unknown[],
  ledger: ScoreEvent[],
  attributions: JsonRecord[],
): LeaderboardEntry[] {
  const legacyByActor = new Map(
    legacyValues.map((value, index) => {
      const leader = record(value, `leaders[${index}]`);
      const actor = record(leader.actor, `leaders[${index}].actor`);
      return [text(actor.id, `leaders[${index}].actor.id`), leader];
    }),
  );
  const modelsByActor = new Map<string, Set<string>>();
  for (const attribution of attributions) {
    const actor = record(attribution.actor, "attribution.actor");
    const actorId = text(actor.id, "attribution.actor.id");
    const models = modelsByActor.get(actorId) ?? new Set<string>();
    models.add(text(attribution.identifier, "attribution.identifier"));
    modelsByActor.set(actorId, models);
  }

  const entries = new Map<string, Omit<LeaderboardEntry, "rank">>();
  for (const event of ledger) {
    const prior = entries.get(event.actor.id);
    const legacy = legacyByActor.get(event.actor.id);
    const entry =
      prior ??
      ({
        actor: event.actor,
        score: 0,
        points: {
          mergedPullRequests: 0,
          resolvedIssues: 0,
          materialTestChanges: 0,
          evidence: 0,
          substantiveReviews: 0,
          evaluatedContributions: 0,
        },
        acceptedOutcomes: {
          mergedPullRequests: 0,
          resolvedIssues: 0,
          materialTestChanges: 0,
          evidenceCategories: 0,
          substantiveReviews: 0,
          evaluatedContributions: 0,
        },
        rawActivity: record(
          legacy?.rawActivity,
          "leader.rawActivity",
        ) as LeaderboardEntry["rawActivity"],
        reportedModels: [],
      } satisfies Omit<LeaderboardEntry, "rank">);
    entry.score += event.points;
    if (event.category === "merged-pull-request") {
      entry.points.mergedPullRequests += event.points;
      entry.acceptedOutcomes.mergedPullRequests += 1;
    } else {
      entry.points.evaluatedContributions += event.points;
      entry.acceptedOutcomes.evaluatedContributions += 1;
    }
    entries.set(event.actor.id, entry);
  }

  return [...entries.values()]
    .map((entry) => ({
      ...entry,
      reportedModels: [...(modelsByActor.get(entry.actor.id) ?? [])].sort(
        (left, right) => left.localeCompare(right),
      ),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        codeUnits(
          left.actor.login.toLowerCase(),
          right.actor.login.toLowerCase(),
        ) ||
        codeUnits(left.actor.login, right.actor.login) ||
        codeUnits(left.actor.id, right.actor.id),
    )
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}

export async function preparePrLedger(inputPath: string, outputPath: string) {
  const input = record(
    JSON.parse(await readFile(resolve(inputPath), "utf8")),
    "snapshot",
  );
  if (input.schemaVersion !== "5" && input.schemaVersion !== "6") {
    throw new TypeError("deployed PR ledger must use schema 5 or 6");
  }
  const output =
    input.schemaVersion === "5"
      ? input
      : (() => {
          const ledger = adaptLedger(array(input.ledger, "snapshot.ledger"));
          const attributions = causalAttributions(
            array(input.attributions, "snapshot.attributions"),
            ledger,
          );
          return {
            ...input,
            schemaVersion: LEADERBOARD_SCHEMA_VERSION,
            ruleVersion: SCORE_RULE_VERSION,
            methodology: leaderboardMethodology(),
            ledger,
            attributions,
            leaders: rebuildLeaders(
              array(input.leaders, "snapshot.leaders"),
              ledger,
              attributions,
            ),
          };
        })();
  assertPublishableLeaderboardSnapshot(output);
  const destination = resolve(outputPath);
  const temporary = `${destination}.tmp-${process.pid}`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`, {
    flag: "wx",
  });
  await rename(temporary, destination);
}

if (import.meta.main) {
  if (process.argv.length !== 4) {
    throw new TypeError(
      "Usage: bun scripts/prepare-pr-ledger.ts <input> <output>",
    );
  }
  await preparePrLedger(process.argv[2], process.argv[3]);
}
