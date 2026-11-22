# Submission fee terms

The refundable submission fee (operator decision, 18 November 2026; PRD
section 6, "Submission fee deposits") has one set of published terms that
every part reads: the backend's registry, Slopbot's gate, the fee pages and
the submission-fee Worker of `apps/fees`. This library is that one set. Its
source is Slop development `8660a6121`, `src/lib/submission-fee.mjs`
(`SUBMISSION_FEE_*`, `slopRatesAt`), `src/lib/submission-fee.test.ts` ("each
network's deployed contract and its start block are published", "the rate in
force") and development's own model
`formal/models/fees/submission_fee_rate.qnt` (commits `8d1ca6d4b`,
`41c784d99`). The backend exports it from `@repo/backend/client` (owner
decision plan5:O8). The rate rows themselves (`submission_fee_rates`) are
written by the fee rate reader of `apps/fees`; how their amounts are computed
is a hand-written `//@` bigint kernel there, since SLOP amounts in 18-decimal
base units do not fit a safe integer.

## Story: Every part reads the same published fee terms

> As a contributor paying a submission fee, I want every page, bot and
> worker to name the same contracts, tokens, amounts and deadlines, so that
> what I am asked is what the contract and the refund honour.

### The submission fee terms are published constants that change only by a reviewed change

Two networks are published. Base mainnet (chain 8453) accepts USDC and
counts a deposit after 30 confirmations; Robinhood Chain mainnet (chain
4663) accepts USDG and SLOP and counts one after 1,200 confirmations. Each
has one `SubmissionDeposits` contract, both at
`0xDe40B32A4156ABC2A05987367966d994BcFbf8D8` (deployed 19 November 2026 by
the same deployer at the same nonce), whose event scan starts at its
deployment block, 59572869 on Base and 118349901 on Robinhood Chain; a
network with a contract and no start block is refused. A kept stablecoin
goes to Slop's fee wallet `0x8f77C37D8650776bFe73c9b12B15209eE15D9b86` and
kept SLOP to the burn address `0x000000000000000000000000000000000000dEaD`.
The stablecoin fee is 2.00 by default, at least 1.00 and at most 10.00, in
six-decimal base units; the SLOP fee is half its value (5,000 basis points).
An undecided pull request is refunded after 14 days, a closed one keeps its
fee after 7 days, and the payer may reclaim an open deposit from the
contract after 30 days (`RECLAIM_DELAY`). A deposit whose pull request Slop
never asked a fee for waits 24 hours after finality before it is refunded as
unknown. The previous SLOP rate still counts 48 hours after a change; a rate
is reset when it is 7 days old, and early when the SLOP fee at the current
price is worth less than 35% or more than 65% of the stablecoin fee. The fee
is switched on (`SUBMISSION_FEE_SWITCHED_ON`, held together with Slopbot's
`SUBMISSION_FEE_MODE` by a test). Addresses compare without case: each
token's `key` is its lowercase form, and a caller looks a token up by the
lowercase form of the address it read.

```quint
type TokenKind = StableToken | SlopToken | NoToken
type FeeToken = { symbol: str, address: str, key: str, kind: TokenKind, decimals: int }
type FeeNetwork = { network: str, chainId: int, confirmations: int, contract: str, startBlock: int, tokens: List[FeeToken] }
pure val feeWallet = "0x8f77C37D8650776bFe73c9b12B15209eE15D9b86"
pure val burnAddress = "0x000000000000000000000000000000000000dEaD"
pure val depositContract = "0xDe40B32A4156ABC2A05987367966d994BcFbf8D8"
pure val stableDecimals = 6
pure val slopDecimals = 18
pure val feeNetworks: List[FeeNetwork] = List(
  { network: "base-mainnet", chainId: 8453, confirmations: 30, contract: depositContract, startBlock: 59572869,
    tokens: List({ symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      key: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", kind: StableToken, decimals: stableDecimals }) },
  { network: "robinhood-mainnet", chainId: 4663, confirmations: 1200, contract: depositContract, startBlock: 118349901,
    tokens: List({ symbol: "USDG", address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
        key: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", kind: StableToken, decimals: stableDecimals },
      { symbol: "SLOP", address: "0xfeb4E36FA4a2A494FF25ae4a63491e4c584A67AE",
        key: "0xfeb4e36fa4a2a494ff25ae4a63491e4c584a67ae", kind: SlopToken, decimals: slopDecimals }) })
pure val defaultMinor = 2000000
pure val minMinor = 1000000
pure val maxMinor = 10000000
pure val slopShareBps = 5000
pure val refundUndecidedDays = 14
pure val keptAfterClosedDays = 7
pure val reclaimDays = 30
pure val unknownItemGraceMs = 86400000
pure val rateGraceMs = 172800000
pure val ratePeriodMs = 604800000
pure val bandMinBps = 3500
pure val bandMaxBps = 6500
pure val switchedOn = true
pure val noNetwork: FeeNetwork = { network: "", chainId: 0, confirmations: 0, contract: "", startBlock: 0, tokens: List() }
pure val noToken: FeeToken = { symbol: "", address: "", key: "", kind: NoToken, decimals: 0 }
pure def networkTerms(network: str): FeeNetwork = feeNetworks.select(n => n.network == network).nthOr(0, noNetwork)
pure def tokenOf(network: str, tokenKey: str): FeeToken =
  networkTerms(network).tokens.select(t => t.key == tokenKey).nthOr(0, noToken)
pure def tokenKind(network: str, tokenKey: str): TokenKind = tokenOf(network, tokenKey).kind
pure def keptToFor(network: str, kind: TokenKind): str =
  if (networkTerms(network).network == "") "" else if (kind == StableToken) feeWallet else if (kind == SlopToken) burnAddress else ""
pure def stableFeeInRange(amountMinor: int): bool = amountMinor >= minMinor and amountMinor <= maxMinor
pure def lawPublishedContractsHaveStartBlocks(network: str): bool =
  networkTerms(network).contract != "" implies
    (networkTerms(network).startBlock > 0 and networkTerms(network).chainId > 0 and networkTerms(network).confirmations > 0)
pure def lawUnknownTokenIsNotAccepted(network: str, tokenKey: str): bool =
  tokenKind(network, tokenKey) == NoToken implies keptToFor(network, tokenKind(network, tokenKey)) == ""
pure def lawSlopIsBurnedAndStablecoinsGoToTheFeeWallet(network: str, tokenKey: str): bool =
  (tokenKind(network, tokenKey) == SlopToken implies keptToFor(network, SlopToken) == burnAddress) and
  (tokenKind(network, tokenKey) == StableToken implies keptToFor(network, StableToken) == feeWallet)
pure def lawDefaultFeeInRange(amountMinor: int): bool = amountMinor == defaultMinor implies stableFeeInRange(amountMinor)
pure val networkValues = Set("base-mainnet", "robinhood-mainnet", "ethereum-mainnet")
pure val tokenKeyValues = Set("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "0xfeb4e36fa4a2a494ff25ae4a63491e4c584a67ae",
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168", "0x0000000000000000000000000000000000000001")
pure val amountMinorValues = Set(0, 999999, 1000000, 2000000, 10000000, 10000001)
```

### A SLOP rate is in force from its own hour, and the previous one still counts for 48 hours

Rates are append-only rows of an effective time and a decimal SLOP per 1.00
of stablecoin (`submission_fee_rates`, written by the fee rate reader). At a
time `t` the rate in force is the latest one whose effective time is at or
before `t`; the one before it, in effective-time order, still counts while
`t` is before the current one's effective time plus 48 hours. With no rate
in force SLOP is not accepted: no SLOP way is offered and a SLOP deposit is
refused (`no_slop_rate`). The SLOP amount due at a time is the lower of the
amounts at the rate in force and at the previous rate while it still counts;
the amount at a rate is half the stablecoin fee at that rate, rounded half up
to two significant digits and never zero (`slopFeeBase`, `slopFeeDueAt`),
computed by the bigint kernel of `apps/fees`. Effective times are distinct
milliseconds; rows may be read in any order.

```quint
type FeeRate = { effectiveAt: int, slopPerUsd: str }
type RatesInForce = { current: FeeRate, previous: FeeRate }
pure val noRate: FeeRate = { effectiveAt: -1, slopPerUsd: "" }
pure def rateAt(rates: List[FeeRate], t: int): FeeRate =
  rates.foldl(noRate, (best, r) => if (r.effectiveAt >= 0 and r.effectiveAt <= t and r.effectiveAt > best.effectiveAt) r else best)
pure def ratesAt(rates: List[FeeRate], t: int): RatesInForce =
  val current = rateAt(rates, t)
  val before = rates.foldl(noRate, (best, r) =>
    if (r.effectiveAt >= 0 and r.effectiveAt < current.effectiveAt and r.effectiveAt > best.effectiveAt) r else best)
  { current: current, previous: if (current.effectiveAt >= 0 and t < current.effectiveAt + rateGraceMs) before else noRate }
pure def rateInForce(rate: FeeRate): bool = rate.effectiveAt >= 0
pure def slopAccepted(rates: List[FeeRate], t: int): bool = rateInForce(ratesAt(rates, t).current)
pure def lawRateNeverInForceBeforeItsTime(rates: List[FeeRate], t: int): bool =
  (rateInForce(ratesAt(rates, t).current) implies ratesAt(rates, t).current.effectiveAt <= t) and
  (rateInForce(ratesAt(rates, t).previous) implies ratesAt(rates, t).previous.effectiveAt < ratesAt(rates, t).current.effectiveAt)
pure def lawPreviousCountsOnlyInItsGrace(rates: List[FeeRate], t: int): bool =
  rateInForce(ratesAt(rates, t).previous) implies t < ratesAt(rates, t).current.effectiveAt + rateGraceMs
pure def lawNoRateNoSlop(rates: List[FeeRate], t: int): bool =
  rates.every(r => r.effectiveAt > t) implies (not(slopAccepted(rates, t)) and not(rateInForce(ratesAt(rates, t).previous)))
pure def lawLatestRateInForce(rates: List[FeeRate], t: int): bool =
  rates.every(r => (r.effectiveAt >= 0 and r.effectiveAt <= t) implies r.effectiveAt <= ratesAt(rates, t).current.effectiveAt)
pure val rateA: FeeRate = { effectiveAt: 3600000, slopPerUsd: "250" }
pure val rateB: FeeRate = { effectiveAt: 7200000, slopPerUsd: "300" }
pure val ratesValues = Set(List()).union(Set(List(rateA))).union(Set(List(rateB, rateA))).union(Set(List(rateA, rateB)))
pure val tValues = Set(0, 3600000, 7199999, 7200000, 179999999, 180000000)
```
