// spec/operations/recordPublication.md, "Every release rebuilds /data/record.json without failing the release and never drops a published receipt"
export const REPO = "SlopDotCash/slopdotcash";
export const ARCHIVE_REF = "109c7640298f9e0652eed9056e78705b776f79a6";
export const SOURCES = {
  leaderboard: "https://slop.cash/data/leaderboard.json",
  registry: "https://slop.cash/api/v1/projects",
  raw: `https://raw.githubusercontent.com/${REPO}/${ARCHIVE_REF}/`,
  api: `https://api.github.com/repos/${REPO}/contents/`,
  proposal: "cycles/eliza/2026-07/proposal.json",
} as const;
export const HISTORICAL_MONTHS = ["2026-07", "2026-08"] as const;
export const CYCLE_FILES = [
  "proposal.json",
  "allocation.json",
  "execution-plan.json",
  "transactions.json",
  "settlement.json",
  "windup.json",
] as const;

export type JsonFetcher = (url: string) => Promise<unknown>;
export type BytesFetcher = (url: string) => Promise<Uint8Array>;

export interface RecordCycleSource {
  readonly projectId: string;
  readonly month: string;
  readonly files: ReadonlyArray<string>;
}

export interface RecordSources {
  readonly projects: ReadonlyArray<string>;
  readonly projectSource?: string;
  readonly disclosures: ReadonlyArray<string>;
  readonly cycles: ReadonlyArray<RecordCycleSource>;
}

export interface CycleSnapshotCounts {
  readonly merged: number;
  readonly reviews: number;
  readonly calendarMerged: number;
  readonly calendarReviews: number;
}

interface RawRecord {
  readonly [key: string]: unknown;
}

function asRecord(value: unknown): RawRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function asArray(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function usdc(minor: unknown): number {
  if (typeof minor === "bigint") return Number(minor) / 1e6;
  if (typeof minor === "number" && Number.isSafeInteger(minor)) return Number(BigInt(minor)) / 1e6;
  if (typeof minor === "string" && /^-?\d+$/u.test(minor)) return Number(BigInt(minor)) / 1e6;
  return 0;
}

const PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  "openai-codex": "openai",
  "z.ai": "zai",
  "z-ai": "zai",
  "moonshot-ai": "moonshotai",
  spacexai: "xai",
  "x-ai": "xai",
};

function modelKey(provider: unknown, model: unknown): string {
  const p0 = asString(provider).trim().toLowerCase();
  const p = PROVIDER_ALIASES[p0] ?? p0;
  let m = asString(model).trim().toLowerCase();
  for (const pre of [
    p,
    ...Object.keys(PROVIDER_ALIASES).filter((alias) => PROVIDER_ALIASES[alias] === p),
  ]) {
    if (m.startsWith(`${pre}/`)) {
      m = m.slice(pre.length + 1);
      break;
    }
  }
  m = m.replaceAll(/(^|[a-z]-)(\d)-(\d)(?!\d)/gu, "$1$2.$3");
  return `${p}/${m}`;
}

interface ModelBucket {
  readonly key: string;
  declarations: number;
  readonly contributors: Set<string>;
  readonly merged: Set<string>;
  readonly signedMerged: Set<string>;
  reviews: number;
  readonly byActor: Map<string, number>;
}

