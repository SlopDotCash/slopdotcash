// spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"; spec/frontend/walletAttempt.md, "Recovery and settlement use the saved record of the signed-in account only"
lemma directRecordRoundTrips(saved: Saved, bytesId: string, legacy: string)
  requires legacy != "" && saved.identity != legacy
  requires saved.identity != "" || saved.candidate != "" || saved.hash == ""
  ensures savedOf(directAttempt(saved, bytesId, legacy), legacy) == saved
{
}

lemma solanaRecordRoundTrips(saved: Saved, bytesId: string, legacy: string)
  requires legacy != "" && saved.identity != legacy
  ensures savedOf(solanaAttempt(saved, bytesId, legacy), legacy) == saved
{
}

lemma legacyEvidenceIsKept(saved: Saved, bytesId: string, legacy: string)
  requires legacy != "" && saved.identity == "" && (saved.hash != "" || saved.candidate != "")
  ensures directAttempt(saved, bytesId, legacy).identity == ""
  ensures directAttempt(saved, bytesId, legacy).hash == saved.hash
  ensures directAttempt(saved, bytesId, legacy).candidate != ""
{
}
