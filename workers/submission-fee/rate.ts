/**
 * The SLOP rate job (PRD section 6, "Submission fee deposits"). Once an hour
 * it reads the price of the official SLOP / USDG pool on Robinhood Chain and
 * stores one reading for that UTC hour. From those readings it sets the
 * platform rate: the first from a full day, then every seven days from the
 * seven-day average, and early from the 24-hour average when the SLOP fee has
 * drifted outside 35% to 65% of the stablecoin fee.
 *
 * When the pool cannot be read, no reading is stored and the last rate stays
 * in force. A new rate takes effect at the start of the next UTC hour, so
 * every deposit is judged against a rate that was already published.
 */

import {
  nextSlopRate,
  type SubmissionFeeRate,
  slopRateText,
} from "../../src/lib/submission-fee.mjs";
import type { PriceSource } from "./config";

const HOUR = 60 * 60 * 1000;

export interface RateStore {
  latestRate(): Promise<SubmissionFeeRate | null>;
  insertSample(sample: {
    sampledAt: string;
    blockNumber: number;
    slopPerUsd: string;
    source: string;
  }): Promise<boolean>;
  samplesSince(since: string, source: string): Promise<string[]>;
  insertRate(rate: {
    effectiveAt: string;
    slopPerUsd: string;
    source: string;
    createdAt: string;
  }): Promise<boolean>;
}

export interface RateDependencies {
  store: RateStore;
  price: PriceSource;
  /** The pool's price as whole SLOP per 1.00, times 10^18. */
  readPrice: () => Promise<{ scaled: bigint; blockNumber: number }>;
  now: () => Date;
  log: (event: Record<string, unknown>) => void;
}

export interface RateResult {
  sampled: boolean;
  /** Why no reading was stored: the source failed, or the hour has one. */
  sample: "stored" | "already_read" | "source_unavailable";
  rate: { slopPerUsd: string; effectiveAt: string; reason: string } | null;
}

export async function runRate(deps: RateDependencies): Promise<RateResult> {
  const { store, price } = deps;
  const at = deps.now();
  let sample: RateResult["sample"];
  try {
    const reading = await deps.readPrice();
    sample = (await store.insertSample({
      sampledAt: at.toISOString(),
      blockNumber: reading.blockNumber,
      slopPerUsd: slopRateText(reading.scaled),
      source: price.label,
    }))
      ? "stored"
      : "already_read";
  } catch {
    // The last rate stays in force; the next hour reads again.
    sample = "source_unavailable";
    deps.log({ event: "submission_fee_price_unavailable" });
  }
  const since = (ms: number) => new Date(at.getTime() - ms).toISOString();
  const next = nextSlopRate({
    // The newest row, even one that takes effect at the next hour, so a
    // second run in the same hour writes nothing.
    current: await store.latestRate(),
    at: at.toISOString(),
    week: await store.samplesSince(since(7 * 24 * HOUR), price.label),
    day: await store.samplesSince(since(24 * HOUR), price.label),
  });
  if (!next) return { sampled: sample === "stored", sample, rate: null };
  const effectiveAt = new Date(
    (Math.floor(at.getTime() / HOUR) + 1) * HOUR,
  ).toISOString();
  const written = await store.insertRate({
    effectiveAt,
    slopPerUsd: next.slopPerUsd,
    source: `${price.label}:${next.reason}`,
    createdAt: at.toISOString(),
  });
  if (!written) return { sampled: sample === "stored", sample, rate: null };
  deps.log({ event: "submission_fee_rate_set", effectiveAt, ...next });
  return {
    sampled: sample === "stored",
    sample,
    rate: { slopPerUsd: next.slopPerUsd, effectiveAt, reason: next.reason },
  };
}
