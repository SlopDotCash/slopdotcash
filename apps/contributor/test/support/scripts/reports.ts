// spec/contributor/workflow.md, "Work selection records blockers, the project projection and live observation epochs"; spec/contributor/termsPreflight.md, "Each named document is digest-verified on an allowlisted host, and the cache never grants authority"
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "vitest";
import { manifestFor, revisionA } from "../installer/harness.ts";
import { servePublication } from "../installer/publication.ts";
import { fetchRedirect, node, removeRoot, scriptRoot } from "./fixture.ts";
import { serveGitHub } from "./github.ts";

type Policy = Record<string, unknown> & { readonly terms: Record<string, unknown> };

interface ClosingReport {
  readonly candidateIssues: ReadonlyArray<{ readonly number: number }>;
  readonly filtered: { readonly issuesWithOpenPullRequests: ReadonlyArray<{ readonly number: number; readonly closingPullRequests: ReadonlyArray<number> }> };
}

interface LiveReport {
  closingIssueNumbers(body: string, repo: string): number[];
  collectLiveReport(repo: string, listPages: (endpoint: string) => unknown[], now: Date): ClosingReport;
}

interface TermsPreflight {
  preflight(projectId: string, options?: { readonly testAuthority?: string }): Promise<Record<string, unknown>>;
}

interface Receipts {
  declaredIdentity(value: string, field: string, kind: "client" | "model" | "provider"): string;
}

const repo = "Example/repo";
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isPolicy = (value: unknown): value is Policy => isRecord(value) && isRecord(value.terms);
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const account = (login: string, id: number, type = "User") => ({ login, id, type });
const issue = (number: number) => ({ number, title: `Defect ${number}`, html_url: `https://github.com/${repo}/issues/${number}`, user: account("ada", 1000 + number), labels: [{ name: "bug-confirmed" }], assignees: [], comments: 0 });
const pull = (number: number, body: string) => ({ number, title: `Fix ${number}`, html_url: `https://github.com/${repo}/pull/${number}`, body, user: account("dependabot[bot]", 2000 + number, "Bot"), labels: [] });

/** @throws {Error} */
export async function anOpenPullRequestWithAClosingKeywordIsNotFreeWork(): Promise<void> {
  const f = scriptRoot("closing", repo);
  try {
    const report: LiveReport = await import(f.url);
    expect(report.closingIssueNumbers("Closes #11", repo)).toEqual([11]);
    expect(report.closingIssueNumbers("Closes: #10", repo)).toEqual([10]);
    expect(report.closingIssueNumbers("Fixes: Example/repo#13", repo)).toEqual([13]);
    expect(report.closingIssueNumbers("Fixes: other/repo#12", repo)).toEqual([]);
    expect(report.closingIssueNumbers("Closes https://github.com/Example/repo/issues/14", repo)).toEqual([14]);
    expect(report.closingIssueNumbers("Fixes: https://github.com/Example/repo/issues/15", repo)).toEqual([15]);
    expect(report.closingIssueNumbers("Fixes: https://github.com/other/repo/issues/16", repo)).toEqual([]);
    const pages = new Map<string, unknown[]>([
      [`repos/${repo}/issues?state=open&per_page=100&sort=created&direction=asc`, [issue(10), issue(11), issue(12), issue(14)]],
      [`repos/${repo}/pulls?state=open&per_page=100&sort=created&direction=asc`, [pull(20, "Closes: #10"), pull(21, "Closes #11"), pull(22, "Fixes: other/repo#12"), pull(23, `Closes https://github.com/${repo}/issues/14`)]],
    ]);
    const collected = report.collectLiveReport(repo, (endpoint) => {
      const page = pages.get(endpoint);
      if (page === undefined) throw new Error(`unexpected GitHub read: ${endpoint}`);
      return page;
    }, new Date("2026-11-10T00:00:00.000Z"));
    expect(collected.candidateIssues.map((item) => item.number)).toEqual([12]);
    expect(collected.filtered.issuesWithOpenPullRequests).toEqual([
      expect.objectContaining({ number: 10, closingPullRequests: [20] }),
      expect.objectContaining({ number: 11, closingPullRequests: [21] }),
      expect.objectContaining({ number: 14, closingPullRequests: [23] }),
    ]);
  } finally {
    removeRoot(f.root);
  }
}

