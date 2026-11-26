/**
 * /receipts (PRD section 7, "Public record pages"): one receipt for each
 * project month in which a project sent money from its vault to at least one
 * outside contributor, read only from /data/record.json. Each receipt keeps
 * the anchor it had on the retired record site, `#<project>-<YYYY-MM>`.
 */
import { Link } from "./Link";
import type { Receipt } from "./lib/record-data";
import { ExternalLinkAnchor } from "./Presentation";
import { RecordLoadState, usePublicRecord } from "./RecordLoad";
import "./record-pages.css";

const safeUrl = (u: string) =>
  /^https:\/\/[^\s"'<>]+$/u.test(String(u)) ? String(u) : "#";
const monthName = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const people = (k: number) =>
  k === 1 ? "1 outside contributor" : `${k} outside contributors`;
const hours = (h: number) =>
  h < 1
    ? "under an hour"
    : h < 48
      ? `${Math.round(h)} ${Math.round(h) === 1 ? "hour" : "hours"}`
      : `${Math.round(h / 24)} days`;
const short = (t: string) =>
  t.length > 20 ? `${t.slice(0, 10)}…${t.slice(-8)}` : t;

function mergeLine(m: Receipt["merges"]): string {
  if (!m || !Array.isArray(m.repositories) || !m.repositories.length)
    return "No merge figures were on record when this receipt was published.";
  const parts = m.repositories.map((r) => {
    const count =
      r.mergedOutside >= 300 ? "300 or more" : String(r.mergedOutside);
    const median =
      r.medianHours === null || r.medianHours === undefined
        ? ""
        : `, median time from opening to merge ${hours(r.medianHours)}`;
    return `${r.repository}: ${count} pull ${r.mergedOutside === 1 ? "request" : "requests"} from outside contributors merged${median}`;
  });
  return `In the ${m.windowDays} days to ${day(m.asOf)}, the day this receipt was published: ${parts.join("; ")}. The site keeps a rolling ${m.windowDays}-day figure, not one per calendar month.`;
}

function ReceiptSection({ r }: { r: Receipt }) {
  const notes: string[] = [];
  if (r.own)
    notes.push(
      `Not counted above: ${r.own.payments === 1 ? "1 payment" : `${r.own.payments} payments`} in the same month, ${r.own.total} ${r.asset} in all, sent to the project's own owner or a Slop team account.`,
    );
  if (r.privateRecords)
    notes.push(
      "Some recipients keep their Slop record private. They are not listed, so the real number of contributors and the real total are higher than the figures here.",
    );
  if (r.reserved)
    notes.push(
      `${r.reserved} ${r.asset} more is held in the project's vault for contributors who have no wallet on file for this network. It is sent when they register one, and is not part of this receipt until then.`,
    );
  const sent =
    r.firstSentAt.slice(0, 10) === r.lastSentAt.slice(0, 10)
      ? day(r.firstSentAt)
      : `${day(r.firstSentAt)} to ${day(r.lastSentAt)}`;
  return (
    <section
      className="record-receipt"
      id={r.anchor}
      aria-labelledby={`${r.anchor}-title`}
    >
      <h2 id={`${r.anchor}-title`}>
        {r.project}, {monthName(r.month)}
      </h2>
      <p className="record-stamp">
        Sent {sent} · <a href={`#${r.anchor}`}>link to this receipt</a>
      </p>
      <dl>
        <dt>Project</dt>
        <dd>
          <Link href={`/projects/${r.projectId}`}>{r.project}</Link>
        </dd>
        <dt>For work merged in</dt>
        <dd>{monthName(r.month)}</dd>
        <dt>Asset and network</dt>
        <dd>
          {r.asset} on {r.networkName}
          {r.stable ? "" : " (the project's own token)"}
        </dd>
        <dt>Total sent</dt>
        <dd>
          {r.total} {r.asset} to {people(r.contributors)}
        </dd>
        <dt>Fee Slop took</dt>
        <dd>
          {r.feeExact
            ? `${r.fee} ${r.asset}. Slop takes 2% of each award before the contributor is sent the rest.`
            : `About ${r.fee} ${r.asset}, worked out from the amounts received (Slop takes 2% of each award before the contributor is sent the rest). The public record gives fees per project, not per month.`}
        </dd>
      </dl>
      <div className="plain-table-wrap">
        <table className="plain-table record-receipt-table">
          <caption className="visually-hidden">
            {r.project}, {monthName(r.month)}: recipients
          </caption>
          <thead>
            <tr>
              <th scope="col">Contributor</th>
              <th scope="col" className="record-num">
                Received
              </th>
              <th scope="col">Transaction</th>
            </tr>
          </thead>
          <tbody>
            {r.recipients.map((p) => (
              <tr key={p.transactions.map((t) => t.id).join(" ")}>
                <td>
                  {p.login ? (
                    <ExternalLinkAnchor href={`https://github.com/${p.login}`}>
                      {p.login}
                    </ExternalLinkAnchor>
                  ) : (
                    "An account the site did not name"
                  )}
                </td>
                <td className="record-num">
                  {p.received} {r.asset}
                </td>
                <td>
                  {p.transactions.map((t, i) => (
                    <span key={t.id}>
                      {i > 0 ? <br /> : null}
                      <ExternalLinkAnchor
                        className="record-addr"
                        href={safeUrl(t.url)}
                      >
                        {short(t.id)}
                      </ExternalLinkAnchor>
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="record-note">
        Amounts are what each contributor received, after the fee. Each
        transaction was confirmed final on {r.networkName} before this receipt
        was published.
      </p>
      <p className="record-note">
        Merging at this project: {mergeLine(r.merges)}
      </p>
      {notes.map((note) => (
        <p className="record-note" key={note}>
          {note}
        </p>
      ))}
    </section>
  );
}

const EMPTY =
  "The first receipt appears here when a project pays an outside contributor.";

export default function ReceiptsPage() {
  const [state, retry] = usePublicRecord();
  return (
    <main className="shell route-main record-page">
      <h1>Receipts</h1>
      <RecordLoadState
        state={state}
        retry={retry}
        label="Loading receipts"
        unavailable="The receipts could not be loaded. Please try again shortly."
      >
        {(record) => {
          const items = Array.isArray(record.receipts?.items)
            ? record.receipts.items
            : [];
          if (!items.length) return <p>{EMPTY}</p>;
          const newestFirst = items
            .slice()
            .sort((a, b) => (a.firstSentAt < b.firstSentAt ? 1 : -1));
          return (
            <>
              <p className="record-stamp">
                Rebuilt {day(record.receipts?.builtAt || record.builtAt)} from
                slop.cash's public payment record.
              </p>
              <p>
                Each receipt below is one month in which a project on Slop Cash
                sent money from its own vault to people outside the project for
                work the project merged. It names who received what and links
                every transaction.
              </p>
              {newestFirst.map((r) => (
                <ReceiptSection key={r.anchor} r={r} />
              ))}
              <h2>When a month gets a receipt</h2>
              <ul>
                <li>
                  The payment is on{" "}
                  <a href="/api/v1/payments/vault-payments">
                    slop.cash's public record of finalized vault payments
                  </a>
                  , for a named month of work, on a main network.
                </li>
                <li>
                  At least one recipient is neither the project's own owner nor
                  a Slop team account.
                </li>
                <li>
                  The site names every recipient of the month, and each counted
                  transaction was checked on chain and found final when this
                  page was rebuilt.
                </li>
              </ul>
              <h2>What these receipts do not show</h2>
              <ul>
                <li>
                  Private allocations. How a month's pool is split among
                  contributors before it is sent is private; a receipt shows
                  only what was sent.
                </li>
                <li>
                  Recipients who keep their Slop record private. Where a project
                  has some, its receipt says so.
                </li>
                <li>
                  Awards not yet claimed. Money held in a vault for a
                  contributor with no wallet on file appears only once it is
                  sent.
                </li>
                <li>
                  Payments to a project's own owner or to Slop team accounts.
                  They are named in a note and left out of the totals.
                </li>
                <li>
                  Security bounties, withdrawals by a project owner, and the
                  August 2026 transfers that were sent directly from a wallet.
                  Those are on the <Link href="/record">live record</Link>.
                </li>
                <li>
                  Anything about later months. A receipt records a payment that
                  happened and says nothing about the next one.
                </li>
              </ul>
              <p className="record-note">
                The receipts are rebuilt with every slop.cash release, so a new
                payment can take some hours to appear.
              </p>
            </>
          );
        }}
      </RecordLoadState>
    </main>
  );
}
