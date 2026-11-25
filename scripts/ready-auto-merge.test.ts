import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type Api,
  githubApi,
  MAX_MERGES_PER_RUN,
  mergeComment,
  PILOT_REPOSITORY,
  PILOT_REPOSITORY_ID,
  READY_LABEL,
  runReadyAutoMerge,
  SLOPBOT_BOT,
} from "./ready-auto-merge";

// Shapes follow the GitHub REST answers read on 25 November 2026: the issue
// event list (a Slopbot label event has actor slopdotcash[bot], type Bot),
// pull request reviews, the collaborator permission answer and the contents
// answer for .github/slop-project.json on development.
const REPO = PILOT_REPOSITORY;
const HEAD = "a".repeat(40);
const OLD_HEAD = "b".repeat(40);
const BOT = { id: SLOPBOT_BOT.id, login: SLOPBOT_BOT.login, type: "Bot" };
const AUTHOR = { id: 11, login: "author", type: "User" };
const MAINTAINER = { id: 22, login: "maint", type: "User" };
const OUTSIDER = { id: 33, login: "outsider", type: "User" };

type Fixture = {
  number: number;
  pull: Record<string, unknown>;
  events: unknown[];
  reviews: unknown[];
  files: unknown[];
};

function projectFile(branch: string) {
  return {
    encoding: "base64",
    content: Buffer.from(
      JSON.stringify({
        repository: {
          fullName: REPO,
          id: String(PILOT_REPOSITORY_ID),
          integrationBranch: branch,
        },
      }),
    ).toString("base64"),
  };
}

function fixture(number = 7): Fixture {
  return {
    number,
    pull: {
      number,
      state: "open",
      merged: false,
      draft: false,
      mergeable: true,
      mergeable_state: "clean",
      changed_files: 1,
      user: AUTHOR,
      head: { sha: HEAD },
      base: { ref: "development", repo: { id: PILOT_REPOSITORY_ID } },
      labels: [{ name: READY_LABEL }],
    },
    events: [
      {
        event: "labeled",
        created_at: "2026-11-25T10:05:00Z",
        label: { name: READY_LABEL },
        actor: BOT,
      },
    ],
    reviews: [
      {
        user: MAINTAINER,
        state: "APPROVED",
        commit_id: HEAD,
        submitted_at: "2026-11-25T10:00:00Z",
      },
    ],
    files: [{ filename: "src/lib/thing.ts" }],
  };
}

type World = {
  api: Api;
  writes: { method: string; path: string; body: unknown }[];
  lines: string[];
  /** Runs after the first read of a pull request, before the second. */
  betweenReads?: (fixture: Fixture) => void;
};

function world(
  fixtures: Fixture[],
  options: {
    permissions?: Record<string, string>;
    fail?: (path: string) => number | undefined;
    mergeStatus?: number;
    integrationBranch?: string;
    defaultBranch?: string;
  } = {},
): World {
  const permissions: Record<string, string> = {
    maint: "write",
    outsider: "read",
    author: "write",
    ...options.permissions,
  };
  const users = [AUTHOR, MAINTAINER, OUTSIDER];
  const seen = new Set<number>();
  const result: World = {
    writes: [],
    lines: [],
    api: async (method, path, body) => {
      const failed = options.fail?.(path);
      if (failed !== undefined) return { status: failed, data: null };
      if (method !== "GET") {
        result.writes.push({ method, path, body });
        if (path.endsWith("/merge"))
          return {
            status: options.mergeStatus ?? 200,
            data: { merged: (options.mergeStatus ?? 200) === 200 },
          };
        return { status: 201, data: { id: 1 } };
      }
      if (path === `/repos/${REPO}`)
        return {
          status: 200,
          data: {
            id: PILOT_REPOSITORY_ID,
            full_name: REPO,
            default_branch: options.defaultBranch ?? "vibestack",
          },
        };
      if (path.startsWith(`/repos/${REPO}/issues?`))
        return {
          status: 200,
          data: [
            ...fixtures.map((item) => ({
              number: item.number,
              pull_request: {},
            })),
            { number: 9000 },
          ],
        };
      const contents = path.match(/\/contents\/.+\?ref=(.+)$/u);
      if (contents)
        return {
          status: 200,
          data: projectFile(options.integrationBranch ?? "development"),
        };
      const permission = path.match(/\/collaborators\/([^/]+)\/permission$/u);
      if (permission) {
        const user = users.find((item) => item.login === permission[1]);
        return {
          status: 200,
          data: { permission: permissions[permission[1] ?? ""], user },
        };
      }
      const item = path.match(/\/(?:pulls|issues)\/(\d+)(\/[a-z]+)?/u);
      const found = fixtures.find(
        (entry) => entry.number === Number(item?.[1]),
      );
      if (!item || !found) return { status: 404, data: null };
      if (item[2] === "/events") return { status: 200, data: found.events };
      if (item[2] === "/reviews") return { status: 200, data: found.reviews };
      if (item[2] === "/files") return { status: 200, data: found.files };
      const data = structuredClone(found.pull);
      if (!seen.has(found.number)) {
        seen.add(found.number);
        result.betweenReads?.(found);
      }
      return { status: 200, data };
    },
  };
  return result;
}

