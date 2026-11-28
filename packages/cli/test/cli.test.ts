import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { commands, defineCommand, runCli, type CliIo } from "../src/index.ts";

const templateRoot = path.resolve(import.meta.dirname, "../../..");
const mainPath = path.resolve(import.meta.dirname, "../src/main.ts");

function createRecorder(): { readonly io: CliIo; readonly out: () => string; readonly err: () => string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      writeOut: (text) => {
        stdout.push(text);
      },
      writeErr: (text) => {
        stderr.push(text);
      },
    },
    out: () => stdout.join(""),
    err: () => stderr.join(""),
  };
}

function parseJson(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

describe("project CLI", () => {
  test("lists registered commands in human and JSON help output", async () => {
    const human = createRecorder();
    expect(await runCli({ argv: ["--help"], commands, rootDir: templateRoot, cwd: templateRoot, io: human.io })).toBe(0);
    expect(human.out()).toContain("Usage: pnpm cli <command> [options]");
    expect(human.out()).toContain("status");

    const structured = createRecorder();
    expect(await runCli({ argv: ["help", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: structured.io })).toBe(0);
    const helpPayload = parseJson(structured.out()) as {
      readonly ok: boolean;
      readonly command: string;
      readonly data: { readonly commands: readonly { readonly name: string }[] };
    };
    expect(helpPayload.ok).toBe(true);
    expect(helpPayload.command).toBe("help");
    expect(helpPayload.data.commands.map((cmd) => cmd.name)).toEqual(["status", "deploy", "verify-live"]);

    const single = createRecorder();
    expect(await runCli({ argv: ["status", "--help", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: single.io })).toBe(0);
    expect(parseJson(single.out())).toEqual({
      ok: true,
      command: "help",
      data: {
        name: "status",
        summary: "Inspect workspace packages, specs, and generated outputs",
        usage: "pnpm cli status [--package <name|path>] [--json]",
        flags: {
          package: {
            kind: "string",
            short: "p",
            description: "Filter to one workspace package by name or relative path",
          },
        },
      },
    });
  });

  test("status inspects workspace packages and specs and supports filtering", async () => {
    const all = createRecorder();
    expect(await runCli({ argv: ["status", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: all.io })).toBe(0);
    const parsed = parseJson(all.out()) as {
      readonly ok: boolean;
      readonly command: string;
      readonly data: {
        readonly project: string;
        readonly specs: readonly string[];
        readonly packages: readonly { readonly name: string; readonly path: string }[];
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("status");
    expect(parsed.data.specs).toContain("spec/index.md");
    expect(parsed.data.packages.map((pkg) => pkg.name)).toEqual(expect.arrayContaining(["@repo/app", "@repo/backend", "@repo/cli", "@repo/design-system", "@repo/frontend", "@repo/ui"]));

    const filtered = createRecorder();
    expect(await runCli({ argv: ["status", "-p", "@repo/app", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: filtered.io })).toBe(0);
    const filteredParsed = parseJson(filtered.out()) as {
      readonly ok: boolean;
      readonly command: string;
      readonly data: {
        readonly packages: readonly { readonly name: string; readonly path: string }[];
      };
    };
    expect(filteredParsed.ok).toBe(true);
    expect(filteredParsed.command).toBe("status");
    expect(filteredParsed.data.packages.map((pkg) => ({ name: pkg.name, path: pkg.path }))).toEqual([
      { name: "@repo/app", path: "apps/app" },
    ]);

    const missing = createRecorder();
    expect(await runCli({ argv: ["status", "--package", "@repo/missing", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: missing.io })).toBe(1);
    const missingParsed = parseJson(missing.out()) as { readonly ok: boolean; readonly command: string; readonly error: string };
    expect(missingParsed.ok).toBe(false);
    expect(missingParsed.command).toBe("status");
    expect(missingParsed.error).toContain("@repo/missing");
  });

  test("returns exit code 2 on unknown commands and unknown flags", async () => {
    const unknownCmd = createRecorder();
    expect(await runCli({ argv: ["nope"], commands, rootDir: templateRoot, cwd: templateRoot, io: unknownCmd.io })).toBe(2);
    expect(unknownCmd.err()).toContain('Unknown command "nope"');

    const unknownFlag = createRecorder();
    expect(await runCli({ argv: ["status", "--bogus", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: unknownFlag.io })).toBe(2);
    expect(parseJson(unknownFlag.out())).toMatchObject({
      ok: false,
      command: "status",
    });

    const failing = defineCommand({
      name: "boom",
      summary: "Throws at runtime",
      run: () => {
        throw new Error("corrupt state");
      },
    });

    const textFailure = createRecorder();
    expect(await runCli({ argv: ["boom"], commands: [failing], rootDir: templateRoot, cwd: templateRoot, io: textFailure.io })).toBe(1);
    expect(textFailure.err()).toBe("error: corrupt state\n");

    const jsonFailure = createRecorder();
    expect(await runCli({ argv: ["boom", "--json"], commands: [failing], rootDir: templateRoot, cwd: templateRoot, io: jsonFailure.io })).toBe(1);
    expect(parseJson(jsonFailure.out())).toEqual({
      ok: false,
      command: "boom",
      error: "corrupt state",
    });
  });

  test("defineCommand parses typed flags and positionals for custom levers", async () => {
    const custom = defineCommand({
      name: "echo",
      summary: "Echo input",
      flags: {
        upper: { kind: "boolean", short: "u", description: "Uppercase output" },
        prefix: { kind: "string", description: "Prefix text" },
      },
      run: ({ flags, positionals }) => {
        const joined = positionals.join(" ");
        const body = flags.upper ? joined.toUpperCase() : joined;
        const text = flags.prefix ? `${flags.prefix}:${body}` : body;
        return { ok: true, data: { text }, lines: [text] };
      },
    });

    const recorded = createRecorder();
    expect(await runCli({
      argv: ["echo", "-u", "--prefix", "ok", "hello", "world"],
      commands: [custom],
      rootDir: templateRoot,
      cwd: templateRoot,
      io: recorded.io,
    })).toBe(0);
    expect(recorded.out()).toBe("ok:HELLO WORLD\n");
  });

  test("executes directly on Node 26 via src/main.ts", () => {
    const stdout = execFileSync(process.execPath, [mainPath, "status", "--json"], {
      cwd: templateRoot,
      encoding: "utf8",
    });
    const parsed = parseJson(stdout) as {
      readonly ok: boolean;
      readonly command: string;
      readonly data: {
        readonly packages: readonly { readonly name: string }[];
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("status");
    expect(parsed.data.packages.map((pkg) => pkg.name)).toContain("@repo/cli");
  });

  test("deploy rejects incompatible flags and verify-live probes live endpoints with JSON receipts", async () => {
    const conflict = createRecorder();
    expect(
      await runCli({
        argv: ["deploy", "--dry-run", "--destroy", "--json"],
        commands,
        rootDir: templateRoot,
        cwd: templateRoot,
        io: conflict.io,
      }),
    ).toBe(2);

    const missingUrl = createRecorder();
    expect(
      await runCli({
        argv: ["verify-live", "--json"],
        commands,
        rootDir: templateRoot,
        cwd: templateRoot,
        io: missingUrl.io,
      }),
    ).toBe(2);

    const server = createServer((req, res) => {
      if (req.url === "/" || req.url === "/SKILL.md") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("slop.cash ok");
        return;
      }
      if (req.url === "/.well-known/agent-skills/index.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ skills: [] }));
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${String(address.port)}`;

    try {
      const verifyDeploy = createRecorder();
      expect(
        await runCli({
          argv: ["deploy", "--verify", "--url", baseUrl, "--json"],
          commands,
          rootDir: templateRoot,
          cwd: templateRoot,
          io: verifyDeploy.io,
        }),
      ).toBe(0);
      const deployParsed = parseJson(verifyDeploy.out()) as {
        readonly ok: boolean;
        readonly data: { readonly receipt: { readonly ok: boolean; readonly probes: readonly unknown[] } };
      };
      expect(deployParsed.ok).toBe(true);
      expect(deployParsed.data.receipt.ok).toBe(true);
      expect(deployParsed.data.receipt.probes).toHaveLength(2);

      const verifyLive = createRecorder();
      expect(
        await runCli({
          argv: ["verify-live", "--url", baseUrl, "--identity-url", baseUrl, "--json"],
          commands,
          rootDir: templateRoot,
          cwd: templateRoot,
          io: verifyLive.io,
        }),
      ).toBe(0);
      const liveParsed = parseJson(verifyLive.out()) as {
        readonly ok: boolean;
        readonly data: { readonly siteReceipt: { readonly ok: boolean }; readonly identityReceipt: { readonly ok: boolean } };
      };
      expect(liveParsed.ok).toBe(true);
      expect(liveParsed.data.siteReceipt.ok).toBe(true);
      expect(liveParsed.data.identityReceipt.ok).toBe(true);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
