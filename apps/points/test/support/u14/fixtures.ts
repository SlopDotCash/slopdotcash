export const author = { id: "U_kgDOauthor", login: "author", kind: "User" } as const;
export const carrier = { id: "U_kgDOcarrier", login: "carrier", kind: "User" } as const;
export const baseGeneratedAt = "2026-11-10T00:00:00.000Z";
export const collectedAt = "2026-11-10T00:00:00.000Z";
export const censusDigest = "c".repeat(64);
export const receiptSchema = "slop-implementation-correction-collection-v1";
export const correctionRule = "historical-implementation-allocation-v1";

export interface Pool {
  readonly project: string;
  readonly repository: string;
  readonly repositoryNodeId: string;
  readonly source: string;
  readonly number: number;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly transaction: string;
}

export const alpha: Pool = { project: "alpha", repository: "acme/alpha", repositoryNodeId: "R_kgDOalpha", source: "PR_kwDOalpha01", number: 1, occurredAt: "2026-09-10T12:00:00.000Z", recordedAt: "2026-10-01T00:00:00.000Z", transaction: "0x01" };
export const beta: Pool = { project: "beta", repository: "acme/beta", repositoryNodeId: "R_kgDObeta", source: "PR_kwDObeta002", number: 2, occurredAt: "2026-10-05T12:00:00.000Z", recordedAt: "2026-10-06T00:00:00.000Z", transaction: "0x02" };
export const gamma: Pool = { project: "gamma", repository: "acme/gamma", repositoryNodeId: "R_kgDOgamma", source: "PR_kwDOgamma03", number: 3, occurredAt: "2026-10-08T12:00:00.000Z", recordedAt: "2026-10-09T00:00:00.000Z", transaction: "0x03" };

export const registry = JSON.stringify({
  projects: [alpha, beta, gamma].map((pool) => ({ id: pool.project, repositories: [{ id: pool.repository }] })),
});

/** @throws {never} */
export function urlOf(pool: Pool): string {
  return `https://github.com/${pool.repository}/pull/${pool.number}`;
}

/** @throws {never} */
export function sourceOf(pool: Pool) {
  const first = "1".repeat(39) + String(pool.number);
  const head = "2".repeat(39) + String(pool.number);
  const commit = (sha: string, additions: number, deletions: number) => ({ sha, parentCount: 1, author, additions, deletions, firstAcceptedSourceId: pool.source });
  return {
    repository: pool.repository,
    repositoryNodeId: pool.repositoryNodeId,
    sourceId: pool.source,
    sourceUrl: urlOf(pool),
    headSha: head,
    occurredAt: pool.occurredAt,
    author: carrier,
    complete: true,
    commitCount: 2,
    commits: [commit(first, 10, 2), commit(head, 5, 0)],
  };
}

/** @throws {never} */
export function transferSql(pool: Pool): string {
  return `INSERT INTO payment_direct_transfers (network, transaction_id, project_id, contribution_month, github_user_id, github_node_id, github_login, chain, recipient, amount_micro, block_time, block_id, source_path, imported_at) VALUES ('base-mainnet', '${pool.transaction}', '${pool.project}', '${pool.occurredAt.slice(0, 7)}', '101', 'MDQ6VXNlcjEwMQ==', 'alice', 'base', '0x0000000000000000000000000000000000000001', '1000000', '2026-10-25T00:00:00.000Z', '1', 'direct/${pool.project}.json', '2026-10-25T00:00:00.000Z')`;
}
