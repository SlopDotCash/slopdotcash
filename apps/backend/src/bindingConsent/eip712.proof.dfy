// spec/backend/bindingConsent.md, "Authorization stores a consent the attester can still submit and never edits an earlier one"
lemma decimalDigitsAreTheAsciiDigits()
  ensures isDigitCode(48) && isDigitCode(57) && !isDigitCode(47) && !isDigitCode(58)
{
}
