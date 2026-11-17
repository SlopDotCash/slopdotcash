// spec/frontend/walletAttempt.md, "Recovery and settlement use the saved record of the signed-in account only"; spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"; spec/settlement/payment.md, "Direct reconciliation requires a retained exact attempt"
import { Alert, Button, Field, Input } from "@repo/ui";
import { useState } from "react";
import type { SubmittedRow } from "../../../wallets/bounty/submitted.vibe";
import { isEvmHash, isSolanaSignature } from "../../../wallets/bounty/records.ts";
import { useMounted } from "../program/hooks.ts";
import type { SecurityCase } from "../cases/case.schema.ts";
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

function valid(solana: boolean, value: string): boolean {
  return solana ? isSolanaSignature(value) : isEvmHash(value);
}

/** Transactions this browser already sent for the case, to verify before another payment is prepared. */
export function SubmittedPayments({ solana, values, busy, error, stale, notice, onValue, onCheck, onRefresh }: SubmittedPaymentsProps) {
  const ready = values.some((value) => valid(solana, value.trim()));
  return (
    <section aria-label="Submitted payment recovery" className="flex flex-col gap-4">
      <p>Verify transactions already sent before preparing another payment.</p>
      {values.map((value, index) => (
        <Field key={index} label={`Transaction ${solana ? "signature" : "hash"} ${index + 1}`}>
          <Input value={value} spellCheck={false} disabled={busy} onChange={(event) => onValue(index, event.target.value)} />
        </Field>
      ))}
      <Button variant="secondary" className="self-start" loading={busy} disabled={!ready} onClick={onCheck}>
        Verify submitted payments
      </Button>
      <ActionOutcome error={error} stale={stale} notice={notice} onRefresh={onRefresh} />
    </section>
  );
}

function SavedRows({ runtime, record, submitted, onChanged }: { runtime: PaymentsRuntime; record: SecurityCase; submitted: Submitted; onChanged: () => void }) {
  const [rows, setRows] = useState<readonly SubmittedRow[]>(submitted.rows);
  const action = useAction();
  return (
    <SubmittedPayments
      solana={submitted.solana}
      values={rows.map((row) => row.value)}
      busy={action.busy}
      error={action.error}
      stale={action.stale}
      notice={action.notice}
      onValue={(index, value) => setRows((prior) => prior.map((row, at) => (at === index ? { ...row, value } : row)))}
      onCheck={() => action.run(() => act(runtime, verifySubmittedRows(record, { ...submitted, rows })), () => {
        onChanged();
        return null;
      })}
      onRefresh={onChanged}
    />
  );
}

/** Reads the signed-in account's saved transactions for this case generation; shows nothing when there are none. */
export function SubmittedPaymentsSection({ runtime, record, onChanged }: { runtime: PaymentsRuntime; record: SecurityCase; onChanged: () => void }) {
  const read = useMounted(runtime, () => readSubmitted(record));
  if (read.status === "running") return null;
  if (read.status === "failed") return <Alert variant="destructive">{read.message}</Alert>;
  if (read.value.rows.length === 0) return null;
  return <SavedRows runtime={runtime} record={record} submitted={read.value} onChanged={onChanged} />;
}
