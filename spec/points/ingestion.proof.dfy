// Equal part lists agree at every index, so a foreign part cannot be accepted.
lemma lawMixedGenerationRefused_ensures(m: PartsManifest, read: seq<ReadPart>, wholeDigest: int)
  ensures (lawMixedGenerationRefused(m, read, wholeDigest) == true)
{
  if (exists p :: p in read && !(partOf(p) in m.parts)) && accepted(m, 4, read, wholeDigest) {
    var p :| p in read && !(partOf(p) in m.parts);
    var i :| 0 <= i < |read| && read[i] == p;
    assert partsMatch(m, read);
    assert |m.parts| == |read|;
    assert m.parts[i] == partOf(read[i]);
    assert m.parts[i] in m.parts;
  }
}
