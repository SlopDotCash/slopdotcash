/**
 * Fails CI unless every checked-in direct-payment disclosure still reproduces
 * itself from the frozen preparation it names. A disclosure records transfers
 * that were signed and broadcast outside the verified settlement flow, so
 * nothing upstream validates it. This recomputes every row from the declared
 * basis and refuses a record that has drifted from the preparation, that
 * silently changes a contributor weight, or that asserts a reconciliation the
 * published bytes do not support. It authorizes no payment and reads no chain.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MINIMUM_TRANSFER_MINOR = 2_000_000n;

export interface DisclosureRow {
  actorId: string;
  login: string;
  publishedWeight: string;
  effectiveWeight: string;
  entitlementMinor: string;
  wallet: string | null;
  state: "paid-direct" | "held-below-minimum" | "unclaimed";
  observed: null | {
    signature: string;
    slot: number;
    blockTime: string;
    recipient: string;
    amountMinor: string;
  };
  deltaMinor?: string;
  weightAdjustment?: { minor: string; reason: string };
  walletAnomaly?: string;
}

export interface Disclosure {
  schemaVersion: "1";
  kind: "direct-payment-disclosure";
  projectId: string;
  contributionMonth: string;
  preparation: { path: string; sha256: string; totalWeight: string };
  reconstructedBasis: {
    capMinor: string;
    denominatorWeight: string;
    rounding: "half-up";
    allocatedMinor: string;
    overCapMinor: string;
  };
  totals: {
    rows: number;
    observedTransfers: number;
    observedAmountMinor: string;
    allocatedMinor: string;
    byState: Record<string, { rows: number; amountMinor: string }>;
  };
  rows: DisclosureRow[];
}

/** Integer half-up division. Mirrors the rounding the observed amounts imply. */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  return (2n * numerator + denominator) / (2n * denominator);
}

function assertBigint(value: string, label: string): bigint {
  if (!/^-?\d+$/u.test(value)) throw new TypeError(`${label} must be integral`);
  return BigInt(value);
}

