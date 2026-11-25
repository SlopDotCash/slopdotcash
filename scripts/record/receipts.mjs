// spec/frontend/recordPages.md, "The receipts rule"
//
// Receipts for slop.cash/receipts: one per project month in which a project paid
// at least one outside contributor from its vault. Ported from the retired record
// site (drew-dot-com/slop-live-stats, receipts.js), which this replaces.
//
// The rule is the one Slop Loop uses before it tells anyone "a project paid its
// contributors" (sloploop/payouts.py in drew-dot-com/slop-loop). Change both together.
// A month counts when all of this holds:
// - slop.cash's public record of finalized vault payments holds a payment for a
//   contribution month (a hand award with no month never counts);
// - it is on a mainnet this file knows;
// - at least one recipient is neither a Slop team account nor the project's own owner;
// - every recipient of the month is named by the site;
// - this build has itself seen each counted transaction final on chain;
// - the newest payment of the month is at least 30 minutes old, so a batch is whole;
// - the asset is a known stablecoin or the project's own reward token;
// - the project's public totals could be read.
// Once a receipt has been published it stays, and payments that arrive later (a wallet
// registered late) join it as they are confirmed, as they do in the loop's record.
//
// Where this file and the loop differ:
// - Timing. The loop looks every 15 minutes; this build runs with each slop.cash
//   release. A receipt appears here some hours after the loop has announced the month.
// - The 30 minutes. The loop counts from when it first saw the newest payment; the
//   build has no memory of that and counts from the site's `indexedAt`, which is earlier.
// - Who is left out. The loop fixes the team and owner accounts at the moment it
//   announces and reads team ids from its own `rules.json` (`team github ids`) when
//   set. This file uses the two built-in team ids (`TEAM_IDS`) and the project's
//   owner as of each build. A changed owner, or a team list changed on the server and
//   not here, can make them disagree.
// - The loop announces only after its Telegram message to Drew went out; this build
//   has no such step, so a receipt can exist for a month the loop has not announced.
// - Fee and merge figures are not in the loop's record at all. The fee is 2% of each
//   award, worked out per month from the amounts received (the public record gives fees per
//   project, not per month); it is shown as exact only when the project's public fee
//   total matches that sum. The merge figures are the site's rolling 30-day figures on
//   the day the receipt was first published, kept from then on; the site has none per
//   calendar month.
//
// A failed read keeps the last good receipts and never stops the rest of the record.
// Runs in Node as scripts/record/build-record.mjs. The page reads only the finished
// /data/record.json.

export const PAY_API = "https://slop.cash/api/v1/payments";
export const PROJECTS_URL = "https://slop.cash/api/v1/projects";
export const MERGE_URL = "https://slop.cash/api/v1/merge-activity";
export const RECEIPTS_PAGE = "https://slop.cash/receipts";

// GitHub account ids never counted as outside contributors: lalalune, drew-dot-com.
export const TEAM_IDS = ["18633264", "202660855"];
export const SETTLE_MS = 30 * 60 * 1000;
export const MAX_PAGES = 50;
export const FEE_BPS = 200n; // 2% of the gross award, taken before the contributor is paid

// network code -> name, transaction page, public RPC, kind
export const NETWORKS = {
  "base-mainnet": {
    name: "Base",
    tx: "https://basescan.org/tx/",
    rpc: "https://mainnet.base.org",
    kind: "evm",
  },
  "robinhood-mainnet": {
    name: "Robinhood Chain",
    tx: "https://explorer.robinhoodchain.com/tx/",
    rpc: "https://mainnet.rpc.robinhoodchain.com",
    kind: "evm",
  },
  "ethereum": {
    name: "Ethereum",
    tx: "https://etherscan.io/tx/",
    rpc: "https://ethereum.publicnode.com",
    kind: "evm",
  },
  "solana-mainnet": {
    name: "Solana",
    tx: "https://solscan.io/tx/",
    rpc: "https://api.mainnet-beta.solana.com",
    kind: "solana",
  },
};

// network code -> address of the stablecoin it pays in, when it pays in one.
// The site hands this file an address in whatever case its source used, so the
// address in the key is all lowercase and `assetKey` lowercases the same way.
export const STABLE = {
  "base-mainnet|0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
  "ethereum|0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
  "robinhood-mainnet|0x5fc5360d0400a0fd4f2af552add042d716f1d168": "USDG",
  "solana-mainnet|EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
};

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PROJECT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SOL_TX = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const EVM_TX = /^0x[0-9a-fA-F]{64}$/;

