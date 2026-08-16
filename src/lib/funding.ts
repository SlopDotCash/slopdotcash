/** Strict, non-custodial project-funding records and deterministic totals. */

import { isSolanaAddress } from "./wallets";

export const FUNDING_PROTOCOL_VERSION = "1" as const;
export type FundingNetwork = "base" | "bitcoin" | "ethereum" | "solana";
export type FundingAsset = "BTC" | "USDC";
export type FundingState = "disputed" | "self-reported" | "verified-on-chain";

export interface ProjectFundingAddress {
  network: FundingNetwork;
  asset: FundingAsset;
  address: string;
  effectiveAt: string;
  replacedAt: string | null;
}

export interface ProjectFundingRecord {
  schemaVersion: typeof FUNDING_PROTOCOL_VERSION;
  kind: "project-funding";
  recordId: string;
  projectId: string;
  manifestRevision: string;
  network: FundingNetwork;
  asset: FundingAsset;
  transactionId: string;
  recipient: string;
  amountMinor: string;
  observedAt: string;
  state: FundingState;
  donor:
    | { attribution: "anonymous" }
    | { attribution: "github"; actorId: string; login: string };
  finality:
    | { kind: "confirmations"; confirmations: number }
    | { kind: "finalized" }
    | { kind: "unverified" };
  verifier: null | {
    version: string;
    checkedAt: string;
    evidenceUrl: string;
    reason: string | null;
  };
  supersedes: string | null;
}

export interface ProjectFundingIndex {
  schemaVersion: typeof FUNDING_PROTOCOL_VERSION;
  generatedAt: string | null;
  records: readonly ProjectFundingRecord[];
}

const NETWORK_ASSET: Readonly<Record<FundingNetwork, FundingAsset>> = {
  base: "USDC",
  bitcoin: "BTC",
  ethereum: "USDC",
  solana: "USDC",
};
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const RECORD_ID_PATTERN = /^fund_[a-z0-9](?:[a-z0-9_-]{6,79})$/u;
const PROJECT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  field: string,
) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(`${field} has unexpected or missing fields`);
  }
}

function timestamp(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function canonicalMinor(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new TypeError(`${field} must be canonical integer minor units`);
  }
  if (BigInt(value) === 0n) throw new TypeError(`${field} must be positive`);
  return value;
}

function decodedBase58Length(value: string): number | null {
  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return null;
    number = number * 58n + BigInt(digit);
  }
  let bytes = 0;
  while (number > 0n) {
    bytes += 1;
    number >>= 8n;
  }
  return (value.match(/^1*/u)?.[0].length ?? 0) + bytes;
}

function bech32Polymod(values: readonly number[]): number {
  const generators = [
    0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
  ];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < generators.length; index += 1) {
      if ((top >>> index) & 1) checksum ^= generators[index];
    }
  }
  return checksum >>> 0;
}

function validBitcoinAddress(value: string): boolean {
  if (value !== value.toLowerCase() || !value.startsWith("bc1")) return false;
  const separator = value.lastIndexOf("1");
  if (separator !== 2 || value.length < 14 || value.length > 90) return false;
  const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const data = [...value.slice(separator + 1)].map((character) =>
    alphabet.indexOf(character),
  );
  if (data.some((entry) => entry < 0) || data.length < 7) return false;
  const encoding = bech32Polymod([3, 3, 0, 2, 3, ...data]);
  return encoding === 1 || encoding === 0x2bc830a3;
}

export function isFundingAddress(
  network: FundingNetwork,
  value: string,
): boolean {
  if (network === "solana") return isSolanaAddress(value);
  if (network === "bitcoin") return validBitcoinAddress(value);
  return /^0x[0-9a-f]{40}$/u.test(value) && !/^0x0{40}$/u.test(value);
}

function validTransactionId(
  network: FundingNetwork,
  value: unknown,
): value is string {
  if (typeof value !== "string") return false;
  if (network === "solana") return decodedBase58Length(value) === 64;
  return (
    /^(?:0x)?[0-9a-f]{64}$/u.test(value) &&
    (network === "ethereum" || network === "base"
      ? value.startsWith("0x")
      : !value.startsWith("0x"))
  );
}

