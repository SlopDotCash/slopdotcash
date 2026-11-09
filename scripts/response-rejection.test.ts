import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  readBoundedBytes,
  readBoundedJson,
  readBoundedText,
} from "../src/lib/browser-json";

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

test("an exact byte limit still waits for EOF and rejects an extra fragment", async () => {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let cancellations = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      cancel() {
        cancellations++;
      },
    }),
  );
  let settled = false;
  const read = readBoundedBytes(response, 2, "snapshot").finally(() => {
    settled = true;
  });
  controller!.enqueue(Uint8Array.of(1, 2));
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  controller!.enqueue(Uint8Array.of(3));
  await expect(read).rejects.toBeInstanceOf(RangeError);
  expect(cancellations).toBe(1);
  expect(response.body?.locked).toBe(false);
});

test("fragment overflow keeps its RangeError when cancellation rejects", async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2, 3));
      },
      cancel() {
        throw new Error("Cancellation unavailable");
      },
    }),
  );
  await expect(readBoundedBytes(response, 2, "snapshot")).rejects.toBeInstanceOf(
    RangeError,
  );
  expect(response.body?.locked).toBe(false);
});

test("a failed read retains its original error and releases the reader", async () => {
  const original = new DOMException("Request interrupted", "AbortError");
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(original);
      },
    }),
  );
  await expect(readBoundedBytes(response, 2, "snapshot")).rejects.toBe(original);
  expect(response.body?.locked).toBe(false);
});

test("a bounded Content-Length is not an exact-length integrity assertion", async () => {
  const response = new Response(Uint8Array.of(7), {
    headers: { "content-length": "2" },
  });
  expect(await readBoundedBytes(response, 2, "snapshot")).toEqual(
    Uint8Array.of(7),
  );
  expect(response.body?.locked).toBe(false);
});

test("split UTF-8 is decoded only after all bounded bytes arrive", async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(0xc3));
        controller.enqueue(Uint8Array.of(0xa9));
        controller.close();
      },
    }),
  );
  expect(await readBoundedText(response, 2, "snapshot")).toBe("é");
  expect(response.body?.locked).toBe(false);
});

test("malformed UTF-8 is refused after EOF without being mislabeled as JSON syntax", async () => {
  const response = new Response(Uint8Array.of(0xc3));
  await expect(readBoundedJson(response, 2, "snapshot")).rejects.toBeInstanceOf(
    TypeError,
  );
  expect(response.body?.locked).toBe(false);
});

test("valid UTF-8 with invalid JSON keeps the parse cause after reader release", async () => {
  const response = new Response("{");
  const failure = await readBoundedJson(response, 2, "snapshot").catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toBe("snapshot returned invalid JSON");
  expect((failure as Error).cause).toBeInstanceOf(SyntaxError);
  expect(response.body?.locked).toBe(false);
});

test("missing body refuses without inventing a reader or successful empty payload", async () => {
  await expect(readBoundedBytes(new Response(null), 2, "snapshot")).rejects.toThrow(
    "snapshot returned no readable body",
  );
  expect(
    await readBoundedBytes(new Response(new Uint8Array()), 2, "snapshot"),
  ).toEqual(new Uint8Array());
});
