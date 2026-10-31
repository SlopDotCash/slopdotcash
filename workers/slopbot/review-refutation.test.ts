// Slopbot must not publish a finding that the reviewed text itself disproves
// (#1930): live reviews called a pinned 64-character hex digest "not a sha256
// hex value" and a 0x integer literal an "undefined name". Local HTTP fixtures
// exercise input and action controls only; synthetic verdicts do not qualify
// model correctness.
import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readdirSync } from "node:fs";
import { findProject } from "../../src/lib/projects.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { Job, Verdict } from "./contracts";
import type { D1Database } from "./persistence";
import { type ReviewEnv, refutedClaim, reviewItem } from "./review";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

// The digest of the SPL Token ELF pinned in pumpfun-source #3297 (issue #1930).
const PINNED_DIGEST =
  "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697";
const DIGEST_LINE = `+    assert sha256sum(deployed.so) == "${PINNED_DIGEST}"`;
const LITERAL_LINE = "+    SLOT_TOKEN_SIDE = 0x57738c8";
const FALSE_DIGEST_SUMMARY = `The pinned value ${PINNED_DIGEST} is not a sha256 hex value, so the hash assertion cannot succeed.`;
const FALSE_LITERAL_SUMMARY =
  "The change assigns SLOT_TOKEN_SIDE = 0x57738c8, an undefined name, so the source raises NameError.";
const GUIDANCE_QUOTE =
  "Weak or unsupported work earns no accepted-outcome score.";

type Case = {
  verdict: Verdict;
  guidance?: string | null;
  limited?: boolean;
};

/** Runs one review against the migrations, a local synthetic GitHub and a
 * local synthetic model endpoint; nothing leaves this process. */
