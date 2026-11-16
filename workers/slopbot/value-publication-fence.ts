import {
  CloudflareProjectPersistence,
  type ProjectD1Database,
} from "../../backend/projects/cloudflare-persistence";
import type { Job } from "./contracts";
import type { D1TransactionalDatabase } from "./persistence";
import { registeredProject } from "./registry";
import type { ValueClaim } from "./value-processing";
import { valueSourceScopeKeys } from "./value-source-leases";

export type ValuePublicationFence = {
  projectId: string;
  revision: number;
  manifestSha256: string;
  enforcementGeneration: number;
  repositoryKeys: string[];
  lease?: { claim: ValueClaim; sourceKeys: string };
};

export function fenceValueClaim(
  fence: ValuePublicationFence,
  claim: ValueClaim | undefined,
  sources: readonly {
    repositoryDatabaseId: number;
    pullRequestNumber: number;
  }[],
): ValuePublicationFence {
  return claim
    ? { ...fence, lease: { claim, sourceKeys: valueSourceScopeKeys(sources) } }
    : fence;
}

/** Capture before the source/authority reads. The journal INSERT compares the
 * same version and restriction generation, so a later pause or ban wins even
 * after the publisher's last awaited authority check. */
export async function registeredValuePublication(
  db: D1TransactionalDatabase,
  job: Pick<Job, "owner" | "repo" | "repositoryId">,
  repositoryKeys = [`${job.owner}/${job.repo}`],
) {
  // The same D1 binding supplies query statements to registeredProject.
  // These persistence methods read only; they do not require a new transaction.
  const projects = new CloudflareProjectPersistence(db as ProjectD1Database);
  const enforcementGeneration = await projects.enforcementGeneration();
  const project = await registeredProject(db, job);
  if (!project) return null;
  const current = await projects.getProject(project.id);
  if (
    current?.status !== "active" ||
    JSON.stringify(current.manifest) !== JSON.stringify(project)
  )
    return null;
  return {
    project,
    fence: {
      projectId: current.id,
      revision: current.revision,
      manifestSha256: current.manifestSha256,
      enforcementGeneration,
      repositoryKeys: [
        ...new Set(repositoryKeys.map((key) => key.toLowerCase())),
      ],
    } satisfies ValuePublicationFence,
  };
}

/** All predicates execute with the INSERT, not in an earlier SELECT. */
export const VALUE_PUBLICATION_FENCE_SQL = `(? IS NULL OR EXISTS (
  SELECT 1 FROM projects p
  WHERE p.id=? AND p.revision=? AND p.manifest_sha256=?
    AND p.status='active' AND json_extract(p.manifest,'$.status')='active'
    AND json_extract(p.manifest,'$.listingTier')<>'retired'
    AND (SELECT COALESCE(MAX(rowid),0) FROM project_enforcements)=?
    AND NOT EXISTS (
      SELECT 1 FROM json_each(?) required
      WHERE NOT EXISTS (SELECT 1 FROM project_repositories r
        WHERE r.project_id=p.id AND r.repository_key=required.value)
    )
)) AND (? IS NULL OR EXISTS (
  SELECT 1 FROM slopbot_value_processing owner
  WHERE owner.delivery_id=? AND owner.claim_token=? AND owner.state='running'
    AND owner.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND NOT EXISTS (
      SELECT 1 FROM json_each(?) wanted
      WHERE NOT EXISTS (
        SELECT 1 FROM slopbot_value_source_leases held
        WHERE held.scope_key=wanted.value AND held.delivery_id=owner.delivery_id
          AND held.claim_token=owner.claim_token
          AND held.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
))`;

export const valuePublicationFenceValues = (fence?: ValuePublicationFence) => {
  return [
    fence?.projectId ?? null,
    fence?.projectId ?? null,
    fence?.revision ?? null,
    fence?.manifestSha256 ?? null,
    fence?.enforcementGeneration ?? null,
    JSON.stringify(fence?.repositoryKeys ?? []),
    fence?.lease?.claim.deliveryId ?? null,
    fence?.lease?.claim.deliveryId ?? null,
    fence?.lease?.claim.token ?? null,
    fence?.lease?.sourceKeys ?? "[]",
  ];
};
