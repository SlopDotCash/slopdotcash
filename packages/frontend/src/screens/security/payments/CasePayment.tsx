// spec/settlement/directBounty.md, "A standard award freezes its network, asset and two split amounts"; spec/settlement/directBounty.md, "A recovered request changes only an unpaid leg after exact retirement"; spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"; spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"
import type { OwnerRequest } from "@repo/settlement/client";
import { Alert, CopyButton } from "@repo/ui";
import type { ReactNode } from "react";
import type { PageRuntime } from "../../../app/runtime.vibe";
import type { SecurityCase } from "../cases/case.schema.ts";
import type { PaymentSlot } from "../cases/CaseDetail.tsx";
import { canPay } from "../cases/labels.ts";
import { useMounted } from "../program/hooks.ts";
import { DirectBountyPaymentSection } from "./DirectBountyPayment.tsx";
import { type PaymentsRuntime, type SolanaOpened, openSolanaPayment, paymentsRuntime } from "./payments.vibe";
import { hasSolanaPlan, ownerRequestOf, requestSymbol, requestText, transferAmount } from "./request.ts";
import { SolanaBountyPaymentSection } from "./SolanaBountyPayment.tsx";
import { SolanaBountyRecoverySection } from "./SolanaBountyRecovery.tsx";
import { SubmittedPaymentsSection } from "./SubmittedPayments.tsx";
import { UnsignedRequest } from "./UnsignedRequest.tsx";

export type CasePaymentProps = {
  runtime: PaymentsRuntime;
  record: SecurityCase;
  onChanged: () => void;
};

const unpayable = ["retirement-required", "retirement-unproven"];
const expired = ["signature-required", "history-check"];
const roleNames = { researcher: "Researcher", fee: "Slop fee" } as const;

type SolanaForm = { readonly kind: "none" } | { readonly kind: "opened"; readonly opened: SolanaOpened } | { readonly kind: "failed"; readonly message: string };

interface Plan {
  readonly request: OwnerRequest | undefined;
  readonly evm: boolean;
  readonly solana: boolean;
  readonly direct: boolean;
}

/** What the old case page offered the payer for this case: the rails its prepared request can use. @throws {never} */
export function paymentPlan(record: SecurityCase): Plan {
  const settlement = record.settlement;
  const request = ownerRequestOf(settlement?.ownerRequest);
  const direct = record.paymentRail === "direct" && settlement?.generation !== undefined;
  const transactions = request?.transactions ?? [];
  const evm = direct && !unpayable.includes(settlement?.recovery?.mode ?? "") && transactions.length > 0 && transactions.every((transaction) => transaction.nonce !== undefined);
  const solana = direct && hasSolanaPlan(settlement?.ownerRequest);
  return { request, evm, solana, direct };
}

function Body({ runtime, record, onChanged, solana }: CasePaymentProps & { solana: SolanaForm }) {
  const settlement = record.settlement;
  if (settlement === null || !canPay(record)) return null;
  const plan = paymentPlan(record);
  const recovery = settlement.recovery;
  const request = plan.request;
  const form = solana.kind === "opened" ? solana.opened.form : undefined;
  const parts: ReactNode[] = [];
  if (recovery && expired.includes(recovery.mode) && recovery.payer && (recovery.messages ?? []).length > 0)
    parts.push(<SolanaBountyRecoverySection key="history" runtime={runtime} record={record} form={form} onChanged={onChanged} />);
  if (recovery?.mode === "cancellation-required" && recovery.consented === true && recovery.cancellationRequest !== undefined && recovery.cancellationRequest !== null)
    parts.push(
      <div key="cancellation" className="flex flex-col gap-3">
        <CopyButton variant="labeled" className="self-start" text={requestText(recovery.cancellationRequest)} label="Copy cancellation request" />
        <DirectBountyPaymentSection runtime={runtime} record={record} cancellation legs={[{ name: "Cancellation" }]} onChanged={onChanged} />
      </div>,
    );
  if (!plan.evm && !plan.solana && plan.direct && record.allowedActions.includes("verify-payment"))
    parts.push(<SubmittedPaymentsSection key="submitted" runtime={runtime} record={record} onChanged={onChanged} />);
  if (request !== undefined) {
    parts.push(<UnsignedRequest key="request" request={request} raw={settlement.ownerRequest} />);
    const legs = request.transfers.map((transfer) => ({ name: roleNames[transfer.role], amount: transferAmount(request, transfer), symbol: requestSymbol(request) }));
    if (plan.evm) parts.push(<DirectBountyPaymentSection key="evm" runtime={runtime} record={record} cancellation={false} legs={legs} onChanged={onChanged} />);
    if (solana.kind === "opened") parts.push(<SolanaBountyPaymentSection key="solana" runtime={runtime} record={record} opened={solana.opened} onChanged={onChanged} />);
    if (solana.kind === "failed") parts.push(<Alert key="solana" variant="destructive">{solana.message}</Alert>);
  }
  return parts.length > 0 ? <div className="flex flex-col gap-6">{parts}</div> : null;
}

function WithSolana(props: CasePaymentProps) {
  const opened = useMounted(props.runtime, () => openSolanaPayment(props.record));
  if (opened.status === "running")
    return (
      <p aria-live="polite" className="text-muted-foreground">
        Checking saved payment…
      </p>
    );
  return <Body {...props} solana={opened.status === "done" ? { kind: "opened", opened: opened.value } : { kind: "failed", message: opened.message }} />;
}

/** The payer's wallet controls for one case: history recovery, cancellation, saved transactions, the transfers due and their wallet forms. */
export function CasePayment(props: CasePaymentProps) {
  return paymentPlan(props.record).solana && canPay(props.record) ? <WithSolana {...props} /> : <Body {...props} solana={{ kind: "none" }} />;
}

/** The payment controls `SecurityCasesPage`, `SecurityInbox` and `CaseDetail` take for a case with a settlement. */
export function casePayments(page: PageRuntime): PaymentSlot {
  const runtime = paymentsRuntime(page);
  return (record, changed) => <CasePayment runtime={runtime} record={record} onChanged={changed} />;
}
