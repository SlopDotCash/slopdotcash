// spec/backend/referralCodes.md, "The referral path without a name opens Settings without a database read"
import { Address, Alert, Button, Spinner } from "@repo/ui";
import { Coins } from "lucide-react";
import { retryOnce, useOnce } from "../../app/hooks.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { loadReferralClaims } from "../../flows/account/referralClaims.vibe";
import { networkLabel } from "../../kernels/assetText.ts";
import { formatSlopAmount } from "../../kernels/standingDepositItem.ts";
import { formatDate } from "../projects/summary.ts";

function formatSlop(base: string | null, decimals: number): string {
  if (base === null) return "—";
  return formatSlopAmount(base, decimals);
}

export function ReferralClaims({ runtime, githubId }: { runtime: PageRuntime; githubId: string }) {
  const key = `referral-claims:${githubId}`;
  const loaded = useOnce(runtime, key, () => loadReferralClaims(githubId));

  if (loaded.status === "running") {
    return (
      <section aria-labelledby="referral-claims-heading" className="flex flex-col gap-3">
        <h2 id="referral-claims-heading" className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Coins aria-hidden className="size-5 text-primary" /> Referral rewards
        </h2>
        <Spinner size="sm" label="Loading referral rewards" />
      </section>
    );
  }

  if (loaded.status === "failed") {
    return (
      <section aria-labelledby="referral-claims-heading" className="flex flex-col gap-3">
        <h2 id="referral-claims-heading" className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Coins aria-hidden className="size-5 text-primary" /> Referral rewards
        </h2>
        <Alert variant="destructive" action={<Button variant="outline" size="sm" onClick={() => retryOnce(runtime, key)}>Retry</Button>}>
          {loaded.message}
        </Alert>
      </section>
    );
  }

  const data = loaded.value;
  if (!data.enabled) return null;

  const decimals = data.program?.decimals ?? 18;
  const network = data.program ? networkLabel(data.program.network) : "Robinhood Chain";

  return (
    <section aria-labelledby="referral-claims-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="referral-claims-heading" className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Coins aria-hidden className="size-5 text-primary" /> Referral rewards
        </h2>
        <a href="/referrals" className="text-sm text-primary underline underline-offset-4">
          Referral terms
        </a>
      </div>
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-sm">
        {data.status === "stale" ? (
          <Alert variant="info">Referral figures may be stale while the latest epoch syncs.</Alert>
        ) : data.status === "unknown" ? (
          <Alert variant="info">On-chain claim status could not be confirmed right now.</Alert>
        ) : null}
        {data.paused ? <Alert variant="info">Referral claims are temporarily paused.</Alert> : null}
        {data.ended ? <Alert variant="info">This referral program epoch has ended.</Alert> : null}
        {data.latestVoided ? <Alert variant="info">The most recent referral epoch was voided before finalization.</Alert> : null}
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Accrued</dt>
            <dd className="font-mono text-sm font-semibold text-foreground">{formatSlop(data.accruedBase, decimals)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Claimable now</dt>
            <dd className="font-mono text-sm font-semibold text-foreground">{formatSlop(data.claimableBase, decimals)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Pending</dt>
            <dd className="font-mono text-sm text-foreground">{formatSlop(data.pendingBase, decimals)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Already claimed</dt>
            <dd className="font-mono text-sm text-foreground">{formatSlop(data.claimedBase, decimals)}</dd>
          </div>
        </dl>
        {data.wallet ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Claim wallet on {network}:</span>
            <Address value={data.wallet} label="Referral claim wallet" />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Add an EVM payout wallet in <a href="/account#wallets" className="text-primary underline underline-offset-4">Settings</a> to claim referral rewards on {network}.
          </p>
        )}
        {data.pendingUntil ? (
          <p className="text-xs text-muted-foreground">Pending referral rewards unlock after {formatDate(data.pendingUntil)}.</p>
        ) : null}
        {data.program && data.claim ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <span>
              Period {data.claim.period} · Epoch {data.claim.epoch} · Distributor{" "}
              <code className="font-mono text-foreground">{data.program.distributor}</code>
            </span>
            <Button variant="outline" size="sm" onClick={() => retryOnce(runtime, key)}>
              Refresh claim status
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
