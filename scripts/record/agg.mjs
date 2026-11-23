// Aggregation for the Slop Cash public record (slop.cash/record, published as
// /data/record.json). Ported from the retired record site (drew-dot-com/
// slop-live-stats, agg.js), which this replaces; the output keeps that site's
// snapshot shape, so agents that read it only change the URL. Runs in Node
// during the site build (scripts/record/build-record.mjs). Inputs are public
// files; the output is aggregate-only, no per-person rows.

export const REPO = "SlopDotCash/slopdotcash";
// #876 (19 Oct 2026) moved projects to a D1 registry and deleted projects/,
// cycles/ and disclosures/ from the repository. Those records now live only
// in history, so they are read from the last `main` commit that had them.
export const ARCHIVE_REF = "109c7640298f9e0652eed9056e78705b776f79a6";
export const SOURCES = {
  leaderboard: "https://slop.cash/data/leaderboard.json",
  registry: "https://slop.cash/api/v1/projects",
  raw: `https://raw.githubusercontent.com/${REPO}/${ARCHIVE_REF}/`,
  api: `https://api.github.com/repos/${REPO}/contents/`,
  // The first frozen proposal, kept as a fixed reference line under Pools.
  proposal: "cycles/eliza/2026-07/proposal.json",
};
// Months shown as fixed rows on /record (July from its cycle file, August
// from funding/preparations). Every later cycle directory becomes a row here.
export const HISTORICAL_MONTHS = ["2026-07", "2026-08"];
export const CYCLE_FILES = [
  "proposal.json",
  "allocation.json",
  "execution-plan.json",
  "transactions.json",
  "settlement.json",
  "windup.json",
];

const usdc = (minor) => Number(BigInt(minor)) / 1e6;

// Model figures must match summarizeModelOutcomes exactly. This is a line-for-line
// port of summarizeModelOutcomes in src/lib/model-outcomes.ts (SlopDotCash/
// slopdotcash, main): same provider aliases, same name folding, same
// "unavailable" exclusion, same same-actor join, same ordering. Change it
// only alongside that file.
const PROVIDER_ALIASES = {
  "openai-codex": "openai",
  "z.ai": "zai",
  "z-ai": "zai",
  "moonshot-ai": "moonshotai",
  spacexai: "xai",
  "x-ai": "xai",
};
function modelKey(provider, model) {
  const p0 = String(provider).trim().toLowerCase();
  const p = PROVIDER_ALIASES[p0] ?? p0;
  let m = String(model).trim().toLowerCase();
  for (const pre of [
    p,
    ...Object.keys(PROVIDER_ALIASES).filter((a) => PROVIDER_ALIASES[a] === p),
  ]) {
    if (m.startsWith(`${pre}/`)) {
      m = m.slice(pre.length + 1);
      break;
    }
  }
  m = m.replaceAll(/(^|[a-z]-)(\d)-(\d)(?!\d)/gu, "$1$2.$3");
  return `${p}/${m}`;
}

