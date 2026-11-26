// spec/operations/notifications.md, "Story: Deliver each attempt once and never resend an uncertain one"
import { EmailMessage } from "cloudflare:email";
import type { EmailMessage as Envelope } from "@repo/platform/bindings";

/** @throws {never} */
export function envelope(mail: { readonly from: string; readonly to: string; readonly raw: string }): Envelope {
  return new EmailMessage(mail.from, mail.to, mail.raw);
}
