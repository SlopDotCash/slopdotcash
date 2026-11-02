import type { TargetRepository } from "../../src/lib/repositories.mjs";
import type { D1Database } from "./persistence";
import {
  type AcceptedCommitCensus,
  collectAcceptedCommitCensus,
} from "./value-accepted-commit-census";
import { collectValueContext } from "./value-context";
import {
  collectValueEvidence,
  namesRepository,
  type ValueEvidence,
} from "./value-evidence";
import { latestValueRecord } from "./value-journal";
import { noChangePromotionDeferralOnly } from "./value-no-change-promotion";
import { loadValuePolicy, type ValueClient } from "./value-publication";
import {
  acceptedWorkUnitCommits,
  type WorkUnitSource,
} from "./value-work-unit";
import {
  currentWorkUnitRecord,
  type WorkUnitRecord,
} from "./value-work-unit-journal";

type Selection = { repository: string; number: number; nodeId: string };
type Identity = {
  repository: string;
  repositoryDatabaseId: number;
  repositoryNodeId: string;
};

/** GitHub's commit associations are discovery evidence, not acceptance or
 * credit proof. Every discovered member still passes full source collection.
 */
async function acceptedCommitCarriers(
  github: ValueClient,
  evidence: ValueEvidence,
  cache: Map<string, Selection[]>,
): Promise<Selection[] | null> {
  if (!evidence.pull.merged_at && !evidence.indirectAcceptance) return [];
  const shas = new Set(
    acceptedWorkUnitCommits(evidence).map((commit) => commit.sha),
  );
  if (evidence.pull.merged_at && evidence.mergeCommitEvidence)
    shas.add(evidence.mergeCommitEvidence.sha);
  const carriers = new Map<string, Selection>();
  for (const sha of shas) {
    const key = `${evidence.repositoryNodeId}:${sha}`;
    let matches = cache.get(key);
    if (!matches) {
      matches = [];
      for (let page = 1; ; page++) {
        const pulls = await github.get<
          {
            node_id: string;
            number: number;
            html_url: string;
            state: string;
            merged_at: string | null;
            base: {
              repo: {
                id: number;
                node_id: string;
                full_name: string;
                private: boolean;
              };
            };
          }[]
        >(
          `/repos/${evidence.repository}/commits/${sha}/pulls?per_page=100&page=${page}`,
        );
        if (!Array.isArray(pulls)) return null;
        for (const pull of pulls) {
          if (pull.state !== "closed" || pull.merged_at === null) continue;
          const repo = pull.base?.repo;
          if (
            !pull.node_id ||
            !Number.isSafeInteger(pull.number) ||
            pull.number <= 0 ||
            !Number.isFinite(Date.parse(pull.merged_at)) ||
            !repo ||
            repo.private !== false ||
            repo.id !== evidence.repositoryDatabaseId ||
            repo.node_id !== evidence.repositoryNodeId ||
            repo.full_name.toLowerCase() !==
              evidence.repository.toLowerCase() ||
            pull.html_url !==
              `https://github.com/${repo.full_name}/pull/${pull.number}`
          )
            return null;
          matches.push({
            repository: evidence.repository,
            number: pull.number,
            nodeId: pull.node_id,
          });
        }
        if (pulls.length < 100) break;
      }
      cache.set(key, matches);
    }
    for (const match of matches) carriers.set(match.nodeId, match);
  }
  return [...carriers.values()];
}

/** Follow current references and retained joint membership. Bounds are a
 * collection limit, not a scoring cap: an unfinished group remains pending.
 */
