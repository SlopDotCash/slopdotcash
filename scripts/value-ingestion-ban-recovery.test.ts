import { expect, test } from "bun:test";
import { type AddressInfo, createServer, type Socket } from "node:net";
import {
  fetchProjectPenaltyState,
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
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.once("data", () => {
      // Keep a declared body incomplete until the client aborts it. A partial
      // streaming Response can otherwise arrive as a complete malformed body.
      socket.write(
        'HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n{"schemaVersion":',
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let receivedHeaders = false;
  const transport = Object.assign(
    async (_input: unknown, init?: RequestInit) => {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        ...init,
        signal: controller.signal,
      });
      receivedHeaders = true;
      timeout = setTimeout(
        () => controller.abort(new DOMException("Timed out", "TimeoutError")),
        50,
      );
      return response;
    },
    { preconnect: fetch.preconnect },
  );
  try {
    await expect(
      loadParticipationBans(github, transport),
    ).rejects.toBeInstanceOf(ValueFeedUnavailableError);
    expect(receivedHeaders).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  } finally {
    clearTimeout(timeout);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
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

test("a malformed penalty feed page stops publication instead of keeping the stale snapshot", async () => {
  const transport = Object.assign(async () => new Response("{"), {
    preconnect: fetch.preconnect,
  });
  const read = fetchProjectPenaltyState("asi", transport);
  await expect(read).rejects.toBeInstanceOf(SyntaxError);
  await expect(read).rejects.not.toBeInstanceOf(ValueFeedUnavailableError);
});

test("an interrupted penalty feed body still reports an unavailable feed", async () => {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new TypeError("Response body interrupted"));
    },
  });
  const transport = Object.assign(async () => new Response(body), {
    preconnect: fetch.preconnect,
  });
  await expect(
    fetchProjectPenaltyState("asi", transport),
  ).rejects.toBeInstanceOf(ValueFeedUnavailableError);
});

test("a penalty feed connection reset after its headers reports an unavailable feed", async () => {
  // Bun rejects a body cut off by the network with a plain ECONNRESET Error,
  // not a TypeError, so every body read failure must count as an outage.
  const server = createServer((socket) => {
    socket.once("data", () => {
      socket.write(
        'HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n{"schemaVersion":',
      );
      setTimeout(() => socket.destroy(), 20);
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  const transport = Object.assign(
    async (_input: unknown, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${port}/`, init),
    { preconnect: fetch.preconnect },
  );
  try {
    await expect(
      fetchProjectPenaltyState("asi", transport),
    ).rejects.toBeInstanceOf(ValueFeedUnavailableError);
  } finally {
    server.close();
  }
});

test("a complete empty ban feed succeeds", async () => {
  const transport = Object.assign(
    async () =>
      Response.json({ schemaVersion: "slop-account-bans:v1", bans: [] }),
    { preconnect: fetch.preconnect },
  );
  expect(await loadParticipationBans(github, transport)).toEqual(new Map());
});
