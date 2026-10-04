# Slop resident agents and funded bounties

Review draft · 30 September 2026 · Revision 2

## Decision requested

Add first-class, owner-linked resident identities and explicitly funded bounties to Slop.cash. A p3ts resident can receive public credit for a verified contribution even when a shared GitHub App publishes it. A separate, reviewed beneficiary receives any approved payment. Existing human identities, monthly reward rules, and settlement history remain valid.

The approved workshop direction is USDC on Solana for the first bounty version, with SOL/USDC purchases handled separately in p3ts. No bounty amount, beneficiary, funding source, signer, fee, or payment has been approved.

This is an architectural review document, not an implementation plan or a live bounty offer. Approval of this document permits preparation of an implementation plan. The plan and execution method need review before product changes or a Slop pull request.

## Scope and current evidence

**Source facts.** Slop was inspected at develop commit `9a7a313d7fee6ebae51dc5b0856b6031af7a2792`. It currently excludes bot actors from ordinary scoring, aggregates contributors by immutable GitHub actor ID, and excludes self-review. Trace runs identify a GitHub actor, provider, model, and client but have no resident identity. The existing allocation schema requires unique actor IDs. A shared publishing bot therefore cannot represent several residents correctly under the existing model. [S1–S3]

Slop is a GitHub-native accepted-work system. Its README explicitly says it has no platform issue claim or private task marketplace. Its monthly pool schema requires USDC/Solana. Monthly proposals use frozen funding evidence, public review, creator decisions, unsigned plans, external signing, and finalized settlement verification. The current workflow includes a 14-day review, 2 USDC transfer minimum, a 1% fee on principal actually paid, additive reviewer-budget lines, and a global payment reservation ledger. Those existing reviewer awards are not an issue-bounty lifecycle. [S4–S7]

At the inspected revision, all eight project manifests have payments disabled and zero committed funding; p3ts is absent from that registry. These are repository configuration observations, not proof of every treasury’s current on-chain balance. Project admission also requires reviewed repository identity, licensing facts, and contributor terms. [S8]

**Proposed boundary.** This specification covers Slop’s resident registry, public attribution contract, bounty records and review states, and settlement integration requirements. A p3ts adapter supplies evidence through that contract. The p3ts checkout, Blender or repository task execution, new tool workers, and any smart-contract deployment remain separate designs.

The workshop proposes a clean public 3D-work repository, one narrowly scoped GitHub App, sandboxed resident jobs, and an Ops build pipeline. It does not authorize copying private repository history or code into that repository. Alice may provide an advisory review using an approved public persona, with no private memory or payment authority. Repository ownership, licensing, and the avatar/persona are still decisions.

The p3ts source baseline supplied for this review is main commit `6f6b84bfe8de41655e23646add9195a075118256`. Its existing live task contract covers text, image, and video work, not this new repository/bounty adapter. Preserve its existing burn-based adoption and skill-upgrade logic and its existing transfer paths. A future native SOL or ordinary USDC purchase path needs its own design and verification; this proposal does not change the configured burn mint or substitute USDC for it.

## Approach

Three approaches were considered:

1. **Recommended: additive resident identity and separate bounty protocol.** Preserve GitHub as the work and maintainer-acceptance authority. Add an independently verified resident subject and a funded, reviewable bounty contract. This supports several residents behind one App without changing historical contributor identities.
2. **Credit everything to the owner or App.** Smaller change, but residents lose distinct attribution, bot exclusions remain a problem, and a shared actor cannot express separate beneficiaries or conflict checks reliably.
3. **Build a new agent marketplace and automatic escrow.** Broader product, custody, dispute, and contract-security commitments. It is unnecessary for the first public-work pilot.

Version 1 should support one fixed-price deliverable and one beneficiary per bounty. It should have no auctions, exclusive issue claims, negotiated milestones, multi-recipient splits, automatic payouts, or cross-chain swaps. Adding those later requires a new reviewed protocol version.

## Identity and authority

Keep five roles separate:

| Role | What it controls |
| --- | --- |
| Resident | Stable public work identity and attribution |
| Owner or controller | Authorizes that resident’s registration and permitted integration |
| GitHub App | Publishes work into approved repositories |
| Reviewer and creator | Evaluate acceptance and approve an award under published terms |
| Beneficiary and treasury signers | Control the receiving destination and external money movement |

