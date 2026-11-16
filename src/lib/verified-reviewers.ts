/** Selection over validated reviews in submission-time/review-ID order. */
export interface ReviewerBand {
  actor: number;
  thirds: number;
}

export interface ReviewerSelection {
  /** Every encountered actor once, in first-occurrence order. */
  actors: number[];
  /** First highest-band review index, or -1 for an unused actor slot. */
  sources: number[];
  creditedCount: number;
}

/**
 * Actor ordinals are assigned by the caller from immutable IDs. Comparison
 * order and dense-ID correspondence remain caller obligations. This scan
 * uses neither JavaScript Map nor sorting, and never mutates the input.
 */
//@ verify
//@ requires 0 <= actorCount && actorCount <= 4294967295
//@ requires 0 <= limit && limit <= 9007199254740991
//@ requires forall(i, 0 <= i && i < entries.length ==> 0 <= entries[i].actor && entries[i].actor < actorCount && 0 < entries[i].thirds && entries[i].thirds <= 9007199254740991)
//@ ensures \result.sources.length == actorCount
//@ ensures \result.actors == FirstActors(entries)
//@ ensures forall(p, 0 <= p && p < \result.actors.length ==> HasActor(entries, \result.actors[p]))
//@ ensures forall(a, HasActor(entries, a) ==> exists(p, 0 <= p && p < \result.actors.length && \result.actors[p] == a))
//@ ensures forall(p, 0 <= p && p < \result.actors.length ==> forall(q, p < q && q < \result.actors.length ==> \result.actors[p] != \result.actors[q]))
//@ ensures \result.creditedCount == (\result.actors.length < limit ? \result.actors.length : limit)
//@ ensures 0 <= \result.creditedCount && \result.creditedCount <= limit && \result.creditedCount <= \result.actors.length
//@ ensures forall(a, 0 <= a && a < actorCount ==> (\result.sources[a] == -1 <==> !HasActor(entries, a)))
//@ ensures forall(a, 0 <= a && a < actorCount && HasActor(entries, a) ==> 0 <= \result.sources[a] && \result.sources[a] < entries.length && entries[\result.sources[a]].actor == a)
//@ ensures forall(a, 0 <= a && a < actorCount && HasActor(entries, a) ==> forall(i, 0 <= i && i < entries.length && entries[i].actor == a ==> entries[i].thirds <= entries[\result.sources[a]].thirds))
//@ ensures forall(a, 0 <= a && a < actorCount && HasActor(entries, a) ==> forall(i, 0 <= i && i < \result.sources[a] && entries[i].actor == a ==> entries[i].thirds < entries[\result.sources[a]].thirds))
export function selectReviewers(
  actorCount: number,
  entries: ReviewerBand[],
  limit: number,
): ReviewerSelection {
  const sources: number[] = [];
  let a = 0;
  while (a < actorCount) {
    //@ invariant 0 <= a && a <= actorCount
    //@ invariant sources.length == a
    //@ invariant forall(k, 0 <= k && k < a ==> sources[k] == -1)
    sources.push(-1);
    a += 1;
  }
  const actors: number[] = [];
  let i = 0;
  while (i < entries.length) {
    //@ invariant 0 <= i && i <= entries.length
    //@ invariant sources.length == actorCount
    //@ invariant actors == FirstActors(entries.slice(0, i))
    //@ invariant forall(k, 0 <= k && k < actorCount ==> (sources[k] == -1 <==> !HasActor(entries.slice(0, i), k)))
    //@ invariant forall(k, 0 <= k && k < actorCount && HasActor(entries.slice(0, i), k) ==> 0 <= sources[k] && sources[k] < i && entries[sources[k]].actor == k)
    //@ invariant forall(k, 0 <= k && k < actorCount && HasActor(entries.slice(0, i), k) ==> forall(j, 0 <= j && j < i && entries[j].actor == k ==> entries[j].thirds <= entries[sources[k]].thirds))
    //@ invariant forall(k, 0 <= k && k < actorCount && HasActor(entries.slice(0, i), k) ==> forall(j, 0 <= j && j < sources[k] && entries[j].actor == k ==> entries[j].thirds < entries[sources[k]].thirds))
    const entry = entries[i];
    const previous = sources[entry.actor];
    if (previous < 0) {
      actors.push(entry.actor);
      sources[entry.actor] = i;
    } else if (entry.thirds > entries[previous].thirds) {
      sources[entry.actor] = i;
    }
    i += 1;
  }
  const creditedCount = actors.length < limit ? actors.length : limit;
  return { actors, sources, creditedCount };
}
