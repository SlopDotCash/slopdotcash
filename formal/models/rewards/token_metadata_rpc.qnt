// @source backend/projects/token-metadata.ts
// @source contracts/solana/token-extensions.ts
// @source src/lib/reward-asset.mjs
// @evidence backend/projects/token-metadata.test.ts
// One metadata call: native (zero RPC), EVM (four), or Solana (two).
// Network and address are fixed atoms. Chain identity, ABI bytes and approved
// SPL/Token-2022 mint layout are bounded result classes, not chain proofs.
// Required read failures distinguish retryable transport/parser errors from
// TokenMetadataError refusals. Symbol failures are always optional/null.
// HTTP bodies are either handled by the bounded reader or cancellation is
// attempted; cancellation failure preserves the original HTTP classification.
// Calls use latest EVM state and a finalized Solana account read; no atomic
// cross-request chain snapshot or mainnet/provider execution is claimed.
// Reader decimals are uint8; downstream manifest bounds remain independent.
module token_metadata_rpc {
  type State = { phase: str, family: str, stage: str, calls: int,
    responses: Set[int], bodyReads: Set[int], cancelAttempts: Set[int], cancelFailures: Set[int],
    chain: bool, bytecode: bool, mint: bool, decimalsRead: bool, decimals: int,
    symbol: bool, returned: bool, error: str }
  var s: State
  action init = s' = { phase: "input", family: "none", stage: "none", calls: 0,
    responses: Set(), bodyReads: Set(), cancelAttempts: Set(), cancelFailures: Set(),
    chain: false, bytecode: false, mint: false, decimalsRead: false, decimals: -1,
    symbol: false, returned: false, error: "none" }
  def finished(failure: str): State =
    if (s.stage == "symbol") s.with("phase", "done").with("returned", true).with("symbol", false)
    else s.with("phase", "done").with("error", failure)
  def nextRequest(stage: str): State = s.with("stage", stage).with("phase", "fetch").with("calls", s.calls + 1)
  action begin(family: str): bool = all { s.phase == "input", Set("native-evm", "native-solana", "evm", "solana").contains(family),
    s' = if (Set("native-evm", "native-solana").contains(family)) s.with("family", family).with("phase", "done")
      .with("returned", true).with("decimalsRead", true).with("decimals", if (family == "native-solana") 9 else 18).with("symbol", true)
      else nextRequest("chain").with("family", family) }
  action fetched(outcome: str): bool = all { s.phase == "fetch", Set("ok", "http", "transport").contains(outcome),
    s' = if (outcome == "transport") finished("retry")
      else s.with("responses", s.responses.union(Set(s.calls)))
        .with("phase", if (outcome == "ok") "body" else "cancel") }
  action cancel(succeeds: bool): bool = all { s.phase == "cancel",
    s' = finished("retry").with("cancelAttempts", s.cancelAttempts.union(Set(s.calls)))
      .with("cancelFailures", if (succeeds) s.cancelFailures else s.cancelFailures.union(Set(s.calls))) }
  // The 64 KiB bound covers body bytes; malformed JSON/UTF-8 and read errors
  // retain generic retry classification, while size overflow is a refusal.
  action readBody(outcome: str): bool = all { s.phase == "body", Set("ok", "malformed", "overflow", "read-error").contains(outcome),
    s' = (if (outcome == "ok") s.with("phase", "envelope")
      else finished(if (outcome == "overflow") "refused" else "retry"))
      .with("bodyReads", s.bodyReads.union(Set(s.calls))) }
  // The implementation does not validate jsonrpc/id fields. Missing result,
  // arrays and primitive JSON refuse; null property access is a generic error.
  action envelope(kind: str): bool = all { s.phase == "envelope",
    Set("result", "temporary-error", "rpc-error", "missing", "null", "primitive").contains(kind),
    s' = if (kind == "result") s.with("phase", "payload")
      else finished(if (kind == "temporary-error" or kind == "null") "retry" else "refused") }
  action payload(kind: str): bool = all { s.phase == "payload", Set("valid", "invalid", "malformed-quantity", "zero", "max").contains(kind),
    s' = if (s.stage == "chain")
      (if (kind == "valid") nextRequest(if (s.family == "evm") "code" else "mint").with("chain", true)
       else finished(if (s.family == "evm" and kind == "malformed-quantity") "retry" else "refused"))
    else if (s.stage == "code")
      (if (kind == "valid") nextRequest("decimals").with("bytecode", true) else finished("refused"))
    else if (s.stage == "decimals")
      (if (Set("valid", "zero", "max").contains(kind)) nextRequest("symbol").with("decimalsRead", true)
        .with("decimals", if (kind == "zero") 0 else if (kind == "max") 255 else 18)
       else finished("refused"))
    else if (s.stage == "mint")
      (if (kind == "valid") s.with("phase", "done").with("mint", true).with("decimalsRead", true)
        .with("decimals", 9).with("returned", true) else finished("refused"))
    else s.with("phase", "done").with("returned", true).with("symbol", kind == "valid") }
  action step = {
    nondet family = Set("native-evm", "native-solana", "evm", "solana").oneOf()
    nondet outcome = Set("ok", "http", "transport").oneOf()
    nondet body = Set("ok", "malformed", "overflow", "read-error").oneOf()
    nondet kind = Set("result", "temporary-error", "rpc-error", "missing", "null", "primitive").oneOf()
    nondet value = Set("valid", "invalid", "malformed-quantity", "zero", "max").oneOf()
    nondet succeeds = Set(false, true).oneOf()
    any { begin(family), fetched(outcome), cancel(succeeds), readBody(body), envelope(kind), payload(value), s' = s }
  }
  val invariant = all { s.calls <= 4, s.family == "solana" implies s.calls <= 2,
    s.returned implies s.decimalsRead and s.error == "none",
    s.returned and s.family == "evm" implies s.chain and s.bytecode,
    s.returned and s.family == "solana" implies s.chain and s.mint,
    s.returned and Set("native-evm", "native-solana").contains(s.family) implies s.calls == 0,
    s.decimalsRead implies s.decimals >= 0 and s.decimals <= 255,
    s.cancelFailures.subseteq(s.cancelAttempts),
    s.phase == "done" implies s.responses.subseteq(s.bodyReads.union(s.cancelAttempts)) }
  action readValue(value: str): bool = fetched("ok").then(readBody("ok")).then(envelope("result")).then(payload(value))
  action evmCode = begin("evm").then(readValue("valid"))
  action evmDecimals = evmCode.then(readValue("valid"))
  action evmSymbol = evmDecimals.then(readValue("valid"))
  run nativeSkipsRpcTest = init.then(begin("native-evm")).expect(s.returned and s.calls == 0 and s.decimals == 18 and invariant)
  run nativeSolanaKeepsNineDecimalsTest = init.then(begin("native-solana")).expect(s.returned and s.calls == 0 and s.decimals == 9 and invariant)
  run evmReadsAllRequiredStagesTest = init.then(evmSymbol).then(readValue("valid")).expect(s.returned and s.symbol and s.calls == 4 and invariant)
  run solanaGenesisPrecedesFinalizedMintTest = init.then(begin("solana")).then(readValue("valid")).then(readValue("valid")).expect(s.returned and s.calls == 2 and s.mint and invariant)
  run wrongChainPreventsAddressReadTest = init.then(begin("evm")).then(readValue("invalid")).expect(s.error == "refused" and s.calls == 1 and invariant)
  run malformedChainQuantityRemainsRetryTest = init.then(begin("evm")).then(readValue("malformed-quantity")).expect(s.error == "retry" and invariant)
  run invalidBytecodePreventsDecimalsReadTest = init.then(evmCode).then(readValue("invalid")).expect(s.error == "refused" and s.calls == 2 and invariant)
  run invalidDecimalsPreventsSymbolReadTest = init.then(evmDecimals).then(readValue("invalid")).expect(s.error == "refused" and s.calls == 3 and invariant)
  run zeroDecimalsIsPreservedTest = init.then(evmDecimals).then(readValue("zero")).then(readValue("valid")).expect(s.decimals == 0 and s.returned and invariant)
  run maximumUint8DecimalsIsPreservedTest = init.then(evmDecimals).then(readValue("max")).then(readValue("valid")).expect(s.decimals == 255 and s.returned and invariant)
  run unreadableSymbolPreservesDecimalsTest = init.then(evmSymbol).then(readValue("invalid")).expect(s.returned and not(s.symbol) and s.decimals == 18 and invariant)
  run symbolTransportFailureIsOptionalTest = init.then(evmSymbol).then(fetched("transport")).expect(s.returned and not(s.symbol) and invariant)
  run symbolHttpFailureCancelsBeforeReturningTest = init.then(evmSymbol).then(fetched("http")).then(cancel(true)).expect(s.returned and s.cancelAttempts == Set(4) and invariant)
  run symbolOversizeRemainsOptionalTest = init.then(evmSymbol).then(fetched("ok")).then(readBody("overflow")).expect(s.returned and not(s.symbol) and invariant)
  run requiredHttpFailureCancelsAndRetriesTest = init.then(begin("evm")).then(fetched("http")).then(cancel(true)).expect(s.error == "retry" and s.cancelAttempts == Set(1) and invariant)
  run failedCancelPreservesRetryTest = init.then(begin("evm")).then(fetched("http")).then(cancel(false)).expect(s.error == "retry" and s.cancelFailures == Set(1) and invariant)
  run transportFailureHasNoBodyToDisposeTest = init.then(begin("evm")).then(fetched("transport")).expect(s.error == "retry" and s.responses == Set() and invariant)
  run oversizedRequiredReplyRefusesTest = init.then(begin("evm")).then(fetched("ok")).then(readBody("overflow")).expect(s.error == "refused" and invariant)
  run malformedJsonKeepsRetryTest = init.then(begin("evm")).then(fetched("ok")).then(readBody("malformed")).expect(s.error == "retry" and invariant)
  run interruptedReadKeepsRetryTest = init.then(begin("evm")).then(fetched("ok")).then(readBody("read-error")).expect(s.error == "retry" and invariant)
  run temporaryRpcErrorKeepsRetryTest = init.then(begin("evm")).then(fetched("ok")).then(readBody("ok")).then(envelope("temporary-error")).expect(s.error == "retry" and invariant)
  run nullEnvelopeKeepsRetryTest = init.then(begin("evm")).then(fetched("ok")).then(readBody("ok")).then(envelope("null")).expect(s.error == "retry" and invariant)
  run primitiveEnvelopeRefusesTest = init.then(begin("evm")).then(fetched("ok")).then(readBody("ok")).then(envelope("primitive")).expect(s.error == "refused" and invariant)
  run missingResultRefusesTest = init.then(begin("evm")).then(fetched("ok")).then(readBody("ok")).then(envelope("missing")).expect(s.error == "refused" and invariant)
  run unsupportedMintRefusesTest = init.then(begin("solana")).then(readValue("valid")).then(readValue("invalid")).expect(s.error == "refused" and not(s.mint) and invariant)
  // Prior code accepted every string except "0x" as contract evidence.
  action oldMalformedBytecode = all { s.phase == "payload", s.stage == "code", s' = nextRequest("decimals") }
  run oldMalformedBytecodeCouldReturnMetadataTest = init.then(evmCode).then(fetched("ok")).then(readBody("ok")).then(envelope("result"))
    .then(oldMalformedBytecode).then(readValue("valid")).then(readValue("valid")).expect(s.returned and not(s.bytecode) and not(invariant))
}
