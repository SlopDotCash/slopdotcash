// spec/backend/wallets.md, "Registration appends an immutable successor or returns the current registry row"; spec/backend/wallets.md, "The legacy possession verifier issues single-use challenges and keeps one attestation per claim"
lemma base58RefusesTheLookalikeCharacters()
  ensures !isBase58Code(48) && !isBase58Code(73) && !isBase58Code(79) && !isBase58Code(108)
  ensures isBase58Code(49) && isBase58Code(57) && isBase58Code(65) && isBase58Code(122)
{
}

lemma aSignatureEndsOnASextetWithoutSpareBits()
  ensures endsWithoutSpareBits(65) && endsWithoutSpareBits(81) && endsWithoutSpareBits(103) && endsWithoutSpareBits(119)
  ensures !endsWithoutSpareBits(66) && !endsWithoutSpareBits(82) && !endsWithoutSpareBits(61)
  ensures isBase64Code(43) && isBase64Code(47) && !isBase64Code(61) && !isBase64Code(45)
{
}

lemma evmAccountsAreLowerCaseHex()
  ensures isLowerHexCode(48) && isLowerHexCode(102) && !isLowerHexCode(65) && !isLowerHexCode(103)
{
}
