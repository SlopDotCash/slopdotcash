// @source contracts/evm/src/ProjectEscrow.sol
// @source contracts/solana/programs/slop-escrow/src/lib.rs
// @source workers/payment-executor/core.ts
// @evidence workers/payment-executor/bind-trigger.integration.ts
// EVM registrar replacement and Solana owner+independent confirmer rotation.
// The EVM journal is a separately bounded refinement: an old already-signed
// binding can arrive after rotation and revert, while a binding mined before
// rotation remains usable. Reconciliation needs canonical finalized evidence
// even after this signer has lost authority. Two keys and two binding versions.
module authority_rotation {
  type S = { chain: str, current: int, pending: int, confirmed: bool,
    ready: bool, bindings: int, awards: int, bindingVersion: int,
    consentVersion: int, consent: bool, attemptBy: int, attemptState: str,
    held: bool, canonical: bool, finalized: bool, paid: bool }
  var s: S
  action init = s' = { chain: "solana", current: 1, pending: 0, confirmed: false,
    ready: false, bindings: 2, awards: 3, bindingVersion: 0, consentVersion: 0,
    consent: false, attemptBy: 0, attemptState: "none", held: false,
    canonical: false, finalized: false, paid: false }
  action evm = all { s.pending == 0, s.chain == "solana", s' = s.with("chain", "evm") }
  action propose(key: int): bool = all { s.pending == 0, key != s.current,
    s' = s.with("pending", key).with("confirmed", s.chain == "evm").with("ready", s.chain == "evm") }
  action confirm = all { s.pending > 0, not(s.confirmed), s' = s.with("confirmed", true) }
  action waitDelay = s' = s.with("ready", true)
  action cancel = all { s.pending > 0, s' = s.with("pending", 0).with("confirmed", false).with("ready", false) }
  action execute = all { s.pending > 0, s.confirmed, s.ready,
    s' = s.with("current", s.pending).with("pending", 0).with("confirmed", false).with("ready", false) }
  action walletConsent = all {s.chain=="evm",s.bindingVersion<2,
    s'=s.with("consent",true).with("consentVersion",s.bindingVersion)}
  action journalBinding = all {s.chain=="evm",s.consent,not(s.held),s.bindingVersion<2,
    s.consentVersion==s.bindingVersion,
    s'=s.with("attemptBy",s.current).with("attemptState","signed")
      .with("held",true).with("canonical",false).with("finalized",false)}
  action broadcastBinding = all {s.held,s.attemptState=="signed",s.attemptBy==s.current,
    s'=s.with("attemptState","broadcast")}
  action delayedDelivery = all {s.held,Set("signed","broadcast").contains(s.attemptState),
    s'=if(s.attemptBy==s.current)
      s.with("attemptState","bound").with("bindingVersion",s.bindingVersion+1).with("consent",false)
    else s.with("attemptState","reverted")}
  action observeCanonical(matches) = all {s.held,not(s.finalized),
    Set("bound","reverted").contains(s.attemptState),s'=s.with("canonical",matches)}
  action finalizeReceipt = all {s.held,s.canonical,s'=s.with("finalized",true)}
  action reconcile = all {s.held,s.canonical,s.finalized,
    s'=s.with("held",false).with("attemptState","reconciled")}
  action payExisting = all {s.bindingVersion>0,not(s.paid),s'=s.with("paid",true)}
  action step = any { evm, propose(1), propose(2), confirm, waitDelay, cancel, execute,
    walletConsent,journalBinding,broadcastBinding,delayedDelivery,observeCanonical(false),
    observeCanonical(true),finalizeReceipt,reconcile,payExisting,s' = s }
  val invariant = all {s.bindings == 2,s.awards == 3,s.current > 0,
    s.bindingVersion<=2,s.paid implies s.bindingVersion>0,
    s.finalized implies s.canonical,
    s.attemptState=="reconciled" implies (not(s.held) and s.finalized)}
  run independentConfirmationTest = init.then(propose(2)).then(waitDelay).then(execute.fail())
  run solanaRotationTest = init.then(propose(2)).then(confirm).then(waitDelay).then(execute).expect(s.current == 2 and invariant)
  run evmRotationTest = init.then(evm).then(propose(2)).then(execute).expect(s.current == 2 and invariant)
  run rotatedAuthorityCannotRebroadcastHeldBindingTest = init.then(evm).then(walletConsent)
    .then(journalBinding).then(propose(2)).then(execute).then(broadcastBinding.fail())
  run delayedOldAuthorityRevertsAndReconcilesTest = init.then(evm).then(walletConsent)
    .then(journalBinding).then(propose(2)).then(execute).then(delayedDelivery)
    .then(observeCanonical(true)).then(finalizeReceipt).then(reconcile)
    .expect(s.bindingVersion==0 and not(s.held) and s.current==2 and invariant)
  run noncanonicalReceiptKeepsBindingHeldTest = init.then(evm).then(walletConsent)
    .then(journalBinding).then(delayedDelivery).then(observeCanonical(false))
    .expect(s.held).then(finalizeReceipt.fail())
  run minedBindingSurvivesAuthorityRotationTest = init.then(evm).then(walletConsent)
    .then(journalBinding).then(delayedDelivery).then(propose(2)).then(execute)
    .then(observeCanonical(true)).then(finalizeReceipt).then(reconcile).then(payExisting)
    .expect(s.paid and s.bindingVersion==1 and s.current==2 and invariant)
}
