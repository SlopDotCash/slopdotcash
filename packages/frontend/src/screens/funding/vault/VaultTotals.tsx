// spec/settlement/vaultSnapshots.md, "A failed refresh keeps the last totals marked stale"
import { Meter, Metric, MetricGrid, Status } from "@repo/ui";
import { formatDateTime } from "../../../app/format.ts";
import { formatAssetAmount } from "../../../kernels/assetText.ts";
import type { ShownVaultSnapshot } from "../../../reads/payments.vibe";

export type VaultTotalsProps = {
  /** One vault's last finalized read, marked stale when it is older than the stale window. */
  snapshot: ShownVaultSnapshot;
};

const share = 10_000n;

/** @throws {never} */
function reservedOf({ reserved, reservedPrincipal, reservedFees }: ShownVaultSnapshot): string | null {
  return reserved ?? (reservedPrincipal !== null && reservedFees !== null ? (BigInt(reservedPrincipal) + BigInt(reservedFees)).toString() : null);
}

/** One vault's free and reserved funds and what it has paid, never a zero it did not report. */
export function VaultTotals({ snapshot }: VaultTotalsProps) {
  const amount = (value: string | null) => (value === null ? "Not reported" : formatAssetAmount(BigInt(value), snapshot));
  const reserved = reservedOf(snapshot);
  const free = snapshot.freeBalance === null ? null : BigInt(snapshot.freeBalance);
  const whole = free === null || reserved === null ? 0n : free + BigInt(reserved);
  const freeShare = whole === 0n || free === null ? 0 : Number((free * share) / whole);
  return (
    <div className="flex flex-col gap-3">
      {snapshot.stale ? <Status presentation={{ tone: "Caution", icon: "Clock", label: `Stale · read ${formatDateTime(snapshot.observedAt)}` }} /> : null}
      {whole === 0n ? null : (
        <Meter
          label="Free and reserved funds"
          legend={false}
          segments={[
            { label: "Available", value: freeShare, tone: "Emphasis" },
            { label: "Reserved", value: Number(share) - freeShare, tone: "Notice" },
          ]}
        />
      )}
      <MetricGrid>
        <Metric label="Available" value={amount(snapshot.freeBalance)} tone="Emphasis" />
        <Metric label="Paid out" value={amount(snapshot.totalPaid)} detail={`+ ${amount(snapshot.totalPayoutFees)} fees`} />
      </MetricGrid>
    </div>
  );
}
