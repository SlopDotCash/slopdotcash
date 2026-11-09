import { expect, test } from "bun:test";
import { githubAdvisoryReader } from "./advisories";

const origin = "https://api.github.test";
const repository = "owner/project";
const firstId = "GHSA-2345-6789-cfgh";
const secondId = "GHSA-3456-789c-fghj";

function report(id: string, createdAt: string) {
  return {
    ghsa_id: id,
    created_at: createdAt,
    submission: {},
    author: { type: "User", id: 123, login: "researcher" },
    state: "draft",
    summary: "Private fixture report",
    description: "Private fixture details",
  };
}

const first = report(firstId, "2026-10-01T00:00:00.000Z");
const second = report(secondId, "2026-10-02T00:00:00.000Z");
type Fetch = Parameters<typeof githubAdvisoryReader>[0]["fetch"];

function reader(fetch: Fetch) {
  return githubAdvisoryReader({
    apiOrigin: origin,
    token: async () => "fixture-advisory-token",
    fetch,
  });
}

test("private advisory pagination publishes only the complete sorted list and retains duplicate records", async () => {
  const requests: string[] = [];
  const advisory = reader(async (url, init) => {
    requests.push(url);
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer fixture-advisory-token",
    );
    expect(init.redirect).toBe("manual");
    if (requests.length === 1)
      return Response.json([second, { submission: null }], {
        headers: {
          link: `<${origin}/repos/${repository}/security-advisories?page=2>; rel="next"`,
        },
      });
    return Response.json([first, second]);
  });
  const result = await advisory.privateReports(repository);
  expect(result.state).toBe("ok");
  if (result.state !== "ok") throw new Error("Expected a complete census");
  expect(result.reports.map((entry) => entry.ghsa)).toEqual([
    firstId,
    secondId,
    secondId,
  ]);
  expect(requests).toHaveLength(2);
});

for (const failure of ["status", "transport"] as const) {
  test(`a later advisory page ${failure} failure returns unavailable without partial reports`, async () => {
    let requests = 0;
    const advisory = reader(async () => {
      if (++requests === 1)
        return Response.json([first], {
          headers: { link: `<${origin}/next>; rel="next"` },
        });
      if (failure === "transport") throw new Error("Fixture network failure");
      return new Response("Private provider error", { status: 503 });
    });
    expect(await advisory.privateReports(repository)).toEqual({
      state: "unavailable",
    });
    expect(requests).toBe(2);
  });
}

test("foreign advisory pagination never receives the private token", async () => {
  const requests: string[] = [];
  const advisory = reader(async (url) => {
    requests.push(url);
    return Response.json([first], {
      headers: { link: '<https://foreign.example/private>; rel="next"' },
    });
  });
  expect(await advisory.privateReports(repository)).toEqual({
    state: "unavailable",
  });
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0]!).origin).toBe(origin);
});

for (const furtherPage of [false, true]) {
  test(`the advisory page cap ${furtherPage ? "refuses a further page" : "allows a complete twentieth page"}`, async () => {
    let requests = 0;
    const advisory = reader(async () => {
      requests++;
      return Response.json([], {
        headers:
          requests < 20 || furtherPage
            ? { link: `<${origin}/next?page=${requests + 1}>; rel="next"` }
            : {},
      });
    });
    expect(await advisory.privateReports(repository)).toEqual(
      furtherPage ? { state: "unavailable" } : { state: "ok", reports: [] },
    );
    expect(requests).toBe(20);
  });
}

for (const invalid of ["shape", "json", "length"] as const) {
  test(`invalid advisory ${invalid} is unavailable rather than verified empty`, async () => {
    const advisory = reader(async () => {
      if (invalid === "shape") return Response.json({ reports: [] });
      if (invalid === "json") return new Response("[");
      return new Response("[]", {
        headers: { "content-length": String(8 * 1024 * 1024 + 1) },
      });
    });
    expect(await advisory.privateReports(repository)).toEqual({
      state: "unavailable",
    });
  });
}

test("single advisory lookup distinguishes a qualifying report from an unqualified draft", async () => {
  let qualifies = true;
  const advisory = reader(async () =>
    Response.json(qualifies ? first : { ...first, submission: null }),
  );
  const found = await advisory.privateReport(repository, firstId);
  expect(found.state).toBe("found");
  if (found.state !== "found") throw new Error("Expected the private report");
  expect(found.report.ghsa).toBe(firstId);
  qualifies = false;
  expect(await advisory.privateReport(repository, firstId)).toEqual({
    state: "unavailable",
  });
});

for (const tokenFailure of ["missing", "rejected"] as const) {
  test(`a ${tokenFailure} advisory token makes no private request`, async () => {
    let requests = 0;
    const advisory = githubAdvisoryReader({
      apiOrigin: origin,
      token: async () => {
        if (tokenFailure === "rejected") throw new Error("Fixture token failure");
        return null;
      },
      fetch: async () => {
        requests++;
        return Response.json([]);
      },
    });
    expect(await advisory.privateReports(repository)).toEqual({
      state: "unavailable",
    });
    expect(await advisory.privateReport(repository, firstId)).toEqual({
      state: "unavailable",
    });
    expect(requests).toBe(0);
  });
}
