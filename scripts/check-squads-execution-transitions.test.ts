import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareSquadsBatchHandoff } from "../src/lib/squads-batch-handoff";
import { MAX_EXECUTION_JSON_BYTES } from "../src/lib/squads-execution";
import { executionContext } from "../tests/squads-execution-context";
import { checkSquadsExecutionTransitions } from "./check-squads-execution-transitions";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const LEDGER = "funding/executions/ledger.json";
const ALLOCATION = "cycles/eliza/2026-07/allocation.json";
const PLAN = "cycles/eliza/2026-07/execution-plan.json";

async function fixture(initial: "empty" | "bound" | "missing" = "empty") {
  const root = mkdtempSync(join(tmpdir(), "slop-squads-gate-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--initial-branch=develop");
  git("config", "user.name", "Execution Gate Test");
  git("config", "user.email", "execution@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.filemode", "true");
  git("config", "core.hooksPath", join(root, "no-hooks"));
  const write = (path: string, bytes: string | Uint8Array) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  };
  const context = await executionContext();
  const bind = () => {
    write(LEDGER, `${JSON.stringify(context.ledger)}\n`);
    write(ALLOCATION, context.allocationBytes);
    write(PLAN, context.planBytes);
  };
  write("README.md", "Synthetic gate fixture\n");
  if (initial === "bound") bind();
  else if (initial === "empty") write(LEDGER, "[]\n");
  git("add", ".");
  git("commit", "-qm", "trusted base");
  const baseSha = git("rev-parse", "HEAD");
  const head = () => {
    git("add", "-A");
    git("commit", "--allow-empty", "-qm", "untrusted proposed data");
    const headSha = git("rev-parse", "HEAD");
    git("checkout", "--detach", baseSha);
    return headSha;
  };
  const check = (headSha: string) =>
    checkSquadsExecutionTransitions({ repositoryRoot: root, baseSha, headSha });
  return { root, git, write, context, bind, baseSha, head, check };
}

