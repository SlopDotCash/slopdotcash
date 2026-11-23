// spec/frontend/ownerVault.md, "A wallet reply settles only its own attempt; an unclear one waits for the owner"; spec/settlement/ownerTransactions.md, "The pending request is saved before the wallet call and recovered without resubmission"
import { Button, Disclosure, Field, Input, TransactionStatus } from "@repo/ui";
import { useState } from "react";

export type PendingCheckProps = {
  /** What the saved request does, such as "Deposit" or "Token approval". */
  action: string;
  /** The status line of a request whose screen names it with a spinner, such as "Pending · don't resend"; otherwise the action awaits verification. */
  status?: string;
  /** The request's exact amount, already formatted. */
  amount?: string;
  /** The transaction hash or signature the wallet returned or the owner entered. */
  hash?: string;
  /** The transaction's page on the network's explorer. */
  explorerUrl?: string;
  /** A Solana request is named by its signature, an EVM one by its hash. */
  solana?: boolean;
  /** A wallet is connected, so the chain can be read. */
  canCheck: boolean;
  /** A wallet or chain request is running. */
  busy?: boolean;
  /** Reads the chain for the saved request. */
  onCheck: () => void;
  /** Saves the hash the owner found in wallet activity, then checks it; offered while no hash is saved. */
  onEnterHash?: (candidate: string) => void;
  /** Clears the saved request after the owner confirmed in wallet activity that nothing was sent. */
  onConfirmUnsent?: () => void;
};

/** A saved wallet request that must be verified before another is sent, with its recovery controls. */
export function PendingCheck({ action, status, amount, hash, explorerUrl, solana = false, canCheck, busy = false, onCheck, onEnterHash, onConfirmUnsent }: PendingCheckProps) {
  const [candidate, setCandidate] = useState("");
  const label = solana ? "Transaction signature" : "Transaction hash";
  return (
    <TransactionStatus
      presentation={status === undefined ? { tone: "Notice", icon: "Clock", label: `${action} awaiting verification. Do not send it again.` } : { tone: "Notice", icon: "Spinner", label: status }}
      hash={hash || undefined}
      hashLabel={label}
      explorerUrl={explorerUrl}
      explorerLabel="Transaction"
      actions={
        <>
          {amount ? <span className="text-sm text-foreground">{amount}</span> : null}
          {onEnterHash ? (
            <form
              className="flex w-full flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                onEnterHash(candidate);
              }}
            >
              <Field label={label} className="min-w-0 flex-1">
                <Input value={candidate} disabled={busy} autoComplete="off" spellCheck={false} onChange={(event) => setCandidate(event.target.value)} />
              </Field>
              <Button type="submit" variant="secondary" disabled={!canCheck || candidate.trim() === ""} loading={busy}>
                Check transaction
              </Button>
            </form>
          ) : (
            <Button variant="secondary" disabled={!canCheck} loading={busy} onClick={onCheck}>
              Check transaction
            </Button>
          )}
          {onConfirmUnsent && candidate.trim() === "" ? (
            <Disclosure summary="Nothing was sent?">
              <Button variant="secondary" disabled={busy} onClick={onConfirmUnsent}>
                Not sent — clear
              </Button>
            </Disclosure>
          ) : null}
        </>
      }
    />
  );
}
