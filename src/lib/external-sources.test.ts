/**
 * Proves that an external evaluated source must be the canonical public URL
 * for its platform and must carry archive evidence, so a deleted post can
 * still be audited and the same URL can never be awarded twice.
 */

import { describe, expect, it } from "vitest";
import {
  assertExternalSourceEvidence,
  assertExternalSourceUrl,
  externalSourceId,
} from "./external-sources";

const post = "https://x.com/shawmakesmagic/status/1830000000000000000";

describe("external evaluated sources", () => {
  it("accepts only canonical public URLs per platform", () => {
    expect(assertExternalSourceUrl(post, "x", "url")).toBe(post);
    expect(
      assertExternalSourceUrl(
        "https://discord.com/channels/1/2/3",
        "discord",
        "url",
      ),
    ).toBe("https://discord.com/channels/1/2/3");
    expect(
      assertExternalSourceUrl("https://youtu.be/dQw4w9WgXcQ", "youtube", "url"),
    ).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(
      assertExternalSourceUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "youtube",
        "url",
      ),
    ).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(
      assertExternalSourceUrl(
        "https://blog.example.org/eliza-plugin-tutorial",
        "web",
        "url",
      ),
    ).toBe("https://blog.example.org/eliza-plugin-tutorial");

    for (const [value, platform] of [
      ["https://x.com/shawmakesmagic", "x"],
      [`${post}?s=20`, "x"],
      ["http://x.com/shawmakesmagic/status/1", "x"],
      ["https://discord.gg/invite", "discord"],
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "youtube"],
      ["https://github.com/elizaOS/eliza/discussions/1", "web"],
      ["https://x.com/shawmakesmagic/status/1", "web"],
      ["https://example.org/", "web"],
      ["https://example.org/post?utm=1", "web"],
      ["https://user:pw@example.org/post", "web"],
      ["https://example.org/post#section", "web"],
    ] as const) {
      expect(() => assertExternalSourceUrl(value, platform, "url")).toThrow(
        /canonical public|plain https/u,
      );
    }
  });

  it("requires archive evidence that points at the exact source", () => {
    const evidence = {
      archiveUrl: `https://web.archive.org/web/20260901120000/${post}`,
      contentSha256: "a".repeat(64),
      capturedAt: "2026-09-01T12:00:00.000Z",
    };
    expect(assertExternalSourceEvidence(evidence, post, "evidence")).toEqual(
      evidence,
    );
    expect(
      assertExternalSourceEvidence(
        { ...evidence, archiveUrl: "https://archive.ph/AbCdE" },
        post,
        "evidence",
      ).archiveUrl,
    ).toBe("https://archive.ph/AbCdE");

    expect(() =>
      assertExternalSourceEvidence(
        {
          ...evidence,
          archiveUrl:
            "https://web.archive.org/web/20260901120000/https://x.com/other/status/2",
        },
        post,
        "evidence",
      ),
    ).toThrow(/capture of the source/u);
    expect(() =>
      assertExternalSourceEvidence(
        { ...evidence, archiveUrl: "https://example.org/mirror" },
        post,
        "evidence",
      ),
    ).toThrow(/capture of the source/u);
    expect(() =>
      assertExternalSourceEvidence(
        { ...evidence, contentSha256: "A".repeat(64) },
        post,
        "evidence",
      ),
    ).toThrow(/contentSha256/u);
    expect(() =>
      assertExternalSourceEvidence(
        { ...evidence, capturedAt: "2026-09-01T12:00:00Z" },
        post,
        "evidence",
      ),
    ).toThrow(/capturedAt/u);
    expect(() =>
      assertExternalSourceEvidence(
        { ...evidence, screenshot: "data:image/png;base64,AAAA" },
        post,
        "evidence",
      ),
    ).toThrow(/unexpected or missing/u);
  });

  it("derives one deterministic id per URL", () => {
    expect(externalSourceId(post)).toMatch(/^external-[0-9a-f]{64}$/u);
    expect(externalSourceId(post)).toBe(externalSourceId(post));
    expect(externalSourceId(post)).not.toBe(externalSourceId(`${post}1`));
  });
});
