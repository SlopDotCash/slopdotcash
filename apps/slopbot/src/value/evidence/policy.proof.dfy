// spec/slopbot/valueEvidence.md, "Story: Value only evidence that is complete and hash-verified"
lemma asciiLowerFoldsOnlyUppercaseLetters()
  ensures asciiLower(65) == 97 && asciiLower(90) == 122 && asciiLower(97) == 97 && asciiLower(122) == 122
  ensures asciiLower(64) == 64 && asciiLower(91) == 91 && asciiLower(45) == 45 && asciiLower(46) == 46 && asciiLower(95) == 95
{
}

lemma fenceRunsNeverEndALine()
  ensures !isLineTerminator(96) && !isLineTerminator(126) && !isTrimSpace(96) && !isTrimSpace(126)
  ensures isLineTerminator(13) && isTrimSpace(32) && isTrimSpace(9)
{
}
