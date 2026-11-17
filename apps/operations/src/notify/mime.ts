//@ backend dafny
// spec/operations/notifications.md, "A failed or overdue case notice escalates once to a backup with current access"; spec/slopbot/spendAlerts.md, "One claim per run, in order, and an ambiguous send is never resent"

export interface InboxMime {
  from: string;
  to: string;
  subject: string;
  date: string;
  deliveryId: string;
  attempt: number;
  text: string;
  unsubscribeUrl: string;
}

export interface AdminMime {
  from: string;
  to: string;
  subject: string;
  date: string;
  messageId: string;
  text: string;
}

//@ pure
export function isByte(value: number): boolean {
  return 0 <= value && value <= 255;
}

//@ pure
export function isControl(code: number): boolean {
  return code < 32 || (127 <= code && code <= 159) || code === 8232 || code === 8233;
}

//@ pure
export function isPrintableAscii(code: number): boolean {
  return 32 <= code && code <= 126;
}

//@ pure
export function isBodyCode(code: number): boolean {
  return code === 9 || isPrintableAscii(code);
}

//@ pure
export function isMailCode(code: number): boolean {
  return isBodyCode(code) || code === 10 || code === 13;
}

//@ pure
export function isBase64Code(code: number): boolean {
  return (65 <= code && code <= 90) || (97 <= code && code <= 122) || (48 <= code && code <= 57) || code === 43 || code === 47 || code === 61;
}

/** @throws {never} */
export function utf8(text: string): number[] {
  //@ ensures forall(k, 0 <= k && k < \result.length ==> isByte(\result[k]))
  const bytes: number[] = [];
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    //@ invariant forall(k, 0 <= k && k < bytes.length ==> isByte(bytes[k]))
    //@ decreases text.length - i
    const unit = text.charCodeAt(i);
    const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
    if (unit < 128) {
      bytes.push(unit);
      i = i + 1;
    } else if (unit < 2048) {
      bytes.push(192 + Math.floor(unit / 64));
      bytes.push(128 + (unit % 64));
      i = i + 1;
    } else if (55296 <= unit && unit <= 56319 && 56320 <= next && next <= 57343) {
      const plane = unit - 55296 + 64;
      const low = next - 56320;
      bytes.push(240 + Math.floor(plane / 256));
      bytes.push(128 + (Math.floor(plane / 4) % 64));
      bytes.push(128 + (plane % 4) * 16 + Math.floor(low / 64));
      bytes.push(128 + (low % 64));
      i = i + 2;
    } else if (55296 <= unit && unit <= 57343) {
      bytes.push(239);
      bytes.push(191);
      bytes.push(189);
      i = i + 1;
    } else {
      bytes.push(224 + Math.floor(unit / 4096));
      bytes.push(128 + (Math.floor(unit / 64) % 64));
      bytes.push(128 + (unit % 64));
      i = i + 1;
    }
  }
  return bytes;
}

/** @throws {never} */
export function hexDigit(value: number): string {
  //@ requires 0 <= value && value < 16
  //@ ensures \result.length === 1 && isPrintableAscii(\result.charCodeAt(0))
  if (value < 10) return String.fromCharCode(48 + value);
  return String.fromCharCode(55 + value);
}

/** @throws {never} */
export function quotedToken(byte: number, last: boolean): string {
  //@ requires isByte(byte)
  //@ ensures 1 <= \result.length && \result.length <= 3
  //@ ensures forall(k, 0 <= k && k < \result.length ==> isBodyCode(\result.charCodeAt(k)))
  if ((byte >= 33 && byte <= 126 && byte !== 61) || ((byte === 32 || byte === 9) && !last)) return String.fromCharCode(byte);
  const high = hexDigit(Math.floor(byte / 16));
  const low = hexDigit(byte % 16);
  return "=" + high + low;
}

/** @throws {never} */
export function quotedPrintable(text: string): string {
  //@ ensures forall(k, 0 <= k && k < \result.length ==> isMailCode(\result.charCodeAt(k)))
  const bytes = utf8(text);
  let out = "";
  let line = "";
  let i = 0;
  while (i < bytes.length) {
    //@ invariant 0 <= i && i <= bytes.length
    //@ invariant line.length <= 75
    //@ invariant forall(k, 0 <= k && k < out.length ==> isMailCode(out.charCodeAt(k)))
    //@ invariant forall(k, 0 <= k && k < line.length ==> isBodyCode(line.charCodeAt(k)))
    //@ decreases bytes.length - i
    const byte = bytes[i];
    if (byte === 10) {
      out = out + line + "\r\n";
      line = "";
    } else {
      const last = i + 1 === bytes.length || bytes[i + 1] === 10;
      const token = quotedToken(byte, last);
      if (line.length + token.length > 75) {
        out = out + line + "=\r\n";
        line = "";
      }
      line = line + token;
    }
    i = i + 1;
  }
  return out + line;
}

/** @throws {never} */
export function base64Char(index: number): string {
  //@ requires 0 <= index && index < 64
  //@ ensures \result.length === 1 && isBase64Code(\result.charCodeAt(0))
  if (index < 26) return String.fromCharCode(65 + index);
  if (index < 52) return String.fromCharCode(71 + index);
  if (index < 62) return String.fromCharCode(index - 4);
  if (index === 62) return "+";
  return "/";
}

