import { afterEach, expect, test } from "bun:test";
import {
  apiRequest,
  ProjectApiError,
  projectApiRequest,
} from "../src/lib/project-api";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function respond(body: string, status: number) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    expect(input).toBe("/api/v1/projects");
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

for (const status of [400, 503]) {
  test.each([null, false, 0, "unavailable", []].map((body) => ({ body })))(
    `keeps HTTP ${status} when the JSON error has no details: %j`,
    async ({ body }) => {
      respond(JSON.stringify(body), status);
      const error = await projectApiRequest("POST", "projects", {}).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ProjectApiError);
      expect(error).toMatchObject({
        status,
        code: "request_failed",
        message: `The request failed with HTTP ${status}.`,
      });
    },
  );

  test(`retains the API error details for HTTP ${status}`, async () => {
    respond(
      JSON.stringify({ error: "github_unavailable", message: "Try again." }),
      status,
    );
    await expect(
      projectApiRequest("POST", "projects", {}),
    ).rejects.toMatchObject({
      status,
      code: "github_unavailable",
      message: "Try again.",
    });
  });

  test(`reports unreadable JSON for HTTP ${status}`, async () => {
    respond("{", status);
    await expect(
      projectApiRequest("POST", "projects", {}),
    ).rejects.toMatchObject({
      status,
      code: "invalid_response",
      message: "The server returned an unreadable response.",
    });
  });
}

test("keeps a successful response unchanged", async () => {
  respond(JSON.stringify({ project: { id: "fixture" } }), 200);
  const response = await projectApiRequest<{ project: { id: string } }>(
    "POST",
    "projects",
    {},
  );
  expect(response).toEqual({
    project: { id: "fixture" },
  });
});

for (const phase of ["headers", "body"] as const) {
  for (const reason of ["AbortError", "TimeoutError", "TypeError"] as const) {
    test(`${phase} ${reason} preserves the transport error classification`, async () => {
      const failure =
        reason === "TypeError"
          ? new TypeError("Connection interrupted")
          : new DOMException("Connection interrupted", reason);
      globalThis.fetch = (async () => {
        if (phase === "headers") throw failure;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(failure);
            },
          }),
          { status: 503 },
        );
      }) as typeof fetch;
      const timed = reason !== "TypeError";
      await expect(projectApiRequest("GET", "projects")).rejects.toMatchObject({
        status: phase === "headers" || timed ? 0 : 503,
        code:
          phase === "headers" || timed ? "network_error" : "invalid_response",
        message: timed
          ? "The request timed out. Try again."
          : phase === "headers"
            ? "The network request failed. Try again."
            : "The server returned an unreadable response.",
      });
    });
  }
}

test.each([
  {
    body: { error: "actor_changed", message: false },
    code: "actor_changed",
    message: "The request failed with HTTP 409.",
  },
  {
    body: { error: 409, message: "Retry the access check." },
    code: "request_failed",
    message: "Retry the access check.",
  },
])("maps error fields independently: %j", async ({ body, code, message }) => {
  respond(JSON.stringify(body), 409);
  await expect(projectApiRequest("POST", "projects", {})).rejects.toMatchObject({
    status: 409,
    code,
    message,
  });
});

test.each([null, false, 0, "payload", []].map((body) => ({ body })))(
  "successful JSON is a value, not implicit session validation: %j",
  async ({ body }) => {
    respond(JSON.stringify(body), 200);
    expect(await projectApiRequest("GET", "projects")).toEqual(body);
  },
);

test("project requests bind only the supplied expected actor and serialize the exact body", async () => {
  let observed: RequestInit | undefined;
  globalThis.fetch = (async (_input, init) => {
    observed = init;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  await projectApiRequest(
    "POST",
    "projects",
    { value: 7 },
    { expectedActorGithubId: "123" },
  );
  expect(observed).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    body: '{"value":7}',
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-slop-expected-github-id": "123",
    },
  });
  expect(observed?.signal).toBeInstanceOf(AbortSignal);
});

test("raw API requests preserve caller cancellation without aborting an independent request", async () => {
  const signals: AbortSignal[] = [];
  globalThis.fetch = (async (_input, init) => {
    if (!(init?.signal instanceof AbortSignal)) throw new Error("Missing signal");
    signals.push(init.signal);
    return new Response("{}", { status: 409 });
  }) as typeof fetch;
  const oldOwner = new AbortController();
  const newOwner = new AbortController();
  const oldResponse = await apiRequest("projects", {
    signal: oldOwner.signal,
    timeoutMs: 15_000,
  });
  const newResponse = await apiRequest("projects", {
    signal: newOwner.signal,
    timeoutMs: 15_000,
  });
  oldOwner.abort();
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
  // The raw helper resolves HTTP error responses for its caller to handle.
  expect(oldResponse.status).toBe(409);
  expect(newResponse.status).toBe(409);
});
