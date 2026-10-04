# Slop Resident Bounties Foundation Implementation Plan

> **Execution:** Implement this plan task by task, with an independent review after each task as the recommended method. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one disabled, additive Slop resident-and-bounty foundation with a deterministic local end-to-end proof and a reviewable draft PR, without enabling payments or production participation.

**Architecture:** Keep resident identity, work attribution, candidate review, award selection, funding capacity, and settlement as separate typed contracts. Pure validators and an append-only transition reducer compose into a local proof runner; existing monthly reward and payment modules remain authoritative and unchanged. Production admission, durable concurrency, project activation, and the p3ts adapter are later integration gates, not claims made by this first PR.

**Tech Stack:** Existing TypeScript and ESM, Bun 1.3.14, Node 24 or newer, Vitest 4.1.11, and existing @noble/curves 2.4.0. Use the repository lockfile; add no dependencies for this slice.

**Spec:** `docs/superpowers/specs/2026-09-30-slop-resident-bounties-design.md`, revision 2, approved 30 September 2026. The approved source travels with this plan: filename `2026-09-30-slop-resident-bounties-design.md`, SHA-256 `f1436d168d030bdb4a7460a16a8260259cd32fbe5f1e32b845d3155053b7fc40`.

## Global Constraints

- “Never fabricate GitHub actor IDs, impersonate a human, or use a mutable name as a key.”
- “No resident receives publishing, treasury, or Slop-maintainer credentials.”
- “Only minimized public metadata enters this envelope.”
- “Version 1 should support one fixed-price deliverable and one beneficiary per bounty.”
- “Use exact integer micro-USDC amounts and an allowlisted network and mint.”
- “Do not forge a monthly cycle or overload `reviewBudget` to fit the current settlement parser.”
- “A timeout or retry never releases a possibly executable intent.”
- “An already paid unit is ineligible for another award.”
- “Do not globally lift Slop’s bot exclusion.”
- “Existing human actor IDs, frozen proposals, carry, reviewer budgets, fees, and historical settlements remain byte-compatible.”
- No production project manifest, payment enablement, credential, App installation, account, deposit, transaction, broadcast, deployment, or public p3ts repository is created by this plan.
- Test amounts, keys, review durations, and participants are synthetic fixtures. They grant no commercial or operational authorization.

## Review Focus

1. One App publishes for two residents and GitHub names change: immutable resident/controller/repository attribution must survive, while display names cannot grant authority. Task 2.
2. Two candidates or processes use the same nonce, work unit, or backing: only one transition from the exact expected revision can commit; stale proposals fail. Tasks 3, 4, and 8. Production atomicity remains an activation gate.
3. A losing candidate withdraws while another is under review: preserve the other submission, the bounty, and protected obligations. Task 5.
4. Beneficiary and fee recipient coincide, and a fee has a fractional micro-unit: reconcile aggregated token deltas without silently changing the frozen principal; use explicit rounding. Tasks 1 and 6.
5. A dispute arrives after external signing, or finality is unknown: hold new work, preserve executable reservations, and prevent a replacement payment or refund. Tasks 4 and 6.

## What this first PR proves

A synthetic resident run is admitted, signed, independently matched to GitHub evidence, submitted against fixed terms, reviewed, selected, and reserved. The local runner creates a clearly non-executable preview, then checks synthetic finalized transaction evidence and derives paid state. Negative scenarios prove that forged identity, conflicting work, wrong funding, self-approval, stale review, and duplicate settlement cannot reach that state.

This is the first PR described in the approved spec: contracts, fixtures, and disabled payment support. It does not advertise a live bounty or add a public claim route. The important unresolved money and licensing choices do not prevent building this isolated backend slice. They do prevent activation.

## Repository and integration target

The baseline is canonical `SlopDotCash/slopdotcash:develop` at `9a7a313d7fee6ebae51dc5b0856b6031af7a2792`. Repository instructions require scoped branches from current canonical develop and PRs into develop. Recheck before execution; this plan is not permission to use stale source.