async function run(
  target: World,
  options: { enabled?: string; dryRun?: boolean } = {},
) {
  return runReadyAutoMerge({
    api: target.api,
    repository: REPO,
    enabled: "enabled" in options ? options.enabled : "on",
    dryRun: options.dryRun ?? false,
    log: (line) => target.lines.push(line),
  });
}

async function skipReason(change: (item: Fixture) => void, options = {}) {
  const item = fixture();
  change(item);
  const target = world([item], options);
  const outcomes = await run(target);
  expect(target.writes).toEqual([]);
  expect(outcomes).toHaveLength(1);
  expect(outcomes[0]?.action).toBe("skipped");
  return outcomes[0]?.detail ?? "";
}

test("an absent or other switch value reads and merges nothing", async () => {
  for (const enabled of [undefined, "", "off", "ON", "true"]) {
    let calls = 0;
    const target = world([fixture()]);
    const outcomes = await runReadyAutoMerge({
      api: async (...args) => {
        calls++;
        return target.api(...args);
      },
      repository: REPO,
      enabled,
      dryRun: false,
      log: () => {},
    });
    expect(outcomes).toEqual([]);
    expect(calls).toBe(0);
  }
});

test("a verified pull request is merged at its head with one comment", async () => {
  const target = world([fixture()]);
  const outcomes = await run(target);
  expect(outcomes).toEqual([
    {
      number: 7,
      action: "merged",
      detail: `head ${HEAD} into development, approved by maint`,
    },
  ]);
  expect(target.writes).toEqual([
    {
      method: "PUT",
      path: `/repos/${REPO}/pulls/7/merge`,
      body: { sha: HEAD, merge_method: "merge" },
    },
    {
      method: "POST",
      path: `/repos/${REPO}/issues/7/comments`,
      body: { body: mergeComment(HEAD, ["maint"]) },
    },
  ]);
  expect(target.lines[0]).toBe(
    `#7 merged: head ${HEAD} into development, approved by maint`,
  );
  expect(mergeComment(HEAD, ["maint"])).not.toContain("@");
});

test("a dry run reports the merge and writes nothing, whatever the switch", async () => {
  const target = world([fixture()]);
  const outcomes = await run(target, { enabled: undefined, dryRun: true });
  expect(outcomes[0]?.action).toBe("would-merge");
  expect(target.writes).toEqual([]);
  const api = githubApi("token", true, (async () => {
    throw new Error("no request expected");
  }) as unknown as typeof fetch);
  await expect(api("PUT", "/x", {})).rejects.toThrow("never writes");
});

test("only the registered integration branch is a permitted base", async () => {
  for (const base of ["main", "vibestack"])
    expect(
      await skipReason((item) => {
        (item.pull.base as { ref: string }).ref = base;
      }),
    ).toContain("never merges into");
  expect(
    await skipReason(
      (item) => {
        (item.pull.base as { ref: string }).ref = "trunk";
      },
      { defaultBranch: "trunk" },
    ),
  ).toContain("never merges into");
  expect(
    await skipReason((item) => {
      (item.pull.base as { ref: string }).ref = "feature";
    }),
  ).toBe("feature is not the project's registered integration branch");
  expect(
    await skipReason(() => {}, {
      fail: (path: string) => (path.includes("/contents/") ? 404 : undefined),
    }),
  ).toContain("could not be read (HTTP 404)");
  expect(
    await skipReason((item) => {
      (item.pull.base as { repo: { id: number } }).repo.id = 5;
    }),
  ).toBe("its base is another repository");
});

