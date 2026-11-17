// spec/settlement/composition.md, "An exact finalized event records one receipt and consumes the matching reserve"; spec/settlement/paymentDispatch.md, "Acquire an exclusive token and retain the captured request identity"
export const writes = ["payment_obligations", "payment_events", "payment_outbox", "payment_attempts", "payment_attempt_failures"] as const;