export function verifyDisclosure(
  disclosure: Disclosure,
  preparationBytes: Uint8Array,
): string[] {
  const failures: string[] = [];
  const fail = (message: string) => failures.push(message);

  if (disclosure.schemaVersion !== "1") fail("unsupported schemaVersion");
  if (disclosure.kind !== "direct-payment-disclosure") fail("unsupported kind");

  const digest = createHash("sha256").update(preparationBytes).digest("hex");
  if (digest !== disclosure.preparation.sha256)
    fail(
      `preparation ${disclosure.preparation.path} is ${digest}, disclosure claims ${disclosure.preparation.sha256}`,
    );

  const preparation = JSON.parse(
    new TextDecoder().decode(preparationBytes),
  ) as {
    counts: { weight: string };
    contributors: Array<{
      actor: { id: string; login: string };
      weight: string;
      wallet: { address: string } | null;
    }>;
  };
  if (preparation.counts.weight !== disclosure.preparation.totalWeight)
    fail("preparation totalWeight does not match the preparation bytes");

  const published = new Map(
    preparation.contributors.map((entry) => [entry.actor.id, entry]),
  );
  if (published.size !== disclosure.rows.length)
    fail(
      `disclosure has ${disclosure.rows.length} rows, preparation has ${published.size} contributors`,
    );

  const cap = assertBigint(disclosure.reconstructedBasis.capMinor, "capMinor");
  const denominator = assertBigint(
    disclosure.reconstructedBasis.denominatorWeight,
    "denominatorWeight",
  );

  let allocated = 0n;
  let observedTotal = 0n;
  let observedRows = 0;
  const signatures = new Set<string>();
  const byState = new Map<string, { rows: number; amountMinor: bigint }>();

  for (const row of disclosure.rows) {
    const source = published.get(row.actorId);
    if (!source) {
      fail(`row ${row.login} is not in the preparation`);
      continue;
    }
    if (source.actor.login !== row.login)
      fail(`row ${row.actorId} login drifted from the preparation`);
    if (source.weight !== row.publishedWeight)
      fail(
        `row ${row.login} publishedWeight ${row.publishedWeight} does not match preparation ${source.weight}`,
      );

    const adjustment = row.weightAdjustment
      ? assertBigint(row.weightAdjustment.minor, `${row.login} adjustment`)
      : 0n;
    if (adjustment !== 0n && !row.weightAdjustment?.reason.trim())
      fail(`row ${row.login} adjusts weight without a public reason`);

    const effective = assertBigint(row.effectiveWeight, `${row.login} weight`);
    if (effective !== assertBigint(row.publishedWeight, "weight") + adjustment)
      fail(
        `row ${row.login} effectiveWeight is not published weight plus the declared adjustment`,
      );

    const entitlement = assertBigint(
      row.entitlementMinor,
      `${row.login} entitlement`,
    );
    const expected = roundHalfUp(cap * effective, denominator);
    if (entitlement !== expected)
      fail(
        `row ${row.login} entitlement ${entitlement} does not equal the declared basis ${expected}`,
      );
    allocated += entitlement;

    const frozenWallet = source.wallet?.address ?? null;
    if (row.wallet !== frozenWallet)
      fail(`row ${row.login} wallet does not match the preparation`);

    if (row.observed) {
      observedRows += 1;
      if (signatures.has(row.observed.signature))
        fail(`signature ${row.observed.signature} is used twice`);
      signatures.add(row.observed.signature);
      const amount = assertBigint(
        row.observed.amountMinor,
        `${row.login} amount`,
      );
      observedTotal += amount;
      const delta = assertBigint(row.deltaMinor ?? "0", `${row.login} delta`);
      if (amount - entitlement !== delta)
        fail(
          `row ${row.login} deltaMinor does not equal observed minus entitlement`,
        );
      if (row.observed.recipient !== frozenWallet && !row.walletAnomaly)
        fail(
          `row ${row.login} was paid to an address the preparation did not freeze, with no walletAnomaly recorded`,
        );
      if (row.state !== "paid-direct")
        fail(
          `row ${row.login} has an observed transfer but state ${row.state}`,
        );
    } else if (row.deltaMinor !== undefined) {
      fail(`row ${row.login} records a delta with no observed transfer`);
    } else if (entitlement < MINIMUM_TRANSFER_MINOR) {
      if (row.state !== "held-below-minimum")
        fail(
          `row ${row.login} is below the minimum transfer but state ${row.state}`,
        );
    } else if (row.state !== "unclaimed") {
      fail(
        `row ${row.login} was not paid and is above the minimum but state ${row.state}`,
      );
    }

    const bucket = byState.get(row.state) ?? { rows: 0, amountMinor: 0n };
    bucket.rows += 1;
    bucket.amountMinor +=
      row.state === "paid-direct" && row.observed
        ? assertBigint(row.observed.amountMinor, "amount")
        : entitlement;
    byState.set(row.state, bucket);
  }

  if (allocated !== assertBigint(disclosure.totals.allocatedMinor, "allocated"))
    fail("totals.allocatedMinor does not equal the sum of the rows");
  if (
    allocated !==
    assertBigint(disclosure.reconstructedBasis.allocatedMinor, "allocated")
  )
    fail(
      "reconstructedBasis.allocatedMinor does not equal the sum of the rows",
    );
  if (
    allocated - cap !==
    assertBigint(disclosure.reconstructedBasis.overCapMinor, "overCap")
  )
    fail(
      "reconstructedBasis.overCapMinor does not equal allocated minus the cap",
    );
  if (observedRows !== disclosure.totals.observedTransfers)
    fail("totals.observedTransfers does not equal the observed rows");
  if (
    observedTotal !==
    assertBigint(disclosure.totals.observedAmountMinor, "observed")
  )
    fail(
      "totals.observedAmountMinor does not equal the sum of the observed transfers",
    );
  if (disclosure.rows.length !== disclosure.totals.rows)
    fail("totals.rows does not equal the row count");

  for (const [state, bucket] of byState) {
    const declared = disclosure.totals.byState[state];
    if (!declared) {
      fail(`totals.byState is missing ${state}`);
      continue;
    }
    if (declared.rows !== bucket.rows)
      fail(`totals.byState.${state}.rows does not equal the row count`);
    if (assertBigint(declared.amountMinor, state) !== bucket.amountMinor)
      fail(
        `totals.byState.${state}.amountMinor does not equal the summed rows`,
      );
  }
  for (const state of Object.keys(disclosure.totals.byState))
    if (!byState.has(state))
      fail(`totals.byState declares unused state ${state}`);

  return failures;
}

export function checkDirectPaymentDisclosures(
  root = REPOSITORY_ROOT,
): string[] {
  const directory = resolve(root, "disclosures");
  const names = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const failures: string[] = [];
  for (const name of names) {
    const disclosure = JSON.parse(
      readFileSync(join(directory, name), "utf8"),
    ) as Disclosure;
    const preparationBytes = readFileSync(
      resolve(root, disclosure.preparation.path),
    );
    for (const failure of verifyDisclosure(disclosure, preparationBytes))
      failures.push(`${name}: ${failure}`);
  }
  if (names.length === 0) failures.push("no disclosures found");
  return failures;
}

if (import.meta.main) {
  const failures = checkDirectPaymentDisclosures();
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`[Slop] ${failure}\n`);
    process.exit(1);
  }
  process.stdout.write("[Slop] direct-payment disclosures reproduce\n");
}
