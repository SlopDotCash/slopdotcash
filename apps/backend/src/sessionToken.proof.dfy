// spec/backend/accounts.md, "Members are keyed by an immutable actor and numeric GitHub ID, and sessions by server-issued IDs"
lemma sessionTokenBoundsMatchTheIssuedCookie()
  ensures tokenLengthAllowed(40) && tokenLengthAllowed(64) && tokenLengthAllowed(128)
  ensures !tokenLengthAllowed(39) && !tokenLengthAllowed(129) && !tokenLengthAllowed(0)
{
}
