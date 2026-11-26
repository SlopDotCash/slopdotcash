/**
 * /record (PRD section 7, "Public record pages"): the money that has reached
 * contributors, the monthly cycles, the pools and where the numbers come from,
 * read only from /data/record.json. Ported from the retired record site.
 */
import { Link } from "./Link";
import {
  type PublicRecord,
  RECORD_DATA_PATH,
  type RecordCyclePool,
  type RecordMonth,
} from "./lib/record-data";
import { ExternalLinkAnchor } from "./Presentation";
import { RecordLoadState, usePublicRecord } from "./RecordLoad";
import "./record-pages.css";

const ARCHIVE =
  "https://github.com/SlopDotCash/slopdotcash/tree/109c7640298f9e0652eed9056e78705b776f79a6/";
const ARCHIVE_BLOB =
  "https://github.com/SlopDotCash/slopdotcash/blob/109c7640298f9e0652eed9056e78705b776f79a6/";

const n = (x: number, d = 0) =>
  x.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
const usd = (x: number) => `$${n(x, 2)}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const dm = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";
const monthName = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const monthOnly = (ym: string) => monthName(ym).split(" ")[0];
const lastDay = (ym: string) =>
  new Date(
    Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0),
  ).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
const when = (iso: string) =>
  `${new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;
const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];
const word = (k: number) => WORDS[k] ?? String(k);
const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// Fixed rows in the table: July from its cycle file, August from
// funding/preparations. Calendar-month counts, so months add up without the
// 35-day window overlap.
const FIXED = [
  { month: "2026-07", merged: 4165, reviews: 14, perPool: "25 in eliza" },
  {
    month: "2026-08",
    merged: 5588,
    reviews: 2674,
    perPool: "108 in eliza and 26 in asi",
  },
];

// States follow the cycle files: proposal, allocation, execution plan,
// transactions, settlement (written only once the verifier reconciles).
function poolState(c: RecordCyclePool, now: number): string {
  const f = new Set(c.files);
  if (c.settlement)
    return `Paid ${dm(c.settlement.settledAt)}, verified on chain`;
  if (f.has("windup.json")) return "Wound up, rows held";
  if (f.has("transactions.json"))
    return "Transfers recorded, awaiting verification";
  if (f.has("execution-plan.json")) return "Approved, scheduled";
  if (f.has("allocation.json") || c.approvedAt)
    return `Approved${c.approvedAt ? ` ${dm(c.approvedAt)}` : ""}`;
  if (c.reviewEndsAt && Date.parse(c.reviewEndsAt) > now)
    return `Frozen ${dm(c.generatedAt)}, under review until ${dm(c.reviewEndsAt)}`;
  return `Frozen ${dm(c.generatedAt)}, review window closed ${dm(c.reviewEndsAt)}, not approved`;
}

function monthState(pools: RecordCyclePool[], now: number): string {
  const states = pools.map((pool) => poolState(pool, now));
  return new Set(states).size === 1
    ? states[0]
    : pools.map((c, i) => `${c.projectId}: ${states[i]}`).join("; ");
}

const byContributors = (pools: RecordCyclePool[]) =>
  [...pools].sort((a, b) => b.contributors - a.contributors);

