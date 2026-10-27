import { describe, expect, test } from "bun:test";
import type {
  ReportingObservation,
  ReportingReader,
} from "../../backend/security/reporting-readiness";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { findProject } from "../../src/lib/projects.mjs";
import {
  type ReportingRefreshEnv,
  refreshRegisteredReporting,
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
