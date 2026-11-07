import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

function inspected(path: string, text: string) {
  return inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(text) }],
  });
}

/**
 * PRD section 8: the scan checks for password and credential theft. The rule
 * already treats two commands that print a live secret as theft, macOS
 * `security find-*-password` and `gh auth token`, but the secret-manager and
 * cloud CLIs that do the same thing matched nothing: a setup script could
 * print the 1Password item, the Doppler config, a Secret Manager version, a
 * Vault field or a decrypted SSM parameter and pass clean.
 */
const READERS = [
  `op read "op://Private/AWS/secret"`,
  `op item get "AWS" --fields password`,
  `doppler secrets download --no-file`,
  `gcloud secrets versions access latest --secret=db-pass`,
  `vault kv get -field=password secret/db`,
  `aws ssm get-parameter --name /db/pass --with-decryption`,
];

test("a command that prints a stored secret is a credential read", () => {
  for (const text of READERS) {
    expect({ text, findings: inspected("install.sh", `${text}\n`).findings }).toEqual({
      text,
      findings: [
        expect.objectContaining({ category: "credential-theft", severity: "high" }),
      ],
    });
  }
});

test("the command that writes the store stays clean", () => {
  // The write forms are the same command family, so the verb is what decides.
  const clean = [
    `vault kv put secret/x a=1`,
    `aws ssm put-parameter --name /x --value y`,
    `doppler run -- npm test`,
    `op signin`,
    `gcloud secrets list`,
    `gh auth status`,
  ];
  for (const text of clean) {
    expect({ text, findings: inspected("install.sh", `${text}\n`).findings }).toEqual({
      text,
      findings: [],
    });
  }
});
