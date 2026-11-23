import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetcher } from "@repo/platform/bindings";
import { githubFake } from "@repo/platform/testing/github";
import { day, fastClock, repository, start } from "./github.ts";

const missingSource = "PR_kwDOmissing";

export interface Recorded {
  readonly sourceId: string
  readonly number: number
  readonly mergedAt: number
  readonly login: string
  readonly actorId: string
}

function iso(millis: number) {
  return new Date(millis).toISOString()
}

function answer(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
}

function omittedSearch(text: string, omitted: ReadonlySet<string>) {
  const envelope = JSON.parse(text) as { data?: { search?: { issueCount: number; nodes: ReadonlyArray<{ readonly id?: string }> } } }
  const search = envelope.data?.search
  if (search === undefined) return text
  const nodes = search.nodes.filter((node) => node.id === undefined || !omitted.has(node.id))
  return JSON.stringify({ ...envelope, data: { ...envelope.data, search: { ...search, issueCount: search.issueCount - (search.nodes.length - nodes.length), nodes } } })
}

export function supplementWorld() {
  const clock = fastClock(start - 50 * day, 1)
  const fake = githubFake({ now: () => clock.now() })
  fake.world.addUser({ id: 101, login: "ada" })
  fake.world.addUser({ id: 102, login: "grace" })
  const created = fake.world.addRepo({ id: 7001, owner: "ada", name: "widgets" })
  const base = created.branches.get(created.defaultBranch) ?? ""
  const commit = (branch: string, parents: ReadonlyArray<string>, author: string, file: string) => fake.world.addCommit(repository, { branch, parents: [...parents], author, files: { [file]: `${branch}\n` } })
  const earlyWork = commit("early", [base], "grace", "src/early.ts")
  const earlySquash = commit("early-squash", [base], "grace", "src/early.ts")
  const laterWork = commit("later", [earlySquash], "ada", "src/later.ts")
  const heldWork = commit("held", [base], "grace", "src/held.ts")
  const heldSquash = commit("held-squash", [base], "grace", "src/held.ts")
  const blockedWork = commit("blocked", [heldSquash], "ada", "src/blocked.ts")
  const emptyHead = fake.world.addCommit(repository, { branch: "empty", parents: [earlySquash], author: "ada" })
  const binaryHead = fake.world.addCommit(repository, { branch: "binary", parents: [earlySquash], author: "ada", files: { "image.bin": Uint8Array.of(0, 255) } })
  const unknownHead = fake.world.addCommit(repository, { branch: "unknown", parents: [earlySquash], author: "ada" })
  const merged = (number: number, author: string, at: number, commits: ReadonlyArray<string>, mergeCommit?: string) => {
    fake.world.addPull({ repo: repository, number, author, mergedAt: iso(at), commits: [...commits], headSha: commits[commits.length - 1] ?? base, ...(mergeCommit === undefined ? {} : { mergeCommit }) })
    return fake.world.pull(repository, number).nodeId
  }
  const early = merged(1, "grace", start - 20 * day, [earlyWork], earlySquash)
  const later = merged(2, "ada", start - 10 * day, [earlySquash, laterWork])
  const held = merged(3, "grace", start - 18 * day, [heldWork], heldSquash)
  const blocked = merged(4, "ada", start - 8 * day, [heldSquash, blockedWork])
  const empty = merged(5, "ada", start - 7 * day, [earlySquash, emptyHead])
  const binary = merged(6, "ada", start - 6 * day, [earlySquash, binaryHead])
  const unknown = merged(7, "ada", start - 5 * day, [earlySquash, unknownHead])
  clock.set(start)
  const grace = fake.world.account("grace").nodeId
  const ada = fake.world.account("ada").nodeId
  const recorded: ReadonlyArray<Recorded> = [
    { sourceId: early, number: 1, mergedAt: start - 20 * day, login: "grace", actorId: grace },
    { sourceId: later, number: 2, mergedAt: start - 10 * day, login: "ada", actorId: ada },
    { sourceId: held, number: 3, mergedAt: start - 18 * day, login: "grace", actorId: grace },
    { sourceId: blocked, number: 4, mergedAt: start - 8 * day, login: "ada", actorId: ada },
    { sourceId: empty, number: 5, mergedAt: start - 7 * day, login: "ada", actorId: ada },
    { sourceId: binary, number: 6, mergedAt: start - 6 * day, login: "ada", actorId: ada },
    { sourceId: unknown, number: 7, mergedAt: start - 5 * day, login: "ada", actorId: ada },
    { sourceId: missingSource, number: 99, mergedAt: start - 15 * day, login: "grace", actorId: grace },
  ]
  const omitted = new Set([early, held])
  const acceptedObjectReads: string[] = []
  const zeroLineReads: string[] = []
  const zeroLineObjects = new Set([emptyHead, binaryHead, unknownHead])
  let offline = false
  const fetcher: Fetcher = {
    fetch: async (request) => {
      if (offline) throw new Error("Offline replay attempted a GitHub read")
      const url = new URL(request.url)
      if (url.pathname.includes("/git/commits/")) {
        acceptedObjectReads.push(url.pathname)
        if (url.pathname.endsWith(`/${heldSquash}`)) return answer({ message: "Not Found" }, 404)
      }
      const body = request.method === "POST" ? await request.clone().text() : ""
      const response = await fake.fetch(request)
      const zeroLineObject = url.pathname.split("/").at(-1) ?? ""
      if (url.pathname.startsWith(`/repos/${repository}/commits/`) && zeroLineObjects.has(zeroLineObject)) {
        zeroLineReads.push(zeroLineObject)
        if (zeroLineObject === unknownHead && response.ok) {
          const { files: _files, ...detail } = await response.json() as Record<string, unknown>
          return answer(detail)
        }
      }
      if (!body.includes("LeaderboardSearchReferences") || !response.ok) return response
      return new Response(omittedSearch(await response.text(), omitted), { status: response.status, headers: response.headers })
    },
  }
  return {
    clock,
    fetcher,
    recorded,
    acceptedObjectReads,
    zeroLineReads,
    token: fake.tokens.user("ada"),
    directory: mkdtempSync(join(tmpdir(), "slop-supplement-")),
    sources: { early, later, held, blocked, empty, binary, unknown },
    shas: { earlyWork, earlySquash, laterWork, blockedWork, heldSquash, emptyHead, binaryHead, unknownHead },
    goOffline: () => {
      offline = true
    },
  }
}

export type World = ReturnType<typeof supplementWorld>