export function aggregateModels(lb) {
  const keyOf = new Map(),
    bySource = new Map(),
    byArtifact = new Map(),
    models = new Map(),
    clients = new Set();
  const push = (map, k, v) => {
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v);
  };
  const declaring = new Set();
  let unavailable = 0,
    declarations = 0,
    signedDeclarations = 0;
  for (const a of lb.attributions || []) {
    if (a.run) signedDeclarations++;
    if (
      typeof a.model === "string" &&
      a.model.toLowerCase() === "unavailable"
    ) {
      unavailable++;
      continue;
    }
    declarations++;
    const key = modelKey(a.provider, a.model);
    keyOf.set(a, key);
    push(bySource, a.sourceId, a);
    push(byArtifact, a.artifactId, a);
    if (!models.has(key))
      models.set(key, {
        key,
        declarations: 0,
        contributors: new Set(),
        merged: new Set(),
        signedMerged: new Set(),
        reviews: 0,
        byActor: new Map(),
      });
    const b = models.get(key);
    b.declarations++;
    const actor = a.actor?.id ?? null;
    if (actor) {
      b.contributors.add(actor);
      declaring.add(actor);
    }
    const client = a.run?.client ? a.run.client.trim().toLowerCase() : null;
    if (client) clients.add(client);
  }

  const mergedIds = new Set(),
    mergedWithModel = new Set(),
    mergedWithSigned = new Set();
  let acceptedReviews = 0,
    reviewsWithModel = 0;
  for (const e of lb.ledger || []) {
    const isPr = e.category === "merged-pull-request";
    if (isPr) mergedIds.add(e.source.id);
    else if (e.category === "substantive-review") acceptedReviews++;
    else continue;
    const own = ((isPr ? byArtifact : bySource).get(e.source.id) || []).filter(
      (a) => a.actor?.id === e.actor.id,
    );
    const keys = [...new Set(own.map((a) => keyOf.get(a)))].filter(
      (k) => typeof k === "string",
    );
    if (!keys.length) continue;
    if (isPr) {
      mergedWithModel.add(e.source.id);
      if (own.some((a) => a.run)) mergedWithSigned.add(e.source.id);
    } else reviewsWithModel++;
    for (const k of keys) {
      const b = models.get(k);
      if (isPr) {
        b.merged.add(e.source.id);
        if (own.some((a) => a.run && keyOf.get(a) === k))
          b.signedMerged.add(e.source.id);
      } else b.reviews++;
      b.byActor.set(e.actor.id, (b.byActor.get(e.actor.id) || 0) + 1);
    }
  }

  const rows = [...models.values()]
    .map((b) => {
      const outcomes = [...b.byActor.values()].reduce((s, x) => s + x, 0);
      return {
        key: b.key,
        declarations: b.declarations,
        contributors: b.contributors.size,
        mergedPullRequests: b.merged.size,
        signedPullRequests: b.signedMerged.size,
        acceptedReviews: b.reviews,
        topContributorShare:
          outcomes > 0 ? Math.max(...b.byActor.values()) / outcomes : null,
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
    // List models with at least one accepted outcome, as upstream does.
    top: rows
      .filter((r) => r.mergedPullRequests > 0 || r.acceptedReviews > 0)
      .slice(0, 8),
  };
}

export function aggregateLeaderboard(lb) {
  // Shared merge credit emits one ledger event per commit author of one merge,
  // so a merged PR is counted once by source id, as upstream does.
  const cats = {},
    merged = new Set();
  for (const e of lb.ledger) {
    if (e.category === "merged-pull-request") {
      merged.add(e.source.id);
      continue;
    }
    cats[e.category] = (cats[e.category] || 0) + 1;
  }
  cats["merged-pull-request"] = merged.size;
  const cov = lb.attributionCoverage || {};
  return {
    generatedAt: lb.generatedAt,
    ruleVersion: lb.ruleVersion,
    window: lb.window,
    repositories: lb.repositories.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      url: r.githubUrl,
      projectId: r.projectId,
    })),
    contributors: lb.leaders.length,
    outcomes: Object.values(cats).reduce((a, x) => a + x, 0),
    mergedPullRequests: cats["merged-pull-request"] || 0,
    substantiveReviews: cats["substantive-review"] || 0,
    evaluatedContributions: cats["evaluated-contribution"] || 0,
    invalidMarkers: (lb.invalidAttributionMarkers || []).length,
    receiptCoverage: cov.eligibleSourceCount
      ? { valid: cov.validSourceCount, eligible: cov.eligibleSourceCount }
      : null,
    openPullRequests: lb.source?.counts?.openPullRequests ?? null,
  };
}

export function aggregateDisclosure(d) {
  const by = d.totals.byState || {};
  const paidRows = d.rows.filter(
    (r) => r.state === "paid-direct" && r.observed,
  );
  const times = paidRows.map((r) => r.observed.blockTime).sort();
  return {
    projectId: d.projectId,
    month: d.contributionMonth,
    status: d.status,
    network: d.network,
    asset: d.asset,
    capUsdc: usdc(d.reconstructedBasis.capMinor),
    allocatedUsdc: usdc(d.totals.allocatedMinor),
    paidUsdc: usdc(d.totals.observedAmountMinor),
    transfers: d.totals.observedTransfers,
    rows: d.totals.rows,
    paidRows: by["paid-direct"]?.rows || 0,
    unclaimedRows: by.unclaimed?.rows || 0,
    unclaimedUsdc: by.unclaimed ? usdc(by.unclaimed.amountMinor) : 0,
    heldRows: by["held-below-minimum"]?.rows || 0,
    heldUsdc: by["held-below-minimum"]
      ? usdc(by["held-below-minimum"].amountMinor)
      : 0,
    unmatched: d.totals.unmatchedObservedTransfers,
    platformFee: d.totals.platformFeeTransfer,
    firstAt: times[0] || null,
    lastAt: times[times.length - 1] || null,
    exampleSignature: paidRows[0]?.observed?.signature || null,
  };
}

