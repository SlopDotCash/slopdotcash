import {
  REGISTERED_REPOSITORIES,
  type TargetRepository,
} from "../../src/lib/repositories.mjs";
import type { D1Database } from "./persistence";
import { collectValueContext } from "./value-context";
import { collectValueEvidence } from "./value-evidence";
import { latestValueRecord } from "./value-journal";
import { loadValuePolicy, type ValueClient } from "./value-publication";
import type { WorkUnitSource } from "./value-work-unit";
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

/** Follow current references and retained joint membership. Bounds are a
 * collection limit, not a scoring cap: an unfinished group remains pending.
 */
export async function collectValueGroup(
  db: D1Database,
  github: ValueClient,
  seed: WorkUnitSource,
  authorize: (source: Identity) => Promise<boolean>,
  startAt: number,
  repositories: readonly TargetRepository[] = REGISTERED_REPOSITORIES,
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
        [r.id, ...r.aliases].some(
          (id) => id.toLowerCase() === selected.repository.toLowerCase(),
        ),
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
      evidence.pull.state !== "closed" ||
      evidence.limitations.length
    )
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
    if (evidence.limitations.length) return null;
    const [owner, repo] = repository.id.split("/");
    const policy =
      position === 0
        ? seed.policy
        : await loadValuePolicy(github, owner, repo, evidence.pull.base.sha);
    sources.set(key, { evidence, policy });
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
