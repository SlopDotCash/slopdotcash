import type {
  HistoricalLeaderboardScope,
  LeaderboardInput,
} from "../src/lib/leaderboard";
import { readWorkUnitHistory } from "../workers/slopbot/value-work-unit-consumption";
import {
  assertHistoricalClosedBindings,
  type HistoricalClosedContextBindings,
  type HistoricalEmptyLegacyClosureBindings,
} from "./historical-merged-replay";
import { fetchWorkUnitHistoryPage, loadValueInputs } from "./value-ingestion";

/** Check authenticated, canonically hydrated closed bindings before scoring.
 * The catalog and closures come from the trusted historical reconciliation and
 * existing closed census. This check produces no snapshot or award changes. */
export async function preflightHistoricalClosedBindings({
  history,
  scope,
  closed,
  approved,
  emptyLegacy,
  github,
}: {
  history: typeof fetch;
  scope: Pick<HistoricalLeaderboardScope, "repository" | "repositoryNodeId">;
  closed: NonNullable<LeaderboardInput["closedUnmergedPullRequests"]>;
  approved: HistoricalClosedContextBindings;
  emptyLegacy: HistoricalEmptyLegacyClosureBindings;
  github: Parameters<typeof loadValueInputs>[0];
}): Promise<void> {
  const jointValueDecisions = new Map<
    string,
    { latestDigest: string; status?: string }
  >();
  const strict = new Set<string>();
  for (const [id, { number, digest }] of new Map([
    ...emptyLegacy,
    ...approved,
  ])) {
    const { current } = await readWorkUnitHistory(
      (after, through) =>
        fetchWorkUnitHistoryPage(
          scope.repository,
          number,
          after,
          through,
          history,
          scope.repositoryNodeId,
        ),
      { repositoryNodeId: scope.repositoryNodeId, pullRequestNodeId: id },
    );
    if (current) {
      jointValueDecisions.set(id, { latestDigest: current.row.record_digest });
      if (
        approved.get(id)?.standaloneReview &&
        current.row.record_digest === digest &&
        current.record.sources.length === 1
      )
        strict.add(id);
    } else if (emptyLegacy.has(id)) {
      strict.add(id);
    }
  }

  // Only true standalone decisions and empty legacy records need current
  // evidence. Neither contributes to the accepted-commit attribution census.
  const strictOutcomes = closed.filter(({ id }) => strict.has(id));
  const evidence = strictOutcomes.length
    ? await loadValueInputs(
        github,
        strictOutcomes,
        history,
        undefined,
        [],
        undefined,
        undefined,
        1,
        approved,
      )
    : undefined;
  for (const [id, decision] of evidence?.jointValueDecisions ?? [])
    if (decision.latestDigest !== null)
      jointValueDecisions.set(id, {
        latestDigest: decision.latestDigest,
        status: decision.status,
      });
  assertHistoricalClosedBindings(
    {
      closedUnmergedPullRequests: closed,
      jointValueDecisions,
      valueDecisions: evidence?.valueDecisions,
    },
    approved,
    emptyLegacy,
  );
}
