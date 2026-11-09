/** Native stream and event-emitter regressions. No socket or server is opened. */
import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  probeProductionTls,
  readEvidenceResponseBytes,
  verifyRemoteArtifacts,
  withEvidenceResponse,
} from "./evidence-contract.mjs";

class SocketFixture extends EventEmitter {
  authorized = true;
  authorizationError: string | undefined;
  protocol = "TLSv1.3";
  endCalls = 0;
  destroyCalls = 0;
  autoClose = false;
  certificateError: Error | undefined;
  destroyError: Error | undefined;

  getPeerCertificate() {
    if (this.certificateError) throw this.certificateError;
    return {
      issuer: { CN: "Fixture issuer" },
      subject: { CN: "slop.cash" },
      subjectaltname: "DNS:slop.cash",
      valid_from: "Jan 1 00:00:00 2025 GMT",
      valid_to: "Jan 1 00:00:00 2100 GMT",
    };
  }

  getCipher() {
    return { name: "TLS_AES_256_GCM_SHA384" };
  }

  getProtocol() {
    return this.protocol;
  }

  end() {
    this.endCalls++;
    return this;
  }

  destroy() {
    this.destroyCalls++;
    if (this.destroyError) throw this.destroyError;
    if (this.autoClose) queueMicrotask(() => this.emit("close"));
    return this;
  }

  setTimeout() {
    throw new Error("The probe must use its absolute deadline");
  }
}

type TransportError = Error & { errors?: unknown[]; cause?: unknown };

async function failure(
  operation: () => Promise<unknown>,
): Promise<TransportError> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error) return error as TransportError;
    throw error;
  }
  throw new Error("Expected transport failure");
}

function responseFixture(
  options: {
    chunks?: Uint8Array[];
    close?: boolean;
    cancelError?: Error;
    status?: number;
    headers?: Record<string, string>;
  } = {},
) {
  let cancels = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of options.chunks ?? []) controller.enqueue(chunk);
        if (options.close) controller.close();
      },
      cancel() {
        cancels++;
        if (options.cancelError) throw options.cancelError;
      },
    }),
    { status: options.status, headers: options.headers },
  );
  return { response, cancels: () => cancels };
}

test("TLS validation waits for owned socket close before returning success", async () => {
  const socket = new SocketFixture();
  let options: unknown;
  const result = probeProductionTls((value: unknown) => {
    options = value;
    return socket;
  }, 1_000);
  let settled = false;
  void result.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  socket.emit("secureConnect");
  await Promise.resolve();
  expect(options).toEqual({
    host: "slop.cash",
    port: 443,
    rejectUnauthorized: true,
    servername: "slop.cash",
  });
  expect(socket.endCalls).toBe(1);
  expect(socket.destroyCalls).toBe(1);
  expect(settled).toBe(false);
  socket.emit("close");
  expect((await result).protocol).toBe("TLSv1.3");
  expect(settled).toBe(true);
});

test("TLS certificate getter failure rejects through the promise and closes", async () => {
  const socket = new SocketFixture();
  const primary = new Error("fixture certificate getter failed");
  socket.certificateError = primary;
  socket.autoClose = true;
  const result = probeProductionTls(() => socket, 1_000);
  socket.emit("secureConnect");
  expect(await failure(() => result)).toBe(primary);
  expect(socket.destroyCalls).toBe(1);
});

test("TLS policy failure rejects without escaping the event callback", async () => {
  const socket = new SocketFixture();
  socket.protocol = "SSLv3";
  socket.autoClose = true;
  const result = probeProductionTls(() => socket, 1_000);
  socket.emit("secureConnect");
  expect((await failure(() => result)).message).toContain(
    "TLS protocol is not accepted",
  );
  expect(socket.endCalls).toBe(0);
  expect(socket.destroyCalls).toBe(1);
});

test("TLS socket error retains its original identity", async () => {
  const socket = new SocketFixture();
  socket.autoClose = true;
  const primary = new Error("fixture TLS transport failed");
  const result = probeProductionTls(() => socket, 1_000);
  socket.emit("error", primary);
  expect(await failure(() => result)).toBe(primary);
  expect(socket.destroyCalls).toBe(1);
});

