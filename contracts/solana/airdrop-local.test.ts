import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { airdropLocalPayer } from "./scripts/airdrop-local.mjs";

const cli = fileURLToPath(
  new URL("./scripts/airdrop-local.mjs", import.meta.url),
);
const node = execFileSync("which", ["node"], { encoding: "utf8" }).trim();

function fixture(body: string) {
  const cwd = mkdtempSync(join(tmpdir(), "slop-airdrop-"));
  const bin = join(cwd, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "solana"), `#!${node}\n${body}\n`);
  chmodSync(join(bin, "solana"), 0o755);
  const env = {
    PATH: `${bin}:${dirname(node)}:/usr/bin:/bin`,
    ANCHOR_PROVIDER_URL: "http://127.0.0.1:18899",
    ANCHOR_WALLET: join(cwd, "unused-payer.json"),
  };
  return {
    cwd,
    env,
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

test("local airdrop keeps the exact amount, URL and keypair arguments and captures output", async () => {
  const f = fixture(
    `require('node:fs').writeFileSync('arguments.json', JSON.stringify(process.argv.slice(2))); console.log('private response');`,
  );
  try {
    const result = await airdropLocalPayer(f);
    expect(result.status).toBe(0);
    expect(result.commandExitCode).toBe(0);
    expect(result.commandSignal).toBeNull();
    expect(
      JSON.parse(readFileSync(join(f.cwd, "arguments.json"), "utf8")),
    ).toEqual([
      "--url",
      f.env.ANCHOR_PROVIDER_URL,
      "airdrop",
      "100",
      "--keypair",
      f.env.ANCHOR_WALLET,
    ]);
    expect(readFileSync(result.log, "utf8")).toBe("private response\n");
  } finally {
    f.cleanup();
  }
});

test("local airdrop preserves failure status and collects diagnostics before returning", () => {
  const f = fixture("console.error('private failure'); process.exit(37);");
  mkdirSync(join(f.cwd, "scripts"));
  writeFileSync(
    join(f.cwd, "scripts", "failure-evidence.mjs"),
    `
    import { readFileSync, writeFileSync } from 'node:fs';
    const [log, code] = process.argv.slice(2);
    if (!readFileSync(log, 'utf8').includes('private failure')) process.exit(2);
    writeFileSync('diagnostics.json', JSON.stringify({ code }));
  `,
  );
  try {
    let failure: { status: number; stdout: Buffer; stderr: Buffer } | undefined;
    try {
      execFileSync(node, [cli], { cwd: f.cwd, env: f.env, timeout: 5000 });
    } catch (error) {
      failure = error as typeof failure;
    }
    expect(failure?.status).toBe(37);
    expect(failure?.stdout.toString()).not.toContain("private failure");
    expect(failure?.stderr.toString()).not.toContain("private failure");
    expect(
      JSON.parse(readFileSync(join(f.cwd, "diagnostics.json"), "utf8")),
    ).toEqual({ code: "37" });
  } finally {
    f.cleanup();
  }
});

test("local airdrop terminates a hung child that ignores TERM before returning failure", async () => {
  const f = fixture(`
    const fs = require('node:fs');
    fs.writeFileSync('child.pid', String(process.pid));
    process.on('SIGTERM', () => fs.writeFileSync('term-received', 'yes'));
    setInterval(() => {}, 1000);
  `);
  try {
    const result = await airdropLocalPayer({
      ...f,
      timeoutMs: 1000,
      interruptGraceMs: 100,
    });
    expect(result.status).toBe(1);
    expect(result.commandSignal).toBe("SIGKILL");
    expect(readFileSync(join(f.cwd, "term-received"), "utf8")).toBe("yes");
    const pid = Number(readFileSync(join(f.cwd, "child.pid"), "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
    expect(readFileSync(result.log, "utf8")).toContain(
      "exceeded the 1000ms phase deadline",
    );
  } finally {
    f.cleanup();
  }
});
