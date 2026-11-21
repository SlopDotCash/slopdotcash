// spec/points/scoringPolicy.md, "A scored source records its provenance and keeps the 10-Point minimum"; spec/frontend/projections.md, "Payment states keep award, funding and settlement apart"; spec/frontend/vaultLocks.md, "A lock covers its count of months from the vault's current month, and an unreserved month is releasable from 00:00 UTC on the 4th of the second month after it"
import { ExternalLink, PageHeader } from "@repo/ui";
import { Ban, BookOpen, CalendarCheck, CircleSlash, GitPullRequest, HandCoins, ListChecks, type LucideIcon, Search, ShieldCheck, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { Milestones, PaymentLifecycle, payoutTimeline } from "./PaymentLifecycle.tsx";
import { ContributionPointTiers, PenaltyPointTable, pointsNotice } from "./PointsRules.tsx";

const link = "text-primary underline underline-offset-4 hover:decoration-2";

interface PathStep {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: ReactNode;
}

function Path({ id, title, steps }: { id: string; title: string; steps: ReadonlyArray<PathStep> }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-xl font-semibold text-foreground">
        {title}
      </h2>
      <ol className="flex flex-col gap-4">
        {steps.map(({ icon: Icon, title: step, body }) => (
          <li key={step} className="flex gap-3">
            <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="flex flex-col gap-1">
              <strong className="font-semibold text-foreground">{step}</strong>
              <p className="text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Explained({ id, title, children, aside }: { id?: string; title: string; children: ReactNode; aside?: ReactNode }) {
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
        Find an active <a className={link} href="/#projects">project</a>, read its skill and choose unblocked work.
      </>
    ),
  },
  { icon: GitPullRequest, title: "2. Submit a PR", body: "Use any agent. Test the result and disclose the exact provider, model and client." },
  { icon: ShieldCheck, title: "3. Maintainer review", body: "Maintainers accept the work. Accepted work and useful reviews earn Points." },
  {
    icon: Wallet,
    title: "4. Points and payout",
    body: (
      <>
        Track points and funded awards in <a className={link} href="/earnings">Payouts</a>. <a className={link} href="#payments">Payment stages and timing</a>.
      </>
    ),
  },
];

const maintainerSteps: ReadonlyArray<PathStep> = [
  {
    icon: GitPullRequest,
    title: "1. Add a project",
    body: (
      <>
        <a className={link} href="/projects/new">Add your repository and contribution rules</a>. Install free Slopbot and complete the security checks.
      </>
    ),
  },
  {
    icon: Wallet,
    title: "2. Fund the pool",
    body: (
      <>
        Only funds in the project vault pay awards. Unused funds roll over. <a className={link} href="/sponsors">Funding options</a>
      </>
    ),
  },
  { icon: ListChecks, title: "3. Adjust awards", body: "Change proposed amounts within the cap before the monthly cutoff." },
  {
    icon: CalendarCheck,
    title: "4. Automatic payment",
    body: (
      <>
        Funded awards pay at the <a className={link} href="#payments">monthly cutoff</a> unless you turn automatic payment off.
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
        <p className="text-muted-foreground">
          Slopbot sizes each accepted pull request with the tiers in this table and awards points. Every accepted merge earns at least 10 points. Only accepted-work points count toward payouts. Joining and connecting X earn no points.
        </p>
      </Explained>
      <Explained id="penalties" title="Penalties" aside={<PenaltyPointTable />}>
        <p className="text-muted-foreground">
          Slopbot applies this one published penalty table. A debit reduces only that UTC month's accepted-work points and never takes it below zero. A debit never changes an approved, scheduled, or paid award. Maintainers and authors outside the closure scope receive no penalty.
        </p>
      </Explained>
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
      >
        <p className="text-muted-foreground">Your points ÷ project points × funded pool = projected allocation.</p>
      </Explained>
      <section className="flex flex-col gap-4">
        <h2 id="payments" className="text-xl font-semibold text-foreground">
          Payment stages
        </h2>
        <p className="text-muted-foreground">
          After each UTC month ends, the owner has 72 hours to adjust awards. A cut below the proposed amount needs a public reason, and the contributor gets 24 hours of notice before the month locks. When payments are enabled, the vault then pays funded awards automatically unless the owner turned this off. Awards without a wallet remain reserved.
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
              Choose unblocked work in an active <a className={link} href="/#projects">project</a> and follow its contribution rules. You do not need to claim an issue.
            </p>
            <p>
              Non-code work counts only on projects that opt in. The <a className={link} href="/projects/slopdotcash">Slop project</a> ran one round for October 2026: a tutorial, explainer, video, or support answer about Slop could receive a reviewed award of 1 to 8 points. That round closed on 28 October 2026. Check each project's current contribution rules before preparing non-code work.
            </p>
          </Answer>
          <Answer question="When will my work show up?">
            <p>Merged pull requests and their qualifying reviews appear at the next site update. There is no waiting period or minimum account age.</p>
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
              A flag is GitHub&apos;s restriction, not Slop&apos;s. Slop does not report accounts and cannot lift a flag. Appeal to GitHub through its{" "}
              <ExternalLink className={link} href="https://support.github.com/contact/flagged">
                flagged account form
              </ExternalLink>{" "}
              from the account&apos;s primary email.
            </p>
            <p>
              Keep the same account. Sign-in and wallet registration are tied to it, and a new account inherits nothing. If GitHub prevents Slop from verifying your account, Slop sign-in will fail. Your wallet registrations are unchanged. If GitHub hides your pull requests, merged work may be missing from the site. Once GitHub restores access, eligible work can appear again after a successful Slop collection and site update.
            </p>
          </Answer>
          <Answer question="How do I receive an award?">
            <p>
              Add a wallet for your award's network in <a className={link} href="/account#wallets">Account wallets</a>. Wallet confirmation requires your signature. Follow the award and its payment status in{" "}
              <a className={link} href="/earnings">Payouts</a>.
            </p>
          </Answer>
          <Answer question="What does projected mean? Is the pool funded?">
            <p>A live estimate at the project&apos;s cap. It is not a balance or a guarantee: a cap is a target, and only funds in the vault can be allocated. Funds added after a month freezes count toward later months.</p>
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
