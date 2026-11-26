// spec/security/cases.md, "Current technical approvers and triagers request information on the current report version"; spec/security/cases.md, "A technical decision records the finding, duplicate identity and relatedness"; spec/security/reportDeposit.md, "A paid deposit is sent back on a first response and kept only after a keeping close stood seven days"; spec/security/cases.md, "An award commits only under paid terms, eligibility and project clearance"; spec/security/cases.md, "An independent moderator upholds or returns the appeal"; spec/security/cases.md, "Authority snapshots advance and triager membership is audited at the next revision"
import { REPORT_DEPOSIT_SWITCHED_ON } from "@repo/security/client";
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { utcInput } from "../../../flows/security/cases.vibe";
import { REPORT_DEPOSIT_SPAM_INFO } from "../../../projections/reportDeposit.ts";
import { decimalToMinor } from "./amount.ts";
import type { SecurityCase } from "./case.schema.ts";
import { awardAmounts, awardText, money } from "./labels.ts";

type Shown = { readonly field: string; readonly values: ReadonlyArray<string> };

export type FieldSpec =
  | {
      readonly name: string;
      readonly label: string;
      readonly kind: "text" | "textarea";
      readonly placeholder?: string;
      readonly private?: boolean;
      readonly optional?: boolean;
      readonly requiredWhen?: Shown;
      readonly initial?: string;
      readonly when?: Shown;
    }
  | { readonly name: string; readonly label: string; readonly kind: "select"; readonly options: ReadonlyArray<readonly [string, string]>; readonly when?: Shown }
  | { readonly name: string; readonly label: string; readonly kind: "checkbox"; readonly info?: string; readonly publicNotice?: boolean; readonly when?: Shown }
  | { readonly name: string; readonly label: string; readonly kind: "utc"; readonly when?: Shown }
  | { readonly name: string; readonly label: string; readonly kind: "amount"; readonly decimals: number; readonly chip?: string; readonly initial?: string; readonly readOnly?: boolean; readonly when?: Shown };

export interface ActionSpec {
  readonly title: string;
  readonly submit: string;
  readonly fields: ReadonlyArray<FieldSpec>;
}

export type FieldValues = Readonly<Record<string, string | boolean>>;

export type ActionFields = { readonly ok: true; readonly fields: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly message: string };

const reason = { name: "reason", label: "Reason", kind: "textarea", private: true } as const satisfies FieldSpec;