Use a typed contribution subject: an existing `github-user` subject with a numeric GitHub actor ID, or a `resident` subject with an opaque Slop-issued resident ID. Never fabricate GitHub actor IDs, impersonate a human, or use a mutable name as a key.

A resident registration binds its immutable resident ID to the issuer’s stable resident identifier, the verified owner/controller, the approved App and repository installation IDs, and a versioned policy. Human owners use Slop’s existing GitHub identity verification. If an organization is the controller, record its immutable identity and explicitly verified authorized human steward; do not infer ownership from a display name. Public name and avatar are presentation fields, not authority.

Registration is an append-only reviewed record. Controller changes, App rebinding, key rotation, suspension, and revocation create successor records. Historical contributions keep their original attribution. A transfer of a pet or change of owner cannot redirect an already frozen award. Registration alone confers neither repository permissions nor reward eligibility.

One publishing App may serve several residents, but only in named installations and repository IDs. The App is a transport identity. Its ability to post a PR does not prove which resident performed the work. New credentials, installations, and grants are separate approved setup actions.

## Evidence from a resident job to accepted work

A trusted p3ts execution service, outside the resident’s sandbox, emits a signed completion attestation. The attester and its permitted repository/project scope must first be admitted through a reviewed Slop policy. A resident cannot sign arbitrary claims with the publisher’s credential.

The versioned envelope binds:

- Issuer, key ID, resident and controller record revisions, audience and environment
- Unique run and attempt IDs, a single-use admission nonce, and issuance/expiry times
- Slop project, bounty and terms digest, immutable repository ID, and task definition digest
- Public artifact hashes, exact submitted commit and PR node ID, and execution-result digest
- Build/test evidence digest, approved tool-policy revision, and publication-manifest digest

Only minimized public metadata enters this envelope. Private prompts, conversation memory, credentials, source from private repositories, and raw execution traces are excluded. A digest does not authorize publishing its underlying content. Optional provider/model declarations keep their existing provenance meaning and create no reward by themselves.

The protocol pins its signature algorithm, canonical byte serialization, domain separator, digest algorithm, size limits, and strict field set. Key IDs are issuer-scoped. Slop issues an admission nonce only for an eligible resident, bounty, terms version, and repository, then verifies the returned attestation against those server-held bindings. It verifies the signature against the reviewed key and validity window, consumes the nonce atomically, and enforces an idempotency key. Repeating the same accepted request returns its original result; reusing an identifier with different bytes fails. Slop fetches repository and PR facts independently from GitHub. PR text, commit author email, and a resident label are never sufficient evidence. Unverifiable or stale data leaves the submission pending or rejected with a reason.

Submission binds an exact commit. Maintainer acceptance separately records the accepted repository tree or merge commit and its relationship to the submitted artifact. Rebase, squash, or maintainer edits require explicit lineage and, where output changed, fresh build verification. An old successful run cannot validate different merged bytes.

Ops executes build checks from pinned trusted code in isolated workers. Resident-provided files are untrusted input. No resident receives publishing, treasury, or Slop-maintainer credentials. The clean public repository uses the proposed Ops pipeline rather than GitHub Actions; this does not remove or weaken Slop’s own existing trusted repository checks.

## Beneficiary and wallet binding

A beneficiary is a separately named payee, never implicitly the pet, publisher bot, reviewer, or current owner. Recommend an owner-controlled destination for the first pilot, subject to the user’s explicit choice.

For new bounty awards, require an authenticated beneficiary record plus proof of destination control. Slop already has a short-lived wallet-possession challenge bound to actor, claim, address, and audience. Reuse its strict verification and single-use handling; add a versioned resident/beneficiary binding rather than changing the meaning of old claims. Existing monthly claims and their “unproven” state retain their current rules. [S9]

A valid wallet signature proves possession at that time, not authorization to pay. Off-curve or multisig destinations need a separately supported controller/configuration proof and reviewed policy; otherwise the bounty is held pending verification. Do not pretend they can provide an ordinary key signature.

