# Independent referral root watcher

PRD section 11 makes an operating independent watcher a prerequisite of
posting ([deferred referrals](./referrals.md), `canStartWatcher`). The
watcher recomputes every [public accrual file](./referralFiles.md) from its
own records and compares the distributor's finalized history with those
files. Every mismatch fails the run with one fixed category; the run never
repairs, posts or signs. Source anchors are development
`scripts/check-referral-roots.ts` (`checkReferralFiles`,
`checkReferralRoots`, `referralWatchConfig`),
`workers/referral-accrual/chain-logs.ts` (`scanReferralLogs`) and
`.github/workflows/referral-root-watch.yml` (hourly at minute 47). Reading
JSON, hashing, Merkle proofs and RPC calls belong to the watcher's adapter,
which reports each recomputed fact as evidence below.

## Story: Fail loudly on any difference between files, roots and events

### Every month closed more than two hours ago has a filed accrual file, and an earlier month is only awaiting filing

The filing job runs at 01:23 UTC and has until 02:00 to publish a month
that just closed. A run therefore requires a file for every month from the
program's first period that closed more than two hours before the run
(`referral_files_stale`); a month that closed less recently is reported as
awaiting filing, never as a failure. Each indexed file must be the next
epoch and period in order, closed before the run, at its own URL
(`referral_period_coverage_invalid`). Periods are ordinal months,
`year * 12 + month - 1`.

```quint
import money as M from "./money"
import calendar as C from "./calendar"
import referrals as R from "./referrals"
type WatchFailure = NoFailure | AccrualArithmeticMismatch | AccrualCapMismatch | CumulativeAccountMismatch
  | CumulativeTotalMismatch | DeploymentCodeMismatch | DeploymentEvidenceMissing | DeploymentNotFinalized
  | DeploymentTokenMismatch | EpochStateMismatch | EventCoverageMismatch | EventNotCanonical | ExcludedAmountMismatch
  | FileAccountInvalid | FileAmountInvalid | FileDigestMismatch | FileIdentityMismatch | FilesStale | FinalityChanged
  | IndexInvalid | ObligationRepeated | ObservationChanged | PeriodCoverageInvalid | PostWithoutFile | PostedRootMismatch
  | ProofMismatch | PublicDataOversized | PublicDataUnavailable | TreeMismatch | VoidCoverageMismatch | VoidRootMismatch
  | WalletInvalid | WalletPinMismatch | WalletlessLeaf | WatchUnavailable | WrongChain
pure val filingGraceSeconds = 7200
pure def ordinalMonth(seconds: int): int = C::ordinalPeriod(C::utcPeriod(seconds))
pure def monthsClosedBy(firstPeriod: int, seconds: int): int =
  if (ordinalMonth(seconds) > firstPeriod) ordinalMonth(seconds) - firstPeriod else 0
pure def filesStale(firstPeriod: int, filed: int, now: int): bool = filed < monthsClosedBy(firstPeriod, now - filingGraceSeconds)
pure def awaitingFiling(firstPeriod: int, filed: int, now: int): bool = filed < monthsClosedBy(firstPeriod, now)
```

### Each public file's bytes, digest, identity, amounts, arithmetic, caps, excluded amounts and wallet pins recompute exactly from its own records

The adapter reports for each file whether its bytes hash to the indexed
digest and the `x-slop-sha256` header, whether its schema, rule version,
epoch, period, mode, filing time and claim chain match the index, and
whether every account and amount is well formed. The watcher then replays
the records in order. Each obligation appears once across all files. An
excluded record (window closed, held, referrer excluded or asset not
eligible) carries zero computed and accrued amounts. A counted record's
computed amount is its stablecoin gross times the file's rate, and its
accrued amount is the least of that, the project's remaining cap and the
pool's remaining cap. A wallet, once published for an account, stays its
wallet; a walletless account has no leaf; a published wallet is well formed,
positive and belongs to one account only. The adapter then checks the tree,
its total and leaf count and every published proof.

