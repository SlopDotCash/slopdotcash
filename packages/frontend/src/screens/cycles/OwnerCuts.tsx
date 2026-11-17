// spec/frontend/projections.md, "The cycle page lists public cuts with distinct loading, error, empty and list states"; spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"
import type { MonthlyCut } from "@repo/settlement/client";
import { parseBaseUnits } from "@repo/settlement/kernels/amounts";
import { Button, DataState } from "@repo/ui";
import { cutListView, noCutsText, offersRetry } from "../../../gen/frontend__projections.ts";
import { formatRewardMinor, type RewardAmountAsset } from "../../kernels/assetText.ts";
import type { Shown } from "../home/listing.ts";
import { formatDateTime } from "../../app/format.ts";

export type OwnerCutsProps = {
  /** The month's public cuts, as their read shows them. */
  cuts: Shown<ReadonlyArray<MonthlyCut>>;
  /** The project's reward asset, which the amounts are in. */
  asset?: RewardAmountAsset;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

/** @throws {never} */
function amount(value: string, asset: RewardAmountAsset | undefined): string {
  return formatRewardMinor(parseBaseUnits(value) ?? 0n, asset);
}

function CutList({ cuts, asset }: { cuts: ReadonlyArray<MonthlyCut>; asset: RewardAmountAsset | undefined }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {cuts.map((cut) => (
        <li key={cut.githubUserId} className="flex flex-col gap-1 py-3">
          <p>
            <a href={`/contributors/${encodeURIComponent(cut.login)}`} className={linkClass}>
              {cut.login}
            </a>
            : proposed {amount(cut.proposedGrossBase, asset)}, new amount {amount(cut.grossBase, asset)} · <time dateTime={cut.cutAt}>{formatDateTime(cut.cutAt)}</time>
          </p>
          <p className="text-muted-foreground">Reason: {cut.reason}</p>
        </li>
      ))}
    </ul>
  );
}

/** Each current cut below a proposed amount with the owner's public reason; loading, failure, no cuts and a stale list each read differently. */
export function OwnerCuts({ cuts, asset }: OwnerCutsProps) {
  const view = cutListView(cuts.status);
  return (
    <section aria-labelledby="owner-cuts-heading" className="flex flex-col gap-3">
      <h2 id="owner-cuts-heading" className="text-xl font-semibold text-foreground">
        Owner cuts
      </h2>
      {view === "CutsLoading" ? (
        <p role="status">Loading owner cuts…</p>
      ) : view === "CutsError" ? (
        <p role="status">
          Owner cuts unavailable.{" "}
          {offersRetry(view) ? (
            <Button variant="link" size="sm" onClick={cuts.onRetry}>
              Retry owner cuts
            </Button>
          ) : null}
        </p>
      ) : view === "NoCuts" ? (
        <p>{noCutsText}</p>
      ) : view === "CutsStale" ? (
        <DataState status="Stale" onRetry={cuts.onRetry} retryLabel="Retry owner cuts">
          <CutList cuts={cuts.value ?? []} asset={asset} />
        </DataState>
      ) : (
        <CutList cuts={cuts.value ?? []} asset={asset} />
      )}
    </section>
  );
}
