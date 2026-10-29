import { readBoundedJson } from "../../src/lib/browser-json";
import {
  type DeploymentTier,
  deploymentOrigins,
} from "../../src/lib/deployment";
import {
  EMAIL_ADDRESS,
  MAX_ADMIN_RECIPIENTS,
  MAX_NOTICE_BODY_BYTES,
  NOTIFY_INTERNAL_HOST,
  PROJECT_APPLICATION_NOTICE_PATH,
  type ProjectApplicationNotice,
  SENDER_ADDRESS,
  SLOPBOT_FAILURE_NOTICE_PATH,
  SLOPBOT_SPEND_NOTICE_PATH,
  type SlopbotFailureNotice,
  type SlopbotSpendNotice,
  safeProviderFailure,
  validFailureNotice,
  validSpendNotice,
} from "./contracts";

export type NotifyWorkerDependencies = {
  tier?: DeploymentTier;
  /** Raw `ADMIN_EMAILS` secret: comma-separated admin addresses. */
  adminEmails: string | undefined;
  fromAddress: string;
  now: () => Date;
  randomId: () => string;
  sendEmail: (from: string, to: string, rawMime: string) => Promise<void>;
};

const NOTICE_KEYS = [
  "applicationId",
  "projectId",
  "projectName",
  "repository",
  "applicantLogin",
  "submittedAt",
  "reviewUrl",
] as const satisfies readonly (keyof ProjectApplicationNotice)[];

/**
 * Parses the operator-configured admin list. Returns null unless every entry
 * is a plain address, entries are unique, and the count is within bounds, so
 * a misconfigured secret sends nothing.
 */
export function parseAdminEmails(value: string | undefined): string[] | null {
  if (typeof value !== "string") return null;
  const recipients = value.split(",").map((entry) => entry.trim());
  if (
    recipients.length < 1 ||
    recipients.length > MAX_ADMIN_RECIPIENTS ||
    !recipients.every((entry) => EMAIL_ADDRESS.test(entry)) ||
    new Set(recipients.map((entry) => entry.toLowerCase())).size !==
      recipients.length
  ) {
    return null;
  }
  return recipients;
}

class InvalidRequest extends Error {}

function json(
  status: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

async function readNoticeJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new InvalidRequest("content type must be application/json");
  }
  try {
    return await readBoundedJson(request, MAX_NOTICE_BODY_BYTES, "notice");
  } catch {
    throw new InvalidRequest("body must be bounded UTF-8 JSON");
  }
}

// Removes C0 and C1 controls, DEL, and Unicode line/paragraph separators.
// Applying this to every header value makes header injection impossible.
function stripControls(value: string): string {
  let clean = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    if (code === 0x2028 || code === 0x2029) continue;
    clean += character;
  }
  return clean;
}

