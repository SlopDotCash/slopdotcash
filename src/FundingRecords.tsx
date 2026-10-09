import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import {
  assertProjectFundingIndex,
  type ProjectFundingIndex,
  type ProjectFundingRecord,
  projectFundingTotals,
  publicFundingRecordsForDonor,
} from "./lib/funding";
import type { GitHubActor } from "./lib/leaderboard";
import { findProject, PROJECTS } from "./lib/projects.mjs";
import {
  type PublicResourceState,
  usePublicResource,
} from "./lib/use-public-resource";
import { ExternalLinkAnchor, formatMicroUsdc } from "./Presentation";

async function loadFundingIndex(signal: AbortSignal) {
  const addresses = new Map(
    PROJECTS.map((project) => [project.id, project.funding.addresses]),
  );
  const commitments = new Map(
    PROJECTS.map((project) => [project.id, project.funding.commitments ?? []]),
  );
  const response = await fetchWithDeadline("/data/funding.json", {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const value = await readBoundedJson(
    response,
    8 * 1024 * 1024,
    "Funding index",
  );
  return { index: assertProjectFundingIndex(value, addresses, commitments) };
}

export type FundingDataState = PublicResourceState<{
  index: ProjectFundingIndex;
}>;
export function useFundingIndex(): [FundingDataState, () => void] {
  return usePublicResource(true, loadFundingIndex, "Invalid data");
}

export function DonorFundingProfile({
  actor,
  records,
}: {
  actor: Pick<GitHubActor, "id" | "login">;
  records: readonly ProjectFundingRecord[];
}) {
  const publicRecords = publicFundingRecordsForDonor(records, actor.id);
  if (publicRecords.length === 0) return null;
  const totals = projectFundingTotals(publicRecords);
  return (
    <section className="section profile-section">
      <div className="profile-section-heading">
        <h2>Public project funding</h2>
        <span>
          {publicRecords.length} attributed record
          {publicRecords.length === 1 ? "" : "s"}
        </span>
      </div>
      <p>
        Only transactions explicitly attributed to this GitHub actor appear
        here. Anonymous funding never appears on contributor profiles.
      </p>
      {totals.map((assetTotals) => (
        <p className="money-summary" key={assetTotals.asset}>
          <strong>
            {formatFundingAmount(assetTotals.asset, assetTotals.verifiedMinor)}{" "}
            verified on-chain
          </strong>
          <span>
            {formatFundingAmount(
              assetTotals.asset,
              assetTotals.selfReportedMinor,
            )}{" "}
            self-reported
          </span>
        </p>
      ))}
      <div className="plain-table-wrap">
        <table className="plain-table">
          <caption className="visually-hidden">
            Publicly attributed project funding
          </caption>
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Amount</th>
              <th scope="col">State</th>
              <th scope="col">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {publicRecords.map((record) => (
              <tr key={record.recordId}>
                <th scope="row">
                  {findProject(record.projectId)?.name ?? record.projectId}
                </th>
                <td>{formatFundingMinor(record)}</td>
                <td>{record.state.replaceAll("-", " ")}</td>
                <td>
                  <ExternalLinkAnchor href={fundingTransactionExplorer(record)}>
                    View transaction
                  </ExternalLinkAnchor>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function formatFundingAmount(
  asset: ProjectFundingRecord["asset"],
  amountMinor: string,
): string {
  if (asset === "USDC") return formatMicroUsdc(amountMinor);
  const satoshis = BigInt(amountMinor);
  const whole = satoshis / 100_000_000n;
  const fraction = (satoshis % 100_000_000n).toString().padStart(8, "0");
  return `${whole}.${fraction} BTC`;
}

export function formatFundingMinor(record: ProjectFundingRecord): string {
  return formatFundingAmount(record.asset, record.amountMinor);
}

export function fundingTransactionExplorer(
  record: ProjectFundingRecord,
): string {
  const encoded = encodeURIComponent(record.transactionId);
  if (record.network === "solana") return `https://solscan.io/tx/${encoded}`;
  if (record.network === "base") return `https://basescan.org/tx/${encoded}`;
  if (record.network === "ethereum")
    return `https://etherscan.io/tx/${encoded}`;
  return `https://mempool.space/tx/${encoded}`;
}
