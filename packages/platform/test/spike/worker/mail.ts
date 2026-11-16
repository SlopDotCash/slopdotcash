// The raw-MIME EmailMessage the old notify Worker sends (workers/notify/index.ts); `cloudflare:email` stays external.
import { EmailMessage } from "cloudflare:email";

/** @throws {never} */
export function emailMessage(from: string, to: string, subject: string, text: string, messageId: string): EmailMessage {
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: <${messageId}@slop.test>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    text,
  ].join("\r\n");
  return new EmailMessage(from, to, mime);
}
