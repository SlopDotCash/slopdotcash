import { expect, spyOn, test } from "bun:test";
import { type AddressInfo, createServer } from "node:net";
import {
  fetchProjectPenaltyState,
  fetchValueHistoryPage,
  fetchWorkUnitHistoryPage,
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
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() =>
    originalTimeout(50),
  );
  const transport = Object.assign(
    async (_input: unknown, init?: RequestInit) => {
      const response = await fetch(server.url, init);
      const signal = init?.signal;
      if (!signal) throw new Error("The feed must own its request deadline");
      return response;
    },
    { preconnect: fetch.preconnect },
  );
  try {
    await expect(
      loadParticipationBans(github, transport),
    ).rejects.toBeInstanceOf(ValueFeedUnavailableError);
  } finally {
    timeout.mockRestore();
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

for (const feed of [
  "bans",
  "penalties",
  "value history",
  "work-unit history",
] as const) {
  test(`a ${feed} response returned after its deadline remains unavailable`, async () => {
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() =>
      originalTimeout(5),
    );
    const transport = Object.assign(
      async (_input: unknown, init?: RequestInit) => {
        const signal = init?.signal;
        if (!signal) throw new Error("The feed must own its request deadline");
        if (!signal.aborted)
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        // Bun's native timeout can fulfill a body with its received prefix.
        // The separate local HTTP case exercises that transport; this fixes
        // the exact late-fulfillment state independently of runtime scheduling.
        return new Response('{"schemaVersion":');
      },
      { preconnect: fetch.preconnect },
    );
    try {
      await expect(
        feed === "bans"
          ? loadParticipationBans(github, transport)
          : feed === "penalties"
            ? fetchProjectPenaltyState("asi", transport)
            : feed === "value history"
              ? fetchValueHistoryPage("elizaOS/asi", 1, 0, transport)
              : fetchWorkUnitHistoryPage("elizaOS/asi", 1, 0, null, transport),
      ).rejects.toBeInstanceOf(ValueFeedUnavailableError);
    } finally {
      timeout.mockRestore();
    }
  });
}
