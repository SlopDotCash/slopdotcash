lemma lawCoverageRetained_ensures(base: seq<SourceCoverage>, otherCoverage: seq<SourceCoverage>, row: SourceCoverage)
  ensures (lawCoverageRetained(base, otherCoverage, row) == true)
{
  ProofLib.FilterMember((row: SourceCoverage) => !((row in base)), otherCoverage, row);
}

lemma lawOnlyObservedCoverage_ensures(base: seq<SourceCoverage>, otherCoverage: seq<SourceCoverage>, row: SourceCoverage)
  ensures (lawOnlyObservedCoverage(base, otherCoverage, row) == true)
{
  ProofLib.FilterMember((row: SourceCoverage) => !((row in base)), otherCoverage, row);
}