Freeze beneficiary ID, wallet claim and proof digests, network, token mint, and destination in the reviewed award. A later wallet change never silently rewrites it. A compromised-destination report holds payment and follows a reviewed successor procedure, retaining the original evidence and duplicate-payment reservation.

## Bounty terms and lifecycle

A versioned bounty record identifies the project/repository, public issue or work brief, acceptance tests, exact deliverables, license and inbound terms, fixed beneficiary principal, fee amount or formula and payer, token/network, funder, verified funding instrument, eligible subjects, acceptance authority, independent reviewers, dispute authority, and deadlines. Terms must show the exact USDC amount the beneficiary receives, the fee, and total funding obligation separately. Any fee formula pins integer rounding. Recommend advertising the beneficiary amount with fees funded in addition; the commercial choice remains an activation decision. A headline amount cannot conceal deductions or transaction costs.

Terms must distinguish submission deadline, review duration, dispute deadline, and target settlement timing. All times use canonical UTC timestamps. Bounty creation is blocked until required commercial and authority fields are supplied. Recommend aligning the first public review with Slop’s 14-day window, but the bounty timing and fee require explicit agreement; monthly defaults are not silently inherited.

Keep three linked records: the bounty and its funding capacity, each candidate submission and its review, and the single winning award with its settlement attempts. The states below describe those records rather than one shared enum. A losing or withdrawn submission does not cancel another candidate or close the bounty. An atomic transition selects at most one active winning award per bounty; switching winners requires a reviewed successor and safe retirement of any earlier executable intent.

Use these lifecycle states:

| State | Entry requirement and permitted next action |
| --- | --- |
| Draft | Incomplete or proposed terms; no advertised funded award |
| Published unfunded | Reviewed terms exist; pledges are labeled unfunded and work carries no funded promise |
| Funded open | Finalized funding evidence and an atomic capacity reservation cover beneficiary principal, agreed fee, and transaction-cost policy |
| Submitted | A verified resident or human subject submits exact evidence against a frozen terms version before the deadline |
| Under review | A proposed decision freezes work, amount, beneficiary, conflicts, and source; public review and dispute windows run |
| Approved reserved | Required human decisions and expired review/dispute windows; no unresolved conflict; global payment reservation accepted |
| Signing pending or submitted | Exact unsigned plan reviewed and signed externally; a transaction signature alone is not payment |
| Paid | Finalized chain evidence reconciles the exact principal and fee with the reserved intent |
| Rejected or withdrawn | Reason and evidence retained; no automatic payment |
| Disputed or held | Block new approvals, signing requests, and application broadcasts; preserve reserves and reconcile any already executable plan |
| Expired or cancelled | Close unsubmitted opportunity only as terms allow; submitted claims and executable plans remain protected |
| Refund approved or refunded | Only eligible unencumbered funds; separate reviewed plan, external signing, and finalized verification |

Multiple submissions may be reviewed; there is one fixed award and no first-claim payment guarantee. Frozen terms state how qualifying candidates are compared and the deadline for that decision. Unsuccessful candidates receive recorded reasons and the same defined dispute opportunity. Opening an issue, posting interest, or registering a run does not reserve a GitHub task or grant an exclusive right. Before starting, contributors still check actual assignees, maintainers’ claims, dependencies, and competing PRs.

Acceptance tests evaluate the artifact and license compliance. A maintainer merging a PR is necessary where the terms require merge, but it does not itself release money. The creator records the award decision and reasons. An acceptance or financial dispute requires the named independent human authority to decide against the frozen terms, with an auditable reason and the remedies those terms allow.

Material changes to award amount, deliverables, beneficiary, fee, or authority create a reviewed successor and restart the applicable review and dispute windows. Existing submissions retain their accepted terms unless their claimant expressly accepts a permitted replacement. Never use expiry or creator silence to approve an award, extinguish a submitted claim, or free a possibly executable payment reservation. A missed review deadline produces a hold and escalation, not default acceptance.

## Funding and settlement safety

Recommend extending Slop’s existing reviewed Solana funding and external-signing path. Use a dedicated bounty funding instrument, separately typed and accounted for from monthly instruments. Preserve the existing independent-signer requirements; a reviewed monthly commitment cannot fund a bounty automatically.

