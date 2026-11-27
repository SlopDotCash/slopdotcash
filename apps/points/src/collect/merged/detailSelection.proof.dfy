// spec/points/census.md, "A live collection spends at most 4,900 GraphQL cost points per rate-limit window, keeps a 100-point reserve and recollects a changed review census once within the same budget"
// The count of earlier members of a group is proved by induction on how many entries it has read.

lemma earlierInGroup_ensures(groups: seq<int>, count: int, group: int)
  requires (0 <= count)
  requires (count <= |groups|)
  ensures (earlierInGroup(groups, count, group) >= 0)
  ensures (earlierInGroup(groups, count, group) <= count)
{
  if count > 0 {
    earlierInGroup_ensures(groups, count - 1, group);
  }
}
