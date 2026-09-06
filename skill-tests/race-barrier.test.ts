import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

const helper = new URL("./helpers/race-barrier.mjs", import.meta.url).href;
const node = process.env.SLOP_TEST_NODE ?? "node";

function probe(release: string, options: Record<string, number>) {
  return spawnSync(
    node,
    [
      "--input-type=module",
      "-e",
      `import {waitForRaceRelease} from ${JSON.stringify(helper)}; waitForRaceRelease(${JSON.stringify(release)}, ${JSON.stringify(options)});`,
    ],
    { encoding: "utf8", timeout: 5_000 },
  );
}

it("race barrier completes when its coordinator releases it", () => {
  const root = mkdtempSync(join(tmpdir(), "slop-race-barrier-"));
  try {
    const release = join(root, "release");
    writeFileSync(release, "released\n");
    const result = probe(release, { timeoutMs: 100 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.error, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("race barrier fails by its own deadline instead of leaking a child", () => {
  const root = mkdtempSync(join(tmpdir(), "slop-race-barrier-"));
  try {
    const result = probe(join(root, "never-released"), { timeoutMs: 30 });
    assert.equal(result.status, 1);
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.match(result.stderr, /Race barrier timed out before release/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("race barrier refuses an absent or replaced coordinator", () => {
  const root = mkdtempSync(join(tmpdir(), "slop-race-barrier-"));
  try {
    for (const parentPid of [1, 2_147_483_647]) {
      const result = probe(join(root, "never-released"), { parentPid });
      assert.equal(result.status, 1);
      assert.equal(result.error, undefined);
      assert.match(result.stderr, /Race coordinator (is unavailable|exited)/u);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("race child exits when its actual coordinator terminates without release", async () => {
  const root = mkdtempSync(join(tmpdir(), "slop-race-barrier-"));
  try {
    const outcome = join(root, "outcome");
    const childSource = `import {writeFileSync} from "node:fs"; import {waitForRaceRelease} from ${JSON.stringify(helper)}; const parentPid=process.ppid; process.send("ready"); try { waitForRaceRelease(${JSON.stringify(join(root, "never-released"))}, {parentPid}); } catch(error) { writeFileSync(${JSON.stringify(outcome)}, error.message); process.exit(0); }`;
    const coordinatorSource = `import {spawn} from "node:child_process"; const child=spawn(process.execPath,["--input-type=module","-e",${JSON.stringify(childSource)}],{stdio:["ignore","inherit","inherit","ipc"]}); child.once("message",()=>process.exit(0));`;
    const result = spawnSync(
      node,
      ["--input-type=module", "-e", coordinatorSource],
      {
        encoding: "utf8",
        timeout: 5_000,
      },
    );
    assert.equal(result.status, 0);
    assert.equal(result.error, undefined);
    const deadline = Date.now() + 5_000;
    while (!existsSync(outcome) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.match(
      readFileSync(outcome, "utf8"),
      /Race coordinator exited before release/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