const unboundedProgram = {
  steward: { displayName: "Example maintainers", kind: "organization", github: { actorId: "987654321", nodeId: "O_example", login: "example", type: "Organization", profileUrl: "https://github.com/example" }, website: null },
  authority: { state: "unverified", reason: "missing-repository-proof", role: "project-steward", repositoryId: "123456789", repositoryNodeId: "R_example", proof: null },
  terms: {
    revision: "draft-1",
    effectiveAt: "2026-10-18T00:00:00.000Z",
    paymentTransfersIp: false,
    retroactive: false,
    receiptPolicy: { state: "pending-authority-activation", activatedAt: null, bindings: [] },
    copyright: { model: "unknown", claimedLegalHolder: null, notice: null, legalCapacity: null, governanceResolution: null },
    repositoryLicense: { state: "unknown", spdx: null, url: null, commitSha: null, fileSha256: null },
    inbound: { mode: "unknown", termsUrl: null, commitSha: null, fileSha256: null, version: null, acceptance: null },
    assignment: null,
    externalPrize: null,
  },
};

/** @throws {Error} */
export async function termsPreflightAcknowledgesTheServedTerms(): Promise<void> {
  const manifest = { ...manifestFor("Prefer small PRs."), ...unboundedProgram };
  const projectId = manifest.id;
  const served = await servePublication({ commit: revisionA, projectId, revision: 1, manifestText: JSON.stringify(manifest) });
  const f = scriptRoot("terms-preflight", "example/project", ["terms-preflight.mjs"]);
  try {
    const authority = new URL(served.origin).origin;
    const answer = await fetch(`${served.origin}/terms.json`);
    expect(answer.status).toBe(200);
    const policy: unknown = await answer.json();
    if (!isPolicy(policy)) throw new Error("terms.json is not a policy object");
    expect(policy.securityBounty).toBeNull();
    const terms = policy.terms;
    const fields = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
    const acknowledged = { policyRevision: "draft-1", licenseSha256: null, inboundTermsSha256: null, prizeRulesSha256: null };
    expect({
      policyRevision: terms.revision,
      licenseSha256: fields(terms.repositoryLicense).fileSha256,
      inboundTermsSha256: fields(terms.inbound).fileSha256,
      prizeRulesSha256: fields(terms.externalPrize).rulesSha256 ?? null,
    }).toEqual(acknowledged);
    const script = join(f.scripts, "terms-preflight.mjs");
    const module: TermsPreflight = await import(pathToFileURL(script).href);
    const fileAuthority = join(f.root, "authority");
    mkdirSync(join(fileAuthority, "projects", projectId), { recursive: true });
    writeFileSync(join(fileAuthority, "projects", projectId, "terms.json"), JSON.stringify(policy));
    expect(await module.preflight(projectId, { testAuthority: pathToFileURL(fileAuthority).href })).toMatchObject(acknowledged);

    const redirected = { NODE_OPTIONS: `--import=${fetchRedirect}`, SLOP_TEST_REDIRECTS: JSON.stringify({ "https://slop.cash": authority }), XDG_CACHE_HOME: join(f.root, "cache") };
    const cli = node([script, "--project", projectId, "--json"], redirected);
    expect(cli.status, cli.stderr).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject(acknowledged);
    const forbidden = node([script, "--project", projectId, "--authority", "file:///tmp"], redirected);
    expect(forbidden.status).toBe(1);
    expect(forbidden.stderr).toContain("direct CLI authority overrides are forbidden");

    const document = Buffer.from("Synthetic immutable license document.\n");
    const expected = sha(document);
    const source = `https://raw.githubusercontent.com/example/project/${"a".repeat(40)}/LICENSE`;
    const cached = { ...policy, terms: { ...terms, repositoryLicense: { ...fields(terms.repositoryLicense), state: "verified", url: source, fileSha256: expected } } };
    const cacheHome = join(f.root, "cache-close");
    const cache = join(cacheHome, "slop", "policy-documents-v1");
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, `${sha(`${source}\0${expected}`)}.bin`), document);
    const probe = `
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      const [url, policyJson, projectId] = process.argv.slice(1);
      const nativeOpen = fs.open;
      let closed = 0;
      fs.open = async (...args) => {
        const handle = await nativeOpen(...args);
        return {
          stat: () => handle.stat(),
          readFile: () => handle.readFile(),
          close: async () => {
            await handle.close();
            closed++;
            throw new Error('synthetic cache-close failure');
          },
        };
      };
      syncBuiltinESMExports();
      const reads = [];
      globalThis.fetch = async (input) => {
        reads.push(String(input));
        if (String(input) !== 'https://slop.cash/projects/' + projectId + '/terms.json')
          throw new Error('verified cache unexpectedly required a document download');
        return new Response(policyJson, { status: 200 });
      };
      const { preflight } = await import(url);
      const result = await preflight(projectId);
      process.stdout.write(JSON.stringify({ result, reads, closed }));
    `;
    const closing = node(["--input-type=module", "--eval", probe, pathToFileURL(script).href, JSON.stringify(cached), projectId], { XDG_CACHE_HOME: cacheHome });
    expect(closing.status, closing.stderr).toBe(0);
    expect(JSON.parse(closing.stdout)).toMatchObject({ result: { licenseSha256: expected }, reads: [`https://slop.cash/projects/${projectId}/terms.json`], closed: 1 });

    const drifted = join(f.root, "drifted");
    const driftedLicense = join(drifted, "LICENSE");
    mkdirSync(join(drifted, "projects", projectId), { recursive: true });
    writeFileSync(driftedLicense, "Changed license bytes.\n");
    writeFileSync(join(drifted, "projects", projectId, "terms.json"), JSON.stringify({ ...cached, terms: { ...cached.terms, repositoryLicense: { ...cached.terms.repositoryLicense, url: pathToFileURL(driftedLicense).href } } }));
    await expect(module.preflight(projectId, { testAuthority: pathToFileURL(drifted).href })).rejects.toThrow("LICENSE digest drifted");

    const paused = { ...policy, status: "paused" };
    const pausedProbe = `
      import { pathToFileURL } from 'node:url';
      const [script, policyJson, projectId] = process.argv.slice(1);
      globalThis.fetch = async () => new Response(policyJson, { status: 200 });
      process.argv = [process.execPath, script, '--project', projectId];
      await import(pathToFileURL(script).href);
    `;
    const pausedRun = node(["--input-type=module", "--eval", pausedProbe, script, JSON.stringify(paused), projectId]);
    expect(pausedRun.status, pausedRun.stderr).toBe(0);
    expect(pausedRun.stdout).toContain("Project policy documents verified:");
    expect(pausedRun.stdout).not.toContain("contributions open");
  } finally {
    removeRoot(f.root);
    await served.close();
  }
}

