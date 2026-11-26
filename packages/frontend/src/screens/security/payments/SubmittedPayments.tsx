// spec/frontend/walletAttempt.md, "Recovery and settlement use the saved record of the signed-in account only"; spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"; spec/settlement/payment.md, "Direct reconciliation requires a retained exact attempt"
import { Alert, Button, Field, Input } from "@repo/ui";
import { useState } from "react";
import type { SubmittedRow } from "../../../wallets/bounty/submitted.vibe";
import { isEvmHash, isSolanaSignature } from "../../../wallets/bounty/records.ts";
import { useMounted } from "../program/hooks.ts";
import type { SecurityCase } from "../cases/case.schema.ts";
import type { PaymentHold } from "../cases/CaseDetail.tsx";
import { act, useAction } from "./hooks.ts";
import { ActionOutcome, type Outcome } from "./parts.tsx";
import { type PaymentsRuntime, type Submitted, readSubmitted, verifySubmittedRows } from "./payments.vibe";

export type SubmittedPaymentsProps = Outcome & {
  solana: boolean;
  /** Each saved transaction this browser sent for the case and the value to verify, as the payer may correct it. */
  values: readonly string[];
  busy: boolean;
  onValue: (index: number, value: string) => void;
  onCheck: () => void;
  onRefresh: () => void;
};

const unreadable = "Saved transactions unreadable. Verify from the case.";

function valid(solana: boolean, value: string): boolean {
  return solana ? isSolanaSignature(value) : isEvmHash(value);
}

/** Transactions this browser already sent for the case, to verify before another payment is prepared. */
export function SubmittedPayments({ solana, values, busy, error, stale, onValue, onCheck, onRefresh }: SubmittedPaymentsProps) {
  const ready = values.some((value) => valid(solana, value.trim()));
  return (
    <section aria-label="Submitted payment recovery" className="flex flex-col gap-4">
      <p>Unverified payments</p>
      {values.map((value, index) => (
        <Field key={`tx-slot-${solana ? "sol" : "evm"}-${index + 1}`} label={`Transaction ${solana ? "signature" : "hash"} ${index + 1}`}>
          <Input value={value} spellCheck={false} disabled={busy} onChange={(event) => onValue(index, event.target.value)} />
        </Field>
      ))}
      <Button variant="secondary" className="self-start" loading={busy} disabled={!ready} onClick={onCheck}>
        Verify submitted payments
      </Button>
      <ActionOutcome error={error} stale={stale} onRefresh={onRefresh} />
    </section>
  );
}

function SavedRows({ runtime, record, submitted, hold }: { runtime: PaymentsRuntime; record: SecurityCase; submitted: Submitted; hold: PaymentHold }) {
  const [rows, setRows] = useState<readonly SubmittedRow[]>(submitted.rows);
  const action = useAction(() => hold.hold(null));
  return (
    <SubmittedPayments
      solana={submitted.solana}
      values={rows.map((row) => row.value)}
      busy={action.busy}
      error={action.error}
      stale={action.stale}
      onValue={(index, value) => setRows((prior) => prior.map((row, at) => (at === index ? { ...row, value } : row)))}
      onCheck={() => action.run(() => act(runtime, verifySubmittedRows(record, { ...submitted, rows })), hold.changed)}
      onRefresh={hold.changed}
    />
  );
}

/** Reads the signed-in account's saved transactions for this case generation; shows nothing when there are none. */
export function SubmittedPaymentsSection({ runtime, record, hold }: { runtime: PaymentsRuntime; record: SecurityCase; hold: PaymentHold }) {
  const read = useMounted(runtime, () => readSubmitted(record));
  if (read.status === "running") return null;
  if (read.status === "failed") return <Alert variant="destructive">{unreadable}</Alert>;
  if (read.value.rows.length === 0) return null;
  return <SavedRows runtime={runtime} record={record} submitted={read.value} hold={hold} />;
}