export async function collectValueGroup(
  db: D1Database,
  github: ValueClient,
  seed: WorkUnitSource,
  authorize: (source: Identity) => Promise<boolean>,
  startAt: number,
  repositories: readonly TargetRepository[],
): Promise<WorkUnitSource[] | null> {
  const root = repositories.find((r) => r.id === seed.evidence.repository);
  if (!root) return null;
  const queue: Selection[] = [
    {
      repository: root.id,
      number: seed.evidence.pull.number,
      nodeId: seed.evidence.pull.node_id,
    },
  ];
  const sources = new Map<string, WorkUnitSource>();
  const commitCarriers = new Map<string, Selection[]>();
  const censuses = new Map<string, AcceptedCommitCensus>();
  for (let position = 0; position < queue.length; position++) {
    const selected = queue[position];
    const key = `${selected.repository.toLowerCase()}#${selected.number}`;
    const prior = sources.get(key);
    if (prior) {
      if (prior.evidence.pull.node_id !== selected.nodeId) return null;
      continue;
    }
    if (sources.size >= 32) return null;
    const repository = repositories.find(
      (r) =>
        r.projectId === root.projectId &&
        namesRepository(r, selected.repository),
    );
    if (!repository) return null;
    const identity = await github.get<{
      id: number;
      node_id: string;
      private: boolean;
    }>(`/repos/${repository.id}`);
    if (
      !identity ||
      identity.private ||
      !(await authorize({
        repository: repository.id,
        repositoryDatabaseId: identity.id,
        repositoryNodeId: identity.node_id,
      }))
    )
      return null;
    let evidence =
      position === 0
        ? seed.evidence
        : await collectValueEvidence(
            github,
            repository.id,
            selected.number,
            repository,
          );
    if (
      evidence.pull.node_id !== selected.nodeId ||
      evidence.repositoryDatabaseId !== identity.id ||
      evidence.repositoryNodeId !== identity.node_id ||
      evidence.pull.state !== "closed"
    )
      return null;
    // A proven no-change promotion's only limitation is its joint deferral;
    // joint preparation drops it, so the source may enter the group.
    if (evidence.limitations.length && !noChangePromotionDeferralOnly(evidence))
      return null;
    const occurred = Date.parse(
      evidence.pull.merged_at ??
        evidence.indirectAcceptance?.observedOnBranchAt ??
        evidence.pull.closed_at ??
        "",
    );
    if (!Number.isFinite(occurred) || occurred < startAt) return null;
    const previous = await currentWorkUnitRecord(
      db,
      evidence.repositoryNodeId,
      evidence.pull.node_id,
    );
    const group: WorkUnitRecord | null = previous
      ? JSON.parse(previous.record_json)
      : null;
    const legacy = await latestValueRecord(
      db,
      evidence.repositoryNodeId,
      evidence.pull.node_id,
    );
    const retained = group?.sources.find(
      (s) => s.pullRequestNodeId === evidence.pull.node_id,
    );
    const context =
      retained?.contextPaths ??
      (legacy ? JSON.parse(legacy.record_json).contextPaths : undefined) ??
      [];
    if (context.length)
      evidence = await collectValueContext(github, evidence, context);
    if (evidence.limitations.length && !noChangePromotionDeferralOnly(evidence))
      return null;
    const [owner, repo] = repository.id.split("/");
    const policy =
      position === 0
        ? seed.policy
        : await loadValuePolicy(github, owner, repo, evidence.pull.base.sha);
    sources.set(key, { evidence, policy });
    const carriers = await acceptedCommitCarriers(
      github,
      evidence,
      commitCarriers,
    );
    if (carriers === null) return null;
    queue.push(...carriers);
    if (evidence.pull.merged_at || evidence.indirectAcceptance) {
      let census = censuses.get(evidence.repositoryNodeId);
      if (!census) {
        const collected = await collectAcceptedCommitCensus(
          github,
          evidence,
          startAt,
        );
        if (collected === null) return null;
        census = collected;
        censuses.set(evidence.repositoryNodeId, census);
      }
      if (evidence.pull.merged_at && !census.ids.has(evidence.pull.node_id))
        return null;
      for (const commit of acceptedWorkUnitCommits(evidence)) {
        queue.push(...(census.carriers.get(commit.sha) ?? []));
      }
      if (evidence.mergeCommitEvidence)
        queue.push(
          ...(census.carriers.get(evidence.mergeCommitEvidence.sha) ?? []),
        );
    }
    for (const related of evidence.relatedPullRequests)
      queue.push({
        repository: related.repository,
        number: related.number,
        nodeId: related.id,
      });
    for (const sibling of group?.sources ?? [])
      queue.push({
        repository: sibling.repository,
        number: sibling.pullRequestNumber,
        nodeId: sibling.pullRequestNodeId,
      });
  }
  return [...sources.values()];
}
