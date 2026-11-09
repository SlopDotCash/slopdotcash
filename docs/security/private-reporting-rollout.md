# Private reporting rollout

This runbook implements the owner decisions in [PRD sections 8–10](../slop-product-requirements.md#8-security-and-private-bounties). It is not a project registry, deployment record, funding authorization or claim of live acceptance.

## Approved behavior

All registered projects accept confidential reports. Umia Protocol and, from 28 October 2026, Slop's own contracts have paid bounties (see "Slop contract bounty" below). The Umia maintainer considers a $10,000 gross Umia award for the first qualifying report of each distinct critical loss-of-funds finding: $7,500 to the researcher and $2,500 to slop.cash. The owner decides whether to grant the published award; an after-approval award uses the amount frozen at receipt. There is no fixed number of findings and no upfront vault deposit. Slop funds approved awards through the existing private settlement flow; Umia reimbursement stays outside this application.

The researcher signs in to Slop, reviews current terms, and submits a private report. Slop retains the validated report in private object storage, records its own receipt and terms, and shows the case in Inbox. Surplus screening precedes owner notification. Missing evidence, suspected spam and provider failure stay available for private human review. A screening result never approves an award or disclosure.

Qualified reports create the existing generic private Inbox/email notice. The owner reads the evidence after authentication. Email contains no vulnerability body. Optional GitHub forwarding uses the researcher's authorization, preserves their identity, and verifies the separate GitHub receipt. Slop receipt, review and settlement remain available without GitHub forwarding.

## Implementation and verification

- `backend/security/report-intake.ts` extends the existing submission and case lifecycle. Migration `0101_durable_security_intake.sql` preserves older receipts and obligations while allowing a Slop receipt without a GitHub advisory.
- `security-reports/` objects in the existing private bucket hold immutable report versions. D1 holds identifiers, hashes, state and audit records. The authenticated report route checks current case access; contributor trace bodies remain unreadable.
- The existing Surplus route screens without executing code or following report instructions. Model failure preserves the report. Authorized maintainers can request more evidence or approve private routing.
- Inbox reuses the private case, review and payment views. The homepage derives bounty cards from published D1 terms. Canonical skills use the same private Slop journey.
- `fundingPolicy: "after-approval"` permits an open, visibly pledged program. `capacity.awards: null` means no predetermined count. Omitted funding policy preserves the existing prefunded behavior. Each award still requires an owner decision, first-finding checks, a verified private vault balance, and the existing 75/25 finality checks.

Run the repository quality gate and browser matrix against the final reviewed source. Include a private report with GitHub unavailable, provider failure and recovery, incomplete/spam screening and owner override, revoked or unrelated accounts, retry/replay, report revision, and a chosen but unfunded award. Prove that later verified funding permits the same existing settlement path without a second commission. Preserve old funded-case tests. Fixture inference proves control flow only; it is not real provider qualification or delivery evidence.

The protected main release calls the actual private-screening implementation
once with a public synthetic authorization-bypass report before publication.
The gate caps its request and output with a conservative $1 bound, requires the
provider cost receipt and returned model identity, and logs only provider,
model, count and outcome. It never reads private reports or sends notifications.
A dry run proves the transport boundary without a provider call; it is not real
model qualification. This case proves the plausible-report path only; it does
not claim comprehensive model quality or live report/email delivery.

## Live setup

1. Verify `lalalune`'s current authority on the repository and the Slop GitHub App installation. The organization name remains the repository owner; the intended program contact is a separate identity. The read-only GitHub credential observed during implementation cannot authorize registration. Do not bypass this check through direct D1 writes.
2. Register the repository through `/projects/new`, including repository identity, license facts, integration branch and complete project skill fields. The owner approved an explicit normal-admission exemption for the temporary Umia fork on 27 October 2026. Record that decision through the admin exemption control after its release; verify the exact registered repository identity. It is an exemption, not a successful scan. Other projects complete the normal admission checks. Do not add a project manifest to this repository or hand-edit generated snapshots.
3. Publish the bounty through its owner settings: critical loss of funds, first qualifying report per finding, $10,000 gross, 75/25 split, funding after approval and no predetermined award count. Use the owner-confirmed Base USDC settlement terms (27 October 2026). Identify `lalalune` as the technical/financial contact and Slop as the payer; state that reimbursement is outside Slop. Keep safe testing, response targets, disclosure and appeal terms explicit.
4. Read the live registry and close any other paid programs through immutable revisions. Do not delete programs, cases, receipt terms or funded obligations. Leave unpaid private reporting available everywhere. At the implementation review, the public registry had no paid program and no Umia entry; recheck rather than relying on that observation.
5. Promote the reviewed change from `development` to `main` through the normal release workflow. It applies the migration, snapshots D1 and publishes the matching generated pages and skills. Never deploy this worktree directly or expose production credentials to a feature branch.
6. Verify the deployed homepage and private submission/Inbox flow, Surplus availability, current owner access and actual email receipt. Verify optional GitHub delivery separately. A provider-accepted mail state is not proof of delivery. Record failures and unavailable integrations honestly.
7. After the maintainer chooses an award, deploy/register and fund the approved separate bounty vault as needed through the existing owner flow. Do not fund it during program setup. Reserve only after fresh finalized balance evidence, and mark paid only after exact principal, fee and destination reconciliation. An off-chain reimbursement is not a contributor payment receipt.

The existing PRD waiver for earlier private-reporting live checks remains recorded as waived, not passed. This runbook does not turn unexecuted new provider, browser, email, GitHub or payment checks into successful evidence.

## Slop contract bounty

Owner decision, 28 October 2026: $10,000 per accepted critical loss-of-funds
finding (theft or permanent freezing of funds) in Slop's mainnet contracts from
`contracts/evm/src` and `contracts/solana/programs`. slop.cash is the sponsor,
so the terms use the full-award split (`researcherBasisPoints: 10000`,
`slopBasisPoints: 0`; owner decision confirmed 28 October 2026), which only
the platform project `slopdotcash`, whose repositories include
`SlopDotCash/slopdotcash`, may publish. Full-award terms must use
`fundingPolicy: "after-approval"` and may not bind `settlement`: the bounty
vault always pays 75/25. A case received under them freezes the full-award
split, records a chosen award as unfunded, and never reserves or prepares a
payment through a bounty vault, even if a later revision binds one. No
full-award payment path exists yet: reservation is skipped and payment
preparation is refused, so an approved full-award case is not payable until a
full-award payment path is approved and released.

Publish it as the owner: sign in as `lalalune`, open
`/projects/slopdotcash/security`, choose **Set bounty terms**, review the
prefilled terms (USDC, $10,000, after-approval, no award count, source revision
`7fdedd35…`, the recorded EVM factory and vault implementations on Base,
Ethereum and Robinhood Chain and the Solana program), set Status to **Open**,
then **Review** and **Publish**. That appends the immutable D1 revision that
the home page and security page read. Confirm the source revision and network
before publishing.