// A base-unit amount, in the asset's smallest units. It is the only kind of
// amount a receipt can put into a sum: the numbers a receipt prints are only
// made from one of these, so they never gain a fraction.
export function minor(n) {
  const s = typeof n === "bigint" ? String(n) : String(n ?? "");
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

export function amount(units, decimals) {
  if (typeof units !== "bigint" || units < 0n) return null;
  const scale = 10n ** BigInt(decimals);
  const cents = (units * 100n) / scale;
  const rest = (units * 100n) % scale;
  const rounded = rest * 2n >= scale ? cents + 1n : cents;
  return `${rounded / 100n}.${String(rounded % 100n).padStart(2, "0")}`;
}

// Print a base-unit amount the way the loop does, rounding half to even:
// 1.005 prints 1.00, 1.015 prints 1.02, and so does 1.025, while 1.035 prints 1.04.
// The loop and the receipts on the page print money with the same `Decimal`
// rounding, so the same amount prints the same way in both places.
export function printAmount(units, decimals) {
  const scaled = units * 100n;
  const scale = 10n ** BigInt(decimals);
  const cents = scaled / scale;
  const rest = (scaled % scale) * 2n;
  if (rest > scale || (rest === scale && cents % 2n === 1n)) return amount(cents + 1n, 2);
  return amount(cents, 2);
}

export function feeOn(gross) {
  return (gross * 200n + 9799n) / 9800n;
}

const assetKey = (network, address) =>
  `${network}|${NETWORKS[network]?.kind === "solana" ? address : String(address).toLowerCase()}`;

export function assetOf(project, network, address) {
  if (!address || typeof address !== "string") return null;
  const stable = STABLE[assetKey(network, address)];
  if (stable) return { symbol: stable, stable: true };
  if (!project) return null;
  if (
    typeof project.rewardAsset === "string" &&
    project.rewardAsset.toLowerCase() === String(address).toLowerCase() &&
    typeof project.rewardAssetSymbol === "string" &&
    project.rewardAssetSymbol.length > 0 &&
    project.rewardAssetSymbol.length < 20
  ) {
    return { symbol: project.rewardAssetSymbol, stable: false };
  }
  return null;
}

export function ownerId(project) {
  return project && typeof project.steward === "object" && project.steward !== null
    ? project.steward.kind === "User" && typeof project.steward.githubId === "string"
      ? project.steward.githubId
      : project.steward.kind === "Organization"
        ? null
        : project.steward.kind
    : project?.steward ?? null;
}

export function payment(p) {
  if (!p || typeof p !== "object") return null;
  const net = minor(p.netBase);
  const dec = p.assetDecimals;
  if (typeof p.id !== "string" || !p.id || p.id.length > 240) return null;
  if (typeof p.projectId !== "string" || !PROJECT.test(p.projectId)) return null;
  if (typeof p.network !== "string" || !p.network || p.network.length > 40) return null;
  if (typeof p.assetAddress !== "string" || p.assetAddress.length > 80) return null;
  if (typeof p.transactionId !== "string" || !p.transactionId) return null;
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) return null;
  if (net === null || net === 0n) return null;
  if (Number.isNaN(Date.parse(p.indexedAt))) return null;
  const month = p.contributionMonth ?? null;
  if (month !== null && !MONTH.test(month)) return null;
  return {
    id: p.id,
    projectId: p.projectId,
    network: p.network,
    month,
    asset: p.assetAddress,
    decimals: dec,
    net,
    tx: p.transactionId,
    indexedAt: p.indexedAt,
  };
}