async function reviewFixture(options: Case) {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((p) => p.endsWith(".sql"))
      .sort(),
  );
  const project = findProject("asi");
  if (!project) throw new Error("fixture project missing");
  const manifest = JSON.stringify({ ...project, status: "active" });
  const digest = createHash("sha256").update(manifest).digest("hex");
  const at = "2026-10-21T00:00:00.000Z";
  sqlite.run(
    "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
    [project.id, manifest, digest, "local regression fixture", at],
  );
  sqlite.run(
    "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,?,1,?,?,?,?)",
    [project.id, "active", manifest, digest, at, at],
  );
  const [owner, repo] = new URL(project.repositories[0].githubUrl).pathname
    .slice(1)
    .split("/");
  sqlite.run(
    "INSERT INTO project_repositories(repository_key,project_id) VALUES (?,?)",
    [`${owner}/${repo}`.toLowerCase(), project.id],
  );
  sqlite.run(
    "INSERT INTO slopbot_installations(installation_id, account_id, account_login, account_type, created_at) VALUES (1,77,?,'Organization',?)",
    [owner, at],
  );
  const repositoryId = Number(project.authority.repositoryId);
  const comments: string[] = [];
  const labels: string[] = [];
  const writes: string[] = [];
  const fallback = new Response(null, { status: 404 });
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method !== "GET") writes.push(`${request.method} ${path}`);
      if (path === "/v1/messages") {
        const input = (await request.json()) as { model?: string };
        return Response.json({
          id: "local-input-control",
          type: "message",
          role: "assistant",
          model: input.model ?? "claude-opus-5.5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                category: options.verdict.category,
                confidence: options.verdict.confidence,
                rule_refs: options.verdict.rule_refs,
                evidence: options.verdict.evidence,
                summary: options.verdict.summary,
                limitations: options.verdict.limitations,
                objective_defect: null,
              }),
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      }
      if (path.endsWith("/access_tokens"))
        return Response.json({ token: "local-synthetic-token" });
      if (path === `/repos/${owner}/${repo}`)
        return Response.json({
          id: repositoryId,
          private: false,
          default_branch: "main",
          owner: { login: owner, id: 77, type: "Organization" },
        });
      if (path.endsWith("/contents/.github/slopbot.json")) return fallback;
      if (path.endsWith("/contents/AGENTS.md")) return fallback;
      if (path.endsWith("/contents/CONTRIBUTING.md")) {
        if (options.guidance === null) return fallback;
        const text = options.guidance ?? `Be excellent.\n${GUIDANCE_QUOTE}`;
        return Response.json({
          type: "file",
          size: text.length,
          content: Buffer.from(text).toString("base64"),
          encoding: "base64",
        });
      }
      if (path.endsWith("/issues/5") && request.method === "GET")
        return Response.json({
          node_id: "PR_local",
          number: 5,
          state: "open",
          title: "pin the deployed ELF",
          body: "Made via @slopdotcash",
          user: { login: "author", id: 42, type: "User" },
          assignees: [],
          pull_request: {},
        });
      if (path.endsWith("/pulls/5"))
        return Response.json({
          draft: false,
          merged: false,
          head: { sha: "b".repeat(40) },
          base: {
            sha: "c".repeat(40),
            ref: "main",
            repo: { id: repositoryId },
          },
          additions: 2,
          deletions: 0,
          changed_files: 1,
        });
      if (path.endsWith("/branches/main"))
        return Response.json({ commit: { sha: "c".repeat(40) } });
      if (path.includes("/compare/"))
        return Response.json({
          base_commit: { sha: "c".repeat(40) },
          merge_base_commit: { sha: "c".repeat(40) },
          files: options.limited
            ? [
                {
                  filename: "assets/generated.go",
                  status: "modified",
                  patch: "+".repeat(120_001),
                },
                {
                  filename: "evidence/spl_token.go",
                  status: "added",
                  patch: `${DIGEST_LINE}\n${LITERAL_LINE}`,
                },
              ]
            : [
                {
                  filename: "evidence/spl_token.go",
                  status: "added",
                  patch: `${DIGEST_LINE}\n${LITERAL_LINE}`,
                },
              ],
        });
      if (path.endsWith("/permission"))
        return Response.json({ permission: "read" });
      if (path.endsWith("/issues/5/comments") && request.method === "GET")
        return Response.json([]);
      if (path.endsWith("/issues/5/comments")) {
        comments.push(((await request.json()) as { body: string }).body);
        return Response.json({ id: 900 }, { status: 201 });
      }
      if (path.endsWith("/issues/5/labels")) {
        const body = (await request.json()) as { labels: string[] };
        for (const name of body.labels)
          if (!labels.includes(name)) labels.push(name);
        return Response.json(body.labels.map((name) => ({ name })));
      }
      return fallback;
    },
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((
    url: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
  ) => {
    const u = new URL(url instanceof Request ? url.url : String(url));
    if (u.origin === server.url.origin) return nativeFetch(url, init);
    if (u.hostname !== "api.github.com")
      throw new Error(`unexpected network request to ${u.hostname}`);
    return nativeFetch(new URL(u.pathname + u.search, server.url), init);
  }) as typeof fetch;
  const env = {
    SLOPBOT_DB: db as unknown as D1Database,
    SLOPBOT_APP_ID: "1",
    SLOPBOT_APP_PRIVATE_KEY: privateKey,
    SLOPBOT_APP_USER_ID: "999",
    SURPLUS_API_KEY: "local-input-control",
    SURPLUS_BASE_URL: server.url.origin,
  } as ReviewEnv;
  const job: Extract<Job, { kind: "review" }> = {
    kind: "review",
    deliveryId: "refutation",
    installationId: 1,
    repositoryId,
    owner,
    repo,
    itemKind: "pull_request",
    number: 5,
  };
  try {
    const outcome = await reviewItem(env, job);
    const review = sqlite
      .query(
        "SELECT status, action FROM slopbot_reviews WHERE item_node_id = 'PR_local'",
      )
      .get() as { status: string; action: string } | null;
    const actions = sqlite
      .query(
        "SELECT action, detail FROM slopbot_actions WHERE item_node_id = 'PR_local' ORDER BY rowid",
      )
      .all() as { action: string; detail: string }[];
    const holds = sqlite
      .query("SELECT COUNT(*) AS n FROM slopbot_maintainer_holds")
      .get() as { n: number };
    return { outcome, comments, labels, writes, review, actions, holds };
  } finally {
    globalThis.fetch = nativeFetch;
    server.stop(true);
    sqlite.close();
  }
}

