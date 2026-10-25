/** Explicit build setup; the Points consumer never downloads an executable. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { MERGE_GIT_VERSION } from "../workers/slopbot/value-merge-profile";

const [destination, ...extra] = process.argv.slice(2);
if (!destination || !isAbsolute(destination) || extra.length)
  throw new Error("Provide one absolute installation directory");
const source = "https://www.kernel.org/pub/software/scm/git/git-2.56.0.tar.xz";
const expected =
  "26c56c296b38c0695b26fa95f475f1d01704d2d38e73465ca30b0b2f5dc789d3";
// Refuse to adopt or overwrite a prior partial/unknown installation.
await mkdir(destination, { recursive: false });
const directory = await mkdtemp(join(tmpdir(), "slop-merge-git-build-"));
try {
  const response = await fetch(source, {
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error("Pinned Git archive unavailable");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw new Error("Pinned Git archive checksum mismatch");
  const archive = join(directory, "git.tar.xz");
  await writeFile(archive, bytes, { flag: "wx" });
  const env = { PATH: process.env.PATH, HOME: directory, LC_ALL: "C" };
  execFileSync(
    "tar",
    ["-xJf", archive, "--strip-components=1", "-C", directory],
    { env, stdio: "inherit" },
  );
  // HTTPS support is needed for the consumer's fixed public-object fetch.
  // The container build omits it because that operation has no network.
  execFileSync(
    "make",
    [
      "-C",
      directory,
      "-j2",
      `prefix=${destination}`,
      "NO_GETTEXT=YesPlease",
      "NO_TCLTK=YesPlease",
      "NO_PERL=YesPlease",
      "install",
    ],
    { env, stdio: "inherit", timeout: 600_000 },
  );
  const version = execFileSync(join(destination, "bin/git"), ["--version"], {
    env,
    encoding: "utf8",
  }).trim();
  if (version !== MERGE_GIT_VERSION)
    throw new Error("Built Git version differs from merge profile");
  await writeFile(
    join(destination, "source.json"),
    `${JSON.stringify({ source, sha256: expected, version })}\n`,
    { flag: "wx" },
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
