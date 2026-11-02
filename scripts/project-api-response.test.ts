import { afterEach, expect, test } from "bun:test";
import { ProjectApiError, projectApiRequest } from "../src/lib/project-api";

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
