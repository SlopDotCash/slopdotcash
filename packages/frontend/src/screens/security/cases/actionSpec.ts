// spec/security/cases.md, "Current technical approvers and triagers request information on the current report version"; spec/security/cases.md, "A technical decision records the finding, duplicate identity and relatedness"; spec/security/cases.md, "An award commits only under paid terms, eligibility and project clearance"; spec/security/cases.md, "An independent moderator upholds or returns the appeal"; spec/security/cases.md, "Authority snapshots advance and triager membership is audited at the next revision"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { utcInput } from "../../../flows/security/cases.vibe";
import { decimalToMinor } from "./amount.ts";
import type { SecurityCase } from "./case.schema.ts";
import { awardText, money } from "./labels.ts";

type Shown = { readonly field: string; readonly values: ReadonlyArray<string> };

export type FieldSpec =
  | { readonly name: string; readonly label: string; readonly kind: "text" | "textarea"; readonly hint?: string; readonly optional?: boolean; readonly initial?: string; readonly when?: Shown }
  | { readonly name: string; readonly label: string; readonly kind: "select"; readonly options: ReadonlyArray<readonly [string, string]>; readonly when?: Shown }
  | { readonly name: string; readonly label: string; readonly kind: "checkbox" | "utc"; readonly when?: Shown }
  | { readonly name: string; readonly label: string; readonly kind: "amount"; readonly decimals: number; readonly hint?: string; readonly initial?: string; readonly readOnly?: boolean; readonly when?: Shown };

export interface ActionSpec {
  readonly title: string;
  readonly submit: string;
  readonly fields: ReadonlyArray<FieldSpec>;
}

export type FieldValues = Readonly<Record<string, string | boolean>>;

export type ActionFields = { readonly ok: true; readonly fields: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly message: string };

