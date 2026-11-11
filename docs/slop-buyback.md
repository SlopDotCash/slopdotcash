# SLOP buyback and burn: design, review and evidence

Owner decision, 10 November 2026 ([PRD section 6](slop-product-requirements.md#slop-buyback-and-burn)).
Half of all fee income buys SLOP on Robinhood Chain. The SLOP stays in the
Robinhood Chain fee wallet, and half of it is then burned. This document
records the research, the contract review, the design, the state models and
the local evidence. The operating instructions are in the
[fee-converter guide](../workers/fee-converter/README.md#slop-buyback).

Nothing here is active. `BUYBACK_MODE` is `off` in both checked-in Worker
configurations, and a merge activates nothing.

## What the decision means in numbers

| Fee                                      | Fee rate | Buyback share  |
| ---------------------------------------- | -------- | -------------- |
| Ordinary award or unused-fund withdrawal | 2%       | 1% of gross    |
| Private security bounty (75/25 split)    | 25%      | 12.5% of gross |

Every fee reaches a network fee wallet the same way: a vault's `claimFees`
(EVM) or `claim_fees` (Solana) for ordinary and bounty vaults, or the fee leg
of a direct award. The contracts already take the right amount, so the buyback
is one rule on what the fee wallet receives: half of it.

## Facts established before the design

Each fact was read on chain through a public RPC, or from the named primary
source, on 10 November 2026.

| Fact                                                                                                                                                                                                     | How it was established                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| SLOP is `0xfeb4e36fa4a2a494ff25ae4a63491e4c584a67ae` on chain 4663: "Slop Cash", 18 decimals, supply 100,000,000, not a proxy.                                                                           | `eth_getCode`, `name`, `symbol`, `decimals`, `totalSupply`, ERC-1967 slot.                                                                  |
| SLOP has `mint(address,uint256)`, `burn(address,uint256)`, `pause`, `unpause` and an owner. It has no `burn(uint256)` and no permit.                                                                     | Selector scan of the runtime bytecode.                                                                                                      |
| `burn(address,uint256)` is owner-only. A holder's call reverts with `OwnableUnauthorizedAccount`.                                                                                                        | `eth_call` from a holder.                                                                                                                   |
| A transfer to the zero address reverts. A transfer to `0x…dEaD` succeeds.                                                                                                                                | `eth_call`; and the fork test, which also shows `totalSupply` unchanged.                                                                    |
| The owner `0x9602…d1a2` is a beacon proxy that holds SLOP and USDG. Its source is not published.                                                                                                         | `eth_getCode`, beacon and implementation reads.                                                                                             |
| Paxos USDG on chain 4663 is `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals. A second token named "Paxos USDG" exists and is not it.                                                            | [Paxos USDG mainnet addresses](https://docs.paxos.com/guides/stablecoin/usdg/mainnet); on-chain `decimals`.                                 |
| Robinhood Chain has no Circle USDC and no CCTP.                                                                                                                                                          | [Circle CCTP supported chains](https://developers.circle.com/cctp/cctp-supported-blockchains).                                              |
| The deepest SLOP liquidity is a Uniswap v4 SLOP/USDG pool with a 1% fee and a hook; smaller v4 and v3 pools exist. A 1,000 USDG purchase moved the price about 1.4% including the fee; 5,000 about 2.9%. | Uniswap v4 Quoter calls; the pools were hours old.                                                                                          |
| KyberSwap routes USDG to SLOP on chain 4663 through the router `0x6131…37b5` already pinned for Base and Ethereum, and prices both tokens in USD.                                                        | Live `routes` responses; `eth_getCode`; the fork test executes its built calldata.                                                          |
| deBridge DLN delivers USDG on chain 4663 from Base, Ethereum and Solana. `DlnSource` is `0xeF4f…EB66`, `DlnDestination` is `0xE735…dd7f`, the Solana program is `src5qy…Hr4`.                            | Live `create-tx` responses; `eth_getCode` on each chain; the fork and validator tests run the deployed code.                                |
| The DLN ABI fragments and status enums used here match the published contracts.                                                                                                                          | [dln-contracts](https://github.com/debridge-finance/dln-contracts) `DlnSource.sol`, `DlnDestination.sol`, `DlnOrderLib.sol`; the fork test. |
| The public Robinhood Chain RPC does not serve contract state at its finalized block.                                                                                                                     | `eth_call` at `finalized` returned `historical state … is not available`.                                                                   |

## Why these routes

**Bridge: deBridge DLN.** The order itself names its receiver, arrival asset,
amount and destination chain, so each can be compared with the Worker's own
decision before signing. Relay was cheaper (about 0.06% against about 0.2%
plus a fixed fee) but binds its receiver only through an opaque order id; no
pre-sign check could prove where the funds go. Across reaches chain 4663 with
ETH only. The canonical bridge would deliver a bridged USDC with no liquidity.
LI.FI adds another party and a fee on top of the same underlying routes.

**Purchase: KyberSwap.** It is the route the converter already uses and
reviews on the EVM networks: one pinned router, decoded calldata, a signed
minimum and a simulation. It follows SLOP liquidity if it moves between pools.
A direct Uniswap v4 call would pin one pool of a token that was hours old.

**Burn: transfer to `0x…dEaD`.** The token offers its holders no burn. The
burn address balance is the public record; `totalSupply` does not fall.

## Flow

```text
Base / Ethereum / Solana                        Robinhood Chain (4663)
------------------------                        ----------------------
vault fees -> fee wallet                        vault fees -> fee wallet
other tokens -> USDC (existing)                 (retained half stays unconverted)
half of USDC fee income
  -> exact approval (EVM)
  -> deBridge DLN order  ---- taker fills ---->  USDG arrives, credited once
                                                 arrival in full + half of fees
                                                   -> exact approval -> swap -> SLOP
                                                 half of acquired SLOP -> 0x…dEaD
                                                 other half stays in the fee wallet
```

Every amount is a share of a cumulative verified total, less what the journal
has already committed:

- Bridge: `floor(income × 50%) − bridged`, where bridged counts every signed
  order not proven failed or refunded.
- Purchase of one asset: `arrivals + floor(fees × 50%) − purchased`.
- Burn: `floor(acquired × 50%) − burned`.

A retry, a restart or a repeated run therefore cannot take a share twice, and
the retained SLOP is never halved again. "Half of the SLOP in the fee wallet"
is read as half of what the buyback acquired, not half of the balance on each
run: the second reading would burn the retained half again every time.

## Contract review: no upgrade is needed

| Contract                                          | Review                                                                                                                                                                                                                                                                                                                                 | Change         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `ProjectEscrow` (EVM, ordinary and bounty vaults) | The fee recipient is fixed at initialization. Ordinary fees are `ceil(gross / 50)`; a bounty award commits its 25% share as the fee. Both accrue in `accruedFees`, and the permissionless `claimFees()` sends them only to the fee recipient with an exact-transfer check. The vault has no knowledge of what the recipient does next. | None.          |
| `EscrowFactory`                                   | Supplies the fee recipient to new vaults and refuses it as upgrade or identity authority.                                                                                                                                                                                                                                              | None.          |
| `slop-escrow` (Solana)                            | The same model: `accrued_fees` per project, `claim_fees` pays only a token account owned by the Config's fee recipient.                                                                                                                                                                                                                | None.          |
| `ReferralDistributor`                             | Holds and distributes the program token for referrals. It takes no fee and has no link to the fee wallets.                                                                                                                                                                                                                             | None.          |
| SLOP token                                        | Not a Slop contract. Its owner can pause and mint. A pause stops purchases and burns until it ends.                                                                                                                                                                                                                                    | None possible. |

Splitting the fee on chain was considered and rejected. It would mean a new
fee recipient contract on four networks and an upgrade or redeployment of
every vault, to enforce a rule that the fee wallet's own key could still
bypass after the fees arrive. A dedicated buy-and-burn contract on Robinhood
Chain was also considered. It would make the purchase and burn atomic, but it
adds a contract to deploy and review, pins one pool, and still does not bound
the hot key. Both remain possible later without changing the accounting here.

The one schema change is migration `0121`: the fee journal accepts the kinds
`bridge`, `buyback` and `burn` and the route `debridge`; a new
`fee_bridge_outcomes` table holds one proven outcome per deposit; and native
gas reservations carry a purpose, so Solana bridge orders have their own
limits.

## What the fee-wallet key may newly sign

Only these, each journaled before broadcast and checked against the Worker's
own decision first:

1. `approve(DlnSource, amount)` on USDC, for exactly one order's amount.
2. `DlnSource.createSaltedOrder` (EVM) or `create_order_with_nonce` (Solana)
   that delivers USDG on chain 4663 to the Robinhood fee wallet, with that
   wallet as order authority and the source fee wallet as refund beneficiary.
3. On Robinhood Chain: `claimFees()` on reviewed vaults, `approve(router,
amount)` for exactly one purchase, the checked KyberSwap swap into SLOP with
   the fee wallet as receiver, and `transfer(0x…dEaD, amount)` on SLOP.

The Worker does not cancel orders, sweep funds, or send SLOP anywhere but the
burn address.

## State models

Four Quint models cover the buyback (`formal/models/fees/`). Each passed type
check, its scenarios, 500 seeded traces and exhaustive TLC exploration of its
finite graph.

| Model                     | What it covers                                                                                                                                                                   | Distinct states |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `buyback_accounting`      | Source-network money: income, the half share, one open order, lost responses, failure, deposit, arrival credit, refund, owner sweeps.                                            | 2,530           |
| `buyback_slop_accounting` | Robinhood money: arrivals in full, fees at half, purchases, the burn of half of everything acquired, failures, owner sweeps.                                                     | 126,533         |
| `buyback_bridge_order`    | One order from proposal to outcome: bad proposals, the check bound to exact bytes, approval, uncertain sends, fill, owner cancellation, refund, leases, one outcome per deposit. | 1,314           |
| `buyback_market`          | The Robinhood run: mode combinations, key loading, the fee claim, approval and swap, a moving price, a paused token, reverted sends.                                             | 1,408           |

The arithmetic in `verified-buyback.ts` is proved in Dafny through
LemmaScript: the share is a floor that never exceeds income, an entitlement
plus what is committed never exceeds the share, a send never exceeds its
entitlement, balance or cap, and the burn never exceeds the burn share.

These are abstract models. They do not prove that the implementation refines
them, and they assume the bridge and token contracts behave as published.

## Local evidence

| Check                                                         | Command                                                   | Result on 10 November 2026                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy, journal constraints, configuration, order validators  | `bun test ./workers/fee-converter/buyback.test.ts`        | 29 tests pass                                                                                                                                                                                                                                                                         |
| Whole cycle on forks of Base, Ethereum and Robinhood Chain    | `bun run test:fee-converter:buyback`                      | Pass: 1,000.000001 USDC of fee income per source gave one 500 USDC order each; both fills credited once; 1,097.75 USDG bought 52,590 SLOP; exactly half burned. A second Base order was cancelled by the fee wallet, refunded in full by `DlnSource`, released once and bridged again |
| Solana order on a local validator with the cloned DLN program | `bun run test:fee-converter:buyback:solana`               | Pass: 500 USDC escrowed in the order's derived account; 0.0202 SOL native cost settled under purpose `bridge`                                                                                                                                                                         |
| State models                                                  | `node scripts/check-formal.mjs [--verify] --model=<name>` | Pass for all four                                                                                                                                                                                                                                                                     |
| Arithmetic proofs                                             | `bun run lemmascript:check`                               | `verified-buyback`: 122 obligations verified                                                                                                                                                                                                                                          |

The fork and validator runs use throwaway keys and send nothing to a public
network. They seed fee income, impersonate the deBridge taker for the fill,
and use harness gas budgets and slippage, as each file's header explains.

## What local testing cannot show

- **A live fill.** A real taker must choose to fill a real order. The first
  live order should be small.
- **deBridge's cross-chain message.** The fork test cancels a real order through `DlnDestination` and the real `DlnSource` pays the refund, but the message between the two chains is delivered by a stub at deBridge's CallProxy address. A refund from Solana is tested only against stand-ins and the published status values.
- **The hook on the main SLOP pool.** Its `beforeSwap` logic is unpublished.
  Every swap is simulated before signing, and the fork test executed real
  swaps through it.
- **Production gas budgets.** Anvil suggests a 1 gwei priority fee, so the
  harness uses wider native budgets. On Ethereum, a 700,000-gas order exceeds
  the 0.001 ETH transaction ceiling above about 1 gwei of maximum fee; such an
  order is refused and retried on a later scan.
- **Third-party claims.** Anyone may call `claimFees`. A USDC fee that another
  caller claims reaches the wallet without a journal row and is not counted as
  income. The buyback then takes less than half, never more.

## Owner decisions

Confirmed by the owner on 10 November 2026 (PRD section 6 table). The code
holds no fallback for any of these values.

1. Every limit in the configuration table, including the minimum order of 500
   USDC and the 1.5% bridge cost limit.
2. The Solana order ceiling of 0.05 SOL per order and 0.1 SOL per day, which is
   separate from and larger than the fee-conversion budget.
3. The burn takes half of the SLOP the buyback acquired, once. The retained
   half is never burned again.

Still open, and needed before or at activation:

1. The activation instant. Fees finalized before it never enter the buyback.
2. A Robinhood Chain RPC that serves state at the finalized block.
3. Whether SLOP received directly as a fee should have its half counted as
   acquired, as implemented, or be left out of the burn.
4. Whether the Worker should later be allowed to cancel unfilled orders. It is
   not, today.

## Accepted risks

- The fee-wallet keys are hot. The checks bound what the Worker signs, not
  what a stolen key can do. Bridging concentrates buyback funds in the
  Robinhood Chain fee wallet; keep its balance small by keeping the caps low.
- SLOP's owner can pause or mint. A pause halts purchases and burns; a mint
  dilutes what was bought.
- Price impact is measured from KyberSwap's own USD prices. The signed minimum
  and the simulation bound each swap against its quote, not against an
  independent price.
- The deBridge contracts and program are upgradeable by deBridge. An arrival is
  credited from `DlnDestination` status at a finalized block.
- An order that no taker fills ties up its share until the owner cancels it.
