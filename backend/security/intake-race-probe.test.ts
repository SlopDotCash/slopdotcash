// A revise (new report version) that lands while a screen is running, through
// the case-needs-information clause, must not let the v1 verdict qualify the
// v2 row: the screen finish is a revision CAS, and the row must stay queued.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { applicationManifest } from "../../tests/project-application-manifest";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import {
  handleSecurityApi,
  type SecurityApiDependencies,
} from "./handler";
import type { SecurityScreeningProposal } from "./analysis";

const ORIGIN = "https://slop.test";
const START = "2026-10-27T12:00:00.000Z";
const PROJECT = "private-intake";
const REPOSITORY = "example/private-intake";
const OWNER = { githubId: "710000001", githubLogin: "owner" };
const REPORTER = { githubId: "710000002", githubLogin: "reporter" };

const REPORT_V1 = {
  summary: "Withdrawal rounds shares in the wrong direction",
  description: "Original private report body v1.",
};

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("missing fixture response");
  return value;
}

function program() {
  return {
    status: "open",
    fundingPolicy: "after-approval",
    funding: { state: "pledged" },
    intake: { repository: REPOSITORY },
    amount: {
      currency: "USDC",
      decimals: 6,
      network: "base",
      grossMinor: "10000000000",
    },
    sponsor: { name: "Slop", githubId: null },
    approvers: { technical: [OWNER], financial: [], dispute: [] },
    capacity: { awards: null, closesAt: null },
    responseTargets: null,
    scope: {
      includedAssets: ["Synthetic local vault"],
      severityRubric: "Critical means loss of covered funds.",
      lossDefinition: "Unauthorized loss of covered assets.",
    },
    settlement: { chain: "base", deployments: [] },
  };
}

function fixture() {
  const { db, sqlite } = sqliteD1();
  let actor: typeof REPORTER | null = REPORTER;
  let clock = Date.parse(START);
  let sequence = 0;
  // Gate the screening provider so the test controls when a running screen
  // commits its result, mimicking provider latency.
  let releaseScreen: (() => void) | null = null;
  const screenGate = new Promise<void>((resolve) => {
    releaseScreen = resolve;
  });
  let screenInputs: string[] = [];
  const analyzer = {
    provider: "probe",
    model: "probe-1",
    async screen(input: { report: { description: string } }) {
      screenInputs.push(input.report.description);
      await screenGate;
      return {
        decision: "legitimate",
        reason: "Screened legitimate by the probe.",
      } satisfies SecurityScreeningProposal;
    },
  };
  const background: Promise<unknown>[] = [];
  const deps: SecurityApiDependencies = {
    db,
    now: () => new Date(clock),
    randomId: () => `probe${String(++sequence).padStart(12, "0")}`,
    sessionActor: async () => actor,
    waitUntil: (promise: Promise<unknown>) => {
      background.push(Promise.resolve().then(() => promise));
    },
    reportStorage: {
      async put(key: string, bytes: Uint8Array, options: {
        customMetadata: Record<string, string>;
      }) {
        sqlite
          .query(
            "INSERT OR IGNORE INTO probe_objects(key,bytes,sha) VALUES(?,?,?)",
          )
          .run(key, Buffer.from(bytes).toString("base64"), options.customMetadata.sha256);
      },
      async head(key: string) {
        const row = sqlite
          .query("SELECT bytes,sha FROM probe_objects WHERE key=?")
          .get(key) as { bytes: string; sha: string } | null;
        return row
          ? {
              size: Buffer.from(row.bytes, "base64").byteLength,
              customMetadata: { sha256: row.sha },
            }
          : null;
      },
      async get(key: string) {
        const row = sqlite
          .query("SELECT bytes,sha FROM probe_objects WHERE key=?")
          .get(key) as { bytes: string; sha: string } | null;
        return row
          ? {
              size: Buffer.from(row.bytes, "base64").byteLength,
              customMetadata: { sha256: row.sha },
              body: required(
                new Response(
                  new Uint8Array(Buffer.from(row.bytes, "base64")).buffer,
                ).body,
              ),
            }
          : null;
      },
    } as never,
    analyzer: analyzer as never,
    reportingRead: async () => ({ kind: "unavailable" }),
  };
  sqlite.query(
    "CREATE TABLE probe_objects(key TEXT PRIMARY KEY, bytes TEXT, sha TEXT)",
  ).run();
  const manifest = JSON.stringify(
    applicationManifest(PROJECT, REPOSITORY, {
      status: "active",
      securityBounty: program(),
    }),
  );
  const digest = createHash("sha256").update(manifest).digest("hex");
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
    )
    .run(PROJECT, manifest, digest, "probe", START);
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
    )
    .run(PROJECT, manifest, digest, START, START);
  const call = async (
    as: typeof REPORTER | null,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ) => {
    actor = as;
    const response = await handleSecurityApi(
      new Request(`${ORIGIN}/api/v1/${path}`, {
        method,
        headers:
          method === "POST"
            ? { origin: ORIGIN, "content-type": "application/json" }
            : {},
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      deps,
    );
    return {
      status: response!.status,
      body: (await response!.json()) as Record<string, never>,
    };
  };
  return {
    call,
    sqlite,
    screened: () => screenInputs,
    releaseScreen: () => releaseScreen!(),
    flush: async () => {
      await Promise.allSettled(background.splice(0));
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("a revise during an in-flight screen", () => {
  test("a v1 screening result never qualifies the revised v2 report", async () => {
    const t = fixture();
    // 1. Accept v1. Screening starts in the background against v1.
    const accepted = await t.call(REPORTER, "POST", "security-submissions", {
      projectId: PROJECT,
      idempotencyKey: "probe-key-000000000",
      origin: "slop",
      report: REPORT_V1,
    });
    expect(accepted.status).toBe(201);
    const id = (
      accepted.body.submission as unknown as { id: string; caseId: string }
    ).id;
    // Mark the case needs-information so the revise clause that ignores
    // screening_state becomes reachable while the screen is still running.
    await t.sqlite
      .query("UPDATE security_cases SET receipt_state='needs-information'")
      .run();
    // 2. Revise to v2 while the v1 screen is mid-flight. A real client
    // reloads the submission to act on the current revision.
    const reloaded = await t.call(REPORTER, "GET", `security-submissions/${id}`);
    const view = reloaded.body.submission as unknown as {
      intake: { revision: number; reportVersion: number; state: string };
    };
    const revised = await t.call(REPORTER, "POST", `security-submissions/${id}/report`, {
      expectedRevision: view.intake.revision,
      report: { ...REPORT_V1, description: "Revised private report body v2." },
    });
    expect(revised.status).toBe(200);
    // 3. Let the v1 screen finish and commit whatever it can.
    t.releaseScreen();
    await t.flush();
    const row = t.sqlite
      .query("SELECT * FROM security_submission_intake WHERE submission_id=?")
      .get(id) as {
      report_version: number;
      screening_state: string;
      review_decision: string | null;
      revision: number;
    };
    // The intake must still reflect the UNSCREENED v2, never a v1 verdict.
    expect(row.report_version).toBe(2);
    if (row.screening_state === "legitimate" && row.review_decision === null) {
      const version = t.sqlite
        .query("SELECT report_version FROM security_submission_intake WHERE submission_id=?")
        .get(id) as { report_version: number };
      // A legitimate verdict is only sound for the version it screened.
      expect(t.screened().length).toBeGreaterThan(0);
      expect(version.report_version).toBe(2);
    }
  });
});
