import { readBoundedJson } from "../../src/lib/browser-json";
import {
  type HistoricalIntakeTerminalFailure,
  INTAKE_DIAGNOSTIC_HEADER,
  INTAKE_TERMINAL_V1,
  projectTerminalIntakeFailure,
} from "../../workers/slopbot/value-import-diagnostics";
import { isSameOriginJsonWrite } from "../http";
import {
  INTAKE_CORRELATION_HEADER,
  isIntakeCorrelation,
  MAX_INTAKE_BODY_BYTES,
  pagesIntakeObserver,
} from "./value-import-observation";

type HistoricalValueReceipt = { recordDigest: string; sequence: number };

export type HistoricalValueDiagnosticReply =
  | { status: 200; receipt: HistoricalValueReceipt }
  | {
      status: 409;
      correlation: string;
      diagnostic: HistoricalIntakeTerminalFailure | null;
    };

/** This binding targets a named Worker RPC entrypoint, never a public URL. */
export interface HistoricalValueBinding {
  publishSubscription(
    input: unknown,
    bundle?: ReadableStream<Uint8Array>,
  ): Promise<HistoricalValueReceipt>;
  publishSubscriptionDiagnosed?(
    input: unknown,
    correlation: string,
    bundle?: ReadableStream<Uint8Array>,
  ): Promise<HistoricalValueDiagnosticReply>;
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
  const correlation = request.headers.get(INTAKE_CORRELATION_HEADER);
  const started = isIntakeCorrelation(correlation) ? performance.now() : null;
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
  const observe =
    started === null || correlation === null
      ? undefined
      : pagesIntakeObserver(correlation, started);
  observe?.("owner-admitted");
  let received = 0;
  const eof = () => {
    if (received <= MAX_INTAKE_BODY_BYTES)
      observe?.("body-eof", { bodyBytes: received });
  };
  let input: unknown;
  let bundle: File | undefined;
  try {
    if (mediaType === "multipart/form-data") {
      if (!request.body) throw new Error("Missing request body");
      const body = request.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            received += chunk.byteLength;
            if (received > MAX_INTAKE_BODY_BYTES)
              throw new Error("Historical assessment body limit");
            controller.enqueue(chunk);
          },
          flush: eof,
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
        MAX_INTAKE_BODY_BYTES,
        "historical assessment",
      );
      bundle = objects;
    } else {
      const inputBody =
        observe && request.body
          ? {
              headers: request.headers,
              body: request.body.pipeThrough(
                new TransformStream<
                  Uint8Array<ArrayBuffer>,
                  Uint8Array<ArrayBuffer>
                >({
                  transform(chunk, controller) {
                    received += chunk.byteLength;
                    controller.enqueue(chunk);
                  },
                  flush: eof,
                }),
              ),
            }
          : request;
      input = await readBoundedJson(
        inputBody,
        MAX_INTAKE_BODY_BYTES,
        "historical assessment",
      );
    }
  } catch {
    observe?.("terminal", { terminalStatus: 400 });
    return respond(400, { error: "invalid_request" });
  }
  observe?.("parsed");
  const publisher = deps.publisher;
  const diagnosticOptIn =
    isIntakeCorrelation(correlation) &&
    request.headers.get(INTAKE_DIAGNOSTIC_HEADER) === INTAKE_TERMINAL_V1;
  const publish = async () => {
    try {
      const objects = bundle?.stream();
      observe?.("rpc-dispatch");
      if (diagnosticOptIn && publisher.publishSubscriptionDiagnosed) {
        const result = await publisher.publishSubscriptionDiagnosed(
          input,
          correlation,
          objects,
        );
        if (result.status === 200) {
          observe?.("terminal", { terminalStatus: 200 });
          return { status: 200, body: result.receipt };
        }
        if (result.status === 409) {
          const failure =
            result.correlation === correlation
              ? projectTerminalIntakeFailure(result.diagnostic)
              : null;
          observe?.("terminal", { terminalStatus: 409 });
          return {
            status: 409,
            body: {
              error: "assessment_not_published",
              ...(failure ? { diagnostic: { correlation, failure } } : {}),
            },
          };
        }
        throw new Error("Invalid historical publisher response");
      }
      const receipt = await publisher.publishSubscription(input, objects);
      observe?.("terminal", { terminalStatus: 200 });
      return { status: 200, body: receipt };
    } catch {
      // Never return source bodies, provider declarations or upstream errors.
      console.error("historical value import failure");
      observe?.("terminal", { terminalStatus: 409 });
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
      observe?.("heartbeat-queued");
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