```quint
type WatchedAccrual = { obligation: str, project: int, referrer: int, counted: bool, assetEligible: bool,
  gross: M::Amount, computed: M::Amount, accrued: M::Amount }
type WatchedReferrer = { actor: int, cumulative: M::Amount, wallet: str, walletWellFormed: bool, hasLeaf: bool }
type WatchedFile = { epoch: int, period: int, urlMatches: bool, digestMatches: bool, identityMatches: bool,
  accountsWellFormed: bool, amountsWellFormed: bool, rate: M::Amount, projectCap: M::Amount, poolCap: M::Amount,
  accruals: List[WatchedAccrual], referrers: List[WatchedReferrer], poolAccrued: M::Amount, merkleRoot: str,
  treeTotal: M::Amount, treeMatches: bool, proofsMatch: bool }
type Keyed = { key: int, amount: M::Amount }
type Pin = { actor: int, wallet: str }
type Replay = { obligations: List[str], projects: List[Keyed], accounts: List[Keyed], pins: List[Pin],
  pool: M::Amount, seen: List[int], filed: int, failure: WatchFailure }
pure val emptyReplay: Replay = { obligations: List(), projects: List(), accounts: List(), pins: List(),
  pool: M::zero, seen: List(), filed: 0, failure: NoFailure }
pure def keyedAmount(entries: List[Keyed], key: int): M::Amount =
  entries.foldl(M::zero, (found, e) => if (e.key == key) e.amount else found)
pure def withKeyed(entries: List[Keyed], key: int, amount: M::Amount): List[Keyed] =
  if (entries.some(e => e.key == key)) entries.listMap(e => if (e.key == key) { key: key, amount: amount } else e)
  else entries.append({ key: key, amount: amount })
pure def capLeft(cap: M::Amount, used: M::Amount): M::Amount =
  if (M::compareAmounts(cap, used) > 0) M::subtractAmounts(cap, used) else M::zero
pure def smallerAmount(left: M::Amount, right: M::Amount): M::Amount = if (M::compareAmounts(left, right) <= 0) left else right
pure def replayAccrual(file: WatchedFile, r: Replay, x: WatchedAccrual): Replay =
  val expected = smallerAmount(x.computed, smallerAmount(capLeft(file.projectCap, keyedAmount(r.projects, x.project)), capLeft(file.poolCap, r.pool)))
  if (r.failure != NoFailure) r
  else if (x.obligation == "" or r.obligations.includes(x.obligation)) { ...r, failure: ObligationRepeated }
  else if (not(x.counted)) (if (M::equalAmounts(x.computed, M::zero) and M::equalAmounts(x.accrued, M::zero))
    { ...r, obligations: r.obligations.append(x.obligation) } else { ...r, failure: ExcludedAmountMismatch })
  else if (not(x.assetEligible) or not(M::equalAmounts(x.computed, M::multiplyAmounts(x.gross, file.rate))))
    { ...r, failure: AccrualArithmeticMismatch }
  else if (not(M::equalAmounts(x.accrued, expected))) { ...r, failure: AccrualCapMismatch }
  else { ...r, obligations: r.obligations.append(x.obligation),
    projects: withKeyed(r.projects, x.project, M::addAmounts(keyedAmount(r.projects, x.project), x.accrued)),
    accounts: withKeyed(r.accounts, x.referrer, M::addAmounts(keyedAmount(r.accounts, x.referrer), x.accrued)),
    pool: M::addAmounts(r.pool, x.accrued) }
pure def pinnedWallet(pins: List[Pin], actor: int): str = pins.foldl("", (found, p) => if (p.actor == actor) p.wallet else found)
pure def replayReferrer(r: Replay, referrer: WatchedReferrer): Replay =
  val pinned = pinnedWallet(r.pins, referrer.actor)
  if (r.failure != NoFailure) r
  else if (referrer.actor <= 0) { ...r, failure: FileAccountInvalid }
  else if (r.seen.includes(referrer.actor) or not(r.accounts.some(e => e.key == referrer.actor))
    or not(M::equalAmounts(keyedAmount(r.accounts, referrer.actor), referrer.cumulative))) { ...r, failure: CumulativeAccountMismatch }
  else if (pinned != "" and pinned != referrer.wallet) { ...r, failure: WalletPinMismatch }
  else if (referrer.wallet == "") (if (referrer.hasLeaf) { ...r, failure: WalletlessLeaf } else { ...r, seen: r.seen.append(referrer.actor) })
  else if (not(referrer.walletWellFormed) or not(M::positiveAmount(referrer.cumulative))
    or r.pins.some(p => p.wallet == referrer.wallet and p.actor != referrer.actor)) { ...r, failure: WalletInvalid }
  else { ...r, seen: r.seen.append(referrer.actor),
    pins: if (pinned == "") r.pins.append({ actor: referrer.actor, wallet: referrer.wallet }) else r.pins }
pure def replayFile(firstPeriod: int, now: int, r: Replay, file: WatchedFile): Replay =
  val afterAccruals = file.accruals.foldl(r, (acc, x) => replayAccrual(file, acc, x))
  val afterReferrers = file.referrers.foldl({ ...afterAccruals, seen: List() }, (acc, x) => replayReferrer(acc, x))
  if (r.failure != NoFailure) r
  else if (file.epoch != r.filed or file.period != firstPeriod + r.filed or not(file.urlMatches)
    or file.period >= ordinalMonth(now)) { ...r, failure: PeriodCoverageInvalid }
  else if (not(file.digestMatches)) { ...r, failure: FileDigestMismatch }
  else if (not(file.identityMatches)) { ...r, failure: FileIdentityMismatch }
  else if (not(file.accountsWellFormed)) { ...r, failure: FileAccountInvalid }
  else if (not(file.amountsWellFormed)) { ...r, failure: FileAmountInvalid }
  else if (afterAccruals.failure != NoFailure) afterAccruals
  else if (file.referrers.length() != afterAccruals.accounts.length() or not(M::equalAmounts(file.poolAccrued, afterAccruals.pool)))
    { ...afterAccruals, failure: CumulativeTotalMismatch }
  else if (afterReferrers.failure != NoFailure) afterReferrers
  else if (not(file.treeMatches)) { ...afterReferrers, failure: TreeMismatch }
  else if (not(file.proofsMatch)) { ...afterReferrers, failure: ProofMismatch }
  else { ...afterReferrers, filed: r.filed + 1 }
type FileCheck = { failure: WatchFailure, filed: int, awaiting: bool }
pure def checkFiles(files: List[WatchedFile], indexValid: bool, firstPeriod: int, now: int): FileCheck =
  val replayed = files.foldl(emptyReplay, (acc, file) => replayFile(firstPeriod, now, acc, file))
  if (not(indexValid)) { failure: IndexInvalid, filed: 0, awaiting: false }
  else if (replayed.failure != NoFailure) { failure: replayed.failure, filed: replayed.filed, awaiting: false }
  else if (filesStale(firstPeriod, files.length(), now)) { failure: FilesStale, filed: replayed.filed, awaiting: false }
  else { failure: NoFailure, filed: replayed.filed, awaiting: awaitingFiling(firstPeriod, files.length(), now) }
```

