import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8: the scan checks for wallet drainers and credential theft.
 *
 * A credential store is named by its path, and the same path is spelled more
 * than one way: a forward slash on POSIX, a backslash on Windows, and one
 * argument per component when it is assembled with a path builder. Only the
 * spelling differs, so a rule that matches one form and not another depends on
 * which machine the scanned script was written on, not on what the script
 * does.
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
