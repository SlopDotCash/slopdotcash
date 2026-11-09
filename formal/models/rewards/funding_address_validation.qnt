// @source src/lib/funding-address.mjs
// @source src/lib/verified-ids.ts
// @source src/lib/base58.ts
// @source src/lib/wallets.ts
// @source src/lib/reward-asset.mjs
// @evidence scripts/funding-address.test.ts
// Finite predicate classes for receiving-address and Solana tx-id validation.
// String/character counts, decoded lengths, witness version/program, padding
// and checksum are explicit. Polynomial arithmetic, base conversion and
// cryptographic address control remain external. Bitcoin v0/v1/future rules
// stay distinct: source requires v1 to be 32 bytes and permits v2..16 at 2..40.
// Bitcoin chars summarizes valid alphabet, separator and encoded/data length;
// canonical includes string type and lowercase spelling. EVM requires lowercase,
// 20 bytes and nonzero. Solana 32-byte addresses and 64-byte
// signatures are separate types. Validity is not direct funding permission.
// No model/parser/test execution or funding action occurred.
module funding_address_validation {
  var s: { phase: str, accepted: bool, kind: str }
  action init = s' = { phase: "input", accepted: false, kind: "none" }
  action evm(network: str, spelling: str, nonzero: bool): bool = all { s.phase == "input",
    Set("base", "ethereum", "robinhood", "other").contains(network),
    Set("lower20", "upper20", "mixed20", "short", "not-string").contains(spelling),
    s' = s.with("phase", "done").with("kind", "evm").with("accepted",
      network != "other" and spelling == "lower20" and nonzero) }
  action solana(purpose: str, isString: bool, alphabet: bool, length: int, decoded: int): bool = all {
    s.phase == "input", Set("address", "transaction").contains(purpose),
    Set(31, 32, 44, 45, 63, 64, 88, 89).contains(length), Set(31, 32, 33, 63, 64, 65).contains(decoded),
    s' = s.with("phase", "done").with("kind", purpose).with("accepted", isString and alphabet and
      (if (purpose == "address") length >= 32 and length <= 44 and decoded == 32
       else length >= 64 and length <= 88 and decoded == 64)) }
  action bitcoin(canonical: bool, hrp: bool, chars: bool, version: int, program: int, padding: bool, checksum: str): bool = all {
    s.phase == "input", Set(-1, 0, 1, 2, 16, 17).contains(version), Set(1, 2, 20, 32, 40, 41).contains(program),
    Set("bech32", "bech32m", "bad").contains(checksum),
    s' = s.with("phase", "done").with("kind", "bitcoin").with("accepted",
      canonical and hrp and chars and padding and version >= 0 and version <= 16 and program >= 2 and program <= 40
      and (if (version == 0) (program == 20 or program == 32) and checksum == "bech32"
        else (version != 1 or program == 32) and checksum == "bech32m")) }
  action step = {
    nondet yes = Set(false, true).oneOf()
    nondet other = Set(false, true).oneOf()
    nondet third = Set(false, true).oneOf()
    nondet fourth = Set(false, true).oneOf()
    nondet network = Set("base", "ethereum", "robinhood", "other").oneOf()
    nondet spelling = Set("lower20", "upper20", "mixed20", "short", "not-string").oneOf()
    nondet purpose = Set("address", "transaction").oneOf()
    nondet length = Set(31, 32, 44, 45, 63, 64, 88, 89).oneOf()
    nondet decoded = Set(31, 32, 33, 63, 64, 65).oneOf()
    nondet version = Set(-1, 0, 1, 2, 16, 17).oneOf()
    nondet program = Set(1, 2, 20, 32, 40, 41).oneOf()
    nondet checksum = Set("bech32", "bech32m", "bad").oneOf()
    any { evm(network, spelling, yes), solana(purpose, yes, other, length, decoded),
      bitcoin(yes, other, third, version, program, fourth, checksum), s' = s }
  }
  val invariant = s.accepted implies s.phase == "done"
  run lowercaseNonzeroEvmAcceptedTest = init.then(evm("base", "lower20", true)).expect(s.accepted)
  run zeroEvmRefusedTest = init.then(evm("base", "lower20", false)).expect(not(s.accepted))
  run uppercaseEvmRefusedTest = init.then(evm("ethereum", "upper20", true)).expect(not(s.accepted))
  run robinhoodWalletAddressRemainsSupportedTest = init.then(evm("robinhood", "lower20", true)).expect(s.accepted)
  run unsupportedAddressNetworkRefusedTest = init.then(evm("other", "lower20", true)).expect(not(s.accepted))
  run solanaDecodedAddressAcceptedTest = init.then(solana("address", true, true, 44, 32)).expect(s.accepted)
  run solanaAlphabetRefusedTest = init.then(solana("address", true, false, 44, 32)).expect(not(s.accepted))
  run solanaAddressWrongDecodedLengthRefusedTest = init.then(solana("address", true, true, 44, 33)).expect(not(s.accepted))
  run solanaTextLengthAloneInsufficientTest = init.then(solana("address", true, true, 31, 32)).expect(not(s.accepted))
  run signatureIsNotAnAddressTest = init.then(solana("address", true, true, 88, 64)).expect(not(s.accepted))
  run signatureRequires64DecodedBytesTest = init.then(solana("transaction", true, true, 88, 64)).expect(s.accepted)
  run signatureWrongDecodedLengthRefusedTest = init.then(solana("transaction", true, true, 88, 63)).expect(not(s.accepted))
  run bitcoinV0Bech32AcceptedTest = init.then(bitcoin(true, true, true, 0, 20, true, "bech32")).expect(s.accepted)
  run bitcoinV0Bech32mRefusedTest = init.then(bitcoin(true, true, true, 0, 20, true, "bech32m")).expect(not(s.accepted))
  run bitcoinTaprootBech32mAcceptedTest = init.then(bitcoin(true, true, true, 1, 32, true, "bech32m")).expect(s.accepted)
  run bitcoinTaprootWrongLengthRefusedTest = init.then(bitcoin(true, true, true, 1, 40, true, "bech32m")).expect(not(s.accepted))
  run bitcoinFutureVersionLengthAcceptedTest = init.then(bitcoin(true, true, true, 2, 20, true, "bech32m")).expect(s.accepted)
  run bitcoinVersion17RefusedTest = init.then(bitcoin(true, true, true, 17, 32, true, "bech32m")).expect(not(s.accepted))
  run bitcoinPaddingRefusedTest = init.then(bitcoin(true, true, true, 1, 32, false, "bech32m")).expect(not(s.accepted))
  run bitcoinUppercaseRefusedTest = init.then(bitcoin(false, true, true, 1, 32, true, "bech32m")).expect(not(s.accepted))
  run bitcoinWrongNetworkRefusedTest = init.then(bitcoin(true, false, true, 1, 32, true, "bech32m")).expect(not(s.accepted))
}
