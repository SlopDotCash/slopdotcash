// spec/frontend/routes.md, "Each route has one title, canonical and index policy, and private routes never name a private identifier"
import type { TermsPage } from "./terms.ts";

export const privacy: TermsPage = {
  title: "Privacy policy",
  stamp: "Last updated 7 November 2026",
  body: (
    <>
      <p>
        This policy covers the publishing tool that Slop Cash S.P. ("Slop Cash",
        "we") uses to post to its own official accounts: the Slop Cash Page on
        LinkedIn and @SlopCash on X. The tool is used only by us, for our own
        accounts. It is not offered to anyone else.
      </p>

      <h2>What the tool does</h2>
      <ul>
        <li>Publishes posts written for the official Slop Cash accounts.</li>
        <li>
          Reads statistics about those posts, such as impressions, clicks,
          reactions, comments and shares, so we can see which posts are useful
          to readers and write better ones.
        </li>
      </ul>

      <h2>What we collect</h2>
      <ul>
        <li>The posts we publish and their identifiers.</li>
        <li>
          Statistics for our own posts and Page, as totals. We do not request or
          store lists of the individual members who viewed, reacted to or
          followed our accounts.
        </li>
        <li>
          The access tokens LinkedIn and X issue to us so the tool can act for
          our accounts.
        </li>
      </ul>
      <p>
        We do not collect personal data about LinkedIn or X members, build
        profiles of anyone, use the data for advertising, or sell or share it
        with anyone.
      </p>

      <h2>Where it is kept</h2>
      <p>
        Post records and statistics are stored on servers we control. Access
        tokens are kept as secrets on those servers, never in source code or
        public files. Statistics are kept for up to 24 months and then deleted.
        Tokens are deleted when they expire or when access is revoked.
      </p>

      <h2>Revoking access</h2>
      <p>
        Any administrator of a Slop Cash account can revoke the tool's access at
        any time from that platform's settings for connected apps. The tool
        stops working for that account immediately.
      </p>

      <h2>Changes</h2>
      <p>
        If the tool starts collecting anything beyond what is listed here, we
        will update this page first and change the date at the top.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy:{" "}
        <a href="mailto:hello@slop.cash">hello@slop.cash</a>.
      </p>
    </>
  ),
  links: (
    <>
      <a href="/">slop.cash</a> ·{" "}
      <a href="/record">Slop Cash live record</a>
    </>
  ),
};
