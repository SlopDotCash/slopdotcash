/** @throws {never} */
export function netOutcomeReply(answer: string | undefined): Response {
  return new Response(answer ?? '{"message":"Not Found"}', {
    status: answer === undefined ? 404 : 200,
    headers: { "content-type": "application/json" },
  });
}