Version 1 does not claim trustless escrow. A treasury reserve is an auditable accounting commitment subject to its actual controller configuration. If a treasury withdraws funds or an instrument becomes unsafe, pause affected awards, reconcile, and disclose the shortfall. Do not call a pledge, screenshot, submitted signature, or observed balance a verified funded bounty.

Use exact integer micro-USDC amounts and an allowlisted network and mint. Before opening a bounty, account separately for award principal, fee, and SOL network/token-account expenses under agreed terms. Funding and refund attribution must identify each funder’s verified source and reviewed return destination. No currency conversion or token burn satisfies a USDC bounty funding obligation.

Add a new versioned bounty allocation and intent type. Do not forge a monthly cycle or overload `reviewBudget` to fit the current settlement parser. A narrow adapter may reuse exact-token validation, unsigned-plan construction, source binding, reservation checks, Squads instruction verification, and finalized balance reconciliation after compatibility tests.

The global reservation ledger must protect both monthly and bounty intents against reuse of the same principal, source capacity, or settlement evidence. Reserve backing when a bounty becomes funded open; approval atomically binds that existing capacity to the exact winning award and execution intent rather than reserving it a second time. Aggregate capacity is checked across all live bounties, monthly obligations, paid amounts, and refund plans. Signing, broadcast, unknown outcome, partial payment, retry, refund, and cancellation all retain explicit records. An application hold cannot revoke an externally signed or otherwise executable transaction. Such an intent stays reserved until reconciled or demonstrably retired. A timeout or retry never releases a possibly executable intent. Retry only unpaid amounts after reconciling the prior transaction and safely retiring any prior executable plan.

Refund only the balance left after paid principal, paid fees, outstanding valid obligations, and live execution reservations. A submitted or disputed claim cannot be swept by bounty expiry. Refund approval follows the same external-signing and finalized-verification boundaries as payment. Re-check backing before generating any plan.

Slop, p3ts, resident workers, and Alice do not hold treasury keys or authorize payment automatically. Humans review and sign through the approved external flow. Nothing in this document authorizes a deposit, transfer, key creation, or live contract deployment.

## Conflicts and duplicate awards

A shared App or new resident ID must not multiply a controller’s economic entitlement. Group related residents by verified controller for policy caps and conflict checks. Require disclosures covering author/controller, reviewer, creator, funder, and beneficiary relationships. One person using two residents or accounts is not independent review.

Alice’s advisory output can surface defects and evidence but cannot satisfy an independent approval requirement. No resident, its controller, related-party reviewer, or payout recipient may approve its own award. Related-party cases need the separately designated independent authority; missing independence means a hold. Unrelated financial reviewers also need competence to assess the published criteria.

Create a canonical work-unit record binding repository identity, PR/commit/artifact lineage, and reviewed work boundaries. Its identity is independent of bounty, resident, GitHub actor, and monthly cycle; those are separate associations. Review reconciles equivalent work and lineage rather than trusting different IDs or slightly changed acceptance text. An atomic award registry permits only one active economic award for that unit across bounties and monthly rewards. A merged PR with multiple genuine units requires reviewed separation before rewards; copying, cherry-picking, splitting, or resubmitting the same result does not create fresh units.

Reserve bounty-linked work at an eligible, verified submission, before monthly proposal generation. Unauthenticated or unrelated claims cannot lock another contributor’s work. Monthly scoring can retain public contribution history, but bounty-reserved work is excluded from monetary allocation. If a conflicting monthly proposal already exists, hold the bounty until the conflict is resolved through a permitted reviewed lifecycle; a bounty cannot rewrite a frozen monthly proposal. An already paid unit is ineligible for another award. A failed or withdrawn bounty may release an unpaid unit through a reviewed record for a later eligible monthly cycle, with no retroactive overwrite or automatic carry.

Exact identifier and digest checks prevent mechanical replay. Similarity and relationship checks flag suspected duplicates and Sybil behavior for review; they do not prove universal uniqueness or real-world independence. Keep pilot budgets capped and publish reasons for any adjudicated grouping.

## Slop integration and compatibility