/** @throws {Error} */
export async function discloseRefusesPlaceholderIdentityAndKeepsLegacyMarkers(): Promise<void> {
  const current = scriptRoot("disclose");
  const legacy = scriptRoot("disclose-legacy", "elizaOS/eliza");
  try {
    const disclose = (root: string, provider: string, model: string, client: string) =>
      node([join(root, "scripts", "run-receipt.mjs"), "disclose", "--provider", provider, "--model", model, "--client", client, "--json"], { XDG_CONFIG_HOME: join(root, "state") });
    const footerOf = (root: string, model: string) => {
      const ran = disclose(root, "openai", model, "codex");
      expect(ran.status, ran.stderr).toBe(0);
      return String(JSON.parse(ran.stdout).footer);
    };
    const footer = footerOf(current.root, "gpt-5.1-codex");
    expect(footer.split("\n")).toEqual([
      "Made via @slopdotcash",
      "AI provider/model: openai / gpt-5.1-codex",
      "Client / agent tooling: codex",
      "Contribution skill revision: N/A - ordinary GitHub contribution without optional run evidence",
      "Attribution status: self-reported",
      "— [contributor]",
      `<!-- slop-contribution-attribution:v1 ${JSON.stringify({ provider: "openai", model: "gpt-5.1-codex", client: "codex", skill_revision: "N/A - ordinary GitHub contribution without optional run evidence" })} -->`,
    ]);
    expect(footerOf(current.root, "unavailable")).toContain("AI provider/model: openai / unavailable");
    expect(footerOf(legacy.root, "gpt-5.1-codex")).toContain("<!-- eliza-computer-attribution:v1 ");
    for (const [provider, model, client, field] of [["ai", "gpt-5.1-codex", "codex", "--provider"], ["openai", "gpt", "codex", "--model"], ["openai", "gpt-5.1-codex", "agent", "--client"], ["unknown", "gpt-5.1-codex", "codex", "--provider"], ["openai", "TBD", "codex", "--model"]] as const) {
      const refused = disclose(current.root, provider, model, client);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain(`${field} must be an exact non-placeholder identifier`);
      expect(refused.stdout).toBe("");
    }
    const receipts: Receipts = await import(pathToFileURL(join(current.scripts, "run-receipt.mjs")).href);
    expect(() => receipts.declaredIdentity("unavailable", "--model", "model")).toThrow("is valid only with disclose");
  } finally {
    removeRoot(current.root);
    removeRoot(legacy.root);
  }
}