/** @throws {never} */
export function base64(bytes: number[]): string {
  //@ requires forall(k, 0 <= k && k < bytes.length ==> isByte(bytes[k]))
  //@ ensures \result.length % 4 === 0
  //@ ensures forall(k, 0 <= k && k < \result.length ==> isBase64Code(\result.charCodeAt(k)))
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    //@ invariant 0 <= i
    //@ invariant out.length % 4 === 0
    //@ invariant forall(k, 0 <= k && k < out.length ==> isBase64Code(out.charCodeAt(k)))
    //@ decreases bytes.length - i
    const first = bytes[i];
    const second = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const third = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const a = base64Char(Math.floor(first / 4));
    const b = base64Char((first % 4) * 16 + Math.floor(second / 16));
    const c = base64Char((second % 16) * 4 + Math.floor(third / 64));
    const d = base64Char(third % 64);
    out = out + a + b + (i + 1 < bytes.length ? c : "=") + (i + 2 < bytes.length ? d : "=");
    i = i + 3;
  }
  return out;
}

/** @throws {never} */
export function stripControls(value: string): string {
  //@ ensures forall(k, 0 <= k && k < \result.length ==> !isControl(\result.charCodeAt(k)))
  let clean = "";
  let i = 0;
  while (i < value.length) {
    //@ invariant 0 <= i && i <= value.length
    //@ invariant forall(k, 0 <= k && k < clean.length ==> !isControl(clean.charCodeAt(k)))
    //@ decreases value.length - i
    if (!isControl(value.charCodeAt(i))) clean = clean + value.slice(i, i + 1);
    i = i + 1;
  }
  return clean;
}

/** @throws {never} */
export function isAsciiText(value: string): boolean {
  //@ ensures \result <==> forall(k, 0 <= k && k < value.length ==> isPrintableAscii(value.charCodeAt(k)))
  let i = 0;
  while (i < value.length) {
    //@ invariant 0 <= i && i <= value.length
    //@ invariant forall(k, 0 <= k && k < i ==> isPrintableAscii(value.charCodeAt(k)))
    //@ decreases value.length - i
    if (!isPrintableAscii(value.charCodeAt(i))) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function encodedWord(text: string): string {
  //@ ensures forall(k, 0 <= k && k < \result.length ==> isPrintableAscii(\result.charCodeAt(k)))
  const bytes = utf8(text);
  const encoded = base64(bytes);
  return "=?UTF-8?B?" + encoded + "?=";
}

/** @throws {never} */
export function encodeHeaderValue(value: string): string {
  //@ ensures forall(k, 0 <= k && k < \result.length ==> isMailCode(\result.charCodeAt(k)))
  const clean = stripControls(value);
  const ascii = isAsciiText(clean);
  if (ascii) return clean;
  let out = "";
  let start = 0;
  let size = 0;
  let i = 0;
  while (i < clean.length) {
    //@ invariant 0 <= start && start <= i && i <= clean.length
    //@ invariant size >= 0
    //@ invariant forall(k, 0 <= k && k < out.length ==> isMailCode(out.charCodeAt(k)))
    //@ decreases clean.length - i
    const unit = clean.charCodeAt(i);
    const next = i + 1 < clean.length ? clean.charCodeAt(i + 1) : 0;
    const pair = 55296 <= unit && unit <= 56319 && 56320 <= next && next <= 57343;
    const width = pair ? 4 : unit < 128 ? 1 : unit < 2048 ? 2 : 3;
    if (size + width > 45 && size > 0) {
      const word = encodedWord(clean.slice(start, i));
      out = out === "" ? word : out + "\r\n " + word;
      start = i;
      size = width;
    } else {
      size = size + width;
    }
    i = pair ? i + 2 : i + 1;
  }
  if (size > 0) {
    const word = encodedWord(clean.slice(start, clean.length));
    out = out === "" ? word : out + "\r\n " + word;
  }
  return out;
}

/** @throws {never} */
export function decimal(value: number): string {
  //@ requires value >= 0
  //@ ensures \result.length >= 1
  let digits = String.fromCharCode(48 + (value % 10));
  let rest = Math.floor(value / 10);
  while (rest > 0) {
    //@ invariant rest >= 0
    //@ invariant digits.length >= 1
    //@ decreases rest
    digits = String.fromCharCode(48 + (rest % 10)) + digits;
    rest = Math.floor(rest / 10);
  }
  return digits;
}

/** @throws {never} */
export function inboxMime(mail: InboxMime): string {
  //@ requires mail.attempt >= 0
  const attempt = decimal(mail.attempt);
  const body = quotedPrintable(mail.text);
  const unsubscribe = mail.unsubscribeUrl === "" ? "" : `List-Unsubscribe: <${mail.unsubscribeUrl}>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n`;
  return `From: ${mail.from}\r\nTo: ${mail.to}\r\nSubject: ${mail.subject}\r\nDate: ${mail.date}\r\nMessage-ID: <slop-notice-${mail.deliveryId}-${attempt}@slop.cash>\r\n${unsubscribe}MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${body}`;
}

/** @throws {never} */
export function adminMime(mail: AdminMime): string {
  const from = stripControls(mail.from);
  const to = stripControls(mail.to);
  const subject = encodeHeaderValue(mail.subject);
  const date = stripControls(mail.date);
  const messageId = stripControls(`<${mail.messageId}@slop.cash>`);
  const body = quotedPrintable(mail.text);
  return `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nDate: ${date}\r\nMessage-ID: ${messageId}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${body}`;
}
