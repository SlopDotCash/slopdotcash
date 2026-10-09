# Slop MVP Delivery Plan

Date: 6 October 2026. Status: MVP scope submitted for adoption alongside [Slop Product Requirements](slop-product-requirements.md).

## Scope

The MVP retains current product capabilities and completes account, project, contribution, review, discovery, funding, and payout journeys on Base and Solana. It also requires optional participant-scoped Slopbot, Slop Score as the default leaderboard sort, issue/PR outcome metrics, closure penalties, admin featuring/bans, and mandatory community security vetting. Source availability is not proof of production readiness. Private security bounty programs, Robinhood, Ethereum mainnet settlement, bridges, swaps, and additional chains are future work.

The maintainer-approved fee for new payout obligations is 2% deducted from the gross award: 100 USDC gross means 98 to the contributor and 2 fee. Reserve the 100 once, show net contributor earnings, and preserve recorded legacy terms. Actor-binding proof and execution authority remain separate approval gates.

## Implementation scope and phase exit

Implement only the approved work packages below. Every implementation issue and PR must reference the exact PRD requirement and MVP package. New proposals must review and reference the PRD, or add a proposed requirement for human approval before implementation. A future requirement, open issue, or agent recommendation does not expand MVP scope.

Slop participation issues are chosen, verified and personally submitted by the human on the website. Agents must not generate unattended issue text, create issues in bulk, or open or submit an issue through the UI, CLI, API, scripts, prefilled URLs or another agent; they may investigate, explain findings, and assist with editing or translation under the contributor's control. The rule, its evidence standard, appeal path and effective date are in `CONTRIBUTING.md`. Every Slop participation issue/PR includes `Made via @slopdotcash`; the human adds it to their issue.

The rest of the PRD is blocked until maintainers approve an explicit MVP completion record. That record must map every work package and requirement to exact revisions, test results, real workflow validation, release evidence, and resolved blocking defects. It must confirm the MVP is finished, verified, tested and validated. A partially shipped feature, green local suite, merged PR, or model declaration is not phase completion. After confirmation, humans approve the next PRD phase before implementation begins.

## Work packages

