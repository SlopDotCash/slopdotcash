import { expect, spyOn, test } from "bun:test";
import { handleHistoricalValueImport } from "./value-import";

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