### Cumulative totals and accounts never decrease across files and no obligation appears twice

The replay carries every account's total, every project's total, the pool
total, the wallet pins and the obligations seen from one file into the
next, so each file's cumulative amounts must equal everything accrued up to
and including it. Because every accrued amount is non-negative, a file
whose account or pool total is below an earlier file's fails as a
cumulative mismatch, and a repeated obligation in any later file fails as
`referral_obligation_repeated`.

```quint
pure def lawRepeatedObligationFails(file: WatchedFile, r: Replay, x: WatchedAccrual): bool =
  (r.failure == NoFailure and x.obligation != "" and r.obligations.includes(x.obligation))
    implies replayAccrual(file, r, x).failure == ObligationRepeated
pure def lawFailureIsSticky(file: WatchedFile, r: Replay, x: WatchedAccrual): bool =
  r.failure != NoFailure implies replayAccrual(file, r, x) == r
pure val accrualSample: WatchedAccrual = { obligation: "o1", project: 1, referrer: 3, counted: true, assetEligible: true,
  gross: List(0, 0, 1), computed: List(0, 0, 3, 0, 0), accrued: List(0, 0, 3, 0, 0) }
pure val xValues = Set(accrualSample, { ...accrualSample, counted: false }, { ...accrualSample, accrued: List(1) })
pure val fileValues = Set({ epoch: 0, period: 24322, urlMatches: true, digestMatches: true, identityMatches: true,
  accountsWellFormed: true, amountsWellFormed: true, rate: List(3, 0, 0), projectCap: List(0, 0, 0, 0, 0, 250),
  poolCap: List(0, 0, 0, 0, 0, 0, 2), accruals: List(accrualSample),
  referrers: List({ actor: 3, cumulative: List(0, 0, 3, 0, 0), wallet: "w", walletWellFormed: true, hasLeaf: true }),
  poolAccrued: List(0, 0, 3, 0, 0), merkleRoot: "root", treeTotal: List(0, 0, 3, 0, 0), treeMatches: true, proofsMatch: true })
pure val rValues = Set(emptyReplay, { ...emptyReplay, obligations: List("o1") }, { ...emptyReplay, failure: TreeMismatch })
```

