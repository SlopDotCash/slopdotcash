/** #1411 C-09: the scheduled controller records publication state through the
 * signed service, so the protected job holds no database credential of its own.
 *
 * The direct-D1 writer these cases used to drive is gone with the credential.
 * The tables' own guarantees are unchanged and schema-enforced (migration 0074:
 * immutable intents and receipts, one receipt per assessment); their behavioural
 * coverage now lives in `scripts/vetting-api.test.ts`, which drives the route
 * end to end (second reservation 409, second receipt 409, mismatched digest 422).
 */
import { expect, test } from "bun:test";
import {
  JOURNAL_SCHEMA,
  servicePublicationJournal,
} from "../workers/vetting/publication-journal";

const intent = {
  assessmentId: "assessment-a",
  origin: "https://staging.slop.cash",
  resultSha256: "a".repeat(64),
  disposition: "incomplete" as const,
};

async function serviceSigner() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

test("the journal client signs every operation and reads the service reply", async () => {
  const calls: {
    url: string;
    method: string;
    body: Record<string, unknown>;
    signed: boolean;
  }[] = [];
  const journal = servicePublicationJournal({
    origin: "https://staging.slop.cash",
    signer: await serviceSigner(),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const body = JSON.parse(
        new TextDecoder().decode(init?.body as Uint8Array),
      ) as Record<string, unknown>;
      const headers = new Headers(init?.headers);
      calls.push({
        url: `${url.origin}${url.pathname}`,
        method: String(init?.method),
        body,
        signed: (headers.get("x-slop-vetting-signature") ?? "").length === 88,
      });
      return Response.json({
        schemaVersion: JOURNAL_SCHEMA,
        ...(body.operation === "has"
          ? { present: true }
          : body.operation === "reserve"
            ? { reserved: true }
            : { recorded: true }),
      });
    }) as typeof fetch,
  });

  expect(await journal.has(intent.assessmentId)).toBe(true);
  await journal.reserve(intent);
  await journal.complete({ ...intent, outcome: "unknown", httpStatus: null });

  expect(calls.map((call) => call.url)).toEqual(
    Array(3).fill("https://staging.slop.cash/api/v1/vetting/journal"),
  );
  expect(calls.map((call) => call.method)).toEqual(["POST", "POST", "POST"]);
  expect(calls.every((call) => call.signed)).toBe(true);
  expect(calls[0].body).toEqual({
    operation: "has",
    assessmentId: intent.assessmentId,
  });
  expect(calls[1].body).toEqual({ operation: "reserve", ...intent });
  expect(calls[2].body).toEqual({
    operation: "complete",
    ...intent,
    outcome: "unknown",
    httpStatus: null,
  });
});

test("an unsigned or refused journal reply fails the operation by name", async () => {
  const journal = servicePublicationJournal({
    origin: "https://staging.slop.cash",
    signer: await serviceSigner(),
    fetch: (async () =>
      new Response("no", { status: 503 })) as unknown as typeof fetch,
  });
  await expect(journal.has("vet_assessment")).rejects.toThrow(
    "Publication journal refused has (HTTP 503)",
  );
  await expect(journal.reserve(intent)).rejects.toThrow(
    "Publication journal refused reserve (HTTP 503)",
  );
  await expect(
    journal.complete({ ...intent, outcome: "unknown", httpStatus: null }),
  ).rejects.toThrow("Publication journal refused complete (HTTP 503)");
});

test("a reply from another contract generation is refused", async () => {
  const journal = servicePublicationJournal({
    origin: "https://staging.slop.cash",
    signer: await serviceSigner(),
    fetch: (async () =>
      Response.json({ present: true })) as unknown as typeof fetch,
  });
  await expect(journal.has(intent.assessmentId)).rejects.toThrow(
    "unexpected contract",
  );
});
