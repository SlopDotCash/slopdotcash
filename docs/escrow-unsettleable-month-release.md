# Escrow: release of an unsettleable monthly reserve

Status: proposed contract change. It is not deployed. It needs a reviewed
upgrade and testnet qualification on each network before use.

Source: owner action list on issue #914, and the owner decision of 25 October
2026: "Plan a contract fix: design a reviewed contract change that lets the
owner release an unsettleable month's reserve (needs a new upgrade and testnet
qualification)."

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
- The attester lost the tree, or signed a root that no leaf set opens.
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
section 11, "Accepted attester-compromise risk"). The release does not add a
new power to the attester.

If the attester key is lost, the existing rotation path installs a new
identity authority. The new authority signs the release. A signature from a
rotated-out authority does not verify.

### 3.2 What the attester must prove before it signs

The contract cannot prove that a leaf can never settle. The attester proves
it off-chain, in the same way that it checks sources before admission (EVM
README, "The trusted attester rejects duplicate sources before signing"). The
attester signs only when all of these are true at one finalized block:

1. The month has a reserve, and its unsettled gross equals the value it signs.
2. Every leaf that can settle has settled. The keeper or the attester sends
   each such leaf first. Leaf settlement is permissionless.
3. For each remaining leaf, a dry run of the settle call fails for a reason
   that a retry cannot fix, or the leaf data cannot exist (the root total and
   the signed total differ, or the tree is lost).
4. The released amount is exactly the gross that items 2 and 3 show can never
   settle. If the tree is lost or the totals disagree, that is all of the
   unsettled gross.
5. The cause is an attester fault. The attester does not sign for gross that
   the Solana rules keep reserved on purpose: a source that the owner consumed
   after the freeze with a smaller award, or with an award to another actor.
   A release there would refund the gap to the owner.

The attester records the evidence for items 1 to 5 before it signs.

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

The release can be partial. The attester can release only the faulty gross
and leave settleable leaves reserved. After a partial release, a leaf still
settles while its gross fits the unsettled remainder.

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

1. An attester signing route for the release. It must apply section 3.2 at one
   finalized block and keep the evidence.
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

The pending EVM V2 upgrade kit (`contracts/DEPLOY-MAINNET.md` section 4)
targets source `dd1af34d`. This change makes a different vault implementation,
so that kit's addresses and code digests do not apply to it. Mainnet EVM
vaults do not yet run V2, so no mainnet EVM vault can have this fault today.

## 6. Alternatives considered

| Alternative | Why it was rejected |
| --- | --- |
| Release after a waiting period, by the owner alone | Time alone would release a reserve. This breaks the PRD rule that funded awards never expire. |
| On-chain proof only (extend the Solana per-leaf release to EVM) | It cannot cover whole-tree faults: a lost tree, or a signed total that differs from the tree. Those faults block the owner just the same. The existing Solana per-leaf release stays. |
| The attester alone, or anyone with the attester's signature | The owner decision gives the release to the owner. Two parties are safer than one. |
| The owner with the registrar or rotation authority | That key does not know the allocation tree and cannot check section 3.2. The rotation path already lets the registrar install a new attester that can sign. |
| Release the whole remainder only | A month can have both settleable and faulty leaves. A partial release lets the faulty part go and keeps the rest protected. |
| Let the period admit again after a release | One commitment per period is a required rule. Manual awards cover the corrected month. |
| Remove the manual-award block | The block protects the sources of funded leaves. Removing it lets the owner take a leaf's source by hand. |

## 7. Testnet qualification plan

Run these steps for each network on the public testnet, from the exact
reviewed source. Do not use mainnet.

1. Build the exact source. Record the EVM implementation code digests and the
   Solana program `codeSha256`.
2. Deploy the current reviewed implementation and create a funded vault or
   project. Admit a month with a deliberately faulty tree (a repeated source,
   and a signed total that differs from the tree). Settle every settleable
   leaf. Confirm that the owner's manual award fails.
3. Upgrade to the new implementation. Confirm that all counters, awards,
   bindings, and the stuck reserve are unchanged.
4. Confirm each failure: a non-owner sender, a signature from another key, a
   rotated-out authority, a stale unsettled value, a zero amount, an amount
   above the unsettled gross, and a replay.
5. Do a partial release. Settle the remaining settleable leaves. Do a final
   release if gross remains. Confirm that the manual award now succeeds.
6. Read `totals()` (EVM) or the project counters (Solana) at a finalized block.
   Confirm the conservation identities and that the event matches the state.
7. Pay one settled leaf. Confirm the exact net payment and the 2% fee.
8. Rotate the identity authority. Confirm that only the new authority's
   release signature verifies.
9. Attach the transaction identities, code digests, and the read results to
   the release issue.

Local evidence for this revision:

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
