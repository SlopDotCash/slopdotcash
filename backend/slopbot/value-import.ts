import { readBoundedJson } from "../../src/lib/browser-json";
import { isSameOriginJsonWrite } from "../http";

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
    waitUntil?: (work: Promise<unknown>) => void;
  },
): Promise<Response> {
  const respond = (status: number, body: unknown) =>
    Response.json(body, {
      status,
      headers: { "cache-control": "private, no-store" },
    });
  if (request.method !== "POST")
    return respond(405, { error: "method_not_allowed" });
  if (
    !isSameOriginJsonWrite(request, ["application/json", "multipart/form-data"])
  )
    return respond(403, { error: "origin_forbidden" });
  const mediaType = request.headers.get("content-type")?.split(";")[0];
  let actor: { githubId: string } | null;
  try {
    actor = await deps.sessionActor(request);
  } catch {
    console.error("historical value import session failure");
    return respond(503, { error: "intake_unavailable" });
  }
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
            if (received > 33 * 1024 * 1024)
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
        33 * 1024 * 1024,
        "historical assessment",
      );
      bundle = objects;
    } else
      input = await readBoundedJson(
        request as unknown as Response,
        33 * 1024 * 1024,
        "historical assessment",
      );
  } catch {
    return respond(400, { error: "invalid_request" });
  }
  const publisher = deps.publisher;
  const publish = async () => {
    try {
      const receipt = await publisher.publishSubscription(
        input,
        bundle?.stream(),
      );
      return { status: 200, body: receipt };
    } catch {
      // Never return source bodies, provider declarations or upstream errors.
      console.error("historical value import failure");
      return { status: 409, body: { error: "assessment_not_published" } };
    }
  };
  const streaming = request.headers
    .get("accept")
    ?.split(",")
    .some((type) => type.trim() === "application/x-ndjson");
  if (!streaming) {
    const result = await publish();
    return respond(result.status, result.body);
  }

  // Start only after authorization and the complete bounded request parse.
  // Heartbeats keep a long-running RPC attached to its HTTP invocation. A
  // disconnected reader cannot turn a pending publication into a success.
  const encoder = new TextEncoder();
  let canceled = false;
  let heartbeat: ReturnType<typeof setInterval>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const pending = encoder.encode('{"status":"pending"}\n');
      controller.enqueue(pending);
      heartbeat = setInterval(() => {
        if ((controller.desiredSize ?? 0) > 0) controller.enqueue(pending);
      }, 15_000);
      const work = publish().then((result) => {
        clearInterval(heartbeat);
        if (canceled) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(result)}\n`));
        controller.close();
      });
      deps.waitUntil?.(work);
    },
    cancel() {
      canceled = true;
      clearInterval(heartbeat);
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "private, no-store, no-transform",
      "x-content-type-options": "nosniff",
    },
  });
}