export function aggregateModels(lbInput: unknown) {
  const lb = asRecord(lbInput) ?? {};
  const keyOf = new Map<RawRecord, string>();
  const bySource = new Map<string, RawRecord[]>();
  const byArtifact = new Map<string, RawRecord[]>();
  const models = new Map<string, ModelBucket>();
  const clients = new Set<string>();
  const push = (map: Map<string, RawRecord[]>, k: string, v: RawRecord) => {
    const existing = map.get(k);
    if (existing === undefined) map.set(k, [v]);
    else existing.push(v);
  };
  const declaring = new Set<string>();
  let unavailable = 0;
  let declarations = 0;
  let signedDeclarations = 0;
  for (const entry of asArray(lb.attributions)) {
    const a = asRecord(entry);
    if (a === null) continue;
    const run = asRecord(a.run);
    if (run !== null) signedDeclarations += 1;
    if (typeof a.model === "string" && a.model.toLowerCase() === "unavailable") {
      unavailable += 1;
      continue;
    }
    declarations += 1;
    const key = modelKey(a.provider, a.model);
    keyOf.set(a, key);
    if (typeof a.sourceId === "string") push(bySource, a.sourceId, a);
    if (typeof a.artifactId === "string") push(byArtifact, a.artifactId, a);
    let bucket = models.get(key);
    if (bucket === undefined) {
      bucket = {
        key,
        declarations: 0,
        contributors: new Set(),
        merged: new Set(),
        signedMerged: new Set(),
        reviews: 0,
        byActor: new Map(),
      };
      models.set(key, bucket);
    }
    bucket.declarations += 1;
    const actor = asNullableString(asRecord(a.actor)?.id);
    if (actor !== null) {
      bucket.contributors.add(actor);
      declaring.add(actor);
    }
    const client = typeof run?.client === "string" && run.client.trim() !== "" ? run.client.trim().toLowerCase() : null;
    if (client !== null) clients.add(client);
  }

  const mergedIds = new Set<string>();
  const mergedWithModel = new Set<string>();
  const mergedWithSigned = new Set<string>();
  let acceptedReviews = 0;
  let reviewsWithModel = 0;
  for (const entry of asArray(lb.ledger)) {
    const e = asRecord(entry);
    if (e === null) continue;
    const isPr = e.category === "merged-pull-request";
    const sourceId = asString(asRecord(e.source)?.id);
    const actorId = asString(asRecord(e.actor)?.id);
    if (isPr) mergedIds.add(sourceId);
    else if (e.category === "substantive-review") acceptedReviews += 1;
    else continue;
    const own = ((isPr ? byArtifact : bySource).get(sourceId) ?? []).filter(
      (a) => asRecord(a.actor)?.id === actorId,
    );
    const keys = [...new Set(own.map((a) => keyOf.get(a)))].filter(
      (k): k is string => typeof k === "string",
    );
    if (keys.length === 0) continue;
    if (isPr) {
      mergedWithModel.add(sourceId);
      if (own.some((a) => asRecord(a.run) !== null)) mergedWithSigned.add(sourceId);
    } else {
      reviewsWithModel += 1;
    }
    for (const k of keys) {
      const bucket = models.get(k);
      if (bucket === undefined) continue;
      if (isPr) {
        bucket.merged.add(sourceId);
        if (own.some((a) => asRecord(a.run) !== null && keyOf.get(a) === k)) {
          bucket.signedMerged.add(sourceId);
        }
      } else {
        bucket.reviews += 1;
      }
      bucket.byActor.set(actorId, (bucket.byActor.get(actorId) ?? 0) + 1);
    }
  }

  const rows = [...models.values()]
    .map((bucket) => {
      const outcomes = [...bucket.byActor.values()].reduce((sum, x) => sum + x, 0);
      return {
        key: bucket.key,
        declarations: bucket.declarations,
        contributors: bucket.contributors.size,
        mergedPullRequests: bucket.merged.size,
        signedPullRequests: bucket.signedMerged.size,
        acceptedReviews: bucket.reviews,
        topContributorShare: outcomes > 0 ? Math.max(...bucket.byActor.values()) / outcomes : null,
      };
    })
    .sort(
      (x, y) =>
        y.mergedPullRequests - x.mergedPullRequests ||
        y.acceptedReviews - x.acceptedReviews ||
        y.declarations - x.declarations ||
        x.key.localeCompare(y.key),
    );

  return {
    totals: {
      declarations,
      declarationsWithoutExactModel: unavailable,
      signedDeclarations,
      declaringContributors: declaring.size,
      distinctModels: rows.length,
      distinctClients: clients.size,
      mergedPullRequests: mergedIds.size,
      mergedPullRequestsWithModel: mergedWithModel.size,
      mergedPullRequestsWithSignedRun: mergedWithSigned.size,
      acceptedReviews,
      acceptedReviewsWithModel: reviewsWithModel,
    },
    top: rows
      .filter((row) => row.mergedPullRequests > 0 || row.acceptedReviews > 0)
      .slice(0, 8),
  };
}