const severityOptions: ReadonlyArray<readonly [string, string]> = [
  ["critical", "Critical"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
  ["informational", "Informational"],
  ["unresolved", "Unresolved"],
];

const unrecoverable = ["legacy-manual", "consent-required", "wallet-required", "signature-required", "payment-found", "fee-pending", "retirement-unproven", "payer-review"];

export const primaryActions: ReadonlyArray<string> = [
  "verify-link",
  "reject-link",
  "request-information",
  "decide",
  "award",
  "remediation",
  "decide-appeal",
  "decide-related-party",
  "prepare-payment",
  "verify-payment",
  "recover-payment",
  "consent-payment",
  "appeal",
];

function awardSpec(record: SecurityCase): ActionSpec | null {
  if (record.terms === null) return null;
  const terms = record.terms;
  const fixed = terms.fundingPolicy === "after-approval";
  const direct = record.paymentRail === "direct";
  const chip = direct ? undefined : record.awardFunds ? `Available ${money(record.awardFunds.availableMinor, record.awardFunds)}` : "No verified funds";
  const exact = terms.grossMinor !== undefined && /^[0-9]+$/u.test(terms.grossMinor) && Number.isInteger(terms.decimals) && terms.decimals >= 0 && terms.decimals <= 36;
  const fixedGross = fixed && exact && terms.grossMinor !== undefined ? formatBaseUnits({ value: BigInt(terms.grossMinor), decimals: terms.decimals, grouping: false }) : undefined;
  return {
    title: "Award",
    submit: "Save",
    fields: [
      {
        name: "decision",
        label: "Decision",
        kind: "select",
        options: [
          ["amount", "Award"],
          ["none", "No award"],
        ],
      },
      { name: "grossMinor", label: `Gross award (${terms.currency})`, kind: "amount", decimals: terms.decimals, initial: fixedGross, readOnly: fixed, chip, when: { field: "decision", values: ["amount"] } },
      { name: "paymentDeadline", label: "Payment deadline (UTC)", kind: "utc", when: { field: "decision", values: ["amount"] } },
      {
        name: "confirmation",
        label: `Approve award for @${record.reporter?.githubLogin ?? "the reporter"}`,
        kind: "checkbox",
        when: { field: "decision", values: ["amount"] },
      },
      reason,
    ],
  };
}

function paymentSpec(action: "consent-payment" | "prepare-payment", record: SecurityCase): ActionSpec | null {
  if (record.paymentNetworks.length === 0) return null;
  const consent = action === "consent-payment";
  return {
    title: consent ? "Visibility" : record.settlement ? "Refresh payment" : "Prepare payment",
    submit: consent ? "Accept" : record.settlement ? "Refresh" : "Prepare",
    fields: [
      { name: "network", label: "Network", kind: "select", options: record.paymentNetworks.map((network) => [network, network] as const) },
      {
        name: "confirmation",
        label: consent
          ? record.paymentRail === "direct"
            ? "On-chain: wallet, time, amount public"
            : "On-chain: GitHub ID, wallet, time, amount public"
          : `Approve ${awardAmounts(record) ?? awardText(record)}`,
        publicNotice: consent,
        kind: "checkbox",
      },
    ],
  };
}

function recoverySpec(record: SecurityCase): ActionSpec | null {
  const recovery = record.settlement?.recovery;
  if (!recovery || unrecoverable.includes(recovery.mode)) return null;
  const transaction = recovery.mode === "cancellation-required" || recovery.mode === "retirement-required";
  return {
    title: "Recover payment",
    submit:
      recovery.mode === "resume-original" ? "Resume" : transaction ? "Verify" : "Check",
    fields: [
      ...(transaction
        ? [
            { name: "cancellationTransactionId", label: "Transaction ID", kind: "text" } as const,
          ]
        : []),
      { name: "confirmation", label: "Approve recovery to this wallet", kind: "checkbox" },
    ],
  };
}

function decideSpec(record: SecurityCase): ActionSpec {
  const proposal = record.analysis?.state === "complete" ? record.analysis : null;
  return {
    title: "Decide",
    submit: "Record decision",
    fields: [
      {
        name: "outcome",
        label: "Outcome",
        kind: "select",
        options: [
          ["confirmed", "Confirmed"],
          ["duplicate", "Duplicate"],
          ["out-of-scope", "Out of scope"],
          ["rejected", "Rejected"],
        ],
      },
      ...(REPORT_DEPOSIT_SWITCHED_ON ? [{ name: "spam", label: "Spam", info: REPORT_DEPOSIT_SPAM_INFO, kind: "checkbox", when: { field: "outcome", values: ["rejected"] } } as const satisfies FieldSpec] : []),
      { name: "severity", label: "Severity", kind: "select", options: [["", "Choose severity"], ...severityOptions] },
      {
        name: "loss",
        label: "Loss of funds",
        kind: "select",
        options: [
          ["unresolved", "Unresolved"],
          ["verified-potential", "Potential"],
          ["verified-actual", "Actual"],
          ["not-verified", "None"],
        ],
      },
      { name: "inScope", label: "In scope", kind: "checkbox" },
      { name: "relatedParty", label: "Related party", info: "Owner, employee, sponsor or approver", kind: "checkbox" },
      { name: "rootCauseKey", label: "Root cause key", kind: "text", optional: true, initial: proposal?.rootCauseKey ?? "", placeholder: "root-cause-key" },
      { name: "duplicateOf", label: "Original case ID", kind: "text", when: { field: "outcome", values: ["duplicate"] }, initial: proposal?.duplicateCaseIds[0] ?? "" },
      { name: "evidenceReference", label: "Evidence ref", kind: "text", optional: true },
      reason,
    ],
  };
}

/** The form of one case action, or null when this case cannot take it here. @throws {never} */
export function actionSpec(action: string, record: SecurityCase): ActionSpec | null {
  switch (action) {
    case "verify-link":
      return {
        title: "Verify report",
        submit: "Verify report",
        fields: [
          { name: "receivedAt", label: "Received (UTC)", kind: "utc" },
          {
            name: "confirmation",
            label: `Verified on GitHub: ${record.advisory?.ghsa ?? "this advisory"} by @${record.reporter?.githubLogin ?? "the reporter"}`,
            kind: "checkbox",
          },
        ],
      };
    case "reject-link":
      return { title: "Reject this link", submit: "Reject link", fields: [reason] };
    case "request-information":
      return {
        title: "Request info",
        submit: "Ask for information",
        fields: [{ name: "reason", label: "What you need", kind: "textarea" }],
      };
    case "decide":
      return decideSpec(record);
    case "award":
      return awardSpec(record);
    case "remediation":
      return {
        title: "Remediation",
        submit: "Save remediation state",
        fields: [
          {
            name: "remediationState",
            label: "Remediation state",
            kind: "select",
            options: [
              ["investigating", "Investigating"],
              ["fixing", "Fixing"],
              ["retest", "Retest"],
              ["resolved", "Resolved"],
              ["mitigation-verified", "Mitigated"],
              ["reopened", "Reopened"],
            ],
          },
          { name: "patchDigest", label: "Patch SHA-256", kind: "text", when: { field: "remediationState", values: ["retest", "resolved", "mitigation-verified"] } },
          { name: "evidenceReference", label: "Evidence ref", kind: "text", optional: true, requiredWhen: { field: "remediationState", values: ["resolved", "mitigation-verified"] } },
          { ...reason, optional: true },
        ],
      };
    case "disclosure":
      return {
        title: "Disclosure",
        submit: "Save disclosure decision",
        fields: [
          {
            name: "disclosureState",
            label: "Disclosure state",
            kind: "select",
            options: [
              ["embargoed", "Embargoed"],
              ["redaction-approved", "Redaction approved"],
              ["disclosed", "Disclosed"],
            ],
          },
          { name: "evidenceReference", label: "Approval ref", kind: "text" },
          { name: "redactedContentDigest", label: "Redacted SHA-256", kind: "text", optional: true, requiredWhen: { field: "disclosureState", values: ["redaction-approved", "disclosed"] } },
          { name: "embargoChange", label: "Embargo change", kind: "textarea", optional: true },
          reason,
        ],
      };
    case "assign-triager":
      return {
        title: "Assign a triager",
        submit: "Assign triager",
        fields: [
          { name: "githubId", label: "GitHub ID", kind: "text" },
          { name: "githubLogin", label: "Login", kind: "text" },
        ],
      };
    case "revoke-triager": {
      const active = (record.triagers ?? []).filter((entry) => entry.revokedAt === null);
      if (active.length === 0) return null;
      return {
        title: "Remove a triager",
        submit: "Remove triager",
        fields: [{ name: "githubId", label: "Triager", kind: "select", options: active.map((entry) => [entry.githubId, `@${entry.githubLogin}`] as const) }],
      };
    }
    case "recognition": {
      const choices: ReadonlyArray<readonly [string, string]> = [
        ["private", "Off"],
        ["opt-in", "On"],
      ];
      return {
        title: "Public recognition",
        submit: "Save my choice",
        fields: [{ name: "recognition", label: "Public name", kind: "select", options: [...choices].sort(([value]) => (value === record.recognition ? -1 : 1)) }],
      };
    }
    case "appeal":
      return {
        title: "Appeal",
        submit: "Send appeal",
        fields: [{ name: "reason", label: "Reason", kind: "textarea", private: true }],
      };
    case "decide-appeal":
      return {
        title: "Decide the appeal",
        submit: "Record appeal decision",
        fields: [
          {
            name: "outcome",
            label: "Outcome",
            kind: "select",
            options: [
              ["uphold", "Uphold"],
              ["return", "Return"],
            ],
          },
          reason,
        ],
      };
    case "decide-related-party":
      return {
        title: "Related-party review",
        submit: "Record review",
        fields: [
          {
            name: "outcome",
            label: "Outcome",
            kind: "select",
            options: [
              ["approve", record.award && record.terms ? `Approve ${money(record.award.grossMinor, record.terms)}` : "Approve"],
              ["refuse", "Refuse"],
            ],
          },
          reason,
        ],
      };
    case "consent-payment":
    case "prepare-payment":
      return paymentSpec(action, record);
    case "verify-payment":
      return {
        title: "Verify payment",
        submit: "Verify payment",
        fields: [
          { name: "transactionIds", label: "Transaction IDs", kind: "textarea", placeholder: "One per line" },
          { name: "confirmation", label: "Pays this award", kind: "checkbox" },
        ],
      };
    case "recover-payment":
      return recoverySpec(record);
    default:
      return null;
  }
}

/** @throws {never} */
export function initialValues(spec: ActionSpec): FieldValues {
  return Object.fromEntries(
    spec.fields.map((field) => [field.name, field.kind === "checkbox" ? false : field.kind === "select" ? (field.options[0]?.[0] ?? "") : "initial" in field ? (field.initial ?? "") : ""]),
  );
}

/** @throws {never} */
export function fieldShown(field: FieldSpec, values: FieldValues): boolean {
  return field.when === undefined || field.when.values.includes(String(values[field.when.field]));
}

/** The case's actions this page can take, common decisions first and disclosure among them once it matters. @throws {never} */
export function orderedActions(record: SecurityCase, disclosureFirst: boolean): ReadonlyArray<string> {
  const available = record.allowedActions.filter((action) => actionSpec(action, record) !== null);
  const leading = (action: string) => primaryActions.includes(action) || (action === "disclosure" && disclosureFirst);
  return [...available.filter(leading), ...available.filter((action) => !leading(action))];
}

/** The body fields an action form sends, in the shapes the case route reads. @throws {never} */
export function actionFields(action: string, spec: ActionSpec, values: FieldValues): ActionFields {
  const fields: Record<string, unknown> = {};
  for (const field of spec.fields) {
    if (!fieldShown(field, values)) continue;
    const value = values[field.name];
    if (action === "verify-payment" && field.name === "transactionIds") fields[field.name] = String(value).trim().split(/\s+/u).filter(Boolean);
    else if (field.kind === "utc") fields[field.name] = utcInput(String(value));
    else if (field.kind === "amount") {
      const minor = decimalToMinor(String(value), field.decimals);
      if (minor === undefined) return { ok: false, message: `Enter the ${field.label.toLowerCase()} as a number.` };
      fields[field.name] = minor;
    } else if ((field.kind === "text" || field.kind === "textarea") && field.optional && String(value).trim() === "") continue;
    else fields[field.name] = value;
  }
  return { ok: true, fields };
}
