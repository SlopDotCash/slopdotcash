// spec/fees/feeReport.md, "Only an administrator reads the fee report, and it never contains a signed transaction or secret"
lemma keptCountBoundsTheTail()
  ensures keptCount(3, 100) == 3 && keptCount(250, 100) == 100 && keptCount(12, 10) == 10 && keptCount(0, 10) == 0
{
}

lemma candidateNeedsEveryCheck()
  ensures candidateAccepted(true, true, true, true, true, true)
  ensures !candidateAccepted(false, true, true, true, true, true) && !candidateAccepted(true, false, true, true, true, true)
  ensures !candidateAccepted(true, true, false, true, true, true) && !candidateAccepted(true, true, true, false, true, true)
  ensures !candidateAccepted(true, true, true, true, false, true) && !candidateAccepted(true, true, true, true, true, false)
{
}