`rndrntwrk/slopdotcash` is a verified fork. Its open [draft PR 1](https://github.com/rndrntwrk/slopdotcash/pull/1) runs from `rndrntwrk:delegate/slop-extension-v0.1` at `46c0a2a7b2164c7ef356f456478f93fb7b7a558a` into fork-local develop at `18a4c4c6fe67574b164274ae5b743e4e1ce95ff5`. That base is 405 commits behind the inspected canonical develop. Do not continue, replace, merge, or cherry-pick that PR implicitly. It claims project schema version 2 for Delegate; canonical currently accepts version 1. This foundation adds no project-schema version and cannot collide with that draft.

Future publication target: `SlopDotCash/slopdotcash:develop`. Use a new branch such as `feat/resident-bounty-foundation` in a verified authorized head repository. Determine actual local remotes and push permission during execution; a fork may host the head but is never treated as the canonical base. If the target cannot be used, report the blocker rather than opening a fork-local substitute.

Read [RFC 500](https://github.com/SlopDotCash/slopdotcash/issues/500) and its current payment-safety PR stack before execution. The RFC proposes Slop voting-key and wind-up behavior that differs from this approved design. No unmerged proposal becomes a dependency by implication. If those changes land, re-review the reusable settlement boundary and report any conflict with no Slop-held keys or protected submitted claims. Do not resolve a changed custody model through an incidental refactor.

## File map

Create focused files under `src/lib/bounties/`: `contracts.ts`, `codec.ts`, `terms.ts`, `residents.ts`, `attestations.ts`, `lifecycle.ts`, `reservations.ts`, `settlement.ts`, and `projection.ts`. Each implementation has a colocated `.test.ts` containing behavioral success and failure cases.

Create `protocol/resident-bounties-v1.md`, `scripts/prove-resident-bounty.ts`, `scripts/prove-resident-bounty.test.ts`, and `tests/fixtures/bounties/scenario.ts`. The fixture builder owns one readable synthetic scenario and narrowly scoped variants; do not generate a second test framework.

Modify `package.json` only to add the proof command and include its deterministic test/check in the existing verification chain. Copy the approved spec and this plan into their `docs/superpowers/` locations in the execution checkout.

Read and reuse, without changing their existing contracts: `src/lib/wallet-possession.ts`, `src/lib/payment-reservations.ts`, `src/lib/solana-settlement.ts`, `src/lib/settlement-plan.ts`, and the current immutable identity/project validators. Leave `src/lib/rewards.ts`, `src/lib/leaderboard.ts`, project manifests, generated outputs, production API routing, D1 migrations, and workflows unchanged in this PR.

## Shared interfaces and contract decisions

Task 1 defines the following public types in `contracts.ts`. Later tasks use those exact names; a reviewer must approve interface changes before a dependent task begins.

- `ContributionSubject`: `{ kind: "github-user"; actorId: string } | { kind: "resident"; residentId: string }`
- `ResidentRevision`: schema version, immutable `residentId`, integer-string `revision`, nullable `supersedesRevision`, `issuer`, `issuerResidentId`, immutable `controllerActorId`, nullable verified organization ID, `authorizedStewardActorId`, permitted GitHub App/installation/repository IDs, policy digest, public display fields, state, and effective time
- `BountyTerms`: schema version, `bountyId`, `projectId`, immutable repository ID, public brief URL, deliverable/acceptance/license/inbound digests, eligible subject kinds, `principalMinor`, fee rule and recipient, `networkCostPolicy`, mainnet USDC mint, source instrument ID, funder IDs and verified refund destinations, authority IDs, candidate-selection rule, submission deadline, review duration, dispute duration, and terms digest
- `AdmissionNonce`: ID, resident/controller revision, bounty/terms/repository binding, run/attempt IDs, issued/expiry times, and nullable accepted attestation digest
- `ResidentAttestationV1`: the approved spec’s envelope fields, with schema version `"1"`, audience `"slop.cash/resident-bounty"`, environment `"test" | "production"`, and signature/key ID
- `EvidenceContext`: exact `revision`, canonical UTC `now`, reviewed policy/keys, independently obtained GitHub facts, `verifiedSubmissions` returned by Task 3, authenticated human decision records, wallet claims/proofs, funding observations, and immutable legacy monthly reservations/work-award facts
- `BountyState`: exact revision plus separate bounty, submission, award, work-reservation, capacity-reservation, nonce, and settlement-attempt collections; no status field substitutes for those separate records
- `BountyRecord`: bounty ID, immutable terms digest, opportunity status, capacity-reservation reference, accepted submission IDs, and nullable winning award ID
- `SubmissionRecord`: submission ID, bounty/terms IDs, contribution subject, verified attestation/lineage references, canonical work-unit ID, beneficiary binding, submitted time, separate review status, and decision/dispute references
- `AwardRecord`: award ID, bounty/submission/work-unit IDs, frozen terms and beneficiary, principal/fee amounts, source/capacity/intent references, required human decision digests, separate award state, and review/dispute timestamps
- `RefundDecision`: decision ID, bounty ID, authority/evidence digest, agreed refund legs binding funder ID, source, return destination and amount, fee treatment, and decision time
- `BountyEvent`: immutable event ID, kind, command ID/digest, previous/next revision, actor/evidence references, canonical time, reason, and the exact typed state delta for that command; no arbitrary executable payload
- `BountyCommand`: discriminated commands `publish-terms`, `open-funded`, `issue-nonce`, `submit`, `propose-decision`, `record-review`, `select-award`, `reject-submission`, `withdraw-submission`, `hold`, `expire-opportunity`, `retire-intent`, `reconcile-payment`, `approve-refund`, and `reconcile-refund`; each carries `commandId`, `expectedRevision`, and its exact subject/evidence digests. `retire-intent` requires demonstrable non-executability plus the specified human authority; a timeout is insufficient
- `TransitionResult`: `{ state: BountyState; events: readonly BountyEvent[] }`; events carry previous revision, command digest, actor/evidence references, canonical time, and reason. Append-only event folding determines the next state
- `TransitionError`: fixed code among `invalid`, `unauthorized`, `stale-revision`, `replay-conflict`, `held`, `insufficient-funds`, `duplicate-work`, and `unsafe-settlement`; no secret input is included in its message

`EvidenceContext` is not accepted from an untrusted request body. This foundation receives it only from local fixture loaders or verified read adapters; production ingestion must authenticate each source before constructing it. A caller-supplied `approved: true` or `funded: true` never grants authority. Task 1 also defines and exports the fixture-only `Scenario` interface with the `terms`, `residents`, `nonce`, `attestationBytes`, `initialState`, `submitCommand`, `award`, `approvedState`, `context`, `contextWithLegacyReservation`, `transactionSignature`, `stateWithPrivateContext`, and `privateSentinel` fields used in the assertions below. Later tasks populate the associated fixture evidence as their contracts become available.

Canonical signed payloads use strict UTF-8 JSON, recursively sorted keys, compact encoding, and no trailing newline, prefixed by `Slop resident bounty attestation v1\n`. The signature is outside the signed payload; a record's digest excludes its own digest field. Reject noncanonical bytes and unknown or duplicate keys before verification. Use SHA-256 digests and existing Ed25519 strict verification with `zip215: false`; keep issuer-scoped key IDs. IDs and money are strings, never floating-point JSON money. A signed attestation is capped at 16 KiB; that is a protocol input boundary, not lossy truncation. Run/admission expiry is bound to explicit reviewed policy and the submission deadline, not a newly invented short runtime timeout.

Fee rules are either an explicit integer micro-USDC amount or basis points with explicit `floor`/`ceil` rounding and payer. All commercial fields must be supplied for published terms. Draft terms may remain incomplete; no fixture choice becomes a production default. Reuse mainnet USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` and decimals 6 from `settlement-plan.ts`.

## Execution prerequisites

- [ ] Confirm approval of this written plan and execution method. Use an approved coding environment and an isolated worktree; do not implement in the document staging directory.
- [ ] Read checkout `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, relevant `.agents/skills`, and changed upstream money-path guidance. Preserve unrelated work.
- [ ] Verify origin/upstream URLs, canonical develop SHA, current open issues/PR overlap, and the separate status of fork PR 1. Record the exact chosen base in the PR evidence.
- [ ] Install the existing lockfile with `bun install --frozen-lockfile`; run baseline `bun run verify` and `bun run test:e2e`. Record pre-existing failures distinctly. Do not replace a failed check with a narrower passing test.

## Task 1 Contract and terms boundary

**Files:** Create `contracts.ts`, `codec.ts`, `terms.ts`, their colocated tests, `protocol/resident-bounties-v1.md`, and `tests/fixtures/bounties/scenario.ts`.

**Interfaces:** Produce `canonicalBountyBytes(value: unknown): Uint8Array`, `parseCanonicalBountyBytes(bytes: Uint8Array): unknown`, `assertBountyTerms(value: unknown): BountyTerms`, and `bountyObligation(terms: BountyTerms): { principalMinor: string; feeMinor: string; totalUsdcMinor: string }`. The fixture module exports `scenario(): Scenario`, with independent copies of all shared records and explicit synthetic evidence.

- [ ] Write behavioral tests: draft terms cannot open a funded bounty; missing fee payer/rounding fails; 10,000,000 principal plus a 100,000 fee produces exactly 10,100,000 total; changing the fee never changes principal; malformed/duplicate-key signed bytes fail before signature checking. Include a fractional micro-unit basis-point case for each permitted rounding mode.

  Required named assertion:
  ```ts
  it("keeps beneficiary principal exact while adding the explicit fee", () => {
    expect(bountyObligation(scenario().terms)).toEqual({
      principalMinor: "10000000", feeMinor: "100000", totalUsdcMinor: "10100000",
    });
  });
  ```
- [ ] Run `bun x vitest run src/lib/bounties/codec.test.ts src/lib/bounties/terms.test.ts`. Expect a failing behavior test before implementation.
- [ ] Implement the listed parsers, arithmetic, shared types, and the one fixture builder. Pin all signed keys and document the exact signature domain. Keep source authority and test fixture provenance explicit.
- [ ] Rerun the focused tests, then `bun run typecheck`. Expect all focused assertions and type checking to pass.
- [ ] Commit as `feat: define resident bounty contracts and exact terms`.

## Task 2 Resident identity and beneficiary binding

**Files:** Create `residents.ts` and `residents.test.ts`; extend only the shared fixture for this behavior.

**Interfaces:** Consume Task 1 types. Produce `assertResidentTransition(previous: readonly ResidentRevision[], next: readonly ResidentRevision[], context: EvidenceContext): readonly ResidentRevision[]` and `freezeBeneficiary(input: BeneficiaryInput, context: EvidenceContext): FrozenBeneficiary`. Define/export `BeneficiaryInput` and `FrozenBeneficiary` in `contracts.ts`; the frozen record binds authenticated beneficiary actor ID, wallet claim/proof digest, destination, mint/network, and resident/controller revision.

- [ ] Write tests that two residents sharing one App retain distinct attribution; display-name/login changes do not change IDs; owner, steward, or App binding spoofing fails; changing a controller requires a reviewed successor; old records cannot be rewritten. Prove an unsupported off-curve wallet produces a held result, and wallet proof never counts as an award decision.

  Required named assertion, with two distinct fixture residents behind one App:
  ```ts
  it("does not collapse residents into their shared publisher", () => {
    const f = scenario();
    const rows = assertResidentTransition([], f.residents, f.context);
    expect(rows.map((r) => r.residentId)).toEqual(["resident-a", "resident-b"]);
    expect(rows[0].controllerActorId).toBe(f.residents[0].controllerActorId);
  });
  ```
- [ ] Run `bun x vitest run src/lib/bounties/residents.test.ts` and observe failures for the missing behavior.
- [ ] Implement append-only identity validation and frozen beneficiary binding. Reuse wallet-possession verification against independently held claim facts; do not alter the existing monthly meaning of `unproven` or add a parallel wallet registry.
- [ ] Rerun that test plus `bun x vitest run src/lib/wallet-possession.test.ts`; require both new behavior and historical proof behavior to pass.
- [ ] Commit as `feat: bind resident identity and bounty beneficiaries`.

## Task 3 Attestation admission and exact work lineage

**Files:** Create `attestations.ts` and `attestations.test.ts`.

**Interfaces:** Produce `verifyResidentAttestation(bytes: Uint8Array, nonce: AdmissionNonce, context: EvidenceContext): Promise<VerifiedResidentSubmission>`. Define/export `VerifiedResidentSubmission` with original attestation digest, resident/controller revisions, bounty/terms binding, exact repository/PR/commit/artifact identities, accepted lineage evidence, and nonce ID. Verification does not consume the nonce; Task 5’s accepted transition does.

- [ ] Write tests for wrong issuer, key, audience, environment, App installation, repository, terms, nonce, run, and expiry; key revocation; changed artifact; exact repeated request; and changed bytes under one command ID. Include a squashed PR whose accepted tree differs from the executed artifact: fresh build/lineage evidence is required.

  Required named assertion:
  ```ts
  it("refuses a nonce for another bounty even with a valid signature", async () => {
    const f = scenario();
    await expect(verifyResidentAttestation(f.attestationBytes,
      { ...f.nonce, bountyId: "different-bounty" }, f.context)).rejects.toThrow();
  });
  ```
- [ ] Run `bun x vitest run src/lib/bounties/attestations.test.ts`; expect the targeted failures.
- [ ] Implement strict signature and all server-held binding checks. GitHub facts must come from `EvidenceContext`, never PR prose or commit email. Return a verified value only after all checks; do not mutate durable state during cryptographic verification.
- [ ] Rerun the tests, including two residents behind the same publisher and rejection of private-prompt/raw-trace fields. Expect exact signed-byte and lineage failures to remain explicit.
- [ ] Commit as `feat: verify resident bounty attestations and lineage`.

## Task 4 Global economic reservation contract

**Files:** Create `reservations.ts` and `reservations.test.ts`. Read the existing payment ledger without changing its schema or permanent reservation semantics.

**Interfaces:** Produce `assertBountyReservations(state: BountyState, context: EvidenceContext): void`, `reserveBountyCapacity(state: BountyState, terms: BountyTerms, context: EvidenceContext): CapacityReservation`, `reserveWorkUnit(state: BountyState, submission: VerifiedResidentSubmission, context: EvidenceContext): WorkReservation`, and `bindAwardReservation(state: BountyState, award: AwardRecord, context: EvidenceContext): AwardReservation`. Define/export those four record types in `contracts.ts` with exact source, amount, work identity, revision, and obligation references.

- [ ] Write tests that funded-open consumes backing immediately; selecting the award converts existing capacity without a second debit; another bounty/monthly reservation cannot use the same backing; an already paid or frozen monthly work unit blocks a bounty; changing bounty/resident/cycle identifiers cannot evade a work-unit conflict; unauthenticated submissions cannot reserve someone else’s work.

  Required named assertion, with the fixture instrument already occupied by a legacy reservation:
  ```ts
  it("cannot open a bounty on backing already reserved for monthly rewards", () => {
    const f = scenario();
    expect(() => reserveBountyCapacity(f.initialState, f.terms,
      f.contextWithLegacyReservation)).toThrow();
  });
  ```
- [ ] Run `bun x vitest run src/lib/bounties/reservations.test.ts`; expect the reservation cases to fail before implementation.
- [ ] Implement the shared accounting projection over existing monthly reservations and new bounty obligations. Legacy `PaymentReservation` v1 permanently reserves its instrument; never retire it or infer free capacity from a paid flag. New bounty work-unit IDs exclude bounty, resident, actor, and monthly cycle from identity. Equivalent lineage requires explicit reviewed reconciliation.
- [ ] Implement candidate proposal validation against an exact expected revision. The local proof must show two stale-base proposals cannot both be accepted by its test compare-and-swap store. Document that this proves the required storage contract, not production atomicity across GitHub merges, D1, or workers.
- [ ] Rerun focused tests plus `bun x vitest run scripts/payment-reservations.test.ts`. Prove held, disputed, unknown, partial, and executable payment states retain backing; insufficient refund capacity fails.
- [ ] Commit as `feat: enforce bounty capacity and work reservations`.

## Task 5 Candidate review and single award lifecycle

**Files:** Create `lifecycle.ts` and `lifecycle.test.ts`.

**Interfaces:** Produce `applyBountyCommand(state: BountyState, command: BountyCommand, context: EvidenceContext): TransitionResult` and `foldBountyEvents(initial: BountyState, events: readonly BountyEvent[]): BountyState`. Exact repeated command IDs/digests return the original result; different bytes under one ID fail. Commands check `expectedRevision` and append one coherent transition, including nonce consumption and submission creation together.

- [ ] Write tests that rejecting/withdrawing candidate A leaves candidate B and the opportunity intact; only one winning award exists; creator silence holds rather than approves; changed terms/beneficiary reset applicable windows; an owner or related-party reviewer cannot approve their award; Alice’s advisory record never satisfies a human approval requirement.

  Required named assertion:
  ```ts
  it("replays an accepted command without a second economic effect", () => {
    const f = scenario();
    const first = applyBountyCommand(f.initialState, f.submitCommand, f.context);
    const replay = applyBountyCommand(first.state, f.submitCommand, f.context);
    expect(replay).toEqual(first);
  });
  ```
- [ ] Run `bun x vitest run src/lib/bounties/lifecycle.test.ts` and observe the unmet assertions.
- [ ] Implement separate opportunity, submission, and award states, explicit authority checks, nonce consumption, review/dispute timing, and idempotency. Preserve submitted claims when opportunity expiry closes new submissions. Use Task 4’s reservation helpers for funded-open, submission work reservation, and award selection in the same accepted transition.
- [ ] Rerun focused tests and one event-replay test: folding the accepted events yields the same exact state and cannot mutate prior events. A stale expected revision rejects without consuming a nonce or creating a submission.
- [ ] Commit as `feat: model reviewed bounty submissions and awards`.

## Task 6 Settlement reconciliation without execution authority

**Files:** Create `settlement.ts` and `settlement.test.ts`.

**Interfaces:** Produce `previewBountySettlement(award: AwardRecord, state: BountyState, context: EvidenceContext): BountySettlementPreview`, `reconcileBountyPayment(preview: BountySettlementPreview, evidence: unknown, context: EvidenceContext): VerifiedBountySettlement`, and `previewBountyRefund(state: BountyState, refund: RefundDecision, context: EvidenceContext): BountySettlementPreview`. Define/export the named types in `contracts.ts`. Previews have kind `"bounty-settlement-preview"`, status `"non-executable"`, frozen principal/fee/refund legs, source and intent digests, and no transaction bytes, wallet deep link, signing request, or broadcast method.

- [ ] Write tests that wrong mint/network/source/destination/amount/finality fails; a signature alone cannot produce paid state; a duplicate transaction cannot settle another intent; fee and beneficiary legs sharing an owner reconcile exact aggregate deltas while retaining separate obligations; partial/unknown evidence remains held.

  Required named assertion:
  ```ts
  it("does not turn a transaction signature into paid state", () => {
    const f = scenario();
    const preview = previewBountySettlement(f.award, f.approvedState, f.context);
    expect(() => reconcileBountyPayment(preview,
      { signature: f.transactionSignature }, f.context)).toThrow();
  });
  ```
- [ ] Run `bun x vitest run src/lib/bounties/settlement.test.ts`; expect substantive failures.
- [ ] Implement exact-amount preview and verification by composing existing `assertFinalizedUsdcTransfer`, mint constants, and frozen bounty intents. Do not manufacture a monthly allocation or pass a fake cycle into `createSettlementExecutionPlan`. Settlement facts must include trusted finalized RPC observation context; transaction JSON alone is not proof of finality.
- [ ] Add post-signing hold/refund tests: an executable or possibly executable earlier intent blocks a replacement/refund until reconciled or demonstrably retired. A disputed submitted claim cannot be swept by expiry. Network/SOL costs are a separate reviewed obligation, never a USDC burn or implicit principal deduction.
- [ ] Rerun new tests and `bun x vitest run src/lib/solana-settlement.test.ts src/lib/settlement-plan.test.ts`; both historical verifiers and new reconciliation must pass.
- [ ] Commit as `feat: reconcile bounty settlement evidence without signing`.

## Task 7 Safe public projection and disabled production boundary

**Files:** Create `projection.ts` and `projection.test.ts`; extend the protocol document.

**Interfaces:** Produce `projectPublicBounty(state: BountyState, bountyId: string): PublicBountyView` and `assertLiveBountyActivation(): never`. Define/export `PublicBountyView` with identity/controller disclosure, safe evidence links/digests, exact terms/principal/fee, distinct funding/review/settlement states, beneficiary, and explicit fixture/disabled provenance.

- [ ] Write a test where private prompts, raw traces, credentials, and unapproved persona text are present in nonpublic fixture context; none may appear in the public projection. Prove paid/submitted/held/unfunded cannot collapse into a generic funded label. Calling the live entry boundary must fail before reading a wallet, contacting a signer, or creating an executable output.

  Required named assertion:
  ```ts
  it("never leaks private context or permits live activation", () => {
    const f = scenario();
    expect(JSON.stringify(projectPublicBounty(f.stateWithPrivateContext,
      f.terms.bountyId))).not.toContain(f.privateSentinel);
    expect(() => assertLiveBountyActivation()).toThrow();
  });
  ```
- [ ] Run `bun x vitest run src/lib/bounties/projection.test.ts`; observe the missing-boundary failures.
- [ ] Implement the allowlisted projection and an unconditional disabled live entry boundary. Do not introduce an environment variable, query parameter, or local flag that enables production behavior. The fixture runner calls pure simulation functions directly and is labeled as test-only.
- [ ] Verify no new production route, project manifest field, public CTA, automatic scorer eligibility, migration, credential binding, or workflow was introduced. Existing monthly fixtures retain the same serialized meaning.
- [ ] Rerun focused tests plus `bun run typecheck`; commit as `feat: expose safe bounty views behind disabled activation`.

## Task 8 One end-to-end proof and repository regression

**Files:** Create `scripts/prove-resident-bounty.ts` and `.test.ts`; modify `package.json` and finish the shared fixture.

**Interfaces:** Produce `proveResidentBounty(): Promise<{ scenarioDigest: string; finalStateDigest: string; checks: readonly string[] }>` and the package command `bounties:prove`. The runner uses only local synthetic fixtures, test keys, and a small exact-revision compare-and-swap test store. It makes no network request and creates no production record.

- [ ] Write a full behavioral proof: two residents share one App; one exact verified contribution wins after independent review; funded-open backing is converted once; finalized synthetic evidence settles exactly once. Include losing-candidate withdrawal and alternate blocked branches for replay, self-review, shortfall, frozen monthly work, pending dispute, and unsafe refund.

  Required named assertion after the runner itself checks the full real-module lifecycle:
  ```ts
  it("reproduces the complete accepted outcome without network or live authority", async () => {
    const first = await proveResidentBounty();
    expect(await proveResidentBounty()).toEqual(first);
    expect(first.checks).toContain("paid exactly once after finalized reconciliation");
  });
  ```
- [ ] Run `bun x vitest run scripts/prove-resident-bounty.test.ts`; observe failures until all real module boundaries are connected.
- [ ] Implement the proof runner with actual signature verification, real domain reducers, real exact-transfer verifier, and deterministic test-store races. Do not mock the validator under test or substitute `approved` booleans. Add `bounties:prove` to the existing `verify` chain without removing any check.
- [ ] Run `bun run bounties:prove` twice; expect identical digests and all named checks passing. Run focused tests, then `bun run verify` and `bun run test:e2e` from the exact head. Distinguish any blocked network/dependency/source-data check from a test failure; never claim the whole suite passed if it did not run.
- [ ] Inspect the final diff: no real funding record, key, private prompt, raw trace, generated public artifact, payment enablement, schema-v2 collision, or unrelated change. Commit as `test: prove the disabled resident bounty lifecycle`.

## Task 9 Draft PR and exact-head review

**Files:** Final spec, plan, protocol, code/tests, and `package.json` only; PR evidence is attached, not committed.

- [ ] Re-fetch canonical develop and open PR status. Recheck RFC 500 and the payment stack; if the reusable contracts changed, reconcile the plan and obtain review of any material authority/custody change. Rebase the scoped branch and rerun all affected checks plus aggregate verification on the final head.
- [ ] Obtain a fresh whole-branch code review emphasizing authority boundaries, nonce atomicity contract, shared backing, work-unit uniqueness, exact settlement, and disabled activation. Fix findings and rerun checks; do not self-approve or bypass repository policy.
- [ ] Prepare one accurate draft PR describing the local accepted-work outcome, source baseline, spec link, disabled/live distinction, actual checks, and explicit remaining activation gates. Do not split it into one PR per file or claim production bounties are supported.
- [ ] After execution/publication authorization is confirmed, push the exact reviewed commit to the verified head repository and open a draft PR targeting canonical `SlopDotCash/slopdotcash:develop`. Never use the old fork PR 1 as the base. Verify remote SHA and head/base identities before reporting the link.
- [ ] Observe required CI for that exact head to a terminal result; diagnose failures and safely fix authorized implementation issues. Report external blockers. No merge, deployment, live funding, credential setup, or activation is included.

## Required follow-on integration before any pilot

These are separate finite deliverables after the foundation review, each requiring a scoped implementation plan. They are not silently included in the first PR’s completion claim.

1. **Production admission and authoritative state:** implement authenticated resident/beneficiary onboarding, durable nonce consumption, replay-safe submissions, and a single authoritative commit boundary for economic reservations. Prove that concurrent monthly and bounty writers cannot bypass each other. A file check or in-process lock is insufficient. Integrate the canonical trusted-base review/admission history and exact-head checks before any new record can become authoritative.
2. **Reviewed project and public product integration:** reconcile schema evolution with any landed Delegate work, add explicit project policy binding with disabled historical defaults, admit the real public repository with licenses/terms, and wire read-only UI loading/empty/stale/invalid/error states. Integrate monetary exclusion of bounty-reserved work into monthly proposal generation without changing scores or frozen historical proposals; this must precede any live bounty submission.
3. **p3ts adapter:** separately plan the trusted run attester, reviewed public publication manifest, sandboxed job and Ops build pipeline, owner/controller proof, and the narrowly scoped publisher App. Use the foundation’s envelope and failure tests. Keep Alice’s persona public and approved, with advisory authority only. No private repository history or assistant memory enters the public repository.
4. **Live unsigned-plan release and pilot readiness:** implement source/instrument verification, current signer checks, exact reserved-plan release, supported independent signing instructions, finalized settlement, and refund/dispute administration. Resolve amount, funder, beneficiary, wallet, fees, costs, reviewers, deadlines, remedies, and signers. Test operational safety and failure handling before proposing activation. Slop still must not sign, broadcast, or hold keys.

The p3ts SOL/USDC purchase flow remains its own design. This work never substitutes USDC for the existing adoption or skill-upgrade burn mint.

## Coverage and completion

Identity and owner changes are covered by Task 2; attestation, public-data minimization, and exact lineage by Tasks 1/3/7; beneficiary proof by Task 2; candidate competition, independent decisions, review timing, and disputes by Task 5; duplicate work and shared backing by Task 4; finalized payment/refund invariants by Task 6; compatibility and a complete local outcome by Task 8; exact-target publication and CI by Task 9. Production authorization/storage/UI/pilot concerns are explicitly assigned to the four follow-on deliverables above.

Foundation completion means a verified disabled implementation and draft PR with accurate evidence. It does not mean merge, deployment, live bounty admission, or payment readiness. Stop at that boundary unless the user separately authorizes the next reviewed stage.

## Execution recommendation

Use **task-by-task implementation with independent review after each task**, then a whole-branch review. The identity and economic contracts cross several modules; discovering a mismatch before its dependent task starts is worth the extra review. Keep Tasks 1–6 sequential; do not parallelize changes to shared contract types. Independent read-only source checks and final evidence preparation may run alongside implementation.

The alternative is **one implementation pass with independent review at the end**. That is faster, with fewer intermediate review points.

**Review requested:** Does this disabled first-PR plan capture the intended scope, and should execution use the recommended task-by-task review method or one implementation pass with review at the end? Product changes wait for that answer.

## Verified source references

- [Canonical contribution rules](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/CONTRIBUTING.md)
- [Canonical repository instructions](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/AGENTS.md)
- [Pinned package and verification commands](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/package.json)
- [Permanent legacy reservation contract](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/src/lib/payment-reservations.ts)
- [Trusted reservation checker](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/scripts/check-payment-reservations.ts)
- [Exact finalized USDC verification](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/src/lib/solana-settlement.ts)
- [Existing project schema](https://github.com/SlopDotCash/slopdotcash/blob/9a7a313d7fee6ebae51dc5b0856b6031af7a2792/src/lib/project-schema.mjs)
- [Fork-local Delegate draft PR](https://github.com/rndrntwrk/slopdotcash/pull/1)
- [Unmerged vault RFC requiring compatibility review](https://github.com/SlopDotCash/slopdotcash/issues/500)
