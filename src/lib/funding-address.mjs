/** Validates canonical public receiving addresses for each funding network. */

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const MAX_FUNDING_ROUTES = 32;

function fundingTimestamp(value, field) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function fundingRecord(value, field) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function exactFundingKeys(value, keys, field) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError(`${field} has unexpected or missing fields`);
  }
}

function decodedBase58Length(value, minimumLength, maximumLength) {
  if (
    typeof value !== "string" ||
    value.length < minimumLength ||
    value.length > maximumLength
  ) {
    return null;
  }
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

function bech32Polymod(values) {
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

function validBitcoinAddress(value) {
  if (
    typeof value !== "string" ||
    value !== value.toLowerCase() ||
    !value.startsWith("bc1")
  ) {
    return false;
  }
  const separator = value.lastIndexOf("1");
  if (separator !== 2 || value.length < 14 || value.length > 90) return false;
  const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const data = [...value.slice(separator + 1)].map((character) =>
    alphabet.indexOf(character),
  );
  if (data.some((entry) => entry < 0) || data.length < 7) return false;
  const encoding = bech32Polymod([3, 3, 0, 2, 3, ...data]);
  const payload = data.slice(0, -6);
  const witnessVersion = payload[0];
  if (witnessVersion === undefined || witnessVersion > 16) return false;
  let accumulator = 0;
  let bits = 0;
  const program = [];
  for (const value of payload.slice(1)) {
    accumulator = (accumulator << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      program.push((accumulator >> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((accumulator << (8 - bits)) & 0xff) !== 0) return false;
  if (program.length < 2 || program.length > 40) return false;
  if (witnessVersion === 0) {
    return (program.length === 20 || program.length === 32) && encoding === 1;
  }
  return encoding === 0x2bc830a3;
}

export function fundingAssetForNetwork(network) {
  return (
    {
      base: "USDC",
      bitcoin: "BTC",
      ethereum: "USDC",
      solana: "USDC",
    }[network] ?? null
  );
}

export function isFundingAddress(network, value) {
  if (network === "solana") {
    return decodedBase58Length(value, 32, 44) === 32;
  }
  if (network === "bitcoin") return validBitcoinAddress(value);
  if (network === "base" || network === "ethereum") {
    return (
      typeof value === "string" &&
      /^0x[0-9a-f]{40}$/u.test(value) &&
      !/^0x0{40}$/u.test(value)
    );
  }
  return false;
}

export function isSolanaTransactionId(value) {
  return decodedBase58Length(value, 64, 88) === 64;
}

/**
 * Validates the complete bounded receiving-address history. A project keeps
 * replaced routes so old transaction records remain independently verifiable,
 * while intervals for the same network and asset may never overlap.
 */
export function assertFundingAddresses(
  value,
  field = "project funding addresses",
) {
  if (!Array.isArray(value) || value.length > MAX_FUNDING_ROUTES) {
    throw new TypeError(
      `${field} must be an array of at most ${MAX_FUNDING_ROUTES} routes`,
    );
  }
  const seenAddresses = new Set();
  const histories = new Map();
  const routes = value.map((candidate, index) => {
    const routeField = `${field}[${index}]`;
    const route = fundingRecord(candidate, routeField);
    exactFundingKeys(
      route,
      ["address", "asset", "effectiveAt", "network", "replacedAt"],
      routeField,
    );
    const asset = fundingAssetForNetwork(route.network);
    if (asset === null || route.asset !== asset) {
      throw new TypeError(`${routeField} network or asset is unsupported`);
    }
    if (!isFundingAddress(route.network, route.address)) {
      throw new TypeError(`${routeField}.address is invalid`);
    }
    const effectiveAt = fundingTimestamp(
      route.effectiveAt,
      `${routeField}.effectiveAt`,
    );
    const replacedAt =
      route.replacedAt === null
        ? null
        : fundingTimestamp(route.replacedAt, `${routeField}.replacedAt`);
    if (
      replacedAt !== null &&
      Date.parse(replacedAt) <= Date.parse(effectiveAt)
    ) {
      throw new TypeError(`${routeField}.replacedAt must follow effectiveAt`);
    }
    const addressKey = `${route.network}:${route.asset}:${route.address}`;
    if (seenAddresses.has(addressKey)) {
      throw new TypeError(`${field} contain a duplicate receiving address`);
    }
    seenAddresses.add(addressKey);
    const result = {
      network: route.network,
      asset: route.asset,
      address: route.address,
      effectiveAt,
      replacedAt,
    };
    const historyKey = `${route.network}:${route.asset}`;
    const history = histories.get(historyKey) ?? [];
    history.push(result);
    histories.set(historyKey, history);
    return result;
  });
  for (const history of histories.values()) {
    history.sort((left, right) =>
      left.effectiveAt.localeCompare(right.effectiveAt),
    );
    for (let index = 1; index < history.length; index += 1) {
      const prior = history[index - 1];
      const current = history[index];
      if (prior.replacedAt === null || prior.replacedAt > current.effectiveAt) {
        throw new TypeError(`${field} contain overlapping active routes`);
      }
    }
  }
  return routes;
}
