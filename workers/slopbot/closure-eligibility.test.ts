import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { findProject } from "../../src/lib/projects.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  closureEligibility,
  hasRecordedSkillRun,
  isMember,
} from "./closure-eligibility";
import { labelOnlyConfig } from "./contracts";
import type { D1Database } from "./persistence";
import { registeredRepository, reviewRegistration } from "./registry";
import { route } from "./routing";

const migrations = readdirSync(new URL("../../migrations/", import.meta.url))
  .filter((p) => p.endsWith(".sql"))
  .sort();

const eligible = {
  itemKind: "pull_request",
  exemption: "not-exempt",
  member: true,
  recordedSkillRun: true,
} as const;

describe("closure eligibility", () => {
  test("permits closure only for a verified member with a recorded run (D6)", () => {
    expect(closureEligibility(eligible)).toEqual({
      eligible: true,
      why: "verified member with a recorded Slop run for this pull request",
    });
    for (const [change, why] of [
      [{ exemption: "exempt" }, "maintainers are never closed by Slopbot"],
      [{ exemption: "unknown" }, "maintainer status unknown"],
      [{ itemKind: "issue" }, "only Slop-skill pull requests can be closed"],
      [{ member: false }, "author is not a verified slop.cash member"],
      [
        { recordedSkillRun: false },
        "no recorded Slop run for this pull request",
      ],
    ] as const)
      expect(closureEligibility({ ...eligible, ...change })).toEqual({
        eligible: false,
        why,
      });
  });

  const base = {
    config: { ...labelOnlyConfig(), closure: true },
    itemKind: "pull_request" as const,
    itemOpen: true,
    draft: false,
    merged: false,
    authorType: "User",
    authorIsSelf: false,
    scope: "contributor" as const,
    exemption: "not-exempt" as const,
    markerPresent: true,
    participant: true,
    humanReopenedThisRevision: false,
    authorCapReached: false,
  };

  test("a copied marker keeps advisory review but never permits closure", () => {
    const routing = route({
      ...base,
      participant: false,
      closure: closureEligibility({
        ...eligible,
        member: false,
        recordedSkillRun: false,
      }),
    });
    expect(routing).toEqual({
      review: true,
      mayClose: false,
      penaltyEligible: false,
      reason: "advisory review only: author is not a verified slop.cash member",
    });
  });

  test("a member without a verified skill run is reviewed but not closed", () => {
    expect(
      route({
        ...base,
        closure: closureEligibility({ ...eligible, recordedSkillRun: false }),
      }),
    ).toMatchObject({ review: true, mayClose: false, penaltyEligible: false });
  });

  test("a matched member with a recorded run may be closed and penalized", () => {
    expect(
      route({ ...base, closure: closureEligibility(eligible) }),
    ).toMatchObject({ review: true, mayClose: true, penaltyEligible: true });
  });

  test("a security-only review of a paused project never closes", () => {
    expect(
      route({
        ...base,
        scope: "security",
        closure: closureEligibility(eligible),
      }),
    ).toEqual({
      review: true,
      mayClose: false,
      penaltyEligible: false,
      reason: "contributor work is paused; security review only",
    });
  });
});

