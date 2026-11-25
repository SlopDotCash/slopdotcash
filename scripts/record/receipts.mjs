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
    tx: "https://robinhoodchain.blockscout.com/tx/",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    kind: "evm",
  },
  ethereum: {
    name: "Ethereum",
    tx: "https://etherscan.io/tx/",
    rpc: "https://ethereum-rpc.publicnode.com",
    kind: "evm",
  },
  "solana-mainnet": {
    name: "Solana",
    tx: "https://explorer.solana.com/tx/",
    rpc: "https://api.mainnet-beta.solana.com",
    kind: "solana",
  },
};

const STABLE = {
  "base-mainnet|0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": "USDC",
  "ethereum|0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": "USDC",
  "robinhood-mainnet|0x5fc5360d0400a0fd4f2af552add042d716f1d168": "USDG",
  "solana-mainnet|EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
};

const PROJECT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ACTOR = /^[1-9]\d{0,15}$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const SYMBOL = /^[A-Za-z0-9]{1,12}$/;
const EVM_TX = /^0x[0-9a-f]{64}$/;
const SOL_TX = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const DIGITS = /^\d{1,40}$/;

function minor(v) {
  return (typeof v === "string" || typeof v === "number") && DIGITS.test(String(v)) ? BigInt(v) : null;
}

function assetKey(network, address) {
  return `${network}|${NETWORKS[network]?.kind === "solana" ? address : String(address).toLowerCase()}`;
}

export function groupKey(projectId, month, network, assetAddress) {
  return `${projectId}|${month}|${network}|${assetAddress}`;
}

export function amount(minorUnits, decimals) {
  const scale = 10n ** BigInt(decimals);
  const scaled = BigInt(minorUnits) * 100n;
  let cents = scaled / scale;
  const rest = scaled % scale;
  if (rest * 2n > scale || (rest * 2n === scale && cents % 2n === 1n)) cents += 1n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (cents % 100n).toString().padStart(2, "0");
  return frac === "00" ? whole : `${whole}.${frac}`;
}

export function feeOn(net) {
  const n = BigInt(net);
  return (n * FEE_BPS + (10000n - FEE_BPS) - 1n) / (10000n - FEE_BPS);
}

export function payment(p) {
  const net = minor(p.netBase);
  const dec = p.assetDecimals;
  if (typeof p.id !== "string" || !p.id || p.id.length > 240) return null;
  if (typeof p.projectId !== "string" || !PROJECT.test(p.projectId)) return null;
  if (typeof p.network !== "string" || !NETWORKS[p.network]) return null;
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

export function ownerId(project) {
  const gh = project?.steward?.github;
  if (gh && typeof gh === "object" && gh.type === "User") {
    const id = String(gh.actorId ?? "");
    return ACTOR.test(id) ? id : null;
  }
  return null;
}

export function assetOf(project, network, address) {
  const key = assetKey(network, address);
  if (STABLE[key]) return { symbol: STABLE[key], stable: true };
  const a = project?.rewardAsset;
  if (a && typeof a === "object" && typeof a.address === "string") {
    const same =
      NETWORKS[network]?.kind === "solana"
        ? a.address === address
        : a.address.toLowerCase() === String(address).toLowerCase();
    if (same && typeof a.symbol === "string" && SYMBOL.test(a.symbol)) {
      return { symbol: a.symbol, stable: false };
    }
  }
  return null;
}

export function mergeFigures(rows, nowIso) {
  const repos = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.repository === "string" && !r.lastAttemptFailed)
    .map((r) => ({
      repository: r.repository.slice(0, 140),
      mergedOutside: Number.isInteger(r.mergedOutsideLast30Days) ? r.mergedOutsideLast30Days : null,
      medianHours:
        typeof r.medianHoursToMerge === "number" && r.mergedOutsideLast30Days
          ? Math.round(r.medianHoursToMerge * 10) / 10
          : null,
    }));
  if (!repos.length) return null;
  return { windowDays: 30, asOf: nowIso, repositories: repos };
}

