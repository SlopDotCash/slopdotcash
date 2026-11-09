// Source-only regression definitions for the signed journal client. These
// use disposable local keys and response streams; no deployed service is used.
import { expect, test } from "bun:test";
import { signedVettingRequest } from "../../backend/vetting/handler";
import { vettingKeyPair } from "../../tests/vetting-fixtures";
import { JOURNAL_PATH } from "../../src/lib/vetting-contracts";
import { JOURNAL_SCHEMA, servicePublicationJournal } from "./publication-journal";
import type { VettingServiceSigner } from "./service";

const ORIGIN = "https://journal.example";
const NOW = new Date("2026-11-09T12:00:00.000Z");
const intent = () => ({ assessmentId: "vet_" + "a".repeat(32),
  resultSha256: "b".repeat(64), origin: ORIGIN, disposition: "incomplete" as const });
const receipt = () => ({ ...intent(), outcome: "unknown" as const, httpStatus: null });
type Reply = (payload: Record<string, unknown>) => Response | Promise<Response>;
async function fixture(reply: Reply = (payload) => Response.json({
  schemaVersion: JOURNAL_SCHEMA,
  ...(payload.operation === "has" ? { present: false }
    : payload.operation === "reserve" ? { reserved: true } : { recorded: true }),
})) {
  const keys = await vettingKeyPair();
  const signer: VettingServiceSigner = { privateKey: keys.privateKey,
    publicKey: await crypto.subtle.importKey("raw", keys.raw, { name: "Ed25519" }, true, ["verify"]) };
  const calls: { url: string; payload: Record<string, unknown>; signal: AbortSignal | null }[] = [];
  const config = {
    origin: ORIGIN, signer, now: () => NOW,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input instanceof Request ? input : String(input), init);
      const bytes = (await signedVettingRequest(request, { resultPublicKeys: keys.publicKey, now: () => NOW })).body;
      const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      expect(request.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      expect(request.headers.get("content-type")).toBe("application/json");
      calls.push({ url: request.url, payload, signal: init?.signal ?? null });
      return reply(payload);
    }) as typeof fetch,
  };
  return { config, signer, calls, journal: servicePublicationJournal(config) };
}

test("every journal operation signs its exact metadata and requires its own acknowledgement", async () => {
  const f = await fixture();
  expect(await f.journal.has(intent().assessmentId)).toBe(false);
  await f.journal.reserve(intent());
  await f.journal.complete(receipt());
  expect(f.calls.map((call) => call.payload)).toEqual([
    { operation: "has", assessmentId: intent().assessmentId },
    { operation: "reserve", ...intent() },
    { operation: "complete", ...receipt() },
  ]);
  expect(f.calls.every((call) => call.url === `${ORIGIN}${JOURNAL_PATH}` && call.signal !== null)).toBe(true);
});

test.each(["http://journal.example", "http://127.0.0.1:8100", `${ORIGIN}/path`,
  `${ORIGIN}/`, `${ORIGIN}?private=value`, "https://user:password@journal.example"])(
  "journal construction refuses a noncanonical service origin: %s", (origin) => {
    expect(() => servicePublicationJournal({ origin, signer: {} as VettingServiceSigner })).toThrow("exact HTTPS service origin");
  },
);

test("journal owns the endpoint, transport, clock and key pair captured at construction", async () => {
  const f = await fixture();
  const other = await vettingKeyPair();
  f.config.origin = "https://changed.example";
  f.config.fetch = (async () => { throw new Error("Changed transport must not run"); }) as typeof fetch;
  f.config.now = () => { throw new Error("Changed clock must not run"); };
  f.config.signer.privateKey = other.privateKey;
  f.config.signer.publicKey = await crypto.subtle.importKey("raw", other.raw, { name: "Ed25519" }, true, ["verify"]);
  await f.journal.reserve(intent());
  expect(f.calls[0].url).toBe(`${ORIGIN}${JOURNAL_PATH}`);
});

test("request metadata is captured before asynchronous signing yields", async () => {
  const f = await fixture();
  const mutable = receipt();
  const expected = { operation: "complete", ...mutable };
  const pending = f.journal.complete(mutable);
  mutable.assessmentId = "changed";
  mutable.resultSha256 = "c".repeat(64);
  mutable.origin = "https://changed.example";
  await pending;
  expect(f.calls[0].payload).toEqual(expected);
});

test.each([true, false])("has preserves the exact boolean presence %s", async (present) => {
  const f = await fixture(() => Response.json({ schemaVersion: JOURNAL_SCHEMA, present }));
  expect(await f.journal.has(intent().assessmentId)).toBe(present);
});