export function aggregateLeaderboard(lbInput: unknown) {
  const lb = asRecord(lbInput) ?? {};
  const cats: Record<string, number> = {};
  const merged = new Set<string>();
  for (const entry of asArray(lb.ledger)) {
    const e = asRecord(entry);
    if (e === null) continue;
    const category = asString(e.category);
    if (category === "merged-pull-request") {
      merged.add(asString(asRecord(e.source)?.id));
      continue;
    }
    cats[category] = (cats[category] ?? 0) + 1;
  }
  cats["merged-pull-request"] = merged.size;
  const cov = asRecord(lb.attributionCoverage) ?? {};
  const eligibleSourceCount = asNumber(cov.eligibleSourceCount);
  const validSourceCount = asNumber(cov.validSourceCount);
  const counts = asRecord(asRecord(lb.source)?.counts);
  const openPullRequests = typeof counts?.openPullRequests === "number" ? counts.openPullRequests : null;
  return {
    generatedAt: asString(lb.generatedAt),
    ruleVersion: asString(lb.ruleVersion),
    window: lb.window ?? null,
    repositories: asArray(lb.repositories).map((entry) => {
      const r = asRecord(entry) ?? {};
      return {
        id: asString(r.id),
        displayName: asString(r.displayName),
        url: asString(r.githubUrl),
        projectId: asString(r.projectId),
      };
    }),
    contributors: asArray(lb.leaders).length,
    outcomes: Object.values(cats).reduce((sum, x) => sum + x, 0),
    mergedPullRequests: cats["merged-pull-request"] ?? 0,
    substantiveReviews: cats["substantive-review"] ?? 0,
    evaluatedContributions: cats["evaluated-contribution"] ?? 0,
    invalidMarkers: asArray(lb.invalidAttributionMarkers).length,
    receiptCoverage: eligibleSourceCount > 0 ? { valid: validSourceCount, eligible: eligibleSourceCount } : null,
    openPullRequests,
  };
}

export function aggregateDisclosure(dInput: unknown) {
  const d = asRecord(dInput) ?? {};
  const totals = asRecord(d.totals) ?? {};
  const by = asRecord(totals.byState) ?? {};
  const paidDirect = asRecord(by["paid-direct"]);
  const unclaimed = asRecord(by.unclaimed);
  const held = asRecord(by["held-below-minimum"]);
  const basis = asRecord(d.reconstructedBasis) ?? {};
  const paidRows = asArray(d.rows)
    .map(asRecord)
    .filter((row): row is RawRecord => row !== null && row.state === "paid-direct" && asRecord(row.observed) !== null);
  const times = paidRows
    .map((row) => asString(asRecord(row.observed)?.blockTime))
    .filter((time) => time !== "")
    .sort();
  return {
    projectId: asString(d.projectId),
    month: asString(d.contributionMonth),
    status: asString(d.status),
    network: asString(d.network),
    asset: asString(d.asset),
    capUsdc: usdc(basis.capMinor),
    allocatedUsdc: usdc(totals.allocatedMinor),
    paidUsdc: usdc(totals.observedAmountMinor),
    transfers: asNumber(totals.observedTransfers),
    rows: asNumber(totals.rows),
    paidRows: asNumber(paidDirect?.rows),
    unclaimedRows: asNumber(unclaimed?.rows),
    unclaimedUsdc: unclaimed !== null ? usdc(unclaimed.amountMinor) : 0,
    heldRows: asNumber(held?.rows),
    heldUsdc: held !== null ? usdc(held.amountMinor) : 0,
    unmatched: asNumber(totals.unmatchedObservedTransfers),
    platformFee: Boolean(totals.platformFeeTransfer),
    firstAt: times[0] ?? null,
    lastAt: times.at(-1) ?? null,
    exampleSignature: asNullableString(asRecord(paidRows[0]?.observed)?.signature),
  };
}

