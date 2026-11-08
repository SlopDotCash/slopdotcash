import { describe, expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8: the admission scan must report a download that the install
 * executes. `docker run` pulls an image from a registry and starts its
 * entrypoint, usually with the repository mounted, so the install executes
 * bytes the scan never acquires. The result used to be clean with the
 * `downloads` surface at zero.
 *
 * `docker build` and `docker compose up` execute a definition that is already
 * an install surface (the Dockerfile or the compose file), so they stay out.
 * `container run` is the long spelling and podman takes the same flags.
 */

const findingsOf = (path: string, body: string) =>
  inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(body) }],
  }).findings.map((finding) => `${finding.category}:${finding.severity}`);

const RUNS = "unsafe-execution:high";

describe("a container image run during install", () => {
  test("a mounted docker run in a setup script is reported", () => {
    expect(
      findingsOf(
        "setup.sh",
        '#!/bin/sh\ndocker run --rm -v "$PWD":/w -w /w node:20 sh -c "npm ci"\n',
      ),
    ).toEqual([RUNS]);
  });

  test("the script of the image is enough, without a shell", () => {
    expect(
      findingsOf(
        "scripts/bootstrap",
        "#!/bin/sh\ndocker run --rm img:1 ./install\n",
      ),
    ).toEqual([RUNS]);
  });

  test("podman, the long spelling and an absolute path are the same act", () => {
    for (const line of [
      "podman run --rm img:1 ./install\n",
      "docker container run --rm img:1 ./install\n",
      "/usr/bin/docker run --rm img:1 ./install\n",
      // The command token can be quoted, carry the Windows suffix or be the
      // legacy compose binary; the boundary character is the quote itself.
      '"docker" run --rm img:1 ./install\n',
      "docker.exe run --rm img:1 ./install\n",
      "docker-compose run web ./install\n",
      // Compose V2 spells the same act with a space, and nerdctl is a third
      // Docker-compatible CLI with the same shapes.
      "docker compose run web ./install\n",
      "podman compose run web ./install\n",
      "nerdctl run --rm img:1 ./install\n",
      "nerdctl compose run web ./install\n",
    ])
      expect(findingsOf("setup.sh", `#!/bin/sh\n${line}`)).toEqual([RUNS]);
  });

  // The CLI takes global flags before the subcommand, and a flag may carry a
  // value. One flag in between must not hide the run.
  test("global flags between the binary and the subcommand are skipped", () => {
    for (const line of [
      "docker -D run --rm img:1 ./install\n",
      "docker --log-level debug run --rm img:1 ./install\n",
      "docker --config /tmp/cfg run --rm img:1 ./install\n",
      "docker -H unix:///var/run/docker.sock run --rm img:1 ./install\n",
      "docker compose --profile x run web ./install\n",
    ])
      expect(findingsOf("setup.sh", `#!/bin/sh\n${line}`)).toEqual([RUNS]);
  });

  // `--config` takes a value, and here the value is spelled `run`. The bare
  // command runs nothing, but the rule has no way to tell the value from the
  // subcommand, so it reports and lets the reader look.
  test("a value spelled like the subcommand is still reported", () => {
    expect(findingsOf("setup.sh", "#!/bin/sh\ndocker --config run\n")).toEqual([
      RUNS,
    ]);
  });

  test("sudo and an environment assignment do not hide it", () => {
    for (const line of [
      "sudo docker run --rm img:1 ./install\n",
      "sudo -u bob docker run --rm img:1 ./install\n",
      "env DOCKER_BUILDKIT=1 docker run --rm img:1 ./install\n",
      "FOO=1 docker run --rm img:1 ./install\n",
    ])
      expect(findingsOf("setup.sh", `#!/bin/sh\n${line}`)).toEqual([RUNS]);
  });

  // A shell line continuation can split the command anywhere. The pipe rule
  // already reads `\` plus newline, so the container rule does the same.
  test("a line continuation does not break the command", () => {
    for (const line of [
      "docker \\\n  run --rm img:1 ./install\n",
      "docker \\\n  --config /tmp/cfg \\\n  run --rm img:1 ./install\n",
      "docker \\\n  compose run web ./install\n",
      "docker compose \\\n  run web ./install\n",
    ])
      expect(findingsOf("setup.sh", `#!/bin/sh\n${line}`)).toEqual([RUNS]);
  });

  test("a continued command that is not a run stays clean", () => {
    for (const line of [
      "docker \\\n  ps\n",
      "docker \\\n  build -t app .\n",
      "docker compose \\\n  up -d\n",
    ])
      expect(findingsOf("setup.sh", `#!/bin/sh\n${line}`)).toEqual([]);
  });

  // A manifest is read twice, as the file and as its extracted scripts, so the
  // same act is reported on both items. `curl | sh` in a hook already does this.
  test("an install hook in a manifest is read the same way", () => {
    expect(
      findingsOf(
        "package.json",
        '{"scripts":{"postinstall":"docker run --rm img:1 ./install"}}',
      ),
    ).toEqual([RUNS, RUNS]);
  });
});

describe("container commands that stay clean", () => {
  test("build, compose, inspection and pruning are not a run", () => {
    for (const line of [
      "docker build -t app .\n",
      "docker compose up -d\n",
      "docker compose down\n",
      "docker compose config\n",
      "docker compose logs -f\n",
      "docker container create img:1\n",
      "docker ps\n",
      "docker --version\n",
      "docker --debug ps\n",
      "docker system prune -f\n",
      "mydocker run --rm img:1 ./install\n",
      "dockerrun --rm img:1 ./install\n",
      "docker runner\n",
      // A subcommand that only takes the word as an argument is not a run.
      "docker context use run\n",
    ])
      expect(findingsOf("setup.sh", `#!/bin/sh\n${line}`)).toEqual([]);
  });

  test("an empty script is clean", () => {
    expect(findingsOf("setup.sh", "#!/bin/sh\n")).toEqual([]);
  });

  test("a Dockerfile RUN is the Dockerfile surface, not a container run", () => {
    expect(findingsOf("Dockerfile", "FROM node:20\nRUN npm ci\n")).toEqual([]);
  });
});