test.each([undefined, null, 0, 1, "false", "true"])("has refuses nonboolean presence %s", async (present) => {
  const f = await fixture(() => Response.json({ schemaVersion: JOURNAL_SCHEMA, present }));
  await expect(f.journal.has(intent().assessmentId)).rejects.toThrow("no boolean presence");
});

test.each([{}, { reserved: false }, { reserved: "true" }, { recorded: true }, { present: true }])(
  "reserve refuses an unconfirmed or wrong-operation acknowledgement %j", async (fields) => {
    const f = await fixture(() => Response.json({ schemaVersion: JOURNAL_SCHEMA, ...fields }));
    await expect(f.journal.reserve(intent())).rejects.toThrow("no confirmed reservation");
  },
);

test.each([{}, { recorded: false }, { recorded: "true" }, { reserved: true }, { present: true }])(
  "complete refuses an unconfirmed or wrong-operation acknowledgement %j", async (fields) => {
    const f = await fixture(() => Response.json({ schemaVersion: JOURNAL_SCHEMA, ...fields }));
    await expect(f.journal.complete(receipt())).rejects.toThrow("no confirmed receipt");
  },
);

test.each([null, [], true, "reply", { reserved: true }, { schemaVersion: "old", reserved: true }])(
  "journal refuses a nonobject or mismatched contract %j", async (value) => {
    const f = await fixture(() => Response.json(value));
    await expect(f.journal.reserve(intent())).rejects.toThrow("unexpected contract");
  },
);

test("HTTP refusal cancels the body and preserves its operation/status when cancellation fails", async () => {
  let cancellations = 0;
  const f = await fixture(() => new Response(new ReadableStream<Uint8Array>({
    cancel() { cancellations += 1; throw new Error("Cancellation detail must not replace refusal"); },
  }), { status: 503 }));
  await expect(f.journal.reserve(intent())).rejects.toThrow("Publication journal refused reserve (HTTP 503)");
  expect(cancellations).toBe(1);
});

test("the 4096-byte reply boundary is inclusive", async () => {
  const base = { schemaVersion: JOURNAL_SCHEMA, reserved: true, padding: "" };
  const body = JSON.stringify({ ...base, padding: "x".repeat(4096 - JSON.stringify(base).length) });
  const f = await fixture(() => new Response(body, { headers: { "content-length": "4096" } }));
  await f.journal.reserve(intent());
});

test("an oversized streamed reply is cancelled and releases its reader", async () => {
  let cancellations = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(4097)); },
    cancel() { cancellations += 1; },
  }, { highWaterMark: 0 }));
  const f = await fixture(() => response);
  await expect(f.journal.reserve(intent())).rejects.toThrow("4096-byte limit");
  expect(cancellations).toBe(1);
  expect(response.body?.locked).toBe(false);
});

test("an invalid declared content length cancels before JSON reading", async () => {
  let cancellations = 0;
  const f = await fixture(() => new Response(new ReadableStream<Uint8Array>({
    cancel() { cancellations += 1; },
  }), { headers: { "content-length": "not-a-number" } }));
  await expect(f.journal.reserve(intent())).rejects.toThrow("invalid content length");
  expect(cancellations).toBe(1);
});

test("a declared oversized reply cancels before creating a reader", async () => {
  let cancellations = 0;
  let pulls = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull() { pulls += 1; },
    cancel() { cancellations += 1; },
  }, { highWaterMark: 0 }), { headers: { "content-length": "4097" } });
  const f = await fixture(() => response);
  await expect(f.journal.reserve(intent())).rejects.toThrow("4096-byte limit");
  expect(cancellations).toBe(1);
  expect(pulls).toBe(0);
  expect(response.body?.locked).toBe(false);
});

test("malformed JSON, invalid UTF-8 and absent response bodies cannot confirm a write", async () => {
  for (const response of [new Response("{invalid"), new Response(new Uint8Array([0xff])), new Response(null)]) {
    const f = await fixture(() => response);
    await expect(f.journal.reserve(intent())).rejects.toThrow();
    expect(response.body?.locked ?? false).toBe(false);
  }
});

test("a lost reservation reply remains uncertain and a later presence read can recover it", async () => {
  let reserved = false;
  const f = await fixture((payload) => {
    if (payload.operation === "reserve") {
      reserved = true;
      throw new Error("Reservation reply lost");
    }
    return Response.json({ schemaVersion: JOURNAL_SCHEMA, present: reserved });
  });
  await expect(f.journal.reserve(intent())).rejects.toThrow("Reservation reply lost");
  expect(await f.journal.has(intent().assessmentId)).toBe(true);
  expect(f.calls.map((call) => call.payload.operation)).toEqual(["reserve", "has"]);
});
