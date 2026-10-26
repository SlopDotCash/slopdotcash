# Project funding

Slop has one funding mode: the project escrow vault. The owner chose this mode
on 18 October 2026. Each vault must use a reviewed deployment on the project's
settlement network. The project owner creates its own vault
(owner decision D13, 24 October 2026). A vault has one purpose: ordinary awards
or private bounties, so the two never share a balance. The project owner
deposits funds into that vault, authorizes each gross award, and can withdraw
free funds under the disclosed withdrawal fee. In an ordinary vault the owner
can also turn on a bounded monthly commitment: after the monthly cutoff, anyone
can commit that month's allocation when the identity attester signed it, within
the owner's monthly cap and once per month. The owner can turn it off at any
time. The contract enforces reserved awards, fees, and exact-once payment. It
has no service charge. The contracts hold project funds.

Slop's fee-claim and conversion key can claim only accrued fees from reviewed
vaults to the same fee wallet and convert received fees. It cannot withdraw
free funds or reserved awards. Slop's identity attester signs wallet bindings
and bounded monthly allocations. A compromised identity key can redirect
unpaid awards; upgrade keys held by Slop's owner can change the contract logic that
governs vault funds. The [canonical PRD, sections 6 and 11](../docs/slop-product-requirements.md#6-funds-and-payments)
records these powers, limits and accepted risks. Contract balances do not remove
these key risks.

The escrow rules are in these documents:

- [Canonical PRD, sections 4, 6 and 11](../docs/slop-product-requirements.md):
  current project setup, funding scope, authority and acceptance requirements.
- [`contracts/evm/README.md`](../contracts/evm/README.md) and
  [`contracts/solana/README.md`](../contracts/solana/README.md): the contract
  rules and the key recovery runbook.
- [`backend/payments/README.md`](../backend/payments/README.md): the payment
  projection and the escrow indexer.

The escrow deployment is part of the canonical project manifest in the D1
registry. The verified project owner registers the deployment through project
setup. The API verifies its on-chain identity and appends an immutable registry
revision; routine admin approval is not required. GitHub identity does not prove
wallet control.

[`docs/payouts-mvp.md`](../docs/payouts-mvp.md) and
[`docs/base-solana-payout-plan.md`](../docs/base-solana-payout-plan.md) retain
historical implementation decisions. They do not override the current PRD or
change existing funded awards and payment records.

## Removed legacy mode

The committed-instrument mode is removed. It used Squads v4 multisig vaults on
Solana, Sablier Lockup v4 streams on Base, direct-funding records committed as
JSON, and unsigned monthly-pool settlement plans (PAY-09). No project used it,
and its execution ledger was empty. Its records and tools remain in Git
history. The empty `executions/ledger.json` and `payment-reservations.json`
stay only until this removal merges, because the trusted append-only gates
on the base branch refuse their deletion; no code reads them.

The site reads no chain and no GitHub API on a page view. Escrow payment state
comes from the escrow indexer.

## Manifest funding fields

The manifest keeps `funding.mode`, `funding.recordsPath`,
`funding.disclosure`, and `funding.addresses` for schema compatibility with
existing registry revisions. The site does not show these addresses as a
funding route. A committed `fundingState` is refused, because no manifest
instrument can back a committed amount.

## Contribution quality evidence

`quality/` and `preparations/` hold historical contribution-quality evidence
and its source-bound preparation inputs. `bun run quality:check` validates
them. They confer no approval or payment authority.
