/** Linux SDK qualification with pinned public objects; no assessment/journal. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [origin, output] = process.argv.slice(2);
assert.equal(process.platform, "linux", "This proof requires native Linux");
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
assert(output, "Provide a safe result path");
const fixture = JSON.parse(
  await readFile(
    new URL(
      "../tests/fixtures/value-merge-network-97-117.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const directory = await mkdtemp(join(tmpdir(), "slop-fixed-merge-sdk-"));
const report = {
  status: "failed",
  platform: process.platform,
  actualNamedMergeVerifier: true,
  actualSdk: true,
  assessmentImported: false,
  syntheticRole: true,
  cases: [],
};
const env = {
  PATH: process.env.PATH,
  HOME: directory,
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_AUTHOR_NAME: "Harmless size control",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Harmless size control",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
};
function git(args, input) {
  try {
    return execFileSync(
      "git",
      [
        "-c",
        "credential.helper=",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "http.followRedirects=false",
        "-c",
        "fetch.fsckObjects=true",
        "-C",
        directory,
        ...args,
      ],
      {
        env,
        input,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
  } catch {
    throw new Error("Public fixture Git command refused");
  }
}
const control = (inputs) => ({
  schema: "public-merge-control-not-an-assessment",
  inputs,
});
async function send(name, inputs, bundle, expected) {
  const form = new FormData();
  form.append(
    "envelope",
    new Blob([JSON.stringify(control(inputs))], { type: "application/json" }),
    "control.json",
  );
  form.append("bundle", new Blob([bundle]), "public.bundle");
  const started = performance.now();
  const response = await fetch(`${origin}/api/v1/slopbot/value-import`, {
    method: "POST",
    headers: { origin, "x-fixture-actor": "fixture-admin" },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  report.cases.push({
    name,
    status: response.status,
    expected,
    elapsedMs: Math.round(performance.now() - started),
  });
  assert.equal(response.status, expected, name);
  const result = await response.json();
  if (expected === 200) {
    assert.equal(result.recordDigest, "test-only-no-journal");
    assert.equal(result.sequence, 0);
    assert.equal(result.destroyAcknowledged, true);
    assert.deepEqual(
      result.results,
      fixture.sources.map((source) => ({
        inputSha256: source.inputSha256,
        resolutions: source.expected,
      })),
    );
  } else
    assert.equal(
      result.error,
      expected === 400 ? "invalid_request" : "assessment_not_published",
    );
}
try {
  git(["init", "--bare", "--template="]);
  git([
    "fetch",
    "--no-tags",
    "--no-recurse-submodules",
    fixture.repository,
    ...fixture.sources.map(
      (source) =>
        `${source.input.pull.head.sha}:refs/heads/pr-${source.number}`,
    ),
  ]);
  const file = join(directory, "public.bundle");
  git(["bundle", "create", file, "--all"]);
  git(["bundle", "verify", file]);
  const bundle = await readFile(file);
  assert(bundle.length > 24_000_000 && bundle.length < 25 * 1024 * 1024);
  report.bundle = { bytes: bundle.length, sha256: sha(bundle) };
  report.gitVersion = fixture.gitVersion;
  const inputs = fixture.sources.map((source) => source.input);
  await send("complete-public-merge", inputs, bundle, 200);
  await send("fresh-sandbox-repeat", inputs, bundle, 200);
  await send(
    "corrupt-bundle",
    inputs,
    new TextEncoder().encode("not a Git bundle"),
    409,
  );
  const parents = structuredClone(inputs);
  parents[1].commits
    .find((commit) => commit.parents.length === 2)
    .parents.reverse();
  await send("wrong-ordered-parents", parents, bundle, 409);
  const paths = structuredClone(inputs);
  paths[1].commitAttribution
    .find((commit) => commit.changedPaths.length)
    .changedPaths.pop();
  await send("omitted-ordinary-path", paths, bundle, 409);
  await send(
    "unchanged-25MiB-request-bound",
    inputs,
    new Uint8Array(25 * 1024 * 1024),
    400,
  );

  // Add one harmless unreachable-by-input object graph. Both genuine heads
  // remain intact, but its expanded objects exceed the fixed operation bound.
  const large = join(directory, "size-control");
  const handle = await open(large, "wx");
  try {
    await handle.truncate(128 * 1024 * 1024);
  } finally {
    await handle.close();
  }
  const blob = git(["hash-object", "-w", large]);
  const tree = git(["mktree"], `100644 blob ${blob}\tpublic-size-control\n`);
  const commit = git(["commit-tree", tree], "Harmless expanded-size control\n");
  git(["update-ref", "refs/heads/size-control", commit]);
  await rm(large);
  const expanded = git([
    "cat-file",
    "--batch-all-objects",
    "--batch-check=%(objectsize)",
  ])
    .split("\n")
    .reduce((sum, value) => sum + Number(value), 0);
  assert(expanded > 256 * 1024 * 1024);
  const oversizedFile = join(directory, "expanded.bundle");
  git(["bundle", "create", oversizedFile, "--all"]);
  const oversized = await readFile(oversizedFile);
  assert(oversized.length < 25 * 1024 * 1024);
  await send("expanded-object-bound", inputs, oversized, 409);
  report.expandedControl = {
    bundleBytes: oversized.length,
    expandedObjectBytes: expanded,
  };
  report.status = "passed";
} finally {
  await rm(directory, { recursive: true, force: true });
  report.hostTemporaryDirectoryRemoved = true;
  report.cleanupBoundary =
    "Each successful response follows actual MergeVerifier sandbox.destroy acknowledgement; this is not proof of hosted VM erasure.";
  report.capacityBoundary =
    "Local Linux SDK/container operation, not deployed Worker per-isolate memory qualification.";
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}
