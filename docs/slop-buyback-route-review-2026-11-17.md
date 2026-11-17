# Buyback route review, 17 November 2026

This is read-only route research for PRD section 6, BUY-01 through BUY-07.
No quote was signed, broadcast, entered as fee income or used to declare
operational qualification. Quotes are time-specific estimates, not firm
prices for a later transaction. The owner approved checking and executing
from 25 USD of eligible buyback funds with a 10% total bridge-cost cap.
The 50% allocation and the separate purchase, burn and native limits remain.

## Findings

Fixed costs dominate small deBridge orders. The token shortfall comprises
4 basis points of protocol fee, 13 basis points of taker margin and about
0.6813 USDG of operating expenses. The funded-share unsigned simulation
also measured a whole native debit and network fee of 0.01879428 SOL,
valued at 1.343049 USDC by the reviewed Jupiter client at that observation.
The 15,000-lamport network fee is known; the remaining native debit was not
independently divided into fixed fee and rent. deBridge separately documents
a flat source-chain fee, so switching the destination ticker does not remove
that charge. [Fee structure](https://docs.debridge.com/dln-details/overview/fee-structure),
[supported-chain fees](https://docs.debridge.com/dln-details/overview/fees-supported-chains).

At about 01:30 UTC, these were the checked deBridge quotes:

| Input USDC | Expected USDG | Bridge cost percentage |
| ---: | ---: | ---: |
| 3.902439 | 3.214480 | 52.044580%, unsigned simulation with actual account state |
| 25 | 24.276237 | 8.267248%, scenario estimate |
| 50 | 49.233750 | 4.218598%, scenario estimate |
| 100 | 99.148739 | 2.194310%, scenario estimate |
| 500 | 498.468980 | 0.574814%, scenario estimate |

The four larger scenarios reuse the measured small-order native cost. They
are neither funded simulations nor upper bounds: the real wallet lacked
their token balances, and those simulations refused. A live order must
price its own entire debit and satisfy the cost cap before signing. These
figures cover the bridge leg; later approval, purchase and burn have their
own controls. In particular, a 25 USDC order delivering 24.276237 USDG is
below the separate 25 USDG purchase minimum. An arrival can wait until
enough eligible funds are available on Robinhood; arrival alone is not a
verified purchase or burn.

## USDC to USDC

Circle currently lists neither native USDC nor a CCTP domain on Robinhood
Chain. A token named USDC there is not automatically Circle's native asset.
The canonical Ethereum bridge can create a bridged ERC-20 representation,
but its exact USDC deployment and usable SLOP liquidity were not established
in this review. An extra bridge and swap cannot be called cheaper without
their complete costs. [Circle USDC contracts](https://developers.circle.com/stablecoins/usdc-contract-addresses),
[CCTP domains](https://developers.circle.com/cctp/concepts/supported-chains-and-domains),
[Robinhood bridging](https://docs.robinhood.com/chain/bridging/).

Paxos publishes native USDG and OFT deployments on both Solana and Robinhood.
That makes Solana USDC to USDG, followed by USDG OFT to Robinhood, a supported
asset candidate. [Paxos deployments](https://docs.paxos.com/guides/stablecoin/usdg/mainnet).

Jupiter quoted 25 USDC to 24.998998 USDG at 01:33 UTC, with no platform fee.
An on-chain OFT quote at 01:37 returned the same USDG amount for 0.014171814
SOL of messaging fees. The peer matched Paxos's Robinhood OFT and was not
paused. The fee wallet needed a 187-byte Token-2022 USDG account with a
0.0016002 SOL refundable rent deposit. Known first-use native outlay was
therefore 0.015777014 SOL including the 5,000-lamport Jupiter message fee,
before OFT send fees or any additional endpoint setup. Full send and recovery
costs were not qualified; this is not a proven cheaper complete route.
[LayerZero SDK](https://docs.layerzero.network/v2/developers/solana/oft/sdk),
[Jupiter quote semantics](https://developers.jup.ag/docs/swap/v1/get-quote).

## Other direct routes

Relay was the lowest current quote obtained. At 01:53 UTC, 25 USDC quoted
24.963844 USDG, with a minimum of 24.839024. Its quote-estimated bridge cost
including a conservative origin-gas estimate was 0.037577 USD, about 0.1503%.
The unsigned message fee was 5,000 lamports, and the required token accounts
already existed. This is a quote and local binding check, not a completed
transfer or a recovery qualification. [Relay fees](https://docs.relay.link/references/api/api_core_concepts/fees).

The current API's canonical order data changes the initial review's opaque-ID
finding. Settlement SDK 0.0.156 recomputed the order hash and matched it to
the actual Solana deposit instruction. The amount, source/destination assets
and chains, recipient, minimum output, deadlines, canonical program/vault,
token accounts and solver signature were checked. Both refund beneficiaries
were the reviewed fee wallets. Both refund minima were zero, with seven-day
deadlines; a positive or timely refund is not established by recipient binding.
Oracle, Allocator and solver recovery trust, deployment provenance and actual
failure recovery need separate review before integration.
[Relay input validation](https://docs.relay.link/references/api/api_core_concepts/input-validation),
[Relay trust model](https://docs.relay.link/references/protocol/security).

The reviewed public oracle source checks a refund against the signed minimum
and does not add a full-input refund floor in that path. The published quote
request schema has no positive refund-minimum parameter. Requiring such a
floor would therefore reject the sampled quote without a documented way to
request a compatible replacement. This is a concrete refund-trust difference
from the current route, not evidence that the live oracle is malicious or
that its deployed binary matches the reviewed source. The cheap quote is
insufficient to approve automatic use under the present signer policy.
[Refund behavior](https://github.com/relayprotocol/relay-protocol-oracle/blob/55b22de6358c212c22eebb48d2df5b793a16e863/src/services/attestation/index.ts#L1023),
[quote request schema](https://docs.relay.link/references/api/get-quote-v2).

Across's discovery metadata listed the chains and expected assets. The tested
Solana-to-Robinhood USDG quote requests nevertheless returned HTTP 400 on
the output-token/route combination. No usable quote or cheaper route was
established. [Across route announcement](https://across.to/blog/bridge-to-robinhood-chain-with-across),
[quote schema](https://docs.across.to/api-reference/swap/approval/get).

## Operating decision

Keep the reviewed deBridge route while applying the owner's 25 USD threshold
and 10% all-in bridge cap. Recompute real costs for every eligible order;
defer it when costs are unpriced or exceed the cap. The price comparison
supports a separate Relay integration review as the strongest cost candidate.
It does not authorize another provider or an expansion of fee-key powers.
That review must qualify binding, deployment provenance, native budgets,
refund semantics, journal recovery and finalized arrival evidence before a
reviewed release. No route may spend the retained half of fees or unrelated
wallet deposits to manufacture a qualification result.
