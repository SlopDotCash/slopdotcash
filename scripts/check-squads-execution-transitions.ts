/** Trusted-base Git-object gate. PR trees are data; no PR module is loaded. */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findProject } from "../src/lib/projects.mjs";
import {
  assertSquadsBindingTransition,
  MAX_EXECUTION_JSON_BYTES,
  parseSquadsBindingLedger,
  validateSquadsExecutionContext,
} from "../src/lib/squads-execution";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHA = /^[0-9a-f]{40}$/u;
const LEDGER = "funding/executions/ledger.json";
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

function git(root: string, args: string[], maxBuffer = 4096): Buffer {
  return execFileSync("git", ["--literal-pathspecs", ...args], {
    cwd: root,
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
  });
}

function blob(
  root: string,
  revision: string,
  path: string,
  optional = false,
): string | null {
  const entries = new TextDecoder("utf-8", { fatal: true })
    .decode(git(root, ["ls-tree", "-z", "--full-tree", revision, "--", path]))
    .split("\0")
    .filter(Boolean);
  if (optional && entries.length === 0) return null;
  if (entries.length !== 1)
    throw new TypeError(`Missing canonical execution artifact: ${path}`);
  const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/u.exec(entries[0]);
  if (!match || match[2] !== path)
    throw new TypeError(
      `Execution artifacts must be regular non-executable Git blobs: ${path}`,
    );
  return match[1];
}

function read(
  root: string,
  oid: string,
  budget: { bytes: number },
): Uint8Array {
  const sizeText = git(root, ["cat-file", "-s", oid]).toString("utf8").trim();
  const size = Number(sizeText);
  if (
    !/^[1-9][0-9]*$/u.test(sizeText) ||
    !Number.isSafeInteger(size) ||
    size > MAX_EXECUTION_JSON_BYTES ||
    budget.bytes + size > MAX_TOTAL_BYTES
  )
    throw new RangeError("Execution transition byte budget exceeded");
  budget.bytes += size;
  const bytes = git(root, ["cat-file", "blob", oid], MAX_EXECUTION_JSON_BYTES);
  if (bytes.length !== size) throw new TypeError("Git blob size mismatch");
  return new Uint8Array(bytes);
}

/** JSON.parse checks grammar; a bounded token walk rejects duplicate keys,
 * including escaped aliases, which ordinary parsing would overwrite. */
function strictJson(bytes: Uint8Array): void {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  JSON.parse(source);
  const stack: Array<{ keys: Set<string> | null; expectsKey: boolean }> = [];
  for (const token of source.matchAll(
    /"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/gu,
  )) {
    const value = token[0];
    if (value === "{") stack.push({ keys: new Set(), expectsKey: true });
    else if (value === "[") stack.push({ keys: null, expectsKey: false });
    else if (value === "}" || value === "]") stack.pop();
    else {
      const frame = stack.at(-1);
      if (value === "," && frame?.keys) frame.expectsKey = true;
      else if (value.startsWith('"') && frame?.keys && frame.expectsKey) {
        const key = JSON.parse(value) as string;
        if (frame.keys.has(key))
          throw new TypeError("Execution artifact contains duplicate JSON key");
        frame.keys.add(key);
        frame.expectsKey = false;
      }
    }
    if (stack.length > 64)
      throw new RangeError("Execution JSON nesting exceeds bounds");
  }
}

export async function checkSquadsExecutionTransitions(input: {
  baseSha: string;
  headSha: string;
  repositoryRoot?: string;
}) {
  const root = input.repositoryRoot ?? ROOT;
  if (!SHA.test(input.baseSha) || !SHA.test(input.headSha))
    throw new TypeError("Execution gate requires immutable base and head SHAs");
  if (
    git(root, ["rev-parse", "HEAD"]).toString("utf8").trim() !== input.baseSha
  )
    throw new TypeError(
      "Execution gate must run from its exact trusted base checkout",
    );
  git(root, ["cat-file", "-e", `${input.baseSha}^{commit}`]);
  git(root, ["cat-file", "-e", `${input.headSha}^{commit}`]);
  const budget = { bytes: 0 };
  const beforeOid = blob(root, input.baseSha, LEDGER, true);
  const afterOid = blob(root, input.headSha, LEDGER);
  if (!afterOid) throw new TypeError("Execution ledger is required");
  const before = beforeOid
    ? parseSquadsBindingLedger(read(root, beforeOid, budget))
    : [];
  const after = parseSquadsBindingLedger(read(root, afterOid, budget));
  // Bootstrap cannot introduce payment bindings alongside their own authority.
  if (!beforeOid && after.length)
    throw new TypeError(
      "Initial execution ledger must be empty; land the gate first",
    );
  const ledger = assertSquadsBindingTransition(before, after);
  let checkedArtifacts = 0;
  for (const [index, binding] of ledger.entries()) {
    if (findProject(binding.projectId)?.reward.kind !== "monthly-pool")
      throw new TypeError(
        "Execution project must already be registered in the trusted base",
      );
    const directory = `cycles/${binding.projectId}/${binding.cycleId}`;
    const paths = [
      `${directory}/allocation.json`,
      `${directory}/execution-plan.json`,
    ];
    const contents: Uint8Array[] = [];
    for (const path of paths) {
      const oid = blob(root, input.headSha, path);
      if (!oid) throw new TypeError("Missing bound execution artifact");
      if (index < before.length && blob(root, input.baseSha, path) !== oid)
        throw new TypeError(
          "Accepted execution allocation and plan bytes are immutable",
        );
      const bytes = read(root, oid, budget);
      strictJson(bytes);
      contents.push(bytes);
      checkedArtifacts++;
    }
    // These validators and all their imports come from the trusted checkout.
    // Only exact PR Git blob bytes cross the boundary, never executable code.
    await validateSquadsExecutionContext({
      projectId: binding.projectId,
      allocationBytes: contents[0],
      planBytes: contents[1],
      baseLedger: before,
      ledger,
    });
  }
  return {
    preservedBindings: before.length,
    appendedBindings: ledger.length - before.length,
    checkedArtifacts,
    bytesRead: budget.bytes,
    paymentAuthorized: false as const,
  };
}

if (import.meta.main) {
  const [baseSha, headSha, ...extra] = process.argv.slice(2);
  if (!baseSha || !headSha || extra.length)
    throw new TypeError(
      "Usage: check-squads-execution-transitions.ts <base-sha> <head-sha>",
    );
  process.stdout.write(
    `${JSON.stringify(await checkSquadsExecutionTransitions({ baseSha, headSha }))}\n`,
  );
}