describe("trusted Squads execution Git transition", () => {
  it("validates Batch child hashes from base-owned canonical message code and rejects omitted fee coverage", async () => {
    const f = await fixture();
    f.bind();
    const handoff = await prepareSquadsBatchHandoff({
      ...f.context,
      multisig: "Vote111111111111111111111111111111111111111",
      vaultIndex: 0,
      transactionIndex: "1",
      member: "Stake11111111111111111111111111111111111111",
    });
    f.write(LEDGER, `${JSON.stringify([handoff.binding])}\n`);
    expect(await f.check(f.head())).toMatchObject({ appendedBindings: 1 });
    // A second proposal based on the same empty base must cover the fee too.
    f.bind();
    handoff.binding.children[0].transferIndexes.pop();
    f.write(LEDGER, `${JSON.stringify([handoff.binding])}\n`);
    await expect(f.check(f.head())).rejects.toThrow(/every parent transfer/);
  });
  it("rejects a rewritten accepted Batch child account even when the parent plan is unchanged", async () => {
    const f = await fixture();
    f.bind();
    const handoff = await prepareSquadsBatchHandoff({
      ...f.context,
      multisig: "Vote111111111111111111111111111111111111111",
      vaultIndex: 0,
      transactionIndex: "1",
      member: "Stake11111111111111111111111111111111111111",
    });
    f.write(LEDGER, `${JSON.stringify([handoff.binding])}\n`);
    f.git("add", ".");
    f.git("commit", "-qm", "accepted Batch");
    const baseSha = f.git("rev-parse", "HEAD");
    handoff.binding.children[0].messageSha256 = "f".repeat(64);
    f.write(LEDGER, `${JSON.stringify([handoff.binding])}\n`);
    f.git("add", ".");
    f.git("commit", "-qm", "rewritten child");
    const headSha = f.git("rev-parse", "HEAD");
    f.git("checkout", "--detach", baseSha);
    await expect(
      checkSquadsExecutionTransitions({
        repositoryRoot: f.root,
        baseSha,
        headSha,
      }),
    ).rejects.toThrow(/immutable/);
  });
  it("runs the real dependency-free CLI from base while a malicious head checker remains inert", async () => {
    const f = await fixture();
    cpSync(join(process.cwd(), "src/lib"), join(f.root, "src/lib"), {
      recursive: true,
    });
    f.write(
      "scripts/check-squads-execution-transitions.ts",
      readFileSync(
        join(process.cwd(), "scripts/check-squads-execution-transitions.ts"),
      ),
    );
    f.git("add", ".");
    f.git("commit", "-qm", "trusted checker and local schemas");
    const baseSha = f.git("rev-parse", "HEAD");
    f.bind();
    f.write(
      "scripts/check-squads-execution-transitions.ts",
      "throw new Error('executed PR code');",
    );
    f.write(
      "src/lib/squads-execution.ts",
      "throw new Error('loaded PR module');",
    );
    f.git("add", ".");
    f.git("commit", "-qm", "binding with hostile head code");
    const headSha = f.git("rev-parse", "HEAD");
    f.git("checkout", "--detach", baseSha);
    const result = execFileSync(
      "bun",
      [
        "--no-install",
        "scripts/check-squads-execution-transitions.ts",
        baseSha,
        headSha,
      ],
      {
        cwd: f.root,
        encoding: "utf8",
        timeout: 30000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    expect(JSON.parse(result)).toMatchObject({
      appendedBindings: 1,
      paymentAuthorized: false,
    });
  });
  it("validates a new binding from exact head blobs and ignores poisoned working-tree files and PR checker code", async () => {
    const f = await fixture();
    f.bind();
    f.write(
      "scripts/check-squads-execution-transitions.ts",
      "throw new Error('PR code must never execute');",
    );
    f.write("src/lib/squads-execution.ts", "process.exit(0);");
    const head = f.head();
    f.write(LEDGER, "poisoned working tree");
    f.write(PLAN, "uncommitted substituted plan");
    expect(await f.check(head)).toMatchObject({
      preservedBindings: 0,
      appendedBindings: 1,
      checkedArtifacts: 2,
      paymentAuthorized: false,
    });
  });
  it("preserves accepted bindings and artifacts on unrelated changes", async () => {
    const f = await fixture("bound");
    f.write("README.md", "unrelated\n");
    expect(await f.check(f.head())).toMatchObject({
      preservedBindings: 1,
      appendedBindings: 0,
      checkedArtifacts: 2,
    });
  });
  it.each(["delete", "rewrite", "rename", "duplicate"])(
    "rejects ledger %s",
    async (action) => {
      const f = await fixture("bound");
      if (action === "delete") f.write(LEDGER, "[]\n");
      if (action === "rename") {
        rmSync(join(f.root, LEDGER));
        f.write(
          "funding/executions/renamed.json",
          `${JSON.stringify(f.context.ledger)}\n`,
        );
      }
      if (action === "rewrite")
        f.write(
          LEDGER,
          `${JSON.stringify([{ ...f.context.ledger[0], transactionIndex: "2" }])}\n`,
        );
      if (action === "duplicate")
        f.write(
          LEDGER,
          `${JSON.stringify([...f.context.ledger, ...f.context.ledger])}\n`,
        );
      await expect(f.check(f.head())).rejects.toThrow();
    },
  );
  it.each([ALLOCATION, PLAN])(
    "rejects an appended binding when exact head bytes differ at %s",
    async (path) => {
      const f = await fixture();
      f.bind();
      f.write(path, `${readFileSync(join(f.root, path), "utf8")} `);
      await expect(f.check(f.head())).rejects.toThrow(/bytes/);
    },
  );
  it.each([ALLOCATION, PLAN])(
    "rejects changing accepted exact artifact %s even with a permissive PR validator",
    async (path) => {
      const f = await fixture("bound");
      f.write(path, `${readFileSync(join(f.root, path), "utf8")} `);
      f.write(
        "src/lib/squads-execution.ts",
        "export const validateSquadsExecutionContext = () => true;",
      );
      await expect(f.check(f.head())).rejects.toThrow(/immutable/);
    },
  );
  it.each(["missing", "symlink", "executable"])(
    "rejects %s head artifact",
    async (kind) => {
      const f = await fixture();
      f.bind();
      if (kind !== "executable") rmSync(join(f.root, PLAN));
      if (kind === "symlink")
        symlinkSync("allocation.json", join(f.root, PLAN));
      if (kind === "executable") chmodSync(join(f.root, PLAN), 0o755);
      await expect(f.check(f.head())).rejects.toThrow(/artifact|blob/);
    },
  );
  it("rejects duplicate and escaped duplicate keys before ordinary JSON parsing can normalize them", async () => {
    for (const key of ["currency", "currenc\\u0079"]) {
      const f = await fixture();
      f.bind();
      const source = new TextDecoder().decode(f.context.allocationBytes);
      f.write(
        ALLOCATION,
        source.replace(
          '"currency":"USDC"',
          `"currency":"USDC","${key}":"USDC"`,
        ),
      );
      await expect(f.check(f.head())).rejects.toThrow(/duplicate JSON/);
    }
  });
  it("rejects malformed UTF-8 and oversized blobs", async () => {
    const invalid = await fixture();
    invalid.bind();
    invalid.write(ALLOCATION, new Uint8Array([0xff]));
    await expect(invalid.check(invalid.head())).rejects.toThrow();
    const large = await fixture();
    large.bind();
    large.write(PLAN, new Uint8Array(MAX_EXECUTION_JSON_BYTES + 1));
    await expect(large.check(large.head())).rejects.toThrow(/byte budget/);
  });
  it("requires the exact base checkout and immutable references", async () => {
    const f = await fixture();
    f.bind();
    const head = f.head();
    f.git("checkout", "--detach", head);
    await expect(f.check(head)).rejects.toThrow(/trusted base/);
    await expect(
      checkSquadsExecutionTransitions({
        repositoryRoot: f.root,
        baseSha: "HEAD",
        headSha: head,
      }),
    ).rejects.toThrow(/immutable/);
  });
  it("permits only empty-ledger bootstrap, never new bindings alongside their first authority", async () => {
    const empty = await fixture("missing");
    empty.write(LEDGER, "[]\n");
    expect(await empty.check(empty.head())).toMatchObject({
      appendedBindings: 0,
    });
    const binding = await fixture("missing");
    binding.bind();
    await expect(binding.check(binding.head())).rejects.toThrow(
      /land the gate first/,
    );
  });
  it("cannot approve a foreign project binding with the Eliza plan", async () => {
    const f = await fixture();
    f.bind();
    f.write(
      LEDGER,
      `${JSON.stringify([{ ...f.context.ledger[0], projectId: "asi" }])}\n`,
    );
    f.write("cycles/asi/2026-07/allocation.json", f.context.allocationBytes);
    f.write("cycles/asi/2026-07/execution-plan.json", f.context.planBytes);
    await expect(f.check(f.head())).rejects.toThrow(/Foreign/);
  });
  it("keeps the existing trusted workflow check and executes only base-owned code without installing PR dependencies", () => {
    const workflow = readFileSync(
      join(
        process.cwd(),
        ".github/workflows/unsafe-destination-transitions.yml",
      ),
      "utf8",
    );
    expect(workflow).toContain("pull_request_target:");
    expect(workflow).toContain(
      ["ref: $", "{{ github.event.pull_request.base.sha }}"].join(""),
    );
    expect(workflow).toContain(
      'test "$(git rev-parse refs/remotes/origin/slop-cycle-head)" = "$CYCLE_HEAD_SHA"',
    );
    expect(workflow).toContain(
      'bun --no-install scripts/check-squads-execution-transitions.ts \\\n            "$CYCLE_BASE_SHA" "$CYCLE_HEAD_SHA"',
    );
    expect(workflow).not.toMatch(
      /bun install|npm install|ref: \$\{\{ github.event.pull_request.head/,
    );
  });
});
