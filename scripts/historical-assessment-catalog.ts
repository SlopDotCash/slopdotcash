import { createHash } from "node:crypto";

export interface HistoricalAssessmentScope {
  projectId: string;
  repositoryNodeId: string;
  revision: number;
  manifestSha256: string;
  expectedPointsDigest: string;
}

export interface HistoricalAssessmentHeads {
  jointThrough: number;
  legacyThrough: number;
  jointScopedCount: number;
  legacyRepoCount: number;
  d1PointsDigest: string;
  d1PointsCount: number;
  enforcementGeneration: number;
  registryRevision: number;
  registryManifestSha256: string;
}

interface AssessmentCatalogRow {
  sequence: number;
  record_digest: string;
  record_json: string;
  recorded_at: string;
}

export interface JointAssessmentCatalogRow extends AssessmentCatalogRow {
  project_id: string;
  source_digest: string;
  /** Ordered repository and pull request node IDs checked against the D1 index. */
  source_keys_json: string;
}

export interface LegacyAssessmentCatalogRow extends AssessmentCatalogRow {
  repository_node_id: string;
  pull_request_node_id: string;
  head_sha: string;
  source_digest: string;
  supersedes: string | null;
}

export interface HistoricalAssessmentCatalog {
  heads: HistoricalAssessmentHeads;
  joint: JointAssessmentCatalogRow[];
  legacy: LegacyAssessmentCatalogRow[];
}

type Row = Record<string, unknown>;
type Query = (sql: string) => Promise<Row[]>;
type Descriptor = { sequence: number; digest: string; bytes: number };
type CatalogSource<T> = {
  table: "slopbot_work_unit_journal" | "slopbot_value_journal";
  scopeSql: string;
  columns: string;
  through: number;
  count: number;
  decode: (row: Row, base: AssessmentCatalogRow, record: Row) => T;
};

const DESCRIPTOR_PAGE_SIZE = 100;
// D1 supports up to 2 MB per row. Bound each body page to that many raw JSON
// bytes, leaving room for JSON string escaping in Wrangler's 16 MiB output.
const BODY_PAGE_BYTES = 2_000_000;
const DIGEST = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const NODE = /^[A-Za-z0-9_=+/-]{1,256}$/u;
const PROJECT = /^[a-z0-9][a-z0-9-]{0,47}$/u;

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

function requireCatalog(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(`Historical assessment catalog: ${reason}`);
}

function record(value: unknown): Row {
  requireCatalog(
    typeof value === "object" && value !== null && !Array.isArray(value),
    "invalid database or record shape",
  );
  return value as Row;
}

function integer(value: unknown): number {
  requireCatalog(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    "invalid sequence or row count",
  );
  return value;
}

function validatedText(value: unknown, pattern: RegExp): string {
  requireCatalog(
    typeof value === "string" && pattern.test(value),
    "invalid immutable binding",
  );
  return value;
}

function parseRecord(raw: string): Row {
  try {
    return record(JSON.parse(raw));
  } catch {
    throw new Error("Historical assessment catalog: invalid stored JSON");
  }
}

function descriptorPage(
  input: Row[],
  after: number,
  through: number,
  expectedCount: number,
  seen: Set<string>,
): Descriptor[] {
  requireCatalog(
    Array.isArray(input) && input.length === expectedCount,
    "incomplete descriptor page",
  );
  let previous = after;
  return input.map((value) => {
    const row = record(value);
    const sequence = integer(row.sequence);
    const digest = validatedText(row.record_digest, DIGEST);
    const bytes = integer(row.record_bytes);
    requireCatalog(
      sequence > previous && sequence <= through && !seen.has(digest),
      "invalid descriptor cursor or identity",
    );
    requireCatalog(
      bytes > 0 &&
        bytes <= BODY_PAGE_BYTES &&
        integer(row.timestamp_bytes) <= 128,
      "record exceeds the protected read bound",
    );
    previous = sequence;
    seen.add(digest);
    return { sequence, digest, bytes };
  });
}

function bodyPages(descriptors: Descriptor[]): Descriptor[][] {
  const pages: Descriptor[][] = [];
  let page: Descriptor[] = [];
  let bytes = 0;
  for (const descriptor of descriptors) {
    if (bytes + descriptor.bytes > BODY_PAGE_BYTES) {
      pages.push(page);
      page = [];
      bytes = 0;
    }
    page.push(descriptor);
    bytes += descriptor.bytes;
  }
  if (page.length) pages.push(page);
  return pages;
}