function finding(
  summary: string,
  evidence: string,
  options: { confidence?: number; quoted?: boolean } = {},
): Verdict {
  return {
    category: "low_quality",
    confidence: options.confidence ?? 0.97,
    rule_refs:
      options.quoted === false
        ? []
        : [{ source: "CONTRIBUTING.md", quote: GUIDANCE_QUOTE }],
    evidence: [evidence],
    summary,
    limitations: [],
    objective_defect: null,
  };
}

test("a model finding that misreads a pinned digest publishes no finding", async () => {
  const result = await reviewFixture({
    verdict: finding(FALSE_DIGEST_SUMMARY, DIGEST_LINE, { quoted: false }),
  });
  expect(result.outcome).toBe(
    "no finding published (model claim refuted by the item text)",
  );
  expect(result.comments[0]).toContain(
    "**Slopbot review complete — no finding**",
  );
  expect(result.comments[0]).not.toContain("not a sha256 hex value");
  expect(result.comments[0]).toContain("64-character lowercase-hex");
  expect(result.labels).toEqual([]);
  expect(result.holds.n).toBe(0);
  expect(result.review).toEqual({ status: "completed", action: "comment" });
  expect(result.actions).toContainEqual({
    action: "comment",
    detail: "refuted model claim",
  });
});

test("a grounded model finding with the same misread publishes no finding", async () => {
  const result = await reviewFixture({
    verdict: finding(FALSE_DIGEST_SUMMARY, DIGEST_LINE),
  });
  expect(result.outcome).toBe(
    "no finding published (model claim refuted by the item text)",
  );
  expect(result.labels).toEqual([]);
  expect(result.holds.n).toBe(0);
  expect(result.comments[0]).not.toContain("not a sha256 hex value");
});

test("a model finding that misreads a hex literal publishes no finding", async () => {
  const result = await reviewFixture({
    verdict: finding(FALSE_LITERAL_SUMMARY, LITERAL_LINE, { quoted: false }),
  });
  expect(result.outcome).toBe(
    "no finding published (model claim refuted by the item text)",
  );
  expect(result.comments[0]).not.toContain("so the source raises NameError");
  expect(result.comments[0]).toContain("integer literal");
  expect(result.labels).toEqual([]);
  expect(result.holds.n).toBe(0);
});

test("a limited review drops only the refuted claim", async () => {
  const result = await reviewFixture({
    limited: true,
    verdict: finding(FALSE_DIGEST_SUMMARY, DIGEST_LINE),
  });
  expect(result.outcome).toBe("limited advisory review published");
  expect(result.comments[0]).toContain(
    "**Slopbot limited review — maintainer review needed**",
  );
  expect(result.comments[0]).toContain("Not reviewed:");
  expect(result.comments[0]).not.toContain("not a sha256 hex value");
  expect(result.labels).toEqual([]);
  expect(result.writes).not.toContain(
    `POST /repos/SlopDotCash/asi/issues/5/labels`,
  );
});

test("a truthful low_quality finding still publishes and labels", async () => {
  const result = await reviewFixture({
    verdict: finding(
      "The change pins a digest and adds no executable work.",
      DIGEST_LINE,
    ),
  });
  expect(result.outcome).toBe("labeled (low_quality)");
  expect(result.labels).toEqual(["slopbot: low quality"]);
  expect(result.comments[0]).toContain(
    "The change pins a digest and adds no executable work.",
  );
});

