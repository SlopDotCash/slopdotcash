// spec/points/corrections.md, "A recorded source omitted from the historical search is verified through a census supplement"
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetcher } from "@repo/platform/bindings";
import { githubFake } from "@repo/platform/testing/github";
import { type FastClock, day, fastClock, repository, start } from "../u13/github.ts";

export const project = "widgets";
export const missingSource = "PR_kwDOmissing";

export interface Recorded {
  readonly sourceId: string;
  readonly number: number;
  readonly mergedAt: number;
  readonly login: string;
  readonly actorId: string;
}

export interface SupplementWorld {
  readonly clock: FastClock;
  readonly fetcher: Fetcher;
  readonly recorded: ReadonlyArray<Recorded>;
  readonly acceptedObjectReads: ReadonlyArray<string>;
  readonly token: string;
  readonly directory: string;
  readonly sources: { readonly early: string; readonly later: string; readonly held: string; readonly blocked: string };
  readonly shas: { readonly earlyWork: string; readonly earlySquash: string; readonly laterWork: string; readonly blockedWork: string; readonly heldSquash: string };
  /** @throws {never} */
  goOffline(): void;
}

/** @throws {never} */
export function iso(millis: number): string {
  return new Date(millis).toISOString();
}

function answer(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

/** @throws {never} */
export function registryProject() {
  return {
    id: project,
    status: "active",
    listingTier: "listed",
    authority: {},
    reward: { committedMinor: "0", monthlyCapMinor: "0" },
    skill: {},
    repositories: [{ id: repository, githubUrl: `https://github.com/${repository}`, displayName: project, description: project, integrationBranch: "main" }],
  };
}

function omittedSearch(text: string, omitted: ReadonlySet<string>): string {
  const envelope = JSON.parse(text) as { data?: { search?: { issueCount: number; nodes: ReadonlyArray<{ readonly id?: string }> } } };
  const search = envelope.data?.search;
  if (search === undefined) return text;
  const nodes = search.nodes.filter((node) => node.id === undefined || !omitted.has(node.id));
  return JSON.stringify({ ...envelope, data: { ...envelope.data, search: { ...search, issueCount: search.issueCount - (search.nodes.length - nodes.length), nodes } } });
}

export function supplementWorld(): SupplementWorld {
  const clock = fastClock(start - 50 * day);
  const fake = githubFake({ now: () => clock.now() });
  fake.world.addUser({ id: 101, login: "ada" });
  fake.world.addUser({ id: 102, login: "grace" });
  const created = fake.world.addRepo({ id: 7001, owner: "ada", name: "widgets" });
  const base = created.branches.get(created.defaultBranch) ?? "";
  const commit = (branch: string, parents: ReadonlyArray<string>, author: string, file: string) => fake.world.addCommit(repository, { branch, parents: [...parents], author, files: { [file]: `${branch}\n` } });
  const earlyWork = commit("early", [base], "grace", "src/early.ts");
  const earlySquash = commit("early-squash", [base], "grace", "src/early.ts");
  const laterWork = commit("later", [earlySquash], "ada", "src/later.ts");
  const heldWork = commit("held", [base], "grace", "src/held.ts");
  const heldSquash = commit("held-squash", [base], "grace", "src/held.ts");
  const blockedWork = commit("blocked", [heldSquash], "ada", "src/blocked.ts");
  const merged = (number: number, author: string, at: number, commits: ReadonlyArray<string>, mergeCommit?: string) => {
    fake.world.addPull({ repo: repository, number, author, mergedAt: iso(at), commits: [...commits], headSha: commits[commits.length - 1] ?? base, ...(mergeCommit === undefined ? {} : { mergeCommit }) });
    return fake.world.pull(repository, number).nodeId;
  };
  const early = merged(1, "grace", start - 20 * day, [earlyWork], earlySquash);
  const later = merged(2, "ada", start - 10 * day, [earlySquash, laterWork]);
  const held = merged(3, "grace", start - 18 * day, [heldWork], heldSquash);
  const blocked = merged(4, "ada", start - 8 * day, [heldSquash, blockedWork]);
  clock.set(start);
  const grace = fake.world.account("grace").nodeId;
  const ada = fake.world.account("ada").nodeId;
  const recorded: ReadonlyArray<Recorded> = [
    { sourceId: early, number: 1, mergedAt: start - 20 * day, login: "grace", actorId: grace },
    { sourceId: later, number: 2, mergedAt: start - 10 * day, login: "ada", actorId: ada },
    { sourceId: held, number: 3, mergedAt: start - 18 * day, login: "grace", actorId: grace },
    { sourceId: blocked, number: 4, mergedAt: start - 8 * day, login: "ada", actorId: ada },
    { sourceId: missingSource, number: 99, mergedAt: start - 15 * day, login: "grace", actorId: grace },
  ];
  const omitted = new Set([early, held]);
  const acceptedObjectReads: string[] = [];
  let offline = false;
  const fetcher: Fetcher = {
    fetch: async (request) => {
      if (offline) throw new Error("Offline replay attempted a GitHub read");
      const url = new URL(request.url);
      if (url.pathname.includes("/git/commits/")) {
        acceptedObjectReads.push(url.pathname);
        if (url.pathname.endsWith(`/${heldSquash}`)) return answer({ message: "Not Found" }, 404);
      }
      const body = request.method === "POST" ? await request.clone().text() : "";
      const response = await fake.fetch(request);
      if (!body.includes("LeaderboardSearchReferences") || !response.ok) return response;
      return new Response(omittedSearch(await response.text(), omitted), { status: response.status, headers: response.headers });
    },
  };
  return {
    clock,
    fetcher,
    recorded,
    acceptedObjectReads,
    token: fake.tokens.user("ada"),
    directory: mkdtempSync(join(tmpdir(), "slop-supplement-")),
    sources: { early, later, held, blocked },
    shas: { earlyWork, earlySquash, laterWork, blockedWork, heldSquash },
    goOffline: () => {
      offline = true;
    },
  };
}