describe("recorded run evidence", () => {
  test("binds the authenticated author, project, repository and pull request", async () => {
    const { db, sqlite } = sqliteD1(migrations);
    const store = db as unknown as D1Database;
    const at = "2026-10-22T00:00:00.000Z";
    sqlite.run(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES ('actor-42','42','author',?,0)",
      [at],
    );
    sqlite.run(
      `INSERT INTO trace_runs(id,client_run_id,github_user_id,github_login,project_id,repository,
        project_policy_revision,provider,model,client,client_version,state,created_at,create_idempotency_key)
       VALUES ('run-1','client-1','42','author','asi','Example-Org/Repo',?,
        'surplus','claude-opus-5.5','claude-code','1.0.0','awaiting_trace',?,'idem-1')`,
      ["a".repeat(40), at],
    );
    sqlite.run(
      `INSERT INTO run_progress_events(id,run_id,github_user_id,kind,occurred_at,source,github_object_id,
        github_url,head_sha,created_at,idempotency_key)
       VALUES ('event-1','run-1','42','pull_request_opened',?,'agent',NULL,
        'https://github.com/Example-Org/Repo/pull/7',NULL,?,'idem-event-1')`,
      [at, at],
    );
    const item = {
      authorId: 42,
      projectId: "asi",
      owner: "example-org",
      repo: "repo",
      nodeId: "PR_seven",
    };
    expect(await isMember(store, 42)).toBe(true);
    expect(await isMember(store, 43)).toBe(false);
    // Owner decision D6: the event must name the exact pull request node ID.
    // A matching URL alone is not evidence.
    expect(await hasRecordedSkillRun(store, item)).toBe(false);
    sqlite.run("UPDATE run_progress_events SET github_object_id = 'PR_seven'");
    expect(await hasRecordedSkillRun(store, item)).toBe(true);
    expect(
      closureEligibility({
        ...eligible,
        member: await isMember(store, 42),
        recordedSkillRun: await hasRecordedSkillRun(store, item),
      }),
    ).toMatchObject({ eligible: true });
    // Another person's run, another pull request, project or repository is
    // not evidence for this author.
    expect(await hasRecordedSkillRun(store, { ...item, authorId: 43 })).toBe(
      false,
    );
    expect(
      await hasRecordedSkillRun(store, { ...item, nodeId: "PR_eight" }),
    ).toBe(false);
    expect(
      await hasRecordedSkillRun(store, { ...item, projectId: "other" }),
    ).toBe(false);
    expect(await hasRecordedSkillRun(store, { ...item, repo: "fork" })).toBe(
      false,
    );
    // A run without a pull_request_opened event proves no submission.
    sqlite.run("UPDATE run_progress_events SET kind = 'checkpoint'");
    expect(await hasRecordedSkillRun(store, item)).toBe(false);
  });
});

describe("registry capabilities", () => {
  test("a paused registered project keeps security review and loses contributor work", async () => {
    const { db, sqlite } = sqliteD1(migrations);
    const store = db as unknown as D1Database;
    const project = findProject("asi");
    if (!project) throw new Error("fixture project missing");
    const manifest = JSON.stringify(project);
    const digest = createHash("sha256").update(manifest).digest("hex");
    const at = "2026-10-21T00:00:00.000Z";
    sqlite.run(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
      [project.id, manifest, digest, "local regression fixture", at],
    );
    sqlite.run(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,?,1,?,?,?,?)",
      [project.id, project.status, manifest, digest, at, at],
    );
    const [owner, repo] = new URL(project.repositories[0].githubUrl).pathname
      .slice(1)
      .split("/");
    sqlite.run(
      "INSERT INTO project_repositories(repository_key,project_id) VALUES (?,?)",
      [`${owner}/${repo}`.toLowerCase(), project.id],
    );
    const job = {
      owner,
      repo,
      repositoryId: Number(project.authority.repositoryId),
    };
    expect(project.status).toBe("active");
    expect(await reviewRegistration(store, job)).toEqual({
      scope: "contributor",
      projectId: project.id,
    });
    expect(await registeredRepository(store, job)).toBe(true);

    const paused = JSON.stringify({ ...project, status: "paused" });
    const pausedDigest = createHash("sha256").update(paused).digest("hex");
    sqlite.run(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,2,?,?,?,?)",
      [project.id, paused, pausedDigest, "local pause fixture", at],
    );
    sqlite.run(
      "UPDATE projects SET status = 'paused', revision = 2, manifest = ?, manifest_sha256 = ? WHERE id = ?",
      [paused, pausedDigest, project.id],
    );
    expect(await reviewRegistration(store, job)).toEqual({
      scope: "security",
      projectId: project.id,
    });
    // Value assessment and scoring are contributor work.
    expect(await registeredRepository(store, job)).toBe(false);

    // A reused repository name with another immutable ID is not registered.
    expect(
      await reviewRegistration(store, { ...job, repositoryId: 1 }),
    ).toBeNull();
    expect(
      await reviewRegistration(store, { ...job, repo: "unregistered" }),
    ).toBeNull();
  });
});
