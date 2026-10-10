/** Monthly Slopbot cost statement. Vault service settlement is not active. */
import type { D1Database } from "../trace/cloudflare-persistence";

export interface SlopbotInvoice {
  installationId: number;
  month: string;
  state: "open" | "closed";
  periodStart: string;
  periodEnd: string;
  modelCalls: number;
  billedMicroUsdc: string;
  feeOffsetMicroUsdc: string;
  feeOffsetReason: string;
  settlement: "unavailable";
  settlementReason: string;
}

/** Sums one installation's billed model calls in one UTC month (BOT-10, BOT-11). */
export async function slopbotInvoice(
  db: D1Database,
  installationId: number,
  month: string,
  now: string,
): Promise<SlopbotInvoice | null> {
  const [year, monthNumber] = month.split("-").map(Number);
  const periodStart = new Date(
    Date.UTC(year, monthNumber - 1, 1),
  ).toISOString();
  const periodEnd = new Date(Date.UTC(year, monthNumber, 1)).toISOString();
  const installation = await db
    .prepare(
      "SELECT 1 AS ok FROM slopbot_installations WHERE installation_id=?",
    )
    .bind(installationId)
    .first();
  if (!installation) return null;
  const totals = await db
    .prepare(
      "SELECT COUNT(*) AS calls, CAST(COALESCE(SUM(billed_micro_usdc), 0) AS TEXT) AS billed FROM slopbot_costs WHERE installation_id=? AND created_at>=? AND created_at<?",
    )
    .bind(installationId, periodStart, periodEnd)
    .first<{ calls: number; billed: string }>();
  const billed = BigInt(totals?.billed ?? 0);
  return {
    installationId,
    month,
    state: now >= periodEnd ? "closed" : "open",
    periodStart,
    periodEnd,
    modelCalls: totals?.calls ?? 0,
    billedMicroUsdc: billed.toString(),
    feeOffsetMicroUsdc: "0",
    feeOffsetReason:
      "No reviewed link from a Slopbot installation to a funded project exists yet, so Slop's payout fee cannot offset this invoice.",
    settlement: "unavailable",
    settlementReason:
      "The vault service-charge operation and finalized invoice reconciliation are not implemented. This statement does not authorize or request a payment.",
  };
}
