// spec/operations/notifications.md, "Only independent provider evidence for the exact attempt and destination settles a send"
import { onlyTo, type MailSink, type SentMail } from "../testing.ts";

export interface CapturedMail extends SentMail {
  readonly headers: Readonly<Record<string, string>>;
}

export interface MailCapture {
  readonly binding: MailSink;
  /** @throws {never} */
  messages(): ReadonlyArray<CapturedMail>;
  /** @throws {never} */
  reject(next: number): void;
}

function headersOf(raw: string): Readonly<Record<string, string>> {
  const end = raw.search(/\r?\n\r?\n/u);
  const lines = (end === -1 ? raw : raw.slice(0, end)).split(/\r?\n/u);
  const headers: Record<string, string> = {};
  let last = "";
  for (const line of lines) {
    if (/^[ \t]/u.test(line) && last !== "") headers[last] = `${headers[last] ?? ""} ${line.trim()}`;
    else {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      last = line.slice(0, colon).trim().toLowerCase();
      headers[last] = line.slice(colon + 1).trim();
    }
  }
  return headers;
}

function addressOf(header: string | undefined): string | undefined {
  return header === undefined ? undefined : /<([^>]+)>/u.exec(header)?.[1] ?? header.trim();
}

/** @throws {never} */
export function mailCapture(options: { readonly allowed?: ReadonlyArray<string> } = {}): MailCapture {
  const captured: CapturedMail[] = [];
  let refusals = 0;
  return {
    binding: onlyTo(options.allowed, (mail) => {
      const headers = headersOf(mail.raw);
      if (headers["message-id"] === undefined) return "invalid message-id";
      if (addressOf(headers.from) !== mail.from) return "From: header does not match mail from";
      if (refusals > 0) {
        refusals -= 1;
        return `email to ${mail.to} refused by the provider`;
      }
      captured.push({ ...mail, headers });
      return undefined;
    }),
    messages: () => [...captured],
    reject: (next) => { refusals = next; },
  };
}
