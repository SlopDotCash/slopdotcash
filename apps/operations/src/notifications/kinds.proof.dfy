// spec/operations/notifications.md, "A replay of the same source change and recipient adds nothing"
lemma StoredKindReadsBack(k: Kind)
  ensures isStoredKind(storedKind(k)) && kindOfStored(storedKind(k)) == k
{
}

lemma storedKindsReadBackAsThemselves()
  ensures isStoredKind("security_case") && storedKind(kindOfStored("security_case")) == "security_case"
  ensures isStoredKind("wallet_changed") && storedKind(kindOfStored("wallet_changed")) == "wallet_changed"
  ensures isStoredKind("slopbot_scam_review") && storedKind(kindOfStored("slopbot_scam_review")) == "slopbot_scam_review"
  ensures !isStoredKind("admin_application") && !isStoredKind("")
{
}
