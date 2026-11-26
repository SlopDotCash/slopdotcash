// spec/points/scoringPolicy.md, "A scored source records its provenance and keeps the 10-Point minimum"; spec/frontend/projections.md, "Payment states keep award, funding and settlement apart"; spec/frontend/vaultLocks.md, "A lock covers its count of months from the vault's current month, and an unreserved month is releasable from 00:00 UTC on the 4th of the second month after it"; spec/settlement/maintainerShare.md, "The share is a floor of the monthly amount and is split by decisions with ties to the lower account"; spec/backend/submissionFeeTerms.md, "The submission fee terms are published constants that change only by a reviewed change"; spec/security/reportDeposit.md, "A paid deposit is sent back on a first response and kept only after a keeping close stood seven days"
import { defaultMinor, keepFeeLabel, keptAfterClosedDays, refundUndecidedDays, stableDecimals } from "@repo/backend/client";
import { REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS, REPORT_DEPOSIT_REFUND_SILENT_DAYS, REPORT_DEPOSIT_SWITCHED_ON, REPORT_DEPOSIT_USD_MINOR } from "@repo/security/client";
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { ExternalLink, PageHeader } from "@repo/ui";
import { Ban, BookOpen, CalendarCheck, CircleSlash, FolderPlus, GitPullRequest, HandCoins, ListChecks, type LucideIcon, Search, ShieldCheck, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { wantedLabelName } from "../../../gen/backend__mergeActivity.ts";
import { maxShareBasisPoints } from "../../../gen/settlement__maintainerShare.ts";
import { pageShellClass } from "../../app/PageShell.tsx";
import { Milestones, PaymentLifecycle, payoutTimeline } from "./PaymentLifecycle.tsx";
import { ContributionPointTiers, PenaltyPointTable, pointsNotice } from "./PointsRules.tsx";

const link = "text-primary underline underline-offset-4 hover:decoration-2";

interface PathStep {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly href?: string;
  readonly body?: ReactNode;
}

function Path({ id, title, steps }: { id: string; title: string; steps: ReadonlyArray<PathStep> }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-xl font-semibold text-foreground">
        {title}
      </h2>
      <ol className="flex flex-col gap-4">
        {steps.map(({ icon: Icon, title: step, href, body }) => (
          <li key={step} className="flex gap-3">
            <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="flex flex-col gap-1">
              <strong className="font-semibold text-foreground">
                {href ? (
                  <a className={link} href={href}>
                    {step}
                  </a>
                ) : (
                  step
                )}
              </strong>
              {body ? <p className="text-muted-foreground">{body}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Explained({ id, title, children, aside }: { id?: string; title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {children}
      </div>
      {aside}
    </section>
  );
}

function Answer({ question, children }: { question: string; children: ReactNode }) {
  return (
    <article className="flex flex-col gap-2">
      <h3 className="font-semibold text-foreground">{question}</h3>
      <div className="flex flex-col gap-2 text-muted-foreground">{children}</div>
    </article>
  );
}

const contributorSteps: ReadonlyArray<PathStep> = [
  {
    icon: Search,
    title: "1. Choose work",
    body: (
      <>
        <a className={link} href="/">
          Use the contributor skill
        </a>{" "}
        to find unblocked work.
      </>
    ),
  },
  { icon: GitPullRequest, title: "2. Submit a PR" },
  { icon: ShieldCheck, title: "3. Maintainer review" },
  { icon: Wallet, title: "4. Points and payout", href: "/earnings" },
];

const maintainerSteps: ReadonlyArray<PathStep> = [
  {
    icon: FolderPlus,
    title: "1. Add or resume",
    body: (
      <>
        <a className={link} href="/?audience=maintainer">
          Use the maintainer skill
        </a>
        .
      </>
    ),
  },
  { icon: ShieldCheck, title: "2. Get ready", body: "GitHub access. Free Slopbot. Admission." },
  { icon: ListChecks, title: "3. Maintain your project", body: "PRs, CI, rules and private reports." },
  {
    icon: Wallet,
    title: "4. Manage rewards",
    body: (
      <>
        Funding is optional. Adjust allocations before the{" "}
        <a className={link} href="#payments">
          monthly cutoff
        </a>
        .
      </>
    ),
  },
];

const submissionFee = defaultMinor / 10 ** stableDecimals;
const depositSize = `a refundable deposit of about ${formatBaseUnits({ value: BigInt(REPORT_DEPOSIT_USD_MINOR), decimals: 6 })} US dollars of SLOP on Robinhood Chain`;
const depositAsked = REPORT_DEPOSIT_SWITCHED_ON
  ? `Yes, unless the project's owner turned it off. A private report filed through Slop needs ${depositSize}.`
  : `Not yet. Slop has not switched the deposit on. Once it is on, a private report filed through Slop needs ${depositSize}, unless the project's owner turned it off.`;

const formula = ["Your points", "÷", "Project points", "×", "Funded pool", "=", "Your share"];

/** How Slop works: the contributor and maintainer paths, Points, penalties, payment stages and questions. */
export function HowItWorksPage() {
  return (
    <main className={pageShellClass("lg", "12")}>
      <PageHeader title="How Slop works" icon={<BookOpen className="size-6 text-primary" />} />
      <div className="grid gap-10 lg:grid-cols-2">
        <Path id="contributor-path" title="For contributors" steps={contributorSteps} />
        <Path id="maintainer-path" title="For maintainers" steps={maintainerSteps} />
      </div>
      <Explained id="points" title="Points" aside={<ContributionPointTiers />}>
        <p className="text-muted-foreground">Min 10 points per accepted merge.</p>
      </Explained>
      <Explained id="penalties" title="Penalties" aside={<PenaltyPointTable />} />
      <Explained
        title="Example allocation"
        aside={
          <dl aria-label="Example projected allocation" className="grid gap-3 rounded-lg border border-border p-6">
            {[
              ["Accepted share", "270 ÷ 900 = 30%"],
              ["Funded pool", "$5,000"],
              ["Projected allocation", "30% × $5,000 = $1,500"],
            ].map(([term, value]) => (
              <div key={term} className="flex flex-wrap items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">{term}</dt>
                <dd className="font-mono font-medium tabular-nums text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        }
      />
      <section className="flex flex-col gap-4">
        <h2 id="payments" className="text-xl font-semibold text-foreground">
          Payment stages
        </h2>
        <p className="text-muted-foreground">
          Funded awards pay automatically 72 h after month end unless the owner turned this off. Awards without a wallet stay reserved. A cut needs a public reason and 24 h notice.
        </p>
        <PaymentLifecycle />
      </section>
      <section id="faq" aria-labelledby="faq-title" className="flex flex-col gap-6">
        <h2 id="faq-title" className="text-xl font-semibold text-foreground">
          Questions
        </h2>
        <div className="grid gap-8 lg:grid-cols-2">
          <Answer question="What work can I contribute?">
            <p>
              Any unblocked work in an active{" "}
              <a className={link} href="/#projects">
                project
              </a>
              . No claim needed.
            </p>
          </Answer>
          <Answer question="When will my work show up?">
            <p>At the next site update.</p>
          </Answer>
          <Answer question="How do points work?">
            <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
              {formula.map((part, index) => (
                <span key={part} className={index % 2 === 1 ? "text-muted-foreground" : index === formula.length - 1 ? "text-primary" : undefined}>
                  {part}
                </span>
              ))}
            </p>
            <ul className="flex flex-col gap-2">
              <li className="flex items-center gap-2">
                <CalendarCheck aria-hidden className="size-4 shrink-0" />
                Counts in its own UTC month
              </li>
              <li className="flex items-center gap-2">
                <Ban aria-hidden className="size-4 shrink-0" />
                No carryover into a later pool
              </li>
              <li className="flex items-center gap-2">
                <HandCoins aria-hidden className="size-4 shrink-0" />
                <span>
                  Owner decides funding · <a className={link} href="/earnings">Payouts</a>
                </span>
              </li>
              <li className="flex items-center gap-2">
                <CircleSlash aria-hidden className="size-4 shrink-0" />
                {pointsNotice}
              </li>
            </ul>
          </Answer>
          <Answer question="When are payouts sent?">
            <Milestones label="Monthly payout timeline" milestones={payoutTimeline} />
          </Answer>
          <Answer question="Can maintainers be paid?">
            <p>
              Yes, when a project sets a maintainer share. The owner can set aside up to {maxShareBasisPoints / 100}% of the monthly amount for the people who merge or close pull requests from outside contributors. It is split by how many each decided, and a close counts the same as a merge. Owners set it on the project&apos;s manage page, and a change starts with the next UTC month. In a month with no such decision, the whole amount stays with contributors.
            </p>
          </Answer>
          <Answer question="Is there a fee to open a pull request?">
            <p>
              Only on a project whose owner turned on the refundable submission fee. There, Slopbot comments once on a pull request from an outside contributor with a link to its pay page on slop.cash, and holds its review until the fee is recorded. The fee is {submissionFee} USDC on Base or {submissionFee} USDG on Robinhood Chain unless the owner set another amount, or the same fee in SLOP on Robinhood Chain at half the price. It is a deposit: a merge sends it back, and so do {refundUndecidedDays} days without a maintainer decision. A pull request closed without a merge for {keptAfterClosedDays} days keeps it: a stablecoin fee goes to Slop and a SLOP fee is burned. A pull request for an issue labelled {wantedLabelName} is the exception: it is sent back unless a maintainer marks it with {keepFeeLabel}. An unpaid pull request is never closed for that reason, the fee does not buy a merge and scoring does not read it. Pay only through the page linked in Slopbot&apos;s own comment.
            </p>
          </Answer>
          <Answer question="Is there a deposit to file a security report?">
            <p>
              {depositAsked} The report is stored at once and screened once the deposit is recorded; your Inbox shows the exact amount and links its pay page. The deposit is kept only if the report is closed as spam, as a duplicate or as out of scope and that close stands for {REPORT_DEPOSIT_KEPT_AFTER_CLOSED_DAYS} days with no open appeal: it is then sent to the burn address, so neither Slop nor the project receives it. It is sent back to the wallet that paid when the report gets its first response that is not one of those closes, or after {REPORT_DEPOSIT_REFUND_SILENT_DAYS} days with no response, or when the owner turns the deposit off. A report is never closed or deleted for an unpaid deposit. The deposit is public on chain and shows the wallet that paid, not the project or the report. Pay only through the page linked in your Inbox.
            </p>
          </Answer>
          <Answer question="GitHub flagged my account. What happens to my work?">
            <p>
              Appeal to GitHub (
              <ExternalLink className={link} href="https://support.github.com/contact/flagged">
                flagged account form
              </ExternalLink>
              ). Keep the same account.
            </p>
          </Answer>
          <Answer question="How do I receive an award?">
            <p>
              Add a wallet in{" "}
              <a className={link} href="/account#wallets">
                Settings
              </a>
              . Track it in{" "}
              <a className={link} href="/earnings">
                Payouts
              </a>
              .
            </p>
          </Answer>
          <Answer question="What does projected mean? Is the pool funded?">
            <p>An estimate at the cap, not a balance.</p>
          </Answer>
          <Answer question="Can the owner take this month's pool back?">
            <p>
              When an owner locks a month in the project vault, that month&apos;s pool is locked in the vault until it is paid out: the vault contract refuses to withdraw it, and it can be paid even if the owner turns automatic payment off. The owner can still lower an individual contributor&apos;s amount before the cutoff, with a public reason. A locked month that is never reserved for payout can be released back to the owner&apos;s free funds from the 4th of the second month after it, by a transaction anyone can send; the project&apos;s manage page offers it. Without a lock, Slop&apos;s pages refuse that withdrawal but the contract does not. Slop&apos;s upgrade key can still change the vault contract.
            </p>
          </Answer>
          <Answer question="Is there a standing deposit for regular contributors?">
            <p>
              Yes. A contributor can post one refundable SLOP deposit on Robinhood Chain worth $10 at Slop&apos;s published SLOP rate. While it stands, Slopbot does not ask the per pull request submission fee on a project that accepts standing deposits once you have had a pull request merged there.{" "}
              <a className={link} href="/deposit">
                Standing deposit
              </a>
            </p>
          </Answer>
          <Answer question="Where can I see public payout receipts?">
            <p>
              Every month in which a project sends money from its vault to outside contributors has a public receipt naming each recipient and transaction on{" "}
              <a className={link} href="/receipts">
                Receipts
              </a>
              , and the full monthly history lives on the{" "}
              <a className={link} href="/record">
                public record
              </a>
              .
            </p>
          </Answer>
          <Answer question="Is there a referral program?">
            <p>
              Yes. You can refer a project today: sign in on slop.cash once, then send its maintainer <code className="font-mono">slop.cash/r/</code> followed by your GitHub login. The referral is recorded when the project lists. A referrer receives SLOP only after a project they brought in has paid its contributors.{" "}
              <a className={link} href="/referrals">
                Referral terms
              </a>
            </p>
          </Answer>
          <Answer question="Does Slop buy back SLOP?">
            <p>
              The buyback is configured live since 12 November 2026. Half of eligible fee income funds SLOP purchases on Robinhood Chain once minimum order sizes are met. Half of the SLOP acquired is allocated to burning. The first verified bridge fill, purchase and burn are still pending. Funding comes from fees, not the treasury, and nothing is guaranteed.{" "}
              <a className={link} href="/buyback">
                How the buyback works
              </a>
            </p>
          </Answer>
        </div>
      </section>
    </main>
  );
}