function verifiedBody(
  value: Row,
  descriptor: Descriptor,
): AssessmentCatalogRow {
  const row = record(value);
  const raw = row.record_json;
  const recordedAt = row.recorded_at;
  requireCatalog(
    row.sequence === descriptor.sequence &&
      row.record_digest === descriptor.digest &&
      typeof raw === "string" &&
      Buffer.byteLength(raw) === descriptor.bytes &&
      hash(raw) === descriptor.digest &&
      typeof recordedAt === "string" &&
      Buffer.byteLength(recordedAt) <= 128 &&
      Number.isFinite(Date.parse(recordedAt)),
    "stored bytes do not match their descriptor",
  );
  return {
    sequence: descriptor.sequence,
    record_digest: descriptor.digest,
    record_json: raw,
    recorded_at: recordedAt,
  };
}

async function readSource<T>(
  source: CatalogSource<T>,
  query: Query,
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  const { table, scopeSql, columns, count, through, decode } = source;
  let after = 0;
  while (rows.length < count) {
    const pageSize = Math.min(DESCRIPTOR_PAGE_SIZE, count - rows.length);
    const descriptors = descriptorPage(
      await query(`SELECT r.sequence, r.record_digest,
        length(CAST(r.record_json AS BLOB)) AS record_bytes,
        length(CAST(r.recorded_at AS BLOB)) AS timestamp_bytes
      FROM ${table} r
      WHERE r.sequence > ${after} AND r.sequence <= ${through} AND (${scopeSql})
      ORDER BY r.sequence LIMIT ${pageSize}`),
      after,
      through,
      pageSize,
      seen,
    );
    for (const page of bodyPages(descriptors)) {
      const bodies =
        await query(`SELECT r.sequence, r.record_digest, r.record_json,
        r.recorded_at, ${columns}
      FROM ${table} r
      WHERE r.sequence <= ${through} AND (${scopeSql})
        AND r.sequence IN (${page.map(({ sequence }) => sequence).join(",")})
      ORDER BY r.sequence`);
      requireCatalog(
        Array.isArray(bodies) && bodies.length === page.length,
        "incomplete body page",
      );
      rows.push(
        ...bodies.map((value, index) => {
          const base = verifiedBody(value, page[index]);
          return decode(value, base, parseRecord(base.record_json));
        }),
      );
    }
    after = descriptors[descriptors.length - 1].sequence;
  }
  return rows;
}

function jointDecoder(scope: HistoricalAssessmentScope) {
  return (
    row: Row,
    base: AssessmentCatalogRow,
    value: Row,
  ): JointAssessmentCatalogRow => {
    const sourceDigest = validatedText(row.source_digest, DIGEST);
    requireCatalog(
      row.project_id === scope.projectId &&
        value.schemaVersion === "slop-work-unit-record:v1" &&
        value.projectId === scope.projectId &&
        value.sourceDigest === sourceDigest &&
        row.source_index_matches === 1 &&
        Array.isArray(value.sources) &&
        value.sources.length > 0,
      "joint record or source index differs from project scope",
    );
    const pullIds = value.sources.map((source) => {
      const item = record(source);
      requireCatalog(
        item.repositoryNodeId === scope.repositoryNodeId,
        "joint record refers to another repository",
      );
      return validatedText(item.pullRequestNodeId, NODE);
    });
    requireCatalog(
      new Set(pullIds).size === pullIds.length,
      "joint source keys are duplicated",
    );
    // Every member shares the same repo, so ordering by PR node ID makes the
    // projected immutable keys deterministic without re-reading the JSON.
    const sourceKeys = pullIds.sort().map((id) => [scope.repositoryNodeId, id]);
    return {
      ...base,
      project_id: scope.projectId,
      source_digest: sourceDigest,
      source_keys_json: JSON.stringify(sourceKeys),
    };
  };
}

function legacyDecoder(scope: HistoricalAssessmentScope) {
  return (
    row: Row,
    base: AssessmentCatalogRow,
    value: Row,
  ): LegacyAssessmentCatalogRow => {
    const pullId = validatedText(row.pull_request_node_id, NODE);
    const headSha = validatedText(row.head_sha, COMMIT);
    const sourceDigest = validatedText(row.source_digest, DIGEST);
    const supersedes =
      row.supersedes === null ? null : validatedText(row.supersedes, DIGEST);
    requireCatalog(
      row.repository_node_id === scope.repositoryNodeId &&
        value.schemaVersion === "slop-value-record:v1" &&
        value.projectId === scope.projectId &&
        value.repositoryNodeId === scope.repositoryNodeId &&
        value.pullRequestNodeId === pullId &&
        value.headSha === headSha &&
        value.sourceDigest === sourceDigest &&
        value.supersedes === supersedes,
      "legacy record differs from its indexed scope",
    );
    return {
      ...base,
      repository_node_id: scope.repositoryNodeId,
      pull_request_node_id: pullId,
      head_sha: headSha,
      source_digest: sourceDigest,
      supersedes,
    };
  };
}

