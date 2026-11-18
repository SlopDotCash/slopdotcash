# Verified payout recognition

PRD section 7 grants 25 participation Points once per recipient, project and
contribution month. Online `points:generate` reads the existing public,
actor-scoped vault-payment history for immutable GitHub actors already in the
contribution journal, as well as retained Git-backed cycle settlements. It does
not join wallet addresses or publish a new recipient-identity feed.

Only finalized ordinary mainnet payments with a proven monthly obligation and
positive net amount qualify. The existing API excludes private bounty tables,
unpaid obligations and private or closed memberships. A missing work month is
not inferred from the transfer date. Unavailable, incomplete or moving payment
history fails the generation instead of becoming an empty result. Offline
generation retains history without fetching new payment evidence.

For newly recognized D1 payments, `occurredAt` records when the finalized
evidence was indexed; it does not claim to be block time. The source's cycle is
the recorded contribution month. Existing recognition awards, their dates and
any recorded exclusions remain unchanged. Multiple transfers, networks and
GitHub node-ID representations cannot reissue the same recognition.

Recognition remains nonfinancial participation credit. Monthly reward weights
exclude it; this reader does not reserve, bind, sign or pay an award. Publication
uses the normal reviewed Points import and release guards.
