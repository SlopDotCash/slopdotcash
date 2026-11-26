// spec/frontend/routes.md, "Each route has one title, canonical and index policy, and private routes never name a private identifier"
import { Alert, Button, ExternalLink, PageHeader, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui";
import { retryOnce, useOnce } from "../../app/hooks.ts";
import { PageShell } from "../../app/PageShell.tsx";
import type { PageRuntime } from "../../app/runtime.vibe";
import { loadPublicRecord, type Receipt } from "../../reads/record.vibe";

const safeUrl = (u: string) => (/^https:\/\/[^\s"'<>]+$/u.test(u) ? u : "#");
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const people = (k: number) => (k === 1 ? "1 outside contributor" : `${k} outside contributors`);
const hours = (h: number) => (h < 1 ? "under an hour" : h < 48 ? `${Math.round(h)} ${Math.round(h) === 1 ? "hour" : "hours"}` : `${Math.round(h / 24)} days`);
const short = (t: string) => (t.length > 20 ? `${t.slice(0, 10)}…${t.slice(-8)}` : t);

function mergeLine(m: Receipt["merges"]): string {
  if (!m || m.repositories.length === 0) return "No merge figures were on record when this receipt was published.";
  const parts = m.repositories.map((r) => {
    const count = r.mergedOutside >= 300 ? "300 or more" : String(r.mergedOutside);
    const median = r.medianHours === null ? "" : `, median time from opening to merge ${hours(r.medianHours)}`;
    return `${r.repository}: ${count} pull ${r.mergedOutside === 1 ? "request" : "requests"} from outside contributors merged${median}`;
  });
  return `In the ${m.windowDays} days to ${day(m.asOf)}, the day this receipt was published: ${parts.join("; ")}. The site keeps a rolling ${m.windowDays}-day figure, not one per calendar month.`;
}

function ReceiptSection({ r }: { r: Receipt }) {
  const notes: string[] = [];
  if (r.own) {
    notes.push(
      `Not counted above: ${r.own.payments === 1 ? "1 payment" : `${r.own.payments} payments`} in the same month, ${r.own.total} ${r.asset} in all, sent to the project's own owner or a Slop team account.`,
    );
  }
  if (r.privateRecords) {
    notes.push("Some recipients keep their Slop record private. They are not listed, so the real number of contributors and the real total are higher than the figures here.");
  }
  if (r.reserved) {
    notes.push(`${r.reserved} ${r.asset} more is held in the project's vault for contributors who have no wallet on file for this network. It is sent when they register one, and is not part of this receipt until then.`);
  }
  const sent = r.firstSentAt.slice(0, 10) === r.lastSentAt.slice(0, 10) ? day(r.firstSentAt) : `${day(r.firstSentAt)} to ${day(r.lastSentAt)}`;

  return (
    <section id={r.anchor} aria-labelledby={`${r.anchor}-title`} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
        <div>
          <h2 id={`${r.anchor}-title`} className="text-lg font-semibold text-foreground">
            {r.project}, {monthName(r.month)}
          </h2>
          <p className="text-xs text-muted-foreground">
            Sent {sent} · <a href={`#${r.anchor}`} className="text-primary underline underline-offset-4">link to this receipt</a>
          </p>
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(11rem,auto)_1fr]">
          <dt className="text-muted-foreground">Project</dt>
          <dd><a href={`/projects/${encodeURIComponent(r.projectId)}`} className="text-primary underline underline-offset-4">{r.project}</a></dd>
          <dt className="text-muted-foreground">For work merged in</dt>
          <dd>{monthName(r.month)}</dd>
          <dt className="text-muted-foreground">Asset and network</dt>
          <dd>{r.asset} on {r.networkName}{r.stable ? "" : " (the project's own token)"}</dd>
          <dt className="text-muted-foreground">Total sent</dt>
          <dd>{r.total} {r.asset} to {people(r.contributors)}</dd>
          <dt className="text-muted-foreground">Fee Slop took</dt>
          <dd>
            {r.feeExact
              ? `${r.fee} ${r.asset}. Slop takes 2% of each award before the contributor is sent the rest.`
              : `About ${r.fee} ${r.asset}, worked out from the amounts received (Slop takes 2% of each award before the contributor is sent the rest). The public record gives fees per project, not per month.`}
          </dd>
        </dl>
        <div className="overflow-x-auto">
          <Table label={`${r.project}, ${monthName(r.month)}: recipients`}>
            <TableHeader>
              <TableRow>
                <TableHead>Contributor</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead>Transaction</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.recipients.map((p) => (
                <TableRow key={p.transactions.map((t) => t.id).join(" ")}>
                  <TableCell>
                    {p.login ? <ExternalLink href={`https://github.com/${encodeURIComponent(p.login)}`}>{p.login}</ExternalLink> : "An account the site did not name"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{p.received} {r.asset}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {p.transactions.map((t) => (
                        <ExternalLink key={t.id} href={safeUrl(t.url)} className="font-mono text-xs">
                          {short(t.id)}
                        </ExternalLink>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">Amounts are what each contributor received, after the fee. Each transaction was confirmed final on {r.networkName} before this receipt was published.</p>
        <p className="text-xs text-muted-foreground">Merging at this project: {mergeLine(r.merges)}</p>
        {notes.map((note) => (
          <p key={note} className="text-xs text-muted-foreground">{note}</p>
        ))}
      </section>
  );
}

const EMPTY = "The first receipt appears here when a project pays an outside contributor.";

export function ReceiptsPage({ runtime }: { runtime: PageRuntime }) {
  const state = useOnce(runtime, "public-record", () => loadPublicRecord());
  return (
    <PageShell width="lg" gap="6">
      <PageHeader title="Receipts" />
      {state.status === "running" ? (
        <Spinner label="Loading receipts" />
      ) : state.status === "failed" ? (
        <Alert variant="destructive" action={<Button variant="outline" size="sm" onClick={() => retryOnce(runtime, "public-record")}>Retry</Button>}>
          The receipts could not be loaded. Please try again shortly.
        </Alert>
      ) : (() => {
        const record = state.value;
        const items = record.receipts?.items ?? [];
        if (items.length === 0) return <p className="text-sm text-muted-foreground">{EMPTY}</p>;
        const newestFirst = [...items].sort((a, b) => (a.firstSentAt < b.firstSentAt ? 1 : -1));
        return (
          <>
            <p className="text-xs text-muted-foreground">
              Rebuilt {day(record.receipts?.builtAt || record.builtAt)} from slop.cash&apos;s public payment record.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Each receipt below is one month in which a project on Slop Cash sent money from its own vault to people outside the project for work the project merged. It names who received what and links every transaction.
            </p>
            <div className="flex flex-col gap-6">
              {newestFirst.map((r) => <ReceiptSection key={r.anchor} r={r} />)}
            </div>
            <section className="flex flex-col gap-2 text-sm text-muted-foreground">
              <h2 className="text-base font-semibold text-foreground">When a month gets a receipt</h2>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>The payment is on <a href="/api/v1/payments/vault-payments" className="text-primary underline underline-offset-4">slop.cash&apos;s public record of finalized vault payments</a>, for a named month of work, on a main network.</li>
                <li>At least one recipient is neither the project&apos;s own owner nor a Slop team account.</li>
                <li>The site names every recipient of the month, and each counted transaction was checked on chain and found final when this page was rebuilt.</li>
              </ul>
            </section>
            <section className="flex flex-col gap-2 text-sm text-muted-foreground">
              <h2 className="text-base font-semibold text-foreground">What these receipts do not show</h2>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>Private allocations. How a month&apos;s pool is split among contributors before it is sent is private; a receipt shows only what was sent.</li>
                <li>Recipients who keep their Slop record private. Where a project has some, its receipt says so.</li>
                <li>Awards not yet claimed. Money held in a vault for a contributor with no wallet on file appears only once it is sent.</li>
                <li>Payments to a project&apos;s own owner or to Slop team accounts. They are named in a note and left out of the totals.</li>
                <li>Security bounties, withdrawals by a project owner, and the August 2026 transfers that were sent directly from a wallet. Those are on the <a href="/record" className="text-primary underline underline-offset-4">live record</a>.</li>
                <li>Anything about later months. A receipt records a payment that happened and says nothing about the next one.</li>
              </ul>
              <p className="text-xs text-muted-foreground">The receipts are rebuilt with every slop.cash release, so a new payment can take some hours to appear.</p>
            </section>
          </>
        );
      })()}
    </PageShell>
  );
}