export function assertProjectFundingAddresses(
  value: unknown,
): readonly ProjectFundingAddress[] {
  if (!Array.isArray(value) || value.length > 4) {
    throw new TypeError(
      "project funding addresses must be an array of at most four routes",
    );
  }
  const seen = new Set<string>();
  return value.map((candidate, index) => {
    const field = `project funding address ${index}`;
    const route = object(candidate, field);
    exactKeys(
      route,
      ["address", "asset", "effectiveAt", "network", "replacedAt"],
      field,
    );
    if (
      typeof route.network !== "string" ||
      !(route.network in NETWORK_ASSET)
    ) {
      throw new TypeError(`${field} network is unsupported`);
    }
    const network = route.network as FundingNetwork;
    if (route.asset !== NETWORK_ASSET[network]) {
      throw new TypeError(`${field} asset is unsupported for its network`);
    }
    if (
      typeof route.address !== "string" ||
      !isFundingAddress(network, route.address)
    ) {
      throw new TypeError(`${field} address is invalid`);
    }
    const effectiveAt = timestamp(route.effectiveAt, `${field}.effectiveAt`);
    const replacedAt =
      route.replacedAt === null
        ? null
        : timestamp(route.replacedAt, `${field}.replacedAt`);
    if (
      replacedAt !== null &&
      Date.parse(replacedAt) <= Date.parse(effectiveAt)
    ) {
      throw new TypeError(`${field} replacement must follow activation`);
    }
    const key = `${network}:${route.asset}`;
    if (seen.has(key)) {
      throw new TypeError(
        "project funding addresses contain a duplicate network and asset",
      );
    }
    seen.add(key);
    return {
      network,
      asset: route.asset,
      address: route.address,
      effectiveAt,
      replacedAt,
    } as ProjectFundingAddress;
  });
}

function assertFinality(
  state: FundingState,
  network: FundingNetwork,
  value: unknown,
) {
  const finality = object(value, "funding record finality");
  if (finality.kind === "unverified") {
    exactKeys(finality, ["kind"], "funding record finality");
    if (state !== "self-reported") {
      throw new TypeError("only self-reported funding may be unverified");
    }
    return;
  }
  if (finality.kind === "finalized") {
    exactKeys(finality, ["kind"], "funding record finality");
    if (network !== "solana" || state === "self-reported") {
      throw new TypeError("finalized funding state is inconsistent");
    }
    return;
  }
  exactKeys(finality, ["confirmations", "kind"], "funding record finality");
  const minimum =
    network === "bitcoin"
      ? 6
      : network === "ethereum"
        ? 64
        : network === "base"
          ? 12
          : Number.POSITIVE_INFINITY;
  if (
    !Number.isSafeInteger(finality.confirmations) ||
    Number(finality.confirmations) < minimum ||
    state === "self-reported"
  ) {
    throw new TypeError(
      "funding record does not meet the network finality policy",
    );
  }
}

