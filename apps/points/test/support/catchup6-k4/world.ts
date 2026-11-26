// spec/points/corrections.md, "A historical source retains its original carrier and every successor"
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settableClock } from "@repo/platform/testing/clock";
import { githubFake } from "@repo/platform/testing/github";
import { day, repository, start } from "../u13/github.ts";

const iso = (millis: number) => new Date(millis).toISOString();

export function acceptanceWorld() {
  const clock = settableClock(start - 50 * day);
  const fake = githubFake({ now: () => clock.now() });
  fake.world.addUser({ id: 101, login: "ada" });
  const created = fake.world.addRepo({ id: 7001, owner: "ada", name: "widgets" });
  const base = created.branches.get(created.defaultBranch) ?? "";
  const original = fake.world.addCommit(repository, { branch: "original", parents: [base], author: "ada", files: { "src/carried.ts": "original\n" } });
  fake.world.addPull({ repo: repository, number: 1, author: "ada", state: "closed", commits: [original], headSha: original });
  const carried = fake.world.addCommit(repository, { branch: "carried", parents: [base], files: { "src/carried.ts": "carried\n" } });
  const mergedAt = start - 20 * day;
  fake.world.addPull({ repo: repository, number: 2, author: "ada", body: "Carries #1 forward.", mergedAt: iso(mergedAt), commits: [carried], headSha: carried });
  clock.set(start);
  return {
    clock,
    fetcher: { fetch: (request: Request) => fake.fetch(request) },
    token: fake.tokens.user("ada"),
    directory: mkdtempSync(join(tmpdir(), "slop-retained-")),
    source: fake.world.pull(repository, 2).nodeId,
    mergedAt,
    ada: fake.world.account("ada").nodeId,
  };
}

export type World = ReturnType<typeof acceptanceWorld>;