test("a label a person added, or removed last, never counts", async () => {
  expect(
    await skipReason((item) => {
      item.events = [
        {
          event: "labeled",
          created_at: "2026-11-25T10:05:00Z",
          label: { name: READY_LABEL },
          actor: MAINTAINER,
        },
      ];
    }),
  ).toBe("the ready label was last added by maint, not Slopbot");
  // Slopbot labelled, removed the label, and a person put it back.
  expect(
    await skipReason((item) => {
      item.events.push(
        {
          event: "unlabeled",
          created_at: "2026-11-25T10:06:00Z",
          label: { name: READY_LABEL },
          actor: BOT,
        },
        {
          event: "labeled",
          created_at: "2026-11-25T10:07:00Z",
          label: { name: READY_LABEL },
          actor: { id: 44, login: "slopdotcash", type: "User" },
        },
      );
    }),
  ).toContain("not Slopbot");
  expect(
    await skipReason((item) => {
      item.events.push({
        event: "unlabeled",
        created_at: "2026-11-25T10:06:00Z",
        label: { name: READY_LABEL },
        actor: BOT,
      });
    }),
  ).toBe("the newest ready label event is a removal");
  expect(
    await skipReason((item) => {
      item.events = [
        {
          event: "labeled",
          created_at: "2026-11-25T10:05:00Z",
          label: { name: "other" },
          actor: BOT,
        },
      ];
    }),
  ).toBe("its event history shows no ready label");
  // A full last page means the history may be cut short.
  expect(
    await skipReason((item) => {
      item.events = Array.from({ length: 100 }, () => item.events[0]);
    }),
  ).toBe("the event history is too long to read in full");
});

test("a label older than the head commit never counts", async () => {
  // The only review of the head came after the label: the label belongs to
  // an earlier commit that Slopbot has not yet cleared.
  expect(
    await skipReason((item) => {
      item.reviews = [
        {
          user: MAINTAINER,
          state: "APPROVED",
          commit_id: OLD_HEAD,
          submitted_at: "2026-11-25T10:00:00Z",
        },
        {
          user: MAINTAINER,
          state: "APPROVED",
          commit_id: HEAD,
          submitted_at: "2026-11-25T10:20:00Z",
        },
      ];
    }),
  ).toBe("the ready label is older than every review of its head commit");
  expect(
    await skipReason((item) => {
      item.events.push({
        event: "head_ref_force_pushed",
        created_at: "2026-11-25T10:06:00Z",
        actor: AUTHOR,
      });
    }),
  ).toBe("the head was force pushed after Slopbot added the label");
});

test("approval must stand at the head from an account with write access", async () => {
  expect(
    await skipReason((item) => {
      (item.reviews[0] as { commit_id: string }).commit_id = OLD_HEAD;
    }),
  ).toBe("no approval stands at its head commit");
  expect(
    await skipReason((item) => {
      (item.reviews[0] as { user: unknown }).user = OUTSIDER;
    }),
  ).toBe("no approval at its head commit is from an account with write access");
  // The author's own approval is not counted even with write access.
  expect(
    await skipReason((item) => {
      (item.reviews[0] as { user: unknown }).user = AUTHOR;
    }),
  ).toBe("no approval stands at its head commit");
  expect(
    await skipReason((item) => {
      (item.reviews[0] as { user: unknown }).user = {
        id: 8,
        login: "helper[bot]",
        type: "Bot",
      };
    }),
  ).toBe("no approval stands at its head commit");
  // A later dismissal replaces the approval.
  expect(
    await skipReason((item) => {
      item.reviews.push({
        user: MAINTAINER,
        state: "DISMISSED",
        commit_id: HEAD,
        submitted_at: "2026-11-25T10:01:00Z",
      });
    }),
  ).toBe("no approval stands at its head commit");
  expect(
    await skipReason(() => {}, {
      fail: (path: string) => (path.endsWith("/permission") ? 403 : undefined),
    }),
  ).toBe("the permission of maint could not be read (HTTP 403)");
  for (const permission of ["admin", "write"]) {
    const target = world([fixture()], { permissions: { maint: permission } });
    expect((await run(target))[0]?.action).toBe("merged");
  }
});

test("an open change request from a write account blocks the merge", async () => {
  const requested = (user: unknown) => (item: Fixture) => {
    item.reviews.push({
      user,
      state: "CHANGES_REQUESTED",
      commit_id: OLD_HEAD,
      submitted_at: "2026-11-25T09:00:00Z",
    });
  };
  expect(
    await skipReason(requested({ id: 55, login: "second", type: "User" }), {
      permissions: { second: "admin" },
      fail: () => undefined,
    }),
  ).toContain("permission of second");
  const item = fixture();
  requested(OUTSIDER)(item);
  expect((await run(world([item])))[0]?.action).toBe("merged");
  const blocked = fixture();
  requested(OUTSIDER)(blocked);
  const target = world([blocked], { permissions: { outsider: "write" } });
  expect((await run(target))[0]?.detail).toBe(
    "outsider has an open change request",
  );
  expect(target.writes).toEqual([]);
});