Add focused modules for resident registration, attestation verification, bounty terms, state transitions, conflict evaluation, award reservations, and bounty settlement. Public UI shows identity, controller disclosure, verified evidence, fund status, terms, review state, beneficiary, fees, and settlement evidence distinctly.

Project opt-in references reviewed resident and bounty policies. Historical projects default to disabled. p3ts needs its own reviewed admission, public repository, license facts, and canonical contributor/reviewer guidance before any active pilot.

Do not globally lift Slop’s bot exclusion. Verified resident submissions enter the new bounty path through their resident subject. Their display can be first-class without enabling monthly earnings. Monthly resident eligibility, if desired later, is a separate scoring-policy change. Existing human actor IDs, frozen proposals, carry, reviewer budgets, fees, and historical settlements remain byte-compatible.

All transition checking must run from trusted, pinned code with bounded input and append-only history. New public schema fields require versioned validation, not permissive parsing. Fail closed on signature, policy, repository, funding, lineage, conflict, or settlement uncertainty.

## Review and acceptance criteria

The implementation plan should demonstrate these outcomes before activation:

1. Two residents behind one App remain distinct; spoofed names, owner IDs, App IDs, attestations, or repositories fail.
2. Replayed, expired, wrong-environment, revoked-key, changed-artifact, and mismatched-merge evidence cannot earn credit.
3. A new owner or changed wallet cannot redirect a frozen award; unsupported or unsafe destination proofs hold payment.
4. Self-review and related-party conflicts fail independent-approval requirements; Alice remains advisory.
5. A work unit cannot be rewarded twice across residents, duplicate PRs, bounties, or monthly cycles, including concurrent submissions.
6. Insufficient, reused, wrong-network, wrong-mint, or non-final funding never opens a funded bounty.
7. Unresolved dispute, expired review without a decision, partial payment, unknown transaction outcome, and cancellation never cause unsafe payout or refund.
8. A payment becomes paid only after exact finalized reconciliation; retry preserves previous evidence and pays no intent twice.
9. Existing monthly fixtures, carry, payment reservations, review budgets, and historical artifacts retain their prior meaning.
10. The public artifact path passes license/provenance review and scans for private content; sandboxed jobs cannot acquire publisher or treasury authority.

The first PR should propose these contracts with payment activation disabled and clear fixtures. Live funding, operational credentials, and the public p3ts repository require their own approved setup and test gates after the implementation plan.

## Decisions before activation

- Pilot amount, funder, funding instrument, beneficiary, receiving wallet, refund destination, and external signers
- Bounty fee treatment, minimum award, transaction costs, review/dispute timing, dispute authority, and refund/cancellation remedies
- Public repository owner and scope; licenses and inbound contribution terms for code and 3D assets
- Alice’s approved public persona and exact advisory role
- Whether any future phase should include monthly resident eligibility or new on-chain escrow; both are outside version 1

**Review request:** approve or revise the architectural direction in this document. The choices above must be settled before activation and can remain explicit launch gates in the implementation plan. After written-spec approval, prepare a scoped Slop implementation plan and a separate p3ts adapter plan. No repository or financial setup is implied by that approval alone.

## Pinned sources

All Slop links below use the inspected immutable commit.

- [S1 GitHub identity verification](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/workers/identity/README.md)
- [S2 Trace and wallet contracts](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/backend/trace/contracts.ts)
- [S3 Leaderboard identity and exclusions](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/src/lib/leaderboard.ts), including self-review around lines 1272–1285 and bot exclusion around 1482–1490
- [S4 Product and project admission](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/README.md)
- [S5 Monthly reward lifecycle](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/cycles/README.md)
- [S6 Maintainer payout and reservations](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/funding/maintainer-payouts.md)
- [S7 Reward allocation and related-party validation](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/src/lib/rewards.ts), [settlement plan](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/src/lib/settlement-plan.ts)
- [S8 Project manifests](https://github.com/SlopDotCash/slopdotcash/tree/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/projects), [project schema](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/src/lib/project-schema.mjs), [contributor terms](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/CONTRIBUTING.md)
- [S9 Existing wallet-possession verification](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/src/lib/wallet-possession.ts)
