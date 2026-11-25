/**
 * The refundable submission fee (operator decision, 18 November 2026; PRD
 * section 6, "Submission fee deposits"). An outside contributor deposits a
 * small fee into the `SubmissionDeposits` contract before Slopbot reviews
 * their pull request. A merge sends it back. A pull request closed without a
 * merge keeps it: a stablecoin goes to Slop's fee wallet, SLOP goes to the
 * burn address.
 *
 * This file holds the constants every part shares and the pure money rules:
 * the pull request's item hash, the SLOP amount for a stablecoin fee, which
 * SLOP rate is in force at a time, whether a deposit counts, and what may be
 * sent for a deposit. It reads no chain, database or clock.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";

export const SUBMISSION_FEE_BURN = "0x000000000000000000000000000000000000dEaD";
/**
 * The fee networks whose addresses are Solana addresses (operator decision,
 * 25 November 2026; PRD section 6, "Submission fee deposits", "Solana"). On
 * them a deposit is an account of the `slop-submission-deposits` program, an
 * address is base58 and is compared exactly, and only USDC is accepted. SLOP
 * stays payable on Robinhood Chain only.
 */
export const SUBMISSION_FEE_SOLANA_NETWORKS = Object.freeze(["solana-mainnet"]);
export const SUBMISSION_FEE_KEPT_TO = {
  "base-mainnet": "0x8f77C37D8650776bFe73c9b12B15209eE15D9b86", // Slop fee wallet
  "robinhood-mainnet": "0x8f77C37D8650776bFe73c9b12B15209eE15D9b86", // Slop fee wallet
  // Slop's Solana fee wallet (`contracts/DEPLOY-MAINNET.md`). A wallet, not a
  // token account: a kept fee goes to its associated USDC account.
  "solana-mainnet": "9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY",
};
export const SUBMISSION_FEE_TOKENS = {
  "base-mainnet": { usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  "robinhood-mainnet": {
    usdg: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    slop: "0xfeb4E36FA4a2A494FF25ae4a63491e4c584A67AE",
  },
  // Circle's USDC mint on Solana, a classic SPL Token mint.
  "solana-mainnet": { usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
};
/**
 * The `SubmissionDeposits` contracts, deployed 19 November 2026 by the same
 * deployer at the same nonce, so both chains share one address
 * (`contracts/DEPLOY-MAINNET.md`, "Submission fee deposit contracts").
 */
export const SUBMISSION_FEE_CONTRACTS = {
  "base-mainnet": "0xDe40B32A4156ABC2A05987367966d994BcFbf8D8",
  "robinhood-mainnet": "0xDe40B32A4156ABC2A05987367966d994BcFbf8D8",
  // The `slop-submission-deposits` program id. Null until the program is
  // deployed: while it is null nothing offers, reads or sends on Solana.
  "solana-mainnet": null,
};
/**
 * True only while a Solana deposit is recorded and settled, which is while
 * `SUBMISSION_FEE_SOLANA_MODE` in `workers/submission-fee/wrangler.toml` is
 * `live`. While it is false no page, comment or API lists Solana as a way to
 * pay, whatever the program id says. A test holds the two together; change
 * them in the same reviewed change.
 */
export const SUBMISSION_FEE_SOLANA_SWITCHED_ON = false;
/**
 * A Solana deposit is read at this commitment only, for marking a pull
 * request paid as much as for settling: there is no earlier "confirmed"
 * step as on the EVM chains.
 */
export const SUBMISSION_FEE_SOLANA_COMMITMENT = "finalized";
/**
 * The size of a Solana deposit's record account, discriminator included. A
 * test holds it to the committed IDL of the program.
 */
export const SUBMISSION_FEE_SOLANA_DEPOSIT_BYTES = 169;
/**
 * The rent a payer locks with a Solana deposit's record: the rent-exempt
 * minimum of an account of that size, which is 6,960 lamports for each of
 * its bytes and of the 128 bytes of account overhead. The program returns
 * it to the payer on every outcome.
 */
export const SUBMISSION_FEE_SOLANA_RENT_LAMPORTS = String(
  (SUBMISSION_FEE_SOLANA_DEPOSIT_BYTES + 128) * 6960,
);
/**
 * True only while Slopbot asks contributors for the fee, which is while
 * `SUBMISSION_FEE_MODE` in `workers/slopbot/wrangler.toml` is `live`. The
 * owner's settings page says the fee is not switched on while this is false.
 * A test holds the two together; change them in the same reviewed change.
 */
export const SUBMISSION_FEE_SWITCHED_ON = true;
export const SUBMISSION_FEE_DEFAULT_MINOR = "2000000"; // 2.00, six decimals
export const SUBMISSION_FEE_MIN_MINOR = "1000000";
export const SUBMISSION_FEE_MAX_MINOR = "10000000";
export const SUBMISSION_FEE_SLOP_SHARE_BPS = 5000; // SLOP fee is half the stablecoin fee
export const SUBMISSION_FEE_REFUND_UNDECIDED_DAYS = 14;
export const SUBMISSION_FEE_KEPT_AFTER_CLOSED_DAYS = 7;
/**
 * A pull request that closes an issue labelled `slop-wanted` (labelled before
 * the pull request was opened) is invited work. Closed without a merge, its
 * deposit goes back unless a maintainer adds this label before the kept wait
 * ends (operator decision, 22 November 2026; PRD section 5).
 */
export const SUBMISSION_FEE_KEEP_LABEL = "slop-keep-fee";
/**
 * The contracts' immutable reclaim delay (`RECLAIM_DELAY` in
 * `contracts/evm/script/DeploySubmissionDeposits.sol`): the payer can take an
 * open deposit back from the contract this long after making it.
 */
export const SUBMISSION_FEE_RECLAIM_DAYS = 30;

/**
 * The block of each contract's deployment, where its event scan starts. A
 * network with an address and no start block is refused.
 */
export const SUBMISSION_FEE_START_BLOCKS = {
  "base-mainnet": 59572869,
  "robinhood-mainnet": 118349901,
  // The slot of the program's `initialize` transaction, set with its id.
  "solana-mainnet": null,
};
export const SUBMISSION_FEE_CHAIN_IDS = {
  "base-mainnet": 8453,
  "robinhood-mainnet": 4663,
};
/**
 * Blocks on top of a deposit's block before its pull request is marked paid:
 * about one minute on Base and two on Robinhood Chain. Refunds and kept fees
 * wait for the finalized block instead.
 */
export const SUBMISSION_FEE_CONFIRMATIONS = {
  "base-mainnet": 30,
  "robinhood-mainnet": 1200,
};
export const SUBMISSION_FEE_STABLE_DECIMALS = 6;
export const SUBMISSION_FEE_SLOP_DECIMALS = 18;
/** The previous SLOP rate still counts this long after a change. */
export const SUBMISSION_FEE_RATE_GRACE_MS = 48 * 60 * 60 * 1000;
/** The SLOP rate is reset when it is this old. */
export const SUBMISSION_FEE_RATE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * The SLOP fee is reset early when, at the current price, it is worth less
 * than 35% or more than 65% of the stablecoin fee.
 */
export const SUBMISSION_FEE_SLOP_BAND_BPS = Object.freeze({
  min: 3500,
  max: 6500,
});
/**
 * A deposit whose pull request Slop has not asked a fee for waits this long
 * after it is finalized before it is refunded as unknown.
 */
export const SUBMISSION_FEE_UNKNOWN_ITEM_GRACE_MS = 24 * 60 * 60 * 1000;

const UINT64_MAX = (1n << 64n) - 1n;
const AMOUNT = /^(0|[1-9][0-9]{0,38})$/u;
const RATE = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,18})?$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const ONE = 10n ** 18n;

