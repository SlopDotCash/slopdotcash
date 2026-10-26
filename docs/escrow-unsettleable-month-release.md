# Escrow: release of an unsettleable monthly reserve

Status: contract change in review (PR #1271), bundled into the pending EVM V2
upgrade. It is not deployed. It needs the reviewed upgrade and testnet
qualification on each network before use. Section 9 records the owner
decisions.

Source: owner action list on issue #914, and the owner decision of 25 October
2026: "Plan a contract fix: design a reviewed contract change that lets the
owner release an unsettleable month's reserve (needs a new upgrade and testnet
qualification)."

The [owner decision of 26 October 2026](https://github.com/SlopDotCash/slopdotcash/issues/914#issuecomment-6405648518)
selects inclusion in V2, no readmission of a period, and no signature expiry.
A changed reserve or authority still invalidates the signature. The pending
upgrade kit must be rebuilt and rehearsed for these new bytes.

## 1. The problem

A monthly allocation moves through two steps:

1. **Admission.** Anyone submits the month with a signature from the identity
   authority (the attester). The vault moves the month's unfunded gross from
   the free balance into a monthly reserve.
   - EVM: `reserveMonthly` adds the gross to `pendingMonthlyGross` and to
     `monthlyReserves[period].remaining`.
   - Solana: `commit_monthly` adds the total to `reserved` and to
     `monthly_outstanding`.
2. **Leaf settlement.** Anyone proves one award (a leaf) against the signed
   Merkle-sum root. The leaf's gross moves from the monthly reserve into an
   ordinary award reserve.

While a monthly reserve is not zero, the owner cannot commit a manual award
(EVM `MonthlyLeavesPending`, Solana `MonthlyOutstanding`). This rule stops the
owner from taking the source of a funded leaf by hand.

An **attester fault** is a signed admission that can never settle completely.
Examples:

- The signed total does not equal the sum of the leaves in the tree.
- A complete retained tree reproduces the committed root, but its authenticated
  sum contradicts the stored total. Missing tree data is not proof of a fault.
- The tree repeats a source. Only one copy can settle.
- A leaf has an invalid field (for example, actor 0 on EVM) or a source that a
  different month already consumed.

The contract cannot detect these faults at admission, because admission is
constant-size and does not read the leaves. Solana already releases some
single-leaf cases with `release_monthly_award` (actor 0, or a source that
already pays the same actor at least the same gross, or a source consumed
before the freeze). EVM has no release path. Whole-tree faults have no release
path on either network.

Result today: the unsettleable gross stays reserved for all time. The owner's
manual awards on that vault stay blocked until a contract upgrade. Payments,
deposits, free withdrawals, and later monthly admissions still work (PRD
section 11, "Funded-award expiry").

## 2. Requirements that the fix must keep

| Requirement | Source |
| --- | --- |
| Approved funded awards never expire. Time alone never releases a reserve. | PRD section 11, Funded-award expiry |
| Reserved awards and fees cannot be withdrawn. | PRD section 6 |
| One commitment per period, within the owner's cap, with the owner's opt-out. | PRD section 11, Contracts before launch |
| Replay protection, 2% fee rules, existing reserves and funded fees stay. | PRD sections 6 and 11 |
| Slop holds no keys. The owner and the identity attester keep their roles. | PRD sections 6 and 11 |
| Storage and account layouts stay compatible with deployed contracts. | `contracts/DEPLOY-MAINNET.md` section 4.1; Solana README, "Project account layout" |

## 3. The change

### 3.1 Who can trigger the release

Only the **vault owner** can send the release. Two parties must agree:

- The owner sends the transaction.
- The **identity authority in force** signs the release. On EVM this is
  `factory.identityAuthority()`. On Solana this is `project.identity_authority`.

The owner alone cannot release, because the owner could then take back gross
that a recipient can still settle. The attester alone cannot release, because
the owner decision gives the release to the owner. The attester already has a
larger power over unpaid awards: it can bind a wallet that it controls (PRD
section 11, "Accepted attester-compromise risk"). This accepted compromise risk does not prove a reserve is unsettleable. The
new release still depends on a correct fault classification and the owner
transaction; the contract does not independently prove that classification.

If the attester key is lost, the existing rotation path installs a new
identity authority. The new authority signs the release. A signature from a
rotated-out authority does not verify.

### 3.2 What the attester must prove before it signs

The contract enforces the owner, current identity authority, exact reserve and
amount. It does not prove the fault. Missing local tree data never authorizes
release: another keeper or contributor may still hold a valid proof. Provider
failure, a failed supplied proof, and a generic simulation error also prove
nothing about permanent eligibility.

The read-only EVM inspection in `contracts/evm/monthly-reserve.ts`,
`inspectEvmMonthlyWrongSum`, qualifies only this conservative case:

1. The complete retained ordered tree passes the existing canonical builder.
2. Its allocation digest, root and count match the recorded month exactly.
3. Its authenticated sum differs from the immutable stored total.
4. The entire original total remains unsettled; no prior reserve transition
   needs separate reconciliation.
5. The reviewed deployment and current authority verify at one finalized
   block. The block hash remains canonical after all reads.

The result binds the complete entries hash, allocation digest, root, count,
computed and stored totals, remaining amount, deployment and finalized block.
It is evidence only. It does not produce a signature or release transaction.
A healthy tree, missing capture, mismatched root/count/digest, or already
changed reserve stays held. Malformed input, an unavailable provider, or a
noncanonical block refuses the inspection. No existing signer calls it yet.

A contradictory authenticated sum prevents every valid proof from satisfying
the stored sum check. This case releases the full still-unsettled total only.
Other whole-tree and per-leaf faults remain unqualified by this inspection.

The read-only Solana inspection in `contracts/solana/monthly-reserve.ts`,
`inspectSolanaMonthlyWrongSum`, checks the same narrow fault against the
program's Merkle sum rule. It reuses the canonical allocation builder and
requires the root to match an untouched, nonexpired month's stored root while
the authenticated sum differs from its stored total. Both `committed` and
`released` must be zero. Solana does not store a separate allocation digest or
leaf count; the result records the retained entries hash and count without
claiming separate on-chain checks for them.

The project and month come from one finalized account batch. The reviewed
program must have been effective before that slot; Config and project roles
must verify. The inspector checks unchanged project/month bytes and the
slot's canonical block hash after the reads. Its result binds the current
identity authority, deployment, period, root, totals and finalized slot.
Missing data, provider errors, a changed snapshot, a healthy root or a prior
reserve transition cannot produce positive evidence. It emits no signature
or transaction and no existing signer calls it.

The unsigned owner builders `prepareEvmMonthlyWrongSumRelease` and
`prepareSolanaMonthlyWrongSumRelease` rerun these inspections from the complete
retained allocation. They accept a caller-supplied attestation, never a key,
claimed fault or chosen release amount. They verify that signature against the
freshly observed authority and the release message. They release only the full
untouched wrong-sum reserve. No service obtains authority to issue that signature.

The EVM builder checks the latest reviewed deployment and simulates the exact
zero-value owner call. The Solana builder reuses the existing unsigned-wallet
planner for a fresh blockhash, fee, owner balance and finalized simulation. The
owner-plan CLI exposes it as `release-monthly-wrong-sum`, with `period`,
`capture.entries` and `attestation` (64-byte Ed25519 signature as hex). Build
the reviewed module first with `bun build monthly-reserve.ts --target=node
--outfile=.local/monthly-reserve.mjs` from `contracts/solana`.

The plans contain no owner signature and do not broadcast. A rotation, reserve
transition or changed deployment refuses a new plan. The contracts repeat the
authority and exact-remainder checks when the owner transaction executes, so a
later change can still make a prepared plan revert. There is no time-based
attestation expiry or readmission of the period.

For any future qualified per-leaf path, settle every settleable leaf first,
then reread finalized state. Preserve Solana's existing deliberate hold for a
source consumed after the freeze with a smaller award or another actor.
Never treat that hold as a refundable attester fault. Such a path needs its
own positive predicate and retained evidence before signing is enabled.

### 3.3 The signed message

The signature binds the exact state. A leaf that settles after the signature
changes the unsettled gross, so the signature becomes stale and fails.

EVM: an EIP-712 message in the existing vault domain (`SlopProjectEscrow`,
version `5`, chain ID, vault address), with a new type:

```text
MonthlyRelease(uint32 period,bytes32 allocationDigest,bytes32 allocationRoot,uint128 remainingGross,uint128 releasedGross)
```

`monthlyReleaseDigest(period, remainingGross, releasedGross)` returns the
digest. The contract reads `allocationDigest` and `allocationRoot` from its
own storage for that period.

Solana: an Ed25519 program check, in the instruction just before the release,
over these bytes:

```text
"slop-monthly-release-v1" || program ID || project || period (u32 LE)
|| allocation root || total (u64 LE) || unsettled (u64 LE)
|| released (u64 LE) || network domain
```

The type and prefix are new. An admission, binding, or older signature never
verifies as a release.

### 3.4 Exactly which amount is released

| | EVM `releaseMonthlyReserve(period, expectedRemaining, releasedGross, attestation)` | Solana `release_monthly_reserve(period, expected_unsettled, released)` |
| --- | --- | --- |
| Unsettled gross | `monthlyReserves[period].remaining` | `month.total - month.committed` |
| Stale check | `remaining == expectedRemaining`, else `MonthlyReserveChanged` | `unsettled == expected_unsettled`, else `MonthlyReserveChanged` |
| Amount | `0 < releasedGross <= remaining`, else `InvalidInput` | `0 < released <= unsettled`, else `InvalidAmount` |
| Month record | `remaining -= releasedGross`; `monthlyReleased[period] += releasedGross` | `committed += released`; `released += released` |
| Vault counters | `pendingMonthlyGross -= releasedGross`; `freeBalance += releasedGross` | `reserved -= released`; `monthly_outstanding -= released` (not for a legacy expired month) |
| Fee | None. The fee applies only at payout or at a later free withdrawal. | None |

The contract primitive accepts partial amounts. This is not a qualified
partial-release policy. The read-only wrong-sum inspection above permits only
the full untouched remainder. Other release cases stay held until their
classifier proves the exact faulty gross and all settleable leaves have
already settled. The existing partial-amount contract tests prove accounting
mechanics only; they do not authorize release before healthy leaves settle.

### 3.5 What stays reserved

- Every committed award, with its principal and its fee. The release does not
  read or change `reservedPrincipal`, `reservedFees`, obligations, or
  `accruedFees`.
- Any unsettled gross that the release does not include.
- Every other month's reserve.

The period stays committed (`monthlyRoots[period]` on EVM, the `month` account
on Solana). A second admission for the same period still fails. The owner can
pay a corrected allocation for that month with manual awards, because the
release removes the block.

### 3.6 Events

- EVM: `MonthlyReserveReleased(uint32 indexed period, bytes32 allocationDigest, uint128 remainingGross, uint128 releasedGross)`.
- Solana: `MonthlyReserveReleased { project, period, unsettled, released }`.

## 4. Keeper, scanner and API reconciliation

The vault totals stay consistent. The release moves gross from the monthly
reserve to the free balance, so these EVM identities still hold:

```text
totalDeposited = freeBalance + reservedPrincipal + reservedFees + pendingMonthlyGross
               + totalPaid + totalPayoutFees + totalGrossWithdrawn
vault balance  = freeBalance + reservedPrincipal + reservedFees + pendingMonthlyGross
               + accruedFees + unsolicited direct transfers
```

On Solana, `free = deposited - paid - payout_fees - withdrawn_gross - reserved`
increases by the released gross. `readVaultTotals` needs no change on either
network.

Monthly executors:

- EVM (`contracts/evm/monthly-reserve.ts`) reads `monthlyReserves(period)`.
  After a full release, `remaining` is zero and the month is complete. After a
  partial release, the executor continues to send the settleable leaves.
- Solana (`workers/payment-executor/solana-monthly.ts`) treats a month as
  complete when `committed == total`. A full release, or a partial release
  followed by all settleable leaves, reaches that state.

Off-chain work that this change does **not** include. It must merge before a
live project uses the release:

1. An attester signing route for the release. It must consume a qualified
   section 3.2 result, reread its exact state immediately before signing, and
   keep the evidence. The current read-only EVM inspection adds no signing
   power. Both read-only inspections qualify only the complete wrong-sum case.
2. An owner transaction builder (EVM calldata; Solana instruction with the
   Ed25519 check), in the existing owner-plan tools.
3. Scanner and API support for the new event. The API shows the released gross
   as "released to the project by owner and attester", never as paid. The
   affected awards of the month show as excluded with the release transaction,
   not as approved or scheduled.
4. A pinned review revision for the new implementation code digests
   (`evmUpgrade` and Solana `codeSha256`), as in `contracts/DEPLOY-MAINNET.md`.

## 5. Storage and account compatibility

EVM (`ProjectEscrow`): one new mapping is appended after the last V2 field.

| Field | Slot | Byte offset |
| --- | --- | --- |
| `pendingMonthlyGross` (`uint128`) | 18 | 1 (unchanged) |
| `ordinarySourceSequence` (`uint256`) | 19 | 0 (unchanged) |
| `monthlyReserves` (mapping) | 20 | 0 (unchanged) |
| `monthlyReleased` (mapping `uint32 => uint128`) | 21 | 0 (new) |

`forge inspect ProjectEscrow storageLayout` shows the same slot, offset, name
and type for every existing field: slots 0 to 20 of `origin/development`, and
slots 0 to 17 of the deployed mainnet source `bce5b0df`. Only compiler AST
numbers in the type names differ. The factory does not change. No initializer or migration
call is necessary. The vault runtime grows from 21,548 to 22,752 bytes, which
is below the 24,576-byte limit.

Solana: no account changes. The release uses the existing `released` and
`committed` fields of the 109-byte `MonthlyAllocation` and the existing
`reserved` and `monthly_outstanding` fields of the 332-byte `Project`. The
change adds one instruction, one event, and one error code at the end of the
error list, so existing error codes keep their numbers.

Base's factory received the previous V2 implementation from `208fbf5b` /
`dd1af34d` at finalized block `53093023`, as recorded in the
[owner's deployment update](https://github.com/SlopDotCash/slopdotcash/issues/904#issuecomment-6405728213).
That template does not include this release. The owner decided to bundle this
change into V2 (section 9). On 26 October 2026 the reviewed kit in
`contracts/DEPLOY-MAINNET.md` section 4 installed the bundled vault
implementation on Base, Ethereum and Robinhood (finalized record in that file,
"Bundled monthly reserve V2 upgrade"): the vault implementation
`0x90C46e3E5be35B1048cD69403d1402Feed1240D8` (runtime SHA-256
`155c7ea2fdeeaeccfd6daac64b6105e968c1927092f8761f34090a8b42e15bfc`). On Base
the factory implementation did not change. The Solana program hash `d29200ec…`
from source `edf3b341` is superseded; the deterministic Solana build must be
redone from the final merged source.

## 6. Alternatives considered

| Alternative | Why it was rejected |
| --- | --- |
| Release after a waiting period, by the owner alone | Time alone would release a reserve. This breaks the PRD rule that funded awards never expire. |
| On-chain fault proof | A bound sum proof could establish the demonstrated wrong-total fault, but needs a different contract proof interface. The current primitive instead trusts a qualified off-chain classifier and both authorities. Neither design can infer a fault from a lost local tree. The existing Solana per-leaf release stays. |
| The attester alone, or anyone with the attester's signature | The owner decision gives the release to the owner. Two parties are safer than one. |
| The owner with the registrar or rotation authority | That key does not know the allocation tree and cannot check section 3.2. The rotation path already lets the registrar install a new attester that can sign. |
| Release the whole remainder only | This is the only amount qualified by the current wrong-sum inspection. The contract supports partial amounts, but a mixed-leaf classifier and its ordering remain unqualified. |
| Let the period admit again after a release | One commitment per period is a required rule. Manual awards cover the corrected month. |
| Remove the manual-award block | The block protects the sources of funded leaves. Removing it lets the owner take a leaf's source by hand. |

## 7. Testnet qualification plan

Run these steps for each network on the public testnet, from the exact
reviewed source. Do not use mainnet.

1. Build the exact source. Record the EVM implementation code digests and the
   Solana program `codeSha256`.
2. Deploy the current reviewed implementation and create a funded vault or
   project. Retain a complete canonical tree. Admit its exact root and count
   with a stored total that differs from its authenticated sum. Confirm all
   actual proofs fail the sum check and the owner's manual award fails.
   Separately prove a healthy allocation is held by the classifier and its
   leaves still settle. Missing and mismatched captures must never authorize
   a release. The Solana classifier must be implemented and qualified first.
3. Upgrade to the new implementation. Confirm that all counters, awards,
   bindings, and the stuck reserve are unchanged.
4. Confirm each failure: a non-owner sender, a signature from another key, a
   rotated-out authority, a stale unsettled value, a zero amount, an amount
   above the unsettled gross, and a replay.
5. Apply the full release of the positively classified wrong-sum reserve.
   Confirm that the manual award now succeeds. Other fault classes and partial
   releases need separate qualification; do not use this result for them.
6. Read `totals()` (EVM) or the project counters (Solana) at a finalized block.
   Confirm the conservation identities and that the event matches the state.
7. Pay a separately committed award retained before the release. Confirm its
   unchanged principal, exact net payment and 2% fee.
8. Rotate the identity authority. Confirm that only the new authority's
   release signature verifies.
9. Attach the transaction identities, code digests, and the read results to
   the release issue.

Local evidence for this revision (contract primitives and classifier results
are separate):

- `contracts/evm/monthly-reserve.integration.ts` calls the actual read-only
  inspection against local Anvil admissions. It checks a healthy tree, an
  exact-root wrong-sum admission, missing/mismatched captures, wrong count,
  wrong code, and a noncanonical block. Reads cannot change the reserve.

- `contracts/evm/test/MonthlyReserveV2.t.sol` tests the full release, the
  partial release with later leaf settlement and payment, stale and replayed
  signatures, the wrong signer, another vault's signature, a non-owner sender,
  and a rotated authority.
- `contracts/evm/test/OpusInvariant.t.sol` adds the release to the random
  handler. The supply, balance, and monthly reserve invariants still hold.
- `contracts/solana/integration/escrow.e2e.mjs` tests the same rules on a
  local validator with a tree that repeats a source.

## 8. Proposed PRD wording (for the maintainer)

Replace the "Consequence" sentence of the "Funded-award expiry" row in PRD
section 11 with this text:

> If a signed monthly allocation can never settle (an attester fault), the
> owner can release only its unsettleable gross to the free balance. The
> release needs the owner's transaction and a fresh identity-attester
> signature over the month's exact unsettled gross. The attester signs only
> after every settleable leaf has settled and the fault is recorded. Committed
> awards and settleable leaves stay reserved, and the period stays committed.
> Time alone never releases a reserve.

## 9. Owner decisions (25 October 2026, in chat)

| Question | Decision |
| --- | --- |
| Upgrade path | "Bundle into V2." Fold the release into the pending EVM V2 mainnet upgrade before it runs. The kit in `contracts/DEPLOY-MAINNET.md` section 4 is recomputed and rehearsed again for the bundled vault. |
| Re-admission after a release | "No, manual awards." Keep one commitment per period. The owner pays a corrected month with manual awards after the release. |
| Expiry | "No expiry." Funded awards and reserves never expire. Only the signed owner release in this document returns unsettleable gross. |
