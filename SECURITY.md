# Reporting a vulnerability

Report suspected Slop vulnerabilities privately. Sign in at
[slop.cash/projects/slopdotcash/security](https://slop.cash/projects/slopdotcash/security)
and submit a private report; Slop retains it privately and shows its status in
your [Inbox](https://slop.cash/inbox). You may also use
[GitHub private vulnerability reporting](https://github.com/SlopDotCash/slopdotcash/security/advisories/new).
Reports are shared privately with the repository's security maintainers.
Do not open a public issue or pull request containing an unpatched vulnerability.

Include the affected component or URL, revision if known, reproduction steps,
expected and observed behavior, and the potential impact. Use a minimal example
with synthetic data. Never include credentials, signing material, private traces,
or another person's private data.

Maintainers will assess the report and coordinate remediation and disclosure
privately. A report does not establish reward eligibility or payment approval.
Only owners and maintainers open issues. For an ordinary bug, open a pull
request that fixes and proves the defect.

## Slop security program

Operator decision, 20 November 2026: Slop's own security program is funded by
its holders. It opens only if the Slop Cash decision market of 24 November 2026
passes the option "Fund the pool and a Slop security program". Until then, and
if that option does not pass, no paid award is offered for Slop's own code;
report privately anyway. This replaces the $10,000 contract offer of
28 October 2026.

- **In scope:** a loss of funds from a Slop vault, from a contributor payout,
  or from Slop's other payout contracts (project escrow on Base, Ethereum,
  Robinhood Chain and Solana; submission deposits; the referral distributor),
  including the off-chain Slop services that compute, record or send those
  payouts.
- **Severity:** a distinct critical vulnerability with a reproducible path to
  loss of funds, reachable without privileged keys. Loss of funds means theft
  or permanent freezing of user, contributor, project-owner or vault funds, or
  a payout sent to someone not entitled to it.
- **Out of scope:** third-party contracts and protocols (including USDC),
  website and frontend-only defects, testnet-only or local deployments,
  already-known or previously reported issues, reports filed before the
  program opens, and losses that need a compromised owner, upgrade, identity
  or fee authority key or an intended owner action. Report those privately
  anyway; they carry no paid award.
- **Award:** $5,000 to the first qualifying reporter of each distinct finding,
  in full; slop.cash takes no share. At most two awards. The program closes
  12 months after it opens or after its second award, and unawarded funds go
  back to the Slop treasury. The Slop Cash S.P. confirms each finding and its
  severity, pays an approved award directly and publishes the transaction
  after the fix is released.
- **Rules:** test only on local chains, forks or isolated deployments with
  synthetic funds. Never exploit a mainnet deployment, move or freeze anyone's
  funds, or publish exploit details. Disclosure needs the maintainer's
  approval in the private case.
