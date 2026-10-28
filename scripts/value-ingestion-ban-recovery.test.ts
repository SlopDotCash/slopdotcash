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
