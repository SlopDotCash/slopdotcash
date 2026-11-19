// spec/contributor/openedRun.md, "One invocation validates the PR, reuses its own run and records one exact event"; spec/contributor/sessionExchange.md, "Assertion consumption survives signing errors and a lost session reply"
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "vitest";
import { author, startSite } from "../harness.ts";
import { removeRoot, templateScripts } from "./fixture.ts";

interface Opened {
  readonly serverRunId: string;
  readonly eventId: string;
  readonly pullRequest: string;
  readonly pullRequestNodeId: string;
}

interface OpenedOptions {
  readonly pullRequest: string;
  readonly pullRequestNodeId: string;
  readonly provider: string;
  readonly model: string;
  readonly client: string;
  readonly clientVersion: string;
}

interface Receipts {
  recordPullRequestOpened(options: OpenedOptions, transport: {
    readonly fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
    readonly assertionProvider: () => Promise<string>;
    readonly now: () => string;
  }): Promise<Opened>;
}

const traceAuthority = "https://api.slop.cash";
const skillSourcePath = "skills/contribute-to-slop-test";
const node = "PR_kwDOscriptsOpened1";

/** @throws {Error} */
function git(root: string, ...args: ReadonlyArray<string>): void {
  const ran = spawnSync("git", ["-C", root, "-c", "user.name=Slop Test", "-c", "user.email=test@slop.invalid", ...args], { encoding: "utf8" });
  if (ran.status !== 0) throw new Error(`git ${args[0]} failed: ${ran.stderr}`);
}

/** @throws {Error} */
function committedSkill(root: string): string {
  const skill = join(root, skillSourcePath);
  mkdirSync(join(skill, "scripts"), { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "# Contribute to slop-test\n");
  writeFileSync(join(skill, "project.json"), JSON.stringify({ projectId: "slop-test", repositoryId: "slop-test/widget", skillName: "contribute-to-slop-test", skillSourcePath, usageAdapters: {} }));
  copyFileSync(join(templateScripts, "run-receipt.mjs"), join(skill, "scripts", "run-receipt.mjs"));
  git(root, "init", "-q");
  git(root, "remote", "add", "origin", "https://github.com/SlopDotCash/slopdotcash.git");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "Commit the slop-test skill");
  return join(skill, "scripts", "run-receipt.mjs");
}

/** @throws {Error} */
export async function theOpenedCommandRecordsOneEventOnItsOwnRun(): Promise<void> {
  const assets = mkdtempSync(join(tmpdir(), "slop-opened-site-"));
  const checkout = mkdtempSync(join(tmpdir(), "slop-opened-skill-"));
  const site = await startSite(assets);
  try {
    const at = new Date().toISOString();
    await site.rows("INSERT INTO private_intake_status (singleton, enabled, verified_at) VALUES (1, 1, ?) ON CONFLICT(singleton) DO UPDATE SET enabled = excluded.enabled, verified_at = excluded.verified_at", at);
    const receipts: Receipts = await import(pathToFileURL(committedSkill(checkout)).href);
    const reached: string[] = [];
    const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== traceAuthority) throw new Error(`the opened command reached ${url.origin}`);
      reached.push(`${init.method ?? "GET"} ${url.pathname}`);
      const answer = await site.call(`${url.pathname}${url.search}`, {
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers)),
        ...(typeof init.body === "string" ? { body: init.body } : {}),
      });
      return new Response(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": answer.headers["content-type"] ?? "application/json" } });
    };
    const transport = { fetchImpl, assertionProvider: () => site.assertion(author.login), now: () => at };
    const options: OpenedOptions = { pullRequest: "https://github.com/slop-test/widget/pull/7", pullRequestNodeId: node, provider: "anthropic", model: "claude-opus-4-1", client: "claude-code", clientVersion: "2.0.0" };

    await expect(receipts.recordPullRequestOpened({ ...options, pullRequest: "https://github.com/other/widget/pull/7" }, transport)).rejects.toThrow("--pull-request must be a https://github.com/slop-test/widget/pull/<number> URL");
    expect(reached).toEqual([]);

    const first = await receipts.recordPullRequestOpened(options, transport);
    const second = await receipts.recordPullRequestOpened(options, transport);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ pullRequest: "https://github.com/slop-test/widget/pull/7", pullRequestNodeId: node });
    const once = ["POST /api/v1/auth/session", "POST /api/v1/runs", `POST /api/v1/runs/${encodeURIComponent(first.serverRunId)}/events`];
    expect(reached).toEqual([...once, ...once]);

    const runs = await site.rows("SELECT id, client_run_id, github_user_id FROM trace_runs WHERE client_run_id = ?", `pr_opened_${node}`);
    const events = await site.rows("SELECT e.kind, e.source, e.github_object_id FROM run_progress_events e JOIN trace_runs r ON r.id = e.run_id WHERE r.client_run_id = ?", `pr_opened_${node}`);
    expect({ runs: runs.map((run) => ({ id: run.id, githubUserId: String(run.github_user_id) })), events }).toEqual({
      runs: [{ id: first.serverRunId, githubUserId: author.githubId }],
      events: [{ kind: "pull_request_opened", source: "agent", github_object_id: node }],
    });
  } finally {
    await site.dispose();
    removeRoot(assets);
    removeRoot(checkout);
  }
}
