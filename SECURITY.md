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

## Slop contract security bounty

Owner decision, 28 October 2026: slop.cash offers **$10,000** per accepted
critical loss-of-funds finding in the Slop contracts. The binding terms are the
ones published on the security page above, from the project's current D1
revision; the terms in force when Slop receives your report apply. Until they
are published there, no award is promised.

- **In scope:** Slop contracts deployed to a Slop mainnet deployment from
  `contracts/evm/src` (project vaults, vault factory, monthly reserve) and
  `contracts/solana/programs` (project vaults, monthly reserve), and any other
  contract in `contracts/`, such as the referral distributor, once it is
  deployed to mainnet from reviewed source.
- **Severity:** a distinct critical vulnerability with a reproducible path to
  loss of funds, reachable without privileged keys. Loss of funds means theft
  or permanent freezing of user, contributor, project-owner or vault funds.
- **Out of scope:** third-party contracts and protocols (including USDC, Squads
  and Sablier), website, API, worker and other off-chain or frontend-only
  issues, testnet-only or local deployments, already-known or previously
  reported issues, and losses that need a compromised owner, upgrade, identity
  or fee authority key or an intended owner action. Report those privately
  anyway; they carry no paid award.
- **Award:** the full $10,000 goes to the first qualifying reporter of each
  distinct finding; slop.cash is the sponsor and takes no share (owner decision
  confirmed 28 October 2026). Awards are discretionary and decided by the
  maintainer. Funding is pledged and supplied after approval. No full-award
  payment path exists yet: an approved award is not payable until one is
  approved and released, and verified funding alone does not make it payable.
- **Rules:** test only on local chains, forks or isolated deployments with
  synthetic funds. Never exploit a mainnet deployment, move or freeze anyone's
  funds, or publish exploit details. Disclosure needs the maintainer's
  approval in the private case.
