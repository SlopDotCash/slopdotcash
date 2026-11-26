// spec/frontend/routes.md, "Each route has one title, canonical and index policy, and private routes never name a private identifier"
import { ExternalLink } from "@repo/ui";
import type { TermsPage } from "./terms.ts";

export const sponsoredPools: TermsPage = {
  title: "Sponsored pools",
  stamp: "Terms set 18 November 2026. Status updated 18 November 2026.",
  status: (
    <>
      <p>
        <strong>
          Status: open for entries. Nothing is funded or approved.
        </strong>{" "}
        Maintainers can enter their repos now. No amount is set for any repo,
        and no holder vote is scheduled yet.
      </p>
      <p>
        When a vote is scheduled, its date and the link to the market will be on
        this page.
      </p>
    </>
  ),
  body: (
    <>
      <h2>What a sponsored pool is</h2>
      <p>
        On Slop Cash a project funds a monthly pool, contributors send pull
        requests, and the pool is split each month among the people whose work
        the maintainers accepted. Work that is not merged counts for nothing.
      </p>
      <p>
        A sponsored pool is one where the Slop Cash treasury puts up the money
        instead of the project. SLOP holders choose which repos are sponsored in
        a{" "}
        <ExternalLink href="https://app.umia.finance/p/slop-cash">
          decision market on Umia
        </ExternalLink>
        . Nothing is funded unless that market passes.
      </p>

      <h2>Who can enter</h2>
      <ul>
        <li>A public repo with an open-source licence.</li>
        <li>It already merges pull requests from outside contributors.</li>
        <li>It has no ban on AI-assisted contributions.</li>
        <li>
          It is entered by one of its maintainers, with admin rights on the
          repo.
        </li>
      </ul>
      <p>
        Repos run by Slop Cash's founders, or by a company a founder is a
        partner in, are left out of the first round.
      </p>

      <h2>How to enter</h2>
      <ol>
        <li>
          List your repo at{" "}
          <a href="/projects/new">slop.cash/projects/new</a>. Listing is
          free. When the setup asks you to install Slopbot, choose "Only select
          repositories" and pick this repo.
        </li>
        <li>
          Email <a href="mailto:hello@slop.cash">hello@slop.cash</a> with the
          link to your project's page on slop.cash, and say whether we may name
          your repo publicly.
        </li>
      </ol>
      <p>
        Anyone can suggest a repo, but only its maintainers can enter it. A
        suggestion is a reason for us to write to them.
      </p>

      <h2>What maintainers get</h2>
      <ul>
        <li>
          A funded monthly pool that pays outside contributors for merged work
          on your repo, with no money from you.
        </li>
        <li>
          A maintainer share, if you set one. A project can direct up to 30% of
          its monthly pool to the people who merge or close outside pull
          requests. You set it on your project's manage page, under Monthly
          rewards, and it starts with the next month.
        </li>
        <li>
          Free Slopbot review of new pull requests, and a setting that caps how
          many outside pull requests the project takes at once.
        </li>
        <li>
          A place on the slop.cash home page and in the project list that
          contributors' agents read, for as long as the pool is funded.
        </li>
      </ul>
      <p>
        You are never required to merge anything. You decide what is accepted,
        as you do today.
      </p>

      <h2>What happens after you enter</h2>
      <ul>
        <li>We check each entry against the list above.</li>
        <li>
          A repo is named in our posts, in any poll and in the proposal only
          after its maintainer has said yes.
        </li>
        <li>
          The finalists go into one decision market, beside an outcome that
          funds nothing. The proposal states the repos, the amount for each and
          how many months it covers.
        </li>
        <li>
          Holders trade the outcomes. A funding outcome has to finish above the
          do-nothing outcome by the market's threshold, which was 2% in earlier
          Slop Cash markets.
        </li>
      </ul>

      <h2>If your repo is funded</h2>
      <ul>
        <li>
          You create the project's vault on your manage page, which takes a
          couple of minutes. You own the vault.
        </li>
        <li>
          Slop Cash deposits into it one month at a time. The treasury holds
          USDG on Robinhood Chain, so pools are expected to be funded in USDG
          there.
        </li>
        <li>
          A month counts as funded when the vault holds its amount at the start
          of that UTC month, on top of anything still to be paid for the month
          before.
        </li>
        <li>
          After each month ends, the pool is split among contributors with
          accepted work, and your maintainer share if you set one. Slop Cash
          deducts a 2% fee from each payout.
        </li>
        <li>
          Sponsorship runs for the number of months in the proposal and then
          ends. Continuing it would need a new holder decision or your own
          funding.
        </li>
        <li>
          Withdrawing sponsored funds from the vault ends the sponsorship.
        </li>
      </ul>

      <h2>What to know before entering</h2>
      <ul>
        <li>
          Entering is not a promise of funding. Holders may choose to fund
          nothing.
        </li>
        <li>
          A funded pool attracts pull requests, many of them written with AI
          agents. The intake cap and Slopbot review are there for that, and the
          maintainer share pays for the time it takes.
        </li>
        <li>
          Payouts run from the project's vault contract. Slop Cash holds the
          upgrade keys for these contracts and the key that confirms
          contributors' payout wallets.
        </li>
        <li>
          Contributors need a wallet registered on slop.cash for the chain the
          pool is on. An amount set aside for someone without one waits for
          them.
        </li>
      </ul>

      <h2>Changes</h2>
      <p>
        If these terms change, this page is updated first and the date at the
        top changes.
      </p>

      <h2>Contact</h2>
      <p>
        Entries and questions:{" "}
        <a href="mailto:hello@slop.cash">hello@slop.cash</a>.
      </p>
    </>
  ),
  links: (
    <>
      <a href="/">slop.cash</a> ·{" "}
      <a href="/record">Slop Cash live record</a> ·{" "}
      <a href="/receipts">Receipts</a> ·{" "}
      <a href="/referrals">Referral program</a> ·{" "}
      <ExternalLink href="https://app.umia.finance/p/slop-cash">
        SLOP on Umia
      </ExternalLink>
    </>
  ),
};