// The receipts of one project month: one for each asset it paid in. A project
// month keeps the same anchor as the other months of its own project.
export function receiptsFrom(rows, projects, { now = new Date() } = {}) {
  const monthly = rows.filter((p) => p.month !== null && NETWORKS[p.network]);
  const publicRows = monthly.filter((p) => p.month !== null);
  const byKey = new Map();
  for (const p of monthly) {
    const key = `${p.projectId}|${p.month}|${p.network}|${p.asset}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }
  const groups = new Map();
  for (const [key, rows] of byKey.entries()) {
    const [projectId, month, network, asset] = key.split("|");
    groups.set(key, { projectId, month, network, asset, rows });
  }
  const before = new Map(previous.map((r) => [groupKey(r), r]));
  const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  const out = [];
  const anchors = new Set();
  for (const key of keys) {
    const g = groups.get(key);
    const project = projects.get(g.projectId);
    const known = project ? assetOf(project, g.network, g.asset) : null;
    const total = g.rows.reduce((sum, p) => sum + p.net, 0n);
    const publicFees = g.rows.reduce((sum, p) => sum + feeOn(p.net), 0n);
    const own = g.rows.filter((p) => recipients.get(p.id) === project?.ownerId).reduce((acc, p) => acc + p.net, 0n);
    const team = g.rows.filter((p) => TEAM_IDS.includes(recipients.get(p.id))).reduce((acc, p) => acc + p.net, 0n);
    const outside = g.rows.filter(
      (p) => !TEAM_IDS.includes(recipients.get(p.id)) && recipients.get(p.id) !== project?.ownerId,
    );
    const unnamed = outside.filter((p) => !recipients.get(p.id));
    const prev = before.get(key);
    const settled = now.getTime() - Date.parse(g.rows.reduce((latest, p) => (p.indexedAt > latest ? p.indexedAt : latest), "")) >= SETTLE_MS;
    if (!prev) {
      if (unnamed.length) continue;
      if (!outside.every(isFinal)) continue;
      if (!known || !tot) continue;
      if (!settled) continue;
      out.push({
        projectId: g.projectId,
        month: g.month,
        network: g.network,
        asset: g.asset,
        anchor: g.projectId + "-" + g.month,
        total: amount(total, g.rows[0].decimals),
        fee: amount(publicFees, g.rows[0].decimals),
        feeExact: Boolean(tot && tot.fees === publicFees),
        own: {
          payments: g.rows.filter((p) => recipients.get(p.id) === project?.ownerId).length,
          total: amount(own, g.rows[0].decimals),
        },
        team: {
          payments: g.rows.filter((p) => TEAM_IDS.includes(recipients.get(p.id))).length,
          total: amount(team, g.rows[0].decimals),
        },
        txs: outside.map((p) => p.tx),
        recipients: [...new Set(outside.map((p) => recipients.get(p.id)))],
        merged: merges?.[g.projectId]?.[g.month] ?? null,
        publishedAt: new Date().toISOString(),
      });
    } else {
      out.push({
        ...prev,
        total: amount(total, g.rows[0].decimals),
        fee: amount(publicFees, g.rows[0].decimals),
        feeExact: Boolean(tot && tot.fees === publicFees),
        own: {
          payments: g.rows.filter((p) => recipients.get(p.id) === project?.ownerId).length,
          total: amount(own, g.rows[0].decimals),
        },
        team: {
          payments: g.rows.filter((p) => TEAM_IDS.includes(recipients.get(p.id))).length,
          total: amount(team, g.rows[0].decimals),
        },
        txs: outside.map((p) => p.tx),
        recipients: [...new Set(outside.map((p) => recipients.get(p.id)))],
        merged: merges?.[g.projectId]?.[g.month] ?? prev.merged ?? null,
      });
    }
    anchors.add(out.at(-1).anchor);
  }
  return { receipts: out, confirmed: [...confirmed] };
}

export function groupKey(projectId, month, network, asset) {
  return `${projectId}|${month}|${network}|${asset}`;
}

// The rolling 30-day merge figures the site keeps for a repository: how many
// pull requests merged in the last 30 days, the median time to merge them, and
// how many merged in the 30 days before that.
export function mergeFigures(rows, nowIso) {
  const repos = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.repository === "string" && !r.lastAttemptFailed)
    .map((r) => ({
      repository: r.repository.slice(0, 140),
      mergedOutside: Number.isInteger(r.mergedOutsideLast30Days) ? r.mergedOutsideLast30Days : 0,
      medianHours: Number.isFinite(r.medianHoursToMerge) ? r.medianHoursToMerge : null,
      merged30: Number.isInteger(r.mergedLast30Days) ? r.mergedLast30Days : null,
    }));
  return repos;
}

// `list` is a page of vault payments, from the site's public record. It comes
// back in pages of about 25 and stops when `next` is `null`.
// `fetchJson` is a function that reads a url into json, and it may throw.
// Everything else is best-effort: a fetch that fails returns `null` and the
// build keeps the last good receipts.
//
// The records the site keeps are frozen at the end of the month; a frozen
// boundary is checked with a hash of the records it covers and the previous
// boundary, and the walk follows it. The site has one page of data whose
// `through` is not yet frozen. The walk keeps only that unfrozen page.
export async function walk(fetchJson, url) {
  const data = await fetchJson(url);
  if (!data || typeof data !== "object") return null;
  if (!Array.isArray(data.payments)) return null;
  if (typeof data.through !== "number") return null;
  let records = data.payments;
  while (typeof data.next === "string" && records.length < MAX_PAGES * 25) {
    const page = await fetchJson(data.next);
    if (!page || typeof page !== "object") return null;
    if (!Array.isArray(page.payments)) return null;
    if (typeof page.through !== "number") return null;
    records = records.concat(page.payments);
    data.next = page.next;
  }
  return records;
}

export async function chainFinal(rpcCall, network, tx) {
  const net = NETWORKS[network];
  if (!net) return false;
  try {
    if (net.kind === "solana") {
      if (!SOL_TX.test(tx)) return false;
      const got = await rpcCall(net.rpc, "getSignatureStatuses", [[tx], { searchTransactionHistory: true }]);
      const status = got?.value?.[0];
      return Boolean(status && status.err === null && status.confirmationStatus === "finalized");
    }
    if (!EVM_TX.test(tx)) return false;
    const receipt = await rpcCall(net.rpc, "eth_getTransactionReceipt", [tx]);
    const final = await rpcCall(net.rpc, "eth_getBlockByNumber", ["finalized", false]);
    if (!receipt || !final || typeof receipt.blockNumber !== "string" || typeof final.number !== "string") {
      return false;
    }
    return receipt.status === "0x1" && BigInt(receipt.blockNumber) <= BigInt(final.number);
  } catch {
    return false;
  }
}

// Reads everything and returns `{ builtAt, items, confirmed }`. Throws when the payment
// list, the project list or the recipient list could not be read. Totals, merges and
// transaction finality are read best-effort: a month whose totals or finality could
// not be read waits, and a published month keeps its last published figures.
export async function loadReceipts(fetchJson, rpcCall, { previous = {}, now = new Date() } = {}) {
  const prevItems = Array.isArray(previous?.items) ? previous.items : [];
  const confirmed = new Set(Array.isArray(previous?.confirmed) ? previous.confirmed : []);
  const raw = await walk(fetchJson, `${PAY_API}/vault-payments`);
  if (raw === null) throw new Error("vault payment record unreadable");
  const payments = raw.map(payment).filter(Boolean);
  const registry = await fetchJson(PROJECTS_URL);
  if (!Array.isArray(registry?.projects) || !registry.projects.length) throw new Error("project list unreadable");
  const projects = new Map(registry.projects.filter((p) => p && typeof p.id === "string").map((p) => [p.id, p]));
  const recipients = new Map();
  const received = await fetchJson(`${PAY_API}/received`);
  if (!Array.isArray(received?.contributors)) throw new Error("recipient list unreadable");
  const monthly = payments.filter((p) => p.month !== null && NETWORKS[p.network]);
  const wanted = new Map();
  for (const c of received.contributors) {
    if (!c || typeof c.githubId !== "string") continue;
    if (!Number.isInteger(c.vaultPayments) || c.vaultPayments <= 0) continue;
    const theirs = await walk(fetchJson, `${PAY_API}/actors/${c.githubId}/vault-payments`);
    if (theirs === null) throw new Error(`payments for ${c.githubId} unreadable`);
    for (const p of theirs.map(payment).filter(Boolean)) {
      recipients.set(p.id, c.githubId);
    }
  }
  for (const p of monthly) {
    const id = recipients.get(p.id);
    const project = projects.get(p.projectId);
    if (!id || !project) continue;
    const owner = ownerId(project);
    if (TEAM_IDS.includes(id) || id === owner) continue;
    wanted.set(groupKey(p.projectId, p.month, p.network, p.asset), {
      projectId: p.projectId,
      month: p.month,
      network: p.network,
      asset: p.asset,
    });
  }
  const totals = new Map();
  for (const p of wanted.values()) {
    for (const row of monthly.filter(
      (r) =>
        r.projectId === p.projectId && r.month === p.month && r.network === p.network && r.asset === p.asset,
    )) {
      const id = `${row.network}:${row.tx}`;
      if (confirmed.has(id)) continue;
      if (await chainFinal(rpcCall, row.network, row.tx)) confirmed.add(id);
    }
    try {
      const data = await fetchJson(`${PAY_API}/projects/${p.projectId}/totals`);
      const a = Array.isArray(data?.assets) ? data.assets.find((x) => x.network === p.network && x.asset === p.asset) : undefined;
      const paid = minor(a?.totalNetPaidBase);
      if (paid === null) throw new Error(`totals for ${p.projectId} unreadable`);
      totals.set(groupKey(p.projectId, p.month, p.network, p.asset), {
        paid,
        fees: minor(a?.payoutFeesPaidBase) ?? -1n,
        reserved: minor(a?.reservedNetBase) ?? 0n,
      });
    } catch {
      // Totals are best-effort: a month whose totals could not be read waits.
    }
  }
  let merges = null;
  try {
    const merged = await fetchJson(MERGE_URL);
    if (merged && typeof merged === "object") merges = merged;
  } catch {
    // Merge figures are best-effort: a month whose merges could not be read waits.
  }
  const { receipts, confirmed: confirmedIds } = receiptsFrom(
    monthly,
    projects,
    recipients,
    totals,
    merges,
    { previous: prevItems, now },
  );
  return {
    builtAt: now.toISOString(),
    items: receipts,
    confirmed: confirmedIds,
  };
}
