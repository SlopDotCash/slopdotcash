import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type DisabledPrivateIntakeAttestation,
  isDisabledPrivateIntakeAttestation,
  PRIVATE_INTAKE_ATTESTATION_PATH,
  type PrivateIntakeAttestation,
  parsePrivateIntakeAttestation,
} from "../src/lib/private-intake-attestation";

const STATUS_URL =
  "https://api.github.com/repos/SlopDotCash/slopdotcash/private-vulnerability-reporting";
const outputPath = resolve(`public${PRIVATE_INTAKE_ATTESTATION_PATH}`);
const disabled: DisabledPrivateIntakeAttestation = {
  enabled: false,
  source: "build-unverified",
  verifiedAt: null,
  revision: null,
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeAttestation(
  value: PrivateIntakeAttestation | DisabledPrivateIntakeAttestation,
): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(temporary, outputPath);
}

async function prepareLive(): Promise<void> {
  const revision = process.env.GITHUB_SHA ?? "";
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
  if (!/^[0-9a-f]{40}$/u.test(revision) || token.length < 1) {
    throw new Error("GITHUB_SHA and the Actions GITHUB_TOKEN are required");
  }
  const response = await fetch(STATUS_URL, {
    method: "GET",
    redirect: "error",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "slop-build-private-intake-verifier",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  const source = await response.text();
  if (new TextEncoder().encode(source).byteLength > 65_536) {
    throw new Error("GitHub response exceeded 65536 bytes");
  }
  const value = JSON.parse(source) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["enabled"]) ||
    (value as { enabled?: unknown }).enabled !== true
  ) {
    throw new Error("GitHub public private-request intake is not enabled");
  }
  const attestation: PrivateIntakeAttestation = {
    enabled: true,
    source: "github-public-status",
    verifiedAt: new Date().toISOString(),
    revision,
  };
  writeAttestation(attestation);
  console.log(`[Slop] verified private intake for ${revision.slice(0, 12)}`);
}

function ensureDisabled(): void {
  if (existsSync(outputPath)) {
    const value = readJson(outputPath);
    if (
      parsePrivateIntakeAttestation(value) !== null ||
      isDisabledPrivateIntakeAttestation(value)
    ) {
      return;
    }
    throw new Error("Existing private intake attestation is invalid");
  }
  writeAttestation(disabled);
}

function checkAttestation(path: string): void {
  const value = readJson(resolve(path));
  const attestation = parsePrivateIntakeAttestation(value);
  if (attestation === null) {
    throw new Error("Private intake attestation is invalid or stale");
  }
  const expectedRevision = process.env.GITHUB_SHA;
  if (
    expectedRevision !== undefined &&
    attestation.revision !== expectedRevision
  ) {
    throw new Error(
      `Private intake attestation revision ${attestation.revision} does not match ${expectedRevision}`,
    );
  }
}

const [mode, argument] = process.argv.slice(2);
if (mode === "--ensure-disabled") {
  ensureDisabled();
} else if (mode === "--check" && argument !== undefined) {
  checkAttestation(argument);
} else if (mode === undefined) {
  await prepareLive();
} else {
  throw new Error(
    "Usage: prepare-private-intake-attestation.ts [--ensure-disabled | --check <path>]",
  );
}
