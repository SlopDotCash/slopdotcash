// spec/points/ingestion.md, "A read classifies each response and waits only for a rate limit"
export type Reply = () => Response;

/** @throws {never} */
export function textReply(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

/** @throws {never} */
export function jsonReply(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}

/** @throws {never} */
export function partialReply(status: number): Response {
  return new Response(new ReadableStream<Uint8Array>({ start: (controller) => controller.enqueue(new TextEncoder().encode("partial")) }), { status });
}

export const serverError: Reply = () => textReply("internal error", { status: 500 });
export const validationFailed: Reply = () => jsonReply({ message: "Validation Failed" }, { status: 422 });
export const limited: Reply = () => textReply("limited", { status: 429, headers: { "retry-after": "3" } });
