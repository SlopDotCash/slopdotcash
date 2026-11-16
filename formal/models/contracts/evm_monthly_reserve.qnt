// @source contracts/evm/src/ProjectEscrow.sol
// @source contracts/evm/monthly-reserve.ts
// Contract-level V2 monthly reserve of the EVM ProjectEscrow:
// `reserveMonthly`, `commitMonthlyLeaf`, `releaseMonthlyReserve`,
// `commitAward` and the ordinary source sequence that `recordAward` advances.
// The identity authority signs a reservation for one period at the current
// `ordinarySourceSequence`, listing only sources unfunded at that sequence.
// Any ordinary award recorded before the reservation lands (a manual
// `commitAward` while nothing is pending, or another period's leaf) makes it
// revert with MonthlySourceChanged. A reservation moves its remaining gross
// from free to `pendingMonthlyGross` once per period inside the period's
// window. A leaf moves its gross from the period's remaining reserve to a
// recorded award without charging free again; global source consumption
// refuses a replayed or duplicate source. The contract accepts a partial
// signed release of the current remaining reserve, and a leaf still proves
// afterwards while its gross fits what remains. The release service
// (monthly_release) signs only the whole untouched reserve; the contract does
// not enforce that policy.
//
// Abstractions: the Merkle proof is membership of (source, gross) in the
// signed leaf set; wholeGross equals remainingGross (sources already funded
// at signing are left out); principal and fee are one gross amount, and a
// withdrawal fee leaves with the withdrawn gross. Bounds: periods 1 and 2
// (period p's window is open while now == p), sources 1 and 2, gross 1..2,
// cap 3, deposits up to 4, at most two sequence advances signed against.
module evm_monthly_reserve {
  type Sig = { valid: bool, seq: int, leaves: Set[(int, int)] }
  type Month = { root: bool, admitted: int, remaining: int, released: int, leafSum: int,
    leaves: Set[(int, int)] }
  type S = { free: int, pending: int, reservedAwards: int, paid: int, withdrawn: int,
    deposited: int, seq: int, enabled: bool, now: int, months: int -> Month,
    sigs: int -> Sig, consumed: Set[int], awards: Set[(int, int)], uses: int -> int }
  var s: S
  pure val Periods = Set(1, 2)
  pure val Sources = Set(1, 2)
  pure val Cap = 3
  pure val MaxDeposit = 4
  pure val NoMonth = { root: false, admitted: 0, remaining: 0, released: 0, leafSum: 0, leaves: Set() }
  pure val NoSig = { valid: false, seq: 0, leaves: Set() }
  // Leaf sets with distinct sources and gross 1..2.
  pure val LeafSets = Set(Set((1, 1)), Set((1, 2)), Set((2, 1)), Set((2, 2)),
    Set((1, 1), (2, 1)), Set((1, 1), (2, 2)), Set((1, 2), (2, 1)), Set((1, 2), (2, 2)))