// Proposal-level facts the page needs for a cycle row. The state label is
// computed at render time so "under review" turns into "review closed" on its
// own without waiting for a rebuild.
export function aggregateCycle(projectId, month, files, docs) {
  const pr = docs["proposal.json"];
  const st = docs["settlement.json"];
  const out = {
    projectId,
    month,
    files,
    kind: pr.kind,
    status: pr.status,
    generatedAt: pr.generatedAt,
    approvedAt: pr.approvedAt ?? null,
    reviewEndsAt: pr.review?.endsAt || null,
    capUsdc: pr.capMinor ? usdc(pr.capMinor) : null,
    sourceSnapshotSha256: pr.sourceSnapshotSha256,
    contributors: (pr.allocations || []).length,
    actors: (pr.allocations || [])
      .map((a) => a.actor?.id || a.actor?.login)
      .filter(Boolean),
    settlement: null,
  };
  if (st && st.status === "paid") {
    const paid = (st.recipients || []).filter(
      (r) => BigInt(r.paidMinor || "0") > 0n,
    );
    out.settlement = {
      settledAt: st.settledAt,
      chain: st.chain,
      paidUsdc: paid.reduce((a, r) => a + usdc(r.paidMinor), 0),
      transfers: paid.length,
    };
  }
  return out;
}

// Ledger counts for a frozen source snapshot: whole 35-day window, plus the
// calendar month alone so months can be summed without double counting.
export function aggregateCycleSnapshot(snap, month) {
  const cnt = (cat, inMonth) =>
    snap.ledger.filter(
      (e) =>
        e.category === cat &&
        (!inMonth || String(e.occurredAt).startsWith(month)),
    ).length;
  return {
    merged: cnt("merged-pull-request"),
    reviews: cnt("substantive-review"),
    calendarMerged: cnt("merged-pull-request", true),
    calendarReviews: cnt("substantive-review", true),
  };
}

export function aggregateProject(p) {
  const r = p.reward || {};
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    kind: r.kind,
    capDisplay: r.monthlyCapDisplay || null,
    chain: r.chain || null,
    paymentMode: r.paymentMode || null,
    fundingState: r.fundingState || null,
    committedMinor: r.committedMinor ?? null,
    feeBasisPoints: r.feeBasisPoints ?? null,
    authority: p.authority?.state || null,
    repository: p.links?.repository || null,
    prize: p.links?.prize || null,
  };
}

export function aggregateProposal(pr) {
  return {
    projectId: pr.projectId,
    cycleId: pr.cycleId,
    status: pr.status,
    allocations: pr.allocations.length,
    capUsdc: usdc(pr.capMinor),
    suggestedUsdc: usdc(pr.totals.suggestedMinor),
    approvedUsdc: usdc(pr.totals.approvedMinor),
    generatedAt: pr.generatedAt,
    reviewEndsAt: pr.review?.endsAt || null,
    approvedAt: pr.approvedAt,
  };
}

// One row per contribution month. Counts come from the frozen source
// snapshots (deduplicated, since pools of one month share a snapshot); the
// unique contributor count is computed here so no account ids leave the build.
export function aggregateMonths(cycles, snaps) {
  const byMonth = {};
  for (const c of cycles) {
    byMonth[c.month] ??= [];
    byMonth[c.month].push(c);
  }
  return Object.keys(byMonth)
    .sort()
    .map((month) => {
      const all = byMonth[month];
      const pools = all.filter((c) => c.kind === "reward-allocation");
      const counts = {
        merged: 0,
        reviews: 0,
        calendarMerged: 0,
        calendarReviews: 0,
      };
      let complete = true;
      for (const key of new Set(all.map((c) => c.sourceSnapshotSha256))) {
        if (!snaps[key]) {
          complete = false;
          continue;
        }
        for (const k of Object.keys(counts)) counts[k] += snaps[key][k];
      }
      return {
        month,
        counts: complete ? counts : null,
        uniqueContributors: new Set(pools.flatMap((c) => c.actors)).size,
        pools: pools.map(({ actors, sourceSnapshotSha256, kind, ...c }) => c),
      };
    });
}

