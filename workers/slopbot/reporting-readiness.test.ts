import { describe, expect, test } from "bun:test";
import type {
  ReportingObservation,
  ReportingReader,
} from "../../backend/security/reporting-readiness";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { findProject } from "../../src/lib/projects.mjs";
import {
  ensureWantedLabel,
  type ReportingRefreshEnv,
  refreshRegisteredReporting,
  WANTED_LABEL_COLOR,
  WANTED_LABEL_DESCRIPTION,
} from "./reporting-readiness";

function registered(status: "active" | "paused") {
  const original = findProject("asi");
  if (!original) throw new Error("Missing registry fixture");
  return assertProjectDefinition({ ...original, status });
}

function environment(projects: ReturnType<typeof registered>[]) {
  const writes: unknown[][] = [];
  const statement = (sql: string) => ({
    values: [] as unknown[],
    bind(...values: unknown[]) {
      this.values = values;
      return this;
    },
    async all() {
      if (!sql.startsWith("SELECT manifest, revision FROM projects"))
        throw new Error(`unexpected query: ${sql}`);
      return {
        results: projects.map((project) => ({
          manifest: JSON.stringify(project),
          revision: 1,
        })),
      };
    },
    async run() {
      writes.push(this.values);
      return { success: true, meta: { changes: 1 } };
    },
    async first() {
      return null;
    },
  });
  const env = {
    SLOPBOT_DB: { prepare: statement },
    SLOPBOT_APP_ID: "1",
    SLOPBOT_APP_PRIVATE_KEY: "unused",
  } as unknown as ReportingRefreshEnv;
  return { env, writes };
}

function reader(observations: ReportingObservation[]): ReportingReader {
  const queue = [...observations];
  return async () => {
    const observation = queue.shift();
    if (!observation) throw new Error("unexpected extra read");
    return observation;
  };
}

describe("refreshRegisteredReporting", () => {
  test("a paused listing without the App is recorded but not a failure", async () => {
    const { env, writes } = environment([registered("paused")]);
    const result = await refreshRegisteredReporting(
      env,
      reader([{ kind: "app-not-installed" }]),
    );
    expect(result).toEqual({ checked: 1, failed: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.at(-1)).toBe("app-not-installed");
  });

  test("an active project without the App and any unavailable read still fail", async () => {
    const { env } = environment([registered("active"), registered("paused")]);
    const result = await refreshRegisteredReporting(
      env,
      reader([{ kind: "app-not-installed" }, { kind: "unavailable" }]),
    );
    expect(result).toEqual({ checked: 2, failed: 2 });
  });
});

describe("wanted label creation", () => {
  function fake(statuses: { get: number; post?: number }) {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const fetcher = async (url: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      calls.push({
        method,
        url,
        ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      return new Response(null, {
        status: method === "GET" ? statuses.get : (statuses.post ?? 500),
      });
    };
    return { calls, fetcher };
  }

  test("an existing label is left alone", async () => {
    const { calls, fetcher } = fake({ get: 200 });
    expect(await ensureWantedLabel(fetcher, "t", "o/r", "slop-wanted")).toBe(
      true,
    );
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  test("a missing label is created once with the published look", async () => {
    const { calls, fetcher } = fake({ get: 404, post: 201 });
    expect(await ensureWantedLabel(fetcher, "t", "o/r", "slop-wanted")).toBe(
      true,
    );
    expect(calls[1]).toEqual({
      method: "POST",
      url: "https://api.github.com/repos/o/r/labels",
      body: {
        name: "slop-wanted",
        color: WANTED_LABEL_COLOR,
        description: WANTED_LABEL_DESCRIPTION,
      },
    });
  });

  test("a label created by someone else in between counts as present", async () => {
    const { fetcher } = fake({ get: 404, post: 422 });
    expect(await ensureWantedLabel(fetcher, "t", "o/r", "slop-wanted")).toBe(
      true,
    );
  });

  test("a refused read or create reports false and creates nothing else", async () => {
    const refusedRead = fake({ get: 403 });
    expect(
      await ensureWantedLabel(refusedRead.fetcher, "t", "o/r", "slop-wanted"),
    ).toBe(false);
    expect(refusedRead.calls).toHaveLength(1);
    const refusedCreate = fake({ get: 404, post: 403 });
    expect(
      await ensureWantedLabel(refusedCreate.fetcher, "t", "o/r", "slop-wanted"),
    ).toBe(false);
  });
});