test("a digest comparison claim is not refuted", async () => {
  const result = await reviewFixture({
    verdict: finding(
      `The pinned value ${PINNED_DIGEST} does not match the sha256 digest of the deployed binary.`,
      DIGEST_LINE,
    ),
  });
  expect(result.outcome).toBe("labeled (low_quality)");
  expect(result.labels).toEqual(["slopbot: low quality"]);
});

const REVIEWED_TEXT = `Title: pin the deployed ELF\n\nDiff:\n--- evidence/spl_token.go (added)\n${DIGEST_LINE}\n${LITERAL_LINE}\n+    program[0xF4] = 0\n`;

function claim(
  summary: string,
  options: { evidence?: string[]; limitations?: string[] } = {},
) {
  return {
    summary,
    evidence: options.evidence ?? [],
    limitations: options.limitations ?? [],
  };
}

test("refutedClaim reports each incident misread", () => {
  expect(refutedClaim(claim(FALSE_DIGEST_SUMMARY), REVIEWED_TEXT)).toContain(
    "64-character lowercase-hex",
  );
  expect(refutedClaim(claim(FALSE_LITERAL_SUMMARY), REVIEWED_TEXT)).toContain(
    "integer literal",
  );
  expect(
    refutedClaim(
      claim(
        "The slice uses an undefined name, `0xF4`, where 0xF4 appears intended.",
      ),
      REVIEWED_TEXT,
    ),
  ).toContain("integer literal");
});

test("refutedClaim reads limits and evidence text too", () => {
  expect(
    refutedClaim(
      claim("The value may be a redaction.", {
        limitations: [
          `The pinned value ${PINNED_DIGEST} is not a valid sha-256 value.`,
        ],
      }),
      REVIEWED_TEXT,
    ),
  ).toContain("64-character lowercase-hex");
  expect(
    refutedClaim(
      claim("The item embeds a malformed hex string.", {
        evidence: [`+    expect_hash != "${PINNED_DIGEST}"`],
      }),
      REVIEWED_TEXT,
    ),
  ).toContain("64-character lowercase-hex");
});

test("refutedClaim leaves every other claim alone", () => {
  // A comparison, not a form claim.
  expect(
    refutedClaim(
      claim(
        `The pinned value ${PINNED_DIGEST} does not match the sha256 digest of the deployed binary.`,
      ),
      REVIEWED_TEXT,
    ),
  ).toBeNull();
  // The quoted value is not in the reviewed text.
  const absent = "f".repeat(64);
  expect(
    refutedClaim(
      claim(`The pinned value ${absent} is not a sha256 hex value.`),
      REVIEWED_TEXT,
    ),
  ).toBeNull();
  // Uppercase hex is outside the checked form.
  const upper = PINNED_DIGEST.toUpperCase();
  expect(
    refutedClaim(
      claim(`The pinned value ${upper} is not a hex value.`),
      REVIEWED_TEXT,
    ),
  ).toBeNull();
  // An undefined-name claim about a real identifier is not refuted.
  expect(
    refutedClaim(
      claim("The change assigns FLAG_SECTION, an undefined name."),
      REVIEWED_TEXT,
    ),
  ).toBeNull();
  // A claim whose 0x token sits outside the phrase window is not refuted.
  expect(
    refutedClaim(
      claim(
        `The change assigns FLAG_SECTION, an undefined name. ${"The pins hold the frame. ".repeat(12)} The address 0x57738c8 stays unchanged.`,
      ),
      REVIEWED_TEXT,
    ),
  ).toBeNull();
  // A long hex blob is not treated as an integer literal.
  expect(
    refutedClaim(
      claim(`The blob 0x${"ab".repeat(18)} is an undefined name.`),
      `+    blob = 0x${"ab".repeat(18)}`,
    ),
  ).toBeNull();
  // A truthful finding needs no refutation.
  expect(
    refutedClaim(claim("The change adds no executable work."), REVIEWED_TEXT),
  ).toBeNull();
});