function validSubmittedAt(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function validReviewUrl(value: string, tier?: DeploymentTier): boolean {
  if (value.length > 512) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // `href` equality rejects anything the URL parser would rewrite, including
  // embedded tabs or newlines that it silently drops.
  return (
    url.href === value &&
    url.origin === deploymentOrigins(tier).site &&
    url.username === "" &&
    url.password === "" &&
    (url.pathname === "/admin" || url.pathname.startsWith("/admin/"))
  );
}

function parseNotice(
  value: unknown,
  tier?: DeploymentTier,
): ProjectApplicationNotice {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidRequest("body must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== NOTICE_KEYS.length ||
    !NOTICE_KEYS.every(
      (key) => Object.hasOwn(record, key) && typeof record[key] === "string",
    )
  ) {
    throw new InvalidRequest("body must contain exactly the notice keys");
  }
  const notice = record as ProjectApplicationNotice;
  const nameLength = [...notice.projectName].length;
  if (
    !/^[A-Za-z0-9_-]{8,80}$/u.test(notice.applicationId) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u.test(notice.projectId) ||
    nameLength < 1 ||
    nameLength > 80 ||
    stripControls(notice.projectName).trim() === "" ||
    notice.repository.length > 201 ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(notice.repository) ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(notice.applicantLogin) ||
    !validSubmittedAt(notice.submittedAt) ||
    !validReviewUrl(notice.reviewUrl, tier)
  ) {
    throw new InvalidRequest("notice field is invalid");
  }
  return notice;
}

function base64Utf8(encoder: TextEncoder, value: string): string {
  let binary = "";
  for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isAscii(value: string): boolean {
  return /^[ -~]*$/u.test(value);
}

/**
 * Encodes a header value as RFC 2047 UTF-8 base64 encoded-words when it is not
 * printable ASCII. Words stay within 75 characters and never split a code
 * point; folded continuation lines start with a space.
 */
export function encodeHeaderValue(value: string): string {
  const clean = stripControls(value);
  if (isAscii(clean)) return clean;
  const encoder = new TextEncoder();
  const words: string[] = [];
  let pending = "";
  for (const codePoint of clean) {
    const candidate = pending + codePoint;
    if (encoder.encode(candidate).byteLength > 45 && pending !== "") {
      words.push(pending);
      pending = codePoint;
    } else {
      pending = candidate;
    }
  }
  if (pending !== "") words.push(pending);
  return words
    .map((word) => `=?UTF-8?B?${base64Utf8(encoder, word)}?=`)
    .join("\r\n ");
}

/**
 * Quoted-printable body encoding (RFC 2045 section 6.7) over UTF-8 bytes.
 * Input lines are separated by `\n`; output uses CRLF hard breaks and `=`
 * soft breaks so no encoded line exceeds 76 characters.
 */
export function encodeQuotedPrintable(text: string): string {
  const encoder = new TextEncoder();
  return text
    .split("\n")
    .map((line) => {
      const bytes = encoder.encode(line);
      const tokens: string[] = [];
      bytes.forEach((byte, index) => {
        const last = index === bytes.length - 1;
        const literal =
          (byte >= 33 && byte <= 126 && byte !== 61) ||
          ((byte === 32 || byte === 9) && !last);
        tokens.push(
          literal
            ? String.fromCharCode(byte)
            : `=${byte.toString(16).toUpperCase().padStart(2, "0")}`,
        );
      });
      const out: string[] = [];
      let current = "";
      for (const token of tokens) {
        if (current.length + token.length > 75) {
          out.push(`${current}=`);
          current = "";
        }
        current += token;
      }
      out.push(current);
      return out.join("\r\n");
    })
    .join("\r\n");
}

function rfc5322Date(date: Date): string {
  return date.toUTCString().replace(/ GMT$/u, " +0000");
}

function spendDollars(micro: number): string {
  const value = BigInt(micro);
  return `$${value / 1_000_000n}.${String((value % 1_000_000n) / 10_000n).padStart(2, "0")}`;
}

function noticeText(
  notice: ProjectApplicationNotice | SlopbotSpendNotice | SlopbotFailureNotice,
): string {
  if ("callId" in notice)
    return [
      notice.kind === "budget-exhausted"
        ? "Surplus refused a Slopbot request because its provider budget was exhausted."
        : "A Slopbot request to Surplus did not produce a valid result.",
      `Model: ${notice.model}. Recorded at: ${notice.occurredAt}.`,
      `Internal cost record: ${notice.callId}.`,
      `Cause: ${safeProviderFailure(notice.failure)}.`,
      "The failed call remains recorded. A fallback may have completed the assessment; otherwise it stays pending for retry.",
      "Check provider availability and budget settings. Unknown charges remain unknown.",
      "This notice does not change a spending limit, publish a score or approve a payout.",
      "Review Slopbot: https://slop.cash/admin",
      "",
    ].join("\n");
  if ("month" in notice)
    return [
      `Slopbot recorded API cost crossed ${spendDollars(notice.thresholdMicroUsd)} for ${notice.month} (UTC).`,
      `Recorded total: ${spendDollars(notice.recordedMicroUsd)}.`,
      `Calls priced from estimates rather than provider-reported charges: ${notice.estimatedCalls}.`,
      "Provider-reported charges are used where available; estimates are not a settled invoice.",
      "This includes failed provider calls. Contributor charges and the service markup are not API cost.",
      "This alert does not change a budget, authorize spending, or approve a payout.",
      "Review Slopbot costs: https://slop.cash/admin",
      "",
    ].join("\n");
  const name = stripControls(notice.projectName);
  return [
    "A person submitted a new project application to Slop.",
    "",
    `Project name: ${name}`,
    `Project id: ${notice.projectId}`,
    `Repository: https://github.com/${notice.repository}`,
    `Applicant: ${notice.applicantLogin} (https://github.com/${notice.applicantLogin})`,
    `Submitted at: ${notice.submittedAt}`,
    `Application id: ${notice.applicationId}`,
    "",
    `Review it in the admin panel: ${notice.reviewUrl}`,
    "",
  ].join("\n");
}

export function buildNoticeMime(
  notice: ProjectApplicationNotice | SlopbotSpendNotice | SlopbotFailureNotice,
  from: string,
  to: string,
  date: Date,
  messageIdLocal: string,
): string {
  const headers = [
    ["From", from],
    ["To", to],
    [
      "Subject",
      encodeHeaderValue(
        "callId" in notice
          ? "Slopbot: Surplus request failed"
          : "month" in notice
            ? `Slopbot API cost: ${notice.month} crossed ${spendDollars(notice.thresholdMicroUsd)}`
            : `New Slop project application: ${stripControls(notice.projectName)}`,
      ),
    ],
    ["Date", rfc5322Date(date)],
    ["Message-ID", `<${messageIdLocal}@slop.cash>`],
    ["MIME-Version", "1.0"],
    ["Content-Type", "text/plain; charset=utf-8"],
    ["Content-Transfer-Encoding", "quoted-printable"],
  ] as const;
  const head = headers
    .map(([name, value]) =>
      name === "Subject"
        ? `${name}: ${value}`
        : `${name}: ${stripControls(value)}`,
    )
    .join("\r\n");
  return `${head}\r\n\r\n${encodeQuotedPrintable(noticeText(notice))}`;
}

export async function handleNotifyRequest(
  request: Request,
  deps: NotifyWorkerDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.protocol !== "https:" ||
    url.host !== NOTIFY_INTERNAL_HOST ||
    ![
      PROJECT_APPLICATION_NOTICE_PATH,
      SLOPBOT_SPEND_NOTICE_PATH,
      SLOPBOT_FAILURE_NOTICE_PATH,
    ].includes(url.pathname) ||
    url.search !== ""
  ) {
    return json(404, { error: "not_found" });
  }
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, { allow: "POST" });
  }
  let notice:
    | ProjectApplicationNotice
    | SlopbotSpendNotice
    | SlopbotFailureNotice;
  try {
    const body = await readNoticeJson(request);
    if (url.pathname === SLOPBOT_FAILURE_NOTICE_PATH) {
      if (!validFailureNotice(body))
        throw new InvalidRequest("Invalid failure notice");
      notice = body;
    } else if (url.pathname === SLOPBOT_SPEND_NOTICE_PATH) {
      if (!validSpendNotice(body))
        throw new InvalidRequest("Invalid cost notice");
      notice = body;
    } else notice = parseNotice(body, deps.tier);
  } catch (error) {
    if (error instanceof InvalidRequest) {
      return json(400, { error: "invalid_request" });
    }
    throw error;
  }
  const recipients = parseAdminEmails(deps.adminEmails);
  if (!SENDER_ADDRESS.test(deps.fromAddress) || recipients === null) {
    console.error("slop notify sender or recipients are misconfigured");
    return json(500, { error: "service_misconfigured" });
  }
  const date = deps.now();
  let sent = 0;
  let failed = false;
  // Attempt every recipient so one rejected destination does not silence the
  // other, then report the exact delivered count without claiming success.
  for (const recipient of recipients) {
    const messageIdLocal = deps.randomId();
    try {
      await deps.sendEmail(
        deps.fromAddress,
        recipient,
        buildNoticeMime(
          notice,
          deps.fromAddress,
          recipient,
          date,
          messageIdLocal,
        ),
      );
      sent += 1;
    } catch {
      console.error("slop notify delivery failed");
      failed = true;
    }
  }
  if (failed) return json(502, { error: "delivery_failed", sent });
  return json(202, {
    status: "sent",
    recipients: recipients.length,
  });
}
