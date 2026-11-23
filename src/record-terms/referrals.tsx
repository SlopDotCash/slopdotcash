/** /referrals: the project referral program terms. Edit the words here. */
import { Link } from "../Link";
import { ExternalLinkAnchor } from "../Presentation";
import type { TermsPage } from "./terms";

export const referrals: TermsPage = {
  title: "Project referral program",
  stamp: "Terms set 11 November 2026. Status updated 17 November 2026.",
  status: (
    <>
      <p>
        <strong>Status: funded and recording.</strong> SLOP holders approved
        funding this program in a{" "}
        <ExternalLinkAnchor href="https://app.umia.finance/p/slop-cash/market/referral-program-funding">
          decision market on Umia
        </ExternalLinkAnchor>{" "}
        that closed on 12 November 2026 at 15:00 UTC. The funding outcome
        finished 15.3% above the do-nothing outcome; it needed 2%.
      </p>
      <p>
        The 2,000,000 SLOP moved from the Slop Cash treasury to the referral
        contract the same day. Referrals can be named today, and since 12
        November 2026 Slop Cash keeps the monthly record of accruals, starting
        with November 2026. Referrals are tallied monthly, and the first tally
        comes after November closes. No referred project has paid its
        contributors yet, so nothing has accrued. Slop Cash turns on monthly
        posting once there is a month to distribute, not before: a live posting
        key with nothing to post only adds risk (see the risks below).
      </p>
    </>
  ),
  body: (
    <>
      <h2>What the program is for</h2>
      <p>
        Slop Cash pays open-source contributors from pools that projects fund.
        The program sets aside 2,000,000 SLOP (2% of supply) from the treasury's
        ecosystem allocation for the people who bring funded projects to Slop
        Cash. A referrer receives tokens only when a project they referred
        actually pays its contributors. A listing, a pledge or a funded vault
        that never pays produces nothing.
      </p>

      <h2>How a referral is recorded</h2>
      <ul>
        <li>
          When a maintainer lists a project on{" "}
          <Link href="/projects/new">slop.cash</Link>, they may name the account
          that referred it. A referral link fills this in for them.
        </li>
        <li>
          You can choose your own link name: open{" "}
          <a href="/referral">slop.cash/referral</a>, sign in and pick a name.
          Your link is then <code>slop.cash/referral/&lt;your name&gt;</code>.
        </li>
        <li>
          A link of the form <code>slop.cash/r/&lt;GitHub login&gt;</code> works
          too, with no setup.
        </li>
        <li>
          A chosen name only points to your GitHub account, and the referral is
          recorded against that account. Saving a new name stops your old link,
          and a name one account has used is never given to another.
        </li>
        <li>The referrer must be a signed-in slop.cash member.</li>
        <li>
          The record is fixed once the project is submitted and cannot be
          changed later.
        </li>
        <li>
          A project cannot refer itself, and its steward, Slop administrators
          and moderators cannot be named.
        </li>
      </ul>

      <h2>When tokens accrue</h2>
      <ul>
        <li>
          Only on a finalized contributor payout from the referred project,
          recorded as paid and confirmed on chain.
        </li>
        <li>
          Only payouts in the 12 months after that project's first paid payout
          count.
        </li>
        <li>The first month that can count is November 2026.</li>
      </ul>

      <h2>How much</h2>
      <ul>
        <li>
          3 SLOP for every 1 USDC of gross contributor payout, counted on
          stablecoin payouts only. This is a fixed token rate, not a dollar
          value.
        </li>
        <li>At most 250,000 SLOP per referred project, over its lifetime.</li>
        <li>
          At most 2,000,000 SLOP for the whole program. At this rate the full
          pool corresponds to about 666,667 USDC paid to contributors by
          referred projects.
        </li>
        <li>
          A rate change applies only to later payouts. Filed months are never
          changed.
        </li>
      </ul>

      <h2>What does not count</h2>
      <ul>
        <li>
          Payouts in a project's own token or any other non-stablecoin asset.
        </li>
        <li>Projects under a public hold.</li>
        <li>Accounts under a participation ban.</li>
        <li>
          The founders' accounts (<code>lalalune</code>,{" "}
          <code>drew-dot-com</code>), administrators and moderators. They can
          never receive referral tokens.
        </li>
      </ul>

      <h2>How tokens are distributed</h2>
      <ul>
        <li>
          After each closed UTC month, Slop Cash publishes a public file with
          every referrer's running total. Anyone can recompute it from the
          public payment record.
        </li>
        <li>
          A fingerprint of that file (a Merkle root) is posted to the referral
          contract.
        </li>
        <li>
          Referrers claim their own tokens from the contract with the Robinhood
          Chain wallet registered on their slop.cash account. Slop Cash sends no
          tokens to anyone.
        </li>
        <li>
          A referrer without a registered wallet keeps their total, and it
          carries into later files.
        </li>
        <li>Claimed tokens cannot be taken back.</li>
      </ul>

      <h2>The contract</h2>
      <ul>
        <li>
          Address on Robinhood Chain:{" "}
          <ExternalLinkAnchor
            className="record-addr"
            href="https://robin.etherscan.io/address/0x6A24E993E59cbA950C6F91A964BEF2A5F91227CC"
          >
            0x6A24E993E59cbA950C6F91A964BEF2A5F91227CC
          </ExternalLinkAnchor>
          . Source:{" "}
          <ExternalLinkAnchor href="https://github.com/SlopDotCash/slopdotcash/blob/main/contracts/evm/src/ReferralDistributor.sol">
            ReferralDistributor.sol
          </ExternalLinkAnchor>
          . It is not upgradeable and can hold and pay out only SLOP.
        </li>
        <li>
          It has had an AI-assisted internal review. It has not had an
          independent audit.
        </li>
        <li>
          Owner:{" "}
          <span className="record-addr">
            0xbCA4736F59d03F07cFac9415A5936fECb06b2eA7
          </span>
          , the Slop Cash S.P. operating wallet. The owner can pause the
          contract, replace the address allowed to post monthly files, cancel
          the most recent file before anyone has claimed from it, and, only
          after 365 days with no active file, withdraw the remaining balance. If
          that withdrawal is ever used, the balance goes back to the treasury at{" "}
          <span className="record-addr">
            0x96028De971a9D37404F5030F6284b40640E2D1a2
          </span>
          .
        </li>
        <li>
          Posting address: none usable today. It is set to the unusable address{" "}
          <span className="record-addr">
            0x000000000000000000000000000000000000dEaD
          </span>{" "}
          until the program is activated.
        </li>
      </ul>

      <h2>Risks</h2>
      <ul>
        <li>
          Whoever controls the posting address could post a false file and claim
          up to the contract's balance before the owner reacts. There is no
          built-in waiting period. The defences are an independent watcher on
          the contract, the owner's pause, and keeping the posting key separate
          from the owner key.
        </li>
        <li>
          The owner can replace the poster, so the owner key is the root of
          trust for these tokens.
        </li>
        <li>
          If referred projects pay out less than the pool covers, the remainder
          stays in the contract until the owner's 365-day withdrawal becomes
          available.
        </li>
      </ul>

      <h2>Changes</h2>
      <p>
        If the terms change, this page is updated first and the date at the top
        changes. Changes apply only to later payouts.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href="mailto:hello@slop.cash">hello@slop.cash</a>.
      </p>
    </>
  ),
  links: (
    <>
      <Link href="/">slop.cash</Link> ·{" "}
      <Link href="/record">Slop Cash live record</Link> ·{" "}
      <Link href="/receipts">Receipts</Link> ·{" "}
      <ExternalLinkAnchor href="https://app.umia.finance/p/slop-cash">
        SLOP on Umia
      </ExternalLinkAnchor>
    </>
  ),
};