export function assertProjectFundingRecord(
  value: unknown,
  addresses: readonly ProjectFundingAddress[],
): ProjectFundingRecord {
  const record = object(value, "funding record");
  exactKeys(
    record,
    [
      "amountMinor",
      "asset",
      "donor",
      "finality",
      "kind",
      "manifestRevision",
      "network",
      "observedAt",
      "projectId",
      "recipient",
      "recordId",
      "schemaVersion",
      "state",
      "supersedes",
      "transactionId",
      "verifier",
    ],
    "funding record",
  );
  if (
    record.schemaVersion !== FUNDING_PROTOCOL_VERSION ||
    record.kind !== "project-funding"
  ) {
    throw new TypeError("funding record protocol is unsupported");
  }
  if (
    typeof record.recordId !== "string" ||
    !RECORD_ID_PATTERN.test(record.recordId)
  ) {
    throw new TypeError("funding record id is invalid");
  }
  if (
    typeof record.projectId !== "string" ||
    !PROJECT_ID_PATTERN.test(record.projectId)
  ) {
    throw new TypeError("funding record project is invalid");
  }
  if (
    typeof record.manifestRevision !== "string" ||
    !SHA_PATTERN.test(record.manifestRevision)
  ) {
    throw new TypeError("funding record manifest revision is invalid");
  }
  if (
    typeof record.network !== "string" ||
    !(record.network in NETWORK_ASSET)
  ) {
    throw new TypeError("funding record network is unsupported");
  }
  const network = record.network as FundingNetwork;
  if (record.asset !== NETWORK_ASSET[network]) {
    throw new TypeError("funding record asset is unsupported");
  }
  if (!validTransactionId(network, record.transactionId)) {
    throw new TypeError("funding record transaction id is invalid");
  }
  if (
    typeof record.recipient !== "string" ||
    !isFundingAddress(network, record.recipient)
  ) {
    throw new TypeError("funding record recipient is invalid");
  }
  const observedAt = timestamp(record.observedAt, "funding record observedAt");
  const route = addresses.find(
    (candidate) =>
      candidate.network === network &&
      candidate.asset === record.asset &&
      candidate.address === record.recipient &&
      Date.parse(candidate.effectiveAt) <= Date.parse(observedAt) &&
      (candidate.replacedAt === null ||
        Date.parse(observedAt) < Date.parse(candidate.replacedAt)),
  );
  if (!route) {
    throw new TypeError(
      "funding record recipient was not active at the manifest-bound observation time",
    );
  }
  canonicalMinor(record.amountMinor, "funding record amountMinor");
  if (
    record.state !== "self-reported" &&
    record.state !== "verified-on-chain" &&
    record.state !== "disputed"
  ) {
    throw new TypeError("funding record state is invalid");
  }
  assertFinality(record.state, network, record.finality);
  const donor = object(record.donor, "funding record donor");
  if (donor.attribution === "anonymous") {
    exactKeys(donor, ["attribution"], "funding record donor");
  } else {
    exactKeys(
      donor,
      ["actorId", "attribution", "login"],
      "funding record donor",
    );
    if (
      donor.attribution !== "github" ||
      typeof donor.actorId !== "string" ||
      !/^[1-9]\d*$/u.test(donor.actorId) ||
      typeof donor.login !== "string" ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/u.test(donor.login)
    ) {
      throw new TypeError("funding record donor identity is invalid");
    }
  }
  if (record.state === "self-reported") {
    if (record.verifier !== null) {
      throw new TypeError(
        "self-reported funding cannot claim independent verification",
      );
    }
  } else {
    const verifier = object(record.verifier, "funding record verifier");
    exactKeys(
      verifier,
      ["checkedAt", "evidenceUrl", "reason", "version"],
      "funding record verifier",
    );
    timestamp(verifier.checkedAt, "funding record verifier.checkedAt");
    if (
      typeof verifier.version !== "string" ||
      !/^funding-[a-z0-9-]+-v\d+$/u.test(verifier.version)
    ) {
      throw new TypeError("funding record verifier version is invalid");
    }
    if (
      typeof verifier.evidenceUrl !== "string" ||
      !/^https:\/\//u.test(verifier.evidenceUrl)
    ) {
      throw new TypeError("funding record verifier evidence is invalid");
    }
    if (
      record.state === "disputed"
        ? typeof verifier.reason !== "string" ||
          verifier.reason.trim().length < 8
        : verifier.reason !== null
    ) {
      throw new TypeError("funding record dispute reason is inconsistent");
    }
  }
  if (
    record.supersedes !== null &&
    (typeof record.supersedes !== "string" ||
      !RECORD_ID_PATTERN.test(record.supersedes))
  ) {
    throw new TypeError("funding record supersedes id is invalid");
  }
  return value as ProjectFundingRecord;
}

