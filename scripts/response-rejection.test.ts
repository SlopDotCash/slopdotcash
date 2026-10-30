import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readBoundedBytes } from "../src/lib/browser-json";

test("a header-rejected download cancels the native HTTP response", () => {
  execFileSync(
    "node",
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    import { createServer } from "node:http";
    import { readBoundedBytes } from ${JSON.stringify(new URL("../src/lib/browser-json.ts", import.meta.url).href)};
    let finish;
    const closed = new Promise(resolve => { finish = resolve; });
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-length": "1048576" });
      response.write("first bytes");
      response.on("close", finish);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    let response, timer;
    try {
      response = await fetch("http://127.0.0.1:" + server.address().port);
      await assert.rejects(readBoundedBytes(response, 1024, "snapshot"), RangeError);
      assert.equal(response.bodyUsed, true);
      await Promise.race([closed, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Rejected HTTP download stayed open")), 2000);
      })]);
    } finally {
      clearTimeout(timer);
      await response?.body?.cancel().catch(() => {});
      server.closeAllConnections();
      server.close();
    }
  `,
    ],
    { stdio: "pipe", timeout: 10000 },
  );
});

test("invalid length refusal cancels without hiding the original error", async () => {
  const response = new Response(
    new ReadableStream({
      cancel() {
        throw new Error("cancel failed");
      },
    }),
    { headers: { "content-length": "invalid" } },
  );
  await expect(readBoundedBytes(response, 1024, "snapshot")).rejects.toThrow(
    "snapshot returned an invalid content length",
  );
  expect(response.bodyUsed).toBe(true);
});