const JOINT_INDEX_COLUMNS = `r.project_id, r.source_digest,
  (
    (SELECT COUNT(*) FROM slopbot_work_unit_sources s
      WHERE s.record_digest = r.record_digest)
      = json_array_length(r.record_json, '$.sources')
    AND NOT EXISTS (
      SELECT 1 FROM slopbot_work_unit_sources s
      WHERE s.record_digest = r.record_digest AND NOT EXISTS (
        SELECT 1 FROM json_each(r.record_json, '$.sources') source
        WHERE json_extract(source.value, '$.repositoryNodeId') = s.repository_node_id
          AND json_extract(source.value, '$.pullRequestNodeId') = s.pull_request_node_id
      )
    )
  ) AS source_index_matches`;

/** The protected query connection is the authority for the frozen journal. */
export async function readHistoricalAssessmentCatalog(
  requested: HistoricalAssessmentScope,
  query: Query,
): Promise<HistoricalAssessmentCatalog> {
  const scope = { ...requested };
  const projectId = quote(validatedText(scope.projectId, PROJECT));
  const repositoryNodeId = quote(validatedText(scope.repositoryNodeId, NODE));
  const revision = integer(scope.revision);
  requireCatalog(revision > 0, "registry revision is missing");
  const manifestSha256 = validatedText(scope.manifestSha256, DIGEST);
  const expectedPointsDigest = validatedText(
    scope.expectedPointsDigest,
    DIGEST,
  );
  const jointScope = `r.project_id = ${projectId} OR EXISTS (
    SELECT 1 FROM slopbot_work_unit_sources s
    WHERE s.record_digest = r.record_digest
      AND s.repository_node_id = ${repositoryNodeId})`;
  const legacyScope = `r.repository_node_id = ${repositoryNodeId}`;
  const output = await query(`SELECT h.joint_through, h.legacy_through,
    (SELECT COUNT(*) FROM slopbot_work_unit_journal r
      WHERE r.sequence <= h.joint_through AND (${jointScope})) AS joint_scoped_count,
    (SELECT COUNT(*) FROM slopbot_value_journal r
      WHERE r.sequence <= h.legacy_through AND (${legacyScope})) AS legacy_repo_count,
    checkpoint.digest AS d1_points_digest,
    checkpoint.revision_count AS d1_points_count,
    (SELECT COALESCE(MAX(rowid), 0) FROM project_enforcements) AS enforcement_generation,
    p.revision AS registry_revision, p.manifest_sha256 AS registry_manifest_sha256
  FROM (
    SELECT COALESCE((SELECT MAX(sequence) FROM slopbot_work_unit_journal), 0) AS joint_through,
      COALESCE((SELECT MAX(sequence) FROM slopbot_value_journal), 0) AS legacy_through
  ) h CROSS JOIN (
    SELECT digest, revision_count FROM points_batches
    ORDER BY revision_count DESC, generated_at DESC, digest DESC LIMIT 1
  ) checkpoint CROSS JOIN projects p
  WHERE p.id = ${projectId}
    AND p.revision = ${revision}
    AND p.manifest_sha256 = ${quote(manifestSha256)}
    AND p.status = 'active'
    AND json_extract(p.manifest, '$.authority.repositoryNodeId') = ${repositoryNodeId}
    AND json_array_length(p.manifest, '$.repositories') = 1`);
  requireCatalog(
    Array.isArray(output) && output.length === 1,
    "scope head unavailable",
  );
  const head = record(output[0]);
  const heads: HistoricalAssessmentHeads = {
    jointThrough: integer(head.joint_through),
    legacyThrough: integer(head.legacy_through),
    jointScopedCount: integer(head.joint_scoped_count),
    legacyRepoCount: integer(head.legacy_repo_count),
    d1PointsDigest: validatedText(head.d1_points_digest, DIGEST),
    d1PointsCount: integer(head.d1_points_count),
    enforcementGeneration: integer(head.enforcement_generation),
    registryRevision: integer(head.registry_revision),
    registryManifestSha256: validatedText(
      head.registry_manifest_sha256,
      DIGEST,
    ),
  };
  requireCatalog(
    heads.registryRevision === revision &&
      heads.registryManifestSha256 === manifestSha256 &&
      heads.d1PointsDigest === expectedPointsDigest &&
      heads.jointScopedCount <= heads.jointThrough &&
      heads.legacyRepoCount <= heads.legacyThrough,
    "registry, Points checkpoint or journal heads changed",
  );
  const joint = await readSource(
    {
      table: "slopbot_work_unit_journal",
      scopeSql: jointScope,
      columns: JOINT_INDEX_COLUMNS,
      count: heads.jointScopedCount,
      through: heads.jointThrough,
      decode: jointDecoder(scope),
    },
    query,
  );
  const legacy = await readSource(
    {
      table: "slopbot_value_journal",
      scopeSql: legacyScope,
      columns:
        "r.repository_node_id, r.pull_request_node_id, r.head_sha, r.source_digest, r.supersedes",
      count: heads.legacyRepoCount,
      through: heads.legacyThrough,
      decode: legacyDecoder(scope),
    },
    query,
  );
  return { heads, joint, legacy };
}
