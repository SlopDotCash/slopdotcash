/** Actual retained outputs only. Local authority is synthetic; runtime evidence is replayed. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectD1Database } from "../backend/projects/cloudflare-persistence";
import {
  EVIDENCE_CHUNK_BYTES,
  evidenceLocation,
} from "../backend/vetting/evidence-chunks";
import { enlargeText } from "../tests/text-size";
import {
  EVIDENCE_OWNER_GITHUB_ID,
  localVettingEvidence,
} from "../tests/vetting-evidence-fixture";
import { assembleEvidence } from "../workers/vetting/assembly";
import { parseAssemblyManifest } from "../workers/vetting/assembly-manifest";

const digest = (body: Uint8Array | string) =>
  createHash("sha256").update(body).digest("hex");

export async function retainActualAssembly(input: {
  db: ProjectD1Database;
  now: () => Date;
  retained?: Awaited<ReturnType<typeof localVettingEvidence>>;
  acquisitionDirectory: string;
  artifactDirectory: string;
  vmDirectory: string;
  guestProfile: string;
  dependencyDirectory: string;
  outputDirectory: string;
  provenanceDirectory?: string;
}) {
  const artifactInventories = await Promise.all(
    (await readdir(join(input.acquisitionDirectory, "objects"))).map(
      async (sourceSha256) => {
        const path = join(input.artifactDirectory, `${sourceSha256}.json`);
        return { sourceSha256, path, sha256: digest(await readFile(path)) };
      },
    ),
  );
  const assembled = await assembleEvidence({
    acquisitionDirectory: input.acquisitionDirectory,
    queuedInputsSha256: digest(
      await readFile(join(input.acquisitionDirectory, "queued-inputs.json")),
    ),
    artifactInventories,
    vmEvidence: {
      directory: input.vmDirectory,
      sha256: digest(await readFile(join(input.vmDirectory, "evidence.json"))),
    },
    guestEvidence: {
      profilePath: input.guestProfile,
      profileSha256: digest(await readFile(input.guestProfile)),
      collectorSha256: digest(
        await readFile(new URL("../workers/vetting/guest.py", import.meta.url)),
      ),
      receiptSha256: digest(
        await readFile(join(input.vmDirectory, "guest-source-evidence.json")),
      ),
    },
    dependencyEvidence: {
      directory: input.dependencyDirectory,
      inventorySha256: digest(
        await readFile(join(input.dependencyDirectory, "inventory.json")),
      ),
      profileSha256: digest(
        await readFile(join(input.dependencyDirectory, "profile.json")),
      ),
    },
    provenanceEvidence: input.provenanceDirectory
      ? {
          directory: input.provenanceDirectory,
          reportSha256: digest(
            await readFile(join(input.provenanceDirectory, "report.json")),
          ),
        }
      : undefined,
    outputDirectory: input.outputDirectory,
  });
  const manifestBytes = await readFile(
    join(assembled.directory, "manifest.json"),
  );
  const manifest = parseAssemblyManifest(
    JSON.parse(manifestBytes.toString("utf8")),
  );
  assert.equal(digest(manifestBytes), assembled.manifestSha256);
  assert.equal(manifest.state, "incomplete");
  assert.equal(manifest.providerCallsAuthorized, false);
  assert.equal(manifest.publicationAuthorized, false);
  const needed = new Set([
    assembled.manifestSha256,
    manifest.reviewInputSha256,
    ...manifest.files.map((file) => file.sha256),
  ]);
  const candidates = new Map<string, Buffer>();
  async function collect(path: string) {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const entry of await readdir(path, { withFileTypes: true }))
        if (!entry.isSymbolicLink()) await collect(join(path, entry.name));
    } else if (info.isFile() && info.size <= 32 * 1024 * 1024) {
      const bytes = await readFile(path);
      const sha = digest(bytes);
      if (needed.has(sha)) candidates.set(sha, bytes);
    }
  }
  for (const path of [
    input.acquisitionDirectory,
    input.artifactDirectory,
    input.vmDirectory,
    input.guestProfile,
    input.dependencyDirectory,
    assembled.directory,
  ])
    await collect(path);
  if (input.provenanceDirectory) await collect(input.provenanceDirectory);
  // Review items are exact canonical text bytes, not generated replacement evidence.
  const review = JSON.parse(
    (await readFile(join(assembled.directory, "review-input.json"))).toString(
      "utf8",
    ),
  );
  for (const item of review.items) {
    const bytes = Buffer.from(item.text, "utf8");
    assert.equal(digest(bytes), item.sha256);
    if (needed.has(item.sha256)) candidates.set(item.sha256, bytes);
  }
  for (const sha of needed)
    assert.ok(
      candidates.has(sha),
      `Actual captured object unavailable: ${sha}`,
    );
  for (const file of manifest.files)
    assert.equal(candidates.get(file.sha256)!.length, file.bytes);
  const retained =
    input.retained ?? (await localVettingEvidence(input.db, input.now));
  const traceSha256 = manifest.files.find(
    (file) => file.role === "untrusted-trace",
  )!.sha256;
  const objects = [...candidates].map(([sha256, bytes]) => {
    const chunks = [];
    if (bytes.length > EVIDENCE_CHUNK_BYTES)
      for (
        let offset = 0;
        offset < bytes.length;
        offset += EVIDENCE_CHUNK_BYTES
      ) {
        const part = bytes.subarray(offset, offset + EVIDENCE_CHUNK_BYTES);
        chunks.push({
          index: chunks.length,
          sha256: digest(part),
          sizeBytes: part.length,
        });
      }
    return {
      sha256,
      sizeBytes: bytes.length,
      kind:
        sha256 === traceSha256
          ? "trace"
          : sha256 === assembled.manifestSha256
            ? "manifest"
            : "artifact",
      label:
        sha256 === assembled.manifestSha256
          ? "Canonical captured assembly"
          : `Captured object ${sha256.slice(0, 12)}`,
      contentType: "application/octet-stream",
      ...(chunks.length ? { chunks } : {}),
    };
  });
  const assessmentId = manifest.assessment.assessmentId;
  const runId = "retained-assembly";
  const path = `/api/v1/vetting/evidence/${assessmentId}/${runId}`;
  async function send(
    method: string,
    route: string,
    body: string | Uint8Array,
  ) {
    const response = await retained.evidence.handle(
      await retained.request(method, route, body),
    );
    assert.ok(
      response?.ok,
      `${method} retained evidence failed ${response?.status}: ${await response?.text()}`,
    );
    return response;
  }
  await send(
    "POST",
    path,
    JSON.stringify({
      assemblySha256: assembled.manifestSha256,
      traceSha256,
      objects,
    }),
  );
  await assert.rejects(retained.evidence.assemblyClosure(assessmentId, runId));
  for (const object of objects) {
    const bytes = candidates.get(object.sha256)!;
    if (object.chunks) {
      for (const chunk of object.chunks)
        await send(
          "PUT",
          `${path}/${object.sha256}/chunks/${chunk.index}`,
          bytes.subarray(
            chunk.index * EVIDENCE_CHUNK_BYTES,
            chunk.index * EVIDENCE_CHUNK_BYTES + chunk.sizeBytes,
          ),
        );
      await send("POST", `${path}/${object.sha256}/finalize`, "{}");
    } else await send("PUT", `${path}/${object.sha256}`, bytes);
  }
  const closure = await retained.evidence.assemblyClosure(assessmentId, runId);
  assert.equal(closure.retained, true);
  assert.equal(closure.state, "incomplete");
  assert.equal(closure.providerCallsAuthorized, false);
  assert.equal(closure.publicationAuthorized, false);
  assert.deepEqual(closure.visibilityGaps, manifest.visibilityGaps);
  const omitted = manifest.files.find(
    (file) => file.role === "source-inventory",
  )!;
  const missingPath = `/api/v1/vetting/evidence/${assessmentId}/missing-reference`;
  await send(
    "POST",
    missingPath,
    JSON.stringify({
      assemblySha256: assembled.manifestSha256,
      traceSha256,
      objects: objects.filter((object) => object.sha256 !== omitted.sha256),
    }),
  );
  await send(
    "PUT",
    `${missingPath}/${assembled.manifestSha256}`,
    manifestBytes,
  );
  await assert.rejects(
    retained.evidence.assemblyClosure(assessmentId, "missing-reference"),
    /canonical assembly reference is absent|Source and release comparison does not bind retained inputs/i,
  );
  const changedAssembly = Buffer.from(
    JSON.stringify({
      ...manifest,
      assessment: { ...manifest.assessment, projectId: "different-project" },
    }),
  );
  const changedSha = digest(changedAssembly);
  const wrongPath = `/api/v1/vetting/evidence/${assessmentId}/wrong-assessment`;
  await send(
    "POST",
    wrongPath,
    JSON.stringify({
      assemblySha256: changedSha,
      traceSha256,
      objects: [
        ...objects.filter(
          (object) => object.sha256 !== assembled.manifestSha256,
        ),
        {
          sha256: changedSha,
          sizeBytes: changedAssembly.length,
          kind: "manifest",
          label: "Deliberately mismatched assessment claim",
          contentType: "application/json",
        },
      ],
    }),
  );
  await send("PUT", `${wrongPath}/${changedSha}`, changedAssembly);
  await assert.rejects(
    retained.evidence.assemblyClosure(assessmentId, "wrong-assessment"),
    /does not bind the stored assessment/,
  );
  // Keep the actual guest receipt unchanged while trying to omit its output
  // from both the declared file list and review inputs. Retention must refuse.
  const omittedFiles = [
    manifest.files.find((file) => file.role === "syscall-index")!,
    manifest.files.find((file) => file.role === "untrusted-output")!,
    ...manifest.files.filter((file) => file.role === "raw-filesystem-capture"),
    ...manifest.files.filter(
      (file) => file.role === "provenance-release-archive",
    ),
    ...manifest.files
      .filter((file) => file.role.startsWith("captured-filesystem-object:"))
      .slice(0, 1),
  ];
  for (const [index, omittedFile] of omittedFiles.entries()) {
    const outputSha = omittedFile.sha256;
    const missingRunId = `omitted-evidence-${index}`;
    const truncatedReview = Buffer.from(
      JSON.stringify({
        ...review,
        items: review.items.filter(
          (item: { sha256: string }) => item.sha256 !== outputSha,
        ),
      }),
    );
    const truncatedReviewSha = digest(truncatedReview);
    const truncatedManifest = Buffer.from(
      JSON.stringify({
        ...manifest,
        reviewInputSha256: truncatedReviewSha,
        files: manifest.files.filter((file) => file.sha256 !== outputSha),
      }),
    );
    const truncatedManifestSha = digest(truncatedManifest);
    const omittedOutputPath = `/api/v1/vetting/evidence/${assessmentId}/${missingRunId}`;
    const omittedObjects = objects.filter(
      (object) =>
        ![
          outputSha,
          assembled.manifestSha256,
          manifest.reviewInputSha256,
        ].includes(object.sha256),
    );
    const replacementObjects = [
      [truncatedManifestSha, truncatedManifest, "manifest"],
      [truncatedReviewSha, truncatedReview, "artifact"],
    ] as const;
    await send(
      "POST",
      omittedOutputPath,
      JSON.stringify({
        assemblySha256: truncatedManifestSha,
        traceSha256,
        objects: [
          ...omittedObjects,
          ...replacementObjects.map(([sha256, bytes, kind]) => ({
            sha256,
            sizeBytes: bytes.length,
            kind,
            label: "Deliberately incomplete captured inventory",
            contentType: "application/json",
          })),
        ],
      }),
    );
    for (const object of omittedObjects) {
      const bytes = candidates.get(object.sha256)!;
      if (object.chunks) {
        for (const chunk of object.chunks)
          await send(
            "PUT",
            `${omittedOutputPath}/${object.sha256}/chunks/${chunk.index}`,
            bytes.subarray(
              chunk.index * EVIDENCE_CHUNK_BYTES,
              chunk.index * EVIDENCE_CHUNK_BYTES + chunk.sizeBytes,
            ),
          );
        await send(
          "POST",
          `${omittedOutputPath}/${object.sha256}/finalize`,
          "{}",
        );
      } else await send("PUT", `${omittedOutputPath}/${object.sha256}`, bytes);
    }
    for (const [sha256, bytes] of replacementObjects)
      await send("PUT", `${omittedOutputPath}/${sha256}`, bytes);
    await assert.rejects(
      retained.evidence.assemblyClosure(assessmentId, missingRunId),
      /canonical.*(?:absent|missing)|Source and release comparison does not bind retained inputs/i,
    );
  }
  const overview = await retained.evidence.handle(
    new Request(
      `https://slop.cash/api/v1/operator/vetting-evidence?assessmentId=${assessmentId}&runId=${runId}`,
      { headers: { "x-test-operator": EVIDENCE_OWNER_GITHUB_ID } },
    ),
  );
  assert.equal(overview?.status, 200);
  const view = (await overview!.json()) as {
    runs: { assembly: { retained: boolean; scanReady: boolean } }[];
  };
  assert.equal(view.runs[0].assembly.retained, true);
  assert.equal(view.runs[0].assembly.scanReady, false);
  return {
    retained,
    assembled,
    manifest,
    assessmentId,
    runId,
    traceSha256,
    objects,
    candidates,
    send,
  };
}

/** Built UI + the same real D1/R2 handler. Only the local operator session is adapted. */
export async function captureAssemblyConsole(
  result: Awaited<ReturnType<typeof retainActualAssembly>>,
  outputDirectory: string,
  projectApi: (request: Request) => Promise<Response | null>,
) {
  const { chromium } = await import("@playwright/test");
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const { mkdir } = await import("node:fs/promises");
  const { resolve, sep } = await import("node:path");
  const root = resolve("dist");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/"))
        return (
          (await result.retained.evidence.handle(request)) ??
          (await projectApi(request)) ??
          new Response("Not found", { status: 404 })
        );
      const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (path !== root && !path.startsWith(`${root}${sep}`))
        return new Response(null, { status: 403 });
      const file = Bun.file(path);
      return new Response(
        (await file.exists()) ? file : Bun.file(join(root, "index.html")),
      );
    },
  });
  const browser = await chromium.launch();
  try {
    for (const [name, viewport] of [
      ["desktop", { width: 1440, height: 1000 }],
      ["mobile", { width: 320, height: 800 }],
    ] as const) {
      const directory = join(outputDirectory, name);
      await mkdir(directory, { recursive: true });
      const context = await browser.newContext({
        viewport,
        extraHTTPHeaders: { "x-test-operator": EVIDENCE_OWNER_GITHUB_ID },
        recordVideo: { dir: directory },
      });
      const page = await context.newPage();
      const errors: string[] = [],
        failures: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("requestfailed", (request) =>
        failures.push(
          `${new URL(request.url()).pathname}: ${request.failure()?.errorText}`,
        ),
      );
      await page.goto(
        `${server.url}vetting-evidence?assessmentId=${result.assessmentId}&runId=${result.runId}`,
        { waitUntil: "networkidle" },
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(failures, []);
      await page
        .getByRole("button", { name: "Inspect evidence inventory" })
        .click();
      await page.getByText(/Evidence assembly: Retained/).waitFor();
      assert.match(
        await page.getByText(/Evidence assembly: Retained/).innerText(),
        /Clean admission is unavailable/,
      );
      await page
        .getByText(/Evidence assembly: Retained/)
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(directory, "assembly-status.png"),
        fullPage: false,
      });
      // Let the walkthrough viewer read the retained-versus-ready boundary.
      await page.waitForTimeout(1200);
      const item = page.getByRole("article").filter({
        has: page.getByRole("heading", {
          name: "Canonical captured assembly",
          exact: true,
        }),
      });
      await item
        .getByRole("textbox")
        .fill(
          "Inspect the retained canonical fixture manifest without execution",
        );
      await item.getByRole("button").focus();
      const download = page.waitForEvent("download");
      await page.keyboard.press("Enter");
      const received = await download;
      const saved = join(directory, "captured-assembly.json");
      await received.saveAs(saved);
      assert.equal(await received.failure(), null);
      assert.equal(
        digest(await readFile(saved)),
        result.assembled.manifestSha256,
      );
      // Reflow at the existing 320 CSS-pixel minimum; 200% desktop zoom.
      // Zooming a 390px mobile layout to 195 CSS pixels is below that boundary.
      if (name === "desktop")
        await page.evaluate(() => {
          document.documentElement.style.zoom = "2";
        });
      const restoreText =
        name === "mobile" ? await enlargeText(page.locator("body")) : undefined;
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      assert.equal(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations.length,
        0,
      );
      await page.screenshot({
        path: join(
          directory,
          name === "desktop" ? "assembly-zoom.png" : "assembly-mobile.png",
        ),
        fullPage: false,
      });
      await page.evaluate(() => {
        document.documentElement.style.zoom = "1";
        window.scrollTo(0, 0);
      });
      await restoreText?.();
      await page.screenshot({
        path: join(directory, "assembly.png"),
        fullPage: false,
      });
      assert.deepEqual(errors, []);
      assert.deepEqual(failures, []);
      const video = page.video();
      assert.ok(video);
      await context.close();
      await video.saveAs(join(directory, "assembly-walkthrough.webm"));
    }
  } finally {
    await browser.close();
    await server.stop(true);
  }
}