export function receiptsFrom({
  payments,
  recipients,
  projects,
  totals,
  confirmed,
  merges = new Map(),
  previous = [],
  now,
  teamIds = TEAM_IDS,
}) {
  const nowIso = now.toISOString();
  const before = new Map(previous.map((r) => [groupKey(r.projectId, r.month, r.network, r.assetAddress), r]));
  const groups = new Map();
  const publicByAsset = new Map();
  for (const p of payments) {
    const ak = `${p.projectId}|${p.network}|${p.asset}`;
    if (!publicByAsset.has(ak)) publicByAsset.set(ak, []);
    publicByAsset.get(ak).push(p);
    if (p.month === null || !NETWORKS[p.network]) continue;
    const key = groupKey(p.projectId, p.month, p.network, p.asset);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const fa = groups
      .get(a)
      .map((p) => p.indexedAt)
      .sort()[0];
    const fb = groups
      .get(b)
      .map((p) => p.indexedAt)
      .sort()[0];
    return fa < fb ? -1 : fa > fb ? 1 : a < b ? -1 : 1;
  });
  const anchors = new Set();
  const out = [];
  for (const key of keys) {
    const rows = groups
      .get(key)
      .slice()
      .sort((a, b) =>
        a.indexedAt < b.indexedAt ? -1 : a.indexedAt > b.indexedAt ? 1 : a.id < b.id ? -1 : 1,
      );
    const { projectId, month, network, asset, decimals } = rows[0];
    const project = projects.get(projectId);
    const excluded = new Set(teamIds);
    const owner = ownerId(project);
    if (owner) excluded.add(owner);
    const who = (p) => recipients.get(p.id);
    const named = rows.filter((p) => who(p)?.actor);
    const unnamed = rows.filter((p) => !who(p)?.actor);
    const outside = named.filter((p) => !excluded.has(who(p).actor));
    const own = named.filter((p) => excluded.has(who(p).actor));
    if (!outside.length) continue;
    const known = assetOf(project, network, asset);
    const tot = totals.get(`${projectId}|${network}|${asset}`);
    const isFinal = (p) => confirmed.has(`${network}:${p.tx}`);
    const prev = before.get(key);
    if (!prev) {
      if (unnamed.length) continue;
      if (!outside.every(isFinal)) continue;
      if (!known || !tot) continue;
      const newest = Math.max(...rows.map((p) => Date.parse(p.indexedAt)));
      if (now.getTime() - newest < SETTLE_MS) continue;
    }
    const final = outside.filter(isFinal);
    if (!final.length) continue;
    const symbol = known?.symbol ?? prev?.asset;
    if (!symbol) continue;
    const net = NETWORKS[network];
    const byActor = new Map();
    for (const p of final) {
      const { actor, login } = who(p);
      if (!byActor.has(actor)) {
        byActor.set(actor, {
          login: typeof login === "string" && LOGIN.test(login) ? login : null,
          minor: 0n,
          txs: [],
        });
      }
      const r = byActor.get(actor);
      r.minor += p.net;
      if (!r.txs.includes(p.tx)) r.txs.push(p.tx);
    }
    const people = [...byActor.values()].sort((a, b) =>
      a.minor > b.minor ? -1 : a.minor < b.minor ? 1 : String(a.login).localeCompare(String(b.login)),
    );
    const totalMinor = final.reduce((sum, p) => sum + p.net, 0n);
    const feeMinor = final.reduce((sum, p) => sum + feeOn(p.net), 0n);
    const allPublic = publicByAsset.get(`${projectId}|${network}|${asset}`) ?? [];
    const publicNet = allPublic.reduce((sum, p) => sum + p.net, 0n);
    const publicFees = allPublic.reduce((sum, p) => sum + feeOn(p.net), 0n);
    const privateRecords = tot ? tot.paid > publicNet : Boolean(prev?.privateRecords);
    const feeExact = Boolean(tot) && !privateRecords && tot.fees === publicFees;
    const ownMinor = own.reduce((sum, p) => sum + p.net, 0n);
    let anchor = prev?.anchor;
    if (!anchor || anchors.has(anchor)) {
      anchor = `${projectId}-${month}`;
      if (anchors.has(anchor)) anchor = `${projectId}-${month}-${network}`;
      if (anchors.has(anchor)) anchor = `${projectId}-${month}-${network}-${symbol.toLowerCase()}`;
    }
    anchors.add(anchor);
    out.push({
      anchor,
      url: `${RECEIPTS_PAGE}#${anchor}`,
      projectId,
      project: String(project?.name || prev?.project || projectId)
        .trim()
        .slice(0, 80),
      month,
      network,
      networkName: net.name,
      asset: symbol,
      assetAddress: asset,
      stable: known ? known.stable : Boolean(prev?.stable),
      contributors: people.length,
      total: amount(totalMinor, decimals),
      fee: amount(feeMinor, decimals),
      feeExact,
      recipients: people.map((r) => ({
        login: r.login,
        received: amount(r.minor, decimals),
        transactions: r.txs.map((t) => ({ id: t, url: net.tx + t })),
      })),
      own: own.length ? { payments: own.length, total: amount(ownMinor, decimals) } : null,
      privateRecords,
      reserved: tot ? (tot.reserved > 0n ? amount(tot.reserved, decimals) : null) : (prev?.reserved ?? null),
      firstSentAt: final.map((p) => p.indexedAt).sort()[0],
      lastSentAt: final.map((p) => p.indexedAt).sort().at(-1),
      publishedAt: prev?.publishedAt ?? nowIso,
      merges: prev ? (prev.merges ?? null) : mergeFigures(merges.get(projectId), nowIso),
    });
  }
  return out;
}