// Lists what the page reads. Projects come from the live registry; while it is
// empty (production after #876, until the projects are re-added) they come
// from the archive commit. The list is stored in the record as `sources`.
export async function discover(fetchJson) {
  const ls = (path) => fetchJson(`${SOURCES.api}${path}?ref=${ARCHIVE_REF}`);
  const dirs = (xs) =>
    xs
      .filter((x) => x.type === "dir")
      .map((x) => x.name)
      .sort();
  const registry = (await fetchJson(SOURCES.registry)).projects
    .map((p) => p.id)
    .sort();
  const projectSource = registry.length ? "registry" : "archive";
  const projects = registry.length ? registry : dirs(await ls("projects"));
  const disclosures = (await ls("disclosures"))
    .filter((x) => x.type === "file" && x.name.endsWith(".json"))
    .map((x) => x.name)
    .sort();
  const cycles = [];
  for (const projectId of dirs(await ls("cycles"))) {
    for (const month of dirs(await ls(`cycles/${projectId}`))) {
      if (!/^\d{4}-\d{2}$/.test(month) || HISTORICAL_MONTHS.includes(month))
        continue;
      const names = new Set(
        (await ls(`cycles/${projectId}/${month}`)).map((x) => x.name),
      );
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

// slop.cash shards a leaderboard over 25 MB into 8 MB parts (SlopDotCash/
// slopdotcash 78be5c44, 30 Oct 2026): leaderboard.json is then a small
// manifest naming each part by its SHA-256, and the logical JSON bytes are
// unchanged. This mirrors readLeaderboardBytes in src/lib/leaderboard-
// transport.mjs: the whole manifest is checked before any part is read, every
// part is checked by size and digest, and the assembled bytes must match the
// manifest digest. A legacy single-file leaderboard passes straight through.
const LEADERBOARD_PARTS_FORMAT = "slop-leaderboard-parts-v1";
const MAX_LEADERBOARD_BYTES = 64 * 1024 * 1024; // matches slop.cash #2374
const MAX_LEADERBOARD_PART_BYTES = 8 * 1024 * 1024;
const MAX_LEADERBOARD_FILE_BYTES = 25 * 1024 * 1024;
const HEX64 = /^[a-f0-9]{64}$/;
const exactKeys = (v, keys) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...keys].sort());
async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export const defaultFetchBytes = (u) =>
  fetch(u).then(async (r) => {
    if (!r.ok) throw new Error(`${r.status} ${u}`);
    return new Uint8Array(await r.arrayBuffer());
  });
export async function loadLeaderboard(
  fetchJson,
  fetchBytes = defaultFetchBytes,
) {
  const root = await fetchJson(SOURCES.leaderboard);
  if (root?.format !== LEADERBOARD_PARTS_FORMAT) return root;
  if (
    !exactKeys(root, ["format", "bytes", "sha256", "parts"]) ||
    !Number.isSafeInteger(root.bytes) ||
    root.bytes <= MAX_LEADERBOARD_FILE_BYTES ||
    root.bytes > MAX_LEADERBOARD_BYTES ||
    !HEX64.test(root.sha256) ||
    !Array.isArray(root.parts) ||
    root.parts.length !== Math.ceil(root.bytes / MAX_LEADERBOARD_PART_BYTES)
  )
    throw new Error("Invalid leaderboard parts manifest");
  let total = 0;
  for (const part of root.parts) {
    if (
      !exactKeys(part, ["path", "bytes", "sha256"]) ||
      !HEX64.test(part.sha256) ||
      part.path !== `/data/leaderboard/${part.sha256}.part` ||
      part.bytes !== Math.min(MAX_LEADERBOARD_PART_BYTES, root.bytes - total)
    ) {
      throw new Error("Invalid leaderboard part");
    }
    total += part.bytes;
  }
  if (total !== root.bytes) throw new Error("Incomplete leaderboard parts");
  const origin = new URL(SOURCES.leaderboard).origin;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of root.parts) {
    const data = await fetchBytes(origin + part.path);
    if (
      !(data instanceof Uint8Array) ||
      data.length !== part.bytes ||
      (await sha256Hex(data)) !== part.sha256
    )
      throw new Error("Leaderboard part size or digest mismatch");
    bytes.set(data, offset);
    offset += data.length;
  }
  if ((await sha256Hex(bytes)) !== root.sha256)
    throw new Error("Leaderboard snapshot digest mismatch");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

// Fetches and aggregates everything the page shows. `sources` comes from
// discover() (or the last record's list when that read fails).
// `cycleSnapshots` maps sourceSnapshotSha256 to counts already computed (the
// snapshots are frozen and large, so the build reuses earlier counts).
// `leaderboard`, when given, is the snapshot this site build publishes, read
// from disk; otherwise the live slop.cash file is fetched.
export async function loadAll(
  fetchJson,
  sources,
  {
    cycleSnapshots = {},
    fetchCycleSnapshots = false,
    fetchBytes = defaultFetchBytes,
    leaderboard = null,
  } = {},
) {
  const raw = (path) => fetchJson(SOURCES.raw + path);
  const [lb, disclosureDocs, projectDocs, proposalDoc, cycleDocs] =
    await Promise.all([
      leaderboard ?? loadLeaderboard(fetchJson, fetchBytes),
      Promise.all(sources.disclosures.map((f) => raw(`disclosures/${f}`))),
      sources.projectSource === "registry"
        ? fetchJson(SOURCES.registry).then((r) => r.projects)
        : Promise.all(
            sources.projects.map((p) => raw(`projects/${p}/project.json`)),
          ),
      raw(SOURCES.proposal),
      Promise.all(
        sources.cycles.map(async (c) => {
          const docs = {};
          for (const f of c.files)
            if (f === "proposal.json" || f === "settlement.json")
              docs[f] = await raw(`cycles/${c.projectId}/${c.month}/${f}`);
          return aggregateCycle(c.projectId, c.month, c.files, docs);
        }),
      ),
    ]);
  // An empty ledger means slop.cash has no registered repositories (production
  // after #876, until projects are re-added), not zero activity. Refuse it so
  // the build keeps the last good record.
  if (!lb.ledger?.length) throw new Error("slop.cash leaderboard is empty");
  const disclosures = disclosureDocs.map((d, i) => ({
    ...aggregateDisclosure(d),
    file: sources.disclosures[i],
  }));
  const order = { active: 0, paused: 1 };
  const projects = projectDocs
    .map(aggregateProject)
    .sort(
      (a, b) =>
        (order[a.status] ?? 2) - (order[b.status] ?? 2) ||
        a.name.localeCompare(b.name),
    );

  const snaps = { ...cycleSnapshots };
  if (fetchCycleSnapshots) {
    for (const c of cycleDocs) {
      const key = c.sourceSnapshotSha256;
      if (!key || snaps[key]) continue;
      snaps[key] = aggregateCycleSnapshot(
        await raw(`cycles/${c.projectId}/${c.month}/source-snapshot.json`),
        c.month,
      );
    }
  }
  const usedSnaps = Object.fromEntries(
    cycleDocs
      .map((c) => c.sourceSnapshotSha256)
      .filter((k) => snaps[k])
      .map((k) => [k, snaps[k]]),
  );

  const settled = cycleDocs.filter((c) => c.settlement);
  const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
  return {
    builtAt: new Date().toISOString(),
    sources,
    leaderboard: aggregateLeaderboard(lb),
    models: aggregateModels(lb),
    money: {
      transfers:
        sum(disclosures, (d) => d.transfers) +
        sum(settled, (c) => c.settlement.transfers),
      paidUsdc:
        sum(disclosures, (d) => d.paidUsdc) +
        sum(settled, (c) => c.settlement.paidUsdc),
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
