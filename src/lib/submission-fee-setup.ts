/**
 * What the pay page runs with: whether the fee is switched on, and the
 * address tables every way to pay is checked against.
 *
 * Every deployed bundle uses `SUBMISSION_FEE_SWITCHED_ON` and the published
 * tables in `submission-fee.mjs`, and nothing else. Only the browser-test
 * build sets `VITE_SLOP_FEE_FIXTURE` (`scripts/prepare-e2e-fixture.mjs`; a
 * release test refuses it anywhere else). In that build a test may set
 * `__SLOP_FEE_FIXTURE__` before the page loads, to exercise the payment flow
 * against a private local chain while the fee is switched off in production.
 */

import { SUBMISSION_FEE_SWITCHED_ON } from "./submission-fee.mjs";
import { type FeeTables, PUBLISHED_FEE_TABLES } from "./submission-fee-page";

type FeeFixture = { switchedOn?: boolean; tables?: Partial<FeeTables> };

export function feePageSetup(): { switchedOn: boolean; tables: FeeTables } {
  if (import.meta.env.VITE_SLOP_FEE_FIXTURE === "1") {
    const fixture = (globalThis as { __SLOP_FEE_FIXTURE__?: FeeFixture })
      .__SLOP_FEE_FIXTURE__;
    if (fixture)
      return {
        switchedOn: fixture.switchedOn === true,
        tables: { ...PUBLISHED_FEE_TABLES, ...fixture.tables },
      };
  }
  return {
    switchedOn: SUBMISSION_FEE_SWITCHED_ON,
    tables: PUBLISHED_FEE_TABLES,
  };
}
