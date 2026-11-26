import type {
  HistoricalAssessmentCatalog,
  HistoricalAssessmentScope,
  LegacyAssessmentCatalogRow,
} from "./historical-assessment-catalog";

type Scope = Pick<
  HistoricalAssessmentScope,
  "projectId" | "repositoryNodeId"
> & {
  repository: string;
};
type CatalogRow = HistoricalAssessmentCatalog["joint"][number];
type Source = {
  repositoryNodeId: string;
  pullRequestNodeId: string;
  pullRequestNumber: number;
};

const ORIGIN = "https://slopbot.slop.cash";
const PAGE_BYTES = 8 * 1024 * 1024;
const PAGE_RECORDS = 100;

function requireHistory(value: unknown): asserts value {
  if (!value)
    throw new Error(
      "Frozen historical assessment catalog is incomplete or out of scope",
    );
}

function publicRow(row: CatalogRow | LegacyAssessmentCatalogRow) {
  const { sequence, record_digest, record_json, recorded_at } = row;
  const record = { sequence, record_digest, record_json, recorded_at };
  return { record, bytes: Buffer.byteLength(JSON.stringify(record)) };
}
type Entry = ReturnType<typeof publicRow>;

function append<T>(index: Map<number, T[]>, number: number, value: T) {
  const entries = index.get(number);
  if (entries) entries.push(value);
  else index.set(number, [value]);
}

/** Feed the existing history readers from one complete, protected catalog.
 * Only fixed immutable-repository GETs are accepted. No request is forwarded. */
