import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PAYMENT_REPOSITORY,
  reservationGithub,
} from "./payment-reservation-history";
export function assertAdmissionReceipt(
  value: unknown,
  expected: {
    base: string;
    head: string;
    number: number;
    runId: number;
    attempt: number;
  },
) {
  const r = value as Record<string, unknown>;
  if (
    !r ||
    Object.keys(r).sort().join() !== "attempt,base,head,number,runId" ||
    Object.entries(expected).some(([k, v]) => r[k] !== v)
  )
    throw new TypeError(
      "Workflow admission receipt differs from exact PR inputs",
    );
}
export function verifyReceipt(
  runId: number,
  expected: Parameters<typeof assertAdmissionReceipt>[1],
) {
  const response = reservationGithub(
    `repos/${PAYMENT_REPOSITORY}/actions/runs/${runId}/artifacts?per_page=100`,
  ) as {
    total_count?: number;
    artifacts?: {
      id: number;
      name: string;
      expired: boolean;
      size_in_bytes: number;
      digest: string;
    }[];
  };
  if ((response.total_count ?? 101) > 100 || !Array.isArray(response.artifacts))
    throw new TypeError("Incomplete admission artifact inventory");
  const artifacts = response.artifacts.filter(
    (a) => a.name === `payment-admission-${expected.attempt}` && !a.expired,
  );
  if (
    artifacts.length !== 1 ||
    artifacts[0].size_in_bytes > 65536 ||
    !/^sha256:[a-f0-9]{64}$/u.test(artifacts[0].digest)
  )
    throw new TypeError(
      "Exact nonexpired trusted admission receipt is required",
    );
  const archive = execFileSync(
    "gh",
    [
      "api",
      `repos/${PAYMENT_REPOSITORY}/actions/artifacts/${artifacts[0].id}/zip`,
    ],
    { timeout: 30000, maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (
    `sha256:${createHash("sha256").update(archive).digest("hex")}` !==
    artifacts[0].digest
  )
    throw new TypeError("Admission artifact digest mismatch");
  const dir = mkdtempSync(join(tmpdir(), "slop-admission-"));
  try {
    const path = join(dir, "receipt.zip");
    writeFileSync(path, archive, { mode: 0o600 });
    const names = execFileSync("unzip", ["-Z1", path], { maxBuffer: 4096 })
      .toString()
      .trim();
    if (names !== "payment-admission.json")
      throw new TypeError("Unexpected admission archive members");
    const bytes = execFileSync(
      "unzip",
      ["-p", path, "payment-admission.json"],
      { maxBuffer: 4096, timeout: 5000 },
    );
    assertAdmissionReceipt(JSON.parse(bytes.toString()), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