### Each posted root equals its file's tree, every void is covered and every finalized distributor event is canonical and covered once

Only files with a nonempty tree are posting candidates, in epoch order. The
distributor's epoch count must equal the posted events found
(`referral_event_coverage_mismatch`), and there are never more posts than
candidates (`referral_post_without_file`). Each void names a distinct posted
epoch (`referral_void_coverage_mismatch`) and that epoch's file root
(`referral_void_root_mismatch`). Each post names its own epoch, its file's
root and tree total (`referral_posted_root_mismatch`), and the contract's
stored epoch shows the same root, total and void state
(`referral_epoch_state_mismatch`). Every event must sit in a successful
canonical receipt of the distributor (`referral_event_not_canonical`). An
event above the finalized head, a candidate not yet posted, or a month still
awaiting filing makes the run pending, never verified. Before reading events
the run checks the chain id, a finalized deployment block and the deployed
code and token; afterwards the finalized block, the observed tip and the
epoch count must be unchanged (`referral_finality_changed`,
`referral_observation_changed`).

```quint
type PostedRoot = { epoch: int, root: str, total: M::Amount, canonical: bool, finalized: bool,
  storedRoot: str, storedTotal: M::Amount, storedVoided: bool }
type VoidEvent = { epoch: int, root: str, canonical: bool, finalized: bool }
type ChainView = { chainMatches: bool, deploymentFinalized: bool, codeMatches: bool, tokenMatches: bool,
  epochCount: int, posted: List[PostedRoot], voids: List[VoidEvent], finalityStable: bool, observationStable: bool }
type WatchStatus = WatchVerified | WatchPending | WatchFailed
type WatchResult = { status: WatchStatus, failure: WatchFailure }
pure val noFile: WatchedFile = { epoch: -1, period: 0, urlMatches: false, digestMatches: false, identityMatches: false,
  accountsWellFormed: false, amountsWellFormed: false, rate: M::zero, projectCap: M::zero, poolCap: M::zero, accruals: List(),
  referrers: List(), poolAccrued: M::zero, merkleRoot: "", treeTotal: M::zero, treeMatches: false, proofsMatch: false }
pure def candidates(files: List[WatchedFile]): List[WatchedFile] = files.select(f => f.merkleRoot != "")
pure def failed(failure: WatchFailure): WatchResult = { status: WatchFailed, failure: failure }
pure def voidsCovered(chain: ChainView): bool = chain.voids.every(v => v.epoch >= 0
  and v.epoch < chain.epochCount and chain.voids.select(o => o.epoch == v.epoch).length() == 1)
pure def postMatches(posts: List[WatchedFile], p: PostedRoot): bool =
  val file = posts.nthOr(p.epoch, noFile)
  p.epoch >= 0 and p.root == file.merkleRoot and file.merkleRoot != "" and M::equalAmounts(p.total, file.treeTotal)
pure def epochStateMatches(posts: List[WatchedFile], chain: ChainView, p: PostedRoot): bool =
  val file = posts.nthOr(p.epoch, noFile)
  p.storedRoot == file.merkleRoot and M::equalAmounts(p.storedTotal, file.treeTotal)
    and p.storedVoided == chain.voids.some(v => v.epoch == p.epoch)
pure def postsInOrder(chain: ChainView): bool =
  chain.posted.foldl({ position: 0, ordered: true }, (acc, p) => { position: acc.position + 1,
    ordered: acc.ordered and p.epoch == acc.position }).ordered
type OrderFold = { position: int, ordered: bool }
pure def checkRoots(fileCheck: FileCheck, watched: List[WatchedFile], chain: ChainView): WatchResult =
  val posts = candidates(watched)
  if (fileCheck.failure != NoFailure) failed(fileCheck.failure)
  else if (not(chain.chainMatches)) failed(WrongChain)
  else if (not(chain.deploymentFinalized)) failed(DeploymentNotFinalized)
  else if (not(chain.codeMatches)) failed(DeploymentCodeMismatch)
  else if (not(chain.tokenMatches)) failed(DeploymentTokenMismatch)
  else if (chain.posted.length() != chain.epochCount) failed(EventCoverageMismatch)
  else if (chain.posted.length() > posts.length()) failed(PostWithoutFile)
  else if (not(voidsCovered(chain))) failed(VoidCoverageMismatch)
  else if (chain.voids.some(v => v.root != posts.nthOr(v.epoch, noFile).merkleRoot)) failed(VoidRootMismatch)
  else if (chain.voids.some(v => not(v.canonical))) failed(EventNotCanonical)
  else if (not(postsInOrder(chain)) or chain.posted.some(p => not(postMatches(posts, p)))) failed(PostedRootMismatch)
  else if (chain.posted.some(p => not(p.canonical))) failed(EventNotCanonical)
  else if (chain.posted.some(p => not(epochStateMatches(posts, chain, p)))) failed(EpochStateMismatch)
  else if (not(chain.finalityStable)) failed(FinalityChanged)
  else if (not(chain.observationStable)) failed(ObservationChanged)
  else if (fileCheck.awaiting or chain.posted.length() < posts.length()
    or chain.posted.some(p => not(p.finalized)) or chain.voids.some(v => not(v.finalized)))
    { status: WatchPending, failure: NoFailure }
  else { status: WatchVerified, failure: NoFailure }
```