export function assertProjectFundingLedger(
  values: readonly unknown[],
  addresses: readonly ProjectFundingAddress[],
): readonly ProjectFundingRecord[] {
  const records = values.map((value) =>
    assertProjectFundingRecord(value, addresses),
  );
  const byId = new Map<string, ProjectFundingRecord>();
  const latestByTransaction = new Map<string, ProjectFundingRecord>();
  for (const record of records) {
    if (byId.has(record.recordId)) {
      throw new TypeError("funding ledger contains a duplicate record id");
    }
    const transactionKey = `${record.network}:${record.transactionId}`;
    const prior = latestByTransaction.get(transactionKey);
    if ((prior?.recordId ?? null) !== record.supersedes) {
      throw new TypeError(
        "funding ledger duplicate or correction chain is invalid",
      );
    }
    if (record.supersedes !== null && !byId.has(record.supersedes)) {
      throw new TypeError(
        "funding ledger supersedes a missing or later record",
      );
    }
    if (
      prior &&
      (prior.recipient !== record.recipient ||
        prior.asset !== record.asset ||
        Date.parse(record.observedAt) <= Date.parse(prior.observedAt))
    ) {
      throw new TypeError(
        "funding ledger correction changes transaction identity or is not later",
      );
    }
    byId.set(record.recordId, record);
    latestByTransaction.set(transactionKey, record);
  }
  return records;
}

export function projectFundingTotals(records: readonly ProjectFundingRecord[]) {
  const latest = new Map<string, ProjectFundingRecord>();
  for (const record of records) {
    latest.set(`${record.network}:${record.transactionId}`, record);
  }
  const byAsset = new Map<
    FundingAsset,
    { selfReportedMinor: bigint; verifiedMinor: bigint }
  >();
  for (const record of latest.values()) {
    const totals = byAsset.get(record.asset) ?? {
      selfReportedMinor: 0n,
      verifiedMinor: 0n,
    };
    if (record.state === "self-reported") {
      totals.selfReportedMinor += BigInt(record.amountMinor);
    }
    if (record.state === "verified-on-chain") {
      totals.verifiedMinor += BigInt(record.amountMinor);
    }
    byAsset.set(record.asset, totals);
  }
  return [...byAsset.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([asset, totals]) => ({
      asset,
      selfReportedMinor: totals.selfReportedMinor.toString(),
      verifiedMinor: totals.verifiedMinor.toString(),
    }));
}

export function assertProjectFundingIndex(
  value: unknown,
  addressesByProject: ReadonlyMap<string, readonly ProjectFundingAddress[]>,
): ProjectFundingIndex {
  const index = object(value, "funding index");
  exactKeys(
    index,
    ["generatedAt", "records", "schemaVersion"],
    "funding index",
  );
  if (index.schemaVersion !== FUNDING_PROTOCOL_VERSION) {
    throw new TypeError("funding index protocol is unsupported");
  }
  const generatedAt =
    index.generatedAt === null
      ? null
      : timestamp(index.generatedAt, "funding index generatedAt");
  if (!Array.isArray(index.records) || index.records.length > 100_000) {
    throw new TypeError("funding index records are invalid or unbounded");
  }
  const grouped = new Map<string, unknown[]>();
  for (const candidate of index.records) {
    const projectId = object(candidate, "funding index record").projectId;
    if (typeof projectId !== "string" || !addressesByProject.has(projectId)) {
      throw new TypeError("funding index references an unknown project");
    }
    const group = grouped.get(projectId) ?? [];
    group.push(candidate);
    grouped.set(projectId, group);
  }
  const records = [...grouped.entries()].flatMap(([projectId, candidates]) =>
    assertProjectFundingLedger(
      candidates,
      addressesByProject.get(projectId) ?? [],
    ),
  );
  const transactionProjects = new Map<string, string>();
  for (const record of records) {
    const key = `${record.network}:${record.transactionId}`;
    const projectId = transactionProjects.get(key);
    if (projectId !== undefined && projectId !== record.projectId) {
      throw new TypeError(
        "funding index attributes a transaction to multiple projects",
      );
    }
    transactionProjects.set(key, record.projectId);
  }
  return { schemaVersion: FUNDING_PROTOCOL_VERSION, generatedAt, records };
}
