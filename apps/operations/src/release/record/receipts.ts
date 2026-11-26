// spec/operations/recordPublication.md, "Every release rebuilds /data/record.json without failing the release and never drops a published receipt"
import type { JsonFetcher } from "./agg.ts";

export const PAY_API = "https://slop.cash/api/v1/payments";
export const PROJECTS_URL = "https://slop.cash/api/v1/projects";
export const MERGE_URL = "https://slop.cash/api/v1/merge-activity";
export const RECEIPTS_PAGE = "https://slop.cash/receipts";
export const TEAM_IDS = ["18633264", "202660855"] as const;
export const SETTLE_MS = 30 * 60 * 1000;
export const MAX_PAGES = 50;
export const FEE_BPS = 200n;

export type RpcCaller = (url: string, method: string, params: ReadonlyArray<unknown>) => Promise<unknown>;

export interface NetworkInfo {
  readonly name: string;
  readonly tx: string;
  readonly rpc: string;
  readonly kind: "evm" | "solana";
}

export const NETWORKS: Readonly<Record<string, NetworkInfo>> = {
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

export const STABLE: Readonly<Record<string, string>> = {
  "base-mainnet|0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
  "ethereum|0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
  "robinhood-mainnet|0x5fc5360d0400a0fd4f2af552add042d716f1d168": "USDG",
  "solana-mainnet|EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
};

const PROJECT = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/u;
const ACTOR = /^[1-9]\d{0,15}$/u;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u;
const SYMBOL = /^[A-Za-z0-9]{1,12}$/u;
const EVM_TX = /^0x[0-9a-f]{64}$/u;
const SOL_TX = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/u;
const DIGITS = /^\d{1,40}$/u;

interface RawRecord {
  readonly [key: string]: unknown;
}

function asRecord(value: unknown): RawRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function minor(v: unknown): bigint | null {
  return (typeof v === "string" || typeof v === "number") && DIGITS.test(String(v)) ? BigInt(v) : null;
}

function assetKey(network: string, address: string): string {
  return `${network}|${NETWORKS[network]?.kind === "solana" ? address : address.toLowerCase()}`;
}

export function groupKey(projectId: string, month: string, network: string, assetAddress: string): string {
  return `${projectId}|${month}|${network}|${assetAddress}`;
}

export function amount(minorUnits: bigint | number | string, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const scaled = BigInt(minorUnits) * 100n;
  let cents = scaled / scale;
  const rest = (scaled % scale) * 2n;
  if (rest > scale || (rest === scale && cents % 2n === 1n)) cents += 1n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const frac = (cents % 100n).toString().padStart(2, "0");
  return frac === "00" ? whole : `${whole}.${frac}`;
}

export function feeOn(net: bigint | number | string): bigint {
  const n = BigInt(net);
  return (n * FEE_BPS + (10000n - FEE_BPS) - 1n) / (10000n - FEE_BPS);
}

export interface VaultPayment {
  readonly id: string;
  readonly projectId: string;
  readonly network: string;
  readonly month: string | null;
  readonly asset: string;
  readonly decimals: number;
  readonly net: bigint;
  readonly tx: string;
  readonly indexedAt: string;
}

export function payment(input: unknown): VaultPayment | null {
  const p = asRecord(input);
  if (p === null) return null;
  const net = minor(p.netBase);
  const dec = p.assetDecimals;
  if (typeof p.id !== "string" || p.id === "" || p.id.length > 240) return null;
  if (typeof p.projectId !== "string" || !PROJECT.test(p.projectId)) return null;
  if (typeof p.network !== "string" || p.network === "" || p.network.length > 40) return null;
  if (typeof p.assetAddress !== "string" || p.assetAddress === "" || p.assetAddress.length > 80) return null;
  if (typeof p.transactionId !== "string") return null;
  if (typeof dec !== "number" || !Number.isInteger(dec) || dec < 0 || dec > 36) return null;
  if (net === null || net <= 0n) return null;
  if (typeof p.indexedAt !== "string" || Number.isNaN(Date.parse(p.indexedAt))) return null;
  const month = p.contributionMonth ?? null;
  if (month !== null && !(typeof month === "string" && MONTH.test(month))) return null;
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

export function ownerId(projectInput: unknown): string | null {
  const project = asRecord(projectInput);
  const steward = asRecord(project?.steward);
  const gh = asRecord(steward?.github);
  if (gh !== null && gh.type === "User") {
    const id = typeof gh.actorId === "string" || typeof gh.actorId === "number" ? String(gh.actorId) : "";
    return ACTOR.test(id) ? id : null;
  }
  return null;
}

export function assetOf(projectInput: unknown, network: string, address: string): { readonly symbol: string; readonly stable: boolean } | null {
  const key = assetKey(network, address);
  const stableSymbol = STABLE[key];
  if (stableSymbol !== undefined) return { symbol: stableSymbol, stable: true };
  const project = asRecord(projectInput);
  const asset = asRecord(project?.rewardAsset);
  if (asset !== null && typeof asset.address === "string") {
    const same = NETWORKS[network]?.kind === "solana"
      ? asset.address === address
      : asset.address.toLowerCase() === address.toLowerCase();
    if (same && typeof asset.symbol === "string" && SYMBOL.test(asset.symbol)) {
      return { symbol: asset.symbol, stable: false };
    }
  }
  return null;
}

export interface MergeRepositoryFigure {
  readonly repository: string;
  readonly mergedOutside: number;
  readonly medianHours: number | null;
}

export interface MergeFigures {
  readonly windowDays: number;
  readonly asOf: string;
  readonly repositories: ReadonlyArray<MergeRepositoryFigure>;
}

export function mergeFigures(rows: unknown, nowIso: string): MergeFigures | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const repos: MergeRepositoryFigure[] = [];
  for (const entry of rows) {
    const r = asRecord(entry);
    if (r === null || typeof r.repository !== "string" || Boolean(r.lastAttemptFailed)) continue;
    const mergedOutside = typeof r.mergedOutsideLast30Days === "number" && Number.isInteger(r.mergedOutsideLast30Days)
      ? r.mergedOutsideLast30Days
      : 0;
    const medianHours = typeof r.medianHoursToMerge === "number" && mergedOutside > 0
      ? Math.round(r.medianHoursToMerge * 10) / 10
      : null;
    repos.push({
      repository: r.repository.slice(0, 140),
      mergedOutside,
      medianHours,
    });
  }
  if (repos.length === 0) return null;
  return { windowDays: 30, asOf: nowIso, repositories: repos };
}

export interface ReceiptItem {
  readonly anchor: string;
  readonly url: string;
  readonly projectId: string;
  readonly project: string;
  readonly month: string;
  readonly network: string;
  readonly networkName: string;
  readonly asset: string;
  readonly assetAddress: string;
  readonly stable: boolean;
  readonly contributors: number;
  readonly total: string;
  readonly fee: string;
  readonly feeExact: boolean;
  readonly recipients: ReadonlyArray<{
    readonly login: string | null;
    readonly received: string;
    readonly transactions: ReadonlyArray<{ readonly id: string; readonly url: string }>;
  }>;
  readonly own: { readonly payments: number; readonly total: string } | null;
  readonly privateRecords: boolean;
  readonly reserved: string | null;
  readonly firstSentAt: string;
  readonly lastSentAt: string;
  readonly publishedAt: string;
  readonly merges: MergeFigures | null;
}

export interface ReceiptRecipientInfo {
  readonly actor: string;
  readonly login: string | null;
}

export interface AssetTotals {
  readonly paid: bigint;
  readonly fees: bigint;
  readonly reserved: bigint;
}

export interface ReceiptsFromInput {
  readonly payments: ReadonlyArray<VaultPayment>;
  readonly recipients: ReadonlyMap<string, ReceiptRecipientInfo>;
  readonly projects: ReadonlyMap<string, unknown>;
  readonly totals: ReadonlyMap<string, AssetTotals>;
  readonly confirmed: ReadonlySet<string>;
  readonly merges?: ReadonlyMap<string, unknown>;
  readonly previous?: ReadonlyArray<ReceiptItem>;
  readonly now: Date;
  readonly teamIds?: ReadonlyArray<string>;
}

export function receiptsFrom(input: ReceiptsFromInput): ReadonlyArray<ReceiptItem> {
  const { payments, recipients, projects, totals, confirmed, now } = input;
  const merges = input.merges ?? new Map<string, unknown>();
  const previous = input.previous ?? [];
  const teamIds = input.teamIds ?? TEAM_IDS;
  const nowIso = now.toISOString();
  const before = new Map<string, ReceiptItem>(
    previous.map((r) => [groupKey(r.projectId, r.month, r.network, r.assetAddress), r]),
  );
  const groups = new Map<string, VaultPayment[]>();
  const publicByAsset = new Map<string, VaultPayment[]>();
  for (const p of payments) {
    const ak = `${p.projectId}|${p.network}|${p.asset}`;
    const existingPublic = publicByAsset.get(ak);
    if (existingPublic === undefined) publicByAsset.set(ak, [p]);
    else existingPublic.push(p);
    if (p.month === null || NETWORKS[p.network] === undefined) continue;
    const key = groupKey(p.projectId, p.month, p.network, p.asset);
    const existingGroup = groups.get(key);
    if (existingGroup === undefined) groups.set(key, [p]);
    else existingGroup.push(p);
  }
  const out: ReceiptItem[] = [];
  const anchors = new Set<string>();
  const keys = [...groups.keys()].sort((a, b) => {
    const fa = (groups.get(a) ?? []).map((p) => p.indexedAt).sort()[0] ?? "";
    const fb = (groups.get(b) ?? []).map((p) => p.indexedAt).sort()[0] ?? "";
    return fa < fb ? -1 : fa > fb ? 1 : a < b ? -1 : 1;
  });
  for (const key of keys) {
    const rows = (groups.get(key) ?? [])
      .slice()
      .sort((a, b) =>
        a.indexedAt < b.indexedAt ? -1 : a.indexedAt > b.indexedAt ? 1 : a.id < b.id ? -1 : 1,
      );
    const firstRow = rows[0];
    if (firstRow === undefined || firstRow.month === null) continue;
    const { projectId, month, network, asset, decimals } = firstRow;
    const net = NETWORKS[network];
    if (net === undefined) continue;
    const project = projects.get(projectId);
    const excluded = new Set<string>(teamIds);
    const owner = ownerId(project);
    if (owner !== null) excluded.add(owner);
    const named: VaultPayment[] = [];
    const unnamed: VaultPayment[] = [];
    const outside: VaultPayment[] = [];
    const own: VaultPayment[] = [];
    for (const p of rows) {
      const who = recipients.get(p.id);
      if (who === undefined || who.actor === "") {
        unnamed.push(p);
      } else {
        named.push(p);
        if (excluded.has(who.actor)) own.push(p);
        else outside.push(p);
      }
    }
    if (outside.length === 0) continue;
    const known = assetOf(project, network, asset);
    const tot = totals.get(`${projectId}|${network}|${asset}`);
    const isFinal = (p: VaultPayment) => confirmed.has(`${network}:${p.tx}`);
    const prev = before.get(key);
    if (prev === undefined) {
      if (unnamed.length > 0) continue;
      if (!outside.every(isFinal)) continue;
      if (known === null || tot === undefined) continue;
      const newest = Math.max(...rows.map((p) => Date.parse(p.indexedAt)));
      if (now.getTime() - newest < SETTLE_MS) continue;
    }
    const finalPayments = outside.filter(isFinal);
    if (finalPayments.length === 0) continue;
    const symbol = known?.symbol ?? prev?.asset;
    if (symbol === undefined || symbol === "") continue;
    const byActor = new Map<string, { login: string | null; minor: bigint; txs: string[] }>();
    for (const p of finalPayments) {
      const who = recipients.get(p.id);
      if (who === undefined) continue;
      let entry = byActor.get(who.actor);
      if (entry === undefined) {
        entry = {
          login: who.login !== null && LOGIN.test(who.login) ? who.login : null,
          minor: 0n,
          txs: [],
        };
        byActor.set(who.actor, entry);
      }
      entry.minor += p.net;
      if (!entry.txs.includes(p.tx)) entry.txs.push(p.tx);
    }
    const people = [...byActor.values()].sort((a, b) =>
      a.minor > b.minor ? -1 : a.minor < b.minor ? 1 : String(a.login).localeCompare(String(b.login)),
    );
    const totalMinor = finalPayments.reduce((sum, p) => sum + p.net, 0n);
    const feeMinor = finalPayments.reduce((sum, p) => sum + feeOn(p.net), 0n);
    const allPublic = publicByAsset.get(`${projectId}|${network}|${asset}`) ?? [];
    const publicNet = allPublic.reduce((sum, p) => sum + p.net, 0n);
    const publicFees = allPublic.reduce((sum, p) => sum + feeOn(p.net), 0n);
    const privateRecords = tot !== undefined ? tot.paid > publicNet : Boolean(prev?.privateRecords);
    const feeExact = tot !== undefined && !privateRecords && tot.fees === publicFees;
    const ownMinor = own.reduce((sum, p) => sum + p.net, 0n);
    let anchor = prev?.anchor;
    if (anchor === undefined || anchor === "" || anchors.has(anchor)) {
      anchor = `${projectId}-${month}`;
      if (anchors.has(anchor)) anchor = `${projectId}-${month}-${network}`;
      if (anchors.has(anchor)) anchor = `${projectId}-${month}-${network}-${symbol.toLowerCase()}`;
    }
    anchors.add(anchor);
    const projectName = asRecord(project)?.name;
    const resolvedName = (typeof projectName === "string" && projectName !== "" ? projectName : prev?.project ?? projectId).trim().slice(0, 80);
    const sortedTimes = finalPayments.map((p) => p.indexedAt).sort();
    out.push({
      anchor,
      url: `${RECEIPTS_PAGE}#${anchor}`,
      projectId,
      project: resolvedName,
      month,
      network,
      networkName: net.name,
      asset: symbol,
      assetAddress: asset,
      stable: known !== null ? known.stable : Boolean(prev?.stable),
      contributors: people.length,
      total: amount(totalMinor, decimals),
      fee: amount(feeMinor, decimals),
      feeExact,
      recipients: people.map((r) => ({
        login: r.login,
        received: amount(r.minor, decimals),
        transactions: r.txs.map((t) => ({ id: t, url: net.tx + t })),
      })),
      own: own.length > 0 ? { payments: own.length, total: amount(ownMinor, decimals) } : null,
      privateRecords,
      reserved: tot !== undefined ? (tot.reserved > 0n ? amount(tot.reserved, decimals) : null) : (prev?.reserved ?? null),
      firstSentAt: sortedTimes[0] ?? nowIso,
      lastSentAt: sortedTimes.at(-1) ?? nowIso,
      publishedAt: prev?.publishedAt ?? nowIso,
      merges: prev !== undefined ? (prev.merges ?? null) : mergeFigures(merges.get(projectId), nowIso),
    });
  }
  return out;
}

export async function walk(fetchJson: JsonFetcher, url: string): Promise<ReadonlyArray<unknown> | null> {
  const out: unknown[] = [];
  let query = "";
  try {
    for (let i = 0; i < MAX_PAGES; i += 1) {
      const data = asRecord(await fetchJson(url + query));
      if (data === null || !Array.isArray(data.payments) || typeof data.through !== "number" || !Number.isInteger(data.through)) {
        return null;
      }
      for (const item of data.payments as ReadonlyArray<unknown>) out.push(item);
      if (data.next === null || data.next === undefined) return out;
      if (typeof data.next !== "number" || !Number.isInteger(data.next)) return null;
      query = `?after=${data.next}&through=${data.through}`;
    }
  } catch {
    return null;
  }
  return null;
}

export async function chainFinal(rpcCall: RpcCaller, network: string, tx: string): Promise<boolean> {
  const net = NETWORKS[network];
  if (net === undefined) return false;
  try {
    if (net.kind === "solana") {
      if (!SOL_TX.test(tx)) return false;
      const got = asRecord(await rpcCall(net.rpc, "getSignatureStatuses", [[tx], { searchTransactionHistory: true }]));
      const values = Array.isArray(got?.value) ? got.value : [];
      const status = asRecord(values[0]);
      return status !== null && status.err === null && status.confirmationStatus === "finalized";
    }
    if (!EVM_TX.test(tx)) return false;
    const receipt = asRecord(await rpcCall(net.rpc, "eth_getTransactionReceipt", [tx]));
    const finalBlock = asRecord(await rpcCall(net.rpc, "eth_getBlockByNumber", ["finalized", false]));
    if (
      receipt === null ||
      finalBlock === null ||
      typeof receipt.blockNumber !== "string" ||
      typeof finalBlock.number !== "string"
    ) {
      return false;
    }
    return receipt.status === "0x1" && BigInt(receipt.blockNumber) <= BigInt(finalBlock.number);
  } catch {
    return false;
  }
}

export interface ReceiptsBundle {
  readonly builtAt: string | null;
  readonly items: ReadonlyArray<ReceiptItem>;
  readonly confirmed: ReadonlyArray<string>;
}

export async function loadReceipts(
  fetchJson: JsonFetcher,
  rpcCall: RpcCaller,
  options: { readonly previous?: ReceiptsBundle | null; readonly now?: Date } = {},
): Promise<ReceiptsBundle> {
  const now = options.now ?? new Date();
  const previous = options.previous ?? null;
  const raw = await walk(fetchJson, `${PAY_API}/vault-payments`);
  if (raw === null) throw new Error("vault payment record unreadable");
  const payments = raw.map(payment).filter((p): p is VaultPayment => p !== null);
  const registry = asRecord(await fetchJson(PROJECTS_URL));
  if (!Array.isArray(registry?.projects) || registry.projects.length === 0) {
    throw new Error("project list unreadable");
  }
  const projects = new Map<string, unknown>();
  for (const p of registry.projects) {
    const rec = asRecord(p);
    if (rec !== null && typeof rec.id === "string") projects.set(rec.id, rec);
  }

  const recipients = new Map<string, ReceiptRecipientInfo>();
  const monthly = payments.filter((p) => p.month !== null && NETWORKS[p.network] !== undefined);
  if (monthly.length > 0) {
    const received = asRecord(await fetchJson(`${PAY_API}/received`));
    const people = received?.contributors;
    if (!Array.isArray(people)) throw new Error("recipient list unreadable");
    for (const entry of people) {
      const c = asRecord(entry);
      if (c === null) continue;
      const actor = typeof c.githubUserId === "string" || typeof c.githubUserId === "number" ? String(c.githubUserId) : "";
      if (!ACTOR.test(actor) || typeof c.vaultPayments !== "number" || !Number.isInteger(c.vaultPayments) || c.vaultPayments <= 0) {
        continue;
      }
      const theirs = await walk(fetchJson, `${PAY_API}/actors/${actor}/vault-payments`);
      if (theirs === null) continue;
      const login = typeof c.login === "string" && LOGIN.test(c.login) ? c.login : null;
      for (const p of theirs) {
        const pr = asRecord(p);
        if (pr !== null && typeof pr.id === "string") recipients.set(pr.id, { actor, login });
      }
    }
  }

  const prevItems = Array.isArray(previous?.items) ? previous.items : [];
  const confirmed = new Set<string>(
    Array.isArray(previous?.confirmed)
      ? previous.confirmed.filter((x): x is string => typeof x === "string")
      : [],
  );
  const wanted = new Map<string, VaultPayment>();
  for (const p of monthly) {
    const r = recipients.get(p.id);
    if (r === undefined || p.month === null) continue;
    const excluded = new Set<string>(TEAM_IDS);
    const owner = ownerId(projects.get(p.projectId));
    if (owner !== null) excluded.add(owner);
    if (!excluded.has(r.actor)) {
      wanted.set(groupKey(p.projectId, p.month, p.network, p.asset), p);
    }
  }
  const totals = new Map<string, AssetTotals>();
  for (const p of wanted.values()) {
    if (p.month === null) continue;
    const pKey = groupKey(p.projectId, p.month, p.network, p.asset);
    for (const row of monthly) {
      if (row.month === null || groupKey(row.projectId, row.month, row.network, row.asset) !== pKey) {
        continue;
      }
      const id = `${row.network}:${row.tx}`;
      if (!confirmed.has(id) && recipients.has(row.id) && (await chainFinal(rpcCall, row.network, row.tx))) {
        confirmed.add(id);
      }
    }
    const tk = `${p.projectId}|${p.network}|${p.asset}`;
    if (totals.has(tk)) continue;
    try {
      const data = asRecord(await fetchJson(`${PAY_API}/projects/${p.projectId}/totals`));
      for (const entry of Array.isArray(data?.assets) ? data.assets : []) {
        const a = asRecord(entry);
        if (a === null || a.network !== p.network || a.assetAddress !== p.asset) continue;
        const paid = minor(a.totalNetPaidBase);
        if (paid !== null) {
          totals.set(tk, {
            paid,
            fees: minor(a.payoutFeesPaidBase) ?? -1n,
            reserved: minor(a.reservedNetBase) ?? 0n,
          });
        }
      }
    } catch {
      continue;
    }
  }
  const merges = new Map<string, unknown>();
  if (wanted.size > 0) {
    try {
      const data = asRecord(await fetchJson(MERGE_URL));
      if (data?.schema === "slop-merge-activity-v1" && Array.isArray(data.projects)) {
        for (const entry of data.projects) {
          const p = asRecord(entry);
          if (p !== null && typeof p.projectId === "string") merges.set(p.projectId, p.repositories);
        }
      }
    } catch {
      merges.clear();
    }
  }
  const items = receiptsFrom({
    payments,
    recipients,
    projects,
    totals,
    confirmed,
    merges,
    previous: prevItems,
    now,
  });
  return {
    builtAt: now.toISOString(),
    items,
    confirmed: [...confirmed].sort(),
  };
}
