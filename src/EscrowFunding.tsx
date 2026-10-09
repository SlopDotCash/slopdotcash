import { useEffect, useState } from "react";
import { readBoundedJson } from "./lib/browser-json";
import type { ProjectDefinition } from "./lib/projects.mjs";

interface Totals {
  network: string;
  totalNetPaidMicro: string;
  payoutFeesPaidMicro: string;
  reservedNetMicro: string;
  reservedFeeMicro: string;
  syncedAt: string | null;
  coverage: { kind: string; completeThrough: string | null };
}
function usdc(value: string) {
  const n = BigInt(value);
  return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, "0")} USDC`;
}

export function EscrowFunding({ project }: { project: ProjectDefinition }) {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const deployed = Boolean(project.escrow?.deployments.length);
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit refresh reloads the verified projection.
  useEffect(() => {
    setTotals(null);
    setError("");
    if (!deployed) return;
    const controller = new AbortController();
    fetch(
      `/api/v1/payments/projects/${encodeURIComponent(project.id)}/totals`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Verified payout totals are not available yet.");
        const value = (await readBoundedJson(
          response,
          65536,
          "project payout totals",
        )) as Totals;
        if (
          ![
            value.totalNetPaidMicro,
            value.payoutFeesPaidMicro,
            value.reservedNetMicro,
            value.reservedFeeMicro,
          ].every((n) => typeof n === "string" && /^(0|[1-9]\d*)$/.test(n)) ||
          value.coverage?.kind !== "finalized-payment-events"
        )
          throw new Error("Invalid payout totals.");
        if (!controller.signal.aborted) setTotals(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not verify payouts.",
          );
      });
    return () => controller.abort();
  }, [project.id, deployed, revision]);
  return (
    <section className="section project-funding" aria-label="Project escrow">
      <h2>{project.escrow?.chain === "base" ? "Base" : "Solana"} escrow</h2>
      <p>
        Contributor amounts deduct a 2% fee. Funded awards remain reserved until
        paid. Returning unused sponsor funds costs 10%.
      </p>
      {!deployed ? (
        <p>
          Escrow deployment is pending review. This project is not accepting
          escrow funding yet.
        </p>
      ) : (
        <>
          <p>
            Only the project owner can fund this version through its deposit
            transaction. Direct token transfers do not create reward or refund
            credit. Public donations are not enabled.
          </p>
          {error ? (
            <p role="alert">{error}</p>
          ) : !totals ? (
            <p role="status">Checking finalized payout records…</p>
          ) : (
            <>
              <dl>
                <dt>Indexed contributor payouts</dt>
                <dd>{usdc(totals.totalNetPaidMicro)}</dd>
                <dt>Indexed payout fees</dt>
                <dd>{usdc(totals.payoutFeesPaidMicro)}</dd>
                <dt>Reserved contributor awards</dt>
                <dd>{usdc(totals.reservedNetMicro)}</dd>
                <dt>Reserved payout fees</dt>
                <dd>{usdc(totals.reservedFeeMicro)}</dd>
              </dl>
              <p>
                Network: {totals.network}.{" "}
                {totals.coverage.completeThrough
                  ? "Finalized event scan recorded."
                  : "Initial event scan is incomplete."}{" "}
                These figures describe indexed awards and payments; they are not
                the vault balance.
              </p>
            </>
          )}
          <button
            className="button secondary-button"
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Refresh verified totals
          </button>
        </>
      )}
      <p>
        <a href="/earnings">View your earnings and payout wallets</a>
      </p>
    </section>
  );
}