interface LiveRun {
  readonly candidateIssues: ReadonlyArray<{ readonly number: number }>;
  readonly filtered: { readonly issuesWithOpenPullRequests: ReadonlyArray<{ readonly number: number; readonly closingPullRequests: ReadonlyArray<number> }> };
}

const isLiveRun = (value: unknown): value is LiveRun => isRecord(value) && Array.isArray(value.candidateIssues) && isRecord(value.filtered) && Array.isArray(value.filtered.issuesWithOpenPullRequests);

/** @throws {Error} */
export async function theLiveReportRunsThroughGhAndRetriesAChangedInventory(): Promise<void> {
  const liveRepo = "example/project";
  const github = await serveGitHub();
  const f = scriptRoot("live-gh", liveRepo);
  try {
    const world = github.fake.world;
    world.addOrg({ id: 9_001, login: "example" });
    world.addUser({ id: 9_002, login: "ada" });
    world.addUser({ id: 9_003, login: "runner" });
    world.addUser({ id: 9_004, login: "dependabot[bot]", type: "Bot" });
    world.addRepo({ id: 9_100, owner: "example", name: "project" });
    const at = "2026-11-01T00:00:00.000Z";
    const free = world.addIssue({ repo: liveRepo, number: 1, author: "ada", title: "Defect 1", labels: ["bug-confirmed"], createdAt: at });
    const blocked = world.addIssue({ repo: liveRepo, number: 2, author: "ada", title: "Defect 2", labels: ["bug-confirmed"], createdAt: at });
    const blocking = world.addPull({ repo: liveRepo, number: 3, author: "dependabot[bot]", title: "Fix 2", body: "Closes #2", createdAt: at });
    const vanishing = world.addIssue({ repo: liveRepo, number: 4, author: "ada", title: "Defect 4", labels: ["bug-confirmed"], createdAt: at });
    github.fake.alterNext(`GET /repos/${liveRepo}/pulls?state=open`, (response) => {
      Object.assign(world.item(liveRepo, vanishing), { state: "closed", stateReason: "completed", closedAt: at });
      return response;
    });
    const ran = node([f.entry, "--json"], github.environment(f.bin, "runner"), { timeout: 60_000 });
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stderr).toContain("open-item inventory changed during snapshot attempt 1; retrying one complete read");
    const report: unknown = JSON.parse(ran.stdout);
    if (!isLiveRun(report)) throw new Error("live-report --json printed no report");
    expect({
      candidates: report.candidateIssues.map((item) => item.number),
      blocked: report.filtered.issuesWithOpenPullRequests.map((item) => ({ number: item.number, closingPullRequests: item.closingPullRequests })),
    }).toEqual({ candidates: [free], blocked: [{ number: blocked, closingPullRequests: [blocking] }] });
    expect(github.fake.requests.filter((request) => request.url.includes(`/repos/${liveRepo}/issues?state=open`)).length).toBe(2);
  } finally {
    await github.close();
    removeRoot(f.root);
  }
}
