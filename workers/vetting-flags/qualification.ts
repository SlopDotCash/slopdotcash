/** Fixed queue-only fixtures. Never bind application stores or real credentials. */
import {
  CloudflareProjectPersistence,
  type ProjectD1Database,
} from "../../backend/projects/cloudflare-persistence";
import type { R2Bucket } from "../../backend/trace/cloudflare-persistence";
import { sha256Hex } from "../../backend/trace/validation";
import {
  EVIDENCE_OPERATOR_GITHUB_IDS,
  EVIDENCE_POLICY_AUTHORITY_GITHUB_ID,
} from "../../backend/vetting/evidence";
import { CloudflareVettingPersistence } from "../../backend/vetting/persistence";
import { onRequest as pagesArtifact } from "../../functions/[[path]]";
import { onRequest as pagesApi } from "../../functions/api/v1/[[path]]";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import {
  signedVettingHeaders,
  VETTING_EVIDENCE_OBJECTS,
  VETTING_TRACE_SHA,
  vettingKeyPair,
  vettingScanResult,
} from "../../tests/vetting-fixtures";

export const flagsSchema = `
CREATE TABLE qualification_results(phase TEXT PRIMARY KEY, result TEXT NOT NULL CHECK(json_valid(result)));
CREATE TABLE qualification_deliveries(id TEXT PRIMARY KEY, action TEXT NOT NULL);
`;
type Environment = {
  EVIDENCE_DATABASE: ProjectD1Database;
  EVIDENCE_SOURCE: R2Bucket;
  QUALIFICATION_RUN: string;
};
type Inputs = {
  source: string;
  workingTree: boolean;
  assets: Record<string, string>;
  migrationHashes: { path: string; sha256: string }[];
};
type Message = {
  body: { qualification?: unknown; action?: unknown; delivery?: unknown };
  ack(): void;
};
const origin = "https://flag-qualification.invalid";
const encoder = new TextEncoder();
const actors = {
  alice: { id: "900000010", login: "qualification-alice" },
  bob: { id: "900000011", login: "qualification-bob" },
  carol: { id: "900000012", login: "qualification-carol" },
  admin: { id: "900000001", login: "qualification-admin" },
} as const;
type Actor = keyof typeof actors;
function check(value: unknown, detail: string): asserts value {
  if (!value) throw new Error(detail);
}

// This replacement is bundled only in this disposable entry. It never calls the
// network and never changes the application's origin or authentication controls.
let fixtureFetch: typeof fetch | null = null;

