import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  planReferencedArtifacts,
  verifyReferencedArtifacts,
} from "./pr-evidence-artifacts.mjs";

// Real VP8/WebM: 320x180, 10 fps, 60 frames. The first 20 canvas frames are
// gray; moving RGB tiles follow. FFmpeg 7.0.1 Playwright build 1011 encoded
// JPEG frames with libvpx, -b:v 128k -g 10 -threads 1 -cluster_time_limit 500.
// All 60 frames decode in FFmpeg; Chromium also plays/seeks the 6-second clip.
// The first Cluster has blocks of at most 138 bytes; a later one reaches 6972.
const video = readFileSync(
  new URL("../tests/fixtures/later-cluster-evidence.webm", import.meta.url),
);
const url =
  "https://github.com/user-attachments/assets/11111111-1111-4111-8111-111111111111";
const body = `<!-- evidence-row:walkthrough-video -->
[Walkthrough video](${url})`;
const rows = [{ id: "walkthrough-video", label: "Walkthrough video" }];

async function verify(bytes: Uint8Array, contentDigestLimitBytes?: number) {
  expect(planReferencedArtifacts(body, rows)).toEqual({
    referenceCount: 1,
    uniqueArtifactCount: 1,
  });
  let requests = 0;
  const result = await verifyReferencedArtifacts(body, rows, {
    token: "",
    ...(contentDigestLimitBytes === undefined
      ? {}
      : { contentDigestLimitBytes }),
    fetchImpl: async (requested) => {
      expect(String(requested)).toBe(url);
      requests += 1;
      return new Response(new Uint8Array(bytes), {
        headers: {
          "content-type": "video/webm",
          "content-length": String(bytes.length),
        },
      });
    },
  });
  expect(requests).toBe(1);
  return result;
}

for (const [mode, limit] of [
  ["bounded prefix", undefined],
  ["complete content digest", 1024 * 1024],
] as const) {
  test(`accepts real video with payload in a later Cluster: ${mode}`, async () => {
    const result = await verify(video, limit);
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.status).toBe("ok");
  });

  test(`still requires the video Tracks element: ${mode}`, async () => {
    const changed = Buffer.from(video);
    // Actual top-level Tracks, not its earlier SeekHead reference.
    const tracks = 262;
    expect([...changed.subarray(tracks, tracks + 4)]).toEqual([
      0x16, 0x54, 0xae, 0x6b,
    ]);
    changed[tracks] = 0x15;
    const result = await verify(changed, limit);
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.status).toBe("artifact-kind-mismatch");
  });
}
