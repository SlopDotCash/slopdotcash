// spec/frontend/routes.md, "Each route has one title, canonical and index policy, and private routes never name a private identifier"
import { Alert, Button, ExternalLink, PageHeader, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui";
import { retryOnce, useNow, useOnce } from "../../app/hooks.ts";
import { PageShell } from "../../app/PageShell.tsx";
import type { PageRuntime } from "../../app/runtime.vibe";
import { loadPublicRecord, type PublicRecord, RECORD_DATA_PATH, type RecordCyclePool, type RecordMonth } from "../../reads/record.vibe";

const ARCHIVE = "https://github.com/SlopDotCash/slopdotcash/tree/109c7640298f9e0652eed9056e78705b776f79a6/";
const ARCHIVE_BLOB = "https://github.com/SlopDotCash/slopdotcash/blob/109c7640298f9e0652eed9056e78705b776f79a6/";

const n = (x: number, d = 0) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (x: number) => `$${n(x, 2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const dm = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const monthOnly = (ym: string) => monthName(ym).split(" ")[0] ?? ym;
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
const when = (iso: string) => `${new Date(iso).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = (k: number) => WORDS[k] ?? String(k);
const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const FIXED = [
  { month: "2026-07", merged: 4165, reviews: 14, perPool: "25 in eliza" },
  { month: "2026-08", merged: 5588, reviews: 2674, perPool: "108 in eliza and 26 in asi" },
] as const;

const CHAIN_NAMES: Readonly<Record<string, string>> = {
  base: "Base",
  ethereum: "Ethereum",
  robinhood: "Robinhood Chain",
  solana: "Solana",
};

function poolState(c: RecordCyclePool, now: number): string {
  const f = new Set(c.files);
  if (c.settlement) return `Paid ${dm(c.settlement.settledAt)}, verified on chain`;
  if (f.has("windup.json")) return "Wound up, rows held";
  if (f.has("transactions.json")) return "Transfers recorded, awaiting verification";
  if (f.has("execution-plan.json")) return "Approved, scheduled";
  if (f.has("allocation.json") || c.approvedAt) return `Approved${c.approvedAt ? ` ${dm(c.approvedAt)}` : ""}`;
  if (c.reviewEndsAt && Date.parse(c.reviewEndsAt) > now) return `Frozen ${dm(c.generatedAt)}, under review until ${dm(c.reviewEndsAt)}`;
  return `Frozen ${dm(c.generatedAt)}, review window closed ${dm(c.reviewEndsAt)}, not approved`;
}

function monthState(pools: ReadonlyArray<RecordCyclePool>, now: number): string {
  const states = pools.map((pool) => poolState(pool, now));
  return new Set(states).size === 1 ? (states[0] ?? "") : pools.map((c, i) => `${c.projectId}: ${states[i]}`).join("; ");
}

const byContributors = (pools: ReadonlyArray<RecordCyclePool>) => [...pools].sort((a, b) => b.contributors - a.contributors);

function Cycles({ months, now }: { months: ReadonlyArray<RecordMonth>; now: number }) {
  const rows = months.filter((m) => m.pools.length > 0 && m.counts !== null);
  const total = FIXED.length + rows.length;
  const merged = FIXED.reduce((a, f) => a + f.merged, 0) + rows.reduce((a, m) => a + (m.counts?.calendarMerged ?? 0), 0);
  const reviews = FIXED.reduce((a, f) => a + f.reviews, 0) + rows.reduce((a, m) => a + (m.counts?.calendarReviews ?? 0), 0);
  const last = rows.at(-1)?.month ?? FIXED.at(-1)?.month ?? "";
  const perPool = FIXED.slice(1)
    .map((f) => `${f.perPool} for ${monthOnly(f.month)}`)
    .concat(rows.map((m) => `${byContributors(m.pools).map((c) => `${n(c.contributors)} in ${c.projectId}`).join(" and ")} for ${monthOnly(m.month)}`));
  const overlaps = rows
    .filter((m) => m.pools.length > 1)
    .map((m) => {
      const both = m.pools.reduce((a, c) => a + c.contributors, 0) - m.uniqueContributors;
      return ` In ${monthOnly(m.month)}, ${n(both)} ${both === 1 ? "person appears" : "people appear"} in more than one pool, so the month has ${n(m.uniqueContributors)} unique contributors with a proposal row.`;
    })
    .join("");

  return (
    <section aria-labelledby="record-cycles" className="flex flex-col gap-3">
      <h2 id="record-cycles" className="text-lg font-semibold text-foreground">{cap1(word(total))} monthly cycles scored since July</h2>
      <p className="text-sm text-muted-foreground">
        Each month is frozen from the same scoring ledger into a file in the repository. Counts below come straight from those frozen files, so they do not move as the live window rolls.
      </p>
      <div className="overflow-x-auto">
        <Table label="Monthly cycles">
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead>Pools</TableHead>
              <TableHead className="text-right">Merged PRs</TableHead>
              <TableHead className="text-right">Accepted reviews</TableHead>
              <TableHead className="text-right">Contributors</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Record</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>July 2026</TableCell>
              <TableCell>eliza</TableCell>
              <TableCell className="text-right font-mono text-xs">4,766</TableCell>
              <TableCell className="text-right font-mono text-xs">14</TableCell>
              <TableCell className="text-right font-mono text-xs">25</TableCell>
              <TableCell>Trial, proposal never approved</TableCell>
              <TableCell><ExternalLink href={`${ARCHIVE}cycles/eliza/2026-07`}>cycles/eliza/2026-07</ExternalLink></TableCell>
            </TableRow>
            <TableRow>
              <TableCell>August 2026</TableCell>
              <TableCell>eliza, asi</TableCell>
              <TableCell className="text-right font-mono text-xs">5,588</TableCell>
              <TableCell className="text-right font-mono text-xs">2,674</TableCell>
              <TableCell className="text-right font-mono text-xs">108 + 26</TableCell>
              <TableCell>Sent, 72 transfers</TableCell>
              <TableCell><ExternalLink href="https://github.com/SlopDotCash/slopdotcash/tree/main/funding/preparations">funding/preparations</ExternalLink></TableCell>
            </TableRow>
            {rows.map((m) => {
              const pools = byContributors(m.pools);
              return (
                <TableRow key={m.month}>
                  <TableCell>{monthName(m.month)}</TableCell>
                  <TableCell>{pools.map((c) => c.projectId).join(", ")}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{n(m.counts?.merged ?? 0)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{n(m.counts?.reviews ?? 0)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{pools.map((c) => n(c.contributors)).join(" + ")}</TableCell>
                  <TableCell>{monthState(pools, now)}</TableCell>
                  <TableCell>
                    {pools.map((c, i) => (
                      <span key={c.projectId}>
                        {i > 0 ? ", " : null}
                        <ExternalLink href={`${ARCHIVE}cycles/${c.projectId}/${m.month}`}>{`${c.projectId}/${m.month}`}</ExternalLink>
                      </span>
                    ))}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Counted once per calendar month (July 1 to {lastDay(last)}), the {word(total)} cycles hold <strong className="text-foreground">{n(merged)} merged pull requests</strong> and <strong className="text-foreground">{n(reviews)} accepted reviews</strong>; the table rows overlap by a few days at each boundary because every cycle scores a 35-day window. Contributors are listed per pool: {perPool.join(", ")}.{overlaps} August asi reviews are the pool&apos;s scored events minus its scored merges. Review scoring was barely live in July, which is why that row is low.
      </p>
    </section>
  );
}

function Money({ record }: { record: PublicRecord }) {
  const M = record.money;
  const settlements = M.settlements ?? [];
  const paidMonthList = [...new Set(M.pools.map((p) => p.month).concat(settlements.map((x) => x.month)))].sort().map(monthName);
  const paidMonths = paidMonthList.length > 2 ? `${paidMonthList[0]} to ${paidMonthList[paidMonthList.length - 1]}` : paidMonthList.join(" and ");

  return (
    <section aria-labelledby="record-money" className="flex flex-col gap-3">
      <h2 id="record-money" className="text-lg font-semibold text-foreground">Money that has reached contributors</h2>
      <p className="text-sm text-muted-foreground">
        USDC transfers on Solana mainnet, finalized on chain, for{" "}
        {settlements.length > 0 ? `${paidMonths}; August was sent directly, later months through the verified settlement flow` : "the August 2026 contribution month"}. Every signature is published in the repository and reconciled row by row against the frozen preparation for each pool.
      </p>
      <div className="overflow-x-auto">
        <Table label="Monthly cycles">
          <TableHeader>
            <TableRow>
              <TableHead>Pool</TableHead>
              <TableHead className="text-right">Cap</TableHead>
              <TableHead className="text-right">Allocated</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Transfers</TableHead>
              <TableHead className="text-right">Unclaimed</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Record</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {M.pools.map((p) => (
              <TableRow key={`${p.projectId}-${p.month}`}>
                <TableCell><strong className="text-foreground">{p.projectId}</strong> <span className="text-xs text-muted-foreground">{p.month}</span></TableCell>
                <TableCell className="text-right font-mono text-xs">{usd(p.capUsdc)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{usd(p.allocatedUsdc)}</TableCell>
                <TableCell className="text-right font-mono text-xs font-semibold">{usd(p.paidUsdc)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{p.transfers} of {p.rows} rows</TableCell>
                <TableCell className="text-right font-mono text-xs">{usd(p.unclaimedUsdc)} ({p.unclaimedRows})</TableCell>
                <TableCell>{p.firstAt ? day(p.firstAt) : ""}</TableCell>
                <TableCell>
                  <ExternalLink href={`${ARCHIVE_BLOB}disclosures/${p.file || `${p.projectId}-${p.month}-direct-payments.json`}`}>JSON</ExternalLink>
                  {p.exampleSignature ? (
                    <>
                      {" · "}
                      <ExternalLink href={`https://solscan.io/tx/${p.exampleSignature}`}>example tx</ExternalLink>
                    </>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {settlements.map((x) => (
              <TableRow key={`settled-${x.projectId}-${x.month}`}>
                <TableCell><strong className="text-foreground">{x.projectId}</strong> <span className="text-xs text-muted-foreground">{x.month}</span></TableCell>
                <TableCell className="text-right font-mono text-xs">{x.capUsdc === null ? "" : usd(x.capUsdc)}</TableCell>
                <TableCell className="text-right" />
                <TableCell className="text-right font-mono text-xs font-semibold">{usd(x.paidUsdc)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{x.transfers}</TableCell>
                <TableCell className="text-right" />
                <TableCell>{day(x.settledAt)}</TableCell>
                <TableCell>
                  <ExternalLink href={`${ARCHIVE}cycles/${x.projectId}/${x.month}`}>settlement</ExternalLink>{" "}
                  <span className="text-xs text-ok">verified</span>
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell><strong className="text-foreground">Total</strong></TableCell>
              <TableCell />
              <TableCell className="text-right font-mono text-xs">{usd(M.allocatedUsdc)}</TableCell>
              <TableCell className="text-right font-mono text-xs font-semibold">{usd(M.paidUsdc)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{M.transfers}</TableCell>
              <TableCell className="text-right font-mono text-xs">{usd(M.unclaimedUsdc)}</TableCell>
              <TableCell />
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        <p>
          <strong className="text-foreground">How the August transfers were sent.</strong> The project creator signed and broadcast these transfers directly from the project&apos;s own wallet. Slop held no funds and no keys for these transfers. They went out before any month had run through Slop&apos;s own payment flow, so the repository records them as <code className="font-mono text-xs">sent-outside-verified-flow</code>, with a reconciliation that found zero unmatched transfers and no row with a registered wallet above the $2.00 minimum left unpaid.
          {settlements.length > 0 ? null : (
            <>
              {" "}Payouts now run from project vaults instead: contracts that each project&apos;s owner funds. In that flow Slop holds a fee key, an identity attester key and contract upgrade keys. The <a href="/sponsors" className="text-primary underline underline-offset-4">Fund a project page</a> says what each one can do.
            </>
          )}
        </p>
        <p>
          {usd(M.unclaimedUsdc)} of the {usd(M.allocatedUsdc)} allocated across the August pools is unclaimed. Unclaimed amounts belong to contributors who had not registered a payout wallet when the month was frozen.
          {M.platformFeeCollected ? null : " No platform fee was collected on the August pools."}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Each month in which a project sends money from its vault to outside contributors gets its own public receipt, with every recipient and transaction: <a href="/receipts" className="text-primary underline underline-offset-4">slop.cash/receipts</a>.
      </p>
    </section>
  );
}

function Pools({ record }: { record: PublicRecord }) {
  const pr = record.proposal;
  return (
    <section aria-labelledby="record-pools" className="flex flex-col gap-3">
      <h2 id="record-pools" className="text-lg font-semibold text-foreground">Pools</h2>
      <div className="overflow-x-auto">
        <Table label="Monthly cycles">
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Repository</TableHead>
              <TableHead className="text-right">Monthly cap</TableHead>
              <TableHead>Rail</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {record.projects.map((p) => (
              <TableRow key={p.id}>
                <TableCell><strong className="text-foreground">{p.name}</strong></TableCell>
                <TableCell>
                  {p.repository ? <ExternalLink href={p.repository}>{p.repository.replace("https://github.com/", "")}</ExternalLink> : null}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {p.kind === "external-prize-share" ? <ExternalLink href={p.prize || "#"}>external prize</ExternalLink> : p.capDisplay || ""}
                </TableCell>
                <TableCell>{p.chain ? (CHAIN_NAMES[p.chain] ?? p.chain) : p.kind === "external-prize-share" ? "prize share" : ""}</TableCell>
                <TableCell>
                  {p.status}{" "}
                  <span className="text-xs text-muted-foreground">
                    {p.authority === "verified" ? "authority verified" : `authority ${p.authority || "unverified"}`}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        First frozen proposal: <strong className="text-foreground">{pr.projectId} {pr.cycleId}</strong>, {pr.allocations} proposed allocations under a {usd(pr.capUsdc)} cap, generated {day(pr.generatedAt)}. State <code className="font-mono text-xs">{pr.status}</code>, approved {usd(pr.approvedUsdc)}. Proposed is not approved, and approved is not paid. <a href="/cycles" className="text-primary underline underline-offset-4">slop.cash/cycles</a>
      </p>
    </section>
  );
}

function Sources() {
  return (
    <section aria-labelledby="record-sources" className="flex flex-col gap-2 text-sm text-muted-foreground">
      <h2 id="record-sources" className="text-lg font-semibold text-foreground">Where the numbers come from</h2>
      <ul className="list-disc space-y-1.5 pl-5">
        <li><ExternalLink href={`${ARCHIVE}disclosures`}>disclosures/</ExternalLink> in the Slop repository: one JSON record per pool for transfers sent outside the verified flow (August 2026), each row bound to a Solana signature.</li>
        <li><ExternalLink href={`${ARCHIVE}cycles`}>cycles/</ExternalLink>: frozen proposals, their review windows, and verified settlements, as of the last repository commit that held them.</li>
        <li><a href="/api/v1/projects" className="text-primary underline underline-offset-4">slop.cash/api/v1/projects</a>: the project registry. Each change is an append-only revision.</li>
        <li><a href="/api/v1/payments/vault-payments" className="text-primary underline underline-offset-4">slop.cash/api/v1/payments/vault-payments</a>: finalized vault payments, the source of each <a href="/receipts" className="text-primary underline underline-offset-4">receipt</a>.</li>
      </ul>
      <p className="text-xs text-muted-foreground">
        Slop rebuilds this record from these sources with every site release and publishes it as <a href={RECORD_DATA_PATH} className="text-primary underline underline-offset-4">slop.cash{RECORD_DATA_PATH}</a>.
      </p>
    </section>
  );
}

export function RecordPage({ runtime }: { runtime: PageRuntime }) {
  const state = useOnce(runtime, "public-record", () => loadPublicRecord());
  const now = useNow();
  return (
    <PageShell width="lg" gap="8">
      <PageHeader title="Slop Cash, by the public record." />
      <p className="text-sm text-muted-foreground">
        Built from slop.cash&apos;s own public data and the public Slop repository on GitHub with every site release. Every number links back to its source.
      </p>
      {state.status === "running" ? (
        <Spinner label="Loading the record" />
      ) : state.status === "failed" ? (
        <Alert variant="destructive" action={<Button variant="outline" size="sm" onClick={() => retryOnce(runtime, "public-record")}>Retry</Button>}>
          The public record could not be loaded. Please try again shortly.
        </Alert>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Rebuilt {when(state.value.builtAt)}</p>
          <Money record={state.value} />
          {state.value.months ? <Cycles months={state.value.months} now={now} /> : null}
          <Pools record={state.value} />
        </>
      )}
      <Sources />
    </PageShell>
  );
}
