# Maintainer payout flow

Open a project's **Funding → Monthly payout review** in the app. The project
manifest supplies its funding policy and each month's cap. A preparation is a
review aid; the published cycle supplies frozen wallets, approvals, and payments.

1. **Review recipients.** Select the contribution month. Inspect the complete
   census and filter missing wallets. Keep, adjust, or exclude a contributor with
   a public reason. Exclusion preserves the original row and does not redistribute
   its award. Save a local draft or download the review for GitHub review.
2. **Resolve receiving addresses.** Contributors use `/wallet` to authenticate
   their GitHub identity and explicitly register a public Solana address. A
   registration identifies a requested destination; it does not prove wallet
   control. Run the linked preparation workflow in `refresh-wallets` mode for
   the selected project/month and review its PR. Failed lookups remain explicit.
   A published proposal's wallet is locked for that cycle; later observations
   cannot silently change it. Missing wallets stay unclaimed.
3. **Review the monthly vault.** Use existing Phantom accounts or create dedicated
   accounts in Phantom. The funder and independent co-signer provide public
   addresses and GitHub identities through the app's funding intake. Review the
   exact Squads v4 configuration, monthly instrument, fee destination, signer
   capability evidence, and payout policy through GitHub before depositing.
   Each monthly vault has exactly the two reviewed members and a threshold of
   two. Loss of either key can make its funds inaccessible; Slop has no recovery
   key or configuration authority.
4. **Fund and verify.** After configuration and protocol review, use Phantom to
   deposit Solana mainnet USDC into the exact reviewed vault. The app displays
   the draft principal and maximum platform fee; only approved principal incurs
   the fee. Retain SOL for external transaction fees and any recipient token
   accounts paid for by the vault. Submit the public deposit signature using the
   verification workflow. A signature submission or observed balance alone is
   not an approved commitment or payment authorization.
5. **Publish and review the funded proposal.** Use the selected-project reward
   workflow after funding verification. Never freeze an unfunded preparation as
   a zero-dollar payout. Review lasts 14 days. Material amount adjustments create
   a reviewed successor and restart review; related-party awards require separate
   approval. The app exports a validated successor only for an active review.
6. **Approve and reserve.** The approval workflow creates a reviewable allocation
   PR. An unsigned plan must bind that exact approved allocation and an accepted
   global reservation on protected `develop`. Reservations prevent overlapping
   plans from reusing principal or payout intents. They are not retired by a
   timeout, cancellation, retry, or reported signer loss.
7. **Sign externally.** Review the recipients and exact amounts in Squads. The
   two members approve there and an authorized member executes. Slop does not
   create keys, sign, or broadcast. An unsigned Slop JSON plan is not a documented
   Squads UI import format. Do not assume a large payout fits one Solana
   transaction merely because its instructions pass a decoding test.
8. **Verify settlement.** Link the reviewed Squads proposal and submit finalized
   transaction evidence through GitHub. The app checks the linked proposal's
   instructions against the frozen plan and shows its observed status. Even an
   executed proposal is not displayed as paid until finalized source/destination
   deltas reconcile every intent and fee in the canonical settlement record.

All workflow links run trusted `develop` code and create reviewable evidence;
none are an alternative payment authority. Contributors never need a maintainer
credential. Local browser drafts contain no OAuth token or signing material.

## Before the first live test

Retain the exact reviewed manifests, source snapshot, allocation, reservation,
unsigned plan, transaction IDs, and verifier evidence. Verify required branch
checks and review enforcement for the canonical reservation ledger. A funded
personal wallet alone is insufficient: the exact instrument, independent signer,
registered recipients, public review, and finalized verification must also work.
Use a separately reviewed test allocation and agreed amount. Do not shorten a
real contributor cycle's review period or relabel a simulated test as payment.

Relevant public interfaces: [Phantom setup](https://help.phantom.com/articles/8071074929043),
[Squads setup](https://docs.squads.so/main/getting-started/quickstart-guide), and
[Squads batch send](https://docs.squads.so/main/navigating-your-squad/treasury/manage-assets).