export function createHistoricalAssessmentTransport(
  catalog: HistoricalAssessmentCatalog,
  { projectId, repository, repositoryNodeId }: Scope,
): typeof fetch {
  const { jointThrough, legacyThrough, jointScopedCount, legacyRepoCount } =
    catalog.heads;
  requireHistory(
    repositoryNodeId.length > 0 &&
      repository.length > 0 &&
      projectId.length > 0 &&
      Number.isSafeInteger(jointThrough) &&
      jointThrough >= 0 &&
      Number.isSafeInteger(legacyThrough) &&
      legacyThrough >= 0 &&
      catalog.joint.length === jointScopedCount &&
      catalog.legacy.length === legacyRepoCount,
  );

  const byNumber = new Map<number, string>();
  const byId = new Map<string, number>();
  function bind(source: Source) {
    const { pullRequestNodeId, pullRequestNumber } = source;
    requireHistory(
      source.repositoryNodeId === repositoryNodeId &&
        typeof pullRequestNodeId === "string" &&
        pullRequestNodeId.length > 0 &&
        Number.isSafeInteger(pullRequestNumber) &&
        pullRequestNumber > 0 &&
        (byNumber.get(pullRequestNumber) ?? pullRequestNodeId) ===
          pullRequestNodeId &&
        (byId.get(pullRequestNodeId) ?? pullRequestNumber) ===
          pullRequestNumber,
    );
    byNumber.set(pullRequestNumber, pullRequestNodeId);
    byId.set(pullRequestNodeId, pullRequestNumber);
  }

  const legacy = new Map<number, Entry[]>();
  let previousSequence = 0;
  for (const row of catalog.legacy) {
    const source = JSON.parse(row.record_json) as Source & {
      projectId: string;
    };
    requireHistory(
      Number.isSafeInteger(row.sequence) &&
        row.sequence > previousSequence &&
        row.sequence <= legacyThrough &&
        row.repository_node_id === repositoryNodeId &&
        row.pull_request_node_id === source.pullRequestNodeId &&
        source.projectId === projectId,
    );
    bind(source);
    append(legacy, source.pullRequestNumber, publicRow(row));
    previousSequence = row.sequence;
  }

  const jointSeeds = new Map<number, string[]>();
  const joint = new Map<string, { entry: Entry; predecessors: string[] }>();
  previousSequence = 0;
  for (const row of catalog.joint) {
    const record = JSON.parse(row.record_json) as {
      projectId: string;
      sources: Source[];
      supersedes: string[];
    };
    requireHistory(
      Number.isSafeInteger(row.sequence) &&
        row.sequence > previousSequence &&
        row.sequence <= jointThrough &&
        !joint.has(row.record_digest) &&
        row.project_id === projectId &&
        record.projectId === projectId &&
        Array.isArray(record.sources) &&
        record.sources.length > 0 &&
        Array.isArray(record.supersedes) &&
        record.supersedes.every((digest) => joint.has(digest)),
    );
    for (const source of record.sources) {
      bind(source);
      append(jointSeeds, source.pullRequestNumber, row.record_digest);
    }
    joint.set(row.record_digest, {
      entry: publicRow(row),
      predecessors: record.supersedes,
    });
    previousSequence = row.sequence;
  }

  const jointHistories = new Map<number, Entry[]>();
  function jointHistory(number: number) {
    const known = jointHistories.get(number);
    if (known) return known;
    const pending = [...(jointSeeds.get(number) ?? [])];
    const collected = new Map<string, Entry>();
    for (const digest of pending) {
      if (collected.has(digest)) continue;
      const ancestor = joint.get(digest);
      requireHistory(ancestor);
      collected.set(digest, ancestor.entry);
      for (const predecessor of ancestor.predecessors)
        pending.push(predecessor);
    }
    const entries = [...collected.values()].sort(
      (a, b) => a.record.sequence - b.record.sequence,
    );
    if (entries.length) jointHistories.set(number, entries);
    return entries;
  }

  const transport: typeof fetch = Object.assign(
    async (input: string | URL | Request, options?: RequestInit) => {
      const url =
        input instanceof URL || typeof input === "string"
          ? new URL(input)
          : null;
      const invalid = () => new Response(null, { status: 400 });
      if (
        !url ||
        url.origin !== ORIGIN ||
        url.username ||
        url.password ||
        url.hash ||
        (options?.method !== undefined && options.method !== "GET")
      )
        return invalid();
      const isJoint = url.pathname === "/v1/work-unit-assessments";
      if (!isJoint && url.pathname !== "/v1/value-assessments")
        return invalid();
      const params = url.searchParams;
      const through = params.get("through");
      const pull = params.get("pull") ?? "";
      const cursor = params.get("after") ?? "0";
      const after = Number(cursor);
      const pullRequestNumber = Number(pull);
      const allowed = new Set(
        isJoint
          ? ["repositoryNodeId", "pull", "after", "through"]
          : ["repositoryNodeId", "pull", "after"],
      );
      if (
        [...params.keys()].some((key) => !allowed.delete(key)) ||
        params.get("repositoryNodeId") !== repositoryNodeId ||
        !/^[1-9]\d*$/u.test(pull) ||
        !Number.isSafeInteger(pullRequestNumber) ||
        !/^(0|[1-9]\d*)$/u.test(cursor) ||
        !Number.isSafeInteger(after) ||
        after > (isJoint ? jointThrough : legacyThrough) ||
        (isJoint &&
          (through !== null || after > 0) &&
          through !== String(jointThrough))
      )
        return invalid();

      const entries = isJoint
        ? jointHistory(pullRequestNumber)
        : (legacy.get(pullRequestNumber) ?? []);
      const envelope = {
        schemaVersion: isJoint
          ? "slop-work-unit-history:v1"
          : "slop-value-history:v1",
        repository,
        repositoryNodeId,
        pullRequestNumber,
        ...(isJoint
          ? { throughSequence: jointThrough, totalRecords: entries.length }
          : {}),
      };
      const records: Entry["record"][] = [];
      let bytes = Buffer.byteLength(
        JSON.stringify({
          ...envelope,
          records,
          nextAfter: Number.MAX_SAFE_INTEGER,
        }),
      );
      let nextAfter: number | null = null;
      for (const entry of entries) {
        if (entry.record.sequence <= after) continue;
        if (
          records.length === PAGE_RECORDS ||
          bytes + entry.bytes + 1 > PAGE_BYTES
        ) {
          requireHistory(records.length > 0);
          nextAfter = records[records.length - 1].sequence;
          break;
        }
        records.push(entry.record);
        bytes += entry.bytes + 1;
      }
      return Response.json({ ...envelope, records, nextAfter });
    },
    {
      preconnect() {
        /* This transport never opens a connection. */
      },
    },
  );
  return transport;
}