### Log scans cover every block from deployment to the observed tip once, in ranges of at most one million blocks

The watcher reads `RootPosted` and `RootVoided` logs of the distributor from
its deployment block to the latest block it observed, in consecutive
inclusive ranges of at most 1,000,000 blocks, so every block is read exactly
once whatever the page size; events above the finalized head only make the
run pending. The poster's own scans use the network's registered page size
the same way.

```quint
type BlockRange = { fromBlock: int, toBlock: int }
type RangeFold = { nextBlock: int, ok: bool }
pure val watchScanPageBlocks = 1000000
pure def rangesCoverOnce(ranges: List[BlockRange], firstBlock: int, lastBlock: int, pageBlocks: int): bool =
  val walked = ranges.foldl({ nextBlock: firstBlock, ok: true }, (acc, span) => { nextBlock: span.toBlock + 1,
    ok: acc.ok and span.fromBlock == acc.nextBlock and span.toBlock >= span.fromBlock
      and span.toBlock - span.fromBlock < pageBlocks and span.toBlock <= lastBlock })
  pageBlocks >= 1 and walked.ok and (if (firstBlock > lastBlock) ranges.length() == 0 else walked.nextBlock == lastBlock + 1)
pure def lawEmptyScanReadsNothing(firstBlock: int, lastBlock: int, pageBlocks: int): bool =
  (pageBlocks >= 1 and firstBlock <= lastBlock) implies not(rangesCoverOnce(List(), firstBlock, lastBlock, pageBlocks))
pure val firstBlockValues = Set(0, 5)
pure val lastBlockValues = Set(4, 5)
pure val pageBlocksValues = Set(1, 3)
```

### The watcher holds no key, runs apart from the poster, and an unavailable or oversized source fails the run explicitly

The watcher is a separate scheduled job with no signer and no private key;
its operator must differ from the root poster's, which activation already
requires. It reads each public resource without following redirects, within
30 seconds, and refuses one larger than 16 MiB
(`referral_public_data_oversized`) or one it cannot read
(`referral_public_data_unavailable`). Any other error is reported only as
`referral_watch_unavailable`, because RPC errors can contain provider URLs.
When the program's deployment is not configured the run reports inactive,
which is not a qualification.

```quint
type WatchConfig = { configured: bool, holdsKey: bool, operator: str }
pure val publicDataLimitBytes = 16777216
pure def watcherIndependent(config: WatchConfig, control: R::Referral): bool =
  not(config.holdsKey) and config.operator != "" and config.operator != control.poster
pure def publicDataFailure(available: bool, sizeBytes: int): WatchFailure =
  if (not(available)) PublicDataUnavailable else if (sizeBytes > publicDataLimitBytes) PublicDataOversized else NoFailure
```
