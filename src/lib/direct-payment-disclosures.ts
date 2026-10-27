/**
 * August 2026 direct-payment disclosures were removed from the branch tip when
 * the project registry moved to D1 (`0f1369d0`). The public bytes remain at the
 * parent of that commit. Link only those retained records; never invent a tip
 * path that 404s (PRD section 7 visitor journey).
 */
import { SOURCE_REPOSITORY } from "./source-repository";

/** Parent of `0f1369d0`; last tip that still held the disclosure JSON files. */
export const DIRECT_PAYMENT_DISCLOSURE_COMMIT =
  "eae9fbab8403ec70d79c5397d16afb4928050b1d";

const RETAINED = new Set(["asi-2026-08", "eliza-2026-08"]);

/** GitHub blob URL for a retained disclosure, or null when no record exists. */
export function directPaymentDisclosureUrl(
  projectId: string,
  month: string,
): string | null {
  const key = `${projectId}-${month}`;
  if (!RETAINED.has(key)) return null;
  return `${SOURCE_REPOSITORY}/blob/${DIRECT_PAYMENT_DISCLOSURE_COMMIT}/disclosures/${key}-direct-payments.json`;
}
