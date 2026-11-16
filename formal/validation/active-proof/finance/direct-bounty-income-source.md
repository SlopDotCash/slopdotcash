# Direct award fee evidence and accounting

The pinned development revision is `d6c44489cd5a4ff687f1ef406991aaf9b28b7b64`.
The [executed fee model](../../../../spec/fees/directBountyIncome.md) uses
[the durable award journal](../../../../spec/settlement/directBounty.md).

| Evidence | Pinned behavior | Executable successor |
| --- | --- | --- |
| `backend/security/direct-payments.ts:799–884` and `migrations/0109_direct_payment_transfer_receipts.sql:1–33` | An exact verified transfer is written with unique case, leg and network transaction identity. Aggregate receipt depends on every required leg. The Solana bundle contributes one transaction. | `cashFact`, `recordCash`, `exactAwardComplete`, `book` |
| `workers/fee-converter/store.ts:419–449,569–575` | The balance and historical asset discovery query joins the immutable original intent to the completed aggregate receipt. A received EVM fee with an outstanding researcher leg is absent from that query. | `receivedFor` exposes verified cash. Eligibility for the operational booked view is a separate rule. |
| `workers/fee-converter/buyback-store.ts:59–91` | The completed direct-fee query filters by original intent `prepared_at`. It filters the fee wallet and uses exact base units. | `pinnedPreparedFilter` preserves the source comparison. `bookingStatus` applies the cutover to canonical fee receipt time and requires completed evidence. |
| `backend/security/direct-evm.ts:219–224`, `backend/security/direct-solana.ts:493–510` | EVM returns transaction, block hash and height without timestamp. Solana returns the secure-finality bundle identity and `blockTime` in seconds. | `matchesTime` requires a canonical block-time observation matching the stored transaction and height. The adapter must verify the exact retained block hash and normalize UTC milliseconds. |

A preparation before cutover followed by a verified fee and complete award
at or after cutover is eligible under the specified journal. The pinned
worker can omit it. A cash receipt before cutover stays excluded even when
completion and database verification occur later. The existing workers are
unchanged. The EVM adapter must obtain the exact canonical block time, and a
missing Solana chain time needs a fresh qualified observation. Runtime
conformance still needs a real D1 read and an exact canonical chain observation.

The directed Quint witnesses cover partial EVM cash, unchanged paid evidence,
two independent EVM receipts, one Solana receipt, incomplete or conflicting
time observations, cutover equality, replay across cases or networks and
padded amounts. Separate source-bound verification and replay reports record
formal results.
