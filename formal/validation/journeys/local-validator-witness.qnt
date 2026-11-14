module localValidatorWitness {
  import operations__localCommand as C from "../../../gen/operations__localCommand"
  import operations__localValidator as V from "../../../gen/operations__localValidator"
  import operations__localValidator.ShellCaller from "../../../gen/operations__localValidator"
  import operations__localValidator.AcceptanceCaller from "../../../gen/operations__localValidator"

  run independentShellStagesTest = {
    val first = V::startStage(V::initial, ShellCaller, 1, true, true)
    val fundingStage = V::recognizeReady(first, 1, true)
    val launched = C::launch(C::initial, 1, 1, 0, true, true)
    val exited = C::exitCommand(launched, 0, 59999)
    val drained = C::confirmDrained(exited, 1, true, true)
    val funding = C::fundingResult(C::settleCommand(drained, true, false))
    val tested = V::recordTests(V::recordFunding(fundingStage, funding), 0)
    val stopped = V::recordStop(tested, 1, true, true, true)
    val between = V::finishStage(stopped)
    val second = V::startStage(between, ShellCaller, 2, true, true)
    val secondFundingStage = V::recognizeReady(second, 2, true)
    all {
      not(V::canRecognizeReady(first, 1, false)),
      not(V::canRecordTests(fundingStage, 0)),
      V::canRecordFunding(fundingStage, funding),
      not(V::canRecordStop(tested, 1, false, true, true)),
      V::canRecordStop(tested, 1, true, true, true),
      V::canFinishStage(stopped),
      V::canStartStage(between, ShellCaller, 2, true, true),
      not(V::canRecognizeReady(second, 1, true)),
      not(V::canRecordFunding(secondFundingStage, funding)),
      not(V::canRecordFunding(secondFundingStage, { receipt: 2, code: 0, cleanupConfirmed: false }))
    }
  }

  run localDeadlineAndOwnedEscalationTest = {
    val launched = C::launch(C::initial, 1, 1, 0, true, true)
    val interrupted = C::interrupt(launched, 60000, false)
    val escalated = C::escalate(interrupted, 65000, 1, true)
    val exited = C::exitCommand(escalated, 0, 65000)
    val drained = C::confirmDrained(exited, 1, true, true)
    val finished = C::settleCommand(drained, true, false)
    all {
      not(C::canLaunch(C::initial, 1, 1, 0, false, true)),
      not(C::canInterrupt(launched, 59999, false)),
      C::canInterrupt(launched, 60000, false),
      not(C::canEscalate(interrupted, 64999, 1, true)),
      not(C::canEscalate(interrupted, 65000, 1, false)),
      not(C::canEscalate(interrupted, 65000, 2, true)),
      C::canEscalate(interrupted, 65000, 1, true),
      finished.code == 1,
      finished.cleanupOk,
      C::alwaysSuccessHasCompleteEvidence(finished)
    }
  }

  run primaryFailuresAndLedgerRemovalTest = {
    val stage = V::startStage(V::initial, AcceptanceCaller, 1, true, true)
    val canceled = V::cancelStart(stage, 7)
    val stopped = V::recordStop(canceled, 1, true, true, true)
    val finished = V::finishStage(V::recordLedgerCleanup(stopped, true))
    val failed = V::finishStage(V::recordStop(canceled, 1, true, false, true))
    all {
      not(V::canRecordLedgerCleanup(canceled, true)),
      not(V::canFinishStage(stopped)),
      V::canRecordLedgerCleanup(stopped, true),
      not(finished.ledger),
      finished.status == 7,
      failed.status == 7,
      failed.ledger,
      failed.cleanupFailed
    }
  }
}