| ID | Requirements | Concrete result | Dependency and acceptance |
| --- | --- | --- | --- |
| MVP-00 | PRD sections 3, 4, 22 | Approved scope, financial terms, donation rights, authority, policy migration | Resolve conflicts before implementation; maintainers approve PRD and this plan |
| MVP-01 | ACC-01–05, SOC-01 | One GitHub account with profile, optional X, sessions, privacy and recovery | Reuse identity/membership; real OAuth, rename and access tests |
| MVP-02 | WAL-01–05 | Backend Base/Solana wallet connections and safe changes | MVP-01; real wallet proof, unsupported paths, replay/concurrency and recovery |
| MVP-03 | PRJ-01–04 | Resumable project setup, optional Slopbot settings/health and updates | MVP-00/01 for drafts; MVP-12 before executable activation; actual permissions and canonical publication |
| MVP-04 | SKL-01–07 | Discovery/project skills, human-responsible outside issues, visible attribution and sandbox checks | MVP-03/12; genuine contribution, provenance and exact approved-revision execution |
| MVP-05 | BOT-01–07 | Optional Slopbot, marker/member routing, external opt-in, ignored actors, guideline-aware review and delegated closures | MVP-03/04/12; full eligibility matrix, health, stale revision, close confirmation, retry and uninstall |
| MVP-06 | FND-01–05, PAY-01–08 | Base and Solana contract/program, funding classes and protected obligations | MVP-00/02/03; approved PAY-05 actor-binding proof and recovery authority, independent review and accounting/authority conformance |
| MVP-07 | PAY-01–09 | Human approval, manual/automatic execution, late wallet dispatch, finality and receipts | MVP-06; full same-scenario test deployment evidence on both chains |
| MVP-07a | PAY-09 | Monthly-pool settlement network per project (RFC #472, approved 8 October 2026): `reward.chain`, per-network wallet resolution, Base reservation, EIP-191 recipient signer control, quorum source readiness, unsigned Base plans with EIP-681 requests, Base settlement evidence and verification | Reuses the canonical reservation, readiness and release path, the #470 verifier and #478 claim lineages; published fee recipients, updated 9 October 2026: Base `0x8f77c37d8650776bfe73c9b12b15209ee15d9b86` (replaces retired `0xb7b0d5e45016d6d31629d9ab375df770fd2aaf77`) and Solana `9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY`, enforced for new fresh-cycle policies; no real project changes network and no payment is enabled; #471 remains open |
| MVP-08 | ELG-01–03 | Prospective maintainer exclusions, moderation, financial holds and appeals | MVP-00/03/07; scoped human decisions and protected accrued obligations |
| MVP-09 | SCR-01–04, LDR-01–03, DSC-01–04 | Separate signed Slop Score/points, shared commit-author merge credit (owner decision on #506), closure debits/reversals, issue/PR ratios and score-default sorting | MVP-00/03/05/07/08; exact source coverage, ties, zero denominators, no duplicate penalties or financial seizure |
| MVP-10 | ADM-01–06, NOT-01, UX-01–17, PRD sections 16–17 | Unified pages, bot health, security evidence, admin featuring/bans, notifications and recovery | Relevant prior packages; permissions, canonical sync, cached/direct-route enforcement, appeals and browser evidence |
| MVP-12 | VET-01–08 | Revision-bound secure-VM vetting, full declared telemetry, binary/obfuscation quarantine, Astra and Opus reviews, confirmed-malware bans | MVP-00/01 and project drafts; required before community/featured executable onboarding; isolated clean/malicious fixture evidence |
| MVP-11 | DEP-01, PRD sections 20–23 | Versioned migration and limited production activation | All release gates; authorized production proof and reconciliation |

No package is marked implemented by this document. Create bounded implementation issues only after approval, tied to a real missing requirement and existing work. Reuse or reconcile open vault, settlement, installer, queue and deployment proposals before starting duplicate work.

## Vertical slices

1. A contributor signs in, connects X optionally, adds a verified wallet on each supported network, and sees correct private/public state.
2. A maintainer proves repository authority, passes security admission, publishes policy/skills, and optionally configures Slopbot. Tagged/member submissions are reviewed; external/ignored submissions are skipped unless explicitly configured otherwise.
3. A contributor discovers cleared work through the main skill, uses the approved community sandbox, completes required tests, and submits a tagged PR. Any Slop participation issue is chosen, verified and personally submitted by the human.
4. A sponsor funds a vault; a separate donor adds reward-restricted funds; the maintainer approves awards for registered and walletless actors.
5. Registered actors receive exact payments; late registration triggers the remaining funded award; retries do not repay; donor funds cannot be refunded.
6. Slopbot closes an eligible policy-violating issue/PR under delegated rules. Confirm one points/score debit, ratios, retry deduplication, and reversal after reopen/appeal; preserve earned obligations.
7. An admin promotes a cleared community project, bans a project, and verifies that discovery/skill routes stop serving it. A confirmed malicious scan also invokes the recorded ban policy. Reinstatement requires independent review and a new scan.
8. A human handles an exclusion, wallet incident, and appeal without erasing history; the site defaults to Slop Score and can sort by Points or Money received.

## Release gates

- **Policy:** section 22 decisions approved, effective dates set, and all affected instructions/protocols agree. Keep `AGENTS.md` and `CLAUDE.md` identical when they are updated.
- **Source:** scoped current-base branch, pinned dependencies, required repository checks, exact-head review, and real workflow evidence.
- **Identity:** live GitHub and X configuration independently qualified; optional X failure does not block contribution or payment.
- **Bot scope and penalties:** optional/off/incomplete/ready/degraded states, tagged nonmember, untagged member, unknown membership, external opt-in, ignored maintainer/contributor, stale revision, manual versus bot closure, failed close, merge, reopen and appeal; each has its specified review and journal outcome.
- **Community security:** isolated VM, trusted outside collector, file/disk/process/network telemetry, canary probes, controlled egress, tamper detection, recursive artifact quarantine, independent pinned Astra/Opus scans, incomplete/clean/malicious dispositions, no unscanned execution, and revision revocation.
- **Contracts:** exact deployed code, network/asset/vault identity, permissions, reserve invariants, donation rights, fee arithmetic, no Slop-held key able to originate or redirect a payment, and independent security review.
- **Financial operations:** complete Base/Solana test scenarios, ambiguous-send recovery, replay protection, finalized receipts, queue/indexer restart and reconciliation.
- **UI:** desktop/mobile, keyboard, 200% zoom, WCAG AA, copy/download/link checks, console/network evidence, uploaded walkthrough and test videos.
- **Deployment:** DEP-01 separates `development` staging and `main` production, including an isolated staging login and write backend; approved protected workflow and environment; production website/API/contract checks are separate. Claim the deploy/DNS lever before any such change.
- **Operations:** named incident/recovery owners, tested restore, scoped operator access, alerts, support/appeals and approved privacy/retention terms.
- **Pilot:** small authorized mainnet exposure; no broad enabling until actual payments and public totals reconcile.

## Future backlog

Private software and smart-contract bounty programs require their own approved program specification: authorized scope, safe harbor, private case storage, auto-submission, maintainer notifications, triage, duplicate/severity appeals, remediation/retest, agreed 50/50 collected-principal split, and privacy-aware settlement. Do not present that workflow as part of the current public contribution product.

Define the intended Robinhood integration separately. Ethereum mainnet and additional chain adapters require a funded use case and the same authority/accounting/finality acceptance as the MVP chains. Merkle batching and additional wallet types should follow measured need and supported proof paths.

## Approval and MVP completion record

The maintainer-approved merge adopting this PRD and plan records scope approval. Record its PR/revision and the choices adopted from PRD section 22; unresolved choices remain implementation gates. Adoption does not activate bot closure, penalties, project bans, money movement, or a future phase without the corresponding reviewed implementation and policy activation.

**MVP completion: not confirmed. Future implementation: blocked.** The later completion record must identify the responsible maintainers, approval date and decision link; every MVP package/requirement; exact tested/deployed revisions; end-to-end, security, provider and chain evidence; resolved defects; and the approved next phase. Add the real record only after these conditions hold. Do not prefill completion, waive missing evidence silently, or infer completion from this document merge.

## Quality review delivery

The [PRD quality requirements](slop-product-requirements.md#quality-review-requirements) and
[dated full review](slop-quality-review.md) belong to MVP-10. This plan does not mark them implemented.
Reuse MVP-01/02 for account and wallet changes, MVP-03 for project forms, MVP-07 for payouts, and MVP-09 for rankings.
Retain Slop Score as the default. Keep financial-policy decisions in PRD section 22.

| Pass | Requirement IDs | Required result |
| --- | --- | --- |
| 1. Correct misleading displays | UX-02–05, UX-12, UX-14–15 | Accurate amount/state labels, readable mobile model data, formatted scores and explicit loading states |
| 2. Combine duplicate workflows | UX-01, UX-03–07, UX-10–11 | One account area, consistent rankings, shared people discovery, one profile summary and shared proposal/payout controls |
| 3. Reduce explanations | UX-08–09, UX-13, UX-16 | Shorter pages, canonical explanations, searchable evidence and preserved material conditions |
| 4. Show useful visuals | UX-05, UX-08–09, UX-11–12 | Readable process, payment stages, allocation/fee arithmetic, model coverage and funding readiness |
| 5. Verify quality | UX-17 and all affected requirements | Real browser workflows, before/after measures, uploaded walkthrough and evidence video, accessibility and recovery results |

Reproduce the dated defects first. Link existing fixes and omit work already complete.
Track every page and project-state variant from the review. Record any omitted suggestion and its requirement-based reason.
Do not use arbitrary copy quotas, decorative charts, extra tests or new abstractions as completion criteria.
Use the same inputs and states for before/after comparisons. Keep hashes, financial precision, consent and historical records available.
Documentation-only updates require link and consistency checks. Application E2E and UI videos apply to later implementation changes.
