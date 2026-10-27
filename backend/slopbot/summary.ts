import type { D1TransactionalDatabase as D1Database } from "../d1";
import { json } from "../http";

/** Public per-repository Slopbot aggregates (PRD BOT-07, LDR-04). */
export interface SlopbotRepositorySummary {
  installationIds: number[];
  repositoryId: number;
  itemsReviewed: number;
  itemsBlocked: number;
  itemsLabeled: number;
  itemsClosed: number;
  closuresReopened: number;
  closuresAppealed: number;
  lastActivityAt: string | null;
}

const PUBLIC_CACHE_CONTROL = "public, max-age=60";

// Counts and sums only: no verdicts, comment bodies, authors, or item IDs leave
// the database. Skipped and running reviews are excluded, so private
// repositories (always skipped) never appear.
const SUMMARY_QUERY = `WITH base AS (
  SELECT installation_id, repository_id, item_node_id, status, COALESCE(completed_at, created_at) AS at
  FROM slopbot_reviews WHERE status IN ('completed','failed')
), repos AS (
  SELECT repository_id, MAX(at) AS at FROM base GROUP BY repository_id
), closed AS (
  SELECT repository_id, item_node_id, MIN(created_at) AS at FROM slopbot_actions
  WHERE action = 'close' GROUP BY repository_id, item_node_id
)
SELECT json_group_array(json_object(
  'installationIds', json((SELECT json_group_array(installation_id) FROM
    (SELECT DISTINCT installation_id FROM base b WHERE b.repository_id = r.repository_id ORDER BY installation_id))),
  'repositoryId', r.repository_id,
  'itemsReviewed', (SELECT COUNT(DISTINCT b.item_node_id) FROM base b
    WHERE b.repository_id = r.repository_id AND b.status = 'completed'),
  'itemsBlocked', (SELECT COUNT(DISTINCT v.item_node_id) FROM slopbot_reviews v
    JOIN slopbot_budget_blocks b ON b.review_key=v.review_key AND b.claim_token=v.claim_token
    WHERE v.repository_id=r.repository_id AND v.status='failed'
      AND NOT EXISTS(SELECT 1 FROM slopbot_reviews newer
        WHERE newer.repository_id=v.repository_id AND newer.item_node_id=v.item_node_id AND newer.rowid>v.rowid)),
  'itemsLabeled', (SELECT COUNT(DISTINCT a.item_node_id) FROM slopbot_actions a
    WHERE a.repository_id = r.repository_id AND a.action = 'label'),
  'itemsClosed', (SELECT COUNT(*) FROM closed c WHERE c.repository_id = r.repository_id),
  'closuresReopened', (SELECT COUNT(DISTINCT a.item_node_id) FROM slopbot_actions a
    JOIN closed c ON c.repository_id = a.repository_id AND c.item_node_id = a.item_node_id
    WHERE a.repository_id = r.repository_id AND a.action = 'human_reopen' AND a.created_at >= c.at),
  'closuresAppealed', (SELECT COUNT(DISTINCT a.item_node_id) FROM slopbot_actions a
    JOIN closed c ON c.repository_id = a.repository_id AND c.item_node_id = a.item_node_id
    WHERE a.repository_id = r.repository_id AND a.action = 'appeal' AND a.created_at >= c.at),
  'lastActivityAt', MAX(r.at, COALESCE((SELECT MAX(a.created_at) FROM slopbot_actions a
    WHERE a.repository_id = r.repository_id), ''))
)) AS items FROM (SELECT * FROM repos ORDER BY repository_id) r`;

export async function handleSlopbotApi(
  request: Request,
  db: D1Database,
): Promise<Response> {
  const route = new URL(request.url).pathname.replace("/api/v1/slopbot", "");
  if (route !== "/summary")
    return json(
      404,
      { error: "not_found" },
      { cacheControl: PUBLIC_CACHE_CONTROL },
    );
  if (request.method !== "GET")
    return json(
      405,
      { error: "method_not_allowed" },
      { cacheControl: PUBLIC_CACHE_CONTROL, headers: { allow: "GET" } },
    );
  try {
    const row = await db.prepare(SUMMARY_QUERY).first<{ items: string }>();
    const repositories = JSON.parse(
      row?.items ?? "[]",
    ) as SlopbotRepositorySummary[];
    return json(
      200,
      {
        generatedAt: new Date().toISOString(),
        repositories: repositories.map((repository) => ({
          ...repository,
          lastActivityAt: repository.lastActivityAt || null,
        })),
      },
      { cacheControl: PUBLIC_CACHE_CONTROL },
    );
  } catch {
    console.error("Slopbot summary API failure");
    return json(503, { error: "unavailable" }, { cacheControl: "no-store" });
  }
}