export interface CycleSettlementSummary {
  readonly settledAt: string;
  readonly chain: string;
  readonly paidUsdc: number;
  readonly transfers: number;
}

export interface CycleSummary {
  readonly projectId: string;
  readonly month: string;
  readonly files: ReadonlyArray<string>;
  readonly kind: string;
  readonly status: string;
  readonly generatedAt: string;
  readonly approvedAt: string | null;
  readonly reviewEndsAt: string | null;
  readonly capUsdc: number | null;
  readonly sourceSnapshotSha256: string;
  readonly contributors: number;
  readonly actors: ReadonlyArray<string>;
  readonly settlement: CycleSettlementSummary | null;
}

export function aggregateCycle(
  projectId: string,
  month: string,
  files: ReadonlyArray<string>,
  docs: Readonly<Record<string, unknown>>,
): CycleSummary {
  const pr = asRecord(docs["proposal.json"]) ?? {};
  const st = asRecord(docs["settlement.json"]);
  const allocations = asArray(pr.allocations);
  const actors = allocations
    .map((entry) => {
      const actor = asRecord(asRecord(entry)?.actor);
      return asNullableString(actor?.id) ?? asNullableString(actor?.login);
    })
    .filter((id): id is string => id !== null);
  let settlement: CycleSettlementSummary | null = null;
  if (st !== null && st.status === "paid") {
    const paid = asArray(st.recipients)
      .map(asRecord)
      .filter((r): r is RawRecord => {
        if (r === null) return false;
        const raw = typeof r.paidMinor === "string" || typeof r.paidMinor === "number" ? String(r.paidMinor) : "0";
        return /^\d+$/u.test(raw) && BigInt(raw) > 0n;
      });
    settlement = {
      settledAt: asString(st.settledAt),
      chain: asString(st.chain),
      paidUsdc: paid.reduce((sum, r) => sum + usdc(r.paidMinor), 0),
      transfers: paid.length,
    };
  }
  return {
    projectId,
    month,
    files,
    kind: asString(pr.kind),
    status: asString(pr.status),
    generatedAt: asString(pr.generatedAt),
    approvedAt: asNullableString(pr.approvedAt),
    reviewEndsAt: asNullableString(asRecord(pr.review)?.endsAt),
    capUsdc: pr.capMinor !== undefined && pr.capMinor !== null && pr.capMinor !== "" ? usdc(pr.capMinor) : null,
    sourceSnapshotSha256: asString(pr.sourceSnapshotSha256),
    contributors: allocations.length,
    actors,
    settlement,
  };
}

export function aggregateCycleSnapshot(snapInput: unknown, month: string): CycleSnapshotCounts {
  const snap = asRecord(snapInput) ?? {};
  const ledger = asArray(snap.ledger).map(asRecord).filter((e): e is RawRecord => e !== null);
  const count = (category: string, inMonth: boolean) =>
    ledger.filter(
      (e) => e.category === category && (!inMonth || (typeof e.occurredAt === "string" && e.occurredAt.startsWith(month))),
    ).length;
  return {
    merged: count("merged-pull-request", false),
    reviews: count("substantive-review", false),
    calendarMerged: count("merged-pull-request", true),
    calendarReviews: count("substantive-review", true),
  };
}

export function aggregateProject(pInput: unknown) {
  const p = asRecord(pInput) ?? {};
  const r = asRecord(p.reward) ?? {};
  const authority = asRecord(p.authority);
  const links = asRecord(p.links);
  return {
    id: asString(p.id),
    name: asString(p.name),
    status: asString(p.status),
    kind: asNullableString(r.kind),
    capDisplay: asNullableString(r.monthlyCapDisplay),
    chain: asNullableString(r.chain),
    paymentMode: asNullableString(r.paymentMode),
    fundingState: asNullableString(r.fundingState),
    committedMinor: r.committedMinor ?? null,
    feeBasisPoints: r.feeBasisPoints ?? null,
    authority: asNullableString(authority?.state),
    repository: asNullableString(links?.repository),
    prize: asNullableString(links?.prize),
  };
}

