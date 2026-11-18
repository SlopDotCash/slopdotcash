import { expect, spyOn, test } from "bun:test";
import { handleHistoricalValueImport } from "./value-import";
import { INTAKE_CORRELATION_HEADER } from "./value-import-observation";

const receipt = { recordDigest: "a".repeat(64), sequence: 7 };
function request(accept?: string, body = "{}") {
  return new Request("https://slop.cash/api/v1/slopbot/value-import", {
    method: "POST",
    headers: {
      origin: "https://slop.cash",
      "content-type": "application/json",
      ...(accept ? { accept } : {}),
    },
    body,
  });
}
function dependencies(publish = async (_input: unknown) => receipt) {
  return {
    adminGithubIds: new Set(["1"]),
    sessionActor: async () => ({ githubId: "1" }),
    publisher: { publishSubscription: publish },
  };
}

test("ordinary intake preserves HTTP success and refusal responses", async () => {
  const success = await handleHistoricalValueImport(request(), dependencies());
  expect(success.status).toBe(200);
  expect(await success.json()).toEqual(receipt);
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const failure = await handleHistoricalValueImport(
      request(),
      dependencies(async () => {
        throw Error("private source");
      }),
    );
    expect(failure.status).toBe(409);
    expect(await failure.json()).toEqual({ error: "assessment_not_published" });
  } finally {
    log.mockRestore();
  }
});

test("stream starts before the publisher completes and ends with exact receipt", async () => {
  let complete!: (value: typeof receipt) => void;
  let pending: Promise<unknown> | undefined;
  const response = await handleHistoricalValueImport(
    request("application/x-ndjson"),
    {
      ...dependencies(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      ),
      waitUntil: (work) => {
        pending = work;
      },
    },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/x-ndjson");
  if (!response.body) throw Error("Missing response stream");
  const reader = response.body.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(
    '{"status":"pending"}\n',
  );
  complete(receipt);
  expect(
    JSON.parse(new TextDecoder().decode((await reader.read()).value)),
  ).toEqual({ status: 200, body: receipt });
  expect((await reader.read()).done).toBe(true);
  await pending;
});

test("stream heartbeat continues while the authenticated publisher is pending", async () => {
  let tick!: () => void;
  let complete!: (value: typeof receipt) => void;
  const interval = spyOn(globalThis, "setInterval").mockImplementation(((
    callback: () => void,
  ) => {
    tick = callback;
    return 123;
  }) as typeof setInterval);
  const clear = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
  try {
    const response = await handleHistoricalValueImport(
      request("application/x-ndjson"),
      dependencies(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      ),
    );
    if (!response.body) throw Error("Missing response stream");
    const reader = response.body.getReader();
    await reader.read();
    tick();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      '{"status":"pending"}\n',
    );
    complete(receipt);
    await reader.read();
    expect(clear).toHaveBeenCalledWith(123);
  } finally {
    interval.mockRestore();
    clear.mockRestore();
  }
});

test("stream failures expose only the existing fixed refusal", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await handleHistoricalValueImport(
      request("application/x-ndjson"),
      dependencies(async () => {
        throw Error("private source and credentials");
      }),
    );
    const frames = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(frames).toEqual([
      { status: "pending" },
      { status: 409, body: { error: "assessment_not_published" } },
    ]);
  } finally {
    log.mockRestore();
  }
});

test("authorization and parsing refuse before any streaming or publisher call", async () => {
  let calls = 0;
  const deps = dependencies(async () => {
    calls++;
    return receipt;
  });
  for (const [req, options, expected] of [
    [
      request("application/x-ndjson"),
      { ...deps, sessionActor: async () => null },
      401,
    ],
    [
      request("application/x-ndjson"),
      { ...deps, adminGithubIds: new Set<string>() },
      403,
    ],
    [request("application/x-ndjson", "invalid"), deps, 400],
  ] as const) {
    const response = await handleHistoricalValueImport(req, options);
    expect(response.status).toBe(expected);
    expect(response.headers.get("content-type")).not.toBe(
      "application/x-ndjson",
    );
  }
  expect(calls).toBe(0);
});

test("canceling a stream retains the publisher promise without a false receipt", async () => {
  let complete!: (value: typeof receipt) => void;
  let pending: Promise<unknown> | undefined;
  const response = await handleHistoricalValueImport(
    request("application/x-ndjson"),
    {
      ...dependencies(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      ),
      waitUntil: (work) => {
        pending = work;
      },
    },
  );
  if (!response.body) throw Error("Missing response stream");
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  complete(receipt);
  await pending;
  expect((await reader.read()).done).toBe(true);
});