test("GitHub must report the pull request mergeable and clean", async () => {
  for (const state of ["unstable", "blocked", "behind", "dirty", "has_hooks"])
    expect(
      await skipReason((item) => {
        item.pull.mergeable_state = state;
      }),
    ).toBe(`GitHub reports its merge state as ${state}, not clean`);
  expect(
    await skipReason((item) => {
      item.pull.mergeable = null;
    }),
  ).toContain("has not worked out");
  expect(
    await skipReason((item) => {
      item.pull.draft = true;
    }),
  ).toBe("it is a draft");
  expect(
    await skipReason((item) => {
      item.pull.labels = [];
    }),
  ).toBe(`it does not carry ${READY_LABEL}`);
});

test("nothing under .github/ merges this way", async () => {
  expect(
    await skipReason((item) => {
      item.files = [{ filename: ".github/workflows/deploy.yml" }];
    }),
  ).toContain("touches .github/workflows/deploy.yml");
  expect(
    await skipReason((item) => {
      item.files = [
        { filename: "docs/moved.json", previous_filename: ".GitHub/x.json" },
      ];
    }),
  ).toContain("touches .GitHub/x.json");
  expect(
    await skipReason((item) => {
      item.pull.changed_files = 2;
    }),
  ).toBe("the changed file list is incomplete");
});

test("a head that moves during the checks is not merged", async () => {
  const item = fixture();
  const target = world([item]);
  target.betweenReads = (found) => {
    (found.pull.head as { sha: string }).sha = OLD_HEAD;
  };
  const outcomes = await run(target);
  expect(outcomes[0]?.detail).toBe(
    "its head or base changed during the checks",
  );
  expect(target.writes).toEqual([]);
});

test("a refused merge posts no comment and one bad answer skips one item", async () => {
  const target = world([fixture()], { mergeStatus: 409 });
  const outcomes = await run(target);
  expect(outcomes[0]?.detail).toBe("GitHub refused the merge (HTTP 409)");
  expect(target.writes).toHaveLength(1);
  const broken = fixture(8);
  broken.pull = { number: 8 };
  const mixed = world([broken, fixture(9)]);
  expect((await run(mixed)).map((outcome) => outcome.action)).toEqual([
    "skipped",
    "merged",
  ]);
});

test("a run merges at most five pull requests, lowest number first", async () => {
  const numbers = [16, 15, 14, 13, 12, 11, 10];
  const target = world(numbers.map((number) => fixture(number)));
  const outcomes = await run(target);
  expect(outcomes.filter((outcome) => outcome.action === "merged").length).toBe(
    MAX_MERGES_PER_RUN,
  );
  expect(outcomes.map((outcome) => outcome.number)).toEqual(
    [...numbers].sort((a, b) => a - b),
  );
  expect(outcomes.slice(MAX_MERGES_PER_RUN).map((o) => o.detail)).toEqual([
    "this run already reached its limit of 5",
    "this run already reached its limit of 5",
  ]);
  expect(target.lines).toHaveLength(numbers.length + 1);
});

test("an unreadable repository or list stops the run before any merge", async () => {
  const target = world([fixture()], {
    fail: (path: string) => (path.includes("/issues?") ? 502 : undefined),
  });
  await expect(run(target)).rejects.toThrow("could not start");
  expect(target.writes).toEqual([]);
  await expect(
    runReadyAutoMerge({
      api: target.api,
      repository: "someone/else",
      enabled: "on",
      dryRun: false,
    }),
  ).rejects.toThrow("only");
});

test("the workflow is dispatch-only, switched, serialized and least-privileged", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ready-auto-merge.yml", import.meta.url),
    "utf8",
  )
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  expect(workflow).toMatch(
    /^on:\n {2}workflow_dispatch:\npermissions: \{\}\n/mu,
  );
  for (const trigger of ["schedule", "pull_request", "push:", "workflow_run"])
    expect(workflow).not.toContain(trigger);
  expect(workflow).toContain("vars.SLOPBOT_AUTO_MERGE == 'on'");
  expect(workflow).toContain("github.ref == 'refs/heads/main'");
  expect(workflow).toContain(`github.repository == '${PILOT_REPOSITORY}'`);
  expect(workflow).toContain(
    "concurrency:\n  group: slop-ready-auto-merge\n  cancel-in-progress: false",
  );
  expect(workflow).toContain(
    "    permissions:\n      contents: write\n      pull-requests: write\n    steps:",
  );
  // The job runs main's own script and never a pull request's code.
  expect(workflow).toMatch(/ref: \$\{\{ github\.sha \}\}/u);
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).not.toContain("bun install");
  expect(workflow).not.toContain("head.sha");
});
