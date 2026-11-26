/**
 * What the pay pages run with: whether the fee (or the report deposit) is
 * switched on, and the address tables every way to pay is checked against.
 *
 * Every deployed bundle uses `SUBMISSION_FEE_SWITCHED_ON` and the published
 * tables in `submission-fee.mjs`, and nothing else. Only the browser-test
 * build sets `VITE_SLOP_FEE_FIXTURE` (`scripts/prepare-e2e-fixture.mjs`; a
 * release test refuses it anywhere else). In that build a test may set
 * `__SLOP_FEE_FIXTURE__` before the page loads, to exercise the payment flow
 * against a private local chain while the fee is switched off in production.
 */

import { REPORT_DEPOSIT_SWITCHED_ON } from "./security-report-deposit.mjs";
import {
  STANDING_DEPOSIT_CONTRACT,
  STANDING_DEPOSIT_NETWORK,
  STANDING_DEPOSIT_START_BLOCK,
  standingDepositDeployed,
} from "./standing-deposit.mjs";
import { SUBMISSION_FEE_SWITCHED_ON } from "./submission-fee.mjs";
import { type FeeTables, PUBLISHED_FEE_TABLES } from "./submission-fee-page";

type FeeFixture = {
  switchedOn?: boolean;
  /** The report deposit's own switch (`REPORT_DEPOSIT_SWITCHED_ON`). */
  reportDeposit?: boolean;
  tables?: Partial<FeeTables>;
  /** A standing deposit contract of a private local chain (`STANDING_DEPOSIT_CONTRACT`). */
  standingDeposit?: { contract: string; startBlock: number };
};

function fixture(): FeeFixture | undefined {
  return import.meta.env.VITE_SLOP_FEE_FIXTURE === "1"
    ? (globalThis as { __SLOP_FEE_FIXTURE__?: FeeFixture }).__SLOP_FEE_FIXTURE__
    : undefined;
}

export function feePageSetup(): { switchedOn: boolean; tables: FeeTables } {
  const test = fixture();
  if (test)
    return {
      switchedOn: test.switchedOn === true,
      tables: { ...PUBLISHED_FEE_TABLES, ...test.tables },
    };
  return {
    switchedOn: SUBMISSION_FEE_SWITCHED_ON,
    tables: PUBLISHED_FEE_TABLES,
  };
}

/**
 * The same for the report deposit's pages (PRD section 8): the deployed
 * bundle uses `REPORT_DEPOSIT_SWITCHED_ON` and the published tables; the
 * browser-test build may set `reportDeposit` on the same fixture object.
 */
export function reportDepositSetup(): {
  switchedOn: boolean;
  tables: FeeTables;
} {
  const test = fixture();
  if (test)
    return {
      switchedOn: test.reportDeposit === true,
      tables: { ...PUBLISHED_FEE_TABLES, ...test.tables },
    };
  return {
    switchedOn: REPORT_DEPOSIT_SWITCHED_ON,
    tables: PUBLISHED_FEE_TABLES,
  };
}

/**
 * The same for the standing deposit page (PRD section 5, "Standing
 * deposit"): the deployed bundle uses `STANDING_DEPOSIT_CONTRACT` and its
 * start block, which are null until the second deposit contract is
 * deployed; the browser-test build may set `standingDeposit` on the same
 * fixture object. `tables` name the standing contract on Robinhood Chain, so
 * every way to pay is checked against it and never against the per pull
 * request contract.
 */
export function standingDepositSetup(): {
  deployed: boolean;
  contract: string | null;
  tables: FeeTables;
} {
  const test = fixture();
  const base = test
    ? { ...PUBLISHED_FEE_TABLES, ...test.tables }
    : PUBLISHED_FEE_TABLES;
  const contract = test
    ? (test.standingDeposit?.contract ?? null)
    : STANDING_DEPOSIT_CONTRACT;
  const startBlock = test
    ? (test.standingDeposit?.startBlock ?? null)
    : STANDING_DEPOSIT_START_BLOCK;
  const deployed = standingDepositDeployed(contract, startBlock);
  return {
    deployed,
    contract: deployed ? contract : null,
    tables: {
      ...base,
      contracts: {
        ...base.contracts,
        [STANDING_DEPOSIT_NETWORK]: deployed ? contract : null,
      },
    },
  };
}
