import type { LeaderboardSnapshot } from "../leaderboard-types";
import {
  repositoriesCountedFor,
  repositoryIdentity,
} from "../project-repositories.mjs";
import {
  findHistoricalProject,
  findHistoricalRepository,
  type ProjectDefinition,
} from "../projects.mjs";
import { readRecord } from "../record-validation.mjs";
import { sha256Hex } from "../sha256";

export const ASI_NOVEMBER_CLOSEOUT = {
  projectId: "asi",
  period: "2026-11",
  cutoff: "2026-11-19T00:00:00.000Z",
  grossBase: "150000000",
  chain: "robinhood",
  network: "robinhood-mainnet",
  assetSymbol: "USDG",
  assetDecimals: 6,
} as const;

export interface AsiHeldWorkUnitRecord {
  recordDigest: string;
  projectId: string;
  recordJson: string;
  sourceKeys: string;
}

function sameUniqueMembers(left: readonly string[], right: readonly string[]) {
  const rightMembers = new Set(right);
  return (
    new Set(left).size === left.length &&
    rightMembers.size === right.length &&
    left.length === right.length &&
    left.every((member) => rightMembers.has(member))
  );
}

export function asiHeldSourcesAreDisjoint(
  snapshot: LeaderboardSnapshot,
  asi: ProjectDefinition,
  records: readonly AsiHeldWorkUnitRecord[],
): boolean {
  const held = snapshot.source.heldWorkUnits ?? [];
  const unavailable = snapshot.source.unavailableSources ?? [];
  if (held.length === 0)
    return unavailable.length === 0 && records.length === 0;
  if (held.length !== records.length) return false;

  const counted = repositoriesCountedFor(
    asi,
    Date.parse(`${ASI_NOVEMBER_CLOSEOUT.period}-01T00:00:00.000Z`),
  );
  const asiNodes = new Set<string>();
  for (const repository of counted) {
    const identity = repositoryIdentity(asi, repository.id);
    if (!identity) return false;
    asiNodes.add(identity.nodeId);
  }
  if (asiNodes.size === 0) return false;

  const byDigest = new Map(
    records.map((record) => [record.recordDigest, record]),
  );
  if (byDigest.size !== records.length) return false;
  const seenMembers = new Set<string>();
  const unavailableMembers: string[] = [];
  for (const unit of held) {
    const row = byDigest.get(unit.recordDigest);
    if (
      !row ||
      row.projectId === asi.id ||
      sha256Hex(row.recordJson) !== unit.recordDigest
    )
      return false;
    const record = readRecord(JSON.parse(row.recordJson), "held work unit");
    if (
      record.schemaVersion !== "slop-work-unit-record:v1" ||
      record.projectId !== row.projectId ||
      typeof record.sourceDigest !== "string" ||
      !/^[a-f0-9]{64}$/u.test(record.sourceDigest) ||
      !Array.isArray(record.sources)
    )
      return false;
    const members: string[] = [];
    const sourceKeys: string[] = [];
    for (const value of record.sources) {
      const source = readRecord(value, "held work unit source");
      if (
        typeof source.repository !== "string" ||
        typeof source.repositoryNodeId !== "string" ||
        typeof source.pullRequestNodeId !== "string" ||
        !source.pullRequestNodeId ||
        seenMembers.has(source.pullRequestNodeId) ||
        typeof source.pullRequestNumber !== "number" ||
        !Number.isSafeInteger(source.pullRequestNumber) ||
        source.pullRequestNumber < 1 ||
        typeof source.repositoryDatabaseId !== "number" ||
        !Number.isSafeInteger(source.repositoryDatabaseId) ||
        source.repositoryDatabaseId < 1 ||
        asiNodes.has(source.repositoryNodeId)
      )
        return false;
      const registered = findHistoricalRepository(source.repository);
      const owner = registered && findHistoricalProject(registered.projectId);
      const identity = owner && repositoryIdentity(owner, source.repository);
      if (
        !registered ||
        registered.projectId !== row.projectId ||
        !identity ||
        identity.nodeId !== source.repositoryNodeId ||
        String(identity.githubId) !== String(source.repositoryDatabaseId)
      )
        return false;
      seenMembers.add(source.pullRequestNodeId);
      members.push(source.pullRequestNodeId);
      sourceKeys.push(
        JSON.stringify([identity.nodeId, source.pullRequestNodeId]),
      );
    }
    const indexed: unknown = JSON.parse(row.sourceKeys);
    if (
      !Array.isArray(indexed) ||
      !sameUniqueMembers(members, unit.sourceNodeIds) ||
      !sameUniqueMembers(
        sourceKeys,
        indexed.map((key: unknown) => JSON.stringify(key)),
      )
    )
      return false;
    unavailableMembers.push(...unit.unavailableNodeIds);
  }
  return sameUniqueMembers(
    unavailableMembers,
    unavailable.map((source) => source.nodeId),
  );
}
