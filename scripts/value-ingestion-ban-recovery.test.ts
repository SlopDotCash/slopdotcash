import { expect, test } from "bun:test";
import {
  loadParticipationBans,
  ValueFeedUnavailableError,
} from "./value-ingestion";

const github = {
  get: async () => {
    throw new Error("No GitHub lookup is expected");
  },
};

test("an interrupted ban feed body reports an unavailable feed", async () => {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new TypeError("Response body interrupted"));
    },
  });
  const transport = Object.assign(async () => new Response(body), {
    preconnect: fetch.preconnect,
  });
  await expect(loadParticipationBans(github, transport)).rejects.toBeInstanceOf(
    ValueFeedUnavailableError,
  );
});

test("a ban feed that times out after its headers reports unavailable", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"schemaVersion":'));
          },
        }),
      );
    },
  });
  const transport = Object.assign(
    async (_input: unknown, init?: RequestInit) =>
      fetch(server.url, { ...init, signal: AbortSignal.timeout(50) }),
    { preconnect: fetch.preconnect },
  );
  try {
    await expect(
      loadParticipationBans(github, transport),
    ).rejects.toBeInstanceOf(ValueFeedUnavailableError);
  } finally {
    server.stop(true);
  }
});

test("a malformed ban feed remains an integrity error", async () => {
  const transport = Object.assign(async () => new Response("{"), {
    preconnect: fetch.preconnect,
  });
  await expect(loadParticipationBans(github, transport)).rejects.toBeInstanceOf(
    SyntaxError,
  );
});

test("a complete empty ban feed succeeds", async () => {
  const transport = Object.assign(
    async () =>
      Response.json({ schemaVersion: "slop-account-bans:v1", bans: [] }),
    { preconnect: fetch.preconnect },
  );
  expect(await loadParticipationBans(github, transport)).toEqual(new Map());
});