/** Whether a fee network's addresses are Solana addresses. */
export function isSolanaFeeNetwork(network) {
  return SUBMISSION_FEE_SOLANA_NETWORKS.includes(network);
}

/**
 * Whether two addresses of one fee network are the same address. EVM hex is
 * compared without regard to case; Solana base58 is case-sensitive and is
 * compared exactly.
 */
export function submissionFeeSameAddress(network, left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  return isSolanaFeeNetwork(network)
    ? left === right
    : left.toLowerCase() === right.toLowerCase();
}

function uint64(value, name) {
  const text = typeof value === "bigint" ? value.toString() : String(value);
  if (
    (typeof value !== "bigint" &&
      typeof value !== "string" &&
      !Number.isSafeInteger(value)) ||
    !/^[1-9][0-9]{0,19}$/u.test(text) ||
    BigInt(text) > UINT64_MAX
  )
    throw new TypeError(`${name} must be a positive 64-bit integer`);
  return BigInt(text);
}

/**
 * The contract's `item` for a pull request:
 * `keccak256(abi.encodePacked("slop-fee-v1", uint64(repositoryId), uint64(pullNumber)))`,
 * as lowercase 0x hex. `repositoryId` is the repository's numeric GitHub id.
 */
export function submissionFeeItem(repositoryId, pullNumber) {
  const repository = uint64(repositoryId, "repositoryId");
  const pull = uint64(pullNumber, "pullNumber");
  const tag = new TextEncoder().encode("slop-fee-v1");
  const packed = new Uint8Array(tag.length + 16);
  packed.set(tag, 0);
  const view = new DataView(packed.buffer);
  view.setBigUint64(tag.length, repository, false);
  view.setBigUint64(tag.length + 8, pull, false);
  return `0x${[...keccak_256(packed)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function amount(value, name) {
  if (typeof value !== "string" || !AMOUNT.test(value))
    throw new TypeError(`${name} must be a base-unit decimal string`);
  return BigInt(value);
}

/** True when a project's stablecoin fee is a whole amount inside the limits. */
export function validStableFee(stableMinor) {
  if (typeof stableMinor !== "string" || !AMOUNT.test(stableMinor))
    return false;
  const value = BigInt(stableMinor);
  return (
    value >= BigInt(SUBMISSION_FEE_MIN_MINOR) &&
    value <= BigInt(SUBMISSION_FEE_MAX_MINOR)
  );
}

/**
 * A rate as an exact integer: whole SLOP per 1.00 of stablecoin, times
 * 10^18. A rate is a positive decimal string with at most 18 decimals.
 */
export function slopRateScaled(slopPerUsd) {
  if (typeof slopPerUsd !== "string" || !RATE.test(slopPerUsd))
    throw new TypeError("slopPerUsd must be a positive decimal string");
  const [whole, fraction = ""] = slopPerUsd.split(".");
  const scaled = BigInt(whole) * ONE + BigInt(fraction.padEnd(18, "0"));
  if (scaled <= 0n) throw new TypeError("slopPerUsd must be above zero");
  return scaled;
}

/** The decimal string of a scaled rate, rounded half up to six decimals. */
export function slopRateText(scaled) {
  if (typeof scaled !== "bigint" || scaled <= 0n)
    throw new TypeError("A rate must be above zero");
  const unit = 10n ** 12n;
  const rounded = (scaled + unit / 2n) / unit;
  if (rounded <= 0n) throw new TypeError("A rate must be above zero");
  const whole = rounded / 1_000_000n;
  const fraction = (rounded % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/u, "");
  const text = fraction ? `${whole}.${fraction}` : `${whole}`;
  if (!RATE.test(text)) throw new TypeError("A rate is out of range");
  return text;
}

/** Rounds a positive integer half up to two significant digits. */
function twoSignificant(value) {
  const digits = value.toString().length;
  if (digits <= 2) return value;
  const unit = 10n ** BigInt(digits - 2);
  return ((value + unit / 2n) / unit) * unit;
}

/**
 * The SLOP fee, in SLOP base units (18 decimals), for a stablecoin fee in
 * minor units (six decimals) at a rate: half the stablecoin fee's value,
 * rounded half up to two significant digits (75.47 becomes 75, 377.3 becomes
 * 380). It is never zero.
 */
export function slopFeeBase(stableMinor, slopPerUsd) {
  const stable = amount(stableMinor, "stableMinor");
  if (stable <= 0n) throw new TypeError("stableMinor must be above zero");
  // stable / 10^6 dollars, times the rate in SLOP base units, times the share.
  const exact =
    (stable *
      slopRateScaled(slopPerUsd) *
      BigInt(SUBMISSION_FEE_SLOP_SHARE_BPS)) /
    (10n ** BigInt(SUBMISSION_FEE_STABLE_DECIMALS) * 10_000n);
  const rounded = twoSignificant(exact);
  if (rounded <= 0n) throw new TypeError("The SLOP fee rounds to zero");
  return rounded.toString();
}

function instant(value, name) {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (
    !Number.isFinite(time) ||
    typeof value !== "string" ||
    new Date(time).toISOString() !== value
  )
    throw new TypeError(`${name} must be an ISO instant`);
  return time;
}

/**
 * The rate in force at `at` and, for 48 hours after it took effect, the rate
 * before it. `rates` are the stored rows in any order. A rate is in force
 * from its `effectiveAt` on; the previous one counts while
 * `at < current.effectiveAt + 48 hours`. With no rate yet in force both are
 * null and SLOP is not accepted.
 */
export function slopRatesAt(rates, at) {
  const time = instant(at, "at");
  const sorted = [...rates]
    .map((rate) => ({
      effectiveAt: rate.effectiveAt,
      slopPerUsd: rate.slopPerUsd,
      time: instant(rate.effectiveAt, "effectiveAt"),
    }))
    .sort((left, right) => left.time - right.time);
  for (const rate of sorted) slopRateScaled(rate.slopPerUsd);
  let index = -1;
  for (let position = 0; position < sorted.length; position += 1)
    if (sorted[position].time <= time) index = position;
  if (index < 0) return { current: null, previous: null };
  const current = sorted[index];
  const before = index > 0 ? sorted[index - 1] : null;
  const graceEnds = current.time + SUBMISSION_FEE_RATE_GRACE_MS;
  return {
    current: {
      effectiveAt: current.effectiveAt,
      slopPerUsd: current.slopPerUsd,
    },
    previous:
      before && time < graceEnds
        ? {
            effectiveAt: before.effectiveAt,
            slopPerUsd: before.slopPerUsd,
            acceptedUntil: new Date(graceEnds).toISOString(),
          }
        : null,
  };
}

/**
 * The least SLOP, in base units, that pays a stablecoin fee at `at`: the
 * amount at the rate in force, or the amount at the previous rate during its
 * 48 hours when that is lower. Null when no rate is in force.
 */
export function slopFeeDueAt(stableMinor, rates, at) {
  const { current, previous } = slopRatesAt(rates, at);
  if (!current) return null;
  const now = BigInt(slopFeeBase(stableMinor, current.slopPerUsd));
  if (!previous) return now.toString();
  const before = BigInt(slopFeeBase(stableMinor, previous.slopPerUsd));
  return (before < now ? before : now).toString();
}

/**
 * Which accepted token an address is on a network: "stable", "slop" or null.
 * `tokens` and the rest of `terms` default to the mainnet tables above; a
 * local rehearsal passes its own.
 */
export function submissionFeeTokenKind(network, token, terms = {}) {
  const tokens = (terms.tokens ?? SUBMISSION_FEE_TOKENS)[network];
  if (!tokens || typeof token !== "string") return null;
  if (isSolanaFeeNetwork(network))
    // USDC only, and the mint address exactly as published.
    return SOLANA_ADDRESS.test(token) && tokens.usdc === token
      ? "stable"
      : null;
  if (!ADDRESS.test(token)) return null;
  const same = (left, right) => submissionFeeSameAddress(network, left, right);
  if (same(tokens.usdc, token) || same(tokens.usdg, token)) return "stable";
  if (same(tokens.slop, token)) return "slop";
  return null;
}

/**
 * Whether a deposit pays for its pull request (interface section 3).
 *
 * `deposit` is the chain's own record: token, amount (base units), keptTo and
 * the block time. `item` is the pull request's row, or null when Slop has not
 * asked a fee for that item. `rates` are the stored SLOP rates.
 *
 * It counts only when: the item is known and still unpaid and undecided; the
 * token is the network's stablecoin or SLOP; `keptTo` is the fee wallet for a
 * stablecoin and the burn address for SLOP; and the amount is at least the
 * amount due at the deposit's block time. Everything else is refused with a
 * reason and never kept: a refused deposit of an accepted token is refunded,
 * and one of any other token is left for its payer to reclaim.
 */
export function submissionDepositCounts(
  network,
  deposit,
  item,
  rates,
  terms = {},
) {
  const refuse = (reason) => ({ accepted: false, reason });
  // The token and destination are judged first: they need no pull request,
  // so a deposit of another token never waits for one to appear.
  const kind = submissionFeeTokenKind(network, deposit.token, terms);
  if (!kind) return refuse("token_not_accepted");
  const feeWallet = (terms.keptTo ?? SUBMISSION_FEE_KEPT_TO)[network];
  const wanted =
    kind === "stable" ? feeWallet : (terms.burn ?? SUBMISSION_FEE_BURN);
  if (!wanted || !submissionFeeSameAddress(network, deposit.keptTo, wanted))
    return refuse("wrong_kept_to");
  if (!item) return refuse("unknown_item");
  if (typeof item.stableMinor !== "string" || !AMOUNT.test(item.stableMinor))
    return refuse("item_fee_invalid");
  const stable = BigInt(item.stableMinor);
  if (stable <= 0n) return refuse("item_fee_invalid");
  const paid = amount(deposit.amount, "deposit.amount");
  let due;
  if (kind === "stable") due = stable;
  else {
    const slop = slopFeeDueAt(item.stableMinor, rates, deposit.blockTime);
    if (slop === null) return refuse("no_slop_rate");
    due = BigInt(slop);
  }
  if (paid < due) return refuse("amount_below_due");
  const paidBy = item.paidDepositId ?? null;
  const own =
    paidBy !== null &&
    item.paidNetwork === network &&
    String(paidBy) === String(deposit.depositId);
  // A second deposit for a pull request that is already paid or decided
  // pays for nothing; the deposit that paid stays accepted.
  if (!own && paidBy !== null) return refuse("item_already_paid");
  if (!own && (item.outcome ?? null) !== null)
    return refuse("item_already_decided");
  return { accepted: true, kind, due: due.toString() };
}

/**
 * What the resolver may send for one deposit: "refund", "keep" or null.
 *
 * Nothing is sent before the deposit is finalized and judged, or once it has
 * left the open states. A deposit of a token outside the table is never
 * resolved at all: the resolver makes no call into a token nobody reviewed,
 * and its payer reclaims it from the contract after 30 days. A deposit of an
 * accepted token that does not count is refunded. A deposit that counts is
 * refunded when its pull request's row says `refund_due`, and kept only when
 * that row says `kept_due` and names this very deposit as the one that paid.
 * No other input can produce "keep".
 */
export function submissionResolveAction(network, deposit, item, terms = {}) {
  if (!deposit.finalizedAt) return null;
  if (!["open", "refund_due", "kept_due"].includes(deposit.state)) return null;
  if (submissionFeeTokenKind(network, deposit.token, terms) === null)
    return null;
  if (deposit.accepted === 0 || deposit.accepted === false) return "refund";
  if (deposit.accepted !== 1 && deposit.accepted !== true) return null;
  if (
    !item ||
    item.paidNetwork !== network ||
    String(item.paidDepositId) !== String(deposit.depositId)
  )
    return null;
  if (item.outcome === "refund_due") return "refund";
  if (item.outcome === "kept_due") return "keep";
  return null;
}

/**
 * The share of the stablecoin fee, in basis points, that the SLOP fee at
 * `rateInForce` is worth at the price `marketRate` (both whole SLOP per
 * 1.00). At an unchanged price it is the 5000 the fee was set at.
 */
export function slopFeeShareBps(rateInForce, marketRate) {
  return Number(
    (BigInt(SUBMISSION_FEE_SLOP_SHARE_BPS) * slopRateScaled(rateInForce)) /
      slopRateScaled(marketRate),
  );
}

/**
 * The average price over a set of readings, as a rate. Each reading is whole
 * SLOP per 1.00; the average is taken over the SLOP price (1 / reading), so
 * the result is the harmonic mean of the readings.
 */
export function averageSlopRate(readings) {
  if (!Array.isArray(readings) || readings.length === 0)
    throw new TypeError("At least one reading is needed");
  const two = ONE * ONE;
  let prices = 0n;
  for (const reading of readings) prices += two / slopRateScaled(reading);
  if (prices <= 0n) throw new TypeError("The readings have no price");
  return slopRateText((two * BigInt(readings.length)) / prices);
}

/**
 * The next rate, or null to keep the one in force.
 *
 * `week` are the hourly readings of the last seven days and `day` those of
 * the last 24 hours, each whole SLOP per 1.00. With no rate yet, the first is
 * set from a full day of readings. A rate seven days old is reset from the
 * seven-day average when at least half its hours were read. Before that, it
 * is reset early from the 24-hour average when the SLOP fee at the rate in
 * force is worth less than 35% or more than 65% of the stablecoin fee at
 * that average. Too few readings change nothing: the last rate stays.
 */
export function nextSlopRate({ current, at, week, day }) {
  const time = instant(at, "at");
  const enoughDay = day.length >= 12;
  if (!current)
    return day.length >= 24
      ? { slopPerUsd: averageSlopRate(day), reason: "first" }
      : null;
  const age = time - instant(current.effectiveAt, "effectiveAt");
  if (age >= SUBMISSION_FEE_RATE_PERIOD_MS) {
    if (week.length < 84) return null;
    const slopPerUsd = averageSlopRate(week);
    return slopPerUsd === current.slopPerUsd
      ? null
      : { slopPerUsd, reason: "weekly" };
  }
  if (!enoughDay) return null;
  const market = averageSlopRate(day);
  const share = slopFeeShareBps(current.slopPerUsd, market);
  if (
    share >= SUBMISSION_FEE_SLOP_BAND_BPS.min &&
    share <= SUBMISSION_FEE_SLOP_BAND_BPS.max
  )
    return null;
  return market === current.slopPerUsd
    ? null
    : { slopPerUsd: market, reason: "drift" };
}

/**
 * Every way to pay a stablecoin fee at `at`: one entry per network and
 * accepted token, with the amount in base units, the contract (null for a
 * network without one) and where a kept fee goes. SLOP is listed only while a rate is
 * in force. A Solana network is listed only once its program id is published
 * and Solana is switched on (`terms.solanaOn`, by default
 * `SUBMISSION_FEE_SOLANA_SWITCHED_ON`); its `contract` is the program id and
 * its `chainId` is null.
 */
export function submissionFeeOptions(stableMinor, rates, at, terms = {}) {
  const tokens = terms.tokens ?? SUBMISSION_FEE_TOKENS;
  const contracts = terms.contracts ?? SUBMISSION_FEE_CONTRACTS;
  const keptTo = terms.keptTo ?? SUBMISSION_FEE_KEPT_TO;
  const burn = terms.burn ?? SUBMISSION_FEE_BURN;
  const chainIds = terms.chainIds ?? SUBMISSION_FEE_CHAIN_IDS;
  amount(stableMinor, "stableMinor");
  const slop = slopFeeDueAt(stableMinor, rates, at);
  const slopNow = slopRatesAt(rates, at).current
    ? slopFeeBase(stableMinor, slopRatesAt(rates, at).current.slopPerUsd)
    : null;
  const options = [];
  const solanaOn = terms.solanaOn ?? SUBMISSION_FEE_SOLANA_SWITCHED_ON;
  for (const network of Object.keys(tokens).sort()) {
    const entry = tokens[network];
    if (
      isSolanaFeeNetwork(network) &&
      (solanaOn !== true || typeof contracts[network] !== "string")
    )
      continue;
    const base = {
      network,
      chainId: chainIds[network] ?? null,
      contract: contracts[network] ?? null,
    };
    for (const symbol of ["usdc", "usdg"])
      if (entry[symbol])
        options.push({
          ...base,
          token: entry[symbol],
          symbol: symbol.toUpperCase(),
          decimals: SUBMISSION_FEE_STABLE_DECIMALS,
          amount: stableMinor,
          minimumAccepted: stableMinor,
          keptTo: keptTo[network],
        });
    if (entry.slop && slop !== null && slopNow !== null)
      options.push({
        ...base,
        token: entry.slop,
        symbol: "SLOP",
        decimals: SUBMISSION_FEE_SLOP_DECIMALS,
        amount: slopNow,
        minimumAccepted: slop,
        keptTo: burn,
      });
  }
  return options;
}