export function aggregateProposal(prInput: unknown) {
  const pr = asRecord(prInput) ?? {};
  const totals = asRecord(pr.totals) ?? {};
  return {
    projectId: asString(pr.projectId),
    cycleId: asString(pr.cycleId),
    status: asString(pr.status),
    allocations: asArray(pr.allocations).length,
    capUsdc: usdc(pr.capMinor),
    suggestedUsdc: usdc(totals.suggestedMinor),
    approvedUsdc: usdc(totals.approvedMinor),
    generatedAt: asString(pr.generatedAt),
    reviewEndsAt: asNullableString(asRecord(pr.review)?.endsAt),
    approvedAt: asNullableString(pr.approvedAt),
  };
}

export function aggregateMonths(
  cycles: ReadonlyArray<CycleSummary>,
  snaps: Readonly<Record<string, CycleSnapshotCounts>>,
) {
  const byMonth = new Map<string, CycleSummary[]>();
  for (const cycle of cycles) {
    const existing = byMonth.get(cycle.month);
    if (existing === undefined) byMonth.set(cycle.month, [cycle]);
    else existing.push(cycle);
  }
  return [...byMonth.keys()]
    .sort()
    .map((month) => {
      const all = byMonth.get(month) ?? [];
      const pools = all.filter((c) => c.kind === "reward-allocation");
      const counts = { merged: 0, reviews: 0, calendarMerged: 0, calendarReviews: 0 };
      let complete = true;
      for (const key of new Set(all.map((c) => c.sourceSnapshotSha256))) {
        const snap = snaps[key];
        if (snap === undefined) {
          complete = false;
          continue;
        }
        counts.merged += snap.merged;
        counts.reviews += snap.reviews;
        counts.calendarMerged += snap.calendarMerged;
        counts.calendarReviews += snap.calendarReviews;
      }
      return {
        month,
        counts: complete ? counts : null,
        uniqueContributors: new Set(pools.flatMap((c) => c.actors)).size,
        pools: pools.map(({ actors: _a, sourceSnapshotSha256: _s, kind: _k, settlement, ...rest }) => ({
          ...rest,
          settlement: settlement === null
            ? null
            : {
                projectId: rest.projectId,
                month: rest.month,
                capUsdc: rest.capUsdc,
                settledAt: settlement.settledAt,
                paidUsdc: settlement.paidUsdc,
                transfers: settlement.transfers,
              },
        })),
      };
    });
}

export async function discover(fetchJson: JsonFetcher): Promise<RecordSources> {
  const ls = async (path: string): Promise<ReadonlyArray<RawRecord>> =>
    asArray(await fetchJson(`${SOURCES.api}${path}?ref=${ARCHIVE_REF}`))
      .map(asRecord)
      .filter((entry): entry is RawRecord => entry !== null);
  const dirs = (xs: ReadonlyArray<RawRecord>) =>
    xs.filter((x) => x.type === "dir" && typeof x.name === "string").map((x) => x.name as string).sort();
  const registryBody = asRecord(await fetchJson(SOURCES.registry));
  const registry = asArray(registryBody?.projects)
    .map((p) => asRecord(p)?.id)
    .filter((id): id is string => typeof id === "string")
    .sort();
  const projectSource = registry.length > 0 ? "registry" : "archive";
  const projects = registry.length > 0 ? registry : dirs(await ls("projects"));
  const disclosures = (await ls("disclosures"))
    .filter((x) => x.type === "file" && typeof x.name === "string" && x.name.endsWith(".json"))
    .map((x) => x.name as string)
    .sort();
  const cycles: RecordCycleSource[] = [];
  for (const projectId of dirs(await ls("cycles"))) {
    for (const month of dirs(await ls(`cycles/${projectId}`))) {
      if (!/^\d{4}-\d{2}$/u.test(month) || (HISTORICAL_MONTHS as ReadonlyArray<string>).includes(month)) {
        continue;
      }
      const names = new Set((await ls(`cycles/${projectId}/${month}`)).map((x) => asString(x.name)));
      if (!names.has("proposal.json")) continue;
      cycles.push({
        projectId,
        month,
        files: CYCLE_FILES.filter((f) => names.has(f)),
      });
    }
  }
  return { projects, projectSource, disclosures, cycles };
}