  action init = s' = { free: 0, pending: 0, reservedAwards: 0, paid: 0, withdrawn: 0,
    deposited: 0, seq: 0, enabled: true, now: 1, months: Periods.mapBy(p => NoMonth),
    sigs: Periods.mapBy(p => NoSig), consumed: Set(), awards: Set(), uses: Sources.mapBy(x => 0) }

  def sum(leaves: Set[(int, int)]): int = leaves.fold(0, (acc, l) => acc + l._2)
  def open(p: int): bool = s.now == p

  // recordAward: the source is consumed once and the ordinary sequence advances.
  def record(src: int, g: int): S = s.with("consumed", s.consumed.union(Set(src)))
    .with("awards", s.awards.union(Set((src, g)))).with("seq", s.seq + 1)
    .with("uses", s.uses.set(src, s.uses.get(src) + 1))

  action deposit(a: int): bool = all { a >= 1, s.deposited + a <= MaxDeposit,
    s' = s.with("free", s.free + a).with("deposited", s.deposited + a) }
  // commitAward: refused while any monthly gross is pending (MonthlyLeavesPending).
  action commitOrdinary(src: int, g: int): bool = all { s.pending == 0,
    not(s.consumed.contains(src)), g <= s.free,
    s' = record(src, g).with("free", s.free - g).with("reservedAwards", s.reservedAwards + g) }
  action setEnabled(on: bool): bool = s' = s.with("enabled", on)
  // The identity service signs only sources unfunded at the current sequence.
  action signReservation(p: int, leaves: Set[(int, int)]): bool = all {
    not(s.months.get(p).root), s.seq < 3, sum(leaves) <= Cap,
    leaves.forall(l => not(s.consumed.contains(l._1))),
    s' = s.with("sigs", s.sigs.set(p, { valid: true, seq: s.seq, leaves: leaves })) }
  action reserve(p: int): bool = {
    val sig = s.sigs.get(p)
    val g = sum(sig.leaves)
    all { sig.valid, s.enabled, open(p), not(s.months.get(p).root),
      sig.seq == s.seq, g <= Cap, g <= s.free,
      s' = s.with("free", s.free - g).with("pending", s.pending + g)
        .with("months", s.months.set(p, { root: true, admitted: g, remaining: g, released: 0,
          leafSum: 0, leaves: sig.leaves })) } }
  // commitMonthlyLeaf needs neither the window nor the owner's opt-in.
  action leaf(p: int, src: int, g: int): bool = {
    val m = s.months.get(p)
    all { m.root, m.leaves.contains((src, g)), g <= m.remaining, not(s.consumed.contains(src)),
      s' = record(src, g).with("pending", s.pending - g)
        .with("reservedAwards", s.reservedAwards + g)
        .with("months", s.months.set(p, m.with("remaining", m.remaining - g)
          .with("leafSum", m.leafSum + g))) } }
  // releaseMonthlyReserve: expected must equal the current remaining reserve.
  action release(p: int, expected: int, amt: int): bool = {
    val m = s.months.get(p)
    all { m.root, expected == m.remaining, amt > 0, amt <= expected,
      s' = s.with("pending", s.pending - amt).with("free", s.free + amt)
        .with("months", s.months.set(p, m.with("remaining", expected - amt)
          .with("released", m.released + amt))) } }
  action pay(src: int, g: int): bool = all { s.awards.contains((src, g)),
    s' = s.with("awards", s.awards.exclude(Set((src, g))))
      .with("reservedAwards", s.reservedAwards - g).with("paid", s.paid + g) }
  action withdraw(g: int): bool = all { g >= 1, g <= s.free,
    s' = s.with("free", s.free - g).with("withdrawn", s.withdrawn + g) }
  action tick = all { s.now < 3, s' = s.with("now", s.now + 1) }

  action step = any {
    nondet a = 1.to(2).oneOf()
    deposit(a),
    nondet k = 0.to(3).oneOf()
    any { commitOrdinary(k % 2 + 1, k / 2 + 1), pay(k % 2 + 1, k / 2 + 1), withdraw(k / 2 + 1) },
    nondet p = Periods.oneOf()
    nondet leaves = LeafSets.oneOf()
    signReservation(p, leaves),
    nondet p = Periods.oneOf()
    reserve(p),
    nondet k = 0.to(7).oneOf()
    leaf(k % 2 + 1, (k / 2) % 2 + 1, k / 4 + 1),
    nondet p = Periods.oneOf()
    nondet amt = 1.to(Cap).oneOf()
    release(p, s.months.get(p).remaining, amt),
    setEnabled(false), setEnabled(true), tick, s' = s }

  val invariant = all {
    s.free >= 0, s.pending >= 0, s.reservedAwards >= 0,
    s.free + s.pending + s.reservedAwards + s.paid + s.withdrawn == s.deposited,
    Periods.forall(p => {
      val m = s.months.get(p)
      all { m.remaining >= 0, m.released + m.leafSum + m.remaining == m.admitted,
        not(m.root) implies m.admitted == 0 } }),
    s.pending == Periods.fold(0, (acc, p) => acc + s.months.get(p).remaining),
    Sources.forall(x => s.uses.get(x) <= 1),
    Sources.forall(x => s.consumed.contains(x) iff s.uses.get(x) == 1),
    s.awards.forall(a => s.consumed.contains(a._1)) }

  run fundedRun = init.then(deposit(2)).then(deposit(2))
  run sequenceChangeRevertsReservationTest = fundedRun.then(signReservation(1, Set((1, 1))))
    .then(commitOrdinary(2, 1)).then(reserve(1).fail())
  run reattestedReservationLandsTest = fundedRun.then(signReservation(1, Set((1, 1))))
    .then(commitOrdinary(2, 1)).then(signReservation(1, Set((1, 1)))).then(reserve(1))
    .expect(s.pending == 1 and invariant)
  run otherPeriodLeafRevertsReservationTest = fundedRun.then(signReservation(1, Set((1, 1))))
    .then(reserve(1)).then(signReservation(2, Set((2, 1)))).then(leaf(1, 1, 1)).then(tick)
    .then(reserve(2).fail())
  run pendingBlocksManualAwardTest = fundedRun.then(signReservation(1, Set((1, 1), (2, 1))))
    .then(reserve(1)).then(commitOrdinary(1, 1).fail())
  run partialReleaseThenFittingLeafTest = fundedRun.then(signReservation(1, Set((1, 1), (2, 1))))
    .then(reserve(1)).then(release(1, 2, 1)).then(leaf(1, 1, 1))
    .expect(s.months.get(1).remaining == 0 and s.months.get(1).released == 1 and invariant)
    .then(leaf(1, 2, 1).fail())
  run staleExpectedReleaseRefusedTest = fundedRun.then(signReservation(1, Set((1, 1), (2, 1))))
    .then(reserve(1)).then(leaf(1, 1, 1)).then(release(1, 2, 1).fail())
  run wholeUntouchedReleaseTest = fundedRun.then(signReservation(1, Set((1, 2))))
    .then(reserve(1)).then(release(1, 2, 2))
    .expect(s.free == 4 and s.pending == 0 and s.months.get(1).released == 2 and invariant)
    .then(reserve(1).fail())
  run leafSurvivesOptOutAndWindowTest = fundedRun.then(signReservation(1, Set((1, 2))))
    .then(reserve(1)).then(setEnabled(false)).then(tick).then(leaf(1, 1, 2))
    .expect(s.pending == 0 and s.reservedAwards == 2 and invariant)
  run duplicateSourceAcrossPeriodsTest = fundedRun.then(signReservation(1, Set((1, 1))))
    .then(signReservation(2, Set((1, 1)))).then(reserve(1)).then(tick).then(reserve(2))
    .then(leaf(1, 1, 1)).then(leaf(2, 1, 1).fail())
  run reservationNeedsFreeBalanceTest = init.then(deposit(1)).then(signReservation(1, Set((1, 2))))
    .then(reserve(1).fail())
  run closedWindowRefusedTest = fundedRun.then(signReservation(1, Set((1, 1)))).then(tick)
    .then(reserve(1).fail())
}
