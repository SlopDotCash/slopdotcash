# August 2026 direct payments

On 11 and 12 September 2026, 72 finalized USDC transfers totalling
**6,004.977346 USDC** were signed and broadcast on Solana mainnet for the
August 2026 contribution month. They did not go through the verified settlement
flow. At the time of writing the public record still reports nothing paid,
because `funding/executions/ledger.json` and `funding/payment-reservations.json`
are both empty, there is no `cycles/eliza/2026-08` or `cycles/asi/2026-08`, and
every project is still `paymentMode: "disabled"` with `committedMinor: "0"`.

This document and the two JSON files beside it record what happened. They
authorize nothing, approve nothing, and create no claim.

## What moved

| Pool | Cap | Transfers | Sent | Rows | Date |
| --- | --- | --- | --- | --- | --- |
| eliza | 10,000.00 | 53 | 4,219.710147 | 108 | 11 Sep, 17:12 to 17:27 UTC |
| asi | 5,000.00 | 19 | 1,785.267199 | 26 | 12 Sep, 00:42 to 00:57 UTC |
| **Total** | | **72** | **6,004.977346** | | |

No platform fee transfer was sent for either pool.

## Where the rest of each pool is

| | eliza | asi |
| --- | --- | --- |
| `paid-direct` | 53 rows, 4,219.710147 | 19 rows, 1,785.267199 |
| `unclaimed`, no wallet frozen | 33 rows, 5,757.805377 | 7 rows, 3,225.860294 |
| `held-below-minimum` | 22 rows, 22.484468 | none |
| With a wallet, above the minimum, unpaid | **none** | **none** |

Every contributor whose wallet was frozen in the preparation and whose
entitlement cleared the 2.00 USDC minimum received a transfer. The unsent
balance is almost entirely entitlement that no wallet can receive yet.

This does not support the 624.72 USDC of silently skipped recipients reported
in [#455](https://github.com/SlopDotCash/slopdotcash/issues/455). Reconciling
every row in both preparations against the observed transfers finds no
contributor with a frozen wallet and an entitlement above the minimum who went
unpaid. Where a recipient's associated token account appears absent today, the
account was closed after the transfer landed, so the transfer itself is still
on chain.

## The basis each pool actually used

A preparation freezes weights, not amounts. Reconstructing the amounts means
recovering the cap, the denominator and the rounding the sender applied. The
two pools did not use the same method.

**eliza** used `round_half_up(10_000_000_000 * weight / 120_750_000)`. The
denominator is the published preparation total of 120,540,000 **plus** the
210,000 of weight that [#434](https://github.com/SlopDotCash/slopdotcash/pull/434)
restored after the preparation was frozen, and the two affected numerators were
raised to match. Because numerator and denominator were both corrected, the
allocation sums to 9,999.999989 USDC, inside the 10,000 cap.

50 of the 53 transfers reproduce exactly. Three are one minor unit
(0.000001 USDC) above what half-up rounding gives, three micro-USDC in total.
No single uniform rate and rounding mode reproduces all 53, so the payout is
not bit-reproducible from any published artifact.

This settles the open question on
[#458](https://github.com/SlopDotCash/slopdotcash/pull/458) about why eliza did
not reconcile: the reported 7,466,401 against 7,453,416 is exactly the ratio
120,750,000 / 120,540,000. The allocator was reading the published denominator
while the sender had already moved to the corrected one.

**asi** used `round_half_up(5_000_000_000 * weight / 17_973_500)`, the published
denominator, unchanged. 16 of the 19 transfers reproduce exactly. Three rows
were paid as though they held additional weight:

| Row | Published weight | Implied weight | Excess paid |
| --- | --- | --- | --- |
| `ss251` | 1,260,000 | 1,280,000 | 5.563747 |
| `Svector-anu` | 830,000 | 840,000 | 2.781873 |
| `rama0x1` | 196,500 | 206,500 | 2.781873 |

Because the numerators moved and the denominator did not, the asi allocation
sums to **5,011.127493 USDC, or 11.127493 above the published 5,000 cap**. No
published artifact records these three adjustments, so the disclosure derives
them from the observed amounts and says so on each row.

Whether they are a legitimate unpublished score correction or an error is a
question for the creator. This document does not decide it.

## Two wallet bindings that did not come from the frozen preparation

- `Svector-anu` has `wallet: null` in `funding/preparations/asi-2026-08.json`
  and was nonetheless paid 233.677358 USDC, at the address frozen for that
  contributor in the **eliza** preparation.
- `FreeSolDev` has `EU8ZXW65rMfw8o7py5kzahJiGqh8Dh9uaGcMAysu3hXi` frozen in the
  asi preparation and was paid 25.036860 USDC at
  `soAVqvYm8vceoycnVjnwYj74YRaWHMBYYSiz6hUFBCc`, again the eliza address.

Both rows carry a `walletAnomaly`. Recipients are unaffected in amount, but the
asi transfers were not addressed from the artifact that was supposed to bind
them.

## The sending wallet

Every signature is published here. Signatures resolve to their sender on any
explorer, so the sending wallet is one click away and has been since a
contributor posted one of these signatures on
[#406](https://github.com/SlopDotCash/slopdotcash/issues/406) on 14 September.
This record still does not assert the address as a field, because the creator
has not been asked whether to publish it and the record does not need it. Say
the word and it goes in.

## What this record does not do

It does not adopt a successor preparation, change any score, bind a wallet
registered after a preparation was frozen, approve an allocation, or send
anything. Those remain open on
[#406](https://github.com/SlopDotCash/slopdotcash/issues/406).

On the wallet question specifically, `cycles/README.md` already states the
governing rule: wallets are cut off at `generatedAt`, a wallet observed after
the artifact was generated applies to the next cycle, and the row stays
`unclaimed` and carries forward. Applying that rule to the outstanding requests
is a creator decision, not something this record can make.
