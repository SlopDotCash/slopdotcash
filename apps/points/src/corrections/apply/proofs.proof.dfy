// spec/points/corrections.md, "A historical source retains its original carrier and every successor"
// Relabelling maps equal labels to equal labels, so candidates already joined stay joined when two components merge.

lemma relabeledKeepsEquality(labels: seq<int>, from: int, to: int, a: int, b: int)
  requires 0 <= a < |labels| && 0 <= b < |labels|
  requires labels[a] == labels[b]
  ensures relabeled(labels, from, to)[a] == relabeled(labels, from, to)[b]
{
}

lemma relabeledJoins(labels: seq<int>, a: int, b: int)
  requires 0 <= a < |labels| && 0 <= b < |labels|
  ensures relabeled(labels, labels[a], labels[b])[a] == relabeled(labels, labels[a], labels[b])[b]
{
}
