/**
 * Disclosure links must open retained Git history, never a tip path that 404s
 * after the D1 registry migration (issue #1460, PRD section 7).
 */
import { expect, test } from "bun:test";
import {
  DIRECT_PAYMENT_DISCLOSURE_COMMIT,
  directPaymentDisclosureUrl,
} from "../src/lib/direct-payment-disclosures";
import { SOURCE_REPOSITORY } from "../src/lib/source-repository";

test("retained August 2026 disclosures link to the last tip that held them", () => {
  for (const projectId of ["asi", "eliza"] as const) {
    expect(directPaymentDisclosureUrl(projectId, "2026-08")).toBe(
      `${SOURCE_REPOSITORY}/blob/${DIRECT_PAYMENT_DISCLOSURE_COMMIT}/disclosures/${projectId}-2026-08-direct-payments.json`,
    );
  }
});

test("months or projects without a retained disclosure have no link", () => {
  expect(directPaymentDisclosureUrl("eliza", "2026-07")).toBeNull();
  expect(directPaymentDisclosureUrl("slopdotcash", "2026-08")).toBeNull();
  expect(directPaymentDisclosureUrl("asi", "2026-09")).toBeNull();
});