for (const event of ["end", "close"] as const) {
  test(`TLS ${event} before handshake settles as failure`, async () => {
    const socket = new SocketFixture();
    socket.autoClose = true;
    const result = probeProductionTls(() => socket, 1_000);
    socket.emit(event);
    expect((await failure(() => result)).message).toContain(
      "before a verified handshake",
    );
  });
}

test("TLS activity cannot restart the absolute observation deadline", async () => {
  const socket = new SocketFixture();
  const result = probeProductionTls(() => socket, 20);
  let settlements = 0;
  void result.then(
    () => {
      settlements++;
    },
    () => {
      settlements++;
    },
  );
  const activity = setInterval(
    () => socket.emit("data", Buffer.from("activity")),
    1,
  );
  try {
    expect((await failure(() => result)).message).toContain(
      "exceeded its deadline",
    );
    expect(socket.destroyCalls).toBe(1);
    socket.emit("close");
    socket.emit("error", new Error("late fixture error"));
    await Promise.resolve();
    expect(settlements).toBe(1);
  } finally {
    clearInterval(activity);
  }
});

test("verified TLS without observed close cannot report success", async () => {
  const socket = new SocketFixture();
  const result = probeProductionTls(() => socket, 20);
  socket.emit("secureConnect");
  expect((await failure(() => result)).message).toContain(
    "exceeded its deadline",
  );
  expect(socket.endCalls).toBe(1);
  socket.emit("close");
});

test("TLS destruction failure preserves the earlier validation error", async () => {
  const socket = new SocketFixture();
  const primary = new Error("fixture certificate getter failed");
  const cleanup = new Error("fixture socket destruction failed");
  socket.certificateError = primary;
  socket.destroyError = cleanup;
  const result = probeProductionTls(() => socket, 1_000);
  socket.emit("secureConnect");
  const error = await failure(() => result);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.cause).toBe(primary);
  expect(error.errors).toEqual([primary, cleanup]);
});

test("TLS deadline keeps the original validation failure when close never arrives", async () => {
  const socket = new SocketFixture();
  const primary = new Error("fixture certificate getter failed");
  socket.certificateError = primary;
  const result = probeProductionTls(() => socket, 20);
  socket.emit("secureConnect");
  expect(await failure(() => result)).toBe(primary);
  expect(socket.destroyCalls).toBe(1);
  socket.emit("close");
});

test("TLS connector failure settles without a socket", async () => {
  const primary = new Error("fixture connect failed");
  expect(
    await failure(() =>
      probeProductionTls(() => {
        throw primary;
      }, 1_000),
    ),
  ).toBe(primary);
});

test("header-only response success disposes its unread body", async () => {
  const fixture = responseFixture();
  const value = await withEvidenceResponse(
    fixture.response,
    async () => "headers verified",
  );
  expect(value).toBe("headers verified");
  expect(fixture.cancels()).toBe(1);
  expect(fixture.response.body?.locked).toBe(false);
});

test("response validation failure still disposes its body", async () => {
  const fixture = responseFixture();
  const primary = new Error("fixture response headers rejected");
  const error = await failure(() =>
    withEvidenceResponse(fixture.response, async () => {
      throw primary;
    }),
  );
  expect(error).toBe(primary);
  expect(fixture.cancels()).toBe(1);
});

test("response cancellation failure retains the earlier operation error", async () => {
  const primary = new Error("fixture rejected response");
  const cleanup = new Error("fixture cancellation failed");
  const fixture = responseFixture({ cancelError: cleanup });
  const error = await failure(() =>
    withEvidenceResponse(fixture.response, async () => {
      throw primary;
    }),
  );
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.cause).toBe(primary);
  expect(error.errors).toEqual([primary, cleanup]);
  expect(fixture.cancels()).toBe(1);
});

test("successful response validation cannot hide cancellation failure", async () => {
  const cleanup = new Error("fixture cancellation failed");
  const fixture = responseFixture({ cancelError: cleanup });
  const error = await failure(() =>
    withEvidenceResponse(fixture.response, async () => "accepted"),
  );
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors).toEqual([cleanup]);
});