if (import.meta.main) {
  const [
    sourceDirectory,
    artifactDirectory,
    vmDirectory,
    guestProfile,
    dependencyDirectory,
    outputDirectory,
    provenanceDirectory,
  ] = process.argv.slice(2);
  if (
    !sourceDirectory ||
    !artifactDirectory ||
    !vmDirectory ||
    !guestProfile ||
    !dependencyDirectory ||
    !outputDirectory
  )
    throw new Error(
      "usage: bun scripts/vetting-evidence-assembly-workflow.ts SOURCE REPORTS VM PROFILE DEPENDENCIES PRIVATE_OUTPUT",
    );
  const { retainedAssemblyFixture } = await import(
    "./vetting-retained-assembly-fixture"
  );
  const { signedVettingHeaders, vettingResult } = await import(
    "../tests/vetting-fixtures"
  );
  const { parseVettingResult } = await import("../backend/vetting/result");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(outputDirectory, { recursive: true });
  const fixture = await retainedAssemblyFixture({
    sourceDirectory,
    createEvidence: (db, now) => localVettingEvidence(db, now),
  });
  try {
    const result = await retainActualAssembly({
      ...fixture,
      artifactDirectory,
      vmDirectory,
      guestProfile,
      dependencyDirectory,
      outputDirectory,
      provenanceDirectory,
    });
    const assessment = fixture.assessment;
    // Deliberately false signed clean claim: a negative admission test, not a scan receipt.
    const claim = vettingResult(
      {
        ...assessment,
        assessmentId: assessment.id,
        repository: "example/fixture",
      },
      "clean",
    );
    claim.environment.runId = result.runId;
    claim.environment.startedAt = fixture.now().toISOString();
    claim.environment.completedAt = fixture.now().toISOString();
    claim.assessed.inputManifestSha256 = result.manifest.reviewInputSha256;
    claim.assessed.dependencyLocks = [];
    claim.artifacts = [];
    claim.traceSha256 = result.traceSha256;
    for (const review of claim.modelReviews)
      review.inputManifestSha256 = result.manifest.reviewInputSha256;
    assert.equal(
      await result.retained.evidence.complete(parseVettingResult(claim)),
      false,
    );
    const path = "/api/v1/vetting/results",
      body = JSON.stringify(claim);
    const response = await fixture.vettingApi(
      new Request(`https://slop.cash${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(await signedVettingHeaders(
            fixture.keys.privateKey,
            fixture.keys.raw,
            "POST",
            path,
            body,
            fixture.now(),
          )),
        },
        body,
      }),
    );
    assert.ok(response);
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, "evidence_incomplete");
    assert.equal(
      (await fixture.vetting.getAssessment(assessment.id))?.state,
      "pending",
    );
    await captureAssemblyConsole(
      result,
      join(outputDirectory, "browser"),
      fixture.projectApi,
    );
    const removed = result.manifest.files.find(
      (file) => file.role === "source-inventory",
    )!;
    const stored = fixture.sqlite
      .query(
        "SELECT object_key,sha256,storage FROM vetting_evidence_objects WHERE assessment_id=? AND run_id=? AND sha256=?",
      )
      .get(result.assessmentId, result.runId, removed.sha256) as {
      object_key: string;
      sha256: string;
      storage: string;
    };
    // Content-addressed rows (migration 0107) keep their bytes by digest.
    await result.retained.bucket.delete(evidenceLocation(stored));
    await assert.rejects(
      result.retained.evidence.assemblyClosure(
        result.assessmentId,
        result.runId,
      ),
    );
    assert.equal(
      await result.retained.evidence.complete(parseVettingResult(claim)),
      false,
    );
    console.log(
      JSON.stringify({
        schema: "local-retained-assembly-workflow-evidence-v1",
        authenticatedFreshQueue: true,
        sourceInventoryByteIdentical: true,
        runtimeEvidence: "replayed-retained-fixture-no-intrinsic-run-identity",
        assemblySha256: result.assembled.manifestSha256,
        retainedObjects: result.objects.length,
        retainedBytes: result.objects.reduce(
          (total, object) => total + object.sizeBytes,
          0,
        ),
        assemblyState: result.manifest.state,
        scanReady: false,
        cleanHttpStatus: response.status,
        missingObjectRefused: true,
        browser:
          "desktop200% zoom/mobile320CSSpx200% text, actual handler/R2 with isolated operator-session adapter",
      }),
    );
  } finally {
    await fixture.dispose();
  }
}