const reason = { name: "reason", label: "Private reason", kind: "textarea", hint: "Do not name another reporter or quote another report." } as const satisfies FieldSpec;

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
  const available = record.awardFunds ? `Available to reserve: ${money(record.awardFunds.availableMinor, record.awardFunds)}.` : undefined;
  const hint = direct
    ? fixed
      ? "The published award is fixed."
      : undefined
    : fixed
      ? ["The published award is fixed.", available, "Without funds, it stays selected and unpaid."].filter((part) => part !== undefined).join(" ")
      : available;
  const exact = terms.grossMinor !== undefined && /^[0-9]+$/u.test(terms.grossMinor) && Number.isInteger(terms.decimals) && terms.decimals >= 0 && terms.decimals <= 36;
  const fixedGross = fixed && exact && terms.grossMinor !== undefined ? formatBaseUnits({ value: BigInt(terms.grossMinor), decimals: terms.decimals, grouping: false }) : undefined;
  return {
    title: "Award",
    submit: "Record award decision",
    fields: [
      {
        name: "decision",
        label: "Decision",
        kind: "select",
        options: [
          ["amount", fixed ? "Award the published amount" : "Award an amount"],
          ["none", "No award"],
        ],
      },
      { name: "grossMinor", label: `Gross award (${terms.currency})`, kind: "amount", decimals: terms.decimals, initial: fixedGross, readOnly: fixed, hint, when: { field: "decision", values: ["amount"] } },
      { name: "paymentDeadline", label: "Payment deadline (UTC)", kind: "utc", when: { field: "decision", values: ["amount"] } },
      {
        name: "confirmation",
        label: `I approve this award for @${record.reporter?.githubLogin ?? "the reporter"}.${direct ? "" : fixed ? " It remains unpaid until verified funds cover the award." : " Approval reserves the amount now."}`,
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
    title: consent ? "Accept payment visibility" : record.settlement ? "Refresh payment request" : "Prepare payment",
    submit: consent ? "Accept visibility" : record.settlement ? "Refresh unsigned payment" : "Prepare unsigned payment",
    fields: [
      { name: "network", label: "Payment network", kind: "select", options: record.paymentNetworks.map((network) => [network, network] as const) },
      {
        name: "confirmation",
        label: consent
          ? record.paymentRail === "direct"
            ? "I understand that chain transactions reveal my wallet, time and amounts. My report stays private."
            : "I understand that chain transactions reveal my GitHub actor number, wallet, time and amounts. My report stays private."
          : `I approve ${awardText(record)} on this network. This prepares an unsigned request; it does not pay.`,
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
      recovery.mode === "resume-original"
        ? "Resume original wallet"
        : recovery.mode === "cancellation-required"
          ? "Verify cancellation"
          : recovery.mode === "retirement-required"
            ? "Verify previous transaction"
            : "Check payment recovery",
    fields: [
      ...(transaction
        ? [
            {
              name: "cancellationTransactionId",
              label: recovery.mode === "retirement-required" ? `Previous ${recovery.role === "fee" ? "fee" : "researcher"} transaction ID` : "Cancellation transaction ID",
              kind: "text",
            } as const,
          ]
        : []),
      { name: "confirmation", label: "I approve recovery to the payout wallet shown above.", kind: "checkbox" },
    ],
  };
}

function decideSpec(record: SecurityCase): ActionSpec {
  const proposal = record.analysis?.state === "complete" ? record.analysis : null;
  return {
    title: "Decide the finding",
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
      { name: "severity", label: "Severity", kind: "select", options: [["", "Choose severity"], ...severityOptions] },
      {
        name: "loss",
        label: "Loss of funds",
        kind: "select",
        options: [
          ["unresolved", "Unresolved"],
          ["verified-potential", "Verified potential loss"],
          ["verified-actual", "Verified actual loss"],
          ["not-verified", "Not verified"],
        ],
      },
      { name: "inScope", label: "The affected asset is in scope", kind: "checkbox" },
      {
        name: "relatedParty",
        label: "The reporter is a related party (owner, employee, sponsor or approver). An independent reviewer must then approve any award.",
        kind: "checkbox",
      },
      { name: "rootCauseKey", label: "Root cause key", kind: "text", optional: true, initial: proposal?.rootCauseKey ?? "", hint: "Lowercase words and hyphens. Required to confirm." },
      { name: "duplicateOf", label: "Original case ID", kind: "text", when: { field: "outcome", values: ["duplicate"] }, initial: proposal?.duplicateCaseIds[0] ?? "" },
      { name: "evidenceReference", label: "Private evidence reference (optional)", kind: "text", optional: true },
      reason,
    ],
  };
}

/** The form of one case action, or null when this case cannot take it here. @throws {never} */
export function actionSpec(action: string, record: SecurityCase): ActionSpec | null {
  switch (action) {
    case "verify-link":
      return {
        title: "Verify the GitHub report",
        submit: "Verify report",
        fields: [
          { name: "receivedAt", label: "Time GitHub received the report (UTC)", kind: "utc" },
          {
            name: "confirmation",
            label: `I checked on GitHub that ${record.advisory?.ghsa ?? "this advisory"} exists and that @${record.reporter?.githubLogin ?? "the reporter"} submitted it.`,
            kind: "checkbox",
          },
        ],
      };
    case "reject-link":
      return { title: "Reject this link", submit: "Reject link", fields: [reason] };
    case "request-information":
      return {
        title: "Ask the reporter for information",
        submit: "Ask for information",
        fields: [
          {
            name: "reason",
            label: "What you need",
            kind: "textarea",
            hint: record.advisory ? "The reporter answers in the private GitHub advisory." : "Use the private report review to request further evidence.",
          },
        ],
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
              ["fixing", "Fixing in a private workspace"],
              ["retest", "Retest"],
              ["resolved", "Resolved (fix merged)"],
              ["mitigation-verified", "Deployed mitigation verified"],
              ["reopened", "Reopened"],
            ],
          },
          { name: "patchDigest", label: "Exact patch SHA-256", kind: "text", hint: "The patch under retest, merged or deployed.", when: { field: "remediationState", values: ["retest", "resolved", "mitigation-verified"] } },
          { name: "evidenceReference", label: "Private test or deployment evidence", kind: "text", optional: true, hint: "Required for resolved and for deployed mitigation." },
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
              ["redaction-approved", "Redacted text approved"],
              ["disclosed", "Disclosed by the security maintainer"],
            ],
          },
          { name: "evidenceReference", label: "Private disclosure approval evidence", kind: "text", hint: "Reference the approval in the private advisory. Do not paste the content here." },
          { name: "redactedContentDigest", label: "Approved redacted content SHA-256", kind: "text", optional: true, hint: "Required when approving redacted text or recording disclosure." },
          { name: "embargoChange", label: "Approved embargo change", kind: "textarea", optional: true, hint: "Leave blank if unchanged." },
          reason,
        ],
      };
    case "assign-triager":
      return {
        title: "Assign a triager",
        submit: "Assign triager",
        fields: [
          { name: "githubId", label: "Triager GitHub account ID", kind: "text" },
          { name: "githubLogin", label: "Triager GitHub login", kind: "text" },
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
        ["private", "No, keep my identity private"],
        ["opt-in", "Yes, after authorized disclosure"],
      ];
      return {
        title: "Public recognition",
        submit: "Save my choice",
        fields: [{ name: "recognition", label: "Show my name publicly", kind: "select", options: [...choices].sort(([value]) => (value === record.recognition ? -1 : 1)) }],
      };
    }
    case "appeal":
      return {
        title: "Appeal this decision",
        submit: "Send appeal",
        fields: [{ name: "reason", label: "Why the decision is wrong", kind: "textarea", hint: "An independent reviewer reads this privately." }],
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
              ["uphold", "Uphold the original decision"],
              ["return", "Return the case for a new decision"],
            ],
          },
          reason,
        ],
      };
    case "decide-related-party":
      return {
        title: "Related-party award review",
        submit: "Record review",
        fields: [
          {
            name: "outcome",
            label: "Outcome",
            kind: "select",
            options: [
              ["approve", `Approve ${record.award && record.terms ? money(record.award.grossMinor, record.terms) : "the proposed award"}${record.paymentRail === "direct" ? "" : " and reserve it if funds remain"}`],
              ["refuse", "Refuse: the reporter is not eligible for this award"],
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
          { name: "transactionIds", label: "Transaction IDs", kind: "textarea", hint: "One per line." },
          { name: "confirmation", label: "These transactions pay the approved award.", kind: "checkbox" },
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
