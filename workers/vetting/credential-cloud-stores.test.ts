import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

/**
 * PRD section 8: the scan checks for password and credential theft. The rule
 * named the SSH, AWS, GitHub CLI and package-manager stores, and stopped
 * there, so a setup script that reads a cloud token file was clean: the
 * Google ADC refresh token, the Terraform Cloud API token, the Vault token,
 * the Azure CLI token cache and the rclone remote config all matched nothing.
 * Each one is a long-lived credential for a whole account, not a per-project
 * value, so a theft finding is the same act the rule already reports for
 * `~/.aws/credentials`.
 */
const CLOUD_STORES: [string, string][] = [
  ["src/gcloud.py", `open(os.path.expanduser("~/.config/gcloud/application_default_credentials.json"))`],
  ["src/terraform.py", `open(os.path.expanduser("~/.terraform.d/credentials.tfrc.json"))`],
  ["src/vault.py", `open(os.path.expanduser("~/.vault-token")).read()`],
  ["src/azure.py", `open(os.path.expanduser("~/.azure/accessTokens.json"))`],
  ["src/rclone.py", `open(os.path.expanduser("~/.config/rclone/rclone.conf"))`],
];

test("a cloud credential store is a high credential-theft indicator", () => {
  for (const [path, text] of CLOUD_STORES) {
    expect({ path, findings: inspected(path, `${text}\n`).findings }).toEqual({
      path,
      findings: [
        expect.objectContaining({
          path,
          category: "credential-theft",
          severity: "high",
        }),
      ],
    });
  }
});

test("the cloud stores are also found through a Windows path", () => {
  // The separator form is the same one the store rule already uses: a drive
  // letter and the user-profile variable reach the same file.
  const payloads = [
    `open("C:\\\\Users\\\\me\\\\.config\\\\gcloud\\\\application_default_credentials.json")`,
    `Get-Content "$env:USERPROFILE\\\\.terraform.d\\\\credentials.tfrc.json"`,
    `type %USERPROFILE%\\\\.azure\\\\accessTokens.json`,
  ];
  for (const text of payloads) {
    expect({ text, findings: inspected("src/win.ps1", `${text}\n`).findings }).toEqual({
      text,
      findings: [expect.objectContaining({ category: "credential-theft" })],
    });
  }
});

test("a database password file is a medium indicator", () => {
  // Both files hold a password next to the host, so they are the same class
  // as the registry token files the medium rule already names.
  for (const text of [
    `open(os.path.expanduser("~/.pgpass"))`,
    `open(os.path.expanduser("~/.my.cnf"))`,
  ]) {
    expect({ text, findings: inspected("src/db.py", `${text}\n`).findings }).toEqual({
      text,
      findings: [
        expect.objectContaining({ category: "credential-theft", severity: "medium" }),
      ],
    });
  }
});

test("a bare file name without its store directory stays clean", () => {
  // These names are common enough that the directory is what identifies the
  // store; without it the model review is not worth the escalation.
  const clean = [
    `open("application_default_credentials.json")`,
    `open("credentials.tfrc.json")`,
    `open("config/rclone.conf.example")`,
    `print("Set VAULT_ADDR in the environment")`,
    `print("See the docs for the token")`,
  ];
  for (const text of clean) {
    expect({ text, findings: inspected("src/clean.py", `${text}\n`).findings }).toEqual({
      text,
      findings: [],
    });
  }
});
