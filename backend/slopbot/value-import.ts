import { readBoundedJson } from "../../src/lib/browser-json";

/** This binding targets a named Worker RPC entrypoint, never a public URL. */
export interface HistoricalValueBinding {
  publishSubscription(
    input: unknown,
    bundle?: ReadableStream<Uint8Array>,
  ): Promise<{
    recordDigest: string;
    sequence: number;
  }>;
}

export async function handleHistoricalValueImport(
  request: Request,
  deps: {
    adminGithubIds: ReadonlySet<string>;
    sessionActor: (request: Request) => Promise<{ githubId: string } | null>;
    publisher?: HistoricalValueBinding;
  },
): Promise<Response> {
  const respond = (status: number, body: unknown) =>
    Response.json(body, {
      status,
      headers: { "cache-control": "private, no-store" },
    });
  if (request.method !== "POST")
    return respond(405, { error: "method_not_allowed" });
  const mediaType = request.headers.get("content-type")?.split(";")[0];
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    !["application/json", "multipart/form-data"].includes(mediaType ?? "")
  )
    return respond(403, { error: "origin_forbidden" });
  try {
    const actor = await deps.sessionActor(request);
    if (!actor) return respond(401, { error: "unauthorized" });
    if (!deps.adminGithubIds.has(actor.githubId))
      return respond(403, { error: "forbidden" });
    if (!deps.publisher) return respond(503, { error: "intake_unavailable" });
    let input: unknown;
    let bundle: File | undefined;
    try {
      if (mediaType === "multipart/form-data") {
        if (!request.body) throw new Error("Missing request body");
        let received = 0;
        const body = request.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              received += chunk.byteLength;
              if (received > 25 * 1024 * 1024)
                throw new Error("Historical assessment body limit");
              controller.enqueue(chunk);
            },
          }),
        );
        const form = await new Request(request, { body }).formData();
        if (Array.from(form.keys()).sort().join() !== "bundle,envelope")
          throw new Error("Unexpected historical assessment parts");
        const envelope = form.get("envelope");
        const objects = form.get("bundle");
        if (
          !(envelope instanceof File) ||
          envelope.type !== "application/json" ||
          !(objects instanceof File) ||
          objects.size === 0
        )
          throw new Error("Invalid historical assessment parts");
        input = await readBoundedJson(
          new Response(envelope.stream()),
          25 * 1024 * 1024,
          "historical assessment",
        );
        bundle = objects;
      } else
        input = await readBoundedJson(
          request as unknown as Response,
          25 * 1024 * 1024,
          "historical assessment",
        );
    } catch {
      return respond(400, { error: "invalid_request" });
    }
    const receipt = await deps.publisher.publishSubscription(
      input,
      bundle?.stream(),
    );
    return respond(200, receipt);
  } catch {
    // Do not echo source bodies, provider declarations or upstream errors.
    return respond(409, { error: "assessment_not_published" });
  }
}