const correlation = "a1".repeat(32);
function observedRequest(body: string, accept?: string, nonce = correlation) {
  const input = request(accept, body);
  input.headers.set(INTAKE_CORRELATION_HEADER, nonce);
  return input;
}

test("opt-in Pages milestones preserve streaming frames and the exact publisher input", async () => {
  const messages: { phase: string }[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    messages.push(JSON.parse(message));
  });
  const body = '{"private":"fixture-body-☃"}';
  try {
    const response = await handleHistoricalValueImport(
      observedRequest(body, "application/x-ndjson"),
      dependencies(async (input) => {
        expect(input).toEqual(JSON.parse(body));
        expect(messages.map((entry) => entry.phase)).toEqual([
          "owner-admitted",
          "body-eof",
          "parsed",
          "heartbeat-queued",
          "rpc-dispatch",
        ]);
        return receipt;
      }),
    );
    expect(response.status).toBe(200);
    expect(
      (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([{ status: "pending" }, { status: 200, body: receipt }]);
    expect(messages).toEqual(
      [
        "owner-admitted",
        "body-eof",
        "parsed",
        "heartbeat-queued",
        "rpc-dispatch",
        "terminal",
      ].map((phase) => ({
        event: "historical-intake-pages-milestone",
        correlation,
        phase,
        elapsedMs: expect.any(Number),
        bodyBytes:
          phase === "body-eof" ? new TextEncoder().encode(body).length : null,
        terminalStatus: phase === "terminal" ? 200 : null,
      })),
    );
    expect(JSON.stringify(messages)).not.toContain("fixture-body");
  } finally {
    log.mockRestore();
  }
});

test("unauthorized and malformed nonces emit nothing; approved invalid JSON emits attributed 400 only", async () => {
  const log = spyOn(console, "log").mockImplementation(() => {});
  let rpcCalls = 0;
  const deps = dependencies(async () => {
    rpcCalls++;
    return receipt;
  });
  try {
    const refused = await handleHistoricalValueImport(observedRequest("{}"), {
      ...deps,
      sessionActor: async () => null,
    });
    expect(refused.status).toBe(401);
    expect(log).not.toHaveBeenCalled();
    const invalid = await handleHistoricalValueImport(
      observedRequest("{}", undefined, "fake-secret"),
      deps,
    );
    expect(invalid.status).toBe(200);
    expect(log).not.toHaveBeenCalled();

    const badBody = "fixture-invalid-json";
    const parseRefused = await handleHistoricalValueImport(
      observedRequest(badBody, "application/x-ndjson"),
      deps,
    );
    expect(parseRefused.status).toBe(400);
    expect(await parseRefused.json()).toEqual({ error: "invalid_request" });
    expect(rpcCalls).toBe(1);
    const entries = log.mock.calls.map(([message]) => JSON.parse(message));
    expect(entries.map((entry) => entry.phase)).toEqual([
      "owner-admitted",
      "body-eof",
      "terminal",
    ]);
    expect(entries[1].bodyBytes).toBe(badBody.length);
    expect(entries[2].terminalStatus).toBe(400);
    expect(JSON.stringify(entries)).not.toContain(badBody);
  } finally {
    log.mockRestore();
  }
});

test("RPC refusal keeps the fixed 409 and a failed diagnostics sink leaves the receipt intact", async () => {
  const log = spyOn(console, "log").mockImplementation(() => {});
  const warning = spyOn(console, "error").mockImplementation(() => {});
  try {
    const refusal = await handleHistoricalValueImport(
      observedRequest("{}"),
      dependencies(async () => {
        throw Error("private publisher failure");
      }),
    );
    expect(refusal.status).toBe(409);
    expect(await refusal.json()).toEqual({ error: "assessment_not_published" });
    const entries = log.mock.calls.map(([message]) => JSON.parse(message));
    expect(entries.map((entry) => entry.phase)).toEqual([
      "owner-admitted",
      "body-eof",
      "parsed",
      "rpc-dispatch",
      "terminal",
    ]);
    expect(entries.at(-1).terminalStatus).toBe(409);
    expect(JSON.stringify(entries)).not.toContain("private publisher failure");
    log.mockImplementation(() => {
      throw Error("private sink failure");
    });
    const success = await handleHistoricalValueImport(
      observedRequest("{}"),
      dependencies(),
    );
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual(receipt);
  } finally {
    warning.mockRestore();
    log.mockRestore();
  }
});
