// spec/points/scoringPolicy.md, "A scored source records its provenance and keeps the 10-Point minimum"; spec/frontend/projections.md, "Payment states keep award, funding and settlement apart"; spec/frontend/vaultLocks.md, "A lock covers its count of months from the vault's current month, and an unreserved month is releasable from 00:00 UTC on the 4th of the second month after it"
import { ExternalLink, PageHeader } from "@repo/ui";
import { Ban, BookOpen, CalendarCheck, CircleSlash, FolderPlus, GitPullRequest, HandCoins, ListChecks, type LucideIcon, Search, ShieldCheck, Wallet } from "lucide-react";
import type { ReactNode } from "react";
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

const formula = ["Your points", "÷", "Project points", "×", "Funded pool", "=", "Your share"];

/** How Slop works: the contributor and maintainer paths, Points, penalties, payment stages and questions. */
export function HowItWorksPage() {
  return (
    <main className="mx-auto flex w-full max-w-(--breakpoint-lg) flex-1 flex-col gap-12 px-4 py-8">
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
                <span key={`${part}-${index}`} className={index % 2 === 1 ? "text-muted-foreground" : index === formula.length - 1 ? "text-primary" : undefined}>
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
          <Answer question="Is there a referral program?">
            <p>
              Yes. You can refer a project today: sign in on slop.cash once, then send its maintainer <code className="font-mono">slop.cash/r/</code> followed by your GitHub login. The referral is recorded when the project lists. A referrer receives SLOP only after a project they brought in has paid its contributors.{" "}
              <ExternalLink className={link} href="https://record.slop.cash/referrals">
                Referral terms
              </ExternalLink>
            </p>
          </Answer>
          <Answer question="Does Slop buy back SLOP?">
            <p>
              The buyback is configured live since 12 November 2026. Half of eligible fee income funds SLOP purchases on Robinhood Chain once minimum order sizes are met. Half of the SLOP acquired is allocated to burning. The first verified bridge fill, purchase and burn are still pending. Funding comes from fees, not the treasury, and nothing is guaranteed.{" "}
              <ExternalLink className={link} href="https://record.slop.cash/buyback">
                How the buyback works
              </ExternalLink>
            </p>
          </Answer>
        </div>
      </section>
    </main>
  );
}
