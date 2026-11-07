/** Composed real consumer + migrated SQLite + synthetic local Git/provider
 * transport. Provider fixtures test retention/partition control, not quality. */
import { expect, setSystemTime, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { collectTargetRepositories } from "../../src/lib/repositories.mjs";
import { REWARD_ASSET_NETWORKS } from "../../src/lib/reward-asset.mjs";
import { VALUE_DIMENSIONS } from "../../src/lib/value-assessment";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { fixture, policy, repository } from "../../tests/value-binary-fixture";
import { recordDelivery } from "./persistence";
import { consumeValueRequest, type ValueConsumerEnv } from "./value-consumer";
import { collectValueEvidence } from "./value-evidence";
import { recordValueRequest } from "./value-requests";
import { prepareWorkUnitEvidence } from "./value-work-unit";

const start = new Date().toISOString();
type PipelineState = {
  last: string;
  now: number;
  calls: number;
  retained: boolean;
  writes: number;
  a: string;
  b: string;
};
function pipelineTrace(scenario: string): PipelineState[] {
  const directory = mkdtempSync(join(tmpdir(), "slop-pipeline-trace-"));
  const output = join(directory, "trace.itf.json");
  try {
    const generated = spawnSync(
      "node_modules/.bin/quint",
      [
        "test",
        "formal/models/bot_value_pipeline.qnt",
        "--backend=typescript",
        `--match=${scenario}`,
        "--seed=20261107",
        `--out-itf=${output}`,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    expect(generated.status, generated.stderr).toBe(0);
    const trace = JSON.parse(readFileSync(output, "utf8"), (_key, value) =>
      value && typeof value === "object" && "#bigint" in value
        ? Number(value["#bigint"])
        : value,
    ) as { states: { s: PipelineState }[] };
    return trace.states.map(({ s }) => s);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const key = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

for (const expiry of [
  "publication",
  "provider",
  "overlap",
  "queued",
] as const) {
  test(`${expiry} expiry preserves retained inference and one joint publication for both PRs`, async () => {
    const trace = pipelineTrace(
      expiry === "publication" || expiry === "queued"
        ? "expiredPublicationReusesInferenceTest"
        : expiry === "provider"
          ? "leaseExpiryDuringInferenceStillKeepsReusableReceiptTest"
          : "overlappingConsumerWaitsThenReadsCurrentTest",
    );
    const tick = trace.find((state) => state.last === "tick");
    if (!tick) throw new Error("Generated pipeline trace omitted expiry");
    const later = new Date(
      Date.parse(start) +
        tick.now * (expiry === "overlap" ? 61 : 11) * 60 * 1000,
    ).toISOString();
    setSystemTime(new Date(start));
    const { db, sqlite } = sqliteD1();
    const fixtures = [
      fixture({ direct: true, textOnly: true }),
      fixture({ direct: true, textOnly: true }),
    ];
    for (const [index, source] of fixtures.entries()) {
      Object.assign(source.pull, {
        number: index + 1,
        node_id: `PR_pipeline_${index + 1}`,
        html_url: `https://github.com/${repository.id}/pull/${index + 1}`,
        merged_at: `2026-11-0${5 + index}T18:00:00Z`,
        closed_at: `2026-11-0${5 + index}T18:00:00Z`,
        updated_at: `2026-11-0${5 + index}T18:00:00Z`,
      });
    }
    const project = assertProjectDefinition(
      applicationManifest("fixture", repository.id, {
        rewardAsset: {
          network: "ethereum",
          kind: "stablecoin",
          ...REWARD_ASSET_NETWORKS.ethereum.stablecoin,
          chainId: REWARD_ASSET_NETWORKS.ethereum.chainId,
          cluster: null,
          verifiedAt: start,
        },
        status: "active",
        authority: {
          state: "unverified",
          reason: "missing-repository-proof",
          role: "project-steward",
          repositoryId: "42",
          repositoryNodeId: "R_binary",
          proof: null,
        },
      }),
    );
    const manifest = JSON.stringify(project);
    const digest = createHash("sha256").update(manifest).digest("hex");
    sqlite.run(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
      [project.id, manifest, digest, "Composed pipeline fixture", start],
    );
    sqlite.run(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,'active',1,?,?,?,?)",
      [project.id, manifest, digest, start, start],
    );
    sqlite.run(
      "INSERT INTO project_repositories(repository_key,project_id) VALUES (?,?)",
      [repository.id, project.id],
    );
    sqlite.run(
      "INSERT INTO slopbot_installations(installation_id,account_id,account_login,account_type,created_at) VALUES (1,1,'example','Organization',?)",
      [start],
    );
    const repositories = collectTargetRepositories([project]);
    const sources = await Promise.all(
      fixtures.map(async (source) => ({
        evidence: await collectValueEvidence(
          source.client,
          repository.id,
          1,
          repositories[0],
        ),
        policy,
      })),
    );
    const joint = await prepareWorkUnitEvidence(sources, repositories);
    expect(joint.limitations).toEqual([]);
    expect(joint.claims).toHaveLength(1);
    expect(joint.claims[0].carrierPullRequestIds).toHaveLength(2);
    const assessment = {
      status: "unresolved",
      tier: null,
      rationale: "This local transport fixture makes no value determination.",
      dimensions: Object.fromEntries(
        VALUE_DIMENSIONS.map((dimension) => [
          dimension,
          "Not assessed by this fixture.",
        ]),
      ),
      evidenceUrls: sources.map(({ evidence }) => evidence.pull.html_url),
      relatedPullRequests: [],
      limitations: ["No model quality assertion is made."],
      reviews: [],
    };
    let providerCalls = 0;
    let expired = false;
    const expireRows = () => {
      sqlite.run(
        "UPDATE slopbot_value_processing SET lease_until=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second') WHERE state='running'",
      );
      sqlite.run(
        "UPDATE slopbot_value_source_leases SET lease_until=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second')",
      );
      setSystemTime(new Date(later));
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        providerCalls++;
        if (expiry === "overlap") {
          expect(await consumeValueRequest(env, jobs[1])).toBe("retry");
        }
        if (expiry === "provider" && !expired) {
          expired = true;
          expireRows();
        }
        const input = (await request.json()) as { model: string };
        return Response.json(
          {
            id: "local-pipeline",
            type: "message",
            role: "assistant",
            model: input.model,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  units: [
                    { claimIds: joint.claims.map(({ id }) => id), assessment },
                  ],
                }),
              },
            ],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: {
              input_tokens: 10,
              output_tokens: 10,
              buyer_cost_micro: 1000,
            },
          },
          { headers: { "x-request-id": "local-pipeline-request" } },
        );
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === `http://127.0.0.1:${server.port}`)
        return originalFetch(input, init);
      if (url.origin !== "https://api.github.com")
        throw new Error("Unexpected external transport");
      if (url.pathname === "/app/installations/1/access_tokens")
        return Response.json({ token: "local-installation" });
      if (url.pathname === "/installation/repositories")
        return Response.json({
          repositories: [{ id: 42, node_id: "R_binary", private: false }],
        });
      if (url.pathname === "/graphql") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          query: string;
          variables: { number?: number };
        };
        if (body.query.includes("search(query:"))
          return Response.json({
            data: {
              search: {
                issueCount: 2,
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: fixtures.map(({ pull }) => ({
                  id: pull.node_id,
                  number: pull.number,
                  url: pull.html_url,
                  mergedAt: pull.merged_at,
                  repository: {
                    id: "R_binary",
                    databaseId: 42,
                    nameWithOwner: repository.id,
                    isPrivate: false,
                  },
                  mergeCommit: { oid: pull.merge_commit_sha },
                  commits: {
                    totalCount: 1,
                    nodes: [{ commit: { oid: pull.head.sha } }],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                })),
              },
            },
          });
        return Response.json({
          data:
            await fixtures[(body.variables.number ?? 1) - 1].client.graphql(),
        });
      }
      if (/\/commits\/[a-f0-9]{40}\/pulls$/.test(url.pathname))
        return Response.json(
          fixtures.map(({ pull }) => ({
            node_id: pull.node_id,
            number: pull.number,
            html_url: pull.html_url,
            state: "closed",
            merged_at: pull.merged_at,
            base: {
              repo: {
                id: 42,
                node_id: "R_binary",
                full_name: repository.id,
                private: false,
              },
            },
          })),
        );
      if (url.pathname.endsWith("/contents/CONTRIBUTING.md"))
        return Response.json({
          type: "file",
          encoding: "base64",
          size: "Retain accepted source evidence.".length,
          content: Buffer.from("Retain accepted source evidence.").toString(
            "base64",
          ),
        });
      const selected = /\/(?:pulls|issues)\/2(?:\/|$)/.test(url.pathname)
        ? fixtures[1]
        : fixtures[0];
      const path = (url.pathname + url.search).replace(
        /\/(pulls|issues)\/2(?=\/|\?|$)/,
        "/$1/1",
      );
      const result = await selected.client.get(path);
      return Response.json(result, { status: result === null ? 404 : 200 });
    }) as typeof fetch;
    const wrapped = {
      ...db,
      prepare(sql: string) {
        if (
          expiry === "publication" &&
          !expired &&
          sql.includes("INSERT INTO slopbot_work_unit_journal")
        ) {
          expired = true;
          expect(providerCalls).toBe(1);
          expect(
            sqlite
              .query("SELECT COUNT(*) n FROM slopbot_value_inference_results")
              .get(),
          ).toEqual({ n: 1 });
          expect(
            sqlite
              .query("SELECT COUNT(*) n FROM slopbot_value_source_leases")
              .get(),
          ).toEqual({ n: 2 });
          expireRows();
        }
        if (
          expiry === "queued" &&
          !expired &&
          sql.includes("INSERT INTO slopbot_work_unit_journal")
        ) {
          expired = true;
          const observed = sqlite
            .query("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS at")
            .get() as { at: string };
          const expiryAt = new Date(
            Date.parse(observed.at) + 500,
          ).toISOString();
          sqlite.run(
            "UPDATE slopbot_value_processing SET lease_until=? WHERE state='running'",
            [expiryAt],
          );
          sqlite.run("UPDATE slopbot_value_source_leases SET lease_until=?", [
            expiryAt,
          ]);
          const delayed = (
            statement: ReturnType<typeof db.prepare>,
          ): ReturnType<typeof db.prepare> => ({
            ...statement,
            bind: (...values: unknown[]) => delayed(statement.bind(...values)),
            run: async () => {
              expect(
                sqlite
                  .query(
                    "SELECT lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AS live FROM slopbot_value_processing WHERE state='running'",
                  )
                  .get(),
              ).toEqual({ live: 1 });
              await new Promise((resolve) => setTimeout(resolve, 650));
              expect(
                sqlite
                  .query(
                    "SELECT lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AS live FROM slopbot_value_processing WHERE state='running'",
                  )
                  .get(),
              ).toEqual({ live: 0 });
              setSystemTime(new Date(later));
              return statement.run();
            },
          });
          return delayed(db.prepare(sql));
        }
        return db.prepare(sql);
      },
    };
    const env = {
      SLOPBOT_DB: wrapped,
      SLOPBOT_APP_ID: "1",
      SLOPBOT_APP_PRIVATE_KEY: key,
      SLOPBOT_APP_USER_ID: "2",
      SURPLUS_API_KEY: "local-only",
      SURPLUS_BASE_URL: `http://127.0.0.1:${server.port}`,
      SLOPBOT_PRODUCER_REVISION: "a".repeat(40),
      SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD: "alerts-only",
    } as ValueConsumerEnv;
    const jobs = fixtures.map(({ pull }) => ({
      deliveryId: `pipeline-${pull.number}`,
      installationId: 1,
      repositoryId: 42,
      owner: "example",
      repo: "binary-proof",
      number: pull.number,
    }));
    try {
      for (const job of jobs) {
        await recordDelivery(db, job.deliveryId, "pull_request");
        await recordValueRequest(db, job);
      }
      if (expiry === "overlap") {
        expect(await consumeValueRequest(env, jobs[0])).toBe("published");
        setSystemTime(new Date(later));
        expect(await consumeValueRequest(env, jobs[1])).toBe("current");
      } else {
        await expect(consumeValueRequest(env, jobs[0])).rejects.toThrow(
          "lease",
        );
        expect(expired).toBe(true);
        expect(
          sqlite
            .query("SELECT COUNT(*) n FROM slopbot_work_unit_journal")
            .get(),
        ).toEqual({ n: 0 });
        expect(await consumeValueRequest(env, jobs[1])).toBe("published");
        expect(await consumeValueRequest(env, jobs[0])).toBe("current");
      }
      const final = trace.at(-1);
      if (!final) throw new Error("Generated pipeline trace was empty");
      expect(final.a).toBe("complete");
      expect(final.b).toBe("complete");
      expect(final.retained).toBe(true);
      expect(providerCalls).toBe(final.calls);
      expect(
        sqlite
          .query("SELECT COUNT(*) n FROM slopbot_value_inference_attempts")
          .get(),
      ).toEqual({ n: 1 });
      expect(
        sqlite
          .query("SELECT COUNT(*) n FROM slopbot_value_budget_reservations")
          .get(),
      ).toEqual({ n: 1 });
      expect(
        sqlite.query("SELECT COUNT(*) n FROM slopbot_costs").get(),
      ).toEqual({ n: 1 });
      expect(
        sqlite.query("SELECT COUNT(*) n FROM slopbot_work_unit_journal").get(),
      ).toEqual({ n: final.writes });
      expect(
        sqlite.query("SELECT COUNT(*) n FROM slopbot_work_unit_claims").get(),
      ).toEqual({ n: 1 });
      expect(
        sqlite.query("SELECT COUNT(*) n FROM slopbot_work_unit_sources").get(),
      ).toEqual({ n: 2 });
      expect(
        sqlite
          .query(
            "SELECT state,outcome FROM slopbot_value_processing ORDER BY delivery_id",
          )
          .all(),
      ).toEqual([
        {
          state: "completed",
          outcome: expiry === "overlap" ? "published" : "current",
        },
        {
          state: "completed",
          outcome: expiry === "overlap" ? "current" : "published",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      server.stop(true);
      setSystemTime();
      sqlite.close();
    }
  }, 30000);
}
