// spec/points/assessmentAudit.md, "A replay qualifies only an exact merged scope, and its private review is staged only on request after exact readback"
/** @throws {never} */
export function apiReply(body: unknown, status: number, headers: Readonly<Record<string, string>> = {}): Response {
  const payload = body === null ? null : body instanceof Uint8Array ? body.slice() : JSON.stringify(body);
  return new Response(payload, { status, headers: { "content-type": "application/json", ...headers } });
}