// Every payment at `url`, walked under the first answer's frozen boundary, or
// null when any page could not be read.
export async function walk(fetchJson, url) {
  const out = [];
  let query = "";
  try {
    for (let i = 0; i < MAX_PAGES; i++) {
      const data = await fetchJson(url + query);
      if (!Array.isArray(data?.payments) || !Number.isInteger(data.through)) return null;
      out.push(...data.payments);
      if (data.next === null || data.next === undefined) return out;
      if (!Number.isInteger(data.next)) return null;
      query = `?after=${data.next}&through=${data.through}`;
    }
  } catch {
    return null;
  }
  return null;
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

// Reads everything and returns { builtAt, items, confirmed }. Throws when the payment
// list, the project list or the recipient list could not be read. Totals, merges and
// transaction finality are read best-effort: a month whose totals or finality could
// not be read waits, and a published month keeps its last figures.
export async function loadReceipts(fetchJson, rpcCall, { previous = {}, now = new Date() } = {}) {
  const prevItems = Array.isArray(previous?.items) ? previous.items : [];
  const confirmed = new Set(Array.isArray(previous?.confirmed) ? previous.confirmed : []);
  const registry = await fetchJson(PROJECTS_URL);
  if (!Array.isArray(registry?.projects)) throw new Error("project list unreadable");
  const projects = new Map(registry.projects.filter((p) => p && typeof p.id === "string").map((p) => [p.id, p]));
  const payments = (await walk(fetchJson, PAY_API))?.map(payment).filter((p) => p !== null);
  if (!Array.isArray(payments)) throw new Error("payment list unreadable");
  const recipients = new Map();
  const monthly = payments.filter((p) => p.month !== null && NETWORKS[p.network]);
  if (monthly.length) {
    const people = (await fetchJson(`${PAY_API}/received`))?.contributors;
    if (!Array.isArray(people)) throw new Error("recipient list unreadable");
    for (const c of people) {
      const actor = String(c?.githubUserId ?? "");
      if (!ACTOR.test(actor) || !Number.isInteger(c.vaultPayments) || c.vaultPayments <= 0) continue;
      const theirs = await walk(fetchJson, `${PAY_API}/actors/${actor}/vault-payments`);
      if (theirs === null) continue;
      const login = typeof c.login === "string" && LOGIN.test(c.login) ? c.login : null;
      for (const p of theirs) if (typeof p?.id === "string") recipients.set(p.id, { actor, login });
    }
  }
  const wanted = new Map();
  for (const p of monthly) {
    const r = recipients.get(p.id);
    if (!r) continue;
    const excluded = new Set(TEAM_IDS);
    const owner = ownerId(projects.get(p.projectId));
    if (owner) excluded.add(owner);
    if (!excluded.has(r.actor)) wanted.set(groupKey(p.projectId, p.month, p.network, p.asset), p);
  }
  for (const p of wanted.values()) {
    for (const row of monthly) {
      if (groupKey(row.projectId, row.month, row.network, row.asset) !== groupKey(p.projectId, p.month, p.network, p.asset)) continue;
      const id = `${row.network}:${row.tx}`;
      if (!confirmed.has(id) && recipients.get(row.id) && (await chainFinal(rpcCall, row.network, row.tx))) {
        confirmed.add(id);
      }
    }
  }
  const totals = new Map();
  for (const p of wanted.values()) {
    const tk = `${p.projectId}|${p.network}|${p.asset}`;
    if (totals.has(tk)) continue;
    try {
      const data = await fetchJson(`${PAY_API}/projects/${p.projectId}/totals`);
      const a = Array.isArray(data?.assets)
        ? data.assets.find((x) => x?.network === p.network && x?.assetAddress === p.asset)
        : undefined;
      const paid = minor(a?.totalNetPaidBase);
      if (paid === null) throw new Error(`totals for ${p.projectId} unreadable`);
      totals.set(tk, {
        paid,
        fees: minor(a?.payoutFeesPaidBase) ?? -1n,
        reserved: minor(a?.reservedNetBase) ?? 0n,
      });
    } catch {
      // A new month waits for its totals, a published one keeps its last figures.
    }
  }
  let merges = new Map();
  try {
    const data = await fetchJson(MERGE_URL);
    if (data?.schema === "slop-merge-activity-v1" && Array.isArray(data.projects)) {
      merges = new Map(
        data.projects
          .filter((p) => p && typeof p.projectId === "string")
          .map((p) => [p.projectId, p.repositories]),
      );
    }
  } catch {
    // A receipt without merge figures says so.
  }
  const items = receiptsFrom({ payments, recipients, projects, totals, confirmed, merges, previous: prevItems, now });
  return { builtAt: now.toISOString(), items, confirmed: [...confirmed].sort() };
}
