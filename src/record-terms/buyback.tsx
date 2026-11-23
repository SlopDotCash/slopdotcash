/** /buyback: the SLOP buyback terms. Edit the words here. */
import { Link } from "../Link";
import { ExternalLinkAnchor } from "../Presentation";
import type { TermsPage } from "./terms";

export const buyback: TermsPage = {
  title: "SLOP buyback",
  stamp: "Terms set 12 November 2026. Status updated 21 November 2026",
  status: (
    <p>
      <strong>
        Status: live since 12 November 2026. Nothing bought or burned yet.
      </strong>{" "}
      The first fees have come in from project payouts, but they are still below
      the minimum purchase size. The first purchase and burn will be listed on
      this page with their transactions once they are confirmed on chain.
    </p>
  ),
  body: (
    <>
      <h2>What it is</h2>
      <p>
        Half of every fee Slop Cash collects goes to buying SLOP on Robinhood
        Chain, and half of the SLOP bought is burned. It runs automatically. The
        money comes from Slop's fees, not from the treasury.
      </p>

      <h2>Where the money comes from</h2>
      <ul>
        <li>
          Contributor rewards and returned unused funds: Slop takes a 2% fee,
          and half of it (1% of the gross amount) goes to the buyback.
        </li>
        <li>
          Private security bounties: Slop's share is 25%, and half of it (12.5%
          of the gross award) goes to the buyback.
        </li>
        <li>Only fees received from 12 November 2026 00:00 UTC count.</li>
      </ul>

      <h2>How it works</h2>
      <ul>
        <li>
          Fees arrive in Slop's fee wallet on each network: Base, Ethereum,
          Solana and Robinhood Chain.
        </li>
        <li>
          From Base, Ethereum and Solana, half of the USDC fee income is moved
          to Robinhood Chain as USDG through deBridge.
        </li>
        <li>
          On Robinhood Chain, that USDG and half of the fees received there buy
          SLOP through KyberSwap.
        </li>
        <li>
          Half of the SLOP bought is sent to the burn address below. The other
          half stays in the Robinhood Chain fee wallet.
        </li>
        <li>
          Every amount is worked out from a running total of what has come in
          and what has already been bought or burned, so a retry can never buy
          or burn the same share twice.
        </li>
      </ul>

      <h2>Limits</h2>
      <p>
        Small fees add up until they reach these sizes, so purchases come in
        batches, not with every fee.
      </p>
      <ul>
        <li>
          A transfer to Robinhood Chain starts at 25 USDC. A purchase starts at
          25 USDG. A burn starts at 5 USDG worth of SLOP.
        </li>
        <li>At most 1,000 USDG of purchases per run and 5,000 per day.</li>
        <li>
          A purchase is refused if the price would move more than 3% or the
          result could come in more than 1% below the quote.
        </li>
      </ul>

      <h2>Addresses</h2>
      <ul>
        <li>
          SLOP token on Robinhood Chain:{" "}
          <ExternalLinkAnchor
            className="record-addr"
            href="https://robin.etherscan.io/token/0xfeb4E36FA4a2A494FF25ae4a63491e4c584A67AE"
          >
            0xfeb4E36FA4a2A494FF25ae4a63491e4c584A67AE
          </ExternalLinkAnchor>
        </li>
        <li>
          Burn address:{" "}
          <ExternalLinkAnchor
            className="record-addr"
            href="https://robin.etherscan.io/token/0xfeb4E36FA4a2A494FF25ae4a63491e4c584A67AE?a=0x000000000000000000000000000000000000dEaD"
          >
            0x000000000000000000000000000000000000dEaD
          </ExternalLinkAnchor>
          . Its SLOP balance is the public record of every burn.
        </li>
        <li>
          Fee wallet on Robinhood Chain, Base and Ethereum:{" "}
          <ExternalLinkAnchor
            className="record-addr"
            href="https://robin.etherscan.io/address/0x8f77C37D8650776bFe73c9b12B15209eE15D9b86"
          >
            0x8f77C37D8650776bFe73c9b12B15209eE15D9b86
          </ExternalLinkAnchor>
        </li>
        <li>
          Fee wallet on Solana:{" "}
          <span className="record-addr">
            9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY
          </span>
        </li>
      </ul>

      <h2>What to know</h2>
      <ul>
        <li>
          Nothing about the buyback is guaranteed. It buys only when fees come
          in, and there is no fixed amount or schedule.
        </li>
        <li>
          The SLOP token has no burn function for holders, so a burn is a
          transfer to an address nobody controls. The token's reported total
          supply stays at 100,000,000; the burn address balance shows what is
          out of circulation.
        </li>
        <li>
          Slop Cash holds the fee wallet keys. Software places each order within
          the limits above.
        </li>
        <li>
          The token's owner can pause the token. A pause stops purchases and
          burns until it ends.
        </li>
        <li>
          The half of the bought SLOP that is not burned stays in Slop's fee
          wallet. If that changes, this page says so first.
        </li>
      </ul>

      <h2>Details</h2>
      <p>
        The full design, the contract review and the test evidence are in{" "}
        <ExternalLinkAnchor href="https://github.com/SlopDotCash/slopdotcash/blob/main/docs/slop-buyback.md">
          docs/slop-buyback.md
        </ExternalLinkAnchor>
        . Questions: <a href="mailto:hello@slop.cash">hello@slop.cash</a>.
      </p>
    </>
  ),
  links: (
    <>
      <Link href="/">slop.cash</Link> ·{" "}
      <Link href="/record">Slop Cash live record</Link> ·{" "}
      <Link href="/receipts">Receipts</Link> ·{" "}
      <Link href="/referrals">Referral program</Link> ·{" "}
      <ExternalLinkAnchor href="https://app.umia.finance/p/slop-cash">
        SLOP on Umia
      </ExternalLinkAnchor>
    </>
  ),
};
