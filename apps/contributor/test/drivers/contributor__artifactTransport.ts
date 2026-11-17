// spec/contributor/artifactTransport.md, "Each request carries a credential only at the GitHub authority"
import { Effect, ManagedRuntime, Redacted } from "effect";
import { webCrypto } from "@repo/platform/crypto";
import type { Driver, Options } from "../../gen/contributor__artifactTransport.conformance.ts";
import type { Artifact, Event } from "../../gen/contributor__artifactTransport.ts";
import { type Answer, type Run, type Target, again, begin, open, settle } from "../../src/artifacts/transport.vibe";
import { largeScreenshot, screenshot, serverLog, trivialDocument } from "../fixtures/artifacts/media.ts";
import { uploadUrl } from "../fixtures/artifacts/network.ts";

const runtime = ManagedRuntime.make(webCrypto);

const target: Target = {
  url: uploadUrl(1),
  expectation: { rowId: "domain-artifacts", expectedKind: null, extension: "", fullContentLimit: undefined },
  credential: Redacted.make("ghs_conformanceDriverCredential0000"),
  timeoutMs: 10_000,
};

interface Body {
  readonly status: number;
  readonly bytes?: Uint8Array;
  readonly total?: number;
  readonly contentType?: string;
  readonly location?: string;
}

function answered({ status, bytes = new Uint8Array(0), total, contentType, location }: Body): Answer {
  return {
    kind: "answered",
    url: "",
    location,
    received: {
      status,
      contentType,
      contentLength: String(bytes.length),
      contentRange: total === undefined ? undefined : `bytes 0-${bytes.length - 1}/${total}`,
      bytes,
      ended: true,
    },
  };
}

function partial(bytes: Uint8Array, length: number, contentType: string): Answer {
  return answered({ status: 206, bytes: bytes.subarray(0, length), total: bytes.length, contentType });
}

function body(event: Extract<Event, { type: "accept" }>): Answer {
  if (event.document && !event.complete) return partial(serverLog, 200, "text/plain");
  if (event.document) return answered({ status: 200, bytes: event.valid ? serverLog : trivialDocument, contentType: "text/plain" });
  if (!event.valid) return answered({ status: 200, bytes: new TextEncoder().encode("not an image at all, only words"), contentType: "image/png" });
  if (!event.complete) return partial(largeScreenshot, 65_536, "image/png");
  return answered({ status: 200, bytes: screenshot, contentType: "image/png" });
}

function answerFor(event: Exclude<Event, { type: "request" } | { type: "retry" }>): Answer {
  switch (event.type) {
    case "redirect":
      return answered({ status: 302, location: event.trusted ? "https://objects.githubusercontent.com/github-production-user-asset-6210df/1" : "https://evil.example/assets/1" });
    case "transientFailure":
      return { kind: "unreachable", timedOut: false };
    case "terminalFailure":
      return answered({ status: 404 });
    case "accept":
      return body(event);
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

const runs = new Map<string, Run>();

async function runFor(key: string): Promise<Run> {
  const found = runs.get(key);
  if (found !== undefined) return found;
  const run = await runtime.runPromise(begin(target));
  runs.set(key, run);
  return run;
}

function outcome<A, R extends ManagedRuntime.ManagedRuntime.Services<typeof runtime>>(sent: Effect.Effect<A, { readonly _tag: "Rejected" }, R>) {
  return runtime.runPromise(sent.pipe(Effect.as("accepted" as const), Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const) })));
}

export const driver: Driver<Artifact> & AsyncDisposable = {
  reset: () => {
    runs.clear();
  },
  dispatch: async (key, event) => {
    const run = await runFor(key);
    if (event.type === "request") return outcome(open(run));
    if (event.type === "retry") return outcome(again(run));
    return outcome(settle(run, answerFor(event)));
  },
  observe: async (key) => runtime.runPromise((await runFor(key)).machine.get()),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["artifact"] };