async function run(env: Environment, inputs: Inputs) {
  const db = env.EVIDENCE_DATABASE;
  const projects = new CloudflareProjectPersistence(db);
  const vetting = new CloudflareVettingPersistence(db);
  const keys = await vettingKeyPair();
  const sessions = new Map<Actor, string>();
  const repositories = new Set<string>();
  const now = new Date().toISOString();
  let calls = 0;
  let unexpectedRequests = 0;
  fixtureFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const request = new Request(input, init);
      const url = new URL(request.url);
      check(
        url.origin === "https://api.github.com" &&
          request.method === "GET" &&
          !request.headers.has("authorization"),
        "Unexpected outbound request",
      );
      calls++;
      const user = /^\/user\/([0-9]+)$/.exec(url.pathname);
      if (user && !url.search) {
        const actor = Object.values(actors).find((a) => a.id === user[1]);
        check(actor, "Unknown fixture actor");
        return Response.json({
          id: Number(actor.id),
          login: actor.login,
          type: "User",
          created_at: "2020-01-01T00:00:00Z",
        });
      }
      const repo =
        /^\/repos\/(example\/qual-[a-z-]+)\/(issues|branches\/main)$/.exec(
          url.pathname,
        );
      check(repo && repositories.has(repo[1]), "Unknown fixture repository");
      if (repo[2] === "branches/main") {
        check(!url.search, "Unexpected branch query");
        return Response.json({ commit: { sha: "a".repeat(40) } });
      }
      const actor = Object.values(actors).find(
        (a) => a.login === url.searchParams.get("creator"),
      );
      check(
        actor &&
          url.searchParams.get("state") === "closed" &&
          url.searchParams.get("per_page") === "100" &&
          url.searchParams.get("page") === "1" &&
          [...url.searchParams].length === 4,
        "Unexpected eligibility query",
      );
      return Response.json([
        {
          user: { id: Number(actor.id) },
          pull_request: { merged_at: "2026-01-01T00:00:00Z" },
        },
      ]);
    } catch (error) {
      unexpectedRequests++;
      throw error;
    }
  }) as typeof fetch;
  const policy = JSON.stringify({
    version: "disposable-flag-qualification-only",
    policyAuthorityGithubId: EVIDENCE_POLICY_AUTHORITY_GITHUB_ID,
    operatorGithubIds: [...EVIDENCE_OPERATOR_GITHUB_IDS],
    postClosureRetentionSeconds: 90 * 86400,
    readGrantDurationSeconds: 900,
    maxObjectBytes: 8 * 1024 * 1024,
    maxRunBytes: 64 * 1024 * 1024,
    maxObjects: 1024,
    accessPolicyReference: "fixture:access",
    retentionPolicyReference: "fixture:retention",
    recoveryPolicyReference: "fixture:recovery",
    externalControls: {
      evidenceReference: "fixture:not-an-operational-attestation",
      attestedByGithubId: EVIDENCE_POLICY_AUTHORITY_GITHUB_ID,
      attestedAt: now,
      validUntil: new Date(Date.now() + 3600000).toISOString(),
    },
  });
  const pagesEnv = {
    SLOP_DB: db,
    VETTING_EVIDENCE: env.EVIDENCE_SOURCE,
    VETTING_EVIDENCE_POLICY: policy,
    VETTING_RESULT_PUBLIC_KEYS: keys.publicKey,
    ADMIN_GITHUB_IDS: actors.admin.id,
    PROJECT_MODERATOR_GITHUB_IDS: actors.admin.id,
    ASSETS: {
      fetch: async (request: Request) => {
        const url = new URL(request.url);
        check(
          url.origin === origin && url.pathname.startsWith("/skill-templates/"),
          "Unexpected asset path",
        );
        const text =
          inputs.assets[url.pathname.slice("/skill-templates/".length)];
        check(text !== undefined, "Missing exact template input");
        return new Response(text);
      },
    },
    SLOPBOT: {
      fetch: async (request: Request) => {
        const url = new URL(request.url);
        check(
          url.origin === "https://slopbot.internal" &&
            url.pathname === "/v1/repository-access" &&
            request.method === "GET" &&
            repositories.has(url.searchParams.get("repository") ?? ""),
          "Unexpected Slopbot request",
        );
        return Response.json({
          installation: "installed",
          installationId: 1,
          permission: "read",
          roleName: null,
        });
      },
    },
  } as Parameters<typeof pagesApi>[0]["env"];
  for (const name of Object.keys(actors) as Actor[]) {
    const actor = actors[name];
    const token =
      crypto.randomUUID().replaceAll("-", "") +
      crypto.randomUUID().replaceAll("-", "");
    const hash = await sha256Hex(encoder.encode(token));
    await db
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,0)",
      )
      .bind(`qualification-${name}`, actor.id, actor.login, now)
      .run();
    await db
      .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
      .bind(
        hash,
        `qualification-${name}`,
        new Date(Date.now() + 3600000).toISOString(),
      )
      .run();
    sessions.set(name, token);
  }
  async function api(
    path: string,
    method = "GET",
    body?: unknown,
    actor: Actor | null = null,
  ) {
    check(
      /^\/(?:project-flags\/qual-[a-z-]+(?:\/withdraw)?|projects\/qual-[a-z-]+|admin\/vetting\/assessments|vetting\/refresh)$/.test(
        path,
      ),
      "Unexpected Pages route",
    );
    return pagesApi({
      request: new Request(`${origin}/api/v1${path}`, {
        method,
        headers: {
          ...(actor
            ? { cookie: `__Host-slop_points=${sessions.get(actor)}` }
            : {}),
          ...(body === undefined
            ? {}
            : { origin, "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env: pagesEnv,
    });
  }
  async function signed(path: string, method: string, body: string) {
    check(
      /^\/api\/v1\/vetting\/(?:results|refresh|evidence\/vet_[a-f0-9]{32}\/scan-run(?:\/[a-f0-9]{64})?)$/.test(
        path,
      ),
      "Unexpected signed route",
    );
    return pagesApi({
      request: new Request(`${origin}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(await signedVettingHeaders(
            keys.privateKey,
            keys.raw,
            method,
            path,
            body,
          )),
        },
        body,
      }),
      env: pagesEnv,
    });
  }
  async function skill(id: string) {
    return pagesArtifact({
      request: new Request(`${origin}/projects/${id}/skill.md`),
      env: pagesEnv,
      next: async () => new Response(null, { status: 599 }),
    });
  }
  async function flag(id: string, actor: Actor) {
    return api(
      `/project-flags/${id}`,
      "POST",
      {
        category: "credential-theft",
        evidence: `Harmless fixture ${actor}: synthetic credential-read finding.`,
      },
      actor,
    );
  }
  async function queue(id: string) {
    const response = await api(
      "/admin/vetting/assessments",
      "POST",
      { projectId: id, revision: 1, reason: "Harmless isolated qualification" },
      "admin",
    );
    check(response.status === 201, `Queue failed (${response.status})`);
    return (await vetting.projectAssessments(id)).at(-1)?.id as string;
  }
  async function result(
    id: string,
    disposition: "clean" | "malicious" = "clean",
  ) {
    const assessment = await vetting.getAssessment(id);
    check(assessment, "Missing queued assessment");
    const project = await projects.getProject(assessment.projectId);
    check(project, "Missing project");
    const body = vettingScanResult(
      {
        assessmentId: id,
        projectId: project.id,
        revision: assessment.revision,
        manifestSha256: assessment.manifestSha256,
        repository: project.manifest.repositories[0].id,
        commitSha: assessment.commitSha,
        templateSha256: assessment.templateSha256,
      },
      disposition,
      { runId: "scan-run" },
    );
    if (disposition === "clean") {
      const missing = await signed(
        "/api/v1/vetting/results",
        "POST",
        JSON.stringify(body),
      );
      check(missing.status === 422, "Missing evidence established clearance");
      const mismatch = {
        ...body,
        assessed: { ...body.assessed, commitSha: "c".repeat(40) },
      };
      check(
        (
          await signed(
            "/api/v1/vetting/results",
            "POST",
            JSON.stringify(mismatch),
          )
        ).status === 422,
        "Wrong source pin accepted",
      );
    }
    const path = `/api/v1/vetting/evidence/${id}/scan-run`;
    const manifest = {
      traceSha256: VETTING_TRACE_SHA,
      objects: VETTING_EVIDENCE_OBJECTS.map(
        ({ body: _body, ...object }) => object,
      ),
    };
    check(
      (await signed(path, "POST", JSON.stringify(manifest))).status === 201,
      "Evidence manifest refused",
    );
    for (const object of VETTING_EVIDENCE_OBJECTS)
      check(
        (await signed(`${path}/${object.sha256}`, "PUT", object.body)).ok,
        "Evidence bytes refused",
      );
    const response = await signed(
      "/api/v1/vetting/results",
      "POST",
      JSON.stringify(body),
    );
    check(response.status === 200, `Result refused (${response.status})`);
  }
  async function seed(name: string) {
    const id = `qual-${name}`;
    const repository = `example/${id}`;
    repositories.add(repository);
    const fixtureManifest = applicationManifest(id, repository, {
      status: "active",
    }) as unknown as ProjectDefinition;
    const manifest = {
      ...fixtureManifest,
      authority: {
        ...fixtureManifest.authority,
        repositoryId: String(800000000 + repositories.size),
      },
    };
    const text = JSON.stringify(manifest);
    const sha = await sha256Hex(encoder.encode(text));
    // Explicit fixture state, not a claim that project creation was exercised.
    await db.batch([
      db
        .prepare(
          "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES(?,1,?,?,'Harmless fixture seed','987654321','example',?)",
        )
        .bind(id, text, sha, now),
      db
        .prepare(
          "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
        )
        .bind(id, text, sha, now, now),
      db
        .prepare(
          "INSERT INTO project_repositories(repository_key,project_id) VALUES(?,?)",
        )
        .bind(repository, id),
    ]);
    await result(await queue(id));
    const baseline = await skill(id);
    check(
      baseline.status === 200,
      `Baseline skill unavailable (${baseline.status})`,
    );
    return id;
  }
  const assertions: string[] = [];
  const basic = await seed("fresh");
  check((await flag(basic, "alice")).status === 201, "First flag refused");
  check((await flag(basic, "alice")).status === 409, "Duplicate flag counted");
  check((await skill(basic)).status === 200, "One flag paused project");
  check((await flag(basic, "bob")).status === 201, "Second flag refused");
  check((await skill(basic)).status === 410, "Warm skill survived pause");
  check(
    (await api(`/projects/${basic}`)).status === 410,
    "Project survived pause",
  );
  const own = (await (
    await api(`/project-flags/${basic}`, "GET", undefined, "bob")
  ).json()) as { flag: { evidence: string } };
  check(
    !JSON.stringify(own).includes("fixture alice"),
    "Other reporter evidence disclosed",
  );
  check(
    (await api(`/project-flags/${basic}/withdraw`, "POST", {}, "bob"))
      .status === 200,
    "Withdrawal refused",
  );
  check((await skill(basic)).status === 410, "Withdrawal lifted quarantine");
  const fresh = (await vetting.pendingAssessments()).find(
    (a) => a.projectId === basic,
  );
  check(fresh, "Pause did not automatically queue scan");
  await result(fresh.id);
  check(
    (await skill(basic)).status === 200,
    "Fresh scan did not restore skill",
  );
  check(
    (await flag(basic, "alice")).status === 201 &&
      (await skill(basic)).status === 200,
    "Resolved flag repaused project",
  );
  assertions.push(
    "distinct-flags",
    "duplicate-refused",
    "warm-skill-410",
    "own-evidence",
    "withdrawal-keeps-pause",
    "automatic-fresh-scan",
    "fresh-restores",
    "resolved-flags-do-not-count",
  );

  const stale = await seed("stale");
  const old = await queue(stale);
  check(
    (await flag(stale, "alice")).status === 201 &&
      (await flag(stale, "bob")).status === 201,
    "Stale fixture flags failed",
  );
  await result(old);
  check((await skill(stale)).status === 410, "Pre-pause scan cleared pause");
  assertions.push("pre-pause-scan-refused");

  const newer = await seed("newer");
  check(
    (await flag(newer, "alice")).status === 201 &&
      (await flag(newer, "bob")).status === 201,
    "Newer fixture flags failed",
  );
  const prior = (await vetting.pendingAssessments()).find(
    (a) => a.projectId === newer,
  );
  check(prior, "Missing newer-evidence scan");
  check((await flag(newer, "carol")).status === 201, "Third flag refused");
  await result(prior.id);
  check((await skill(newer)).status === 410, "Newer evidence was cleared");
  await result(await queue(newer));
  check((await skill(newer)).status === 200, "Covering scan did not restore");
  assertions.push("newer-evidence-preserved", "covering-scan-restores");

  const banned = await seed("banned");
  check(
    (await flag(banned, "alice")).status === 201 &&
      (await flag(banned, "bob")).status === 201,
    "Ban fixture flags failed",
  );
  const malicious = (await vetting.pendingAssessments()).find(
    (a) => a.projectId === banned,
  );
  check(malicious, "Missing malicious assessment");
  await result(malicious.id, "malicious");
  await result(await queue(banned));
  check((await skill(banned)).status === 410, "Clean scan cleared ban");
  check(
    (await projects.listEnforcements())
      .filter((e) => e.projectId === banned)
      .at(-1)?.stateAfter === "banned",
    "Ban state changed",
  );
  assertions.push("ban-preserved");
  const pause = (await projects.listEnforcements()).find(
    (e) => e.projectId === basic && e.action === "quarantine",
  );
  check(pause, "Missing pause");
  const notices = await db
    .prepare(
      "SELECT count(*) n FROM notifications WHERE event_key=? AND recipient_github_id=?",
    )
    .bind(`project-enforcement:${pause.id}`, actors.admin.id)
    .first<{ n: number }>();
  check(notices?.n === 1, "Duplicate moderator notice");
  const concurrent = await seed("concurrent");
  const concurrentFlags = await Promise.all([
    flag(concurrent, "alice"),
    flag(concurrent, "bob"),
  ]);
  check(
    concurrentFlags.every((response) => response.status === 201),
    "Concurrent flags did not both commit",
  );
  check(
    (await skill(concurrent)).status === 410,
    "Concurrent flags missed pause",
  );
  check(
    (await projects.listEnforcements()).filter(
      (record) =>
        record.projectId === concurrent && record.action === "quarantine",
    ).length === 1,
    "Concurrent flags duplicated pause",
  );
  assertions.push(
    "concurrent-flags-pause-once",
    "missing-evidence-refused",
    "wrong-source-pin-refused",
  );
  check(unexpectedRequests === 0, "Unexpected transport request was swallowed");
  const counts = await db
    .prepare(
      "SELECT (SELECT count(*) FROM projects) projects,(SELECT count(*) FROM project_flags) flags,(SELECT count(*) FROM vetting_assessments) assessments,(SELECT count(*) FROM project_enforcements) enforcements,(SELECT count(*) FROM points_sessions) sessions,(SELECT count(*) FROM notifications) notifications,(SELECT count(*) FROM vetting_evidence_objects) evidenceObjects",
    )
    .first();
  return {
    source: inputs.source,
    workingTree: inputs.workingTree,
    migrationHashes: inputs.migrationHashes,
    actualPagesFactories: true,
    actualD1Sessions: true,
    actualRetainedEvidence: true,
    externalProviderFacts: "fixed-harmless-fixtures",
    publicHttpEdge: false,
    browser: false,
    liveScanner: false,
    productionTouched: false,
    assertions: [...assertions, "one-moderator-notice"],
    githubFixtureReads: calls,
    unexpectedTransportRequests: unexpectedRequests,
    counts,
  };
}

export function qualification(inputs: Inputs) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!fixtureFetch) throw new Error("No fixture transport is active");
    return fixtureFetch(input, init);
  }) as typeof fetch;
  let active: Promise<void> = Promise.resolve();
  return {
    async fetch() {
      return new Response(null, { status: 404 });
    },
    async queue(batch: { messages: Message[] }, env: Environment) {
      // Serializes isolates' overlapping deliveries while the closed transport
      // holds fixture state; hosted queue configuration also sets concurrency 1.
      const task = active.then(async () => {
        for (const message of batch.messages) {
          const { qualification: identity, action, delivery } = message.body;
          check(
            /^slop-vet-flags-[0-9]{1,20}-[0-9]{1,5}$/.test(
              env.QUALIFICATION_RUN,
            ) &&
              identity === env.QUALIFICATION_RUN &&
              (action === "flags" || action === "empty") &&
              typeof delivery === "string" &&
              /^(flags|empty)-[1-9][0-9]{0,3}$/.test(delivery) &&
              delivery.startsWith(`${action}-`),
            "Invalid fixture command",
          );
          const db = env.EVIDENCE_DATABASE;
          try {
            if (action === "empty") {
              const bucket = env.EVIDENCE_SOURCE as R2Bucket & {
                list(): Promise<{ objects: { key: string }[] }>;
                delete(key: string): Promise<void>;
              };
              for (;;) {
                const page = await bucket.list();
                if (!page.objects.length) break;
                for (const object of page.objects) {
                  check(
                    object.key.startsWith("vetting/"),
                    "Foreign fixture object",
                  );
                  await bucket.delete(object.key);
                }
              }
              await db
                .prepare(
                  "INSERT OR IGNORE INTO qualification_results VALUES('empty','{\"empty\":true}')",
                )
                .run();
            } else if (
              !(await db
                .prepare(
                  "SELECT phase FROM qualification_results WHERE phase='flags'",
                )
                .first())
            ) {
              const started = await db
                .prepare(
                  "INSERT OR IGNORE INTO qualification_results VALUES('started-flags','{}')",
                )
                .run();
              check(
                started.meta?.changes === 1,
                "Partial fixture run must not repeat",
              );
              const result = await run(env, inputs);
              await db
                .prepare("INSERT INTO qualification_results VALUES('flags',?)")
                .bind(JSON.stringify(result))
                .run();
            }
            await db
              .prepare(
                "INSERT OR IGNORE INTO qualification_deliveries VALUES(?,?)",
              )
              .bind(`command:${delivery}`, action)
              .run();
          } catch (error) {
            await db
              .prepare(
                "INSERT OR IGNORE INTO qualification_results VALUES(?,?)",
              )
              .bind(
                `failed-${action}`,
                JSON.stringify({
                  failed: true,
                  category:
                    error instanceof Error ? error.message : "fixture-failed",
                }),
              )
              .run();
          } finally {
            fixtureFetch = null;
          }
          message.ack();
        }
      });
      // Only the serialization tail absorbs rejection; the original task below
      // still fails the delivery. Later cleanup can therefore run.
      active = task.catch(() => {});
      return task;
    },
  };
}