function Cycles({ months }: { months: RecordMonth[] }) {
  const now = Date.now();
  const rows = months.filter((m) => m.pools.length && m.counts);
  const total = FIXED.length + rows.length;
  const merged =
    FIXED.reduce((a, f) => a + f.merged, 0) +
    rows.reduce((a, m) => a + (m.counts?.calendarMerged ?? 0), 0);
  const reviews =
    FIXED.reduce((a, f) => a + f.reviews, 0) +
    rows.reduce((a, m) => a + (m.counts?.calendarReviews ?? 0), 0);
  const last = rows.length
    ? rows[rows.length - 1].month
    : FIXED[FIXED.length - 1].month;
  const perPool = FIXED.slice(1)
    .map((f) => `${f.perPool} for ${monthOnly(f.month)}`)
    .concat(
      rows.map(
        (m) =>
          `${byContributors(m.pools)
            .map((c) => `${n(c.contributors)} in ${c.projectId}`)
            .join(" and ")} for ${monthOnly(m.month)}`,
      ),
    );
  const overlaps = rows
    .filter((m) => m.pools.length > 1)
    .map((m) => {
      const both =
        m.pools.reduce((a, c) => a + c.contributors, 0) - m.uniqueContributors;
      return ` In ${monthOnly(m.month)}, ${n(both)} ${both === 1 ? "person appears" : "people appear"} in more than one pool, so the month has ${n(m.uniqueContributors)} unique contributors with a proposal row.`;
    })
    .join("");
  return (
    <section aria-labelledby="record-cycles">
      <h2 id="record-cycles">
        {cap1(word(total))} monthly cycles scored since July
      </h2>
      <p>
        Each month is frozen from the same scoring ledger into a file in the
        repository. Counts below come straight from those frozen files, so they
        do not move as the live window rolls.
      </p>
      <div className="plain-table-wrap">
        <table className="plain-table">
          <caption className="visually-hidden">Monthly cycles</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Pools</th>
              <th scope="col" className="record-num">
                Merged PRs
              </th>
              <th scope="col" className="record-num">
                Accepted reviews
              </th>
              <th scope="col" className="record-num">
                Contributors
              </th>
              <th scope="col">State</th>
              <th scope="col">Record</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>July 2026</td>
              <td>eliza</td>
              <td className="record-num">4,766</td>
              <td className="record-num">14</td>
              <td className="record-num">25</td>
              <td>Trial, proposal never approved</td>
              <td>
                <ExternalLinkAnchor href={`${ARCHIVE}cycles/eliza/2026-07`}>
                  cycles/eliza/2026-07
                </ExternalLinkAnchor>
              </td>
            </tr>
            <tr>
              <td>August 2026</td>
              <td>eliza, asi</td>
              <td className="record-num">5,588</td>
              <td className="record-num">2,674</td>
              <td className="record-num">108 + 26</td>
              <td>Sent, 72 transfers</td>
              <td>
                <ExternalLinkAnchor href="https://github.com/SlopDotCash/slopdotcash/tree/main/funding/preparations">
                  funding/preparations
                </ExternalLinkAnchor>
              </td>
            </tr>
            {rows.map((m) => {
              const pools = byContributors(m.pools);
              return (
                <tr key={m.month}>
                  <td>{monthName(m.month)}</td>
                  <td>{pools.map((c) => c.projectId).join(", ")}</td>
                  <td className="record-num">{n(m.counts?.merged ?? 0)}</td>
                  <td className="record-num">{n(m.counts?.reviews ?? 0)}</td>
                  <td className="record-num">
                    {pools.map((c) => n(c.contributors)).join(" + ")}
                  </td>
                  <td>{monthState(pools, now)}</td>
                  <td>
                    {pools.map((c, i) => (
                      <span key={c.projectId}>
                        {i > 0 ? ", " : null}
                        <ExternalLinkAnchor
                          href={`${ARCHIVE}cycles/${c.projectId}/${m.month}`}
                        >
                          {`${c.projectId}/${m.month}`}
                        </ExternalLinkAnchor>
                      </span>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="record-note">
        Counted once per calendar month (July 1 to {lastDay(last)}), the{" "}
        {word(total)} cycles hold{" "}
        <strong>{n(merged)} merged pull requests</strong> and{" "}
        <strong>{n(reviews)} accepted reviews</strong>; the table rows overlap
        by a few days at each boundary because every cycle scores a 35-day
        window. Contributors are listed per pool: {perPool.join(", ")}.
        {overlaps} August asi reviews are the pool's scored events minus its
        scored merges. Review scoring was barely live in July, which is why that
        row is low.
      </p>
    </section>
  );
}

function Money({ record }: { record: PublicRecord }) {
  const M = record.money;
  const settlements = M.settlements ?? [];
  const paidMonthList = [
    ...new Set(
      M.pools.map((p) => p.month).concat(settlements.map((x) => x.month)),
    ),
  ]
    .sort()
    .map(monthName);
  const paidMonths =
    paidMonthList.length > 2
      ? `${paidMonthList[0]} to ${paidMonthList[paidMonthList.length - 1]}`
      : paidMonthList.join(" and ");
  return (
    <section aria-labelledby="record-money">
      <h2 id="record-money">Money that has reached contributors</h2>
      <p>
        USDC transfers on Solana mainnet, finalized on chain, for{" "}
        {settlements.length
          ? `${paidMonths}; August was sent directly, later months through the verified settlement flow`
          : "the August 2026 contribution month"}
        . Every signature is published in the repository and reconciled row by
        row against the frozen preparation for each pool.
      </p>
      <div className="plain-table-wrap">
        <table className="plain-table">
          <caption className="visually-hidden">
            Money that has reached contributors
          </caption>
          <thead>
            <tr>
              <th scope="col">Pool</th>
              <th scope="col" className="record-num">
                Cap
              </th>
              <th scope="col" className="record-num">
                Allocated
              </th>
              <th scope="col" className="record-num">
                Paid
              </th>
              <th scope="col" className="record-num">
                Transfers
              </th>
              <th scope="col" className="record-num">
                Unclaimed
              </th>
              <th scope="col">Sent</th>
              <th scope="col">Record</th>
            </tr>
          </thead>
          <tbody>
            {M.pools.map((p) => (
              <tr key={`${p.projectId}-${p.month}`}>
                <td>
                  <strong>{p.projectId}</strong>{" "}
                  <span className="record-pill">{p.month}</span>
                </td>
                <td className="record-num">{usd(p.capUsdc)}</td>
                <td className="record-num">{usd(p.allocatedUsdc)}</td>
                <td className="record-num">
                  <strong>{usd(p.paidUsdc)}</strong>
                </td>
                <td className="record-num">
                  {p.transfers} of {p.rows} rows
                </td>
                <td className="record-num">
                  {usd(p.unclaimedUsdc)} ({p.unclaimedRows})
                </td>
                <td>{p.firstAt ? day(p.firstAt) : ""}</td>
                <td>
                  <ExternalLinkAnchor
                    href={`${ARCHIVE_BLOB}disclosures/${p.file || `${p.projectId}-${p.month}-direct-payments.json`}`}
                  >
                    JSON
                  </ExternalLinkAnchor>
                  {p.exampleSignature ? (
                    <>
                      {" · "}
                      <ExternalLinkAnchor
                        href={`https://solscan.io/tx/${p.exampleSignature}`}
                      >
                        example tx
                      </ExternalLinkAnchor>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
            {settlements.map((x) => (
              <tr key={`settled-${x.projectId}-${x.month}`}>
                <td>
                  <strong>{x.projectId}</strong>{" "}
                  <span className="record-pill">{x.month}</span>
                </td>
                <td className="record-num">
                  {x.capUsdc === null ? "" : usd(x.capUsdc)}
                </td>
                <td className="record-num" />
                <td className="record-num">
                  <strong>{usd(x.paidUsdc)}</strong>
                </td>
                <td className="record-num">{x.transfers}</td>
                <td className="record-num" />
                <td>{day(x.settledAt)}</td>
                <td>
                  <ExternalLinkAnchor
                    href={`${ARCHIVE}cycles/${x.projectId}/${x.month}`}
                  >
                    settlement
                  </ExternalLinkAnchor>{" "}
                  <span className="record-pill">verified</span>
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <strong>Total</strong>
              </td>
              <td className="record-num" />
              <td className="record-num">{usd(M.allocatedUsdc)}</td>
              <td className="record-num">
                <strong>{usd(M.paidUsdc)}</strong>
              </td>
              <td className="record-num">{M.transfers}</td>
              <td className="record-num">{usd(M.unclaimedUsdc)}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="record-status">
        <p>
          <strong>How the August transfers were sent.</strong> The project
          creator signed and broadcast these transfers directly from the
          project's own wallet. Slop held no funds and no keys for these
          transfers. They went out before any month had run through Slop's own
          payment flow, so the repository records them as{" "}
          <code>sent-outside-verified-flow</code>, with a reconciliation that
          found zero unmatched transfers and no row with a registered wallet
          above the $2.00 minimum left unpaid.
          {settlements.length > 0 ? null : (
            <>
              {" "}
              Payouts now run from project vaults instead: contracts that each
              project's owner funds. In that flow Slop holds a fee key, an
              identity attester key and contract upgrade keys. The{" "}
              <Link href="/sponsors">Fund a project page</Link> says what each
              one can do.
            </>
          )}
        </p>
        <p>
          {usd(M.unclaimedUsdc)} of the {usd(M.allocatedUsdc)} allocated across
          the August pools is unclaimed. Unclaimed amounts belong to
          contributors who had not registered a payout wallet when the month was
          frozen.
          {M.platformFeeCollected
            ? null
            : " No platform fee was collected on the August pools."}
        </p>
      </div>
      <p>
        Each month in which a project sends money from its vault to outside
        contributors gets its own public receipt, with every recipient and
        transaction: <Link href="/receipts">slop.cash/receipts</Link>.
      </p>
    </section>
  );
}

function Pools({ record }: { record: PublicRecord }) {
  const pr = record.proposal;
  return (
    <section aria-labelledby="record-pools">
      <h2 id="record-pools">Pools</h2>
      <div className="plain-table-wrap">
        <table className="plain-table">
          <caption className="visually-hidden">Pools</caption>
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Repository</th>
              <th scope="col" className="record-num">
                Monthly cap
              </th>
              <th scope="col">Rail</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {record.projects.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong>
                </td>
                <td>
                  {p.repository ? (
                    <ExternalLinkAnchor href={p.repository}>
                      {p.repository.replace("https://github.com/", "")}
                    </ExternalLinkAnchor>
                  ) : null}
                </td>
                <td className="record-num">
                  {p.kind === "external-prize-share" ? (
                    <ExternalLinkAnchor href={p.prize || "#"}>
                      external prize
                    </ExternalLinkAnchor>
                  ) : (
                    p.capDisplay || ""
                  )}
                </td>
                <td>
                  {p.chain
                    ? (CHAIN_NAMES[p.chain] ?? p.chain)
                    : p.kind === "external-prize-share"
                      ? "prize share"
                      : ""}
                </td>
                <td>
                  {p.status}{" "}
                  <span className="record-pill">
                    {p.authority === "verified"
                      ? "authority verified"
                      : `authority ${p.authority || "unverified"}`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="record-note">
        First frozen proposal:{" "}
        <strong>
          {pr.projectId} {pr.cycleId}
        </strong>
        , {pr.allocations} proposed allocations under a {usd(pr.capUsdc)} cap,
        generated {day(pr.generatedAt)}. State <code>{pr.status}</code>,
        approved {usd(pr.approvedUsdc)}. Proposed is not approved, and approved
        is not paid. <Link href="/cycles">slop.cash/cycles</Link>
      </p>
    </section>
  );
}

function Sources() {
  return (
    <section aria-labelledby="record-sources">
      <h2 id="record-sources">Where the numbers come from</h2>
      <ul>
        <li>
          <ExternalLinkAnchor href={`${ARCHIVE}disclosures`}>
            disclosures/
          </ExternalLinkAnchor>{" "}
          in the Slop repository: one JSON record per pool for transfers sent
          outside the verified flow (August 2026), each row bound to a Solana
          signature.
        </li>
        <li>
          <ExternalLinkAnchor href={`${ARCHIVE}cycles`}>
            cycles/
          </ExternalLinkAnchor>
          : frozen proposals, their review windows, and verified settlements, as
          of the last repository commit that held them.
        </li>
        <li>
          <a href="/api/v1/projects">slop.cash/api/v1/projects</a>: the project
          registry. Each change is an append-only revision.
        </li>
        <li>
          <a href="/api/v1/payments/vault-payments">
            slop.cash/api/v1/payments/vault-payments
          </a>
          : finalized vault payments, the source of each{" "}
          <Link href="/receipts">receipt</Link>.
        </li>
      </ul>
      <p className="record-note">
        Slop rebuilds this record from these sources with every site release and
        publishes it as{" "}
        <a href={RECORD_DATA_PATH}>slop.cash{RECORD_DATA_PATH}</a>.
      </p>
    </section>
  );
}

/** The pool's network. The record does not say which asset a pool pays in. */
const CHAIN_NAMES: Record<string, string> = {
  base: "Base",
  ethereum: "Ethereum",
  robinhood: "Robinhood Chain",
  solana: "Solana",
};

export default function RecordPage() {
  const [state, retry] = usePublicRecord();
  return (
    <main className="shell route-main record-page">
      <h1>Slop Cash, by the public record.</h1>
      <p>
        Built from slop.cash's own public data and the public Slop repository on
        GitHub with every site release. Every number links back to its source.
      </p>
      <RecordLoadState state={state} retry={retry} label="Loading the record">
        {(record) => (
          <>
            <p className="record-stamp">Rebuilt {when(record.builtAt)}</p>
            <Money record={record} />
            {record.months ? <Cycles months={record.months} /> : null}
            <Pools record={record} />
          </>
        )}
      </RecordLoadState>
      <Sources />
    </main>
  );
}