test("bounded response reading releases the reader before cancellation", async () => {
  const fixture = responseFixture({ chunks: [new Uint8Array([1, 2, 3])] });
  const error = await failure(() =>
    withEvidenceResponse(fixture.response, () =>
      readEvidenceResponseBytes(fixture.response, 2, "fixture body"),
    ),
  );
  expect(error.message).toContain("exceeded the verified body size");
  expect(fixture.response.body?.locked).toBe(false);
  expect(fixture.cancels()).toBe(1);
});

test("oversize refusal remains the primary error if cancellation fails", async () => {
  const cleanup = new Error("fixture oversize cancellation failed");
  const fixture = responseFixture({
    chunks: [new Uint8Array([1, 2, 3])],
    cancelError: cleanup,
  });
  const error = await failure(() =>
    withEvidenceResponse(fixture.response, () =>
      readEvidenceResponseBytes(fixture.response, 2, "fixture body"),
    ),
  );
  expect(error).toBeInstanceOf(AggregateError);
  expect((error.cause as Error | undefined)?.message).toContain(
    "exceeded the verified body size",
  );
  expect(error.errors?.[1]).toBe(cleanup);
  expect(fixture.response.body?.locked).toBe(false);
});

test("short bounded response may finish and leaves no reader lock", async () => {
  const fixture = responseFixture({
    chunks: [new Uint8Array([1])],
    close: true,
  });
  const bytes = await withEvidenceResponse(fixture.response, () =>
    readEvidenceResponseBytes(fixture.response, 2, "fixture body"),
  );
  expect([...bytes]).toEqual([1]);
  expect(fixture.response.body?.locked).toBe(false);
});

test("a failed stream read releases its lock and preserves the source error", async () => {
  const primary = new Error("fixture body read failed");
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(primary);
      },
    }),
  );
  const error = await failure(() =>
    withEvidenceResponse(response, () =>
      readEvidenceResponseBytes(response, 2, "fixture body"),
    ),
  );
  // Canceling an already errored native stream rejects with that stored error.
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.cause).toBe(primary);
  expect(response.body?.locked).toBe(false);
});

for (const mismatch of ["status", "type", "length"] as const) {
  test(`remote artifact ${mismatch} refusal cancels before any body read`, async () => {
    const fixture = responseFixture({
      status: mismatch === "status" ? 503 : 200,
      headers: {
        "content-type": mismatch === "type" ? "text/html" : "text/plain",
        "content-length": mismatch === "length" ? "99" : "3",
      },
    });
    const error = await failure(() =>
      verifyRemoteArtifacts({
        artifacts: [{ path: "llms.txt", contents: Buffer.from("abc") }],
        cacheKey: "fixture",
        fetchImpl: async () => fixture.response,
      }),
    );
    expect(error).toBeInstanceOf(Error);
    expect(fixture.cancels()).toBe(1);
    expect(fixture.response.body?.locked).toBe(false);
  });
}

test("exact remote artifact bytes remain verified after transport cleanup", async () => {
  const fixture = responseFixture({
    chunks: [new TextEncoder().encode("abc")],
    close: true,
    headers: { "content-type": "text/plain", "content-length": "3" },
  });
  const result = await verifyRemoteArtifacts({
    artifacts: [{ path: "llms.txt", contents: Buffer.from("abc") }],
    cacheKey: "fixture",
    fetchImpl: async () => fixture.response,
  });
  expect(result[0].bytes).toBe(3);
  expect(result[0].path).toBe("llms.txt");
  expect(fixture.response.body?.locked).toBe(false);
});

test("short exact artifact body is refused after releasing the reader", async () => {
  const fixture = responseFixture({
    chunks: [new TextEncoder().encode("a")],
    close: true,
    headers: { "content-type": "text/plain" },
  });
  const error = await failure(() =>
    verifyRemoteArtifacts({
      artifacts: [{ path: "llms.txt", contents: Buffer.from("abc") }],
      cacheKey: "fixture",
      fetchImpl: async () => fixture.response,
    }),
  );
  expect(error.message).toContain("length does not match");
  expect(fixture.response.body?.locked).toBe(false);
});

test("missing response body rejects without inventing a disposal error", async () => {
  const response = new Response(null);
  const error = await failure(() =>
    withEvidenceResponse(response, () =>
      readEvidenceResponseBytes(response, 2, "fixture body"),
    ),
  );
  expect(error.message).toContain("omitted its response body");
  expect(error).not.toBeInstanceOf(AggregateError);
});
