/**
 * Adapts the currently deployed public ledger for untrusted pull-request
 * browser checks when a schema migration has landed in code before production.
 * Trusted develop builds always regenerate from GitHub and never call this.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  assertPublishableLeaderboardSnapshot,
  LEADERBOARD_SCHEMA_VERSION,
  type LeaderboardEntry,
  type LeaderboardSnapshot,
  leaderboardMethodology,
  SCORE_RULE_VERSION,
  SCORE_V2_EFFECTIVE_AT,
  type ScoreEvent,
  TARGET_REPOSITORIES,
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

function currentRegistryFields() {
  return TARGET_REPOSITORIES.map(
    ({ aliases: _aliases, expectedNodeId: _expectedNodeId, ...repository }) =>
      repository,
  );
}

function normalizeTransferredRepositories(candidate: JsonRecord): JsonRecord {
  const repositories = array(
    candidate.repositories,
    "snapshot.repositories",
  ).map((value, index) => {
    const published = record(value, `snapshot.repositories[${index}]`);
    const registered = TARGET_REPOSITORIES[index];
    if (!registered || published.id !== registered.id) {
      throw new TypeError(
        `snapshot.repositories[${index}].id does not match the stable repository registry`,
      );
    }
    for (const key of [
      "description",
      "integrationBranch",
      "projectId",
      "role",
    ] as const) {
      if (published[key] !== registered[key]) {
        throw new TypeError(
          `snapshot.repositories[${index}].${key} does not match the repository registry`,
        );
      }
    }
    const identity = `${String(published.owner)}/${String(published.name)}`;
    const allowedIdentities = new Set([
      registered.id.toLowerCase(),
      ...registered.aliases.map((alias) => alias.toLowerCase()),
    ]);
    if (
      !allowedIdentities.has(identity.toLowerCase()) ||
      published.githubUrl !== `https://github.com/${identity}` ||
      published.displayName !== identity
    ) {
      throw new TypeError(
        `snapshot.repositories[${index}] is not a registered repository identity`,
      );
    }
    return currentRegistryFields()[index];
  });
  return { ...candidate, repositories };
}

function actorId(value: unknown): string {
  const actor = record(value, "actor");
  if (typeof actor.id !== "string" || actor.id.length === 0) {
    throw new TypeError("actor.id must be a non-empty string");
  }
  return actor.id;
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function eventThirds(event: ScoreEvent): number {
  return event.scoreThirds ?? event.points * 3;
}

function v2WorkUnit(event: ScoreEvent): string {
  const repository = TARGET_REPOSITORIES.find(
    (candidate) => candidate.id === event.repository,
  );
  if (!repository)
    throw new TypeError(`unknown repository ${event.repository}`);
  return `wu_${repository.projectId}_${event.source.id
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "_")}`;
}

function migrateEvent(value: unknown): ScoreEvent | null {
  const event = record(value, "ledger event") as unknown as ScoreEvent;
  if (
    typeof event.occurredAt !== "string" ||
    Date.parse(event.occurredAt) < Date.parse(SCORE_V2_EFFECTIVE_AT)
  ) {
    return event;
  }
  if (
    event.category !== "merged-pull-request" &&
    event.category !== "evaluated-contribution"
  ) {
    return null;
  }
  const scoreThirds =
    event.category === "merged-pull-request"
      ? 1
      : Math.max(1, Math.round(event.points * 3));
  return {
    ...event,
    points: scoreThirds / 3,
    scoreThirds,
    workUnitId: v2WorkUnit(event),
    reason:
      event.category === "merged-pull-request"
        ? "Accepted outcome has provisional micro credit pending immutable maintainer ratification."
        : "Reviewed evaluated contribution migrated to integer-thirds credit.",
  };
}

function rebuildLeaders(
  legacyLeaders: unknown[],
  ledger: ScoreEvent[],
  attributions: unknown[],
): LeaderboardEntry[] {
  const legacyByActor = new Map(
    legacyLeaders.map((value) => {
      const leader = record(value, "legacy leader");
      return [actorId(leader.actor), leader];
    }),
  );
  const eventsByActor = new Map<string, ScoreEvent[]>();
  for (const event of ledger) {
    const id = actorId(event.actor);
    const events = eventsByActor.get(id) ?? [];
    events.push(event);
    eventsByActor.set(id, events);
  }
  const reportedModelsByActor = new Map<string, Set<string>>();
  for (const value of attributions) {
    const attribution = record(value, "attribution");
    if (attribution.actor === null) continue;
    const id = actorId(attribution.actor);
    if (typeof attribution.identifier !== "string") {
      throw new TypeError("attribution.identifier must be a string");
    }
    const identifiers = reportedModelsByActor.get(id) ?? new Set<string>();
    identifiers.add(attribution.identifier);
    reportedModelsByActor.set(id, identifiers);
  }
  const leaders = [...eventsByActor.entries()].map(([id, events]) => {
    const legacy = legacyByActor.get(id);
    if (!legacy) throw new TypeError(`ledger actor ${id} has no legacy leader`);
    const pointThirds: LeaderboardEntry["pointThirds"] = {
      mergedPullRequests: 0,
      resolvedIssues: 0,
      materialTestChanges: 0,
      evidence: 0,
      substantiveReviews: 0,
      evaluatedContributions: 0,
    };
    const acceptedOutcomes: LeaderboardEntry["acceptedOutcomes"] = {
      mergedPullRequests: 0,
      resolvedIssues: 0,
      materialTestChanges: 0,
      evidenceCategories: 0,
      substantiveReviews: 0,
      evaluatedContributions: 0,
    };
    for (const event of events) {
      const thirds = eventThirds(event);
      if (event.category === "merged-pull-request") {
        pointThirds.mergedPullRequests += thirds;
        acceptedOutcomes.mergedPullRequests += 1;
      } else if (event.category === "resolved-issue") {
        pointThirds.resolvedIssues += thirds;
        acceptedOutcomes.resolvedIssues += 1;
      } else if (event.category === "material-test-change") {
        pointThirds.materialTestChanges += thirds;
        acceptedOutcomes.materialTestChanges += 1;
      } else if (event.category === "evidence") {
        pointThirds.evidence += thirds;
        acceptedOutcomes.evidenceCategories += 1;
      } else if (event.category === "substantive-review") {
        pointThirds.substantiveReviews += thirds;
        acceptedOutcomes.substantiveReviews += 1;
      } else {
        pointThirds.evaluatedContributions += thirds;
        acceptedOutcomes.evaluatedContributions += 1;
      }
    }
    const scoreThirds = Object.values(pointThirds).reduce(
      (total, thirds) => total + thirds,
      0,
    );
    return {
      rank: 0,
      actor: legacy.actor as LeaderboardEntry["actor"],
      score: Math.floor(scoreThirds / 3),
      scoreThirds,
      points: {
        mergedPullRequests: pointThirds.mergedPullRequests / 3,
        resolvedIssues: pointThirds.resolvedIssues / 3,
        materialTestChanges: pointThirds.materialTestChanges / 3,
        evidence: pointThirds.evidence / 3,
        substantiveReviews: pointThirds.substantiveReviews / 3,
        evaluatedContributions: pointThirds.evaluatedContributions / 3,
      },
      pointThirds,
      acceptedOutcomes,
      rawActivity: legacy.rawActivity as LeaderboardEntry["rawActivity"],
      reportedModels: [...(reportedModelsByActor.get(id) ?? [])].sort(
        (left, right) => left.localeCompare(right),
      ),
    };
  });
  leaders.sort(
    (left, right) =>
      right.scoreThirds - left.scoreThirds ||
      codeUnitCompare(
        left.actor.login.toLowerCase(),
        right.actor.login.toLowerCase(),
      ) ||
      codeUnitCompare(left.actor.login, right.actor.login) ||
      codeUnitCompare(left.actor.id, right.actor.id),
  );
  leaders.forEach((leader, index) => {
    leader.rank = index + 1;
  });
  return leaders;
}

function retainCausalAttributions(
  values: unknown[],
  ledger: ScoreEvent[],
): unknown[] {
  const causalKeys = new Set<string>();
  const resolvedArtifacts = new Set<string>();
  for (const event of ledger) {
    const id = actorId(event.actor);
    if (event.source.kind === "pull-request") {
      causalKeys.add(`${id}\0artifact\0${event.source.id}`);
    }
    if (
      (event.category === "substantive-review" &&
        event.source.kind === "review") ||
      (event.category === "evaluated-contribution" &&
        event.source.kind === "comment")
    ) {
      causalKeys.add(`${id}\0source\0${event.source.id}`);
    }
    if (event.category === "resolved-issue") {
      const separator = ":resolved-by:";
      const index = event.id.lastIndexOf(separator);
      if (index >= 0) {
        resolvedArtifacts.add(
          `${id}\0${event.id.slice(index + separator.length)}`,
        );
      }
    }
  }
  return values.filter((value) => {
    const attribution = record(value, "attribution");
    if (attribution.actor === null) return false;
    const id = actorId(attribution.actor);
    return (
      causalKeys.has(`${id}\0artifact\0${String(attribution.artifactId)}`) ||
      causalKeys.has(`${id}\0source\0${String(attribution.sourceId)}`) ||
      resolvedArtifacts.has(`${id}\0${String(attribution.artifactId)}`)
    );
  });
}

export function preparePullRequestLedger(value: unknown): LeaderboardSnapshot {
  const candidate = record(value, "snapshot");
  if (candidate.schemaVersion === LEADERBOARD_SCHEMA_VERSION) {
    const normalized = normalizeTransferredRepositories(candidate);
    assertPublishableLeaderboardSnapshot(normalized);
    return normalized as unknown as LeaderboardSnapshot;
  }
  if (candidate.schemaVersion !== "5") {
    throw new TypeError("deployed ledger is not schema 5 or 6");
  }
  const ledger = array(candidate.ledger, "snapshot.ledger")
    .map(migrateEvent)
    .filter((event): event is ScoreEvent => event !== null)
    .sort(
      (left, right) =>
        right.points - left.points ||
        left.source.number - right.source.number ||
        left.id.localeCompare(right.id),
    );
  const attributions = retainCausalAttributions(
    array(candidate.attributions, "snapshot.attributions"),
    ledger,
  );
  const snapshot = {
    ...candidate,
    schemaVersion: LEADERBOARD_SCHEMA_VERSION,
    ruleVersion: SCORE_RULE_VERSION,
    methodology: leaderboardMethodology(),
    leaders: rebuildLeaders(
      array(candidate.leaders, "snapshot.leaders"),
      ledger,
      attributions,
    ),
    ledger,
    attributions,
  };
  assertPublishableLeaderboardSnapshot(snapshot);
  return snapshot as unknown as LeaderboardSnapshot;
}

async function main(): Promise<void> {
  if (process.argv.length !== 4) {
    throw new TypeError("Usage: prepare-pr-ledger.ts <input> <output>");
  }
  const input = resolve(process.argv[2]);
  const output = resolve(process.argv[3]);
  const parsed: unknown = JSON.parse(await readFile(input, "utf8"));
  const snapshot = preparePullRequestLedger(parsed);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
    flag: "wx",
  });
  await rename(temporary, output);
  process.stdout.write(
    `[Slop] prepared schema ${snapshot.schemaVersion} pull-request ledger from deployed public data\n`,
  );
}

if (import.meta.main) {
  await main();
}