export const LEADERBOARD_PARTS_FORMAT = "slop-leaderboard-parts-v1";
export const MAX_LEADERBOARD_BYTES = 64 * 1024 * 1024;
export const MAX_LEADERBOARD_PART_BYTES = 8 * 1024 * 1024;
export const MAX_LEADERBOARD_FILE_BYTES = 25 * 1024 * 1024;
const HEX64 = /^[a-f0-9]{64}$/u;

function exactKeys(v: unknown, keys: ReadonlyArray<string>): v is RawRecord {
  const obj = asRecord(v);
  if (obj === null) return false;
  return JSON.stringify(Object.keys(obj).sort()) === JSON.stringify([...keys].sort());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function assembleLeaderboardManifest(
  root: unknown,
  readPart: BytesFetcher,
): Promise<unknown> {
  const record = asRecord(root);
  if (record?.format !== LEADERBOARD_PARTS_FORMAT) return root;
  const totalBytes = record.bytes;
  const rootSha = record.sha256;
  const parts = record.parts;
  if (
    !exactKeys(record, ["format", "bytes", "sha256", "parts"]) ||
    typeof totalBytes !== "number" ||
    !Number.isSafeInteger(totalBytes) ||
    totalBytes <= MAX_LEADERBOARD_FILE_BYTES ||
    totalBytes > MAX_LEADERBOARD_BYTES ||
    typeof rootSha !== "string" ||
    !HEX64.test(rootSha) ||
    !Array.isArray(parts) ||
    parts.length !== Math.ceil(totalBytes / MAX_LEADERBOARD_PART_BYTES)
  ) {
    throw new Error("Invalid leaderboard parts manifest");
  }
  const checkedParts: Array<{ readonly path: string; readonly bytes: number; readonly sha256: string }> = [];
  let total = 0;
  for (const part of parts) {
    if (
      !exactKeys(part, ["path", "bytes", "sha256"]) ||
      typeof part.sha256 !== "string" ||
      !HEX64.test(part.sha256) ||
      part.path !== `/data/leaderboard/${part.sha256}.part` ||
      part.bytes !== Math.min(MAX_LEADERBOARD_PART_BYTES, totalBytes - total)
    ) {
      throw new Error("Invalid leaderboard part");
    }
    checkedParts.push({ path: part.path, bytes: part.bytes, sha256: part.sha256 });
    total += part.bytes;
  }
  if (total !== totalBytes) throw new Error("Incomplete leaderboard parts");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of checkedParts) {
    const data = await readPart(part.path);
    if (data.length !== part.bytes || (await sha256Hex(data)) !== part.sha256) {
      throw new Error("Leaderboard part size or digest mismatch");
    }
    bytes.set(data, offset);
    offset += data.length;
  }
  if ((await sha256Hex(bytes)) !== rootSha) {
    throw new Error("Leaderboard snapshot digest mismatch");
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

export async function loadLeaderboard(fetchJson: JsonFetcher, fetchBytes: BytesFetcher): Promise<unknown> {
  const root = await fetchJson(SOURCES.leaderboard);
  const origin = new URL(SOURCES.leaderboard).origin;
  return assembleLeaderboardManifest(root, (path) => fetchBytes(origin + path));
}

export interface LoadAllOptions {
  readonly cycleSnapshots?: Readonly<Record<string, CycleSnapshotCounts>>;
  readonly fetchCycleSnapshots?: boolean;
  readonly fetchBytes: BytesFetcher;
  readonly leaderboard?: unknown;
  readonly now?: Date;
}

export async function loadAll(
  fetchJson: JsonFetcher,
  sources: RecordSources,
  options: LoadAllOptions,
) {
  const raw = (path: string) => fetchJson(SOURCES.raw + path);
  const [lb, disclosureDocs, projectDocs, proposalDoc, cycleDocs] = await Promise.all([
    options.leaderboard !== undefined && options.leaderboard !== null
      ? Promise.resolve(options.leaderboard)
      : loadLeaderboard(fetchJson, options.fetchBytes),
    Promise.all(sources.disclosures.map((f) => raw(`disclosures/${f}`))),
    sources.projectSource === "registry"
      ? fetchJson(SOURCES.registry).then((r) => asArray(asRecord(r)?.projects))
      : Promise.all(sources.projects.map((p) => raw(`projects/${p}/project.json`))),
    raw(SOURCES.proposal),
    Promise.all(
      sources.cycles.map(async (c) => {
        const docs: Record<string, unknown> = {};
        for (const f of c.files) {
          if (f === "proposal.json" || f === "settlement.json") {
            docs[f] = await raw(`cycles/${c.projectId}/${c.month}/${f}`);
          }
        }
        return aggregateCycle(c.projectId, c.month, c.files, docs);
      }),
    ),
  ]);
  const lbRecord = asRecord(lb);
  if (asArray(lbRecord?.ledger).length === 0) throw new Error("slop.cash leaderboard is empty");
  const disclosures = disclosureDocs.map((d, index) => ({
    ...aggregateDisclosure(d),
    file: sources.disclosures[index] ?? "",
  }));
  const order: Readonly<Record<string, number>> = { active: 0, paused: 1 };
  const projects = projectDocs
    .map(aggregateProject)
    .sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || a.name.localeCompare(b.name));

  const snaps: Record<string, CycleSnapshotCounts> = { ...(options.cycleSnapshots ?? {}) };
  if (options.fetchCycleSnapshots === true) {
    for (const c of cycleDocs) {
      const key = c.sourceSnapshotSha256;
      if (key === "" || snaps[key] !== undefined) continue;
      snaps[key] = aggregateCycleSnapshot(
        await raw(`cycles/${c.projectId}/${c.month}/source-snapshot.json`),
        c.month,
      );
    }
  }
  const usedSnaps: Record<string, CycleSnapshotCounts> = {};
  for (const c of cycleDocs) {
    const snap = snaps[c.sourceSnapshotSha256];
    if (c.sourceSnapshotSha256 !== "" && snap !== undefined) {
      usedSnaps[c.sourceSnapshotSha256] = snap;
    }
  }

  const settled = cycleDocs.filter((c): c is CycleSummary & { readonly settlement: CycleSettlementSummary } => c.settlement !== null);
  const sum = <T>(xs: ReadonlyArray<T>, f: (x: T) => number) => xs.reduce((acc, x) => acc + f(x), 0);
  return {
    builtAt: (options.now ?? new Date()).toISOString(),
    sources,
    leaderboard: aggregateLeaderboard(lb),
    models: aggregateModels(lb),
    money: {
      transfers: sum(disclosures, (d) => d.transfers) + sum(settled, (c) => c.settlement.transfers),
      paidUsdc: sum(disclosures, (d) => d.paidUsdc) + sum(settled, (c) => c.settlement.paidUsdc),
      allocatedUsdc: sum(disclosures, (d) => d.allocatedUsdc),
      unclaimedUsdc: sum(disclosures, (d) => d.unclaimedUsdc),
      platformFeeCollected: disclosures.some((d) => d.platformFee),
      pools: disclosures,
      settlements: settled.map((c) => ({
        projectId: c.projectId,
        month: c.month,
        capUsdc: c.capUsdc,
        ...c.settlement,
      })),
    },
    months: aggregateMonths(cycleDocs, usedSnaps),
    cycleSnapshots: usedSnaps,
    projects,
    proposal: aggregateProposal(proposalDoc),
  };
}
