// spec/frontend/routes.md, "Each route has one title, canonical and index policy, and private routes never name a private identifier"
import { ExternalLink } from "@repo/ui";
import type { TermsPage } from "./terms.ts";

export const octoberAllocation: TermsPage = {
  title: "October contributor allocation",
  stamp: "Terms set 11 November 2026. Status updated 18 November 2026.",
  status: (
    <>
      <p>
        <strong>Status: not approved.</strong> SLOP holders decided this
        proposal in a one-day decision market on Umia, 16 November 2026, 17:00
        UTC to 17 November 2026, 17:00 UTC, and it resolved to Do Nothing:{" "}
        <ExternalLink href="https://app.umia.finance/p/slop-cash/market/october-contributor-allocation">
          the market on Umia
        </ExternalLink>
        .
      </p>
      <p>
        No SLOP moved from the treasury, and no October allocation will be sent.
        The 30 September Contributors list is unchanged. Any later allocation
        would need a new holder decision; none is filed.
      </p>
    </>
  ),
  body: (
    <>
      <h2>What this is</h2>
      <p>
        Slop Cash set its Contributors distribution (2,000,000 SLOP) from a
        snapshot on 30 September 2026. That list is published and does not
        change. People who began contributing in October are not on it.
      </p>
      <p>
        This proposal asked holders whether to recognise October work with a
        second, smaller allocation of 1,000,000 SLOP (1% of supply) from the
        treasury's ecosystem and contributor programs reserve, which can be
        released only by a decision market.
      </p>
      <p>
        The first distribution is not reduced, re-split or delayed. Tokens from
        it that are not claimed by 8 February 2027 return to the treasury as
        already published.
      </p>

      <h2>Who would receive it</h2>
      <ul>
        <li>
          GitHub accounts with at least one accepted pull request or accepted
          review on a Slop-listed repository between 1 October 2026 00:00 UTC
          and 31 October 2026 23:59 UTC, as recorded in Slop's public
          contribution record.
        </li>
        <li>About 190 accounts on the record published 11 November 2026.</li>
        <li>The founders' accounts are excluded.</li>
        <li>
          Accounts the S.P. identifies as farming volume are removed before the
          list is published.
        </li>
        <li>
          Being on the first list does not exclude an account. October work
          counts for this allocation; earlier work does not.
        </li>
      </ul>

      <h2>How it is split</h2>
      <ul>
        <li>
          Every eligible account receives a base amount. The rest is weighted by
          accepted October work in the record, so more work receives more.
        </li>
        <li>
          No account receives more than 10% of the allocation (100,000 SLOP).
        </li>
        <li>
          The S.P. publishes the full list, every account and amount, before any
          transfer. The list states the date of the record it was built from.
        </li>
      </ul>

      <h2>How the tokens are delivered</h2>
      <ul>
        <li>
          Each recipient registers a Robinhood Chain wallet on{" "}
          <a href="/earnings">slop.cash Payouts</a>. The deadline is the
          same as the first distribution: 8 February 2027, 17:00 UTC.
        </li>
        <li>
          The S.P. sends in batches from{" "}
          <span className="font-mono text-xs break-all">
            0xbCA4736F59d03F07cFac9415A5936fECb06b2eA7
          </span>{" "}
          to registered wallets and publishes each transaction.
        </li>
        <li>Tokens are unlocked on receipt.</li>
        <li>
          Any part of the 1,000,000 SLOP not sent once the final batch is
          recorded goes back to the treasury at{" "}
          <span className="font-mono text-xs break-all">
            0x96028De971a9D37404F5030F6284b40640E2D1a2
          </span>
          .
        </li>
        <li>
          There is nothing to apply for. Nobody from Slop Cash will message you
          about this allocation.
        </li>
      </ul>

      <h2>What passing does and does not do</h2>
      <ul>
        <li>
          Passing moves 1,000,000 SLOP from the treasury to the S.P. operating
          wallet. Nothing else.
        </li>
        <li>It does not change the first Contributors distribution.</li>
        <li>
          It creates no continuing program. Work after 31 October is not
          covered, and any later allocation would need its own proposal.
        </li>
      </ul>

      <h2>Risks</h2>
      <ul>
        <li>
          The receiving address is an ordinary wallet controlled by the S.P.'s
          Operator, not a contract. Holders rely on the S.P. to send according
          to the published list and to return the remainder.
        </li>
        <li>
          October activity was concentrated. Before the cap, the ten most active
          accounts account for more than half of recorded October work, and much
          of it was produced by AI coding agents at high volume. The 10% cap and
          the removal of farming accounts limit this; they do not remove it.
        </li>
        <li>
          Slop's review of how October work is sized is not finished, and one
          project's record ends early on 31 October. The list is built from the
          record as published on a stated date and is not rebuilt afterwards.
        </li>
        <li>
          Up to 1,000,000 SLOP becomes freely transferable as batches go out.
        </li>
      </ul>

      <h2>Changes</h2>
      <p>
        If the terms change before the market opens, this page is updated first
        and the date at the top changes. Once the market is open the terms do
        not change.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href="mailto:hello@slop.cash">hello@slop.cash</a>.
      </p>
    </>
  ),
  links: (
    <>
      <a href="/">slop.cash</a> ·{" "}
      <a href="/record">Slop Cash live record</a> ·{" "}
      <a href="/referrals">Referral terms</a> ·{" "}
      <ExternalLink href="https://app.umia.finance/p/slop-cash">
        SLOP on Umia
      </ExternalLink>
    </>
  ),
};
