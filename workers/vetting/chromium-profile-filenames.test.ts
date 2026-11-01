import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8: the scan checks for wallet drainers and credential theft.
 * Chromium's password database is the file `Login Data`, and its extension
 * store is the directory `Local Extension Settings`. A high finding stays
 * open after specialist review (`scanProblems`), so a case-insensitive match
 * of ordinary phrases such as "login data" blocks a clean result.
 */
function inspected(files: { path: string; text: string }[]) {
  return inspectRepository({
    files: files.map((file) => ({
      path: file.path,
      bytes: new TextEncoder().encode(file.text),
    })),
  });
}

function described(files: { path: string; text: string }[]) {
  return inspected(files).findings.map(
    (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
  );
}

test("Chromium profile filenames are still theft indicators", () => {
  // Each form has to match on its own. A lowercased Windows path still names
  // the file; a quoted filename and a path segment are the same read.
  for (const [path, text, category] of [
    [
      "src/extensions.py",
      'store = os.path.join(profile, "Local Extension Settings")\n',
      "wallet-drainer",
    ],
    [
      "src/extensions-lower.py",
      "store = os.path.join(profile, 'local extension settings')\n",
      "wallet-drainer",
    ],
    [
      "src/extensions-path.py",
      'store = profile + "/Local Extension Settings/id"\n',
      "wallet-drainer",
    ],
    [
      "src/passwords.py",
      'open(os.path.join(profile, "Default", "Login Data"), "rb")\ntargets = ["Login Data", "Cookies"]\n',
      "credential-theft",
    ],
    [
      "src/passwords-lower.py",
      'open(os.path.join(profile, "login data"), "rb")\n',
      "credential-theft",
    ],
    [
      "src/passwords-path.py",
      'open(profile + "/Default/login data", "rb")\n',
      "credential-theft",
    ],
    [
      "src/passwords-tick.ts",
      "const file = `login data`;\n",
      "credential-theft",
    ],
    // A separator variable, Chromium's account-password file, and a quoted
    // directory with a trailing slash are the same reads. The name only needs
    // filename context on the left.
    [
      "src/passwords-account.py",
      'os.path.join(profile, "Login Data For Account")\n',
      "credential-theft",
    ],
    [
      "src/passwords-sep.py",
      'f"{profile}{os.sep}Login Data"\n',
      "credential-theft",
    ],
    [
      "src/passwords-template.ts",
      "`${profile}${path.sep}Login Data`\n",
      "credential-theft",
    ],
    [
      "src/extensions-slash.py",
      '"Local Extension Settings/" + walletId\n',
      "wallet-drainer",
    ],
  ] as const) {
    expect({ path, findings: described([{ path, text }]) }).toEqual({
      path,
      findings: [`${path}:${category}:high`],
    });
  }
});

test("ordinary login wording is not a Chromium profile read", () => {
  // These sentences use the English phrase, not the on-disk spelling.
  // Base development flags each of them as a high finding.
  const inspection = inspected([
    {
      path: "src/account.ts",
      text: [
        "We store login data for the session only.",
        "Login data is encrypted at rest.",
        "See the local extension settings directory.",
        "const note = read local extension settings from the profile;",
        "export const label = xLocal Extension Settings;",
        'const help = "We store login data for the session only.";',
        'const guide = "See the local extension settings directory for the profile.";',
        "",
      ].join("\n"),
    },
    {
      path: "README.md",
      text: "This project does not collect login data.\n",
    },
  ]);
  expect(
    inspection.findings.map(
      (finding) => `${finding.path}:${finding.category}:${finding.severity}`,
    ),
  ).toEqual([]);
  expect(inspection.checks["credential-theft"]).toBe("passed");
  expect(inspection.checks["wallet-drainer"]).toBe("passed");
});

test("the other key and extension-id indicators still match", () => {
  expect(
    described([
      {
        path: "src/keys.py",
        text: 'open(os.path.expanduser("~/.ssh/id_rsa"))\n',
      },
      {
        path: "src/metamask.py",
        text: 'dir = profile + "/nkbihfbeogaeaoehlefnkodbefgpgknn"\n',
      },
    ]),
  ).toEqual([
    "src/keys.py:credential-theft:high",
    "src/metamask.py:wallet-drainer:high",
  ]);
});
